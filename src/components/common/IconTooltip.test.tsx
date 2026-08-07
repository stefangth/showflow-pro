import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconTooltip } from "./IconTooltip";

function renderWithTooltip(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("IconTooltip", () => {
  it("renders the wrapped control and keeps its accessible name", () => {
    renderWithTooltip(
      <IconTooltip label="Edit production">
        <button aria-label="Edit production">·</button>
      </IconTooltip>,
    );
    expect(screen.getByRole("button", { name: "Edit production" })).toBeInTheDocument();
  });

  it("wraps the trigger in an inline-flex span (so a disabled button still hosts the tooltip)", () => {
    renderWithTooltip(
      <IconTooltip label="Delete">
        <button aria-label="Delete" disabled>·</button>
      </IconTooltip>,
    );
    const span = screen.getByRole("button", { name: "Delete" }).closest("span");
    expect(span).toHaveClass("inline-flex");
  });

  it("reveals the label on hover", async () => {
    renderWithTooltip(
      <IconTooltip label="Resend invite">
        <button aria-label="Resend invite">·</button>
      </IconTooltip>,
    );
    // Radix opens a tooltip from pointermove on the trigger, not mouseover.
    fireEvent.pointerMove(screen.getByRole("button", { name: "Resend invite" }), {
      pointerType: "mouse",
    });
    // Radix renders the visible bubble plus a visually-hidden copy, hence findAllByText.
    expect(await screen.findAllByText("Resend invite")).not.toHaveLength(0);
  });

  it("still opens the tooltip when the control itself is disabled", async () => {
    renderWithTooltip(
      <IconTooltip label="Synced productions can't be deleted">
        <button aria-label="Delete" disabled>·</button>
      </IconTooltip>,
    );
    // The disabled button emits no pointer events; they bubble to the wrapping span.
    const span = screen.getByRole("button", { name: "Delete" }).closest("span")!;
    fireEvent.pointerMove(span, { pointerType: "mouse" });
    expect(
      await screen.findAllByText("Synced productions can't be deleted"),
    ).not.toHaveLength(0);
  });

  it("renders the child unwrapped when the label is empty", () => {
    render(
      <IconTooltip label="">
        <button aria-label="No tip">·</button>
      </IconTooltip>,
    );
    const btn = screen.getByRole("button", { name: "No tip" });
    // Escape hatch: no trigger-span wrapper, the child is returned directly.
    expect(btn.closest("span")).toBeNull();
  });
});
