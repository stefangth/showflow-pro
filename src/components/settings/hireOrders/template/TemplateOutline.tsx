import { useTranslation } from "react-i18next";
import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderThemeOverride, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";
import { hasOwnKeys } from "../../templateEditor/overrideMap";
import { TemplateOutline as GenericTemplateOutline } from "../../templateEditor/TemplateOutline";
import { TEMPLATE_SECTIONS, type TemplateRole } from "./templateMeta";

export interface TemplateOutlineProps {
  selected: RoleKey | "document";
  onSelect: (role: RoleKey | "document") => void;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
}

function isRoleModified(role: TemplateRole, copyDraft: Partial<HireOrderCopy>, themeDraft: HireOrderThemeOverride): boolean {
  return hasOwnKeys(themeDraft.roles?.[role.key]) || role.copyKeys.some((key) => copyDraft[key] !== undefined);
}

/** PDF-domain adapter over the domain-neutral callback-driven outline. */
export function TemplateOutline({ selected, onSelect, copyDraft, themeDraft }: TemplateOutlineProps) {
  const { t } = useTranslation("settingsHireOrders");
  return (
    <GenericTemplateOutline
      document={{ key: "document", label: t("templateOutline.documentLabel") }}
      sections={TEMPLATE_SECTIONS}
      selected={selected}
      onSelect={onSelect}
      isModified={(key) => key === "document"
        ? hasOwnKeys(themeDraft.base)
        : isRoleModified(
          TEMPLATE_SECTIONS.flatMap((section) => section.roles).find((role) => role.key === key) as TemplateRole,
          copyDraft,
          themeDraft,
        )}
    />
  );
}
