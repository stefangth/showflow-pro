import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// render.tsx is dual-homed so the settings editor can preview the REAL
// document in the browser instead of a lookalike. The generated edge copy
// (like every "file"-mode entry in scripts/mirrors.manifest.json) carries a
// 3-line "GENERATED FILE" header, so it is never byte-identical to its
// source - a raw readFileSync-equality check would fail even when the two
// are perfectly in sync. pdfCopyMirror.test.ts already asserts the correct
// thing (`syncMirrors({ check: true }).stale` is empty) for every manifest
// entry, which as of this file includes render.tsx and docTypes.ts, so this
// file does not repeat that check.
//
// The only per-runtime differences (which @react-pdf/renderer build, how
// fonts register) live in pdfDeps.ts, which is deliberately NOT mirrored.
describe("hire-order pdf render mirror", () => {
  it("pdfDeps.ts is NOT mirrored (it is the per-runtime shim)", () => {
    const a = readFileSync("src/lib/hireOrders/pdf/pdfDeps.ts", "utf8");
    const b = readFileSync("supabase/functions/_shared/hire-order-pdf/pdfDeps.ts", "utf8");
    expect(a).not.toBe(b);
  });

  it("render.tsx imports only from paths that resolve identically on both runtimes", () => {
    const source = readFileSync("src/lib/hireOrders/pdf/render.tsx", "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    // ./pdfDeps.ts is the deliberately-divergent per-runtime shim. ./docTypes.ts,
    // ./pdfCopy.ts and ./pdfTheme.ts are dual-homed "file"-mode mirror pairs in
    // the same directory on both sides. ../feeBasis.ts and ../money.ts are ALSO
    // dual-homed mirror pairs (e.g. src/lib/hireOrders/feeBasis.ts <->
    // supabase/functions/_shared/feeBasis.ts), one directory above render.tsx
    // on both sides, so those relative specifiers resolve identically too.
    const allowed = ["./pdfDeps.ts", "./docTypes.ts", "./pdfCopy.ts", "./pdfTheme.ts", "../feeBasis.ts", "../money.ts"];
    for (const specifier of imports) {
      expect(allowed).toContain(specifier);
    }
  });
});
