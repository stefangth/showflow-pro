import type { Session } from "@supabase/supabase-js";

/** Config for {@link maybeDevAutoLogin}. The single call site reads these from
 *  `import.meta.env`; passing them in keeps the logic unit-testable and keeps
 *  the `import.meta.env` reads out of the tested code. */
export interface DevAutoLoginConfig {
  /** Opt-in flag from `VITE_DEV_AUTOLOGIN === 'true'`. When false, this no-ops. */
  optedIn: boolean;
  email?: string;
  password?: string;
}

/** The slice of `supabase.auth` this helper depends on. */
export interface DevAutoLoginAuth {
  getSession(): Promise<{ data: { session: Session | null } }>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ error: { message: string } | null }>;
}

/**
 * DEV-ONLY convenience: auto sign-in on the local Vite dev server so gated
 * routes render without stopping at the login screen.
 *
 * Safety model:
 * - The single call site wraps this in `if (import.meta.env.DEV)`, which Vite
 *   statically evaluates to `false` in any production build (`vite build`, what
 *   the host runs), so this whole path — and the credential env reads — is
 *   dead-code-eliminated from deployed bundles. It can never run on a deployed
 *   server, regardless of what env vars are set there.
 * - It performs an ordinary password sign-in; it does NOT bypass Supabase RLS.
 *   Server-side authorization is unchanged — the real security boundary is
 *   untouched.
 * - Credentials come only from local dev env vars (`VITE_DEV_AUTOLOGIN_*`):
 *   either a gitignored `.env` / `.env.development.local`, or the committed
 *   `.env.development`, which carries the SYNTHETIC seeded admin
 *   (`admin@example.com`) for the local Supabase stack — never a real account,
 *   and never set in the hosting provider. With the DEV guard above, these
 *   reads are stripped from any deployed build regardless.
 *
 * No-ops when not opted in, when credentials are absent, or when a session
 * already exists (a persisted login is never overridden).
 */
export async function maybeDevAutoLogin(auth: DevAutoLoginAuth, config: DevAutoLoginConfig): Promise<void> {
  if (!config.optedIn) return;
  if (!config.email || !config.password) {
    console.warn(
      "[dev auto-login] VITE_DEV_AUTOLOGIN is on but VITE_DEV_AUTOLOGIN_EMAIL/PASSWORD are not set — skipping.",
    );
    return;
  }
  const {
    data: { session },
  } = await auth.getSession();
  if (session) return; // already signed in (persisted session) — don't fight it
  const { error } = await auth.signInWithPassword({ email: config.email, password: config.password });
  if (error) console.warn("[dev auto-login] sign-in failed:", error.message);
}
