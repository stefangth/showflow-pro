import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
vi.mock("@/hooks/useHireOrders", () => ({
  useSignHireOrder: () => ({ mutate, isPending: false }),
}));
// SignaturePad is exercised in its own test; stub it to emit a typed value on click.
vi.mock("./SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button onClick={() => onChange({ method: "typed", typedName: "Ann Lee" })}>set-sig</button>
  ),
}));

import { SignHireOrderDialog } from "./SignHireOrderDialog";

describe("SignHireOrderDialog", () => {
  beforeEach(() => mutate.mockReset());

  it("keeps Sign disabled until a signature and consent are present, then submits", () => {
    render(<SignHireOrderDialog orderId="ho1" orgId="o1" open onOpenChange={() => {}} />);
    const signBtn = () => screen.getByRole("button", { name: /sign hire order/i });
    expect(signBtn()).toBeDisabled();

    fireEvent.click(screen.getByText("set-sig"));       // signature present
    expect(signBtn()).toBeDisabled();                    // still need consent
    fireEvent.click(screen.getByRole("checkbox"));       // consent checked
    expect(signBtn()).toBeEnabled();

    fireEvent.click(signBtn());
    expect(mutate).toHaveBeenCalledWith(
      { orgId: "o1", orderId: "ho1", method: "typed", typedName: "Ann Lee", signaturePng: undefined, consent: true },
      expect.anything(),
    );
  });

  it("keeps Sign disabled when consent is checked but no signature is present", () => {
    render(<SignHireOrderDialog orderId="ho1" orgId="o1" open onOpenChange={() => {}} />);
    const signBtn = () => screen.getByRole("button", { name: /sign hire order/i });

    fireEvent.click(screen.getByRole("checkbox"));       // consent checked, no signature
    expect(signBtn()).toBeDisabled();
  });

  it("summarizes the terms and what happens after signing (R4.5)", () => {
    render(<SignHireOrderDialog orderId="ho1" orgId="o1" open onOpenChange={() => {}} />);
    expect(screen.getByText(/you are agreeing to the fee, dates, and terms shown on this order/i)).toBeInTheDocument();
    // The artist's in-app signature IS the countersignature (signOrder flips
    // issued -> countersigned in the same request with signer_user_id = the
    // artist and emails them the final PDF immediately) -- there is no
    // subsequent org countersign step, so the copy must not claim one.
    expect(screen.getByText(/adding your signature completes it, and we email you the final signed pdf/i)).toBeInTheDocument();
    expect(screen.queryByText(/your organization countersigns/i)).not.toBeInTheDocument();
  });
});
