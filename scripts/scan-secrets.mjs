#!/usr/bin/env node
//
// Secret scanner — blocks committed credentials from ever reaching GitHub.
//
// WHY THIS EXISTS: a live Resend API key was hardcoded into the tracked
// `.mcp.json` by a cloud coding session and pushed to GitHub (twice). A local
// git hook is useless against that class of leak — it never runs in a cloud
// session. So the enforced gate is the CI "Lint" job (see
// .github/workflows/ci.yml), which runs on every PR/push including cloud-session
// commits and any `git push --no-verify` bypass. Locally it can be run by hand as
// `npm run scan:secrets` (snapshot) or with `--prepush` (history range); there is
// no auto-installed hook.
//
// TWO SCAN MODES:
//   • Snapshot (default / `scanRepo`): every git-TRACKED file at the current
//     tree. Catches a secret sitting in the working tree.
//   • History (`--range A..B` / `--prepush` / `scanRange`): the added lines of
//     EVERY commit in the pushed/PR range. This catches the incident shape a
//     snapshot misses — a secret added in commit A and removed in commit B
//     within the same push: the tree is clean at push time, but commit A still
//     carries the plaintext secret permanently in history. (Per-commit diff, so
//     an add-then-remove is still flagged.)
//
// SCOPE: git-tracked files only. Untracked / gitignored files (`.env`,
// `.env.development.local`, …) never reach the remote, so scanning them would
// just produce noise about secrets that are supposed to stay local.
//
// PATTERNS are deliberately high-signal (provider-prefixed + enough random tail)
// so real credentials match while placeholders and fixtures do not. The public
// Supabase ANON JWT (committed on purpose in .env.development) is NOT matched;
// but a Supabase SERVICE_ROLE JWT — same shape, and the single most damaging
// secret in this stack (it bypasses RLS) — IS matched, by decoding the JWT
// payload and flagging only `"role":"service_role"`.
//
// ESCAPE HATCH: to commit a string that legitimately trips a pattern (a doc
// example, a test fixture), put `scan-secrets:allow` anywhere on that line.
//
// Guarded by scripts/scanSecrets.test.mjs (runs in the vitest suite).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZERO_SHA = /^0+$/;

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

/** Matches a JWT (three base64url segments). Used only to decode + inspect role. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g;

/**
 * Return the first JWT in `text` whose decoded payload is a Supabase
 * service_role token, or null. Anon-role JWTs (the public, intentionally
 * committed anon key) decode to `"role":"anon"` and are deliberately ignored —
 * we flag ONLY service_role, the RLS-bypassing key.
 */
export function serviceRoleJwt(text) {
  JWT_RE.lastIndex = 0;
  let m;
  while ((m = JWT_RE.exec(text)) !== null) {
    const payloadSeg = m[0].split(".")[1];
    let payload;
    try {
      payload = Buffer.from(payloadSeg, "base64url").toString("utf8");
    } catch {
      continue;
    }
    if (/"role"\s*:\s*"service_role"/.test(payload)) return m[0];
  }
  return null;
}

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
      const match = re.exec(line);
      if (match) findings.push({ line: i + 1, name, snippet: redact(match[0]) });
    }
    const jwt = serviceRoleJwt(line);
    if (jwt) {
      findings.push({
        line: i + 1,
        name: "Supabase service_role JWT",
        snippet: redact(jwt),
      });
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

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

function trackedFiles() {
  return git(["ls-files", "-z"]).split("\0").filter(Boolean);
}

/** Scan every tracked text file at the current tree. Returns { file, line, name, snippet }[]. */
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

/**
 * Scan the ADDED lines of a unified diff (as produced by `git show/diff
 * --unified=0`). Attributes each finding to its file and new-file line number.
 * Returns { file, line, name, snippet }[].
 */
export function scanDiffText(diff) {
  const findings = [];
  let file = null;
  let newLine = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++")) {
      const path = raw.slice(3).trim().replace(/^b\//, "");
      file = path === "/dev/null" ? null : path;
      continue;
    }
    if (raw.startsWith("---")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+")) {
      const content = raw.slice(1);
      if (file && !SKIP_FILES.has(file)) {
        for (const f of scanContent(content)) {
          findings.push({ file, line: newLine, name: f.name, snippet: f.snippet });
        }
      }
      newLine++;
    } else if (raw.startsWith(" ")) {
      newLine++;
    }
    // "-" (removed) lines don't advance the new-file line counter.
  }
  return findings;
}

/**
 * Scan the added lines of every commit in `range` ("base..head"). Per-commit
 * (not net) diffs, so a secret added then removed within the range is still
 * flagged. Merge commits are skipped. Returns { commit, file, line, ... }[].
 */
export function scanRange(range) {
  let commits;
  try {
    commits = git(["rev-list", "--no-merges", range]).split("\n").filter(Boolean);
  } catch {
    return []; // unknown range (e.g. base object absent) — snapshot still runs
  }
  const results = [];
  for (const c of commits) {
    let diff;
    try {
      diff = git(["show", "--format=", "--unified=0", "--no-color", c]);
    } catch {
      continue;
    }
    for (const f of scanDiffText(diff)) results.push({ commit: c.slice(0, 7), ...f });
  }
  return results;
}

/** merge-base of `sha` with the remote default branch, or null. */
function remoteMergeBase(sha) {
  for (const ref of ["origin/main", "origin/HEAD"]) {
    try {
      return git(["merge-base", sha, ref]).trim();
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * pre-push mode: read git's ref-update lines from stdin
 * (`<localref> <localsha> <remoteref> <remotesha>`), scan the pushed history of
 * each, plus a snapshot of the current tree. Returns combined findings.
 */
function scanPrepush() {
  const findings = [...scanRepo()];
  let stdin = "";
  if (!process.stdin.isTTY) {
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      stdin = "";
    }
  }
  for (const line of stdin.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || ZERO_SHA.test(localSha)) continue; // branch deletion
    const base =
      remoteSha && !ZERO_SHA.test(remoteSha) ? remoteSha : remoteMergeBase(localSha);
    if (base) findings.push(...scanRange(`${base}..${localSha}`));
  }
  return findings;
}

function report(hits) {
  if (hits.length === 0) {
    console.log("scan-secrets: clean — no credentials found.");
    process.exit(0);
  }
  console.error(`\nscan-secrets: found ${hits.length} potential secret(s):\n`);
  for (const h of hits) {
    const loc = h.commit ? `${h.commit} ${h.file}:${h.line}` : `${h.file}:${h.line}`;
    console.error(`  ${loc}  ${h.name}  [${h.snippet}]`);
  }
  console.error(
    "\nSecrets must never be committed. Move the value to an environment variable\n" +
      "or a Supabase Edge Function secret and reference it instead. A history hit\n" +
      "means the secret is in a commit even if later removed — rotate it and scrub\n" +
      `the commit. Deliberate non-secret example? Add "${ALLOW_MARKER}" on the line.\n`,
  );
  process.exit(1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const rangeIdx = args.indexOf("--range");
  if (args.includes("--prepush")) {
    report(scanPrepush());
  } else if (rangeIdx !== -1 && args[rangeIdx + 1]) {
    report(scanRange(args[rangeIdx + 1]));
  } else {
    report(scanRepo());
  }
}
