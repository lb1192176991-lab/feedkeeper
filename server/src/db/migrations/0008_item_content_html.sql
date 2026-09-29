-- Migration 0008: Store full content HTML for feed items
ALTER TABLE items ADD COLUMN content_html TEXT;
