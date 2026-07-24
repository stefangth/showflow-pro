import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionRow } from "./PermissionRow";
import type { CapabilityMatrixCell } from "@/hooks/useCapabilities";
import { CAPABILITY_REGISTRY } from "@/lib/capabilities";

function cell(key: string, over: Partial<CapabilityMatrixCell> = {}): CapabilityMatrixCell {
  const def = CAPABILITY_REGISTRY[key];
  return { def, effective: def.defaultEnabled, locked: false, source: "registry", policyLocked: false, ...over };
}

describe("PermissionRow", () => {
  it("renders the label and an enabled producer switch reflecting effective", () => {
    render(<PermissionRow cell={cell("producer_can_rename_org", { effective: false })} mode="org" onToggleOverride={vi.fn()} />);
    // Anchored: the description for this capability ("Producers can rename the
    // organization.") also contains the label text as a substring, so an
    // unanchored case-insensitive regex matches both paragraphs.
    expect(screen.getByText(/^Rename the organization$/i)).toBeInTheDocument();
    expect(screen.getByRole("switch")).not.toBeChecked();
  });

  it("org mode: toggling the switch calls onToggleOverride with the new value", () => {
    const onToggle = vi.fn();
    render(<PermissionRow cell={cell("producer_can_manage_casts", { effective: true })} mode="org" onToggleOverride={onToggle} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("locked cell in org mode is disabled and shows the managed note", () => {
    render(<PermissionRow cell={cell("producer_can_issue_hire_orders", { locked: true, effective: false })} mode="org" onToggleOverride={vi.fn()} />);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.getByText(/managed by ShowFlow/i)).toBeInTheDocument();
  });

  it("platform mode shows a lock toggle wired to onToggleLock", () => {
    const onLock = vi.fn();
    render(<PermissionRow cell={cell("producer_can_rename_org")} mode="platform" onToggleOverride={vi.fn()} onToggleLock={onLock} onSetPlatformDefault={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /lock/i }));
    expect(onLock).toHaveBeenCalledWith(true);
  });
});
