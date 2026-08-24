import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per SourceStep.test.tsx. SkillsStep mounts the real
// SkillsTab, which reads via useSkillCatalog/useSkills (AuthContext currentOrg).
// The default renderWithProviders AuthContext has `currentOrg: null`, so those
// queries stay disabled and never touch the supabase singleton — no seeding needed.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same
// pattern as SourceStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { SkillsStep } from "@/components/getRunning/v3/steps/SkillsStep";

function renderStep(onDone = vi.fn()) {
  // authOverrides opts renderWithProviders into mounting a real AuthContext.Provider
  // (default currentOrg: null), which SkillsStep's real SkillsTab needs (useAuth()) —
  // and keeps useSkillCatalog/useSkills disabled (no currentOrg), so they never touch
  // the supabase singleton.
  const result = renderWithProviders(<SkillsStep orgId="org-1" onDone={onDone} />, { authOverrides: {} });
  return { ...result, onDone };
}

describe("SkillsStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("renders the continue action and calls onDone when a capable viewer clicks it", async () => {
    const { onDone } = renderStep();

    // The step title moved to WizardShell; this is the body's own section heading.
    expect(screen.getByText(/set skills on your artists/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("shows a read-only note instead of continue when the viewer cannot edit", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderStep();

    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/manage skills or the edit artists right/i)).toBeInTheDocument();
  });

  it("gates on manage_skills, not edit_booking_settings", async () => {
    // The default producer has manage_skills but not edit_booking_settings, and the
    // embedded SkillsTab enforces manage_skills. Gating this step on edit_booking_settings
    // would hide Continue and show a false read-only note for a user who can freely edit.
    vi.mocked(useCan).mockImplementation((action) => action === "manage_skills");
    const { onDone } = renderStep();

    expect(screen.queryByText(/manage skills or the edit artists right/i)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  /**
   * The assign list writes `artist_skills`, which `ArtistProfileSheet` gates on
   * `edit_artists`. It used to be gated here on `manage_skills` (which defaults ON for
   * producers), so an org that had switched `edit_artists` off for producers still let one
   * rewrite every artist's skills through this step.
   */
  it("asks for edit_artists, the capability the artist_skills write actually needs", () => {
    vi.mocked(useCan).mockImplementation((action) => action === "manage_skills");
    renderStep();

    expect(screen.getByText(/set skills on your artists/i)).toBeInTheDocument();
    // Before the fix this step only ever read manage_skills, so a producer in an org that
    // had turned edit_artists off could still rewrite artists' skills from here.
    expect(vi.mocked(useCan).mock.calls.map((c) => c[0])).toContain("edit_artists");
  });

  it("keeps continue for a viewer who holds only edit_artists", async () => {
    vi.mocked(useCan).mockImplementation((action) => action === "edit_artists");
    const { onDone } = renderStep();

    expect(screen.queryByText(/manage skills or the edit artists right/i)).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });
});
