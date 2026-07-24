import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HireOrderReadyBanner } from "./HireOrderReadyBanner";

describe("HireOrderReadyBanner", () => {
  it("renders the title, description and CTA, fires onCta, and shows no 'Preview terms'", () => {
    const onCta = vi.fn();
    render(
      <HireOrderReadyBanner
        title="This date is fully filled. Ready for a hire order."
        description="Generate the order and send it to Max Mustermann for countersignature."
        ctaLabel="Generate hire order"
        onCta={onCta}
      />,
    );
    expect(screen.getByText(/ready for a hire order/i)).toBeInTheDocument();
    expect(screen.getByText(/max mustermann/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /generate hire order/i }));
    expect(onCta).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/preview terms/i)).not.toBeInTheDocument();
  });

  it("disables the CTA when disabled is set", () => {
    render(
      <HireOrderReadyBanner
        title="t" description="d" ctaLabel="Generate hire order" onCta={() => {}} disabled
      />,
    );
    expect(screen.getByRole("button", { name: /generate hire order/i })).toBeDisabled();
  });
});
