-- Retire the signup→approval flow in favor of invite-only onboarding
-- (org_memberships + accept_invitation). Greenfield — no approval data to preserve.
--
--   - handle_new_user becomes profile-only (no approval row, no notify-signup POST).
--   - decide_user_approval RPC, user_approvals table, and approval_status enum dropped.
--
-- Access is now membership: a user with no org_membership has no access until invited.
-- The admin-decide-approval / notify-signup edge functions are removed in the same change.

-- 1. handle_new_user: create the profile only.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

-- 2. Drop the approval-decision RPC (depended on user_approvals + user_roles).
DROP FUNCTION IF EXISTS public.decide_user_approval(uuid, text, text, text, uuid);

-- 3. Drop the approval queue. DROP TABLE also removes its policies, indexes, the
--    updated_at trigger, and its realtime-publication membership.
DROP TABLE IF EXISTS public.user_approvals;

-- 4. Drop the now-unused enum.
DROP TYPE IF EXISTS public.approval_status;
