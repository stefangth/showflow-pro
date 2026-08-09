import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthCallbackPage from "./AuthCallbackPage";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

// Controllable auth mock
let sessionResult: { data: { session: unknown } } = { data: { session: null } };
const authCbs: Array<(e: string, s: unknown) => void> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve(sessionResult),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        authCbs.push(cb);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/auth/callback" element={<AuthCallbackPage />} /></Routes>
    </MemoryRouter>,
  );

beforeEach(() => { navigateSpy.mockClear(); authCbs.length = 0; sessionResult = { data: { session: null } }; window.location.hash = ""; });

describe("AuthCallbackPage", () => {
  it("navigates to the validated redirect on SIGNED_IN", async () => {
    renderAt("/auth/callback?redirect=/accept-invite?token=x");
    authCbs.forEach((cb) => cb("SIGNED_IN", { user: { id: "u" } }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/accept-invite?token=x", { replace: true }));
  });

  it("clamps an unsafe redirect to /dashboard", async () => {
    renderAt("/auth/callback?redirect=//evil.com");
    authCbs.forEach((cb) => cb("SIGNED_IN", { user: { id: "u" } }));
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith("/dashboard", { replace: true }));
  });

  it("shows the recovery state immediately on an error hash (first commit, no timers, no auth listener)", () => {
    window.location.hash = "#error=access_denied&error_description=expired";
    renderAt("/auth/callback");
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(authCbs.length).toBe(0); // if (failed) return: no listener wired
  });

  it("falls back to the recovery link after the watchdog when no session and no error hash", () => {
    vi.useFakeTimers();
    renderAt("/auth/callback");
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByText(/request a new sign-in link/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
