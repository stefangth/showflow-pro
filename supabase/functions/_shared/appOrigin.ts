import type { Deps } from "./deps.ts";
import { appUrl } from "./app-url.ts";

/**
 * Return `candidate` iff it is an allowlisted app origin, else null. The allowlist is the
 * canonical app origin (APP_URL or the prod default) plus the committed local-stack dev
 * origins. The localhost ports are allowed UNCONDITIONALLY (not gated on canonical being
 * localhost) because the local edge runtime has no APP_URL, so canonical resolves to prod;
 * gating would reject :8080 locally and mint a production redirect. A foreign host is never
 * allowlisted, so an open-redirect / phishing origin can never be minted into an auth link.
 */
export function safeAppOrigin(candidate: string | undefined, deps: Deps): string | null {
  if (!candidate) return null;
  let trimmed: string;
  try {
    // Normalise and validate as a URL; reject syntactic garbage.
    const u = new URL(candidate);
    trimmed = `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
  const canonical = appUrl(deps.env).replace(/\/+$/, "");
  const allow = new Set([canonical, "http://localhost:8080", "http://127.0.0.1:8080"]);
  return allow.has(trimmed) ? trimmed : null;
}
