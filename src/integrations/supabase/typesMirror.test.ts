import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Deno edge runtime cannot import from src/, so the generated Database
// types are dual-homed (same pattern as entitlements.ts). This test is the
// sync contract: regenerate types.ts -> re-copy the mirror in the same commit.
describe("database types mirror", () => {
  it("supabase/functions/_shared/database.types.ts is byte-identical to the generated types", () => {
    const generated = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const mirror = readFileSync("supabase/functions/_shared/database.types.ts", "utf8");
    expect(mirror).toBe(generated);
  });
});
