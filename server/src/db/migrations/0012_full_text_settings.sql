-- Per-subscription choice whether the reader may fetch full articles, and a
-- per-feed memory of sites that answer full-text requests with a consent wall.
ALTER TABLE subscriptions ADD COLUMN full_text_mode TEXT NOT NULL DEFAULT 'auto' CHECK (full_text_mode IN ('auto', 'never'));
ALTER TABLE feeds ADD COLUMN full_text_blocks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feeds ADD COLUMN full_text_blocked_at TEXT;
