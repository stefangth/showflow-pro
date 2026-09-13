import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { render, screen } from "@/test/renderWithProviders";
import { RunOfShowRail } from "@/components/demo/RunOfShowRail";
import type { DemoStateRow } from "@/data/demo";
import type { AuthContextType } from "@/features/auth/AuthContext";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

const DEMO_ORG = { id: "o1", name: "n", slug: "s", status: "active" as const, is_demo: true, org_kind: "production" as const, org_kind_set_at: null };

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
    runCueMutate.mockReset();
    resetMutate.mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
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
    const { container } = renderRail({ ...DEMO_ORG, is_demo: false, org_kind: "production" as const, org_kind_set_at: null });
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
    expect(runCueMutate).toHaveBeenCalledWith(
      { orgId: "o1", cueId: "artist_accepts_offer" },
      expect.any(Object),
    );
  });

  it("shows a pending state and disables the cue buttons while a cue is in flight", () => {
    // The mock's mutate never settles (no onSettled call), so pendingCue stays set:
    // the clicked cue reports aria-busy and every cue button is disabled meanwhile.
    renderRail();
    const clicked = screen.getByRole("button", { name: /Artist accepts/i });
    fireEvent.click(clicked);
    expect(clicked).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /Drop notifications/i })).toBeDisabled();
  });

  it("surfaces a success toast and marks the cue done when the cue resolves", () => {
    // Drive the mutation's onSuccess so the rail's success affordance runs.
    runCueMutate.mockImplementation((_args, opts) => opts?.onSuccess?.());
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: /Artist accepts/i }));
    expect(toast.success).toHaveBeenCalledWith("Cue done: Artist accepts");
  });

  it("marks the cue failed (retryable) and toasts the error when it rejects", () => {
    // Drive onError + onSettled: the rail records the inline failed state, clears pending,
    // and owns the error toast (useRunCue no longer toasts), so it fires exactly once here.
    runCueMutate.mockImplementation((_args, opts) => {
      opts?.onError?.(new Error("boom"));
      opts?.onSettled?.();
    });
    renderRail();
    const btn = screen.getByRole("button", { name: /Artist accepts/i });
    fireEvent.click(btn);
    expect(toast.error).toHaveBeenCalledWith("boom");
    // Inline failed affordance: destructive styling + sr-only retry hint; pending cleared so
    // the button is enabled and clickable again.
    expect(btn).toHaveClass("border-destructive");
    expect(btn).toHaveAttribute("aria-busy", "false");
    expect(btn).not.toBeDisabled();
    expect(within(btn).getByText(/click to retry/i)).toBeInTheDocument();

    // Retrying clears the failed mark and re-invokes the mutation.
    runCueMutate.mockImplementation(() => {}); // second attempt stays pending
    fireEvent.click(btn);
    expect(runCueMutate).toHaveBeenCalledTimes(2);
    expect(btn).not.toHaveClass("border-destructive");
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

  it("switching volume asks to confirm, then reseeds at the chosen volume", () => {
    renderRail();
    // The volume toggle wipes+reseeds, so it opens a confirmation first: nothing fires yet.
    fireEvent.click(screen.getByText("Small"));
    expect(updateMutate).not.toHaveBeenCalled();
    expect(resetMutate).not.toHaveBeenCalled();

    // Confirming reseeds at the chosen volume; resetState is omitted so the rep keeps place.
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /switch and reseed/i }));
    expect(updateMutate).toHaveBeenCalledWith({ orgId: "o1", patch: { volume: "small" } });
    expect(resetMutate).toHaveBeenCalledWith({ orgId: "o1", volume: "small" });
  });

  it("renders nothing for a non-admin member of a demo org", () => {
    // Mirrors DemoBar: the rail exposes cue/reset controls, so a non-admin member
    // (whose role switcher would flip effectiveHasRole client-side) must not see it.
    const { container } = render(
      <MemoryRouter>
        <RunOfShowRail />
      </MemoryRouter>,
      { authOverrides: { roles: ["producer"], currentOrg: DEMO_ORG } },
    );
    expect(container).toBeEmptyDOMElement();
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
