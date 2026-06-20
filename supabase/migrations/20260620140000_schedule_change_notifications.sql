-- Schedule-change notifications — DB foundation.
--   (1) session_1 becomes nullable: the schedule may reshuffle freely (e.g. clear
--       session_1 while session_3 exists). The "≥1 session" rule is enforced at the
--       offer pipeline (open-offer-tier), NOT a DB CHECK, so the Airtable sync can
--       always mirror a legitimate times-TBD (zero-session) date.
--   (2) show_date_change_log records what changed on a show_date so the daily
--       confirmation digest can notify the date's booked artists.
--   (3) log_show_date_schedule_change writes those rows.
--
-- No GUC is needed here. The #107 cascade (cascade_cancel_bookings_on_date_cancel)
-- updates BOOKINGS, not show_dates, so this show_dates trigger fires exactly once per
-- Airtable write. Fill-state status writes (open/partially_filled/fully_filled) from
-- the bookings recompute trigger are filtered out by the WHEN clause. This is an
-- UPDATE-only trigger, so its WHEN clause MAY reference OLD (unlike the combined
-- INSERT/UPDATE cascade trigger, which triggers Postgres 42P17 if it does).

-- (1) ---------------------------------------------------------------------------
ALTER TABLE public.show_dates ALTER COLUMN session_1 DROP NOT NULL;

-- (2) ---------------------------------------------------------------------------
CREATE TABLE public.show_date_change_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id)    ON DELETE CASCADE,
  change_type  text NOT NULL CHECK (change_type IN ('cancelled','session_added','session_removed','session_retimed')),
  session_slot smallint CHECK (session_slot IN (1,2,3)),
  old_value    text,
  new_value    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  digested_at  timestamptz
);
COMMENT ON TABLE public.show_date_change_log IS
  'Append-only log of schedule changes (cancellation / per-session add/remove/retime) on a show_date, consumed by send-confirmation-digest. digested_at stamps when the change was notified.';

CREATE INDEX idx_show_date_change_log_undigested
  ON public.show_date_change_log (org_id, digested_at) WHERE digested_at IS NULL;
CREATE INDEX idx_show_date_change_log_show_date
  ON public.show_date_change_log (show_date_id);

ALTER TABLE public.show_date_change_log ENABLE ROW LEVEL SECURITY;

-- Writes happen only via the SECURITY DEFINER trigger and the service-role digest
-- (both bypass RLS), so there is no authenticated INSERT/UPDATE/DELETE policy.
CREATE POLICY org_isolation ON public.show_date_change_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Org members can view show_date_change_log"
  ON public.show_date_change_log FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

-- (3) ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_show_date_schedule_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Transition INTO cancelled → record only the cancellation (the whole date is dead;
  -- per-session noise is irrelevant to a released artist).
  IF NEW.status = 'cancelled'::show_date_status
     AND OLD.status IS DISTINCT FROM 'cancelled'::show_date_status THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type)
    VALUES (NEW.org_id, NEW.id, 'cancelled');
    RETURN NULL;
  END IF;

  -- Already cancelled (or staying cancelled) → no active bookings to notify.
  IF NEW.status = 'cancelled'::show_date_status THEN
    RETURN NULL;
  END IF;

  -- Per-session diffs (only a real value change emits a row).
  IF NEW.session_1 IS DISTINCT FROM OLD.session_1 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_1 IS NULL THEN 'session_added'
           WHEN NEW.session_1 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      1, OLD.session_1::text, NEW.session_1::text);
  END IF;
  IF NEW.session_2 IS DISTINCT FROM OLD.session_2 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_2 IS NULL THEN 'session_added'
           WHEN NEW.session_2 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      2, OLD.session_2::text, NEW.session_2::text);
  END IF;
  IF NEW.session_3 IS DISTINCT FROM OLD.session_3 THEN
    INSERT INTO public.show_date_change_log (org_id, show_date_id, change_type, session_slot, old_value, new_value)
    VALUES (NEW.org_id, NEW.id,
      CASE WHEN OLD.session_3 IS NULL THEN 'session_added'
           WHEN NEW.session_3 IS NULL THEN 'session_removed'
           ELSE 'session_retimed' END,
      3, OLD.session_3::text, NEW.session_3::text);
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS log_show_date_schedule_change ON public.show_dates;
CREATE TRIGGER log_show_date_schedule_change
AFTER UPDATE OF session_1, session_2, session_3, status ON public.show_dates
FOR EACH ROW
WHEN (
  (OLD.status = 'cancelled'::show_date_status) IS DISTINCT FROM (NEW.status = 'cancelled'::show_date_status)
  OR OLD.session_1 IS DISTINCT FROM NEW.session_1
  OR OLD.session_2 IS DISTINCT FROM NEW.session_2
  OR OLD.session_3 IS DISTINCT FROM NEW.session_3
)
EXECUTE FUNCTION public.log_show_date_schedule_change();
