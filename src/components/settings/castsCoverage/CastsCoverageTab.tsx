import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { CoveragePanel } from "./CoveragePanel";
import { OwnershipPanel } from "./OwnershipPanel";

type CastsCoverageSegment = "coverage" | "ownership";

/** Settings → Casts & coverage. Page shell: header + a segmented control between the
 *  Coverage sub-tab (org-default / per-show offer order) and Production Ownership
 *  (routing map, built in a later task). */
export function CastsCoverageTab({ orgId }: { orgId: string }) {
  const { t } = useTranslation('settingsCastsCoverage');
  const [segment, setSegment] = useState<CastsCoverageSegment>("coverage");

  const SEGMENT_OPTIONS: SegmentedControlOption<CastsCoverageSegment>[] = [
    { value: "coverage", label: t('tab.segmentCoverage') },
    { value: "ownership", label: t('tab.segmentOwnership') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
          {t('tab.eyebrow')}
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold text-foreground">{t('tab.title')}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
          {t('tab.description')}
        </p>
      </div>

      <SegmentedControl value={segment} onChange={(v) => setSegment(v)} options={SEGMENT_OPTIONS} />

      {segment === "coverage" ? (
        <CoveragePanel orgId={orgId} />
      ) : (
        <OwnershipPanel orgId={orgId} />
      )}
    </div>
  );
}
