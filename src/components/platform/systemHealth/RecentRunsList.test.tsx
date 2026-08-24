import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecentRunsList } from "./RecentRunsList";

describe("RecentRunsList", () => {
  it("renders nothing when there are no recent runs", () => {
    const { container } = render(<RecentRunsList recent={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("summarises the count while collapsed and lists each run when opened", () => {
    render(<RecentRunsList recent={[
      { status: 200, ms: 900, at: "2026-08-04T09:00:00Z" },
      { status: 502, ms: 4200, at: "2026-08-04T09:24:06Z" },
    ]} />);

    const summary = screen.getByText(/Recent runs \(2\)/);
    expect(summary).toBeInTheDocument();
    fireEvent.click(summary);
    // The status (mono Token) and the duration/timestamp (sans) are separate nodes
    // now, so match on the row's full text rather than a single element's text.
    // (The timestamp suffix is locale-dependent, so only the prefix is asserted.)
    const rowTexts = screen.getAllByTestId("recent-run-row").map((r) => r.textContent);
    expect(rowTexts.some((t) => t?.startsWith("HTTP 502 · 4.2s"))).toBe(true);
    expect(rowTexts.some((t) => t?.startsWith("HTTP 200 · 0.9s"))).toBe(true);
  });

  it("flags the failing runs so they can be picked out of the list", () => {
    render(<RecentRunsList recent={[{ status: 502, ms: 4200 }]} />);
    fireEvent.click(screen.getByText(/Recent runs \(1\)/));
    expect(screen.getByTestId("recent-run-row").className).toContain("text-destructive");
  });

  it("flags a run that never got an HTTP response, not just 4xx and 5xx", () => {
    render(<RecentRunsList recent={[{ status: 0, ms: 0 }]} />);
    fireEvent.click(screen.getByText(/Recent runs \(1\)/));
    expect(screen.getByTestId("recent-run-row").className).toContain("text-destructive");
  });

  it("renders the status as a machine token, separate from the sans duration/timestamp", () => {
    render(<RecentRunsList recent={[{ status: 502, ms: 4200, at: "2026-08-04T09:24:06Z" }]} />);
    fireEvent.click(screen.getByText(/Recent runs \(1\)/));
    expect(screen.getByText("HTTP 502").className).toContain("font-mono");
  });
});
