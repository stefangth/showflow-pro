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
});
