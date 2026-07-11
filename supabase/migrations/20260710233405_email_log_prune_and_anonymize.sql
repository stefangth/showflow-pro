-- prune_email_log: daily retention prune of email_send_log, org-agnostic (email_log_retention_days
-- is a platform-wide app_settings key with org_id IS NULL — see 20260710231816_email_delivery_tables.sql).
CREATE OR REPLACE FUNCTION public.prune_email_log()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_days int := COALESCE((SELECT (value #>> '{}')::int FROM public.app_settings
                          WHERE org_id IS NULL AND key = 'email_log_retention_days'), 90);
  v_deleted int;
BEGIN
  DELETE FROM public.email_send_log WHERE created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.prune_email_log() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_email_log() TO service_role;

SELECT cron.schedule('email-log-prune', '30 3 * * *', $$ SELECT public.prune_email_log(); $$);

-- Extend anonymize_user (GDPR erasure) to also scrub the recipient in email_send_log.
-- Real body read from the live function via pg_get_functiondef('public.anonymize_user'::regproc)
-- on 2026-07-11; every pre-existing statement below is preserved verbatim. Only additions:
-- the `v_email` DECLARE, the `SELECT ... INTO v_email` lookup, and the trailing IF block.
CREATE OR REPLACE FUNCTION public.anonymize_user(p_user uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
  end if;
end;
$function$;
