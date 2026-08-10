import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [{ id: "c1", name: "Hamburg" }] }) }));

// The panel reads the org's flow for the SAME reason TimingStep does, and its test mocks
// the hook the same way: a real, fully normalized BookingFlow built from a shipped preset,
// held in a hoisted ref so each test can swap the org's flow without a provider dance.
const { flowRef, flowOrgSpy } = vi.hoisted(() => ({
  flowRef: { value: null as unknown },
  flowOrgSpy: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: (orgId?: string | null) => { flowOrgSpy(orgId); return { data: flowRef.value }; },
}));

import { LadderStep } from "./LadderStep";
import { ROUTES } from "@/config/app.config";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

beforeEach(() => {
  flowOrgSpy.mockClear();
  flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");
});

describe("LadderStep", () => {
  it("shows the ranked-count copy when the org list has a tier-1 cast", () => {
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/1 tier ranked/)).toBeInTheDocument();
  });

  it("does not claim 'no casts ranked' when only a show-scoped tier-1 row covers the city", () => {
    // The org-wide list is empty for this city, but a show-scoped row covers it at tier 1.
    // resolveCoverage/EligibilityStep treat this city as covered, so LadderStep must not
    // contradict that with "No casts ranked." or "nothing at tier 1."
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [{ showId: "s1", cityId: "c1", castId: "k9", priority: 1 }],
      cityPriorities: [],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/Ranked per show/)).toBeInTheDocument();
    expect(screen.queryByText(/No casts ranked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/nothing at tier 1/)).not.toBeInTheDocument();
  });

  it("flags that some shows use their own list when the city has show-scoped overrides", () => {
    // The org list covers the city at tier 1, but one show also has its own scoped rows.
    // The city-level summary can't see whether that per-show override opens to nobody at
    // tier 1, so it appends a caveat pointing at EligibilityStep ("Who is eligible")
    // rather than implying the city is fully covered.
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }, { showId: "s2", cityId: "c1" }],
      showPriorities: [{ showId: "s2", cityId: "c1", castId: "k2", priority: 2 }],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByText(/1 tier ranked/)).toBeInTheDocument();
    expect(screen.getByText(/Some shows here use their own cast list/)).toBeInTheDocument();
  });

  it("offers the concept explanation next to the edit link, deep-linked to Documentation", () => {
    // "Tier", "cast" and "ladder" are all house vocabulary. The panel names them, so it
    // also has to say where they are explained. The label names the destination because
    // the link lands on the whole guide, not on a section: promising a specific answer and
    // delivering a manual is the thing to avoid.
    const coverage: LadderCoverageInputs = { futurePairs: [], showPriorities: [], cityPriorities: [] };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /how casts and tiers work, in the app logic guide/i })).toHaveAttribute(
      "href",
      `${ROUTES.SETTINGS}?tab=docs`,
    );
  });

  it("shows no per-show caveat when the city has no show-scoped overrides", () => {
    const coverage: LadderCoverageInputs = {
      futurePairs: [{ showId: "s1", cityId: "c1" }],
      showPriorities: [],
      cityPriorities: [{ cityId: "c1", castId: "k1", priority: 1 }],
    };
    renderWithProviders(
      <MemoryRouter><LadderStep coverage={coverage} orgId="org-1" /></MemoryRouter>,
    );
    expect(screen.queryByText(/use their own cast list/)).not.toBeInTheDocument();
  });

  const empty: LadderCoverageInputs = { futurePairs: [], showPriorities: [], cityPriorities: [] };

  it("reads the flow for the org it was handed, not for whatever org the shell is on", () => {
    // Same rule as TimingStep: the rail passes this panel an orgId, so resolving the flow
    // from AuthContext instead would let one org's ranking be narrated with another org's
    // flow during a switch (the switcher lives in the shell and unmounts nothing).
    renderWithProviders(<MemoryRouter><LadderStep coverage={empty} orgId="org-9" /></MemoryRouter>);
    expect(flowOrgSpy).toHaveBeenCalledWith("org-9");
  });

  it("tells an offers org what the ranking decides", () => {
    renderWithProviders(<MemoryRouter><LadderStep coverage={empty} orgId="org-1" /></MemoryRouter>);
    expect(screen.getByText(/Tier 1 is asked first/)).toBeInTheDocument();
  });

  it("tells a direct-book org that nothing reads this ranking", () => {
    // The panel used to open with "The order offers go out in. Tier 1 is asked first..."
    // for every org. A direct-book org never opens a tier, and its picker
    // (deriveDirectBookList over useEligibleArtists) ignores priority entirely, so that
    // sentence sent it off to rank casts for an effect it will never see.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<MemoryRouter><LadderStep coverage={empty} orgId="org-1" /></MemoryRouter>);
    expect(screen.getByText(/nothing reads this ranking today/)).toBeInTheDocument();
    expect(screen.queryByText(/asked first/)).not.toBeInTheDocument();
  });

  it("narrates no pipeline at all while the flow is still being read", () => {
    flowRef.value = undefined;
    renderWithProviders(<MemoryRouter><LadderStep coverage={empty} orgId="org-1" /></MemoryRouter>);
    expect(screen.getByText("Your casts ranked per city, tier 1 first.")).toBeInTheDocument();
    expect(screen.queryByText(/asked first,/)).not.toBeInTheDocument();
  });

  it("narrates no pipeline without an org either, whatever the platform default resolves to", () => {
    // `useBookingFlow` has no `enabled` gate, so a null org still runs
    // fetchBookingFlow(client, null): resolveOrgSetting then reads only the PLATFORM DEFAULT
    // row and normalizeBookingFlow falls back to BOOKING_FLOW_DEFAULTS (artist_acceptance
    // true). The hook therefore hands this panel a truthy, offers-shaped flow that belongs
    // to no org, which would defeat the unknown-flow branch above by printing the offers
    // pipeline instead. The panel's own org is what decides, so it gates on that.
    flowRef.value = BOOKING_FLOW_DEFAULTS;
    renderWithProviders(<MemoryRouter><LadderStep coverage={empty} orgId={null} /></MemoryRouter>);
    expect(screen.getByText("Your casts ranked per city, tier 1 first.")).toBeInTheDocument();
    expect(screen.queryByText(/asked first,/)).not.toBeInTheDocument();
  });
});
