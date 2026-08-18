import { useTranslation } from "react-i18next";
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

const PRESET_META: Record<PresetName, { dotClass: string }> = {
  classic: { dotClass: "bg-primary" },
  fasttrack: { dotClass: "bg-[var(--green-500)]" },
  direct: { dotClass: "bg-[var(--amber-500)]" },
  off: { dotClass: "bg-muted-foreground" },
};

function useDescribeTemplate() {
  const { t } = useTranslation("settingsBookingFlow");
  return ({ flow, times }: BookingTemplateDefinition): string => {
    if (!flow.active) {
      return t("flowPresets.describe.paused");
    }
    if (!flow.artist_acceptance) {
      return t("flowPresets.describe.directBooking");
    }
    const opening = flow.auto_open_tier1
      ? t("flowPresets.describe.tierAuto")
      : t("flowPresets.describe.tierManual");
    const delivery = flow.offer_delivery === "immediate"
      ? t("flowPresets.describe.deliveryImmediate")
      : t("flowPresets.describe.deliveryDigest", { hour: berlinTime(times.offerDigestHour) });
    const confirmation = flow.producer_confirmation
      ? t("flowPresets.describe.confirmProducer")
      : t("flowPresets.describe.confirmInstant");
    return t("flowPresets.describe.summary", { opening, delivery, hours: times.windowHours, confirmation });
  };
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
  const { t } = useTranslation("settingsBookingFlow");
  const describeTemplate = useDescribeTemplate();
  const presetNames: Record<PresetName, string> = {
    classic: t("flowPresets.names.classic"),
    fasttrack: t("flowPresets.names.fasttrack"),
    direct: t("flowPresets.names.direct"),
    off: t("flowPresets.names.off"),
  };
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
      aria-label={t("flowPresets.groupLabel")}
    >
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={active === p}
          disabled={disabled}
          onClick={() => onSelect(p)}
          className={cn(
            "flex flex-col rounded-lg border border-border bg-card p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            active === p ? "border-primary ring-1 ring-primary bg-accent" : "hover:border-input",
          )}
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("h-2 w-2 rounded-full", PRESET_META[p].dotClass)} />
            {presetNames[p]}
            {active === p && customized && <Badge variant="secondary">{t("flowPresets.custom")}</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{describeTemplate(templates[p])}</span>
        </button>
      ))}
    </div>
  );
}
