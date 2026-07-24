-- The legacy terms_variant guard predates PR #193's dynamic terms templates.
-- terms_variant now holds an arbitrary template id (crypto.randomUUID() minted by
-- TermsVariantsCard), and resolveTermsClauses tolerates stale/unknown ids by
-- falling back to the org's default template. The fixed CHECK (terms_variant IN
-- ('lean','standard','full')) therefore rejected every hire-order INSERT for any
-- org that authored a custom template (Postgres 23514) -- the root cause of
-- "cannot create hire orders" after #193. The multi-date draft-batch path masked
-- it as "aggregate_insert_failed". Drop the guard; NOT NULL + the app-level
-- default remain, and clause resolution already handles any id value gracefully.
alter table public.hire_orders
  drop constraint if exists hire_orders_terms_variant_check;
