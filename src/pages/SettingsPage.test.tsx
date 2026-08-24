import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { composeGetRunningV3, type GetRunningInputV3 } from "@/lib/getRunning/steps";

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
// Base per-table seed, factored out so the get-running describe block below can reseed
// `app_settings` alone (per test, to flip the org's `getrunning_v3_enabled` override) while
// keeping every other table this page's tree reaches intact, then restore this exact shape
// afterwards.
const BASE_SEED: Record<string, TableSeed> = {
  app_settings: { data: [], error: null },
  shows: { data: [], error: null },
  custom_field_definitions: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
  org_entitlements: [
    { when: { org_id: "org-locked" }, data: [{ feature: "booking_flow", enabled: false }], error: null },
  ],
};

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase(BASE_SEED));

// useAuth is a vi.fn() (not a fixed factory) so the locked-org test below can swap in a
// different currentOrg without affecting the other tests in this file — see the
// vi.hoisted holder pattern in BookingFlowTab.test.tsx.
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

// useCan is mocked directly (rather than seeding org_capabilities/org_capability_policies)
// so ON/OFF states are one-line, synchronous, and don't depend on the real resolver's
// async settle. Every other export of the module (useCapabilityMatrix, etc., used by the
// admin-only RolesRightsTab, which these tests never mount) keeps its real implementation.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

// The get-running tab (task B3) mounts GetRunningBoardV3, whose useGetRunningV3 aggregates
// ~10 booking/hire-order/skills/dates hooks. Mocked wholesale, same as
// GetRunningBoardV3.test.tsx / GetRunningSettingsMirror.test.tsx, so this file doesn't have
// to seed every table that live-data wiring touches just to prove the tab mounts.
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { SETTINGS_TAB_PARAMS } from "@/lib/settingsTabs";
import SettingsPage from "./SettingsPage";

// "get-running"'s trigger/content is gated on `isSuperAdmin || ((isAdmin || isProducer) &&
// v3Enabled)` (task B3), and `v3Enabled` resolves through an async `app_settings` query,
// unlike every other value in SETTINGS_TAB_PARAMS whose plain role gate holds synchronously
// under DEFAULT_AUTH. v3 is the app default now, so its trigger does render under
// admin/producer auth, but only once that async query settles; the exhaustiveness sweeps
// below assert on triggers synchronously, so "get-running" is excluded here to avoid racing
// that resolution. It is covered instead by its own dedicated tests in the "SettingsPage
// get-running mirror tab" describe block below, which seed the override explicitly (both
// on and off) and await the trigger.
const WIRED_SETTINGS_TAB_PARAMS = SETTINGS_TAB_PARAMS.filter((tab) => tab !== "get-running");

// Every render wraps in a MemoryRouter: the page reads `?tab=` through useSearchParams and
// tabs render react-router <Link>s (for example EmailTemplatesTab's per-template links), which
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
    // trigger — scope to the heading <p> to disambiguate. (The admin default tab is now
    // "How this org works", so the OrganizationTab card is not mounted here.)
    expect(screen.getByText("Organization", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Modules", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /booking engine on/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /contracts off/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /scheduling/i })).not.toBeInTheDocument();
    // Switching a section swaps the visible content.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & coverage/i }));
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");
  });

  // Broad Settings, read-only floor: these tabs used to be admin-only. A producer now
  // sees them too (read-only unless granted the matching capability) — only the rights
  // matrix itself ("Roles & rights") stays admin-only.
  it("shows a producer the previously admin-only nav items, but not Roles & rights", async () => {
    vi.mocked(useAuth).mockReturnValue({
      ...DEFAULT_AUTH,
      hasRole: (r: string) => r === "producer",
    } as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByText("Modules");
    expect(screen.getByRole("tab", { name: /sources/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /booking engine/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /email templates/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^notifications$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^organization$/i })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /roles & rights/i })).not.toBeInTheDocument();
  });

  // Settings > Documentation is a super-admin console surface, not a producer or admin
  // destination: DEFAULT_AUTH's isSuperAdmin: false covers both roles here since neither
  // grants it.
  it("hides the Documentation trigger for a non-super-admin", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByText("Modules", { selector: "p" });
    expect(screen.queryByRole("tab", { name: /documentation/i })).not.toBeInTheDocument();
  });

  it("shows the Documentation trigger for a super-admin", async () => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /documentation/i })).toBeInTheDocument();
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
    expect(await screen.findByRole("tab", { name: /sources/i })).toHaveAttribute("aria-selected", "true");
  });

  it("lands on 'How this org works' by default for an admin", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter initialEntries={["/settings"]}><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /how this org works/i })).toHaveAttribute("aria-selected", "true");
  });

  it("redirects a retired casts-cities or production-ownership deep link to Casts & coverage", async () => {
    // Both sections folded into one tab; old bookmarks/notifications must still resolve
    // rather than stranding the user on the role default (settingsTabs.test.ts pins the
    // pure resolver, this pins the page actually wires it through).
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    const { unmount } = renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=casts-cities"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");
    unmount();

    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=production-ownership"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores an admin-only tab asked for by a producer", async () => {
    // A producer cannot see "permissions", so the page falls back to their default,
    // which is now "How this org works" (producers can see it).
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, hasRole: (r: string) => r === "producer" } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=permissions"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /how this org works/i })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores the docs tab asked for by a non-super-admin, from the page's side too", async () => {
    // settingsTabs.test.ts pins the pure resolver; this pins the page actually wires
    // isSuperAdmin through to it rather than only isAdmin.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=docs"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /how this org works/i })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the docs tab for a super-admin", async () => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=docs"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /documentation/i })).toHaveAttribute("aria-selected", "true");
  });

  // The registry in settingsTabs.ts is a list of strings; only the page knows whether each
  // one still names a section it renders. Renaming a TabsTrigger value (or dropping a
  // section) would leave Tabs holding a value with no trigger and no content: the deep link
  // would open a blank page and no pure test could see it.
  //
  // Scoped to the page's own nav tablist (the first "tablist" in the tree, rendered ahead of
  // any tab content): Roles & rights renders its own nested SegmentedControl "tablist"s
  // (preset picker, rights filter) for the ?tab=permissions case, each with its own
  // aria-selected option, which would otherwise inflate the count this assertion checks.
  it.each([...WIRED_SETTINGS_TAB_PARAMS])("selects a real section for ?tab=%s", async (tab) => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}><SettingsPage /></MemoryRouter>,
    );
    const [navTablist] = await screen.findAllByRole("tablist");
    const triggers = within(navTablist).getAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  // The ADMIN_ONLY list in settingsTabs.ts is a literal, while the real gate is the per-item
  // `show` predicate in this page's navGroups. Nothing ties them together: move any listed
  // tab behind `isAdmin` (as "permissions" already is) without adding it to ADMIN_ONLY and
  // resolveInitialTab would hand a producer a value with no trigger and no content, leaving
  // the deep link on a blank page. Running the same sweep as a producer is what pins them.
  //
  // Scoped to the page's own nav tablist for the same reason as the admin sweep above:
  // Casts & coverage renders its own nested SegmentedControl "tablist"s (Coverage/Ownership
  // segment, and CoveragePanel's own org/per-show scope), each with its own aria-selected
  // option, which would otherwise inflate the count this assertion checks.
  it.each([...WIRED_SETTINGS_TAB_PARAMS])("selects a real section for a producer at ?tab=%s", async (tab) => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, hasRole: (r: string) => r === "producer" } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}><SettingsPage /></MemoryRouter>,
    );
    const [navTablist] = await screen.findAllByRole("tablist");
    const triggers = within(navTablist).getAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("deep-links the hire-orders tab (its trigger renders for any admin regardless of entitlement)", async () => {
    // The hire-orders trigger is gated only by role (show: isAdmin || isProducer), not by the
    // hire_orders entitlement — an unentitled org just gets a "module off" badge and the
    // tab's own self-gated content. So honouring ?tab=hire-orders never strands anyone, and
    // the /get-running contract-task breadcrumbs deep-link straight to it.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=hire-orders"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /contracts/i })).toHaveAttribute("aria-selected", "true");
  });

  it("still lets the user switch tabs after arriving through a deep link", async () => {
    // The param seeds the tab; it must not pin the page there. This is also the guard on
    // the re-seed effect below: an effect that fired on every render (rather than on a
    // change of the param) would snap the page straight back to "airtable" here.
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}><SettingsPage /></MemoryRouter>,
    );
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /casts & coverage/i }));
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the named tab when a deep link arrives while the page is already open", async () => {
    // Seeding from a lazy useState initializer alone runs once per MOUNT. Every deep link
    // on this branch (LadderStep, EligibilityStep) is rendered off Settings, so it always
    // remounts the page and the gap was invisible. A notification deep-link clicked while
    // the user is already sitting on Settings changes the URL and nothing else: the page
    // has to follow the param, not just the mount.
    //
    // Uses a super-admin so the docs deep-link stays reachable: this test is about the
    // re-seed effect following a same-page navigation, not about the super-admin gate.
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=airtable"]}>
        <Link to="/settings?tab=docs">deep link</Link>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /sources/i })).toHaveAttribute("aria-selected", "true");
    // Switch by hand in between, so this proves the effect follows the param rather than
    // simply re-running on any state change.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & coverage/i }));
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");

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
    expect(await screen.findByRole("tab", { name: /sources/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.mouseDown(screen.getByRole("tab", { name: /casts & coverage/i }));
    expect(await screen.findByRole("tab", { name: /casts & coverage/i })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("link", { name: /sync report/i }));
    expect(await screen.findByRole("tab", { name: /sources/i })).toHaveAttribute("aria-selected", "true");
  });
});

describe("SettingsPage get-running mirror tab (wireflow v3 phase 5)", () => {
  // Neither module on is the shallowest board state (get-running-v3-nothing testid), so
  // this suite doesn't need booking/hire-order fixtures just to prove the tab mounts and
  // wires through — same minimal input GetRunningSettingsMirror.test.tsx / GetRunningBoardV3.test.tsx use.
  const NOTHING_TO_SET_UP: GetRunningInputV3 = {
    role: "admin",
    bookingOn: false,
    hireOrdersOn: false,
    booking: null,
    hire: null,
    datesSource: "airtable",
    datesConnectDone: true,
    datesMapDone: true,
    datesCitiesDone: true,
    hasAnyDates: true,
    producerCount: 1,
    skillGaps: 0,
    feeDone: false,
    documentDone: false,
    canManageShows: true,
    canEditScheduling: true,
    canEditBooking: true,
    canManageSkills: true,
    canEditHire: true,
    canAddArtists: true,
    canInvite: true,
  };

  beforeEach(() => {
    vi.mocked(useGetRunningV3).mockReturnValue({ model: composeGetRunningV3(NOTHING_TO_SET_UP), isLoading: false });
  });

  afterEach(() => {
    // Restore the file's base seed for every table: the override case below reseeds
    // `app_settings` alone to flip `getrunning_v3_enabled` for org-1.
    for (const k of Object.keys(client)) delete client[k];
    Object.assign(client, createFakeSupabase(BASE_SEED));
  });

  // `resolveOrgSetting` (fetchGetRunningV3Enabled) queries with `.eq("key", ...)`, which the
  // fake's array-seed matches on; the page's own bulk settings query has no `key` eq() call,
  // so it falls through to the `when`-less fallback entry (empty rows) instead.
  function seedV3Override(orgId: string, enabled: boolean) {
    for (const k of Object.keys(client)) delete client[k];
    Object.assign(client, createFakeSupabase({
      ...BASE_SEED,
      app_settings: [
        { when: { key: "getrunning_v3_enabled" }, data: [{ org_id: orgId, value: enabled }], error: null },
        { data: [], error: null },
      ],
    }));
  }

  it("shows a super-admin the trigger even with v3 disabled for the org", async () => {
    seedV3Override("org-1", false);
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /^get running$/i })).toBeInTheDocument();
  });

  it("hides the trigger from a plain admin while v3 is disabled for the org", async () => {
    // v3 is the app default now, so the trigger only stays hidden from a plain admin when
    // the org has an explicit false override; seed it rather than relying on the default.
    seedV3Override("org-1", false);
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByRole("tab", { name: /how this org works/i });
    expect(screen.queryByRole("tab", { name: /^get running$/i })).not.toBeInTheDocument();
  });

  it("shows a plain admin the trigger once the org's v3 override is on", async () => {
    seedV3Override("org-1", true);
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /^get running$/i })).toBeInTheDocument();
  });

  // Isolates the PRODUCER-only arm of `showGetRunning = isSuperAdmin || ((isAdmin ||
  // isProducer) && v3Enabled)`. DEFAULT_AUTH's `hasRole: () => true` makes isAdmin AND
  // isProducer both true, so every case above also exercises this arm incidentally and
  // would keep passing even if the OR became an AND, or the isProducer disjunct were
  // dropped entirely. `hasRole: (r) => r === "producer"` (isAdmin: false, isProducer: true,
  // isSuperAdmin: false, mirroring the existing producer-only sweep fixture above) pins
  // both directions on their own.
  it("shows a producer the trigger once the org's v3 override is on, but not while v3 is off", async () => {
    const producerAuth = { ...DEFAULT_AUTH, hasRole: (r: string) => r === "producer" };

    seedV3Override("org-1", true);
    vi.mocked(useAuth).mockReturnValue(producerAuth as never);
    const { unmount } = renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /^get running$/i })).toBeInTheDocument();
    unmount();

    // v3 is the app default now, so the "off" half needs an explicit false override.
    seedV3Override("org-1", false);
    vi.mocked(useAuth).mockReturnValue(producerAuth as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByRole("tab", { name: /how this org works/i });
    expect(screen.queryByRole("tab", { name: /^get running$/i })).not.toBeInTheDocument();
  });

  it("renders the mirror (toggle + board) at ?tab=get-running for a super-admin", async () => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=get-running"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /^get running$/i })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("switch")).toBeInTheDocument();
    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
  });

  it("renders the board (no super-admin toggle) at ?tab=get-running for an admin with the org override on", async () => {
    seedV3Override("org-1", true);
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=get-running"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /^get running$/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  // CI review-bot finding (correctness): resolveInitialTab used to resolve `?tab=get-running`
  // to "get-running" for any admin/producer regardless of the org's v3 flag, but
  // showGetRunning gates the trigger/content on `isSuperAdmin || ((isAdmin || isProducer) &&
  // v3Enabled)` — so a bookmarked link landed on a tab with no trigger and no content, and
  // Radix rendered a blank pane. resolveInitialTab now takes the same v3Enabled flag and
  // falls back to the role default when it's off, so the page falls back to its real "how
  // this org works" content instead of going blank.
  it("falls back to the default section (not a blank pane) at ?tab=get-running for a plain admin while v3 is off for the org", async () => {
    seedV3Override("org-1", false);
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=get-running"]}><SettingsPage /></MemoryRouter>,
    );
    expect(await screen.findByRole("tab", { name: /how this org works/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tab", { name: /^get running$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("get-running-v3-nothing")).not.toBeInTheDocument();
  });

  // Same invariant the two shared exhaustiveness sweeps above pin for every other
  // SETTINGS_TAB_PARAMS value ("exactly one selected tab") — covering both branches of
  // showGetRunning's OR gate, since neither shared sweep can hold either branch true for a
  // single param without changing every other param's assertions too (see the
  // WIRED_SETTINGS_TAB_PARAMS comment above).
  it("selects exactly one tab at ?tab=get-running for a super-admin", async () => {
    vi.mocked(useAuth).mockReturnValue({ ...DEFAULT_AUTH, isSuperAdmin: true } as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=get-running"]}><SettingsPage /></MemoryRouter>,
    );
    const [navTablist] = await screen.findAllByRole("tablist");
    const triggers = within(navTablist).getAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("selects exactly one tab at ?tab=get-running for an admin with the org override on", async () => {
    seedV3Override("org-1", true);
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(
      <MemoryRouter initialEntries={["/settings?tab=get-running"]}><SettingsPage /></MemoryRouter>,
    );
    const [navTablist] = await screen.findAllByRole("tablist");
    const triggers = within(navTablist).getAllByRole("tab");
    expect(triggers.filter((t) => t.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });
});

describe("SettingsPage producer capability read-only floor", () => {
  // The Notifications section is rendered inline (not a separate tab component), so its
  // read-only threading is exercised here rather than in a component-level test file.
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
});

describe("Settings nav icons", () => {
  it("does not give How this org works and Get running the same icon", async () => {
    vi.mocked(useAuth).mockReturnValue(DEFAULT_AUTH as never);
    renderWithProviders(<MemoryRouter><SettingsPage /></MemoryRouter>);
    await screen.findByText("Modules");

    // lucide stamps its component name into the svg class, so this reads the actual mark.
    // Rocket is Get running's identity, in this nav and in the sidebar; the Get running
    // tab itself only appears for a v3-enabled org, so assert against the mark rather
    // than against a row that may not be rendered.
    const mark = screen.getByRole("tab", { name: /how this org works/i }).querySelector("svg")?.getAttribute("class") ?? "";
    expect(mark).not.toBe("");
    expect(mark).not.toContain("lucide-rocket");
  });
});
