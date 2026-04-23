-- Ensure pg_net is available for outbound HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Replace handle_new_user to also POST to the notify-signup edge function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  approval_id uuid;
  function_url text := 'https://epweartpzwvcasrzyueh.supabase.co/functions/v1/notify-signup';
BEGIN
  -- Create profile (existing behavior)
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));

  -- Create pending approval
  INSERT INTO public.user_approvals (user_id, email, display_name, status, requested_role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    'pending'::approval_status,
    'artist'::app_role
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING id INTO approval_id;

  -- Notify admins asynchronously via the edge function (best effort)
  IF approval_id IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := function_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'record', jsonb_build_object(
            'id', approval_id,
            'user_id', NEW.id,
            'email', NEW.email,
            'display_name', COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
            'requested_role', 'artist',
            'status', 'pending'
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never block signup if the notification call fails
      RAISE LOG 'notify-signup http_post failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;