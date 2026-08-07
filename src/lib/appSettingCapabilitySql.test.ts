import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app_setting_capability email-template mappings", () => {
  it("maps both editable email settings to the sensitive producer grant", () => {
    const migration = readdirSync("supabase/migrations").find((file) =>
      file.endsWith("_email_template_capability.sql"),
    );
    expect(migration, "missing email template capability migration").toBeDefined();
    const sql = readFileSync(`supabase/migrations/${migration}`, "utf8");

    expect(sql).toMatch(
      /when _key in \('email_copy','email_theme'\)\s+then 'producer_can_edit_email_templates'/,
    );
  });
});
