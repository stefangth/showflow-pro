import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { DOCUMENTS } from "@/lib/trust/facts";
import { DocumentsCard } from "./DocumentsCard";

describe("DocumentsCard", () => {
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
