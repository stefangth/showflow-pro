import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CopyFieldControl } from "./CopyFieldControl";
import { DocumentBaseControls } from "./DocumentBaseControls";
import { RoleStyleControls } from "./RoleStyleControls";

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

  it("deletes a whole role while preserving unrelated roles", () => {
    const onThemeChange = vi.fn();
    render(
      <RoleStyleControls
        role={{ key: "heading", label: "Heading" }}
        roleDefaults={{ size: 12, weight: 400, color: "text" }}
        themeDraft={{ roles: { heading: { size: 20 }, body: { weight: 600 } } }}
        fonts={fonts}
        colorFields={colors}
        onThemeChange={onThemeChange}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Heading style to default" }));
    expect(onThemeChange).toHaveBeenCalledWith({ roles: { body: { weight: 600 } } });
  });

  it("clears one role field while preserving its siblings", async () => {
    const onThemeChange = vi.fn();
    render(
      <RoleStyleControls
        role={{ key: "heading", label: "Heading" }}
        roleDefaults={{ size: 12, weight: 400, color: "text" }}
        themeDraft={{ roles: { heading: { family: "geist", size: 20 } } }}
        fonts={fonts}
        colorFields={colors}
        onThemeChange={onThemeChange}
        readOnly={false}
      />,
    );

    await selectOption("Font", "Document font");
    expect(onThemeChange).toHaveBeenLastCalledWith({ roles: { heading: { size: 20 } } });
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
          themeDraft={{}}
          fonts={fonts}
          colorFields={colors}
          onThemeChange={vi.fn()}
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
});
