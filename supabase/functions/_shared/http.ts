export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  // `x-active-org` is attached by the browser Supabase client to every request
  // (the org_isolation RLS backstop — see src/integrations/supabase/activeOrg.ts).
  // It rides on functions.invoke calls too, so the preflight must allow it or the
  // browser blocks every cross-origin edge-function call.
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-active-org",
};

/** JSON response with CORS + content-type headers. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Standard CORS preflight response. */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
