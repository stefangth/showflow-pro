import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface OpenOfferTierResult {
  offersCreated: number;
  message?: string;
  /** True when offers were created but the tier tracking row failed to write —
   *  escalation/at-risk won't see this round until the tier is re-opened. */
  trackingWarning?: boolean;
}

/** Invoke the open-offer-tier edge function for one (show_date, tier). */
export async function openOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number },
): Promise<OpenOfferTierResult> {
  const { data, error } = await client.functions.invoke("open-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier },
  });
  if (error) throw error;
  const payload = data as { offers_created?: number; message?: string; error?: string; tier_tracking_warning?: boolean };
  if (payload?.error) throw new Error(payload.error);
  const result: OpenOfferTierResult = { offersCreated: payload?.offers_created ?? 0, message: payload?.message };
  if (payload?.tier_tracking_warning === true) result.trackingWarning = true;
  return result;
}

/**
 * Tiers that *can* be opened for a date.
 * - `priorities`: RAW per-city priorities (duplicates preserved). Dedup/sort/labeling
 *   is the consumer's job — see `buildOfferTierOptions` in `@/lib/bookings`.
 * - `hasAdHoc`: whether the date has any per-date ("ad-hoc") cast assignments.
 * A null `cityId` skips the priority query (priorities = []) but still checks ad-hoc,
 * since ad-hoc casts are per-date, not per-city.
 */
export async function fetchOfferTiers(
  client: SupabaseClient<Database>,
  args: { cityId: string | null; showDateId: string },
): Promise<{ priorities: number[]; hasAdHoc: boolean }> {
  let priorities: number[] = [];
  if (args.cityId) {
    const { data, error } = await client
      .from("cast_city_priority")
      .select("priority")
      .eq("city_id", args.cityId);
    if (error) throw error;
    // Raw — dedup happens downstream in buildOfferTierOptions.
    priorities = (data ?? []).map((r) => r.priority as number);
  }
  // Any show_date_cast_eligibility row for this date means ad-hoc casts exist (tier 99).
  const { data: adHoc, error: adErr } = await client
    .from("show_date_cast_eligibility")
    .select("id")
    .eq("show_date_id", args.showDateId)
    .limit(1);
  if (adErr) throw adErr;
  return { priorities, hasAdHoc: (adHoc ?? []).length > 0 };
}

export interface OpenedTier { tier: number; openedAt: string; closedAt: string | null }

/** Tiers that *have* been opened for a date (read-only state display). */
export async function fetchOpenedTiers(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<OpenedTier[]> {
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select("tier, opened_at, closed_at")
    .eq("show_date_id", showDateId)
    .order("tier", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ tier: r.tier, openedAt: r.opened_at, closedAt: r.closed_at }));
}

export interface CloseOfferTierResult { closed: boolean; withdrawn: number; message?: string }

/** Invoke the close-offer-tier edge function for one (show_date, tier). */
export async function closeOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number; withdraw: boolean },
): Promise<CloseOfferTierResult> {
  const { data, error } = await client.functions.invoke("close-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier, withdraw: args.withdraw },
  });
  if (error) throw error;
  const payload = data as { closed?: boolean; withdrawn?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { closed: !!payload?.closed, withdrawn: payload?.withdrawn ?? 0, message: payload?.message };
}
