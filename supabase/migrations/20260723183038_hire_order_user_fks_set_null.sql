-- GDPR erasure: the hire-order FKs to auth.users must SET NULL on delete so a user
-- who signed (hire_order_signatures.signer_user_id) or created (hire_orders.created_by)
-- a hire order can still be deleted via auth.admin.deleteUser. The signature audit row
-- keeps its denormalized signer_name/signer_email, so nulling signer_user_id preserves
-- the trail; created_by is provenance only. anonymize_user also nulls both proactively
-- (mirrors the existing booking_audit_log.performed_by handling) so the data is cleared
-- before the auth user is removed.
alter table public.hire_order_signatures drop constraint hire_order_signatures_signer_user_id_fkey;
alter table public.hire_order_signatures add constraint hire_order_signatures_signer_user_id_fkey
  foreign key (signer_user_id) references auth.users(id) on delete set null;

alter table public.hire_orders drop constraint hire_orders_created_by_fkey;
alter table public.hire_orders add constraint hire_orders_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

create or replace function public.anonymize_user(p_user uuid)
returns void language plpgsql security definer set search_path to 'public'
as $anon$
declare
  v_email text;
begin
  if not (auth.uid() = p_user or public.is_super_admin(auth.uid())) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select lower(email) into v_email from auth.users where id = p_user;
  delete from public.blocked_dates
    where artist_id in (select id from public.artists where user_id = p_user);
  update public.artists
    set name = 'Deleted artist', email = null, phone = null, bio = null, user_id = null
    where user_id = p_user;
  delete from public.chat_messages where user_id = p_user;
  update public.booking_audit_log set performed_by = null where performed_by = p_user;
  update public.hire_order_signatures set signer_user_id = null where signer_user_id = p_user;
  update public.hire_orders set created_by = null where created_by = p_user;
  delete from public.notifications where user_id = p_user;
  delete from public.notification_preferences where user_id = p_user;
  delete from public.org_memberships where user_id = p_user;
  delete from public.org_invitations
    where lower(email) = (select lower(email) from auth.users where id = p_user);
  delete from public.profiles where user_id = p_user;
  if v_email is not null then
    update public.email_send_log set recipient_email = '[anonymized]'
      where lower(recipient_email) = v_email;
    delete from public.email_unsubscribe_tokens where lower(email) = v_email;
  end if;
end;
$anon$;
