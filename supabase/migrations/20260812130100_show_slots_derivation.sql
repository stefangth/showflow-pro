-- Named production slots (Plan B, task 2 of 2026-08-11-production-slots).
-- The derivation engine: keeps shows.main_cast_slots/understudy_slots and
-- show_required_skills as trigger-maintained caches computed from show_slots +
-- show_slot_required_skills (added in 20260812130000_show_slots.sql). Every
-- existing consumer of those caches (compute_show_date_status,
-- auto_cancel_on_slot_fill, eligibility reads of show_required_skills) is
-- unchanged and keeps working exactly as before.
--
-- Recursion/termination: recompute_show_slot_derivations UPDATEs shows
-- (main_cast_slots/understudy_slots), which fires the pre-existing
-- sync_show_dates_on_show_update_trigger (AFTER UPDATE OF program,
-- sub_program, main_cast_slots, understudy_slots) -- that only loops over the
-- show's show_dates and calls compute_show_date_status, which writes
-- show_dates.status. It never writes back to shows or show_slots, so this
-- terminates. The function also rewrites show_required_skills (DELETE +
-- INSERT); that table's only triggers are the pre-existing BEFORE INSERT
-- org-derivation and BEFORE INSERT OR UPDATE same-org guard (both from
-- 20260715130000_configurable_eligibility.sql) -- neither is AFTER, neither
-- writes to any other table, so there is no cascade back into show_slots.
-- show_slots itself only has a BEFORE INSERT org-derivation trigger and a
-- BEFORE UPDATE updated_at trigger -- no AFTER triggers, so recompute's own
-- writes never re-fire the two triggers defined below. No cycle.
--
-- Reparenting: an UPDATE that moves a slot (or a slot-skill row, transitively)
-- to a different show must recompute BOTH the old and the new show, or the old
-- show's cache goes stale. Both trigger functions below branch on TG_OP/
-- OLD-vs-NEW show id and recompute every distinct affected show.
--
-- recompute_show_slot_derivations is SECURITY DEFINER and REVOKEd from
-- public/anon/authenticated immediately below -- it must never be reachable
-- via PostgREST RPC by an ordinary org member, who could otherwise pass any
-- show UUID (including one from a different org) and, for a show with zero
-- show_slots rows, NULL its main_cast_slots/understudy_slots and delete its
-- show_required_skills.

CREATE OR REPLACE FUNCTION public.recompute_show_slot_derivations(p_show_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- sum() over zero rows is NULL, which correctly leaves an un-slotted kind
  -- NULL (the "unconfigured" state compute_show_date_status/auto_cancel_on_slot_fill
  -- already special-case). Do NOT coalesce to 0 here.
  UPDATE public.shows
  SET main_cast_slots = (
        SELECT sum(slot_count)::smallint FROM public.show_slots
        WHERE show_id = p_show_id AND kind = 'main'
      ),
      understudy_slots = (
        SELECT sum(slot_count)::smallint FROM public.show_slots
        WHERE show_id = p_show_id AND kind = 'understudy'
      )
  WHERE id = p_show_id;

  -- Rebuild show_required_skills as the deduped union of the show's slots' skills.
  DELETE FROM public.show_required_skills WHERE show_id = p_show_id;

  INSERT INTO public.show_required_skills (org_id, show_id, skill_id)
  SELECT DISTINCT sh.org_id, p_show_id, ssrs.skill_id
  FROM public.show_slot_required_skills ssrs
  JOIN public.show_slots ss ON ss.id = ssrs.slot_id
  JOIN public.shows sh ON sh.id = p_show_id
  WHERE ss.show_id = p_show_id;
END;
$$;

-- Only the trigger functions below (running as this function's SECURITY
-- DEFINER owner) may call this; no direct RPC/PostgREST access for any role.
REVOKE ALL ON FUNCTION public.recompute_show_slot_derivations(uuid) FROM public, anon, authenticated;

-- Trigger on show_slots: any insert/update/delete of a slot recomputes its
-- show. A reparenting UPDATE (show_id changed) recomputes both the old and
-- the new show, so neither is left with a stale cache.
CREATE OR REPLACE FUNCTION public.trg_fn_recompute_show_slot_derivations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.show_id IS DISTINCT FROM NEW.show_id THEN
    PERFORM public.recompute_show_slot_derivations(OLD.show_id);
    PERFORM public.recompute_show_slot_derivations(NEW.show_id);
  ELSE
    PERFORM public.recompute_show_slot_derivations(COALESCE(NEW.show_id, OLD.show_id));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_show_slot_derivations ON public.show_slots;
CREATE TRIGGER trg_recompute_show_slot_derivations
  AFTER INSERT OR UPDATE OR DELETE ON public.show_slots
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_recompute_show_slot_derivations();

-- Trigger on show_slot_required_skills: resolve the owning show(s) via the
-- slot(s), then recompute each distinct non-null show. A reparenting UPDATE
-- (slot_id moved to a slot under a different show) recomputes both the old
-- and the new show. On a cascade delete triggered by the slot itself being
-- deleted, the slot row is already gone by the time this fires, so the OLD
-- lookup returns NULL and the recompute is skipped here -- harmless, because
-- the show_slots AFTER DELETE trigger above already recomputes the show (and
-- its rebuild of show_required_skills naturally excludes skills whose slot no
-- longer exists via the JOIN in recompute_show_slot_derivations).
CREATE OR REPLACE FUNCTION public.trg_fn_recompute_show_slot_derivations_from_skill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_show_id uuid;
  v_new_show_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT show_id INTO v_old_show_id FROM public.show_slots WHERE id = OLD.slot_id;
  ELSIF TG_OP = 'INSERT' THEN
    SELECT show_id INTO v_new_show_id FROM public.show_slots WHERE id = NEW.slot_id;
  ELSE -- UPDATE
    SELECT show_id INTO v_old_show_id FROM public.show_slots WHERE id = OLD.slot_id;
    SELECT show_id INTO v_new_show_id FROM public.show_slots WHERE id = NEW.slot_id;
  END IF;

  IF v_old_show_id IS NOT NULL THEN
    PERFORM public.recompute_show_slot_derivations(v_old_show_id);
  END IF;
  IF v_new_show_id IS NOT NULL AND v_new_show_id IS DISTINCT FROM v_old_show_id THEN
    PERFORM public.recompute_show_slot_derivations(v_new_show_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_show_slot_derivations ON public.show_slot_required_skills;
CREATE TRIGGER trg_recompute_show_slot_derivations
  AFTER INSERT OR UPDATE OR DELETE ON public.show_slot_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_recompute_show_slot_derivations_from_skill();
