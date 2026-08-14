import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useFeature } from "@/hooks/useEntitlements";
import {
  bookingTemplateMatches,
  inferBookingTemplate,
  normalizeBookingFlowTemplates,
  normalizeBookingFlow,
  referenceLabel,
  type BookingFlow,
  type FlowTimes,
  type BookingTemplateName,
} from "@/lib/bookingFlow";
import { fetchPlatformBookingTemplates } from "@/data/platform";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { fetchCustomFieldDefs } from "@/data/customFields";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlowPresets } from "./FlowPresets";
import { FlowTimeline } from "./FlowTimeline";
import { FlowRail } from "./FlowRail";
import { BOOKING_AUDIT_KEYS } from "./auditKeys";

interface Props {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  dirtyKeys: string[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Capability floor: the org is entitled and the values render normally, but this
   *  user (a producer without `edit_booking_settings`) can't change them. */
  readOnly?: boolean;
}

export function BookingFlowTab({ get, set, dirtyKeys, saving, onSave, onDiscard, readOnly = false }: Props) {
  const { t } = useTranslation("settingsBookingFlow");
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;

  // When the org isn't entitled to the booking-flow module, the tab renders read-only.
  // The displayed flow must be the classic defaults (normalizeBookingFlow(null)), not
  // the org's stored override — that override isn't the live behavior right now, so
  // showing it would misrepresent what the standard flow actually does.
  const locked = !useFeature("booking_flow");
  const flow = normalizeBookingFlow(locked ? null : get("booking_flow"));
  // Either reason disables the flow steps/presets/rail-save; only `locked` swaps in the
  // classic-defaults display and its own alert copy.
  const stepsDisabled = locked || readOnly;
  // Presets stay clickable in the off state so the admin can turn the flow back on;
  // only the editors below (timeline + rail) disable. Skip when already stepsDisabled
  // so the off banner doesn't compete with the entitlement/capability alert.

  // SettingsPage's `get` returns '' for keys with no draft/persisted value, so a
  // bare `?? default` would leave `Number('')` === 0. Coerce explicitly instead.
  const num = (key: string, fallback: number): number => {
    const v = get(key);
    if (typeof v === "number") return v;
    if (v === undefined || v === null || v === "") return fallback;
    return Number(v);
  };
  const times: FlowTimes = {
    windowHours: num("offer_response_window_hours", BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
    offerDigestHour: num("offer_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
    confirmationDigestHour: num("confirmation_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  };

  const { data: customFieldDefs } = useQuery({
    queryKey: ["custom-fields", "show_dates", orgId],
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
    enabled: Boolean(orgId),
  });
  const {
    data: platformTemplatesRaw,
    isLoading: templatesLoading,
    isError: templatesError,
    error: templatesQueryError,
  } = useQuery({
    queryKey: ["platform", "booking-flow-templates"],
    queryFn: () => fetchPlatformBookingTemplates(supabase),
  });
  const platformTemplates = normalizeBookingFlowTemplates(platformTemplatesRaw);
  const storedTemplate = get("booking_flow_template");
  const selected = (["classic", "fasttrack", "direct", "off"].includes(String(storedTemplate))
    ? storedTemplate
    : inferBookingTemplate(flow, times, platformTemplates)) as BookingTemplateName;
  // Runtime state comes from the flow itself. Template identity only tells us which
  // platform definition this org started from and may legitimately lag after another
  // write path changes the flow (for example the onboarding rail).
  const isOff = !stepsDisabled && !flow.active;
  const audit = useSettingsAudit(BOOKING_AUDIT_KEYS);

  const customFields = (customFieldDefs ?? []).map((d) => ({ id: d.id, label: d.label }));
  const customFieldKey =
    flow.reference_field.source === "custom"
      ? (customFieldDefs ?? []).find((d) => d.id === flow.reference_field.custom_field_id)?.key ?? null
      : null;
  const referencePreview = t("bookingFlowTab.referencePreview", {
    label: referenceLabel({
      reference: flow.reference_field,
      show: { program: "Candlelight", sub_program: "Strings" },
      custom: { [customFieldKey ?? ""]: "FV-2033" },
      customFieldKey,
    }),
  });

  // Remembers the last user-chosen producer_confirmation while artist_acceptance is on.
  // normalizeBookingFlow forces producer_confirmation on whenever artist_acceptance is off
  // (security-relevant invariant: a direct booking IS the confirmation, so the field can't
  // read "not yet confirmed" in that mode); that invariant must stay in normalizeBookingFlow.
  // But the forced value shouldn't permanently clobber a fast-track org's choice: turning
  // acceptance back on restores what the user had set before it was forced.
  const lastProducerConfirmationRef = useRef(flow.producer_confirmation);

  // FlowTimeline emits single-field patches and relies on this handler normalizing
  // the merged flow (e.g. artist_acceptance off forces producer_confirmation on).
  const onFlowChange = (patch: Partial<BookingFlow>) => {
    // Track the user's producer_confirmation choice while it's a real, editable choice
    // (artist_acceptance on), i.e. before a subsequent "turn acceptance off" forces it on.
    if (flow.artist_acceptance) {
      lastProducerConfirmationRef.current =
        patch.producer_confirmation !== undefined ? patch.producer_confirmation : flow.producer_confirmation;
    }
    let merged: Partial<BookingFlow> = { ...flow, ...patch };
    if (patch.artist_acceptance === true && !flow.artist_acceptance) {
      merged = { ...merged, producer_confirmation: lastProducerConfirmationRef.current };
    }
    set("booking_flow", normalizeBookingFlow(merged));
  };
  const onTimesChange = (patch: Partial<FlowTimes>) => {
    if (patch.windowHours !== undefined) set("offer_response_window_hours", patch.windowHours);
    if (patch.offerDigestHour !== undefined) set("offer_digest_hour_berlin", patch.offerDigestHour);
    if (patch.confirmationDigestHour !== undefined) set("confirmation_digest_hour_berlin", patch.confirmationDigestHour);
  };
  const onPreset = (p: BookingTemplateName) => {
    const definition = platformTemplates[p];
    // Template selection changes automation policy and timing. The org's reference
    // field is independent content configuration and must survive the switch.
    const next = { ...definition.flow, reference_field: flow.reference_field };
    // A preset click is an explicit choice too: while it keeps acceptance on, its
    // producer_confirmation becomes the value a later acceptance off/on round trip
    // restores. Skipping this tracking left the ref stale (e.g. Fast-track's
    // auto-confirm silently reverted to requiring confirmation after Direct + undo).
    if (next.artist_acceptance) {
      lastProducerConfirmationRef.current = next.producer_confirmation;
    }
    set("booking_flow", next);
    set("booking_flow_template", p);
    onTimesChange(definition.times);
  };
  const customized = !bookingTemplateMatches(flow, times, platformTemplates[selected]);

  return (
    <div className="space-y-4">
      {locked && (
        <Alert>
          <Lock className="h-4 w-4" />
          <AlertTitle>{t("bookingFlowTab.lockedAlert.title")}</AlertTitle>
          <AlertDescription>
            {t("bookingFlowTab.lockedAlert.description")}
          </AlertDescription>
        </Alert>
      )}
      {isOff && (
        <Alert>
          <AlertTitle>{t("bookingFlowTab.offAlert.title")}</AlertTitle>
          <AlertDescription>
            {t("bookingFlowTab.offAlert.description")}
          </AlertDescription>
        </Alert>
      )}
      {templatesLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : templatesError ? (
        <Alert variant="destructive">
          <AlertTitle>{t("bookingFlowTab.templatesError.title")}</AlertTitle>
          <AlertDescription>{(templatesQueryError as Error).message}</AlertDescription>
        </Alert>
      ) : (
        <FlowPresets
          active={selected}
          customized={customized}
          onSelect={onPreset}
          disabled={stepsDisabled}
          templates={platformTemplates}
        />
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <FlowTimeline
          flow={flow}
          times={times}
          onFlowChange={onFlowChange}
          onTimesChange={onTimesChange}
          customFields={customFields}
          referencePreview={referencePreview}
          disabled={stepsDisabled || isOff}
        />
        <FlowRail
          flow={flow}
          times={times}
          dirtyCount={dirtyKeys.length}
          saving={saving}
          onSave={onSave}
          onDiscard={onDiscard}
          audit={audit.data ?? []}
          isLoading={audit.isLoading}
          isError={audit.isError}
          // NOT `|| isOff`: the off state must keep the rail's Save/Discard so an admin can
          // actually persist "Off". SettingsPage hides its page-level Save for booking-scoped
          // dirt (it assumes this rail carries it), so locking the rail here would leave no way
          // to save the choice. Only the timeline editors above disable in the off state.
          locked={stepsDisabled}
        />
      </div>
      <div className="max-w-sm space-y-2">
        <Label htmlFor="resend-from-address">{t("bookingFlowTab.fromAddress.label")}</Label>
        <Input
          id="resend-from-address"
          placeholder={BOOKING_ENGINE_DEFAULTS.resend_from_address}
          value={(get("resend_from_address") as string) ?? ""}
          disabled={readOnly}
          onChange={(e) => set("resend_from_address", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t("bookingFlowTab.fromAddress.helper")}</p>
      </div>
    </div>
  );
}
