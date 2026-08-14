import { useState } from "react";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { CoveragePanel } from "./CoveragePanel";

type CastsCoverageSegment = "coverage" | "ownership";

const SEGMENT_OPTIONS: SegmentedControlOption<CastsCoverageSegment>[] = [
  { value: "coverage", label: "Coverage" },
  { value: "ownership", label: "Production Ownership" },
];

/** Settings → Casts & coverage. Page shell: header + a segmented control between the
 *  Coverage sub-tab (org-default / per-show offer order) and Production Ownership
 *  (routing map, built in a later task). */
export function CastsCoverageTab({ orgId }: { orgId: string }) {
  const [segment, setSegment] = useState<CastsCoverageSegment>("coverage");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          ORGANIZATION · BOOKING
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold text-foreground">Casts &amp; coverage</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          Decide which cast the offer engine reaches for first, city by city, and see where coverage is missing.
        </p>
      </div>

      <SegmentedControl value={segment} onChange={(v) => setSegment(v)} options={SEGMENT_OPTIONS} />

      {segment === "coverage" ? (
        <CoveragePanel orgId={orgId} />
      ) : (
        <div className="text-sm text-muted-foreground">Production Ownership (coming in next task)</div>
      )}
    </div>
  );
}
