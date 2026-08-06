import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createTestQueryClient } from "@/test/queryClient";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// IssuePreflightSheet navigates to the edit page on an order-scoped "Open the
// order" click. Same mock shape as OrderSlideOver.test.tsx: a bare useNavigate
// stub, no MemoryRouter needed for a component that only ever calls it.
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { IssuePreflightSheet } from "./IssuePreflightSheet";

const ORDER = {
  id: "ho-1",
  order_no: "HO-2026-0001",
  artistName: "Mara Vogel",
  data: { fee: { value: "1200.00", source: "manual" as const }, recipient_email: { value: "m@e.de", source: "manual" as const }, date: { value: "2026-04-12", source: "manual" as const } },
  terms_variant: "t1",
};

// The fake's single-object seed does not filter on .eq("key", ...), so a mixed-array
// seed of both keys would resolve BOTH the letterhead and the terms read to whichever
// row happens to come first. Use the array `when` form, one entry per key, so each
// read resolves to its own row.
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

beforeEach(() => {
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("IssuePreflightSheet", () => {
  it("enables Issue and send when nothing is blocking", async () => {
    seedClient(READY_SEED);
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled());
    expect(screen.getByText(/Ready to issue/i)).toBeInTheDocument();
  });

  it("disables Issue and send while a blocker stands, and names it", async () => {
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("Letterhead legal name")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Issue and send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep as draft" })).toBeEnabled();
  });

  it("shows Admin only for an org blocker a producer cannot fix", async () => {
    canRef.value = false;
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getAllByText("Admin only").length).toBeGreaterThan(0));
  });

  it("calls onConfirm when Issue and send is pressed on a clean order", async () => {
    seedClient(READY_SEED);
    const onConfirm = vi.fn();
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled());
    screen.getByRole("button", { name: "Issue and send" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // Carried forward from plan 1's review: the sheet must not present a clean bill of
  // health derived from an unread org setting. A failed read must say so and keep
  // Issue disabled, rather than showing "Ready to issue" because no blockers happened
  // to be computed from the fallback values.
  it("disables Issue and send and says the check failed when the settings read errors", async () => {
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );
    expect(await screen.findAllByText(/could not check/i)).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Issue and send" })).toBeDisabled();
    expect(screen.queryByText(/Ready to issue/i)).not.toBeInTheDocument();
  });

  // The `&& !isError` fail-safe on `clean`, pinned on its own. The test above only
  // reaches the error COPY: with nothing ever read, the fallbacks produce
  // missing_letterhead + missing_terms, so `clean` is empty because of the blockers,
  // not because of the guard. React Query keeps the last good `data` when a
  // BACKGROUND refetch fails, so "errored, with good stale settings still cached" is
  // reachable, and it is the only state where the guard is what disables the button.
  it("stops presenting a clean bill of health when a background refetch fails, even though the last good settings are still cached", async () => {
    seedClient(READY_SEED);
    const queryClient = createTestQueryClient();
    renderWithProviders(
      <IssuePreflightSheet open orgId="org-1" order={ORDER} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      { queryClient },
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeEnabled());

    // The refetch fails; the good letterhead and terms stay in the cache, so
    // computeBlockers still returns [] from them.
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "Issue and send" })).toBeDisabled());
    expect(screen.queryByText(/Ready to issue/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/could not check/i)).not.toHaveLength(0);
  });
});
