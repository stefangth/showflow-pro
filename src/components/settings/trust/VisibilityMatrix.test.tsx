import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { CROSS_ORG_EXCEPTIONS_NOTE, VISIBILITY_MATRIX } from "@/lib/trust/facts";
import { VisibilityMatrix } from "./VisibilityMatrix";

describe("VisibilityMatrix responsive breakpoint", () => {
  // Settings > Trust & data always renders inside the app sidebar plus the
  // settings nav column, so at a 768px viewport the tab itself only has
  // ~460px to work with. Restacking at `sm` (640px) left a dead band between
  // 640 and ~1024px where the table rendered clipped, with no scroll
  // affordance, cutting off the Mechanism column this page exists to show.
  // The restack must happen at `lg`, not `sm`, so the card list owns that
  // whole band instead.
  it("restacks the table into cards at lg, not sm", () => {
    const { container } = renderWithProviders(<VisibilityMatrix />);

    const tableRegion = container.querySelector('[role="region"][aria-label$="scrollable"]');
    expect(tableRegion).not.toBeNull();
    expect(tableRegion!.className).toMatch(/\blg:block\b/);
    expect(tableRegion!.className).not.toMatch(/\bsm:block\b/);

    const cardList = container.querySelector(".divide-y.divide-border");
    expect(cardList).not.toBeNull();
    expect(cardList!.className).toMatch(/\blg:hidden\b/);
    expect(cardList!.className).not.toMatch(/\bsm:hidden\b/);
  });

  // Moving the restack to `lg` without lowering the table's min-width only
  // moved the dead band: measured live in the settings tab, a 1024px viewport
  // leaves the table 470px, so a 560px floor still clipped the Mechanism
  // column by ~98px from 1024 up to ~1130. The floor has to fit inside the
  // narrowest width at which the table is shown at all.
  it("keeps the table's min-width inside the 470px the tab has at lg", () => {
    const { container } = renderWithProviders(<VisibilityMatrix />);

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const minWidth = table!.className.match(/\bmin-w-\[(\d+)px\]/);
    expect(minWidth, "the table must declare an explicit min-width").not.toBeNull();
    expect(Number(minWidth![1])).toBeLessThanOrEqual(470);
  });
});

describe("VisibilityMatrix enforcement claim", () => {
  // The subhead used to say what each role can read is "enforced in the
  // database, not the interface", which the table two rows down falsifies:
  // the Show-date chat cells credit the interface with turning the thread
  // read-only (admin) and hiding it (production team) 30 days after the show
  // date, and ChatPanel.tsx:141 does exactly that. The public page's
  // equivalent line has always read "not just the interface".
  //
  // Both halves are pinned. If the interface stops being part of the answer,
  // the first assertion fails and the sentence can be tightened again; if
  // someone tightens it while the interface is still part of the answer, the
  // second fails.
  it("does not claim database-only enforcement while the matrix credits the interface", () => {
    const cells = VISIBILITY_MATRIX.flatMap((row) => [row.admin, row.producer, row.artist]);
    const interfaceEnforced = cells.filter((c) => /\bthe interface\b/.test(c.note));
    expect(
      interfaceEnforced.length,
      "no cell credits the interface any more — the subhead may drop 'just'",
    ).toBeGreaterThan(0);

    renderWithProviders(<VisibilityMatrix />);

    const subhead = screen.getByText(/enforced in the database/i);
    expect(subhead).toHaveTextContent(/not just the interface/i);
  });
});

describe("VisibilityMatrix access tones", () => {
  /** The pill rendered inside the table row for a given data object. */
  function pill(object: string) {
    const row = screen
      .getAllByRole("row")
      .find((r) => within(r).queryByRole("rowheader", { name: object }));
    if (!row) throw new Error(`No matrix row for "${object}"`);
    const cell = within(row).getAllByRole("cell")[0];
    return cell.firstElementChild as HTMLElement;
  }

  // The Access column exists to be scanned. Mapping both `scoped` and `none`
  // to the same `neutral` badge collapsed the whole artist column into
  // identical grey pills — "Own record", "Own dates", "Own booking" and
  // "No access" all looked the same, so the column carried no signal and the
  // reader had to read every label. It also put the two Trust Center surfaces
  // into disagreement: the public page has always drawn `scoped` filled and
  // `none` outlined (`Trust.tsx` TONE_STYLE).
  it("draws a `none` cell differently from a `scoped` cell", () => {
    // Derived from the claim table rather than hardcoded, so this keeps
    // testing the real tones as rows are added or corrected.
    const scoped = VISIBILITY_MATRIX.find((r) => r.artist.tone === "scoped");
    const none = VISIBILITY_MATRIX.find((r) => r.artist.tone === "none");
    expect(scoped, "no scoped artist cell to compare").toBeDefined();
    expect(none, "no none artist cell to compare").toBeDefined();

    renderWithProviders(<VisibilityMatrix />); // defaults to the artist view

    expect(pill(none!.object).className).not.toEqual(pill(scoped!.object).className);
  });

  // `--ring` is the focus colour. Painting the selected chip in it meant a
  // keyboard user saw the same accent ring whether or not the control was
  // focused; and `ring-inset` set `--tw-ring-inset: inset` unconditionally,
  // which Tailwind composes into the ring-offset shadow too, so
  // `focus-visible:ring-2 ring-offset-2` rendered INSIDE the chip a pixel
  // from an identical ring. The roving tabindex makes the selected chip the
  // only tab stop in the group, so that was the first focus state a keyboard
  // user met here.
  it("does not decorate the selected role chip with the focus-ring colour", () => {
    renderWithProviders(<VisibilityMatrix />);

    const selected = screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true");
    expect(selected).toBeDefined();
    // Only unconditional classes: `focus-visible:ring-ring` is the ring this
    // control is supposed to have, and must survive.
    const unconditional = selected!.className.split(/\s+/).filter((c) => !c.includes(":"));
    expect(unconditional).not.toContain("ring-ring");
    expect(unconditional).not.toContain("ring-inset");
    expect(selected!.className).toMatch(/\bfocus-visible:ring-ring\b/);
  });
});

describe("VisibilityMatrix mechanism column budget", () => {
  // Both tables lay out `auto`, so the widest Mechanism cell takes the width.
  // The cross-organisation cell used to carry the four-table exclusion list in
  // one 54-word run while every other cell is 3-15 words. Measured in the
  // running app at 1440: the Data column collapsed to 147px and five of eight
  // row labels wrapped to two and three lines, running the table to 542px tall
  // where a short note gives 233px and 434px. The qualifier is not dropped —
  // it renders as a footnote under the table, where it can be read without a
  // 486px column.
  it("keeps every mechanism cell to a clause a table column can hold", () => {
    const words = (s: string) => s.trim().split(/\s+/).length;
    const cells = VISIBILITY_MATRIX.flatMap((row) => [row.admin, row.producer, row.artist]);

    for (const cell of cells) {
      expect(words(cell.note), `mechanism note too long for a cell: "${cell.note}"`).toBeLessThanOrEqual(25);
    }
  });

  it("renders the cross-organisation exclusions once, outside the table", () => {
    const { container } = renderWithProviders(<VisibilityMatrix />);

    const footnotes = screen.getAllByText(CROSS_ORG_EXCEPTIONS_NOTE);
    expect(footnotes, "one footnote, shared by the table and the restacked list").toHaveLength(1);
    expect(footnotes[0].closest("table"), "the qualifier must not sit in a cell").toBeNull();
    // It belongs to the matrix, not to whichever card follows it.
    expect(container.contains(footnotes[0])).toBe(true);
  });
});
