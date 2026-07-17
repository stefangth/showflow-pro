import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { hh, lifecycleChips, type BookingFlow, type FlowTimes } from "@/lib/bookingFlow";

interface Props {
  flow: BookingFlow;
  times: FlowTimes;
  onFlowChange: (patch: Partial<BookingFlow>) => void;
  onTimesChange: (patch: Partial<FlowTimes>) => void;
  customFields: { id: string; label: string }[];
  referencePreview: string;
  disabled?: boolean;
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
}: Props) {
  const respOff = !flow.artist_acceptance;
  const skippedChip = <Badge variant="neutral">Skipped</Badge>;

  // The stage that acceptance (or a direct booking) lands on next is always the
  // second entry of the central lifecycleChips() sequence: "Direct booking" (index
  // 0) skips straight to "Confirmed" (index 1); "Suggested" (index 0) proceeds to
  // either "Soft booked" or "Confirmed" (index 1) depending on producer_confirmation.
  // Deriving from the same helper the rail uses keeps this badge from drifting out
  // of sync with FlowRail's "Resulting lifecycle" chips.
  const nextStageChip = lifecycleChips(flow)[1];
  const nextStageBadgeVariant = nextStageChip.tone === "amber" ? "hold" : "confirmed";

  return (
    <div>
      <TimelineStep
        n={0}
        title="Date created"
        desc="Via Airtable sync or in-app; either way the date enters the flow here."
        chips={<Badge variant="neutral">Always on</Badge>}
      />

      <TimelineStep
        n={1}
        title="Open offer tier"
        desc="Creates suggested bookings for every eligible artist in the tier."
        dim={respOff}
        chips={
          <>
            <Badge variant="accent">Suggested</Badge>
            {respOff && skippedChip}
          </>
        }
      >
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.auto_open_tier1}
            disabled={disabled || respOff}
            aria-label="Auto-open tier 1"
            onCheckedChange={(v) => onFlowChange({ auto_open_tier1: v })}
          />
          Open tier 1 automatically when a new date is ready
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.auto_escalate}
            disabled={disabled || respOff}
            aria-label="Auto-escalate tiers"
            onCheckedChange={(v) => onFlowChange({ auto_escalate: v })}
          />
          Escalate to the next tier automatically when a window closes short
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <Switch
            checked={flow.at_risk_alerts}
            disabled={disabled || respOff}
            aria-label="At-risk alerts"
            onCheckedChange={(v) => onFlowChange({ at_risk_alerts: v })}
          />
          Alert producers when a date can no longer fill in time
        </label>
      </TimelineStep>

      <TimelineStep
        n={2}
        title="Notify artists"
        desc="How and when offers reach artists. The response window starts at delivery."
        dim={respOff}
        chips={respOff ? skippedChip : undefined}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex rounded-md bg-muted p-0.5" role="group" aria-label="Offer delivery">
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
                {mode === "digest" ? `Daily digest · ${hh(times.offerDigestHour)}` : "Immediately"}
              </button>
            ))}
          </div>
          <label
            className={cn(
              "flex items-center gap-2 text-xs text-muted-foreground",
              flow.offer_delivery !== "digest" && "opacity-40",
            )}
          >
            Digest hour (Berlin)
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
            Response window (h)
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
            aria-label="Expiry reminder"
            onCheckedChange={(v) => onFlowChange({ expiry_reminder: v })}
          />
          Remind artists 24 h before their window closes
        </label>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-muted-foreground">Reference field</span>
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
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="show">Show label (default)</SelectItem>
              <SelectItem value="program">Program only</SelectItem>
              <SelectItem value="custom" disabled={customFields.length === 0}>
                Custom field…
              </SelectItem>
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
        title="Artist acceptance"
        desc="Artists accept or decline from their calendar. Off means producers book directly, with no offers at all."
        chips={
          <>
            <Badge variant={nextStageBadgeVariant}>{nextStageChip.label}</Badge>
            <Switch
              checked={flow.artist_acceptance}
              disabled={disabled}
              aria-label="Artist acceptance"
              onCheckedChange={(v) => onFlowChange({ artist_acceptance: v })}
            />
          </>
        }
      >
        {respOff && (
          <p className="rounded-md bg-[var(--amber-100)] px-2.5 py-1.5 text-xs text-[var(--amber-600)]">
            Offers, digests, and response windows are skipped. Producers book from eligibility lists; the artist's
            first touchpoint is the confirmation.
          </p>
        )}
      </TimelineStep>

      <TimelineStep
        n={4}
        title="Producer confirmation"
        desc="Producer reviews soft-booked artists and confirms the cast. Off means an acceptance confirms immediately."
        chips={
          <>
            <Badge variant="confirmed">Confirmed</Badge>
            {respOff && <Badge variant="neutral">Locked on</Badge>}
            <Switch
              checked={respOff || flow.producer_confirmation}
              disabled={disabled || respOff}
              aria-label="Producer confirmation"
              onCheckedChange={(v) => onFlowChange({ producer_confirmation: v })}
            />
          </>
        }
      >
        {respOff && (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
            With artist acceptance off, the producer's booking is itself the confirmation, so this step can't be
            skipped.
          </p>
        )}
      </TimelineStep>

      <TimelineStep
        n={5}
        title="Confirmation digest"
        desc="Daily summary email to newly confirmed artists."
        chips={
          <>
            <label
              className={cn(
                "flex items-center gap-2 text-xs text-muted-foreground",
                !flow.confirmation_digest && "opacity-40",
              )}
            >
              Hour (Berlin)
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
              aria-label="Confirmation digest"
              onCheckedChange={(v) => onFlowChange({ confirmation_digest: v })}
            />
          </>
        }
      />

      <TimelineStep
        n={6}
        last
        title="Understudy promotion"
        desc="When a main-cast booking cancels, the longest-waiting accepted understudy is promoted automatically."
        chips={
          <Switch
            checked={flow.understudy_promotion}
            disabled={disabled}
            aria-label="Understudy promotion"
            onCheckedChange={(v) => onFlowChange({ understudy_promotion: v })}
          />
        }
      />
    </div>
  );
}
