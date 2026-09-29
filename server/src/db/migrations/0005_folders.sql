-- Migration 0005: Feed Folders / Categories

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

ALTER TABLE subscriptions ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_folder ON subscriptions(folder_id);
