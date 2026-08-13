import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// SettingsPage queries `app_settings` directly (not through a data-access hook), and the
// Booking engine tab it renders pulls in its own children (useSettingsAudit, fetchCustomFieldDefs,
// useFeature/useEntitlements) which query settings_audit_log / custom_field_definitions /
// org_entitlements. Seed every table this page's tree can reach so each query resolves
// instead of hanging or throwing.
//
// org_entitlements is an array seed matched on org_id: "org-locked" is explicitly not
// entitled to booking_flow, "org-1" (used by every other test) has no matching entry and
// falls back to `{ data: [] }`, which resolves to the registry default (entitled) — same
// as before this file seeded the table at all.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  custom_field_definitions: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
  org_entitlements: [
    { when: { org_id: "org-locked" }, data: [{ feature: "booking_flow", enabled: false }], error: null },
  ],
}));

// useAuth is a vi.fn() (not a fixed factory) so the locked-org test below can swap in a
// different currentOrg without affecting the other tests in this file — see the
// vi.hoisted holder pattern in BookingFlowTab.test.tsx.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

// useCan is mocked directly (rather than seeding org_capabilities/org_capability_policies)
// so ON/OFF states are one-line, synchronous, and don't depend on the real resolver's
// async settle. Every other export of the module (useCapabilityMatrix, etc., used by the
// admin-only PermissionsTab, which these tests never mount) keeps its real implementation.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { SETTINGS_TAB_PARAMS } from "@/lib/settingsTabs";
import SettingsPage from "./SettingsPage";

// Every render wraps in a MemoryRouter: the page reads `?tab=` through useSearchParams and
// tabs render react-router <Link>s (for example the Artists link in CastsCitiesTab), which
// do not work without Router context. In the app the
// page is always mounted inside a <Route>, so this matches production.

const DEFAULT_AUTH = {
  hasRole: () => true,
  currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
  isSuperAdmin: false,
  refreshOrgs: async () => {},
};

// Real useCan always returns true for admins regardless of capability state; every
// existing test in this file exercises an admin, so default the mock the same way —
// only the producer-specific describe block below overrides it per action key.
beforeEach(() => {
  vi.mocked(useCan).mockReturnValue(true);
});

describe("SettingsPage Booking engine tab Save affordance", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
  });

  // Regression: the Booking engine tab renders its own scoped Save/Discard in FlowRail,
  // fed by the page-level dirtyKeys filtered to BOOKING_AUDIT_KEYS. Before this fix, the
  // page-level header Save button (and the "unsaved changes" banner) stayed visible too,
  // so the same draft showed two Save affordances at once while that tab was active.
  it("hides the page-level Save while the booking tab holds only booking-key dirt", async () => {
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    // Radix TabsTrigger activates on mousedown (not click) — see @radix-ui/react-tabs.
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking engine/i }));
    fireEvent.click(await screen.findByRole("button", { name: /direct book/i }));

    // The rail's own Save is the sole Save affordance left on this tab.
    expect(screen.getAllByRole("button", { name: /^Save/i })).toHaveLength(1);
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });

  it("keeps the page-level Save when the dirt is on another tab", async () => {
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^notifications$/i }));
    fireEvent.click(await screen.findByRole("switch"));

    expect(screen.getByRole("button", { name: /^Save \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });
});

describe("SettingsPage Booking engine tab, locked (booking_flow not entitled)", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      currentOrg: { id: "org-locked", name: "Locked Org", slug: "locked-org" },
    } as never);
  });

  // Critical-bug regression: the from-address input deliberately stays editable while the
  // booking_flow module is locked. Its dirty key used to hide the page-level Save even though
  // FlowRail hides its own Save/Discard while locked, leaving the edit with no save control.
  it("keeps the page-level Save visible, with no rail dirty banner, when editing the from-address while locked", async () => {
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking engine/i }));
    await waitFor(() => expect(screen.getByText("Booking engine is not enabled")).toBeInTheDocument());

    const fromAddress = screen.getByLabelText(/from address/i);
    fireEvent.change(fromAddress, { target: { value: "Locked Org <noreply@locked.example>" } });

    // Page-level Save reappears — it's the only save control left, since FlowRail's own
    // Save/Discard stays hidden while locked.
    expect(await screen.findByRole("button", { name: /^Save \(1\)$/i })).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    // The rail shows no "Previewing unsaved draft" banner: it offers no actions while
    // locked, so that banner would point the user at a save control that doesn't exist.
    expect(screen.queryByText(/previewing unsaved draft/i)).not.toBeInTheDocument();
  });

  // Regression guard: an entitled org editing an actual flow field must keep hiding the
  // page-level Save (unchanged from before this fix) — the rail's own Save/Discard covers it.
  it("still hides the page-level Save for an entitled org editing a flow field", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /booking engine/i }));
    fireEvent.click(await screen.findByRole("button", { name: /direct book/i }));

    expect(screen.getAllByRole("button", { name: /^Save/i })).toHaveLength(1);
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });
});

describe("SettingsPage grouped vertical nav", () => {
  it("renders group headings and switches content", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    // Group headings are decorative visual grouping — aria-hidden so they aren't announced
    // as stray non-tab children of the role="tablist".
    const automationHeading = await screen.findByText("Automation");
    expect(automationHeading).toBeInTheDocument();
    expect(automationHeading).toHaveAttribute("aria-hidden", "true");
    // The "Organization" group heading shares its literal text with the "Organization" tab
    // trigger AND the OrganizationTab card's own CardTitle (rendered because "organization" is
    // the default active tab for an admin) — scope to the heading <p> to disambiguate.
    expect(screen.getByText("Organization", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Modules", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /booking engine on/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /hire orders off/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /scheduling/i })).not.toBeInTheDocument();
    // Switching a section swaps the visible content.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & cities/i }));
    expect(await screen.findByRole("tab", { name: /casts & cities/i })).toHaveAttribute("aria-selected", "true");
  });

  // Broad Settings, read-only floor: these tabs used to be admin-only. A producer now
  // sees them too (read-only unless granted the matching capability) — only the rights
  // matrix itself ("Roles & permissions") stays admin-only.
  it("shows a producer the previously admin-only nav items, but not Roles & permissions", async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      hasRole: (r: string) => r === "producer",
    } as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByText("Modules");
    expect(screen.getByRole("tab", { name: /airtable sync/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /booking engine/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /email templates/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^filters$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^notifications$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^organization$/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /roles & permissions/i })).not.toBeInTheDocument();
  });

  it("places Email templates in Settings and renders its grouped coverage surface", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);

    fireEvent.mouseDown(await screen.findByRole("tab", { name: /email templates/i }));
    expect((await screen.findAllByText("Booking engine")).length).toBeGreaterThan(0);
    expect(screen.getByText("Password reset")).toBeInTheDocument();
  });
});

describe("SettingsPage content measure", () => {
  // `max-w-5xl` used to sit on the page root, which held every tab's content
  // column to 772px however wide the display was — measured in the running
  // app, that left Settings 172px short of the viewport at 1440 and 396px at
  // 1920 while the Trust & data matrix wrapped inside it. The measure now
  // is per tab: the twelve form tabs keep it and the wide reference tabs drop
  // it, so those run to `main`'s own padding at every display width. jsdom has
  // no layout engine, so this pins which element owns the class and that
  // changing tab actually changes it.
  it("keeps the reading measure for form tabs and drops it for Trust & data", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    const { container } = renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);

    const page = () => container.querySelector("div.space-y-6")!;
    await screen.findByRole("tab", { name: /trust & data/i });
    expect(page().className, "a form tab keeps the measure").toMatch(/\bmax-w-5xl\b/);

    fireEvent.mouseDown(screen.getByRole("tab", { name: /trust & data/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /trust & data/i })).toHaveAttribute("aria-selected", "true"),
    );
    expect(page().className, "the wide tab drops it").not.toMatch(/\bmax-w-5xl\b/);
    // The page-level Save travels with it: capping the header while the panel
    // ran wide put it and the tab's own top-right action on right edges 628px
    // apart at 1920.
    expect(container.querySelector("h1")!.closest("div.space-y-6")).toBe(page());
  });
});

describe("SettingsPage ?tab= deep link", () => {
  it("opens the tab named in the query string", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /airtable sync/i })).toHaveAttribute("aria-selected", "true");
  });

  it("lands on the admin default when no tab is named", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter initialEntries={["/settings"]}><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /^organization$/i })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores an admin-only tab asked for by a producer", async () => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, hasRole: (r: string) => r === "producer" } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=permissions"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /^organization$/i })).toHaveAttribute("aria-selected", "true");
  });

  // The registry in settingsTabs.ts is a list of strings; only the page knows whether each
  // one still names a section it renders. Renaming a TabsTrigger value (or dropping a
  // section) would leave Tabs holding a value with no trigger and no content: the deep link
  // would open a blank page and no pure test could see it.
  it.each([...SETTINGS_TAB_PARAMS])("selects a real section for ?tab=%s", async (tab) => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}><SettingsPage /></MemoryRouter>,
    );
    const triggers = await screen.findAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  // The ADMIN_ONLY list in settingsTabs.ts is a literal, while the real gate is the per-item
  // `show` predicate in this page's navGroups. Nothing ties them together: move any listed
  // tab behind `isAdmin` (as "permissions" already is) without adding it to ADMIN_ONLY and
  // resolveInitialTab would hand a producer a value with no trigger and no content, leaving
  // the deep link on a blank page. Running the same sweep as a producer is what pins them.
  it.each([...SETTINGS_TAB_PARAMS])("selects a real section for a producer at ?tab=%s", async (tab) => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, hasRole: (r: string) => r === "producer" } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}><SettingsPage /></MemoryRouter>,
    );
    const triggers = await screen.findAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("leaves the entitlement-gated hire-orders tab out of deep linking, from the page's side too", async () => {
    // An org without the hire_orders entitlement renders no such trigger, so honouring the
    // param would strand it on an empty pane. The page lands on the admin default instead.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=hire-orders"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /^organization$/i })).toHaveAttribute("aria-selected", "true");
  });

  it("still lets the user switch tabs after arriving through a deep link", async () => {
    // The param seeds the tab; it must not pin the page there. This is also the guard on
    // the re-seed effect below: an effect that fired on every render (rather than on a
    // change of the param) would snap the page straight back to "airtable" here.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}><SettingsPage /></MemoryRouter>,
    );
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /casts & cities/i }));
    expect(await screen.findByRole("tab", { name: /casts & cities/i })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the named tab when a deep link arrives while the page is already open", async () => {
    // Seeding from a lazy useState initializer alone runs once per MOUNT. Every deep link
    // on this branch (LadderStep, EligibilityStep) is rendered off Settings, so it always
    // remounts the page and the gap was invisible. A notification deep-link clicked while
    // the user is already sitting on Settings changes the URL and nothing else: the page
    // has to follow the param, not just the mount.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}>
        <Link to="/settings?tab=docs">deep link</Link>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /airtable sync/i })).toHaveAttribute("aria-selected", "true");
    // Switch by hand in between, so this proves the effect follows the param rather than
    // simply re-running on any state change.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & cities/i }));
    expect(await screen.findByRole("tab", { name: /casts & cities/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("link", { name: /deep link/i }));
    expect(await screen.findByRole("tab", { name: /documentation/i })).toHaveAttribute("aria-selected", "true");
  });

  it("follows a repeat deep link to the tab the user has since navigated away from", async () => {
    // Keying the re-seed on the param VALUE alone makes the second click on the same link a
    // dead click: the URL is already `?tab=airtable`, so the param does not change, the
    // effect does not re-run, and the page sits wherever the user last switched to by hand.
    // Reachable from any Settings-to-Settings link (the sync-held notification is the one
    // this branch ships); the cross-page ones remount the page and hid the gap. The effect
    // keys on the navigation itself, so each click is honoured.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}>
        <Link to="/settings?tab=airtable">sync report</Link>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /airtable sync/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & cities/i }));
    expect(await screen.findByRole("tab", { name: /casts & cities/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("link", { name: /sync report/i }));
    expect(await screen.findByRole("tab", { name: /airtable sync/i })).toHaveAttribute("aria-selected", "true");
  });
});

describe("SettingsPage producer capability read-only floor", () => {
  // The Filters and Notifications sections are rendered inline (not separate tab
  // components), so their read-only threading is exercised here rather than in a
  // component-level test file.
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      hasRole: (r: string) => r === "producer",
    } as never);
  });

  it("disables the Notifications switch (but still shows its value) when edit_filter_settings is off", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "edit_filter_settings");
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^notifications$/i }));

    const toggle = await screen.findByRole("switch");
    expect(toggle).toBeDisabled();
    // Read floor: the value (default on) still renders, just can't be changed.
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("enables the Notifications switch once edit_filter_settings is on", async () => {
    vi.mocked(useCan).mockImplementation(() => true);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^notifications$/i }));

    expect(await screen.findByRole("switch")).toBeEnabled();
  });

  it("disables every Filter-visibility switch when edit_filter_settings is off", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "edit_filter_settings");
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /^filters$/i }));

    const switches = await screen.findAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    for (const s of switches) expect(s).toBeDisabled();
  });
});
