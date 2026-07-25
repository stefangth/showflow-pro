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
    ],
  });
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
