-- Per-user notification preferences (category x channel). Opt-out model:
-- a missing row / key = enabled, so existing users keep all notifications.
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create policy "own notif prefs - select" on public.notification_preferences
  for select to authenticated using (user_id = auth.uid());
create policy "own notif prefs - insert" on public.notification_preferences
  for insert to authenticated with check (user_id = auth.uid());
create policy "own notif prefs - update" on public.notification_preferences
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger update_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.update_updated_at_column();

-- Returns whether a user wants a (category, channel) notification.
-- Defaults to TRUE when the row, the category key, or the channel key is absent.
create or replace function public.should_notify(p_user uuid, p_category text, p_channel text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (prefs -> p_category ->> p_channel)::boolean
       from public.notification_preferences
      where user_id = p_user),
    true
  );
$$;

revoke all on function public.should_notify(uuid, text, text) from public, anon;
grant execute on function public.should_notify(uuid, text, text) to authenticated;
