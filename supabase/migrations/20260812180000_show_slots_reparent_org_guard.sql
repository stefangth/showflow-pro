-- Close a tenant-isolation gap on the slot tables: org_id was derived only on
-- INSERT (20260812130000_show_slots.sql), never on UPDATE. Both the write-gate
-- policy and the RESTRICTIVE org_isolation policy authorize purely on the row's
-- own org_id column, so a producer/admin could UPDATE a show_slots row they own
-- and repoint show_id at a show in ANOTHER org: org_id stayed their own org (so
-- both RLS checks passed -- they are a member of it) while the FK now referenced
-- a foreign show, and trg_recompute_show_slot_derivations (20260812130100) would
-- then rewrite that foreign show's main_cast_slots/understudy_slots and
-- show_required_skills cache. The same hole existed for
-- show_slot_required_skills.slot_id.
--
-- Mirror the derive_org_id_for_booking() precedent (20260616162454): re-derive
-- org_id from the FK parent on INSERT and on any UPDATE of the parent key, and
-- reject a reparent that would cross organizations outright. The RAISE is
-- defense-in-depth independent of RLS, so it also holds for a SECURITY DEFINER
-- or service_role writer. The app never reparents a slot (src/data/slots.ts only
-- ever updates name/slot_count/kind/sort_order), so no legitimate path breaks.

CREATE OR REPLACE FUNCTION public.derive_org_id_for_show_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_show_org uuid;
BEGIN
  SELECT org_id INTO v_show_org FROM public.shows WHERE id = NEW.show_id;
  IF TG_OP = 'UPDATE' AND v_show_org IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'show_slot % cannot be reparented across organizations (% -> %)',
      NEW.id, OLD.org_id, v_show_org;
  END IF;
  NEW.org_id := v_show_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_slots;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT OR UPDATE OF show_id ON public.show_slots
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_show_slot();

CREATE OR REPLACE FUNCTION public.derive_org_id_for_show_slot_skill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot_org uuid;
BEGIN
  SELECT org_id INTO v_slot_org FROM public.show_slots WHERE id = NEW.slot_id;
  IF TG_OP = 'UPDATE' AND v_slot_org IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'show_slot_required_skill % cannot be reparented across organizations (% -> %)',
      NEW.id, OLD.org_id, v_slot_org;
  END IF;
  NEW.org_id := v_slot_org;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.show_slot_required_skills;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT OR UPDATE OF slot_id ON public.show_slot_required_skills
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_for_show_slot_skill();
