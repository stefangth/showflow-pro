-- Phase 3 (Part 9): drop the bootstrap-org column DEFAULT from every tenant table.
-- org_id is now set on every insert path (Part-2 derive triggers for FK-children;
-- explicit for roots and the parentless writers). Removing the DEFAULT makes a
-- missed path fail loudly (NOT NULL) rather than silently land in the bootstrap org.
-- (app_settings already dropped its default in 20260604120000.)
do $$
declare t text;
begin
  foreach t in array array[
    'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
    'show_date_cast_eligibility','bookings','booking_audit_log','casts',
    'cast_members','cast_city_priority','cities','skills','artist_skills',
    'blocked_dates','show_assignments','chats','chat_messages',
    'notifications','airtable_sync_log','artists'
  ] loop
    execute format('alter table public.%I alter column org_id drop default', t);
  end loop;
end $$;
