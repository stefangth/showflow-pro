import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inflateFontGzB64 } from "./fontInflate";
import {
  GEIST_MEDIUM_GZ_B64,
  GEIST_MONO_REGULAR_GZ_B64,
  GEIST_REGULAR_GZ_B64,
  GEIST_SEMIBOLD_GZ_B64,
} from "./fonts";

// PROOF, NOT A SELF-CHECK: this compares the round-tripped bytes' SHA-256
// against hashes computed once, offline, from the raw TTF base64 that was
// committed *before* fonts.ts switched to storing gzip-compressed bytes.
// A generator bug that gzips the wrong input, or an inflate bug that happens
// to be self-consistent with a broken generator, would still be caught here,
// because the expected side never touches scripts/compress-fonts.mjs or
// fontInflate.ts at all.
//
// PRE_COMPRESSION_SHA is the last commit where fonts.ts held plain
// base64-of-raw-TTF (the four `*_B64` exports, no gzip layer). The hashes
// below are SHA-256 of those exports' base64-decoded bytes, computed once
// with:
//   git show <PRE_COMPRESSION_SHA>:src/lib/hireOrders/pdf/fonts.ts
// then base64-decoding each `export const *_B64` literal and hashing the raw
// bytes. They are hardcoded (not re-derived via `git show` at test time)
// because CI checks out with `fetch-depth: 1` (see actions/checkout@v4
// defaults) — PRE_COMPRESSION_SHA is not present in that shallow clone, so a
// git-history read fails there even though it works in any full local clone.
// If a font is ever intentionally changed, recompute its hash from the new
// pre-compression source with the same recipe and update the constant below.
const PRE_COMPRESSION_SHA = "63b5b6a00af295e1040bdc423a9176a345484712";

// Uses `node:crypto` (in-process hashing), not `node:child_process` — this
// does not shell out to any external process.
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("inflateFontGzB64 (round-trip proof against pre-compression hashes)", () => {
  // [label, gz-b64 export (current), expected SHA-256 of pre-compression raw
  // TTF bytes, pre-compression export name it replaced]
  const cases: Array<[string, string, string, string]> = [
    [
      "Geist-Regular.ttf",
      GEIST_REGULAR_GZ_B64,
      "5c8968eafb98a4c4f47033daf29e38e284a6f2a82eb017d171ab040fe7c4b615",
      "GEIST_REGULAR_B64",
    ],
    [
      "Geist-Medium.ttf",
      GEIST_MEDIUM_GZ_B64,
      "0090e004725f6f64b841715b4167920580f883fcf9b67fc6d744089103fec101",
      "GEIST_MEDIUM_B64",
    ],
    [
      "Geist-SemiBold.ttf",
      GEIST_SEMIBOLD_GZ_B64,
      "612ec98df33935354f39e81e54101656961ab6e5549f64b63eb57868ba7bab8d",
      "GEIST_SEMIBOLD_B64",
    ],
    [
      "GeistMono-Regular.ttf",
      GEIST_MONO_REGULAR_GZ_B64,
      "42d8ad2e610238e64e8abfcde3037c63f7850a73928742b7ab7229d897bcb155",
      "GEIST_MONO_REGULAR_B64",
    ],
  ];

  it.each(cases)(
    "%s inflates to bytes matching the pre-compression SHA-256",
    async (label, gzB64, expectedSha256, preCompressionConstName) => {
      const inflatedB64 = await inflateFontGzB64(gzB64);
      const actualBytes = Buffer.from(inflatedB64, "base64");
      const actualSha256 = sha256Hex(actualBytes);

      expect(
        actualSha256,
        `${label}: round-tripped bytes do not match the SHA-256 of ` +
          `\`export const ${preCompressionConstName}\` in ` +
          `src/lib/hireOrders/pdf/fonts.ts at commit ${PRE_COMPRESSION_SHA} ` +
          `(the last commit before fonts.ts stored gzip-compressed bytes). ` +
          `Re-derive with: git show ${PRE_COMPRESSION_SHA}:src/lib/hireOrders/pdf/fonts.ts ` +
          `then base64-decode the ${preCompressionConstName} literal and SHA-256 the raw bytes.`,
      ).toBe(expectedSha256);

      // A real sfnt/TTF signature, so a passing hash comparison above can't
      // be hiding an empty or truncated buffer that happens to hash right by
      // coincidence being mistaken for a match against a typo'd constant.
      expect(actualBytes.length).toBeGreaterThan(100_000);
      expect(actualBytes[0]).toBe(0x00);
      expect(actualBytes[1]).toBe(0x01);
      expect(actualBytes[2]).toBe(0x00);
      expect(actualBytes[3]).toBe(0x00);
    },
  );
});
