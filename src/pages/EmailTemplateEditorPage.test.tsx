import { fireEvent, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createFakeSupabase, type TableSeed } from "@/test/supabaseFake";
import { EMAIL_COPY_DEFAULTS } from "@/lib/emailTemplates/emailCopy";

const { client } = vi.hoisted(() => ({ client: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: client }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: vi.fn() }));
vi.mock("@/hooks/useCapabilities", async (original) => ({
  ...(await original<typeof import("@/hooks/useCapabilities")>()),
  useCan: vi.fn(),
}));

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import EmailTemplateEditorPage from "./EmailTemplateEditorPage";

interface RecordedCall { table: string; method: string; args: unknown[] }

function seedClient(appSettings: TableSeed) {
  for (const key of Object.keys(client)) delete client[key];
  Object.assign(client, createFakeSupabase({
    app_settings: appSettings,
    "fn:preview-transactional-email": {
      data: { templates: [{ html: "<h1>Rendered draft</h1>" }] },
      error: null,
    },
  }));
}

function renderPage(templateKey = "org-invitation", readOnly?: boolean) {
  return renderWithProviders(
    <MemoryRouter initialEntries={[`/settings/email-templates/${templateKey}`]}>
      <Routes>
        <Route
          path="/settings/email-templates/:templateKey"
          element={<EmailTemplateEditorPage readOnly={readOnly} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function settingRows(copy: unknown, theme: unknown = {}, legacy: unknown = {}) {
  return [
    { when: { key: "email_copy" }, data: copy === undefined ? [] : [{ org_id: "org-1", value: copy }], error: null },
    { when: { key: "email_theme" }, data: [{ org_id: "org-1", value: theme }], error: null },
    { when: { key: "email_template_overrides" }, data: [{ org_id: "org-1", value: legacy }], error: null },
    { data: [], error: null },
  ];
}

describe("EmailTemplateEditorPage", () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      currentOrg: { id: "org-1", name: "Test Org", slug: "test-org" },
      hasRole: () => true,
    } as never);
    vi.mocked(useCan).mockReturnValue(true);
    seedClient(settingRows({}));
  });

  it.each(["cron-health-alert", "password-reset", "missing-template"])(
    "rejects the non-editable or unknown direct route %s before loading settings",
    async (templateKey) => {
      renderPage(templateKey);
      expect(await screen.findByRole("alert")).toHaveTextContent("This email template cannot be edited");
      expect((client.calls as RecordedCall[]).some((call) => call.table === "app_settings")).toBe(false);
    },
  );

  it("seeds legacy copy only when the new email_copy setting is absent", async () => {
    seedClient(settingRows(undefined, {}, { "org-invitation": { subject: "Legacy subject" } }));
    const first = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Header" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("Legacy subject");
    first.unmount();

    seedClient(settingRows({ "org-invitation.subject": "New subject" }, {}, { "org-invitation": { subject: "Legacy subject" } }));
    const second = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Header" }));
    expect(screen.getByLabelText("Subject")).toHaveValue("New subject");
    second.unmount();

    seedClient(settingRows({}, {}, { "org-invitation": { subject: "Legacy subject" } }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Header" }));
    expect(screen.getByLabelText("Subject")).toHaveValue(EMAIL_COPY_DEFAULTS["org-invitation.subject"]);
  });

  it("round-trips copy and shared theme drafts to preview and preserves dirt across refetch", async () => {
    seedClient(settingRows({ "org-invitation.intro": "Stored intro" }, { roles: { body: { size: 16 } } }));
    const { queryClient } = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Body" }));
    fireEvent.change(screen.getByLabelText("Intro"), { target: { value: "Unsaved intro" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "18" } });

    await waitFor(() => {
      const requests = (client.calls as RecordedCall[]).filter((call) => call.table === "fn:preview-transactional-email");
      const latest = requests.at(-1)?.args[0] as { copyOverride?: Record<string, unknown>; themeOverride?: { roles?: Record<string, unknown> } } | undefined;
      expect(latest?.copyOverride?.["org-invitation.intro"]).toBe("Unsaved intro");
      expect(latest?.themeOverride?.roles?.body).toEqual({ size: 18 });
    });

    await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    expect(screen.getByLabelText("Intro")).toHaveValue("Unsaved intro");
    expect(screen.getByLabelText("Size")).toHaveValue(18);
  });

  it("saves compact copy before compact theme without null deletion sentinels", async () => {
    seedClient(settingRows(
      { "org-invitation.subject": "Custom subject" },
      { base: { colors: {} }, roles: { body: {}, footer: { weight: 500 } } },
    ));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Header" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset Subject to default" }));
    fireEvent.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() => {
      const upserts = (client.calls as RecordedCall[]).filter((call) => call.table === "app_settings" && call.method === "upsert");
      expect(upserts).toHaveLength(2);
      expect((upserts[0].args[0] as { key: string; value: unknown })).toEqual(expect.objectContaining({ key: "email_copy", value: {} }));
      expect((upserts[1].args[0] as { key: string; value: unknown })).toEqual(expect.objectContaining({
        key: "email_theme",
        value: { roles: { footer: { weight: 500 } } },
      }));
      expect(JSON.stringify(upserts.map((call) => call.args[0]))).not.toContain("null");
    });
  });

  it("keeps preview available but disables every mutation in read-only mode", async () => {
    renderPage("org-invitation", true);
    expect(await screen.findByRole("button", { name: "Save template" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset all" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Header" }));
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(await screen.findByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Rendered draft</h1>");
  });
});
