import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const upsert = vi.fn().mockResolvedValue(undefined);
const resolveOrgSetting = vi.fn().mockResolvedValue({ mode: "manual" });
vi.mock("@/data/settings", () => ({
  resolveOrgSetting: (...a: unknown[]) => resolveOrgSetting(...a),
  upsertOrgSetting: (...a: unknown[]) => upsert(...a),
}));
// Spy, not a stub: the REAL fields still render, but the card's draft is recorded
// per render. Unlike the DOM this keeps a history, so the FIRST render is still
// inspectable after act() has settled everything.
vi.mock("./fields/CountersignFields", async (orig) => {
  const actual = await orig<typeof import("./fields/CountersignFields")>();
  return { ...actual, CountersignFields: vi.fn(actual.CountersignFields) };
});

import { CountersignCard } from "./CountersignCard";
import { CountersignFields } from "./fields/CountersignFields";
import { createTestQueryClient } from "@/test/queryClient";

describe("CountersignCard", () => {
  beforeEach(() => {
    upsert.mockClear();
    resolveOrgSetting.mockReset().mockResolvedValue({ mode: "manual" });
  });

  it("offers the in-app signing option and no Documenso option", async () => {
    renderWithProviders(<CountersignCard orgId="o1" />);
    await waitFor(() => expect(screen.getByText(/artist signs in showflow/i)).toBeInTheDocument());
    expect(screen.queryByText(/documenso/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });

  // The form was a COPY of the stored setting, seeded a commit after the isLoading
  // gate opened, so the card rendered interactive with COUNTERSIGN_DEFAULT still in
  // state -- and Save persists the form verbatim. Priming the cache puts the data in
  // the FIRST render, where a lagging draft is visible; asserting on the settled DOM
  // only ever sees the state after the effect ran.
  it("hands the stored countersign mode to the fields in the first render", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["app-settings", "hire_order_countersign", "o1"], { mode: "electronic" });
    vi.mocked(CountersignFields).mockClear();

    renderWithProviders(<CountersignCard orgId="o1" />, { queryClient });

    expect(vi.mocked(CountersignFields).mock.calls[0]?.[0].value).toEqual({ mode: "electronic" });
    await waitFor(() => expect(screen.getByText(/artist signs in showflow/i)).toBeInTheDocument());
  });

  // Same root cause, permanent rather than sub-frame: HireOrdersTab is not keyed by
  // org, so an org switch re-keys this card's query without unmounting it.
  it("follows the org when the active one changes under an untouched form", async () => {
    resolveOrgSetting.mockImplementation((_client: unknown, orgId: string) =>
      Promise.resolve(orgId === "o2" ? { mode: "electronic" } : { mode: "manual" }));

    const { rerender } = renderWithProviders(<CountersignCard orgId="o1" />);
    await waitFor(() => expect(screen.getByRole("radio", { name: /signatures handled outside showflow/i })).toBeChecked());

    rerender(<CountersignCard orgId="o2" />);

    await waitFor(() => expect(screen.getByRole("radio", { name: /artist signs in showflow/i })).toBeChecked());
  });
});
