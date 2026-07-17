-- Structurally guard the hire-orders SELECT policy's ::uuid cast so it can never
-- be reached for any OTHER bucket's rows, regardless of query plan. The previous
-- form (20260717132209_hire_orders_storage.sql) was proven safe live, but that
-- safety rested on Postgres's planner cost-ordering the bucket_id equality ahead
-- of the STABLE function+cast -- a heuristic, not a language guarantee. Since
-- storage.objects is shared by every future bucket, a CASE makes the property
-- structural: for any bucket other than 'hire-orders' the policy short-circuits
-- to false without ever evaluating ((storage.foldername(name))[1])::uuid, so an
-- unrelated bucket with a non-uuid first path segment can never raise 22P02.
-- Behaviorally identical for the 'hire-orders' bucket. A policy cannot be
-- CREATE OR REPLACE'd, so drop and recreate under the same name.
drop policy if exists "Org members read own hire order pdfs" on storage.objects;

create policy "Org members read own hire order pdfs"
  on storage.objects for select to authenticated
  using (
    case
      when bucket_id = 'hire-orders'
        then public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
      else false
    end
  );
-- No INSERT/UPDATE/DELETE policies: writes go through the service role only.
