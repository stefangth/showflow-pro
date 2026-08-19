import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

/**
 * Task 18, item 1: `?lens=` deep link sync for AvailabilityPage (artist), plus
 * the `?filter=unanswered` dashboard deep link (previously "working" only by
 * coincidence — the Offers lens happened to be the default — now handled
 * explicitly). Unlike AvailabilityPage.calendar.test.tsx (which stubs
 * `useSearchParams` to a fixed, inert pair), this file wraps the page in a
 * real MemoryRouter so `useSearchParams` round-trips for real.
 */

const ELIGIBLE = [
  {
    id: "sd-1",
    date: "2099-08-10",
    session_1: "19:00",
    session_2: null,
    session_3: null,
    status: "open",
    city_id: "c1",
    show_id: "s1",
    venue: "Main Stage",
    custom: null,
    show: { id: "s1", program: "Show A", sub_program: null, status: "active" },
  },
];

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    bookings: { data: [], error: null },
    blocked_dates: { data: [], error: null },
  }),
);

vi.mock("@/components/minis/PageMini", () => ({ PageMini: () => null }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ currentOrg: { id: "org-1" } }),
}));
vi.mock("@/hooks/useMyArtist", () => ({
  useMyArtist: () => ({ data: { id: "artist-1" } }),
}));
vi.mock("@/hooks/useArtistEligibleDates", () => ({
  useArtistEligibleDates: () => ({ data: ELIGIBLE, isLoading: false }),
}));
vi.mock("@/hooks/useHireOrders", () => ({
  useMyHireOrders: () => ({ data: [] }),
}));
vi.mock("@/hooks/useEntitlements", () => ({
  useFeature: (feature: string) => feature === "booking_flow",
}));

import AvailabilityPage from "./AvailabilityPage";

/** Exposes the live URL search string so a test can assert what the page wrote to it. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderAt(path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <AvailabilityPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("AvailabilityPage — ?lens= deep link (Task 18)", () => {
  it("?lens=all-dates selects the All dates lens on load", async () => {
    renderAt("/availability?lens=all-dates");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All dates" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Asks" })).toHaveAttribute("aria-selected", "false");
  });

  it("an unrecognised ?lens= value is ignored, keeping the Offers default", async () => {
    renderAt("/availability?lens=bogus");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Asks" })).toHaveAttribute("aria-selected", "true");
  });

  it("?filter=unanswered (the dashboard deep link) lands on the Offers lens", async () => {
    renderAt("/availability?filter=unanswered");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Asks" })).toHaveAttribute("aria-selected", "true");
  });

  it("an explicit ?lens= wins over ?filter=unanswered when both are present", async () => {
    renderAt("/availability?filter=unanswered&lens=month");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Month" })).toHaveAttribute("aria-selected", "true");
  });

  it("changing the lens writes ?lens= to the URL", async () => {
    renderAt("/availability");
    expect(await screen.findByTestId("calendar-surface")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Month" }));

    await waitFor(() => {
      const search = new URLSearchParams(screen.getByTestId("location-search").textContent ?? "");
      expect(search.get("lens")).toBe("month");
    });
  });
});
