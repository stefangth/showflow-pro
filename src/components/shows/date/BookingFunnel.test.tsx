import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { BookingFunnel } from "./BookingFunnel";

describe("BookingFunnel", () => {
  it("renders offered, accepted, and confirmed rows against slots", () => {
    renderWithProviders(
      <BookingFunnel
        bookings={[
          { status: "suggested", is_understudy: false },
          { status: "soft_booked", is_understudy: false },
          { status: "confirmed", is_understudy: false },
        ]}
        slots={{ main_cast: 4, understudies: 1 }}
      />,
    );
    expect(screen.getByText("Offered")).toBeInTheDocument();
    expect(screen.getByText(/3 sent/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 5 slots/)).toBeInTheDocument();
  });
});
