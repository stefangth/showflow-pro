import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DOCUMENTS, DOCUMENTS_NOTE } from "@/lib/trust/facts";
import { DocumentsCard } from "./DocumentsCard";

describe("DocumentsCard", () => {
  // Every other card on the tab stacks an <h3> over a `text-sm
  // text-muted-foreground` <p>. This one put the lede beside the heading in a
  // non-wrapping flex row: measured in the running app at 1440 the header was
  // an 84x24 heading centred against a 240x48 two-line block, and at 375 the
  // heading squeezed to ~138px while the note wrapped to three lines beside
  // it. It read as a layout accident rather than a card header, and it was the
  // only running prose in `font-mono` on the tab.
  it("stacks its header the way every other card on the tab does", () => {
    const { container } = renderWithProviders(<DocumentsCard />);

    const heading = screen.getByRole("heading", { name: "Documents" });
    const note = screen.getByText(DOCUMENTS_NOTE);
    // Siblings in the card's own vertical rhythm, not two halves of a flex row.
    expect(note.previousElementSibling).toBe(heading);
    expect(note.tagName).toBe("P");
    expect(note.className).toMatch(/\btext-sm\b/);
    expect(note.className).toMatch(/\btext-muted-foreground\b/);
    expect(note.className).not.toMatch(/\bfont-mono\b/);
    expect(heading.parentElement?.className).not.toMatch(/\bjustify-between\b/);
    void container;
  });

  // At a 1024px viewport the settings content column is 504px wide and the
  // `lg:grid-cols-2` row above split it in half, so "Data processing
  // agreement" rendered as "Data processing…". A documents list on a trust
  // page cannot elide the document's name: the title is the one thing a
  // reviewer is here to identify. jsdom has no layout, so the guard is that
  // the title carries no truncation rule and every title is present in full.
  it("never truncates a document title", () => {
    const { container } = renderWithProviders(<DocumentsCard />);

    expect(DOCUMENTS.length).toBeGreaterThan(0);
    for (const doc of DOCUMENTS) {
      const title = screen.getByText(doc.title);
      expect(title.className).not.toMatch(/\btruncate\b/);
      expect(title.className).not.toMatch(/\btext-ellipsis\b/);
    }
    expect(container.querySelector(".truncate")).toBeNull();
  });
});
