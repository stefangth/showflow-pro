-- Phase 4 (wireflow v3): Google Sheet -> show_dates importer.
-- show_dates has no natural unique key and airtable_record_id is Airtable-only, so sheet
-- rows get their own identity via a `source` marker and a partial unique on (org, show, date)
-- scoped to source='sheet' -- isolated from Airtable rows (source NULL, airtable_record_id set)
-- and by-hand rows (source NULL, no airtable_record_id), so re-imports never clobber them.

ALTER TABLE public.show_dates ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.show_dates.source IS
  'Origin of the row: ''sheet'' for Google Sheet imports; NULL for Airtable-synced or by-hand rows.';

CREATE UNIQUE INDEX IF NOT EXISTS show_dates_sheet_uniq
  ON public.show_dates (org_id, show_id, date)
  WHERE source = 'sheet';

-- Set-based idempotent upsert. Rows arrive already resolved (show_id + city_id) from the
-- edge function; held rows never reach here. org_id is set by the existing trg_derive_org_id
-- (BEFORE INSERT, from show_id, see 20260604130000_org_id_derivation_triggers.sql). SECURITY
-- DEFINER so it can upsert regardless of the caller's direct table grants, but it re-checks the
-- caller is an admin/producer of p_org (or the service role) first. Also returns new_ids: the
-- uuids of rows INSERTED this call, so the edge fn can open tier-1 offers for exactly those dates.
CREATE OR REPLACE FUNCTION public.import_sheet_dates(p_org uuid, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new int := 0;
  v_updated int := 0;
  v_new_ids uuid[] := '{}';
  v_is_service boolean := (auth.jwt() ->> 'role') = 'service_role';
BEGIN
  IF NOT v_is_service
     AND NOT (public.has_org_role(auth.uid(), p_org, 'admin'::app_role)
           OR public.has_org_role(auth.uid(), p_org, 'producer'::app_role)) THEN
    RAISE EXCEPTION 'not authorized to import sheet dates for this org'
      USING ERRCODE = 'P0001';
  END IF;

  WITH incoming AS (
    -- Only rows whose show belongs to p_org survive: this is the sole guard against a
    -- caller passing a foreign show_id under their own (legitimately authorized) p_org.
    -- org_id on the inserted row is still derived from show_id by trg_derive_org_id, but
    -- constraining the candidate set here prevents a cross-org write via that trigger.
    -- WITH ORDINALITY preserves the row's position in p_rows so duplicates within the
    -- same batch can be resolved deterministically below (last-row-wins), instead of
    -- letting two rows for the same (show_id, date) hit the INSERT in one statement,
    -- which makes ON CONFLICT ... DO UPDATE raise "command cannot affect row a second
    -- time" and abort the whole call.
    SELECT
      (r.elem ->> 'show_id')::uuid   AS show_id,
      (r.elem ->> 'date')::date      AS date,
      NULLIF(r.elem ->> 'city_id','')::uuid AS city_id,
      NULLIF(r.elem ->> 'session_1','')::time AS session_1,
      NULLIF(r.elem ->> 'session_2','')::time AS session_2,
      NULLIF(r.elem ->> 'session_3','')::time AS session_3,
      NULLIF(r.elem ->> 'venue','')     AS venue,
      r.ord AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord)
    JOIN public.shows ON shows.id = (r.elem ->> 'show_id')::uuid
    WHERE shows.org_id = p_org
  ),
  deduped AS (
    -- Sheet rows can legitimately repeat a (show_id, date) within one batch (e.g. the
    -- user re-pasted or the sheet has an accidental duplicate row); keep only the last
    -- occurrence per key so the INSERT below never sees two rows for the same key.
    SELECT DISTINCT ON (show_id, date)
      show_id, date, city_id, session_1, session_2, session_3, venue
    FROM incoming
    ORDER BY show_id, date, ord DESC
  ),
  upserted AS (
    INSERT INTO public.show_dates
      (show_id, date, city_id, session_1, session_2, session_3, venue, source)
    SELECT show_id, date, city_id, session_1, session_2, session_3, venue, 'sheet'
    FROM deduped
    ON CONFLICT (org_id, show_id, date) WHERE source = 'sheet'
    DO UPDATE SET
      -- A blank/unresolved city on a re-import must NOT wipe a previously resolved city
      -- (session/venue updates for that date should still land), so only overwrite when
      -- the new value is non-null. Session and venue stay unconditional EXCLUDED.*: a
      -- blank session or venue legitimately clears it.
      city_id   = COALESCE(EXCLUDED.city_id, public.show_dates.city_id),
      session_1 = EXCLUDED.session_1,
      session_2 = EXCLUDED.session_2,
      session_3 = EXCLUDED.session_3,
      venue     = EXCLUDED.venue
    RETURNING id, (xmax = 0) AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted),
    count(*) FILTER (WHERE NOT inserted),
    coalesce(array_agg(id) FILTER (WHERE inserted), '{}')
  INTO v_new, v_updated, v_new_ids
  FROM upserted;

  RETURN jsonb_build_object(
    'new_count', v_new,
    'updated_count', v_updated,
    'new_ids', to_jsonb(v_new_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_sheet_dates(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.import_sheet_dates(uuid, jsonb) TO authenticated, service_role;
