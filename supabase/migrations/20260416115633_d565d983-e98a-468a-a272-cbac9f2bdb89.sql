
-- ============================================
-- Showflow Pro: Complete Database Schema
-- ============================================

-- 1. Role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'producer', 'artist');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles without RLS recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Show status enum and shows table
CREATE TYPE public.show_status AS ENUM ('active', 'archived', 'draft');
CREATE TYPE public.artist_status AS ENUM ('active', 'inactive', 'on_leave');
CREATE TYPE public.availability_status AS ENUM ('available', 'unavailable', 'tentative');
CREATE TYPE public.booking_status AS ENUM ('suggested', 'soft_booked', 'confirmed', 'cancelled');
CREATE TYPE public.show_date_status AS ENUM ('open', 'partially_filled', 'fully_filled', 'cancelled');

CREATE TABLE public.shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  venue TEXT,
  category TEXT,
  status show_status NOT NULL DEFAULT 'active',
  required_skills TEXT[] DEFAULT '{}',
  slots_per_date INT NOT NULL DEFAULT 1,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view shows"
  ON public.shows FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and producers can create shows"
  ON public.shows FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

CREATE POLICY "Admins and producers can update shows"
  ON public.shows FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

CREATE POLICY "Admins can delete shows"
  ON public.shows FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4. Show dates
CREATE TABLE public.show_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id UUID REFERENCES public.shows(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  venue_override TEXT,
  status show_date_status NOT NULL DEFAULT 'open',
  notes TEXT,
  airtable_record_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_show_dates_show_id ON public.show_dates(show_id);
CREATE INDEX idx_show_dates_date ON public.show_dates(date);
CREATE INDEX idx_show_dates_airtable ON public.show_dates(airtable_record_id);

ALTER TABLE public.show_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view show_dates"
  ON public.show_dates FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins and producers can manage show_dates"
  ON public.show_dates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

CREATE POLICY "Admins and producers can update show_dates"
  ON public.show_dates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

CREATE POLICY "Admins can delete show_dates"
  ON public.show_dates FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 5. Artists
CREATE TABLE public.artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  skills TEXT[] DEFAULT '{}',
  priority_score INT NOT NULL DEFAULT 50,
  status artist_status NOT NULL DEFAULT 'active',
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_artists_user_id ON public.artists(user_id);
CREATE INDEX idx_artists_status ON public.artists(status);

ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view active artists"
  ON public.artists FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage artists"
  ON public.artists FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Artists can update own profile"
  ON public.artists FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 6. Availability
CREATE TABLE public.availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id UUID REFERENCES public.artists(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  status availability_status NOT NULL DEFAULT 'available',
  recurrence_rule TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(artist_id, date)
);

CREATE INDEX idx_availability_artist ON public.availability(artist_id);
CREATE INDEX idx_availability_date ON public.availability(date);

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Artists can manage own availability"
  ON public.availability FOR ALL TO authenticated
  USING (artist_id IN (SELECT id FROM public.artists WHERE user_id = auth.uid()));

CREATE POLICY "Admins and producers can view all availability"
  ON public.availability FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

-- 7. Bookings
CREATE TABLE public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_date_id UUID REFERENCES public.show_dates(id) ON DELETE CASCADE NOT NULL,
  artist_id UUID REFERENCES public.artists(id) ON DELETE CASCADE NOT NULL,
  status booking_status NOT NULL DEFAULT 'suggested',
  is_understudy BOOLEAN NOT NULL DEFAULT false,
  booked_by UUID REFERENCES auth.users(id),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_show_date ON public.bookings(show_date_id);
CREATE INDEX idx_bookings_artist ON public.bookings(artist_id);
CREATE INDEX idx_bookings_status ON public.bookings(status);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and producers can manage bookings"
  ON public.bookings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'producer'));

CREATE POLICY "Artists can view own bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (artist_id IN (SELECT id FROM public.artists WHERE user_id = auth.uid()));

-- 8. Booking audit log
CREATE TABLE public.booking_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_status booking_status,
  new_status booking_status,
  performed_by UUID REFERENCES auth.users(id),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_booking ON public.booking_audit_log(booking_id);
CREATE INDEX idx_audit_performed_by ON public.booking_audit_log(performed_by);

ALTER TABLE public.booking_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all audit logs"
  ON public.booking_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Producers can view audit logs"
  ON public.booking_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'producer'));

CREATE POLICY "System can insert audit logs"
  ON public.booking_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- 9. Airtable sync log
CREATE TABLE public.airtable_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  records_processed INT DEFAULT 0,
  error_details TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.airtable_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view sync logs"
  ON public.airtable_sync_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert sync logs"
  ON public.airtable_sync_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- 10. Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  related_entity_type TEXT,
  related_entity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON public.notifications(user_id);
CREATE INDEX idx_notifications_read ON public.notifications(user_id, read);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

-- 11. Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Apply updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_shows_updated_at BEFORE UPDATE ON public.shows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_show_dates_updated_at BEFORE UPDATE ON public.show_dates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_artists_updated_at BEFORE UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_availability_updated_at BEFORE UPDATE ON public.availability FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
