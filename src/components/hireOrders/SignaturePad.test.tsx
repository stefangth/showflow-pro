import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the canvas library — jsdom cannot draw. The fake mirrors signature_pad@5's real
// EventTarget-style API (addEventListener/off, no constructor callback options) so the
// component's callback-ref wiring, including the drawn-signature (endStroke) path, can be
// exercised end to end.
interface FakeInstance {
  empty: boolean;
  penColor?: string;
  endStroke?: () => void;
  isEmpty: () => boolean;
  clear: () => void;
  toDataURL: () => string;
  addEventListener: (event: string, cb: () => void) => void;
  off: () => void;
}
const instances: FakeInstance[] = [];
vi.mock("signature_pad", () => ({
  default: class {
    empty = true;
    endStroke?: () => void;
    penColor?: string;
    constructor(_canvas: unknown, options?: { penColor?: string }) {
      this.penColor = options?.penColor;
      instances.push(this);
    }
    isEmpty() { return this.empty; }
    clear() { this.empty = true; }
    toDataURL() { return "data:image/png;base64,DRAWN"; }
    addEventListener(event: string, cb: () => void) {
      if (event === "endStroke") this.endStroke = cb;
    }
    off() {}
  },
}));

import { SignaturePad } from "./SignaturePad";

// Radix TabsTrigger activates on mousedown (button 0), not click.
function activateDrawTab() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Draw" }), { button: 0 });
}

function activateTypeTab() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Type" }), { button: 0 });
}

describe("SignaturePad", () => {
  beforeEach(() => { instances.length = 0; });
  afterEach(() => { document.documentElement.classList.remove("dark"); });

  it("opens Draw first and uses white ink in a dark root", () => {
    document.documentElement.classList.add("dark");
    render(<SignaturePad value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: "Draw" })).toHaveAttribute("data-state", "active");
    expect(instances[0].penColor).toBe("#ffffff");
  });

  it("emits a typed value as the name is entered", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    activateTypeTab();
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "Ann Lee" } });
    expect(onChange).toHaveBeenCalledWith({ method: "typed", typedName: "Ann Lee" });
  });

  it("clears the typed value to null when emptied", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={{ method: "typed", typedName: "X" }} onChange={onChange} />);
    activateTypeTab();
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("constructs the pad on mount because Draw is active first", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    expect(instances).toHaveLength(1);
  });

  it("emits a drawn value on endStroke when the pad has ink", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    activateDrawTab();
    const pad = instances[0];
    pad.empty = false;
    pad.endStroke?.();
    expect(onChange).toHaveBeenCalledWith({ method: "drawn", pngDataUrl: "data:image/png;base64,DRAWN" });
  });

  it("emits null on endStroke when the pad is still empty", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    activateDrawTab();
    const pad = instances[0];
    pad.endStroke?.();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("Clear emits null", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    activateDrawTab();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("locks the draw canvas to pointer input when disabled", () => {
    const onChange = vi.fn();
    const { container } = render(<SignaturePad value={null} onChange={onChange} disabled />);
    activateDrawTab();
    const canvas = container.querySelector("canvas");
    expect(canvas?.className).toContain("pointer-events-none");
    expect(canvas?.className).toContain("opacity-50");
  });
});
