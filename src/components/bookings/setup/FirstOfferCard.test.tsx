import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, artistRef, offersRef, orgRef } = vi.hoisted(() => ({
  flowRef: { value: { artist_acceptance: true, producer_confirmation: true, offer_delivery: "digest", confirmation_digest: true } as Record<string, unknown> },
  artistRef: { value: { id: "a1" } as { id: string } | null },
  offersRef: { value: 1 },
  orgRef: { value: { id: "org-1" } },
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
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
});

describe("FirstOfferCard", () => {
  it("explains the classic flow while an offer is pending", async () => {
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/soft-books the date/i)).toBeInTheDocument();
  });

  it("renders nothing when there is no pending offer", async () => {
    offersRef.value = 0;
    const { container } = renderWithProviders(<FirstOfferCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("changes the wording under fast-track", async () => {
    flowRef.value = { artist_acceptance: true, producer_confirmation: false, offer_delivery: "immediate", confirmation_digest: true };
    renderWithProviders(<FirstOfferCard />);
    expect(await screen.findByText(/confirms the booking instantly/i)).toBeInTheDocument();
  });
});
