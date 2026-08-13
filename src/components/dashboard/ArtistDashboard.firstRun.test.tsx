import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
import type { StageChainResult, QueueRow, Stage } from "@/lib/dashboard/stageChain.types";
import { ROUTES } from "@/config/app.config";

/**
 * Task C3: ArtistDashboard is wrapped in the new stage-chain first-run surface
 * (role "artist"). The surface greets the artist above the body; the body itself
 * (offer meter + hire orders + My Casts) renders once the artist has real content
 * of their own (eligible dates / offers) -- unlike an admin configuring an empty
 * org, an artist has real per-user content immediately, so hiding it behind the
 * surface would hide genuinely actionable content. This file mocks
 * useDashboardFirstRun and the artist's own data hooks so the body's queries
 * resolve and the `if (!artist)` early guard passes (harness copied from
 * ArtistDashboard.hireOrders.test.tsx).
 */

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, unknown>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed as never));
}

const navigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  Link: ({ to, className, children }: { to: string; className?: string; children?: ReactNode }) => (
    <a href={to} className={className}>{children}</a>
  ),
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1", name: "Halle Kollektiv" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  // Must return an artist so the `if (!artist)` early guard does not
  // short-circuit before the first-run layer.
  useMyArtist: () => ({ data: { id: "artist-1", name: "Nora" } }),
}));
const eligibleDatesHolder = { data: [] as unknown[] };
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: eligibleDatesHolder.data, isLoading: false }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: undefined }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = () => true;
  return { useFeature, useModuleGate: () => ({ allow: true, pending: false }) };
});

vi.mock("@/components/dashboard/firstRun/useDashboardFirstRun", () => ({
  useDashboardFirstRun: vi.fn(),
}));

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    key: "availability",
    n: "01",
    variant: "hot",
    name: "Availability",
    tag: "Your dates",
    line: "Block the dates you cannot make.",
    running: false,
    badge: "",
    needs: "",
    metric: null,
    metricLabel: "",
    steps: [],
    ctaLabel: "Open availability",
    ctaIsPrimary: true,
    action: { kind: "route", to: ROUTES.AVAILABILITY },
    ...overrides,
  };
}

function makeResult(overrides: Partial<StageChainResult> = {}): StageChainResult {
  return {
    eyebrow: "Halle Kollektiv · first run",
    headline: "Halle Kollektiv added you to the roster",
    body: "One step is yours, and it is two minutes.",
    ghost: "How booking works here",
    hint: "About 2 minutes",
    progressLabel: "Set up · 0 of 1",
    progressHint: "None of this blocks anything.",
    hasSteps: true,
    ticks: [false],
    modules: [{ label: "Booking engine", on: true }],
    offFooters: [],
    hasChain: true,
    chainTitle: "How a date will move",
    rulesBy: "Rules set in Settings · Booking engine",
    stages: [makeStage()],
    sideTitle: "Blocking is how you say no",
    sideBody: "Availability",
    side: [],
    queueTitle: "Your dates",
    queueHint: "Live. This is your real content, not a preview.",
    sample: false,
    queueOpacity: 1,
    nothingOn: false,
    ...overrides,
  };
}

function makeQueueRows(): QueueRow[] {
  return [{ dot: "faint", title: "Nothing yet", hint: "hint", when: "", cta: "" }];
}

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

import { useDashboardFirstRun } from "@/components/dashboard/firstRun/useDashboardFirstRun";
import { ArtistDashboard } from "./ArtistDashboard";

beforeEach(() => {
  vi.clearAllMocks();
  eligibleDatesHolder.data = [];
  vi.mocked(useDashboardFirstRun).mockReturnValue(frState() as never);
  seedClient({
    bookings: [{ when: { artist_id: "artist-1" }, data: [], error: null }],
    "my-cast-memberships": { data: [], error: null },
    cast_members: { data: [], error: null },
    hire_orders: { data: [], error: null },
  });
});

describe("ArtistDashboard first-run (Task C3)", () => {
  it("renders the artist first-run surface", async () => {
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText(/added you to the roster/)).toBeInTheDocument();
  });

  it("shows ONLY the surface (no body) while showing and the artist has no eligible dates yet", async () => {
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText(/added you to the roster/)).toBeInTheDocument();
    expect(screen.queryByText("My Casts")).not.toBeInTheDocument();
  });

  it("renders the real body live, alongside the surface, once the artist has eligible dates", async () => {
    eligibleDatesHolder.data = [{ id: "d1", date: "2099-01-01", show: null, custom: null }];
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText("My Casts")).toBeInTheDocument();
    expect(screen.getByText(/added you to the roster/)).toBeInTheDocument();
  });

  it("renders the body when the surface is dismissed, even with no eligible dates", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({ dismissed: true }) as never);
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText("My Casts")).toBeInTheDocument();
    // fr.show is still true, so the collapsed chip (not the full surface) renders too.
    expect(screen.getByText("Set up · 0 of 1")).toBeInTheDocument();
    expect(screen.queryByText(/added you to the roster/)).not.toBeInTheDocument();
  });

  it("resolves a stage's route action via navigate (DashboardFirstRun's own routing)", async () => {
    renderWithProviders(<ArtistDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Open availability" }));
    expect(navigate).toHaveBeenCalledWith(ROUTES.AVAILABILITY);
  });

  it("falls back an openSetup stage action to Availability (no setup Sheet on this page)", async () => {
    vi.mocked(useDashboardFirstRun).mockReturnValue(frState({
      result: makeResult({
        stages: [makeStage({ ctaLabel: "Do the thing", action: { kind: "openSetup", feature: "booking_flow", step: "x" } })],
      }),
    }) as never);
    renderWithProviders(<ArtistDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: "Do the thing" }));
    expect(navigate).toHaveBeenCalledWith(ROUTES.AVAILABILITY);
  });

  it("hides the ghost CTA entirely (Settings is not artist-reachable, so there is no handler to wire)", async () => {
    renderWithProviders(<ArtistDashboard />);
    expect(await screen.findByText(/added you to the roster/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "How booking works here" })).not.toBeInTheDocument();
  });
});
