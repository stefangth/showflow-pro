import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AccountStatusChip } from "./AccountStatusChip";

describe("AccountStatusChip", () => {
  it("renders the Active label", () => {
    render(<AccountStatusChip state="active" />);
    expect(screen.getByText("Active account")).toBeInTheDocument();
  });
  it("renders the Invited label", () => {
    render(<AccountStatusChip state="invited" />);
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
  });
  it("renders the None label", () => {
    render(<AccountStatusChip state="none" />);
    expect(screen.getByText("No account")).toBeInTheDocument();
  });
});
