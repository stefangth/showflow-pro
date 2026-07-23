import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Deno edge runtime cannot import from src/, so the capability registry is
// dual-homed. This test is the sync contract: the block between the sentinels
// must be byte-identical in both files. Change both in the same commit.
const START = "// >>> CAPABILITY REGISTRY MIRROR (keep byte-identical with the twin file) >>>";
const END = "// <<< CAPABILITY REGISTRY MIRROR <<<";

function block(path: string): string {
  const text = readFileSync(path, "utf8");
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (s === -1 || e === -1) throw new Error(`mirror sentinels not found in ${path}`);
  return text.slice(s, e + END.length);
}

describe("capabilities registry mirror", () => {
  it("src/lib/capabilities.ts and _shared/capabilities.ts share a byte-identical registry block", () => {
    expect(block("supabase/functions/_shared/capabilities.ts")).toBe(block("src/lib/capabilities.ts"));
  });
});
