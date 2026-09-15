import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
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
// Spy, not a stub: the REAL pane still renders, but the props it is handed are
// recorded per render. The draft the page hands its preview is the same draft
// Save persists, so this is where a draft lagging the settings is observable
// synchronously - before act() settles it and hides the lag.
vi.mock("@/components/settings/emailTemplates/EmailPreviewPane", async (original) => {
  const actual = await original<typeof import("@/components/settings/emailTemplates/EmailPreviewPane")>();
  return { ...actual, EmailPreviewPane: vi.fn(actual.EmailPreviewPane) };
});

import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import EmailTemplateEditorPage from "./EmailTemplateEditorPage";
import { EmailPreviewPane } from "@/components/settings/emailTemplates/EmailPreviewPane";
import { createTestQueryClient } from "@/test/queryClient";

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

function pageTree(templateKey = "org-invitation", readOnly?: boolean) {
  return (
    <MemoryRouter initialEntries={[`/settings/email-templates/${templateKey}`]}>
      <Routes>
        <Route
          path="/settings/email-templates/:templateKey"
          element={<EmailTemplateEditorPage readOnly={readOnly} />}
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderPage(templateKey = "org-invitation", readOnly?: boolean, queryClient?: QueryClient) {
  return renderWithProviders(pageTree(templateKey, readOnly), queryClient ? { queryClient } : {});
}

/** An outline entry, by role label. Prefix-matched on purpose: an entry that
 *  carries an override reads "Header, modified", and the drafts are hydrated
 *  from the page's first render, so the bare label is NOT the accessible name
 *  whenever the org has stored copy for that role. These queries used to match
 *  the bare label only because they ran inside the window where the draft was
 *  still empty - the same window Save could persist over the org's settings. */
function outlineEntry(label: string) {
  return screen.findByRole("button", { name: new RegExp(`^${label}`) });
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

  it("shows the workspace-type preview toggle even without variants or language packs", async () => {
    // Regression: the toggle used to sit inside the toolbar gated on
    // `variants || languagePacksEnabled`. offer-immediate has no previewVariants and
    // language_packages is off by default, so the toggle was unreachable. It is not
    // entitlement-gated, so the toolbar (and the toggle) must render regardless.
    renderPage("offer-immediate");
    expect(await screen.findByRole("group", { name: /workspace type/i })).toBeInTheDocument();
  });

  it("seeds legacy copy only when the new email_copy setting is absent", async () => {
    seedClient(settingRows(undefined, {}, { "org-invitation": { subject: "Legacy subject" } }));
    const first = renderPage();
    fireEvent.click(await outlineEntry("Header"));
    expect(screen.getByLabelText("Subject")).toHaveValue("Legacy subject");
    first.unmount();

    seedClient(settingRows({ "org-invitation.subject": "New subject" }, {}, { "org-invitation": { subject: "Legacy subject" } }));
    const second = renderPage();
    fireEvent.click(await outlineEntry("Header"));
    expect(screen.getByLabelText("Subject")).toHaveValue("New subject");
    second.unmount();

    seedClient(settingRows({}, {}, { "org-invitation": { subject: "Legacy subject" } }));
    renderPage();
    fireEvent.click(await outlineEntry("Header"));
    expect(screen.getByLabelText("Subject")).toHaveValue(EMAIL_COPY_DEFAULTS["org-invitation.subject"]);
  });

  it("round-trips copy and shared theme drafts to preview and preserves dirt across refetch", async () => {
    seedClient(settingRows({ "org-invitation.productIntro": "Stored intro" }, { roles: { body: { size: 16 } } }));
    const { queryClient } = renderPage();
    fireEvent.click(await outlineEntry("Body"));
    fireEvent.change(screen.getByLabelText("Product intro"), { target: { value: "Unsaved intro" } });
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "18" } });

    await waitFor(() => {
      const requests = (client.calls as RecordedCall[]).filter((call) => call.table === "fn:preview-transactional-email");
      const latest = requests.at(-1)?.args[0] as { copyOverride?: Record<string, unknown>; themeOverride?: { roles?: Record<string, unknown> } } | undefined;
      expect(latest?.copyOverride?.["org-invitation.productIntro"]).toBe("Unsaved intro");
      expect(latest?.themeOverride?.roles?.body).toEqual({ size: 18 });
    });

    await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    expect(screen.getByLabelText("Product intro")).toHaveValue("Unsaved intro");
    expect(screen.getByLabelText("Size")).toHaveValue(18);
  });

  it("saves compact copy before compact theme without null deletion sentinels", async () => {
    seedClient(settingRows(
      { "org-invitation.subject": "Custom subject" },
      { base: { colors: {} }, roles: { body: {}, footer: { weight: 500 } } },
    ));
    renderPage();
    fireEvent.click(await outlineEntry("Header"));
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

  // The drafts used to be a COPY of the settings — `useState({})` filled in by a
  // seed-once effect — rather than a view of them. Save persists the draft
  // verbatim, so any moment the draft is not the active org's stored settings is
  // a moment Save writes the wrong thing over them. `copyDraft` here is the
  // org-wide email_copy map, so an empty one saved is EVERY template's copy gone,
  // not just this one's.
  describe("binding the drafts to the loaded settings", () => {
    // Deterministic where the flake was not: the settings are already in the
    // query cache, so the page has data during its FIRST render and the props it
    // hands the preview are inspectable before any effect has run. Asserting
    // through act() instead would only ever see the settled state, which is
    // precisely why this bug reached main.
    it("hydrates in the first render, before any effect runs", () => {
      const stored = {
        copy: { "org-invitation.subject": "Stored subject" },
        theme: { roles: { body: { size: 16 } } },
      };
      const queryClient = createTestQueryClient();
      queryClient.setQueryData(["app-settings", "email-templates", "org-1"], stored);
      // The suite does not clear mocks between tests, and this assertion reads
      // the FIRST recorded render rather than the last.
      vi.mocked(EmailPreviewPane).mockClear();
      renderPage("org-invitation", undefined, queryClient);

      const first = vi.mocked(EmailPreviewPane).mock.calls[0]?.[0];
      expect(first?.copyOverride).toEqual(stored.copy);
      expect(first?.themeOverride).toEqual(stored.theme);
    });

    // Same root cause, but permanent rather than sub-frame: switching orgs from
    // the sidebar re-keys the query without unmounting this page, and the
    // seed-once ref had already fired for the previous org.
    it("follows the active org when it changes under the open editor", async () => {
      seedClient([
        {
          when: { key: "email_copy" },
          data: [
            { org_id: "org-1", value: { "org-invitation.subject": "Org one subject" } },
            { org_id: "org-2", value: { "org-invitation.subject": "Org two subject" } },
          ],
          error: null,
        },
        { data: [], error: null },
      ]);
      const { rerender } = renderPage();
      fireEvent.click(await outlineEntry("Header"));
      expect(screen.getByLabelText("Subject")).toHaveValue("Org one subject");

      vi.mocked(useAuth).mockReturnValue({
        currentOrg: { id: "org-2", name: "Other Org", slug: "other-org" },
        hasRole: () => true,
      } as never);
      rerender(pageTree());

      fireEvent.click(await outlineEntry("Header"));
      expect(screen.getByLabelText("Subject")).toHaveValue("Org two subject");
      fireEvent.click(screen.getByRole("button", { name: "Save template" }));

      await waitFor(() => {
        const copyUpsert = (client.calls as RecordedCall[]).find(
          (call) => call.method === "upsert" && (call.args[0] as { key: string }).key === "email_copy",
        );
        expect(copyUpsert?.args[0]).toEqual(expect.objectContaining({
          org_id: "org-2",
          value: { "org-invitation.subject": "Org two subject" },
        }));
      });
    });
  });

  it("keeps preview available but disables every mutation in read-only mode", async () => {
    renderPage("org-invitation", true);
    expect(await screen.findByRole("button", { name: "Save template" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset all" })).toBeDisabled();
    fireEvent.click(await outlineEntry("Header"));
    expect(screen.getByLabelText("Subject")).toBeDisabled();
    expect(await screen.findByTitle("Email template preview")).toHaveAttribute("srcdoc", "<h1>Rendered draft</h1>");
  });

  // org-invitation renders ONE of four separately-editable role action lines, selected
  // by its sample data. Without this switcher the preview only ever showed the producer
  // variant, so three of the four edited sentences were unpreviewable before saving.
  it("switches the org-invitation preview between the declared role variants", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Preview as" });
    const lastPaneProps = () =>
      vi.mocked(EmailPreviewPane).mock.calls.at(-1)?.[0] as { dataOverride?: Record<string, unknown> };
    // Default = the first declared variant, which mirrors the template's own sample data.
    expect(lastPaneProps().dataOverride).toMatchObject({ roleKey: "producer" });
    fireEvent.click(screen.getByRole("button", { name: "Admin" }));
    expect(lastPaneProps().dataOverride).toMatchObject({ roleKey: "admin" });
    fireEvent.click(screen.getByRole("button", { name: "Artist (offer flow)" }));
    expect(lastPaneProps().dataOverride).toMatchObject({ roleKey: "artist", offersExpected: true });
    fireEvent.click(screen.getByRole("button", { name: "Artist (direct book)" }));
    expect(lastPaneProps().dataOverride).toMatchObject({ roleKey: "artist", offersExpected: false });
  });

  it("renders no variant switcher for a template without declared variants", async () => {
    renderPage("account-email-changed");
    expect(await screen.findByTitle("Email template preview")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Preview as" })).not.toBeInTheDocument();
  });
});
