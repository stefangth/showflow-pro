import { describe, expect, it } from "vitest";
import { syncMirrors } from "../../../../scripts/sync-mirrors.mjs";

// The edge runtime cannot import from src/, so this file is dual-homed. It is
// GENERATED from its source by scripts/sync-mirrors.mjs; this test fails if the
// target was hand-edited or the source changed without a regen.
//
// This is a manifest-wide check (every entry in scripts/mirrors.manifest.json,
// not just pdfCopy.ts), so it also supersedes the old
// src/integrations/supabase/typesMirror.test.ts, which asserted the same
// property for the database-types mirror. That file was deleted rather than
// kept alongside this one to avoid two tests asserting the same thing.
describe("hire-order pdf copy mirror", () => {
  it("the generated target is in sync with its source", () => {
    expect(syncMirrors({ check: true }).stale).toEqual([]);
  });
});
