import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { useHireOrderSetupStatus, useImportTermsTemplates, useOrgTerms, useTermsLibrary } from "./useHireOrderSetup";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("useHireOrderSetupStatus", () => {
  it("reports nothing done for an org with no settings rows", async () => {
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus("org-1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.doneCount).toBe(0);
    expect(result.current.status.canIssue).toBe(false);
  });

  it("reports letterhead and terms done, and can issue, from stored rows", async () => {
    // Array-form seed, matched on the `key` eq(): a single-object seed can't
    // distinguish which row belongs to which app_settings key (the fake doesn't
    // filter by plain eq()), so a letterhead row and a terms row seeded together
    // would collide and both queries would see the same (first) row.
    seedClient({
      app_settings: [
        {
          when: { key: "hire_order_letterhead" },
          data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Aurora GmbH", address_lines: [], registration_line: "" } }],
        },
        {
          when: { key: "hire_order_terms" },
          data: [{
            key: "hire_order_terms",
            org_id: "org-1",
            value: { templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "14 days." }] }], default_id: "t1" },
          }],
        },
      ],
    });
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus("org-1"));
    await waitFor(() => expect(result.current.status.canIssue).toBe(true));
    // No hire_order_countersign row, so the decision is still outstanding.
    expect(result.current.status.complete).toBe(false);
  });

  it("is inert without an org", async () => {
    const { result } = renderHookWithProviders(() => useHireOrderSetupStatus(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.status.doneCount).toBe(0);
  });
});

describe("useOrgTerms", () => {
  it("falls back to the same default set as the Settings terms card", async () => {
    // Both observe ["app-settings","hire_order_terms",orgId]. Differing fallbacks would
    // make the cached value depend on which surface mounted first.
    const { result } = renderHookWithProviders(() => useOrgTerms("org-1"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.templates.map((t) => t.id)).toEqual(["lean", "standard", "full"]);
    expect(result.current.data?.default_id).toBe("standard");
  });
});

describe("useImportTermsTemplates", () => {
  function seedTermsReadFailure() {
    seedClient({
      app_settings: [
        {
          when: { key: "hire_order_terms" },
          data: null,
          error: new Error("permission denied for table app_settings"),
        },
        // The library read (key hire_order_terms_library) falls through to this entry
        // and resolves to the code starter set.
        { data: [], error: null },
      ],
    });
  }

  it("refuses to write when the org's current terms could not be read", async () => {
    // The merge APPENDS to `current`. Substituting an empty set after a failed read
    // would turn "add a template" into "replace the org's whole contract library".
    seedTermsReadFailure();
    const { result } = renderHookWithProviders(() => ({
      library: useTermsLibrary(),
      terms: useOrgTerms("org-1"),
      importTerms: useImportTermsTemplates("org-1"),
    }));
    await waitFor(() => {
      expect(result.current.library.isSuccess).toBe(true);
      expect(result.current.terms.isError).toBe(true);
    });

    result.current.importTerms.mutate({ templateIds: ["platform-standard-engagement"] });

    await waitFor(() => expect(result.current.importTerms.isError).toBe(true));
    expect(result.current.importTerms.error?.message).toMatch(/terms could not be loaded/i);
    const calls = (client.calls ?? []) as { table: string; method: string }[];
    expect(calls.filter((c) => c.table === "app_settings" && c.method === "upsert")).toHaveLength(0);
  });
});
