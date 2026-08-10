import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { NumberingCard } from "./NumberingCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("NumberingCard", () => {
  // The form was a COPY of the stored numbering, seeded once by an effect behind a
  // ref, so it never re-seeded when the active org changed underneath it -- and
  // HireOrdersTab is not keyed by org. The card then showed the previous org's
  // prefix and Save, which persists the form verbatim, would write it into the new
  // org. Same root cause as the one-commit window at first load.
  it("follows the org when the active one changes under an untouched form", async () => {
    seedClient({
      app_settings: {
        data: [
          { key: "hire_order_numbering", org_id: "org-1", value: { prefix: "AUR", pattern: "{prefix}-{seq}" } },
          { key: "hire_order_numbering", org_id: "org-2", value: { prefix: "NORD", pattern: "{prefix}-{seq}" } },
        ],
        error: null,
      },
    });
    const { rerender } = renderWithProviders(<NumberingCard orgId="org-1" />);
    await waitFor(() => expect(screen.getByLabelText("Prefix")).toHaveValue("AUR"));

    rerender(<NumberingCard orgId="org-2" />);

    await waitFor(() => expect(screen.getByLabelText("Prefix")).toHaveValue("NORD"));
  });
});
