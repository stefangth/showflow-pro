// src/components/dashboard/firstRun/SamplePreview.test.tsx
import { it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SamplePreview } from "./SamplePreview";
import type { SamplePreviewData } from "@/lib/dashboard/types";

const sample: SamplePreviewData = {
  stats: [
    { title: "Live dates", value: "12", label: "this month" },
    { title: "Open offers", value: "4", label: "pending" },
  ],
  queue: [
    { title: "Confirm cast for Sat show", hint: "3 artists pending", when: "2h", cta: "Review", tone: "accent" },
  ],
  week: [
    { date: "Mon 12", ref: "Halle Kollektiv", status: "Filled" },
  ],
};

it("shows the Sample fixture when not complete", () => {
  render(
    <SamplePreview complete={false} sample={sample} sectionTitle="What this page becomes" sectionHint="Sample rows.">
      <div>LIVE</div>
    </SamplePreview>
  );
  expect(screen.getByText("Sample")).toBeInTheDocument();
  expect(screen.getByText("Live dates")).toBeInTheDocument();
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
});

it("renders live children when complete", () => {
  render(
    <SamplePreview complete sample={sample} sectionTitle="Today" sectionHint="Live.">
      <div>LIVE</div>
    </SamplePreview>
  );
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  expect(screen.queryByText("Sample")).not.toBeInTheDocument();
});
