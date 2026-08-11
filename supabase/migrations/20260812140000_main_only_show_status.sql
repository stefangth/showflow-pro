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
-- New rule: unconfigured is a NULL main cap, OR both caps effectively zero
-- (coalesce(main,0)=0 AND coalesce(us,0)=0) -- nothing to fill, so the date must never
-- read fully_filled and auto-draft an empty hire order. This matches auto_cancel_on_slot_fill
-- exactly (it treats coalesce(main,0)=0 AND coalesce(us,0)=0 as unconfigured). fully_filled
-- then needs confirmed main >= coalesce(main,0) AND confirmed understudies >= coalesce(us,0).
--
-- Consequences of the "both zero" form (vs a bare main<=0):
--   - main-only (main=N, us NULL): configured, fills once main confirmed -- the goal here.
--   - explicit main=0 with us=N>0 (a count-0 Main slot beside a positive Understudy slot,
--     which the show_slots CHECK slot_count>=0 permits): configured, fills once its N
--     understudies confirm. A bare main<=0 test would wrongly strand this combination as
--     never-fully_filled while auto_cancel_on_slot_fill kept capping its understudies --
--     an incoherent split. "Both zero" keeps the two functions consistent.
--   - main=0 AND us=0 (or NULL): unconfigured, never fully_filled (closes the empty-draft path).
--   - NULL main cap: unconfigured, as before (the frontend showSlots() treats a NULL main as
--     not-yet-configured, so an understudy-only show without a main slot stays incomplete).

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

  -- Unconfigured = no main slot (NULL main cap), OR both caps effectively zero
  -- (coalesce(main,0)=0 AND coalesce(us,0)=0) -- nothing to fill, so the date must never
  -- read fully_filled and auto-draft an empty hire order. This mirrors
  -- auto_cancel_on_slot_fill, keeping the two functions consistent for the main=0/us=N case.
  -- A configured main-only show (positive main, NULL/0 understudy) still reaches fully_filled.
  if v_main_cap is null or (coalesce(v_main_cap, 0) <= 0 and coalesce(v_us_cap, 0) <= 0) then
    v_new := case when v_active > 0 then 'partially_filled' else 'open' end;
  elsif v_conf_main >= coalesce(v_main_cap, 0) and v_conf_us >= coalesce(v_us_cap, 0) then
    v_new := 'fully_filled';
  elsif v_active > 0 then
    v_new := 'partially_filled';
  else
    v_new := 'open';
  end if;

  update show_dates set status = v_new where id = p_show_date_id;
end;
$function$;
