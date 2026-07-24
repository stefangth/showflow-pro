/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { TEMPLATES } from "./registry.ts";

Deno.test("hire-order-countersigned is registered and renders", async () => {
  const entry = TEMPLATES["hire-order-countersigned"];
  assert(entry, "template registered");
  const { render } = await import("npm:@react-email/render@1.0.1");
  // Deviation from brief: `entry.component(...)` doesn't type-check because
  // TemplateEntry.component is React.ComponentType<TemplateData> (a union
  // including ComponentClass, which has no call signature). Using
  // React.createElement matches the existing pattern in app-links.test.ts,
  // preview-transactional-email/index.ts, and send-transactional-email/index.ts.
  const html = await render(React.createElement(entry.component, entry.previewData ?? {}));
  assert(html.includes("countersigned") || html.includes("Countersigned"), "mentions countersigned");
  const subject = typeof entry.subject === "function" ? entry.subject(entry.previewData ?? {}) : entry.subject;
  assertEquals(typeof subject, "string");
});
