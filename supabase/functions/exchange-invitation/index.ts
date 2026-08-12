import { json, preflight } from "../_shared/http.ts";
import { realDeps } from "../_shared/deps.ts";
import { mintInvitationActionLink } from "../_shared/invitations.ts";

const COOLDOWN_SECONDS = 60;

type ClaimResult = { data: unknown; error: unknown };

export interface ExchangeInvitationDeps {
  claimInvitation: (token: string, cooldownSeconds: number) => Promise<ClaimResult>;
  mintActionLink: (args: { email: string; appOrigin: string }) => Promise<string>;
  releaseClaim: (token: string, claimedAt: string) => Promise<void>;
  logError: (...values: unknown[]) => void;
}

type Body = { token?: unknown; app_origin?: unknown };
type Claim = { status?: unknown; email?: unknown; claimed_at?: unknown; retry_after_seconds?: unknown };

async function releaseFailedClaim(
  deps: ExchangeInvitationDeps,
  token: string,
  claimedAt: string,
): Promise<void> {
  try {
    await deps.releaseClaim(token, claimedAt);
  } catch {
    deps.logError("exchange-invitation: failed claim could not be released");
  }
}

export async function handler(req: Request, deps: ExchangeInvitationDeps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") {
    const response = json({ error: "Method not allowed" }, 405);
    response.headers.set("Allow", "POST, OPTIONS");
    return response;
  }

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
    if (
      claim?.status !== "ok" || typeof claim.email !== "string" || !claim.email.trim() ||
      typeof claim.claimed_at !== "string" || !claim.claimed_at
    ) {
      deps.logError("exchange-invitation: invalid claim result");
      return json({ error: "Internal error" }, 500);
    }

    let actionUrl: string;
    try {
      actionUrl = await deps.mintActionLink({ email: claim.email, appOrigin });
    } catch {
      await releaseFailedClaim(deps, token, claim.claimed_at);
      deps.logError("exchange-invitation: action link mint failed");
      return json({ error: "Internal error" }, 500);
    }
    if (!actionUrl) {
      await releaseFailedClaim(deps, token, claim.claimed_at);
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
    releaseClaim: async (token, claimedAt) => {
      const { error } = await deps.admin
        .from("org_invitations")
        .update({ last_auth_exchange_at: null })
        .eq("token", token)
        .eq("last_auth_exchange_at", claimedAt);
      if (error) throw error;
    },
    logError: (...values) => console.error(...values),
  };
}

if (import.meta.main) Deno.serve((req) => handler(req, productionDeps()));
