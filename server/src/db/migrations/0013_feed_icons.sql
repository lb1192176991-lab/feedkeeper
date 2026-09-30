-- Icon declared by the feed's website, so the browser does not rely on a
-- guessed /favicon.ico that may be missing or blank.
ALTER TABLE feeds ADD COLUMN icon_url TEXT;
ALTER TABLE feeds ADD COLUMN icon_checked_at TEXT;
