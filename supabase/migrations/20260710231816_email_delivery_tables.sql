-- email_send_log: one row per transactional email (a state machine).
-- send-transactional-email inserts 'pending' then updates; handle-email-suppression
-- updates by resend_id as Resend delivery events arrive.
CREATE TABLE public.email_send_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     uuid NOT NULL UNIQUE,
  resend_id      text UNIQUE,
  org_id         uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  template_name  text NOT NULL,
  recipient_email text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','delivered','delivery_delayed',
                                     'bounced','complained','failed','suppressed','pref_disabled')),
  error_message  text,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  delivered_at   timestamptz,
  delayed_at     timestamptz,
  bounced_at     timestamptz,
  complained_at  timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_send_log_created_idx  ON public.email_send_log (created_at DESC);
CREATE INDEX email_send_log_status_idx   ON public.email_send_log (status);
CREATE INDEX email_send_log_template_idx ON public.email_send_log (template_name);
CREATE INDEX email_send_log_org_idx      ON public.email_send_log (org_id);
CREATE TRIGGER email_send_log_updated_at
  BEFORE UPDATE ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- suppressed_emails: bounce/complaint suppression list. Creating this un-breaks the
-- fail-closed suppression check in send-transactional-email.
CREATE TABLE public.suppressed_emails (
  email      text PRIMARY KEY,
  reason     text NOT NULL DEFAULT 'manual' CHECK (reason IN ('bounce','complaint','manual')),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- email_unsubscribe_tokens: one-click List-Unsubscribe tokens.
CREATE TABLE public.email_unsubscribe_tokens (
  token      text PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- email_health_state: single global row for alert de-dupe (twin of cron_health_state).
CREATE TABLE public.email_health_state (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_state    text NOT NULL DEFAULT 'operational'
                  CHECK (last_state IN ('operational','pending','degraded','down','stale')),
  last_alerted_at timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.email_health_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.email_send_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppressed_emails       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_health_state      ENABLE ROW LEVEL SECURITY;

-- Super-admin reads only; writes come from service role / pg_cron (bypass RLS). No WITH CHECK(true).
CREATE POLICY "super-admin reads email_send_log"    ON public.email_send_log    FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads suppressed_emails" ON public.suppressed_emails FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "super-admin reads email_health_state" ON public.email_health_state FOR SELECT USING (is_super_admin(auth.uid()));
-- email_unsubscribe_tokens: no authenticated access at all (service-role-only unsubscribe handler).

INSERT INTO public.app_settings (org_id, key, value, description) VALUES
  (NULL, 'email_log_retention_days', '90'::jsonb, 'Days to retain email_send_log rows before the daily prune')
ON CONFLICT (org_id, key) DO NOTHING;
