import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// The dialog reaches the shared client only through its Task-11 hooks
// (useUpdateHireOrderReview -> hire_orders update, useHireOrderAction ->
// generate-hire-orders invoke). Same hoisted-fake harness as the card test.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// The dialog now gates the Issue control on the issue_hire_orders capability.
// No AuthContext mock is needed elsewhere in this file, so mock useCan directly
// rather than pulling in a real AuthProvider.
vi.mock("@/hooks/useCapabilities", async (orig) => ({ ...(await orig<typeof import("@/hooks/useCapabilities")>()), useCan: vi.fn() }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useCan } from "@/hooks/useCapabilities";
import { GenerateHireOrderDialog } from "./GenerateHireOrderDialog";
import { TermsVariantsCard } from "@/components/settings/hireOrders/TermsVariantsCard";
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
  vi.mocked(useCan).mockReturnValue(true);
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

  it("renders one radio per org template, labelled by name, checked by the order's stored id", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [
            {
              org_id: "org-1",
              value: {
                templates: [
                  { id: "tpl-a", name: "VIP Contract", clauses: [] },
                  { id: "tpl-b", name: "Standard Package", clauses: [] },
                ],
                default_id: "tpl-a",
              },
            },
          ],
          error: null,
        },
      ],
    });
    const customOrder = { ...ORDER, terms_variant: "tpl-b" } as unknown as HireOrderRow;
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={customOrder} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "VIP Contract" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Standard Package" })).toHaveAttribute("aria-checked", "true");
      // The old hardcoded variants must be gone once the org's templates load.
      expect(screen.queryByRole("radio", { name: "Lean" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Full" })).not.toBeInTheDocument();
    });
  });

  it("falls back to a placeholder label when a saved template's name is blank, instead of an unlabeled radio", async () => {
    // TermsVariantsCard has no non-blank guard on save, so a template can reach
    // this picker with name: "". Rendering {t.name} directly (no fallback) would
    // produce a radio with an empty accessible name -- invisible to sighted users
    // and unannounced to screen readers. The picker must supply a fallback label.
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [
            {
              org_id: "org-1",
              value: {
                templates: [
                  { id: "tpl-a", name: "", clauses: [] },
                  { id: "tpl-b", name: "Standard Package", clauses: [] },
                ],
                default_id: "tpl-b",
              },
            },
          ],
          error: null,
        },
      ],
    });
    const customOrder = { ...ORDER, terms_variant: "tpl-b" } as unknown as HireOrderRow;
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={customOrder} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Untitled template" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Standard Package" })).toBeInTheDocument();
    });
    // No radio without an accessible name should slip through.
    expect(screen.getByRole("radio", { name: "Untitled template" })).toHaveAccessibleName("Untitled template");
  });

  it("shows a disabled removed chip when the order's stored terms_variant is no longer among the org's templates, and blocks issuing until a live template is chosen", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [
            { org_id: "org-1", value: { templates: [{ id: "tpl-a", name: "VIP Contract", clauses: [] }], default_id: "tpl-a" } },
          ],
          error: null,
        },
      ],
    });
    const customOrder = { ...ORDER, terms_variant: "deleted-tpl" } as unknown as HireOrderRow;
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={customOrder} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /removed/i })).toBeDisabled();
      expect(screen.getByRole("radio", { name: "VIP Contract" })).toBeInTheDocument();
    });
    const issueBtn = screen.getByRole("button", { name: "Issue and send" });
    expect(issueBtn).toBeDisabled();
    expect(issueBtn).toHaveAttribute("title", "Choose a terms template before issuing");

    // Picking the live template clears the block, without the app ever crashing.
    fireEvent.click(screen.getByRole("radio", { name: "VIP Contract" }));
    expect(issueBtn).toBeEnabled();
  });

  it("seeds the selection to the org's real default once the terms query resolves for a brand-new order with no stored terms_variant, without a false Removed chip", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [
            {
              org_id: "org-1",
              value: {
                templates: [
                  { id: "tpl-a", name: "VIP Contract", clauses: [] },
                  { id: "tpl-b", name: "Standard Package", clauses: [] },
                ],
                default_id: "tpl-b",
              },
            },
          ],
          error: null,
        },
      ],
    });
    // No stored terms_variant at all -- the state the report's own "Concerns"
    // section flagged as untested (a brand-new order in an org whose custom
    // templates don't include "standard").
    const newOrder = { ...ORDER, terms_variant: "" } as unknown as HireOrderRow;
    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={newOrder} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "Standard Package" })).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.queryByRole("button", { name: /removed/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled();
  });

  it("shows a 'no terms templates configured' message and blocks issuing when the org has zero terms templates", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [{ org_id: "org-1", value: { templates: [], default_id: null } }],
          error: null,
        },
      ],
    });
    // ORDER carries a genuinely stored terms_variant ("standard"); the org has
    // since deleted every template, so there's nothing above to "choose" --
    // the removed-reference chip/hint would be a dead end here.
    renderDialog();
    await waitFor(() => {
      expect(screen.getByText(/no terms templates configured/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /removed/i })).not.toBeInTheDocument();
    const issueBtn = screen.getByRole("button", { name: "Issue and send" });
    expect(issueBtn).toBeDisabled();
    expect(issueBtn).toHaveAttribute("title", "No terms templates configured");
  });

  it("issue_hire_orders off: Issue and send is disabled, Preview PDF still works", async () => {
    vi.mocked(useCan).mockImplementation((action: string) => action !== "issue_hire_orders");
    renderDialog();
    expect(screen.getByRole("button", { name: "Issue and send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Preview PDF" })).toBeEnabled();
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
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
          error: null,
        },
      ],
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
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
          error: null,
        },
      ],
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
      app_settings: [{ when: { key: "hire_order_letterhead" }, data: null, error: { message: "boom" } }],
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
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
          error: null,
        },
      ],
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
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
          error: null,
        },
      ],
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
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ org_id: "org-1", value: { legal_name: "Aurora", address_lines: [], agent_name: "Org Agent", agent_email: "org@x.com" } }],
          error: null,
        },
      ],
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

  // React Query pitfall (see the "React Query key projection pitfall" house
  // lesson): TermsVariantsCard and this dialog register a useQuery under the
  // SAME key (["app-settings","hire_order_terms",orgId]) so a save in Settings
  // busts every picker's cache. That only works if BOTH queryFns resolve to the
  // identical HireOrderTermsSetting shape. A legacy-shape org (never re-saved
  // since the {lean,standard,full} -> {templates,default_id} migration) proves
  // it: mount the card first so it populates the shared cache, then mount this
  // dialog against the SAME QueryClient and assert it renders the legacy
  // templates instead of crashing on `terms.templates` being undefined.
  it("shares the terms cache with TermsVariantsCard: a legacy-shape org still renders three templates, no crash", async () => {
    seedClient({
      hire_orders: { data: [], error: null },
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: [
            {
              org_id: "org-1",
              value: { lean: [{ title: "Fee", body: "Paid on the day." }], standard: [], full: [] },
            },
          ],
          error: null,
        },
      ],
    });

    const queryClient = createTestQueryClient();
    renderWithProviders(<TermsVariantsCard orgId="org-1" />, { queryClient });
    // Let the card's own query resolve and populate the shared cache key.
    await screen.findByDisplayValue("Lean");

    renderWithProviders(
      <GenerateHireOrderDialog
        open onOpenChange={vi.fn()} order={ORDER} showDate={SHOW_DATE} orgId="org-1" producerName="Aurora Productions"
      />,
      { queryClient },
    );

    expect(screen.getByRole("radio", { name: "Lean" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Full" })).toBeInTheDocument();
  });
});
