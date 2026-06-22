-- Repo-convention hardening for the notification-prefs functions:
-- pin search_path on category_of and lock down direct EXECUTE.
create or replace function public.category_of(p_type text)
returns text language sql immutable set search_path = public as $$
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
    else null
  end;
$$;

revoke all on function public.category_of(text) from public, anon;
grant execute on function public.category_of(text) to authenticated;

-- Trigger function: clients never call it directly.
revoke all on function public.gate_notification_pref() from public, anon;
