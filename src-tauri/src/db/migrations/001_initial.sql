CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  scan_depth INTEGER NOT NULL DEFAULT 3,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  is_active INTEGER NOT NULL DEFAULT 1,
  trust_level TEXT NOT NULL DEFAULT 'standard',
  UNIQUE(workspace_id, path)
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
  engine_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  engine_thread_id TEXT,
  engine_metadata_json TEXT,
  engine_capabilities_json TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  archived_at TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT,
  blocks_json TEXT,
  turn_engine_id TEXT,
  turn_model_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  stream_seq INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  token_input INTEGER DEFAULT 0,
  token_output INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  engine_action_id TEXT,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  truncated INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS engine_event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_workspace ON repos(workspace_id);
CREATE INDEX IF NOT EXISTS idx_threads_workspace ON threads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_threads_repo ON threads(repo_id);
CREATE INDEX IF NOT EXISTS idx_threads_activity ON threads(workspace_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_workspace_status_activity ON threads(workspace_id, status, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_status_created ON messages(thread_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_thread ON actions(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_actions_thread_status_created ON actions(thread_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_thread ON approvals(thread_id, created_at ASC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  thread_id UNINDEXED,
  role UNINDEXED,
  searchable_text,
  content=messages,
  content_rowid=rowid
);

CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, thread_id, role, searchable_text)
  VALUES (new.rowid, new.thread_id, new.role, COALESCE(new.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_delete BEFORE DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, thread_id, role, searchable_text)
  VALUES ('delete', old.rowid, old.thread_id, old.role, COALESCE(old.content, ''));
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, thread_id, role, searchable_text)
  VALUES ('delete', old.rowid, old.thread_id, old.role, COALESCE(old.content, ''));
  INSERT INTO messages_fts(rowid, thread_id, role, searchable_text)
  VALUES (new.rowid, new.thread_id, new.role, COALESCE(new.content, ''));
END;
