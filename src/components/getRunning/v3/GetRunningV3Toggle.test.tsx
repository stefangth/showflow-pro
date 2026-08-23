import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// GetRunningV3Toggle reads useGetRunningV3Enabled / useSetGetRunningV3Enabled (Task A2),
// which query the real `app_settings` table through the shared supabase client, so this
// suite seeds it with the fake client the same way useGetRunningV3Enabled.test.tsx does,
// rather than mocking the hooks themselves.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seed(s: Record<string, TableSeed>) {
  for (const k of Object.keys(client)) delete client[k];
  Object.assign(client, createFakeSupabase(s));
}

import { GetRunningV3Toggle } from "./GetRunningV3Toggle";

const TEST_ORG = { id: "org-1", name: "Test Org", slug: "test-org", status: "active", is_demo: false };

describe("GetRunningV3Toggle", () => {
  it("renders nothing for a non-super-admin", () => {
    seed({ app_settings: { data: [], error: null } });

    const { container } = renderWithProviders(<GetRunningV3Toggle />, {
      authOverrides: { isSuperAdmin: false, currentOrg: TEST_ORG },
    });

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the switch for a super-admin", async () => {
    seed({ app_settings: { data: [], error: null } });

    renderWithProviders(<GetRunningV3Toggle />, {
      authOverrides: { isSuperAdmin: true, currentOrg: TEST_ORG },
    });

    const toggle = await screen.findByRole("switch");
    expect(toggle).toBeInTheDocument();
    // Accessible name comes from aria-labelledby pointing at the visible title <p>, not a
    // redundant aria-label duplicating it.
    expect(toggle).toHaveAccessibleName("Get running v3");
    expect(toggle).not.toHaveAttribute("aria-label");
  });
});
