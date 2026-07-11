-- anonymize_user scrubs email_send_log.recipient_email but left
-- email_unsubscribe_tokens.email holding the raw address of every emailed user
-- (created on first email, never pruned) — recoverable PII after account
-- deletion. Add the token cleanup alongside the existing email_send_log scrub.
-- suppressed_emails is intentionally left untouched: retaining a bounce/complaint
-- suppression is a legitimate-interest decision, not scoped to this fix.
CREATE OR REPLACE FUNCTION public.anonymize_user(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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

  -- chat_messages.user_id is NOT NULL; delete the user's messages rather than nulling.
  delete from public.chat_messages where user_id = p_user;

  update public.booking_audit_log set performed_by = null where performed_by = p_user;

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
$function$
