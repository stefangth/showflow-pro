-- Consolidate venue onto show_dates only. shows.venue is dropped;
-- show_dates.venue_override is renamed to show_dates.venue and becomes the
-- target column for Airtable sync.

UPDATE show_dates sd
SET venue_override = s.venue
FROM shows s
WHERE sd.show_id = s.id
  AND sd.venue_override IS NULL
  AND s.venue IS NOT NULL;

ALTER TABLE show_dates RENAME COLUMN venue_override TO venue;
ALTER TABLE shows DROP COLUMN IF EXISTS venue;
