-- Auto-dispatch hire-order drafts when a show date becomes fully filled.
--
-- Mirrors the existing net.http_post dispatch idiom used by every pg_cron job
-- (20260514290000_pg_cron_schedules.sql / 20260624101342_cron_dispatch_timeout.sql):
-- full project URL, X-Cron-Secret from private.cron_secret() (Vault-backed), and the
-- mandatory 30000ms timeout (pg_net's 5000ms default previously misclassified healthy
-- 3-10s edge-function cold starts as timed_out -- see 20260624101342 and memory
-- cron-health-watcher-false-timeouts).
--
-- Unlike the pg_cron dispatches, this is a row-level DB TRIGGER, not a scheduled job, so
-- it does NOT insert into cron_health_dispatch: that table and cron-health-watcher's
-- classification are schedule-based (jobname + max-silence window), and an event-fired
-- trigger has no "silence window" to classify against. The one existing precedent for a
-- trigger-based net.http_post dispatch in this codebase -- on_auth_user_created's
-- artist-approval notify (20260423103651_3100e13e-9907-4d33-b74a-1dc3d0017262.sql) -- is
-- also a bare `perform net.http_post` wrapped in its own BEGIN/EXCEPTION, with no
-- dispatch-capture row, confirming that capture is a cron-only concern, not a trigger one.
--
-- Gated twice: the trigger's WHEN clause only invokes the function on a genuine
-- transition INTO 'fully_filled' (never re-fires on same-status updates or transitions
-- into any other status), and the function body re-checks
-- is_feature_enabled(org,'hire_orders') as the entitlement gate (hire_orders ships dark
-- by default -- org_entitlements.sql registry default is false). Issuing a hire order
-- stays a human action (a later task's UI); this trigger only creates DRAFTS via
-- generate-hire-orders's 'draft' action -- one per confirmed booking on the date -- and
-- asks it to notify producers (notify:true), which inserts the hire_orders_ready
-- notification generate-hire-orders already supports (Task 8).
create or replace function public.dispatch_hire_order_drafts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'fully_filled' or old.status = 'fully_filled' then
    return null;
  end if;
  if not public.is_feature_enabled(new.org_id, 'hire_orders') then
    return null;
  end if;
  perform net.http_post(
    url := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/generate-hire-orders',
    headers := jsonb_build_object('Content-Type','application/json','X-Cron-Secret', private.cron_secret()),
    body := jsonb_build_object('action','draft','org_id', new.org_id,'show_date_id', new.id,'notify', true),
    timeout_milliseconds := 30000
  );
  return null;
end;
$$;

create trigger dispatch_hire_order_drafts
  after update of status on public.show_dates
  for each row
  when (new.status = 'fully_filled' and old.status is distinct from new.status)
  execute function public.dispatch_hire_order_drafts();
