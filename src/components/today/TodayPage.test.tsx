import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/renderWithProviders";
import { TodayPage, type TodayPageProps } from "./TodayPage";
import type { AtRiskDate, CancelledUntoldDate, FeedRow, TodayModel } from "@/lib/autopilot/today";

function anAtRisk(overrides: Partial<AtRiskDate> = {}): AtRiskDate {
  return {
    kind: "at_risk",
    showDateId: "date-1",
    date: "2026-09-03",
    title: "Hamlet, Abend",
    where: "Thalia Theater, Hamburg",
    placesEmpty: 3,
    daysOut: 17,
    exhausted: false,
    nextCastName: "Ensemble Nord",
    nextCastFreeCount: 6,
    rosterCount: 14,
    rosterFreeCount: 9,
    nextTierNumber: 2,
    ...overrides,
  };
}

function aCancelled(overrides: Partial<CancelledUntoldDate> = {}): CancelledUntoldDate {
  return {
    kind: "cancelled_untold",
    showDateId: "date-2",
    date: "2026-08-28",
    title: "Hamlet, Matinee",
    where: "Thalia Theater, Hamburg",
    daysOut: 11,
    artistNames: ["Marek Kowal", "Tomás Ruiz"],
    ...overrides,
  };
}

function aFeedRow(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    id: "ask:date-1:1",
    kind: "ask",
    text: "Asked 3 artists about Hamlet, Abend, 3 Sep.",
    at: "Mon 09:00",
    affordance: "undo",
    bookingIds: [],
    ...overrides,
  };
}

function aModel(overrides: Partial<TodayModel> = {}): TodayModel {
  return {
    items: [],
    bounced: [],
    feed: [],
    openCount: 0,
    fillingOnTheirOwn: 12,
    bookedOvernight: 2,
    ...overrides,
  };
}

function noop() {
  /* test stub */
}

function baseProps(overrides: Partial<TodayPageProps> = {}): TodayPageProps {
  return {
    model: aModel(),
    askTimeLabel: "19:00",
    feedSinceLabel: "Friday",
    today: new Date("2026-08-17T09:00:00Z"),
    onOpenNextCast: noop,
    onOpenDate: noop,
    onTellCast: noop,
    onReadFirst: noop,
    onFixBounced: noop,
    onFeedAction: noop,
    onLookAtSeason: noop,
    ...overrides,
  };
}

describe("TodayPage", () => {
  it("renders the multi-item headline when there are open items", () => {
    const model = aModel({
      items: [anAtRisk(), aCancelled()],
      openCount: 2,
    });
    render(<TodayPage {...baseProps({ model })} />);

    expect(screen.getByRole("heading", { name: "2 things need a human" })).toBeInTheDocument();
  });

  it("renders the empty state when there are zero open items", () => {
    const model = aModel({ items: [], openCount: 0 });
    render(<TodayPage {...baseProps({ model })} />);

    expect(screen.getByRole("heading", { name: "Nothing needs you" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Look at the season anyway" })).toBeInTheDocument();
  });

  it("renders the bounced banner only when bounces exist", () => {
    const withoutBounces = render(
      <TodayPage {...baseProps({ model: aModel({ items: [anAtRisk()], openCount: 1, bounced: [] }) })} />,
    );
    expect(screen.queryByRole("button", { name: "Fix their addresses" })).not.toBeInTheDocument();
    withoutBounces.unmount();

    const withBounces = aModel({
      items: [anAtRisk()],
      openCount: 2,
      bounced: [
        {
          artistId: "artist-1",
          artistName: "Sofia Almeida",
          email: "sofia@example.com",
          showDateId: "date-3",
          dateLabel: "Die Zauberflöte on 12 Sep",
          bouncedAt: "2026-08-16T19:00:00Z",
        },
      ],
    });
    render(<TodayPage {...baseProps({ model: withBounces })} />);
    expect(screen.getByRole("button", { name: "Fix their addresses" })).toBeInTheDocument();
  });

  it("shows Review for a feed row past its digest and Undo for one still before it", () => {
    const model = aModel({
      feed: [
        aFeedRow({ id: "ask:date-1:1", affordance: "undo", text: "Undo-able ask" }),
        aFeedRow({ id: "ask:date-2:1", affordance: "review", text: "Already reviewed ask" }),
      ],
    });
    render(<TodayPage {...baseProps({ model })} />);

    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });
});
