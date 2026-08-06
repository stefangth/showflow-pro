import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { CountersignStep } from "./CountersignStep";

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
});
