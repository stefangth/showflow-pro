import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Reuses the auth/data harness from DashboardPage.test.tsx so the ProducerDashboard
// data reads resolve, then adds the first-run-hook mock and asserts the welcome text.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: () => true,
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }), // falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance: true)
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/components/dashboard/TierAttentionCard", () => ({ TierAttentionCard: () => null }));
vi.mock("@/components/dashboard/DirectBookingCard", () => ({ DirectBookingCard: () => null }));
vi.mock("@/data/bookings", async (orig) => ({
  ...(await orig<typeof import("@/data/bookings")>()),
  fetchTierAttention: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: vi.fn(),
}));
// The Sheet host is exercised on its own (SetupChecklistSheet.test.tsx); here we only need
// to prove a rail step opens it in place with the right module + step. Always rendered
// (mirrors the real component staying mounted through its close animation) and exposes a
// close button, so a test can assert what content shows WHILE it closes.
vi.mock("@/components/setup/SetupChecklistSheet", () => ({
  SetupChecklistSheet: ({ open, feature, initialStep, onOpenChange }: { open: boolean; feature: string; initialStep?: string; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="setup-sheet" data-open={String(open)} data-feature={feature} data-step={initialStep ?? ""}>
      <button data-testid="setup-sheet-close" onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));

// Settable first-run state so the sample-vs-live body switch can be exercised.
function frState(overrides: Record<string, unknown> = {}) {
  return {
    show: true, complete: false, dismissed: false,
    steps: [], rules: [], offFooters: [],
    sample: { stats: [{ title: "Live dates", value: "34", label: "upcoming" }], queue: [], week: [] },
    welcome: { eyebrow: "Welcome", headline: "Finish setting up Halle Kollektiv", body: "b", primaryLabel: "Start setup", secondaryLabel: "Later", progressLabel: "Set up · 0 of 4", progressFilled: 0, progressTotal: 4, progressHint: "About 15 minutes" },
    sectionTitle: "What this page becomes", sectionHint: "Sample rows.",
    railEyebrow: "Set up", railTitle: "Get running", railBody: "b",
    collapsedLabel: "Set up in progress", collapsedHint: "4 steps left", collapsedCta: "Resume",
    railOpen: false, openRail: vi.fn(), closeRail: vi.fn(), dismiss: vi.fn(),
    ...overrides,
  };
}

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useDashboardFirstRun } from "@/components/dashboard/firstRun/useDashboardFirstRun";
import DashboardPage from "./DashboardPage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useDashboardFirstRun).mockReturnValue(frState() as never);
  vi.mocked(useAuth).mockReturnValue({
    hasRole: (r: string) => r === "admin",
    currentOrg: { id: "o1", name: "Halle Kollektiv" },
  } as never);
  seedClient({
    show_dates: { data: [], error: null },
    bookings: [
      { when: { status: "confirmed" }, data: [], error: null },
      { when: { status: "soft_booked" }, data: [], error: null },
    ],
  });
});

describe("DashboardPage first-run layer", () => {
  it("renders the welcome panel above the producer dashboard", async () => {
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByText(/Finish setting up Halle Kollektiv/)).toBeInTheDocument();
  });

  it("shows the greyed Sample (not the live body) when setup is incomplete and the org has no dates", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: false }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    // Sample fixture stat is visible; the real body heading is not rendered.
    expect(await screen.findByText("Live dates")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("renders the live body (not the Sample) when setup is complete", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: true }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Live dates")).not.toBeInTheDocument();
  });

  it("opens the module setup Sheet in place when a rail step is clicked (no navigation)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      railOpen: true,
      steps: [
        { key: "flow", moduleKey: "booking_flow", title: "Booking flow", todoHint: "t", doneHint: "d", ctaLabel: "Choose flow", ctaRoute: "/settings", ctaCapability: "edit_booking_settings", done: false, block: null },
      ],
    }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(screen.getByTestId("setup-sheet").getAttribute("data-open")).toBe("false");
    fireEvent.click(await screen.findByRole("button", { name: "Choose flow" }));
    const sheet = screen.getByTestId("setup-sheet");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(sheet.getAttribute("data-feature")).toBe("booking_flow");
    expect(sheet.getAttribute("data-step")).toBe("flow");
  });

  it("keeps the opened module's content while the Sheet closes (no wrong-module flash)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      railOpen: true,
      steps: [
        { key: "letterhead", moduleKey: "hire_orders", title: "Letterhead", todoHint: "t", doneHint: "d", ctaLabel: "Set letterhead", ctaRoute: "/settings", ctaCapability: "edit_hire_order_settings", done: false, block: "issuing" },
      ],
    }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Set letterhead" }));
    expect(screen.getByTestId("setup-sheet").getAttribute("data-feature")).toBe("hire_orders");
    // Closing must keep feature = hire_orders through the exit animation, not flip to the
    // fallback booking_flow (the Sheet stays mounted while it slides out).
    fireEvent.click(screen.getByTestId("setup-sheet-close"));
    const sheet = screen.getByTestId("setup-sheet");
    expect(sheet.getAttribute("data-open")).toBe("false");
    expect(sheet.getAttribute("data-feature")).toBe("hire_orders");
  });

  it("routes a hire-order rail step to the hire-orders Sheet (by moduleKey)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      railOpen: true,
      steps: [
        { key: "letterhead", moduleKey: "hire_orders", title: "Letterhead", todoHint: "t", doneHint: "d", ctaLabel: "Set letterhead", ctaRoute: "/settings", ctaCapability: "edit_hire_order_settings", done: false, block: "issuing" },
      ],
    }) as never);
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Set letterhead" }));
    const sheet = screen.getByTestId("setup-sheet");
    expect(sheet.getAttribute("data-feature")).toBe("hire_orders");
    expect(sheet.getAttribute("data-step")).toBe("letterhead");
  });

  it("renders the live body when the org already has dates, even while setup is incomplete", async () => {
    // The data-presence override: complete is false, but a real upcoming date exists,
    // so the body must go live (not the greyed Sample).
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ complete: false }) as never);
    seedClient({
      show_dates: { data: [{ id: "d1", date: "2099-12-31", show_id: "s1", status: "confirmed", show: { program: "Show", sub_program: null, main_cast_slots: 1, understudy_slots: 0 } }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [], error: null },
      ],
    });
    renderWithProviders(<MemoryRouter><DashboardPage /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Live dates")).not.toBeInTheDocument();
  });
});
