-- Saved (bookmarked) articles are archived: full text is kept on the item and
-- images are stored as files next to the database; this table maps them.
ALTER TABLE items ADD COLUMN archived_at TEXT;

CREATE TABLE archived_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  file_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (item_id, source_url)
);

CREATE INDEX idx_bookmarks_item ON item_bookmarks(item_id);
