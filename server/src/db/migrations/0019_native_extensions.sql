-- Migration 0019: Feed icons, folder symbols, synchronized article notes, and curated editions

-- 1. Persistent feed icons
CREATE TABLE IF NOT EXISTS feed_icons (
  feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  data BLOB NOT NULL,
  mime TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS trg_changes_feed_icon_insert AFTER INSERT ON feed_icons
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  SELECT s.user_id, 'subscription', s.feed_id, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM subscriptions s WHERE s.feed_id = NEW.feed_id
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_changes_feed_icon_update AFTER UPDATE ON feed_icons
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  SELECT s.user_id, 'subscription', s.feed_id, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = s.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM subscriptions s WHERE s.feed_id = NEW.feed_id
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

-- 2. SF Symbol for folders / categories
ALTER TABLE folders ADD COLUMN icon_symbol TEXT;

-- 3. Synchronized article notes
CREATE TABLE IF NOT EXISTS item_notes (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_notes_item ON item_notes(item_id);

CREATE TRIGGER IF NOT EXISTS trg_changes_note_insert AFTER INSERT ON item_notes
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'note', NEW.item_id, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_changes_note_update AFTER UPDATE ON item_notes
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'note', NEW.item_id, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_changes_note_delete AFTER DELETE ON item_notes
  WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'note', OLD.item_id, 'delete',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

-- 4. Curated edition ("Deine Zeitung")
CREATE TABLE IF NOT EXISTS editions (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  item_ids TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_changes_edition_insert AFTER INSERT ON editions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'edition', 1, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_changes_edition_update AFTER UPDATE ON editions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'edition', 1, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_changes_edition_delete AFTER DELETE ON editions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'edition', 1, 'delete',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;
