import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";

// The supabase singleton is never touched: every read/write this panel makes goes
// through the data layer, and that whole module is faked below. Same shape as
// SkillsStep.test.tsx.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/data/skills", async (orig) => ({
  ...(await orig<typeof import("@/data/skills")>()),
  fetchSkills: vi.fn(),
  fetchSkillEligibilityGaps: vi.fn(),
  setArtistSkills: vi.fn(),
}));

vi.mock("@/data/artists", async (orig) => ({
  ...(await orig<typeof import("@/data/artists")>()),
  fetchActiveArtistOptions: vi.fn(),
}));

import { fetchSkills, fetchSkillEligibilityGaps, setArtistSkills, type SkillGap } from "@/data/skills";
import { fetchActiveArtistOptions } from "@/data/artists";
import { ArtistSkillAssignList } from "@/components/getRunning/v3/steps/ArtistSkillAssignList";

const ORG = { id: "org-1", name: "Aurora", slug: "aurora", status: "active" as const, is_demo: false };

function seedGaps(gaps: SkillGap[]) {
  vi.mocked(fetchSkillEligibilityGaps).mockResolvedValue(gaps);
}
function seedArtists(artists: { id: string; name: string; skillIds?: string[] }[]) {
  vi.mocked(fetchActiveArtistOptions).mockResolvedValue(
    artists.map((a) => ({ id: a.id, name: a.name, skillIds: a.skillIds ?? [] })),
  );
}
function seedCatalog(skills: { id: string; name: string }[]) {
  vi.mocked(fetchSkills).mockResolvedValue(skills);
}

function renderList(canEdit = true) {
  return renderWithProviders(
    <MemoryRouter>
      <ArtistSkillAssignList orgId="org-1" canEdit={canEdit} />
    </MemoryRouter>,
    { authOverrides: { currentOrg: ORG } },
  );
}

describe("ArtistSkillAssignList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedGaps([]);
    seedArtists([]);
    seedCatalog([]);
    vi.mocked(setArtistSkills).mockResolvedValue(undefined);
  });

  it("names the skills a part requires that nobody holds, and the production requiring them", async () => {
    seedGaps([{ skillId: "sk-1", name: "Lead Vocals", productions: ["Winter Gala"] }]);
    renderList();

    expect(await screen.findByText(/lead vocals/i)).toBeInTheDocument();
    expect(screen.getByText(/winter gala/i)).toBeInTheDocument();
  });

  it("assigns a skill to an artist from inside the step", async () => {
    seedGaps([{ skillId: "sk-1", name: "Lead Vocals", productions: ["Winter Gala"] }]);
    seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
    seedCatalog([{ id: "sk-1", name: "Lead Vocals" }]);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: /lead vocals/i }));
    await waitFor(() =>
      expect(setArtistSkills).toHaveBeenCalledWith(expect.anything(), {
        artistId: "a1",
        orgId: "org-1",
        add: ["sk-1"],
        remove: [],
      }),
    );
  });

  it("removes a skill the artist already holds", async () => {
    seedArtists([{ id: "a1", name: "Mara Lindqvist", skillIds: ["sk-1"] }]);
    seedCatalog([{ id: "sk-1", name: "Lead Vocals" }]);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: /lead vocals/i }));
    await waitFor(() =>
      expect(setArtistSkills).toHaveBeenCalledWith(expect.anything(), {
        artistId: "a1",
        orgId: "org-1",
        add: [],
        remove: ["sk-1"],
      }),
    );
  });

  it("fails closed when the artist read fails: an error, never an empty roster", async () => {
    vi.mocked(fetchActiveArtistOptions).mockRejectedValue(new Error("boom"));
    renderList();

    expect(await screen.findByText(/could not load your artists/i)).toBeInTheDocument();
    expect(screen.queryByText(/every artist is set up/i)).toBeNull();
  });

  it("fails closed when the gap read fails: an error, never a silent all-clear", async () => {
    vi.mocked(fetchSkillEligibilityGaps).mockRejectedValue(new Error("boom"));
    seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
    renderList();

    expect(await screen.findByText(/could not check which skills/i)).toBeInTheDocument();
  });

  it("fails closed when the skill catalog read fails: an error, never 'no skills in the catalog yet'", async () => {
    // Without this branch every row's SkillPicker takes its own empty-catalog path and
    // prints "No skills in the catalog yet", which on an errored read is a lie that sends
    // the admin to add skills that already exist.
    vi.mocked(fetchSkills).mockRejectedValue(new Error("boom"));
    seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
    renderList();

    expect(await screen.findByText(/could not load your skill catalog/i)).toBeInTheDocument();
    expect(screen.queryByText(/no skills in the catalog yet/i)).toBeNull();
  });

  it("stays bounded at the product's 200+ artist scale, and filters by name", async () => {
    seedArtists(Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, name: `Artist ${i}` })));
    seedCatalog([{ id: "sk-1", name: "Lead Vocals" }]);
    renderList();

    // 200 rows of chips inside a wizard step is not a usable surface: render a bounded
    // page until the viewer asks for the rest.
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(25));
    expect(screen.getByRole("button", { name: /show all 200 artists/i })).toBeInTheDocument();

    // A name filter reaches an artist far outside that first page.
    fireEvent.change(screen.getByRole("textbox", { name: /search artists by name/i }), {
      target: { value: "Artist 187" },
    });
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(1));
    expect(screen.getByText("Artist 187")).toBeInTheDocument();
  });

  it("shows the whole roster once the viewer asks for it", async () => {
    seedArtists(Array.from({ length: 40 }, (_, i) => ({ id: `a${i}`, name: `Artist ${i}` })));
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: /show all 40 artists/i }));
    await waitFor(() => expect(screen.getAllByRole("listitem").length).toBe(40));
  });

  it("disables the pickers for a viewer who cannot manage skills", async () => {
    seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
    seedCatalog([{ id: "sk-1", name: "Lead Vocals" }]);
    renderList(false);

    const chip = await screen.findByRole("button", { name: /lead vocals/i });
    expect(chip).toBeDisabled();
  });
});
