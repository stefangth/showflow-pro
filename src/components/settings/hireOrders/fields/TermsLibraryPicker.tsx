import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("settingsHireOrders");
  function clauseCount(n: number): string {
    return t("termsLibraryPicker.clauseCount", { count: n });
  }
  if (library.length === 0) {
    return (
      <p className="rounded-l border border-dashed border-border p-3 text-xs text-muted-foreground">
        {t("termsLibraryPicker.empty")}
      </p>
    );
  }
  const held = new Set(alreadyHeldIds);
  const selected = new Set(selectedIds);
  return (
    <div className="space-y-2">
      {library.map((tpl) => {
        const isHeld = held.has(tpl.id);
        return (
          <div key={tpl.id} className="flex items-start gap-3 rounded-l border border-border p-3">
            <Checkbox
              id={`${idPrefix}-${tpl.id}`}
              className="mt-0.5"
              aria-label={tpl.name}
              checked={selected.has(tpl.id)}
              disabled={readOnly || isHeld}
              onCheckedChange={() => onToggle(tpl.id)}
            />
            <Label htmlFor={`${idPrefix}-${tpl.id}`} className="cursor-pointer font-normal">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{tpl.name}</span>
                {isHeld && (
                  <span className="rounded bg-well-tint px-1.5 py-0.5 text-eyebrow font-medium text-muted-foreground">
                    {t("termsLibraryPicker.alreadyAdded")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {clauseCount(tpl.clauses.length)} · {tpl.clauses.map((c) => c.title).join(", ")}
              </span>
            </Label>
          </div>
        );
      })}
    </div>
  );
}
