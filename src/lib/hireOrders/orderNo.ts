// Hire order number formatting + collision suffixing.
// MIRROR: supabase/functions/_shared/hireOrders.ts carries the same logic
// (the two runtimes cannot share an import). Change both files in the same commit.

/**
 * Render an order-number pattern. Supported tokens: {prefix}, {yyyy}, {mm},
 * {dd}, {mmdd}, {seq} (per-artist sequence, always numeric), {cast} (cast code
 * when present, else ""), and {cast|seq} (cast code when present, else seq — the
 * legacy token, kept for orgs that configured it).
 *
 * The default pattern uses {seq} so every artist on a date gets a DISTINCT base
 * number; {cast|seq} collapsed a whole cast to one base, leaving the collision
 * suffix as the only differentiator.
 *
 * `date` arrives as a `YYYY-MM-DD` string; sliced directly (no Date parsing)
 * to avoid timezone drift — see src/lib/dates.ts for why that hazard exists.
 */
export function formatOrderNo(
  pattern: string,
  parts: { prefix: string; date?: string; castCode?: string; seq: number },
): string {
  const { prefix, date, castCode, seq } = parts;
  const yyyy = date ? date.slice(0, 4) : "";
  const mm = date ? date.slice(5, 7) : "";
  const dd = date ? date.slice(8, 10) : "";
  const mmdd = `${mm}${dd}`;
  const castOrSeq = castCode ?? String(seq);

  return pattern
    .replace(/\{prefix\}/g, prefix)
    .replace(/\{yyyy\}/g, yyyy)
    .replace(/\{mmdd\}/g, mmdd)
    .replace(/\{mm\}/g, mm)
    .replace(/\{dd\}/g, dd)
    // {cast|seq} first: it contains the substrings "cast" and "seq" but must be
    // replaced as a whole before the standalone {cast}/{seq} tokens are matched.
    .replace(/\{cast\|seq\}/g, castOrSeq)
    .replace(/\{cast\}/g, castCode ?? "")
    .replace(/\{seq\}/g, String(seq));
}

/**
 * Append a collision suffix for retrying a colliding order number.
 * attempt 0 => unchanged, 1 => "-2", 2 => "-3" (attempt N => suffix N+1).
 */
export function withCollisionSuffix(orderNo: string, attempt: number): string {
  if (attempt <= 0) return orderNo;
  return `${orderNo}-${attempt + 1}`;
}
