// The left pane: a tree of every section/role in TEMPLATE_SECTIONS, letting the
// producer pick which document element to edit and showing which roles/copy
// keys already carry an override. STUB for Task 8 (route + shell) — the real
// tree is built in its own task. This file only needs to render the
// "Document outline" navigation landmark so TemplateEditorPage.test.tsx's
// three-panes test passes.

import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderThemeOverride, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";

export interface TemplateOutlineProps {
  selected: RoleKey | "document";
  onSelect: (role: RoleKey | "document") => void;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
}

export function TemplateOutline(_props: TemplateOutlineProps) {
  return <nav aria-label="Document outline" className="h-full overflow-y-auto p-2" />;
}
