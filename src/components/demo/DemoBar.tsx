import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDemo } from "@/features/demo/DemoContext";
import { useAuth } from "@/features/auth/AuthContext";
import { roleLabel, type AppRole } from "@/config/app.config";
import { DemoOutbox } from "@/components/demo/DemoOutbox";

const ROLE_OPTIONS: AppRole[] = ["admin", "producer", "artist"];

/** The demo control bar: mounted at the header→body seam in AppLayout, visible only
 *  inside a demo org (and only while the operator hasn't hidden it). Shows a "Demo
 *  mode" indicator, a role toggle that drives AuthContext's existing viewAsRole
 *  simulation, and a Reset button that replays the org's demo seed. The scene
 *  selector and simulated clock are Phase 2 and are not rendered here. */
export function DemoBar() {
  const { isDemoOrg, isBarHidden, reset, isResetting } = useDemo();
  const { viewAsRole, setViewAsRole } = useAuth();
  if (!isDemoOrg || isBarHidden) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-accent-50 border-b-[0.5px] border-border text-sm">
      <Badge variant="outline" className="border-primary text-primary gap-1">
        <Play className="h-3 w-3" /> Demo mode
      </Badge>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Role</span>
        <div role="group" className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={viewAsRole === r}
              onClick={() => setViewAsRole(viewAsRole === r ? null : r)}
              className={`h-6 rounded-md px-2.5 text-xs font-medium ${
                viewAsRole === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {roleLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <DemoOutbox />
        <Button size="sm" variant="outline" onClick={reset} disabled={isResetting} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" /> {isResetting ? "Resetting" : "Reset"}
        </Button>
      </div>
    </div>
  );
}
