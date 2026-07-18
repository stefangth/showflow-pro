-- Follow-up (item D): the documenso-webhook edge function looks up hire
-- orders by `.eq('documenso_envelope_id', ...)` (supabase/functions/
-- documenso-webhook/index.ts) but that column was a plain unindexed text
-- column -- every countersign-completion webhook delivery forced a full
-- table scan of public.hire_orders. Partial index (most rows never carry an
-- envelope id -- only orders issued in Documenso countersign mode do).
create index if not exists hire_orders_documenso_envelope_idx on public.hire_orders (documenso_envelope_id) where documenso_envelope_id is not null;
