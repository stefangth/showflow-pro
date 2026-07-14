import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EligibilityBookList } from "./EligibilityBookList";

describe("EligibilityBookList", () => {
  it("books an artist after confirming the dialog and marks already-booked rows", () => {
    const onBook = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }, { id: "a2", name: "Marco" }]}
        bookedArtistIds={new Set(["a2"])}
        onBook={onBook}
        booking={false}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /^Book$/ })[0]);
    // Direct booking is consequential (books AND confirms), so a dialog gates it.
    expect(onBook).not.toHaveBeenCalled();
    expect(screen.getByText("Book Lena for this date?")).toBeInTheDocument();
    expect(
      screen.getByText("This books and confirms Lena immediately. There is no offer step in direct booking mode."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book and confirm" }));
    expect(onBook).toHaveBeenCalledWith("a1", false);
    expect(screen.getByText("Booked")).toBeInTheDocument();
  });

  it("does not book when the confirmation dialog is cancelled", () => {
    const onBook = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={onBook}
        booking={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Book$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onBook).not.toHaveBeenCalled();
  });

  it("shows the empty-state message when there are no eligible artists", () => {
    renderWithProviders(
      <EligibilityBookList artists={[]} bookedArtistIds={new Set()} onBook={vi.fn()} booking={false} />,
    );
    expect(
      screen.getByText("No eligible artists for this date. Check casts and city in Settings."),
    ).toBeInTheDocument();
  });

  it("books as understudy when the checkbox is checked", () => {
    const onBook = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={onBook}
        booking={false}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^Book$/ }));
    // Understudy variant of the confirmation copy.
    expect(screen.getByText("Book Lena as understudy for this date?")).toBeInTheDocument();
    expect(
      screen.getByText("This books and confirms Lena as understudy immediately. There is no offer step in direct booking mode."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book and confirm" }));
    expect(onBook).toHaveBeenCalledWith("a1", true);
  });
});
