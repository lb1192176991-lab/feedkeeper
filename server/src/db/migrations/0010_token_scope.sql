-- Existing tokens keep their original write access. New tokens can be read-only.
ALTER TABLE personal_access_tokens
  ADD COLUMN scope TEXT NOT NULL DEFAULT 'write' CHECK (scope IN ('read', 'write'));
