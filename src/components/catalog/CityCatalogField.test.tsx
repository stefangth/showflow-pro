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

// The Airtable console is heavyweight (roughly ten queries), so the field mounts it only
// for an org whose dates source IS Airtable. Both hooks are mocked so the tests can seed
// the source and assert the console is never even called for the other sources.
vi.mock("@/hooks/useDatesSource", () => ({ useDatesSource: vi.fn() }));
vi.mock("@/hooks/useAirtableConsole", () => ({ useAirtableConsole: vi.fn() }));

import { toast } from "sonner";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import { useAirtableConsole } from "@/hooks/useAirtableConsole";
import { CityCatalogField } from "./CityCatalogField";

const onCreate = vi.fn();
function airtableConsole(over: Partial<ReturnType<typeof useAirtableConsole>> = {}) {
  return { canWrite: true, ready: true, cityRows: [], onCreate, ...over } as unknown as ReturnType<typeof useAirtableConsole>;
}

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
    vi.mocked(useCan).mockImplementation(() => true);
    vi.mocked(useDatesSource).mockReturnValue({ source: null, isLoading: false, save: vi.fn(), saving: false });
    vi.mocked(useAirtableConsole).mockReturnValue(airtableConsole());
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

  /**
   * With no active org there is nowhere to add a city TO, so "an admin can add them in
   * Settings" is false even when the viewer IS the admin. (The unreachable `form.cities.noOrg`
   * error copy that used to sit behind this state went with it.)
   */
  it("does not tell a viewer with no active org that an admin can add cities in Settings", async () => {
    Object.assign(client, createFakeSupabase({ cities: { data: [], error: null } }));
    renderWithProviders(<CityCatalogField orgId={null} />, { authOverrides: { currentOrg: null as never } });

    expect(await screen.findByText("No cities yet.")).toBeInTheDocument();
    expect(screen.queryByText(/an admin can add them/i)).toBeNull();
    expect(screen.queryByText(/add the first one here/i)).toBeNull();
  });

  it("says the read failed rather than showing a reassuring empty state", async () => {
    renderField({ error: { message: "boom" } });
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no cities yet/i)).toBeNull();
  });

  it("names a duplicate city instead of showing the raw Postgres error", async () => {
    createCity.mockRejectedValue({ code: "23505", message: 'duplicate key value violates unique constraint "cities_org_name_uniq"' });
    renderField({ cities: [{ id: "c1", name: "Bremen" }] });
    fireEvent.click(await screen.findByRole("button", { name: /new city/i }));
    const input = screen.getByRole("textbox", { name: /city name/i });
    fireEvent.change(input, { target: { value: "Bremen" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const msg = vi.mocked(toast.error).mock.calls[0][0] as string;
    expect(msg).toMatch(/Bremen/);
    expect(msg).not.toMatch(/duplicate key|constraint/i);
  });

  it("never surfaces the data layer's blank-name sentinel as copy", async () => {
    createCity.mockRejectedValue(new Error("CITY_NAME_REQUIRED"));
    renderField({ cities: [] });
    fireEvent.click(await screen.findByRole("button", { name: /new city/i }));
    const input = screen.getByRole("textbox", { name: /city name/i });
    fireEvent.change(input, { target: { value: "Leipzig" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0][0]).not.toMatch(/CITY_NAME_REQUIRED/);
  });

  describe("Airtable unresolved cities", () => {
    const KAMPNAGEL = { key: "kampnagel", display: "Kampnagel", linkedId: null, linkedLabel: null };
    const LINKED = { key: "bremen", display: "Bremen", linkedId: "c1", linkedLabel: "Bremen" };

    it("offers a create-and-link chip per unlinked imported city", async () => {
      vi.mocked(useDatesSource).mockReturnValue({ source: "airtable", isLoading: false, save: vi.fn(), saving: false });
      vi.mocked(useAirtableConsole).mockReturnValue(airtableConsole({ cityRows: [KAMPNAGEL, LINKED] }));
      renderField({ cities: [] });
      const chip = await screen.findByRole("button", { name: /kampnagel/i });
      // Already-linked imported names are not offered again.
      expect(screen.queryByRole("button", { name: /bremen/i })).toBeNull();
      fireEvent.click(chip);
      expect(onCreate).toHaveBeenCalledWith("city", KAMPNAGEL);
    });

    it("does not mount the console at all for a non-Airtable org", async () => {
      vi.mocked(useDatesSource).mockReturnValue({ source: "manual", isLoading: false, save: vi.fn(), saving: false });
      renderField({ cities: [{ id: "c1", name: "Bremen" }] });
      expect(await screen.findByText("Bremen")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /kampnagel/i })).toBeNull();
      expect(useAirtableConsole).not.toHaveBeenCalled();
    });

    it("shows nothing extra to a producer without configure_airtable, and skips the console", async () => {
      vi.mocked(useCan).mockImplementation((action: string) => action !== "configure_airtable");
      vi.mocked(useDatesSource).mockReturnValue({ source: "airtable", isLoading: false, save: vi.fn(), saving: false });
      renderField({ cities: [] });
      expect(await screen.findByRole("button", { name: /new city/i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /kampnagel/i })).toBeNull();
      expect(useAirtableConsole).not.toHaveBeenCalled();
    });
  });
});
