-- Per-subscription opt-in: unread articles of this feed count towards the number on the app icon.
ALTER TABLE subscriptions ADD COLUMN badge INTEGER NOT NULL DEFAULT 0;
