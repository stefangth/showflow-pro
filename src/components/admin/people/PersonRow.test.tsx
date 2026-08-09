import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PersonRow } from "./PersonRow";
import type { Person } from "./peopleMatch";

const base: Person = {
  emailKey: "a@x.com", email: "a@x.com", status: "active", userId: "u1",
  displayName: "Ada", roles: ["producer"], lastSignInAt: null, invitation: null,
};
const noop = () => {};

describe("PersonRow", () => {
  it("active person shows an Active pill and a Remove control", () => {
    renderWithProviders(<PersonRow person={base} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("invited person shows an Invited pill and a Revoke control", () => {
    const invited: Person = {
      ...base, status: "invited", displayName: null,
      invitation: { id: "inv1", org_id: "o1", email: "a@x.com", role: "artist", status: "pending", token: "tok", expires_at: "2099-01-01" },
    };
    renderWithProviders(<PersonRow person={invited} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke invitation/i })).toBeInTheDocument();
  });

  it("invited revoke calls onRevoke with the invitation id", async () => {
    const onRevoke = vi.fn();
    const invited: Person = {
      ...base, status: "invited",
      invitation: { id: "inv1", org_id: "o1", email: "a@x.com", role: "artist", status: "pending", token: "tok", expires_at: "2099-01-01" },
    };
    renderWithProviders(<PersonRow person={invited} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={onRevoke} onSetRole={noop} onRequestRemove={noop} />);
    screen.getByRole("button", { name: /revoke invitation/i }).click();
    expect(onRevoke).toHaveBeenCalledWith("inv1");
  });
});
