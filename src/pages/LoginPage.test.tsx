import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithProviders } from "@/test/renderWithProviders";
import LoginPage from "./LoginPage";

const requestLoginLink = vi.fn();
vi.mock("@/data/authLinks", () => ({ requestLoginLink: (...a: unknown[]) => requestLoginLink(...a) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a) } }));

// LoginPage pulls signIn from AuthContext and openPreferences from ConsentContext;
// renderWithProviders wraps only QueryClient + Tooltip, so stub those two contexts.
const signIn = vi.fn();
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ signIn }) }));
vi.mock("@/features/consent/ConsentContext", () => ({ useConsent: () => ({ openPreferences: vi.fn() }) }));

const renderPage = () =>
  renderWithProviders(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  requestLoginLink.mockReset();
  toastSuccess.mockReset();
  signIn.mockReset();
});

describe("LoginPage magic-link action", () => {
  it("renders Sign in then the sign-in-link button (co-equal), an 'or' divider, and Forgot password below both", () => {
    renderPage();
    const signInBtn = screen.getByRole("button", { name: /^sign in$/i });
    const link = screen.getByRole("button", { name: /email me a sign-in link/i });
    // DOM order: Sign in before the link button
    expect(signInBtn.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Same visual weight: both carry the default variant's fill class
    expect(signInBtn.className).toMatch(/bg-primary/);
    expect(link.className).toMatch(/bg-primary/);
    // Divider
    expect(screen.getByText(/^or$/i)).toBeInTheDocument();
    // Forgot password below both buttons
    const forgot = screen.getByRole("link", { name: /forgot password/i });
    expect(link.compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("empty email: focuses the field and does not call the function", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    expect(requestLoginLink).not.toHaveBeenCalled();
  });

  it("with email: calls requestLoginLink and shows the generic toast", async () => {
    requestLoginLink.mockResolvedValueOnce(undefined);
    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(requestLoginLink).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/if that email exists/i));
  });

  it("rejected request still shows the same success toast (no enumeration)", async () => {
    requestLoginLink.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "user@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: /email me a sign-in link/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/if that email exists/i)));
  });
});
