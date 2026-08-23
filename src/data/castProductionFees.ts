import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { FeeBasis } from "@/lib/hireOrders/feeBasis";

/** A per-(cast x production) engagement fee, overriding the org default (OrderDefaultsCard)
 *  below the booking/manual fee in generate-hire-orders' resolution order (see the
 *  cast_production_fees migration comment). */
export interface CastProductionFee {
  id: string;
  cast_id: string;
  show_id: string;
  fee_amount: number | null;
  currency: string;
  fee_basis: FeeBasis;
}

interface CastProductionFeeRow {
  id: string;
  cast_id: string;
  show_id: string;
  fee_amount: number | null;
  currency: string;
  fee_basis: string;
}

export async function fetchCastProductionFees(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<CastProductionFee[]> {
  const { data, error } = await client
    .from("cast_production_fees")
    .select("id, cast_id, show_id, fee_amount, currency, fee_basis")
    .eq("org_id", orgId);
  if (error) throw error;
  return ((data ?? []) as unknown as CastProductionFeeRow[]).map((row) => ({
    id: row.id,
    cast_id: row.cast_id,
    show_id: row.show_id,
    fee_amount: row.fee_amount,
    currency: row.currency,
    fee_basis: row.fee_basis as FeeBasis,
  }));
}

/** Upsert one cast x production fee row, keyed on the (cast_id, show_id) unique constraint.
 *  `org_id` IS included in the payload: `derive_org_id_for_cast_production_fee()` (a BEFORE
 *  INSERT trigger) fills it authoritatively from `show_id` on the insert path regardless of
 *  what the client sends, and cross-checks `cast_id` is the same org before doing so, so a
 *  wrong/stale `orgId` here can never smuggle a cross-org row past the trigger's own guard.
 *  The generated PostgREST types mark `org_id` non-optional on `cast_production_fees` (it's
 *  NOT NULL with no default the type-gen can see, only a trigger), so omitting it fails
 *  `tsc` — see the task brief. Passing it is harmless on the update-on-conflict path too:
 *  it's the same org the row already has, since `orgId` here is scoped to the row's own
 *  cast/show in the first place. */
export async function upsertCastProductionFee(
  client: SupabaseClient<Database>,
  args: {
    orgId: string;
    castId: string;
    showId: string;
    feeAmount: number | null;
    currency: string;
    feeBasis: FeeBasis;
  },
): Promise<void> {
  const { orgId, castId, showId, feeAmount, currency, feeBasis } = args;
  const { error } = await client
    .from("cast_production_fees")
    .upsert(
      { org_id: orgId, cast_id: castId, show_id: showId, fee_amount: feeAmount, currency, fee_basis: feeBasis },
      { onConflict: "cast_id,show_id" },
    );
  if (error) throw error;
}

export async function deleteCastProductionFee(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.from("cast_production_fees").delete().eq("id", id);
  if (error) throw error;
}
