import { describe, it, expect } from "vitest";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useOrgKind } from "./useOrgKind";

const org = { id: "o1", name: "A", slug: "a", status: "active", is_demo: false, org_kind: "staffing" as const, org_kind_set_at: null };

describe("useOrgKind", () => {
  it("returns the current org's kind", () => {
    const { result } = renderHookWithProviders(() => useOrgKind(), { authOverrides: { currentOrg: org } });
    expect(result.current).toBe("staffing");
  });
  it("falls back to production with no org", () => {
    const { result } = renderHookWithProviders(() => useOrgKind(), { authOverrides: { currentOrg: null } });
    expect(result.current).toBe("production");
  });
});
