import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrdersTab.test.tsx / SettingsPage.test.tsx: a call-recording
// fake swapped into a hoisted holder (never a hand-rolled vi.mock chain), useAuth as
// a vi.fn() so the page's `currentOrg`/`hasRole` are controlled per test, useCan mocked
// directly (rather than seeding org_capabilities/org_capability_policies) so the
// read-only gate is one-line and synchronous, and a real MemoryRouter (the page's
// header renders a <Link> back to Settings).
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
// Spy, not a stub: the REAL composer still runs (so these tests cannot pass
// against a broken one), but its arguments are recorded. The preview document
// is the page's main output and RenderInput is the contract every other
// renderer test asserts against, so this is the observable edge of the page.
vi.mock("@/lib/hireOrders/pdf/sampleDocument", async (orig) => {
  const actual = await orig<typeof import("@/lib/hireOrders/pdf/sampleDocument")>();
  return { ...actual, sampleRenderInput: vi.fn(actual.sampleRenderInput) };
});

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import TemplateEditorPage from "./TemplateEditorPage";
import { TEMPLATE_SECTIONS } from "./templateMeta";
import { THEME_ROLE_KEYS, type HireOrderThemeOverride } from "@/lib/hireOrders/pdf/pdfTheme";
import { HIRE_ORDER_COPY_DEFAULTS, type CopyKey } from "@/lib/hireOrders/pdf/pdfCopy";
import { SAMPLE_LETTERHEAD, SAMPLE_TERMS, sampleRenderInput } from "@/lib/hireOrders/pdf/sampleDocument";

function authAs() {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
    hasRole: () => true,
  } as never);
}

function renderPage(props: { readOnly?: boolean } = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <TemplateEditorPage {...props} />
    </MemoryRouter>,
  );
}

/** Seeds a specific stored `hire_order_theme` value while leaving
 *  `hire_order_copy` at its defaults. Uses the array-seed `when` form
 *  (matched against the recorded `.eq("key", ...)` arg) rather than the
 *  plain single-object form, because the page issues two separate
 *  `resolveOrgSetting` reads against the same `app_settings` table and the
 *  single-object seed does not discriminate between them - PdfCopyCard's
 *  tests get away with the single-object form only because that card reads
 *  just one key. */
function seedTheme(value: HireOrderThemeOverride) {
  seedClient({
    app_settings: [
      { when: { key: "hire_order_theme" }, data: [{ key: "hire_order_theme", org_id: "org-1", value }] },
      { when: { key: "hire_order_copy" }, data: [] },
      // The page also reads the org's letterhead + terms for the preview;
      // an unmatched read has to resolve to "org has none", not to nothing.
      { data: [] },
    ],
  });
}

/** The RenderInput the page most recently composed for the preview pane. Read
 *  off the spy's RESULTS, not its arguments: the real composer runs, so this
 *  is the document the pane actually renders. Synchronous on purpose - callers
 *  wrap their ASSERTION in waitFor, so the settled value is the one asserted
 *  rather than whichever frame happened to exist when a wrapper first
 *  resolved. */
function lastRenderInput() {
  const results = vi.mocked(sampleRenderInput).mock.results;
  const last = results[results.length - 1];
  if (!last || last.type !== "return") throw new Error("sampleRenderInput has not returned yet");
  return last.value;
}

interface RecordedCall { table: string; method: string; args: unknown[] }

/** Finds the `app_settings` upsert call for `hire_order_theme` and returns
 *  the JSON `value` it was about to persist. */
async function savedThemeValue(): Promise<HireOrderThemeOverride> {
  return waitFor(() => {
    const calls = (client.calls ?? []) as RecordedCall[];
    const themeUpsert = calls.find(
      (c) =>
        c.table === "app_settings" &&
        c.method === "upsert" &&
        (c.args[0] as { key: string }).key === "hire_order_theme",
    );
    if (!themeUpsert) throw new Error("no hire_order_theme upsert recorded yet");
    return (themeUpsert.args[0] as { value: HireOrderThemeOverride }).value;
  });
}

describe("templateMeta", () => {
  it("places every theme role in exactly one section", () => {
    const placed = TEMPLATE_SECTIONS.flatMap((s) => s.roles.map((r) => r.key));
    expect([...placed].sort()).toEqual([...THEME_ROLE_KEYS].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("binds every copy key to exactly one role", () => {
    const bound = TEMPLATE_SECTIONS.flatMap((s) => s.roles.flatMap((r) => r.copyKeys));
    const all = Object.keys(HIRE_ORDER_COPY_DEFAULTS) as CopyKey[];
    expect([...bound].sort()).toEqual([...all].sort());
    expect(new Set(bound).size).toBe(bound.length);
  });
});

describe("TemplateEditorPage", () => {
  beforeEach(() => {
    seedClient({ app_settings: { data: [], error: null } });
    authAs();
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("renders the three panes", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("region", { name: "Document preview" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Element settings" })).toBeInTheDocument();
  });

  it("disables saving in read-only mode", async () => {
    renderPage({ readOnly: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled(),
    );
  });

  it("shows an error instead of the editor when the settings read fails", async () => {
    seedClient({ app_settings: { data: null, error: { message: "boom" } } });
    renderPage();
    expect(await screen.findByText(/Could not load the PDF template settings/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Document outline" })).not.toBeInTheDocument();
  });

  // Fix: the preview used to render an INVENTED letterhead and two invented
  // terms clauses while the server's "Open exact PDF" used the org's real
  // ones. An org styling legalName / partyLine / clauseTitle / clauseBody was
  // therefore styling text it would never see.
  describe("previewing against the org's own document", () => {
    it("renders the org's letterhead and default terms template, not the fixtures", async () => {
      seedClient({
        app_settings: [
          {
            when: { key: "hire_order_letterhead" },
            data: [{
              key: "hire_order_letterhead",
              org_id: "org-1",
              value: { legal_name: "Nord Productions GmbH", address_lines: ["Berlin"], registration_line: "HRB 1 B" },
            }],
          },
          {
            when: { key: "hire_order_terms" },
            data: [{
              key: "hire_order_terms",
              org_id: "org-1",
              value: {
                templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Cancellation", body: "Fourteen days." }] }],
                default_id: "t1",
              },
            }],
          },
          { data: [] },
        ],
      });
      renderPage();

      await waitFor(() => {
        expect(lastRenderInput().letterhead?.legal_name).toBe("Nord Productions GmbH");
      });
      expect(lastRenderInput().terms).toEqual([{ title: "Cancellation", body: "Fourteen days." }]);
    });

    it("falls back to the fixtures only when the org has authored neither", async () => {
      seedClient({ app_settings: { data: [], error: null } });
      renderPage();

      await waitFor(() => {
        expect(lastRenderInput().letterhead?.legal_name).toBe(SAMPLE_LETTERHEAD.legal_name);
      });
      expect(lastRenderInput().terms).toEqual(SAMPLE_TERMS);
    });
  });

  // The theme draft is saved as-is, unlike the copy draft (which goes
  // through compactCopy first). A role can end up hollow - `{}` - by being
  // cleared one field at a time (TemplateInspector's per-field "Document
  // font" clear) rather than through the whole-role Reset; that hollow
  // object is harmless in memory (hasOwnKeys treats it as unmodified) but
  // was, before this fix, saved verbatim into hand-editable app_settings
  // JSON. Save must compact it away, the same "unchanged means absent"
  // principle compactCopy already applies to copy overrides.
  describe("saving the theme draft", () => {
    it("drops a role hollowed out by field-by-field clearing, keeping an unrelated real override", async () => {
      seedTheme({ roles: { totalLabel: {}, feeLabel: { weight: 500 } } });
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      const value = await savedThemeValue();
      expect(value.roles).not.toHaveProperty("totalLabel");
      expect(value.roles?.feeLabel).toEqual({ weight: 500 });
    });

    it("drops an empty base, keeping a real role override", async () => {
      seedTheme({ base: {}, roles: { feeLabel: { weight: 500 } } });
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      const value = await savedThemeValue();
      expect(value).not.toHaveProperty("base");
      expect(value.roles?.feeLabel).toEqual({ weight: 500 });
    });

    it("keeps a real base and a real role override intact", async () => {
      seedTheme({ base: { scale: 1.1 }, roles: { feeLabel: { weight: 500 } } });
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      const value = await savedThemeValue();
      expect(value.base).toEqual({ scale: 1.1 });
      expect(value.roles?.feeLabel).toEqual({ weight: 500 });
    });

    // "Open exact PDF" layers its override over the org's STORED theme
    // server-side, so it has to send what Save would persist. It used to send
    // the raw draft while compacting the copy beside it.
    it("compacts the theme override sent by Open exact PDF, like the copy beside it", async () => {
      seedTheme({ base: {}, roles: { totalLabel: {}, feeLabel: { weight: 500 } } });
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Open exact PDF" }));

      const body = await waitFor(() => {
        const call = (client.calls as RecordedCall[]).find((c) => c.table === "fn:generate-hire-orders");
        if (!call) throw new Error("no preview invocation recorded yet");
        return call.args[0] as { theme_override: HireOrderThemeOverride };
      });
      expect(body.theme_override).not.toHaveProperty("base");
      expect(body.theme_override.roles).not.toHaveProperty("totalLabel");
      expect(body.theme_override.roles?.feeLabel).toEqual({ weight: 500 });
    });

    it("drops every hollow role and an empty base when the draft has nothing real left", async () => {
      seedTheme({ base: {}, roles: { totalLabel: {}, feeLabel: {} } });
      renderPage();
      await waitFor(() =>
        expect(screen.getByRole("navigation", { name: "Document outline" })).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      const value = await savedThemeValue();
      expect(value).not.toHaveProperty("base");
      expect(value).not.toHaveProperty("roles");
    });
  });
});
