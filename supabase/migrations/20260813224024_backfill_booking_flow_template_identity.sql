-- Existing organizations predate the persisted template identity. Infer the old
-- preset from the same flow fields the legacy UI matched (reference fields and
-- timing were customizations, not template identity), then preserve that identity
-- so later platform-template edits put the Custom chip on the correct tile.
with legacy_flows as (
  select
    o.id as org_id,
    coalesce(f.value, '{}'::jsonb) as flow
  from public.organizations o
  left join public.app_settings f
    on f.org_id = o.id
   and f.key = 'booking_flow'
), normalized as (
  select
    org_id,
    coalesce(flow -> 'active', 'true'::jsonb) = 'true'::jsonb as active,
    coalesce(flow -> 'auto_open_tier1', 'true'::jsonb) = 'true'::jsonb as auto_open_tier1,
    coalesce(flow -> 'auto_escalate', 'false'::jsonb) = 'true'::jsonb as auto_escalate,
    coalesce(flow -> 'at_risk_alerts', 'true'::jsonb) = 'true'::jsonb as at_risk_alerts,
    case when flow ->> 'offer_delivery' = 'immediate' then 'immediate' else 'digest' end as offer_delivery,
    coalesce(flow -> 'expiry_reminder', 'false'::jsonb) = 'true'::jsonb as expiry_reminder,
    coalesce(flow -> 'artist_acceptance', 'true'::jsonb) = 'true'::jsonb as artist_acceptance,
    coalesce(flow -> 'producer_confirmation', 'true'::jsonb) = 'true'::jsonb as producer_confirmation,
    coalesce(flow -> 'confirmation_digest', 'true'::jsonb) = 'true'::jsonb as confirmation_digest,
    coalesce(flow -> 'understudy_promotion', 'true'::jsonb) = 'true'::jsonb as understudy_promotion
  from legacy_flows
), inferred as (
  select
    org_id,
    case
      when not active then 'off'
      when auto_open_tier1 and auto_escalate and at_risk_alerts
        and offer_delivery = 'immediate' and expiry_reminder and artist_acceptance
        and not producer_confirmation and confirmation_digest and understudy_promotion
        then 'fasttrack'
      when not auto_open_tier1 and not auto_escalate and not at_risk_alerts
        and offer_delivery = 'digest' and not expiry_reminder and not artist_acceptance
        and producer_confirmation and confirmation_digest and understudy_promotion
        then 'direct'
      when auto_open_tier1 and not auto_escalate and at_risk_alerts
        and offer_delivery = 'digest' and not expiry_reminder and artist_acceptance
        and producer_confirmation and confirmation_digest and understudy_promotion
        then 'classic'
      else 'classic'
    end as template_name
  from normalized
)
insert into public.app_settings (org_id, key, value)
select org_id, 'booking_flow_template', to_jsonb(template_name)
from inferred
on conflict (org_id, key) do nothing;
