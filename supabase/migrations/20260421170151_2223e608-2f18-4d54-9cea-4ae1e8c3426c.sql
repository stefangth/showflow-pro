-- 1. Cities table (mock; will be replaced by Airtable sync)
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  airtable_record_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view cities"
  ON public.cities FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and producers can insert cities"
  ON public.cities FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins and producers can update cities"
  ON public.cities FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins can delete cities"
  ON public.cities FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.cities (name) VALUES
  ('Berlin'), ('London'), ('Paris'), ('New York'), ('Madrid');

-- 2. Casts
CREATE TABLE public.casts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.casts ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_casts_updated_at
  BEFORE UPDATE ON public.casts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Authenticated can view casts"
  ON public.casts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and producers can insert casts"
  ON public.casts FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins and producers can update casts"
  ON public.casts FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins can delete casts"
  ON public.casts FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3. Cast members
CREATE TABLE public.cast_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cast_id uuid NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cast_id, artist_id)
);
ALTER TABLE public.cast_members ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cast_members_cast ON public.cast_members(cast_id);
CREATE INDEX idx_cast_members_artist ON public.cast_members(artist_id);

CREATE POLICY "Authenticated can view cast members"
  ON public.cast_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and producers can insert cast members"
  ON public.cast_members FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins and producers can delete cast members"
  ON public.cast_members FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));

-- 4. Show + city → eligible casts
CREATE TABLE public.show_cast_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  cast_id uuid NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_id, city_id, cast_id)
);
ALTER TABLE public.show_cast_eligibility ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sce_show_city ON public.show_cast_eligibility(show_id, city_id);

CREATE POLICY "Authenticated can view show cast eligibility"
  ON public.show_cast_eligibility FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and producers can insert show cast eligibility"
  ON public.show_cast_eligibility FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins and producers can delete show cast eligibility"
  ON public.show_cast_eligibility FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));

-- 5. Per-date overrides
CREATE TABLE public.show_date_cast_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_date_id uuid NOT NULL REFERENCES public.show_dates(id) ON DELETE CASCADE,
  cast_id uuid NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_date_id, cast_id)
);
ALTER TABLE public.show_date_cast_eligibility ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_sdce_show_date ON public.show_date_cast_eligibility(show_date_id);

CREATE POLICY "Authenticated can view show date cast eligibility"
  ON public.show_date_cast_eligibility FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and producers can insert show date cast eligibility"
  ON public.show_date_cast_eligibility FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Admins and producers can delete show date cast eligibility"
  ON public.show_date_cast_eligibility FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));

-- 6. Schema additions
ALTER TABLE public.artists ADD COLUMN cast_role text;
ALTER TABLE public.show_dates ADD COLUMN city_id uuid REFERENCES public.cities(id) ON DELETE SET NULL;

-- 7. Chats
CREATE TABLE public.chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_date_id uuid NOT NULL UNIQUE REFERENCES public.show_dates(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_chat_messages_chat ON public.chat_messages(chat_id, created_at);

-- 8. Participant helper (security definer to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_chat_participant(_chat_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    has_role(_user_id, 'admin'::app_role)
    OR has_role(_user_id, 'producer'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.chats c
      JOIN public.bookings b ON b.show_date_id = c.show_date_id
      JOIN public.artists a ON a.id = b.artist_id
      WHERE c.id = _chat_id
        AND a.user_id = _user_id
        AND b.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status)
    )
$$;

-- Chats RLS
CREATE POLICY "Participants can view chats"
  ON public.chats FOR SELECT TO authenticated
  USING (public.is_chat_participant(id, auth.uid()));
CREATE POLICY "Admins and producers can insert chats"
  ON public.chats FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'producer'::app_role));
CREATE POLICY "Artists who are booked can insert chats"
  ON public.chats FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bookings b
      JOIN public.artists a ON a.id = b.artist_id
      WHERE b.show_date_id = chats.show_date_id
        AND a.user_id = auth.uid()
        AND b.status IN ('soft_booked'::booking_status, 'confirmed'::booking_status)
    )
  );
CREATE POLICY "Admins can delete chats"
  ON public.chats FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Chat messages RLS
CREATE POLICY "Participants can view messages"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_chat_participant(chat_id, auth.uid()));
CREATE POLICY "Participants can post messages"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_chat_participant(chat_id, auth.uid())
  );

-- 9. Realtime publication for chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;