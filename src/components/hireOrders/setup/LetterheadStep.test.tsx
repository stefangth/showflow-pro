import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
// Spy, not a stub: the REAL fields still render, but the step's draft is recorded per
// render. Unlike the DOM this keeps a history, so the FIRST render stays inspectable
// after act() has settled everything.
vi.mock("@/components/settings/hireOrders/fields/LetterheadFields", async (orig) => {
  const actual = await orig<typeof import("@/components/settings/hireOrders/fields/LetterheadFields")>();
  return { ...actual, LetterheadFields: vi.fn(actual.LetterheadFields) };
});

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { LetterheadStep } from "./LetterheadStep";
import { LetterheadFields } from "@/components/settings/hireOrders/fields/LetterheadFields";
import { createTestQueryClient } from "@/test/queryClient";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("LetterheadStep", () => {
  it("renders the fields and confirms when the read succeeds", async () => {
    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /confirm letterhead/i })).toBeInTheDocument();
  });

  it("shows a destructive alert and no editable form when the read fails", async () => {
    // Falling through to LETTERHEAD_DEFAULT would seed the form with blanks, and the
    // merge-safe save would then write the agent name, agent email and agent signature
    // path back as empty. The merge is correct; the danger is lying to it about `stored`.
    seedClient({ app_settings: { data: null, error: new Error("permission denied for table app_settings") } });
    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />);

    expect(await screen.findByText(/could not load the letterhead/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm letterhead/i })).not.toBeInTheDocument();

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string }[];
      expect(calls.filter((c) => c.table === "app_settings" && c.method === "upsert")).toHaveLength(0);
    });
  });

  it("merges onto the stored value so the agent fields survive a rail save", async () => {
    seedClient({
      app_settings: {
        data: [
          {
            key: "hire_order_letterhead",
            org_id: "org-1",
            value: {
              legal_name: "Aurora GmbH",
              address_lines: ["Hauptstrasse 1"],
              registration_line: "HRB 1234",
              agent_name: "Mia Berg",
              agent_email: "mia@example.com",
              agent_signature_path: "org-1/agent-signature.png",
            },
          },
        ],
        error: null,
      },
    });
    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /confirm letterhead/i }));

    await waitFor(() => {
      const calls = (client.calls ?? []) as { table: string; method: string; args: unknown[] }[];
      const upsert = calls.find((c) => c.table === "app_settings" && c.method === "upsert");
      expect(upsert).toBeDefined();
      const payload = upsert!.args[0] as { value: { agent_name?: string; agent_signature_path?: string | null } };
      expect(payload.value.agent_name).toBe("Mia Berg");
      expect(payload.value.agent_signature_path).toBe("org-1/agent-signature.png");
    });
  });

  // Confirm must be gated on exactly the predicate `letterheadDone` uses, or pressing it
  // writes a blank payload, toasts success and advances the wizard while the step stays
  // outstanding: the user believes they confirmed and nothing happened.
  it("keeps Confirm disabled while the legal name is blank", async () => {
    seedClient({
      app_settings: {
        data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "   ", address_lines: [], registration_line: "" } }],
        error: null,
      },
    });
    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /confirm letterhead/i })).toBeDisabled();
  });

  it("enables Confirm once a legal name is present", async () => {
    seedClient({
      app_settings: {
        data: [{ key: "hire_order_letterhead", org_id: "org-1", value: { legal_name: "Bootstrap Productions GmbH", address_lines: [], registration_line: "" } }],
        error: null,
      },
    });
    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /confirm letterhead/i })).toBeEnabled();
  });

  // The form was a COPY of the stored setting, filled in by a seed-once effect, so
  // the commit that opened the isLoading gate rendered an interactive panel whose
  // form was still the blank default -- and Confirm persists it verbatim (merging
  // onto the stored value, so the fields this panel renders are written back empty).
  // Priming the cache puts the data in the FIRST render, where a lagging draft shows;
  // asserting on the settled DOM only ever sees the state after the effect ran.
  it("hands the stored value to the fields in the first render, before any effect", async () => {
    const stored = { legal_name: "Aurora Productions GmbH", address_lines: ["Rosenthaler Str. 1"], registration_line: "HRB 1 B" };
    seedClient({ app_settings: { data: [{ key: "hire_order_letterhead", org_id: "org-1", value: stored }], error: null } });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(["app-settings", "hire_order_letterhead", "org-1"], stored);
    vi.mocked(LetterheadFields).mockClear();

    renderWithProviders(<LetterheadStep orgId="org-1" onDone={vi.fn()} />, { queryClient });

    expect(vi.mocked(LetterheadFields).mock.calls[0]?.[0].value).toEqual(stored);
  });
});
