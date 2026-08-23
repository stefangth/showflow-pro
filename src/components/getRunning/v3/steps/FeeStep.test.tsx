import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Approved fake in a hoisted holder (vi.mock is hoisted above imports) — never a
// hand-rolled vi.mock chain, per SourceStep.test.tsx. FeeStep mounts the real
// OrderDefaultsCard, which reads/writes `app_settings` via the shared supabase
// singleton — the fake stands in for that singleton.
const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));

// useCan drives the read-only gate. Mocked to a controllable flat boolean, same
// pattern as SourceStep.test.tsx / SkillsStep.test.tsx.
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { FeeStep } from "@/components/getRunning/v3/steps/FeeStep";

function seedAppSettings() {
  Object.assign(client, createFakeSupabase({ app_settings: { data: [], error: null } }));
}

function renderStep(onDone = vi.fn()) {
  const result = renderWithProviders(<FeeStep orgId="org-1" onDone={onDone} />, { authOverrides: {} });
  return { ...result, onDone };
}

describe("FeeStep", () => {
  beforeEach(() => {
    vi.mocked(useCan).mockReturnValue(true);
    seedAppSettings();
  });

  it("shows the per-cast shell note and advances on continue when capable", async () => {
    const { onDone } = renderStep();

    expect(screen.getByText(/fees per production and cast/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("renders read-only (no continue) when the viewer cannot edit", () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderStep();

    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByText(/set by an admin/i)).toBeInTheDocument();
  });
});
