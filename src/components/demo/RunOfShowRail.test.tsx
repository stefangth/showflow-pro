import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@/test/renderWithProviders";
import { RunOfShowRail } from "@/components/demo/RunOfShowRail";
import type { DemoStateRow } from "@/data/demo";
import type { AuthContextType } from "@/features/auth/AuthContext";

// RunOfShowRail (like DemoBar) reads demo_state through DemoContext, which binds the real
// useDemoState/useUpdateDemoState/useRunCue/useResetDemo hooks (src/hooks/useDemo.ts) to the
// real supabase singleton. Mock those four so DemoContext's derived scene/cue/mutation logic
// runs for real while the network calls are stubbed — same pattern as DemoBar.test.tsx and
// DemoContext.test.tsx.
const updateMutate = vi.fn();
const runCueMutate = vi.fn();
const resetMutate = vi.fn();
let demoStateRow: DemoStateRow | null;

vi.mock("@/hooks/useDemo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDemo")>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: resetMutate, isPending: false }),
    useDemoState: () => ({ data: demoStateRow, isLoading: false }),
    useUpdateDemoState: () => ({ mutate: updateMutate, isPending: false }),
    useRunCue: () => ({ mutate: runCueMutate, isPending: false }),
  };
});

const DEMO_ORG = { id: "o1", name: "n", slug: "s", status: "active" as const, is_demo: true };

function renderRail(currentOrg: AuthContextType["currentOrg"] = DEMO_ORG) {
  return render(
    <MemoryRouter>
      <RunOfShowRail />
    </MemoryRouter>,
    { authOverrides: { currentOrg } },
  );
}

describe("RunOfShowRail", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    runCueMutate.mockClear();
    resetMutate.mockClear();
    // Scene 03 ("holds-expire"): three cues, next scene is "artists-side".
    demoStateRow = {
      org_id: "o1",
      volume: "full",
      prospect_label: null,
      sim_now: null,
      current_scene_id: "holds-expire",
      script_id: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
  });

  it("renders nothing outside a demo org", () => {
    const { container } = renderRail({ ...DEMO_ORG, is_demo: false });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no active org", () => {
    const { container } = renderRail(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active scene's Say talk track", () => {
    renderRail();
    expect(screen.getByText(/Watch one artist accept, the clock run out/i)).toBeInTheDocument();
  });

  it("shows the progress counter", () => {
    renderRail();
    expect(screen.getByText("3 / 7")).toBeInTheDocument();
  });

  it("renders one button per cue on the active scene", () => {
    renderRail();
    expect(screen.getByText("Artist accepts")).toBeInTheDocument();
    expect(screen.getByText("Run clock to 17:00")).toBeInTheDocument();
    expect(screen.getByText("Drop notifications")).toBeInTheDocument();
  });

  it("clicking a cue button calls runCue(cueId)", () => {
    renderRail();
    fireEvent.click(screen.getByText("Artist accepts"));
    expect(runCueMutate).toHaveBeenCalledWith({ orgId: "o1", cueId: "artist_accepts_offer" });
  });

  it("clicking Next scene calls goToScene with the next scene id", () => {
    renderRail();
    fireEvent.click(screen.getByText("Next scene"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { current_scene_id: "artists-side" } });
  });

  it("prospect-label input change on blur calls setProspectLabel", () => {
    renderRail();
    const input = screen.getByPlaceholderText(/prospect/i);
    fireEvent.change(input, { target: { value: "Acme Theatre" } });
    fireEvent.blur(input);
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { prospect_label: "Acme Theatre" } });
  });

  it("switching volume reseeds at the chosen volume", () => {
    renderRail();
    fireEvent.click(screen.getByText("Small"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { volume: "small" } });
    expect(resetMutate).toHaveBeenCalledWith({ orgId: "o1", volume: "small" });
  });

  it("disables Next scene on the final scene", () => {
    demoStateRow = {
      org_id: "o1",
      volume: "full",
      prospect_label: null,
      sim_now: null,
      current_scene_id: "leave-sandbox",
      script_id: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    renderRail();
    expect(screen.getByText("Next scene").closest("button")).toBeDisabled();
  });
});
