// The center pane: the live browser-rendered PDF preview of `input`, with the
// selected role outlined via `input.highlightRole`. STUB for Task 8 (route +
// shell) — the real preview (react-pdf's browser renderer) is wired up in its
// own task. This file only needs to render the "Document preview" region
// landmark so TemplateEditorPage.test.tsx's three-panes test passes.

import type { RenderInput } from "@/lib/hireOrders/pdf/docTypes";

export interface TemplateDocumentPaneProps {
  input: RenderInput;
}

export function TemplateDocumentPane(_props: TemplateDocumentPaneProps) {
  return <section aria-label="Document preview" className="h-full overflow-y-auto bg-muted/30" />;
}
