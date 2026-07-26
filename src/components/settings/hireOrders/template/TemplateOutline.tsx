// The left pane: a tree of every section/role in TEMPLATE_SECTIONS, letting the
// producer pick which document element to edit and showing which roles/copy
// keys already carry an override.
//
// Why this pane exists at all: the centre pane is a real PDF rendered into an
// iframe, which has no clickable elements of its own. This tree IS the
// selection mechanism - picking a role here sets `highlightRole`, and the
// renderer draws an accent outline around that element in the preview. That
// loop is the entire reason the editor feels direct rather than form-like.

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderThemeOverride, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import { TEMPLATE_SECTIONS, type TemplateRole } from "./templateMeta";

export interface TemplateOutlineProps {
  selected: RoleKey | "document";
  onSelect: (role: RoleKey | "document") => void;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
}

/** True when a value is a non-null object with at least one own key. Guards
 *  both directions the draft state can go wrong: an override map is never
 *  guaranteed to omit a role entirely (present-but-empty must NOT read as
 *  modified), and it is never guaranteed to be the object the loose override
 *  type promises (a stray `null` must not throw). */
function hasOwnKeys(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.keys(value).length > 0;
}

/** A role counts as modified when its style has an override OR any copy key
 *  it prints has one - both halves matter, because a role whose only change
 *  is wording must still show as modified. Draft state omits unchanged keys
 *  entirely and never stores `null`, so an absent copy key reads as
 *  unmodified; `hasOwnKeys` covers the matching style-side case where the
 *  key is present but empty. */
function isRoleModified(
  role: TemplateRole,
  copyDraft: Partial<HireOrderCopy>,
  themeDraft: HireOrderThemeOverride,
): boolean {
  if (hasOwnKeys(themeDraft.roles?.[role.key])) return true;
  return role.copyKeys.some((key) => copyDraft[key] !== undefined);
}

interface OutlineButtonProps {
  label: string;
  modified: boolean;
  active: boolean;
  onClick: () => void;
}

function OutlineButton({ label, modified, active, onClick }: OutlineButtonProps) {
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent-100 text-accent-800" : "hover:bg-muted",
      )}
    >
      <span className="truncate">
        {label}
        {modified ? ", modified" : ""}
      </span>
      {modified && (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-600" />
      )}
    </button>
  );
}

/** Left pane. A PDF in an iframe has no clickable elements, so this tree is
 *  the only way to select a document element for the inspector to edit. */
export function TemplateOutline({ selected, onSelect, copyDraft, themeDraft }: TemplateOutlineProps) {
  const documentModified = hasOwnKeys(themeDraft.base);

  return (
    <nav aria-label="Document outline" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-3 p-2">
          <OutlineButton
            label="Document"
            modified={documentModified}
            active={selected === "document"}
            onClick={() => onSelect("document")}
          />

          {TEMPLATE_SECTIONS.map((section) => (
            <div key={section.title}>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              <div className="mt-1 space-y-0.5">
                {section.roles.map((role) => (
                  <OutlineButton
                    key={role.key}
                    label={role.label}
                    modified={isRoleModified(role, copyDraft, themeDraft)}
                    active={selected === role.key}
                    onClick={() => onSelect(role.key)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </nav>
  );
}
