import { useTranslation } from "react-i18next";
import { adminDisplayName } from "@/data/orgAdmins";
import type { GetRunningModel, GetRunningTask } from "@/lib/getRunning/tasks";

/** A task blocks the first offer when it holds up either offers or booking (mirrors
 *  `composeGetRunning`'s own `canFirstOffer` derivation in src/lib/getRunning/tasks.ts). */
function isFirstOfferBlocker(task: GetRunningTask): boolean {
  return task.block === "offers" || task.block === "booking";
}

/**
 * Board header for `/get-running` (screen 01/03): eyebrow + headline + body on the left,
 * a 236px "Set up" progress card (ticks + module on/off list) on the right. Pure
 * presentational leaf — see docs/superpowers/specs/2026-08-17-setup-settings-design/
 * screens/01_01_Get_running.html (admin) and screens/03_03_Producer_view.html (producer)
 * for the source markup this mirrors.
 *
 * `role`/`adminNames` are both optional and default to the admin/screen-01 wording when
 * omitted, so every existing caller (and this component's own pre-Task-8 tests) is
 * unaffected. Passing `role="producer"` swaps the headline+body for the screen-03 variant,
 * which counts each not-done task's own `actionableByViewer` ("yours" vs "waits on
 * {admin}") rather than re-deriving anything — the same single source of truth `TaskRow`
 * and `PhaseCard` already read.
 */
export function GetRunningHeader({ model, orgName, role, adminNames }: {
  model: GetRunningModel;
  orgName: string | null | undefined;
  role?: "admin" | "producer";
  adminNames?: string[];
}): JSX.Element {
  const { t } = useTranslation("getRunning");

  const allTasks = model.phases.flatMap((p) => p.tasks);
  const blockingCount = allTasks.filter((task) => isFirstOfferBlocker(task) && !task.done).length;

  const state = model.complete ? "complete" : model.canFirstOffer ? "ready" : "blocking";

  // A producer's own "yours" vs "waits on {admin}" split, straight off each not-done
  // task's `actionableByViewer` — never re-derived from role/capabilities here.
  const yoursCount = allTasks.filter((task) => !task.done && task.actionableByViewer).length;
  const waitsCount = allTasks.filter((task) => !task.done && !task.actionableByViewer).length;

  let headline: string;
  let body: string;
  if (role === "producer" && (yoursCount > 0 || waitsCount > 0)) {
    const adminName = adminDisplayName(adminNames, t("waitsOn.fallbackAdmin"));
    if (yoursCount > 0 && waitsCount > 0) {
      headline = `${t("header.headline.producerYours", { count: yoursCount })} ${t("header.headline.producerWaits", {
        count: waitsCount,
        name: adminName,
      })}`;
    } else if (yoursCount > 0) {
      headline = t("header.headline.producerYours", { count: yoursCount });
    } else {
      headline = t("header.headline.producerOnlyWaits", { count: waitsCount, name: adminName });
    }
    body = t("header.body.producer");
  } else {
    // Nothing left at all (producer or admin, board complete/ready) reads the same
    // role-neutral wording the admin board always has.
    headline =
      state === "blocking"
        ? t("header.headline.blocking", { count: blockingCount })
        : t(`header.headline.${state}`);
    body =
      state === "blocking"
        ? t("header.body.blocking", { count: blockingCount, minutes: blockingCount * 3 })
        : t(`header.body.${state}`);
  }

  const modules: { key: string; label: string; on: boolean }[] = [
    { key: "booking", label: t("progress.module.booking"), on: model.bookingOn },
    { key: "hireOrders", label: t("progress.module.hireOrders"), on: model.hireOrdersOn },
  ];

  return (
    <div className="flex items-start gap-6">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-600">
          {t("header.eyebrow", { org: orgName || t("header.fallbackOrg") })}
        </div>
        <h1 className="mt-2 max-w-[620px] text-[32px] font-semibold leading-[38px] tracking-[-0.6px] text-foreground text-pretty">
          {headline}
        </h1>
        <p className="mt-2 max-w-[600px] text-sm leading-[21px] text-muted-foreground text-pretty">{body}</p>
      </div>

      <div className="w-[236px] shrink-0 rounded-[var(--radius-l)] border border-border bg-card p-3.5">
        <div className="text-[11px] font-semibold uppercase tracking-[1.6px] text-[var(--text-faint)]">
          {t("progress.title")}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-mono text-[22px] font-semibold tracking-[-0.4px] text-foreground">
            {model.doneCount}
          </span>
          <span className="text-xs text-[var(--text-faint)]">{t("progress.of", { total: model.totalCount })}</span>
        </div>
        <div className="mt-2.5 flex gap-[3px]">
          {Array.from({ length: model.totalCount }, (_, i) => i < model.doneCount).map((filled, i) => (
            <div
              key={i}
              data-testid="get-running-tick"
              data-filled={filled ? "true" : "false"}
              className={`h-[3px] flex-1 rounded-full ${filled ? "bg-primary" : "bg-[var(--surface-3)]"}`}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-2.5">
          {modules.map((m) => (
            <div key={m.key} data-testid={`get-running-module-${m.key}`} className="flex items-baseline gap-[7px]">
              <div className={`h-1.5 w-1.5 shrink-0 rounded-[2px] ${m.on ? "bg-primary" : "bg-[var(--text-faint)]"}`} />
              <div className="text-xs font-medium text-foreground">{m.label}</div>
              <div className="flex-1" />
              <div className={`text-[11px] font-semibold ${m.on ? "text-accent-600" : "text-[var(--text-faint)]"}`}>
                {m.on ? t("progress.module.on") : t("progress.module.off")}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2.5 text-[11px] leading-4 text-[var(--text-faint)] text-pretty">
          {t("progress.footer")}
        </div>
      </div>
    </div>
  );
}
