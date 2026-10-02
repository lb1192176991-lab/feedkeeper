-- Change log for native clients (see docs/design/native-api.md).
--
-- One row per object a user owns (compacted): whenever the object changes the row's seq moves
-- forward, so the log grows with the number of objects, not with the number of changes.
-- Triggers fill it, so every code path (web, MCP, native API, poller, cleanup) is covered.
-- No foreign key on user_id: triggers write here while a user's data is being deleted.
CREATE TABLE changes (
  user_id INTEGER NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  seq INTEGER NOT NULL,
  changed_at TEXT NOT NULL,
  -- Per-field times of an article's state, for last-writer-wins between devices.
  read_at TEXT,
  saved_at TEXT,
  progress_at TEXT,
  PRIMARY KEY (user_id, entity, entity_id)
) WITHOUT ROWID;

CREATE INDEX idx_changes_seq ON changes(user_id, seq);

-- A row exists once a user's existing data was added to the log. `pruned_through` is the highest
-- seq of a forgotten deletion, so clients that missed it know they must start over.
CREATE TABLE sync_state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  pruned_through INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE applied_mutations (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error TEXT,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, mutation_id)
) WITHOUT ROWID;

-- Reading position of any article; positions near the start or the end are not stored.
CREATE TABLE item_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, item_id)
);

CREATE TRIGGER trg_changes_read_insert AFTER INSERT ON item_reads
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, read_at)
  VALUES (NEW.user_id, 'item_state', NEW.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, read_at = excluded.read_at;
END;

CREATE TRIGGER trg_changes_read_delete AFTER DELETE ON item_reads
  WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, read_at)
  VALUES (OLD.user_id, 'item_state', OLD.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, read_at = excluded.read_at;
END;

CREATE TRIGGER trg_changes_saved_insert AFTER INSERT ON item_bookmarks
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, saved_at)
  VALUES (NEW.user_id, 'item_state', NEW.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, saved_at = excluded.saved_at;
END;

CREATE TRIGGER trg_changes_saved_delete AFTER DELETE ON item_bookmarks
  WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, saved_at)
  VALUES (OLD.user_id, 'item_state', OLD.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, saved_at = excluded.saved_at;
END;

CREATE TRIGGER trg_changes_progress_insert AFTER INSERT ON item_progress
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, progress_at)
  VALUES (NEW.user_id, 'item_state', NEW.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, progress_at = excluded.progress_at;
END;

CREATE TRIGGER trg_changes_progress_update AFTER UPDATE ON item_progress
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, progress_at)
  VALUES (NEW.user_id, 'item_state', NEW.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, progress_at = excluded.progress_at;
END;

CREATE TRIGGER trg_changes_progress_delete AFTER DELETE ON item_progress
  WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at, progress_at)
  VALUES (OLD.user_id, 'item_state', OLD.item_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at, progress_at = excluded.progress_at;
END;

CREATE TRIGGER trg_changes_subscription_insert AFTER INSERT ON subscriptions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'subscription', NEW.feed_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_subscription_update AFTER UPDATE ON subscriptions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'subscription', NEW.feed_id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_subscription_delete AFTER DELETE ON subscriptions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'subscription', OLD.feed_id, 'delete', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_folder_insert AFTER INSERT ON folders
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'folder', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_folder_update AFTER UPDATE ON folders
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'folder', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_folder_delete AFTER DELETE ON folders
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'folder', OLD.id, 'delete', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_muted_keyword_insert AFTER INSERT ON user_muted_keywords
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'muted_keyword', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_muted_keyword_update AFTER UPDATE ON user_muted_keywords
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'muted_keyword', NEW.id, 'upsert', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_muted_keyword_delete AFTER DELETE ON user_muted_keywords
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (OLD.user_id, 'muted_keyword', OLD.id, 'delete', (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = OLD.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_user_delete AFTER DELETE ON users
BEGIN
  DELETE FROM changes WHERE user_id = OLD.id;
END;
