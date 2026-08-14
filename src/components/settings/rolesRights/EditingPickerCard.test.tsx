import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditingPickerCard } from "./EditingPickerCard";

describe("EditingPickerCard", () => {
  it("renders the Production Team row selected with the roleOnCount", () => {
    render(<EditingPickerCard roleOnCount="24/29" memberCount={6} />);
    expect(screen.getByText(/Production Team/)).toBeInTheDocument();
    expect(screen.getByText("24/29")).toBeInTheDocument();
    expect(screen.getByText("Team default")).toBeInTheDocument();
  });

  it("renders Individuals as an explicitly deferred, non-interactive section", () => {
    render(<EditingPickerCard roleOnCount="24/29" memberCount={6} />);
    expect(screen.getByText(/Production Team/)).toBeInTheDocument();
    expect(
      screen.getByText("Per-person exceptions are coming soon."),
    ).toBeInTheDocument();
    // no clickable member rows
    expect(screen.queryByRole("button", { name: /Lena/i })).toBeNull();
  });

  it("renders no interactive controls at all inside the deferred Individuals block", () => {
    render(<EditingPickerCard roleOnCount="24/29" memberCount={6} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows memberCount as non-interactive context text", () => {
    render(<EditingPickerCard roleOnCount="24/29" memberCount={6} />);
    expect(screen.getByText(/6 members/i)).toBeInTheDocument();
  });
});
