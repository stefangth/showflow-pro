import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// HireOrdersTab and its cards read `currentOrg` from useAuth and hit the shared supabase
// client directly (resolveOrgSetting/upsertOrgSetting, useFeature/useEntitlements,
// useSettingsAudit): same shape as BookingFlowTab.test.tsx / SettingsPage.test.tsx.
// A fake client built with createFakeSupabase (never a hand-rolled vi.mock chain) is
// swapped in via the vi.hoisted holder pattern; useAuth is a vi.fn() so each test can
// select which org (entitled / not entitled) is active.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));

// Every card resolves its own key via resolveOrgSetting({ ... }.eq("key", key)...); the
// fake doesn't filter on `.eq("key", ...)` for a single-object seed, so an empty array
// means every card falls back to its own default, which is what the happy-path tests
// need (empty HIRE_ORDER_DEFAULT_TERMS, "manual" countersign).
const OK_SEED: Record<string, TableSeed> = {
  app_settings: { data: [], error: null },
  settings_audit_log: { data: [], error: null },
  profiles: { data: [], error: null },
  org_entitlements: [
    { when: { org_id: "org-on" }, data: [{ feature: "hire_orders", enabled: true }], error: null },
    { when: { org_id: "org-off" }, data: [{ feature: "hire_orders", enabled: false }], error: null },
  ],
};

/** Re-seed the shared client holder in place, so each test picks its own server behavior
 *  (the vi.mock above captured this exact object by reference, so it must be mutated,
 *  never reassigned). */
function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}
seedClient(OK_SEED);

import { useAuth } from "@/features/auth/AuthContext";
import { HireOrdersTab } from "./HireOrdersTab";

function authAs(orgId: string) {
  vi.mocked(useAuth).mockReturnValue({ currentOrg: { id: orgId, name: "Test Org", slug: "test-org" } } as never);
}

// PdfTemplateCard renders a react-router <Link> to the template editor route, so every
// render needs a Router ancestor (matches TemplateEditorPage.test.tsx's own MemoryRouter
// wrapping for the same reason).
function renderTab(props: { readOnly?: boolean } = {}) {
  return renderWithProviders(
    <MemoryRouter>
      <HireOrdersTab {...props} />
    </MemoryRouter>,
  );
}

describe("HireOrdersTab", () => {
  beforeEach(() => seedClient(OK_SEED));

  it("renders all six cards when the org is entitled", async () => {
    authAs("org-on");
    renderTab();
    await screen.findByText("Letterhead");
    expect(screen.getByText("Order defaults")).toBeInTheDocument();
    expect(screen.getByText("Numbering")).toBeInTheDocument();
    expect(screen.getByText("Terms")).toBeInTheDocument();
    expect(screen.getByText("PDF template")).toBeInTheDocument();
    expect(screen.getByText("Countersign mode")).toBeInTheDocument();
  });

  it("renders nothing when the org is not entitled to hire_orders", async () => {
    authAs("org-off");
    const { queryClient } = renderTab();
    await waitFor(() =>
      expect(queryClient.getQueryState(["entitlements", "org-off"])?.status).toBe("success"),
    );
    expect(screen.queryByText("Letterhead")).not.toBeInTheDocument();
    expect(screen.queryByText("Countersign mode")).not.toBeInTheDocument();
  });

  it("persists the letterhead legal name via upsertOrgSetting on Save", async () => {
    authAs("org-on");
    renderTab();
    const legalName = await screen.findByLabelText("Legal name");
    fireEvent.change(legalName, { target: { value: "Aurora Productions GmbH" } });
    fireEvent.click(screen.getByRole("button", { name: "Save letterhead" }));

    await waitFor(() => {
      const calls = client.calls as { table: string; method: string; args: unknown[] }[];
      const upsertCall = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsertCall).toBeDefined();
      const payload = upsertCall!.args[0] as { org_id: string; key: string; value: { legal_name: string } };
      expect(payload.org_id).toBe("org-on");
      expect(payload.key).toBe("hire_order_letterhead");
      expect(payload.value.legal_name).toBe("Aurora Productions GmbH");
    });
  });

  it("offers exactly manual and electronic countersign options, manual by default", async () => {
    authAs("org-on");
    renderTab();
    const countersignHeading = await screen.findByText("Countersign mode");
    // Scope to the Countersign card: Terms also renders role="radio" controls now
    // (one "Default" radio per template), so a page-wide query would over-count.
    const countersignCard = countersignHeading.parentElement!.parentElement!;
    const radios = within(countersignCard).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /outside showflow/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /artist signs in showflow/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /outside showflow/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /artist signs in showflow/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(/documenso/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });

  it("shows the producer-email checkbox only once electronic is selected, and keeps it togglable", async () => {
    authAs("org-on");
    renderTab();
    await screen.findByText("Countersign mode");
    expect(screen.queryByLabelText(/also email producers the signed copy/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /artist signs in showflow/i }));
    const checkbox = screen.getByRole("checkbox", { name: /also email producers the signed copy/i });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute("aria-checked", "false");

    fireEvent.click(checkbox);
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("persists the electronic mode and producer-email flag via upsertOrgSetting on Save", async () => {
    authAs("org-on");
    renderTab();
    await screen.findByText("Countersign mode");
    fireEvent.click(screen.getByRole("radio", { name: /artist signs in showflow/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /also email producers the signed copy/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save countersign mode" }));

    await waitFor(() => {
      const calls = client.calls as { table: string; method: string; args: unknown[] }[];
      const upsertCall = calls.find(
        (c) =>
          c.table === "app_settings" &&
          c.method === "upsert" &&
          (c.args[0] as { key: string }).key === "hire_order_countersign",
      );
      expect(upsertCall).toBeDefined();
      const value = (upsertCall!.args[0] as { value: { mode: string; email_producers_on_countersign: boolean } }).value;
      expect(value.mode).toBe("electronic");
      expect(value.email_producers_on_countersign).toBe(true);
    });
  });

  it("lists three terms templates (lean, standard, full), all empty by default", async () => {
    authAs("org-on");
    renderTab();
    await screen.findByText("Terms");

    expect(screen.getByDisplayValue("Lean")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Standard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Full")).toBeInTheDocument();

    // ShowFlow seeds NO clause text (HIRE_ORDER_DEFAULT_TERMS is empty for every
    // template): terms are the org's own legal responsibility, authored here before
    // issuing. So every template starts with zero clause rows and an empty state.
    for (const [variant, id] of [["Lean", "lean"], ["Standard", "standard"], ["Full", "full"]] as const) {
      const section = screen.getByTestId(`terms-template-${id}`);
      expect(within(section).queryAllByLabelText(new RegExp(`${variant} clause \\d+ title`, "i"))).toHaveLength(0);
      expect(within(section).getByText(/no clauses yet/i)).toBeInTheDocument();
    }
  });

  // Data-loss regression: when the settings read fails, React Query settles to
  // status:'error' with isLoading:false and data:undefined. Cards that branch only on
  // isLoading fall through and render their blank/default form values as if they were
  // the org's saved data, with Save live. An admin clicking Save then overwrites a real
  // stored value (a legal letterhead name, authored terms) with the empty default.
  // The cards must surface the failure and offer no Save while in that state.
  describe("when the settings read fails", () => {
    const FAILING_SEED: Record<string, TableSeed> = {
      ...OK_SEED,
      app_settings: { data: null, error: new Error("permission denied for table app_settings") },
    };

    it("shows a destructive alert and no Save control, instead of an editable blank form", async () => {
      seedClient(FAILING_SEED);
      authAs("org-on");
      renderTab();

      // Every card that reads app_settings surfaces the failure. Each card owns its own
      // query, so they settle independently: wait for the count rather than
      // findAllByRole, which resolves on the FIRST match and would race the other five.
      await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(6));
      expect(screen.getByText(/could not load the letterhead settings/i)).toBeInTheDocument();
      expect(screen.getByText(/could not load the terms settings/i)).toBeInTheDocument();
      // ...carrying the underlying reason, not a bare "something went wrong".
      expect(screen.getAllByText(/permission denied for table app_settings/i).length).toBeGreaterThan(0);

      // The overwrite path is closed: no Save button exists anywhere on the tab, and
      // no blank form field is offered as if it held the org's real value.
      expect(screen.queryByRole("button", { name: /^save/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Legal name")).not.toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    });

    it("recovers to the normal editable form once the read succeeds", async () => {
      authAs("org-on");
      renderTab();

      // Guard against the alert becoming a permanent state: the happy path still works.
      expect(await screen.findByLabelText("Legal name")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save letterhead" })).toBeEnabled();
      expect(screen.queryByText(/could not load/i)).not.toBeInTheDocument();
    });
  });

  // Capability read-only floor: the tab threads `readOnly` into every card so a
  // producer without `edit_hire_order_settings` sees the org's real values but can't
  // change any of them.
  describe("readOnly (capability floor)", () => {
    it("disables a representative write control on every card, but still renders real values", async () => {
      authAs("org-on");
      renderTab({ readOnly: true });

      // Each card resolves its own independent query — await a checkpoint per card
      // rather than relying on the first one to imply the rest have settled too.
      expect(await screen.findByLabelText("Legal name")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save letterhead" })).toBeDisabled();
      expect(await screen.findByLabelText("Default fee")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save defaults" })).toBeDisabled();
      expect(await screen.findByLabelText("Prefix")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save numbering" })).toBeDisabled();
      // Terms has one "Add clause" button per variant (Lean/Standard/Full) — all disabled.
      await screen.findByText("Terms");
      for (const btn of screen.getAllByRole("button", { name: /add clause/i })) expect(btn).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save terms" })).toBeDisabled();
      // Countersign mode: read floor keeps "manual" visibly selected even though the
      // radios can't be changed.
      const manualRadio = await screen.findByRole("radio", { name: /outside showflow/i });
      expect(manualRadio).toBeDisabled();
      expect(manualRadio).toHaveAttribute("aria-checked", "true");
      expect(screen.getByRole("button", { name: "Save countersign mode" })).toBeDisabled();
    });

    it("leaves every card's controls enabled when readOnly is false", async () => {
      authAs("org-on");
      renderTab({ readOnly: false });

      expect(await screen.findByLabelText("Legal name")).toBeEnabled();
      expect(screen.getByRole("button", { name: "Save letterhead" })).toBeEnabled();
      expect(screen.getByRole("radio", { name: /outside showflow/i })).toBeEnabled();
    });
  });

  it("adds and removes clause rows on a variant that starts empty", async () => {
    authAs("org-on");
    renderTab();
    await screen.findByText("Terms");
    const standardSection = screen.getByTestId("terms-template-standard");

    // Add two rows to the empty variant; the empty state gives way to the editors.
    fireEvent.click(within(standardSection).getByRole("button", { name: /add clause/i }));
    fireEvent.click(within(standardSection).getByRole("button", { name: /add clause/i }));
    expect(within(standardSection).getAllByLabelText(/standard clause \d+ title/i)).toHaveLength(2);
    expect(within(standardSection).queryByText(/no clauses yet/i)).not.toBeInTheDocument();

    // A clause row edits both of its { title, body } halves.
    fireEvent.change(within(standardSection).getByLabelText(/standard clause 1 title/i), {
      target: { value: "Clause one" },
    });
    fireEvent.change(within(standardSection).getByLabelText(/standard clause 1 body/i), {
      target: { value: "Body text." },
    });
    expect(within(standardSection).getByLabelText(/standard clause 1 title/i)).toHaveValue("Clause one");
    expect(within(standardSection).getByLabelText(/standard clause 1 body/i)).toHaveValue("Body text.");

    // Removing takes it back down, and emptying it restores the empty state.
    fireEvent.click(within(standardSection).getByRole("button", { name: /remove standard clause 1/i }));
    expect(within(standardSection).getAllByLabelText(/standard clause \d+ title/i)).toHaveLength(1);
    fireEvent.click(within(standardSection).getByRole("button", { name: /remove standard clause 1/i }));
    expect(within(standardSection).queryAllByLabelText(/standard clause \d+ title/i)).toHaveLength(0);
    expect(within(standardSection).getByText(/no clauses yet/i)).toBeInTheDocument();
  });
});
