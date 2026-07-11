/**
 * Canonical origin of the ShowFlow *app* (app.showflow.pro) — NOT the marketing site
 * at showflow.pro, which has no application routes. Every link in a transactional
 * email or notification must be built from this so it resolves in the app (e.g.
 * /accept-invite, /availability, /platform). Override with the APP_URL edge secret
 * (staging/custom domains); it wins over the default.
 */
export const DEFAULT_APP_URL = "https://app.showflow.pro";

/**
 * Resolve the configured app origin: the APP_URL env var (trailing slashes trimmed)
 * when set to a non-blank value, otherwise DEFAULT_APP_URL. `getEnv` is injectable so
 * edge-function handlers can pass their DI'd `deps.env` and tests can pass a stub.
 */
export function appUrl(
  getEnv: (key: string) => string | undefined = (k) => Deno.env.get(k),
): string {
  const v = getEnv("APP_URL")?.trim().replace(/\/+$/, "");
  return v && v.length > 0 ? v : DEFAULT_APP_URL;
}

/** App origin resolved from the ambient environment at module load. */
export const APP_URL = appUrl();
