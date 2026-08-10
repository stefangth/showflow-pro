import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "@/test/renderWithProviders";

const { flowRef, canRef, nextRef, dryRun } = vi.hoisted(() => ({
  flowRef: { value: { artist_acceptance: true, offer_delivery: "digest" } as Record<string, unknown> },
  canRef: { value: true },
  nextRef: { value: { id: "d1", date: "2026-09-18" } as { id: string; date: string } | null },
  dryRun: vi.fn(() => Promise.resolve({ candidates: [{ id: "a1", name: "Anna Kessler" }], excluded: {}, message: undefined })),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  useBookingFlow: () => ({ data: flowRef.value }),
  useFlowTimes: () => ({ data: { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 } }),
}));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));
vi.mock("@/data/bookings", () => ({ dryRunOfferTier: dryRun }));
vi.mock("@/data/showDates", () => ({ fetchNextRehearsalDate: () => Promise.resolve(nextRef.value) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { RehearsalBlock } from "./RehearsalBlock";

beforeEach(() => {
  flowRef.value = { artist_acceptance: true, offer_delivery: "digest" };
  canRef.value = true;
  nextRef.value = { id: "d1", date: "2026-09-18" };
  dryRun.mockClear();
});

describe("RehearsalBlock", () => {
  it("runs the dry run and lists candidates", async () => {
    renderWithProviders(<RehearsalBlock orgId="org-1" />);
    fireEvent.click(await screen.findByRole("button", { name: /run the rehearsal/i }));
    expect(await screen.findByText("Anna Kessler")).toBeInTheDocument();
    expect(dryRun).toHaveBeenCalledWith(expect.anything(), { showDateId: "d1", tier: 1 });
  });

  it("renders nothing under direct book", async () => {
    flowRef.value = { artist_acceptance: false, offer_delivery: "digest" };
    const { container } = renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders nothing until the flow is known", async () => {
    // Same rule as TimingStep's narrative: the flow query resolves after first paint, and
    // defaulting it to acceptance-on would flash a whole offer rehearsal at a direct-book
    // org. Staged through a shared, caching QueryClient so the date read is already
    // resolved on the second mount: that is the exact race (warm date, cold flow), and it
    // makes the assertion synchronous instead of a poll that passes before anything loads.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    renderWithProviders(<RehearsalBlock orgId="org-1" />, { queryClient: qc });
    expect(await screen.findByText("See it run before it runs")).toBeInTheDocument();

    cleanup();
    flowRef.value = undefined as unknown as Record<string, unknown>;
    const { container } = renderWithProviders(<RehearsalBlock orgId="org-1" />, { queryClient: qc });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when no future date has a city", async () => {
    nextRef.value = null;
    const { container } = renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("hides the run button without the offer-engine capability", async () => {
    canRef.value = false;
    renderWithProviders(<RehearsalBlock orgId="org-1" />);
    await waitFor(() => expect(screen.queryByRole("button", { name: /run the rehearsal/i })).not.toBeInTheDocument());
  });
});
