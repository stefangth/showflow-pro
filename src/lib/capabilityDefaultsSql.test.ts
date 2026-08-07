import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAPABILITY_DEFS } from "./capabilities";

describe("capability_default SQL twin covers every registry key", () => {
  it("has a matching CASE arm and default for all 28 keys in the email-template migration", () => {
    const migration = readdirSync("supabase/migrations").find((file) =>
      file.endsWith("_email_template_capability.sql"),
    );
    expect(migration, "missing email template capability migration").toBeDefined();
    const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
    for (const def of CAPABILITY_DEFS) {
      const arm = new RegExp(`when '${def.key}' then (true|false)`).exec(sql);
      expect(arm, `missing capability_default arm for ${def.key}`).not.toBeNull();
      expect(arm![1]).toBe(String(def.defaultEnabled));
    }
    expect(sql).toContain("when 'producer_can_edit_email_templates' then false");
  });
});
