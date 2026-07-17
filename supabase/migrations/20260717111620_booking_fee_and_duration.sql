alter table public.bookings   add column if not exists fee_amount numeric(10,2) check (fee_amount is null or fee_amount >= 0);
alter table public.show_dates add column if not exists duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440);
