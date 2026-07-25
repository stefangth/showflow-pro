import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inflateFontGzB64 } from "./fontInflate";
import {
  GEIST_MEDIUM_GZ_B64,
  GEIST_MONO_REGULAR_GZ_B64,
  GEIST_REGULAR_GZ_B64,
  GEIST_SEMIBOLD_GZ_B64,
} from "./fonts";

// PROOF, NOT A SELF-CHECK: this compares the round-tripped bytes against the
// raw TTF base64 that was committed *before* fonts.ts switched to storing
// gzip-compressed bytes, read straight out of git history — not against
// anything this session generated. A generator bug that gzips the wrong
// input, or an inflate bug that happens to be self-consistent with a broken
// generator, would still be caught here, because the expected side never
// touches scripts/compress-fonts.mjs or fontInflate.ts at all.
//
// PRE_COMPRESSION_SHA is the last commit where fonts.ts held plain
// base64-of-raw-TTF (the four `*_B64` exports, no gzip layer). It is an
// ancestor of every commit on this branch from here on, so `git show` against
// it keeps working regardless of how much history piles up afterwards.
const PRE_COMPRESSION_SHA = "63b5b6a00af295e1040bdc423a9176a345484712";

/** Reads one `export const NAME = "...";` literal out of a git-historical
 *  fonts.ts and returns its raw decoded bytes (base64 -> bytes, no gzip
 *  layer existed at this commit). */
function rawBytesFromHistory(constName: string): Buffer {
  const text = execFileSync(
    "git",
    ["show", `${PRE_COMPRESSION_SHA}:src/lib/hireOrders/pdf/fonts.ts`],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const re = new RegExp(`export const ${constName} =\\n\\s*"([^"]+)";`);
  const match = re.exec(text);
  if (!match) {
    throw new Error(`could not find export const ${constName} in ${PRE_COMPRESSION_SHA}:fonts.ts`);
  }
  return Buffer.from(match[1], "base64");
}

describe("inflateFontGzB64 (round-trip proof against git history)", () => {
  // [label, gz-b64 export (current), pre-compression export name it replaced]
  const cases: Array<[string, string, string]> = [
    ["Geist-Regular.ttf", GEIST_REGULAR_GZ_B64, "GEIST_REGULAR_B64"],
    ["Geist-Medium.ttf", GEIST_MEDIUM_GZ_B64, "GEIST_MEDIUM_B64"],
    ["Geist-SemiBold.ttf", GEIST_SEMIBOLD_GZ_B64, "GEIST_SEMIBOLD_B64"],
    ["GeistMono-Regular.ttf", GEIST_MONO_REGULAR_GZ_B64, "GEIST_MONO_REGULAR_B64"],
  ];

  it.each(cases)("%s inflates to byte-identical pre-compression bytes", async (_label, gzB64, preCompressionConstName) => {
    const expectedRawBytes = rawBytesFromHistory(preCompressionConstName);

    const inflatedB64 = await inflateFontGzB64(gzB64);
    const actualRawBytes = Buffer.from(inflatedB64, "base64");

    expect(actualRawBytes.equals(expectedRawBytes)).toBe(true);
    // A real sfnt/TTF signature, so a passing byte-comparison above can't be
    // hiding two empty buffers agreeing with each other.
    expect(expectedRawBytes.length).toBeGreaterThan(100_000);
    expect(expectedRawBytes[0]).toBe(0x00);
    expect(expectedRawBytes[1]).toBe(0x01);
    expect(expectedRawBytes[2]).toBe(0x00);
    expect(expectedRawBytes[3]).toBe(0x00);
  });
});
