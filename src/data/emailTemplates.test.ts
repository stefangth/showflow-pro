import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchEmailTemplateSettings } from "./emailTemplates";

describe("fetchEmailTemplateSettings", () => {
  it("keeps the new copy map when it is configured", async () => {
    const client = createFakeSupabase({
      app_settings: [
        { when: { key: "email_copy" }, data: [{ org_id: "org-1", value: { "org-invitation.subject": "New subject" } }], error: null },
        { when: { key: "email_theme" }, data: [], error: null },
        { when: { key: "email_template_overrides" }, data: [{ org_id: "org-1", value: { "org-invitation": { subject: "Legacy subject" } } }], error: null },
      ],
    });

    await expect(fetchEmailTemplateSettings(client as never, "org-1")).resolves.toEqual({
      copy: { "org-invitation.subject": "New subject" },
      theme: {},
    });
  });

  it("maps legacy copy only when the new copy setting is absent", async () => {
    const client = createFakeSupabase({
      app_settings: [
        { when: { key: "email_copy" }, data: [], error: null },
        { when: { key: "email_theme" }, data: [], error: null },
        { when: { key: "email_template_overrides" }, data: [{ org_id: "org-1", value: { "org-invitation": { subject: "Legacy subject", cta_label: "Join us" } } }], error: null },
      ],
    });

    await expect(fetchEmailTemplateSettings(client as never, "org-1")).resolves.toEqual({
      copy: {
        "org-invitation.subject": "Legacy subject",
        "org-invitation.ctaLabel": "Join us",
      },
      theme: {},
    });
  });

  it("does not resurrect legacy copy when the stored new copy map is empty", async () => {
    const client = createFakeSupabase({
      app_settings: [
        { when: { key: "email_copy" }, data: [{ org_id: "org-1", value: {} }], error: null },
        { when: { key: "email_theme" }, data: [], error: null },
        { when: { key: "email_template_overrides" }, data: [{ org_id: "org-1", value: { "org-invitation": { subject: "Legacy subject" } } }], error: null },
      ],
    });

    await expect(fetchEmailTemplateSettings(client as never, "org-1")).resolves.toEqual({
      copy: {},
      theme: {},
    });
  });

  it("uses an empty object when no email theme exists", async () => {
    const client = createFakeSupabase({
      app_settings: [
        { when: { key: "email_copy" }, data: [], error: null },
        { when: { key: "email_theme" }, data: [], error: null },
        { when: { key: "email_template_overrides" }, data: [], error: null },
      ],
    });

    await expect(fetchEmailTemplateSettings(client as never, "org-1")).resolves.toEqual({
      copy: {},
      theme: {},
    });
  });
});
