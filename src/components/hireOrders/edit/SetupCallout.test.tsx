import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import type { Blocker } from "@/lib/hireOrders/preflight";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { SetupCallout } from "./SetupCallout";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("SetupCallout", () => {
  it("renders nothing when only order-scoped blockers stand", () => {
    const blockers: Blocker[] = [{ key: "missing_fee", scope: "order", fixable: true }];
    const { container } = renderWithProviders(<SetupCallout orgId="org-1" blockers={blockers} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no blockers at all", () => {
    const { container } = renderWithProviders(<SetupCallout orgId="org-1" blockers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("calls out an org-scoped gap against the document", async () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: true }];
    renderWithProviders(<SetupCallout orgId="org-1" blockers={blockers} />);
    expect(screen.getByText(/The header on this document is empty/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Legal name/i)).toBeInTheDocument();
  });
});
