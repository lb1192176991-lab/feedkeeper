-- Shared reader content lifecycle; no client- or AI-specific state.
ALTER TABLE items ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE items ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE items ADD COLUMN extraction_attempted_at TEXT;
ALTER TABLE items ADD COLUMN extraction_retry_at TEXT;
UPDATE items SET extraction_status = 'ready' WHERE full_content_html IS NOT NULL;
CREATE TABLE full_text_jobs (
  item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_full_text_jobs_due ON full_text_jobs(available_at, priority);
CREATE TRIGGER trg_content_revision AFTER UPDATE OF content_html, full_content_html, content_snippet, image_url, title, link ON items
WHEN OLD.content_html IS NOT NEW.content_html OR OLD.full_content_html IS NOT NEW.full_content_html
  OR OLD.content_snippet IS NOT NEW.content_snippet OR OLD.image_url IS NOT NEW.image_url OR OLD.title IS NOT NEW.title OR OLD.link IS NOT NEW.link
BEGIN
  UPDATE items SET content_revision = OLD.content_revision + 1,
    extraction_status = CASE WHEN NEW.full_content_html IS NOT NULL THEN 'ready' WHEN OLD.extraction_status = 'feed_only' THEN 'pending' ELSE NEW.extraction_status END
  WHERE id = NEW.id;
END;
CREATE TRIGGER trg_content_changes AFTER UPDATE OF content_revision, extraction_status, extraction_retry_at ON items
WHEN OLD.content_revision IS NOT NEW.content_revision OR OLD.extraction_status IS NOT NEW.extraction_status OR OLD.extraction_retry_at IS NOT NEW.extraction_retry_at
BEGIN
  INSERT INTO changes(user_id, entity, entity_id, op, seq, changed_at)
  SELECT owners.user_id, 'item_content', NEW.id, 'upsert',
    (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes WHERE user_id = owners.user_id), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM (SELECT user_id FROM subscriptions WHERE feed_id = NEW.feed_id
    UNION SELECT user_id FROM item_bookmarks WHERE item_id = NEW.id
    UNION SELECT user_id FROM item_notes WHERE item_id = NEW.id
    UNION SELECT e.user_id FROM editions e, json_each(e.item_ids) selected
      WHERE selected.value = NEW.id AND e.status = 'active' AND julianday(e.expires_at) > julianday('now')) owners WHERE 1
  ON CONFLICT(user_id, entity, entity_id) DO UPDATE SET seq = excluded.seq, changed_at = excluded.changed_at, op = excluded.op;
END;

-- Metadata-only nested updates must not issue a second FTS delete for the new body.
DROP TRIGGER trg_items_fts_update;
CREATE TRIGGER trg_items_fts_update AFTER UPDATE OF title, content_snippet, content_html, full_content_html ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content_snippet, content_html, full_content_html)
  VALUES ('delete', old.id, old.title, old.content_snippet, old.content_html, old.full_content_html);
  INSERT INTO items_fts(rowid, title, content_snippet, content_html, full_content_html)
  VALUES (new.id, new.title, new.content_snippet, new.content_html, new.full_content_html);
END;
