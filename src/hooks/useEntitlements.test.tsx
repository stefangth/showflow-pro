import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/entitlements", () => ({ fetchEntitlements: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchEntitlements } from "@/data/entitlements";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { partialMock } from "@/test/castHelpers";
import { useModuleGate } from "./useEntitlements";

const ORG = { id: "org-1", name: "Acme", slug: "acme", status: "active" };

function mockAuth(over: Partial<ReturnType<typeof useAuth>> = {}) {
  vi.mocked(useAuth).mockReturnValue(
    partialMock<ReturnType<typeof useAuth>>({
      currentOrg: ORG,
      isSuperAdmin: false,
      roles: [],
      viewAsRole: null,
      viewAsUser: null,
      ...over,
    }),
  );
}

async function gate() {
  const { result } = renderHookWithProviders(() => useModuleGate("booking_flow"));
  await waitFor(() => expect(result.current.pending).toBe(false));
  return result.current;
}

describe("useModuleGate view-as", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // booking_flow defaults ON, so an explicit disabled row is needed to turn it off.
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: false }]);
  });

  it("keeps god-mode for a super-admin who is NOT previewing", async () => {
    mockAuth({ isSuperAdmin: true });
    expect((await gate()).allow).toBe(true);
  });

  it("keeps god-mode when a super-admin views as a role they already hold", async () => {
    // Selecting your own role is not impersonation, so the exemption stays and the
    // pencil stays un-red — the gate and the indicator agree.
    mockAuth({ isSuperAdmin: true, roles: ["admin"], viewAsRole: "admin" });
    expect((await gate()).allow).toBe(true);
  });

  it("gates a super-admin previewing a role they do not hold", async () => {
    mockAuth({ isSuperAdmin: true, roles: ["admin"], viewAsRole: "producer" });
    expect((await gate()).allow).toBe(false);
  });

  it("gates a super-admin previewing as a specific user", async () => {
    mockAuth({ isSuperAdmin: true, viewAsUser: { id: "u1", email: "a@b.c", roles: ["artist"] } });
    expect((await gate()).allow).toBe(false);
  });

  it("still allows a previewing super-admin when the module is actually on", async () => {
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: true }]);
    mockAuth({ isSuperAdmin: true, roles: ["admin"], viewAsRole: "producer" });
    expect((await gate()).allow).toBe(true);
  });
});
