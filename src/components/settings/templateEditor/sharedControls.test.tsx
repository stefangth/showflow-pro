import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CopyFieldControl } from "./CopyFieldControl";
import { DocumentBaseControls } from "./DocumentBaseControls";
import { RoleStyleControls } from "./RoleStyleControls";
import { EMAIL_ROLE_KEYS, EMAIL_THEME_COLOR_KEYS, EMAIL_THEME_DEFAULTS, type EmailThemeOverride } from "@/lib/emailTemplates/emailTheme";

const fonts = [{ key: "geist", label: "Geist", kind: "sans" }];
const colors = [{ key: "text", label: "Text" }];

async function selectOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("shared template editor controls", () => {
  it("deletes a reset copy key while preserving sibling overrides", () => {
    const onCopyChange = vi.fn();
    render(
      <CopyFieldControl
        field={{ key: "title", label: "Title", tokens: [] }}
        defaultValue="Default title"
        copyDraft={{ title: "Custom title", footer: "Custom footer" }}
        onCopyChange={onCopyChange}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Title to default" }));
    expect(onCopyChange).toHaveBeenCalledWith({ footer: "Custom footer" });
  });

  it("warns when copy contains a forbidden dash", () => {
    render(
      <CopyFieldControl
        field={{ key: "title", label: "Title", tokens: [] }}
        defaultValue="Default title"
        copyDraft={{ title: "A — title" }}
        onCopyChange={vi.fn()}
        readOnly={false}
      />,
    );

    expect(screen.getByText("Use a period, comma, or middot instead of a dash.")).toBeInTheDocument();
  });

  it("delegates whole-role deletion to the domain callback", () => {
    const onResetRole = vi.fn();
    render(
      <RoleStyleControls
        role={{ key: "heading", label: "Heading" }}
        roleDefaults={{ size: 12, weight: 400, color: "text" }}
        roleOverride={{ size: 20 }}
        fonts={fonts}
        colorFields={colors}
        onRoleChange={vi.fn()}
        onResetRole={onResetRole}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Heading style to default" }));
    expect(onResetRole).toHaveBeenCalledOnce();
  });

  it("clears one role field while preserving its siblings", async () => {
    const onRoleChange = vi.fn();
    render(
      <RoleStyleControls
        role={{ key: "heading", label: "Heading" }}
        roleDefaults={{ size: 12, weight: 400, color: "text" }}
        roleOverride={{ family: "geist", size: 20 }}
        fonts={fonts}
        colorFields={colors}
        onRoleChange={onRoleChange}
        onResetRole={vi.fn()}
        readOnly={false}
      />,
    );

    await selectOption("Font", "Document font");
    expect(onRoleChange).toHaveBeenLastCalledWith({ size: 20 });
  });

  it("deletes the base override while preserving role overrides", () => {
    const onThemeChange = vi.fn();
    render(
      <DocumentBaseControls
        title="Document"
        base={{ fontFamily: "geist", colors: { text: "#111111" } }}
        baseModified
        fonts={fonts}
        fontFields={[{ key: "fontFamily", label: "Body font" }]}
        colors={colors}
        colorValues={{ text: "#111111" }}
        onBaseChange={vi.fn()}
        onThemeChange={onThemeChange}
        themeDraft={{ base: { fontFamily: "geist" }, roles: { heading: { size: 20 } } }}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset document style to default" }));
    expect(onThemeChange).toHaveBeenCalledWith({ roles: { heading: { size: 20 } } });
  });

  it("disables the shared controls in read-only mode", () => {
    render(
      <div>
        <CopyFieldControl
          field={{ key: "title", label: "Title", tokens: [] }}
          defaultValue="Default title"
          copyDraft={{} as Partial<Record<"title", string>>}
          onCopyChange={vi.fn()}
          readOnly
        />
        <RoleStyleControls
          role={{ key: "heading", label: "Heading" }}
          roleDefaults={{ size: 12, weight: 400, color: "text" }}
          roleOverride={{}}
          fonts={fonts}
          colorFields={colors}
          onRoleChange={vi.fn()}
          onResetRole={vi.fn()}
          readOnly
        />
      </div>,
    );

    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Font" })).toBeDisabled();
    expect(screen.getByLabelText("Size")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Weight" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Colour" })).toBeDisabled();
  });

  it("supports the production email theme's sparse role overrides and 700 weight", async () => {
    const onThemeChange = vi.fn();
    const emailDraft: EmailThemeOverride = { roles: { dataLabel: { weight: 700 } } };
    render(
      <RoleStyleControls
        role={{ key: "dataLabel", label: "Data label" }}
        roleDefaults={EMAIL_THEME_DEFAULTS.roles.dataLabel}
        roleOverride={emailDraft.roles?.dataLabel}
        fonts={[{ key: "body", label: "Body", kind: "body" }, { key: "heading", label: "Heading", kind: "heading" }]}
        colorFields={EMAIL_THEME_COLOR_KEYS.map((key) => ({ key, label: key }))}
        onRoleChange={onThemeChange}
        onResetRole={vi.fn()}
        readOnly={false}
        fontResetLabel="Email base font"
        weightOptions={[400, 500, 600, 700].map((value) => ({ value, label: String(value) }))}
      />,
    );

    expect(EMAIL_ROLE_KEYS).toContain("dataLabel");
    expect(screen.getByRole("combobox", { name: "Weight" })).toHaveTextContent("700");
    fireEvent.click(screen.getByRole("combobox", { name: "Font" }));
    expect(screen.getByRole("option", { name: "Email base font" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Email base font" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await selectOption("Weight", "700");
    expect(onThemeChange).toHaveBeenLastCalledWith({ weight: 700 });
  });

  it("renders typed PDF and email base-field groups without PDF-only terminology", () => {
    const onPdfMarginChange = vi.fn();
    const onEmailRadiusChange = vi.fn();
    const onEmailFooterChange = vi.fn();
    const { rerender } = render(
      <DocumentBaseControls
        title="Document"
        base={{}}
        baseModified={false}
        fonts={fonts}
        fontFields={[]}
        colors={[]}
        colorValues={{}}
        fieldGroups={[{
          label: "Page margins",
          fields: [{ kind: "number", key: "marginX", label: "Left and right", value: 44, min: 20, max: 80, onChange: onPdfMarginChange }],
        }]}
        onBaseChange={vi.fn()}
        onThemeChange={vi.fn()}
        themeDraft={{}}
        readOnly={false}
      />,
    );
    expect(screen.getByText("Page margins")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Left and right"), { target: { value: "50" } });
    expect(onPdfMarginChange).toHaveBeenCalledWith(50);

    rerender(
      <DocumentBaseControls
        title="Email"
        base={EMAIL_THEME_DEFAULTS.base}
        baseModified={false}
        fonts={fonts}
        fontFields={[]}
        colors={[]}
        colorValues={{}}
        fieldGroups={[{
          label: "Email defaults",
          fields: [
            { kind: "number", key: "buttonRadius", label: "Button radius", value: EMAIL_THEME_DEFAULTS.base.buttonRadius, min: 0, max: 24, onChange: onEmailRadiusChange },
            { kind: "text", key: "footerText", label: "Footer text", value: EMAIL_THEME_DEFAULTS.base.footerText, onChange: onEmailFooterChange },
          ],
        }]}
        onBaseChange={vi.fn()}
        onThemeChange={vi.fn()}
        themeDraft={{}}
        readOnly={false}
      />,
    );
    expect(screen.getByText("Email defaults")).toBeInTheDocument();
    expect(screen.queryByText("Page margins")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Button radius"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Footer text"), { target: { value: "Regards" } });
    expect(onEmailRadiusChange).toHaveBeenCalledWith(12);
    expect(onEmailFooterChange).toHaveBeenCalledWith("Regards");
  });

  it("partitions font fields by the caller's allowed kinds", async () => {
    const threeKinds = [
      { key: "sans", label: "Sans", kind: "sans" },
      { key: "serif", label: "Serif", kind: "serif" },
      { key: "mono", label: "Mono", kind: "mono" },
    ];
    render(
      <DocumentBaseControls
        title="Document"
        base={{ bodyFamily: "sans", monoFamily: "mono" }}
        baseModified={false}
        fonts={threeKinds}
        fontFields={[
          { key: "bodyFamily", label: "Body font", allowedKinds: ["sans", "serif"] },
          { key: "monoFamily", label: "Numeric font", allowedKinds: ["mono"] },
        ]}
        colors={[]}
        colorValues={{}}
        onBaseChange={vi.fn()}
        onThemeChange={vi.fn()}
        themeDraft={{}}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Body font" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Sans", "Serif"]);
    fireEvent.click(screen.getByRole("option", { name: "Serif" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(screen.getByRole("combobox", { name: "Numeric font" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(["Mono"]);
  });
});
