import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { TermsVariantsCard } from "./TermsVariantsCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("TermsVariantsCard", () => {
  it("renders the seeded default templates with Standard checked as the default", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    expect(await screen.findByDisplayValue("Lean")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Standard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Full")).toBeInTheDocument();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.getAttribute("aria-checked") === "true")).toHaveLength(1);

    const standardRow = screen.getByTestId("terms-template-standard");
    expect(within(standardRow).getByRole("radio")).toHaveAttribute("aria-checked", "true");
  });

  it("normalizes a legacy {lean,standard,full} stored value into templates", async () => {
    seedClient({
      app_settings: {
        data: [
          {
            key: "hire_order_terms",
            org_id: "org-1",
            value: { lean: [{ title: "Fee", body: "Paid on the day." }], standard: [], full: [] },
          },
        ],
        error: null,
      },
    });
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);

    expect(await screen.findByDisplayValue("Lean")).toBeInTheDocument();
    const leanRow = screen.getByTestId("terms-template-lean");
    expect(within(leanRow).getByLabelText(/lean clause 1 title/i)).toHaveValue("Fee");
    // Legacy normalization always resolves the default to "standard".
    expect(within(screen.getByTestId("terms-template-standard")).getByRole("radio")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("adds a new blank template on Add template", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    fireEvent.click(screen.getByRole("button", { name: "Add template" }));

    const names = screen.getAllByPlaceholderText("Template name").map((el) => (el as HTMLInputElement).value);
    expect(names).toEqual(["Lean", "Standard", "Full", ""]);
  });

  it("renames a template via its name Input", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    const leanInput = await screen.findByDisplayValue("Lean");

    fireEvent.change(leanInput, { target: { value: "Basic" } });

    expect(screen.getByDisplayValue("Basic")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Lean")).not.toBeInTheDocument();
  });

  it("moves the default when a different template's radio is clicked", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    const leanRow = screen.getByTestId("terms-template-lean");
    fireEvent.click(within(leanRow).getByRole("radio"));

    expect(within(leanRow).getByRole("radio")).toHaveAttribute("aria-checked", "true");
    const standardRow = screen.getByTestId("terms-template-standard");
    expect(within(standardRow).getByRole("radio")).toHaveAttribute("aria-checked", "false");
  });

  it("deleting the current default template promotes the first remaining template", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    // Standard is the seeded default; delete it.
    const standardRow = screen.getByTestId("terms-template-standard");
    fireEvent.click(within(standardRow).getByRole("button", { name: /^delete /i }));

    expect(screen.queryByDisplayValue("Standard")).not.toBeInTheDocument();
    const leanRow = screen.getByTestId("terms-template-lean");
    expect(within(leanRow).getByRole("radio")).toHaveAttribute("aria-checked", "true");
  });

  it("deleting a non-default template leaves the default unchanged", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    const leanRow = screen.getByTestId("terms-template-lean");
    fireEvent.click(within(leanRow).getByRole("button", { name: /^delete /i }));

    expect(screen.queryByDisplayValue("Lean")).not.toBeInTheDocument();
    const standardRow = screen.getByTestId("terms-template-standard");
    expect(within(standardRow).getByRole("radio")).toHaveAttribute("aria-checked", "true");
  });

  it("deleting the last remaining template shows the empty state (default_id null)", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    for (const name of ["Lean", "Standard", "Full"]) {
      const input = screen.getByDisplayValue(name);
      const row = input.closest('[data-testid^="terms-template-"]') as HTMLElement;
      fireEvent.click(within(row).getByRole("button", { name: /^delete /i }));
    }

    expect(screen.getByText(/no templates yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("Save writes the whole HireOrderTermsSetting via upsertOrgSetting, persisting the effective default", async () => {
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Lean");

    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const payload = upsert!.args[0] as {
        key: string;
        value: { templates: { id: string; name: string }[]; default_id: string | null };
      };
      expect(payload.key).toBe("hire_order_terms");
      expect(payload.value.templates.map((t) => t.name)).toEqual(["Lean", "Standard", "Full"]);
      expect(payload.value.default_id).toBe("standard");
    });
  });

  it("Save persists the first template as default_id when it was null (no explicit default yet)", async () => {
    seedClient({
      app_settings: {
        data: [
          {
            key: "hire_order_terms",
            org_id: "org-1",
            value: { templates: [{ id: "t1", name: "Only one", clauses: [] }], default_id: null },
          },
        ],
        error: null,
      },
    });
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);
    await screen.findByDisplayValue("Only one");
    // Implicit default renders as checked even though default_id is null.
    expect(screen.getByRole("radio")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save terms" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const payload = upsert!.args[0] as { value: { default_id: string | null } };
      expect(payload.value.default_id).toBe("t1");
    });
  });

  describe("readOnly (capability floor)", () => {
    it("disables Add template, delete, name inputs, radios, and Save, but still shows real values", async () => {
      renderWithProviders(<TermsVariantsCard orgId="org-1" readOnly />);
      const leanInput = await screen.findByDisplayValue("Lean");

      expect(leanInput).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add template" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save terms" })).toBeDisabled();
      for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
      for (const del of screen.getAllByRole("button", { name: /^delete /i })) expect(del).toBeDisabled();
    });

    it("leaves every control enabled when readOnly is false", async () => {
      renderWithProviders(<TermsVariantsCard orgId="org-1" readOnly={false} />);
      expect(await screen.findByDisplayValue("Lean")).toBeEnabled();
      expect(screen.getByRole("button", { name: "Add template" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Save terms" })).toBeEnabled();
    });
  });

  it("shows a destructive alert and no editable form when the settings read fails", async () => {
    seedClient({ app_settings: { data: null, error: new Error("permission denied for table app_settings") } });
    renderWithProviders(<TermsVariantsCard orgId="org-1" />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/could not load the terms settings/i)).toBeInTheDocument();
    expect(screen.getByText(/permission denied for table app_settings/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save terms" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Lean")).not.toBeInTheDocument();
  });
});
