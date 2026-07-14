import { BOOKING_FLOW_PRESETS, type PresetName } from "@/lib/bookingFlow";
import { cn } from "@/lib/utils";

const PRESET_META: Record<PresetName, { name: string; desc: string; dotClass: string }> = {
  classic: { name: "Classic", desc: "Offer → artist accepts → producer confirms. Today's flow.", dotClass: "bg-primary" },
  fasttrack: { name: "Fast-track", desc: "Auto-opened, immediate offers; acceptance confirms instantly.", dotClass: "bg-[var(--green-500)]" },
  direct: { name: "Direct book", desc: "No offers; producers book artists from eligibility lists.", dotClass: "bg-[var(--amber-500)]" },
};

interface Props {
  active: PresetName | "custom";
  onSelect: (p: PresetName) => void;
}

export function FlowPresets({ active, onSelect }: Props) {
  const presets = Object.keys(BOOKING_FLOW_PRESETS) as PresetName[];
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4" role="group" aria-label="Flow presets">
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={active === p}
          onClick={() => onSelect(p)}
          className={cn(
            "rounded-lg border border-border bg-card p-3 text-left transition-colors",
            active === p ? "border-primary ring-1 ring-primary bg-accent" : "hover:border-input",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("h-2 w-2 rounded-full", PRESET_META[p].dotClass)} />
            {PRESET_META[p].name}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{PRESET_META[p].desc}</span>
        </button>
      ))}
      <div
        data-state={active === "custom" ? "on" : "off"}
        className={cn(
          "rounded-lg border border-border bg-card p-3",
          active === "custom" && "border-primary ring-1 ring-primary bg-accent",
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span className="h-2 w-2 rounded-full bg-muted-foreground" />
          Custom
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">Your own combination of the steps below.</span>
      </div>
    </div>
  );
}
