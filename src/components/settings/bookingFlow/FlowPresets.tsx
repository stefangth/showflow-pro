import { BOOKING_FLOW_PRESETS, type PresetName } from "@/lib/bookingFlow";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const PRESET_META: Record<PresetName, { name: string; desc: string; dotClass: string }> = {
  classic: { name: "Classic", desc: "Offer → artist accepts → producer confirms. Today's flow.", dotClass: "bg-primary" },
  fasttrack: { name: "Fast-track", desc: "Auto-opened, immediate offers; acceptance confirms instantly.", dotClass: "bg-[var(--green-500)]" },
  direct: { name: "Direct book", desc: "No offers; producers book artists from eligibility lists.", dotClass: "bg-[var(--amber-500)]" },
  off: { name: "Off", desc: "Booking flow paused. No new offers, reminders, digests or confirmations are sent.", dotClass: "bg-muted-foreground" },
};

interface Props {
  active: PresetName;
  customized?: boolean;
  onSelect: (p: PresetName) => void;
  disabled?: boolean;
  /** Whether to offer the "Off" tile. Settings shows it; the onboarding rail hides it,
   *  because pausing the flow is a deliberate Settings action, not a way to "get started". */
  showOff?: boolean;
}

export function FlowPresets({ active, customized = false, onSelect, disabled, showOff = true }: Props) {
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
          <span className="mt-0.5 block text-xs text-muted-foreground">{PRESET_META[p].desc}</span>
        </button>
      ))}
    </div>
  );
}
