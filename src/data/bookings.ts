import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface OpenOfferTierResult { offersCreated: number; message?: string }

/** Invoke the open-offer-tier edge function for one (show_date, tier). */
export async function openOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number },
): Promise<OpenOfferTierResult> {
  const { data, error } = await client.functions.invoke("open-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier },
  });
  if (error) throw error;
  const payload = data as { offers_created?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { offersCreated: payload?.offers_created ?? 0, message: payload?.message };
}

/** Tiers that *can* be opened for a date: city priorities (raw) + ad-hoc presence. */
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
    priorities = (data ?? []).map((r) => r.priority as number);
  }
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
