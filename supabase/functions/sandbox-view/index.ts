// Public read-only sandbox viewer for demo orgs. verify_jwt=false: a leave-behind
// link a prospect opens with no login. Validation is INLINE over the service-role
// client (no SECURITY DEFINER RPC, so no service-role-grant footgun); the snapshot
// is curated + display-safe (no PII, no PDF bytes, no signed URLs). Only ever
// resolves is_demo orgs. Ships dark.
import { preflight, json } from "../_shared/http.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";

interface LinkRow { org_id: string; expires_at: string; revoked_at: string | null; }

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = body?.token;
  if (!token || typeof token !== "string") return json({ error: "bad_request" }, 400);

  const { data: linkData } = await deps.admin
    .from("demo_sandbox_links")
    .select("org_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  const link = linkData as unknown as LinkRow | null;
  if (!link) return json({ ok: false, reason: "not_found" }, 404);
  if (link.revoked_at) return json({ ok: false, reason: "revoked" }, 410);
  if (new Date(link.expires_at).getTime() <= deps.now().getTime())
    return json({ ok: false, reason: "expired" }, 410);

  // Defense in depth: only demo orgs are ever exposed.
  const { data: orgData } = await deps.admin
    .from("organizations").select("name, is_demo").eq("id", link.org_id).maybeSingle();
  const org = orgData as unknown as { name: string; is_demo: boolean } | null;
  if (!org?.is_demo) return json({ ok: false, reason: "not_found" }, 404);

  const snapshot = await buildSnapshot(deps, link.org_id, org.name);
  return json({ ok: true, snapshot });
}

// Assemble a curated, DISPLAY-SAFE snapshot. NEVER select email/phone/user_id/
// storage_path/preview_html or any PDF/signed-url field.
function showLabel(s: { program: string | null; sub_program: string | null } | undefined): string {
  return [s?.program, s?.sub_program].filter(Boolean).join(" · ") || "Untitled show";
}

async function buildSnapshot(deps: Deps, orgId: string, orgName: string) {
  const { data: stateData } = await deps.admin
    .from("demo_state").select("volume, prospect_label").eq("org_id", orgId).maybeSingle();
  const state = stateData as unknown as { volume: "small" | "full"; prospect_label: string | null } | null;

  // This is a public, unauthenticated endpoint (verify_jwt=false) with no per-token
  // rate limiting, so every read is defensively capped. The caps sit far above any
  // demo's seed volume (6 shows / ~24 dates), so they never trim a real demo — they
  // only bound a pathological org that somehow got is_demo set with a huge catalog.
  const SHOW_CAP = 100;
  const DATE_CAP = 200;

  const { data: showsData } = await deps.admin
    .from("shows").select("id, program, sub_program, main_cast_slots").eq("org_id", orgId).limit(SHOW_CAP);
  const shows = (showsData ?? []) as unknown as Array<{ id: string; program: string | null; sub_program: string | null; main_cast_slots: number | null }>;
  const showById = new Map(shows.map((s) => [s.id, s]));

  const { data: citiesData } = await deps.admin
    .from("cities").select("id, name").eq("org_id", orgId);
  const cityName = new Map(((citiesData ?? []) as unknown as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));

  const { data: datesData } = await deps.admin
    .from("show_dates")
    .select("id, date, status, show_id, city_id")
    .eq("org_id", orgId)
    .order("date", { ascending: true })
    .limit(DATE_CAP);
  const dates = (datesData ?? []) as unknown as Array<{ id: string; date: string; status: string; show_id: string; city_id: string | null }>;
  const dateIds = dates.map((d) => d.id);

  // Scope bookings to the fetched date window so the fill-rate numerator (confirmed
  // main-cast bookings) and denominator (main_cast_slots over `dates`) derive from the
  // SAME set — this both bounds the read and keeps fillRate consistent at the cap edge.
  let bookingsData: unknown = [];
  if (dateIds.length) {
    const res = await deps.admin
      .from("bookings").select("status, show_date_id, is_understudy").eq("org_id", orgId).in("show_date_id", dateIds);
    bookingsData = res.data;
  }
  const bookings = (bookingsData ?? []) as unknown as Array<{ status: string; show_date_id: string; is_understudy: boolean }>;

  // `filled`/fillRate measure main-cast fill against `main_cast_slots`, so only
  // non-understudy confirmed bookings count toward them (an understudy must never
  // push a date past its main-cast capacity, e.g. show "4/3"). bookingsByStatus is a
  // raw status tally over the same date window.
  const bookingsByStatus: Record<string, number> = {};
  const confirmedByDate = new Map<string, number>();
  let confirmedMain = 0;
  for (const b of bookings) {
    bookingsByStatus[b.status] = (bookingsByStatus[b.status] ?? 0) + 1;
    if (b.status === "confirmed" && !b.is_understudy) {
      confirmedMain += 1;
      confirmedByDate.set(b.show_date_id, (confirmedByDate.get(b.show_date_id) ?? 0) + 1);
    }
  }

  const { data: hoData } = await deps.admin
    .from("hire_orders").select("status, show_date_id").eq("org_id", orgId).limit(40);
  const hos = (hoData ?? []) as unknown as Array<{ status: string; show_date_id: string | null }>;
  const dateById = new Map(dates.map((d) => [d.id, d]));

  const now = deps.now().getTime();
  const upcomingDates = dates.filter((d) => new Date(d.date).getTime() >= now).length;
  const confirmedBookings = confirmedMain;
  // "needed" per date is the date's show's main_cast_slots.
  const totalNeeded = dates.reduce((s, d) => s + (showById.get(d.show_id)?.main_cast_slots ?? 0), 0);
  const fillRate = totalNeeded > 0 ? Math.round((confirmedBookings / totalNeeded) * 100) : 0;
  const hireOrdersIssued = hos.filter((h) => h.status === "issued" || h.status === "countersigned").length;

  return {
    org: { label: state?.prospect_label ?? orgName, volume: state?.volume ?? "full" },
    generatedAt: deps.now().toISOString(),
    kpis: { upcomingDates, confirmedBookings, fillRate, hireOrdersIssued },
    shows: shows.map((s) => ({ label: showLabel(s) })),
    dates: dates.map((d) => ({
      id: d.id, date: d.date,
      showLabel: showLabel(showById.get(d.show_id)),
      city: d.city_id ? (cityName.get(d.city_id) ?? null) : null,
      status: d.status,
      filled: confirmedByDate.get(d.id) ?? 0,
      needed: showById.get(d.show_id)?.main_cast_slots ?? 0,
    })),
    bookingsByStatus,
    hireOrders: hos.map((h) => {
      const d = h.show_date_id ? dateById.get(h.show_date_id) : null;
      return {
        status: h.status,
        showLabel: d ? showLabel(showById.get(d.show_id)) : null,
        dateOn: d?.date ?? null,
      };
    }),
  };
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
