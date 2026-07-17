// Hire order pure-logic types + field key registry.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same types +
// resolveFields + orderNo + money + validate logic in one file (the two
// runtimes cannot share an import). Change both files in the same commit.

export type FieldSource = "showflow" | "sheet" | "manual" | "default";

export interface FieldValue<T = unknown> {
  value: T;
  source: FieldSource;
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
  | "notes";

/** Fixed iteration order for resolveFields and any UI that lists order fields. */
export const ORDER_FIELD_KEYS: OrderFieldKey[] = [
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

export type OrderData = Partial<Record<OrderFieldKey, FieldValue>>;

export interface FieldLayers {
  showflow?: Partial<Record<OrderFieldKey, unknown>>;
  sheet?: Partial<Record<OrderFieldKey, unknown>>;
  manual?: Partial<Record<OrderFieldKey, unknown>>;
  defaults?: Partial<Record<OrderFieldKey, unknown>>;
}
