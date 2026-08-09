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

/** Letterhead + terms set, no countersign: the org can issue but setup is not complete. */
const CAN_ISSUE_SEED: Record<string, TableSeed> = {
  app_settings: [
    { when: { key: "hire_order_letterhead" }, data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }] },
    { when: { key: "hire_order_terms" }, data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }] },
    { when: { key: "hire_order_countersign" }, data: [] },
  ],
};

/** All three steps set: setup is complete. */
const COMPLETE_SEED: Record<string, TableSeed> = {
  app_settings: [
    { when: { key: "hire_order_letterhead" }, data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }] },
    { when: { key: "hire_order_terms" }, data: [{ key: "hire_order_terms", org_id: "org-1", value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" } }] },
    { when: { key: "hire_order_countersign" }, data: [{ key: "hire_order_countersign", org_id: "org-1", value: "manual" }] },
  ],
};

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("useSetupRailVisible", () => {
  it("is 'banner' while a blocking step is outstanding (editor, not dismissed)", async () => {
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("banner"));
  });

  it("is 'collapsed' once dismissed while setup is still incomplete", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("collapsed"));
  });

  it("stays 'banner' for an admin while the non-blocking countersign step is outstanding", async () => {
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("banner"));
  });

  it("is 'hidden' for a producer once nothing blocks issuing", async () => {
    canRef.value = false;
    seedClient(CAN_ISSUE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("hidden"));
  });

  it("is 'button' once setup is complete (editor), even if previously dismissed", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    seedClient(COMPLETE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    await waitFor(() => expect(result.current.mode).toBe("button"));
  });

  it("is 'hidden' once complete for a non-editor producer", async () => {
    canRef.value = false;
    seedClient(COMPLETE_SEED);
    const { result } = renderHookWithProviders(() => useSetupRailVisible("org-1"));
    // Loading resolves to complete+canIssue -> not actionable for a non-editor.
    await waitFor(() => expect(result.current.mode).toBe("hidden"));
  });

  it("is 'hidden' without an org", () => {
    const { result } = renderHookWithProviders(() => useSetupRailVisible(null));
    expect(result.current).toEqual({ mode: "hidden" });
  });
});
