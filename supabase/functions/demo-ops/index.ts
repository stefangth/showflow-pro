// Demo-ops: the callable surface for demo-org operations.
//
// Consumes the `wipe_demo_org` / `seed_demo_org` RPCs (Task 3). Three actions:
//  - `flag_and_seed` (super-admin only): marks an already-provisioned org
//    `is_demo = true`, upserts the `hire_orders` entitlement on, and seeds it.
//    The frontend calls `provision-org` FIRST (org + first-admin + invite),
//    then this — `demo-ops` cannot re-invoke `provision-org` itself (its
//    `requireSuperAdmin` gate rejects a service-role fn-to-fn call), and
//    re-implementing account/membership/email would duplicate that code.
//  - `reset` / `wipe` (org-admin; super-admins pass too via the requireOrgRole
//    fallback): re-asserts `is_demo` at the edge (defense in depth on top of each
//    RPC's own guard), then calls wipe/seed. `reset` = wipe then seed; `wipe` =
//    wipe only. There is deliberately NO bare seed-only action: `seed_demo_org`
//    inserts fixed rows (e.g. order_no HO-DEMO-0001..0003) and is NOT idempotent
//    against its own prior output, so it is only ever run on a fresh org
//    (flag_and_seed) or immediately after a wipe (reset).
import { preflight, json } from "../_shared/http.ts";
import { requireOrgRole, requireSuperAdmin } from "../_shared/auth.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

type Action = "reset" | "wipe" | "flag_and_seed";

type Body = {
  action: Action;
  org_id?: string;
  volume?: "small" | "full";
};

const VALID_ACTIONS: Action[] = ["reset", "wipe", "flag_and_seed"];

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
  return json({ ok: true });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
