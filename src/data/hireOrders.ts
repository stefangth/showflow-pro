import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { EditableOrderFieldKey, OrderData } from "@/lib/hireOrders/types";
import { feeCents } from "@/lib/hireOrders/feeBasis";
import { readEdgeError } from "@/lib/edgeErrors";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";
import { mergeTermsTemplates } from "@/lib/hireOrders/termsImport";
import type { HireOrderTemplate, HireOrderTermsSetting } from "@/lib/hireOrders/terms";

export type HireOrderStatus = Database["public"]["Enums"]["hire_order_status"];

/** A `hire_orders` row, with the linked artist's name joined in (when selected). */
export type HireOrderRow = Database["public"]["Tables"]["hire_orders"]["Row"] & {
  artists?: { name: string } | null;
  hire_order_dates?: Array<{ show_date_id: string }> | null;
};

/** All hire orders for a show date (any status), oldest first, artist name joined. */
export async function fetchHireOrdersForDate(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<HireOrderRow[]> {
  const [legacyResult, linksResult] = await Promise.all([
    client
      .from("hire_orders")
      .select("*, artists(name)")
      .eq("show_date_id", showDateId)
      .order("created_at", { ascending: true }),
    client
      .from("hire_order_dates")
      .select("hire_order_id")
      .eq("show_date_id", showDateId),
  ]);
  if (legacyResult.error) throw legacyResult.error;
  if (linksResult.error) throw linksResult.error;

  const linkedOrderIds = [...new Set(
    ((linksResult.data ?? []) as Array<{ hire_order_id: string }>).map((link) =>
      link.hire_order_id
    ),
  )];
  let linked: HireOrderRow[] = [];
  if (linkedOrderIds.length > 0) {
    const { data, error } = await client
      .from("hire_orders")
      .select("*, artists(name)")
      .in("id", linkedOrderIds)
      .order("created_at", { ascending: true });
    if (error) throw error;
    linked = (data ?? []) as unknown as HireOrderRow[];
  }

  const combined = new Map<string, HireOrderRow>();
  for (const order of [
    ...((legacyResult.data ?? []) as unknown as HireOrderRow[]),
    ...linked,
  ]) {
    combined.set(order.id, order);
  }
  return [...combined.values()].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
}

export interface HireOrderDateCoverage {
  id: string;
  status: HireOrderStatus;
}

export interface DatesReadyResult {
  /** Fully-filled show_date ids that have no active (non-void) hire order. */
  readyIds: string[];
  /** For every date an active order covers, that order (drives the row chip). */
  orderByDate: Record<string, HireOrderDateCoverage>;
}

/**
 * Which of the org's fully-filled show_dates are ready for a hire order (i.e.
 * have no active order yet), plus the active order covering each already-ordered
 * date. Coverage is the legacy `hire_orders.show_date_id` OR an aggregate
 * `hire_order_dates` child; void orders never cover. `neq` isn't a real filter
 * in the test fake, so void is filtered in TS after the fetch.
 */
export async function fetchDatesReadyForHireOrder(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<DatesReadyResult> {
  if (!orgId) return { readyIds: [], orderByDate: {} };
  const [filledResult, ordersResult, linksResult] = await Promise.all([
    client.from("show_dates").select("id").eq("org_id", orgId).eq("status", "fully_filled"),
    client.from("hire_orders").select("id, status, show_date_id").eq("org_id", orgId),
    client.from("hire_order_dates").select("hire_order_id, show_date_id").eq("org_id", orgId),
  ]);
  if (filledResult.error) throw filledResult.error;
  if (ordersResult.error) throw ordersResult.error;
  if (linksResult.error) throw linksResult.error;

  const activeOrders = (
    (ordersResult.data ?? []) as Array<{ id: string; status: HireOrderStatus; show_date_id: string | null }>
  ).filter((o) => o.status !== "void");
  const activeById = new Map(activeOrders.map((o) => [o.id, o]));

  const orderByDate: Record<string, HireOrderDateCoverage> = {};
  const cover = (dateId: string, order: HireOrderDateCoverage) => {
    if (!orderByDate[dateId]) orderByDate[dateId] = order;
  };
  for (const o of activeOrders) if (o.show_date_id) cover(o.show_date_id, { id: o.id, status: o.status });
  for (const link of (linksResult.data ?? []) as Array<{ hire_order_id: string; show_date_id: string }>) {
    const o = activeById.get(link.hire_order_id);
    if (o) cover(link.show_date_id, { id: o.id, status: o.status });
  }

  const readyIds = ((filledResult.data ?? []) as Array<{ id: string }>)
    .map((r) => r.id)
    .filter((id) => !orderByDate[id]);
  return { readyIds, orderByDate };
}

/** A single hire order by id, artist name joined. */
export async function fetchHireOrder(
  client: SupabaseClient<Database>,
  id: string,
): Promise<HireOrderRow> {
  const { data, error } = await client
    .from("hire_orders")
    .select("*, artists(name)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as unknown as HireOrderRow;
}

/**
 * This user's own issued/countersigned hire orders (artist-facing surface).
 * `artistIds` is plural so callers can pass every artist row linked to the
 * current user; an empty list short-circuits without querying.
 */
export async function fetchMyHireOrders(
  client: SupabaseClient<Database>,
  artistIds: string[],
): Promise<HireOrderRow[]> {
  if (artistIds.length === 0) return [];
  const { data, error } = await client
    .from("hire_orders")
    .select("*, artists(name), hire_order_dates(show_date_id)")
    .in("artist_id", artistIds)
    .in("status", ["issued", "countersigned"])
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as HireOrderRow[];
}

/** Status + free-text filters accepted by fetchHireOrders. Both are optional;
 *  an empty/undefined status list means "any status". */
export interface HireOrderFilters {
  status?: HireOrderStatus[];
  search?: string;
}

/** A hire_orders row for the V4 tracking table: the joined artist name (as
 *  HireOrderRow already carries) plus the linked show_date's date + venue. */
export type HireOrderListRow = HireOrderRow & {
  show_dates?: { date: string; venue: string | null } | null;
};

/**
 * All of an org's hire orders (any status by default), for the V4 tracking
 * dashboard: `artists(name)` and `show_dates(date, venue)` joined, newest
 * first, optionally narrowed by status and/or a free-text search across the
 * order number and the artist's name.
 *
 * `order_no` matching is pushed to Postgres via `.ilike()` — it is a
 * base-table column, so PostgREST filters it cleanly server-side. Artist-name
 * matching can't join the same query cleanly: PostgREST cannot combine a
 * joined table's column (`artists.name`) with a base-table `.ilike()` in one
 * `.or()` filter. So when a search term is given, this also re-fetches the
 * (status-filtered) rows once more WITHOUT the ilike and matches
 * `artists.name` in JS, merging the two result sets by id. With no search
 * term this stays a single round trip.
 */
export async function fetchHireOrders(
  client: SupabaseClient<Database>,
  orgId: string,
  filters: HireOrderFilters = {},
): Promise<HireOrderListRow[]> {
  const baseQuery = () => {
    let q = client
      .from("hire_orders")
      .select("*, artists(name), show_dates!hire_orders_show_date_id_fkey(date, venue)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (filters.status && filters.status.length > 0) {
      q = q.in("status", filters.status);
    }
    return q;
  };

  const needle = filters.search?.trim();
  if (!needle) {
    const { data, error } = await baseQuery();
    if (error) throw error;
    return (data ?? []) as unknown as HireOrderListRow[];
  }

  const [byOrderNo, fullSet] = await Promise.all([
    baseQuery().ilike("order_no", `%${needle}%`),
    baseQuery(),
  ]);
  if (byOrderNo.error) throw byOrderNo.error;
  if (fullSet.error) throw fullSet.error;

  const lowerNeedle = needle.toLowerCase();
  const byArtistName = ((fullSet.data ?? []) as unknown as HireOrderListRow[]).filter((row) =>
    (row.artists?.name ?? "").toLowerCase().includes(lowerNeedle),
  );

  const merged = new Map<string, HireOrderListRow>();
  for (const row of (byOrderNo.data ?? []) as unknown as HireOrderListRow[]) merged.set(row.id, row);
  for (const row of byArtistName) merged.set(row.id, row);
  return Array.from(merged.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Head count of an org's hire orders currently awaiting countersignature
 *  (status = 'issued'). Feeds both the V4 KPI tile and the sidebar nav badge. */
export async function fetchAwaitingCountersignCount(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { count, error } = await client
    .from("hire_orders")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "issued");
  if (error) throw error;
  return count ?? 0;
}

/** A minimal artist row for the V5 "new order" wizard's artist picker (and,
 *  per Task 5, the spreadsheet import wizard's entity-resolution step). */
export interface ArtistLite { id: string; name: string; email: string | null }

/** Every org artist (any status — the wizard offers a free choice, per the
 *  design spec), lightest possible shape, ordered by name. */
export async function fetchArtistsLite(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ArtistLite[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("artists").select("id, name, email").eq("org_id", orgId).order("name");
  if (error) throw error;
  return (data ?? []) as ArtistLite[];
}

/** A minimal show_date row for the V5 wizard's date picker (and Task 5's import
 *  wizard). `sessions` is the non-empty session_1..3 triplet, mirroring the
 *  edge function's own assembly in draftOrders/draftManual. */
export interface ShowDateLite {
  id: string;
  date: string;
  venue: string | null;
  city: string | null;
  duration_minutes: number | null;
  sessions: string[];
}

/** Every org show_date (any status — "any date" per the design spec), newest
 *  first, with the city name joined. */
export async function fetchShowDatesLite(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<ShowDateLite[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("show_dates")
    .select("id, date, venue, duration_minutes, session_1, session_2, session_3, cities(name)")
    .eq("org_id", orgId)
    .order("date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{
    id: string; date: string; venue: string | null; duration_minutes: number | null;
    session_1: string | null; session_2: string | null; session_3: string | null;
    cities: { name: string } | null;
  }>).map((row) => ({
    id: row.id,
    date: row.date,
    venue: row.venue,
    city: row.cities?.name ?? null,
    duration_minutes: row.duration_minutes,
    sessions: [row.session_1, row.session_2, row.session_3].filter(
      (t): t is string => typeof t === "string" && t !== "",
    ),
  }));
}

/** Invoke the generate-hire-orders edge function (including draft-batch and immutable resend).
 *  Rethrows with the server's own reason rather than supabase-js's opaque
 *  "non-2xx status code" string — see src/lib/edgeErrors.ts. */
export async function invokeHireOrderAction(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("generate-hire-orders", { body });
  if (error) throw new Error(await readEdgeError(error));
  return data;
}

/** The producer's pre-issue review edits from the generate dialog. */
export interface HireOrderReview {
  feeAmount: number | null;
  termsVariant: string;
  /** Per-order booking-agent overrides. Present only when the producer edited them;
   *  `""` means "print no agent", omitted means "leave the column unchanged". */
  agentName?: string | null;
  agentEmail?: string | null;
}

/**
 * Persist the producer's review edits (engagement fee, terms variant, and
 * optionally the per-order booking-agent override) onto a draft/ready order
 * before preview/issue. The fee lands in BOTH the `fee_amount` column and the
 * `data.fee` snapshot as a `manual`-source field — the PDF renders from the
 * snapshot (`data.fee.value`), so the two must stay in step. Every other
 * snapshot field is preserved untouched.
 *
 * A CHANGED fee also clears the server-derived `fee_basis`/`fee_per_date`
 * snapshot keys. They exist only to explain how the stored TOTAL was reached
 * (`fee_per_date` x engagement dates === `fee`), so a total this function
 * rewrites without touching them would issue a PDF whose breakdown line
 * contradicts its own total. Dropping them degrades the document to the plain
 * "Engagement fee" label, which is exactly what every order created before the
 * per-date feature already prints. A fee left unchanged (a terms-only or
 * agent-only edit) keeps them, so the breakdown survives an unrelated edit.
 *
 * `fee_amount`/`terms_variant`/`data` are ALWAYS written. `agent_name` and
 * `agent_email` are each written independently, and only when their key is
 * present on `review` (`undefined` means "leave the column unchanged" —
 * see `HireOrderReview`'s doc comment) — so editing just one of the two
 * agent fields never overwrites the other with its current (possibly
 * inherited) value.
 *
 * Never call on an issued order; the DB transition guard (Task 1) is the
 * backstop, this is only the client path.
 */
export async function updateHireOrderReview(
  client: SupabaseClient<Database>,
  id: string,
  review: HireOrderReview,
  currentData: HireOrderRow["data"],
): Promise<void> {
  const base =
    currentData && typeof currentData === "object" && !Array.isArray(currentData)
      ? (currentData as Record<string, unknown>)
      : {};
  const data: Record<string, unknown> = {
    ...base,
    fee: { value: review.feeAmount, source: "manual" },
  };
  const previousFee = (base.fee as { value?: unknown } | undefined)?.value;
  if (feeCents(previousFee) !== feeCents(review.feeAmount)) {
    delete data.fee_basis;
    delete data.fee_per_date;
  }
  const patch: Database["public"]["Tables"]["hire_orders"]["Update"] = {
    fee_amount: review.feeAmount,
    terms_variant: review.termsVariant,
    data: data as Database["public"]["Tables"]["hire_orders"]["Update"]["data"],
  };
  if (review.agentName !== undefined) patch.agent_name = review.agentName;
  if (review.agentEmail !== undefined) patch.agent_email = review.agentEmail;
  const { error } = await client.from("hire_orders").update(patch).eq("id", id);
  if (error) throw error;
}

/** Patch accepted by `updateHireOrderDraft`: the full resolved snapshot plus
 *  the optional columns that mirror parts of it. */
export interface UpdateHireOrderDraftPatch {
  data: OrderData;
  fee_amount?: string | number | null;
  fee_currency?: string;
  terms_variant?: string;
}

/**
 * Persist the V2 split builder's full field-resolution snapshot onto a
 * draft/ready order, plus the optional fee/currency/terms columns.
 *
 * DISTINCT from `updateHireOrderReview`: that one is the narrow pre-issue path
 * used by the V1 generate dialog (fee + terms variant only, reconstructing
 * just `data.fee` on top of whatever `data` already held). This one writes
 * the WHOLE resolved `data` snapshot the builder computed — every field, each
 * tagged with its resolved source — because the builder can edit any of the
 * twelve order fields across its four sections, not just the fee. Callers are
 * responsible for keeping `fee_amount` in step with `data.fee?.value` (see
 * `HireOrderEditPage`'s patch builder).
 */
export async function updateHireOrderDraft(
  client: SupabaseClient<Database>,
  id: string,
  patch: UpdateHireOrderDraftPatch,
): Promise<void> {
  const update: Database["public"]["Tables"]["hire_orders"]["Update"] = {
    data: patch.data as Database["public"]["Tables"]["hire_orders"]["Update"]["data"],
  };
  if (patch.fee_amount !== undefined) {
    update.fee_amount = patch.fee_amount === null || patch.fee_amount === "" ? null : Number(patch.fee_amount);
  }
  if (patch.fee_currency !== undefined) update.fee_currency = patch.fee_currency;
  if (patch.terms_variant !== undefined) update.terms_variant = patch.terms_variant;
  const { error } = await client.from("hire_orders").update(update).eq("id", id);
  if (error) throw error;
}

/** Assign into a showflow-layer draft only when the value is meaningfully
 *  present. Mirrors `resolveFields` treating `""` the same as `undefined`
 *  (both absent), but a `null` column value is skipped here explicitly too —
 *  same convention as the edge function's own `assign` helper. */
function assignShowflowField(
  layer: Partial<Record<EditableOrderFieldKey, unknown>>,
  key: EditableOrderFieldKey,
  value: unknown,
): void {
  if (value === null || value === undefined || value === "") return;
  layer[key] = value;
}

/**
 * A fresh ShowFlow-sourced field layer for an order's linked artist and/or
 * show date, for the V2 builder's "Refresh from ShowFlow" action. Either id
 * may be null (an order can link just one); when both are null this returns
 * `{}` (a fully manual/unlinked order has nothing to refresh from — the
 * caller hides/disables the action in that case).
 *
 * MIRROR: reproduces the showflow-layer assembly in `draftOrders` /
 * `draftManual` in `supabase/functions/generate-hire-orders/index.ts` (artist
 * name/email/cast_role, show_date date/venue/city/duration/sessions). The two
 * runtimes cannot share an import — the edge function's assembly is
 * authoritative; keep this in step with it.
 *
 * DELIBERATE GAP: the edge function's `draftOrders` assembly also sets `fee`
 * from `bookings.fee_amount` (generate-hire-orders/index.ts:~187), but this
 * mirror omits `fee` on purpose. Nothing currently populates
 * `bookings.fee_amount` on this path, so today the gap is inert, but if that
 * ever changes this function will keep silently NOT re-pulling it: "Refresh
 * from ShowFlow" is meant to leave the engagement fee exactly as the builder
 * (manual entry or prior resolution) already has it, never overwrite it from
 * a booking-sourced value.
 */
export async function fetchShowflowLayerForOrder(
  client: SupabaseClient<Database>,
  args: { showDateId: string | null; artistId: string | null },
): Promise<Partial<Record<EditableOrderFieldKey, unknown>>> {
  const layer: Partial<Record<EditableOrderFieldKey, unknown>> = {};

  const [artistResult, showDateResult] = await Promise.all([
    args.artistId
      ? client.from("artists").select("name, email, cast_role").eq("id", args.artistId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    args.showDateId
      ? client
          .from("show_dates")
          .select("date, venue, duration_minutes, session_1, session_2, session_3, cities(name)")
          .eq("id", args.showDateId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (artistResult.error) throw artistResult.error;
  if (showDateResult.error) throw showDateResult.error;

  if (artistResult.data) {
    const artist = artistResult.data as { name: string; email: string | null; cast_role: string | null };
    assignShowflowField(layer, "artist_name", artist.name);
    assignShowflowField(layer, "recipient_email", artist.email);
    assignShowflowField(layer, "role", artist.cast_role);
  }

  if (showDateResult.data) {
    const sd = showDateResult.data as unknown as {
      date: string; venue: string | null; duration_minutes: number | null;
      session_1: string | null; session_2: string | null; session_3: string | null;
      cities: { name: string } | null;
    };
    assignShowflowField(layer, "date", sd.date);
    assignShowflowField(layer, "venue", sd.venue);
    assignShowflowField(layer, "city", sd.cities?.name ?? null);
    assignShowflowField(layer, "duration_min", sd.duration_minutes);
    const sessions = [sd.session_1, sd.session_2, sd.session_3].filter(
      (t): t is string => typeof t === "string" && t !== "",
    );
    if (sessions.length > 0) layer.sessions = sessions;
  }

  return layer;
}

/** Metadata stored on the `hire_order_imports` row created by a bulk import run.
 *  `source` must satisfy the DB CHECK (source in ('xlsx','csv','gsheet')); `mapping`
 *  is stored as-is (the OrderColumnMapping the user confirmed in the Map step). */
export interface BulkImportHireOrdersImportMeta {
  source: "xlsx" | "csv" | "gsheet";
  file_name: string | null;
  mapping: Record<string, unknown>;
  row_count: number;
}

/** One resolved import row as sent to the RPC. `data` is the ALREADY-RESOLVED
 *  OrderData (via resolveFields) -- the RPC stores it as-is, it never re-resolves. */
export interface BulkImportHireOrdersRow {
  row_index: number;
  artist_id: string | null;
  show_date_id: string | null;
  data: OrderData;
  fee_amount?: number;
  fee_currency: string;
  terms_variant: string;
}

export interface BulkImportHireOrdersArgs {
  orgId: string;
  import: BulkImportHireOrdersImportMeta;
  rows: BulkImportHireOrdersRow[];
}

/** Per-row outcome returned by the `bulk_import_hire_orders` RPC. */
export interface BulkImportHireOrdersResultRow {
  row_index: number;
  status: "created" | "skipped_existing" | "error";
  order_id?: string;
  error?: string;
}

/**
 * Create draft hire orders from an already-resolved spreadsheet import (the
 * import wizard's final Review-step submit). A single SECURITY DEFINER RPC:
 * inserts the `hire_order_imports` row, then one `hire_orders` draft per row
 * (skipping rows that would duplicate an existing active order for the same
 * artist + show_date). Never issues -- import is draft-only by design.
 */
export async function bulkImportHireOrders(
  client: SupabaseClient<Database>,
  args: BulkImportHireOrdersArgs,
): Promise<BulkImportHireOrdersResultRow[]> {
  const { data, error } = await client.rpc("bulk_import_hire_orders", {
    p_org: args.orgId,
    // The RPC's jsonb params type as `Json`; our precise arg interfaces lack the
    // string index signature `Json` requires, so cast at this boundary (house rule).
    p_import: args.import as unknown as Json,
    p_rows: args.rows as unknown as Json,
  });
  if (error) throw error;
  return (data ?? []) as unknown as BulkImportHireOrdersResultRow[];
}

/**
 * Create a new org artist from just a name + email (the import wizard's Resolve
 * step "Create artist" path, for an unmatched sheet row). Mirrors the insert
 * shape in ArtistsPage.tsx's createArtist mutation, selecting the ArtistLite
 * columns back so the new artist can be used immediately as a link target.
 */
export async function createArtistLite(
  client: SupabaseClient<Database>,
  args: { orgId: string; name: string; email: string | null },
): Promise<ArtistLite> {
  const { data, error } = await client
    .from("artists")
    .insert({ name: args.name, email: args.email, org_id: args.orgId })
    .select("id, name, email")
    .single();
  if (error) throw error;
  return data as ArtistLite;
}

/**
 * Client-side status write for "mark countersigned" / "void". Only ever writes
 * `status` (+ `countersigned_at`, stamped here, when transitioning to
 * `countersigned` — never for any other status). The DB transition guard
 * (Task 1) is the real backstop on legality; this is just the client path.
 */
export async function updateHireOrderStatus(
  client: SupabaseClient<Database>,
  id: string,
  status: HireOrderStatus,
): Promise<void> {
  const patch: Database["public"]["Tables"]["hire_orders"]["Update"] =
    status === "countersigned"
      ? { status, countersigned_at: new Date().toISOString() }
      : { status };
  const { error } = await client.from("hire_orders").update(patch).eq("id", id);
  if (error) throw error;
}

export interface SignHireOrderArgs {
  orgId: string;
  orderId: string;
  method: "typed" | "drawn";
  typedName?: string;
  signaturePng?: string;
  consent: boolean;
}

/** Artist-facing in-app signing: invokes generate-hire-orders' `sign` action. */
export async function signHireOrder(
  client: SupabaseClient<Database>,
  args: SignHireOrderArgs,
): Promise<void> {
  await invokeHireOrderAction(client, {
    action: "sign",
    org_id: args.orgId,
    order_id: args.orderId,
    method: args.method,
    typed_name: args.typedName,
    signature_png: args.signaturePng,
    consent: args.consent,
  });
}

/** Upload the org's booking-agent signature PNG (admin-only). Stores the bytes
 *  and returns the storage path + a signed preview URL; the caller persists the
 *  path into the letterhead setting via the normal Save. */
export async function uploadAgentSignature(
  client: SupabaseClient<Database>,
  args: { org_id: string; signature_png: string },
): Promise<{ path: string; url: string | null }> {
  const data = await invokeHireOrderAction(client, {
    action: "upload-agent-signature",
    org_id: args.org_id,
    signature_png: args.signature_png,
  });
  return data as { path: string; url: string | null };
}

/** Signed URL for the org's already-stored agent signature (or null), so settings
 *  can preview it after a reload. Admin-only server-side. */
export async function fetchAgentSignatureUrl(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<string | null> {
  const data = await invokeHireOrderAction(client, {
    action: "agent-signature-url",
    org_id: orgId,
  });
  return (data as { url: string | null }).url;
}

/** Platform-only app_settings key holding the terms catalogue orgs import FROM.
 *  Distinct from `hire_order_terms` on purpose (spec §2.1): an org gets a copy it
 *  owns, so a later platform edit never changes contract text already being issued. */
export const TERMS_LIBRARY_KEY = "hire_order_terms_library";

interface TermsLibraryValue {
  templates: HireOrderTemplate[];
}

/**
 * The platform terms library: the super-admin's row if one exists, else the code
 * starter set. Readable by any authenticated member because `org_isolation` on
 * app_settings admits `org_id is null` for SELECT.
 */
export async function fetchTermsLibrary(
  client: SupabaseClient<Database>,
): Promise<HireOrderTemplate[]> {
  const value = await resolveOrgSetting<TermsLibraryValue>(client, null, TERMS_LIBRARY_KEY, {
    templates: HIRE_ORDER_STARTER_TERMS,
  });
  if (!Array.isArray(value?.templates)) return HIRE_ORDER_STARTER_TERMS;
  // Per-element validation, not just the array shape: the row is writable by SQL as
  // well as by the platform card, and every consumer dereferences `clauses`, so one
  // malformed entry would throw where it renders rather than fail here.
  return value.templates.filter(
    (t): t is HireOrderTemplate =>
      !!t && typeof t.id === "string" && typeof t.name === "string" && Array.isArray(t.clauses),
  );
}

/** Copy library templates into the org's own `hire_order_terms` and return the result. */
export async function importTermsTemplates(
  client: SupabaseClient<Database>,
  args: { orgId: string; current: HireOrderTermsSetting; templates: HireOrderTemplate[] },
): Promise<HireOrderTermsSetting> {
  const next = mergeTermsTemplates(args.current, args.templates);
  await upsertOrgSetting(client, args.orgId, "hire_order_terms", next as unknown as Json);
  return next;
}
