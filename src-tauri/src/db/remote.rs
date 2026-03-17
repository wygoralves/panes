use anyhow::Context;
use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::models::{
    CreatedRemoteDeviceGrantDto, RemoteAuditEventDto, RemoteControllerLeaseDto,
    RemoteDeviceGrantDto,
};

use super::Database;

const SQLITE_DATETIME_FORMAT: &str = "%Y-%m-%d %H:%M:%S";
const MIN_CONTROLLER_LEASE_TTL_SECS: u64 = 15;
const MAX_CONTROLLER_LEASE_TTL_SECS: u64 = 60 * 60;
const DEFAULT_REMOTE_AUDIT_LIMIT: usize = 100;
const MAX_REMOTE_AUDIT_LIMIT: usize = 200;

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

pub fn list_remote_audit_events(
    db: &Database,
    limit: Option<usize>,
) -> anyhow::Result<Vec<RemoteAuditEventDto>> {
    let normalized_limit = normalize_remote_audit_limit(limit);
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, device_grant_id, action_type, target_type, target_id, payload_json, created_at
         FROM remote_audit_events
         ORDER BY created_at DESC, id DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![normalized_limit as i64], map_remote_audit_event_row)?;

    let mut audit_events = Vec::new();
    for row in rows {
        audit_events.push(row?);
    }

    Ok(audit_events)
}

pub fn create_device_grant(
    db: &Database,
    label: &str,
    scopes: &[String],
    expires_at: Option<&str>,
) -> anyhow::Result<CreatedRemoteDeviceGrantDto> {
    let mut conn = db.connect()?;
    let id = Uuid::new_v4().to_string();
    let token = generate_device_grant_token();
    let token_hash = hash_token(&token);
    let normalized_label = normalize_label(label)?;
    let normalized_scopes = normalize_scopes(scopes)?;
    let scopes_json = serde_json::to_string(&normalized_scopes)
        .context("failed to encode device grant scopes")?;
    let normalized_expires_at = normalize_expires_at(expires_at)?;
    let tx = conn
        .transaction()
        .context("failed to start remote device grant create transaction")?;

    tx.execute(
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

    let grant = get_device_grant_by_id_tx(&tx, &id)?
        .ok_or_else(|| anyhow::anyhow!("created remote device grant missing after insert"))?;
    let audit_payload = json!({
        "label": grant.label.clone(),
        "scopes": grant.scopes.clone(),
        "expiresAt": grant.expires_at.clone(),
    });
    insert_remote_audit_event_tx(
        &tx,
        Some(&grant.id),
        "remote_device_grant.created",
        "remote_device_grant",
        Some(&grant.id),
        Some(&audit_payload),
    )?;
    tx.commit()
        .context("failed to commit remote device grant create transaction")?;

    Ok(CreatedRemoteDeviceGrantDto { grant, token })
}

pub fn revoke_device_grant(db: &Database, grant_id: &str) -> anyhow::Result<()> {
    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start remote device grant revoke transaction")?;
    let existing_grant = get_device_grant_by_id_tx(&tx, grant_id)?
        .ok_or_else(|| anyhow::anyhow!("remote device grant not found: {grant_id}"))?;
    let already_revoked = existing_grant.revoked_at.is_some();

    tx.execute(
        "UPDATE remote_device_grants
         SET revoked_at = COALESCE(revoked_at, datetime('now'))
         WHERE id = ?1",
        params![grant_id],
    )
    .context("failed to revoke remote device grant")?;

    tx.execute(
        "UPDATE remote_controller_leases
         SET released_at = COALESCE(released_at, datetime('now'))
         WHERE device_grant_id = ?1
           AND released_at IS NULL",
        params![grant_id],
    )
    .context("failed to release controller leases for revoked device grant")?;

    if !already_revoked {
        insert_remote_audit_event_tx(
            &tx,
            Some(grant_id),
            "remote_device_grant.revoked",
            "remote_device_grant",
            Some(grant_id),
            None,
        )?;
    }

    tx.commit()
        .context("failed to commit remote device grant revoke transaction")?;

    Ok(())
}

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

pub fn touch_device_grant_last_used(db: &Database, grant_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE remote_device_grants
         SET last_used_at = datetime('now')
         WHERE id = ?1",
            params![grant_id],
        )
        .context("failed to update remote device grant last_used_at")?;

    if affected == 0 {
        anyhow::bail!("remote device grant not found: {grant_id}");
    }

    Ok(())
}

pub fn get_active_controller_lease(
    db: &Database,
    scope_type: &str,
    scope_id: &str,
) -> anyhow::Result<Option<RemoteControllerLeaseDto>> {
    let normalized_scope_type = normalize_scope_value(scope_type, "scope type")?;
    let normalized_scope_id = normalize_scope_value(scope_id, "scope id")?;
    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start controller lease lookup transaction")?;
    cleanup_inactive_controller_leases(&tx)?;
    let lease = get_active_controller_lease_tx(&tx, &normalized_scope_type, &normalized_scope_id)?;
    tx.commit()
        .context("failed to commit controller lease lookup transaction")?;
    Ok(lease)
}

pub fn get_controller_lease_by_id(
    db: &Database,
    lease_id: &str,
) -> anyhow::Result<Option<RemoteControllerLeaseDto>> {
    let conn = db.connect()?;
    get_controller_lease_by_id_tx(&conn, lease_id)
}

pub fn acquire_controller_lease(
    db: &Database,
    grant_id: &str,
    scope_type: &str,
    scope_id: &str,
    ttl_secs: u64,
) -> anyhow::Result<RemoteControllerLeaseDto> {
    if !(MIN_CONTROLLER_LEASE_TTL_SECS..=MAX_CONTROLLER_LEASE_TTL_SECS).contains(&ttl_secs) {
        anyhow::bail!(
            "controller lease ttl must be between {MIN_CONTROLLER_LEASE_TTL_SECS} and {MAX_CONTROLLER_LEASE_TTL_SECS} seconds"
        );
    }

    let normalized_scope_type = normalize_scope_value(scope_type, "scope type")?;
    let normalized_scope_id = normalize_scope_value(scope_id, "scope id")?;

    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start controller lease transaction")?;
    cleanup_inactive_controller_leases(&tx)?;

    let grant = get_device_grant_by_id_tx(&tx, grant_id)?
        .ok_or_else(|| anyhow::anyhow!("remote device grant not found: {grant_id}"))?;
    if !is_grant_active(&grant) {
        anyhow::bail!("remote device grant is not active: {grant_id}");
    }

    let expires_at = format_timestamp(Utc::now() + Duration::seconds(ttl_secs as i64));

    let (lease, action_type) =
        match get_active_controller_lease_tx(&tx, &normalized_scope_type, &normalized_scope_id)? {
            Some(existing) if existing.device_grant_id == grant_id => {
                tx.execute(
                    "UPDATE remote_controller_leases
                 SET expires_at = ?2
                 WHERE id = ?1",
                    params![existing.id, expires_at],
                )
                .context("failed to extend controller lease")?;
                let lease = get_controller_lease_by_id_tx(&tx, &existing.id)?.ok_or_else(|| {
                    anyhow::anyhow!("controller lease missing after extension: {}", existing.id)
                })?;
                (lease, "remote_controller_lease.renewed")
            }
            Some(existing) => {
                anyhow::bail!(
                    "controller lease already held for {}:{} by device grant {}",
                    normalized_scope_type,
                    normalized_scope_id,
                    existing.device_grant_id
                );
            }
            None => {
                let lease_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO remote_controller_leases (
                    id, scope_type, scope_id, device_grant_id, expires_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        lease_id,
                        normalized_scope_type,
                        normalized_scope_id,
                        grant_id,
                        expires_at,
                    ],
                )
                .context("failed to create controller lease")?;
                let lease = get_controller_lease_by_id_tx(&tx, &lease_id)?.ok_or_else(|| {
                    anyhow::anyhow!("controller lease missing after insert: {lease_id}")
                })?;
                (lease, "remote_controller_lease.acquired")
            }
        };

    let audit_payload = json!({
        "scopeType": lease.scope_type.clone(),
        "scopeId": lease.scope_id.clone(),
        "expiresAt": lease.expires_at.clone(),
    });
    insert_remote_audit_event_tx(
        &tx,
        Some(&lease.device_grant_id),
        action_type,
        "remote_controller_lease",
        Some(&lease.id),
        Some(&audit_payload),
    )?;

    tx.commit()
        .context("failed to commit controller lease transaction")?;
    Ok(lease)
}

pub fn release_controller_lease(db: &Database, lease_id: &str) -> anyhow::Result<()> {
    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start controller lease release transaction")?;
    let lease = get_controller_lease_by_id_tx(&tx, lease_id)?
        .ok_or_else(|| anyhow::anyhow!("controller lease not found: {lease_id}"))?;

    if lease.released_at.is_none() {
        tx.execute(
            "UPDATE remote_controller_leases
             SET released_at = COALESCE(released_at, datetime('now'))
             WHERE id = ?1",
            params![lease_id],
        )
        .context("failed to release controller lease")?;

        let audit_payload = json!({
            "scopeType": lease.scope_type.clone(),
            "scopeId": lease.scope_id.clone(),
        });
        insert_remote_audit_event_tx(
            &tx,
            Some(&lease.device_grant_id),
            "remote_controller_lease.released",
            "remote_controller_lease",
            Some(&lease.id),
            Some(&audit_payload),
        )?;
    }

    tx.commit()
        .context("failed to commit controller lease release transaction")?;
    Ok(())
}

fn get_device_grant_by_id_tx(
    conn: &impl ConnectionLike,
    grant_id: &str,
) -> anyhow::Result<Option<RemoteDeviceGrantDto>> {
    conn.query_device_grant(grant_id)
        .context("failed to query remote device grant by id")
}

fn get_controller_lease_by_id_tx(
    conn: &impl ConnectionLike,
    lease_id: &str,
) -> anyhow::Result<Option<RemoteControllerLeaseDto>> {
    conn.query_controller_lease(lease_id)
        .context("failed to query controller lease by id")
}

fn get_active_controller_lease_tx(
    conn: &impl ConnectionLike,
    scope_type: &str,
    scope_id: &str,
) -> anyhow::Result<Option<RemoteControllerLeaseDto>> {
    conn.query_active_controller_lease(scope_type, scope_id)
        .context("failed to query active controller lease")
}

fn insert_remote_audit_event_tx(
    tx: &Transaction<'_>,
    device_grant_id: Option<&str>,
    action_type: &str,
    target_type: &str,
    target_id: Option<&str>,
    payload: Option<&Value>,
) -> anyhow::Result<()> {
    let action_type = normalize_scope_value(action_type, "remote audit action type")?;
    let target_type = normalize_scope_value(target_type, "remote audit target type")?;
    let payload_json = payload
        .map(serde_json::to_string)
        .transpose()
        .context("failed to encode remote audit payload")?;

    tx.execute(
        "INSERT INTO remote_audit_events (
            id, device_grant_id, action_type, target_type, target_id, payload_json
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            Uuid::new_v4().to_string(),
            device_grant_id,
            action_type,
            target_type,
            target_id,
            payload_json,
        ],
    )
    .context("failed to insert remote audit event")?;
    Ok(())
}

fn cleanup_inactive_controller_leases(tx: &Transaction<'_>) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE remote_controller_leases
         SET released_at = COALESCE(released_at, datetime('now'))
         WHERE released_at IS NULL
           AND (
                expires_at <= datetime('now')
                OR NOT EXISTS (
                    SELECT 1
                    FROM remote_device_grants
                    WHERE remote_device_grants.id = remote_controller_leases.device_grant_id
                      AND remote_device_grants.revoked_at IS NULL
                      AND (
                            remote_device_grants.expires_at IS NULL
                            OR remote_device_grants.expires_at > datetime('now')
                          )
                )
           )",
        [],
    )
    .context("failed to release inactive controller leases")?;
    Ok(())
}

fn map_device_grant_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteDeviceGrantDto> {
    let scopes_json: String = row.get(2)?;
    let scopes = serde_json::from_str(&scopes_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
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

fn map_controller_lease_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteControllerLeaseDto> {
    Ok(RemoteControllerLeaseDto {
        id: row.get(0)?,
        scope_type: row.get(1)?,
        scope_id: row.get(2)?,
        device_grant_id: row.get(3)?,
        acquired_at: row.get(4)?,
        expires_at: row.get(5)?,
        released_at: row.get(6)?,
    })
}

fn map_remote_audit_event_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RemoteAuditEventDto> {
    let payload_json: Option<String> = row.get(5)?;
    let payload = payload_json
        .map(|payload| {
            serde_json::from_str(&payload).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    5,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .transpose()?;

    Ok(RemoteAuditEventDto {
        id: row.get(0)?,
        device_grant_id: row.get(1)?,
        action_type: row.get(2)?,
        target_type: row.get(3)?,
        target_id: row.get(4)?,
        payload,
        created_at: row.get(6)?,
    })
}

trait ConnectionLike {
    fn query_device_grant(&self, grant_id: &str) -> rusqlite::Result<Option<RemoteDeviceGrantDto>>;
    fn query_controller_lease(
        &self,
        lease_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>>;
    fn query_active_controller_lease(
        &self,
        scope_type: &str,
        scope_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>>;
}

impl ConnectionLike for rusqlite::Connection {
    fn query_device_grant(&self, grant_id: &str) -> rusqlite::Result<Option<RemoteDeviceGrantDto>> {
        self.query_row(
            "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
             FROM remote_device_grants
             WHERE id = ?1",
            params![grant_id],
            map_device_grant_row,
        )
        .optional()
    }

    fn query_controller_lease(
        &self,
        lease_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE id = ?1",
            params![lease_id],
            map_controller_lease_row,
        )
        .optional()
    }

    fn query_active_controller_lease(
        &self,
        scope_type: &str,
        scope_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE scope_type = ?1
               AND scope_id = ?2
               AND released_at IS NULL
             ORDER BY acquired_at DESC, id DESC
             LIMIT 1",
            params![scope_type, scope_id],
            map_controller_lease_row,
        )
        .optional()
    }
}

impl ConnectionLike for super::PooledConnection {
    fn query_device_grant(&self, grant_id: &str) -> rusqlite::Result<Option<RemoteDeviceGrantDto>> {
        self.query_row(
            "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
             FROM remote_device_grants
             WHERE id = ?1",
            params![grant_id],
            map_device_grant_row,
        )
        .optional()
    }

    fn query_controller_lease(
        &self,
        lease_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE id = ?1",
            params![lease_id],
            map_controller_lease_row,
        )
        .optional()
    }

    fn query_active_controller_lease(
        &self,
        scope_type: &str,
        scope_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE scope_type = ?1
               AND scope_id = ?2
               AND released_at IS NULL
             ORDER BY acquired_at DESC, id DESC
             LIMIT 1",
            params![scope_type, scope_id],
            map_controller_lease_row,
        )
        .optional()
    }
}

impl<'conn> ConnectionLike for Transaction<'conn> {
    fn query_device_grant(&self, grant_id: &str) -> rusqlite::Result<Option<RemoteDeviceGrantDto>> {
        self.query_row(
            "SELECT id, label, scopes_json, created_at, expires_at, revoked_at, last_used_at
             FROM remote_device_grants
             WHERE id = ?1",
            params![grant_id],
            map_device_grant_row,
        )
        .optional()
    }

    fn query_controller_lease(
        &self,
        lease_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE id = ?1",
            params![lease_id],
            map_controller_lease_row,
        )
        .optional()
    }

    fn query_active_controller_lease(
        &self,
        scope_type: &str,
        scope_id: &str,
    ) -> rusqlite::Result<Option<RemoteControllerLeaseDto>> {
        self.query_row(
            "SELECT id, scope_type, scope_id, device_grant_id, acquired_at, expires_at, released_at
             FROM remote_controller_leases
             WHERE scope_type = ?1
               AND scope_id = ?2
               AND released_at IS NULL
             ORDER BY acquired_at DESC, id DESC
             LIMIT 1",
            params![scope_type, scope_id],
            map_controller_lease_row,
        )
        .optional()
    }
}

fn normalize_label(label: &str) -> anyhow::Result<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        anyhow::bail!("remote device grant label cannot be empty");
    }
    Ok(trimmed.to_string())
}

fn normalize_scope_value(value: &str, label: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("{label} cannot be empty");
    }
    Ok(trimmed.to_string())
}

fn normalize_remote_audit_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_REMOTE_AUDIT_LIMIT)
        .clamp(1, MAX_REMOTE_AUDIT_LIMIT)
}

fn normalize_scopes(scopes: &[String]) -> anyhow::Result<Vec<String>> {
    let mut normalized = scopes
        .iter()
        .map(|scope| scope.trim())
        .filter(|scope| !scope.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();
    normalized.sort();
    normalized.dedup();
    if normalized.is_empty() {
        anyhow::bail!("remote device grant must include at least one scope");
    }
    Ok(normalized)
}

fn normalize_expires_at(expires_at: Option<&str>) -> anyhow::Result<Option<String>> {
    expires_at
        .map(|value| {
            parse_timestamp(value)
                .ok_or_else(|| anyhow::anyhow!("invalid remote device grant expiry timestamp"))
                .map(format_timestamp)
        })
        .transpose()
}

fn format_timestamp(timestamp: DateTime<Utc>) -> String {
    timestamp.format(SQLITE_DATETIME_FORMAT).to_string()
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
    fn create_device_grant_rejects_empty_scope_sets() {
        let db = test_db();
        let error = create_device_grant(&db, "Invalid", &[], None)
            .expect_err("empty scopes should be rejected");
        assert!(error
            .to_string()
            .contains("remote device grant must include at least one scope"));

        let whitespace_error = create_device_grant(&db, "Whitespace", &["   ".to_string()], None)
            .expect_err("blank scopes should be rejected");
        assert!(whitespace_error
            .to_string()
            .contains("remote device grant must include at least one scope"));
    }

    #[test]
    fn revoked_and_expired_grants_are_not_active() {
        let db = test_db();
        let created = create_device_grant(
            &db,
            "Remote Laptop",
            &["*".to_string()],
            Some(&(Utc::now() - Duration::minutes(5)).to_rfc3339()),
        )
        .expect("failed to create expiring grant");

        assert!(find_active_device_grant_by_token(&db, &created.token)
            .expect("failed to look up expired grant")
            .is_none());

        let active = create_device_grant(&db, "Desk", &["*".to_string()], None)
            .expect("failed to create active grant");
        revoke_device_grant(&db, &active.grant.id).expect("failed to revoke grant");
        assert!(find_active_device_grant_by_token(&db, &active.token)
            .expect("failed to look up revoked grant")
            .is_none());
    }

    #[test]
    fn controller_leases_reuse_same_holder_and_block_others() {
        let db = test_db();
        let primary = create_device_grant(&db, "Primary", &["*".to_string()], None)
            .expect("failed to create primary grant");
        let secondary = create_device_grant(&db, "Secondary", &["*".to_string()], None)
            .expect("failed to create secondary grant");

        let first = acquire_controller_lease(&db, &primary.grant.id, "workspace", "ws-1", 60)
            .expect("failed to acquire initial lease");
        let renewed = acquire_controller_lease(&db, &primary.grant.id, "workspace", "ws-1", 120)
            .expect("failed to renew existing lease");

        assert_eq!(renewed.id, first.id);
        assert!(renewed.expires_at >= first.expires_at);

        let error = acquire_controller_lease(&db, &secondary.grant.id, "workspace", "ws-1", 60)
            .expect_err("second device should be blocked");
        assert!(error.to_string().contains("controller lease already held"));

        release_controller_lease(&db, &first.id).expect("failed to release lease");
        let after_release = get_active_controller_lease(&db, "workspace", "ws-1")
            .expect("failed to query active lease after release");
        assert!(after_release.is_none());
    }

    #[test]
    fn expired_controller_leases_are_released_before_reacquire() {
        let db = test_db();
        let primary = create_device_grant(&db, "Primary", &["*".to_string()], None)
            .expect("failed to create primary grant");
        let secondary = create_device_grant(&db, "Secondary", &["*".to_string()], None)
            .expect("failed to create secondary grant");

        let first = acquire_controller_lease(&db, &primary.grant.id, "thread", "thread-1", 60)
            .expect("failed to acquire lease");

        let conn = db.connect().expect("failed to open test db");
        conn.execute(
            "UPDATE remote_controller_leases
             SET expires_at = datetime('now', '-5 minutes')
             WHERE id = ?1",
            params![first.id],
        )
        .expect("failed to expire lease manually");

        let replacement =
            acquire_controller_lease(&db, &secondary.grant.id, "thread", "thread-1", 60)
                .expect("failed to acquire replacement lease");
        assert_ne!(replacement.id, first.id);
        assert_eq!(replacement.device_grant_id, secondary.grant.id);
    }

    #[test]
    fn revoked_or_expired_grants_do_not_keep_controller_leases_active() {
        let db = test_db();
        let revoked = create_device_grant(&db, "Revoked", &["*".to_string()], None)
            .expect("failed to create revoked grant");
        let replacement = create_device_grant(&db, "Replacement", &["*".to_string()], None)
            .expect("failed to create replacement grant");

        let held = acquire_controller_lease(&db, &revoked.grant.id, "workspace", "ws-2", 60)
            .expect("failed to acquire initial lease");
        revoke_device_grant(&db, &revoked.grant.id).expect("failed to revoke device grant");
        assert!(get_active_controller_lease(&db, "workspace", "ws-2")
            .expect("failed to query revoked lease")
            .is_none());

        let reacquired =
            acquire_controller_lease(&db, &replacement.grant.id, "workspace", "ws-2", 60)
                .expect("failed to acquire lease after revocation");
        assert_ne!(reacquired.id, held.id);

        let expiring = create_device_grant(
            &db,
            "Expiring",
            &["*".to_string()],
            Some(&(Utc::now() + Duration::seconds(20)).to_rfc3339()),
        )
        .expect("failed to create expiring grant");
        let future = create_device_grant(&db, "Future", &["*".to_string()], None)
            .expect("failed to create future grant");

        acquire_controller_lease(&db, &expiring.grant.id, "thread", "thread-2", 15)
            .expect("failed to acquire expiring grant lease");

        let conn = db.connect().expect("failed to open test db");
        conn.execute(
            "UPDATE remote_device_grants
             SET expires_at = datetime('now', '-1 minute')
             WHERE id = ?1",
            params![expiring.grant.id],
        )
        .expect("failed to expire device grant manually");

        assert!(get_active_controller_lease(&db, "thread", "thread-2")
            .expect("failed to query expired grant lease")
            .is_none());

        let replacement_lease =
            acquire_controller_lease(&db, &future.grant.id, "thread", "thread-2", 60)
                .expect("failed to acquire lease after grant expiry");
        assert_eq!(replacement_lease.device_grant_id, future.grant.id);
    }

    #[test]
    fn remote_audit_events_capture_grant_and_lease_mutations() {
        let db = test_db();
        let created = create_device_grant(&db, "Audit Device", &["chat.read".to_string()], None)
            .expect("failed to create audit device grant");
        let lease = acquire_controller_lease(&db, &created.grant.id, "workspace", "ws-audit", 60)
            .expect("failed to acquire controller lease");
        acquire_controller_lease(&db, &created.grant.id, "workspace", "ws-audit", 120)
            .expect("failed to renew controller lease");
        release_controller_lease(&db, &lease.id).expect("failed to release controller lease");
        release_controller_lease(&db, &lease.id)
            .expect("failed to re-release controller lease idempotently");
        revoke_device_grant(&db, &created.grant.id).expect("failed to revoke audit device grant");

        let audit_events =
            list_remote_audit_events(&db, Some(10)).expect("failed to list remote audit events");
        let action_types = audit_events
            .iter()
            .map(|event| event.action_type.as_str())
            .collect::<Vec<_>>();

        assert!(action_types.contains(&"remote_device_grant.created"));
        assert!(action_types.contains(&"remote_controller_lease.acquired"));
        assert!(action_types.contains(&"remote_controller_lease.renewed"));
        assert!(action_types.contains(&"remote_controller_lease.released"));
        assert!(action_types.contains(&"remote_device_grant.revoked"));

        let release_events = audit_events
            .iter()
            .filter(|event| event.action_type == "remote_controller_lease.released")
            .collect::<Vec<_>>();
        assert_eq!(release_events.len(), 1);

        let create_event = audit_events
            .iter()
            .find(|event| event.action_type == "remote_device_grant.created")
            .expect("missing device grant created audit event");
        assert_eq!(
            create_event.device_grant_id.as_deref(),
            Some(created.grant.id.as_str())
        );
        assert_eq!(create_event.target_type, "remote_device_grant");
        assert_eq!(
            create_event.target_id.as_deref(),
            Some(created.grant.id.as_str())
        );
        assert_eq!(
            create_event
                .payload
                .as_ref()
                .and_then(|payload| payload.get("label"))
                .and_then(Value::as_str),
            Some("Audit Device")
        );
        assert!(create_event
            .payload
            .as_ref()
            .and_then(|payload| payload.get("token"))
            .is_none());

        let limited_events =
            list_remote_audit_events(&db, Some(2)).expect("failed to list limited audit events");
        assert_eq!(limited_events.len(), 2);
    }

    #[test]
    fn revoking_an_expired_grant_still_records_an_audit_event() {
        let db = test_db();
        let expired = create_device_grant(
            &db,
            "Expired Device",
            &["*".to_string()],
            Some(&(Utc::now() - Duration::minutes(1)).to_rfc3339()),
        )
        .expect("failed to create expired device grant");

        revoke_device_grant(&db, &expired.grant.id).expect("failed to revoke expired grant");

        let audit_events =
            list_remote_audit_events(&db, Some(10)).expect("failed to list remote audit events");
        assert!(audit_events.iter().any(|event| {
            event.action_type == "remote_device_grant.revoked"
                && event.target_id.as_deref() == Some(expired.grant.id.as_str())
        }));
    }
}
