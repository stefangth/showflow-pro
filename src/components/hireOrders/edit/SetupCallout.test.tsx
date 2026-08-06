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

const LETTERHEAD_GAP: Blocker = { key: "missing_letterhead", scope: "org", fixable: true };
const TERMS_GAP: Blocker = { key: "missing_terms", scope: "org", fixable: true };

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("SetupCallout", () => {
  it("renders nothing when only order-scoped blockers stand", () => {
    const blockers: Blocker[] = [{ key: "missing_fee", scope: "order", fixable: true }];
    const { container } = renderWithProviders(
      <SetupCallout orgId="org-1" blockers={blockers} isLoading={false} isError={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no blockers at all", () => {
    const { container } = renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[]} isLoading={false} isError={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("calls out an org-scoped gap against the document", async () => {
    renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[LETTERHEAD_GAP]} isLoading={false} isError={false} />,
    );
    expect(screen.getByText(/The header on this document is empty/i)).toBeInTheDocument();
    expect(await screen.findByLabelText(/Legal name/i)).toBeInTheDocument();
  });

  // Carried forward from plan 1's review, at the one call site that missed it: an
  // unread setting is not an empty setting. The blockers handed down here are
  // fail-safe (they block on an unread read), so before the read lands they say
  // "missing" about a document whose org may be perfectly configured.
  it("stays silent about the document while the org settings are still being read", () => {
    const { container } = renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[LETTERHEAD_GAP, TERMS_GAP]} isLoading isError={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says the check failed instead of asserting the document is empty when the read errored", () => {
    renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[LETTERHEAD_GAP, TERMS_GAP]} isLoading={false} isError />,
    );
    expect(screen.getByText(/could not check/i)).toBeInTheDocument();
    expect(screen.queryByText(/The header on this document is empty/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/i)).not.toBeInTheDocument();
  });

  // M3: with both org gaps standing (the normal state of a brand-new org, which is
  // this callout's whole audience) the heading must not name only one of them.
  it("names both org gaps in the heading when both stand", () => {
    renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[LETTERHEAD_GAP, TERMS_GAP]} isLoading={false} isError={false} />,
    );
    expect(screen.getByText(/The header and the back page of this document are empty/i)).toBeInTheDocument();
  });

  it("names the back page when only the terms gap stands", () => {
    renderWithProviders(
      <SetupCallout orgId="org-1" blockers={[TERMS_GAP]} isLoading={false} isError={false} />,
    );
    expect(screen.getByText(/The back page of this document is empty/i)).toBeInTheDocument();
  });
});
