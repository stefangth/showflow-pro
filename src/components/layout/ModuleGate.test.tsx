import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/hooks/useEntitlements", () => {
  const useFeature = vi.fn();
  return { useFeature, useModuleGate: (f: string) => ({ allow: useFeature(f), pending: false }) };
});
import { useFeature } from "@/hooks/useEntitlements";
import { ModuleGate } from "./ModuleGate";

describe("ModuleGate", () => {
  it("renders children untouched when the feature is enabled", () => {
    vi.mocked(useFeature).mockReturnValue(true);
    render(<ModuleGate feature="booking_flow"><button>Open tier</button></ModuleGate>);
    expect(screen.getByRole("button", { name: "Open tier" })).toBeInTheDocument();
    expect(screen.queryByTestId("module-gate-booking_flow")).not.toBeInTheDocument();
  });

  it("does NOT mount children when locked, so their queries never fire", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    const spy = vi.fn();
    function Child() { spy(); return <button>Open tier</button>; }
    render(<ModuleGate feature="booking_flow"><Child /></ModuleGate>);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open tier" })).not.toBeInTheDocument();
  });

  it("names the module in the notice when locked", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(<ModuleGate feature="booking_flow"><span>x</span></ModuleGate>);
    expect(screen.getByTestId("module-gate-booking_flow")).toBeInTheDocument();
    expect(screen.getByText("Booking engine is not enabled")).toBeInTheDocument();
  });

  it("renders the preview inert when locked", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(
      <ModuleGate feature="booking_flow" preview={<span>Ada Lovelace</span>}>
        <button>Open tier</button>
      </ModuleGate>,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByTestId("module-gate-preview")).toHaveClass("pointer-events-none");
  });

  it("keeps the locked preview readable: not aria-hidden, not select-none", () => {
    vi.mocked(useFeature).mockReturnValue(false);
    render(
      <ModuleGate feature="booking_flow" preview={<span>Ada Lovelace</span>}>
        <button>Open tier</button>
      </ModuleGate>,
    );
    // Decision 3 of the module gate: disabling a module freezes data, it never
    // hides it. `getByRole`/`getByText` on the accessibility tree would both miss
    // an aria-hidden subtree, which is exactly the regression this guards.
    const preview = screen.getByTestId("module-gate-preview");
    expect(preview).not.toHaveAttribute("aria-hidden");
    expect(preview).not.toHaveClass("select-none");
    // ...and the name is genuinely exposed to assistive tech, not merely present
    // in the DOM (queries default to ignoring aria-hidden content).
    expect(screen.getByText("Ada Lovelace", { ignore: "[aria-hidden='true']" })).toBeInTheDocument();
  });
});
