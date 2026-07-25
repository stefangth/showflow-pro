import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { OrderDefaultsCard } from "./OrderDefaultsCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("OrderDefaultsCard fee basis", () => {
  it("shows a fee basis control defaulting to per date", async () => {
    renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toBeInTheDocument());
    expect(screen.getByLabelText("Fee basis")).toHaveTextContent("Per date");
  });

  it("disables the fee basis control in read-only mode", async () => {
    renderWithProviders(<OrderDefaultsCard orgId="org-1" readOnly />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toBeDisabled());
    expect(screen.getByLabelText("Fee basis")).toBeDisabled();
  });

  // resolveOrgSetting (src/data/settings.ts) replaces the fallback wholesale on a
  // match rather than merging field-by-field, so an org that saved
  // hire_order_defaults before default_fee_basis existed has a stored
  // {default_fee, currency} object with no basis key at all. That must still
  // resolve to "per_date", not an empty/undefined Select.
  it("resolves a legacy stored default with no fee basis key to per date", async () => {
    seedClient({
      app_settings: {
        data: [{ key: "hire_order_defaults", org_id: "org-1", value: { default_fee: 500, currency: "USD" } }],
        error: null,
      },
    });
    renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toHaveValue(500));
    expect(screen.getByLabelText("Fee basis")).toHaveTextContent("Per date");
  });
});
