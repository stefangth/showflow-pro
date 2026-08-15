// Hire order money formatting — display only, never computes with floats.
//
// DUAL-HOME PAIR: this file (edit here) generates supabase/functions/_shared/
// money.ts (the edge renderer can't import from src/). After editing, run
// `npm run sync:mirrors`; never hand-edit the generated target.
// _shared/hireOrders.ts re-exports formatMoney from the generated target so
// its existing importers are unaffected. No relative imports here, since the
// same body must run unchanged in both the browser bundle and the edge
// runtime (render.tsx imports it directly via ../money.ts).

/** Currency symbol prefix. CHF's trailing space is by design — preserve it. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
  USD: "$",
  CHF: "CHF ",
};

/**
 * Format an amount for display with a currency symbol, two decimals, and
 * thousands separators (e.g. "€4,500.00"). Formats only — the amount is
 * parsed for display purposes, never used in arithmetic; storage stays
 * `numeric(10,2)` in SQL.
 *
 * `locale` picks the digit-grouping/decimal separators only (en-US "4,500.50"
 * vs de "4.500,50"); the currency symbol prefix is fixed by `currency`. It is a
 * plain BCP-47 string, not the i18n singleton, so the body stays runtime-neutral
 * for the edge mirror: browser callers pass the active app language, and the edge
 * PDF renderer passes nothing, keeping its output byte-identical to before.
 */
export function formatMoney(amount: string | number, currency: string, locale = "en-US"): string {
  const numeric = typeof amount === "string" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${formatted}`;
}
