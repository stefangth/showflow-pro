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

  // A `??` coercion only catches null/undefined, so a stored "" or "weekly"
  // survives into the Select and renders it blank -- while the server (which
  // validates the value with isFeeBasis) bills the order as per_date. The
  // control must show what will actually happen.
  it.each(["", "weekly", 7, null])(
    "shows the per date fallback the server uses for a stored basis of %p",
    async (stored) => {
      seedClient({
        app_settings: {
          data: [{
            key: "hire_order_defaults",
            org_id: "org-1",
            value: { default_fee: 500, currency: "USD", default_fee_basis: stored },
          }],
          error: null,
        },
      });
      renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
      await waitFor(() => expect(screen.getByLabelText("Default fee")).toHaveValue(500));
      expect(screen.getByLabelText("Fee basis")).toHaveTextContent("Per date");
    },
  );

  it("keeps a stored total basis untouched", async () => {
    seedClient({
      app_settings: {
        data: [{
          key: "hire_order_defaults",
          org_id: "org-1",
          value: { default_fee: 500, currency: "USD", default_fee_basis: "total" },
        }],
        error: null,
      },
    });
    renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toHaveValue(500));
    expect(screen.getByLabelText("Fee basis")).toHaveTextContent("Total for all dates");
  });
});

describe("OrderDefaultsCard hydration", () => {
  // The form was a COPY of the stored defaults, seeded once by an effect behind a
  // ref, so it never re-seeded when the active org changed underneath it -- and
  // HireOrdersTab is not keyed by org. Save persists the form verbatim, so the
  // previous org's fee would have been written into the new org. Same root cause as
  // the one-commit window between the isLoading gate opening and the effect running.
  it("follows the org when the active one changes under an untouched form", async () => {
    seedClient({
      app_settings: {
        data: [
          { key: "hire_order_defaults", org_id: "org-1", value: { default_fee: 250, currency: "EUR", default_fee_basis: "per_date" } },
          { key: "hire_order_defaults", org_id: "org-2", value: { default_fee: 900, currency: "EUR", default_fee_basis: "per_date" } },
        ],
        error: null,
      },
    });
    const { rerender } = renderWithProviders(<OrderDefaultsCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Default fee")).toHaveValue(250));

    rerender(<OrderDefaultsCard orgId="org-2" />);

    await waitFor(() => expect(screen.getByLabelText("Default fee")).toHaveValue(900));
  });
});
