import * as React from "react";

const MOBILE_BREAKPOINT = 768;

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

// Subscribe to the media query via useSyncExternalStore rather than a
// setState-in-effect: the browser is the external store, and this reads its
// live value on every render without an effect. getServerSnapshot returns
// false so SSR/first paint treats the viewport as desktop (matches the old
// `!!isMobile` on undefined).
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  );
}
