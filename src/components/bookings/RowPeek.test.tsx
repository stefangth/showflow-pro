import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RowPeek } from "./RowPeek";
import type { DatePeek } from "@/lib/bookingCockpit";

const atRisk: DatePeek = {
  tone: "at-risk", eyebrowSuffix: "at risk",
  headline: "2 accepted waiting on you · 2 main slots open",
  meter: [{tone:"confirmed"},{tone:"confirmed"},{tone:"accepted"},{tone:"accepted"},{tone:"open"},{tone:"open"}],
  acceptedWaiting: 2, openSlots: 2, confirmable: true,
};

describe("RowPeek", () => {
  it("renders eyebrow, headline, and a Confirm N + Open date action", () => {
    const onConfirm = vi.fn(); const onOpen = vi.fn();
    render(<RowPeek dateLabel="Thu 12 Mar" peek={atRisk} canConfirm confirming={false} onConfirm={onConfirm} onOpen={onOpen} />);
    expect(screen.getByText(/Thu 12 Mar · at risk/i)).toBeInTheDocument();
    expect(screen.getByText(/2 accepted waiting on you/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm 2/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /open date/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("hides Confirm when not confirmable, shows only Open date", () => {
    const filled: DatePeek = { ...atRisk, tone: "filled", eyebrowSuffix: "filled", confirmable: false, acceptedWaiting: 0, headline: "All 6 slots confirmed" };
    render(<RowPeek dateLabel="Wed 11 Mar" peek={filled} canConfirm confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open date/i })).toBeInTheDocument();
  });

  it("hides Confirm when the user lacks the capability", () => {
    render(<RowPeek dateLabel="Thu 12 Mar" peek={atRisk} canConfirm={false} confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("unconfigured (peek null): shows a minimal Open date, no meter", () => {
    render(<RowPeek dateLabel="Thu 12 Mar" peek={null} canConfirm confirming={false} onConfirm={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/unconfigured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open date/i })).toBeInTheDocument();
  });
});
