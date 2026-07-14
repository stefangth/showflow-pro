-- Maps an in-app notification type to a preference category (mirrors
-- IN_APP_TYPE_CATEGORY in _shared/notificationCategories.ts). NULL = always deliver.
--
-- Adds the two Milestone C (Task 11/12) in-app types: the 24h offer-expiry
-- reminder (`offer_expiring`, booking_offers) and the auto-escalation
-- notification (`tier_escalated`, at_risk). Redefines category_of() in full
-- (copied verbatim from 20260622181611_notifications_pref_gate.sql) since a SQL
-- function body can't be patched incrementally — CREATE OR REPLACE is idempotent.
create or replace function public.category_of(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'booking_confirmed' then 'booking_confirmations'
    when 'booking_ready_to_confirm' then 'booking_activity'
    when 'schedule_change' then 'schedule_changes'
    when 'session_added' then 'schedule_changes'
    when 'session_removed' then 'schedule_changes'
    when 'session_retimed' then 'schedule_changes'
    when 'cancelled' then 'schedule_changes'
    when 'tier_at_risk' then 'at_risk'
    when 'cast_escalation_requested' then 'at_risk'
    when 'offer_expiring' then 'booking_offers'
    when 'tier_escalated' then 'at_risk'
    else null
  end;
$$;
