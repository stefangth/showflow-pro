import { preflight, json } from "../_shared/http.ts";
import { isServiceRole, requireRole } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

/**
 * Close an offer tier for a show date.
 *   - Always: stamp show_date_offer_tiers.closed_at (stops escalation + at-risk alerts).
 *   - withdraw=true: also cancel the tier's still-'suggested' (un-answered) bookings
 *     (mirrors expire_soft_bookings: status='cancelled', cancellation_reason='tier_closed').
 *     soft_booked/confirmed bookings are never touched.
 *
 * Auth: service-role bypass, else requireRole(['admin','producer']) — mirrors open-offer-tier.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  if (!isServiceRole(deps, req)) {
    const auth = await requireRole(deps, req, ["admin", "producer"]);
    if (!auth.ok) return auth.response;
  }

  let show_date_id: string;
  let tier: number;
  let withdraw: boolean;
  try {
    const body = await req.json();
    show_date_id = body.show_date_id;
    tier = Number(body.tier);
    withdraw = body.withdraw === true;
    // tier 99 is the ad-hoc convention (see open-offer-tier); any tier ≥ 1 is closable.
    if (!show_date_id || !tier || tier < 1) {
      return json({ error: "show_date_id and tier (≥1) are required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Close the tier FIRST. The two writes aren't transactional, so order picks
  // which partial failure is safe: if the withdraw then fails we're left with a
  // CLOSED tier whose suggested offers survive — benign, because expire-offers /
  // tier-at-risk-watcher skip closed tiers (the offers expire naturally and an
  // admin can re-run close to retry the withdraw). The reverse (cancel, then fail
  // to close) would leave cancelled offers under a still-open tier, which keeps
  // firing escalation/at-risk against zero pending.
  const { data: closedRows, error: clErr } = await (admin as any)
    .from("show_date_offer_tiers")
    .update({ closed_at: deps.now().toISOString() })
    .eq("show_date_id", show_date_id)
    .eq("tier", tier)
    .is("closed_at", null)
    .select("id");
  if (clErr) {
    console.error("close-offer-tier: close error", clErr);
    return json({ error: clErr.message }, 500);
  }
  const closed = (closedRows?.length ?? 0) > 0;

  let withdrawn = 0;
  if (withdraw) {
    const { data: cancelled, error: cErr } = await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: deps.now().toISOString(),
        cancellation_reason: "tier_closed",
      })
      .eq("show_date_id", show_date_id)
      .eq("offer_tier", tier)
      .eq("status", "suggested")
      .select("id");
    if (cErr) {
      // The tier is already closed (safe state); the withdraw retry failed.
      console.error(`close-offer-tier: withdraw error (tier closed: ${closed})`, cErr);
      return json({ error: cErr.message }, 500);
    }
    withdrawn = cancelled?.length ?? 0;
  }

  if (!closed && withdrawn === 0) {
    return json({ closed: false, withdrawn: 0, message: "Tier was not open" });
  }
  console.log("close-offer-tier complete", { show_date_id, tier, withdraw, withdrawn, closed });
  return json({ closed, withdrawn });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
