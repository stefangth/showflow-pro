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

  it("disables the pickers for a viewer who cannot manage skills", async () => {
    seedArtists([{ id: "a1", name: "Mara Lindqvist" }]);
    seedCatalog([{ id: "sk-1", name: "Lead Vocals" }]);
    renderList(false);

    const chip = await screen.findByRole("button", { name: /lead vocals/i });
    expect(chip).toBeDisabled();
  });
});
