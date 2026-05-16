-- shows.title was removed from the app layer and the generated Supabase
-- types; this migration aligns the local schema with the remote project so
-- inserts don't trip the NOT NULL constraint.
ALTER TABLE public.shows DROP COLUMN IF EXISTS title;
