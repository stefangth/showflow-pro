import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { safeAppOrigin } from "../_shared/appOrigin.ts";

type Body = { email?: string; app_origin?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    const email = body?.email?.trim().toLowerCase();
    const appOrigin = safeAppOrigin(body?.app_origin, deps);
    if (!email || !EMAIL_RE.test(email) || !appOrigin) return json({ error: "Invalid payload" }, 400);

    // Existence check FIRST via a single indexed lookup (get_user_id_by_email), NOT the
    // O(users) admin listUsers pagination. On a public endpoint this bounds the per-request
    // cost of a sprayed address to one indexed query and writes no throttle row for a non-account.
    const { data: userId, error: lookupErr } = await deps.admin.rpc("get_user_id_by_email", { p_email: email });
    if (lookupErr) {
      console.error("send-login-link get_user_id_by_email failed:", lookupErr.message);
      return json({ error: "Internal error" }, 500);
    }
    if (!userId) return json({ ok: true }); // no account: identical shape, nothing done

    const { data: allowed, error: throttleError } = await deps.admin.rpc("claim_login_link_slot", {
      p_email: email,
      p_cooldown_seconds: COOLDOWN_SECONDS,
    });
    if (throttleError) {
      console.error("send-login-link claim_login_link_slot failed:", throttleError.message);
      return json({ error: "Internal error" }, 500);
    }
    if (allowed !== true) return json({ ok: true }); // within cooldown; no second email, no leak

    const redirectTo = `${appOrigin}/auth/callback?redirect=${encodeURIComponent("/dashboard")}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) throw error;
    const actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
    await deps.sendEmail({
      template_name: "magic-link",
      recipient_email: email,
      templateData: { actionLink },
    });
    return json({ ok: true });
  } catch (e) {
    console.error("send-login-link error", (e as Error).message);
    return json({ error: "Internal error" }, 500);
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
