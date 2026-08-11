import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "@/test/renderWithProviders";
import { RemovedPersonRow } from "./RemovedPersonRow";
import type { RemovedMember } from "@/data/members";

const base: RemovedMember = {
  user_id: "u1", email: "t@t.test", display_name: "Tobias", roles: ["artist"],
  removed_at: "2026-08-11T09:00:00Z", removed_by_name: "David", deletable: false,
};

describe("RemovedPersonRow", () => {
  it("shows Clear from list (not Delete) when not deletable", () => {
    renderWithProviders(<RemovedPersonRow member={base} onUndo={vi.fn()} onClear={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /clear .* from list/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete account/i })).not.toBeInTheDocument();
  });

  it("shows Delete account when deletable", () => {
    renderWithProviders(<RemovedPersonRow member={{ ...base, deletable: true }} onUndo={vi.fn()} onClear={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /delete account/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear .* from list/i })).not.toBeInTheDocument();
  });

  it("Undo calls onUndo with the user id", () => {
    const onUndo = vi.fn();
    renderWithProviders(<RemovedPersonRow member={base} onUndo={onUndo} onClear={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /undo removal/i }));
    expect(onUndo).toHaveBeenCalledWith("u1");
  });

  it("Delete routes through onDelete (a typed confirm), not a direct purge", () => {
    const onDelete = vi.fn();
    renderWithProviders(<RemovedPersonRow member={{ ...base, deletable: true }} onUndo={vi.fn()} onClear={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1" }));
  });
});
