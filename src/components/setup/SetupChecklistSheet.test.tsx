import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SetupChecklistSheet } from "./SetupChecklistSheet";

vi.mock("@/components/bookings/setup/BookingSetupRail", () => ({
  BookingSetupRail: ({ initialStep }: { initialStep?: string }) => <div data-testid="booking-rail">step:{initialStep ?? "none"}</div>,
}));
vi.mock("@/components/hireOrders/setup/SetupRail", () => ({
  SetupRail: ({ initialStep }: { initialStep?: string }) => <div data-testid="hire-rail">step:{initialStep ?? "none"}</div>,
}));

it("renders the booking rail for booking_flow at the given step", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="booking_flow" orgId="org-1" open onOpenChange={vi.fn()} initialStep="timing" /></MemoryRouter>);
  expect(screen.getByTestId("booking-rail")).toHaveTextContent("step:timing");
  expect(screen.queryByTestId("hire-rail")).not.toBeInTheDocument();
});

it("renders the hire rail for hire_orders", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="hire_orders" orgId="org-1" open onOpenChange={vi.fn()} /></MemoryRouter>);
  expect(screen.getByTestId("hire-rail")).toHaveTextContent("step:none");
});

it("renders nothing inside when closed", () => {
  render(<MemoryRouter><SetupChecklistSheet feature="booking_flow" orgId="org-1" open={false} onOpenChange={vi.fn()} /></MemoryRouter>);
  expect(screen.queryByTestId("booking-rail")).not.toBeInTheDocument();
});
