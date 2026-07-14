import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EligibilityBookList } from "./EligibilityBookList";

describe("EligibilityBookList", () => {
  it("books an artist directly and marks already-booked rows", () => {
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
    expect(onBook).toHaveBeenCalledWith("a1", false);
    expect(screen.getByText("Booked")).toBeInTheDocument();
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
    expect(onBook).toHaveBeenCalledWith("a1", true);
  });
});
