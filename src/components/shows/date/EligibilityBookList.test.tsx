import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { EligibilityBookList } from "./EligibilityBookList";
import i18n from "@/i18n";
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
      screen.getByText("This books Lena immediately. There is no asking step in direct booking mode."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book now" }));
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
      screen.getByText("Nobody can be asked for this date. Check casts and city in Settings."),
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
      screen.getByText("This books Lena as understudy immediately. There is no asking step in direct booking mode."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Book now" }));
    expect(onBook).toHaveBeenCalledWith("a1", true);
  });

  it("shows skeletons instead of the empty state while the list is loading", () => {
    const { container } = renderWithProviders(
      <EligibilityBookList artists={[]} bookedArtistIds={new Set()} onBook={() => {}} booking={false} loading />,
    );
    expect(screen.queryByText(/Nobody can be asked/)).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows an error alert instead of the empty state when loading failed", () => {
    renderWithProviders(
      <EligibilityBookList artists={[]} bookedArtistIds={new Set()} onBook={() => {}} booking={false} error />,
    );
    expect(screen.queryByText(/Nobody can be asked/)).not.toBeInTheDocument();
    expect(screen.getByText(/Could not load who can be asked/)).toBeInTheDocument();
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
    expect(screen.queryByText("Only ask artists with")).not.toBeInTheDocument();
  });

  // Hiding the count (rather than showing a hard-coded "0") when the caller has not wired
  // skillIds through at all: a false "0" would read as "nobody qualifies", which this
  // component cannot actually claim to know when it was never handed the data.
  it("hides the per-skill count, rather than showing 0, when no listed artist carries skillIds", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Lena" }, { id: "a2", name: "Marco" }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[{ id: "s1", name: "Piano" }]}
        selectedSkillIds={[]}
        onSkillFilterChange={vi.fn()}
      />,
    );
    const pianoChip = screen.getByRole("button", { name: "Piano" });
    expect(pianoChip.textContent).toBe("Piano");
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

  // 1h: the narrowing chips are EXTRA (non-required) skills only. An already-required
  // skill is a no-op narrower (every qualifying artist already holds it), so it must be
  // excluded from the chip list rather than rendered as a chip whose count is the whole list.
  it("excludes already-required skills from the narrowing chips", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[
          { id: "a1", name: "Marta", skillIds: ["vocals", "combat", "piano"] },
          { id: "a2", name: "Jonas", skillIds: ["vocals", "combat"] },
        ]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[
          { id: "vocals", name: "Vocals" },
          { id: "combat", name: "Stage combat" },
          { id: "piano", name: "Piano" },
        ]}
        selectedSkillIds={[]}
        onSkillFilterChange={vi.fn()}
        requiredSkillIds={["vocals", "combat"]}
      />,
    );
    // Piano is a real narrower (not every qualifying artist holds it), so it stays a chip.
    expect(screen.getByRole("button", { name: /^Piano/ })).toBeInTheDocument();
    // Vocals / Stage combat are already required, so they are no-op narrowers and excluded.
    expect(screen.queryByRole("button", { name: /^Vocals/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Stage combat/ })).not.toBeInTheDocument();
  });

  it("hides the whole narrowing section when every listed skill is already required", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Marta", skillIds: ["vocals"] }]}
        bookedArtistIds={new Set()}
        onBook={vi.fn()}
        booking={false}
        skills={[{ id: "vocals", name: "Vocals" }]}
        selectedSkillIds={[]}
        onSkillFilterChange={vi.fn()}
        requiredSkillIds={["vocals"]}
      />,
    );
    expect(screen.queryByText("Narrow the list further")).not.toBeInTheDocument();
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
      screen.getByText("This date requires Vocals and Stage combat · 7 of 24 artists qualify and are free."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Only ask artists with")).not.toBeInTheDocument();
  });

  /**
   * "qualify and are free" must not count someone already booked on this date. The list
   * itself still carries booked artists (they render with a Booked badge and no Book
   * button), so a fully booked date claimed there were people left to ask. The branch's own
   * last commit fixed exactly this on the rail; this is its nearest neighbour.
   */
  it("does not count already-booked artists as free", () => {
    renderWithProviders(
      <EligibilityBookList
        artists={[{ id: "a1", name: "Marta" }, { id: "a2", name: "Jonas" }, { id: "a3", name: "Lena" }]}
        bookedArtistIds={new Set(["a1", "a2"])}
        onBook={vi.fn()}
        booking={false}
        requiredSkillNames={[]}
        totalArtistCount={3}
      />,
    );
    expect(
      screen.getByText("This date has no skill requirements · 1 of 3 artists qualify and are free."),
    ).toBeInTheDocument();
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
      screen.getByText("This date has no skill requirements · 1 of 5 artists qualify and are free."),
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
    expect(screen.getByText(unrestrictedEligibilityNote("Cirque Lumiere", i18n.getFixedT("en", "bookingCopy")))).toBeInTheDocument();
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
    expect(screen.queryByText(unrestrictedEligibilityNote("Cirque Lumiere", i18n.getFixedT("en", "bookingCopy")))).not.toBeInTheDocument();
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
