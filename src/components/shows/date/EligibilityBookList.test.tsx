import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EligibilityBookList } from "./EligibilityBookList";
import { unrestrictedEligibilityNote } from "@/lib/bookings/actionCopy";

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

  it("shows skeletons instead of the empty state while the list is loading", () => {
    const { container } = renderWithProviders(
      <EligibilityBookList artists={[]} bookedArtistIds={new Set()} onBook={() => {}} booking={false} loading />,
    );
    expect(screen.queryByText(/No eligible artists/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows an error alert instead of the empty state when loading failed", () => {
    renderWithProviders(
      <EligibilityBookList artists={[]} bookedArtistIds={new Set()} onBook={() => {}} booking={false} error />,
    );
    expect(screen.queryByText(/No eligible artists/)).not.toBeInTheDocument();
    expect(screen.getByText(/Could not load the eligible artists/)).toBeInTheDocument();
  });

  it("renders skill filter chips and fires onSkillFilterChange when a chip is toggled", () => {
    const onSkillFilterChange = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[{ id: "s1", name: "Improv" }, { id: "s2", name: "Singing" }]}
        selectedSkillIds={["s1"]}
        onSkillFilterChange={onSkillFilterChange}
      />,
    );
    expect(screen.getByText("Narrow the list further")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Improv/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Singing/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /^Singing/ }));
    expect(onSkillFilterChange).toHaveBeenCalledWith("s2");
    expect(screen.queryByText("Only offer to artists with")).not.toBeInTheDocument();
  });

  // 1h: direct mode never offers anything, so "Only offer to artists with" was actively
  // wrong here. The narrowing chips carry a per-skill count of the currently-listed
  // (already-qualifying, unblocked) artists who also hold that skill.
  it("shows a per-skill count on each narrowing chip, computed from the listed artists", () => {
    const onSkillFilterChange = vi.fn();
    renderWithProviders(
      <EligibilityBookList
        artists={[
          { id: "a1", name: "Marta", skillIds: ["piano"] },
          { id: "a2", name: "Jonas", skillIds: [] },
          { id: "a3", name: "Lena", skillIds: ["piano", "acting"] },
        ]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[{ id: "piano", name: "Piano" }, { id: "acting", name: "Acting" }]}
        selectedSkillIds={[]}
        onSkillFilterChange={onSkillFilterChange}
      />,
    );
    const pianoChip = screen.getByRole("button", { name: /^Piano/ });
    expect(pianoChip).toHaveTextContent("2");
    const actingChip = screen.getByRole("button", { name: /^Acting/ });
    expect(actingChip).toHaveTextContent("1");
    fireEvent.click(pianoChip);
    expect(onSkillFilterChange).toHaveBeenCalledWith("piano");
  });

  // 1h: the requirement-as-fact sentence replaces the old (wrong-in-direct-mode) label.
  it("shows the requirement-as-fact sentence when required skills and a total pool size are given", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[
          { id: "a1", name: "Marta" }, { id: "a2", name: "Jonas" }, { id: "a3", name: "Lena" },
          { id: "a4", name: "Ana" }, { id: "a5", name: "Ben" }, { id: "a6", name: "Cara" }, { id: "a7", name: "Dan" },
        ]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        requiredSkillNames={["Vocals", "Stage combat"]}
        totalArtistCount={24}
      />,
    );
    expect(
      screen.getByText("This date requires Vocals and Stage combat · 7 of 24 artists qualify and are not blocked."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Only offer to artists with")).not.toBeInTheDocument();
  });

  it("states there are no skill requirements when the date requires none", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        requiredSkillNames={[]}
        totalArtistCount={5}
      />,
    );
    expect(
      screen.getByText("This date has no skill requirements · 1 of 5 artists qualify and are not blocked."),
    ).toBeInTheDocument();
  });

  it("omits the requirement-as-fact sentence when no total pool size is given", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        requiredSkillNames={["Vocals"]}
      />,
    );
    expect(screen.queryByText(/This date requires/)).not.toBeInTheDocument();
  });

  // P3.5: when the date has no cast/city eligibility restriction, deriveDirectBookList
  // (src/lib/bookings.ts) opens the picker to the whole active roster — this note is the
  // one place that says so, so "everyone showed up" doesn't read as a bug.
  it("shows the unrestricted-eligibility note when the date has no cast limits", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        unrestricted
        orgName="Cirque Lumiere"
      />,
    );
    expect(screen.getByText(unrestrictedEligibilityNote("Cirque Lumiere"))).toBeInTheDocument();
  });

  it("omits the unrestricted-eligibility note when the date has a cast/city restriction", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        unrestricted={false}
        orgName="Cirque Lumiere"
      />,
    );
    expect(screen.queryByText(unrestrictedEligibilityNote("Cirque Lumiere"))).not.toBeInTheDocument();
  });

  it("renders no skill chips when skills are omitted or empty", () => {
    const { rerender } = renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
      />,
    );
    expect(screen.queryByText("Narrow the list further")).not.toBeInTheDocument();

    rerender(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[]}
        selectedSkillIds={[]}
        onSkillFilterChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Narrow the list further")).not.toBeInTheDocument();
  });
});
