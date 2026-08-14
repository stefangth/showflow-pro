import {
  berlinTime,
  BOOKING_FLOW_PRESETS,
  BOOKING_FLOW_TEMPLATE_DEFAULTS,
  type BookingFlowTemplates,
  type BookingTemplateDefinition,
  type PresetName,
} from "@/lib/bookingFlow";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRESET_META: Record<PresetName, { name: string; dotClass: string }> = {
  classic: { name: "Classic", dotClass: "bg-primary" },
  fasttrack: { name: "Fast-track", dotClass: "bg-[var(--green-500)]" },
  direct: { name: "Direct book", dotClass: "bg-[var(--amber-500)]" },
  off: { name: "Off", dotClass: "bg-muted-foreground" },
};

function describeTemplate({ flow, times }: BookingTemplateDefinition): string {
  if (!flow.active) {
    return "Booking flow paused. No new offers, reminders, digests or confirmations are sent.";
  }
  if (!flow.artist_acceptance) {
    return "Artists are booked directly; no offer response is required.";
  }
  const opening = flow.auto_open_tier1 ? "Tier 1 opens automatically" : "Tiers open manually";
  const delivery = flow.offer_delivery === "immediate"
    ? "offers go out immediately"
    : `offers go out in the ${berlinTime(times.offerDigestHour)} digest`;
  const confirmation = flow.producer_confirmation
    ? "producer confirms accepted offers"
    : "artist acceptance confirms instantly";
  return `${opening}; ${delivery}; ${times.windowHours} h response window; ${confirmation}.`;
}

interface Props {
  active: PresetName;
  customized?: boolean;
  onSelect: (p: PresetName) => void;
  disabled?: boolean;
  templates?: BookingFlowTemplates;
  /** Whether to offer the "Off" tile. Settings shows it; the onboarding rail hides it,
   *  because pausing the flow is a deliberate Settings action, not a way to "get started". */
  showOff?: boolean;
}

export function FlowPresets({
  active,
  customized = false,
  onSelect,
  disabled,
  templates = BOOKING_FLOW_TEMPLATE_DEFAULTS,
  showOff = true,
}: Props) {
  const presets: PresetName[] = [
    ...(Object.keys(BOOKING_FLOW_PRESETS) as Exclude<PresetName, "off">[]),
    ...(showOff ? (["off"] as const) : []),
  ];
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2.5",
        showOff ? "md:grid-cols-4" : "md:grid-cols-3",
      )}
      role="group"
      aria-label="Flow presets"
    >
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={active === p}
          disabled={disabled}
          onClick={() => onSelect(p)}
          className={cn(
            "rounded-lg border border-border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            active === p ? "border-primary ring-1 ring-primary bg-accent" : "hover:border-input",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("h-2 w-2 rounded-full", PRESET_META[p].dotClass)} />
            {PRESET_META[p].name}
            {active === p && customized && <Badge variant="secondary">Custom</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{describeTemplate(templates[p])}</span>
        </button>
      ))}
    </div>
  );
}
