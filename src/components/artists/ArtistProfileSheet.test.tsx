import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase } from "@/test/supabaseFake";

// Design 1i: the skills block becomes held-skill ROWS (violet, with an
// "N upcoming dates" / "Not required yet" metadata) plus catalog add-chips for
// everything not yet held. Free-text creation is gone entirely — an admin adds
// new skills from Settings -> Casts & Cities now (SkillsCard, task 1f).
//
// This file deliberately does NOT mock @/hooks/useSkills: useSkills /
// useArtistSkills / useUpcomingDateCountsBySkill are real, and their query
// caches are primed directly so the rows/chips/counts are present on the
// FIRST render (seed-once-ref lesson: asserting only after an async settle
// would hide a briefly-empty render, and a background refetch against the
// unseeded fake tables would otherwise clobber the primed data before a
// `waitFor` could see it).

const ARTIST = {
  id: "a1",
  name: "Marta Voss",
  email: "marta@x.com",
  phone: null,
  bio: null,
  status: "active" as const,
  user_id: null,
  org_id: "org-1",
};

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(
  client,
  createFakeSupabase({
    artists: [{ when: { id: "a1" }, data: ARTIST, error: null }],
  }),
);

const { auth } = vi.hoisted(() => ({ auth: { role: "admin" as string } }));
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({
    hasRole: (r: string) => r === auth.role,
    roles: [auth.role],
    currentOrg: { id: "org-1" },
  }),
}));
vi.mock("@/features/editor/EditorContext", () => ({ useEditorConfig: () => ({ isEditorMode: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useOrgMembers", () => ({ useOrgMembers: () => ({ data: [], isLoading: false }) }));
vi.mock("@/hooks/usePendingInvitedArtists", () => ({ usePendingInvitedArtists: () => ({ data: [] }) }));
vi.mock("@/data/invitations", () => ({
  inviteArtistToApp: vi.fn(),
  resendInvitation: vi.fn(),
  fetchOrgInvitations: vi.fn(() => Promise.resolve([])),
}));
vi.mock("./LinkedAccountPanel", () => ({ LinkedAccountPanel: () => null }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(() => true),
}));

import { useCan } from "@/hooks/useCapabilities";
import { ArtistProfileSheet } from "./ArtistProfileSheet";

const CATALOG = [
  { id: "s-vocals", name: "Vocals" },
  { id: "s-combat", name: "Stage combat" },
  { id: "s-piano", name: "Piano" },
  { id: "s-acting", name: "Acting" },
];
const HELD = [
  { id: "s-vocals", name: "Vocals" },
  { id: "s-combat", name: "Stage combat" },
];
const COUNTS = new Map<string, number>([
  ["s-vocals", 4],
  ["s-combat", 2],
]);

function renderSheet(opts?: {
  held?: typeof HELD;
  counts?: Map<string, number>;
  catalog?: typeof CATALOG;
}) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["artists", "detail", "a1"], ARTIST);
  queryClient.setQueryData(["skills", "org-1"], opts?.catalog ?? CATALOG);
  queryClient.setQueryData(["skills", "for-artist", "a1"], opts?.held ?? HELD);
  queryClient.setQueryData(["skills", "upcoming-date-counts", "org-1"], opts?.counts ?? COUNTS);
  return renderWithProviders(
    <MemoryRouter>
      <ArtistProfileSheet artistId="a1" open onOpenChange={() => {}} />
    </MemoryRouter>,
    { queryClient },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = "admin";
  vi.mocked(useCan).mockReturnValue(true);
});

describe("ArtistProfileSheet — skills editor (design 1i)", () => {
  it("renders held skills as rows with the upcoming-date-count metadata, on the first render", () => {
    renderSheet();

    const vocalsRow = screen.getByTestId("skill-row-s-vocals");
    expect(within(vocalsRow).getByText("Vocals")).toBeInTheDocument();
    expect(within(vocalsRow).getByText("4 upcoming dates")).toBeInTheDocument();
    expect(within(vocalsRow).getByLabelText("Remove Vocals")).toBeInTheDocument();

    const combatRow = screen.getByTestId("skill-row-s-combat");
    expect(within(combatRow).getByText("Stage combat")).toBeInTheDocument();
    expect(within(combatRow).getByText("2 upcoming dates")).toBeInTheDocument();
  });

  it('shows "Not required yet" for a held skill with no upcoming dates', () => {
    renderSheet({
      held: [{ id: "s-piano", name: "Piano" }],
      counts: new Map(),
    });
    const row = screen.getByTestId("skill-row-s-piano");
    expect(within(row).getByText("Not required yet")).toBeInTheDocument();
  });

  it("shows the held-of-catalog count header", () => {
    renderSheet();
    expect(screen.getByText("2 of 4 in the catalog")).toBeInTheDocument();
  });

  it("never shows a held count above the catalog denominator when a held skill has been archived out of the active catalog", () => {
    // Finding 3 regression: useSkills() returns ACTIVE skills only, so a held
    // skill that was later archived is absent from the catalog list. The
    // denominator must union held + active-catalog ids, not just count the
    // (now smaller) active catalog, or the header reads "2 of 1".
    renderSheet({
      held: HELD, // s-vocals, s-combat
      catalog: [{ id: "s-vocals", name: "Vocals" }], // s-combat archived out of the active catalog
    });
    expect(screen.getByText("2 of 2 in the catalog")).toBeInTheDocument();
    expect(screen.queryByText("2 of 1 in the catalog")).not.toBeInTheDocument();
  });

  it("an unheld catalog skill appears as an add-chip, and clicking it adds a held row", () => {
    renderSheet();

    expect(screen.queryByTestId("skill-row-s-piano")).not.toBeInTheDocument();
    const chip = screen.getByRole("button", { name: /Piano/ });
    fireEvent.click(chip);

    const row = screen.getByTestId("skill-row-s-piano");
    expect(within(row).getByText("Piano")).toBeInTheDocument();
    // A newly added skill has no seeded count -> "Not required yet".
    expect(within(row).getByText("Not required yet")).toBeInTheDocument();
    // The chip is gone now that the skill is held.
    expect(screen.queryByRole("button", { name: /^Piano$/ })).not.toBeInTheDocument();
  });

  it("has no free-text create affordance for a novel typed name", () => {
    renderSheet();
    // The old TagInput combobox (placeholder "Add skills…", "Search or type to
    // create…", "Create "x"") is gone entirely — replaced by rows + add-chips.
    expect(screen.queryByText(/create ["']/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add skills/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search or type to create/i)).not.toBeInTheDocument();
  });

  it('renders the "Settings, Casts & Cities" helper link to the catalog', () => {
    renderSheet();
    const link = screen.getByRole("link", { name: "Settings, Casts & Cities" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/settings"));
  });

  it("hides the upcoming-date-count metadata for an artist-role viewer (defensive gate)", () => {
    auth.role = "artist";
    renderSheet();
    const vocalsRow = screen.getByTestId("skill-row-s-vocals");
    expect(within(vocalsRow).queryByText("4 upcoming dates")).not.toBeInTheDocument();
    expect(within(vocalsRow).queryByText("Not required yet")).not.toBeInTheDocument();
  });

  it("read-only mode (canEdit false): rows render without remove buttons or add-chips", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderSheet();

    const vocalsRow = screen.getByTestId("skill-row-s-vocals");
    expect(within(vocalsRow).getByText("Vocals")).toBeInTheDocument();
    expect(within(vocalsRow).queryByLabelText("Remove Vocals")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Piano/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings, Casts & Cities" })).not.toBeInTheDocument();
  });
});
