import { useEffect, useState } from "react";

/**
 * Latch a value the first time `ready` becomes true, computing it from
 * `computeInitial()` at that instant; stays `null` until then, and thereafter
 * changes only via the returned setter (explicit events). Optional `seed` starts
 * the value non-null immediately (used when a caller already knows the initial
 * value and must not wait for readiness). Shared by the Airtable connect
 * mode-switch and the rail's active-step so their "settled" definition can't drift.
 */
export function useLatchedOnReady<T>(
  ready: boolean,
  computeInitial: () => T,
  seed: T | null = null,
): [T | null, (v: T) => void] {
  const [value, setValue] = useState<T | null>(seed);
  useEffect(() => {
    if (value === null && ready) setValue(computeInitial());
    // computeInitial is read once at latch time by design — not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready]);
  return [value, setValue];
}
