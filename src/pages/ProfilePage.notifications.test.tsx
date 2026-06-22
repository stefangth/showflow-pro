import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@x.com" } }) }));
vi.mock("@/hooks/useMyProfile", () => ({
  useMyProfile: () => ({ data: { display_name: "Ada", phone: "" }, isLoading: false }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));
const updateMutate = vi.fn();
vi.mock("@/hooks/useNotificationPreferences", () => ({
  useNotificationPreferences: () => ({ data: { booking_offers: { email: false } }, isLoading: false }),
  useUpdateNotificationPreferences: () => ({ mutate: updateMutate, isPending: false }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import ProfilePage from "./ProfilePage";

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe("ProfilePage notification preferences", () => {
  it("renders a switch per category and reflects a disabled value", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Notifications")).toBeInTheDocument());
    const offersEmail = screen.getByLabelText("Booking offers email");
    expect(offersEmail).not.toBeChecked();
  });

  it("writes the merged map when a switch is toggled", async () => {
    render(wrap(<ProfilePage />));
    await waitFor(() => expect(screen.getByText("Notifications")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Booking offers email"));
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ booking_offers: expect.objectContaining({ email: true }) }),
      expect.anything(),
    );
  });
});
