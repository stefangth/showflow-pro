-- Add the hire_orders category to category_of(): the three in-app types emitted by
-- generate-hire-orders (hire_orders_ready, hire_order_issued, hire_order_countersigned)
-- now map to preference category 'hire_orders' (mirrors IN_APP_TYPE_CATEGORY in
-- _shared/notificationCategories.ts, which also maps the 'hire-order-issued' email
-- template to the same category). Redefines category_of() in full (copied verbatim
-- from 20260714123919_notification_categories_flow_types.sql) since a SQL function
-- body can't be patched incrementally -- CREATE OR REPLACE is idempotent.
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
    when 'hire_orders_ready' then 'hire_orders'
    when 'hire_order_issued' then 'hire_orders'
    when 'hire_order_countersigned' then 'hire_orders'
    else null
  end;
$$;
