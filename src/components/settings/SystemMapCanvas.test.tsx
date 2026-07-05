import { describe, it, expect } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { SystemMapCanvas } from "./SystemMapCanvas";

describe("SystemMapCanvas", () => {
  it("renders nodes across the four columns", () => {
    renderWithProviders(<SystemMapCanvas />);
    expect(screen.getByRole("button", { name: /airtable-poll$/i })).toBeInTheDocument();
    expect(screen.getByText(/bookings/i)).toBeInTheDocument();
  });

  it("filters nodes by subsystem chip", () => {
    renderWithProviders(<SystemMapCanvas />);
    // 'Airtable sync' filter hides a GDPR-only node like fetch-remote-sheet
    fireEvent.click(screen.getByRole("button", { name: /airtable sync/i }));
    expect(screen.queryByRole("button", { name: /fetch-remote-sheet/i })).toBeNull();
    // restore
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(screen.getByRole("button", { name: /fetch-remote-sheet/i })).toBeInTheDocument();
  });

  it("opens a detail panel when a node is clicked", () => {
    renderWithProviders(<SystemMapCanvas />);
    fireEvent.click(screen.getByRole("button", { name: /send-transactional-email/i }));
    const panel = screen.getByRole("complementary", { name: /details/i });
    expect(within(panel).getByText(/service-role only/i)).toBeInTheDocument();
  });
});
