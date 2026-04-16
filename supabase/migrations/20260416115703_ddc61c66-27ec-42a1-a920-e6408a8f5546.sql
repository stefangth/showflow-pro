
-- Fix overly permissive insert policies
DROP POLICY "System can insert audit logs" ON public.booking_audit_log;
CREATE POLICY "Admins and producers can insert audit logs"
  ON public.booking_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

DROP POLICY "System can insert sync logs" ON public.airtable_sync_log;
CREATE POLICY "Admins can insert sync logs"
  ON public.airtable_sync_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY "System can insert notifications" ON public.notifications;
CREATE POLICY "Admins and producers can insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));
