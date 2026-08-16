import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/features/auth/AuthContext";
import { useDemo } from "@/features/demo/DemoContext";
import { useResetDemo } from "@/hooks/useDemo";
import { useLanguage } from "@/features/i18n/LanguageContext";
import type { Lang } from "@/i18n/config";
import type { CueId, Scene } from "@/lib/demo/scenes";
import { cn } from "@/lib/utils";

/** Short, readable English labels for the demo cue catalog (`CueId`). Bar chrome stays
 *  English per existing convention (see DemoBar/SceneSelect) — no translation here. */
const CUE_LABELS: Record<CueId, string> = {
  run_clock_to_1700: "Run clock to 17:00",
  artist_accepts_offer: "Artist accepts",
  drop_notifications: "Drop notifications",
  fill_date: "Fill the date",
  issue_hire_order: "Issue hire order",
  advance_clock: "Advance a day",
};

function sceneTitle(scene: Scene, lang: Lang): string {
  return scene.title[lang] ?? scene.title.en;
}

function sceneSay(scene: Scene, lang: Lang): string {
  return scene.say[lang] ?? scene.say.en;
}

/** The docked "run of show" rail (design option 1a, right dock): the rep's teleprompter
 *  for the season-handover script. Self-gates on `isDemoOrg && !isBarHidden`, mirroring
 *  DemoBar/DemoBadge. Header shows progress through the script; the scene list shows
 *  every beat with its time estimate; the active scene expands into its "Say:" line, one
 *  button per scripted cue, and a "Next scene" advance; the footer holds the
 *  prospect-label personalization and the small/full volume toggle. */
export function RunOfShowRail() {
  const { isDemoOrg, isBarHidden, scenes, currentScene, prospectLabel, volume, goToScene, runCue, setProspectLabel, setVolume, setRole } =
    useDemo();
  const { currentOrg } = useAuth();
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const resetMut = useResetDemo();
  const [labelDraft, setLabelDraft] = useState(prospectLabel ?? "");

  // Keep the draft in sync when the underlying state changes from outside the input
  // (a fresh scene load, a Reset, or another tab writing demo_state).
  useEffect(() => {
    setLabelDraft(prospectLabel ?? "");
  }, [prospectLabel]);

  if (!isDemoOrg || isBarHidden) return null;

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
  // the persisted setting and the reseed mutation rather than relying on `reset()`.
  const handleVolumeChange = (v: "small" | "full") => {
    if (v === volume) return;
    setVolume(v);
    if (currentOrg) resetMut.mutate({ orgId: currentOrg.id, volume: v });
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
                          {CUE_LABELS[cueId]}
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
              onClick={() => handleVolumeChange(v)}
              className={cn(
                "h-6 rounded-md px-2.5 text-xs font-medium",
                volume === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {v === "small" ? "Small" : "Full"}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
