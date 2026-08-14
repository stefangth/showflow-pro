import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { StageChainResult, QueueRow, Stage } from "@/lib/dashboard/stageChain.types";
import { ROUTES } from "@/config/app.config";

// Reuses the auth/data harness from DashboardPage.test.tsx so the ProducerDashboard
// data reads resolve, then adds the first-run-hook mock and asserts the new
// DashboardFirstRun surface (chain present / floor state) and the KPI-visibility switch.
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
// to prove a stage's openSetup action opens it in place with the right module + step.
// Always rendered (mirrors the real component staying mounted through its close animation)
// and exposes a close button, so a test can assert what content shows WHILE it closes.
vi.mock("@/components/setup/SetupChecklistSheet", () => ({
  SetupChecklistSheet: ({ open, feature, initialStep, onOpenChange }: { open: boolean; feature: string; initialStep?: string; onOpenChange: (o: boolean) => void }) => (
    <div data-testid="setup-sheet" data-open={String(open)} data-feature={feature} data-step={initialStep ?? ""}>
      <button data-testid="setup-sheet-close" onClick={() => onOpenChange(false)}>close</button>
    </div>
  ),
}));
// A stable navigate spy so both DashboardPage's own handleGhost and DashboardFirstRun's
// internal route-action navigate() are observable from one place. `Link` is mocked too
// (the KPI cards render one) as a plain anchor so no Router context is needed.
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, className, children }: { to: string; className?: string; children?: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    key: "dates",
    n: "01",
    variant: "hot",
    name: "Dates",
    tag: "Shows and bookings",
    line: "Nothing downstream can mean anything until shows exist.",
    running: false,
    badge: "",
    needs: "",
    metric: "0",
    metricLabel: "dates in",
    steps: [],
    ctaLabel: "Set slots",
    ctaIsPrimary: true,
    action: { kind: "openSetup", feature: "booking_flow", step: "slots" },
    ...overrides,
  };
}

function makeResult(overrides: Partial<StageChainResult> = {}): StageChainResult {
  return {
    eyebrow: "Halle Kollektiv · first run",
    headline: "34 dates landed. Four of them can be offered tonight.",
    body: "Stage 01 is running.",
    ghost: "Change the flow in Settings",
    hint: "Tier 1 goes out at 09:00h (Berlin, Germany)",
    progressLabel: "Set up · 2 of 7",
    progressHint: "The steps left sit in the stage they hold up.",
    hasSteps: true,
    ticks: [true, true, false, false, false, false, false],
    modules: [{ label: "Booking engine", on: true }],
    offFooters: [],
    hasChain: true,
    chainTitle: "How a date will move",
    rulesBy: "Rules set by you · Settings · Booking engine",
    stages: [makeStage()],
    sideTitle: "Nothing here blocks the rest of the app",
    sideBody: "Some steps above block the first booking. The app itself is open.",
    side: [],
    queueTitle: "What this page becomes",
    queueHint: "Sample rows, shown once a module is on.",
    sample: true,
    queueOpacity: 0.55,
    nothingOn: false,
    ...overrides,
  };
}

function makeQueueRows(): QueueRow[] {
  return [{ dot: "accent", title: "6 artists accepted", hint: "hint", when: "now", cta: "Confirm" }];
}

// Settable first-run state so the surface/KPI-visibility switch can be exercised.
function frState(overrides: Record<string, unknown> = {}) {
  return {
    show: true,
    result: makeResult(),
    queueRows: makeQueueRows(),
    dismissed: false,
    dismiss: vi.fn(),
    undismiss: vi.fn(),
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
  it("renders the first-run surface above the producer dashboard", async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/34 dates landed/)).toBeInTheDocument();
  });

  it("shows ONLY the first-run surface (no KPI body) when it is showing and the org has no real dates", async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText(/34 dates landed/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("shows the KPI body alongside the surface once the org has real dates", async () => {
    seedClient({
      show_dates: { data: [{ id: "d1", date: "2099-12-31", show_id: "s1", status: "confirmed", show: { program: "Show", sub_program: null, main_cast_slots: 1, understudy_slots: 0 } }], error: null },
      bookings: [
        { when: { status: "confirmed" }, data: [], error: null },
        { when: { status: "soft_booked" }, data: [], error: null },
      ],
    });
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    // The surface still renders above the now-visible KPI body.
    expect(screen.getByText(/34 dates landed/)).toBeInTheDocument();
  });

  it("shows the KPI body when the surface is dismissed, even with no real dates", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ dismissed: true }) as never);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    // fr.show is still true, so the collapsed chip (not the full surface) renders too.
    expect(screen.getByText("Set up · 2 of 7")).toBeInTheDocument();
    expect(screen.queryByText(/34 dates landed/)).not.toBeInTheDocument();
  });

  it("opens the module setup Sheet in place when a stage's openSetup action fires (no navigation)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({
        stages: [makeStage({ ctaLabel: "Choose flow", action: { kind: "openSetup", feature: "booking_flow", step: "flow" } })],
      }),
    }) as never);
    renderWithProviders(<DashboardPage />);
    expect(screen.getByTestId("setup-sheet").getAttribute("data-open")).toBe("false");
    fireEvent.click(await screen.findByRole("button", { name: "Choose flow" }));
    const sheet = screen.getByTestId("setup-sheet");
    expect(sheet.getAttribute("data-open")).toBe("true");
    expect(sheet.getAttribute("data-feature")).toBe("booking_flow");
    expect(sheet.getAttribute("data-step")).toBe("flow");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps the opened module's content while the Sheet closes (no wrong-module flash)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({
        stages: [makeStage({ ctaLabel: "Set letterhead", action: { kind: "openSetup", feature: "hire_orders", step: "letterhead" } })],
      }),
    }) as never);
    renderWithProviders(<DashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Set letterhead" }));
    expect(screen.getByTestId("setup-sheet").getAttribute("data-feature")).toBe("hire_orders");
    // Closing must keep feature = hire_orders through the exit animation, not flip to the
    // fallback booking_flow (the Sheet stays mounted while it slides out).
    fireEvent.click(screen.getByTestId("setup-sheet-close"));
    const sheet = screen.getByTestId("setup-sheet");
    expect(sheet.getAttribute("data-open")).toBe("false");
    expect(sheet.getAttribute("data-feature")).toBe("hire_orders");
  });

  it("routes a stage's route action via navigate, not the setup Sheet", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({
        stages: [makeStage({ ctaLabel: "Send tier 1", action: { kind: "route", to: "/bookings" } })],
      }),
    }) as never);
    renderWithProviders(<DashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Send tier 1" }));
    expect(navigate).toHaveBeenCalledWith("/bookings");
    expect(screen.getByTestId("setup-sheet").getAttribute("data-open")).toBe("false");
  });

  it("fires the ghost CTA to the Help center", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({ ghost: "How this org will work" }),
    }) as never);
    renderWithProviders(<DashboardPage />);
    fireEvent.click(await screen.findByRole("button", { name: "How this org will work" }));
    expect(navigate).toHaveBeenCalledWith(ROUTES.HELP);
  });

  it("renders the no-modules floor state instead of vanishing", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({ nothingOn: true, hasChain: false, stages: [], headline: "No modules are switched on for Halle Kollektiv" }),
    }) as never);
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("No modules are switched on for Halle Kollektiv")).toBeInTheDocument();
  });
});
