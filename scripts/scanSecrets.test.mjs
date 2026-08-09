// Guards scripts/scan-secrets.mjs — the tracked-file secret scanner wired into
// the CI "Lint" job and the pre-push hook. A regression here would silently
// re-open the exact hole that leaked a Resend key: a hardcoded credential in a
// tracked file sailing through to GitHub.
//
// Imports the REAL module — never re-implements the patterns (per CLAUDE.md).
//
// Test secret strings are ASSEMBLED AT RUNTIME (concatenation / repeat / base64)
// so no complete key literal ever appears in this source file, keeping GitHub's
// own secret scanning quiet about the test itself.

import { describe, expect, it } from "vitest";
import {
  ALLOW_MARKER,
  redact,
  scanContent,
  scanDiffText,
  scanRange,
  scanRepo,
  serviceRoleJwt,
} from "./scan-secrets.mjs";

// A synthetic Resend key in the leaked shape (re_<seg>_<longtail>). Not real.
const fakeResendUnderscore = `re_${"a".repeat(8)}_${"b".repeat(24)}`;
const fakeResendContinuous = `re_${"c".repeat(28)}`;
const fakeAwsKey = `AKIA${"ABCDEFGHIJKLMNOP"}`; // AKIA + 16
const fakePem = "-----BEGIN RSA PRIVATE KEY-----";

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const jwt = (role) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ role, iss: "supabase" })}.sig_${"x".repeat(24)}`;
const serviceRoleToken = jwt("service_role");
const anonToken = jwt("anon");

describe("scanContent — catches real credential shapes", () => {
  it("flags a Resend key in the underscore form that actually leaked", () => {
    const hits = scanContent(`"RESEND_API_KEY": "${fakeResendUnderscore}"`);
    expect(hits.map((h) => h.name)).toContain("Resend API key");
  });

  it("flags a Resend key in the continuous form", () => {
    expect(scanContent(fakeResendContinuous).length).toBeGreaterThan(0);
  });

  it("flags an AWS access key id", () => {
    expect(scanContent(fakeAwsKey).map((h) => h.name)).toContain(
      "AWS access key id",
    );
  });

  it("flags a PEM private key block", () => {
    expect(scanContent(fakePem).map((h) => h.name)).toContain(
      "Private key block",
    );
  });
});

describe("service_role JWT detection", () => {
  it("flags a Supabase service_role JWT (the RLS-bypassing key)", () => {
    expect(serviceRoleJwt(serviceRoleToken)).toBeTruthy();
    expect(scanContent(`SUPABASE_SERVICE_ROLE_KEY=${serviceRoleToken}`).map((h) => h.name)).toContain(
      "Supabase service_role JWT",
    );
  });

  it("does NOT flag the public anon JWT (same shape, role=anon)", () => {
    expect(serviceRoleJwt(anonToken)).toBeNull();
    expect(scanContent(`VITE_SUPABASE_PUBLISHABLE_KEY=${anonToken}`)).toEqual([]);
  });
});

describe("scanContent — does NOT flag legitimate committed strings", () => {
  it("ignores the short Resend test stubs used across the edge-fn suites", () => {
    // These exact literals appear in supabase/functions/**/*.test.ts and must
    // never trip the scanner, or every edge-function test would fail to commit.
    for (const stub of ["re_test", "re_x", "re_test_key", "re_test_key_2"]) {
      expect(scanContent(`RESEND_API_KEY: "${stub}"`)).toEqual([]);
    }
  });

  it("ignores an env-variable reference placeholder", () => {
    expect(scanContent('"RESEND_API_KEY": "${RESEND_API_KEY}"')).toEqual([]);
  });
});

describe("scanContent — escape hatch", () => {
  it(`skips a line carrying the ${ALLOW_MARKER} marker`, () => {
    expect(
      scanContent(`key = "${fakeResendUnderscore}" // ${ALLOW_MARKER}`),
    ).toEqual([]);
  });
});

describe("scanDiffText — per-commit history scanning", () => {
  const diff = (path, sign, body) =>
    [
      `diff --git a/${path} b/${path}`,
      "index 0000000..1111111 100644",
      `--- a/${path}`,
      `+++ b/${path}`,
      sign === "+" ? "@@ -0,0 +1 @@" : "@@ -1 +0,0 @@",
      `${sign}${body}`,
    ].join("\n");

  it("flags a secret on an ADDED line, attributed to its file", () => {
    const hits = scanDiffText(diff("config.env", "+", `RESEND_API_KEY=${fakeResendUnderscore}`));
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("config.env");
    expect(hits[0].name).toBe("Resend API key");
  });

  it("does NOT flag a secret on a REMOVED line (the add-then-remove case is caught on the ADD commit, not here)", () => {
    expect(scanDiffText(diff("config.env", "-", `RESEND_API_KEY=${fakeResendUnderscore}`))).toEqual([]);
  });

  it("respects the SKIP_FILES exclusion for the scanner's own sources", () => {
    expect(
      scanDiffText(diff("scripts/scan-secrets.mjs", "+", `const k = "${fakeResendUnderscore}"`)),
    ).toEqual([]);
  });
});

describe("redact", () => {
  it("never returns the full secret", () => {
    const out = redact(fakeResendUnderscore);
    expect(out).not.toContain(fakeResendUnderscore);
    expect(out).toContain("…");
  });
});

describe("scanRepo / scanRange — the tracked tree and an empty range are clean", () => {
  it("finds no secrets in any tracked file (snapshot)", () => {
    // Doubles as an always-on guarantee: if any future commit adds a real
    // credential to a tracked file, this unit test (and CI) go red. Also
    // exercises the anon-JWT-not-flagged path against the real .env.development.
    expect(scanRepo()).toEqual([]);
  });

  it("scans an empty commit range without throwing", () => {
    expect(scanRange("HEAD..HEAD")).toEqual([]);
  });
});
