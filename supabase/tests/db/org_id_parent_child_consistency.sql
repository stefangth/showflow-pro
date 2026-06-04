-- supabase/tests/db/org_id_parent_child_consistency.sql
-- Structural invariant: no child row's org_id diverges from its parent's. With the
-- Part-2 derive triggers and the Part-9 DEFAULT drop, this must hold for all data.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

SELECT is((SELECT count(*) FROM public.show_dates sd JOIN public.shows s ON s.id = sd.show_id WHERE sd.org_id <> s.org_id), 0::bigint, 'show_dates.org_id matches shows');
SELECT is((SELECT count(*) FROM public.bookings b JOIN public.show_dates sd ON sd.id = b.show_date_id WHERE b.org_id <> sd.org_id), 0::bigint, 'bookings.org_id matches show_dates');
SELECT is((SELECT count(*) FROM public.show_date_offer_tiers t JOIN public.show_dates sd ON sd.id = t.show_date_id WHERE t.org_id <> sd.org_id), 0::bigint, 'tiers.org_id matches show_dates');
SELECT is((SELECT count(*) FROM public.cast_members cm JOIN public.casts c ON c.id = cm.cast_id WHERE cm.org_id <> c.org_id), 0::bigint, 'cast_members.org_id matches casts');
SELECT is((SELECT count(*) FROM public.artist_skills a JOIN public.artists ar ON ar.id = a.artist_id WHERE a.org_id <> ar.org_id), 0::bigint, 'artist_skills.org_id matches artists');
SELECT is((SELECT count(*) FROM public.chat_messages m JOIN public.chats ch ON ch.id = m.chat_id WHERE m.org_id <> ch.org_id), 0::bigint, 'chat_messages.org_id matches chats');

SELECT * FROM finish();
ROLLBACK;
