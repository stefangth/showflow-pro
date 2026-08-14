import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ hasRole: () => true, currentOrg: { id: "org-1" } }) }));
vi.mock("@/hooks/useCapabilities", () => ({ useCan: () => true }));

Object.assign(
  client,
  createFakeSupabase({
    cities: { data: [], error: null },
    casts: { data: [], error: null },
    cast_members: { data: [], error: null },
    cast_city_priority: { data: [], error: null },
    shows: { data: [], error: null },
    show_dates: { data: [], error: null },
    show_cast_eligibility: { data: [], error: null },
  }),
);

import { CastsCoverageTab } from "./CastsCoverageTab";

describe("CastsCoverageTab", () => {
  it("renders the header and defaults to the Coverage segment", () => {
    renderWithProviders(<CastsCoverageTab orgId="org-1" />);
    expect(screen.getByText("ORGANIZATION · BOOKING")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Casts & coverage" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Coverage" })).toHaveAttribute("aria-selected", "true");
  });

  it("switches to the Production Ownership placeholder", () => {
    renderWithProviders(<CastsCoverageTab orgId="org-1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Production Ownership" }));
    expect(screen.getByText("Production Ownership (coming in next task)")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Production Ownership" })).toHaveAttribute("aria-selected", "true");
  });
});
