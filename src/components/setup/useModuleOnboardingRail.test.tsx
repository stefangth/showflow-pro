import { it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Test Org" }, hasRole: (r: string) => r === "admin" }),
}));
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useModuleOnboardingRail } from "./useModuleOnboardingRail";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  seed({
    app_settings: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
  });
});

it("composes the booking module with its header copy and progress totals", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("booking_flow", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(5));
  expect(result.current.title).toBe("Get bookings running");
  expect(result.current.steps).toHaveLength(5);
  expect(result.current.progressFilled).toBe(0);
  expect(result.current.progressLabel).toContain("of 5");
});

it("composes the hire-orders module with its header copy and three steps", async () => {
  const { result } = renderHook(() => useModuleOnboardingRail("hire_orders", "org-1"), { wrapper });
  await waitFor(() => expect(result.current.progressTotal).toBe(3));
  expect(result.current.title).toBe("Get hire orders ready");
  expect(result.current.steps.map((s) => s.moduleKey)).toEqual(["hire_orders", "hire_orders", "hire_orders"]);
});
