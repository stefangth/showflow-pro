import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The copy registry is dual-homed because the Deno edge renderer can't import
// from src/. The two files must be byte-identical: the frontend shows defaults +
// reset, the edge renders from them and freezes them into the issue snapshot. If
// they drift, a preview and its issued PDF would use different wording. Edit one,
// edit the other in the same commit.
describe("hire-order pdf copy mirror", () => {
  it("src and edge pdfCopy.ts are byte-identical", () => {
    const a = readFileSync("src/lib/hireOrders/pdfCopy.ts", "utf8");
    const b = readFileSync(
      "supabase/functions/_shared/hire-order-pdf/pdfCopy.ts",
      "utf8",
    );
    expect(a).toBe(b);
  });
});
