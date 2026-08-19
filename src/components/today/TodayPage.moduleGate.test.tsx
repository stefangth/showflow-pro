import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import type { TodayModel } from "@/lib/autopilot/today";
import type { UseAutopilotTodayResult } from "@/hooks/useAutopilotToday";

// The Autopilot Today board (`TodayContainer`, mounted by DashboardPage for any
// non-artist-only viewer) is entirely booking-engine content: at-risk dates, asks
// that didn't arrive, the "done for you" feed. This regression-guards the
// `ModuleGate feature="booking_flow"` wrapping it — the gate the deleted
// `ProducerBookingSection` used to provide on the old dashboard this board
// replaced. Mock scaffold mirrors ShowDateDetailSheet.moduleGate.test.tsx.
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/hooks/useEntitlements", async (orig) => {
  const useFeature = vi.fn();
  return {
    ...(await orig<typeof import("@/hooks/useEntitlements")>()),
    useFeature,
    useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }),
  };
});
vi.mock("@/hooks/useAutopilotToday", () => ({ useAutopilotToday: vi.fn() }));

import { useFeature } from "@/hooks/useEntitlements";
import { useAutopilotToday } from "@/hooks/useAutopilotToday";
import TodayContainer from "./TodayPage";

function aModel(overrides: Partial<TodayModel> = {}): TodayModel {
  return {
    items: [],
    bounced: [],
    feed: [],
    openCount: 0,
    fillingOnTheirOwn: 0,
    bookedOvernight: 0,
    ...overrides,
  };
}

function aResult(overrides: Partial<UseAutopilotTodayResult> = {}): UseAutopilotTodayResult {
  return {
    model: aModel(),
    isLoading: false,
    isError: false,
    error: null,
    askTimeLabel: "19:00",
    feedSinceLabel: "Friday",
    refetch: vi.fn(),
    ...overrides,
  };
}

describe("TodayContainer booking_flow gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("booking_flow on: renders the board, not the module notice", () => {
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
    vi.mocked(useAutopilotToday).mockReturnValue(aResult());

    renderWithProviders(<TodayContainer />);

    expect(screen.getByRole("heading", { name: "Nothing needs you" })).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("booking_flow off: replaces the board with the module notice and skips the fetch", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    vi.mocked(useAutopilotToday).mockReturnValue(aResult({ model: undefined }));

    renderWithProviders(<TodayContainer />);

    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nothing needs you" })).not.toBeInTheDocument();
    // The gate must also stop the underlying reads from firing, not just hide
    // their output — useAutopilotToday gets told not to run.
    expect(useAutopilotToday).toHaveBeenCalledWith({ enabled: false });
  });

  // Bug 2 regression guard: a failed load must say something, not render a
  // textless destructive alert (the container's error branch had no backing
  // copy key until this was added to the "today" i18n namespace).
  it("load error: renders a non-empty error message, not an empty alert", () => {
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
    vi.mocked(useAutopilotToday).mockReturnValue(
      aResult({ isError: true, model: undefined, error: new Error("boom") }),
    );

    renderWithProviders(<TodayContainer />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent?.trim()).not.toBe("");
    expect(alert).toHaveTextContent("Could not load today's board. Try refreshing the page.");
  });
});
