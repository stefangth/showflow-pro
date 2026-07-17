import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type HireOrderStatus = Database["public"]["Enums"]["hire_order_status"];

/** A `hire_orders` row, with the linked artist's name joined in (when selected). */
export type HireOrderRow = Database["public"]["Tables"]["hire_orders"]["Row"] & {
  artists?: { name: string } | null;
};

/** All hire orders for a show date (any status), oldest first, artist name joined. */
export async function fetchHireOrdersForDate(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<HireOrderRow[]> {
  const { data, error } = await client
    .from("hire_orders")
    .select("*, artists(name)")
    .eq("show_date_id", showDateId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  // The joined `artists(name)` shape isn't distinguishable from the generated
  // select-string type; isolate the `any` here per house rule.
  return (data ?? []) as unknown as HireOrderRow[];
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
    .select("*, artists(name)")
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
      .select("*, artists(name), show_dates(date, venue)")
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

/** Invoke the generate-hire-orders edge function (actions: draft/issue/preview/download-url). */
export async function invokeHireOrderAction(
  client: SupabaseClient<Database>,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke("generate-hire-orders", { body });
  if (error) throw error;
  return data;
}

/** The producer's pre-issue review edits from the generate dialog. */
export interface HireOrderReview {
  feeAmount: number | null;
  termsVariant: string;
}

/**
 * Persist the producer's review edits (engagement fee + terms variant) onto a
 * draft/ready order before preview/issue. The fee lands in BOTH the `fee_amount`
 * column and the `data.fee` snapshot as a `manual`-source field — the PDF renders
 * from the snapshot (`data.fee.value`), so the two must stay in step. Every other
 * snapshot field is preserved untouched. Never call on an issued order; the DB
 * transition guard (Task 1) is the backstop, this is only the client path.
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
  const data = { ...base, fee: { value: review.feeAmount, source: "manual" } };
  const patch: Database["public"]["Tables"]["hire_orders"]["Update"] = {
    fee_amount: review.feeAmount,
    terms_variant: review.termsVariant,
    data: data as Database["public"]["Tables"]["hire_orders"]["Update"]["data"],
  };
  const { error } = await client.from("hire_orders").update(patch).eq("id", id);
  if (error) throw error;
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
