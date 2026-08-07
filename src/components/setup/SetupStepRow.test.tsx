import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetupStepRow } from "./SetupStepRow";

describe("SetupStepRow", () => {
  it("shows the step number and no chip when block is null and not done", () => {
    render(
      <SetupStepRow index={3} title="Cast priorities" hint="per city" done={false}
        block={null} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/blocks/i)).not.toBeInTheDocument();
  });

  it("renders a risk-tone chip with the given label", () => {
    render(
      <SetupStepRow index={1} title="Ladder" hint="h" done={false}
        block={{ label: "Blocks offers", tone: "risk" }} expanded={false} onToggle={() => {}} />,
    );
    const chip = screen.getByText("Blocks offers");
    expect(chip.className).toContain("var(--amber-100)"); // Badge risk variant
  });

  it("hides the chip once the step is done, even with a block", () => {
    render(
      <SetupStepRow index={1} title="Ladder" hint="h" done={true}
        block={{ label: "Blocks offers", tone: "risk" }} expanded={false} onToggle={() => {}} />,
    );
    expect(screen.queryByText("Blocks offers")).not.toBeInTheDocument();
  });
});
