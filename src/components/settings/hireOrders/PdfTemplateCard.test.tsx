import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

// Same harness as PdfCopyCard.test.tsx: a call-recording fake swapped into a
// hoisted holder (never a hand-rolled vi.mock chain). Wrapped in a real
// MemoryRouter (not renderWithProviders alone) because the card renders a
// react-router <Link> to the template editor route.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { PdfTemplateCard } from "./PdfTemplateCard";

beforeEach(() => seedClient({ app_settings: { data: [], error: null } }));

function seedTheme(value: Record<string, unknown>) {
  seedClient({
    app_settings: { data: [{ key: "hire_order_theme", org_id: "org-1", value }], error: null },
  });
}

function renderCard(orgId: string | null = "org-1") {
  return renderWithProviders(
    <MemoryRouter>
      <PdfTemplateCard orgId={orgId} />
    </MemoryRouter>,
  );
}

describe("PdfTemplateCard", () => {
  it("summarises the current template and links into the editor", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("PDF template")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open template editor" })).toHaveAttribute(
      "href",
      "/settings/contracts/template",
    );
    expect(screen.getByTestId("tpl-summary")).toHaveTextContent("Geist");
  });

  it("shows the customised element count when the org has role overrides", async () => {
    seedTheme({ roles: { sectionHeading: { size: 18 } } });
    renderCard();
    const summary = await screen.findByTestId("tpl-summary");
    expect(summary).toHaveTextContent("1 customised element");
  });

  it("reports no customised elements against an unmodified theme", async () => {
    renderCard();
    const summary = await screen.findByTestId("tpl-summary");
    expect(summary).toHaveTextContent("no customised elements");
  });

  it("does not count a hollow role entry ({}) as a customisation", async () => {
    // A hand-edited app_settings blob (or a stray future bug) can leave a
    // present-but-empty role entry. It must not inflate the count - same
    // "unchanged means absent" rule the editor's own outline pane applies.
    seedTheme({ roles: { sectionHeading: {} } });
    renderCard();
    const summary = await screen.findByTestId("tpl-summary");
    expect(summary).toHaveTextContent("no customised elements");
  });

  it("shows a destructive alert instead of a fabricated summary when the read fails", async () => {
    seedClient({
      app_settings: { data: null, error: new Error("permission denied for table app_settings") },
    });
    renderCard();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the pdf template settings/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/permission denied/i);
    expect(screen.queryByTestId("tpl-summary")).not.toBeInTheDocument();
  });
});
