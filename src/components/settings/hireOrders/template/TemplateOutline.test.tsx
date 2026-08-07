import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateOutline } from "./TemplateOutline";
import { TemplateOutline as GenericTemplateOutline } from "../../templateEditor/TemplateOutline";

describe("TemplateOutline", () => {
  it("selects generic string role keys and takes modified state from its callback", () => {
    const onSelect = vi.fn();
    render(
      <GenericTemplateOutline
        document={{ key: "theme", label: "Theme" }}
        sections={[{ title: "Copy", roles: [{ key: "intro", label: "Introduction" }] }]}
        selected="theme"
        onSelect={onSelect}
        isModified={(key) => key === "intro"}
      />,
    );

    expect(screen.getByRole("button", { name: "Introduction, modified" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Introduction, modified" }));
    expect(onSelect).toHaveBeenCalledWith("intro");
  });

  it("lists a Document entry and every section", () => {
    render(<TemplateOutline selected="document" onSelect={vi.fn()} copyDraft={{}} themeDraft={{}} />);
    expect(screen.getByRole("button", { name: /Document/ })).toBeInTheDocument();
    expect(screen.getByText("Letterhead")).toBeInTheDocument();
    expect(screen.getByText("Signature certificate")).toBeInTheDocument();
  });

  it("reports the clicked role", () => {
    const onSelect = vi.fn();
    render(<TemplateOutline selected="document" onSelect={onSelect} copyDraft={{}} themeDraft={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /Section heading/ }));
    expect(onSelect).toHaveBeenCalledWith("sectionHeading");
  });

  it("reports 'document' when the Document entry is clicked", () => {
    const onSelect = vi.fn();
    render(<TemplateOutline selected="sectionHeading" onSelect={onSelect} copyDraft={{}} themeDraft={{}} />);
    fireEvent.click(screen.getByRole("button", { name: /Document/ }));
    expect(onSelect).toHaveBeenCalledWith("document");
  });

  it("marks a role whose style was overridden", () => {
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{}}
        themeDraft={{ roles: { sectionHeading: { size: 20 } } }}
      />,
    );
    expect(screen.getByRole("button", { name: /Section heading, modified/ })).toBeInTheDocument();
    // A style override on one role must not bleed into an unrelated role's
    // indicator - this is the half of the check that a copy-only
    // implementation would still pass, so it has to be asserted here too.
    expect(screen.getByRole("button", { name: "Total label" })).toBeInTheDocument();
  });

  it("marks a role whose bound copy was overridden", () => {
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{ fees_total: "Amount due" }}
        themeDraft={{}}
      />,
    );
    expect(screen.getByRole("button", { name: /Total label, modified/ })).toBeInTheDocument();
    // A copy override must not be mistaken for a style override on an
    // unrelated role - the half a style-only implementation would still
    // pass, so it has to be asserted here too.
    expect(screen.getByRole("button", { name: "Section heading" })).toBeInTheDocument();
  });

  it("does not mark a role modified when its style override is present but empty", () => {
    // The draft state never stores an empty object like this, but a stale or
    // hand-edited override could still shape up this way, and the check must
    // not be fooled by a key that is merely PRESENT rather than populated.
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{}}
        themeDraft={{ roles: { sectionHeading: {} } }}
      />,
    );
    expect(screen.getByRole("button", { name: "Section heading" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Section heading, modified/ })).not.toBeInTheDocument();
  });

  it("does not mark a role modified when its style override is an explicit null", () => {
    // The typed HireOrderThemeOverride never allows this, but the value
    // ultimately comes from a hand-editable app_settings JSON blob, and a
    // stray `null` there resolves to the hard-coded default rather than a
    // stored value - it must read as unmodified, the same as an absent key,
    // not throw and not count as an override.
    const themeDraft = { roles: { sectionHeading: null } } as unknown as Parameters<
      typeof TemplateOutline
    >[0]["themeDraft"];
    render(<TemplateOutline selected="document" onSelect={vi.fn()} copyDraft={{}} themeDraft={themeDraft} />);
    expect(screen.getByRole("button", { name: "Section heading" })).toBeInTheDocument();
  });

  it("marks nothing modified when both drafts are empty", () => {
    render(<TemplateOutline selected="document" onSelect={vi.fn()} copyDraft={{}} themeDraft={{}} />);
    expect(screen.getByRole("button", { name: "Document" })).toBeInTheDocument();
    expect(screen.queryByText(/, modified/)).not.toBeInTheDocument();
  });

  it("marks the Document entry modified when the base theme was overridden", () => {
    render(
      <TemplateOutline
        selected="document"
        onSelect={vi.fn()}
        copyDraft={{}}
        themeDraft={{ base: { scale: 1.1 } }}
      />,
    );
    expect(screen.getByRole("button", { name: "Document, modified" })).toBeInTheDocument();
  });

  it("marks the selected row as current", () => {
    render(<TemplateOutline selected="notes" onSelect={vi.fn()} copyDraft={{}} themeDraft={{}} />);
    expect(screen.getByRole("button", { name: /Notes line/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Document" })).not.toHaveAttribute("aria-current");
  });
});
