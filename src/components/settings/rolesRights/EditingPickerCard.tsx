import { Users } from "lucide-react";

interface EditingPickerCardProps {
  roleOnCount: string;
}

/** Right-rail card for the Roles & rights redesign: shows the single editing
 *  target, the Production Team default. Per-person exceptions are not part of
 *  this surface, so there is nothing else to pick here. */
export function EditingPickerCard({ roleOnCount }: EditingPickerCardProps) {
  return (
    <div className="rounded-[var(--radius-l)] border border-border shadow-elev2 bg-card">
      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          Editing
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Rights apply to the whole Production Team.
        </p>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="flex items-center gap-3 rounded-[var(--radius-m)] bg-accent-50 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-s)] bg-accent-100 text-accent-700">
            <Users className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium text-foreground">
              Production Team
            </p>
            <p className="text-[12px] text-muted-foreground">Team default</p>
          </div>
          <span className="shrink-0 font-mono tabular-nums text-[12px] text-muted-foreground">
            {roleOnCount}
          </span>
        </div>
      </div>
    </div>
  );
}
