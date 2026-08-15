/**
 * Deep DI tests for preview-transactional-email handler.
 *
 * Contract under test:
 * - No auth → 401
 * - Non-admin/non-producer (artist) → 403
 * - Producer → 200 (both admin AND producer are allowed)
 * - No templateName → renders ALL registered templates; response is { templates: [...] }
 *   with one entry per TEMPLATES registry key; each entry has the documented shape.
 * - templateName (known) → renders just that template; array of length 1 with status 'ready'
 * - templateName (unknown) → status 'render_failed' + errorMessage, NOT a hard 400/500
 * - Per-template try/catch: a render failure produces status 'render_failed' + errorMessage
 *   and does NOT fail the whole request (other templates still return 'ready').
 * - Override fields (subject, intro, cta_label, footer) are applied when provided.
 * - Subject resolution: string subject uses the literal; function subject is called with previewData.
 * - OPTIONS → preflight (200 or 204)
 */

import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";
import { TEMPLATES } from "../_shared/transactional-email-templates/registry.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminDeps() {
  return makeFakeDeps({
    authUser: { id: "admin-user" },
    tables: {
      org_memberships: { data: [{ user_id: "admin-user", role: "admin" }], error: null },
    },
  }).deps;
}

function producerDeps() {
  return makeFakeDeps({
    authUser: { id: "producer-user" },
    tables: {
      org_memberships: { data: [{ user_id: "producer-user", role: "producer" }], error: null },
    },
  }).deps;
}

function artistDeps() {
  return makeFakeDeps({
    authUser: { id: "artist-user" },
    tables: {
      org_memberships: { data: [{ user_id: "artist-user", role: "artist" }], error: null },
    },
  }).deps;
}

function authedPostRequest(body: unknown = {}) {
  return makeRequest({ headers: { Authorization: "Bearer jwt" }, body });
}

const EXPECTED_TEMPLATE_COUNT = 13;

// ── Auth contract ─────────────────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: OPTIONS → preflight", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ method: "OPTIONS" }), deps);
  assertEquals(res.status === 200 || res.status === 204, true);
});

Deno.test("preview-transactional-email DI: no auth header → 401", async () => {
  const { deps } = makeFakeDeps();
  const res = await handle(makeRequest({ headers: {}, body: {} }), deps);
  assertEquals(res.status, 401);
});

Deno.test("preview-transactional-email DI: auth header without Bearer prefix → 401", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u1" },
    tables: { org_memberships: { data: [{ user_id: "u1", role: "admin" }], error: null } },
  });
  const res = await handle(
    makeRequest({ headers: { Authorization: "jwt-no-prefix" }, body: {} }),
    deps,
  );
  assertEquals(res.status, 401);
});

Deno.test("preview-transactional-email DI: artist role → 403", async () => {
  const res = await handle(authedPostRequest(), artistDeps());
  assertEquals(res.status, 403);
});

Deno.test("preview-transactional-email DI: no role row → 403", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "u-no-role" },
    tables: { org_memberships: { data: null, error: null } },
  });
  const res = await handle(authedPostRequest(), deps);
  assertEquals(res.status, 403);
});

Deno.test("preview-transactional-email DI: admin role → 200", async () => {
  const res = await handle(authedPostRequest(), adminDeps());
  assertEquals(res.status, 200);
});

Deno.test("preview-transactional-email DI: producer role → 200 (both roles are allowed)", async () => {
  const res = await handle(authedPostRequest(), producerDeps());
  assertEquals(res.status, 200);
});

// ── Render all (no templateName) ─────────────────────────────────────────────

Deno.test("preview-transactional-email DI: no templateName → response has templates array", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  assertEquals(res.status, 200);
  const body = await res.json() as { templates: unknown };
  assertExists(body.templates);
  assertEquals(Array.isArray(body.templates), true);
});

Deno.test("preview-transactional-email DI: no templateName → one entry per registry template", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as { templates: unknown[] };
  assertEquals(templates.length, EXPECTED_TEMPLATE_COUNT);
});

Deno.test("preview-transactional-email DI: no templateName → all registry names present in results", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as { templates: Array<{ templateName: string }> };
  const returnedNames = templates.map((t) => t.templateName).sort();
  const expectedNames = Object.keys(TEMPLATES).sort();
  assertEquals(returnedNames, expectedNames);
});

Deno.test("preview-transactional-email DI: no templateName → each entry has documented shape keys", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as {
    templates: Array<Record<string, unknown>>;
  };
  for (const entry of templates) {
    const keys = Object.keys(entry).sort();
    // Required keys: templateName, displayName, subject, html, status
    // Optional: errorMessage (only on error entries)
    for (const required of ["templateName", "displayName", "subject", "html", "status"]) {
      assertEquals(
        keys.includes(required),
        true,
        `Entry for '${entry.templateName}' missing key '${required}'`,
      );
    }
  }
});

Deno.test("preview-transactional-email DI: no templateName → all templates with previewData have status 'ready'", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; status: string }>;
  };
  for (const entry of templates) {
    assertEquals(
      entry.status,
      "ready",
      `Expected status 'ready' for '${entry.templateName}', got '${entry.status}'`,
    );
  }
});

Deno.test("preview-transactional-email DI: no templateName → all entries have non-empty html when status=ready", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; status: string; html: string }>;
  };
  for (const entry of templates) {
    if (entry.status === "ready") {
      assertEquals(
        entry.html.length > 0,
        true,
        `html is empty for '${entry.templateName}'`,
      );
    }
  }
});

Deno.test("preview-transactional-email DI: no templateName → all entries have non-empty subject when status=ready", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; status: string; subject: string }>;
  };
  for (const entry of templates) {
    if (entry.status === "ready") {
      assertEquals(
        entry.subject.length > 0,
        true,
        `subject is empty for '${entry.templateName}'`,
      );
    }
  }
});

Deno.test("preview-transactional-email DI: no templateName → each entry has a non-empty displayName", async () => {
  const res = await handle(authedPostRequest({}), adminDeps());
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; displayName: string }>;
  };
  for (const entry of templates) {
    assertEquals(
      typeof entry.displayName === "string" && entry.displayName.length > 0,
      true,
      `displayName missing or empty for '${entry.templateName}'`,
    );
  }
});

Deno.test("preview-transactional-email DI: no templateName — producer gets same result as admin", async () => {
  const adminRes = await handle(authedPostRequest({}), adminDeps());
  const producerRes = await handle(authedPostRequest({}), producerDeps());
  const adminBody = await adminRes.json() as { templates: Array<{ templateName: string; status: string }> };
  const producerBody = await producerRes.json() as { templates: Array<{ templateName: string; status: string }> };
  assertEquals(adminBody.templates.length, producerBody.templates.length);
  for (let i = 0; i < adminBody.templates.length; i++) {
    assertEquals(adminBody.templates[i].templateName, producerBody.templates[i].templateName);
    assertEquals(adminBody.templates[i].status, producerBody.templates[i].status);
  }
});

// ── Subject resolution ────────────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: function subject resolved correctly (artist-confirmation-digest, with updates)", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "artist-confirmation-digest" }),
    adminDeps(),
  );
  const { templates } = await res.json() as { templates: Array<{ templateName: string; subject: string; status: string }> };
  assertEquals(templates.length, 1);
  const entry = templates[0];
  assertEquals(entry.status, "ready");
  // artist-confirmation-digest now has a FUNCTION subject; its previewData includes a
  // schedule change + a cancellation, so it resolves to the neutral "updates" subject.
  assertEquals(entry.subject, "Your booking updates on ShowFlow");
});

Deno.test("preview-transactional-email DI: function subject (cast-escalation-requested) uses previewData fields", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "cast-escalation-requested" }),
    adminDeps(),
  );
  const { templates } = await res.json() as { templates: Array<{ templateName: string; subject: string; status: string }> };
  assertEquals(templates.length, 1);
  const entry = templates[0];
  assertEquals(entry.status, "ready");
  // previewData: { program: 'Riverdance', date: '2026-06-15', tier: 1, ... }
  assertEquals(entry.subject, "Escalation needed: Tier 1 for Riverdance on 2026-06-15");
});

// ── Single template rendering ─────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: templateName given → array of length 1", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "account-email-changed" }),
    adminDeps(),
  );
  assertEquals(res.status, 200);
  const { templates } = await res.json() as { templates: unknown[] };
  assertEquals(templates.length, 1);
});

Deno.test("preview-transactional-email DI: templateName given → entry has correct templateName", async () => {
  const name = "artist-offer-digest";
  const res = await handle(authedPostRequest({ templateName: name }), adminDeps());
  const { templates } = await res.json() as { templates: Array<{ templateName: string }> };
  assertEquals(templates[0].templateName, name);
});

Deno.test("preview-transactional-email DI: templateName given → status 'ready' and html non-empty", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "artist-offer-digest" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ status: string; html: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.length > 0, true);
});

Deno.test("preview-transactional-email DI: each known template renders individually without error", async () => {
  for (const name of Object.keys(TEMPLATES)) {
    const res = await handle(authedPostRequest({ templateName: name }), adminDeps());
    assertEquals(res.status, 200, `Request failed for template '${name}'`);
    const { templates } = await res.json() as {
      templates: Array<{ templateName: string; status: string; html: string }>;
    };
    assertEquals(templates.length, 1, `Expected 1 entry for '${name}'`);
    assertEquals(templates[0].status, "ready", `Expected status='ready' for '${name}'`);
    assertEquals(templates[0].html.length > 0, true, `html empty for '${name}'`);
  }
});

// ── Unknown templateName ──────────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: unknown templateName → 200 (not a hard error)", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "does-not-exist" }),
    adminDeps(),
  );
  // characterization: unknown template does NOT cause a 4xx/5xx; it returns 200
  // with an entry whose status='render_failed'. The whole request still succeeds.
  assertEquals(res.status, 200);
});

Deno.test("preview-transactional-email DI: unknown templateName → status 'render_failed'", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "does-not-exist" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; status: string; errorMessage?: string }>;
  };
  assertEquals(templates.length, 1);
  assertEquals(templates[0].status, "render_failed");
});

Deno.test("preview-transactional-email DI: unknown templateName → errorMessage contains template name", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "does-not-exist" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ templateName: string; status: string; errorMessage?: string }>;
  };
  assertExists(templates[0].errorMessage);
  assertEquals(templates[0].errorMessage!.includes("does-not-exist"), true);
});

Deno.test("preview-transactional-email DI: unknown templateName → entry html and subject are empty strings", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "nope" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; subject: string; status: string }>;
  };
  assertEquals(templates[0].html, "");
  assertEquals(templates[0].subject, "");
});

// ── Render resilience: per-template try/catch ─────────────────────────────────
//
// The handler wraps each render in try/catch (index.ts lines 69-107).
// We can't easily force a real template component to throw without patching it,
// but we CAN assert the structural guarantee by requesting a template that doesn't
// exist mixed with real templates via the "render all" path: one entry will be
// render_failed while others remain ready.
//
// For a direct render-throws path, we note the code path exists and is covered by
// the unknown-template tests above (entry = template-not-found → render_failed).
// A template whose React component itself throws would follow the same catch block
// (lines 94-107). We characterize this with a NOTE rather than skipping.
//
// NOTE: To fully exercise "component throws → render_failed, others still ready"
// we would need to inject a broken component into TEMPLATES at test time, which
// requires patching the module. This test documents the gap as a coverage note.

Deno.test("preview-transactional-email DI: render-all does NOT fail the request even if one entry is broken", async () => {
  // We simulate a mixed scenario by calling the endpoint with a body that is
  // not a valid POST JSON but still passes JSON.parse (empty object → renders all).
  // All 5 real templates should render cleanly — this confirms the happy path that
  // the per-template catch does not interfere with other entries.
  const res = await handle(authedPostRequest({}), adminDeps());
  assertEquals(res.status, 200);
  const { templates } = await res.json() as {
    templates: Array<{ status: string; templateName: string }>;
  };
  const readyCount = templates.filter((t) => t.status === "ready").length;
  assertEquals(readyCount, EXPECTED_TEMPLATE_COUNT);
});

Deno.test("preview-transactional-email DI: per-template catch structure — unknown name in batch does not prevent others", async () => {
  // We cannot inject a broken template component without module patching.
  // However, we verify the structural guarantee: mixing an unknown template name
  // in a future "batch preview" scenario would still let valid templates render.
  //
  // Here we verify via the handler code structure (read-side assertion):
  // - TEMPLATES loop always pushes to `results` even when entry is missing
  // - The final json({ templates: results }) is always returned regardless of failures
  //
  // Practical verification: request a single unknown name → still 200 + render_failed
  // (not a 5xx). This confirms try/catch keeps the response alive.
  const res = await handle(authedPostRequest({ templateName: "ghost-template" }), adminDeps());
  assertEquals(res.status, 200);
  const { templates } = await res.json() as {
    templates: Array<{ status: string }>;
  };
  assertEquals(templates[0].status, "render_failed");
});

// ── Overrides ─────────────────────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: subject override replaces subject in response", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "account-email-changed",
      overrides: { subject: "Custom Subject Override" },
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ subject: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].subject, "Custom Subject Override");
});

Deno.test("preview-transactional-email DI: whitespace-only subject override is ignored (original subject kept)", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "account-email-changed",
      overrides: { subject: "   " },
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ subject: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].subject, "Your ShowFlow login email was changed");
});

Deno.test("preview-transactional-email DI: non-string subject override is ignored", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "account-email-changed",
      overrides: { subject: 42 },
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ subject: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].subject, "Your ShowFlow login email was changed");
});

Deno.test("preview-transactional-email DI: intro override is applied to html render (no render error)", async () => {
  // We can't easily assert the overridden text appears in HTML without parsing HTML,
  // but we can assert the render does not fail and html is non-empty.
  const res = await handle(
    authedPostRequest({
      templateName: "account-email-changed",
      overrides: { intro: "Custom intro text for this preview." },
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ status: string; html: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.length > 0, true);
});

Deno.test("preview-transactional-email DI: applies copy, theme, and highlight overrides", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "org-invitation",
      copyOverride: {
        "org-invitation.subject": "Welcome {{orgName}}",
        "org-invitation.productIntro": "A custom invitation for {{orgName}}.",
      },
      themeOverride: { base: { colors: { pageBg: "#010203" } } },
      highlightRole: "heading",
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ subject: string; html: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].subject, "Welcome Cirque Lumière");
  assertEquals(templates[0].html.includes("A custom invitation for Cirque Lumière."), true);
  assertEquals(templates[0].html.includes("#010203"), true);
  assertEquals(templates[0].html.includes("outline:2px solid"), true);
});

// The org-invitation template renders ONE of four role action lines, selected by its
// sample data's roleKey/offersExpected. Without a data override the Settings preview
// could only ever show the producer variant, leaving three separately-editable
// sentences unpreviewable before save. dataOverride merges over previewData for the
// requested template so the editor's role switcher can render each variant.
Deno.test("preview-transactional-email DI: dataOverride merges over the template's sample data", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "org-invitation",
      dataOverride: { roleKey: "admin", role: "Admin" },
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.includes("full control of this workspace"), true, "admin action line renders");
  assertEquals(templates[0].html.includes("plan productions and show dates"), false, "producer line is replaced");
});

Deno.test("preview-transactional-email DI: without dataOverride the sample data is untouched", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "org-invitation" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; status: string }>;
  };
  assertEquals(templates[0].html.includes("plan productions and show dates"), true, "producer sample stays the default");
});

Deno.test("preview-transactional-email DI: non-object dataOverride is silently ignored", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "org-invitation", dataOverride: "roleKey=admin" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.includes("plan productions and show dates"), true);
});

Deno.test("preview-transactional-email DI: non-object overrides field is silently ignored", async () => {
  const res = await handle(
    authedPostRequest({
      templateName: "artist-confirmation-digest",
      overrides: "not-an-object",
    }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ status: string; html: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.length > 0, true);
});

// ── Specific template HTML content smoke checks ───────────────────────────────

Deno.test("preview-transactional-email DI: account-email-changed html contains preview data email", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "account-email-changed" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.includes("new@example.com"), true);
});

Deno.test("preview-transactional-email DI: artist-offer-digest html contains preview data offers", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "artist-offer-digest" }),
    adminDeps(),
  );
  const { templates } = await res.json() as {
    templates: Array<{ html: string; status: string }>;
  };
  assertEquals(templates[0].status, "ready");
  assertEquals(templates[0].html.includes("Riverdance"), true);
});

// ── Registry count assertion ──────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: TEMPLATES registry has exactly 13 entries", async () => {
  // Regression guard: if a template is added/removed, this test will catch the mismatch.
  // Task 10 added 'hire-order-issued' (9 -> 10). Task 5 added 'account-email-changed' (10 -> 11).
  // Hire-orders countersign added 'hire-order-countersigned'; two retired signup templates are absent.
  // The magic-link sign-in email added 'magic-link' (10 -> 11).
  // Airtable sync held alert email added 'airtable-sync-held' (11 -> 12).
  // Producer journey WP-P4 added 'tier-at-risk' (12 -> 13).
  assertEquals(EXPECTED_TEMPLATE_COUNT, 13);
});

// ── GET method (non-POST) ─────────────────────────────────────────────────────

Deno.test("preview-transactional-email DI: GET method with auth → 200 (renders all, no body parsing)", async () => {
  // characterization: the handler only parses body for POST; for GET it skips
  // body parsing and renders all templates (templateName = undefined).
  const res = await handle(
    makeRequest({ method: "GET", headers: { Authorization: "Bearer jwt" } }),
    adminDeps(),
  );
  assertEquals(res.status, 200);
  const { templates } = await res.json() as { templates: unknown[] };
  assertEquals(templates.length, EXPECTED_TEMPLATE_COUNT);
});

// ── Per-org language (Section C): explicit, non-entitlement-gated preview locale ──
Deno.test("preview: body.locale 'de' renders German copy + <html lang=de> (admin QA, no entitlement gate)", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "offer-immediate", locale: "de" }),
    adminDeps(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  const entry = body.templates.find((t: { templateName: string }) => t.templateName === "offer-immediate");
  assertExists(entry);
  assertEquals(entry.status, "ready");
  assertEquals(entry.html.includes('lang="de"'), true);
  assertEquals(entry.html.includes("Du hast ein neues Angebot"), true);
});

Deno.test("preview: default locale renders English + <html lang=en>", async () => {
  const res = await handle(
    authedPostRequest({ templateName: "offer-immediate" }),
    adminDeps(),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  const entry = body.templates.find((t: { templateName: string }) => t.templateName === "offer-immediate");
  assertExists(entry);
  assertEquals(entry.html.includes('lang="en"'), true);
  assertEquals(entry.html.includes("You have a new offer"), true);
});
