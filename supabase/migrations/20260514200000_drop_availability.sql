-- Drop the availability table. The offer engine (bookings.status = 'suggested')
-- now covers offered dates; blocked_dates covers conflict windows.
DROP TABLE IF EXISTS public.availability CASCADE;
