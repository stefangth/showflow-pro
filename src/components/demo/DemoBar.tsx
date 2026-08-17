import { Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDemo } from "@/features/demo/DemoContext";
import { useAuth } from "@/features/auth/AuthContext";
import { roleLabel, type AppRole } from "@/config/app.config";
import { DemoOutbox } from "@/components/demo/DemoOutbox";

const ROLE_OPTIONS: AppRole[] = ["admin", "producer", "artist"];

/** The demo control bar: mounted at the header→body seam in AppLayout, visible only
 *  inside a demo org — AND only to an admin (or super-admin) of it. The role toggle
 *  drives AuthContext's viewAsRole simulation (which unconditionally flips
 *  effectiveHasRole client-side), so the bar is gated on the caller's REAL role,
 *  mirroring EditorToolbar's canUseEditor gate — a non-admin must not be able to
 *  grant themselves an admin view. Gate on `roles`, never `hasRole('admin')`, which
 *  is itself viewAsRole-influenced and would make the check self-satisfying. Shows a
 *  "Demo mode" indicator, the role toggle, and a Reset button (confirmed, since it
 *  wipes+reseeds). The scene selector and simulated clock are Phase 2. */
export function DemoBar() {
  const { isDemoOrg, isBarHidden, reset, isResetting } = useDemo();
  const { viewAsRole, setViewAsRole, roles, isSuperAdmin } = useAuth();
  const canOperate = isSuperAdmin || roles.includes("admin");
  if (!isDemoOrg || isBarHidden || !canOperate) return null;

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
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={isResetting} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> {isResetting ? "Resetting" : "Reset"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
              <AlertDialogDescription>
                This wipes this demo org's current data and reseeds it from scratch. Anything you set up in this session is lost. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={reset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
