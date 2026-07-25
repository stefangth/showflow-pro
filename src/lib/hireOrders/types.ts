// Hire order pure-logic types + field key registry.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same types +
// resolveFields + orderNo + money + validate logic in one file (the two
// runtimes cannot share an import). Change both files in the same commit.

export type FieldSource = "showflow" | "sheet" | "manual" | "default";

export interface FieldValue<T = unknown> {
  value: T;
  source: FieldSource;
}

export interface EngagementDate {
  show_date_id: string;
  date: string;
  venue: string | null;
  city: string | null;
  /** Per-date running order + duration override. Optional: legacy stored
   *  `engagement_dates` rows predate these fields. */
  sessions?: string[];
  duration_min?: number | null;
}

export type OrderFieldKey =
  | "artist_name"
  | "recipient_email"
  | "role"
  | "cast"
  | "date"
  | "venue"
  | "city"
  | "duration_min"
  | "sessions"
  | "fee"
  | "currency"
  | "notes"
  | "engagement_dates"
  // Derived by the server from the producer's fee entry, never hand-edited:
  // `fee` always holds the TOTAL payable, these two explain how it was reached.
  | "fee_basis"
  | "fee_per_date";

export type EditableOrderFieldKey = Exclude<
  OrderFieldKey,
  "engagement_dates" | "fee_basis" | "fee_per_date"
>;

/** Fixed iteration order for resolveFields and any UI that lists order fields. */
export const ORDER_FIELD_KEYS: EditableOrderFieldKey[] = [
  "artist_name",
  "recipient_email",
  "role",
  "cast",
  "date",
  "venue",
  "city",
  "duration_min",
  "sessions",
  "fee",
  "currency",
  "notes",
];

/**
 * A resolved order snapshot.
 *
 * INVARIANT: `fee_basis` and `fee_per_date` are valid only while
 * `fee_per_date x |engagement_dates| === fee` (compared in integer cents; a
 * snapshot with no `engagement_dates` counts as one date). They are derived
 * server-side from the producer's fee entry and describe how THIS total was
 * reached, so any writer that changes `fee` must clear them or recompute them
 * in the same write. A stale pair puts a breakdown line on the PDF that
 * contradicts the total printed beneath it, and issued orders are immutable.
 * `feeBreakdownReconciles` (src/lib/hireOrders/feeBasis.ts) is the shared
 * predicate; the PDF renderer applies it as a last-mile guard.
 */
export type OrderData =
  & Partial<Record<OrderFieldKey, FieldValue>>
  & { engagement_dates?: FieldValue<EngagementDate[]> };

export interface FieldLayers {
  showflow?: Partial<Record<EditableOrderFieldKey, unknown>>;
  sheet?: Partial<Record<EditableOrderFieldKey, unknown>>;
  manual?: Partial<Record<EditableOrderFieldKey, unknown>>;
  defaults?: Partial<Record<EditableOrderFieldKey, unknown>>;
}
