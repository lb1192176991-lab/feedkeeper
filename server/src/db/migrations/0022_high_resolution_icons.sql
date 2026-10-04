-- Re-discover existing icons on the next feed poll; keep the last good image until then.
UPDATE feeds SET icon_checked_at = NULL;
