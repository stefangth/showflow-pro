import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CockpitCastList, type CastGroup, type CastRow } from "./CockpitCastList";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";
import i18n from "@/i18n";
import { softBookedMeaning } from "@/lib/bookings/actionCopy";

const classic = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");

function acceptedGroups(overrides: Partial<CastRow> = {}): CastGroup[] {
  return [
    {
      key: "main",
      title: "Main cast",
      count: "0 of 1",
      rows: [
        {
          id: "b1",
          name: "Ada Lovelace",
          meta: "Tier 1 · accepted",
          tone: "violet",
          status: "accepted",
          onConfirm: vi.fn(),
          onCancel: vi.fn(),
          ...overrides,
        },
      ],
    },
  ];
}

describe("CockpitCastList confirm consequence line", () => {
  it("renders the resolved-hour consequence line once when a row is awaiting confirm", () => {
    renderWithProviders(
      <CockpitCastList groups={acceptedGroups()} flow={classic} bookingFlowEnabled confirmationDigestHour={21} />,
    );
    expect(screen.getByText(/goes out in the daily send at 21:00h \(Berlin, Germany\)/)).toBeInTheDocument();
  });

  it("renders nothing about Confirm when no row is awaiting it", () => {
    const groups: CastGroup[] = [
      {
        key: "main",
        title: "Main cast",
        count: "1 of 1",
        rows: [{ id: "b1", name: "Ada Lovelace", meta: "confirmed", tone: "green", status: "confirmed" }],
      },
    ];
    renderWithProviders(
      <CockpitCastList groups={groups} flow={classic} bookingFlowEnabled confirmationDigestHour={21} />,
    );
    expect(screen.queryByText(/Book gives them the place/)).not.toBeInTheDocument();
  });

  it("still states the bare consequence when the flow is paused", () => {
    const off = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
    renderWithProviders(
      <CockpitCastList groups={acceptedGroups()} flow={off} bookingFlowEnabled confirmationDigestHour={21} />,
    );
    expect(screen.getByText("Book gives them the place.")).toBeInTheDocument();
  });

  it("states only the bare consequence when the org has no booking_flow entitlement, even with the flow active and the confirmation digest on", () => {
    // Same bug class as the per-row cancel dialog's who-hears line: a super-admin viewing an
    // org without the booking_flow entitlement must not see a promise about a digest email
    // that the entitlement-gated send-confirmation-digest cron will never send.
    renderWithProviders(
      <CockpitCastList groups={acceptedGroups()} flow={classic} bookingFlowEnabled={false} confirmationDigestHour={21} />,
    );
    expect(screen.getByText("Book gives them the place.")).toBeInTheDocument();
    expect(screen.queryByText(/daily send/)).not.toBeInTheDocument();
  });
});

describe("CockpitCastList Accepted badge tooltip", () => {
  it("carries the soft-booked meaning as a tooltip on the Accepted badge", async () => {
    // TooltipProvider delayDuration=0 nested inside renderWithProviders' own provider so the
    // tooltip opens without waiting on Radix's default 700ms hover delay.
    renderWithProviders(
      <TooltipProvider delayDuration={0}>
        <CockpitCastList groups={acceptedGroups()} flow={classic} bookingFlowEnabled confirmationDigestHour={21} />
      </TooltipProvider>,
    );
    // Radix opens a tooltip from pointermove on the trigger, not mouseover/mouseenter, and
    // renders the visible bubble plus a visually-hidden copy, hence findAllByText.
    fireEvent.pointerMove(screen.getByText("Said yes"), { pointerType: "mouse" });
    expect(await screen.findAllByText(softBookedMeaning(i18n.getFixedT("en", "bookingCopy")))).not.toHaveLength(0);
  });
});

describe("CockpitCastList per-row cancel confirmation", () => {
  it("opens a confirmation dialog naming the artist, the understudy line, and the who-hears line before cancelling", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <CockpitCastList
        groups={acceptedGroups({ onCancel })}
        flow={{ ...classic, understudy_promotion: true }}
        bookingFlowEnabled
        confirmationDigestHour={21}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByText("Cancel Ada Lovelace's booking?")).toBeInTheDocument();
    expect(
      screen.getByText(/If Ada Lovelace is in the main cast, the understudy who has been waiting longest and said yes moves up automatically\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/goes out in the daily send at 21:00h \(Berlin, Germany\)/)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Keep booking" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByText("Cancel Ada Lovelace's booking?")).not.toBeInTheDocument();
  });

  it("keeps the Cancel affordance on a booked row even when it arrives without a name, falling back to generic copy", () => {
    // Regression: the Cancel button + dialog used to be gated on the cancel COPY being
    // non-null, and the copy was only built when `row.name` was present. A booked row with
    // an onCancel handler but no name (defensive: booked rows normally always have one)
    // therefore silently lost its Cancel control. The affordance now keys on `onCancel`
    // alone, and the copy degrades to a generic name.
    const onCancel = vi.fn();
    renderWithProviders(
      <CockpitCastList
        groups={acceptedGroups({ name: undefined, onCancel })}
        flow={classic}
        bookingFlowEnabled
        confirmationDigestHour={21}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cancel this artist's booking?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("omits the understudy line when understudy promotion is off, and fires cancel only on explicit confirm", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <CockpitCastList
        groups={acceptedGroups({ onCancel })}
        flow={{ ...classic, understudy_promotion: false }}
        bookingFlowEnabled
        confirmationDigestHour={21}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText(/waiting longest and said yes moves up/)).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// C1 regression: DevCockpitHarness.tsx (a dev-only fixture harness, outside this WP's file
// list) calls `<CockpitCastList groups={CAST_GROUPS} />` with none of the flow/entitlement
// props — that call site has to keep type-checking and, independent of the type system,
// must not throw when `Row` reads `flow.active` for every row.
describe("CockpitCastList with no flow/entitlement props (mirrors DevCockpitHarness's call site)", () => {
  it("renders without throwing, and degrades to the flow-off-safe defaults", async () => {
    let result: ReturnType<typeof renderWithProviders> | undefined;
    expect(() => {
      result = renderWithProviders(<CockpitCastList groups={acceptedGroups()} />);
    }).not.toThrow();
    // Defaults to BOOKING_FLOW_DEFAULTS (active, confirmation_digest on) rather than any
    // stripped-down "no flow" shape, so the consequence line still states something honest.
    expect(result).toBeDefined();
    expect(screen.getByText(/Book gives them the place/)).toBeInTheDocument();

    // The Cancel dialog also has to build without a real flow/entitlement: bookingFlowEnabled
    // defaults to false (fail closed), so cancelBookingCopy falls back to the plain in-app
    // claim rather than ever fabricating a digest-email sentence with no real hour behind it.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Cancel Ada Lovelace's booking?")).toBeInTheDocument();
    // The default flow (BOOKING_FLOW_DEFAULTS) still has understudy_promotion on, so that
    // line is present too; the string this test cares about is the who-hears fallback.
    // Scoped to the dialog since the confirm consequence line above the list also renders
    // its own (now equally bookingFlowEnabled-gated, defaulting-false-here) sentence, and an
    // unscoped query should not accidentally match text outside the dialog under test.
    expect(within(dialog).getByText(/The artist is notified in the app\./)).toBeInTheDocument();
    expect(within(dialog).queryByText(/session times/i)).not.toBeInTheDocument();
  });
});
