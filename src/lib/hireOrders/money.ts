// Hire order money formatting — display only, never computes with floats.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same logic
// (the two runtimes cannot share an import). Change both files in the same commit.

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
 */
export function formatMoney(amount: string | number, currency: string): string {
  const numeric = typeof amount === "string" ? Number(amount) : amount;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${formatted}`;
}
