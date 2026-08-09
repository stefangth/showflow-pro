import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { safeRelativeRedirect } from "@/features/auth/resetPassword";
import { ROUTES } from "@/config/app.config";
import { StageMark } from "@/components/brand/StageMark";

/** Read at render time, BEFORE supabase-js (detectSessionInUrl) strips the hash. */
function hashHasError(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return Boolean(hash.get("error") || hash.get("error_description"));
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [failed, setFailed] = useState<boolean>(() => hashHasError());

  useEffect(() => {
    if (failed) return; // error hash already detected at render; no session wiring needed.

    const target = safeRelativeRedirect(searchParams.get("redirect"), ROUTES.DASHBOARD);
    let done = false;
    const go = () => { if (!done) { done = true; navigate(target, { replace: true }); } };

    supabase.auth.getSession().then(({ data }) => { if (data.session) go(); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) go();
    });
    const t = setTimeout(() => { if (!done) setFailed(true); }, 8000);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md text-center space-y-4">
        <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
        {failed ? (
          <>
            <p className="text-sm text-muted-foreground">That link has expired. Request a new sign-in link.</p>
            <Link to={ROUTES.LOGIN} className="text-sm font-medium underline-offset-2 hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">Signing you in...</p>
          </div>
        )}
      </div>
    </div>
  );
}
