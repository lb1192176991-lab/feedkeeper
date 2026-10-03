-- Keep note revisions after deletion so a stale device cannot overwrite a recreated note.
CREATE TABLE item_note_revisions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

INSERT INTO item_note_revisions (user_id, item_id, revision, updated_at)
SELECT user_id, item_id, revision, updated_at FROM item_notes;

CREATE TRIGGER trg_note_revision_insert AFTER INSERT ON item_notes
BEGIN
  INSERT INTO item_note_revisions (user_id, item_id, revision, updated_at)
  VALUES (NEW.user_id, NEW.item_id, NEW.revision, NEW.updated_at)
  ON CONFLICT (user_id, item_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_note_revision_update AFTER UPDATE ON item_notes
BEGIN
  INSERT INTO item_note_revisions (user_id, item_id, revision, updated_at)
  VALUES (NEW.user_id, NEW.item_id, NEW.revision, NEW.updated_at)
  ON CONFLICT (user_id, item_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_note_revision_delete AFTER DELETE ON item_notes
  WHEN EXISTS (SELECT 1 FROM items WHERE id = OLD.item_id)
BEGIN
  UPDATE item_note_revisions SET revision = OLD.revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE user_id = OLD.user_id AND item_id = OLD.item_id;
END;
