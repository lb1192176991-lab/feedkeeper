-- Migration 0024: Universal Inbox ("Save to FeedKeeper")
-- Creates a dedicated system feed for each user's saved web articles and inbound clippings.

-- Mark feeds that are internal system inboxes rather than polled RSS sources.
ALTER TABLE feeds ADD COLUMN is_system_inbox INTEGER NOT NULL DEFAULT 0;
