import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateInspector } from "./TemplateInspector";
import type { HireOrderThemeOverride } from "@/lib/hireOrders/pdf/pdfTheme";
import type { HireOrderCopy } from "@/lib/hireOrders/pdf/pdfCopy";

// Same click-trigger-then-option helper as UsersTab.test.tsx / NewOrderWizard.test.tsx:
// Radix Select's dismissable-layer cleanup is an effect that flushes on a later
// tick, so a macrotask flush between picks lets it settle before the next open.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}
async function selectOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
  await flush();
}

const noop = vi.fn();
const props = {
  copyDraft: {},
  themeDraft: {},
  onCopyChange: noop,
  onThemeChange: noop,
  readOnly: false,
};

describe("TemplateInspector", () => {
  it("shows the base controls for the document entry", () => {
    render(<TemplateInspector selected="document" {...props} />);
    expect(screen.getByLabelText("Body font")).toBeInTheDocument();
    expect(screen.getByLabelText("Numeric font")).toBeInTheDocument();
    expect(screen.getByLabelText("Text size")).toBeInTheDocument();
  });

  it("shows a role's bound copy fields and style controls", () => {
    render(<TemplateInspector selected="totalLabel" {...props} />);
    expect(screen.getByLabelText("Total row")).toHaveValue("Total payable");
    expect(screen.getByLabelText("Size")).toHaveValue(12);
  });

  it("reports a copy edit", () => {
    const onCopyChange = vi.fn();
    render(<TemplateInspector selected="totalLabel" {...props} onCopyChange={onCopyChange} />);
    fireEvent.change(screen.getByLabelText("Total row"), { target: { value: "Total payable!" } });
    expect(onCopyChange).toHaveBeenCalledWith({ fees_total: "Total payable!" });
  });

  it("warns on a dash in copy", () => {
    render(<TemplateInspector selected="totalLabel" {...props} copyDraft={{ fees_total: "Total — payable" }} />);
    expect(screen.getByText("Use a period, comma, or middot instead of a dash.")).toBeInTheDocument();
  });

  it("offers reset only for a modified field", () => {
    const { rerender } = render(<TemplateInspector selected="totalLabel" {...props} />);
    expect(screen.queryByRole("button", { name: /Reset Total row/ })).not.toBeInTheDocument();
    rerender(<TemplateInspector selected="totalLabel" {...props} copyDraft={{ fees_total: "Amount due" }} />);
    expect(screen.getByRole("button", { name: /Reset Total row/ })).toBeInTheDocument();
  });

  it("disables every control in read-only mode (role branch)", () => {
    render(<TemplateInspector selected="totalLabel" {...props} readOnly />);
    expect(screen.getByLabelText("Total row")).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Font" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Weight" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Colour" })).toBeDisabled();
  });

  // The role branch's read-only test above only exercises half this pane -
  // the Document branch has its own 13 controls (2 font pickers, a slider,
  // 7 colour swatches, 3 margins) and none of them were under a regression
  // net before this test. A producer without edit_hire_order_settings who
  // could still drag the scale slider or swap a colour would be a real
  // permissions hole, not just a cosmetic one.
  it("disables every control in read-only mode (document branch)", () => {
    render(<TemplateInspector selected="document" {...props} readOnly />);
    expect(screen.getByRole("combobox", { name: "Body font" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Numeric font" })).toBeDisabled();
    // The Slider's interactive element (role="slider", labelled "Text size")
    // is the Thumb, a <span>, which jest-dom's toBeDisabled() never considers
    // disable-able (only native form elements qualify) - Radix marks it via
    // data-disabled instead, so that is what a test has to check for this
    // one control.
    expect(screen.getByLabelText("Text size")).toHaveAttribute("data-disabled");
    for (const label of [
      "Text",
      "Muted text",
      "Faint text",
      "Accent",
      "Rules and borders",
      "Fee cell background",
      "Total row background",
    ]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
    for (const label of ["Left and right", "Top", "Bottom"]) {
      expect(screen.getByLabelText(label)).toBeDisabled();
    }
  });

  // --- No-null-into-the-draft invariant -------------------------------------
  // Every one of these asserts on the exact object passed to onCopyChange /
  // onThemeChange after a "clear" action: the key under test must be ABSENT,
  // never present with a null or undefined value (see the CONTROLLER
  // ADDENDUM). `.not.toHaveProperty(key)` alone already fails for a
  // present-but-undefined key in this repo's Vitest/jest-dom setup; the
  // paired `Object.keys(...).not.toContain(key)` is not load-bearing on top
  // of it, it is just a second, equally direct way to say the same thing.

  it("resetting a copy field deletes the key rather than nulling it", () => {
    const onCopyChange = vi.fn();
    render(
      <TemplateInspector
        selected="totalLabel"
        {...props}
        copyDraft={{ fees_total: "Amount due" }}
        onCopyChange={onCopyChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset Total row/ }));
    expect(onCopyChange).toHaveBeenCalledTimes(1);
    const arg = onCopyChange.mock.calls[0][0] as Partial<HireOrderCopy>;
    expect(Object.keys(arg)).not.toContain("fees_total");
    expect(arg).not.toHaveProperty("fees_total");
  });

  it("resetting a role's style deletes the whole role entry rather than nulling it", () => {
    const onThemeChange = vi.fn();
    render(
      <TemplateInspector
        selected="totalLabel"
        {...props}
        themeDraft={{ roles: { totalLabel: { size: 20 }, feeLabel: { weight: 500 } } }}
        onThemeChange={onThemeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset Total label style/ }));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    const arg = onThemeChange.mock.calls[0][0] as HireOrderThemeOverride;
    expect(Object.keys(arg.roles ?? {})).not.toContain("totalLabel");
    expect(arg.roles).not.toHaveProperty("totalLabel");
    // An unrelated role's override must survive the reset untouched.
    expect(arg.roles?.feeLabel).toEqual({ weight: 500 });
  });

  it("picking 'Document font' deletes just the family override, preserving sibling overrides", async () => {
    const onThemeChange = vi.fn();
    render(
      <TemplateInspector
        selected="totalLabel"
        {...props}
        themeDraft={{ roles: { totalLabel: { family: "geist-mono", size: 20 } } }}
        onThemeChange={onThemeChange}
      />,
    );
    await selectOption("Font", "Document font");
    expect(onThemeChange).toHaveBeenCalled();
    const arg = onThemeChange.mock.calls.at(-1)?.[0] as HireOrderThemeOverride;
    const totalLabel = arg.roles?.totalLabel;
    expect(totalLabel).not.toHaveProperty("family");
    expect(Object.keys(totalLabel ?? {})).not.toContain("family");
    // size must survive: this is not a whole-role reset, only the family key.
    expect(totalLabel).toEqual({ size: 20 });
  });

  it("resetting the document clears base rather than nulling or emptying it in place", () => {
    const onThemeChange = vi.fn();
    render(
      <TemplateInspector
        selected="document"
        {...props}
        themeDraft={{ base: { scale: 1.2 }, roles: { totalLabel: { size: 20 } } }}
        onThemeChange={onThemeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reset document/ }));
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    const arg = onThemeChange.mock.calls[0][0] as HireOrderThemeOverride;
    expect(Object.keys(arg)).not.toContain("base");
    expect(arg).not.toHaveProperty("base");
    // Role overrides are untouched by a document-level reset.
    expect(arg.roles?.totalLabel).toEqual({ size: 20 });
  });

  it("offers a document-reset control only once the base theme is modified", () => {
    const { rerender } = render(<TemplateInspector selected="document" {...props} />);
    expect(screen.queryByRole("button", { name: /Reset document/ })).not.toBeInTheDocument();
    rerender(<TemplateInspector selected="document" {...props} themeDraft={{ base: { scale: 1.2 } }} />);
    expect(screen.getByRole("button", { name: /Reset document/ })).toBeInTheDocument();
  });

  // --- selectableFontFamilies() gating ---------------------------------------

  it("only offers selectable fonts for the document body font", async () => {
    render(<TemplateInspector selected="document" {...props} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Body font" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Geist"]);
    expect(screen.queryByRole("option", { name: "Inter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "IBM Plex Sans" })).not.toBeInTheDocument();
  });

  it("only offers selectable fonts for the document numeric font", async () => {
    render(<TemplateInspector selected="document" {...props} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Numeric font" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Geist Mono"]);
    expect(screen.queryByRole("option", { name: "IBM Plex Mono" })).not.toBeInTheDocument();
  });

  it("only offers selectable fonts (plus 'Document font') for a role's font override", async () => {
    render(<TemplateInspector selected="totalLabel" {...props} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Font" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Document font", "Geist", "Geist Mono"]);
    expect(screen.queryByRole("option", { name: "Source Serif" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Libre Baskerville" })).not.toBeInTheDocument();
  });

  // --- Defensive: a hand-edited app_settings blob can carry a stray null -----

  it("does not crash and falls back to defaults when a role override is a stray null", () => {
    const themeDraft = { roles: { totalLabel: null } } as unknown as HireOrderThemeOverride;
    render(<TemplateInspector selected="totalLabel" {...props} themeDraft={themeDraft} />);
    expect(screen.getByLabelText("Size")).toHaveValue(12);
    expect(screen.queryByRole("button", { name: /Reset Total label style/ })).not.toBeInTheDocument();
  });

  it("does not crash and falls back to defaults when a copy override is a stray null", () => {
    const copyDraft = { fees_total: null } as unknown as Partial<HireOrderCopy>;
    render(<TemplateInspector selected="totalLabel" {...props} copyDraft={copyDraft} />);
    expect(screen.getByLabelText("Total row")).toHaveValue("Total payable");
  });

  // --- Page margins: each margin must render its own value, not fall through
  // to `undefined` once a SIBLING margin has been overridden (a shallow merge
  // of the whole `page` object against the defaults would lose the untouched
  // siblings entirely, rather than just leaving them at their default).

  it("shows every margin at its default even when only one margin is overridden", () => {
    render(
      <TemplateInspector
        selected="document"
        {...props}
        themeDraft={{ base: { page: { marginX: 50 } } }}
      />,
    );
    expect(screen.getByLabelText("Left and right")).toHaveValue(50);
    expect(screen.getByLabelText("Top")).toHaveValue(40);
    expect(screen.getByLabelText("Bottom")).toHaveValue(60);
  });

  it("preserves sibling margin overrides when editing one margin", () => {
    const onThemeChange = vi.fn();
    render(
      <TemplateInspector
        selected="document"
        {...props}
        themeDraft={{ base: { page: { marginX: 50 } } }}
        onThemeChange={onThemeChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Top"), { target: { value: "45" } });
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    const arg = onThemeChange.mock.calls[0][0] as HireOrderThemeOverride;
    expect(arg.base?.page).toEqual({ marginX: 50, marginTop: 45 });
  });

  // A cleared `<input type="number">` reports "", and Number("") is 0. That
  // used to persist `size: 0` / `letterSpacing: 0` / `marginTop: 0`, display
  // "0", mark the role modified and leave the preview clamped to 5pt.
  describe("clearing a numeric field", () => {
    it("does not write a size of 0", () => {
      const onThemeChange = vi.fn();
      render(<TemplateInspector selected="totalLabel" {...props} onThemeChange={onThemeChange} />);
      fireEvent.change(screen.getByLabelText("Size"), { target: { value: "" } });
      expect(onThemeChange).not.toHaveBeenCalled();
    });

    it("does not write a letter spacing of 0", () => {
      const onThemeChange = vi.fn();
      render(<TemplateInspector selected="totalLabel" {...props} onThemeChange={onThemeChange} />);
      fireEvent.change(screen.getByLabelText("Letter spacing"), { target: { value: "" } });
      expect(onThemeChange).not.toHaveBeenCalled();
    });

    it("does not write a page margin of 0", () => {
      const onThemeChange = vi.fn();
      render(<TemplateInspector selected="document" {...props} onThemeChange={onThemeChange} />);
      fireEvent.change(screen.getByLabelText("Left and right"), { target: { value: "" } });
      expect(onThemeChange).not.toHaveBeenCalled();
    });

    it("still writes a real edit", () => {
      const onThemeChange = vi.fn();
      render(<TemplateInspector selected="totalLabel" {...props} onThemeChange={onThemeChange} />);
      fireEvent.change(screen.getByLabelText("Size"), { target: { value: "14" } });
      const arg = onThemeChange.mock.calls[0][0] as HireOrderThemeOverride;
      expect(arg.roles?.totalLabel).toEqual({ size: 14 });
    });

    it("still allows an explicit zero letter spacing", () => {
      // "0" is a legitimate value here, unlike the empty string it used to be
      // conflated with.
      const onThemeChange = vi.fn();
      render(<TemplateInspector selected="totalLabel" {...props} onThemeChange={onThemeChange} />);
      fireEvent.change(screen.getByLabelText("Letter spacing"), { target: { value: "0" } });
      const arg = onThemeChange.mock.calls[0][0] as HireOrderThemeOverride;
      expect(arg.roles?.totalLabel).toEqual({ letterSpacing: 0 });
    });
  });
});
