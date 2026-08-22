import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import { safeAppOrigin } from "../_shared/appOrigin.ts";

type Body = { email?: string; app_origin?: string; redirect_path?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_SECONDS = 60;

/** Backslash, plus every C0 control and DEL: the characters the URL parser folds or strips.
 *  Mirrors UNSAFE_REDIRECT_CHARS in src/features/auth/resetPassword.ts. */
// eslint-disable-next-line no-control-regex -- matching control characters is the entire point
const UNSAFE_REDIRECT_CHARS = /[\\\u0000-\u001F\u007F]/;

/** Clamp the caller-supplied post-login destination to a safe in-app relative path;
 *  anything absolute / protocol-relative / missing falls back to /today, as does
 *  anything the URL parser would rewrite before the `//` check can mean anything: `\` is
 *  folded into `/`, and tab/LF/CR are removed outright, so both `/\evil.example` and
 *  `/<TAB>/evil.example` escape the origin. Mirrors safeRelativeRedirect in
 *  src/features/auth/resetPassword.ts (AuthCallbackPage re-clamps this same value before
 *  navigating, so this is defense-in-depth, not the only guard). */
function safeRedirectPath(p: string | undefined): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || UNSAFE_REDIRECT_CHARS.test(p)) return "/today";
  return p;
}

// Note on the no-enumeration guarantee: it holds at the RESPONSE-SHAPE level — every branch
// below returns an identical `200 {ok:true}` (or an identical generic 500) whether or not the
// address has an account. Wall-clock timing does differ (a non-account returns after one indexed
// lookup; a real account additionally claims a slot, mints a link and sends mail), and that is a
// deliberately accepted residual: the endpoint is per-email throttled, the account set (org
// invitees/members) is low-sensitivity, and a constant-time floor would tax every genuine login
// with only imperfect protection. Revisit with a timing floor if the threat model tightens.
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

    const redirectTo = `${appOrigin}/auth/callback?redirect=${encodeURIComponent(safeRedirectPath(body?.redirect_path))}`;
    const { data, error } = await deps.admin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) throw error;
    const actionLink = (data as { properties?: { action_link?: string } })?.properties?.action_link;
    if (!actionLink) {
      // generateLink resolved without a usable link: treat as a fault rather than ship an
      // email whose only CTA has an empty href.
      console.error("send-login-link: generateLink returned no action_link");
      return json({ error: "Internal error" }, 500);
    }
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
