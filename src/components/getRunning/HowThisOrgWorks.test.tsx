import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { FeatureKey } from "@/lib/entitlements";
import type { BookingFlow } from "@/lib/bookingFlow";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

const CLASSIC_FLOW: BookingFlow = {
  auto_open_tier1: true,
  auto_escalate: false,
  at_risk_alerts: true,
  offer_delivery: "digest",
  expiry_reminder: false,
  artist_acceptance: true,
  producer_confirmation: true,
  confirmation_digest: true,
  understudy_promotion: true,
  active: true,
  reference_field: { source: "show" },
};

// Hoisted, overridable mock fns for every slice this read-only reference reads.
// Mirrors the pattern useDashboardFirstRun.test.tsx already established for this
// codebase: whole-module mocks (never the supabase client itself) with hoisted
// vi.fn()s reset to a "normal admin org" default after every test.
const h = vi.hoisted(() => ({
  hasRole: vi.fn((r: string) => r === "admin"),
  features: vi.fn((): Set<FeatureKey> => new Set(["booking_flow", "hire_orders"] as FeatureKey[])),
  flow: vi.fn(() => ({ data: CLASSIC_FLOW, isLoading: false })),
  provenance: vi.fn(() => ({ byYou: true, actorName: "Nadia Okonkwo", changedAt: "2026-07-20T09:00:00Z" })),
  flowTimes: vi.fn(() => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 }, isLoading: false })),
  audit: vi.fn((_keys: string[]): { data: unknown[]; isLoading: boolean } => ({ data: [], isLoading: false })),
  bookingStatus: vi.fn((): { coverage: LadderCoverageInputs | undefined; isLoading: boolean } => ({
    coverage: { futurePairs: [], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [] },
    isLoading: false,
  })),
  hireStatus: vi.fn((): { status: HireOrderSetupStatus; isLoading: boolean } => ({
    status: {
      steps: [
        { key: "letterhead", done: true, blocksIssue: true },
        { key: "terms", done: false, blocksIssue: true },
        { key: "countersign", done: true, blocksIssue: false },
      ],
      doneCount: 2,
      totalCount: 3,
      canIssue: false,
      complete: false,
    },
    isLoading: false,
  })),
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ hasRole: h.hasRole }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (key: FeatureKey) => h.features().has(key),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => h.flow(),
  useFlowTimes: () => h.flowTimes(),
}));
vi.mock("@/hooks/useBookingFlowProvenance", () => ({
  useBookingFlowProvenance: () => h.provenance(),
}));
vi.mock("@/hooks/useSettingsAudit", () => ({
  useSettingsAudit: (keys: string[]) => h.audit(keys),
}));
vi.mock("@/hooks/useBookingSetup", () => ({
  useBookingSetupStatus: () => h.bookingStatus(),
}));
vi.mock("@/hooks/useHireOrderSetup", () => ({
  useHireOrderSetupStatus: () => h.hireStatus(),
}));

import { HowThisOrgWorks } from "./HowThisOrgWorks";

afterEach(() => {
  h.hasRole.mockImplementation((r: string) => r === "admin");
  h.features.mockReturnValue(new Set(["booking_flow", "hire_orders"] as FeatureKey[]));
  h.flow.mockReturnValue({ data: CLASSIC_FLOW, isLoading: false });
  h.provenance.mockReturnValue({ byYou: true, actorName: "Nadia Okonkwo", changedAt: "2026-07-20T09:00:00Z" });
  h.flowTimes.mockReturnValue({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 }, isLoading: false });
  h.audit.mockReturnValue({ data: [], isLoading: false });
  h.bookingStatus.mockReturnValue({
    coverage: { futurePairs: [], showPriorities: [], cityPriorities: [], nonEmptyCastIds: [] },
    isLoading: false,
  });
  h.hireStatus.mockReturnValue({
    status: {
      steps: [
        { key: "letterhead", done: true, blocksIssue: true },
        { key: "terms", done: false, blocksIssue: true },
        { key: "countersign", done: true, blocksIssue: false },
      ],
      doneCount: 2,
      totalCount: 3,
      canIssue: false,
      complete: false,
    },
    isLoading: false,
  });
});

describe("HowThisOrgWorks", () => {
  it("shows the booking flow's value and a set-by provenance line", () => {
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Set by Nadia Okonkwo, 20/07/2026")).toBeInTheDocument();
  });

  it("never renders a mutating control: no button that saves, no writable input", () => {
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    // Only read-only content: no buttons and no form inputs anywhere on the card.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows offer timing values", () => {
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText("19:00h (Berlin, Germany) daily send, 48h to answer")).toBeInTheDocument();
  });

  it("shows all covered when there are no uncovered future (show, city) pairs", () => {
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText("All covered")).toBeInTheDocument();
  });

  it("shows a partial coverage count when some cities lack a tier-1 cast", () => {
    h.bookingStatus.mockReturnValue({
      coverage: {
        futurePairs: [
          { showId: "s1", cityId: "c1" },
          { showId: "s1", cityId: "c2" },
        ],
        showPriorities: [],
        cityPriorities: [{ cityId: "c1", castId: "cast-1", priority: 1 }],
        nonEmptyCastIds: ["cast-1"],
      },
      isLoading: false,
    });
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText("1 of 2 cities covered")).toBeInTheDocument();
  });

  it("shows Set / Not set for the three hire-order paperwork rows", () => {
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getAllByText("Set")).toHaveLength(2); // letterhead, countersign
    expect(screen.getByText("Not set")).toBeInTheDocument(); // terms
  });

  it("omits the attribution line entirely when nothing has ever been audited (never fabricates one)", () => {
    h.provenance.mockReturnValue({ byYou: true, actorName: null, changedAt: null });
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.queryByText(/Set by/)).not.toBeInTheDocument();
  });

  it("shows a name-only provenance line when the audit table is unreadable but an admin name is known (producer view)", () => {
    h.hasRole.mockImplementation((r: string) => r === "producer");
    h.provenance.mockReturnValue({ byYou: false, actorName: "Tom Reeve", changedAt: null });
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText("Set by Tom Reeve")).toBeInTheDocument();
  });

  it("hides the booking rows when booking_flow is not entitled", () => {
    h.features.mockReturnValue(new Set(["hire_orders"] as FeatureKey[]));
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.queryByText("Booking flow")).not.toBeInTheDocument();
    expect(screen.getByText("Letterhead")).toBeInTheDocument();
  });

  it("hides the paperwork rows when hire_orders is not entitled", () => {
    h.features.mockReturnValue(new Set(["booking_flow"] as FeatureKey[]));
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.queryByText("Letterhead")).not.toBeInTheDocument();
    expect(screen.getByText("Booking flow")).toBeInTheDocument();
  });

  it("shows the empty-modules message when neither module is entitled", () => {
    h.features.mockReturnValue(new Set());
    renderWithProviders(<HowThisOrgWorks orgId="org-1" />);
    expect(screen.getByText(/Neither the booking engine nor contracts/)).toBeInTheDocument();
  });
});
