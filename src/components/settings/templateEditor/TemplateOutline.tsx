import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TemplateRole, TemplateSection } from "./types";

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
      {modified && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-600" />}
    </button>
  );
}

export interface TemplateOutlineProps<RoleKey extends string, CopyKey extends string = never> {
  document: TemplateRole<RoleKey, CopyKey>;
  sections: readonly TemplateSection<RoleKey, CopyKey>[];
  selected: RoleKey;
  onSelect: (key: RoleKey) => void;
  isModified: (key: RoleKey) => boolean;
}

/** Callback-driven outline shared by template editors in every domain. */
export function TemplateOutline<RoleKey extends string, CopyKey extends string = never>({
  document,
  sections,
  selected,
  onSelect,
  isModified,
}: TemplateOutlineProps<RoleKey, CopyKey>) {
  return (
    <nav aria-label="Document outline" className="h-full">
      <ScrollArea className="h-full">
        <div className="space-y-3 p-2">
          <OutlineButton
            label={document.label}
            modified={isModified(document.key)}
            active={selected === document.key}
            onClick={() => onSelect(document.key)}
          />
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
              <div className="mt-1 space-y-0.5">
                {section.roles.map((role) => (
                  <OutlineButton
                    key={role.key}
                    label={role.label}
                    modified={isModified(role.key)}
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
