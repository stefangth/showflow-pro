import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";
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
// A no-seed fake client (rather than the bare `{}` this suite used to mock in): the
// deep-link test below opens real step bodies, whose own hooks read the singleton. With no
// seeds every read resolves empty, which is all those assertions need.
Object.assign(client, createFakeSupabase({}));

// The retired state's dismiss control shares the same rail-dismissal hook v1's
// RetiredBoard uses, spied the same way RetiredBoard.test.tsx does rather than
// touching real localStorage.
const dismissFn = vi.fn();
vi.mock("@/components/setup/useRailDismissed", () => ({
  useRailDismissed: () => [false, dismissFn, vi.fn()],
}));

// The phase handoff is a `sonner` toast (the codebase's side-effect convention), spied the
// same way the step-body suites in this folder spy it rather than rendering a Toaster.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
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
  hasAnyDates: true,
  producerCount: 1,
  skillGaps: 0,
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

function renderBoardAt(context: "page" | "settings", path: string) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <GetRunningBoardV3 context={context} />
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

    // The whole bar is the trigger now (the row itself is the button), so click the row.
    fireEvent.click(screen.getByTestId("phase-row-paperwork"));

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

  it("reopens an already-completed phase's wizard when its bar is clicked", () => {
    // Same model as the first test: get_dates is fully done (renders as a done row with a
    // check, no Start/Continue word) and nothing auto-opens on mount. Clicking that bar
    // must still reopen the phase — a finished phase is reviewable, not a dead end.
    mockModel(composeGetRunningV3({ ...base, hire: hire({ letterhead: false }) }));

    renderBoard();

    const getDatesRow = screen.getByTestId("phase-row-get_dates");
    expect(within(getDatesRow).queryByText(/continue|start/i)).not.toBeInTheDocument();
    fireEvent.click(getDatesRow);

    // The done row is swapped for the wizard shell in place.
    expect(screen.queryByTestId("phase-row-get_dates")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
  });

  it("shows the real skills step body inside the wizard, not a placeholder", () => {
    // skills is undone and every other bookable step is done, so opening "bookable"
    // lands directly on the "skills" step. As of Phase 3 (Task 6) skills has a real
    // in-panel editor (SkillsStep, reusing the Settings SkillsTab), not the Phase-1
    // placeholder (StepComingSoon).
    mockModel(composeGetRunningV3({ ...base, skillGaps: 1 }));

    renderBoard();

    fireEvent.click(screen.getByTestId("phase-row-bookable"));

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

  it("retired state offers a hide-from-nav control and a Settings link, and hide dismisses the rail", () => {
    mockModel(composeGetRunningV3({ ...base, feeDone: true, documentDone: true }));

    renderBoard();

    const settingsLink = screen.getByRole("link", { name: /manage in settings/i });
    expect(settingsLink.getAttribute("href")).toContain("/settings?tab=get-running");

    fireEvent.click(screen.getByRole("button", { name: /hide from the sidebar/i }));
    expect(dismissFn).toHaveBeenCalled();
  });

  it("retired state omits the Settings link inside the Settings mirror, but keeps hide-from-nav", () => {
    mockModel(composeGetRunningV3({ ...base, feeDone: true, documentDone: true }));

    renderBoardAt("settings", "/settings?tab=get-running");

    expect(screen.getByTestId("get-running-v3-retired")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /manage in settings/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /hide from the sidebar/i }));
    expect(dismissFn).toHaveBeenCalled();
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

  it("opens the ?step= deep link on mount for page context, winning over first-blocking", () => {
    // Nothing is outstanding (base has every step done), so without the deep link nothing
    // would auto-open at all. ?step=artists names a visible step in an unblocked phase
    // (bookable's waitsOn is null once productions/slots is done), so it must win.
    mockModel(composeGetRunningV3(base));

    renderBoardAt("page", "/get-running?step=artists");

    expect(screen.getByText(/add an artist/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();
  });

  // Regression: `?step=` used to be applied behind a one-shot `autoOpenedRef`, which is
  // spent on the board's first render with a model. An in-app link that only changes the
  // query string (the cities step's "Go to productions", the single affordance the no-dates
  // state offers) therefore moved the URL and nothing else, and only appeared to work from
  // the Settings mirror because that route remounts the board.
  it("re-opens the named step when an in-app link changes ?step= after mount", async () => {
    // Manual source with no dates: get_dates opens on `cities`, whose body renders the
    // no-dates well and its link into the productions step.
    mockModel(composeGetRunningV3({ ...base, datesSource: "manual", hasAnyDates: false, datesCitiesDone: false }));

    renderBoardAt("page", "/get-running?step=cities");

    const link = await screen.findByRole("link", { name: /go to productions/i });
    fireEvent.click(link);

    // The wizard actually moved: the productions body is mounted, and the cities body is gone.
    // The step's own sub-line also appears in the wizard's step list, hence findAllByText.
    expect((await screen.findAllByText(/check the productions that came in/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no dates yet/i)).not.toBeInTheDocument();
  });

  it("ignores ?step= for the settings mirror (context=\"settings\")", () => {
    mockModel(composeGetRunningV3(base));

    renderBoardAt("settings", "/settings?tab=get-running&step=artists");

    expect(screen.queryByText(/add an artist/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();
  });

  // Findings 06/07: a step that completes IMPLICITLY from data (no explicit Continue) used
  // to turn green under the viewer with no advance, and finishing a phase's last step
  // collapsed the whole wizard with no confirmation of what was finished.
  describe("advance and phase handoff", () => {
    beforeEach(() => {
      vi.mocked(toast.success).mockClear();
    });

    const board = (
      <MemoryRouter>
        <GetRunningBoardV3 context="page" />
      </MemoryRouter>
    );

    it("advances to the next outstanding step when the open step completes from data alone", () => {
      // artists and skills both outstanding; neither blocks, so nothing auto-opens.
      mockModel(composeGetRunningV3({ ...base, booking: booking({ people: false }), skillGaps: 1 }));
      const { rerender } = renderBoard();

      fireEvent.click(screen.getByTestId("phase-row-bookable"));
      expect(screen.getByText(/add an artist/i)).toBeInTheDocument();

      // A background refetch: the roster now has artists, so `artists` flips done under
      // the viewer with no explicit save on this board.
      mockModel(composeGetRunningV3({ ...base, skillGaps: 1 }));
      rerender(board);

      expect(screen.getByText(/skills for your parts/i)).toBeInTheDocument();
      expect(screen.queryByText(/add an artist/i)).not.toBeInTheDocument();
    });

    it("does not bounce a viewer forward off a step that was already done when they opened it", () => {
      // Only `skills` is outstanding in bookable, so the phase opens on it; the viewer
      // deliberately clicks BACK to the finished `artists` step to review it.
      mockModel(composeGetRunningV3({ ...base, skillGaps: 1 }));
      const { rerender } = renderBoard();

      fireEvent.click(screen.getByTestId("phase-row-bookable"));
      // Scoped to the wizard's own step nav: the phase rail above it offers icon buttons
      // with the same accessible name.
      const stepsNav = screen.getByRole("navigation", { name: /steps/i });
      fireEvent.click(within(stepsNav).getByRole("button", { name: /add your artists/i }));
      expect(screen.getByText(/add an artist/i)).toBeInTheDocument();

      rerender(board);

      expect(screen.getByText(/add an artist/i)).toBeInTheDocument();
      expect(screen.queryByText(/skills for your parts/i)).not.toBeInTheDocument();
    });

    it("does not reopen or move a wizard the viewer collapsed when a step later completes", () => {
      mockModel(composeGetRunningV3({ ...base, booking: booking({ people: false }), skillGaps: 1 }));
      const { rerender } = renderBoard();

      fireEvent.click(screen.getByTestId("phase-row-bookable"));
      fireEvent.click(screen.getByRole("button", { name: /collapse/i }));
      expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();

      mockModel(composeGetRunningV3({ ...base, skillGaps: 1 }));
      rerender(board);

      expect(screen.getByTestId("phase-row-bookable")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    });

    it("confirms the finished phase and names the next one instead of closing silently", () => {
      // `cities` is the only outstanding step in get_dates (and blocks, so it auto-opens);
      // paperwork still has fee and document outstanding, so there IS a next phase.
      mockModel(composeGetRunningV3({ ...base, datesCitiesDone: false }));
      const { rerender } = renderBoard();
      expect(screen.getByRole("button", { name: /collapse/i })).toBeInTheDocument();

      mockModel(composeGetRunningV3(base));
      rerender(board);

      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Get dates in is done. Next up: Paperwork.");
      // And the wizard hands back to the board rather than sitting on a finished phase.
      expect(screen.getByTestId("phase-row-get_dates")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /collapse/i })).not.toBeInTheDocument();
    });

    it("does not name a next phase when the finished phase was the last outstanding one", () => {
      // `document` is the only outstanding step on the whole board, and it is the last
      // visible step of paperwork: finishing it finishes everything.
      mockModel(composeGetRunningV3({ ...base, feeDone: true }));
      const { rerender } = renderBoard();

      fireEvent.click(screen.getByTestId("phase-row-paperwork"));
      expect(screen.getByText(/set how contract numbers are built/i)).toBeInTheDocument();

      mockModel(composeGetRunningV3({ ...base, feeDone: true, documentDone: true }));
      rerender(board);

      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Paperwork is done. That was the last step on this board.");
      expect(screen.getByTestId("get-running-v3-retired")).toBeInTheDocument();
    });

    it("confirms the phase on an explicit save too, not only on an implicit one", () => {
      // The document step's Continue calls `onDone` straight through, so this exercises
      // the explicit `handleStepDone` path rather than the data-driven effect.
      mockModel(composeGetRunningV3({ ...base, feeDone: true }));
      renderBoard();

      fireEvent.click(screen.getByTestId("phase-row-paperwork"));
      fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Paperwork is done. That was the last step on this board.");
      expect(screen.getByTestId("phase-row-paperwork")).toBeInTheDocument();
    });
  });

  it("shows the nothing-to-set-up card when neither module is on", () => {
    mockModel(composeGetRunningV3({ ...base, bookingOn: false, hireOrdersOn: false, booking: null, hire: null }));

    renderBoard();

    expect(screen.getByTestId("get-running-v3-nothing")).toBeInTheDocument();
    expect(screen.queryByTestId(/phase-row-/)).not.toBeInTheDocument();
  });
});
