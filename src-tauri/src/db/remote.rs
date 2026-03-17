use anyhow::Context;
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::{CreatedRemoteDeviceGrantDto, RemoteDeviceGrantDto};

use super::Database;

const SQLITE_DATETIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

pub fn list_device_grants(db: &Database) -> anyhow::Result<Vec<RemoteDeviceGrantDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
         FROM remote_device_grants
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([], map_device_grant_row)?;

    let mut grants = Vec::new();
    for row in rows {
        grants.push(row?);
    }

    Ok(grants)
}

pub fn create_device_grant(
    db: &Database,
    label: &str,
    scopes: &[String],
    expires_at: Option<&str>,
) -> anyhow::Result<CreatedRemoteDeviceGrantDto> {
    let conn = db.connect()?;
    let id = Uuid::new_v4().to_string();
    let token = generate_device_grant_token();
    let token_hash = hash_token(&token);
    let normalized_label = normalize_label(label)?;
    let normalized_scopes = normalize_scopes(scopes);
    let scopes_json =
        serde_json::to_string(&normalized_scopes).context("failed to encode device grant scopes")?;
    let normalized_expires_at = normalize_expires_at(expires_at)?;

    conn.execute(
        "INSERT INTO remote_device_grants (
            id, token_hash, label, scopes_json, expires_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            token_hash,
            normalized_label,
            scopes_json,
            normalized_expires_at,
        ],
    )
    .context("failed to insert remote device grant")?;

    let grant = get_device_grant_by_id(db, &id)?
        .ok_or_else(|| anyhow::anyhow!("created remote device grant missing after insert"))?;

    Ok(CreatedRemoteDeviceGrantDto { grant, token })
}

pub fn revoke_device_grant(db: &Database, grant_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE remote_device_grants
             SET revoked_at = COALESCE(revoked_at, datetime('now'))
             WHERE id = ?1",
            params![grant_id],
        )
        .context("failed to revoke remote device grant")?;

    if affected == 0 {
        anyhow::bail!("remote device grant not found: {grant_id}");
    }

    Ok(())
}

#[allow(dead_code)]
pub fn find_active_device_grant_by_token(
    db: &Database,
    token: &str,
) -> anyhow::Result<Option<RemoteDeviceGrantDto>> {
    let conn = db.connect()?;
    let token_hash = hash_token(token);
    let grant = conn
        .query_row(
            "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
             FROM remote_device_grants
             WHERE token_hash = ?1",
            params![token_hash],
            map_device_grant_row,
        )
        .optional()
        .context("failed to query remote device grant by token")?;

    Ok(grant.filter(is_grant_active))
}

#[allow(dead_code)]
pub fn touch_device_grant_last_used(db: &Database, grant_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE remote_device_grants
         SET last_used_at = datetime('now')
         WHERE id = ?1",
        params![grant_id],
    )
    .context("failed to update remote device grant last_used_at")?;
    Ok(())
}

fn get_device_grant_by_id(
    db: &Database,
    grant_id: &str,
) -> anyhow::Result<Option<RemoteDeviceGrantDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
         FROM remote_device_grants
         WHERE id = ?1",
        params![grant_id],
        map_device_grant_row,
    )
    .optional()
    .context("failed to query remote device grant by id")
}

fn map_device_grant_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteDeviceGrantDto> {
    let scopes_json: String = row.get(2)?;
    let scopes = serde_json::from_str(&scopes_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            2,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })?;

    Ok(RemoteDeviceGrantDto {
        id: row.get(0)?,
        label: row.get(1)?,
        scopes,
        created_at: row.get(3)?,
        expires_at: row.get(4)?,
        revoked_at: row.get(5)?,
        last_used_at: row.get(6)?,
    })
}

fn normalize_label(label: &str) -> anyhow::Result<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        anyhow::bail!("remote device grant label cannot be empty");
    }
    Ok(trimmed.to_string())
}

fn normalize_scopes(scopes: &[String]) -> Vec<String> {
    let mut normalized = scopes
        .iter()
        .map(|scope| scope.trim())
        .filter(|scope| !scope.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    normalized
}

fn normalize_expires_at(expires_at: Option<&str>) -> anyhow::Result<Option<String>> {
    expires_at
        .map(|value| {
            parse_timestamp(value)
                .ok_or_else(|| anyhow::anyhow!("invalid remote device grant expiry timestamp"))
                .map(|timestamp| timestamp.format(SQLITE_DATETIME_FORMAT).to_string())
        })
        .transpose()
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, SQLITE_DATETIME_FORMAT)
                .ok()
                .map(|timestamp| DateTime::<Utc>::from_naive_utc_and_offset(timestamp, Utc))
        })
}

#[allow(dead_code)]
fn is_grant_active(grant: &RemoteDeviceGrantDto) -> bool {
    if grant.revoked_at.is_some() {
        return false;
    }

    match grant.expires_at.as_deref().and_then(parse_timestamp) {
        Some(expires_at) => expires_at > Utc::now(),
        None => true,
    }
}

fn generate_device_grant_token() -> String {
    format!(
        "panes_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

fn hash_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;

    fn test_db() -> Database {
        let path = std::env::temp_dir().join(format!("panes-db-remote-{}.db", Uuid::new_v4()));
        Database::open(path).expect("failed to initialize test db")
    }

    #[test]
    fn create_device_grant_persists_token_hash_and_scopes() {
        let db = test_db();
        let created = create_device_grant(
            &db,
            "  My iPad  ",
            &[
                "terminal.read".to_string(),
                "terminal.read".to_string(),
                " chat.read ".to_string(),
            ],
            None,
        )
        .expect("failed to create device grant");

        assert_eq!(created.grant.label, "My iPad");
        assert_eq!(
            created.grant.scopes,
            vec!["chat.read".to_string(), "terminal.read".to_string()]
        );
        assert!(created.token.starts_with("panes_"));

        let looked_up = find_active_device_grant_by_token(&db, &created.token)
            .expect("failed to look up grant by token")
            .expect("grant should be active");
        assert_eq!(looked_up.id, created.grant.id);
        assert_eq!(looked_up.scopes, created.grant.scopes);

        let conn = db.connect().expect("failed to open test db");
        let stored_hash: String = conn
            .query_row(
                "SELECT token_hash FROM remote_device_grants WHERE id = ?1",
                params![created.grant.id],
                |row| row.get(0),
            )
            .expect("failed to query stored token hash");
        assert_ne!(stored_hash, created.token);
    }

    #[test]
    fn revoked_and_expired_grants_are_not_active() {
        let db = test_db();
        let created = create_device_grant(
            &db,
            "Remote Laptop",
            &[],
            Some(&(Utc::now() - Duration::minutes(5)).to_rfc3339()),
        )
        .expect("failed to create expiring grant");

        assert!(
            find_active_device_grant_by_token(&db, &created.token)
                .expect("failed to look up expired grant")
                .is_none()
        );

        let active = create_device_grant(&db, "Desk", &[], None)
            .expect("failed to create active grant");
        revoke_device_grant(&db, &active.grant.id).expect("failed to revoke grant");
        assert!(
            find_active_device_grant_by_token(&db, &active.token)
                .expect("failed to look up revoked grant")
                .is_none()
        );
    }
}
