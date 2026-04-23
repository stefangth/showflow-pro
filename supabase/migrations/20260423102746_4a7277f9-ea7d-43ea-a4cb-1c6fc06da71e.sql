-- 1. Approval status enum
CREATE TYPE public.approval_status AS ENUM ('pending', 'approved', 'rejected');

-- 2. user_approvals table
CREATE TABLE public.user_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text,
  status public.approval_status NOT NULL DEFAULT 'pending',
  requested_role public.app_role NOT NULL DEFAULT 'artist',
  decided_by uuid,
  decided_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_approvals ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX idx_user_approvals_status ON public.user_approvals(status);
CREATE INDEX idx_user_approvals_user_id ON public.user_approvals(user_id);

-- RLS policies
CREATE POLICY "Users can view own approval"
  ON public.user_approvals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view all approvals"
  ON public.user_approvals FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update approvals"
  ON public.user_approvals FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No INSERT/DELETE policies — handled by trigger (SECURITY DEFINER) and admin via service role only.

-- updated_at trigger
CREATE TRIGGER update_user_approvals_updated_at
  BEFORE UPDATE ON public.user_approvals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Replace handle_new_user to also create an approval row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Create profile (existing behavior)
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));

  -- Create pending approval (new)
  INSERT INTO public.user_approvals (user_id, email, display_name, status, requested_role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    'pending'::approval_status,
    'artist'::app_role
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Make sure the trigger is wired (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Bootstrap: auto-approve all existing auth users so logins keep working
INSERT INTO public.user_approvals (user_id, email, display_name, status, requested_role, decided_at)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', u.email),
  'approved'::approval_status,
  COALESCE(
    (SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = u.id LIMIT 1),
    'artist'::app_role
  ),
  now()
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

-- 5. Realtime support
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_approvals;