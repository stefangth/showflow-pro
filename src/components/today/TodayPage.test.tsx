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
    count: 3,
    names: "",
    show: "Hamlet, Abend",
    date: "3 Sep",
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
    producerConfirmation: false,
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
    canBook: true,
    canAsk: true,
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
        aFeedRow({ id: "ask:date-1:1", affordance: "undo" }),
        aFeedRow({ id: "ask:date-2:1", affordance: "review" }),
      ],
    });
    render(<TodayPage {...baseProps({ model })} />);

    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  // Regression: the feed row and the header both asserted a booking ("Booked them
  // ... the place is theirs", "were booked overnight") for every org. In Classic
  // (producer_confirmation on) a yes is only a hold until the producer books it, so
  // the board was telling a producer a date was settled when it was still their move.
  it("says a said-yes date is still waiting on the producer when the org keeps the last word", () => {
    const model = aModel({
      producerConfirmation: true,
      openCount: 0,
      bookedOvernight: 2,
      feed: [aFeedRow({ id: "book:date-1", kind: "book", count: 1, names: "Lena Fischer" })],
    });
    render(<TodayPage {...baseProps({ model })} />);

    expect(
      screen.getByText("Lena Fischer said yes to Hamlet, Abend, 3 Sep. Book them and the place is theirs."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Autopilot cleared the board. 2 artists said yes overnight and are waiting on you to book them.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the booked wording where a yes books the artist on its own", () => {
    const model = aModel({
      producerConfirmation: false,
      openCount: 0,
      bookedOvernight: 2,
      feed: [aFeedRow({ id: "book:date-1", kind: "book", count: 1, names: "Lena Fischer" })],
    });
    render(<TodayPage {...baseProps({ model })} />);

    expect(
      screen.getByText("Booked Lena Fischer onto Hamlet, Abend, 3 Sep. They said yes, so the place is theirs."),
    ).toBeInTheDocument();
    expect(screen.getByText("Autopilot cleared the board. 2 artists were booked overnight.")).toBeInTheDocument();
  });

  // An "ask" row describes artists who were only offered, so it must never gain
  // said-yes wording from either flow.
  it("leaves an ask row as an ask in both flows", () => {
    for (const producerConfirmation of [true, false]) {
      const view = render(
        <TodayPage {...baseProps({ model: aModel({ producerConfirmation, feed: [aFeedRow()] }) })} />,
      );
      expect(screen.getByText("Asked 3 artists about Hamlet, Abend, 3 Sep.")).toBeInTheDocument();
      view.unmount();
    }
  });


  // Role/rights consistency: `confirm_bookings` and `run_offer_engine` are per-org
  // producer rights an admin can revoke (src/lib/capabilities.ts), and every other
  // booking surface already gates on them. A producer without them was still being
  // told the date was "waiting on you to book them" and handed an Open-the-cast
  // button that open-offer-tier rejects at the edge.
  it("names an admin, not the viewer, when the viewer may not book", () => {
    const model = aModel({
      producerConfirmation: true,
      openCount: 0,
      bookedOvernight: 2,
      feed: [aFeedRow({ id: "book:date-1", kind: "book", count: 1, names: "Lena Fischer" })],
    });
    render(<TodayPage {...baseProps({ model, canBook: false })} />);

    expect(
      screen.getByText("Lena Fischer said yes to Hamlet, Abend, 3 Sep. An admin has to book them."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Autopilot cleared the board. 2 artists said yes overnight and are waiting on an admin to book them.",
      ),
    ).toBeInTheDocument();
  });

  it("offers Undo only for a row the viewer is allowed to reverse", () => {
    const feed = [
      aFeedRow({ id: "ask:date-1:1", kind: "ask", affordance: "undo" }),
      aFeedRow({ id: "book:date-1", kind: "book", names: "Lena Fischer", count: 1, affordance: "undo" }),
    ];
    const allowed = render(<TodayPage {...baseProps({ model: aModel({ feed }) })} />);
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
    allowed.unmount();

    // Rights revoked: both rows stay readable, but neither offers a reversal that
    // could only 403.
    render(<TodayPage {...baseProps({ model: aModel({ feed }), canBook: false, canAsk: false })} />);
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Review" })).toHaveLength(2);
  });

  // Review finding: dropping "Open it up to X" left "Pick the people yourself" as
  // the promoted option for a viewer who cannot book either, and the body still
  // read "a decision only you can make". Both are the admin's, not theirs.
  it("hands an at-risk date to an admin when the viewer may neither ask nor book", () => {
    const model = aModel({ items: [anAtRisk()], openCount: 1 });
    render(<TodayPage {...baseProps({ model, canAsk: false, canBook: false })} />);

    expect(screen.queryByText("Pick the people yourself")).not.toBeInTheDocument();
    expect(screen.getByText("An admin has to take this one")).toBeInTheDocument();
    expect(screen.getByText(/It needs a decision an admin has to make/)).toBeInTheDocument();
    // Opening the date is a read they are allowed, so the way in stays.
    expect(screen.getByRole("button", { name: "Open the date" })).toBeInTheDocument();
  });

  it("does not offer to open the next cast to a viewer who may not run the offer engine", () => {
    const model = aModel({ items: [anAtRisk()], openCount: 1 });

    const allowed = render(<TodayPage {...baseProps({ model })} />);
    expect(screen.getByText("Open it up to Ensemble Nord")).toBeInTheDocument();
    allowed.unmount();

    render(<TodayPage {...baseProps({ model, canAsk: false })} />);
    expect(screen.queryByText("Open it up to Ensemble Nord")).not.toBeInTheDocument();
    // The card never goes blank: the read-only route into the date stays.
    expect(screen.getByText("Pick the people yourself")).toBeInTheDocument();
  });

});
