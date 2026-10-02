-- Web Push: devices that receive notifications, and per-subscription opt-in for new articles.
ALTER TABLE subscriptions ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);
