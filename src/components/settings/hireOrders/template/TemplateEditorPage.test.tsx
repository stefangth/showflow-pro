import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
import { THEME_ROLE_KEYS } from "@/lib/hireOrders/pdf/pdfTheme";
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
});
