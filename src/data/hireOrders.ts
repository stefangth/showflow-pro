import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type HireOrderStatus = Database["public"]["Enums"]["hire_order_status"];

/** A `hire_orders` row, with the linked artist's name joined in (when selected). */
export type HireOrderRow = Database["public"]["Tables"]["hire_orders"]["Row"] & {
  artists?: { name: string } | null;
};

/** A `hire_orders` row for the V4 tracking table: artist name AND the linked
 *  show date's date/venue joined in (unlinked/manual orders carry neither and
 *  fall back to the resolved `data` snapshot in the UI). */
export type HireOrderListRow = HireOrderRow & {
  show_dates?: { date: string; venue: string | null } | null;
};

/** `fetchHireOrders` filters: an empty/omitted `status` returns every status;
 *  `search` does a case-insensitive match on the order number OR the joined
 *  artist name. */
export interface HireOrderFilters {
  status?: HireOrderStatus[];
  search?: string;
}

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

/**
 * Neutralise a free-text search term before it is interpolated into a PostgREST
 * `or()` filter string. Strips the two wildcards (`%`, `*`) so a user can't turn
 * the search into a match-all, and the grouping/quoting metacharacters
 * (`,` `(` `)` `"` `\`) so a stray `)` can't close the `or(...)` group early and
 * append attacker-controlled clauses (e.g. `x)or(status.eq.void`). Column and
 * operator are hard-coded around the term, so it only ever lands in the value
 * position where the remaining characters (letters, digits, `.`, `-`, …) are
 * literal — order numbers and artist names never legitimately carry the stripped
 * ones, so the loss is negligible. Returns "" for a blank/undefined term.
 */
export function sanitizeSearchTerm(search: string | undefined): string {
  return (search ?? "").replace(/[%*(),"\\]/g, "").trim();
}

/**
 * All of an org's hire orders (any status), newest first, with the linked
 * artist name and show date (date + venue) joined in — feeds the V4 tracking
 * table. `filters.status` narrows to a status set (omitted/empty = every
 * status); `filters.search` matches the order number OR the joined artist
 * name, case-insensitively (PostgREST's `or()` supports referencing an
 * embedded resource's column — see the API docs' "Embedded filters" section).
 * Every character with structural meaning in a PostgREST filter string is
 * stripped from the search term first (see `sanitizeSearchTerm`) since the
 * search box is free text and is interpolated straight into the `or()` group.
 */
export async function fetchHireOrders(
  client: SupabaseClient<Database>,
  orgId: string,
  filters: HireOrderFilters = {},
): Promise<HireOrderListRow[]> {
  let query = client
    .from("hire_orders")
    .select("*, artists(name), show_dates(date, venue)")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (filters.status && filters.status.length > 0) {
    query = query.in("status", filters.status);
  }
  const term = sanitizeSearchTerm(filters.search);
  if (term) {
    query = query.or(`order_no.ilike.%${term}%,artists.name.ilike.%${term}%`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as HireOrderListRow[];
}

/** Count of this org's orders currently awaiting the artist's countersignature
 *  (status `issued`) — the "Hire orders" nav badge and the V4 KPI tile.
 *  Server-side head count (see fetchPendingConfirmationsCount in bookings.ts). */
export async function fetchAwaitingCountersignCount(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { count, error } = await client
    .from("hire_orders")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "issued");
  if (error) throw error;
  return count ?? 0;
}
