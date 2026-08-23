import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per SourceStep.test.tsx. DocumentStep mounts the real
// NumberingCard, which reads/writes `app_settings` via the shared supabase singleton —
// the fake stands in for that singleton, same pattern as FeeStep.test.tsx.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same pattern
// as SourceStep.test.tsx / SkillsStep.test.tsx / FeeStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { DocumentStep } from "@/components/getRunning/v3/steps/DocumentStep";

function seedAppSettings() {
  Object.assign(client, createFakeSupabase({ app_settings: { data: [], error: null } }));
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(
    <MemoryRouter>
      <DocumentStep orgId="org-1" onDone={onDone} />
    </MemoryRouter>,
  );
  return { ...result, onDone };
}

describe("DocumentStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
    seedAppSettings();
  });

  it("links to the template editor and advances on continue when capable", async () => {
    const { onDone } = renderStep();

    expect(screen.getByRole("link", { name: /template editor/i })).toHaveAttribute(
      "href",
      "/settings/contracts/template",
    );

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("renders read-only (no continue) when the viewer cannot edit", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderStep();

    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();

    // The reused NumberingCard is genuinely put in read-only mode (readOnly={!canEdit}):
    // once it loads, its Save control is the only button on screen (the wizard Continue is
    // gone) and it is disabled. Without the readOnly wiring a producer could still write org
    // numbering. findAllByRole awaits the card's own async query settling.
    const buttons = await screen.findAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeDisabled();
  });
});
