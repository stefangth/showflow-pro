import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/hooks/useEntitlements", () => ({ useFeature: vi.fn() }));
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
    expect(screen.getByText("Booking flow is not enabled")).toBeInTheDocument();
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
});
