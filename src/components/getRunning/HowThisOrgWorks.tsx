import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { useBookingFlowProvenance } from "@/hooks/useBookingFlowProvenance";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { useBookingSetupStatus } from "@/hooks/useBookingSetup";
import { useHireOrderSetupStatus } from "@/hooks/useHireOrderSetup";
import { berlinTime, matchPreset } from "@/lib/bookingFlow";
import { resolveCoverage } from "@/lib/bookings/setupStatus";
import { formatDateDMY } from "@/lib/dates";
import type { SettingsAuditEntry } from "@/data/settingsAudit";
import type { FirstRunRole } from "@/lib/dashboard/stageChain.types";

const TIMING_AUDIT_KEYS = ["offer_response_window_hours", "offer_digest_hour_berlin", "confirmation_digest_hour_berlin"];
const HIRE_AUDIT_KEYS = ["hire_order_letterhead", "hire_order_terms", "hire_order_countersign"];

interface ReferenceRow {
  key: string;
  label: string;
  value: string | null;
  note: string | null;
}

/**
 * `HowThisOrgWorks` — the read-only reference the retired Get Running board (screen 04,
 * `RetiredBoard`) lives on once every setup task is done. Settings → How this org works
 * hosts it for admin + producer (see `SettingsPage`'s `how-it-works` tab).
 *
 * Every row here is a DISPLAY of the org's current settings, never an editor: no button,
 * input, switch or checkbox is rendered anywhere on this card (pinned by this file's own
 * test, "never renders a mutating control"). Editing stays where it always lived — Settings
 * → Booking engine / Hire orders / Casts & coverage — this card only explains what is
 * currently in effect and, where the audit log can say so, who set it and when.
 *
 * Provenance is attempted for booking flow (`useBookingFlowProvenance`, which already
 * handles the admin/producer/artist split — an admin reads the audit log directly, a
 * producer falls back to the org's first admin's name with no date) and, directly off
 * `settings_audit_log` (`useSettingsAudit`), for offer timing and the three hire-order
 * paperwork settings. That table is admin-only under RLS (see
 * `supabase/migrations/20260714103537_settings_audit_log.sql`): a producer's read simply
 * resolves empty, not an error, so those two rows show no attribution line for them,
 * rather than inventing one. Cast coverage has no row of its own in `settings_audit_log`
 * (it is a derived state of the roster and cast rankings, not a stored setting), so it
 * never carries a provenance line.
 */
export function HowThisOrgWorks({ orgId }: { orgId: string | null }): ReactNode {
  const { t } = useTranslation(["getRunning", "settingsBookingFlow"]);
  const { hasRole } = useAuth();
  const role: FirstRunRole = hasRole("admin") ? "admin" : "producer";

  const bookingOn = useFeature("booking_flow");
  const hireOrdersOn = useFeature("hire_orders");

  const flowQ = useBookingFlow(orgId);
  const flowProvenance = useBookingFlowProvenance(role);
  const timesQ = useFlowTimes(orgId);
  const timingAudit = useSettingsAudit(TIMING_AUDIT_KEYS);
  const bookingStatus = useBookingSetupStatus(orgId);

  const hireAudit = useSettingsAudit(HIRE_AUDIT_KEYS);
  const hireStatus = useHireOrderSetupStatus(orgId);

  const provenanceLine = (actorName: string | null, changedAt: string | null): string | null => {
    if (!actorName) return null;
    if (changedAt) return t("reference.provenance.withDate", { name: actorName, date: formatDateDMY(new Date(changedAt)) });
    return t("reference.provenance.nameOnly", { name: actorName });
  };

  const auditNote = (entries: SettingsAuditEntry[] | undefined, key: string): string | null => {
    const entry = entries?.find((e) => e.key === key) ?? null;
    return entry ? provenanceLine(entry.actorName, entry.created_at) : null;
  };

  const bookingRows: ReferenceRow[] = [];
  if (bookingOn) {
    const preset = flowQ.data ? matchPreset(flowQ.data) : null;
    const flowValue = preset
      ? preset === "custom"
        ? t("flowPresets.custom", { ns: "settingsBookingFlow" })
        : t(`flowPresets.names.${preset}`, { ns: "settingsBookingFlow" })
      : null;
    bookingRows.push({
      key: "bookingFlow",
      label: t("reference.rows.bookingFlow.label"),
      value: flowValue,
      note: provenanceLine(flowProvenance.actorName, flowProvenance.changedAt),
    });

    const timingValue = timesQ.data
      ? t("reference.rows.offerTiming.value", {
          hour: berlinTime(timesQ.data.offerDigestHour),
          hours: timesQ.data.windowHours,
        })
      : null;
    bookingRows.push({
      key: "offerTiming",
      label: t("reference.rows.offerTiming.label"),
      value: timingValue,
      note: auditNote(timingAudit.data, "offer_digest_hour_berlin") ?? auditNote(timingAudit.data, "offer_response_window_hours"),
    });

    const coverage = bookingStatus.coverage;
    let coverageValue: string | null = null;
    if (coverage) {
      const totalCities = new Set(coverage.futurePairs.filter((p) => p.cityId !== null).map((p) => p.cityId)).size;
      if (totalCities === 0) {
        coverageValue = t("reference.rows.castCoverage.allCovered");
      } else {
        const result = resolveCoverage(coverage);
        const uncoveredCities = new Set(result.uncoveredPairs.map((p) => p.cityId)).size;
        coverageValue = uncoveredCities === 0
          ? t("reference.rows.castCoverage.allCovered")
          : t("reference.rows.castCoverage.partial", { covered: totalCities - uncoveredCities, total: totalCities });
      }
    }
    bookingRows.push({
      key: "castCoverage",
      label: t("reference.rows.castCoverage.label"),
      value: coverageValue,
      note: null,
    });
  }

  const hireRows: ReferenceRow[] = [];
  if (hireOrdersOn) {
    const stepDone = (key: "letterhead" | "terms" | "countersign"): boolean | null =>
      hireStatus.status.steps.find((s) => s.key === key)?.done ?? null;
    const settingKeyFor: Record<"letterhead" | "terms" | "countersign", string> = {
      letterhead: "hire_order_letterhead",
      terms: "hire_order_terms",
      countersign: "hire_order_countersign",
    };
    (["letterhead", "terms", "countersign"] as const).forEach((key) => {
      const done = stepDone(key);
      hireRows.push({
        key,
        label: t(`reference.rows.${key}.label`),
        value: done === null ? null : done ? t("reference.setNotSet.set") : t("reference.setNotSet.notSet"),
        note: auditNote(hireAudit.data, settingKeyFor[key]),
      });
    });
  }

  const rows = [...bookingRows, ...hireRows];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">{t("reference.title")}</CardTitle>
        <CardDescription>{t("reference.intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("reference.emptyModules")}</p>
        ) : (
          <dl className="text-sm">
            {rows.map((row) => (
              <div key={row.key} className="border-t border-border py-2.5 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt className="font-medium text-foreground">{row.label}</dt>
                  <dd className="ml-auto whitespace-nowrap text-right text-muted-foreground">
                    {row.value ?? "…"}
                  </dd>
                </div>
                {row.note && <dd className="mt-0.5 text-xs leading-4 text-[var(--text-faint)]">{row.note}</dd>}
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
