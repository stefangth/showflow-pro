-- At most one active (non-cancelled) booking per (show_date, artist).
-- The offer engine pre-filters duplicates in application code; this makes it a
-- race-safe DB guarantee. Partial on status<>'cancelled' so a declined-then-
-- re-offered artist still works (multiple cancelled rows are allowed).
CREATE UNIQUE INDEX bookings_active_artist_date_uniq
  ON public.bookings (show_date_id, artist_id)
  WHERE status <> 'cancelled';
