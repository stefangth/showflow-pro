import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { roleLabel } from "@/config/app.config";
import { PersonRow } from "./PersonRow";
import type { Person } from "./peopleMatch";

const base: Person = {
  emailKey: "a@x.com", email: "a@x.com", status: "active", userId: "u1",
  displayName: "Ada", roles: ["producer"], lastSignInAt: null, invitation: null,
};
const noop = () => {};

const invitedFixture = (): Person => ({
  ...base, status: "invited", displayName: null,
  invitation: { id: "inv1", org_id: "o1", email: "a@x.com", role: "artist", status: "pending", token: "tok", expires_at: "2099-01-01", created_at: "2026-08-01T00:00:00Z" },
});

describe("PersonRow", () => {
  it("active person shows its role as a badge and a Remove control", () => {
    renderWithProviders(<PersonRow person={base} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText(roleLabel("producer"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revoke invitation/i })).not.toBeInTheDocument();
  });

  it("the self row shows a 'You' marker and no Remove control", () => {
    renderWithProviders(<PersonRow person={base} isSelf onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText(/^you$/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^remove$/i })).not.toBeInTheDocument();
  });

  it("invited person shows a Revoke control and does not render the email twice", () => {
    renderWithProviders(<PersonRow person={invitedFixture()} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByRole("button", { name: /revoke invitation/i })).toBeInTheDocument();
    // Regression: with no display name the email is the primary line only — never duplicated.
    expect(screen.getAllByText("a@x.com")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^remove$/i })).not.toBeInTheDocument();
  });

  it("invited revoke calls onRevoke with the invitation id", () => {
    const onRevoke = vi.fn();
    renderWithProviders(<PersonRow person={invitedFixture()} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={onRevoke} onSetRole={noop} onRequestRemove={noop} />);
    screen.getByRole("button", { name: /revoke invitation/i }).click();
    expect(onRevoke).toHaveBeenCalledWith("inv1");
  });
});
