import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { RightRow } from "./RightRow";
import type { ComponentProps } from "react";

type RowShape = ComponentProps<typeof RightRow>["row"];

function makeRow(over: Partial<RowShape> = {}): RowShape {
  return {
    key: "manage_casts",
    label: "Manage casts",
    description: "Create and edit casts for this organization.",
    risk: "standard",
    effective: false,
    locked: false,
    ...over,
  };
}

describe("RightRow", () => {
  it("renders the label and description", () => {
    render(
      <RightRow
        row={makeRow()}
        changed={false}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Manage casts")).toBeInTheDocument();
    expect(
      screen.getByText("Create and edit casts for this organization."),
    ).toBeInTheDocument();
  });

  it("locked row disables the switch and shows Managed by ShowFlow", () => {
    render(
      <RightRow
        row={makeRow({
          key: "rename_org",
          label: "Rename the organization",
          description: "Rename the organization.",
          risk: "sensitive",
          effective: false,
          locked: true,
        })}
        changed={false}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText(/Managed by ShowFlow/i)).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeDisabled();
  });

  it("sensitive row shows the Sensitive badge", () => {
    render(
      <RightRow
        row={makeRow({ risk: "sensitive" })}
        changed={false}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Sensitive")).toBeInTheDocument();
  });

  it("standard row does not show the Sensitive badge", () => {
    render(
      <RightRow
        row={makeRow({ risk: "standard" })}
        changed={false}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("Sensitive")).not.toBeInTheDocument();
  });

  it("toggling a non-locked row calls onToggle", () => {
    const onToggle = vi.fn();
    render(
      <RightRow
        row={makeRow({ locked: false })}
        changed={false}
        desired={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("a locked row's switch never calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <RightRow
        row={makeRow({ locked: true })}
        changed={false}
        desired={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("a changed row desired=true shows a Granting chip", () => {
    render(
      <RightRow
        row={makeRow({ effective: false })}
        changed={true}
        desired={true}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Granting")).toBeInTheDocument();
  });

  it("a changed row desired=false shows a Removing chip", () => {
    render(
      <RightRow
        row={makeRow({ effective: true })}
        changed={true}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByText("Removing")).toBeInTheDocument();
  });

  it("an unchanged row shows neither Granting nor Removing", () => {
    render(
      <RightRow
        row={makeRow()}
        changed={false}
        desired={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("Granting")).not.toBeInTheDocument();
    expect(screen.queryByText("Removing")).not.toBeInTheDocument();
  });

  it("the switch reflects the desired value, not effective", () => {
    render(
      <RightRow
        row={makeRow({ effective: false })}
        changed={true}
        desired={true}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole("switch")).toBeChecked();
  });
});
