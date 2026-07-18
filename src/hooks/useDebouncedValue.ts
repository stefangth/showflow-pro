import { useEffect, useState } from "react";

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delayMs`. Use it to keep an input controlled and responsive while deferring
 * the expensive downstream effect (a query, a filter) until the user pauses —
 * e.g. the hire-orders search box feeds every keystroke to the controlled input
 * but only the debounced value into the list query key, so typing doesn't fire
 * a DB round-trip per character.
 */
export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
