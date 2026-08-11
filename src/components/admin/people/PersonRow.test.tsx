import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { roleLabel, ROLE_DESCRIPTIONS } from "@/config/app.config";
import { ROLE_OPTIONS } from "./roleOptions";
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

  it("shows resend info on a pending row once it has been resent", () => {
    const p = invitedFixture();
    p.invitation = { ...p.invitation!, last_resent_at: "2026-08-10T14:30:00Z", resent_count: 2 };
    renderWithProviders(<PersonRow person={p} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    expect(screen.getByText(/Resent 2.*last/i)).toBeInTheDocument();
  });

  it("the Roles dropdown shows a one-line description under every role option", () => {
    renderWithProviders(<PersonRow person={base} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    // Radix's DropdownMenuTrigger opens on pointerdown or Enter/Space, not a plain
    // synthetic "click" event; jsdom has no PointerEvent, so use the keyboard path.
    fireEvent.keyDown(screen.getByRole("button", { name: /edit roles for/i }), { key: "Enter" });
    for (const r of ROLE_OPTIONS) {
      expect(screen.getByText(ROLE_DESCRIPTIONS[r])).toBeInTheDocument();
    }
  });

  // Regression: DropdownMenuCheckboxItem's check indicator is absolutely positioned
  // and, by default, vertically centred on the whole (now two-line) item — so the
  // check mark for the active role sat beside the DESCRIPTION instead of the role
  // name it marks. Each item must top-align its content instead (see the
  // `items-start` className on DropdownMenuCheckboxItem in PersonRow.tsx).
  //
  // Not asserted here: jsdom does not lay out Radix's absolutely-positioned check
  // indicator, so there is no layout signal in this environment to assert on, and
  // matching the `items-start` Tailwind class by name would only pin today's exact
  // styling mechanism (it would false-fail on an equivalent restyle, e.g. an
  // inline style or a different alignment utility that fixes the same bug). This
  // was verified visually in the browser instead; a real regression here needs a
  // visual/e2e check, not a jsdom class-name match.
  it("the Roles dropdown renders each option as a checkbox item with its label and description together", () => {
    renderWithProviders(<PersonRow person={base} isSelf={false} onCopyLink={noop} onResend={noop} onRevoke={noop} onSetRole={noop} onRequestRemove={noop} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /edit roles for/i }), { key: "Enter" });
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items.length).toBe(ROLE_OPTIONS.length);
    for (const [i, item] of items.entries()) {
      const r = ROLE_OPTIONS[i];
      expect(item).toHaveTextContent(roleLabel(r));
      expect(item).toHaveTextContent(ROLE_DESCRIPTIONS[r]);
    }
  });
});
