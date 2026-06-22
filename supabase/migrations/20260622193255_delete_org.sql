-- Hard tenant teardown (super-admin only). Removes ALL of an org's data, including
-- that org's booking_audit_log (never-delete is per-org-lifetime). Does NOT touch
-- auth.users / profiles / notification_preferences (global/user-scoped).
create or replace function public.delete_org(p_org uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin(auth.uid()) then
    raise exception 'Forbidden: super-admin only' using errcode = '42501';
  end if;

  -- Delete leaf/child rows first (children of bookings, show_dates, artists, casts, chats)
  delete from public.booking_audit_log where org_id = p_org;
  delete from public.bookings where org_id = p_org;
  delete from public.show_date_offer_tiers where org_id = p_org;
  delete from public.show_date_change_log where org_id = p_org;
  delete from public.show_date_cast_eligibility where org_id = p_org;
  delete from public.show_cast_eligibility where org_id = p_org;
  delete from public.airtable_sync_record_log where org_id = p_org;
  delete from public.show_assignments where org_id = p_org;
  delete from public.blocked_dates where org_id = p_org;
  delete from public.artist_skills where org_id = p_org;
  delete from public.cast_members where org_id = p_org;
  delete from public.cast_city_priority where org_id = p_org;
  delete from public.chat_messages where org_id = p_org;
  delete from public.chats where org_id = p_org;
  delete from public.show_dates where org_id = p_org;
  delete from public.shows where org_id = p_org;
  delete from public.artists where org_id = p_org;
  delete from public.casts where org_id = p_org;
  delete from public.cities where org_id = p_org;
  delete from public.skills where org_id = p_org;
  delete from public.custom_field_definitions where org_id = p_org;
  delete from public.notifications where org_id = p_org;
  delete from public.org_invitations where org_id = p_org;
  delete from public.app_settings where org_id = p_org;
  delete from public.airtable_sync_log where org_id = p_org;
  delete from public.org_memberships where org_id = p_org;
  delete from public.organizations where id = p_org;
end;
$$;

revoke all on function public.delete_org(uuid) from public, anon;
grant execute on function public.delete_org(uuid) to authenticated;
