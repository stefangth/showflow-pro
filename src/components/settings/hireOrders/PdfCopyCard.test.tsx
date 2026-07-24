import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { PdfCopyCard } from "./PdfCopyCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

function seedCopy(value: Record<string, string>) {
  seedClient({
    app_settings: {
      data: [{ key: "hire_order_copy", org_id: "org-1", value }],
      error: null,
    },
  });
}

describe("PdfCopyCard", () => {
  it("shows a saved override in its field and a default for an unset field", async () => {
    seedCopy({ terms_heading: "Bespoke terms" });
    renderWithProviders(<PdfCopyCard orgId="org-1" />);

    const terms = await screen.findByLabelText("Terms heading");
    expect(terms).toHaveValue("Bespoke terms");
    // an unset key renders its default
    expect(screen.getByLabelText("Fees heading")).toHaveValue("Fees & payment schedule");
  });

  it("saves only the keys that differ from the default", async () => {
    renderWithProviders(<PdfCopyCard orgId="org-1" />);
    const total = await screen.findByLabelText("Total row");
    fireEvent.change(total, { target: { value: "Amount due" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PDF copy" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const value = (upsert!.args[0] as { value: Record<string, string> }).value;
      expect(value.fees_total).toBe("Amount due");
      // an untouched key is not persisted
      expect(value.terms_heading).toBeUndefined();
    });
  });

  it("reset-to-default restores a field and drops it from the saved map", async () => {
    seedCopy({ fees_total: "Amount due" });
    renderWithProviders(<PdfCopyCard orgId="org-1" />);
    const total = await screen.findByLabelText("Total row");
    expect(total).toHaveValue("Amount due");

    fireEvent.click(screen.getByRole("button", { name: "Reset Total row to default" }));
    expect(total).toHaveValue("Total payable");

    fireEvent.click(screen.getByRole("button", { name: "Save PDF copy" }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      const value = (upsert!.args[0] as { value: Record<string, string> }).value;
      expect(value.fees_total).toBeUndefined();
    });
  });

  it("previews with the current edits as a copy_override", async () => {
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
    vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      seedClient({
        app_settings: { data: [], error: null },
        "fn:generate-hire-orders": { data: { pdf_base64: "JVBERi0=" }, error: null },
      });
      renderWithProviders(<PdfCopyCard orgId="org-1" />);
      const terms = await screen.findByLabelText("Terms heading");
      fireEvent.change(terms, { target: { value: "Bespoke terms" } });
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));

      await waitFor(() => {
        const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
        const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
        expect(invoke).toBeDefined();
        const body = invoke!.args[0] as { action: string; copy_override: Record<string, string> };
        expect(body.action).toBe("preview");
        expect(body.copy_override.terms_heading).toBe("Bespoke terms");
      });
    } finally {
      URL.createObjectURL = originalCreate;
      vi.restoreAllMocks();
    }
  });

  it("warns when a field value contains an em/en dash", async () => {
    renderWithProviders(<PdfCopyCard orgId="org-1" />);
    const terms = await screen.findByLabelText("Terms heading");
    fireEvent.change(terms, { target: { value: "Terms — conditions" } });
    expect(await screen.findByText(/dash/i)).toBeInTheDocument();
  });

  it("readOnly disables inputs and Save but still shows the saved value", async () => {
    seedCopy({ terms_heading: "Bespoke terms" });
    renderWithProviders(<PdfCopyCard orgId="org-1" readOnly />);
    const terms = await screen.findByLabelText("Terms heading");
    expect(terms).toHaveValue("Bespoke terms"); // read floor
    expect(terms).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save PDF copy" })).toBeDisabled();
  });
});
