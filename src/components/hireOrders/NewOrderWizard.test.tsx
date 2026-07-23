import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  fireEvent.click(screen.getByRole("button", { name: /apply selected dates to all/i }));
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
  fireEvent.click(screen.getByRole("button", { name: /apply selected dates to all/i }));
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
    expect(screen.getByText(/payable on performance date/i)).toHaveTextContent("$1,200.00");
    clickContinue();

    // Step 3: the first linked date seeds editable batch-wide running order.
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
    expect(manual.duration_min).toBe(90);
    expect(manual.sessions).toEqual(["Main set 19:00", "22:00"]);

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
});
