-- Restore the approval decision RPC used by the admin-decide-approval edge
-- function. The generated types already include this function, but the local
-- migration set was missing its definition, which made a fresh Supabase stack
-- fail admin approvals during E2E signup flows.

CREATE OR REPLACE FUNCTION public.decide_user_approval(
  p_approval_id uuid,
  p_decision text,
  p_role text,
  p_rejection_reason text DEFAULT NULL,
  p_decided_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_decision public.approval_status;
  v_role public.app_role;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval decision: %', p_decision
      USING ERRCODE = '22023';
  END IF;

  v_decision := p_decision::public.approval_status;

  IF v_decision = 'approved' THEN
    IF p_role NOT IN ('admin', 'producer', 'artist') THEN
      RAISE EXCEPTION 'Invalid approval role: %', p_role
        USING ERRCODE = '22023';
    END IF;
    v_role := p_role::public.app_role;
  END IF;

  UPDATE public.user_approvals
  SET
    status = v_decision,
    requested_role = CASE WHEN v_decision = 'approved' THEN v_role ELSE requested_role END,
    rejection_reason = CASE WHEN v_decision = 'rejected' THEN p_rejection_reason ELSE NULL END,
    decided_by = p_decided_by,
    decided_at = now(),
    updated_at = now()
  WHERE id = p_approval_id
  RETURNING user_id INTO v_user_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Approval not found: %', p_approval_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_decision = 'approved' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, v_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    DELETE FROM public.user_roles
    WHERE user_id = v_user_id;
  END IF;
END;
$$;

-- SECURITY DEFINER functions are executable by PUBLIC by default. Keep this
-- RPC service-role-only: admin authorization lives in admin-decide-approval,
-- which invokes this function with the service-role client after checking the
-- caller is an admin.
REVOKE ALL ON FUNCTION public.decide_user_approval(uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decide_user_approval(uuid, text, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.decide_user_approval(uuid, text, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.decide_user_approval(uuid, text, text, text, uuid) TO service_role;
