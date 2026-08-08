#!/usr/bin/env node
//
// Secret scanner — blocks committed credentials from ever reaching GitHub.
//
// WHY THIS EXISTS: a live Resend API key was hardcoded into the tracked
// `.mcp.json` by a cloud coding session and pushed to GitHub (twice). A local
// git hook is useless against that class of leak — it never runs in a cloud
// session. So this scanner runs in TWO places:
//   1. the CI "Lint" job (see .github/workflows/ci.yml) — runs on every PR/push,
//      including cloud-session commits and any `git push --no-verify` bypass.
//      This is the layer that would have caught the original leak.
//   2. the pre-push hook (.githooks/pre-push) — fast local feedback so a secret
//      fails on your machine before it ever leaves it.
//
// SCOPE: only git-TRACKED files (`git ls-files`). Untracked / gitignored files
// (`.env`, `.env.development.local`, …) never reach the remote, so scanning them
// would just produce noise about secrets that are supposed to stay local.
//
// PATTERNS are deliberately high-signal (provider-prefixed + enough random tail)
// so real credentials match while placeholders and fixtures do not. Public
// values that are committed on PURPOSE — notably the Supabase anon JWT in
// `.env.development` — are intentionally NOT matched.
//
// ESCAPE HATCH: to commit a string that legitimately trips a pattern (a doc
// example, a test fixture), put `scan-secrets:allow` anywhere on that line.
//
// Guarded by scripts/scanSecrets.test.mjs (runs in the vitest suite), so a
// regression that neuters the scanner fails CI.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Inline marker that whitelists a single line (deliberate non-secret fixtures). */
export const ALLOW_MARKER = "scan-secrets:allow";

/**
 * High-signal secret patterns. Each requires a provider-specific prefix and
 * enough random tail that a real credential matches but short placeholders
 * (`re_test`, `re_x`) and env references (`${RESEND_API_KEY}`) do not.
 */
export const SECRET_PATTERNS = [
  // Resend — the exact shape that leaked: re_<seg>_<longtail>. The `re_test`,
  // `re_x`, `re_test_key` stubs used across the edge-function tests are far too
  // short to match either form, so this never breaks those suites.
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,}\b/ },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{24,}\b/ },
  // AWS access key id.
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  // Stripe live secret key (test keys sk_test_ are intentionally not flagged).
  { name: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{20,}\b/ },
  // GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_).
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  // Slack tokens.
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  // Any PEM private key block.
  {
    name: "Private key block",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
];

/** Show enough of a match to identify it without reprinting the secret in logs. */
export function redact(secret) {
  if (secret.length <= 8) return "***";
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}

/**
 * Scan one file's text. Returns an array of { line, name, snippet } findings.
 * Lines carrying ALLOW_MARKER are skipped.
 */
export function scanContent(text) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(ALLOW_MARKER)) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      const m = re.exec(line);
      if (m) findings.push({ line: i + 1, name, snippet: redact(m[0]) });
    }
  }
  return findings;
}

/** Files that document or fixture the patterns themselves — skipped wholesale. */
const SKIP_FILES = new Set([
  "scripts/scan-secrets.mjs",
  "scripts/scanSecrets.test.mjs",
]);

/** Treat a NUL byte in the first 8KB as a binary file (skip it). */
function isProbablyText(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return false;
  return true;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

/** Scan every tracked text file. Returns an array of { file, line, name, snippet }. */
export function scanRepo() {
  const results = [];
  for (const rel of trackedFiles()) {
    if (SKIP_FILES.has(rel)) continue;
    let buf;
    try {
      buf = readFileSync(join(repoRoot, rel));
    } catch {
      continue; // e.g. a deleted-but-staged path; nothing to scan
    }
    if (!isProbablyText(buf)) continue;
    for (const f of scanContent(buf.toString("utf8"))) {
      results.push({ file: rel, ...f });
    }
  }
  return results;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = scanRepo();
  if (hits.length === 0) {
    console.log("scan-secrets: clean — no credentials found in tracked files.");
    process.exit(0);
  }
  console.error(`\nscan-secrets: found ${hits.length} potential secret(s):\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  ${h.name}  [${h.snippet}]`);
  }
  console.error(
    "\nSecrets must never be committed. Move the value to an environment variable\n" +
      "or a Supabase Edge Function secret and reference it instead. If this is a\n" +
      `deliberate non-secret example, add "${ALLOW_MARKER}" on that line.\n`,
  );
  process.exit(1);
}
