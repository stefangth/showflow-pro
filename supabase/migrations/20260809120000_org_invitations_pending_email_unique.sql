-- Enforce at most one PENDING invitation per (org, email) at the database level, so the
-- People pane's client-side duplicate detection is backed by a real guarantee (two admins
-- inviting the same address concurrently, a stale page, or a direct edge-function call can
-- no longer create redundant pending invites). Accepted/revoked invites are unaffected, so
-- a revoked address stays re-invitable.

-- Prod may already hold duplicate pending invites; the unique index would fail to build if
-- so. Revoke the older duplicates first (keep the newest per (org_id, lower(email))). This
-- runs before the index and is idempotent — once deduped, it is a no-op on re-run.
with ranked as (
  select id,
         row_number() over (
           partition by org_id, lower(email)
           order by created_at desc, id desc
         ) as rn
  from public.org_invitations
  where status = 'pending'
)
update public.org_invitations o
set status = 'revoked'
from ranked r
where o.id = r.id
  and r.rn > 1;

create unique index if not exists org_invitations_pending_email_uniq
  on public.org_invitations (org_id, lower(email))
  where status = 'pending';
