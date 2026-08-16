// Demo-ops: the callable surface for demo-org operations.
//
// Consumes the `wipe_demo_org` / `seed_demo_org` / `run_demo_cue` RPCs. Four actions:
//  - `flag_and_seed` (super-admin only): marks an already-provisioned org
//    `is_demo = true`, upserts the `hire_orders` entitlement on, and seeds it.
//    The frontend calls `provision-org` FIRST (org + first-admin + invite),
//    then this — `demo-ops` cannot re-invoke `provision-org` itself (its
//    `requireSuperAdmin` gate rejects a service-role fn-to-fn call), and
//    re-implementing account/membership/email would duplicate that code.
//  - `reset` / `wipe` / `cue` (org-admin; super-admins pass too via the
//    requireOrgRole fallback): re-asserts `is_demo` at the edge (defense in depth
//    on top of each RPC's own guard), then dispatches. `reset` = wipe then seed;
//    `wipe` = wipe only. There is deliberately NO bare seed-only action:
//    `seed_demo_org` inserts fixed rows (e.g. order_no HO-DEMO-0001..0003) and is
//    NOT idempotent, so it only runs on a fresh org (flag_and_seed) or right after
//    a wipe (reset). `cue` drives the guided demo tour: DB-mutation cue ids go to
//    `run_demo_cue`; `cue_id: "issue_hire_order"` goes to `generate-hire-orders`.
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole, requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Action = "reset" | "wipe" | "flag_and_seed" | "cue";

type Body = {
  action: Action;
  org_id?: string;
  volume?: "small" | "full";
  cue_id?: string;
};

const VALID_ACTIONS: Action[] = ["reset", "wipe", "flag_and_seed", "cue"];

// DB-mutation cues dispatched to the run_demo_cue RPC (Task 2). `issue_hire_order`
// is handled separately below via generate-hire-orders.
const DB_CUES = ["artist_accepts_offer", "run_clock_to_1700", "drop_notifications", "fill_date", "advance_clock"];

async function assertDemoOrg(deps: Deps, orgId: string): Promise<boolean> {
  const { data } = await deps.admin.from("organizations").select("is_demo").eq("id", orgId).maybeSingle();
  return (data as { is_demo?: boolean } | null)?.is_demo === true;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action || !body?.org_id) return json({ error: "bad_request" }, 400);
  if (!VALID_ACTIONS.includes(body.action)) return json({ error: "bad_request" }, 400);
  const orgId = body.org_id;
  const volume = body.volume ?? "full";

  // flag_and_seed is platform-only: the org already exists (provision-org created it +
  // its admin + invite); here we only stamp is_demo, enable hire_orders, and seed.
  if (body.action === "flag_and_seed") {
    const gate = await requireSuperAdmin(deps, req);
    if (!gate.ok) return gate.response;

    // Blast-radius guard: flag_and_seed FLAGS + WIPES + SEEDS, so it must only ever run
    // on a freshly provisioned org. provision-org's starter catalog is only
    // casts/cities/skills, so the presence of any shows, artists, or bookings means this
    // is a real (or already-seeded) org — refuse rather than wipe it. Checking bookings
    // alone was insufficient once flag_and_seed started wiping.
    for (const table of ["shows", "artists", "bookings"] as const) {
      const { data: rows, error: chkErr } = await deps.admin.from(table).select("id").eq("org_id", orgId).limit(1);
      if (chkErr) return json({ error: chkErr.message }, 500);
      if (rows && (rows as unknown[]).length > 0) return json({ error: "org_not_empty" }, 409);
    }

    // Flag the org first (checked): if this fails, seed_demo_org's is_demo guard would
    // reject anyway, so surface it directly instead of failing obscurely downstream.
    const { error: flagErr } = await deps.admin.from("organizations").update({ is_demo: true }).eq("id", orgId);
    if (flagErr) return json({ error: flagErr.message }, 500);
    // Enable hire_orders (checked): a silent failure here would leave a demo org that
    // looks seeded but has the hire-orders module dark, which is confusing to debug.
    const { error: entErr } = await deps.admin.from("org_entitlements").upsert(
      [{ org_id: orgId, feature: "hire_orders", enabled: true }],
      { onConflict: "org_id,feature" },
    );
    if (entErr) return json({ error: entErr.message }, 500);

    // provision-org already ran seed_org_starter_catalog on this org, so clear that
    // generic starter catalog before seeding the curated demo dataset — otherwise the
    // two mix and the demo shows a polluted catalog. Safe now: is_demo=true (satisfies
    // wipe_demo_org's guard) and the bookings guard above proved the org is fresh.
    const { error: wipeErr } = await deps.admin.rpc("wipe_demo_org", { p_org: orgId });
    if (wipeErr) return json({ error: wipeErr.message }, 500);

    const { error: seedErr } = await deps.admin.rpc("seed_demo_org", {
      p_org: orgId,
      p_volume: volume,
      p_actor: gate.userId ?? undefined,
    });
    if (seedErr) return json({ error: seedErr.message }, 500);
    return json({ ok: true });
  }

  // The destructive/seed actions are org-admin (super-admins pass too via requireOrgRole's fallback).
  const gate = await requireOrgRole(deps, req, orgId, ["admin"]);
  if (!gate.ok) return gate.response;

  // Re-assert the flag at the edge (defense in depth on top of the RPC guard).
  if (!(await assertDemoOrg(deps, orgId))) return json({ error: "not_a_demo_org" }, 400);

  if (body.action === "wipe" || body.action === "reset") {
    const { error } = await deps.admin.rpc("wipe_demo_org", { p_org: orgId });
    if (error) return json({ error: error.message }, 500);
  }
  if (body.action === "reset") {
    const { error } = await deps.admin.rpc("seed_demo_org", {
      p_org: orgId,
      p_volume: volume,
      p_actor: gate.userId ?? undefined,
    });
    if (error) return json({ error: error.message }, 500);
  }

  // `cue` drives the guided demo tour: DB-mutation cues go through run_demo_cue
  // (Task 2); issue_hire_order is a separate action on generate-hire-orders.
  if (body.action === "cue") {
    const cueId = body.cue_id;
    if (cueId === "issue_hire_order") return issueHireOrderCue(deps, req, orgId);
    if (!cueId || !DB_CUES.includes(cueId)) return json({ error: "unknown_cue" }, 400);
    const { error } = await deps.admin.rpc("run_demo_cue", {
      p_org: orgId,
      p_cue: cueId,
      p_actor: gate.userId ?? undefined,
    });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: true });
}

interface DraftHireOrderRow {
  id: string;
  artist_id: string | null;
}

interface IssueOrdersResult {
  issued?: string[];
  failed?: Array<{ order_id: string; issues: string[] }>;
}

/**
 * The `issue_hire_order` cue: find (or synchronously create) an issuable, artist
 * -linked draft hire order for the demo org and issue it, landing a real ISSUED
 * PDF in the demo outbox (Phase 1's send-transactional-email divert), without
 * depending on the async `dispatch_hire_order_drafts` DB trigger (fired by the
 * `fill_date` cue) having already landed.
 *
 * generate-hire-orders' `issue` action 400s on an empty `order_ids` (see
 * issueOrders in generate-hire-orders/index.ts) — the original bug here was
 * calling it with none at all. The seed's HO-DEMO-0001 draft is deliberately
 * UNLINKED (no artist_id/show_date_id, no recipient_email — see
 * 20260816205135_demo_mode_seed_rpcs.sql) so it can never pass
 * generate-hire-orders' orderReadyIssues gate; only a real artist-linked draft
 * (created by fill_date's auto-draft trigger, or synchronously below) is
 * issuable, so linked-ness is exactly what distinguishes a usable draft.
 *
 * Both internal generate-hire-orders calls forward the CALLING admin's own
 * Bearer JWT (already verified admin-of-this-org by requireOrgRole above)
 * rather than demo-ops's own service-role bearer: generate-hire-orders has no
 * `isServiceRole` bypass on its draft/issue actions (unlike open-offer-tier), so
 * a bare service-role call 401s on its requireOrgRole gate — confirmed against
 * the local stack.
 */
async function issueHireOrderCue(deps: Deps, req: Request, orgId: string): Promise<Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const headers = authHeader ? { Authorization: authHeader } : undefined;

  const findLinkedDraft = async (): Promise<string | null> => {
    const { data } = await deps.admin
      .from("hire_orders")
      .select("id, artist_id")
      .eq("org_id", orgId)
      .eq("status", "draft")
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as unknown as DraftHireOrderRow[];
    return rows.find((r) => r.artist_id !== null)?.id ?? null;
  };

  let orderId = await findLinkedDraft();

  if (!orderId) {
    // No linked draft yet -- the async auto-draft trigger from `fill_date` may not
    // have landed, or `fill_date` hasn't run for this org. Draft synchronously
    // from the org's fully_filled date so there is always something to issue.
    const { data: dateRow } = await deps.admin
      .from("show_dates")
      .select("id")
      .eq("org_id", orgId)
      .eq("status", "fully_filled")
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const showDateId = (dateRow as { id: string } | null)?.id ?? null;

    if (showDateId) {
      const { error: draftErr } = await deps.invokeFunction(
        "generate-hire-orders",
        { action: "draft", org_id: orgId, show_date_id: showDateId, notify: true },
        headers,
      );
      if (draftErr) return json({ error: (draftErr as Error).message }, 500);
      orderId = await findLinkedDraft();
    }
  }

  if (!orderId) {
    // Nothing issuable yet (fill_date hasn't run for this org) -- a no-op, not a
    // hard failure: a demo shouldn't crash when a rep clicks a cue out of order.
    return json({ ok: true, issued: false, reason: "no_issuable_draft" });
  }

  const { data, error } = await deps.invokeFunction(
    "generate-hire-orders",
    { action: "issue", org_id: orgId, order_ids: [orderId] },
    headers,
  );
  if (error) return json({ error: (error as Error).message }, 500);

  const result = data as IssueOrdersResult | null;
  if (result?.issued?.includes(orderId)) {
    return json({ ok: true, issued: true, order_id: orderId });
  }
  const issues = result?.failed?.find((f) => f.order_id === orderId)?.issues;
  return json({ error: issues?.join(",") ?? "issue_failed" }, 500);
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
