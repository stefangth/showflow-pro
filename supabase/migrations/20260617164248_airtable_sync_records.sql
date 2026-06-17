-- Phase 3: observable sync. Extend the summary log with counts + details, and add a
-- per-record child table so every Airtable record's outcome (imported/updated/held/error)
-- is auditable and surfaced in the Settings "Last sync report".

-- ── Summary log: count + details columns (additive, nullable) ────────────────
ALTER TABLE public.airtable_sync_log
  ADD COLUMN IF NOT EXISTS imported_count int,
  ADD COLUMN IF NOT EXISTS new_count int,
  ADD COLUMN IF NOT EXISTS updated_count int,
  ADD COLUMN IF NOT EXISTS held_count int,
  ADD COLUMN IF NOT EXISTS details jsonb;

-- ── Per-record history ───────────────────────────────────────────────────────
CREATE TABLE public.airtable_sync_record_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id uuid NOT NULL REFERENCES public.airtable_sync_log(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  airtable_record_id text,
  action text NOT NULL CHECK (action IN ('imported_new','updated','held_unresolved','error')),
  show_date_id uuid REFERENCES public.show_dates(id) ON DELETE SET NULL,
  reason text,
  raw_fields jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_airtable_sync_record_log_sync_log ON public.airtable_sync_record_log (sync_log_id);
CREATE INDEX idx_airtable_sync_record_log_org_created ON public.airtable_sync_record_log (org_id, created_at);
CREATE INDEX idx_airtable_sync_record_log_org_record ON public.airtable_sync_record_log (org_id, airtable_record_id);

-- org_id derived from the parent summary row (mirrors 20260604130000_org_id_derivation_triggers.sql).
CREATE OR REPLACE FUNCTION public.derive_org_id_from_sync_log_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT org_id INTO NEW.org_id FROM public.airtable_sync_log WHERE id = NEW.sync_log_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_derive_org_id ON public.airtable_sync_record_log;
CREATE TRIGGER trg_derive_org_id BEFORE INSERT ON public.airtable_sync_record_log
  FOR EACH ROW EXECUTE FUNCTION public.derive_org_id_from_sync_log_id();

-- RLS: org isolation (restrictive) + admin read + system insert (mirrors airtable_sync_log).
ALTER TABLE public.airtable_sync_record_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON public.airtable_sync_record_log AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_org_member(auth.uid(), org_id))
  WITH CHECK (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "Admins can view sync record logs" ON public.airtable_sync_record_log FOR SELECT TO authenticated
  USING (public.has_org_role(auth.uid(), org_id, 'admin'));

CREATE POLICY "System can insert sync record logs" ON public.airtable_sync_record_log FOR INSERT TO authenticated
  WITH CHECK (true);
