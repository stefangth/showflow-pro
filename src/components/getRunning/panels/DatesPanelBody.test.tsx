import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per TeamPanelBody.test.tsx / PeoplePanelBody.test.tsx.
// DatesPanelBody calls the REAL `fetchLatestSyncLog` (src/data/airtableSync.ts), which
// reads the `airtable_sync_log` table via the shared supabase singleton — the fake
// stands in for that singleton. When the Airtable overlay opens, the REAL
// `AirtableSyncTab` mounts too and reads several other (unseeded) tables/RPCs; every
// one of those falls back to the fake's default `{ data: [], error: null }`, which
// resolves `keyPresent`/`hasBaseTable` to false and pins AirtableSyncTab's console into
// its "setup" mode (see `deriveMode` in `airtable/console.ts`) — so it never reaches the
// recent-runs list that would need a real array shape. That is what makes seeding only
// `airtable_sync_log` here safe.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// `useCan` backs both DatesPanelBody's own `configure_airtable`/`trigger_sync` checks
// and ShowFormDialog's `edit_scheduling` check (mounted for the "New show" overlay).
// Mocked to a flat `true`, same pattern as PeoplePanelBody.test.tsx — none of this
// suite's assertions depend on per-action capability variance.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { DatesPanelBody } from "./DatesPanelBody";

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false };

const CONNECTED_LOG = {
  id: "log-1",
  status: "success",
  records_processed: 148,
  imported_count: 140,
  new_count: 10,
  updated_count: 130,
  held_count: 4,
  error_details: null,
  synced_at: "2026-08-15T19:00:00Z",
};

function seed(log: unknown) {
  Object.assign(
    client,
    createFakeSupabase({
      airtable_sync_log: { data: log, error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
    }),
  );
}

function renderPanel(orgId: string | null = "org-1") {
  return renderWithProviders(<DatesPanelBody orgId={orgId} onDone={vi.fn()} />, {
    authOverrides: { currentOrg: TEST_ORG, roles: ["admin"], hasRole: (r) => r === "admin" },
  });
}

describe("DatesPanelBody", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
  });

  it("shows the sync status card with the held-records resolve affordance", async () => {
    seed(CONNECTED_LOG);
    renderPanel();

    await waitFor(() => expect(screen.getByText(/148/)).toBeInTheDocument());
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resolve/i })).toBeInTheDocument();
  });

  it("shows a Set up Airtable sync button instead of a status card when unconnected", async () => {
    seed(null);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /set up airtable sync/i })).toBeInTheDocument(),
    );
    // No status card rendered — nothing here claims a records-processed count.
    expect(screen.queryByText(/dates$/)).not.toBeInTheDocument();
  });

  it("opens the Airtable overlay (not a navigation) from Set up Airtable sync", async () => {
    seed(null);
    renderPanel();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const setupButton = await screen.findByRole("button", { name: /set up airtable sync/i });
    fireEvent.click(setupButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="/settings"]')).not.toBeInTheDocument();
  });
});
