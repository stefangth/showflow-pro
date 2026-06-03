-- Phase 1B (2/n): make is_chat_participant org-aware.
-- Was: has_role(admin/producer) globally OR a booked artist on that date.
-- Now: derive the org from the chat's show_date and check has_org_role within it,
-- so chat access (and the chats/chat_messages policies that call this) is scoped to
-- the correct org. The booked-artist branch is unchanged (already org-implicit via
-- the booking's show_date).

create or replace function public.is_chat_participant(_chat_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chats c
    join public.show_dates sd on sd.id = c.show_date_id
    where c.id = _chat_id
      and (
        public.has_org_role(_user_id, sd.org_id, 'admin'::app_role)
        or public.has_org_role(_user_id, sd.org_id, 'producer'::app_role)
        or exists (
          select 1
          from public.bookings b
          join public.artists a on a.id = b.artist_id
          where b.show_date_id = c.show_date_id
            and a.user_id = _user_id
            and b.status in ('soft_booked'::booking_status, 'confirmed'::booking_status)
        )
      )
  )
$$;
