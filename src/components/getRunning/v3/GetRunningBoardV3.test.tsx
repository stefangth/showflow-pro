import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3 } from "@/lib/getRunning/steps";
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

// GetRunningBoardV3 reads useGetRunningV3 (the live-data integration hook) and useAuth
// directly, mirroring GetRunningPage.test.tsx's harness for the v1 board: useGetRunningV3
// is mocked so each test hands back an exact model (built with the REAL composer,
// composeGetRunningV3, in the same spirit as board.test.tsx's HeroCard/StillShutCard/
// PhaseIconRail/PhaseRow tests — never a hand-rolled model shape) rather than seeding
// every table the underlying booking/hire-order setup reads touch (that live-data wiring
// is covered by useGetRunningV3.test.tsx). useAuth is exercised for real via
// renderWithProviders' authOverrides (a real AuthContext.Provider), not mocked.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));

import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { GetRunningBoardV3 } from "./GetRunningBoardV3";

const TEST_ORG = { id: "org-1", name: "Nordstadt Produktionen", slug: "nordstadt", status: "active", is_demo: false };

// Minimal booking/hire fixture builders, mirroring board.test.tsx's own helpers so this
// suite composes its models through the same real composer rather than a hand-rolled
// object shape.
function booking(overrides: Partial<Record<string, boolean>> = {}): BookingSetupStatus {
  const keys = ["shows", "slots", "flow", "people", "ladder", "eligibility", "timing"];
  return {
    steps: keys.map((key) => ({ key, done: overrides[key] ?? true, block: null })),
    datesWithoutCity: 0,
  } as unknown as BookingSetupStatus;
}
function hire(overrides: Partial<Record<"letterhead" | "terms" | "countersign", boolean>> = {}): HireOrderSetupStatus {
  const keys = ["letterhead", "terms", "countersign"] as const;
  return {
    steps: keys.map((key) => {
      const done = overrides[key] ?? true;
      return { key, done, blocksIssue: !done };
    }),
  } as unknown as HireOrderSetupStatus;
}
const base: GetRunningInputV3 = {
  role: "admin",
  bookingOn: true,
  hireOrdersOn: true,
  booking: booking(),
  hire: hire(),
  datesSource: "airtable",
  datesConnectDone: true,
  datesMapDone: true,
  datesCitiesDone: true,
  producerCount: 1,
  skillsDone: true,
  feeDone: false,
  documentDone: false,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
  canManageSkills: true,
  canEditHire: true,
  canAddArtists: true,
  canInvite: true,
};

function mockModel(model: GetRunningModelV3) {
  vi.mocked(useGetRunningV3).mockReturnValue({ model, isLoading: false });
}

function renderBoard() {
  return renderWithProviders(
    <MemoryRouter>
      <GetRunningBoardV3 context="page" />
    </MemoryRouter>,
    {
      authOverrides: {
        currentOrg: TEST_ORG,
        roles: ["admin"],
        hasRole: (r) => r === "admin",
      },
    },
  );
}

describe("GetRunningBoardV3", () => {
  it("shows the board with three phase rows and expands a phase inline on click", () => {
    // get_dates and the artists/coverage/flow/timing/team steps of bookable are all done
    // (no offers/booking-blocking step is outstanding), so nothing auto-opens on mount —
    // the board renders three plain phase rows. paperwork's letterhead is left undone
    // (a real, non-placeholder step editor) so clicking it exercises the "real step body"
    // path, not the placeholder one (covered separately below).
    mockModel(
      composeGetRunningV3({
        ...base,
        hire: hire({ letterhead: false }),
      }),
    );

    renderBoard();

    expect(screen.getByTestId("phase-row-get_dates")).toBeInTheDocument();
    expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();
    expect(screen.getByTestId("phase-row-paperwork")).toBeInTheDocument();

    const paperworkRow = screen.getByTestId("phase-row-paperwork");
    fireEvent.click(within(paperworkRow).getByRole("button", { name: /continue|start/i }));

    // The row is gone, replaced by the wizard shell (its own header/footer chrome), and
    // the OTHER two phases stay as plain rows.
    expect(screen.queryByTestId("phase-row-paperwork")).not.toBeInTheDocument();
    expect(screen.getByTestId("phase-row-get_dates")).toBeInTheDocument();
    expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
    expect(screen.getByText(/how this works/i)).toBeInTheDocument();
    // letterhead is a real editor, not the placeholder body.
    expect(screen.queryByText(/more on the way/i)).not.toBeInTheDocument();
  });

  it("shows the real skills step body inside the wizard, not a placeholder", () => {
    // skills is undone and every other bookable step is done, so opening "bookable"
    // lands directly on the "skills" step. As of Phase 3 (Task 6) skills has a real
    // in-panel editor (SkillsStep, reusing the Settings SkillsTab), not the Phase-1
    // placeholder (StepComingSoon).
    mockModel(composeGetRunningV3({ ...base, skillsDone: false }));

    renderBoard();

    const bookableRow = screen.getByTestId("phase-row-bookable");
    fireEvent.click(within(bookableRow).getByRole("button", { name: /continue|start/i }));

    expect(screen.getByText(/skills for your parts/i)).toBeInTheDocument();
    expect(screen.queryByText(/more on the way/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
  });

  it("renders the retired state when the model is complete", () => {
    mockModel(composeGetRunningV3({ ...base, feeDone: true, documentDone: true }));

    renderBoard();

    expect(screen.getByTestId("get-running-v3-retired")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-row-/)).not.toBeInTheDocument();
  });

  it("does not expand a waits-on phase from its rail icon click", () => {
    // bookable waits on get_dates (slots undone -> get_dates not done), so its rail icons
    // must render inert and clicking one must not swap the row for the wizard shell.
    mockModel(composeGetRunningV3({ ...base, booking: booking({ slots: false }) }));

    renderBoard();

    const rail = screen.getByTestId("phase-icon-rail-bookable");
    expect(within(rail).queryAllByRole("button")).toHaveLength(0);

    const firstIcon = rail.querySelector("[title]") as HTMLElement;
    fireEvent.click(firstIcon);

    expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
  });

  it("scrolls the all-steps card into view when See all steps is clicked", () => {
    mockModel(composeGetRunningV3(base));
    renderBoard();

    const scrollIntoView = vi.fn();
    const allStepsCard = screen.getByTestId("all-steps-card");
    allStepsCard.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole("button", { name: /see all steps/i }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("shows the nothing-to-set-up card when neither module is on", () => {
    mockModel(composeGetRunningV3({ ...base, bookingOn: false, hireOrdersOn: false, booking: null, hire: null }));

    renderBoard();

    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-row-/)).not.toBeInTheDocument();
  });
});
