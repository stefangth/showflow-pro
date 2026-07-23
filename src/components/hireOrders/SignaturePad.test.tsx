import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the canvas library — jsdom cannot draw. The fake lets us drive onEnd/clear.
const instances: Array<{ onEnd?: () => void; empty: boolean }> = [];
vi.mock("signature_pad", () => ({
  default: class {
    onEnd?: () => void;
    empty = true;
    constructor(_c: unknown, opts?: { onEnd?: () => void }) { this.onEnd = opts?.onEnd; instances.push(this); }
    isEmpty() { return this.empty; }
    clear() { this.empty = true; }
    toDataURL() { return "data:image/png;base64,ZFAKE"; }
    addEventListener() {}
    off() {}
  },
}));

import { SignaturePad } from "./SignaturePad";

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
});
