import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  cast_members: {
    data: [{ id: "m1", artist_id: "a1", created_at: "2026-08-10T10:05:00Z", artist: { id: "a1", name: "Artist One", status: "active" } }],
    error: null,
  },
  artists: {
    data: [
      { id: "a1", name: "Artist One", status: "active" },
      { id: "a2", name: "Artist Two", status: "active" },
    ],
    error: null,
  },
  // fetchSkillsByArtist joins artist_skills -> skills.
  artist_skills: {
    data: [{ artist_id: "a1", skill: { id: "sk1", name: "Aerial" } }],
    error: null,
  },
  // fetchUpcomingConfirmedDateCounts: two far-future (always upcoming) + one past.
  bookings: {
    data: [
      { artist_id: "a1", show_date_id: "d1", show_date: { date: "2099-01-01" } },
      { artist_id: "a1", show_date_id: "d2", show_date: { date: "2099-02-01" } },
      { artist_id: "a1", show_date_id: "d3", show_date: { date: "2000-01-01" } },
    ],
    error: null,
  },
  cities: {
    data: [
      { id: "city-1", name: "Berlin", org_id: "org-1" },
      { id: "city-2", name: "Munich", org_id: "org-1" },
      { id: "city-3", name: "Hamburg", org_id: "org-1" },
    ],
    error: null,
  },
  shows: {
    data: [{ id: "show-1", program: "Show One", sub_program: null }],
    error: null,
  },
  casts: {
    data: [
      { id: "c1", name: "Cast A" },
      { id: "c2", name: "Cast B" },
    ],
    error: null,
  },
  // Cast A (c1): tier 1 in Berlin, tier 2 in Hamburg (behind Cast B). Munich unranked.
  cast_city_priority: {
    data: [
      { id: "p1", cast_id: "c1", city_id: "city-1", priority: 1 },
      { id: "p2", cast_id: "c2", city_id: "city-3", priority: 1 },
      { id: "p3", cast_id: "c1", city_id: "city-3", priority: 2 },
    ],
    error: null,
  },
  // Cast A eligible for Show One in Berlin (has a tier) and Munich (no tier -> gap).
  show_cast_eligibility: {
    data: [
      { id: "e1", city_id: "city-1", show_id: "show-1" },
      { id: "e2", city_id: "city-2", show_id: "show-1" },
    ],
    error: null,
  },
}));

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ roles: ["producer"], currentOrg: { id: "org-1", name: "Cirque Nova" } }),
}));
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));

import { useCan } from "@/hooks/useCapabilities";
import { CastDetailsSheet } from "./CastDetailsSheet";

const CAST = {
  id: "c1",
  name: "Cast A",
  description: "First-call ensemble.",
  org_id: "org-1",
  created_at: "2026-08-10T10:00:00Z",
  updated_at: "2026-08-10T10:00:00Z",
} as never;

function render() {
  return renderWithProviders(
    <MemoryRouter>
      <CastDetailsSheet cast={CAST} open onOpenChange={() => {}} />
    </MemoryRouter>,
  );
}

describe("CastDetailsSheet (design 2a)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useCan).mockReturnValue(true); });

  it("renders the cast identity, eyebrow, and description in the header", async () => {
    render();
    expect(await screen.findByRole("heading", { name: "Cast A" })).toBeInTheDocument();
    expect(screen.getByText(/Cast · Cirque Nova/)).toBeInTheDocument();
    expect(screen.getByText("First-call ensemble.")).toBeInTheDocument();
  });

  it("shows roster members with their skill chip and real upcoming-date count", async () => {
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByText("Aerial")).toBeInTheDocument();
    // Two of the three seeded bookings are upcoming.
    expect(await screen.findByText("2 dates")).toBeInTheDocument();
  });

  it("renders the KPI tiles derived from real data", async () => {
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByText("Cities eligible")).toBeInTheDocument();
    expect(screen.getByText("Tier 1 cities")).toBeInTheDocument();
    // 2 of 3 cities are eligible.
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("flags a coverage gap for a city eligible with no tier", async () => {
    render();
    expect(await screen.findByText("Coverage gap")).toBeInTheDocument();
    // Munich is eligible for Show One but has no tier for this cast.
    expect(screen.getByText(/Munich not in any tier/)).toBeInTheDocument();
  });

  it("renders the city coverage rows with tier badges and toggleable show chips", async () => {
    render();
    expect(await screen.findByText("City coverage")).toBeInTheDocument();
    // Berlin holds tier 1 for this cast; Munich holds none.
    const berlinRow = (await screen.findByText("Berlin")).closest("[data-city-row]")!;
    expect(within(berlinRow as HTMLElement).getByText("Tier 1")).toBeInTheDocument();
    const munichRow = screen.getByText("Munich").closest("[data-city-row]")!;
    expect(within(munichRow as HTMLElement).getByText("No tier")).toBeInTheDocument();
    // Each row exposes a toggle chip per show.
    expect(within(berlinRow as HTMLElement).getByRole("button", { name: /Show One/ })).toBeEnabled();
  });

  it("builds an activity feed from real timestamps", async () => {
    render();
    expect(await screen.findByText("Cast created")).toBeInTheDocument();
    expect(await screen.findByText("Artist One added to the roster")).toBeInTheDocument();
  });

  it("manage_casts on: edit, remove, and add controls are enabled", async () => {
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit cast" })).toBeEnabled();
    expect(screen.getByLabelText("Remove Artist One")).toBeEnabled();
    // Search reveals the addable candidate.
    fireEvent.change(screen.getByPlaceholderText(/Search the roster/), { target: { value: "Artist Two" } });
    const candidate = await screen.findByText("Artist Two");
    expect(within(candidate.closest("[data-candidate]") as HTMLElement).getByRole("button")).toBeEnabled();
  });

  it("keeps a visible close control in edit mode", async () => {
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit cast" }));
    // The edit form is shown...
    expect(screen.getByPlaceholderText("Cast name")).toBeInTheDocument();
    // ...and the sheet still exposes a way out (regression: close was previously
    // only rendered in the non-edit branch).
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("manage_casts off: edit and remove controls are disabled/absent, roster still reads", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit cast" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove Artist One")).toBeDisabled();
  });

  it("links out to the offer-order coverage matrix in Settings", async () => {
    render();
    expect(await screen.findByText("Artist One")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage offer order/i })).toHaveAttribute(
      "href",
      "/settings?tab=casts-coverage",
    );
  });
});
