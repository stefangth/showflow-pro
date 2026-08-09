import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BookingSetupRail } from "@/components/bookings/setup/BookingSetupRail";
import { SetupRail } from "@/components/hireOrders/setup/SetupRail";
import type { FeatureKey } from "@/lib/entitlements";
import type { BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";

interface SetupChecklistSheetProps {
  feature: FeatureKey;
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the inline rail expanded at this step. */
  initialStep?: string;
}

/**
 * Shared host for the inline setup rails in a right-side Sheet, opened at a chosen step.
 *
 * The rail is remounted via `key={initialStep}` so each open re-seeds its accordion. It is
 * rendered unconditionally inside SheetContent (not gated on `open`): Radix only mounts
 * SheetContent while the Sheet is open OR mid-exit-animation, so a fully-closed Sheet runs
 * no rail reads, while a closing one keeps its content visible through the 300ms slide-out
 * instead of blank-flashing. This is the "do it here" surface that the dashboard-style
 * rail's step buttons open on every page (dashboard, bookings, hire orders).
 */
export function SetupChecklistSheet({ feature, orgId, open, onOpenChange, initialStep }: SetupChecklistSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-base">Setup checklist</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {feature === "hire_orders"
            ? <SetupRail key={initialStep ?? "none"} orgId={orgId} initialStep={initialStep as SetupStepKey | undefined} />
            : <BookingSetupRail key={initialStep ?? "none"} orgId={orgId} initialStep={initialStep as BookingSetupStepKey | undefined} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
