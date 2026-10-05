-- Optional, provider-independent linked overviews for native editions.
ALTER TABLE editions ADD COLUMN overview TEXT CHECK (overview IS NULL OR json_valid(overview));
