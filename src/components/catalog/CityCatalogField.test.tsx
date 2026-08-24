import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

// Creating a city writes through the same data-access function Settings uses.
const createCity = vi.fn((..._a: unknown[]) => Promise.resolve({ id: "c-9", name: "Leipzig" }));
vi.mock("@/data/cities", async (orig) => ({
  ...(await orig<typeof import("@/data/cities")>()),
  createCity: (...a: unknown[]) => createCity(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/hooks/useCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useCan } from "@/hooks/useCapabilities";
import { CityCatalogField } from "./CityCatalogField";

function renderField(opts: { cities?: { id: string; name: string }[]; error?: { message: string } }) {
  Object.assign(
    client,
    createFakeSupabase({
      cities: opts.error
        ? { data: null, error: opts.error }
        : { data: (opts.cities ?? []).map((c) => ({ ...c, airtable_city_key: null })), error: null },
    }),
  );
  return renderWithProviders(<CityCatalogField orgId="org-1" />, {
    authOverrides: { currentOrg: { id: "org-1" } as never },
  });
}

describe("CityCatalogField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCan).mockReturnValue(true);
    createCity.mockResolvedValue({ id: "c-9", name: "Leipzig" });
  });

  it("lists the org's existing cities", async () => {
    renderField({ cities: [{ id: "c1", name: "Bremen" }, { id: "c2", name: "Hamburg" }] });
    expect(await screen.findByText("Bremen")).toBeInTheDocument();
    expect(screen.getByText("Hamburg")).toBeInTheDocument();
  });

  it("says the list is shared across productions, not owned by this one", async () => {
    renderField({ cities: [{ id: "c1", name: "Bremen" }] });
    expect(await screen.findByText(/shared across every production/i)).toBeInTheDocument();
  });

  it("renders existing cities as non-interactive chips (nothing is stored per production)", async () => {
    renderField({ cities: [{ id: "c1", name: "Bremen" }] });
    const chip = await screen.findByText("Bremen");
    expect(chip.tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: "Bremen" })).toBeNull();
  });

  it("creates a city inline", async () => {
    renderField({ cities: [] });
    fireEvent.click(await screen.findByRole("button", { name: /new city/i }));
    const input = screen.getByRole("textbox", { name: /city name/i });
    fireEvent.change(input, { target: { value: "Leipzig" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(createCity).toHaveBeenCalledWith(expect.anything(), { name: "Leipzig", orgId: "org-1" }),
    );
  });

  it("Enter in the city name never submits an enclosing form", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    Object.assign(client, createFakeSupabase({ cities: { data: [], error: null } }));
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <CityCatalogField orgId="org-1" />
      </form>,
      { authOverrides: { currentOrg: { id: "org-1" } as never } },
    );
    fireEvent.click(await screen.findByRole("button", { name: /new city/i }));
    const input = screen.getByRole("textbox", { name: /city name/i });
    fireEvent.change(input, { target: { value: "Leipzig" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(createCity).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hides the create affordance without manage_cities", async () => {
    vi.mocked(useCan).mockReturnValue(false);
    renderField({ cities: [] });
    expect(await screen.findByText(/an admin can add them/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new city/i })).toBeNull();
  });

  it("offers inline creation in the empty hint when the producer may create", async () => {
    renderField({ cities: [] });
    expect(await screen.findByText(/add the first one here/i)).toBeInTheDocument();
    expect(screen.queryByText(/an admin can add them/i)).toBeNull();
  });

  it("says the read failed rather than showing a reassuring empty state", async () => {
    renderField({ error: { message: "boom" } });
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no cities yet/i)).toBeNull();
  });
});
