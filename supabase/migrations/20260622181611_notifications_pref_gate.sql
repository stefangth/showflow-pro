-- Maps an in-app notification type to a preference category (mirrors
-- IN_APP_TYPE_CATEGORY in _shared/notificationCategories.ts). NULL = always deliver.
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
    else null
  end;
$$;

-- One gate for ALL in-app notification inserts (trigger- and app-emitted):
-- skip the insert when the recipient disabled in_app for this category.
create or replace function public.gate_notification_pref()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_category text;
begin
  v_category := public.category_of(NEW.type);
  if v_category is null then
    return NEW; -- uncategorized/critical types are always delivered
  end if;
  if public.should_notify(NEW.user_id, v_category, 'in_app') then
    return NEW;
  end if;
  return null; -- recipient disabled in-app for this category
end;
$$;

drop trigger if exists gate_notification_pref_trigger on public.notifications;
create trigger gate_notification_pref_trigger
before insert on public.notifications
for each row execute function public.gate_notification_pref();
