import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useOrderBlockers } from "./useOrderBlockers";

const ORDER = {
  data: { fee: { value: "1200.00", source: "manual" as const } },
  terms_variant: "t1",
};

beforeEach(() => {
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("useOrderBlockers", () => {
  it("reports the org gaps on an unconfigured org", async () => {
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.blockers.map((b) => b.key)).toEqual([
      "missing_recipient_email",
      "missing_date",
      "missing_letterhead",
      "missing_terms",
    ]);
  });

  it("marks org gaps unfixable without the settings capability", async () => {
    canRef.value = false;
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const letterhead = result.current.blockers.find((b) => b.key === "missing_letterhead");
    expect(letterhead?.fixable).toBe(false);
    expect(result.current.canEditSettings).toBe(false);
  });

  it("returns no blockers for a null order", async () => {
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.blockers).toEqual([]);
  });

  // Carried forward from plan 1's review: an unread setting is not an empty setting.
  // The hook may still fail-safe toward blocking (missing_terms/missing_letterhead),
  // but it must expose isError so a caller can say "could not check" rather than
  // "no clauses configured" when the read itself failed.
  it("surfaces isError instead of silently treating a failed settings read as an empty org", async () => {
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
  });

  it("reports isError false once the settings read succeeds", async () => {
    const { result } = renderHookWithProviders(() => useOrderBlockers("org-1", ORDER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(false);
  });
});
