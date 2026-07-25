import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as HireOrdersPage.test.tsx: a call-recording fake swapped into a
// hoisted holder (never a hand-rolled vi.mock chain). NewOrderWizard takes orgId
// as a PROP (not from useAuth), so only the supabase client and react-router
// navigation need mocking here.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
const navigate = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { NewOrderWizard } from "./NewOrderWizard";

const ORG = "org-1";

const ARTISTS = [
  { id: "a1", name: "Ann Artist", email: "ann@example.com" },
  { id: "a2", name: "Ben Booker", email: "ben@example.com" },
];

const SHOW_DATES = [
  {
    id: "sd1", date: "2026-03-01", venue: "Main Hall", duration_minutes: 90,
    session_1: "19:00", session_2: null, session_3: "22:00", cities: { name: "Berlin" },
  },
  {
    id: "sd2", date: "2026-03-02", venue: "Harbour Stage", duration_minutes: 75,
    session_1: "20:00", session_2: null, session_3: null, cities: { name: "Hamburg" },
  },
];

function seedDefault(extra: Record<string, TableSeed> = {}) {
  seedClient({
    artists: { data: ARTISTS, error: null },
    show_dates: { data: SHOW_DATES, error: null },
    app_settings: { data: [{ org_id: ORG, value: { default_fee: null, currency: "USD" } }], error: null },
    "fn:generate-hire-orders": { data: { created: ["ho-new-1"] }, error: null },
    ...extra,
  });
}

function invokeCalls() {
  const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
  const recorded = calls
    .filter((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke")
    .map((c) => c.args[0] as Record<string, unknown>);
  if (recorded.length > 0) return recorded;
  const invoke = (client as unknown as { functions?: { invoke?: ReturnType<typeof vi.fn> } }).functions?.invoke;
  return (invoke?.mock.calls ?? []).map((call) => (call[1] as { body: Record<string, unknown> }).body);
}

function renderWizard(props: Partial<{ open: boolean; onOpenChange: (o: boolean) => void; orgId: string | null }> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const utils = renderWithProviders(
    <NewOrderWizard open={props.open ?? true} onOpenChange={onOpenChange} orgId={props.orgId ?? ORG} />,
  );
  return { ...utils, onOpenChange };
}

// Radix Popover's dismissable-layer cleanup (from closing one combobox) is an
// effect that flushes on a later tick — opening a SECOND Popover-based combobox
// in the same synchronous test step can race that cleanup and swallow the next
// item's click. A macrotask flush between picks lets the cleanup settle first.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

async function pickArtist(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
  await flush();
}

async function pickShowDate(labelSubstring: string) {
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  fireEvent.click(await screen.findByText(new RegExp(labelSubstring, "i")));
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  fireEvent.click(screen.getByRole("button", { name: /reset all to selected dates/i }));
  await flush();
}

async function selectArtists(...names: string[]) {
  fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
  for (const name of names) fireEvent.click(await screen.findByText(name));
  fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
  await flush();
}

async function selectCommonDates(...labels: string[]) {
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  for (const label of labels) {
    fireEvent.click(await screen.findByText(new RegExp(label, "i")));
  }
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  fireEvent.click(screen.getByRole("button", { name: /reset all to selected dates/i }));
  await flush();
}

async function selectCommonDatesWithoutApplying(...labels: string[]) {
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  for (const label of labels) {
    fireEvent.click(await screen.findByText(new RegExp(label, "i")));
  }
  fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
  await flush();
}

function clickContinue() {
  fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
}

async function reachReviewWithFee(fee = "1200") {
  clickContinue();
  fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: fee } });
  clickContinue();
  clickContinue();
  await screen.findByRole("button", { name: /save as draft/i });
}

// Render the wizard, select artists + common dates (applied to all by default,
// same as selectCommonDates), then optionally uncheck specific artist/date
// matrix cells so callers can set up unequal per-artist date counts. Lands on
// step 2 (Fees and deposit) with the fee field ready. Built from the existing
// selectArtists/selectCommonDates/clickContinue helpers above, not a
// reimplementation of them.
async function openWizardAtStep2({
  artists,
  dates,
  assignments,
}: {
  artists: string[];
  dates: string[];
  assignments?: Record<string, string[]>;
}) {
  renderWizard();
  await selectArtists(...artists);
  await selectCommonDates(...dates);
  if (assignments) {
    for (const artistName of artists) {
      const keep = new Set(assignments[artistName] ?? dates);
      for (const dateLabel of dates) {
        if (!keep.has(dateLabel)) {
          fireEvent.click(
            screen.getByRole("checkbox", { name: new RegExp(`${artistName}.*${dateLabel}`, "i") }),
          );
        }
      }
    }
  }
  clickContinue();
  await screen.findByLabelText(/engagement fee/i);
}

// Walk a single linked artist+date through to step 4 and save it as a draft,
// mirroring the manual step sequence in "walks a linked artist+date through to
// review…" below. Returns the recorded generate-hire-orders request body.
async function completeWizard({ fee }: { fee: string }) {
  renderWizard();
  await pickArtist("Ann Artist");
  await pickShowDate("Berlin");
  clickContinue();
  fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: fee } });
  clickContinue();
  clickContinue();
  fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
  await waitFor(() => expect(invokeCalls().length).toBe(1));
  return invokeCalls()[0];
}

// Continue from openWizardAtStep2's step-2 landing through step 3 (nothing
// there gates Continue) to step 4, entering the fee - and, when given,
// switching the fee basis - along the way.
async function openWizardAtStep4(options: {
  artists: string[];
  dates: string[];
  assignments?: Record<string, string[]>;
  fee: string;
  basis?: "per_date" | "total";
}) {
  await openWizardAtStep2(options);
  fireEvent.change(screen.getByLabelText(/engagement fee/i), { target: { value: options.fee } });
  if (options.basis === "total") {
    fireEvent.click(screen.getByLabelText(/fee basis/i));
    fireEvent.click(await screen.findByRole("option", { name: /total for all dates/i }));
  }
  clickContinue();
  clickContinue();
  await screen.findByRole("button", { name: /save as draft/i });
}

describe("NewOrderWizard", () => {
  beforeEach(() => {
    navigate.mockClear();
    seedDefault();
  });

  it("renders the four steps in order with a stepper, and disables Back on step 1", () => {
    renderWizard();
    expect(screen.getByText("Confirm engagement")).toBeInTheDocument();
    expect(screen.getByText("Fees and deposit")).toBeInTheDocument();
    expect(screen.getByText("Running order")).toBeInTheDocument();
    expect(screen.getByText("Review and issue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^back$/i })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/[—–]/);
  });

  it("picking No linked date switches step 1 to manual date/venue/city inputs", () => {
    renderWizard();
    expect(screen.getByRole("combobox", { name: /select artist/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /no linked date/i }));
    expect(screen.queryByRole("combobox", { name: /select artist/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/artist name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/recipient email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^venue$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^city$/i)).toBeInTheDocument();
  });

  it("keeps Continue disabled on step 1 until every artist has an applied date", async () => {
    renderWizard();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await pickArtist("Ann Artist");
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await pickShowDate("Berlin");
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  });

  it("walks a linked artist+date through to review, then saves a draft with the right payload", async () => {
    renderWizard();

    // Step 1: pick artist + date.
    await pickArtist("Ann Artist");
    await pickShowDate("Berlin");
    clickContinue();

    // Step 2: fee/currency (currency defaulted from org settings to USD).
    expect(await screen.findByLabelText(/engagement fee/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/engagement fee/i), { target: { value: "1200" } });
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent("$1,200.00 per date");
    clickContinue();

    // Step 3: the linked date seeds an editable per-date running order.
    expect(await screen.findByLabelText(/session 1 time/i)).toHaveValue("19:00");
    expect(screen.getByLabelText(/session 2 time/i)).toHaveValue("22:00");
    expect(screen.getByLabelText(/duration/i)).toHaveValue(90);
    fireEvent.change(screen.getByLabelText(/session 1 label/i), { target: { value: "Main set" } });
    clickContinue();

    // Step 4: review + submit.
    expect(await screen.findByRole("button", { name: /save as draft/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue and send to artist/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));

    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    expect(body.action).toBe("draft-batch");
    expect(body.org_id).toBe(ORG);
    expect(body.artists).toEqual([{ artist_id: "a1", show_date_ids: ["sd1"] }]);
    const manual = body.manual as Record<string, unknown>;
    expect(manual.fee).toBe(1200);
    expect(manual.currency).toBe("USD");
    // Sessions + duration are per-date overrides now, not in the shared manual dict.
    expect(manual.duration_min).toBeUndefined();
    expect(manual.sessions).toBeUndefined();
    // Only the edited date is overridden; session 1 gained a "Main set" label, and
    // its duration was untouched (90 == synced) so no duration_min in the override.
    expect(body.date_overrides).toEqual({ sd1: { sessions: ["Main set 19:00", "22:00"] } });

    // Success screen.
    expect(await screen.findByText(/hire order created/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open order/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue now/i })).toBeInTheDocument();
  });

  it("creates a fully manual engagement with every provided field in the manual dict, unlinked", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /no linked date/i }));
    fireEvent.change(screen.getByLabelText(/artist name/i), { target: { value: "Walk-in Artist" } });
    fireEvent.change(screen.getByLabelText(/recipient email/i), { target: { value: "walkin@example.com" } });
    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^venue$/i), { target: { value: "The Loft" } });
    fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: "Hamburg" } });
    clickContinue();

    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "500" } });
    clickContinue();

    // Step 3: no linked date -> manual session rows, max 3.
    expect(await screen.findByLabelText(/session 1 time/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/session 1 time/i), { target: { value: "20:00" } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: "45" } });
    clickContinue();

    fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    expect(body.action).toBe("draft-manual");
    expect(body.artist_id).toBeUndefined();
    expect(body.show_date_id).toBeUndefined();
    const manual = body.manual as Record<string, unknown>;
    expect(manual.artist_name).toBe("Walk-in Artist");
    expect(manual.recipient_email).toBe("walkin@example.com");
    expect(manual.date).toBe("2026-08-01");
    expect(manual.venue).toBe("The Loft");
    expect(manual.city).toBe("Hamburg");
    expect(manual.fee).toBe(500);
    expect(manual.duration_min).toBe(45);
    expect(manual.sessions).toEqual(["20:00"]);
  });

  it("Issue and send to artist drafts then issues, and the success screen hides Issue now", async () => {
    seedDefault({ "fn:generate-hire-orders": { data: { created: ["ho-new-2"], issued: ["ho-new-2"], failed: [] }, error: null } });
    renderWizard();
    await pickArtist("Ann Artist");
    await pickShowDate("Berlin");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "800" } });
    clickContinue();
    clickContinue();
    fireEvent.click(await screen.findByRole("button", { name: /issue and send to artist/i }));

    await waitFor(() => expect(invokeCalls().length).toBe(2));
    expect(invokeCalls()[0].action).toBe("draft-batch");
    expect(invokeCalls()[1]).toMatchObject({ action: "issue", org_id: ORG, order_ids: ["ho-new-2"] });

    expect(await screen.findByText(/hire order created/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open order/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /issue now/i })).not.toBeInTheDocument();
  });

  it("still shows the success screen with Issue now when the draft succeeds but the follow-up issue call fails", async () => {
    seedDefault();
    // Override functions.invoke directly so the two sequential calls diverge
    // (the seed harness only supports one static response per function name).
    (client as unknown as { functions: { invoke: ReturnType<typeof vi.fn> } }).functions = {
      invoke: vi.fn()
        .mockResolvedValueOnce({ data: { created: ["ho-new-3"] }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: "network down" } }),
    };
    renderWizard();
    await pickArtist("Ann Artist");
    await pickShowDate("Berlin");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "800" } });
    clickContinue();
    clickContinue();
    fireEvent.click(await screen.findByRole("button", { name: /issue and send to artist/i }));

    // The draft succeeded, so the user still lands on the success screen (not
    // stuck on step 4) and can retry issuing from there.
    expect(await screen.findByText(/hire order created/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /issue now/i })).toBeInTheDocument();
  });

  it("retries only unissued orders and retains partial issue success across attempts", async () => {
    (client as unknown as { functions: { invoke: ReturnType<typeof vi.fn> } }).functions = {
      invoke: vi.fn()
        .mockResolvedValueOnce({
          data: { created: ["ho-new-1", "ho-new-2"] },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            issued: ["ho-new-1"],
            failed: [{ order_id: "ho-new-2", issues: ["missing_terms"] }],
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { issued: ["ho-new-2"], failed: [] },
          error: null,
        }),
    };
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin");
    await reachReviewWithFee();

    fireEvent.click(screen.getByRole("button", { name: /issue and send to artist/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(2));
    expect(invokeCalls()[1]).toMatchObject({
      action: "issue",
      order_ids: ["ho-new-1", "ho-new-2"],
    });
    fireEvent.click(await screen.findByRole("button", { name: /issue now/i }));

    await waitFor(() => expect(invokeCalls().length).toBe(3));
    expect(invokeCalls()[2]).toMatchObject({
      action: "issue",
      order_ids: ["ho-new-2"],
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /issue now/i })).not.toBeInTheDocument();
    });
  });

  it("Open order navigates to the hire order detail route with the created id", async () => {
    renderWizard();
    await pickArtist("Ann Artist");
    await pickShowDate("Berlin");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "300" } });
    clickContinue();
    clickContinue();
    fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open order/i }));
    expect(navigate).toHaveBeenCalledWith("/hire-orders/ho-new-1");
  });

  it("creates one batch payload row per selected artist with its checked dates", async () => {
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin", "Hamburg");

    fireEvent.click(screen.getByRole("checkbox", { name: /ben booker.*hamburg/i }));
    await reachReviewWithFee();

    const annReview = screen.getByRole("group", { name: /ann artist dates/i });
    expect(within(annReview).getByText(/berlin/i)).toBeInTheDocument();
    expect(within(annReview).getByText(/hamburg/i)).toBeInTheDocument();
    const benReview = screen.getByRole("group", { name: /ben booker dates/i });
    expect(within(benReview).getByText(/berlin/i)).toBeInTheDocument();
    expect(within(benReview).queryByText(/hamburg/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    expect(invokeCalls()[0]).toMatchObject({
      action: "draft-batch",
      org_id: ORG,
      artists: [
        { artist_id: "a1", show_date_ids: ["sd1", "sd2"] },
        { artist_id: "a2", show_date_ids: ["sd1"] },
      ],
    });
  });

  it("removes a deselected common date from every artist assignment", async () => {
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin", "Hamburg");

    fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
    fireEvent.click(await screen.findByRole("option", { name: /hamburg/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));

    expect(screen.queryByRole("checkbox", { name: /hamburg/i })).not.toBeInTheDocument();
    await reachReviewWithFee();
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    expect(invokeCalls()[0].artists).toEqual([
      { artist_id: "a1", show_date_ids: ["sd1"] },
      { artist_id: "a2", show_date_ids: ["sd1"] },
    ]);
  });

  it("keeps a re-added date in append order on both selectedShowDateIds and the artist's own assignment", async () => {
    // Regression for the functional-update fix: select A, select B, deselect
    // A, reselect A. Since both setters now only ever append (never read a
    // precomputed sibling value), the reselected date A must land at the END
    // on both selectedShowDateIds (checked via the matrix's column order) and
    // Ann Artist's own assignment (checked via the actual submitted
    // show_date_ids), i.e. [B, A] on both sides - not just one.
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDatesWithoutApplying("Berlin", "Hamburg"); // A, then B

    // Deselect A (Berlin) via the common date picker - the same deselect path
    // toggleShowDate takes in normal use.
    fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
    fireEvent.click(await screen.findByRole("option", { name: /berlin/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /select show date/i }));
    await flush();

    // Reselect A (Berlin): it is appended at the end of both arrays.
    await selectCommonDatesWithoutApplying("Berlin");

    // selectedShowDateIds order, read off the matrix's column headers.
    const headers = screen.getAllByRole("columnheader");
    expect(headers[1]).toHaveTextContent(/hamburg/i);
    expect(headers[2]).toHaveTextContent(/berlin/i);

    // artistDateIds["a1"] order, read off the actual submitted payload.
    await reachReviewWithFee();
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    expect(invokeCalls()[0].artists).toEqual([
      { artist_id: "a1", show_date_ids: ["sd2", "sd1"] },
    ]);
  });

  it("seeds a per-date running order when a date is assigned directly in the matrix", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    // Selecting a date now auto-assigns it to every already-selected artist, so
    // the checkbox starts checked. Round-trip through BOTH branches of direct
    // matrix assignment (toggleArtistDate) - uncheck, then recheck - asserting
    // the intermediate unchecked/disabled state so a no-op toggle could not
    // pass this test silently.
    await selectCommonDatesWithoutApplying("Berlin");
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: /ann artist.*berlin/i }));
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /ann artist.*berlin/i }));
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "900" } });
    clickContinue();

    expect(await screen.findByLabelText(/duration/i)).toHaveValue(90);
    expect(screen.getByLabelText(/session 1 time/i)).toHaveValue("19:00");
    expect(screen.getByLabelText(/session 2 time/i)).toHaveValue("22:00");
  });

  it("drops a de-assigned date's running order and sends no override for the untouched remainder", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");

    fireEvent.click(screen.getByRole("checkbox", { name: /ann artist.*berlin/i }));
    await reachReviewWithFee("700");

    // Only Hamburg remains, showing its own synced running order in review.
    expect(screen.getByText("75 min")).toBeInTheDocument();
    expect(screen.getByText("20:00")).toBeInTheDocument();
    expect(screen.queryByText("19:00 · 22:00")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    // Hamburg was never edited (its running order still matches sync), so no override
    // is sent, and the shared manual dict no longer carries sessions/duration.
    expect(body.date_overrides).toBeUndefined();
    const manual = body.manual as Record<string, unknown>;
    expect(manual.duration_min).toBeUndefined();
    expect(manual.sessions).toBeUndefined();
  });

  it("renders a per-date running order section for each selected date, prefilled from synced sessions", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "1000" } });
    clickContinue();

    const berlin = await screen.findByRole("group", { name: /berlin/i });
    const hamburg = screen.getByRole("group", { name: /hamburg/i });
    expect(within(berlin).getByLabelText(/session 1 time/i)).toHaveValue("19:00");
    expect(within(berlin).getByLabelText(/session 2 time/i)).toHaveValue("22:00");
    expect(within(berlin).getByLabelText(/duration/i)).toHaveValue(90);
    expect(within(hamburg).getByLabelText(/session 1 time/i)).toHaveValue("20:00");
    expect(within(hamburg).getByLabelText(/duration/i)).toHaveValue(75);

    // Each date's session controls carry a date-prefixed aria-label (mirroring the
    // `${label} running order` group label one level up), so a screen-reader user
    // can tell which date's "Session 1 time" they're on even without the DOM
    // grouping a sighted user relies on: querying the whole document (no `within`
    // scoping) by the date-qualified name still resolves exactly one element.
    expect(screen.getByLabelText(/berlin session 1 time/i)).toHaveValue("19:00");
    expect(screen.getByLabelText(/hamburg session 1 time/i)).toHaveValue("20:00");
  });

  it("copies one date's duration to every other date via 'Copy to all dates', leaving sessions intact", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "1000" } });
    clickContinue();

    const berlin = await screen.findByRole("group", { name: /berlin/i });
    const hamburg = screen.getByRole("group", { name: /hamburg/i });
    // Berlin syncs 90 min, Hamburg 75 min.
    expect(within(hamburg).getByLabelText(/duration/i)).toHaveValue(75);

    fireEvent.change(within(berlin).getByLabelText(/duration/i), { target: { value: "120" } });
    fireEvent.click(within(berlin).getByRole("button", { name: /copy to all dates/i }));

    // Every date now carries Berlin's 120; Hamburg's sessions are untouched.
    expect(within(hamburg).getByLabelText(/duration/i)).toHaveValue(120);
    expect(within(berlin).getByLabelText(/duration/i)).toHaveValue(120);
    expect(within(hamburg).getByLabelText(/session 1 time/i)).toHaveValue("20:00");
  });

  it("sends a date_overrides entry only for the date whose running order was edited", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "1000" } });
    clickContinue();

    const berlin = await screen.findByRole("group", { name: /berlin/i });
    fireEvent.change(within(berlin).getByLabelText(/session 1 time/i), { target: { value: "18:30" } });
    clickContinue();

    fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    expect(body.action).toBe("draft-batch");
    // Only sd1 changed (its first session time); sd2 stays untouched and absent.
    expect(body.date_overrides).toEqual({ sd1: { sessions: ["18:30", "22:00"] } });
    const manual = body.manual as Record<string, unknown>;
    expect(manual.duration_min).toBeUndefined();
    expect(manual.sessions).toBeUndefined();
  });

  it("sends only duration_min when a date's duration is edited but its sessions are untouched", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "1000" } });
    clickContinue();

    const berlin = await screen.findByRole("group", { name: /berlin/i });
    fireEvent.change(within(berlin).getByLabelText(/duration/i), { target: { value: "100" } });
    clickContinue();

    fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    // Only duration changed (sessions still match the synced baseline), so the
    // override for sd1 must carry duration_min and NOT a sessions key; sd2 was
    // never touched and stays absent from date_overrides entirely.
    expect(body.date_overrides).toEqual({ sd1: { duration_min: 100 } });
  });

  it("sends an explicit empty sessions clear when a date's session times are all blanked out", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "1000" } });
    clickContinue();

    const berlin = await screen.findByRole("group", { name: /berlin/i });
    fireEvent.change(within(berlin).getByLabelText(/session 1 time/i), { target: { value: "" } });
    fireEvent.change(within(berlin).getByLabelText(/session 2 time/i), { target: { value: "" } });
    clickContinue();

    fireEvent.click(await screen.findByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    const body = invokeCalls()[0];
    // Blanking every session time on sd1 (which had synced sessions) is an
    // explicit clear: the override carries `sessions: []`, distinct from sd2
    // (never touched), which is absent from date_overrides altogether rather
    // than present with an empty array.
    expect(body.date_overrides).toEqual({ sd1: { sessions: [] } });
  });

  it("omits date_overrides entirely when no running order is edited", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin", "Hamburg");
    await reachReviewWithFee();
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    expect(invokeCalls()[0].date_overrides).toBeUndefined();
  });

  it("removes a deselected artist and its assignments from review and payload", async () => {
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin");

    fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
    fireEvent.click(await screen.findByRole("option", { name: /ann artist/i }));
    fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
    await flush();
    await reachReviewWithFee();

    expect(screen.queryByRole("group", { name: /ann artist dates/i })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /ben booker dates/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save as draft/i }));
    await waitFor(() => expect(invokeCalls().length).toBe(1));
    expect(invokeCalls()[0].artists).toEqual([
      { artist_id: "a2", show_date_ids: ["sd1"] },
    ]);
  });

  it("disables Continue when the last assigned date is removed", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDates("Berlin");
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /ann artist.*berlin/i }));

    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  it("issues every successfully created batch order and closes to the tracking list", async () => {
    (client as unknown as { functions: { invoke: ReturnType<typeof vi.fn> } }).functions = {
      invoke: vi.fn()
        .mockResolvedValueOnce({
          data: {
            created: ["ho-new-1", "ho-new-2"],
            skipped: [{ artist_id: "a3", reason: "exists" }],
            errors: [],
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: { issued: ["ho-new-1", "ho-new-2"], failed: [] },
          error: null,
        }),
    };
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin");
    await reachReviewWithFee();
    fireEvent.click(screen.getByRole("button", { name: /issue and send to artist/i }));

    await waitFor(() => expect(invokeCalls().length).toBe(2));
    expect(invokeCalls()[1]).toMatchObject({
      action: "issue",
      org_id: ORG,
      order_ids: ["ho-new-1", "ho-new-2"],
    });
    expect(await screen.findByText("2 hire orders created")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open order/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close and return to hire orders/i }));
    expect(navigate).toHaveBeenCalledWith("/hire-orders");
  });

  it("shows the per-date total for equal date counts", async () => {
    await openWizardAtStep2({ artists: ["Ann Artist"], dates: ["Berlin", "Hamburg"] });
    fireEvent.change(screen.getByLabelText(/engagement fee/i), { target: { value: "500" } });
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent(
      "$500.00 per date x 2 dates = $1,000.00",
    );
  });

  it("shows a range when artists have different date counts", async () => {
    await openWizardAtStep2({
      artists: ["Ann Artist", "Ben Booker"],
      dates: ["Berlin", "Hamburg"],
      assignments: { "Ann Artist": ["Berlin"], "Ben Booker": ["Berlin", "Hamburg"] },
    });
    fireEvent.change(screen.getByLabelText(/engagement fee/i), { target: { value: "500" } });
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent(
      "$500.00 per date. Totals range from $500.00 to $1,000.00 by artist.",
    );
  });

  it("shows the flat total when the basis is total", async () => {
    await openWizardAtStep2({ artists: ["Ann Artist"], dates: ["Berlin"] });
    fireEvent.change(screen.getByLabelText(/engagement fee/i), { target: { value: "1500" } });
    fireEvent.click(screen.getByLabelText(/fee basis/i));
    fireEvent.click(await screen.findByRole("option", { name: /total for all dates/i }));
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent("$1,500.00 total for all dates");
  });

  it("sends fee_basis in the draft body", async () => {
    const body = await completeWizard({ fee: "500" });
    expect(body).toMatchObject({
      action: "draft-batch",
      fee_basis: "per_date",
      manual: expect.objectContaining({ fee: 500 }),
    });
  });

  it("shows the multiplied total on step 4, not the bare unit price, for a single artist across multiple dates", async () => {
    await openWizardAtStep4({ artists: ["Ann Artist"], dates: ["Berlin", "Hamburg"], fee: "500" });
    const summary = screen.getByTestId("wiz-fee-summary");
    expect(summary).toHaveTextContent("$500.00 per date x 2 dates = $1,000.00");
    // Regression guard: the pre-fix step 4 showed exactly this bare figure
    // (the per-date unit price) while the server billed the multiplied total.
    expect(summary).not.toHaveTextContent(/^\$500\.00$/);
  });

  it("shows each artist's own total on step 4 when artists have different date counts, and the totals differ", async () => {
    await openWizardAtStep4({
      artists: ["Ann Artist", "Ben Booker"],
      dates: ["Berlin", "Hamburg"],
      assignments: { "Ann Artist": ["Berlin"], "Ben Booker": ["Berlin", "Hamburg"] },
      fee: "500",
    });
    const annFee = screen.getByTestId("wiz-artist-fee-a1");
    const benFee = screen.getByTestId("wiz-artist-fee-a2");
    expect(annFee).toHaveTextContent("$500.00 per date");
    expect(benFee).toHaveTextContent("$500.00 per date x 2 dates = $1,000.00");
    // This is the case a single collapsed aggregate number can never satisfy:
    // the two artists' own totals genuinely differ.
    expect(annFee.textContent).not.toBe(benFee.textContent);
  });

  it("shows the flat total on step 4, not a multiplied figure, when the basis is total", async () => {
    await openWizardAtStep4({
      artists: ["Ann Artist"],
      dates: ["Berlin", "Hamburg"],
      fee: "1500",
      basis: "total",
    });
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent("$1,500.00 total for all dates");
  });

  it("shows the basis qualifier on step 4 in manual mode, alongside the entered fee", async () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /no linked date/i }));
    fireEvent.change(screen.getByLabelText(/artist name/i), { target: { value: "Walk-in Artist" } });
    clickContinue();
    fireEvent.change(await screen.findByLabelText(/engagement fee/i), { target: { value: "500" } });
    clickContinue();
    clickContinue();
    await screen.findByRole("button", { name: /save as draft/i });
    expect(screen.getByTestId("wiz-fee-summary")).toHaveTextContent("$500.00 per date");
  });

  it("pre-assigns a newly selected date to every selected artist", async () => {
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDatesWithoutApplying("Berlin");
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ben booker.*berlin/i })).toBeChecked();
  });

  it("seeds a newly selected artist with the dates already selected", async () => {
    renderWizard();
    await selectCommonDatesWithoutApplying("Berlin", "Hamburg");
    await selectArtists("Ann Artist");
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ann artist.*hamburg/i })).toBeChecked();
  });

  it("unblocks Continue without pressing Reset all to selected dates", async () => {
    renderWizard();
    await selectArtists("Ann Artist");
    await selectCommonDatesWithoutApplying("Berlin");
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  });

  it("still lets a producer deselect one artist's date after auto-assignment", async () => {
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDatesWithoutApplying("Berlin");
    fireEvent.click(screen.getByRole("checkbox", { name: /ben booker.*berlin/i }));
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ben booker.*berlin/i })).not.toBeChecked();
    // Ben now has no dates, so step 1 is incomplete again.
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeDisabled();
  });

  it("drops every artist's assignments when two are deselected inside one batched update", async () => {
    // The deselect branch used to build its next map from the RENDER closure and
    // write it wholesale, so two deselects that React batches into one update
    // both read the pre-batch map and the second write resurrected the first
    // artist's assignments. The stale entry then wins over a fresh seed when
    // that artist is re-selected -- Ann comes back with her old single date
    // instead of the two dates currently selected.
    renderWizard();
    await selectArtists("Ann Artist", "Ben Booker");
    await selectCommonDates("Berlin", "Hamburg");
    fireEvent.click(screen.getByRole("checkbox", { name: /ann artist.*hamburg/i }));

    fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
    const annOption = await screen.findByRole("option", { name: /ann artist/i });
    const benOption = await screen.findByRole("option", { name: /ben booker/i });
    // One act() around both clicks: the nested acts defer their flush to the
    // outer one, so React sees a single batched update -- the shape a future
    // bulk "deselect all" would produce.
    await act(async () => {
      fireEvent.click(annOption);
      fireEvent.click(benOption);
    });
    fireEvent.click(screen.getByRole("combobox", { name: /select artist/i }));
    await flush();

    await selectArtists("Ann Artist");
    expect(screen.getByRole("checkbox", { name: /ann artist.*berlin/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ann artist.*hamburg/i })).toBeChecked();
  });
});
