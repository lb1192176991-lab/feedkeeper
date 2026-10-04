-- Native presentation preferences never change the web folder order or stream.
CREATE TABLE native_preferences (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL CHECK (json_valid(settings)),
  updated_at TEXT NOT NULL
);

CREATE TABLE native_requests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, request_id)
) WITHOUT ROWID;

ALTER TABLE editions ADD COLUMN edition_id TEXT;
ALTER TABLE editions ADD COLUMN source TEXT NOT NULL DEFAULT 'curated';
ALTER TABLE editions ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE editions ADD COLUMN period TEXT;
ALTER TABLE editions ADD COLUMN title TEXT;
ALTER TABLE editions ADD COLUMN summary TEXT;
ALTER TABLE editions ADD COLUMN preferences_revision INTEGER NOT NULL DEFAULT 0;
UPDATE editions SET edition_id = lower(hex(randomblob(16))),
  expires_at = COALESCE(expires_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours'));

-- A retained slot keeps revisions monotonic, including expiry and dismissal.
CREATE TABLE edition_history (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL,
  item_ids TEXT NOT NULL CHECK (json_valid(item_ids)),
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, edition_id)
) WITHOUT ROWID;
INSERT INTO edition_history SELECT user_id, edition_id, item_ids, revision, created_at FROM editions;

DROP TRIGGER trg_changes_edition_update;
CREATE TRIGGER trg_changes_edition_update AFTER UPDATE ON editions
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'edition', 1, CASE WHEN NEW.status = 'active' THEN 'upsert' ELSE 'delete' END,
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), NEW.updated_at)
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_native_preferences_insert AFTER INSERT ON native_preferences
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'native_preferences', 1, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), NEW.updated_at)
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

CREATE TRIGGER trg_changes_native_preferences_update AFTER UPDATE ON native_preferences
BEGIN
  INSERT INTO changes (user_id, entity, entity_id, op, seq, changed_at)
  VALUES (NEW.user_id, 'native_preferences', 1, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = NEW.user_id), NEW.updated_at)
  ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET op = excluded.op, seq = excluded.seq, changed_at = excluded.changed_at;
END;

-- Remove stale folder IDs atomically when any API deletes a folder. A new folder
-- with the same name has a new identity and must not inherit old preferences.
CREATE TRIGGER trg_native_preferences_folder_delete AFTER DELETE ON folders
WHEN EXISTS (SELECT 1 FROM native_preferences WHERE user_id = OLD.user_id)
BEGIN
  UPDATE native_preferences SET
    settings = json_set(settings,
      '$.folderOrder', json(COALESCE((SELECT json_group_array(value) FROM json_each(settings, '$.folderOrder') WHERE value IS NULL OR value != OLD.id), '[]')),
      '$.hiddenFolderIds', json(COALESCE((SELECT json_group_array(value) FROM json_each(settings, '$.hiddenFolderIds') WHERE value != OLD.id), '[]')),
      '$.preferredFolderIds', json(COALESCE((SELECT json_group_array(value) FROM json_each(settings, '$.preferredFolderIds') WHERE value != OLD.id), '[]'))),
    revision = revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = OLD.user_id AND (
    EXISTS (SELECT 1 FROM json_each(settings, '$.folderOrder') WHERE value = OLD.id) OR
    EXISTS (SELECT 1 FROM json_each(settings, '$.hiddenFolderIds') WHERE value = OLD.id) OR
    EXISTS (SELECT 1 FROM json_each(settings, '$.preferredFolderIds') WHERE value = OLD.id)
  );
END;
