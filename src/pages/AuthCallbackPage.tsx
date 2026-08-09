import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { safeRelativeRedirect } from "@/features/auth/resetPassword";
import { ROUTES } from "@/config/app.config";
import { StageMark } from "@/components/brand/StageMark";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** How long to wait for a session before treating the link as dead. */
const WATCHDOG_MS = 8000;

/** Read at render time, BEFORE supabase-js (detectSessionInUrl) strips the hash. */
function hashHasError(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return Boolean(hash.get("error") || hash.get("error_description"));
}

/**
 * Public landing for magic-link and invite-link redirects. Resolves the session from the
 * URL and forwards to a validated relative redirect; on an expired/used link it shows a
 * recovery card. Uses the same centered-card treatment as ResetPasswordPage / AcceptInvitePage.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Synchronous initializer: captures the GoTrue error hash before the async strip.
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
    // Watchdog only for the genuine no-signal case (no session AND no error hash arrived).
    const t = setTimeout(() => { if (!done) setFailed(true); }, WATCHDOG_MS);
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* role="status" + aria-live so the loading -> recovery transition is announced. */}
      <Card className="w-full max-w-md" role="status" aria-live="polite">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto"><StageMark variant="tile" size={52} /></div>
          <CardTitle className="font-display text-2xl font-semibold tracking-tight">
            {failed ? "This link didn't work" : "Signing you in"}
          </CardTitle>
          <CardDescription>
            {failed
              ? "It expired or was already used. Sign in to request a fresh link, or ask your admin to resend your invitation."
              : "Hold on while we finish signing you in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {failed ? (
            <Button className="w-full" autoFocus onClick={() => navigate(ROUTES.LOGIN)}>
              Back to sign in
            </Button>
          ) : (
            <div className="flex justify-center py-2" aria-hidden="true">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent motion-reduce:animate-none" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
