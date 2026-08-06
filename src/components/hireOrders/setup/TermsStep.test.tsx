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

import { TermsStep } from "./TermsStep";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("TermsStep", () => {
  it("lists the platform library when both reads succeed", async () => {
    renderWithProviders(<TermsStep orgId="org-1" onDone={vi.fn()} />);
    expect(await screen.findByRole("checkbox", { name: "Standard engagement" })).toBeInTheDocument();
  });

  it("shows a destructive alert and no import control when the org's terms fail to read", async () => {
    // The import APPENDS to the org's current terms. Rendering the picker over a failed
    // read is how "add a template" becomes "replace the whole contract library".
    seedClient({
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: null,
          error: new Error("permission denied for table app_settings"),
        },
        { data: [], error: null },
      ],
    });
    renderWithProviders(<TermsStep orgId="org-1" onDone={vi.fn()} />);

    expect(await screen.findByText(/could not load the terms/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add to this organization/i })).not.toBeInTheDocument();

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string }[];
      expect(calls.filter((c) => c.table === "app_settings" && c.method === "upsert")).toHaveLength(0);
    });
  });
});
