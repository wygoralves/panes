use std::collections::HashSet;

use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{RepoDto, TrustLevelDto};
use crate::path_utils;

use super::Database;

pub fn upsert_repo(
    db: &Database,
    workspace_id: &str,
    name: &str,
    path: &str,
    default_branch: &str,
    default_is_active: bool,
) -> anyhow::Result<RepoDto> {
    let conn = db.connect()?;
    let normalized_path = path_utils::normalize_windows_path_string(path);
    let legacy_path = path_utils::legacy_windows_verbatim_path_string(&normalized_path)
        .filter(|legacy| legacy != &normalized_path);

    let existing = if let Some(id) =
        find_repo_id_by_workspace_and_path(&conn, workspace_id, &normalized_path)?
    {
        Some(id)
    } else if let Some(legacy_path) = legacy_path.as_deref() {
        find_repo_id_by_workspace_and_path(&conn, workspace_id, legacy_path)?
    } else {
        None
    };

    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE repos
         SET name = ?1, path = ?2, default_branch = ?3, is_discovered = 1
         WHERE id = ?4",
                params![name, normalized_path, default_branch, id],
            )
            .context("failed to update repo")?;
        }
        None => {
            conn.execute(
                "INSERT INTO repos (
            id,
            workspace_id,
            name,
            path,
            default_branch,
            is_active,
            is_discovered,
            trust_level
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'standard')",
                params![
                    Uuid::new_v4().to_string(),
                    workspace_id,
                    name,
                    normalized_path,
                    default_branch,
                    if default_is_active { 1 } else { 0 }
                ],
            )
            .context("failed to insert repo")?;
        }
    }

    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos
     WHERE workspace_id = ?1 AND path = ?2",
        params![workspace_id, normalized_path],
        map_repo_row,
    )
    .context("failed to fetch upserted repo")
}

pub fn get_repos(db: &Database, workspace_id: &str) -> anyhow::Result<Vec<RepoDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos
     WHERE workspace_id = ?1
       AND is_discovered = 1
     ORDER BY name ASC",
    )?;

    let rows = stmt.query_map(params![workspace_id], map_repo_row)?;
    let mut repos = Vec::new();

    for row in rows {
        repos.push(row?);
    }

    Ok(repos)
}

pub fn reconcile_workspace_repos(
    db: &Database,
    workspace_id: &str,
    discovered_paths: &[String],
) -> anyhow::Result<()> {
    let discovered_paths = discovered_paths
        .iter()
        .map(|path| path_utils::normalize_windows_path_string(path))
        .collect::<HashSet<_>>();
    let mut conn = db.connect()?;
    let tx = conn.transaction().context("failed to start transaction")?;

    let stale_repo_paths = {
        let mut stmt = tx
            .prepare("SELECT path FROM repos WHERE workspace_id = ?1")
            .context("failed to prepare workspace repo reconciliation query")?;
        let rows = stmt
            .query_map(params![workspace_id], |row| row.get::<_, String>(0))
            .context("failed to query workspace repos for reconciliation")?;

        let mut stale_repo_paths = Vec::new();
        for row in rows {
            let raw_repo_path = row.context("failed to decode workspace repo row")?;
            let normalized_repo_path = path_utils::normalize_windows_path_string(&raw_repo_path);
            if !discovered_paths.contains(&normalized_repo_path) {
                stale_repo_paths.push(raw_repo_path);
            }
        }
        stale_repo_paths
    };

    tx.execute(
        "UPDATE repos
         SET is_discovered = 1
         WHERE workspace_id = ?1",
        params![workspace_id],
    )
    .context("failed to reset workspace repo discovery state")?;

    for repo_path in stale_repo_paths {
        tx.execute(
            "UPDATE repos
             SET is_discovered = 0
             WHERE workspace_id = ?1
               AND path = ?2",
            params![workspace_id, repo_path],
        )
        .context("failed to hide stale workspace repo")?;
    }

    tx.commit()
        .context("failed to commit workspace repo reconciliation")?;
    Ok(())
}

pub fn set_repo_trust_level(
    db: &Database,
    repo_id: &str,
    trust_level: TrustLevelDto,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE repos SET trust_level = ?1 WHERE id = ?2",
        params![trust_level.as_str(), repo_id],
    )
    .context("failed to update repo trust level")?;
    Ok(())
}

pub fn set_repo_active(db: &Database, repo_id: &str, is_active: bool) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE repos
         SET is_active = ?1
         WHERE id = ?2",
            params![if is_active { 1 } else { 0 }, repo_id],
        )
        .context("failed to update repo active flag")?;

    if affected == 0 {
        anyhow::bail!("repo not found: {repo_id}");
    }

    Ok(())
}

pub fn set_workspace_active_repos(
    db: &Database,
    workspace_id: &str,
    repo_ids: &[String],
) -> anyhow::Result<()> {
    let mut conn = db.connect()?;
    let tx = conn.transaction().context("failed to start transaction")?;

    tx.execute(
        "UPDATE repos
     SET is_active = 0
     WHERE workspace_id = ?1",
        params![workspace_id],
    )
    .context("failed to clear active repos")?;

    for repo_id in repo_ids {
        tx.execute(
            "UPDATE repos
         SET is_active = 1
         WHERE workspace_id = ?1
           AND id = ?2",
            params![workspace_id, repo_id],
        )
        .context("failed to activate selected repo")?;
    }

    tx.commit()
        .context("failed to commit repo active selection transaction")?;
    Ok(())
}

pub fn find_deepest_repo_containing_path(
    db: &Database,
    path: &str,
    workspace_id: Option<&str>,
) -> anyhow::Result<Option<RepoDto>> {
    let conn = db.connect()?;
    let normalized_path = path_utils::normalize_windows_path_string(path);
    let rows = if let Some(workspace_id) = workspace_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
                 FROM repos
                 WHERE is_discovered = 1
                   AND workspace_id = ?1",
            )
            .context("failed to prepare containing repo query")?;
        let rows = stmt
            .query_map(params![workspace_id], map_repo_row)
            .context("failed to query containing repos")?
            .collect::<Result<Vec<_>, _>>()
            .context("failed to decode containing repo rows")?;
        rows
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
                 FROM repos
                 WHERE is_discovered = 1",
            )
            .context("failed to prepare containing repo query")?;
        let rows = stmt
            .query_map([], map_repo_row)
            .context("failed to query containing repos")?
            .collect::<Result<Vec<_>, _>>()
            .context("failed to decode containing repo rows")?;
        rows
    };

    let mut best_match: Option<RepoDto> = None;
    let mut best_path_len = 0;

    for repo in rows {
        if !path_utils::is_path_within_root(&normalized_path, &repo.path) {
            continue;
        }

        let repo_path_len = repo.path.len();
        if repo_path_len > best_path_len {
            best_path_len = repo_path_len;
            best_match = Some(repo);
        }
    }

    Ok(best_match)
}

pub fn find_repo_by_id(db: &Database, repo_id: &str) -> anyhow::Result<Option<RepoDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos WHERE id = ?1",
        params![repo_id],
        map_repo_row,
    )
    .optional()
    .context("failed to load repo by id")
}

fn map_repo_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepoDto> {
    let path = path_utils::normalize_windows_path_string(&row.get::<_, String>(3)?);
    Ok(RepoDto {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        path,
        default_branch: row.get(4)?,
        is_active: row.get::<_, i64>(5)? > 0,
        trust_level: TrustLevelDto::from_str(&row.get::<_, String>(6)?),
    })
}

fn find_repo_id_by_workspace_and_path(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    path: &str,
) -> anyhow::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM repos WHERE workspace_id = ?1 AND path = ?2",
        params![workspace_id, path],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .context("failed to query repo")
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Arc, Mutex},
    };

    use uuid::Uuid;

    use crate::db::{threads, workspaces, ConnectionPool, SQLITE_POOL_MAX_IDLE};

    use super::*;

    fn test_db() -> Database {
        let path = std::env::temp_dir().join(format!("panes-repos-{}.db", Uuid::new_v4()));
        let db = Database {
            path,
            pool: Arc::new(ConnectionPool {
                idle: Mutex::new(Vec::new()),
                max_idle: SQLITE_POOL_MAX_IDLE,
            }),
        };
        db.run_migrations().expect("failed to run test migrations");
        db
    }

    #[test]
    fn reconcile_workspace_repos_hides_stale_rows_and_preserves_repo_metadata() {
        let db = test_db();
        let root = std::env::temp_dir().join(format!("panes-workspace-{}", Uuid::new_v4()));
        let keep_path = root.join("keep");
        let stale_path = root.join("stale");

        fs::create_dir_all(&keep_path).expect("failed to create keep repo path");
        fs::create_dir_all(&stale_path).expect("failed to create stale repo path");

        let workspace = workspaces::upsert_workspace(&db, root.to_string_lossy().as_ref(), Some(3))
            .expect("failed to create workspace");

        let keep_repo = upsert_repo(
            &db,
            &workspace.id,
            "keep",
            keep_path.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to insert keep repo");
        let stale_repo = upsert_repo(
            &db,
            &workspace.id,
            "stale",
            stale_path.to_string_lossy().as_ref(),
            "main",
            false,
        )
        .expect("failed to insert stale repo");
        set_repo_trust_level(&db, &stale_repo.id, TrustLevelDto::Restricted)
            .expect("failed to update stale repo trust level");
        let thread = threads::create_thread(
            &db,
            &workspace.id,
            Some(&stale_repo.id),
            "codex",
            "gpt-5.3-codex",
            "Repo thread",
        )
        .expect("failed to create thread");

        reconcile_workspace_repos(
            &db,
            &workspace.id,
            &[keep_path.to_string_lossy().to_string()],
        )
        .expect("failed to reconcile repos");

        let repos = get_repos(&db, &workspace.id).expect("failed to reload repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, keep_repo.id);
        assert_eq!(
            threads::get_thread(&db, &thread.id)
                .expect("failed to reload thread")
                .expect("thread should still exist")
                .repo_id,
            Some(stale_repo.id.clone())
        );

        let hidden_stale_repo = find_repo_by_id(&db, &stale_repo.id)
            .expect("failed to reload stale repo")
            .expect("stale repo row should still exist");
        assert!(!hidden_stale_repo.is_active);
        assert_eq!(hidden_stale_repo.trust_level, TrustLevelDto::Restricted);

        reconcile_workspace_repos(
            &db,
            &workspace.id,
            &[
                keep_path.to_string_lossy().to_string(),
                stale_path.to_string_lossy().to_string(),
            ],
        )
        .expect("failed to re-discover repos");

        let rediscovered = get_repos(&db, &workspace.id).expect("failed to reload repos");
        let rediscovered_stale_repo = rediscovered
            .into_iter()
            .find(|repo| repo.id == stale_repo.id)
            .expect("stale repo should be visible again after re-discovery");
        assert!(!rediscovered_stale_repo.is_active);
        assert_eq!(
            rediscovered_stale_repo.trust_level,
            TrustLevelDto::Restricted
        );
    }

    #[test]
    fn finds_deepest_repo_containing_path() {
        let db = test_db();
        let root = std::env::temp_dir().join(format!("panes-workspace-{}", Uuid::new_v4()));
        let app_repo_path = root.join("apps/app");
        let nested_repo_path = app_repo_path.join("packages/web");

        fs::create_dir_all(&nested_repo_path).expect("failed to create nested repo path");

        let workspace = workspaces::upsert_workspace(&db, root.to_string_lossy().as_ref(), Some(3))
            .expect("failed to create workspace");

        let app_repo = upsert_repo(
            &db,
            &workspace.id,
            "app",
            app_repo_path.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to insert app repo");
        let nested_repo = upsert_repo(
            &db,
            &workspace.id,
            "web",
            nested_repo_path.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to insert nested repo");

        let nested_file = nested_repo_path.join("src/page.tsx");
        let resolved_nested = find_deepest_repo_containing_path(
            &db,
            nested_file.to_string_lossy().as_ref(),
            Some(&workspace.id),
        )
        .expect("failed to resolve nested repo")
        .expect("nested repo should resolve");
        assert_eq!(resolved_nested.id, nested_repo.id);

        let app_file = app_repo_path.join("src/main.ts");
        let resolved_app = find_deepest_repo_containing_path(
            &db,
            app_file.to_string_lossy().as_ref(),
            Some(&workspace.id),
        )
        .expect("failed to resolve app repo")
        .expect("app repo should resolve");
        assert_eq!(resolved_app.id, app_repo.id);

        let outside_file = root.join("README.md");
        assert!(find_deepest_repo_containing_path(
            &db,
            outside_file.to_string_lossy().as_ref(),
            Some(&workspace.id),
        )
        .expect("failed to resolve outside file")
        .is_none());
    }

    #[test]
    fn scopes_containing_repo_lookup_to_workspace_when_paths_overlap() {
        let db = test_db();
        let root = std::env::temp_dir().join(format!("panes-workspace-{}", Uuid::new_v4()));
        let nested_repo_path = root.join("packages/web");

        fs::create_dir_all(&nested_repo_path).expect("failed to create nested repo path");

        let parent_workspace =
            workspaces::upsert_workspace(&db, root.to_string_lossy().as_ref(), Some(3))
                .expect("failed to create parent workspace");
        let nested_workspace =
            workspaces::upsert_workspace(&db, nested_repo_path.to_string_lossy().as_ref(), Some(3))
                .expect("failed to create nested workspace");

        let parent_repo = upsert_repo(
            &db,
            &parent_workspace.id,
            "web-parent",
            nested_repo_path.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to insert parent workspace repo");
        let nested_repo = upsert_repo(
            &db,
            &nested_workspace.id,
            "web-nested",
            nested_repo_path.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to insert nested workspace repo");
        set_repo_trust_level(&db, &parent_repo.id, TrustLevelDto::Trusted)
            .expect("failed to set parent trust");
        set_repo_trust_level(&db, &nested_repo.id, TrustLevelDto::Restricted)
            .expect("failed to set nested trust");

        let nested_file = nested_repo_path.join("src/page.tsx");
        let resolved_parent = find_deepest_repo_containing_path(
            &db,
            nested_file.to_string_lossy().as_ref(),
            Some(&parent_workspace.id),
        )
        .expect("failed to resolve parent-scoped repo")
        .expect("parent workspace repo should resolve");
        assert_eq!(resolved_parent.id, parent_repo.id);
        assert_eq!(resolved_parent.trust_level, TrustLevelDto::Trusted);

        let resolved_nested = find_deepest_repo_containing_path(
            &db,
            nested_file.to_string_lossy().as_ref(),
            Some(&nested_workspace.id),
        )
        .expect("failed to resolve nested-scoped repo")
        .expect("nested workspace repo should resolve");
        assert_eq!(resolved_nested.id, nested_repo.id);
        assert_eq!(resolved_nested.trust_level, TrustLevelDto::Restricted);
    }
}
