import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, artistRef, offersRef, orgRef, flowOrgSpy, timesOrgSpy } = vi.hoisted(() => ({
  flowRef: { value: { artist_acceptance: true, producer_confirmation: true, offer_delivery: "digest", confirmation_digest: true } as Record<string, unknown> },
  artistRef: { value: { id: "a1" } as { id: string } | null },
  offersRef: { value: 1 },
  orgRef: { value: { id: "org-1" } },
  flowOrgSpy: vi.fn(),
  timesOrgSpy: vi.fn(),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: (orgId?: string | null) => { flowOrgSpy(orgId); return { data: flowRef.value }; },
  useFlowTimes: (orgId: string | null) => {
    timesOrgSpy(orgId);
    return { data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } };
  },
}));
vi.mock("@/hooks/useMyArtist", () => ({ useMyArtist: () => ({ data: artistRef.value }) }));
vi.mock("@/data/bookings", () => ({ fetchMyOpenOffersCount: () => Promise.resolve(offersRef.value) }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ currentOrg: orgRef.value }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { FirstOfferCard } from "./FirstOfferCard";

beforeEach(() => {
  localStorage.clear();
  flowRef.value = { artist_acceptance: true, producer_confirmation: true, offer_delivery: "digest", confirmation_digest: true };
  artistRef.value = { id: "a1" };
  offersRef.value = 1;
  orgRef.value = { id: "org-1" };
  flowOrgSpy.mockClear();
  timesOrgSpy.mockClear();
});

describe("FirstOfferCard", () => {
  it("explains the classic flow while an offer is pending", async () => {
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/says yes, waiting on you/i)).toBeInTheDocument();
  });

  it("reads the flow and the hours from one org, not two", async () => {
    // The sentence is one flow narrated with one org's send hours. The hours already keyed
    // on the resolved org id; the flow was left on `useBookingFlow()`'s own AuthContext
    // lookup, so the two were free to drift apart the moment either source changed. Same
    // rule as TimingStep and RehearsalBlock: the org is resolved once and passed down.
    renderWithProviders(<FirstOfferCard />);
    await screen.findByText(/says yes, waiting on you/i);
    expect(flowOrgSpy).toHaveBeenCalledWith("org-1");
    expect(timesOrgSpy).toHaveBeenCalledWith("org-1");
  });

  it("never narrates a flow that belongs to no org", async () => {
    // `useBookingFlow` has no enabled gate, so with a null org fetchBookingFlow still runs
    // and resolves the PLATFORM DEFAULT settings row. Narrating that row would tell an
    // artist how bookings work somewhere other than their own org. With no org there is
    // nothing to narrate from, so the card falls back to the shipped defaults, the same
    // guard TimingStep, LadderStep, EligibilityStep, RehearsalBlock and FlowStep apply.
    orgRef.value = null as unknown as { id: string };
    // A platform row that reads differently from the shipped defaults, so the two branches
    // produce different sentences and the assertion can tell them apart.
    flowRef.value = { artist_acceptance: true, producer_confirmation: false, offer_delivery: "immediate", confirmation_digest: true };
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/says yes, waiting on you/i)).toBeInTheDocument();
    expect(screen.queryByText(/books it instantly/i)).not.toBeInTheDocument();
  });

  it("renders nothing when there is no pending offer", async () => {
    offersRef.value = 0;
    const { container } = renderWithProviders(<FirstOfferCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("changes the wording under fast-track", async () => {
    flowRef.value = { artist_acceptance: true, producer_confirmation: false, offer_delivery: "immediate", confirmation_digest: true };
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/books it instantly/i)).toBeInTheDocument();
  });
});
