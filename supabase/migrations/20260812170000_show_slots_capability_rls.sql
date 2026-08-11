-- Capability-aware write RLS for the slot tables, matching the established pattern
-- (shows_capability_rls, show_dates_capability_rls, casts, etc.).
--
-- Editing a show's slots (and their required skills) is a scheduling edit, gated in the
-- UI by useCan("edit_scheduling"). Enforce the same at the DB layer so a producer whose
-- org has producer_can_edit_scheduling disabled cannot bypass the UI by writing directly
-- via the Supabase client. Admin is always allowed; SELECT (read-only floor) is untouched.
DROP POLICY "Admins and producers manage show slots" ON public.show_slots;
CREATE POLICY "Admins and producers manage show slots"
  ON public.show_slots FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR (public.has_org_role(auth.uid(), org_id, 'producer'::app_role)
          AND public.is_capability_enabled(org_id, 'producer_can_edit_scheduling')))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR (public.has_org_role(auth.uid(), org_id, 'producer'::app_role)
          AND public.is_capability_enabled(org_id, 'producer_can_edit_scheduling')));

DROP POLICY "Admins and producers manage show slot required skills" ON public.show_slot_required_skills;
CREATE POLICY "Admins and producers manage show slot required skills"
  ON public.show_slot_required_skills FOR ALL TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR (public.has_org_role(auth.uid(), org_id, 'producer'::app_role)
          AND public.is_capability_enabled(org_id, 'producer_can_edit_scheduling')))
  WITH CHECK (public.has_org_role(auth.uid(), org_id, 'admin'::app_role)
      OR (public.has_org_role(auth.uid(), org_id, 'producer'::app_role)
          AND public.is_capability_enabled(org_id, 'producer_can_edit_scheduling')));
