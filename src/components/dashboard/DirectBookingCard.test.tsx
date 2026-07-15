import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { MemoryRouter } from "react-router-dom";
import { DirectBookingCard } from "./DirectBookingCard";

const item = { id: "d1", date: "2026-07-21", program: "TJE", subProgram: "Murder", mainBooked: 1, mainSlots: 2 };
const wrap = (ui: React.ReactElement) => renderWithProviders(<MemoryRouter>{ui}</MemoryRouter>);

describe("DirectBookingCard", () => {
  it("lists unfilled dates with booked counts", () => {
    wrap(<DirectBookingCard items={[item]} reference={{ source: "show" }} customFieldKey={null} />);
    expect(screen.getByText("Dates needing artists")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 booked/)).toBeInTheDocument();
  });
  it("renders nothing when empty", () => {
    const { container } = wrap(<DirectBookingCard items={[]} reference={{ source: "show" }} customFieldKey={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
