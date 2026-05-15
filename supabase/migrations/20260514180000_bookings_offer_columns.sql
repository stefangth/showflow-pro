-- Add offer lifecycle columns to bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS offered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_tier INT,
  ADD COLUMN IF NOT EXISTS digest_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_digest_sent_at TIMESTAMPTZ;

-- offer_tier = 99 reserved for ad-hoc producer-added casts

-- Track which offer tiers have been opened for each show date
CREATE TABLE public.show_date_offer_tiers (
  id                     UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  show_date_id           UUID NOT NULL REFERENCES public.show_dates(id) ON DELETE CASCADE,
  tier                   INT  NOT NULL CHECK (tier >= 1),
  opened_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by              UUID REFERENCES auth.users(id),
  closed_at              TIMESTAMPTZ,
  escalation_notified_at TIMESTAMPTZ,
  CONSTRAINT show_date_offer_tiers_unique UNIQUE (show_date_id, tier)
);

ALTER TABLE public.show_date_offer_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and producers can manage show_date_offer_tiers"
ON public.show_date_offer_tiers FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

CREATE POLICY "Artists can view show_date_offer_tiers"
ON public.show_date_offer_tiers FOR SELECT
TO authenticated
USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.show_date_offer_tiers;

-- Also seed offer_response_window_hours as alias for soft_book_expiry_hours
INSERT INTO public.app_settings (key, value, description) VALUES
  ('offer_response_window_hours', '48'::jsonb,
   'Hours an artist has to respond to an offer before it auto-expires (replaces soft_book_expiry_hours)')
ON CONFLICT (key) DO NOTHING;
