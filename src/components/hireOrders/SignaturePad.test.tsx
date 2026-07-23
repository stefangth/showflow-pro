import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the canvas library — jsdom cannot draw. The fake mirrors signature_pad@5's real
// EventTarget-style API (addEventListener/off, no constructor callback options) so the
// component's callback-ref wiring, including the drawn-signature (endStroke) path, can be
// exercised end to end.
interface FakeInstance {
  empty: boolean;
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
    constructor(_canvas: unknown) { instances.push(this); }
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

describe("SignaturePad", () => {
  beforeEach(() => { instances.length = 0; });

  it("emits a typed value as the name is entered", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "Ann Lee" } });
    expect(onChange).toHaveBeenCalledWith({ method: "typed", typedName: "Ann Lee" });
  });

  it("clears the typed value to null when emptied", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={{ method: "typed", typedName: "X" }} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(/full legal name/i), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("constructs the pad once the Draw tab is activated (not eagerly on mount)", () => {
    const onChange = vi.fn();
    render(<SignaturePad value={null} onChange={onChange} />);
    expect(instances).toHaveLength(0);
    activateDrawTab();
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
});
