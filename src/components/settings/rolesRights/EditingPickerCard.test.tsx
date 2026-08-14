import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditingPickerCard } from "./EditingPickerCard";

describe("EditingPickerCard", () => {
  it("renders the Production Team row selected with the roleOnCount", () => {
    render(<EditingPickerCard roleOnCount="24/29" />);
    expect(screen.getByText("Production Team")).toBeInTheDocument();
    expect(screen.getByText("24/29")).toBeInTheDocument();
    expect(screen.getByText("Team default")).toBeInTheDocument();
  });

  it("does not render the deferred per-person Individuals section", () => {
    render(<EditingPickerCard roleOnCount="24/29" />);
    expect(screen.getByText("Production Team")).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
    expect(screen.queryByText(/Individuals/i)).toBeNull();
  });

  it("renders no interactive controls", () => {
    render(<EditingPickerCard roleOnCount="24/29" />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
