-- Phase 1b (DB): slot capacity moves from app_settings.sub_program_slots_defaults
-- (JSON keyed by program/sub_program) onto typed columns on `shows`.
-- compute_show_date_status reads the columns; the app_settings recompute trigger is
-- retired; the shows recompute trigger also fires on slot-column edits.

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS main_cast_slots  smallint CHECK (main_cast_slots  IS NULL OR main_cast_slots  >= 0),
  ADD COLUMN IF NOT EXISTS understudy_slots smallint CHECK (understudy_slots IS NULL OR understudy_slots >= 0);

UPDATE public.shows s SET
  main_cast_slots  = nullif(public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program ->> 'main_cast',  '')::smallint,
  understudy_slots = nullif(public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program ->> 'understudies','')::smallint
WHERE s.program IS NOT NULL AND s.sub_program IS NOT NULL
  AND public.get_org_setting(s.org_id, 'sub_program_slots_defaults') -> s.program -> s.sub_program IS NOT NULL;

CREATE OR REPLACE FUNCTION public.compute_show_date_status(p_show_date_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  if v_main_cap is null or v_us_cap is null then
    v_new := case when v_active > 0 then 'partially_filled' else 'open' end;
  elsif v_conf_main >= v_main_cap and v_conf_us >= v_us_cap then
    v_new := 'fully_filled';
  elsif v_active > 0 then
    v_new := 'partially_filled';
  else
    v_new := 'open';
  end if;

  update show_dates set status = v_new where id = p_show_date_id;
end;
$function$;

DROP TRIGGER IF EXISTS sync_show_dates_on_show_update_trigger ON public.shows;
CREATE TRIGGER sync_show_dates_on_show_update_trigger
  AFTER UPDATE OF program, sub_program, main_cast_slots, understudy_slots ON public.shows
  FOR EACH ROW EXECUTE FUNCTION public.sync_show_dates_on_show_update();

DROP TRIGGER IF EXISTS sync_show_dates_on_settings_update_trigger ON public.app_settings;
DROP FUNCTION IF EXISTS public.sync_show_dates_on_settings_update();
