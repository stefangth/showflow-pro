import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FlowPresets } from "./FlowPresets";

describe("FlowPresets", () => {
  it("shows the Custom chip inline on the selected template and has no Custom tile", () => {
    render(<FlowPresets active="fasttrack" customized onSelect={vi.fn()} />);
    const fastTrack = screen.getByRole("button", { name: /fast-track/i });
    expect(fastTrack).toHaveTextContent("Custom");
    expect(screen.queryByText("Your own combination of the steps below.")).not.toBeInTheDocument();
  });

  it("greys out every template when editing is not allowed", () => {
    render(<FlowPresets active="off" disabled onSelect={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
