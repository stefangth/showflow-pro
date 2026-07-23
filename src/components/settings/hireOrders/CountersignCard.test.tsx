import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";

const upsert = vi.fn().mockResolvedValue(undefined);
vi.mock("@/data/settings", () => ({
  resolveOrgSetting: vi.fn().mockResolvedValue({ mode: "manual" }),
  upsertOrgSetting: (...a: unknown[]) => upsert(...a),
}));

import { CountersignCard } from "./CountersignCard";

describe("CountersignCard", () => {
  beforeEach(() => upsert.mockClear());

  it("offers Electronic and no Documenso option", async () => {
    renderWithProviders(<CountersignCard orgId="o1" />);
    await waitFor(() => expect(screen.getByText(/electronic signature/i)).toBeInTheDocument());
    expect(screen.queryByText(/documenso/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /test connection/i })).not.toBeInTheDocument();
  });
});
