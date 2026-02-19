use std::{fs, path::PathBuf};

use anyhow::Context;
use rusqlite::Connection;

pub mod actions;
pub mod messages;
pub mod repos;
pub mod threads;
pub mod workspaces;

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn init() -> anyhow::Result<Self> {
        let base_dir = dirs_home().join(".agent-workspace");
        fs::create_dir_all(base_dir.join("logs")).context("failed to create app data dir")?;

        let path = base_dir.join("workspaces.db");
        let db = Self { path };
        db.run_migrations()?;

        Ok(db)
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn connect(&self) -> anyhow::Result<Connection> {
        let conn = Connection::open(&self.path).context("failed to open sqlite database")?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .context("failed to enable sqlite foreign keys")?;
        Ok(conn)
    }

    fn run_migrations(&self) -> anyhow::Result<()> {
        let conn = self.connect()?;
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .context("failed to apply migrations")?;
        Ok(())
    }
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}
