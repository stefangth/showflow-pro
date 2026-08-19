import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { OrderTimeline } from "./OrderTimeline";

const LABELS = ["Created", "Issued to artist", "Seen", "Awaiting countersign", "Countersigned"];

interface TimelineProps {
  status: string;
  createdAt?: string | null;
  issuedAt?: string | null;
  seenAt?: string | null;
  countersignedAt?: string | null;
}

function renderTimeline(props: Partial<TimelineProps> = {}) {
  renderWithProviders(
    <OrderTimeline
      status="draft"
      createdAt="2026-01-10T09:00:00Z"
      issuedAt={null}
      countersignedAt={null}
      {...props}
    />,
  );
  return within(screen.getByRole("list", { name: /contract status timeline/i }));
}

describe("OrderTimeline steps", () => {
  it("renders all five steps in order, Seen included, nothing extra", () => {
    const timeline = renderTimeline();
    const items = timeline.getAllByRole("listitem");
    expect(items).toHaveLength(5);
    LABELS.forEach((label) => expect(timeline.getByText(label)).toBeInTheDocument());
  });
});

// A step renders its "reached" marker as a check icon (an <svg>); a pending or active step
// renders a plain dot <span> with no svg. So an svg inside the step's dot column is the
// signal that the step reads as done.
const isReached = (item: HTMLElement) => item.querySelector("svg") != null;

describe("OrderTimeline Seen step reached-state", () => {
  it("shows Seen as pending (not reached) on an issued-but-unseen order, while Awaiting countersign is active", () => {
    const timeline = renderTimeline({ status: "issued", issuedAt: "2026-01-12T10:00:00Z", seenAt: null });
    // Seen has no timestamp yet -- it never rendered a "reached" checkmark just
    // because its index sits before the active step.
    const seenItem = timeline.getByText("Seen").closest("li") as HTMLElement;
    expect(seenItem).not.toBeNull();
    expect(isReached(seenItem)).toBe(false);
    // No timestamp under "Seen" while unseen.
    expect(within(seenItem).queryByText(/\d{4}/)).not.toBeInTheDocument();
  });

  it("shows Seen as reached with its timestamp once seenAt is set, even while Awaiting countersign stays active", () => {
    const timeline = renderTimeline({
      status: "issued",
      issuedAt: "2026-01-12T10:00:00Z",
      seenAt: "2026-01-13T08:15:00Z",
    });
    const seenItem = timeline.getByText("Seen").closest("li") as HTMLElement;
    expect(isReached(seenItem)).toBe(true);
    expect(within(seenItem).getByText(/2026/)).toBeInTheDocument();
    // Awaiting countersign is still the live step for an issued order.
    expect(timeline.getByText("Awaiting countersign")).toBeInTheDocument();
  });

  it("marks Seen reached (but without a timestamp) on a countersigned order the artist never opened in-app (seenAt null)", () => {
    // A countersigned order has self-evidently moved past Seen: it must read as reached, not
    // as an unreached gap sandwiched between the done Issued step and the terminal
    // Countersigned step. Every pre-viewed_at order, and every manual-countersign flow, lands
    // here. The timestamp stays absent because viewed_at was never stamped.
    const timeline = renderTimeline({
      status: "countersigned",
      issuedAt: "2026-01-12T10:00:00Z",
      countersignedAt: "2026-01-14T08:00:00Z",
      seenAt: null,
    });
    const seenItem = timeline.getByText("Seen").closest("li") as HTMLElement;
    expect(isReached(seenItem)).toBe(true);
    expect(within(seenItem).queryByText(/\d{4}/)).not.toBeInTheDocument();
  });

  it("never marks Seen reached on a void order, even when a stale seenAt survives from before it was voided", () => {
    // A void order sits at active 0 (Created is live). Seen must not jump ahead of the
    // Issued step, which is itself not reached for a void order -- otherwise the timeline
    // shows a reached Seen above an unreached Issued.
    const timeline = renderTimeline({
      status: "void",
      issuedAt: "2026-01-12T10:00:00Z",
      seenAt: "2026-01-13T08:15:00Z",
    });
    const seenItem = timeline.getByText("Seen").closest("li") as HTMLElement;
    const issuedItem = timeline.getByText("Issued to artist").closest("li") as HTMLElement;
    expect(isReached(seenItem)).toBe(false);
    expect(isReached(issuedItem)).toBe(false);
  });
});

describe("OrderTimeline stepTimestamp / activeStepIndex mapping", () => {
  it("passes seenAt through as the Seen step's timestamp", () => {
    const timeline = renderTimeline({
      status: "issued",
      issuedAt: "2026-01-12T10:00:00Z",
      seenAt: "2026-01-13T08:15:00Z",
    });
    const seenItem = timeline.getByText("Seen").closest("li") as HTMLElement;
    expect(within(seenItem).getByText("13/01/2026")).toBeInTheDocument();
  });

  it("keeps Countersigned's own timestamp at the last step, unaffected by the Seen insertion", () => {
    const timeline = renderTimeline({
      status: "countersigned",
      issuedAt: "2026-01-12T10:00:00Z",
      countersignedAt: "2026-01-14T08:00:00Z",
      seenAt: "2026-01-13T08:15:00Z",
    });
    const countersignedItem = timeline.getByText("Countersigned").closest("li") as HTMLElement;
    expect(within(countersignedItem).getByText("14/01/2026")).toBeInTheDocument();
  });
});
