-- Cron-health alerts are platform-level (not org-scoped), so they carry no org_id.
-- Relax the NOT NULL so platform notifications can be inserted. Existing rows are
-- unaffected; super-admins still read their org_id-NULL notifications because the
-- org_isolation RESTRICTIVE policy's is_org_member() short-circuits true for super-admins,
-- and delete_org (which filters by org_id) correctly leaves these platform rows alone.
ALTER TABLE public.notifications ALTER COLUMN org_id DROP NOT NULL;
