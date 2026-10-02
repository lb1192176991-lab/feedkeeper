-- Native apps pair with a one-time code and get their own revocable token.
ALTER TABLE personal_access_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'api' CHECK (kind IN ('api', 'device'));
ALTER TABLE personal_access_tokens ADD COLUMN platform TEXT;
ALTER TABLE personal_access_tokens ADD COLUMN app_version TEXT;

-- At most one pairing code per user; creating a new one replaces the old one.
CREATE TABLE IF NOT EXISTS pairing_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
