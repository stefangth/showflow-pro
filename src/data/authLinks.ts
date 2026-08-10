import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Request a branded, one-time sign-in link. Existence-hiding: resolves for any input;
 *  the edge function no-ops (still 200) when no account matches. Throws only on transport error.
 *  `redirectPath`, when a safe in-app relative path, is where the link lands after sign-in
 *  (e.g. the accept-invite bounce) — the edge function re-clamps it, defaulting to /dashboard. */
export async function requestLoginLink(
  client: SupabaseClient<Database>,
  email: string,
  appOrigin: string,
  redirectPath?: string | null,
): Promise<void> {
  const { error } = await client.functions.invoke("send-login-link", {
    body: { email, app_origin: appOrigin, ...(redirectPath ? { redirect_path: redirectPath } : {}) },
  });
  if (error) throw error;
}
