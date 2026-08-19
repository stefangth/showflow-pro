import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { BatchIssuePreflightDialog } from "./BatchIssuePreflightDialog";

const full = { source: "manual" as const };
const CLEAN = {
  id: "a", order_no: "HO-1", artistName: "Mara Vogel", terms_variant: "t1",
  data: { fee: { value: "1200.00", ...full }, recipient_email: { value: "m@e.de", ...full }, date: { value: "2026-04-12", ...full } },
};
const NO_FEE = { ...CLEAN, id: "b", order_no: "HO-2", artistName: "Jonas Reiter", data: { ...CLEAN.data, fee: undefined } };

// The fake's single-object seed does not filter on .eq("key", ...), so the two
// app_settings keys must be seeded as separate array `when` entries or the terms
// read would resolve to the letterhead row (and vice versa).
const READY_SEED: Record<string, TableSeed> = {
  app_settings: [
    {
      when: { key: "hire_order_letterhead" },
      data: [{ org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
    },
    {
      when: { key: "hire_order_terms" },
      data: [{
        org_id: "org-1",
        value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" },
      }],
    },
  ],
};

beforeEach(() => seedClient(READY_SEED));

describe("BatchIssuePreflightDialog", () => {
  it("summarizes how many can go now", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findByText(/1 of 2 can be issued now/i)).toBeInTheDocument();
  });

  it("names the blocked orders and why", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findByText("Jonas Reiter")).toBeInTheDocument();
    expect(screen.getByText(/Engagement fee/)).toBeInTheDocument();
  });

  it("confirms with only the clean ids", async () => {
    const onConfirm = vi.fn();
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    const btn = await screen.findByRole("button", { name: /Issue 1 contract/i });
    btn.click();
    expect(onConfirm).toHaveBeenCalledWith(["a"]);
  });

  it("disables issuing when nothing in the selection is clean", async () => {
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /Issue 0 contracts/i })).toBeDisabled());
  });

  // Carried forward from plan 1's review: the dialog must not present a clean bill of
  // health derived from an unread org setting. A failed settings read must say so and
  // keep issuing disabled, rather than silently treating every order as clean because
  // no blockers happened to be computed from a fallback value.
  it("disables issuing and says the check failed when the settings read errors", async () => {
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findAllByText(/could not check/i)).not.toHaveLength(0);
    const btn = screen.getByRole("button", { name: /Issue \d+ contracts?/i });
    expect(btn).toBeDisabled();
  });

  // The `isError ? [] : ...` fail-safe on `clean`, pinned on its own. The test above
  // only reaches the error COPY: with nothing ever read, the fallbacks block every
  // order anyway, so `clean` is empty for that reason rather than because of the
  // guard. React Query keeps the last good `data` when a BACKGROUND refetch fails,
  // so "errored, with good stale settings still cached" is reachable, and it is the
  // only state where the guard is what holds the selection back.
  it("stops treating the selection as issuable when a background refetch fails, even though the last good settings are still cached", async () => {
    const queryClient = createTestQueryClient();
    renderWithProviders(
      <BatchIssuePreflightDialog open orgId="org-1" orders={[CLEAN, NO_FEE]} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      { queryClient },
    );
    expect(await screen.findByRole("button", { name: /Issue 1 contract/i })).toBeEnabled();

    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /Issue 0 contracts/i })).toBeDisabled());
    expect(screen.queryByText(/can be issued now/i)).not.toBeInTheDocument();
  });
});
