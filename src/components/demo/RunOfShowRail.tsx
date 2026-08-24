import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Metric } from "@/components/ui/metric";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/features/auth/AuthContext";
import { useDemo } from "@/features/demo/DemoContext";
import { useResetDemo, useRunCue } from "@/hooks/useDemo";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { cueLabel, sceneSay, sceneTitle, type CueId } from "@/lib/demo/scenes";
import { cn } from "@/lib/utils";

/** The docked "run of show" rail (design option 1a, right dock): the rep's teleprompter
 *  for the season-handover script. Self-gates on `isDemoOrg && !isBarHidden && canOperate`,
 *  mirroring DemoBar (a non-admin member must not render the teleprompter + cue buttons,
 *  even though the RPCs are also blocked server-side). Header shows progress through the
 *  script; the scene list shows every beat with its time estimate; the active scene expands
 *  into its "Say:" line, one button per scripted cue, and a "Next scene" advance; the footer
 *  holds the prospect-label personalization and the small/full volume toggle. */
export function RunOfShowRail() {
  const { isDemoOrg, isBarHidden, scenes, currentScene, prospectLabel, volume, goToScene, setProspectLabel, setVolume, setRole } =
    useDemo();
  const { currentOrg, roles, isSuperAdmin } = useAuth();
  const canOperate = isSuperAdmin || roles.includes("admin");
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const resetMut = useResetDemo();
  // Cues are fired from the rail directly (rather than through DemoContext's fire-and-forget
  // runCue) so this surface can show which cue is in flight, which have succeeded, and which
  // failed. The mutation hook already busts the cache and toasts on error; the rail adds the
  // pending/success affordances a live demo needs so a click never looks like it did nothing.
  const cueMut = useRunCue();
  const [pendingCue, setPendingCue] = useState<CueId | null>(null);
  const [doneCues, setDoneCues] = useState<Set<CueId>>(new Set());
  const [failedCues, setFailedCues] = useState<Set<CueId>>(new Set());
  const [labelDraft, setLabelDraft] = useState(prospectLabel ?? "");
  // The volume toggle reseeds the demo (wipe + seed), so it's gated behind a confirm
  // dialog like DemoBar's Reset. `pendingVolume` holds the choice awaiting confirmation.
  const [pendingVolume, setPendingVolume] = useState<"small" | "full" | null>(null);
  // Bumped on every reseed. A cue in flight when the reseed lands captures the pre-reseed
  // value; when it later settles against a stale generation we skip its badge repaint, so a
  // cue can't paint done/failed over data the reseed just wiped.
  const reseedGen = useRef(0);

  // Keep the draft in sync when the underlying state changes from outside the input
  // (a fresh scene load, a Reset, or another tab writing demo_state).
  useEffect(() => {
    setLabelDraft(prospectLabel ?? "");
  }, [prospectLabel]);

  if (!isDemoOrg || isBarHidden || !canOperate) return null;

  const currentIndex = Math.max(
    scenes.findIndex((s) => s.id === currentScene.id),
    0,
  );
  const total = scenes.length;
  const next = scenes[currentIndex + 1];

  const handleNextScene = () => {
    if (!next) return;
    goToScene(next.id);
    setRole(next.persona);
    navigate(next.route);
  };

  // Drop a cue from a Set (no-op if absent, stable identity preserved otherwise).
  const removeCue = (setter: typeof setDoneCues, cueId: CueId) =>
    setter((prev) => {
      if (!prev.has(cueId)) return prev;
      const nextSet = new Set(prev);
      nextSet.delete(cueId);
      return nextSet;
    });

  const handleCue = (cueId: CueId) => {
    if (!currentOrg || pendingCue) return;
    setPendingCue(cueId);
    // Clear any prior done/failed mark for this cue so a re-run starts clean (a retry that
    // fails must not still read as done, and vice versa).
    removeCue(setDoneCues, cueId);
    removeCue(setFailedCues, cueId);
    // Snapshot the reseed generation: if a reseed lands before this cue settles, its badge is
    // for wiped data and must be dropped (see reseedGen).
    const gen = reseedGen.current;
    cueMut.mutate(
      { orgId: currentOrg.id, cueId },
      {
        // The rail owns both toasts (useRunCue no longer toasts) so they can be gen-guarded:
        // a cue that settles after a reseed wiped its data paints nothing and stays silent.
        onSuccess: () => {
          if (reseedGen.current !== gen) return;
          setDoneCues((prev) => new Set(prev).add(cueId));
          toast.success(`Cue done: ${cueLabel(cueId, lang)}`);
        },
        onError: (e: Error) => {
          if (reseedGen.current !== gen) return;
          setFailedCues((prev) => new Set(prev).add(cueId));
          toast.error(e.message);
        },
        // Gen-guard here too: a reseed already cleared pendingCue (and may have started a
        // fresh mutation for the same cue), so a stale settle must not null the newer
        // mutation's pending state by matching on cueId alone.
        onSettled: () => {
          if (reseedGen.current !== gen) return;
          setPendingCue((cur) => (cur === cueId ? null : cur));
        },
      },
    );
  };

  const commitLabel = () => {
    if (labelDraft !== (prospectLabel ?? "")) setProspectLabel(labelDraft);
  };

  // Switching volume must reseed at the CHOSEN volume, not whatever `volume` settles to
  // after the state refetch (which can lag the click) — so pass `v` explicitly to both
  // the persisted setting and the reseed mutation. Reseeding here keeps the rep's scene
  // position and prospect label (resetState defaults false) — it's a data-volume change,
  // not a new-prospect restart.
  const confirmVolumeChange = () => {
    if (!pendingVolume || !currentOrg) return setPendingVolume(null);
    setVolume(pendingVolume);
    resetMut.mutate({ orgId: currentOrg.id, volume: pendingVolume });
    // The reseed wipes the cues these marks refer to, so clear the inline done/failed state
    // instead of leaving stale checkmarks that no longer match the underlying data. Bump the
    // generation and clear pending too, so a cue that was in flight across the reseed neither
    // repaints its badge (guarded in handleCue) nor leaves the buttons stuck disabled.
    reseedGen.current += 1;
    setDoneCues(new Set());
    setFailedCues(new Set());
    setPendingCue(null);
    setPendingVolume(null);
  };

  return (
    <aside className="hidden w-[308px] shrink-0 flex-col border-l-[0.5px] border-border bg-background xl:flex">
      <div className="border-b-[0.5px] border-border px-4 py-3">
        <Eyebrow section>Run of show</Eyebrow>
        <p className="text-sm font-semibold text-foreground">Season handover</p>
        <div className="mt-2 flex items-center gap-2">
          <Progress value={((currentIndex + 1) / total) * 100} className="h-1.5" />
          <span className="shrink-0 text-eyebrow tabular-nums text-muted-foreground">
            {currentIndex + 1} / {total}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scenes.map((scene, i) => {
          const active = scene.id === currentScene.id;
          const done = i < currentIndex;
          return (
            <div key={scene.id} className={cn("border-b-[0.5px] border-border px-4 py-2.5", active && "bg-primary/10")}>
              <button
                type="button"
                onClick={() => goToScene(scene.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <Metric
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-eyebrow",
                    active ? "font-semibold text-primary" : "text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5 text-primary" aria-label="Scene done" />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </Metric>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-control", active ? "font-semibold text-foreground" : "text-foreground/80")}>
                    {sceneTitle(scene, lang)}
                  </span>
                </span>
                <span className="shrink-0 text-eyebrow text-muted-foreground">{scene.estMin}m</span>
              </button>

              {active && (
                <div className="mt-2 space-y-2 pl-6">
                  <p className="text-control leading-snug text-foreground/90">
                    <span className="font-semibold">Say: </span>
                    {sceneSay(scene, lang)}
                  </p>
                  {scene.cues.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {scene.cues.map((cueId) => {
                        const isPending = pendingCue === cueId;
                        const isDone = doneCues.has(cueId);
                        const isFailed = failedCues.has(cueId);
                        return (
                          <Button
                            key={cueId}
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pendingCue !== null}
                            aria-busy={isPending}
                            className={cn(
                              "h-6 gap-1 px-2 text-eyebrow",
                              isDone && "border-primary text-primary",
                              isFailed && "border-destructive text-destructive",
                            )}
                            onClick={() => handleCue(cueId)}
                          >
                            {isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : isDone ? (
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            ) : null}
                            {cueLabel(cueId, lang)}
                            {isFailed && !isPending ? <span className="sr-only"> (failed, click to retry)</span> : null}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <Button type="button" size="sm" className="h-7 text-xs" onClick={handleNextScene} disabled={!next}>
                    Next scene
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2.5 border-t-[0.5px] border-border px-4 py-3">
        <div className="space-y-1">
          {/* eslint-disable-next-line no-restricted-syntax -- form <label>, not a standard 11px/1.6px eyebrow (can't swap to the block <Eyebrow> primitive) */}
          <label htmlFor="demo-prospect-label" className="text-eyebrow font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            Prospect
          </label>
          <Input
            id="demo-prospect-label"
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            placeholder="Prospect org name"
            className="h-7 text-xs"
          />
        </div>
        <SegmentedControl
          value={volume}
          onChange={(v) => {
            if (v !== volume) setPendingVolume(v);
          }}
          options={[
            { value: "small", label: "Small" },
            { value: "full", label: "Full" },
          ]}
          disabled={resetMut.isPending}
        />
      </div>

      <AlertDialog open={pendingVolume !== null} onOpenChange={(open) => { if (!open) setPendingVolume(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch demo volume?</AlertDialogTitle>
            <AlertDialogDescription>
              This reseeds the demo data at the {pendingVolume === "small" ? "small" : "full"} volume. Bookings, cues, and contracts from this run are cleared. Your scene position and prospect stay. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmVolumeChange}>Switch and reseed</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
