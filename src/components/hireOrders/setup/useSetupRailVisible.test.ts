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

import { useSetupRailVisible } from "./useSetupRailVisible";

/** Letterhead and terms set, no countersign row: the org can issue but setup is not
 *  "complete", which is exactly the state the rail's first two steps leave behind. */
const CAN_ISSUE_SEED: Record<string, TableSeed> = {
  app_settings: [
    {
      when: { key: "hire_order_letterhead" },
      data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
    },
    {
      when: { key: "hire_order_terms" },
      data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }],
    },
    { when: { key: "hire_order_countersign" }, data: [] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("useSetupRailVisible", () => {
  it("is visible while a blocking step is outstanding, and not (yet) reinvocable", async () => {
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(result.current.reinvocable).toBe(false);
  });

  it("is not visible once the rail is dismissed, so the page can drop its column", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  it("stays visible for an admin while the non-blocking countersign step is outstanding", async () => {
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.visible).toBe(true));
  });

  it("is not visible for a producer once nothing blocks issuing", async () => {
    canRef.value = false;
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.visible).toBe(false));
  });

  // The finding this covers: the header re-invoke button used to be gated
  // independently (`dismissed && !complete`), so it could offer to reopen a
  // rail that -- once undismissed -- would render nothing actionable (e.g. a
  // producer once nothing blocks issuing). `reinvocable` is exactly `visible`
  // minus the dismissed check, so the two can never drift apart.
  describe("reinvocable", () => {
    it("is true once a genuinely actionable rail has been dismissed", async () => {
      localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
      const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
      await waitFor(() => expect(result.current.reinvocable).toBe(true));
      expect(result.current.visible).toBe(false);
    });

    it("is false when dismissed but nothing would be actionable once reopened (producer, nothing blocks issuing)", async () => {
      canRef.value = false;
      seedClient(CAN_ISSUE_SEED);
      localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
      const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
      await waitFor(() => expect(result.current.visible).toBe(false));
      expect(result.current.reinvocable).toBe(false);
    });

    it("is false once setup is complete, even if previously dismissed", async () => {
      localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
      seedClient({
        app_settings: [
          {
            when: { key: "hire_order_letterhead" },
            data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
          },
          {
            when: { key: "hire_order_terms" },
            data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }],
          },
          { when: { key: "hire_order_countersign" }, data: [{ key: "hire_order_countersign", org_id: "org-1", value: "manual" }] },
        ],
      });
      const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
      await waitFor(() => expect(result.current.reinvocable).toBe(false));
      expect(result.current.visible).toBe(false);
    });

    it("is false without an org", () => {
      const { result } = renderHookWithProviders(() => useSetupRailVisible(null));
      expect(result.current).toEqual({ visible: false, reinvocable: false });
    });
  });
});
