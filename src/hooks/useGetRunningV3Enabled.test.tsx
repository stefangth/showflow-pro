import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { useGetRunningV3Enabled, useSetGetRunningV3Enabled } from "./useGetRunningV3Enabled";

const ORG_ID = "org-1";
const TEST_ORG = { id: ORG_ID, name: "Test Org", slug: "test-org", status: "active", is_demo: false };

describe("useGetRunningV3Enabled", () => {
  it("resolves the org override to true", async () => {
    seed({
      app_settings: { data: [{ org_id: ORG_ID, key: "getrunning_v3_enabled", value: true }], error: null },
    });

    const { result } = renderHookWithProviders(() => useGetRunningV3Enabled(), {
      authOverrides: { currentOrg: TEST_ORG },
    });

    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("defaults to v3 on while there is no active org", async () => {
    seed({ app_settings: { data: [], error: null } });

    const { result } = renderHookWithProviders(() => useGetRunningV3Enabled(), {
      authOverrides: { currentOrg: null },
    });

    // No org id: the query never fires (enabled: !!orgId), so isLoading stays false and
    // `enabled` reports the v3 default (v3 is the app default now) rather than hanging.
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });
});

describe("useSetGetRunningV3Enabled", () => {
  it("writes the org override and invalidates app-settings", async () => {
    seed({ app_settings: { data: [], error: null } });

    const { result, queryClient } = renderHookWithProviders(() => useSetGetRunningV3Enabled(), {
      authOverrides: { currentOrg: TEST_ORG },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    result.current.mutate(true);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["app-settings"] });

    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.some((c) => c.table === "app_settings" && c.method === "upsert")).toBe(true);
  });

  it("rejects when there is no active org", async () => {
    const { result } = renderHookWithProviders(() => useSetGetRunningV3Enabled(), {
      authOverrides: { currentOrg: null },
    });

    result.current.mutate(true);

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
