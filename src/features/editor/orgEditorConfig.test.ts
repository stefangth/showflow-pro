import { describe, it, expect } from "vitest";
import { resolveEditorRows } from "./orgEditorConfig";

describe("resolveEditorRows", () => {
  it("prefers the org row over the platform row per key", () => {
    const rows = [
      { key: "editor_page_access", value: { "/x": ["admin"] }, org_id: null },
      { key: "editor_page_access", value: { "/x": ["producer"] }, org_id: "o1" },
    ];
    expect(resolveEditorRows(rows).pageAccess).toEqual({ "/x": ["producer"] });
  });
  it("falls back to platform when no org row", () => {
    const rows = [{ key: "editor_table_permissions", value: { t: { admin: "edit" } }, org_id: null }];
    expect(resolveEditorRows(rows).tablePermissions).toEqual({ t: { admin: "edit" } });
  });
  it("defaults to empty objects when absent", () => {
    expect(resolveEditorRows([])).toEqual({ pageAccess: {}, columnTemplates: {}, tablePermissions: {} });
  });
});
