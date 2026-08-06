import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { createTestQueryClient } from "@/test/queryClient";

// AuthContext drives supabase.auth directly, which supabaseFake does not model.
const session = {
  user: { id: "u-1", email: "admin@acme.test" },
  access_token: "t",
} as unknown as Session;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

vi.mock("@/data/orgs", () => ({
  fetchMyMemberships: vi.fn(async () => [
    { org_id: "org-1", role: "admin", organizations: { id: "org-1", name: "Acme", slug: "acme", status: "active" } },
    { org_id: "org-2", role: "admin", organizations: { id: "org-2", name: "Beta", slug: "beta", status: "active" } },
  ]),
}));
vi.mock("@/data/platform", () => ({
  fetchIsSuperAdmin: vi.fn(async () => false),
  fetchAllOrgs: vi.fn(async () => []),
}));

import { AuthProvider, useAuth } from "./AuthContext";

let ctx: ReturnType<typeof useAuth>;

function Probe() {
  ctx = useAuth();
  return null;
}

async function renderAuth() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ctx.currentOrg?.id).toBe("org-1"));
}

beforeEach(() => {
  localStorage.setItem("showflow.currentOrg", "org-1");
});

describe("switchOrg", () => {
  it("drops the impersonated user, whose identity belongs to the org being left", async () => {
    await renderAuth();
    act(() => ctx.setViewAsUser({ id: "u-9", email: "someone@acme.test", roles: ["producer"] }));
    expect(ctx.viewAsUser).not.toBeNull();

    act(() => ctx.switchOrg("org-2"));

    await waitFor(() => expect(ctx.currentOrg?.id).toBe("org-2"));
    expect(ctx.viewAsUser).toBeNull();
  });

  it("still records the newly active org", async () => {
    await renderAuth();

    act(() => ctx.switchOrg("org-2"));

    await waitFor(() => expect(ctx.currentOrg?.id).toBe("org-2"));
    expect(localStorage.getItem("showflow.currentOrg")).toBe("org-2");
  });
});
