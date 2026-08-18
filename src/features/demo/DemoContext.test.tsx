import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render, screen } from "@/test/renderWithProviders";
import { useDemo } from "@/features/demo/DemoContext";
import { SEASON_HANDOVER } from "@/lib/demo/scenes";
import type { DemoStateRow } from "@/data/demo";

// DemoContext (Phase 2) reads/writes demo_state via useDemoState/useUpdateDemoState
// (src/hooks/useDemo.ts), which bind the real supabase singleton. Mock those hooks
// (keeping useResetDemo mocked too, per the existing DemoBar.test.tsx pattern) so the
// provider's derived scene/mutation behavior is observable without a network dependency.
const updateMutate = vi.fn();
const resetMutate = vi.fn();
let demoStateRow: DemoStateRow | null = null;
let demoStateLoading = false;

vi.mock("@/hooks/useDemo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useDemo")>();
  return {
    ...actual,
    useResetDemo: () => ({ mutate: resetMutate, isPending: false }),
    useDemoState: () => ({ data: demoStateRow, isLoading: demoStateLoading }),
    useUpdateDemoState: () => ({ mutate: updateMutate, isPending: false }),
  };
});

const demoOrg = { id: "o1", name: "n", slug: "s", status: "active" as const, is_demo: true };

function Probe() {
  const { currentScene, simNow, prospectLabel, volume, goToScene, advanceClock, setProspectLabel, setVolume, reset } =
    useDemo();
  return (
    <div>
      <span data-testid="scene-id">{currentScene.id}</span>
      <span data-testid="sim-now">{simNow ?? "none"}</span>
      <span data-testid="prospect-label">{prospectLabel ?? "none"}</span>
      <span data-testid="volume">{volume}</span>
      <button onClick={() => goToScene("hire-order")}>go</button>
      <button onClick={() => advanceClock("10m")}>advance-10m</button>
      <button onClick={() => setProspectLabel("Acme Theatre")}>label</button>
      <button onClick={() => setVolume("small")}>volume-small</button>
      <button onClick={reset}>reset</button>
    </div>
  );
}

describe("DemoContext scene + sim-clock state", () => {
  beforeEach(() => {
    updateMutate.mockClear();
    resetMutate.mockClear();
    demoStateRow = null;
    demoStateLoading = false;
  });

  it("falls back to the first scene when current_scene_id is null", () => {
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    expect(screen.getByTestId("scene-id")).toHaveTextContent(SEASON_HANDOVER[0].id);
  });

  it("resolves currentScene from demo_state.current_scene_id", () => {
    demoStateRow = {
      org_id: "o1",
      volume: "full",
      prospect_label: "Acme Theatre",
      sim_now: "2026-08-17T10:00:00.000Z",
      current_scene_id: "hire-order",
      script_id: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    expect(screen.getByTestId("scene-id")).toHaveTextContent("hire-order");
    expect(screen.getByTestId("sim-now")).toHaveTextContent("2026-08-17T10:00:00.000Z");
    expect(screen.getByTestId("prospect-label")).toHaveTextContent("Acme Theatre");
  });

  it("defaults volume to full when demo_state has no row", () => {
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    expect(screen.getByTestId("volume")).toHaveTextContent("full");
  });

  it("goToScene calls useUpdateDemoState's mutate with the new current_scene_id", () => {
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    fireEvent.click(screen.getByText("go"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { current_scene_id: "hire-order" } });
  });

  it("advanceClock('10m') computes sim_now + 10 minutes from the current sim clock", () => {
    demoStateRow = {
      org_id: "o1",
      volume: "full",
      prospect_label: null,
      sim_now: "2026-08-17T10:00:00.000Z",
      current_scene_id: null,
      script_id: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    fireEvent.click(screen.getByText("advance-10m"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { sim_now: "2026-08-17T10:10:00.000Z" } });
  });

  it("setProspectLabel and setVolume update demo_state via useUpdateDemoState", () => {
    render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    fireEvent.click(screen.getByText("label"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { prospect_label: "Acme Theatre" } });
    fireEvent.click(screen.getByText("volume-small"));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { volume: "small" } });
  });

  it("reset() no-ops while demo_state is still loading, then fires once loaded", () => {
    // Guard against reseeding a "small" org at the "full" fallback mid-load. The Reset
    // button is a new-prospect restart, so once loaded it also clears scene/clock/label.
    demoStateLoading = true;
    demoStateRow = {
      org_id: "o1",
      volume: "small",
      prospect_label: null,
      sim_now: null,
      current_scene_id: null,
      script_id: null,
      updated_at: "2026-08-17T00:00:00.000Z",
    };
    const { rerender } = render(<Probe />, { authOverrides: { currentOrg: demoOrg } });
    fireEvent.click(screen.getByText("reset"));
    expect(resetMutate).not.toHaveBeenCalled();

    demoStateLoading = false;
    rerender(<Probe />);
    fireEvent.click(screen.getByText("reset"));
    expect(resetMutate).toHaveBeenCalledWith(
      { orgId: "o1", volume: "small", resetState: true },
      expect.any(Object),
    );
  });

  it("mutations no-op without a current org", () => {
    render(<Probe />, { authOverrides: { currentOrg: null } });
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByText("advance-10m"));
    expect(updateMutate).not.toHaveBeenCalled();
  });
});
