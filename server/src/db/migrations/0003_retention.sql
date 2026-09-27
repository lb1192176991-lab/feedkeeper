-- Migration 0003: System settings for database retention and housekeeping

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO system_settings (key, value) VALUES
  ('retention_read_days', '30'),
  ('retention_max_days', '90'),
  ('retention_max_items_per_feed', '1000'),
  ('auto_cleanup_enabled', 'true');
