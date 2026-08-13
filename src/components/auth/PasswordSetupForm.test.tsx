import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordSetupForm } from "./PasswordSetupForm";
import { MIN_PASSWORD_LENGTH } from "@/features/auth/resetPassword";

const api = vi.hoisted(() => ({ change: vi.fn(), setup: vi.fn(), reauthenticate: vi.fn(), invalidate: vi.fn() }));
const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("@/data/profiles", () => ({
  changeMyPassword: (...args: unknown[]) => api.change(...args),
  setMyPassword: (...args: unknown[]) => api.setup(...args),
  requestPasswordReauthentication: (...args: unknown[]) => api.reauthenticate(...args),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/usePasswordStatus", () => ({ invalidatePasswordStatus: (...args: unknown[]) => api.invalidate(...args) }));

function fillNewPasswords(password = "new-secret") {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: password } });
}

function renderForm(props: React.ComponentProps<typeof PasswordSetupForm>) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PasswordSetupForm {...props} /></QueryClientProvider>);
}

describe("PasswordSetupForm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows setup copy and validates the shared password requirements", async () => {
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    expect(screen.getByRole("heading", { name: "Set a password" })).toBeInTheDocument();
    fillNewPasswords("short");
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("At least 8 characters")).toBeInTheDocument();
    expect(api.setup).not.toHaveBeenCalled();
    expect(screen.getByText(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)).toBeInTheDocument();
  });

  it("reports confirmation mismatch", async () => {
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-secret" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
  });

  it("provides accessible show and hide controls", () => {
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    const input = screen.getByLabelText("New password");
    fireEvent.click(screen.getByRole("button", { name: "Show new password" }));
    expect(input).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide new password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("submits current and new passwords in change mode and calls success", async () => {
    api.change.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    renderForm({ mode: "change", onSuccess });
    expect(screen.getByRole("heading", { name: "Change password" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-secret" } });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(api.change).toHaveBeenCalledWith({}, {
      password: "new-secret",
      currentPassword: "old-secret",
    }));
    expect(api.invalidate).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
    expect(toastApi.success).toHaveBeenCalledWith("Password changed");
  });

  it("disables submit while pending", async () => {
    api.setup.mockImplementationOnce(() => new Promise(() => undefined));
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Setting password…" })).toBeDisabled());
  });

  it("requests reauthentication, preserves the new password, and retries with a six-digit nonce", async () => {
    api.change.mockRejectedValueOnce(Object.assign(new Error("Reauthentication needed"), { code: "reauthentication_needed" })).mockResolvedValueOnce(undefined);
    api.reauthenticate.mockResolvedValueOnce(undefined);
    renderForm({ mode: "change", onSuccess: vi.fn() });
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-secret" } });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Check your email for the 6-digit code")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("new-secret");
    const nonce = screen.getByLabelText("6-digit code");
    expect(nonce).toHaveAttribute("inputmode", "numeric");
    fireEvent.change(nonce, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(api.change).toHaveBeenLastCalledWith({}, { password: "new-secret", nonce: "123456" }));
  });

  it("requests reauthentication in setup mode and retries setup with the nonce", async () => {
    api.setup.mockRejectedValueOnce(Object.assign(new Error("Reauthentication needed"), { code: "reauthentication_needed" }));
    api.change.mockResolvedValueOnce(undefined);
    api.reauthenticate.mockResolvedValueOnce(undefined);
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));

    expect(await screen.findByText("Check your email for the 6-digit code")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveValue("new-secret");
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));

    await waitFor(() => expect(api.change).toHaveBeenCalledWith({}, { password: "new-secret", nonce: "123456" }));
  });

  it("provides persistent requirements, strength feedback, and semantic validation associations", async () => {
    renderForm({ mode: "setup", onSuccess: vi.fn() });
    const password = screen.getByLabelText("New password");
    const confirm = screen.getByLabelText("Confirm new password");
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(screen.getByText("Not entered")).toBeInTheDocument();

    fillNewPasswords("short");
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Please fix the password fields below.");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAttribute("aria-describedby", expect.stringContaining("new-password-error"));
    expect(password).toHaveAttribute("aria-describedby", expect.stringContaining("password-requirements"));
    expect(confirm).toHaveAttribute("aria-describedby", expect.stringContaining("password-requirements"));
  });

  it("calls cancel and renders auth errors inline", async () => {
    api.setup.mockRejectedValueOnce(new Error("Password update failed"));
    const onCancel = vi.fn();
    renderForm({ mode: "setup", onSuccess: vi.fn(), onCancel });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    fillNewPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Set password" }));
    expect(await screen.findByText("Password update failed")).toBeInTheDocument();
    expect(toastApi.error).toHaveBeenCalledWith("Password update failed");
  });
});
