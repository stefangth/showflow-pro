import { z } from "zod";

/** Read the `type` param (recovery|invite|…) from a URL hash like `#access_token=…&type=recovery`. */
export function parseRecoveryHash(hash: string): { type: string | null } {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return { type: new URLSearchParams(h).get("type") };
}

/** Backslash, plus every C0 control and DEL — the characters the URL parser folds or strips. */
// eslint-disable-next-line no-control-regex -- matching control characters is the entire point
const UNSAFE_REDIRECT_CHARS = /[\\\u0000-\u001F\u007F]/;

/**
 * Return `redirect` only when it is a safe in-app relative path; otherwise `fallback`.
 *
 * Two families of character are rejected outright, both because the WHATWG URL parser rewrites
 * them before the `//` check can mean anything:
 *   - `\` is folded into `/`, so `/\evil.com` resolves cross-origin.
 *   - ASCII tab, LF and CR are *removed* entirely, so `/<TAB>/evil.com` becomes `//evil.com`.
 *     `?redirect=/%09/evil.com` is enough to deliver one, since URLSearchParams.get() decodes.
 * Either way React Router's history falls back to `location.assign` when the resulting
 * pushState throws SecurityError, which is the open redirect behind CVE-2026-53669 /
 * CVE-2025-68470. The v6 line has no patch for it (fixed only in 7.18.0), so the clamp carries
 * the guarantee. The whole C0 range is refused rather than just those three: no legitimate
 * in-app path contains a control character, so the wider net costs nothing. Ordinary
 * characters that merely get percent-encoded (a space, say) stay same-origin and are allowed.
 *
 * Mirrored by `safeRedirectPath` in supabase/functions/send-login-link/index.ts — keep both
 * in step.
 */
export function safeRelativeRedirect(redirect: string | null, fallback: string): string {
  if (!redirect) return fallback;
  if (!redirect.startsWith("/") || redirect.startsWith("//")) return fallback;
  if (UNSAFE_REDIRECT_CHARS.test(redirect)) return fallback;
  return redirect;
}

export const MIN_PASSWORD_LENGTH = 8;

export const newPasswordSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
