/**
 * Required client env vars, checked at boot. If any are missing the Supabase
 * client's `createClient(undefined, ...)` throws at import time and the whole
 * SPA fails to mount with a blank screen (production outage, see the #178 env
 * regression). `main.tsx` uses this to render a legible config-error screen
 * instead — and to gate the `App` import so the throwing module never loads.
 */
export interface ClientEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

const REQUIRED_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"] as const;

/** Names of required env vars that are absent or blank. Empty array = all present. */
export function missingClientEnv(env: ClientEnv): string[] {
  return REQUIRED_ENV.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim() === "";
  });
}
