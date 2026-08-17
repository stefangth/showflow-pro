import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/features/auth/AuthContext";
import { useDemo } from "@/features/demo/DemoContext";
import { useResetDemo } from "@/hooks/useDemo";
import { useLanguage } from "@/features/i18n/LanguageContext";
import { cueLabel, sceneSay, sceneTitle } from "@/lib/demo/scenes";
import { cn } from "@/lib/utils";

/** The docked "run of show" rail (design option 1a, right dock): the rep's teleprompter
 *  for the season-handover script. Self-gates on `isDemoOrg && !isBarHidden && canOperate`,
 *  mirroring DemoBar (a non-admin member must not render the teleprompter + cue buttons,
 *  even though the RPCs are also blocked server-side). Header shows progress through the
 *  script; the scene list shows every beat with its time estimate; the active scene expands
 *  into its "Say:" line, one button per scripted cue, and a "Next scene" advance; the footer
 *  holds the prospect-label personalization and the small/full volume toggle. */
export function RunOfShowRail() {
  const { isDemoOrg, isBarHidden, scenes, currentScene, prospectLabel, volume, goToScene, runCue, setProspectLabel, setVolume, setRole } =
    useDemo();
  const { currentOrg, roles, isSuperAdmin } = useAuth();
  const canOperate = isSuperAdmin || roles.includes("admin");
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const resetMut = useResetDemo();
  const [labelDraft, setLabelDraft] = useState(prospectLabel ?? "");
  // The volume toggle reseeds the demo (wipe + seed), so it's gated behind a confirm
  // dialog like DemoBar's Reset. `pendingVolume` holds the choice awaiting confirmation.
  const [pendingVolume, setPendingVolume] = useState<"small" | "full" | null>(null);

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
    setPendingVolume(null);
  };

  return (
    <aside className="hidden w-[308px] shrink-0 flex-col border-l-[0.5px] border-border bg-background xl:flex">
      <div className="border-b-[0.5px] border-border px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Run of show</p>
        <p className="text-sm font-semibold text-foreground">Season handover</p>
        <div className="mt-2 flex items-center gap-2">
          <Progress value={((currentIndex + 1) / total) * 100} className="h-1.5" />
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {currentIndex + 1} / {total}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {scenes.map((scene, i) => {
          const active = scene.id === currentScene.id;
          return (
            <div key={scene.id} className={cn("border-b-[0.5px] border-border px-4 py-2.5", active && "bg-accent-50")}>
              <button
                type="button"
                onClick={() => goToScene(scene.id)}
                className="flex w-full items-start gap-2 text-left"
              >
                <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px]", active ? "font-semibold text-foreground" : "text-foreground/80")}>
                    {sceneTitle(scene, lang)}
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{scene.estMin}m</span>
              </button>

              {active && (
                <div className="mt-2 space-y-2 pl-6">
                  <p className="text-[12.5px] leading-snug text-foreground/90">
                    <span className="font-semibold">Say: </span>
                    {sceneSay(scene, lang)}
                  </p>
                  {scene.cues.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {scene.cues.map((cueId) => (
                        <Button
                          key={cueId}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => runCue(cueId)}
                        >
                          {cueLabel(cueId, lang)}
                        </Button>
                      ))}
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
          <label htmlFor="demo-prospect-label" className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
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
        <div role="group" aria-label="Volume" className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {(["small", "full"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={volume === v}
              disabled={resetMut.isPending}
              onClick={() => {
                if (v !== volume) setPendingVolume(v);
              }}
              className={cn(
                "h-6 rounded-md px-2.5 text-xs font-medium disabled:opacity-50",
                volume === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {v === "small" ? "Small" : "Full"}
            </button>
          ))}
        </div>
      </div>

      <AlertDialog open={pendingVolume !== null} onOpenChange={(open) => { if (!open) setPendingVolume(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch demo volume?</AlertDialogTitle>
            <AlertDialogDescription>
              This reseeds the demo data at the {pendingVolume === "small" ? "small" : "full"} volume. Bookings, cues, and hire orders from this run are cleared. Your scene position and prospect stay. This cannot be undone.
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
