// The right pane: typography/colour controls plus the bound copy fields for
// whichever role is selected in the outline. STUB for Task 8 (route + shell)
// — the real form is built in its own task. This file only needs to render
// the "Element settings" complementary landmark so TemplateEditorPage.test.tsx's
// three-panes test passes.

import type { Dispatch, SetStateAction } from "react";
import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";
import type { HireOrderThemeOverride, RoleKey } from "@/lib/hireOrders/pdf/pdfTheme";

export interface TemplateInspectorProps {
  selected: RoleKey | "document";
  readOnly: boolean;
  copyDraft: Partial<HireOrderCopy>;
  themeDraft: HireOrderThemeOverride;
  onCopyChange: Dispatch<SetStateAction<Partial<HireOrderCopy>>>;
  onThemeChange: Dispatch<SetStateAction<HireOrderThemeOverride>>;
}

export function TemplateInspector(_props: TemplateInspectorProps) {
  return <aside aria-label="Element settings" className="h-full overflow-y-auto p-3" />;
}
