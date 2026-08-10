import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// Spy, not a stub: the REAL fields still render, but the step's draft is recorded per
// render. Unlike the DOM this keeps a history, so the FIRST render stays inspectable
// after act() has settled everything.
vi.mock("@/components/settings/hireOrders/fields/CountersignFields", async (orig) => {
  const actual = await orig<typeof import("@/components/settings/hireOrders/fields/CountersignFields")>();
  return { ...actual, CountersignFields: vi.fn(actual.CountersignFields) };
});

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { CountersignStep } from "./CountersignStep";
import { CountersignFields } from "@/components/settings/hireOrders/fields/CountersignFields";
import { createTestQueryClient } from "@/test/queryClient";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("CountersignStep", () => {
  it("offers both modes when the read succeeds", async () => {
    renderWithProviders(<CountersignStep orgId="org-1" onDone={vi.fn()} />);
    expect(await screen.findByRole("radio", { name: /artist signs in showflow/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /outside showflow/i })).toBeInTheDocument();
  });

  it("shows a destructive alert and no editable form when the read fails", async () => {
    // Falling through would seed COUNTERSIGN_DEFAULT (manual) and a Save would write it
    // over a stored electronic mode, silently stopping artists signing in-app.
    seedClient({ app_settings: { data: null, error: new Error("permission denied for table app_settings") } });
    renderWithProviders(<CountersignStep orgId="org-1" onDone={vi.fn()} />);

    expect(await screen.findByText(/could not load the countersign/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string }[];
      expect(calls.filter((c) => c.table === "app_settings" && c.method === "upsert")).toHaveLength(0);
    });
  });

  // The form was a COPY of the stored setting, filled in by a seed-once effect, so
  // the commit that opened the isLoading gate rendered an interactive panel whose
  // form was still the blank default -- and Confirm persists it verbatim (merging
  // onto the stored value, so the fields this panel renders are written back empty).
  // Priming the cache puts the data in the FIRST render, where a lagging draft shows;
  // asserting on the settled DOM only ever sees the state after the effect ran.
  it("hands the stored value to the fields in the first render, before any effect", async () => {
    const stored = { mode: "electronic" };
    seedClient({ app_settings: { data: [{ key: "hire_order_countersign", org_id: "org-1", value: stored }], error: null } });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["app-settings", "hire_order_countersign", "org-1"], stored);
    vi.mocked(CountersignFields).mockClear();

    renderWithProviders(<CountersignStep orgId="org-1" onDone={vi.fn()} />, { queryClient });

    expect(vi.mocked(CountersignFields).mock.calls[0]?.[0].value).toEqual(stored);
  });
});
