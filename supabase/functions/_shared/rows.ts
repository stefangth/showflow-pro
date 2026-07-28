import type { Database } from "./database.types.ts";

/** Args of the resolve_show_assignments RPC. PostgREST type-gen marks every
 *  function arg non-null, but the SQL function (20260604133000) explicitly
 *  handles NULL p_sub_program / p_city_id — call sites that legitimately pass
 *  null cast their args object through this type at the boundary. */
export type ResolveShowAssignmentsArgs =
  Database["public"]["Functions"]["resolve_show_assignments"]["Args"];

/** Args of the create_hire_order_with_dates RPC, with the two arguments the SQL
 *  function genuinely accepts as NULL widened back to nullable.
 *
 *  Same type-gen limitation as above, handled one step earlier. Where
 *  resolve_show_assignments builds its args literal directly at the `.rpc()`
 *  call — so casting there loses nothing — these args travel through a helper
 *  (`createBatchHireOrderWithRetry`), and staying honestly typed until the call
 *  is worth the extra type. The cast happens at the `.rpc()` boundary only.
 *
 *  Both NULLs are meaningful, not placeholders: `p_fee_amount` is NULL when no
 *  fee was entered (0 would mean "free"), and `p_created_by` is NULL on the
 *  cron/trigger auto-draft path, which runs on X-Cron-Secret and has no user.
 *  The function (20260724130000) is CALLED ON NULL INPUT and stores both
 *  verbatim; `hire_orders.fee_amount` and `.created_by` are nullable, and the
 *  latter's FK is ON DELETE SET NULL, so the schema produces NULL on its own.
 *
 *  Do NOT express this by hand-editing the generated types instead — that is
 *  what made types.ts un-regenerable. See scripts/generatedTypes.test.ts. */
export type CreateHireOrderWithDatesArgs =
  & Omit<
    Database["public"]["Functions"]["create_hire_order_with_dates"]["Args"],
    "p_fee_amount" | "p_created_by"
  >
  & { p_fee_amount: number | null; p_created_by: string | null };

/** Joined-row shapes shared by the booking-engine crons and webhooks.
 *  Fields mirror the select strings at the call sites — if you change a
 *  select, change the interface in the same commit. */
export interface ShowJoin {
  program: string | null
  sub_program: string | null
  main_cast_slots: number | null
  understudy_slots: number | null
}
export interface ShowDateWithShow {
  id: string
  show_id: string
  date: string
  city_id: string | null
  org_id: string
  show: ShowJoin | null
}
export interface ProducerAssignmentRow { producer_user_id: string }
export interface OrgAdminRow { user_id: string }
export interface ArtistJoin {
  id: string
  name: string | null
  email: string | null
  user_id: string | null
}
export interface DueBookingRow {
  id: string
  artist_id: string
  offer_expires_at: string | null
  artists: ArtistJoin | null
  show_dates: {
    date: string
    custom: Record<string, unknown> | null
    show_id: string
    city_id: string | null
    shows: { program: string | null; sub_program: string | null } | null
  } | null
}
