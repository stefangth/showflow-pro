import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/data/capabilities", () => ({ fetchCapabilityState: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { fetchCapabilityState } from "@/data/capabilities";
import { useCapabilities, useCapability, useCan } from "./useCapabilities";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe("useCapabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
  });

  it("resolves the enabled capability set for the current org", async () => {
    vi.mocked(fetchCapabilityState).mockResolvedValue({
      overrides: [{ capability: "producer_can_invite", enabled: true }],
      policies: [],
    });

    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapper() });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.capabilities.has("producer_can_invite")).toBe(true);
    expect(fetchCapabilityState).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("does not fetch without a current org", () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: null,
      hasRole: (r: string) => r === "producer",
    } as never);
    renderHook(() => useCapabilities(), { wrapper: wrapper() });
    expect(fetchCapabilityState).not.toHaveBeenCalled();
  });
});

describe("useCapability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
  });

  it("returns the registry default (false) while loading, then the resolved value", async () => {
    // producer_can_rename_org defaults to off (sensitive right), unlike producer_can_invite
    // which defaults on (see src/lib/capabilities.ts).
    vi.mocked(fetchCapabilityState).mockResolvedValue({
      overrides: [{ capability: "producer_can_rename_org", enabled: true }],
      policies: [],
    });
    const { result } = renderHook(() => useCapability("producer_can_rename_org"), { wrapper: wrapper() });
    expect(result.current).toBe(false); // default while loading
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when the org row disables the capability", async () => {
    vi.mocked(fetchCapabilityState).mockResolvedValue({
      overrides: [{ capability: "producer_can_invite", enabled: false }],
      policies: [],
    });
    const { result } = renderHook(() => useCapability("producer_can_invite"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe("useCan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("admins can do everything regardless of capability state", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "admin",
    } as never);
    vi.mocked(fetchCapabilityState).mockResolvedValue({ overrides: [], policies: [] });

    const { result } = renderHook(() => useCan("rename_org"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("producers get the registry default when there is no override (rename off, issue on)", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(fetchCapabilityState).mockResolvedValue({ overrides: [], policies: [] });

    const w = wrapper();
    const rename = renderHook(() => useCan("rename_org"), { wrapper: w });
    const issue = renderHook(() => useCan("issue_hire_orders"), { wrapper: w });
    await waitFor(() => {
      expect(rename.result.current).toBe(false);
      expect(issue.result.current).toBe(true);
    });
  });

  it("a lock forces the platform value over an org override", async () => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Acme" },
      hasRole: (r: string) => r === "producer",
    } as never);
    vi.mocked(fetchCapabilityState).mockResolvedValue({
      overrides: [{ capability: "producer_can_issue_hire_orders", enabled: true }],
      policies: [{ capability: "producer_can_issue_hire_orders", enabled: false, locked: true }],
    });

    const { result } = renderHook(() => useCan("issue_hire_orders"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
