import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// The dialog reaches the shared client only through its Task-11 hooks
// (useUpdateHireOrderReview -> hire_orders update, useHireOrderAction ->
// generate-hire-orders invoke). Same hoisted-fake harness as the card test.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { GenerateHireOrderDialog } from "./GenerateHireOrderDialog";
import type { HireOrderRow } from "@/data/hireOrders";

const SHOW_DATE = {
  id: "sd-1",
  date: "2026-02-01",
  venue: "Main Hall",
  duration_minutes: 90,
  status: "fully_filled",
  show: { program: "Aurora", sub_program: null },
  city: { name: "Berlin" },
} as never;

const ORDER = {
  id: "ho-1",
  order_no: "HO-2026-0201-1",
  status: "draft",
  booking_id: "bk-1",
  artist_id: "ar-1",
  show_date_id: "sd-1",
  fee_amount: 500,
  fee_currency: "EUR",
  terms_variant: "standard",
  data: { artist_name: { value: "Ada Lovelace", source: "showflow" } },
  artists: { name: "Ada Lovelace" },
} as unknown as HireOrderRow;

let openSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  seedClient({ hire_orders: { data: [], error: null }, app_settings: { data: [], error: null } });
  openSpy = vi.fn();
  vi.stubGlobal("open", openSpy);
  // jsdom does not implement object URLs.
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

function renderDialog() {
  return renderWithProviders(
    <GenerateHireOrderDialog
      open
      onOpenChange={vi.fn()}
      order={ORDER}
      showDate={SHOW_DATE}
      orgId="org-1"
      producerName="Aurora Productions"
    />,
  );
}

describe("GenerateHireOrderDialog", () => {
  it("renders the fee-only review with facts, no deposit/balance", () => {
    renderDialog();
    expect(screen.getByText("Generate hire order")).toBeInTheDocument();
    expect(screen.getByText(/review the terms before issuing to ada lovelace/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Engagement fee")).toHaveValue(500);
    expect(screen.getByText("Aurora Productions")).toBeInTheDocument();
    expect(screen.getByText("Main Hall")).toBeInTheDocument();
    expect(screen.getByText("90 min")).toBeInTheDocument();
    // Fee-only: deposit/balance must not appear.
    expect(screen.queryByText(/deposit/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/balance/i)).not.toBeInTheDocument();
    // Terms variants in plan order.
    expect(screen.getByRole("radio", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Full" })).toBeInTheDocument();
  });

  it("persists the edited fee + variant then invokes issue, and closes on success", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: { data: [], error: null },
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={onOpenChange} order={ORDER} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );

    fireEvent.change(screen.getByLabelText("Engagement fee"), { target: { value: "750" } });
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      // The order row was updated with the new fee (column + snapshot manual layer) and variant.
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeDefined();
      const patch = update!.args[0] as { fee_amount: number; terms_variant: string; data: { fee?: { value: number; source: string } } };
      expect(patch.fee_amount).toBe(750);
      expect(patch.terms_variant).toBe("full");
      expect(patch.data.fee).toEqual({ value: 750, source: "manual" });
      // Then the issue action was invoked for this order.
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke!.args[0] as { action: string; order_ids: string[] };
      expect(body.action).toBe("issue");
      expect(body.order_ids).toEqual(["ho-1"]);
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("skips persisting the review when nothing changed, but still issues", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: { data: [], error: null },
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
    });
    const onOpenChange = vi.fn();
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={onOpenChange} order={ORDER} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );

    // No edits to fee or variant — click straight to Issue.
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      expect(update).toBeUndefined();
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      const body = invoke!.args[0] as { action: string; order_ids: string[] };
      expect(body.action).toBe("issue");
      expect(body.order_ids).toEqual(["ho-1"]);
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Preview PDF invokes the preview action and opens the returned PDF", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: { data: [], error: null },
      "fn:generate-hire-orders": { data: { pdf_base64: "JVBERi0xLjQK" }, error: null },
    });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const invoke = calls.find((c) => c.table === "fn:generate-hire-orders" && c.method === "invoke");
      expect((invoke!.args[0] as { action: string }).action).toBe("preview");
    });
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("blob:fake", "_blank", "noopener,noreferrer"));
  });

  it("prefills agent fields from the org letterhead default", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: {
        data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
        error: null,
      },
    });
    renderDialog();
    // The inputs render immediately but are disabled while the letterhead query is
    // still loading (see the "disables ... until the default loads" test); poll the
    // VALUE until the seeding effect lands, by which point they are also enabled.
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toHaveValue("Org Agent");
      expect(screen.getByLabelText("Agent email")).toHaveValue("org@x.com");
    });
  });

  it("disables the agent inputs until the org letterhead default loads (no type-before-seed race)", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: {
        data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
        error: null,
      },
    });
    renderDialog();
    // Cold cache: on the first render the letterhead query is still pending, so the
    // fields are disabled — the producer cannot type into a not-yet-seeded field,
    // which is what previously let a type-then-clear silently discard the edit.
    expect(screen.getByLabelText("Agent name")).toBeDisabled();
    expect(screen.getByLabelText("Agent email")).toBeDisabled();
    // Once the default resolves the fields seed and enable.
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeEnabled();
      expect(screen.getByLabelText("Agent name")).toHaveValue("Org Agent");
    });
  });

  it("keeps the agent inputs disabled when the letterhead fetch fails (never shows a misleading blank)", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: { data: null, error: { message: "boom" } },
    });
    const { queryClient } = renderDialog();
    // The query errors, so no default is ever known. The fields must stay disabled
    // rather than un-disabling to a blank that would still print the org default.
    await waitFor(() =>
      expect(queryClient.getQueryState(["app-settings", "hire_order_letterhead", "org-1"])?.status).toBe("error"),
    );
    expect(screen.getByLabelText("Agent name")).toBeDisabled();
    expect(screen.getByLabelText("Agent email")).toBeDisabled();
    // The disabled state is explained, not silent, so the form doesn't read as broken.
    expect(screen.getByText(/this order will use your saved default/i)).toBeInTheDocument();
  });

  it("does not lock the agent inputs when there is no active org (letterhead query never runs)", () => {
    seedClient({ hire_orders: { data: [], error: null }, app_settings: { data: [], error: null } });
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={ORDER} showDate={SHOW_DATE} orgId="" producerName="Aurora Productions"
      />,
    );
    // orgId "" => the letterhead query is disabled and never resolves; the fields must
    // not stay permanently disabled waiting for a default that will never load.
    expect(screen.getByLabelText("Agent name")).toBeEnabled();
    expect(screen.getByLabelText("Agent email")).toBeEnabled();
  });

  it("persists an edited agent name + email on issue", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: {
        data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
        error: null,
      },
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
    });
    renderDialog();
    // Wait for the fields to seed + enable before editing (they are disabled while
    // the letterhead default is still loading).
    await waitFor(() => expect(screen.getByLabelText("Agent name")).toHaveValue("Org Agent"));
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "Solo Agent" } });
    fireEvent.change(screen.getByLabelText("Agent email"), { target: { value: "solo@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      const patch = update!.args[0] as { agent_name?: string; agent_email?: string };
      expect(patch.agent_name).toBe("Solo Agent");
      expect(patch.agent_email).toBe("solo@x.com");
    });
  });

  it("clearing a prefilled agent field persists an empty string", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: {
        data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
        error: null,
      },
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
    });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toHaveValue("Org Agent");
      expect(screen.getByLabelText("Agent email")).toHaveValue("org@x.com");
    });

    // Clear ONLY the name; the email is left exactly as prefilled.
    fireEvent.change(screen.getByLabelText("Agent name"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      const patch = update!.args[0] as Record<string, unknown>;
      expect(patch.agent_name).toBe("");
      // The email was never touched -- its key must be absent, not re-written
      // with its (unchanged) current value.
      expect("agent_email" in patch).toBe(false);
    });
  });

  it("editing only the agent email writes only agent_email", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: {
        data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
        error: null,
      },
      "fn:generate-hire-orders": { data: { issued: ["ho-1"], failed: [] }, error: null },
    });
    renderDialog();
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toHaveValue("Org Agent");
      expect(screen.getByLabelText("Agent email")).toHaveValue("org@x.com");
    });

    // Edit ONLY the email; the name is left exactly as prefilled.
    fireEvent.change(screen.getByLabelText("Agent email"), { target: { value: "new@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Issue and send" }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const update = calls.find((c) => c.table === "hire_orders" && c.method === "update");
      const patch = update!.args[0] as Record<string, unknown>;
      expect(patch.agent_email).toBe("new@x.com");
      // The name was never touched -- its key must be absent.
      expect("agent_name" in patch).toBe(false);
    });
  });
});
