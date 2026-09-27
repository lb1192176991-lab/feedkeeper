ALTER TABLE feeds ADD COLUMN last_success_at TEXT;
ALTER TABLE feeds ADD COLUMN consecutive_errors INTEGER NOT NULL DEFAULT 0;

UPDATE feeds SET last_success_at = last_polled_at WHERE last_error IS NULL AND last_polled_at IS NOT NULL;
UPDATE feeds SET consecutive_errors = 1 WHERE last_error IS NOT NULL;
