import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./segmented-control";

describe("SegmentedControl", () => {
  it("renders every option label", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("calls onChange with the clicked option value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        value="a"
        onChange={onChange}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("B"));

    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("marks the active option with aria-selected=true and the rest false", () => {
    render(
      <SegmentedControl
        value="b"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    const active = tabs.find((tab) => tab.textContent === "B");
    const inactive = tabs.find((tab) => tab.textContent === "A");

    expect(active).toHaveAttribute("aria-selected", "true");
    expect(inactive).toHaveAttribute("aria-selected", "false");
  });

  it("renders a count badge only when count is provided", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={vi.fn()}
        options={[
          { value: "a", label: "A", count: 3 },
          { value: "b", label: "B" },
        ]}
      />,
    );

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("exposes the track as a tablist", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={vi.fn()}
        options={[{ value: "a", label: "A" }]}
      />,
    );

    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("tints the count chip by active state", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={() => {}}
        options={[
          { value: "a", label: "A", count: 3 },
          { value: "b", label: "B", count: 5 },
        ]}
      />,
    );
    expect(screen.getByText("3").className).toContain("bg-accent-tint");
    expect(screen.getByText("5").className).toContain("bg-well-tint");
  });

  it("scrolls when scrollable", () => {
    const { container } = render(
      <SegmentedControl scrollable value="a" onChange={() => {}} options={[{ value: "a", label: "A" }]} />,
    );
    expect(container.querySelector('[role="tablist"]')!.className).toContain("overflow-x-auto");
  });
});
