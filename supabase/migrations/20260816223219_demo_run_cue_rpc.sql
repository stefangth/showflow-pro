-- Demo mode phase 2: run_demo_cue applies deterministic, demo-org-only
-- scripted cues against the state seed_demo_org staged.
--
-- Guarded exactly like wipe_demo_org / seed_demo_org: is_demo is read from
-- the SAME row the cue is about to mutate and refused (raise) when not
-- exactly true. Every cue is written to be safe to run twice: either it
-- targets rows by a predicate that stops matching once applied (idempotent
-- by construction), or it explicitly clears its own prior output first.
--
-- issue_hire_order is NOT handled here -- it is edge-orchestrated (calls
-- generate-hire-orders) and belongs to a later task.
create or replace function public.run_demo_cue(
  p_org uuid,
  p_cue text,
  p_actor uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target uuid;
  v_main_cap int;
  v_us_cap int;
  v_conf_main int;
  v_conf_us int;
  v_need_main int;
  v_need_us int;
begin
  if (select is_demo from public.organizations where id = p_org) is not true then
    raise exception 'run_demo_cue refused: % is not a demo org', p_org
      using errcode = 'raise_exception';
  end if;

  if p_cue = 'artist_accepts_offer' then
    -- Promote the earliest still-suggested offer to soft_booked. Idempotent:
    -- once nothing is 'suggested' the subquery returns no row and the
    -- update is a no-op.
    update public.bookings b set status = 'soft_booked', offered_at = coalesce(offered_at, now())
    where b.id = (
      select b2.id from public.bookings b2
      join public.show_dates d on d.id = b2.show_date_id
      where d.org_id = p_org and b2.status = 'suggested'
      order by b2.created_at limit 1
    );

  elsif p_cue = 'run_clock_to_1700' then
    -- Expire the staged holds: soft_booked with a due-today-17:00 deadline
    -- becomes cancelled (same visible effect as expire-offers). Idempotent:
    -- already-cancelled rows no longer match status = 'soft_booked'.
    update public.bookings b set status = 'cancelled', cancelled_at = now(),
      cancellation_reason = 'Offer expired'
    from public.show_dates d
    where d.id = b.show_date_id and d.org_id = p_org
      and b.status = 'soft_booked' and b.offer_expires_at is not null
      and b.offer_expires_at <= (current_date + interval '17 hours');
    update public.demo_state set sim_now = (current_date + interval '17 hours'), updated_at = now()
      where org_id = p_org;

  elsif p_cue = 'drop_notifications' then
    if p_actor is not null then
      -- Idempotent: clear any prior cue-dropped notifications for this
      -- actor first, then re-insert the fixed set (replace, not duplicate).
      delete from public.notifications
        where user_id = p_actor and org_id = p_org and type = 'demo_cue';
      insert into public.notifications (user_id, org_id, type, title, message, read) values
        (p_actor, p_org, 'demo_cue', 'Angebot angenommen', 'Yasmin Aydın hat zugesagt.', false),
        (p_actor, p_org, 'demo_cue', 'Frist laeuft ab', 'Zwei Angebote laufen heute um 17:00 ab.', false),
        (p_actor, p_org, 'demo_cue', 'Vertrag bereit', 'Ein Engagementvertrag wartet auf Ausstellung.', false);
    end if;

  elsif p_cue = 'fill_date' then
    -- Pick the date that already has a confirmed non-understudy booking
    -- (partially_filled) and confirm additional artists up to the show's
    -- main_cast_slots / understudy_slots caps so it reaches fully_filled,
    -- firing the real dispatch_hire_order_drafts trigger. Idempotent: once
    -- the date is fully_filled it no longer matches status = 'partially_filled',
    -- so a second run selects no target and is a no-op.
    select d.id, s.main_cast_slots, coalesce(s.understudy_slots, 0)
      into v_target, v_main_cap, v_us_cap
    from public.show_dates d
    join public.shows s on s.id = d.show_id
    where d.org_id = p_org and d.status = 'partially_filled'
      and exists (
        select 1 from public.bookings b
        where b.show_date_id = d.id and b.status = 'confirmed' and b.is_understudy = false
      )
    order by d.date limit 1;

    if v_target is not null then
      select
        count(*) filter (where status = 'confirmed' and not is_understudy),
        count(*) filter (where status = 'confirmed' and is_understudy)
        into v_conf_main, v_conf_us
      from public.bookings where show_date_id = v_target;

      v_need_main := greatest(v_main_cap - coalesce(v_conf_main, 0), 0);
      v_need_us := greatest(v_us_cap - coalesce(v_conf_us, 0), 0);

      if v_need_main > 0 then
        insert into public.bookings (org_id, show_date_id, artist_id, status, is_understudy, confirmed_at)
        select p_org, v_target, a.id, 'confirmed', false, now()
        from public.artists a
        where a.org_id = p_org
          and not exists (
            select 1 from public.bookings b2
            where b2.show_date_id = v_target and b2.artist_id = a.id and b2.status <> 'cancelled'
          )
        order by a.name
        limit v_need_main;
      end if;

      if v_need_us > 0 then
        insert into public.bookings (org_id, show_date_id, artist_id, status, is_understudy, confirmed_at)
        select p_org, v_target, a.id, 'confirmed', true, now()
        from public.artists a
        where a.org_id = p_org
          and not exists (
            select 1 from public.bookings b2
            where b2.show_date_id = v_target and b2.artist_id = a.id and b2.status <> 'cancelled'
          )
        order by a.name
        limit v_need_us;
      end if;
    end if;

  else
    raise exception 'run_demo_cue: unknown cue %', p_cue using errcode = 'raise_exception';
  end if;
end;
$$;

-- Service-role-only (via the demo-ops edge function): block direct anon/authenticated
-- calls through PostgREST so the edge role gate can't be bypassed. (service_role grant
-- lives in the demo_rpc_service_role_grants migration.)
revoke all on function public.run_demo_cue(uuid, text, uuid) from public, anon, authenticated;
