/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { template } from "./hire-order-issued.tsx";

Deno.test("issued email shows the sign CTA in electronic mode", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  // Deviation from brief: `template.component({...})` doesn't type-check
  // because TemplateEntry.component is React.ComponentType<TemplateData> (a
  // union including ComponentClass, which has no call signature). Using
  // React.createElement matches the existing pattern in
  // hire-order-countersigned.test.ts / app-links.test.ts.
  const html = await render(React.createElement(template.component, {
    artist_name: "Ann", order_no: "HO-1", date_label: "Sat, Aug 15 2026", venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "electronic",
    signing_url: "https://app.example/hire-orders/o-1",
  }));
  assert(html.includes("Review and sign"), "electronic mode shows the sign CTA");
  assert(
    html.indexOf("Review and sign") < html.indexOf("Review contract"),
    "electronic mode prioritises signing before document download",
  );
  assert(!html.includes("View and download"), "electronic mode uses a secondary document CTA label");
});

Deno.test("issued email preserves the manual download CTA", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(React.createElement(template.component, {
    artist_name: "Ann",
    date_label: "Sat, Aug 15 2026",
    venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "manual",
  }));

  assert(html.includes("View and download"), "manual mode keeps the legacy download label");
  assert(!html.includes("Review and sign"), "manual mode does not show electronic signing");
});

Deno.test("issued email lists every aggregate engagement date", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(React.createElement(template.component, {
    artist_name: "Ann",
    date_label: "Sat, Aug 15 2026",
    engagement_dates_label: "Sat, Aug 15 2026 · Tempodrom, Berlin; Sun, Aug 16 2026 · Huxleys, Berlin",
    venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "manual",
  }));

  assert(html.includes("Sun, Aug 16 2026"), "aggregate email includes every engagement date");
  assert(html.includes("Huxleys, Berlin"), "aggregate email includes each engagement location");
});

Deno.test("fully signed electronic resend does not offer another signing CTA", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(React.createElement(template.component, {
    artist_name: "Ann",
    date_label: "Sat, Aug 15 2026",
    venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "electronic",
    signing_url: "https://app.example/hire-orders/o-1",
    is_fully_signed: true,
  }));

  assert(!html.includes("Review and sign"), "signed order does not offer a stale signing CTA");
  assert(html.includes("View and download"), "signed order leads with its document CTA");
});

Deno.test("Documenso delivery without a durable signing URL does not offer a signing CTA", async () => {
  const { render } = await import("npm:@react-email/render@1.0.1");
  const html = await render(React.createElement(template.component, {
    artist_name: "Ann",
    date_label: "Sat, Aug 15 2026",
    venue: "Tempodrom",
    download_url: "https://app.example/hire-orders/o-1",
    countersign_mode: "documenso",
  }));

  assert(!html.includes("Review and sign"), "missing credential never falls back to an unsafe signing link");
  assert(html.includes("View and download"), "safe fallback still links to the order document");
});
