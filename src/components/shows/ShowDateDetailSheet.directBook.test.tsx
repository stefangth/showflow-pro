import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";

/**
 * Regression guard for the direct-book list wiring (design 1h): EligibilityBookList's
 * requirement-as-fact sentence and per-skill narrowing counts are unit-tested against the
 * component directly (EligibilityBookList.test.tsx), but that alone missed a real bug —
 * ShowDateDetailSheet, the component's only caller, never passed `totalArtistCount` or
 * `requiredSkillNames`, and `fetchActiveArtistOptions` never carried `skillIds`, so in the
 * live app the sentence never rendered and every narrowing chip read a hard-coded 0. This
 * file renders the REAL EligibilityBookList (unlike ShowDateDetailSheet.test.tsx and
 * .moduleGate.test.tsx, which stub it out to stay focused on capability gates) so the
 * wiring itself is under test, not just the component in isolation.
 */
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));
vi.mock("@/hooks/useEntitlements", async (orig) => {
  const useFeature = vi.fn();
  return {
    ...(await orig<typeof import("@/hooks/useEntitlements")>()),
    useFeature,
    useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }),
  };
});
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false, getCustomFieldDefs: () => [] }) }));
// No cast/city restriction: deriveDirectBookList then opens the picker to the whole roster,
// so this test's qualifying/total numbers come entirely from the skill-eligibility filter.
vi.mock("@/hooks/useEligibleArtists", () => ({
  useEligibleArtists: () => ({ data: { artistIds: null, castIds: [] }, isError: false }),
}));
// Unlike the other ShowDateDetailSheet test files, this one needs REAL skill names: the
// requirement-as-fact sentence and the narrowing chips both render off this list.
vi.mock("@/hooks/useSkills", () => ({
  useSkills: () => ({
    data: [
      { id: "sk-voc", name: "Vocals" },
      { id: "sk-combat", name: "Stage combat" },
      { id: "sk-piano", name: "Piano" },
    ],
  }),
}));
vi.mock("@/hooks/useBookingFlow", () => ({
  // artist_acceptance: false -> direct-booking mode, the EligibilityBookList branch.
  useBookingFlow: () => ({ data: { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false } }),
  useReferenceField: () => ({ reference: { source: "show" }, customFieldKey: null }),
}));
vi.mock("@/hooks/useAllCities", () => ({ useAllCities: () => ({ data: [] }) }));
vi.mock("@/hooks/useShowDates", () => ({
  useCancelShowDate: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteShowDate: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/components/chat/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("@/components/shows/hireOrders/HireOrdersCard", () => ({ HireOrdersCard: () => null }));
vi.mock("@/components/shows/ShowDateFormDialog", () => ({ ShowDateFormDialog: () => null }));
vi.mock("@/components/shows/date/DryRunDialog", () => ({ DryRunDialog: () => null }));
// Direct mode never mounts TierTimeline, but stub it anyway for parity with the sibling
// test files and to fail loudly (a visible "offers" stub) if that assumption ever breaks.
vi.mock("@/components/shows/date/TierTimeline", () => ({
  TierTimeline: () => <div data-testid="tier-timeline-unexpected">tiered UI mounted in direct mode</div>,
}));
// EligibilityBookList is deliberately NOT mocked here.

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useFeature } from "@/hooks/useEntitlements";
import { ShowDateDetailSheet } from "./ShowDateDetailSheet";

const SHOW_DATE = {
  id: "sd-1",
  date: "2026-03-01",
  session_1: "20:00:00",
  session_2: null,
  session_3: null,
  venue: "Main Hall",
  status: "open",
  notes: null,
  city_id: null,
  show_id: "show-1",
  cancellation_reason: null,
  airtable_record_id: null,
  custom: null,
  show: { id: "show-1", program: "Aurora", sub_program: null, main_cast_slots: 2, understudy_slots: 1 },
  city: null,
};

function renderSheet() {
  return renderWithProviders(
    <ShowDateDetailSheet showDateId="sd-1" open onOpenChange={vi.fn()} />,
  );
}

const clickTab = async (name: RegExp) =>
  fireEvent.click(await screen.findByRole("button", { name }));

describe("ShowDateDetailSheet direct-book wiring (design 1h)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      hasRole: (r: string) => r === "producer",
      roles: ["producer"],
      user: { id: "u1" },
      currentOrg: { id: "org-1", name: "Aurora Productions" },
    } as never);
    vi.mocked(useCan).mockReturnValue(true);
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");

    seedClient({
      show_dates: { data: SHOW_DATE, error: null },
      bookings: { data: [], error: null },
      casts: { data: [], error: null },
      show_date_cast_eligibility: { data: [], error: null },
      blocked_dates: { data: [], error: null },
      // The date requires Vocals + Stage combat at the show level, nothing added per-date.
      show_required_skills: { data: [{ skill_id: "sk-voc" }, { skill_id: "sk-combat" }], error: null },
      show_date_required_skills: { data: [], error: null },
      // Four active artists. Marta and Jonas hold BOTH required skills (qualify); Lena
      // holds only Vocals and Ben only Piano (neither qualifies) -> 2 of 4 qualify.
      // Only Marta also holds Piano, so the Piano narrowing chip should read a non-zero
      // count of 1 (computed from the two LISTED/qualifying artists, not all four).
      artists: {
        data: [
          { id: "a1", name: "Marta Feld" },
          { id: "a2", name: "Jonas Trier" },
          { id: "a3", name: "Lena Cole" },
          { id: "a4", name: "Ben Ostrowski" },
        ],
        error: null,
      },
      artist_skills: {
        data: [
          { artist_id: "a1", skill_id: "sk-voc" },
          { artist_id: "a1", skill_id: "sk-combat" },
          { artist_id: "a1", skill_id: "sk-piano" },
          { artist_id: "a2", skill_id: "sk-voc" },
          { artist_id: "a2", skill_id: "sk-combat" },
          { artist_id: "a3", skill_id: "sk-voc" },
          { artist_id: "a4", skill_id: "sk-piano" },
        ],
        error: null,
      },
    });
  });

  it("renders the requirement-as-fact sentence with the real qualifying/total counts", async () => {
    renderSheet();
    await clickTab(/^book artists$/i);
    // unionSkillIds (src/lib/eligibility.ts) sorts the required-skill id set, so the
    // rendered order follows the skill ids ("sk-combat" < "sk-voc"), not seed row order.
    expect(
      await screen.findByText(
        "This date requires Stage combat and Vocals · 2 of 4 artists qualify and are free.",
      ),
    ).toBeInTheDocument();
    // The stale, wrong-in-direct-mode label must not reappear.
    expect(screen.queryByText("Only offer to artists with")).not.toBeInTheDocument();
  });

  it("shows a real, non-zero per-skill count on a narrowing chip for a skill some listed artists hold", async () => {
    renderSheet();
    await clickTab(/^book artists$/i);
    // Wait for the qualifying list itself, so the chip counts below are settled.
    expect(await screen.findByText("Marta Feld")).toBeInTheDocument();
    expect(screen.getByText("Jonas Trier")).toBeInTheDocument();
    const pianoChip = screen.getByRole("button", { name: /^Piano/ });
    expect(pianoChip).toHaveTextContent("1");
    expect(pianoChip.textContent).not.toBe("Piano");
  });
});

/**
 * The rail's eligibility line counts who can be asked. `deriveDirectBookList` filters by
 * cast, skill and blocked dates only, so an already-booked artist stays in the list (the
 * book list renders them with a Booked badge and no Book button). On a fully-booked
 * unrestricted date the line must not claim there is anyone left to ask.
 */
describe("ShowDateDetailSheet rail eligibility count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      hasRole: (r: string) => r === "producer",
      roles: ["producer"],
      user: { id: "u1" },
      currentOrg: { id: "org-1", name: "Aurora Productions" },
    } as never);
    vi.mocked(useCan).mockReturnValue(true);
    vi.mocked(useFeature).mockImplementation((f) => f === "booking_flow");
  });

  // No required skills and no cast eligibility -> the rail takes the no-restrictions branch.
  const unrestricted = (bookings: unknown[]) => ({
    show_dates: { data: SHOW_DATE, error: null },
    bookings: { data: bookings, error: null },
    casts: { data: [], error: null },
    show_date_cast_eligibility: { data: [], error: null },
    blocked_dates: { data: [], error: null },
    show_required_skills: { data: [], error: null },
    show_date_required_skills: { data: [], error: null },
    artists: { data: [{ id: "a1", name: "Marta Feld" }, { id: "a2", name: "Jonas Trier" }], error: null },
    artist_skills: { data: [], error: null },
  });

  const booking = (id: string, artistId: string, status: string) => ({
    id, show_date_id: "sd-1", artist_id: artistId, status, is_understudy: false,
    offer_expires_at: null, artist: { id: artistId, name: artistId },
  });

  it("counts only artists who are not already booked", async () => {
    seedClient(unrestricted([booking("bk-1", "a1", "confirmed")]));
    renderSheet();
    expect(await screen.findByText(/1 artist can be asked/i)).toBeInTheDocument();
  });

  it("says nobody can be asked when every eligible artist is already booked", async () => {
    seedClient(unrestricted([booking("bk-1", "a1", "confirmed"), booking("bk-2", "a2", "soft_booked")]));
    renderSheet();
    expect(await screen.findByText(/nobody can be asked yet/i)).toBeInTheDocument();
  });

  // A cancelled booking frees the artist again, so they are askable.
  it("counts an artist whose only booking was cancelled", async () => {
    seedClient(unrestricted([booking("bk-1", "a1", "cancelled"), booking("bk-2", "a2", "confirmed")]));
    renderSheet();
    expect(await screen.findByText(/1 artist can be asked/i)).toBeInTheDocument();
  });
});
