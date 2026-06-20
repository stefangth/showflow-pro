/** True when an Airtable Status value matches the configured "Cancelled" option,
 *  case- and whitespace-insensitively. Empty/null config or value → false. */
export function isCancelledStatus(raw: unknown, cancelledValue: string | null | undefined): boolean {
  const target = (cancelledValue ?? "").trim().toLowerCase();
  if (target === "") return false;
  return String(raw ?? "").trim().toLowerCase() === target;
}
