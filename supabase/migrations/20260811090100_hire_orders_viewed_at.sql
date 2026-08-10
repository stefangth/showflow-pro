alter table public.hire_orders add column if not exists viewed_at timestamptz;
create or replace function public.mark_hire_order_seen(p_order uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.hire_orders ho
    join public.artists a on a.id = ho.artist_id
    where ho.id = p_order and a.user_id = auth.uid()
      and ho.status in ('issued','countersigned')
  ) into v_ok;
  if not v_ok then
    raise exception 'Forbidden: not the linked artist for a viewable order' using errcode = '42501';
  end if;
  update public.hire_orders set viewed_at = now() where id = p_order and viewed_at is null;
end; $$;
revoke all on function public.mark_hire_order_seen(uuid) from public, anon;
grant execute on function public.mark_hire_order_seen(uuid) to authenticated;
