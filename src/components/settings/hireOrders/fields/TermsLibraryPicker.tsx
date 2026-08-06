import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";

export interface TermsLibraryPickerProps {
  library: HireOrderTemplate[];
  selectedIds: string[];
  /** Ids the org already holds. Shown as "Already added" and not selectable, because
   *  mergeTermsTemplates skips them anyway. */
  alreadyHeldIds: string[];
  onToggle: (id: string) => void;
  readOnly?: boolean;
  idPrefix?: string;
}

function clauseCount(n: number): string {
  return `${n} ${n === 1 ? "clause" : "clauses"}`;
}

/** Multi-select over the platform terms library. Used by the setup rail, by the
 *  Settings terms card, and by the issue preflight sheet, so the one-click start is
 *  identical wherever an org meets it. */
export function TermsLibraryPicker({
  library,
  selectedIds,
  alreadyHeldIds,
  onToggle,
  readOnly = false,
  idPrefix = "terms-lib",
}: TermsLibraryPickerProps) {
  if (library.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
        No templates in the library yet. Add your clauses below instead.
      </p>
    );
  }
  const held = new Set(alreadyHeldIds);
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-2">
      {library.map((t) => {
        const isHeld = held.has(t.id);
        return (
          <div key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id={`${idPrefix}-${t.id}`}
              className="mt-0.5"
              aria-label={t.name}
              checked={selected.has(t.id)}
              disabled={readOnly || isHeld}
              onCheckedChange={() => onToggle(t.id)}
            />
            <Label htmlFor={`${idPrefix}-${t.id}`} className="cursor-pointer font-normal">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.name}</span>
                {isHeld && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    Already added
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {clauseCount(t.clauses.length)} · {t.clauses.map((c) => c.title).join(", ")}
              </span>
            </Label>
          </div>
        );
      })}
    </div>
  );
}
