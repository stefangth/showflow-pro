import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TermsLibraryPicker } from "./TermsLibraryPicker";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";

const LIB: HireOrderTemplate[] = [
  { id: "a", name: "Standard engagement", clauses: [{ title: "Fee", body: "14 days." }, { title: "Cancel", body: "21 days." }] },
  { id: "b", name: "Guest artist, per session", clauses: [{ title: "Fee", body: "Per session." }] },
];

describe("TermsLibraryPicker", () => {
  it("lists every library template with its clause count", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByText("Standard engagement")).toBeInTheDocument();
    expect(screen.getByText(/2 clauses/)).toBeInTheDocument();
    expect(screen.getByText(/1 clause\b/)).toBeInTheDocument();
  });

  it("toggles selection", () => {
    const onToggle = vi.fn();
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Standard engagement/ }));
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("marks a template the org already holds and disables re-selecting it", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={["a"]} onToggle={vi.fn()} />);
    expect(screen.getByText("Already added")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Standard engagement/ })).toBeDisabled();
  });

  it("disables every checkbox when readOnly", () => {
    render(<TermsLibraryPicker library={LIB} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} readOnly />);
    for (const cb of screen.getAllByRole("checkbox")) expect(cb).toBeDisabled();
  });

  it("renders an explanatory empty state when the library is empty", () => {
    render(<TermsLibraryPicker library={[]} selectedIds={[]} alreadyHeldIds={[]} onToggle={vi.fn()} />);
    expect(screen.getByText(/No templates in the library/i)).toBeInTheDocument();
  });
});
