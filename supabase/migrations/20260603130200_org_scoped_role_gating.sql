-- Phase 1B (3a/n): scope role-gating to the org — rewrite permissive policies
-- has_role(auth.uid(), R)  →  has_org_role(auth.uid(), org_id, R).
--
-- Programmatic + mechanical: every PERMISSIVE policy whose USING/WITH CHECK calls
-- has_role(auth.uid(), …) is dropped and recreated with the org-scoped helper, so a
-- producer/admin only passes within an org where they actually hold that role. The
-- replacement is a literal text substitution on the well-formed `has_role(auth.uid(), `
-- prefix, preserving the rest of each expression (AND/OR structure, self-checks, etc.).
--
-- Left UNTOUCHED: self policies (auth.uid() = user_id / artist-owned), participant
-- policies (is_chat_participant), USING(true) reads, and the RESTRICTIVE org_isolation
-- policies (which keep enforcing cross-org isolation regardless). user_roles / has_role
-- and the bootstrap fallback remain for now; they are dropped in a later 1B push once
-- nothing reads them.

do $$
declare
  r       record;
  v_using text;
  v_check text;
  v_sql   text;
begin
  for r in
    select tablename, policyname, cmd, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and permissive = 'PERMISSIVE'
      and ( coalesce(qual, '')       like '%has_role(auth.uid(),%'
         or coalesce(with_check, '') like '%has_role(auth.uid(),%' )
      and tablename = any(array[
        'shows','show_dates','show_date_offer_tiers','show_cast_eligibility',
        'show_date_cast_eligibility','bookings','booking_audit_log','casts',
        'cast_members','cast_city_priority','cities','skills','artist_skills',
        'blocked_dates','show_assignments','chats','chat_messages',
        'notifications','airtable_sync_log','artists','app_settings'])
  loop
    v_using := replace(r.qual,       'has_role(auth.uid(), ', 'has_org_role(auth.uid(), org_id, ');
    v_check := replace(r.with_check,  'has_role(auth.uid(), ', 'has_org_role(auth.uid(), org_id, ');

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    v_sql := format('create policy %I on public.%I for %s to authenticated',
                    r.policyname, r.tablename, r.cmd);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;
end $$;
