-- SQLite FTS5 Full-Text Search for items (titles, summaries, and full article text)
CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title,
  content_snippet,
  content_html,
  full_content_html,
  content='items',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Backfill existing items into FTS index
INSERT INTO items_fts(rowid, title, content_snippet, content_html, full_content_html)
SELECT id, title, content_snippet, content_html, full_content_html FROM items;

-- Triggers to keep FTS index in step with items
CREATE TRIGGER IF NOT EXISTS trg_items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, content_snippet, content_html, full_content_html)
  VALUES (new.id, new.title, new.content_snippet, new.content_html, new.full_content_html);
END;

CREATE TRIGGER IF NOT EXISTS trg_items_fts_delete AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content_snippet, content_html, full_content_html)
  VALUES ('delete', old.id, old.title, old.content_snippet, old.content_html, old.full_content_html);
END;

CREATE TRIGGER IF NOT EXISTS trg_items_fts_update AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, content_snippet, content_html, full_content_html)
  VALUES ('delete', old.id, old.title, old.content_snippet, old.content_html, old.full_content_html);
  INSERT INTO items_fts(rowid, title, content_snippet, content_html, full_content_html)
  VALUES (new.id, new.title, new.content_snippet, new.content_html, new.full_content_html);
END;
