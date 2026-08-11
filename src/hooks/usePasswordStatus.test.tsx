import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePasswordStatus, useSetMyPassword } from "./usePasswordStatus";

const state = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, rpcResult: { data: true, error: null as unknown } }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(() => Promise.resolve(state.rpcResult)),
    auth: { updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null })) },
  },
}));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

describe("usePasswordStatus", () => {
  beforeEach(() => { state.user = { id: "u1" }; state.rpcResult = { data: true, error: null }; });

  it("uses the auth password query key and returns the boolean result", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => usePasswordStatus(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(true));
    expect(client.getQueryData(["auth", "has-password"])).toBe(true);
  });

  it("exposes RPC errors", async () => {
    state.rpcResult = { data: null as never, error: new Error("rpc failed") };
    const { wrapper } = setup();
    const { result } = renderHook(() => usePasswordStatus(), { wrapper });
    await waitFor(() => expect(result.current.error).toEqual(new Error("rpc failed")));
  });

  it("does not query without an authenticated user", () => {
    state.user = null;
    const { wrapper } = setup();
    const { result } = renderHook(() => usePasswordStatus(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("invalidates password status after a successful setup", async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetMyPassword(), { wrapper });
    await result.current.mutateAsync("new-secret");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["auth", "has-password"] });
  });
});
