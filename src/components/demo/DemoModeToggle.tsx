import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useDemo } from "@/features/demo/DemoContext";
import { useAuth } from "@/features/auth/AuthContext";

/** Topbar "DEMO" chip: the persistent, always-visible handle for the demo control
 *  bar, mirroring how EditorModeToggle is the single topbar entry point for the
 *  editor toolbar. The sidebar DemoBadge is a secondary affordance that vanishes when
 *  the sidebar collapses — this chip does not. Visible only inside a demo org and only
 *  to an admin (or super-admin) of it, gated on the caller's REAL role exactly like
 *  DemoBar (never `hasRole('admin')`, which is itself viewAsRole-influenced). Renders
 *  whether or not the bar is currently shown, so it always offers a way back. */
export function DemoModeToggle() {
  const { isDemoOrg, isBarHidden, showBar, hideBar } = useDemo();
  const { roles, isSuperAdmin } = useAuth();
  const canOperate = isSuperAdmin || roles.includes("admin");
  if (!isDemoOrg || !canOperate) return null;

  const label = isBarHidden ? "Show demo controls" : "Hide demo controls";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={() => (isBarHidden ? showBar() : hideBar())}
          aria-label={label}
          title={label}
          className={cn(
            "h-8 gap-1 rounded-m border-primary px-2 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary",
            isBarHidden ? "bg-primary/5" : "bg-transparent",
          )}
        >
          DEMO
          <Play className="h-3 w-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
