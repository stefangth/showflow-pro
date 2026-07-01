import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase } from "@/test/supabaseFake";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
Object.assign(client, createFakeSupabase({
  "rpc:bulk_import_artists": { data: [{ index: 1, status: "created", artist_id: "a1" }], error: null },
}));

import { ArtistImportDialog } from "./ArtistImportDialog";

const CSV = `name,email,phone,bio
Ada,ada@x.com,+49,Soprano
Bob,,,`;

describe("ArtistImportDialog", () => {
  it("drives source → map → review → done with dedup and commit", async () => {
    renderWithProviders(
      <ArtistImportDialog open onOpenChange={() => {}} orgId="o1" existingEmails={["ada@x.com"]} />,
    );

    // Source step
    expect(screen.getByText(/Drop a \.csv/i)).toBeInTheDocument();

    // Upload a CSV → advances to Map (auto-mapped).
    // jsdom lacks Blob.text() (real browsers have it since ~2020), so polyfill it here.
    const input = screen.getByLabelText("Upload spreadsheet") as HTMLInputElement;
    const file = new File([CSV], "artists.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: async () => CSV });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/Matched your columns/i)).toBeInTheDocument());

    // Continue → Review
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(screen.getByText("To import")).toBeInTheDocument());
    // Ada is a duplicate (existing), Bob is new → import 1
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText(/Duplicate — skip/i)).toBeInTheDocument();

    // Import → Done
    fireEvent.click(screen.getByRole("button", { name: /import 1 artist/i }));
    await waitFor(() => expect(screen.getByText(/Imported 1 artist/i)).toBeInTheDocument());
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument();
    expect(client.calls).toContainEqual(
      expect.objectContaining({ table: "rpc:bulk_import_artists", method: "rpc" }),
    );
  });
});
