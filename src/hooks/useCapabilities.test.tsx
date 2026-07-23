import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/capabilities", () => ({ fetchCapabilities: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchCapabilities } from "@/data/capabilities";
import { useCapabilities, useCapability } from "./useCapabilities";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("resolves the enabled capability set for the current org", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue([{ capability: "producer_can_invite", enabled: true }]);

    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.capabilities.has("producer_can_invite")).toBe(true);
    expect(fetchCapabilities).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("does not fetch without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({ currentOrg: null } as never);
    renderHook(() => useCapabilities(), { wrapper: wrapper() });
    expect(fetchCapabilities).not.toHaveBeenCalled();
  });
});

describe("useCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: "org-1" } } as never);
  });

  it("returns the registry default (false) while loading, then the resolved value", async () => {
    // producer_can_rename_org defaults to off (sensitive right), unlike producer_can_invite
    // which now defaults on (see src/lib/capabilities.ts).
    vi.mocked(fetchCapabilities).mockResolvedValue([{ capability: "producer_can_rename_org", enabled: true }]);
    const { result } = renderHook(() => useCapability("producer_can_rename_org"), { wrapper: wrapper() });
    expect(result.current).toBe(false); // default while loading
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when the org row disables the capability", async () => {
    vi.mocked(fetchCapabilities).mockResolvedValue([{ capability: "producer_can_invite", enabled: false }]);
    const { result } = renderHook(() => useCapability("producer_can_invite"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
