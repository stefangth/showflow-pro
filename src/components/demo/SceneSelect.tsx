import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDemo } from "@/features/demo/DemoContext";
import { useLanguage } from "@/features/i18n/LanguageContext";
import type { Scene } from "@/lib/demo/scenes";
import type { Lang } from "@/i18n/config";

/** "01 Where the season stands" — a 1-based, zero-padded index plus the scene's title
 *  in the viewer's current language (falling back to English for a missing translation). */
function sceneLabel(scene: Scene, index: number, lang: Lang): string {
  const n = String(index + 1).padStart(2, "0");
  return `${n} ${scene.title[lang] ?? scene.title.en}`;
}

/** The demo bar's scene selector: shows the current scene of the season-handover
 *  run-of-show and a dropdown of every scene, jumping via `goToScene` on pick. */
export function SceneSelect() {
  const { scenes, currentScene, goToScene } = useDemo();
  const { lang } = useLanguage();
  const currentIndex = scenes.findIndex((s) => s.id === currentScene.id);

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Scene</span>
      <Select value={currentScene.id} onValueChange={goToScene}>
        <SelectTrigger
          aria-label="Scene"
          className="h-7 w-auto min-w-[11rem] gap-1.5 border-none bg-transparent px-2 text-xs"
        >
          <SelectValue>{sceneLabel(currentScene, Math.max(currentIndex, 0), lang)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {scenes.map((scene, i) => (
            <SelectItem key={scene.id} value={scene.id}>
              {sceneLabel(scene, i, lang)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
