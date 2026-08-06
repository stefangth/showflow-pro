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

import { BlockerList } from "./BlockerList";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

describe("BlockerList", () => {
  it("names every blocker with its detail line", () => {
    const blockers: Blocker[] = [{ key: "missing_fee", scope: "order", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(screen.getByText("Engagement fee")).toBeInTheDocument();
    expect(screen.getByText(/An order cannot go out without one/i)).toBeInTheDocument();
  });

  it("offers an inline letterhead fix when the viewer may make it", async () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(await screen.findByLabelText(/Legal name/i)).toBeInTheDocument();
    expect(screen.queryByText("Admin only")).not.toBeInTheDocument();
  });

  it("shows an admin-only state instead of a control when the viewer may not", () => {
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: false }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(screen.getByText("Admin only")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/i)).not.toBeInTheDocument();
  });

  it("sends an order-scoped blocker back to the caller rather than fixing it inline", () => {
    const onFix = vi.fn();
    const blockers: Blocker[] = [{ key: "missing_date", scope: "order", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={onFix} />);
    screen.getByRole("button", { name: /Open the order/i }).click();
    expect(onFix).toHaveBeenCalledWith("missing_date");
  });

  // Carried forward from plan 1's review: an unread setting is not an empty setting.
  // A save fired before the real stored value has loaded would merge the producer's
  // one field onto LETTERHEAD_DEFAULT's blanks and erase agent_name / agent_email /
  // agent_signature_path, which this control never renders. Same guard shape as
  // LetterheadStep.tsx: no input until the read has actually landed.
  it("does not offer the letterhead save control when the stored value could not be read, so a click cannot blind-overwrite it", async () => {
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    const blockers: Blocker[] = [{ key: "missing_letterhead", scope: "org", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(await screen.findByText(/Could not load/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/i)).not.toBeInTheDocument();
  });

  // Carried forward from plan 1's review: useImportTermsTemplates now THROWS when the
  // org's terms have not been read, precisely so an import can never replace a library
  // it could not see. The control must guard on that instead of letting the click throw.
  it("does not offer the terms import control before the org's terms have loaded", async () => {
    seedClient({ app_settings: { data: null, error: new Error("boom") } });
    const blockers: Blocker[] = [{ key: "missing_terms", scope: "org", fixable: true }];
    renderWithProviders(<BlockerList orgId="org-1" blockers={blockers} onFixOrderField={vi.fn()} />);
    expect(await screen.findByText(/Could not load/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create from this template/i })).not.toBeInTheDocument();
  });
});
