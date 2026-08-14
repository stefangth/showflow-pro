import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { berlinTime, lifecycleChips, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";

interface Props {
  flow: BookingFlow;
  times: FlowTimes;
  onFlowChange: (patch: Partial<BookingFlow>) => void;
  onTimesChange: (patch: Partial<FlowTimes>) => void;
  customFields: { id: string; label: string }[];
  referencePreview: string;
  disabled?: boolean;
  allowCustomReference?: boolean;
}

function TimelineStep({
  n,
  title,
  desc,
  dim,
  chips,
  children,
  last,
}: {
  n: number;
  title: string;
  desc: string;
  dim?: boolean;
  chips?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("flex gap-3", dim && "opacity-45")}>
      <div className="flex w-7 flex-none flex-col items-center">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
            n === 0 || dim ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground",
          )}
        >
          {n}
        </span>
        {!last && <span className="w-0.5 flex-1 bg-input" />}
      </div>
      <div className="mb-2.5 flex-1 rounded-lg border border-border bg-card p-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          </div>
          {chips}
        </div>
        {children && <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">{children}</div>}
      </div>
    </div>
  );
}

export function FlowTimeline({
  flow,
  times,
  onFlowChange,
  onTimesChange,
  customFields,
  referencePreview,
  disabled = false,
  allowCustomReference = true,
}: Props) {
  const { t } = useTranslation("settingsBookingFlow");
  const respOff = !flow.artist_acceptance;
  const skippedChip = <Badge variant="neutral">{t("flowTimeline.badges.skipped")}</Badge>;

  // The stage that acceptance (or a direct booking) lands on next is always the
  // second entry of the central lifecycleChips() sequence: "Direct booking" (index
  // 0) skips straight to "Confirmed" (index 1); "Offered" (index 0) proceeds to
  // either "Soft booked" or "Confirmed" (index 1) depending on producer_confirmation.
  // Deriving from the same helper the rail uses keeps this badge from drifting out
  // of sync with FlowRail's "Resulting lifecycle" chips.
  // Off state returns a single "Off" chip, so there is no index-1 stage; fall back to it
  // (the whole timeline is disabled in the off state, so this badge is just greyed context).
  const nextStageChip = lifecycleChips(flow)[1] ?? lifecycleChips(flow)[0];
  const nextStageBadgeVariant = nextStageChip.tone === "amber" ? "hold" : "confirmed";

  return (
    <div>
      <TimelineStep
        n={0}
        title={t("flowTimeline.steps.dateCreated.title")}
        desc={t("flowTimeline.steps.dateCreated.desc")}
        chips={<Badge variant="neutral">{t("flowTimeline.badges.alwaysOn")}</Badge>}
      />

      <TimelineStep
        n={1}
        title={t("flowTimeline.steps.openOfferTier.title")}
        desc={t("flowTimeline.steps.openOfferTier.desc")}
        dim={respOff}
        chips={
          <>
            <Badge variant="accent">{t("flowTimeline.badges.offered")}</Badge>
            {respOff && skippedChip}
          </>
        }
      >
        <div className="space-y-1">
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.auto_open_tier1}
            disabled={disabled || respOff}
            aria-label={t("flowTimeline.steps.openOfferTier.autoOpenAria")}
            onCheckedChange={(v) => onFlowChange({ auto_open_tier1: v })}
          />
          {t("flowTimeline.steps.openOfferTier.autoOpenLabel")}
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.auto_escalate}
            disabled={disabled || respOff}
            aria-label={t("flowTimeline.steps.openOfferTier.autoEscalateAria")}
            onCheckedChange={(v) => onFlowChange({ auto_escalate: v })}
          />
          {t("flowTimeline.steps.openOfferTier.autoEscalateLabel")}
        </label>
          <label className="flex items-center gap-2.5 text-sm">
            <Switch
              checked={flow.at_risk_alerts}
              disabled={disabled || respOff}
              aria-label={t("flowTimeline.steps.openOfferTier.atRiskAria")}
              onCheckedChange={(v) => onFlowChange({ at_risk_alerts: v })}
            />
            {t("flowTimeline.steps.openOfferTier.atRiskLabel")}
          </label>
          <p className="pl-11 text-xs text-muted-foreground">
            {t("flowTimeline.steps.openOfferTier.atRiskHelper")}
          </p>
        </div>
      </TimelineStep>

      <TimelineStep
        n={2}
        title={t("flowTimeline.steps.notifyArtists.title")}
        desc={t("flowTimeline.steps.notifyArtists.desc")}
        dim={respOff}
        chips={respOff ? skippedChip : undefined}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label={t("flowTimeline.steps.notifyArtists.deliveryGroupAria")}>
            {(["digest", "immediate"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={flow.offer_delivery === mode}
                disabled={disabled || respOff}
                onClick={() => onFlowChange({ offer_delivery: mode })}
                className={cn(
                  "rounded px-3 py-1.5 text-xs font-medium",
                  flow.offer_delivery === mode ? "bg-card shadow-sm" : "text-muted-foreground",
                )}
              >
                {mode === "digest"
                  ? t("flowTimeline.steps.notifyArtists.dailyDigest", { hour: berlinTime(times.offerDigestHour) })
                  : t("flowTimeline.steps.notifyArtists.immediate")}
              </button>
            ))}
          </div>
          <label
            className={cn(
              "flex items-center gap-2 text-xs text-muted-foreground",
              flow.offer_delivery !== "digest" && "opacity-40",
            )}
          >
            {t("flowTimeline.steps.notifyArtists.digestHourLabel")}
            <Input
              type="number"
              min={0}
              max={23}
              value={times.offerDigestHour}
              disabled={disabled || respOff || flow.offer_delivery !== "digest"}
              className="w-16 font-mono"
              onChange={(e) => onTimesChange({ offerDigestHour: Number(e.target.value) })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {t("flowTimeline.steps.notifyArtists.responseWindowLabel")}
            <Input
              type="number"
              min={1}
              max={336}
              value={times.windowHours}
              disabled={disabled || respOff}
              className="w-16 font-mono"
              onChange={(e) => onTimesChange({ windowHours: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.expiry_reminder}
            disabled={disabled || respOff}
            aria-label={t("flowTimeline.steps.notifyArtists.expiryReminderAria")}
            onCheckedChange={(v) => onFlowChange({ expiry_reminder: v })}
          />
          {t("flowTimeline.steps.notifyArtists.expiryReminderLabel")}
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-muted-foreground">{t("flowTimeline.steps.notifyArtists.referenceFieldLabel")}</span>
          <Select
            value={flow.reference_field.source}
            disabled={disabled || respOff}
            onValueChange={(source) =>
              onFlowChange({
                reference_field:
                  source === "custom"
                    ? { source: "custom", custom_field_id: customFields[0]?.id }
                    : { source: source as "show" | "program" },
              })
            }
          >
            <SelectTrigger className="w-52" aria-label={t("flowTimeline.steps.notifyArtists.referenceFieldAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="show">{t("flowTimeline.steps.notifyArtists.referenceFieldOptions.show")}</SelectItem>
              <SelectItem value="program">{t("flowTimeline.steps.notifyArtists.referenceFieldOptions.program")}</SelectItem>
              {allowCustomReference && (
                <SelectItem value="custom" disabled={customFields.length === 0}>
                  {t("flowTimeline.steps.notifyArtists.referenceFieldOptions.custom")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {flow.reference_field.source === "custom" && (
            <Select
              value={flow.reference_field.custom_field_id}
              disabled={disabled || respOff}
              onValueChange={(id) => onFlowChange({ reference_field: { source: "custom", custom_field_id: id } })}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {customFields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
            {referencePreview}
          </span>
        </div>
      </TimelineStep>

      <TimelineStep
        n={3}
        title={t("flowTimeline.steps.artistAcceptance.title")}
        desc={t("flowTimeline.steps.artistAcceptance.desc")}
        chips={
          <>
            <Badge variant={nextStageBadgeVariant}>{nextStageChip.label}</Badge>
            <Switch
              checked={flow.artist_acceptance}
              disabled={disabled}
              aria-label={t("flowTimeline.steps.artistAcceptance.aria")}
              onCheckedChange={(v) => onFlowChange({ artist_acceptance: v })}
            />
          </>
        }
      >
        {respOff && (
          <p className="rounded-md bg-[var(--amber-100)] px-2.5 py-1.5 text-xs text-[var(--amber-600)]">
            {t("flowTimeline.steps.artistAcceptance.offNotice")}
          </p>
        )}
      </TimelineStep>

      <TimelineStep
        n={4}
        title={t("flowTimeline.steps.producerConfirmation.title")}
        desc={t("flowTimeline.steps.producerConfirmation.desc")}
        chips={
          <>
            <Badge variant="confirmed">{t("flowTimeline.badges.confirmed")}</Badge>
            {respOff && <Badge variant="neutral">{t("flowTimeline.badges.lockedOn")}</Badge>}
            <Switch
              checked={respOff || flow.producer_confirmation}
              disabled={disabled || respOff}
              aria-label={t("flowTimeline.steps.producerConfirmation.aria")}
              onCheckedChange={(v) => onFlowChange({ producer_confirmation: v })}
            />
          </>
        }
      >
        {respOff && (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            {t("flowTimeline.steps.producerConfirmation.offNotice")}
          </p>
        )}
      </TimelineStep>

      <TimelineStep
        n={5}
        title={t("flowTimeline.steps.confirmationDigest.title")}
        desc={t("flowTimeline.steps.confirmationDigest.desc")}
        chips={
          <>
            <label
              className={cn(
                "flex items-center gap-2 text-xs text-muted-foreground",
                !flow.confirmation_digest && "opacity-40",
              )}
            >
              {t("flowTimeline.steps.confirmationDigest.hourLabel")}
              <Input
                type="number"
                min={0}
                max={23}
                value={times.confirmationDigestHour}
                disabled={disabled || !flow.confirmation_digest}
                className="w-16 font-mono"
                onChange={(e) => onTimesChange({ confirmationDigestHour: Number(e.target.value) })}
              />
            </label>
            <Switch
              checked={flow.confirmation_digest}
              disabled={disabled}
              aria-label={t("flowTimeline.steps.confirmationDigest.aria")}
              onCheckedChange={(v) => onFlowChange({ confirmation_digest: v })}
            />
          </>
        }
      />

      <TimelineStep
        n={6}
        last
        title={t("flowTimeline.steps.understudyPromotion.title")}
        desc={t("flowTimeline.steps.understudyPromotion.desc")}
        chips={
          <Switch
            checked={flow.understudy_promotion}
            disabled={disabled}
            aria-label={t("flowTimeline.steps.understudyPromotion.aria")}
            onCheckedChange={(v) => onFlowChange({ understudy_promotion: v })}
          />
        }
      />
    </div>
  );
}
