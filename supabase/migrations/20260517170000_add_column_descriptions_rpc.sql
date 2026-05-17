-- Human-readable descriptions for table columns (stored as Postgres column comments)

-- show_dates
COMMENT ON COLUMN show_dates.show_id IS 'Show';
COMMENT ON COLUMN show_dates.date IS 'Date';
COMMENT ON COLUMN show_dates.session_1 IS 'Session 1';
COMMENT ON COLUMN show_dates.session_2 IS 'Session 2';
COMMENT ON COLUMN show_dates.session_3 IS 'Session 3';
COMMENT ON COLUMN show_dates.venue IS 'Venue';
COMMENT ON COLUMN show_dates.city_id IS 'City ID';
COMMENT ON COLUMN show_dates.status IS 'Status';
COMMENT ON COLUMN show_dates.notes IS 'Notes';
COMMENT ON COLUMN show_dates.airtable_record_id IS 'Airtable ID';
COMMENT ON COLUMN show_dates.created_at IS 'Created';
COMMENT ON COLUMN show_dates.updated_at IS 'Updated';

-- shows
COMMENT ON COLUMN shows.program IS 'Program';
COMMENT ON COLUMN shows.sub_program IS 'Sub-program';
COMMENT ON COLUMN shows.status IS 'Show status';
COMMENT ON COLUMN shows.required_skills IS 'Required skills';
COMMENT ON COLUMN shows.created_by IS 'Created by';
COMMENT ON COLUMN shows.created_at IS 'Created';
COMMENT ON COLUMN shows.updated_at IS 'Updated';

-- cities
COMMENT ON COLUMN cities.name IS 'City';
COMMENT ON COLUMN cities.airtable_record_id IS 'Airtable ID';
COMMENT ON COLUMN cities.created_at IS 'Created';

-- bookings
COMMENT ON COLUMN bookings.artist_id IS 'Artist';
COMMENT ON COLUMN bookings.show_date_id IS 'Show date';
COMMENT ON COLUMN bookings.status IS 'Booking status';
COMMENT ON COLUMN bookings.is_understudy IS 'Understudy';
COMMENT ON COLUMN bookings.booked_by IS 'Booked by';
COMMENT ON COLUMN bookings.confirmed_at IS 'Confirmed';
COMMENT ON COLUMN bookings.cancelled_at IS 'Cancelled';
COMMENT ON COLUMN bookings.cancellation_reason IS 'Cancellation reason';
COMMENT ON COLUMN bookings.notes IS 'Notes';
COMMENT ON COLUMN bookings.created_at IS 'Created';
COMMENT ON COLUMN bookings.updated_at IS 'Updated';
COMMENT ON COLUMN bookings.offered_at IS 'Offered';
COMMENT ON COLUMN bookings.offer_expires_at IS 'Offer expires';
COMMENT ON COLUMN bookings.offer_tier IS 'Offer tier';
COMMENT ON COLUMN bookings.digest_sent_at IS 'Digest sent';
COMMENT ON COLUMN bookings.confirmation_digest_sent_at IS 'Confirmation sent';

-- artists
COMMENT ON COLUMN artists.user_id IS 'User';
COMMENT ON COLUMN artists.name IS 'Name';
COMMENT ON COLUMN artists.email IS 'Email';
COMMENT ON COLUMN artists.phone IS 'Phone';
COMMENT ON COLUMN artists.bio IS 'Bio';
COMMENT ON COLUMN artists.status IS 'Status';
COMMENT ON COLUMN artists.created_at IS 'Created';
COMMENT ON COLUMN artists.updated_at IS 'Updated';

-- RPC: returns all column descriptions as a flat jsonb object
-- keyed by "table_name.column_name", e.g. {"show_dates.date": "Date", ...}
CREATE OR REPLACE FUNCTION get_column_descriptions()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_object_agg(
      c.relname || '.' || a.attname,
      d.description
    ),
    '{}'::jsonb
  )
  FROM pg_class c
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  JOIN pg_namespace n ON c.relnamespace = n.oid
  JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum
  WHERE n.nspname = 'public'
    AND c.relname IN ('show_dates', 'shows', 'cities', 'bookings', 'artists');
    -- Keep in sync with TABLE_COLUMNS in src/features/editor/columnRegistries.ts
$$;

GRANT EXECUTE ON FUNCTION get_column_descriptions() TO authenticated;
