import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// TeamPanelBody (mounted for the "team" step below) calls the REAL useOrgMembers +
// useInvitationMutations hooks, which read the shared supabase singleton — same fake-client
// pattern as src/components/getRunning/panels/TeamPanelBody.test.tsx, so this test never
// makes a real network call. No seeds are needed: the assertions below don't depend on the
// roster resolving, only on the form's own static markup.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({}));

import { StepBodyV3 } from "./stepRegistryV3";
import type { GetRunningStep } from "@/lib/getRunning/steps";

const mk = (key: GetRunningStep["key"], placeholder: boolean): GetRunningStep => ({
  key,
  phase: "bookable",
  done: false,
  block: null,
  adminOnly: false,
  actionableByViewer: true,
  placeholder,
});

function renderStep(step: GetRunningStep, onDone = vi.fn()) {
  return renderWithProviders(
    <MemoryRouter>
      <StepBodyV3 step={step} orgId="org-1" onDone={onDone} />
    </MemoryRouter>,
    // Some reused bodies (LadderPanelBody/EligibilityPanelBody/PeoplePanelBody's useCan)
    // call useAuth() directly, which throws outside an AuthContext.Provider. `{}` mounts
    // the test-only provider with permissive defaults (admin, no active org, so any
    // org-scoped query the auth-derived orgId would gate stays disabled) without needing
    // real data for assertions that don't depend on a query resolving.
    { authOverrides: {} },
  );
}

describe("StepBodyV3", () => {
  beforeEach(() => {
    (client.calls as unknown[] | undefined)?.splice(0);
  });

  it("renders StepComingSoon for a placeholder step with a deep-link", () => {
    renderStep(mk("skills", true));
    expect(screen.getByText(/coming|more on the way/i)).toBeInTheDocument();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("renders StepComingSoon for every placeholder step key", () => {
    const placeholderKeys: GetRunningStep["key"][] = ["fee", "document"];
    for (const key of placeholderKeys) {
      const { unmount } = renderStep(mk(key, true));
      expect(screen.getByText(/more on the way/i)).toBeInTheDocument();
      unmount();
    }
  });

  it("renders the real body for each get-dates step key, not StepComingSoon", () => {
    // Each of these five keys ships a real in-panel editor (Wireflow v3 Phase 2, Tasks
    // 6-9/11); assert a heading unique to that body renders, and that the deep-link
    // fallback copy does not.
    const cases: [GetRunningStep["key"], RegExp][] = [
      ["source", /where do your dates come from/i],
      ["connect", /connect airtable/i],
      ["map", /map your fields/i],
      ["cities", /set a city on every date/i],
      ["productions", /your productions/i],
    ];
    for (const [key, heading] of cases) {
      const { unmount } = renderStep(mk(key, false));
      expect(screen.getByText(heading)).toBeInTheDocument();
      expect(screen.queryByText(/more on the way/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("routes skills/fee/document to their real bodies, not StepComingSoon", () => {
    // Task 6 (Phase 3): these three used to fall through to StepComingSoon via the
    // explicit case block; now each has a real in-panel editor (SkillsStep/FeeStep/
    // DocumentStep) reusing a Settings card, keyed to a heading unique to that body.
    const cases: [GetRunningStep["key"], RegExp][] = [
      ["skills", /skills for your parts/i],
      ["fee", /your default fee/i],
      ["document", /your contract document/i],
    ];
    for (const [key, heading] of cases) {
      const { unmount } = renderStep(mk(key, false));
      expect(screen.getByText(heading)).toBeInTheDocument();
      expect(screen.queryByText(/more on the way/i)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("renders the real team body for the team step", () => {
    renderStep(mk("team", false));
    // TeamPanelBody owns this label + button; a stable element it (not a placeholder) renders.
    expect(screen.getByLabelText(/invite by email/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invite/i })).toBeInTheDocument();
  });

  it("renders both LadderPanelBody and EligibilityPanelBody for the merged coverage step", () => {
    renderStep(mk("coverage", false));
    // Each body owns a distinct label from its own copy set — assert both render.
    expect(screen.getByText(/cities with dates/i)).toBeInTheDocument();
    expect(screen.getByText(/coverage by production/i)).toBeInTheDocument();
  });

  it("throws for an unregistered step key (exhaustiveness guard)", () => {
    const badStep = { ...mk("team", false), key: "not-a-real-key" } as unknown as GetRunningStep;
    expect(() => renderStep(badStep)).toThrow();
  });
});
