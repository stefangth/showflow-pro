import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

// The flow is held as a real, fully normalized BookingFlow (built from the shipped
// presets), not a one-field partial: TimingStep's narrative reads four flow fields, and a
// partial would silently give three of them `undefined` and prove nothing about production.
const { upsertOrgSetting, flowRef, timesRef, timesErrorRef, flowOrgSpy, timesOrgSpy } = vi.hoisted(() => ({
  upsertOrgSetting: vi.fn(() => Promise.resolve()),
  flowRef: { value: null as unknown },
  // Ref-held so a test can put the query back in its loading state (data
  // undefined), which is where the step used to offer a Save, or into its
  // error state, where data is undefined FOREVER.
  timesRef: { value: null as unknown },
  timesErrorRef: { value: null as Error | null },
  flowOrgSpy: vi.fn(),
  timesOrgSpy: vi.fn(),
}));
vi.mock("@/data/settings", () => ({ upsertOrgSetting }));
vi.mock("@/hooks/useBookingFlow", () => ({
  useFlowTimes: (orgId?: string | null) => {
    timesOrgSpy(orgId);
    return { data: timesRef.value, isError: Boolean(timesErrorRef.value), error: timesErrorRef.value };
  },
  useBookingFlow: (orgId?: string | null) => { flowOrgSpy(orgId); return { data: flowRef.value }; },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TimingStep } from "./TimingStep";
import { toast } from "sonner";
import { BOOKING_FLOW_DEFAULTS, applyPreset } from "@/lib/bookingFlow";

const CLASSIC = applyPreset(BOOKING_FLOW_DEFAULTS, "classic");

beforeEach(() => {
  timesRef.value = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
  timesErrorRef.value = null;
  upsertOrgSetting.mockClear();
  flowOrgSpy.mockClear();
  timesOrgSpy.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  flowRef.value = CLASSIC;
  timesRef.value = { windowHours: 48, offerDigestHour: 19, confirmationDigestHour: 20 };
});

describe("TimingStep", () => {
  it("reads the flow for the org it was handed, not for whatever org the shell is on", () => {
    // Everything else on this panel keys off the `orgId` prop: the hours come from
    // useFlowTimes(orgId), and the seed latch is reset by an effect on [orgId]. The flow
    // used to come from useBookingFlow(), which resolved its OWN org out of AuthContext.
    // Two independent org sources agreeing is not something the panel can assume when the
    // whole reason the reset exists is org-switch correctness: a window where they
    // disagreed would print one org's hours beside another org's flow, and the flow is what
    // decides whether the sentence is about a digest, an instant send, or nothing at all.
    renderWithProviders(<TimingStep orgId="org-9" onDone={() => {}} />);
    expect(flowOrgSpy).toHaveBeenCalledWith("org-9");
    expect(timesOrgSpy).toHaveBeenCalledWith("org-9");
  });

  it("saves the seeded values on a plain save", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /save timing/i }));
    await waitFor(() =>
      expect(upsertOrgSetting).toHaveBeenCalledWith(expect.anything(), "org-1", "offer_response_window_hours", 48),
    );
  });

  it("rejects a cleared window field instead of writing a 0-hour window", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    const windowInput = await screen.findByDisplayValue("48");
    fireEvent.change(windowInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save timing/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Enter an answer-by window of at least 1 hour, and daily send hours between 0 and 23."),
    );
    expect(upsertOrgSetting).not.toHaveBeenCalled();
  });

  it("narrates the pipeline from the seeded values", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(
      await screen.findByText(
        "When a round opens, asks go out in the next 19:00h (Berlin, Germany) send. Artists get 48 hours to answer, and bookings mail at 20:00h (Berlin, Germany).",
      ),
    ).toBeInTheDocument();
  });

  it("re-narrates as the fields are edited, before anything is saved", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    fireEvent.change(await screen.findByDisplayValue("19"), { target: { value: "8" } });
    fireEvent.change(screen.getByDisplayValue("48"), { target: { value: "24" } });
    expect(
      await screen.findByText(
        "When a round opens, asks go out in the next 08:00h (Berlin, Germany) send. Artists get 24 hours to answer, and bookings mail at 20:00h (Berlin, Germany).",
      ),
    ).toBeInTheDocument();
  });

  it("drops the narrative mid-edit rather than describing a cleared field", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    fireEvent.change(await screen.findByDisplayValue("19"), { target: { value: "" } });
    // Number("") is 0, so an unguarded parse would confidently announce a 00:00 digest.
    await waitFor(() => expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument());
  });

  // Both reads land after first paint, and this panel is mounted cold: SetupStepRow only
  // mounts an expanded row's children, and the dashboard opens the sheet straight onto a
  // chosen step. So the un-resolved render is a real screen, not a theoretical one.
  it("says nothing while the flow is still being read", async () => {
    flowRef.value = undefined;
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /save timing/i })).toBeInTheDocument();
    // A default flow here would announce the classic digest pipeline to a direct-book or
    // paused org for as long as the settings read takes.
    expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/asks email straight away/)).not.toBeInTheDocument();
  });

  it("withholds the whole panel while the org's own hours are still being read", async () => {
    timesRef.value = undefined;
    const { container } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    // Stronger than falling silent: while there is nothing to derive from, the platform
    // defaults must not be on screen as if they were this org's own, and a Save here
    // would write 48/19/20 over the org's real hours. The skeleton withholds everything.
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument();
  });

  it("starts narrating once both reads land", async () => {
    timesRef.value = undefined;
    const { container, rerender } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    timesRef.value = { windowHours: 24, offerDigestHour: 8, confirmationDigestHour: 17 };
    rerender(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(
      await screen.findByText(
        "When a round opens, asks go out in the next 08:00h (Berlin, Germany) send. Artists get 24 hours to answer, and bookings mail at 17:00h (Berlin, Germany).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save timing/i })).toBeInTheDocument();
  });

  // The seeding latch is one-shot, so an org switch with this panel mounted (the org
  // switcher lives in the shell and does not unmount the page) used to leave the previous
  // org's hours in the fields while the sentence beneath them stated them as this org's
  // schedule. The flow half of that sentence IS re-read per org, so the two halves could
  // describe two different organizations at once.
  it("stops stating the previous org's hours after an org switch", async () => {
    const { rerender } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/next 19:00h \(Berlin, Germany\) send/)).toBeInTheDocument();

    timesRef.value = { windowHours: 24, offerDigestHour: 8, confirmationDigestHour: 17 };
    rerender(<TimingStep orgId="org-2" onDone={() => {}} />);

    expect(
      await screen.findByText(
        "When a round opens, asks go out in the next 08:00h (Berlin, Germany) send. Artists get 24 hours to answer, and bookings mail at 17:00h (Berlin, Germany).",
      ),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("24")).toBeInTheDocument();
  });

  it("falls silent, rather than carrying hours over, while the new org's are still unread", async () => {
    const { rerender } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/next 19:00h \(Berlin, Germany\) send/)).toBeInTheDocument();

    // The switched-to org has nothing cached yet: keeping the old sentence up would state
    // one org's schedule on another org's screen.
    timesRef.value = undefined;
    rerender(<TimingStep orgId="org-2" onDone={() => {}} />);

    await waitFor(() => expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument());
    // And nothing is on screen to carry over at all: the skeleton withholds the fields, so
    // no value from the previous org (nor a platform default) can be saved to the new one.
    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("24")).not.toBeInTheDocument();
  });

  it("says nothing about OFFERS to a direct-book org, and states the hour that does run", async () => {
    // The shipped "direct" preset keeps confirmation_digest on, so this org's artists are
    // mailed daily at confirmation_digest_hour_berlin. That is the only one of these three
    // fields it can act on, and it was the only one whose value the panel never stated.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    const { container } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /save timing/i })).toBeInTheDocument();
    expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Newly booked artists get the booking send at 20:00h (Berlin, Germany)."),
    ).toBeInTheDocument();
    // The scope note stays the single carrier of the timezone on this flow too.
    expect(container.textContent?.match(/Berlin/g) ?? []).toHaveLength(1);
  });

  it("keeps the confirmation hour explained for a direct-book org with the digest off", async () => {
    // No mail of any kind for this org, so the narrative stays silent. The panel must still
    // not read as three dead fields: `send-confirmation-digest` creates the in-app
    // schedule_change notifications ABOVE its confirmation_digest check and is not gated on
    // artist_acceptance, so this hour is when a cancellation reaches a booked artist.
    flowRef.value = { ...applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), confirmation_digest: false };
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/The booking send hour still runs/)).toBeInTheDocument();
    expect(screen.getByText(/notified of schedule changes in the app/)).toBeInTheDocument();
    expect(screen.queryByText(/booking send at/)).not.toBeInTheDocument();
    expect(screen.queryByText(/none of these hours change anything/)).not.toBeInTheDocument();
  });

  it("says nothing at all while the flow is paused", async () => {
    // The "off" preset: send-offer-digest skips the org entirely, so promising a digest
    // on this very screen would be the plainest possible lie.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByRole("button", { name: /save timing/i })).toBeInTheDocument();
    expect(screen.queryByText(/When a round opens/)).not.toBeInTheDocument();
  });

  // The panel's fixed helper line is gone: it described the classic digest deadline as if
  // every org ran it, so it contradicted the narrative directly beneath it at a fast-track
  // org and stood alone, wrong, at a direct-book one.
  it("never prints the flow-blind digest deadline line", async () => {
    for (const preset of ["classic", "fasttrack", "direct", "off"] as const) {
      flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, preset);
      const { unmount } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
      expect(await screen.findByRole("button", { name: /save timing/i })).toBeInTheDocument();
      expect(screen.queryByText(/has until that hour/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("narrates no flow without an org, whatever the platform default resolves to", async () => {
    // `useBookingFlow` has no `enabled` gate, so with a null org fetchBookingFlow still runs
    // and resolveOrgSetting reads the PLATFORM DEFAULT row, with normalizeBookingFlow
    // falling back to BOOKING_FLOW_DEFAULTS. That is a truthy, offers-shaped flow belonging
    // to no org, and the scope note's unknown-flow branch exists precisely so this panel
    // never describes a pipeline it has not read for the org in front of it.
    flowRef.value = { ...BOOKING_FLOW_DEFAULTS, artist_acceptance: false, confirmation_digest: false };
    renderWithProviders(<TimingStep orgId={null} onDone={() => {}} />);
    expect(await screen.findByText("Daily send times include their timezone.")).toBeInTheDocument();
    expect(screen.queryByText(/You book artists directly/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The booking send hour still runs/)).not.toBeInTheDocument();
  });

  it("keeps the timezone on screen under every flow", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/Daily send times include their timezone/)).toBeInTheDocument();
  });

  it("names the timezone once, not on every line that states an hour", async () => {
    // The scope note is the single carrier: it renders under every flow and covers the
    // three hour inputs as well as the sentence below it, so a "Berlin" in the narrative
    // too is the word twice on one small panel. Checked on both shipped presets that reach
    // this "When a round opens" sentence — classic and autopilot (the fasttrack preset) —
    // and both now deliver by digest (autopilot/fasttrack switched from immediate to
    // digest), so both state the offer hour AND the confirmation hour: two "Berlin"
    // mentions each, one per clock time. The single-vs-double contrast this loop used to
    // draw between digest and immediate delivery is covered at the unit level instead, in
    // timingCopy.test.ts's hand-configured immediateFlow, since no shipped preset reaches
    // that branch anymore. (The direct-book sentence is held to the same rule in its own
    // test above, which cannot join this loop because it deliberately prints no "When a
    // tier opens" line to wait on.)
    for (const preset of ["classic", "fasttrack"] as const) {
      flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, preset);
      const { container, unmount } = renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
      expect(await screen.findByText(/When a round opens/)).toBeInTheDocument();
      expect(container.textContent?.match(/Berlin/g) ?? []).toHaveLength(2);
      unmount();
    }
  });

  it("tells a direct-book org that two of these three fields do nothing", async () => {
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "direct");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/You book artists directly/)).toBeInTheDocument();
    expect(screen.getByText(/change nothing/)).toBeInTheDocument();
  });

  it("tells a paused org that these fields are inert, without claiming the app goes quiet", async () => {
    // Hire-order issue mail, org invitations and chat notifications all keep sending with
    // the booking flow off, so the claim is scoped to the three inputs above it.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "off");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(
      await screen.findByText(/These hours change nothing while the booking flow is off/),
    ).toBeInTheDocument();
  });

  it("promises a digest to an autopilot org, which now mails at the digest hour, not at tier open", async () => {
    // The fasttrack preset (labeled "Autopilot" in the UI) switched offer_delivery from
    // "immediate" to "digest", so it now runs the same digest pipeline as classic instead
    // of mailing offers the instant a tier opens.
    flowRef.value = applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/asks go out in the next 19:00h \(Berlin, Germany\) send/)).toBeInTheDocument();
    expect(screen.queryByText(/asks email straight away/)).not.toBeInTheDocument();
  });

  it("drops the confirmation clause when the confirmation digest is off", async () => {
    flowRef.value = { ...CLASSIC, confirmation_digest: false };
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    expect(await screen.findByText(/When a round opens/)).toBeInTheDocument();
    expect(screen.queryByText(/bookings mail/)).not.toBeInTheDocument();
    // But the "Confirmations" input is still on screen and still drives the in-app
    // schedule-change notifications, so it may not be left standing unexplained.
    expect(screen.getByText(/The booking send hour still runs/)).toBeInTheDocument();
  });

  it("rejects a digest hour outside 0..23", async () => {
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);
    const offerInput = await screen.findByDisplayValue("19");
    fireEvent.change(offerInput, { target: { value: "24" } });
    fireEvent.click(screen.getByRole("button", { name: /save timing/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Enter an answer-by window of at least 1 hour, and daily send hours between 0 and 23."),
    );
    expect(upsertOrgSetting).not.toHaveBeenCalled();
  });

  // The worst instance of the seed-once pattern in the tree, because this step had no
  // loading gate at all: the three inputs rendered pre-filled with BOOKING_ENGINE
  // defaults (48 / 19 / 20) and Save was enabled for the WHOLE fetch, not one commit.
  // An org running a 72h window that opened the rail and hit Save before the read
  // landed had its real timing replaced by the code defaults, with nothing on screen
  // to suggest the values shown were not its own.
  it("offers no Save while the org's stored timing is still loading", () => {
    timesRef.value = undefined;
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);

    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("48")).not.toBeInTheDocument();
  });

  // The step is reachable with no active org (a super-admin bypasses the org gate),
  // where the query never runs and so never resolves. That must not be an eternal
  // skeleton - Save is already disabled without an org.
  it("still renders without an active org, where the query never runs", () => {
    timesRef.value = undefined;
    renderWithProviders(<TimingStep orgId={null} onDone={() => {}} />);

    expect(screen.getByRole("button", { name: /save timing/i })).toBeDisabled();
  });

  // Withholding the panel until the read lands turns a failed read into an
  // indefinite skeleton, because `data` stays undefined once React Query has
  // exhausted its retries -- a silent dead end in the rail with nothing to explain
  // it. The siblings fixed alongside this one (LetterheadStep, CountersignStep)
  // already show an alert for the same case.
  it("surfaces the failed read instead of holding the skeleton forever", () => {
    timesRef.value = undefined;
    timesErrorRef.value = new Error("permission denied");
    renderWithProviders(<TimingStep orgId="org-1" onDone={() => {}} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load the timing/i);
    expect(screen.getByRole("alert")).toHaveTextContent("permission denied");
    expect(screen.queryByRole("button", { name: /save timing/i })).not.toBeInTheDocument();
  });
});
