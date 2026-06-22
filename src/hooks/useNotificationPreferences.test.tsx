import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithProviders } from "@/test/renderWithProviders";

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

const fetchSpy = vi.fn().mockResolvedValue({ at_risk: { email: false } });
vi.mock("@/data/notificationPreferences", () => ({
  fetchMyNotificationPreferences: (...a: unknown[]) => fetchSpy(...a),
  updateMyNotificationPreferences: vi.fn(),
}));

import { useNotificationPreferences } from "./useNotificationPreferences";

describe("useNotificationPreferences", () => {
  it("loads the current user's prefs", async () => {
    const { result } = renderHookWithProviders(() => useNotificationPreferences());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ at_risk: { email: false } });
  });
});
