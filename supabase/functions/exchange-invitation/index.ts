import { json, preflight } from "../_shared/http.ts";
import { realDeps } from "../_shared/deps.ts";
import { mintInvitationActionLink } from "../_shared/invitations.ts";

const COOLDOWN_SECONDS = 60;

type ClaimResult = { data: unknown; error: unknown };

export interface ExchangeInvitationDeps {
  claimInvitation: (token: string, cooldownSeconds: number) => Promise<ClaimResult>;
  mintActionLink: (args: { email: string; appOrigin: string }) => Promise<string>;
  logError: (...values: unknown[]) => void;
}

type Body = { token?: unknown; app_origin?: unknown };
type Claim = { status?: unknown; email?: unknown; retry_after_seconds?: unknown };

export async function handler(req: Request, deps: ExchangeInvitationDeps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  try {
    const body = await req.json().catch(() => null) as Body | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const appOrigin = typeof body?.app_origin === "string" ? body.app_origin.trim() : "";
    if (!token || !appOrigin) return json({ error: "Invalid payload" }, 400);

    const { data, error } = await deps.claimInvitation(token, COOLDOWN_SECONDS);
    if (error) {
      deps.logError("exchange-invitation: claim failed");
      return json({ error: "Internal error" }, 500);
    }

    const claim = data as Claim | null;
    if (claim?.status === "unavailable") {
      return json({ error: "Invitation unavailable" }, 410);
    }
    if (claim?.status === "throttled") {
      const rawRetry = typeof claim.retry_after_seconds === "number" ? claim.retry_after_seconds : 1;
      const retryAfterSeconds = Math.max(1, Math.ceil(rawRetry));
      const response = json({
        error: "Please wait before trying again",
        retry_after_seconds: retryAfterSeconds,
      }, 429);
      response.headers.set("Retry-After", String(retryAfterSeconds));
      return response;
    }
    if (claim?.status !== "ok" || typeof claim.email !== "string" || !claim.email.trim()) {
      deps.logError("exchange-invitation: invalid claim result");
      return json({ error: "Internal error" }, 500);
    }

    const actionUrl = await deps.mintActionLink({ email: claim.email, appOrigin });
    if (!actionUrl) {
      deps.logError("exchange-invitation: action link mint failed");
      return json({ error: "Internal error" }, 500);
    }
    return json({ action_url: actionUrl });
  } catch {
    deps.logError("exchange-invitation: unexpected failure");
    return json({ error: "Internal error" }, 500);
  }
}

function productionDeps(): ExchangeInvitationDeps {
  const deps = realDeps();
  return {
    claimInvitation: async (token, cooldownSeconds) =>
      await deps.admin.rpc("claim_invitation_auth_exchange", {
        p_token: token,
        p_cooldown_seconds: cooldownSeconds,
      }),
    mintActionLink: (args) => mintInvitationActionLink(deps, args),
    logError: (...values) => console.error(...values),
  };
}

if (import.meta.main) Deno.serve((req) => handler(req, productionDeps()));
