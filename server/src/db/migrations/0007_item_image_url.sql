-- Migration 0007: Store image URL for feed items
ALTER TABLE items ADD COLUMN image_url TEXT;
