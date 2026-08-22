import type { ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

export interface TemplateEditorShellProps {
  title: ReactNode;
  breadcrumb: ReactNode;
  actions?: ReactNode;
  outline: ReactNode;
  preview: ReactNode;
  inspector: ReactNode;
}

/** Shared three-pane workspace frame. Domain pages own all state and actions. */
export function TemplateEditorShell({ title, breadcrumb, actions, outline, preview, inspector }: TemplateEditorShellProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {breadcrumb}
          <h1 className="font-display text-lg">{title}</h1>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <ResizablePanelGroup direction="horizontal" className="flex-1 rounded-l border">
        <ResizablePanel defaultSize={22} minSize={16}>{outline}</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={50} minSize={30}>{preview}</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={28} minSize={20}>{inspector}</ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
