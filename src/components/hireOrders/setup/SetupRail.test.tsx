import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

const { canRef } = vi.hoisted(() => ({ canRef: { value: true } }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => canRef.value }));

function seedClient(seed: Record<string, TableSeed>) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase(seed));
}

import { SetupRail } from "./SetupRail";

beforeEach(() => {
  localStorage.clear();
  canRef.value = true;
  seedClient({ app_settings: { data: [], error: null } });
});

describe("SetupRail", () => {
  it("shows all three steps, with a blocking chip on exactly two", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Terms template")).toBeInTheDocument();
    expect(screen.getByText("Countersigning")).toBeInTheDocument();
    expect(screen.getAllByText("Blocks issue")).toHaveLength(2);
  });

  it("reports progress out of three", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/0 of 3/)).toBeInTheDocument();
  });

  it("renders the waiting card instead when the viewer cannot edit settings", async () => {
    canRef.value = false;
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText(/An admin needs to finish setup/i)).toBeInTheDocument();
    expect(screen.queryByText("Blocks issue")).not.toBeInTheDocument();
    // The eyebrow must ride the --amber-600 var, which lifts to #F2B23C on a dark
    // card; Tailwind's built-in amber-600 stays #d97706 and fails contrast there.
    expect(screen.getByText("Waiting on your admin").className).toContain("var(--amber-600)");
  });

  // SetupRail no longer self-hides on dismissed / complete / no-org / producer-nothing-
  // blocks: that visibility decision belongs to useSetupRailVisible (see
  // useSetupRailVisible.test.ts, which covers all four). This rail is a dumb content surface
  // mounted only inside SetupChecklistSheet's `open`, so it must always render its steps --
  // otherwise a step opened from the dashboard (a different dismiss key) blanks the Sheet.
  it("still renders its steps when the rail was previously dismissed (never blanks the Sheet)", async () => {
    localStorage.setItem("showflow.hireOrderSetup.hidden.org-1", "true");
    renderWithProviders(<SetupRail orgId="org-1" />);
    expect(await screen.findByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Terms template")).toBeInTheDocument();
    expect(screen.getByText("Countersigning")).toBeInTheDocument();
  });

  it("styles the blocking chip with the design-system amber tokens", async () => {
    // bg-amber-100 / text-amber-600 resolve to Tailwind's built-in palette, which
    // carries no dark-mode override; the --amber-* vars in index.css do.
    renderWithProviders(<SetupRail orgId="org-1" />);
    const chip = (await screen.findAllByText("Blocks issue"))[0];
    expect(chip.className).toContain("var(--amber-100)");
    expect(chip.className).toContain("var(--amber-600)");
  });

  it("opens the step named by initialStep", async () => {
    renderWithProviders(<SetupRail orgId="org-1" initialStep="terms" />);
    const termsToggle = await screen.findByRole("button", { name: /Terms template/ });
    expect(termsToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("associates each disclosure button with the panel it expands", async () => {
    renderWithProviders(<SetupRail orgId="org-1" />);
    const button = (await screen.findByText("Letterhead")).closest("button") as HTMLButtonElement;
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(panelId!)).toBeInTheDocument();
  });
});
