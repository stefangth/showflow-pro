import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { composeGetRunningV3, type GetRunningInputV3, type GetRunningModelV3, type GetRunningStep } from "@/lib/getRunning/steps";
import type { BookingSetupStatus } from "@/lib/bookings/setupStatus";
import type { HireOrderSetupStatus } from "@/lib/hireOrders/setupStatus";

// Task 13a regression coverage: the model's `hidden` step flag (steps.ts) is inert in the
// render/navigation layer that GetRunningBoardV3.tsx owns. composeGetRunningV3's own
// doneCount/totalCount/nextStep already exclude hidden steps (see steps.test.ts), but until
// this fix the board rendered the FULL phase.steps array regardless, so a manual-source org
// saw "connect"/"map" in the wizard rail, a "/5" step count instead of "/3", and step
// navigation that could walk INTO a hidden step. This file is a dedicated companion to
// GetRunningBoardV3.test.tsx (not folded into it) because it needs to mock StepBodyV3 with
// a controllable fake body (a plain "Mark step done" button) to drive `onDone` without
// wiring up every real per-step editor's own data dependencies (SourceStep/CitiesStep/etc.
// are already covered by their own test files) — mocking stepRegistryV3 module-wide would
// undermine GetRunningBoardV3.test.tsx's own assertions that a real editor (not a stub)
// renders for a non-placeholder step, so it stays isolated here instead.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useGetRunningV3", () => ({ useGetRunningV3: vi.fn() }));
vi.mock("@/components/getRunning/v3/stepRegistryV3", () => ({
  StepBodyV3: ({ step, onDone }: { step: GetRunningStep; onDone: () => void }) => (
    <div>
      <span>STEP_BODY:{step.key}</span>
      <button type="button" onClick={onDone}>
        Mark step done
      </button>
    </div>
  ),
}));

import { useGetRunningV3 } from "@/hooks/useGetRunningV3";
import { GetRunningBoardV3 } from "./GetRunningBoardV3";

const TEST_ORG = { id: "org-1", name: "Nordstadt Produktionen", slug: "nordstadt", status: "active", is_demo: false };

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
  feeDone: true,
  documentDone: true,
  canManageShows: true,
  canEditScheduling: true,
  canEditBooking: true,
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

describe("GetRunningBoardV3 hidden steps (manual dates source)", () => {
  it("shows only the 3 visible get_dates steps in the wizard rail and step count, never connect/map", () => {
    // datesSource "manual" marks connect/map hidden (steps.ts). Cities left undone so the
    // get_dates phase isn't fully done (a done phase renders a checkmark, no Continue
    // button — see PhaseRow). Note: with cities undone and hard-blocking, the board's own
    // auto-open-on-mount effect (firstBlockingStep) already expands get_dates on render
    // (landing on "cities", its first not-done VISIBLE blocking step) — this test doesn't
    // depend on that timing either way, since it opens the phase itself via the "All
    // steps" card's rail icon (always rendered, open or not), which is deterministic.
    const model = composeGetRunningV3({
      ...base,
      datesSource: "manual",
      datesConnectDone: false,
      datesMapDone: false,
      datesCitiesDone: false,
    });
    mockModel(model);
    renderBoard();

    const iconRail = screen.getByTestId("phase-icon-rail-get_dates");
    fireEvent.click(within(iconRail).getByTitle(/choose where your dates come from/i));

    // Left step rail: exactly 3 entries (source, cities, productions), never connect/map.
    // Matched by step TITLE, not a loose text search — the visible "source" step's own
    // hint copy ("Connect Airtable or add productions by hand.") legitimately contains the
    // word "Connect", so a substring match on the rail's full text would false-negative.
    const nav = screen.getByRole("navigation", { name: /steps/i });
    const railButtons = within(nav).getAllByRole("button");
    expect(railButtons).toHaveLength(3);
    expect(within(nav).getByText("Choose where your dates come from")).toBeInTheDocument();
    expect(within(nav).getByText("Set a city on every date")).toBeInTheDocument();
    expect(within(nav).getByText("Review your productions")).toBeInTheDocument();
    expect(within(nav).queryByText("Connect Airtable")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Map your fields")).not.toBeInTheDocument();

    // Header step counter reflects the visible total (3), not the full phase.steps length (5).
    expect(screen.getByLabelText(/step 1 of 3/i)).toBeInTheDocument();
  });

  it("advancing from source skips the hidden connect/map steps and lands on cities", () => {
    const model = composeGetRunningV3({
      ...base,
      datesSource: "manual",
      datesConnectDone: false,
      datesMapDone: false,
      datesCitiesDone: false,
    });
    mockModel(model);
    renderBoard();

    // Explicitly open "source" via its rail icon in the "All steps" card — the rail lets
    // you reopen any step regardless of its done state, which is what lets this test start
    // the advance from "source" specifically (the board's own auto-open-on-mount would
    // otherwise land straight on "cities", since "source" is already done for a chosen
    // manual source).
    const iconRail = screen.getByTestId("phase-icon-rail-get_dates");
    fireEvent.click(within(iconRail).getByTitle(/choose where your dates come from/i));

    expect(screen.getByText("STEP_BODY:source")).toBeInTheDocument();
    expect(screen.getByLabelText(/step 1 of 3/i)).toBeInTheDocument();

    // Fire the mocked step body's onDone. The OLD (buggy) logic advanced through the raw
    // phase.steps array and would have landed on "connect" (index 1) next; the fix walks
    // the VISIBLE list only, so it must land on "cities" instead.
    fireEvent.click(screen.getByRole("button", { name: /mark step done/i }));

    expect(screen.getByText("STEP_BODY:cities")).toBeInTheDocument();
    expect(screen.queryByText("STEP_BODY:connect")).not.toBeInTheDocument();
    expect(screen.queryByText("STEP_BODY:map")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/step 2 of 3/i)).toBeInTheDocument();
  });
});
