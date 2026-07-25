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

  it("disables every control in read-only mode", () => {
    render(<TemplateInspector selected="totalLabel" {...props} readOnly />);
    expect(screen.getByLabelText("Total row")).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Font" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Weight" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Colour" })).toBeDisabled();
  });

  // --- No-null-into-the-draft invariant -------------------------------------
  // Every one of these asserts on the exact object passed to onCopyChange /
  // onThemeChange after a "clear" action: the key under test must be ABSENT,
  // never present with a null or undefined value. Object.keys / toHaveProperty
  // catch a present-but-nulled key that .toBeUndefined() alone would miss (a
  // deleted key and a key explicitly set to undefined both read as
  // `undefined` through property access, but only the deleted key is absent
  // from Object.keys - see the CONTROLLER ADDENDUM).

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
});
