use std::collections::HashSet;

use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{RepoDto, TrustLevelDto};

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

    let existing = conn
        .query_row(
            "SELECT id FROM repos WHERE workspace_id = ?1 AND path = ?2",
            params![workspace_id, path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to query repo")?;

    match existing {
        Some(id) => {
            conn.execute(
                "UPDATE repos
         SET name = ?1, default_branch = ?2, is_discovered = 1
         WHERE id = ?3",
                params![name, default_branch, id],
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
                    path,
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
        params![workspace_id, path],
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
    let discovered_paths = discovered_paths.iter().cloned().collect::<HashSet<_>>();
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
            let repo_path = row.context("failed to decode workspace repo row")?;
            if !discovered_paths.contains(&repo_path) {
                stale_repo_paths.push(repo_path);
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

pub fn find_repo_by_path(db: &Database, path: &str) -> anyhow::Result<Option<RepoDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos WHERE path = ?1 LIMIT 1",
        params![path],
        map_repo_row,
    )
    .optional()
    .context("failed to load repo by path")
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
    Ok(RepoDto {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        default_branch: row.get(4)?,
        is_active: row.get::<_, i64>(5)? > 0,
        trust_level: TrustLevelDto::from_str(&row.get::<_, String>(6)?),
    })
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
}
