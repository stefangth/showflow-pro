import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrderDetailPage.test.tsx: a call-recording fake swapped
// into a hoisted holder (never a hand-rolled vi.mock chain), and useAuth as a
// vi.fn() so each test picks the org/role. The page drives its data through
// the real fetchHireOrders/fetchAwaitingCountersignCount (no data-layer
// mocking), so seeding the fake's hire_orders table exercises the real
// status/search filtering end to end.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
// The page now always mounts NewOrderWizard (Task 2), which calls useNavigate
// for its "Open order" success action; OrderSlideOver's Edit button (Task 2b)
// also navigates. A stable spy (not a fresh vi.fn() per call) lets tests
// assert on it. `Link` is mocked too (Task 7's FeatureOffBanner renders one)
// as a plain anchor so it doesn't need a Router context.
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, className, children }: { to: string; className?: string; children?: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));
// The rail is exercised on its own in SetupRail.test.tsx; stub it here so this
// page's tests don't also have to seed its three app_settings reads. The page
// reads the same hook the rail does for `visible` (a null child does not
// collapse a grid track) and, since Plan B's fix wave, for `reinvocable` too
// (the header re-invoke button used to be gated independently, which could
// offer to reopen a rail that would render nothing actionable -- now it reads
// the exact same hook output as the callout, just a different field).
const { railState } = vi.hoisted(() => ({
  railState: { value: { visible: true, reinvocable: false } as { visible: boolean; reinvocable: boolean } },
}));
vi.mock("@/components/hireOrders/setup/SetupRail", () => ({
  SetupRail: () => <div data-testid="setup-rail" />,
}));
vi.mock("@/components/hireOrders/setup/useSetupRailVisible", () => ({
  useSetupRailVisible: () => railState.value,
}));
// Still needed for the callout's "X of Y steps done" text. Partial mock: this
// module also exports useOrgLetterhead/useOrgTerms/useImportTermsTemplates,
// which NewOrderWizard and OrderSlideOver (unmocked here) depend on.
const { hireOrderSetupStatus } = vi.hoisted(() => ({
  hireOrderSetupStatus: { value: { complete: false, doneCount: 0, totalCount: 3 } as { complete: boolean; doneCount: number; totalCount: number } },
}));
vi.mock("@/hooks/useHireOrderSetup", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useHireOrderSetup")>()),
  useHireOrderSetupStatus: () => ({ status: hireOrderSetupStatus.value, isLoading: false }),
}));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import HireOrdersPage from "./HireOrdersPage";

function authAs(role: "admin" | "producer" = "producer", orgId = "org-1", isSuperAdmin = false) {
  vi.mocked(useAuth).mockReturnValue({
    currentOrg: { id: orgId, name: "Aurora Productions", slug: "aurora" },
    hasRole: (r: string) => r === role,
    roles: [role],
    isSuperAdmin,
  } as never);
}

/** A hire_orders row shaped like fetchHireOrders returns it (artist + show_date joined). */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "ho-1",
    order_no: "HO-2026-0201-1",
    status: "draft",
    org_id: "org-1",
    artist_id: "ar-1",
    show_date_id: "sd-1",
    booking_id: "bk-1",
    fee_amount: 1000,
    fee_currency: "EUR",
    terms_variant: "standard",
    pdf_path: null,
    created_at: "2026-01-10T09:00:00Z",
    issued_at: null,
    countersigned_at: null,
    data: {
      artist_name: { value: "Ada Lovelace", source: "showflow" },
      recipient_email: { value: "ada@example.com", source: "showflow" },
      duration_min: { value: "90", source: "showflow" },
    },
    artists: { name: "Ada Lovelace" },
    show_dates: { date: "2030-02-01", venue: "Main Hall" },
    ...overrides,
  };
}

const ROWS = [
  order({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", fee_amount: 1000, created_at: "2026-01-10T09:00:00Z" }),
  order({
    id: "ho-2", order_no: "HO-2026-0301-1", status: "ready", fee_amount: 2000, created_at: "2026-01-09T09:00:00Z",
    artists: { name: "Zed Zeta" }, show_dates: { date: "2030-03-01", venue: "West Wing" },
    data: { artist_name: { value: "Zed Zeta", source: "showflow" }, recipient_email: { value: "zed@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-3", order_no: "HO-2026-0401-1", status: "issued", fee_amount: 3000, created_at: "2026-01-08T09:00:00Z",
    pdf_path: "orgs/org-1/ho-3.pdf", issued_at: "2026-01-08T10:00:00Z",
    artists: { name: "Mira Voss" }, show_dates: { date: "2030-04-01", venue: "East Hall" },
    data: { artist_name: { value: "Mira Voss", source: "showflow" }, recipient_email: { value: "mira@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-4", order_no: "HO-2026-0501-1", status: "countersigned", fee_amount: 4000, created_at: "2026-01-07T09:00:00Z",
    pdf_path: "orgs/org-1/ho-4.pdf", issued_at: "2026-01-07T10:00:00Z", countersigned_at: "2026-01-09T10:00:00Z",
    artists: { name: "Nico Lin" }, show_dates: { date: "2030-05-01", venue: "South Hall" },
    data: { artist_name: { value: "Nico Lin", source: "showflow" }, recipient_email: { value: "nico@example.com", source: "showflow" } },
  }),
  order({
    id: "ho-5", order_no: "HO-2026-0601-1", status: "void", fee_amount: 5000, created_at: "2026-01-06T09:00:00Z",
    artists: { name: "Old One" }, show_dates: { date: "2030-06-01", venue: "North Hall" },
    data: { artist_name: { value: "Old One", source: "showflow" } },
  }),
];

const SIGNED_URL = "https://signed.example/orders/ho-3.pdf?token=abc";

// The bulk-issue tests below now go through BatchIssuePreflightDialog, which checks
// every selected order's data (fee, recipient email, date, terms) against the org's
// letterhead and terms before it will offer to issue anything. ROWS' fixtures don't
// carry a `data.fee`/`data.date`/`terms_variant` (the KPI/table tests that use ROWS
// unmodified never needed them), so the two bulk-issue tests below seed their own
// clean rows and a configured org, matching the fake's documented gotcha: the two
// app_settings keys must be separate array `when` entries or one read clobbers the other.
const READY_APP_SETTINGS: TableSeed = [
  {
    when: { key: "hire_order_letterhead" },
    data: [{ org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
  },
  {
    when: { key: "hire_order_terms" },
    data: [{
      org_id: "org-1",
      value: { templates: [{ id: "standard", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "standard" },
    }],
  },
];

function readyOrder(overrides: Record<string, unknown> = {}) {
  return order({
    terms_variant: "standard",
    data: {
      artist_name: { value: "Ada Lovelace", source: "showflow" },
      recipient_email: { value: "ada@example.com", source: "showflow" },
      date: { value: "2030-02-01", source: "showflow" },
      fee: { value: "1000.00", source: "manual" },
    },
    ...overrides,
  });
}

/** Click "Issue selected" (now opens BatchIssuePreflightDialog), wait for it to
 *  report the expected count clean, then confirm from the dialog. */
async function openBulkDialogAndConfirm(expectedCount: number) {
  fireEvent.click(screen.getByRole("button", { name: /issue selected/i }));
  const confirmBtn = await screen.findByRole("button", { name: new RegExp(`Issue ${expectedCount} orders?`, "i") });
  await waitFor(() => expect(confirmBtn).toBeEnabled());
  fireEvent.click(confirmBtn);
}

function seedFor(rows: Record<string, unknown>[], extra: Record<string, TableSeed> = {}) {
  seedClient({
    hire_orders: { data: rows, error: null },
    // One seeded response services every generate-hire-orders action this page
    // calls (issue / download-url) — the fake doesn't branch on request body.
    "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [], url: SIGNED_URL }, error: null },
    // Default the module ON so the existing (non-Task-7) tests below keep
    // exercising the entitled path. The two Task 7 tests override this.
    org_entitlements: { data: [{ feature: "hire_orders", enabled: true }], error: null },
    ...extra,
  });
}

function renderPage() {
  return renderWithProviders(<HireOrdersPage />);
}

describe("HireOrdersPage", () => {
  beforeEach(() => {
    navigate.mockClear();
    authAs("producer");
    railState.value = { visible: true, reinvocable: false };
    hireOrderSetupStatus.value = { complete: false, doneCount: 0, totalCount: 3 };
    localStorage.clear();
    seedFor(ROWS);
  });

  it("renders the page head with eyebrow, title, and a meta line summarizing count and value", async () => {
    renderPage();
    expect(await screen.findByText("Hire orders")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    // 5 total orders fetched (unfiltered); value committed excludes the void row
    // (1000+2000+3000+4000 = 10000).
    expect(await screen.findByText(/5 orders/i)).toBeInTheDocument();
    expect(screen.getByText(/€10,000\.00 committed/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("renders the four KPI tiles with counts derived from the unfiltered order set", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    const kpiRegion = screen.getByTestId("orders-kpis");
    expect(within(kpiRegion).getByText("Issued")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Awaiting countersign")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Countersigned")).toBeInTheDocument();
    expect(within(kpiRegion).getByText("Value committed")).toBeInTheDocument();

    // Each tile is a label <p> followed by a value <p> in the same card body;
    // read the value next to a given label rather than matching a bare count
    // (multiple tiles can share the same count, e.g. two tiles reading "1").
    const kpiValue = (label: string) => {
      const labelEl = within(kpiRegion).getByText(label);
      return labelEl.nextElementSibling?.textContent;
    };
    // Issued (issued+countersigned) = 2, Awaiting (issued only) = 1, Countersigned = 1
    await waitFor(() => expect(kpiValue("Issued")).toBe("2"));
    expect(kpiValue("Awaiting countersign")).toBe("1");
    expect(kpiValue("Countersigned")).toBe("1");
    expect(kpiValue("Value committed")).toBe("€10,000.00");
  });

  it("renders the table with mono order number, stacked artist/venue, mono date, right-aligned fee, and a status badge", async () => {
    renderPage();
    const row = await screen.findByText("HO-2026-0201-1");
    expect(row).toHaveClass("font-mono");
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
    const dateCell = screen.getByText("01/02/2030");
    expect(dateCell).toHaveClass("font-mono");
    const feeCell = screen.getByText("€1,000.00");
    expect(feeCell).toHaveClass("text-right");
    // "Draft" also labels a filter chip button — scope to the status badge div.
    expect(screen.getByText("Draft", { selector: "div" })).toBeInTheDocument();
  });

  it("opens the slide-over on row click and shows facts + Issue and send for a draft order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /issue and send/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^void$/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /download/i })).not.toBeInTheDocument();
  });

  it("shows Download and Mark countersigned for an issued order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0401-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /download/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /mark countersigned/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /issue and send/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it("shows Edit alongside Issue and send for a draft order, and navigates to the V2 builder", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    const editBtn = within(dialog).getByRole("button", { name: /^edit$/i });
    fireEvent.click(editBtn);
    expect(navigate).toHaveBeenCalledWith("/hire-orders/ho-1/edit");
  });

  it("downloads via the download-url action and opens the returned signed URL", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPage();
    const cell = await screen.findByText("HO-2026-0401-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /download/i }));
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_id?: string } | undefined;
      expect(body?.action).toBe("download-url");
      expect(body?.order_id).toBe("ho-3");
    });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith(SIGNED_URL, "_blank", "noopener,noreferrer"));
    openSpy.mockRestore();
  });

  it("hides the Void action for an already-void order", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0601-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /^void$/i })).not.toBeInTheDocument();
  });

  it("voids an order after confirming the AlertDialog", async () => {
    renderPage();
    const cell = await screen.findByText("HO-2026-0201-1");
    fireEvent.click(cell);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^void$/i }));
    const confirmBtn = await screen.findByRole("button", { name: /void order/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeDefined();
      expect((update!.args[0] as { status?: string }).status).toBe("void");
    });
  });

  it("filters the table by status chip without changing the KPI totals", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("button", { name: /^draft$/i }));
    await waitFor(() => {
      expect(screen.queryByText("HO-2026-0301-1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();
    // KPI totals stay computed from the unfiltered set even while the table is filtered.
    expect(screen.getByText(/5 orders/i)).toBeInTheDocument();
  });

  it("searches by artist name across the whole set", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "mira" } });
    await waitFor(() => {
      expect(screen.getByText("HO-2026-0401-1")).toBeInTheDocument();
      expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument();
    });
  });

  it("debounces rapid search typing into one filtered query instead of one per keystroke, while the input itself stays responsive", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    const selectCallCount = () =>
      ((client.calls ?? []) as { table: string; method: string }[]).filter(
        (c) => c.table === "hire_orders" && c.method === "select",
      ).length;
    const before = selectCallCount();

    const input = screen.getByPlaceholderText(/search/i);
    // Fast typing: several keystrokes fired back-to-back with no elapsed
    // time between them, same as a real user typing well under the 275ms
    // debounce window.
    fireEvent.change(input, { target: { value: "m" } });
    fireEvent.change(input, { target: { value: "mi" } });
    fireEvent.change(input, { target: { value: "mir" } });
    fireEvent.change(input, { target: { value: "mira" } });

    // The input reflects every keystroke immediately (stays controlled and
    // responsive) even though the query underneath hasn't fired yet.
    expect(input).toHaveValue("mira");
    expect(selectCallCount()).toBe(before);

    await waitFor(() => {
      expect(screen.getByText("HO-2026-0401-1")).toBeInTheDocument();
      expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument();
    });

    // The whole four-keystroke burst collapsed into a single debounced
    // filter change: one query round for the search term (order_no ilike +
    // full-set fetch, per fetchHireOrders' own search fan-out) rather than
    // one round per keystroke.
    expect(selectCallCount() - before).toBeLessThanOrEqual(2);
  });

  it("enables the bulk bar on row selection and disables Issue selected unless every selected row is draft/ready", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0401-1/i }));
    const issueBtn = screen.getByRole("button", { name: /issue selected/i });
    expect(issueBtn).toBeDisabled();
  });

  it("issues the selected draft/ready orders via the bulk bar", async () => {
    seedFor(
      [
        readyOrder({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", fee_amount: 1000, created_at: "2026-01-10T09:00:00Z" }),
        readyOrder({
          id: "ho-2", order_no: "HO-2026-0301-1", status: "ready", fee_amount: 2000, created_at: "2026-01-09T09:00:00Z",
          artists: { name: "Zed Zeta" }, show_dates: { date: "2030-03-01", venue: "West Wing" },
        }),
      ],
      { app_settings: READY_APP_SETTINGS },
    );
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i }));
    const issueBtn = screen.getByRole("button", { name: /issue selected/i });
    expect(issueBtn).toBeEnabled();
    await openBulkDialogAndConfirm(2);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_ids?: string[] } | undefined;
      expect(body?.action).toBe("issue");
      expect(body?.order_ids?.sort()).toEqual(["ho-1", "ho-2"]);
    });
  });

  it("prunes a selected row from the bulk-issue bar once it is filtered out of view, so a hidden selection can never be issued unrevalidated", async () => {
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i })); // ho-1, draft
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeEnabled();

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "zed" } });
    await waitFor(() => expect(screen.queryByText("HO-2026-0201-1")).not.toBeInTheDocument());

    // The only selected row (ho-1) is no longer visible under the "zed"
    // search — the bulk bar must disappear entirely rather than keep a
    // stale, un-revalidated selection issuable.
    expect(screen.queryByRole("button", { name: /issue selected/i })).not.toBeInTheDocument();
  });

  it("sends only the still-visible, still-issuable ids when a filter change hides part of a prior selection", async () => {
    seedFor(
      [
        readyOrder({ id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", fee_amount: 1000, created_at: "2026-01-10T09:00:00Z" }),
        readyOrder({
          id: "ho-2", order_no: "HO-2026-0301-1", status: "ready", fee_amount: 2000, created_at: "2026-01-09T09:00:00Z",
          artists: { name: "Zed Zeta" }, show_dates: { date: "2030-03-01", venue: "West Wing" },
        }),
        ...ROWS.slice(2),
      ],
      { app_settings: READY_APP_SETTINGS },
    );
    renderPage();
    await screen.findByText("HO-2026-0201-1");
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0201-1/i })); // ho-1, draft
    fireEvent.click(screen.getByRole("checkbox", { name: /select order ho-2026-0301-1/i })); // ho-2, ready
    expect(screen.getByRole("button", { name: /issue selected/i })).toBeEnabled();

    // Narrow to the Draft chip: ho-2 (ready) drops out of view, but stays
    // in the raw selection set unless it's pruned.
    fireEvent.click(screen.getByRole("button", { name: /^draft$/i }));
    await waitFor(() => expect(screen.queryByText("HO-2026-0301-1")).not.toBeInTheDocument());
    expect(screen.getByText("HO-2026-0201-1")).toBeInTheDocument();

    await openBulkDialogAndConfirm(1);
    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke?.args[0] as { action?: string; order_ids?: string[] } | undefined;
      expect(body?.action).toBe("issue");
      // ho-2 must never be sent: it was hidden by the filter and was never
      // re-validated against its current (visible) status.
      expect(body?.order_ids).toEqual(["ho-1"]);
    });
  });

  it("shows New order and Import from spreadsheet, both enabled (Task 5: import wizard shipped)", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    // hire_orders defaults OFF in the entitlements registry, so useFeature
    // reports disabled for the brief instant the entitlements query is still
    // loading (Task 7) — wait for it to settle to the seeded "enabled" value
    // rather than asserting on the very first render.
    await waitFor(() => expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled());
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled();
  });

  it("opens the import wizard on Import from spreadsheet", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    await waitFor(() => expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /import from spreadsheet/i }));
    expect(await screen.findByText("Import hire orders from a spreadsheet")).toBeInTheDocument();
  });

  it("opens the guided wizard on New order and does not self-disable to a dead-end", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    await waitFor(() => expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled());
    const newOrderBtn = screen.getByRole("button", { name: /new order/i });
    fireEvent.click(newOrderBtn);
    expect(await screen.findByText("New hire order")).toBeInTheDocument();
    // Task-1 Minor resolved: the button used to disable itself to `wizardOpen`,
    // leaving no way to reopen the wizard after a first click.
    expect(newOrderBtn).toBeEnabled();
  });

  // Task 7: ProtectedRoute lets super-admins past the route-level feature gate,
  // so a super-admin viewing an org without the hire_orders module still lands
  // here. Every write on this page calls generate-hire-orders, which 403s when
  // the module is off, so the page must warn and disable writes rather than
  // let the click happen.
  it("warns and disables creation when the module is off", async () => {
    seedFor(ROWS, { org_entitlements: { data: [{ feature: "hire_orders", enabled: false }], error: null } });
    renderPage();
    expect(await screen.findByText(/Hire orders is off for this organization/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new order/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeDisabled();
  });

  it("shows no banner and enabled actions when the module is on", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    // Same loading-race note as above: wait for the entitlements query to
    // settle before asserting the banner is gone and actions are enabled.
    await waitFor(() => expect(screen.queryByText(/is off for this organization/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /new order/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /import from spreadsheet/i })).toBeEnabled();
  });

  it("shows a full-width setup callout (not a cramped side column) and opens the checklist in a Sheet on click", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    // findBy, not getBy: the rail runs on the RAW entitlement with no fail-open, so it
    // appears once org_entitlements resolves rather than optimistically on first
    // paint. That wait is the point. Mounting a live app_settings write surface before
    // knowing the org is entitled is what the two-gate split exists to prevent.
    expect(await screen.findByText(/get hire orders ready/i)).toBeInTheDocument();
    // No fixed side-column grid track anywhere on the page (Plan B Task 3 uncramp).
    expect(document.querySelector(".lg\\:grid-cols-\\[1fr_340px\\]")).toBeNull();
    expect(screen.queryByTestId("setup-rail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open checklist/i }));
    expect(await screen.findByTestId("setup-rail")).toBeInTheDocument();
  });

  it("hides the setup callout once the rail has retired", async () => {
    railState.value = { visible: false, reinvocable: false };
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByText(/get hire orders ready/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("setup-rail")).not.toBeInTheDocument();
  });

  it("shows no re-invoke button by default (not dismissed)", async () => {
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });

  it("shows the header re-invoke button once dismissed while setup is still incomplete", async () => {
    // The mocked hook reports what the real useSetupRailVisible would compute
    // once dismissed: not visible (the callout is gone), but reinvocable --
    // there's still something actionable once the header button reopens it.
    railState.value = { visible: false, reinvocable: true };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    renderPage();
    expect(await screen.findByRole("button", { name: /setup checklist/i })).toBeInTheDocument();
    // The dismissed rail leaves no callout behind either.
    expect(screen.queryByText(/get hire orders ready/i)).not.toBeInTheDocument();
  });

  it("re-invokes on click: clears the dismissal and opens the Sheet with the rail", async () => {
    railState.value = { visible: false, reinvocable: true };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /setup checklist/i }));

    expect(await screen.findByTestId("setup-rail")).toBeInTheDocument();
    expect(localStorage.getItem("showflow.hireOrderSetup.hidden.org-1")).toBeNull();
  });

  it("hides the re-invoke button once setup is complete, even if previously dismissed", async () => {
    // The real hook reports both false once complete, regardless of dismissed.
    railState.value = { visible: false, reinvocable: false };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    hireOrderSetupStatus.value = { complete: true, doneCount: 3, totalCount: 3 };
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });

  it("never offers the re-invoke button in a state where the rail itself would render nothing actionable", async () => {
    // Regression for the fix wave's finding: a producer once nothing blocks
    // issuing is exactly the state useSetupRailVisible reports `reinvocable:
    // false` for, even while dismissed -- the old independently-gated button
    // (`dismissed && !complete`) would have shown here.
    railState.value = { visible: false, reinvocable: false };
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    hireOrderSetupStatus.value = { complete: false, doneCount: 2, totalCount: 3 };
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });

  it("does not show the re-invoke button when the module is off, even if dismissed", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    seedFor(ROWS, { org_entitlements: { data: [{ feature: "hire_orders", enabled: false }], error: null } });
    renderPage();
    await screen.findByText(/Hire orders is off for this organization/);
    expect(screen.queryByRole("button", { name: /setup checklist/i })).not.toBeInTheDocument();
  });

  it("does not mount the setup rail when the module is off", async () => {
    // Super-admins bypass the route's entitlement gate, and hire_orders defaults
    // off, so a module-off org is the normal case for them. The page must not
    // offer an interactive setup checklist right beside its own "changes cannot
    // be saved" banner -- app_settings RLS checks role, not entitlement, so those
    // saves would land and configure a module the org does not have.
    seedFor(ROWS, { org_entitlements: { data: [{ feature: "hire_orders", enabled: false }], error: null } });
    renderPage();
    await screen.findByText(/Hire orders is off for this organization/);
    expect(screen.queryByTestId("setup-rail")).not.toBeInTheDocument();
  });

  it("withholds the setup rail from a super-admin on a module-off org", async () => {
    // The page runs two gates on purpose. useModuleGate exempts super-admins, so
    // god-mode still gets the page itself and no off-state banner. The setup rail is
    // a WRITE surface and runs on the raw entitlement instead: app_settings RLS
    // checks role, not entitlement, so a super-admin confirming the rail here would
    // really write those settings and configure a module this org does not have.
    authAs("admin", "org-1", true);
    seedFor(ROWS, { org_entitlements: { data: [{ feature: "hire_orders", enabled: false }], error: null } });
    renderPage();
    await screen.findByText("Hire orders");
    expect(screen.queryByTestId("setup-rail")).not.toBeInTheDocument();
    // The super-admin exemption is what distinguishes this from the test above.
    expect(screen.queryByText(/Hire orders is off for this organization/)).not.toBeInTheDocument();
  });

  it("points at the dates that are ready when there are no orders yet", async () => {
    // No hire_orders at all (noOrdersYet), and two fully-filled show_dates with
    // no active order covering them (fetchDatesReadyForHireOrder's real logic,
    // exercised through the real useDatesReadyForHireOrder hook against the
    // fake client, not a hook mock).
    seedFor([], {
      show_dates: { data: [{ id: "d1", status: "fully_filled" }, { id: "d2", status: "fully_filled" }], error: null },
      hire_order_dates: { data: [], error: null },
    });
    renderPage();
    expect(await screen.findByText(/2 dates are fully cast and ready/i)).toBeInTheDocument();
    // A semantic token, not a numbered accent stop: those are identical in light
    // and dark by design, so bare on a card the link failed contrast in dark.
    expect(screen.getByText(/Generate from Shows and bookings/).className).toContain("text-primary");
  });

  it("never points at ready dates for an org that already has orders", async () => {
    // noOrdersYet read `allOrders.length === 0` without consulting the query's
    // loading state, so this pointer flashed on every mount of an org that has
    // orders, before the first page of them arrived.
    seedFor(ROWS, {
      show_dates: { data: [{ id: "d1", status: "fully_filled" }], error: null },
      hire_order_dates: { data: [], error: null },
    });
    renderPage();
    await screen.findByText("Hire orders");
    await waitFor(() => expect(screen.getAllByText(/HO-2026-0201-1/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/fully cast and ready/i)).not.toBeInTheDocument();
  });

  describe("timeframe filter (Plan B fix wave: defaults to All time, not Upcoming)", () => {
    it("defaults to All time: shows a past-dated order tinted, right alongside an untinted upcoming one", async () => {
      seedFor([
        order({
          id: "ho-past", order_no: "HO-PAST-1", status: "draft",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
          artists: { name: "Past Artist" },
        }),
        order({
          id: "ho-future", order_no: "HO-FUTURE-1", status: "draft",
          show_dates: { date: "2030-01-01", venue: "New Hall" },
          artists: { name: "Future Artist" },
        }),
      ]);
      renderPage();
      await screen.findByText("HO-FUTURE-1");

      // No interaction needed: unlike the sibling booking surfaces, a hire order
      // stays actionable after its date passes, so it shows by default (grayed).
      const pastCell = await screen.findByText("HO-PAST-1");
      const row = pastCell.closest("tr")!;
      expect(row.className).toMatch(/opacity-60/);
      expect(row.className).not.toMatch(/pointer-events-none/);
      expect(screen.getByText("HO-FUTURE-1").closest("tr")!.className).not.toMatch(/opacity-60/);

      // The trigger itself reads "Any time", not "Upcoming".
      expect(screen.getByRole("button", { name: "Any time" })).toBeInTheDocument();
    });

    it("hides the past order once Upcoming is explicitly selected", async () => {
      seedFor([
        order({
          id: "ho-past", order_no: "HO-PAST-1", status: "draft",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
        }),
        order({
          id: "ho-future", order_no: "HO-FUTURE-1", status: "draft",
          show_dates: { date: "2030-01-01", venue: "New Hall" },
        }),
      ]);
      renderPage();
      await screen.findByText("HO-PAST-1");

      fireEvent.click(screen.getByRole("button", { name: "Any time" }));
      fireEvent.click(screen.getByRole("button", { name: /^Upcoming$/ }));

      await waitFor(() => expect(screen.queryByText("HO-PAST-1")).not.toBeInTheDocument());
      expect(screen.getByText("HO-FUTURE-1")).toBeInTheDocument();
    });

    it("also shows a past order under the Past preset specifically", async () => {
      seedFor([
        order({
          id: "ho-past", order_no: "HO-PAST-1", status: "draft",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
        }),
      ]);
      renderPage();
      await screen.findByText("Hire orders");

      fireEvent.click(screen.getByRole("button", { name: "Any time" }));
      fireEvent.click(screen.getByRole("button", { name: "Past" }));

      expect(await screen.findByText("HO-PAST-1")).toBeInTheDocument();
    });

    it("keeps a past order clickable under the default All-time filter (opens the slide-over)", async () => {
      seedFor([
        order({
          id: "ho-past", order_no: "HO-PAST-1", status: "draft",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
        }),
      ]);
      renderPage();

      const cell = await screen.findByText("HO-PAST-1");
      fireEvent.click(cell);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    // A manual order created with no linked show_date carries its own date in
    // `data.date` (a resolved snapshot field, source "manual") instead of
    // `show_dates.date` -- the timeframe predicate and the past tint both used
    // to key off `show_dates?.date` alone, so this class of order was always
    // treated as dateless (never hidden, never tinted) regardless of how old
    // it actually was.
    it("tints a past manual order with no linked show_date under the default All-time filter", async () => {
      seedFor([
        order({
          id: "ho-manual-past", order_no: "HO-MANUAL-PAST-1", status: "draft",
          show_dates: null,
          artists: null,
          data: {
            artist_name: { value: "Manual Artist", source: "manual" },
            date: { value: "2020-01-01", source: "manual" },
          },
        }),
      ]);
      renderPage();

      const pastCell = await screen.findByText("HO-MANUAL-PAST-1");
      const row = pastCell.closest("tr")!;
      expect(row.className).toMatch(/opacity-60/);
      expect(row.className).not.toMatch(/pointer-events-none/);
    });

    it("hides a past manual (no linked show_date) order once Upcoming is selected", async () => {
      seedFor([
        order({
          id: "ho-manual-past", order_no: "HO-MANUAL-PAST-1", status: "draft",
          show_dates: null,
          data: { date: { value: "2020-01-01", source: "manual" } },
        }),
      ]);
      renderPage();
      await screen.findByText("HO-MANUAL-PAST-1");

      fireEvent.click(screen.getByRole("button", { name: "Any time" }));
      fireEvent.click(screen.getByRole("button", { name: /^Upcoming$/ }));

      await waitFor(() => expect(screen.queryByText("HO-MANUAL-PAST-1")).not.toBeInTheDocument());
    });

    it("keeps a past manual (no linked show_date) order clickable under the default All-time filter", async () => {
      seedFor([
        order({
          id: "ho-manual-past", order_no: "HO-MANUAL-PAST-1", status: "draft",
          show_dates: null,
          data: { date: { value: "2020-01-01", source: "manual" } },
        }),
      ]);
      renderPage();

      const cell = await screen.findByText("HO-MANUAL-PAST-1");
      fireEvent.click(cell);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("Overdue indicator (Plan B fix wave)", () => {
    it("shows Overdue on a past-dated issued order in the table", async () => {
      seedFor([
        order({
          id: "ho-overdue", order_no: "HO-OVERDUE-1", status: "issued",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
        }),
      ]);
      renderPage();
      await screen.findByText("HO-OVERDUE-1");
      expect(screen.getByText("Overdue")).toBeInTheDocument();
    });

    it("does not show Overdue on a past-dated countersigned order", async () => {
      seedFor([
        order({
          id: "ho-done", order_no: "HO-DONE-1", status: "countersigned",
          show_dates: { date: "2020-01-01", venue: "Old Hall" },
          pdf_path: "orgs/org-1/ho-done.pdf", issued_at: "2020-01-02T10:00:00Z", countersigned_at: "2020-01-03T10:00:00Z",
        }),
      ]);
      renderPage();
      await screen.findByText("HO-DONE-1");
      expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
    });
  });
});
