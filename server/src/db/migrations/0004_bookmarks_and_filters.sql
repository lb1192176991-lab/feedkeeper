-- Migration 0004: Bookmarks (Saved Items) and User Muted Keywords

CREATE TABLE IF NOT EXISTS item_bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON item_bookmarks(user_id);

CREATE TABLE IF NOT EXISTS user_muted_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_muted_user ON user_muted_keywords(user_id);
