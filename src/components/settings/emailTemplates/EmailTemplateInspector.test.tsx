import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_TEMPLATE_COPY_FIELDS } from "@/lib/emailTemplates/emailTemplateMeta";
import type { EmailThemeOverride } from "@/lib/emailTemplates/emailTheme";
import { EmailTemplateInspector } from "./EmailTemplateInspector";

const template = EMAIL_TEMPLATE_COPY_FIELDS.find((entry) => entry.templateKey === "org-invitation")!;
const expiryTemplate = EMAIL_TEMPLATE_COPY_FIELDS.find((entry) => entry.templateKey === "offer-expiry-reminder")!;

describe("EmailTemplateInspector", () => {
  it("round-trips template copy and labels shared style as applying to every email", () => {
    const onCopyChange = vi.fn();
    render(
      <EmailTemplateInspector
        selected="body"
        template={template}
        readOnly={false}
        copyDraft={{}}
        themeDraft={{}}
        onCopyChange={onCopyChange}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Applies to all emails.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Product intro"), { target: { value: "A current draft" } });
    expect(onCopyChange).toHaveBeenCalledWith({ "org-invitation.productIntro": "A current draft" });
  });

  it("keeps singular and plural intro copy in the body role", () => {
    render(
      <EmailTemplateInspector
        selected="body"
        template={expiryTemplate}
        readOnly={false}
        copyDraft={{}}
        themeDraft={{}}
        onCopyChange={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Singular intro")).toBeInTheDocument();
    expect(screen.getByLabelText("Plural intro")).toBeInTheDocument();
  });

  it("resets copy by deleting the key rather than writing null", () => {
    const onCopyChange = vi.fn();
    render(
      <EmailTemplateInspector
        selected="header"
        template={template}
        readOnly={false}
        copyDraft={{
          "org-invitation.subject": "Custom subject",
          "org-invitation.previewText": "Custom preview",
        }}
        themeDraft={{}}
        onCopyChange={onCopyChange}
        onThemeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Subject to default" }));
    expect(onCopyChange).toHaveBeenCalledWith({ "org-invitation.previewText": "Custom preview" });
  });

  it("deletes only the selected shared role override on reset", () => {
    const onThemeChange = vi.fn();
    const themeDraft: EmailThemeOverride = {
      roles: { body: { size: 17 }, footer: { weight: 500 } },
    };
    render(
      <EmailTemplateInspector
        selected="body"
        template={template}
        readOnly={false}
        copyDraft={{}}
        themeDraft={themeDraft}
        onCopyChange={vi.fn()}
        onThemeChange={onThemeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Body style to default" }));
    expect(onThemeChange).toHaveBeenCalledWith({ roles: { footer: { weight: 500 } } });
  });

  it("deletes the roles branch when the last shared role is reset", () => {
    const onThemeChange = vi.fn();
    render(
      <EmailTemplateInspector
        selected="body"
        template={template}
        readOnly={false}
        copyDraft={{}}
        themeDraft={{ roles: { body: { size: 17 } } }}
        onCopyChange={vi.fn()}
        onThemeChange={onThemeChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset Body style to default" }));
    expect(Object.keys(onThemeChange.mock.calls[0][0])).toEqual([]);
  });

  it("disables document, copy, and style mutations in read-only mode", () => {
    const { rerender } = render(
      <EmailTemplateInspector
        selected="document"
        template={template}
        readOnly
        copyDraft={{}}
        themeDraft={{}}
        onCopyChange={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Body font" })).toBeDisabled();
    expect(screen.getByLabelText("Button radius")).toBeDisabled();
    expect(screen.getByLabelText("Footer text")).toBeDisabled();

    rerender(
      <EmailTemplateInspector
        selected="header"
        template={template}
        readOnly
        copyDraft={{}}
        themeDraft={{}}
        onCopyChange={vi.fn()}
        onThemeChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Weight" })).toBeDisabled();
  });
});
