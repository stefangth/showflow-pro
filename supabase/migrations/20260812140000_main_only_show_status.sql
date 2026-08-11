-- Main-only shows reach fully_filled.
--
-- The slot model (show_slots) makes understudy counts OPTIONAL: a production can have a
-- main slot and no understudy slot, so its derived shows.understudy_slots is NULL while
-- main_cast_slots is set. The frontend (showSlots, setupStatus) already treats such a
-- main-only show as configured with 0 understudies.
--
-- compute_show_date_status was the lone holdout: it gated fully_filled on BOTH caps being
-- non-NULL (`v_main_cap is null or v_us_cap is null`), so a main-only date could never
-- reach fully_filled even with every main slot confirmed -- it stayed partially_filled
-- forever and never auto-drafted a hire order. Its sibling auto_cancel_on_slot_fill already
-- COALESCEs a NULL understudy cap to 0 (20260616203749); this aligns the status recompute
-- with that rule.
--
-- New rule: unconfigured is now ONLY a NULL main cap. A NULL understudy cap counts as 0, so
-- fully_filled needs confirmed main >= main cap AND confirmed understudies >= coalesce(us,0).
-- Blast radius is exactly main-only shows: shows with both caps configured are unchanged
-- (the coalesce is a no-op), and shows with a NULL main cap stay unconfigured as before.

create or replace function public.compute_show_date_status(p_show_date_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current   show_date_status;
  v_main_cap  int;
  v_us_cap    int;
  v_conf_main int;
  v_conf_us   int;
  v_active    int;
  v_new       show_date_status;
begin
  select sd.status, s.main_cast_slots, s.understudy_slots
    into v_current, v_main_cap, v_us_cap
  from show_dates sd join shows s on s.id = sd.show_id
  where sd.id = p_show_date_id;

  if not found or v_current = 'cancelled' then
    return;
  end if;

  select
    count(*) filter (where status = 'confirmed' and not is_understudy),
    count(*) filter (where status = 'confirmed' and is_understudy),
    count(*) filter (where status <> 'cancelled')
  into v_conf_main, v_conf_us, v_active
  from bookings where show_date_id = p_show_date_id;

  -- Unconfigured = no main slot. A NULL understudy cap is a configured main-only show
  -- (0 understudies required), so it can still reach fully_filled.
  if v_main_cap is null then
    v_new := case when v_active > 0 then 'partially_filled' else 'open' end;
  elsif v_conf_main >= v_main_cap and v_conf_us >= coalesce(v_us_cap, 0) then
    v_new := 'fully_filled';
  elsif v_active > 0 then
    v_new := 'partially_filled';
  else
    v_new := 'open';
  end if;

  update show_dates set status = v_new where id = p_show_date_id;
end;
$function$;
