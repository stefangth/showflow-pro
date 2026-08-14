import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StagedChangesCard } from "./StagedChangesCard";

describe("StagedChangesCard", () => {
  it("shows the empty line and disables Apply when count is 0", () => {
    render(
      <StagedChangesCard
        count={0}
        scopeLine="Production Team"
        changes={[]}
        deltaSentence=""
        canApply={false}
        onDiscard={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Nothing staged. Toggle a right and it lands here before anyone's access changes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("lists each change's label and transition, and enables Apply when canApply", () => {
    render(
      <StagedChangesCard
        count={2}
        scopeLine="Production Team"
        changes={[
          { label: "Edit show dates", transition: "Off -> On", on: true },
          {
            label: "Delete bookings",
            transition: "On -> Off · sensitive",
            on: false,
          },
        ]}
        deltaSentence="Production Team gains 1 right and loses 1 right."
        canApply
        onDiscard={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("Edit show dates")).toBeInTheDocument();
    expect(screen.getByText("Off -> On")).toBeInTheDocument();
    expect(screen.getByText("Delete bookings")).toBeInTheDocument();
    expect(screen.getByText("On -> Off · sensitive")).toBeInTheDocument();
    expect(
      screen.getByText("Production Team gains 1 right and loses 1 right."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("calls onDiscard and onApply when their buttons are clicked", () => {
    const onDiscard = vi.fn();
    const onApply = vi.fn();
    render(
      <StagedChangesCard
        count={1}
        scopeLine="Production Team"
        changes={[
          { label: "Edit show dates", transition: "Off -> On", on: true },
        ]}
        deltaSentence="Production Team gains 1 right."
        canApply
        onDiscard={onDiscard}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("does not call onApply when clicked while disabled (!canApply)", () => {
    const onApply = vi.fn();
    render(
      <StagedChangesCard
        count={1}
        scopeLine="Production Team"
        changes={[
          { label: "Edit show dates", transition: "Off -> On", on: true },
        ]}
        deltaSentence="Production Team gains 1 right."
        canApply={false}
        onDiscard={vi.fn()}
        onApply={onApply}
      />,
    );
    const applyButton = screen.getByRole("button", { name: "Apply" });
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("renders the count and scopeLine in the header", () => {
    render(
      <StagedChangesCard
        count={3}
        scopeLine="Production Team"
        changes={[]}
        deltaSentence=""
        canApply
        onDiscard={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText("STAGED CHANGES")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Production Team")).toBeInTheDocument();
  });
});
