-- Migration 0006: Custom Feed Ordering (position)

ALTER TABLE subscriptions ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_pos ON subscriptions(user_id, position);
