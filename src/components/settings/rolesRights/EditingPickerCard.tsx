import { Users } from "lucide-react";

interface EditingPickerCardProps {
  roleOnCount: string;
  memberCount: number;
}

/** Right-rail card for the Roles & rights redesign: lets an admin pick WHO
 *  they are editing. Per-person exceptions are deferred, so the team default
 *  (role) is always the selected target and the "Individuals" section renders
 *  as an explicitly non-interactive "coming soon" affordance. */
export function EditingPickerCard({
  roleOnCount,
  memberCount,
}: EditingPickerCardProps) {
  return (
    <div className="rounded-[var(--radius-l)] border border-border shadow-elev2 bg-card">
      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          Editing
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Pick the team default or one person.
        </p>
      </div>

      <div className="px-4 pt-3">
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

      <div className="px-4 pb-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          Individuals
        </p>
        <div className="mt-2 select-none space-y-1 rounded-[var(--radius-m)] border border-dashed border-border px-3 py-3 opacity-60 pointer-events-none">
          <p className="text-[12.5px] text-muted-foreground">
            Per-person exceptions are coming soon.
          </p>
          <p className="text-[11px] text-muted-foreground">
            {memberCount} members
          </p>
        </div>
      </div>
    </div>
  );
}
