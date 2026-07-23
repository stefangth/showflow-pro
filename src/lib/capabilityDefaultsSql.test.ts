import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "./capabilities";

describe("capability_default SQL twin covers every registry key", () => {
  it("has a matching CASE arm and default for all 27 keys", () => {
    const sql = readFileSync("supabase/migrations/20260723141017_capability_layered_resolver.sql", "utf8");
    for (const def of CAPABILITY_DEFS) {
      const arm = new RegExp(`when '${def.key}' then (true|false)`).exec(sql);
      expect(arm, `missing capability_default arm for ${def.key}`).not.toBeNull();
      expect(arm![1]).toBe(String(def.defaultEnabled));
    }
  });
});
