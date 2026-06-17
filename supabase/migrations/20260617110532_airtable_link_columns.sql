-- Catalog-link columns: connect an Airtable controlled-option value to a Showflow
-- catalog row. Grain-agnostic opaque text — the value the admin's 2b-UI field
-- mapping produces (a single sub-program option, or a Program+Sub-Programm
-- composite). Unique per org (partial, since most rows stay unlinked); free across
-- orgs. The poll (Phase 3) resolves records against these links.
ALTER TABLE public.shows  ADD COLUMN airtable_program_key text;
ALTER TABLE public.cities ADD COLUMN airtable_city_key text;

CREATE UNIQUE INDEX shows_airtable_program_key_org_uniq
  ON public.shows (org_id, airtable_program_key)
  WHERE airtable_program_key IS NOT NULL;

CREATE UNIQUE INDEX cities_airtable_city_key_org_uniq
  ON public.cities (org_id, airtable_city_key)
  WHERE airtable_city_key IS NOT NULL;
