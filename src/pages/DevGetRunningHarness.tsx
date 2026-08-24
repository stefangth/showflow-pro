import { PhaseCard } from "@/components/getRunning/PhaseCard";
import { GetRunningHeader } from "@/components/getRunning/GetRunningHeader";
import { RetiredBoard } from "@/components/getRunning/RetiredBoard";
import { GetRunningBoardV3 } from "@/components/getRunning/v3/GetRunningBoardV3";
import type { GetRunningModel, GetRunningPhase, GetRunningTask, GetRunningTaskKey, GetRunningPhaseKey, TaskBlock } from "@/lib/getRunning/tasks";

/**
 * DEV-ONLY visual harness (registered only under `import.meta.env.DEV`) for eyeballing the
 * Get running board's phase cards across every visual state at once — the scenarios that are
 * hard to reach with real seed data (a fully-complete "Make it bookable", a complete
 * Paperwork phase, etc.). Not part of the product; never mounted in production.
 */
function task(
  key: GetRunningTaskKey,
  phase: GetRunningPhaseKey,
  done: boolean,
  block: TaskBlock = null,
): GetRunningTask {
  return { key, phase, done, block, adminOnly: false, actionableByViewer: true };
}

const SCENARIOS: { label: string; phase: GetRunningPhase }[] = [
  {
    label: "get_dates · complete (Running)",
    phase: { key: "get_dates", tasks: [task("dates", "get_dates", true), task("slots", "get_dates", true, "filling")] },
  },
  {
    label: "get_dates · in progress (slots left)",
    phase: { key: "get_dates", tasks: [task("dates", "get_dates", true), task("slots", "get_dates", false, "filling")] },
  },
  {
    label: "bookable · blocking (mixed checkmarks)",
    phase: {
      key: "bookable",
      tasks: [
        task("flow", "bookable", true),
        task("people", "bookable", false, "booking"),
        task("ladder", "bookable", false, "offers"),
        task("eligibility", "bookable", true),
        task("timing", "bookable", true),
        task("team", "bookable", true),
      ],
    },
  },
  {
    label: "bookable · active (5 of 6, nothing blocking) ← the reported state",
    phase: {
      key: "bookable",
      tasks: [
        task("flow", "bookable", true),
        task("people", "bookable", true),
        task("ladder", "bookable", true),
        task("eligibility", "bookable", true),
        task("timing", "bookable", true),
        task("team", "bookable", false),
      ],
    },
  },
  {
    label: "bookable · COMPLETE (every checkmark)",
    phase: {
      key: "bookable",
      tasks: [
        task("flow", "bookable", true),
        task("people", "bookable", true),
        task("ladder", "bookable", true),
        task("eligibility", "bookable", true),
        task("timing", "bookable", true),
        task("team", "bookable", true),
      ],
    },
  },
  {
    label: "paperwork · neutral (not started)",
    phase: {
      key: "paperwork",
      tasks: [
        task("letterhead", "paperwork", false, "issuing"),
        task("terms", "paperwork", false, "issuing"),
        task("countersign", "paperwork", false),
      ],
    },
  },
  {
    // Done letterhead/terms still carry block:"issuing" in production (makeHireTask never
    // clears the field — it is the static "what it holds up if outstanding" value), so this
    // is the exact state that regressed: a complete phase must NOT show "Blocks issuing"
    // and each done tile shows its check.
    label: "paperwork · COMPLETE (every checkmark)",
    phase: {
      key: "paperwork",
      tasks: [
        task("letterhead", "paperwork", true, "issuing"),
        task("terms", "paperwork", true, "issuing"),
        task("countersign", "paperwork", true),
      ],
    },
  },
];

const headerModel: GetRunningModel = {
  phases: [SCENARIOS[2].phase, SCENARIOS[4].phase],
  doneCount: 6,
  totalCount: 11,
  canFirstOffer: false,
  complete: false,
  bookingOn: true,
  hireOrdersOn: true,
  datesWithoutCity: 0,
  datesWithoutCityUnknown: false,
};

const retiredModel: GetRunningModel = { ...headerModel, doneCount: 11, complete: true, canFirstOffer: true };

export default function DevGetRunningHarness() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="mx-auto flex max-w-[820px] flex-col gap-8">
        <h1 className="text-sm text-muted-foreground">/dev/get-running · phase-card scenarios</h1>

        <section className="flex flex-col gap-2">
          <div className="text-xs text-[var(--text-faint)]">header</div>
          <GetRunningHeader model={headerModel} orgName="Nordstadt Produktionen" role="admin" />
        </section>

        {SCENARIOS.map((s) => (
          <section key={s.label} className="flex flex-col gap-2">
            <div className="text-xs text-[var(--text-faint)]">{s.label}</div>
            <PhaseCard phase={s.phase} role="admin" onOpenTask={() => {}} />
          </section>
        ))}

        <section className="flex flex-col gap-2">
          <div className="text-xs text-[var(--text-faint)]">retired board (all complete)</div>
          <RetiredBoard model={retiredModel} orgId={null} />
        </section>

        <section className="flex flex-col gap-2">
          <div className="text-xs text-[var(--text-faint)]">v3 board (always on here, regardless of the per-org flag)</div>
          <GetRunningBoardV3 context="page" />
        </section>
      </div>
    </div>
  );
}
