-- Named production slots (Plan B, task 3 of 2026-08-11-production-slots).
-- Backfill: seed one Main/Understudy slot per existing show so the
-- trigger-maintained caches (shows.main_cast_slots/understudy_slots and
-- show_required_skills, added in 20260812130000/20260812130100) keep reading
-- back EXACTLY their pre-backfill values.
--
-- THE load-bearing invariant: for every existing show, main_cast_slots,
-- understudy_slots, and the set of show_required_skills must be byte-for-byte
-- unchanged after this runs. A show with a NULL count MUST stay NULL, never 0.
-- sum() over zero slot rows is NULL, which is the "unconfigured" state
-- compute_show_date_status/auto_cancel_on_slot_fill special-case, so a show that
-- was NULL for a given kind must end up with zero slots of that kind (not a
-- count-0 slot, which would recompute to 0 and break the invariant).
--
-- Kept as a function (not inline DML) so the pgTAP calls the real thing rather
-- than reimplementing it. SECURITY DEFINER + REVOKE, same lockdown lesson as
-- recompute_show_slot_derivations: a cache-mutating SECURITY DEFINER function
-- must never be reachable via PostgREST RPC.

CREATE OR REPLACE FUNCTION public.backfill_show_slots_from_legacy()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r               RECORD;
  v_main_slot_id  uuid;
  v_understudy_id uuid;
  v_target_slot   uuid;
  v_recompute_ids uuid[] := ARRAY[]::uuid[];
  v_show_id       uuid;
BEGIN
  -- Suppress the derivation triggers during the bulk insert so the caches are
  -- not perturbed mid-flight; they are recomputed explicitly at the end. This
  -- runs as the SECURITY DEFINER owner (a superuser in migration context), so
  -- session_replication_role = replica is acceptable and the simplest lever.
  -- Note it ALSO disables the BEFORE INSERT org-derivation trigger, so we set
  -- org_id ourselves (from the show) on every insert below.
  SET LOCAL session_replication_role = replica;

  -- Only shows with zero show_slots rows: a second run is a no-op, and a show
  -- someone has already authored slots on is never overwritten.
  FOR r IN
    SELECT sh.id, sh.org_id, sh.main_cast_slots, sh.understudy_slots
    FROM public.shows sh
    WHERE NOT EXISTS (SELECT 1 FROM public.show_slots ss WHERE ss.show_id = sh.id)
  LOOP
    v_main_slot_id  := NULL;
    v_understudy_id := NULL;

    -- Only create a slot for a kind whose legacy count is NOT NULL, so a kind
    -- that was NULL ends up with zero slots and recomputes back to NULL.
    IF r.main_cast_slots IS NOT NULL THEN
      INSERT INTO public.show_slots (org_id, show_id, name, slot_count, kind, sort_order)
      VALUES (r.org_id, r.id, 'Main cast', r.main_cast_slots, 'main', 0)
      RETURNING id INTO v_main_slot_id;
    END IF;

    IF r.understudy_slots IS NOT NULL THEN
      INSERT INTO public.show_slots (org_id, show_id, name, slot_count, kind, sort_order)
      VALUES (r.org_id, r.id, 'Understudy', r.understudy_slots, 'understudy', 1)
      RETURNING id INTO v_understudy_id;
    END IF;

    -- Every legacy show_required_skills row attaches to the Main cast slot if
    -- one was created, else to the Understudy slot.
    v_target_slot := COALESCE(v_main_slot_id, v_understudy_id);

    IF v_target_slot IS NULL THEN
      -- Both counts NULL. If the show also has required skills, there is no slot
      -- to hang them on, so leave the show ENTIRELY untouched: no slots, counts
      -- stay NULL, and its show_required_skills are preserved as-is (this show is
      -- NOT recomputed below, which would otherwise wipe them). This orphan case
      -- does not exist in production.
      -- NOTE: re-homing such a show's skills when it is later edited is a Task 5
      -- (slot authoring UI) concern.
      IF EXISTS (SELECT 1 FROM public.show_required_skills WHERE show_id = r.id) THEN
        RAISE NOTICE 'backfill_show_slots_from_legacy: show % has required skills but NULL main/understudy counts; left untouched (no slots created).', r.id;
      END IF;
      CONTINUE;
    END IF;

    INSERT INTO public.show_slot_required_skills (org_id, slot_id, skill_id)
    SELECT r.org_id, v_target_slot, srs.skill_id
    FROM public.show_required_skills srs
    WHERE srs.show_id = r.id;

    v_recompute_ids := array_append(v_recompute_ids, r.id);
  END LOOP;

  -- Re-enable triggers before recomputing so the derivation runs normally.
  SET LOCAL session_replication_role = DEFAULT;

  -- Recompute ONLY shows that got slots. Each Main slot's count equals the
  -- show's original main_cast_slots (ditto understudy) and every required skill
  -- is attached to a slot, so the recompute reproduces the identical
  -- main_cast_slots/understudy_slots/show_required_skills. Shows skipped above
  -- (no slots) are deliberately NOT recomputed, so their NULL counts and any
  -- existing show_required_skills are left exactly as they were.
  FOREACH v_show_id IN ARRAY v_recompute_ids LOOP
    PERFORM public.recompute_show_slot_derivations(v_show_id);
  END LOOP;
END;
$$;

-- Cache-mutating SECURITY DEFINER function: never RPC-callable by any client role.
REVOKE ALL ON FUNCTION public.backfill_show_slots_from_legacy() FROM public, anon, authenticated;

-- Run the backfill once. The merge to main applies this migration in production.
SELECT public.backfill_show_slots_from_legacy();
