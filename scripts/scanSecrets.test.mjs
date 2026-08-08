// Guards scripts/scan-secrets.mjs — the tracked-file secret scanner wired into
// the CI "Lint" job and the pre-push hook. A regression here would silently
// re-open the exact hole that leaked a Resend key: a hardcoded credential in a
// tracked file sailing through to GitHub.
//
// Imports the REAL module — never re-implements the patterns (per CLAUDE.md).
//
// Test secret strings are ASSEMBLED AT RUNTIME (concatenation / repeat) so no
// complete key literal ever appears in this source file, keeping GitHub's own
// secret scanning quiet about the test itself.

import { describe, expect, it } from "vitest";
import {
  ALLOW_MARKER,
  redact,
  scanContent,
  scanRepo,
} from "./scan-secrets.mjs";

// A synthetic Resend key in the leaked shape (re_<seg>_<longtail>). Not real.
const fakeResendUnderscore = `re_${"a".repeat(8)}_${"b".repeat(24)}`;
const fakeResendContinuous = `re_${"c".repeat(28)}`;
const fakeAwsKey = `AKIA${"ABCDEFGHIJKLMNOP"}`; // AKIA + 16
const fakePem = "-----BEGIN RSA PRIVATE KEY-----";

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

  it("ignores the public Supabase anon JWT (committed on purpose)", () => {
    // A JWT shape — anon keys are public and live in .env.development. The
    // scanner deliberately has no JWT pattern so it never blocks them.
    const jwtish =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0." +
      "abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
    expect(scanContent(jwtish)).toEqual([]);
  });
});

describe("scanContent — escape hatch", () => {
  it(`skips a line carrying the ${ALLOW_MARKER} marker`, () => {
    expect(
      scanContent(`key = "${fakeResendUnderscore}" // ${ALLOW_MARKER}`),
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

describe("scanRepo — the tracked tree is currently clean", () => {
  it("finds no secrets in any tracked file", () => {
    // Doubles as an always-on guarantee: if any future commit adds a real
    // credential to a tracked file, this unit test (and CI) go red.
    expect(scanRepo()).toEqual([]);
  });
});
