import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Request a branded, one-time sign-in link. Existence-hiding: resolves for any input;
 *  the edge function no-ops (still 200) when no account matches. Throws only on transport error. */
export async function requestLoginLink(
  client: SupabaseClient<Database>,
  email: string,
  appOrigin: string,
): Promise<void> {
  const { error } = await client.functions.invoke("send-login-link", {
    body: { email, app_origin: appOrigin },
  });
  if (error) throw error;
}
