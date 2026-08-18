import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/AuthContext";
import type { AppRole } from "@/config/app.config";
import { isDemoOrg } from "@/features/demo/demoAccess";
import { useDemoState, useResetDemo, useUpdateDemoState } from "@/hooks/useDemo";
import { SEASON_HANDOVER, type Scene } from "@/lib/demo/scenes";

/** Millisecond deltas for the narrative "advance the sim clock" cue. This is a
 *  client-side display convenience only — there is no server clock backing it. */
const CLOCK_STEP_MS: Record<"10m" | "1d", number> = {
  "10m": 10 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
};

/** Persist the "demo bar hidden" flag so hide/show survives a page reload —
 *  mirroring how EditorContext persists its editor-mode flag. Keyed PER ORG so hiding
 *  the bar in one demo org doesn't hide it in another. Guarded so SSR or a
 *  storage-blocked browser degrades to the default (bar shown) rather than throwing. */
const DEMO_BAR_HIDDEN_KEY_PREFIX = "showflow_demo_bar_hidden";

function barHiddenKey(orgId: string | null | undefined): string {
  return `${DEMO_BAR_HIDDEN_KEY_PREFIX}:${orgId ?? ""}`;
}

function readBarHidden(orgId: string | null | undefined): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(barHiddenKey(orgId)) === "true";
  } catch {
    return false;
  }
}

function writeBarHidden(orgId: string | null | undefined, hidden: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (hidden) window.localStorage.setItem(barHiddenKey(orgId), "true");
    else window.localStorage.removeItem(barHiddenKey(orgId));
  } catch {
    // Storage unavailable (private mode, quota) — the in-memory flag still works
    // for this session; only cross-reload persistence is lost.
  }
}

interface DemoContextType {
  isDemoOrg: boolean;
  isBarHidden: boolean;
  hideBar: () => void;
  showBar: () => void;
  /** The season-handover run-of-show, in order. */
  scenes: Scene[];
  /** The scene the demo_state row points at, falling back to the first scene. */
  currentScene: Scene;
  /** The simulated "now" the rep has walked the clock to, or null if untouched. */
  simNow: string | null;
  /** The prospect's org name, as typed into the rail for this run. */
  prospectLabel: string | null;
  volume: "small" | "full";
  goToScene: (id: string) => void;
  advanceClock: (step: "10m" | "1d") => void;
  setProspectLabel: (label: string) => void;
  setVolume: (v: "small" | "full") => void;
  setRole: (role: AppRole | null) => void;
  reset: () => void;
  isResetting: boolean;
  /** True while a sim-clock advance is in flight — guards the +10m/+1d buttons
   *  against rapid clicks sending the same target timestamp (stale-closure race). */
  isAdvancing: boolean;
}

const DemoContext = createContext<DemoContextType | undefined>(undefined);

export function DemoProvider({ children }: { children: ReactNode }) {
  const { currentOrg, setViewAsRole } = useAuth();
  const demo = isDemoOrg(currentOrg);
  const orgId = currentOrg?.id ?? null;
  // Lazy-init from this org's localStorage flag so a hidden bar stays hidden across
  // reloads. Unlike EditorContext's mode flag, this is not access-gated, so the
  // initializer is safe: there is no "identity not yet loaded" first render to miss.
  const [isBarHidden, setBarHidden] = useState<boolean>(() => readBarHidden(orgId));
  // Re-read the per-org flag when the active org changes, so a bar hidden in org A does
  // not carry its hidden state into org B (each org keeps its own flag).
  useEffect(() => {
    setBarHidden(readBarHidden(orgId));
  }, [orgId]);
  const resetMut = useResetDemo();
  const updateDemoState = useUpdateDemoState();
  // Only demo orgs carry a demo_state row — gate the read so switching to (or
  // starting on) a non-demo org never fires a demo_state query for it.
  const { data: demoState, isLoading: demoStateLoading } = useDemoState(demo ? currentOrg?.id ?? null : null);

  const volume: "small" | "full" = demoState?.volume ?? "full";
  const simNow = demoState?.sim_now ?? null;
  const prospectLabel = demoState?.prospect_label ?? null;
  const currentScene = useMemo(
    () => SEASON_HANDOVER.find((s) => s.id === demoState?.current_scene_id) ?? SEASON_HANDOVER[0],
    [demoState?.current_scene_id],
  );

  const reset = useCallback(() => {
    // Don't reset until demo_state has loaded: `volume` falls back to "full" while
    // the query is in flight, so a reset fired mid-load would reseed a "small" org
    // at "full". Once loaded, `volume` reflects the stored value.
    if (!currentOrg || demoStateLoading) return;
    // The Reset button restarts the walkthrough for a fresh prospect, so it also
    // clears the rep's scene position, sim clock, and prospect label (resetState:
    // true) — unlike the rail's volume toggle, which reseeds data but keeps place.
    resetMut.mutate(
      { orgId: currentOrg.id, volume, resetState: true },
      { onSuccess: () => toast.success("Demo reset"), onError: (e: Error) => toast.error(e.message) },
    );
  }, [currentOrg, resetMut, volume, demoStateLoading]);

  const goToScene = useCallback(
    (id: string) => {
      if (!currentOrg) return;
      updateDemoState.mutate({ orgId: currentOrg.id, patch: { current_scene_id: id } });
    },
    [currentOrg, updateDemoState],
  );

  const advanceClock = useCallback(
    (step: "10m" | "1d") => {
      if (!currentOrg) return;
      const base = simNow ? new Date(simNow) : new Date();
      const next = new Date(base.getTime() + CLOCK_STEP_MS[step]);
      updateDemoState.mutate({ orgId: currentOrg.id, patch: { sim_now: next.toISOString() } });
    },
    [currentOrg, simNow, updateDemoState],
  );

  const setProspectLabel = useCallback(
    (label: string) => {
      if (!currentOrg) return;
      updateDemoState.mutate({ orgId: currentOrg.id, patch: { prospect_label: label } });
    },
    [currentOrg, updateDemoState],
  );

  const setVolume = useCallback(
    (v: "small" | "full") => {
      if (!currentOrg) return;
      updateDemoState.mutate({ orgId: currentOrg.id, patch: { volume: v } });
    },
    [currentOrg, updateDemoState],
  );

  const setRole = useCallback((role: AppRole | null) => setViewAsRole(role), [setViewAsRole]);

  const value: DemoContextType = {
    isDemoOrg: demo,
    isBarHidden,
    hideBar: useCallback(() => {
      setBarHidden(true);
      writeBarHidden(orgId, true);
    }, [orgId]),
    showBar: useCallback(() => {
      setBarHidden(false);
      writeBarHidden(orgId, false);
    }, [orgId]),
    scenes: SEASON_HANDOVER,
    currentScene,
    simNow,
    prospectLabel,
    volume,
    goToScene,
    advanceClock,
    setProspectLabel,
    setVolume,
    setRole,
    reset,
    isResetting: resetMut.isPending,
    isAdvancing: updateDemoState.isPending,
  };
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used within DemoProvider");
  return ctx;
}
