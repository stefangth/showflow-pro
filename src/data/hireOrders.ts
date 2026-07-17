import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type HireOrderStatus = Database["public"]["Enums"]["hire_order_status"];

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
