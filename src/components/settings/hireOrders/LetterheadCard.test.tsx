import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { LetterheadCard } from "./LetterheadCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("LetterheadCard readOnly (capability floor)", () => {
  it("disables the form fields and Save button, but still shows the real value", async () => {
    seedClient({
      app_settings: {
        data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora Productions GmbH", address_lines: [], registration_line: "" } }],
        error: null,
      },
    });
    renderWithProviders(<LetterheadCard orgId="org-1" readOnly />);

    const legalName = await screen.findByLabelText("Legal name");
    expect(legalName).toHaveValue("Aurora Productions GmbH"); // read floor: real value renders
    expect(legalName).toBeDisabled();
    expect(screen.getByLabelText("Address")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save letterhead" })).toBeDisabled();
  });

  it("leaves the fields and Save button enabled when readOnly is false", async () => {
    renderWithProviders(<LetterheadCard orgId="org-1" readOnly={false} />);
    expect(await screen.findByLabelText("Legal name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save letterhead" })).toBeEnabled();
  });
});

describe("LetterheadCard address field", () => {
  it("preserves trailing spaces and blank lines while typing", async () => {
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    const address = await screen.findByLabelText("Address");
    fireEvent.change(address, { target: { value: "Street 1\n\n10999 Berlin " } });
    // The raw text is kept verbatim — not collapsed by trim/filter.
    expect(address).toHaveValue("Street 1\n\n10999 Berlin ");
  });

  it("parses address to lines only on Save (trailing space trimmed, interior blank kept)", async () => {
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    const address = await screen.findByLabelText("Address");
    fireEvent.change(address, { target: { value: "Street 1\n\n10999 Berlin " } });
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const value = (upsert!.args[0] as { value: { address_lines: string[] } }).value;
      expect(value.address_lines).toEqual(["Street 1", "", "10999 Berlin"]);
    });
  });
});
