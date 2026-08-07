import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/entitlements", () => ({ fetchEntitlements: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchEntitlements } from "@/data/entitlements";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { useModuleGate } from "./useEntitlements";

function mockAuth(over: { isSuperAdmin?: boolean; viewAsRole?: string | null; viewAsUser?: unknown }) {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: "org-1" },
    isSuperAdmin: false,
    viewAsRole: null,
    viewAsUser: null,
    ...over,
  } as never);
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
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: false }] as never);
  });

  it("keeps god-mode for a super-admin who is NOT previewing", async () => {
    mockAuth({ isSuperAdmin: true });
    expect((await gate()).allow).toBe(true);
  });

  it("gates a super-admin previewing as a role", async () => {
    mockAuth({ isSuperAdmin: true, viewAsRole: "producer" });
    expect((await gate()).allow).toBe(false);
  });

  it("gates a super-admin previewing as a specific user", async () => {
    mockAuth({ isSuperAdmin: true, viewAsUser: { id: "u1", email: "a@b.c", roles: ["artist"] } });
    expect((await gate()).allow).toBe(false);
  });

  it("still allows a previewing super-admin when the module is actually on", async () => {
    vi.mocked(fetchEntitlements).mockResolvedValue([{ feature: "booking_flow", enabled: true }] as never);
    mockAuth({ isSuperAdmin: true, viewAsRole: "producer" });
    expect((await gate()).allow).toBe(true);
  });
});
