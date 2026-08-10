import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// Spy, not a stub: the REAL fields still render, but the card's draft is
// recorded per render. This is the seam where the card hands over the value its
// Save would persist, and unlike the DOM it keeps a history — so the FIRST
// render is still inspectable after everything has settled.
vi.mock("./fields/LetterheadFields", async (orig) => {
  const actual = await orig<typeof import("./fields/LetterheadFields")>();
  return { ...actual, LetterheadFields: vi.fn(actual.LetterheadFields) };
});

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { LetterheadCard } from "./LetterheadCard";
import { LetterheadFields } from "./fields/LetterheadFields";

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

describe("LetterheadCard hydration", () => {
  const STORED = {
    legal_name: "Aurora Productions GmbH",
    address_lines: ["Rosenthaler Str. 1", "10119 Berlin"],
    registration_line: "HRB 1 B",
  };

  function seedStored(orgId = "org-1", value = STORED) {
    seedClient({ app_settings: { data: [{ key: "hire_order_letterhead", org_id: orgId, value }], error: null } });
  }

  // The form used to be a COPY of the stored letterhead - `useState(LETTERHEAD_DEFAULT)`
  // filled in by a seed-once effect - so the commit that opened the `isLoading` gate
  // rendered a fully interactive form whose `form` was still the blank default. Save
  // persists `form` verbatim, so a click there wrote empty strings over the org's real
  // letterhead: exactly the failure the isError branch already guards against, one
  // commit wide instead of permanent.
  //
  // Priming the cache is what makes that deterministic. The card then has its data
  // during the FIRST render, so the value it hands the fields is the unhydrated one
  // if anything lags. Asserting on the settled DOM instead only ever sees the state
  // after act() flushed the effect, which is why this class of bug stays invisible.
  it("hands the stored letterhead to the fields in the first render, before any effect", async () => {
    seedStored();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["app-settings", "hire_order_letterhead", "org-1"], STORED);
    vi.mocked(LetterheadFields).mockClear();

    renderWithProviders(<LetterheadCard orgId="org-1" />, { queryClient });

    expect(vi.mocked(LetterheadFields).mock.calls[0]?.[0].value).toEqual(STORED);
    expect(await screen.findByLabelText("Legal name")).toHaveValue(STORED.legal_name);
  });

  // Same root cause, permanent rather than sub-frame: HireOrdersTab is not keyed by
  // org (only BookingFlowTab is), so switching orgs re-keys this card's query without
  // unmounting it - and the seed-once ref had already fired for the previous org.
  it("follows the org when the active one changes under an untouched form", async () => {
    seedClient({
      app_settings: {
        data: [
          { key: "hire_order_letterhead", org_id: "org-1", value: STORED },
          { key: "hire_order_letterhead", org_id: "org-2", value: { ...STORED, legal_name: "Nord Productions GmbH" } },
        ],
        error: null,
      },
    });
    const { rerender } = renderWithProviders(<LetterheadCard orgId="org-1" />);
    expect(await screen.findByLabelText("Legal name")).toHaveValue("Aurora Productions GmbH");

    rerender(<LetterheadCard orgId="org-2" />);

    await waitFor(() => expect(screen.getByLabelText("Legal name")).toHaveValue("Nord Productions GmbH"));
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

describe("LetterheadCard agent signature", () => {
  it("uploads a PNG, previews it, and persists the returned path on Save", async () => {
    seedClient({
      app_settings: { data: [], error: null },
      "fn:generate-hire-orders": {
        data: { path: "org-1/agent-signature.png", url: "https://signed.test/sig.png" },
        error: null,
      },
    });
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    await screen.findByLabelText("Legal name");

    const fileInput = screen.getByLabelText("Upload agent signature PNG");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sig.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const preview = await screen.findByAltText("Agent signature preview");
    expect(preview).toHaveAttribute("src", "https://signed.test/sig.png");

    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      const value = (upsert!.args[0] as { value: { agent_signature_path?: string } }).value;
      expect(value.agent_signature_path).toBe("org-1/agent-signature.png");
    });
  });

  it("previews an already-saved signature on load via a signed url", async () => {
    seedClient({
      app_settings: {
        data: [{
          key: "hire_order_letterhead",
          org_id: "org-1",
          value: { legal_name: "X", address_lines: [], registration_line: "", agent_signature_path: "org-1/agent-signature.png" },
        }],
        error: null,
      },
      "fn:generate-hire-orders": { data: { url: "https://signed.test/saved.png" }, error: null },
    });
    renderWithProviders(<LetterheadCard orgId="org-1" />);
    const preview = await screen.findByAltText("Agent signature preview");
    expect(preview).toHaveAttribute("src", "https://signed.test/saved.png");
  });
});
