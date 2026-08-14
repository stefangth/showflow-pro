import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useShows } from "@/hooks/useShows";
import { useCities } from "@/hooks/useCities";
import { useCreateShowDate, useUpdateShowDate } from "@/hooks/useShowDates";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { useEntitlements } from "@/hooks/useEntitlements";
import { openOfferTier, fetchOpenedTiers } from "@/data/bookings";
import { fetchShowDatesForShow } from "@/data/showDates";
import { isSyncedDate, findDuplicateDate } from "@/lib/catalog";
import { shouldAutoOpenTier1 } from "@/lib/bookings";
import { showSlots } from "@/lib/settings";
import { scheduleChangeNote } from "@/lib/notifications/scheduleChangeCopy";
import { dateSourceNote } from "@/lib/bookings/actionCopy";
import { showIdentityLabel } from "@/types";
import { toDateKey, parseDateOnly, formatDateDMY } from "@/lib/dates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").optional().or(z.literal(""));
const schema = z.object({
  showId: z.string().min(1, "Production is required"),
  date: z.string().min(1, "Date is required"),
  session1: time, session2: time, session3: time,
  venue: z.string().optional().or(z.literal("")),
  cityId: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
});
type FormValues = z.infer<typeof schema>;
const orNull = (s: string | undefined) => (s && s.trim() !== "" ? s : null);

interface EditDate {
  id: string; show_id: string; date: string;
  session_1: string | null; session_2: string | null; session_3: string | null;
  venue: string | null; city_id: string | null; notes: string | null;
  airtable_record_id: string | null; status: string;
}

export function ShowDateFormDialog({
  open, onOpenChange, mode, showDate, defaultShowId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "create" | "edit";
  showDate?: EditDate | null;
  defaultShowId?: string | null;
}) {
  const { t } = useTranslation("showsDetail");
  const { t: tAction } = useTranslation("bookingCopy");
  const { currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const { data: shows } = useShows();
  const { data: cities } = useCities();
  const { data: flow } = useBookingFlow();
  const { data: flowTimes } = useFlowTimes(currentOrg?.id ?? null);
  // This note makes a factual claim about what the server-side digest pipeline will do for
  // THIS org (send-confirmation-digest only ever iterates entitled orgs, filterEntitledOrgs
  // in _shared/settings.ts), not a permission check on whether the current user may use a
  // gated surface. useModuleGate is the right hook for the latter, but its super-admin
  // exemption (matching ModuleGate/ProtectedRoute's god-mode convention) would make a
  // non-impersonating super-admin editing a date in a genuinely unentitled org see this note
  // assert a pipeline that will not actually run for that org: useModuleGate.allow is true
  // for them regardless of the org's real row. Reading useEntitlements().features directly
  // has no such exemption, so the claim always reflects the org's actual entitlement. isLoading
  // still fails closed (no note while unresolved) for the same reason useModuleGate's `pending`
  // did: a plausible but wrong claim is worse than a brief silence.
  const { features: entitledFeatures, isLoading: entitlementsLoading } = useEntitlements();
  const bookingFlowEnabled = entitledFeatures.has("booking_flow");
  const bookingFlowPending = entitlementsLoading;
  const create = useCreateShowDate();
  const update = useUpdateShowDate();
  const synced = mode === "edit" && !!showDate && isSyncedDate(showDate);
  const [openOffers, setOpenOffers] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      showId: showDate?.show_id ?? defaultShowId ?? "",
      date: showDate?.date ?? "",
      session1: showDate?.session_1?.slice(0, 5) ?? "", session2: showDate?.session_2?.slice(0, 5) ?? "", session3: showDate?.session_3?.slice(0, 5) ?? "",
      venue: showDate?.venue ?? "", cityId: showDate?.city_id ?? "", notes: showDate?.notes ?? "",
    },
  });
  useEffect(() => {
    if (open) {
      form.reset({
        showId: showDate?.show_id ?? defaultShowId ?? "", date: showDate?.date ?? "",
        session1: showDate?.session_1?.slice(0, 5) ?? "", session2: showDate?.session_2?.slice(0, 5) ?? "", session3: showDate?.session_3?.slice(0, 5) ?? "",
        venue: showDate?.venue ?? "", cityId: showDate?.city_id ?? "", notes: showDate?.notes ?? "",
      });
      setDupWarning(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showDate, defaultShowId]);

  // Creating a date is deliberately opt-in: opening Tier 1 can immediately notify artists.
  // Initialize only when the dialog opens so a later flow refetch cannot erase the user's choice.
  useEffect(() => {
    if (open && mode === "create") setOpenOffers(false);
  }, [open, mode]);

  // Edit mode keeps its existing flow-driven auto-open behavior.
  useEffect(() => {
    if (open && mode === "edit") setOpenOffers((flow?.auto_open_tier1 ?? true) && (flow?.artist_acceptance ?? true));
  }, [open, flow, mode]);

  const activeShows = useMemo(() => (shows ?? []).filter((s) => s.status !== "archived"), [shows]);
  const showId = form.watch("showId");
  const dateStr = form.watch("date");
  const chosenShow = activeShows.find((s) => s.id === showId);
  const slotsConfigured = !!(chosenShow && showSlots(chosenShow));

  useEffect(() => {
    if (mode !== "create" || !showId || !dateStr) { setDupWarning(null); return; }
    let cancelled = false;
    fetchShowDatesForShow(supabase, showId).then((rows) => {
      if (cancelled) return;
      const dup = findDuplicateDate(rows, { showId, date: dateStr });
      setDupWarning(dup ? "A non-cancelled date already exists for this production on that day." : null);
    });
    return () => { cancelled = true; };
  }, [mode, showId, dateStr]);

  const onSubmit = async (v: FormValues) => {
    try {
      if (mode === "edit" && showDate) {
        await update.mutateAsync({
          id: showDate.id,
          patch: synced
            ? { notes: orNull(v.notes) }
            : {
                date: v.date, session_1: orNull(v.session1), session_2: orNull(v.session2), session_3: orNull(v.session3),
                venue: orNull(v.venue), city_id: orNull(v.cityId), notes: orNull(v.notes),
              },
        });
        toast.success(t("showDateForm.toast.dateUpdated"));
        // A saved edit can newly satisfy the auto-open conditions (e.g. sessions just
        // filled in). Wrapped in its own try/catch so a failed auto-open never breaks
        // the save the user already succeeded at.
        if (flow) {
          try {
            const hasSession = Boolean(v.session1 || v.session2 || v.session3);
            const openedTiers = await fetchOpenedTiers(supabase, showDate.id);
            if (shouldAutoOpenTier1({ flow, hasSession, openedTiers })) {
              const res = await openOfferTier(supabase, { showDateId: showDate.id, tier: 1 });
              // Match the sheet's own open-tier mutation: bust the bookings prefix (new
              // suggested bookings) and this date's opened-tiers cache.
              queryClient.invalidateQueries({ queryKey: ["bookings"] });
              queryClient.invalidateQueries({ queryKey: ["offer-tiers", "opened", showDate.id] });
              if (res.offersCreated > 0) toast.success(t("showDateForm.toast.tier1AutoOpened", { count: res.offersCreated }));
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        }
      } else {
        if (!currentOrg) { toast.error(t("showDateForm.toast.noActiveOrg")); return; }
        const { id } = await create.mutateAsync({
          orgId: currentOrg.id, showId: v.showId, date: v.date,
          session1: orNull(v.session1), session2: orNull(v.session2), session3: orNull(v.session3),
          venue: orNull(v.venue), cityId: orNull(v.cityId), notes: orNull(v.notes),
        });
        if (openOffers && slotsConfigured) {
          try {
            const res = await openOfferTier(supabase, { showDateId: id, tier: 1 });
            // Same convention as the edit-path auto-open: bust the bookings prefix
            // and this date's opened-tiers cache so open sheets do not go stale.
            queryClient.invalidateQueries({ queryKey: ["bookings"] });
            queryClient.invalidateQueries({ queryKey: ["offer-tiers", "opened", id] });
            toast.success(res.offersCreated > 0 ? t("showDateForm.toast.dateCreatedWithOffers", { count: res.offersCreated }) : t("showDateForm.toast.dateCreated"));
          } catch { toast.success(t("showDateForm.toast.dateCreatedOffersFailed")); }
        } else {
          toast.success(t("showDateForm.toast.dateCreated"));
        }
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const pending = create.isPending || update.isPending;
  const err = form.formState.errors;
  const selectedDate = dateStr ? parseDateOnly(dateStr) : undefined;
  // Synced dates disable the session inputs below (Airtable owns them), so a note about
  // the consequence of changing one here would not be true for this dialog. Also withheld
  // until useFlowTimes actually resolves: falling back to the platform default hour while
  // it loads used to state a plausible but wrong hour for any org configured to a
  // different one. A brief silence is honest; a stale hour is not. Same reasoning for
  // bookingFlowPending: scheduleChangeNote already treats a false entitlement as "no
  // note", but gating here too keeps the condition self-documenting and symmetric with the
  // flowTimes check right next to it.
  const changeNote = mode === "edit" && !synced && flowTimes !== undefined && !bookingFlowPending
    ? scheduleChangeNote(bookingFlowEnabled, flow, flowTimes.confirmationDigestHour)
    : null;
  // A dialog gets ONE DialogDescription: Radix wires it to the dialog's aria-describedby, and
  // two would emit two ids. changeNote is edit-only and DATE_SOURCE_NOTE create-only, so at
  // most one is ever non-null today, but selecting the single description here makes that a
  // structural guarantee rather than a coincidence a later edit to changeNote's mode gate
  // could quietly break.
  const dialogDescription = mode === "create" ? dateSourceNote(tAction) : changeNote;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "edit" ? t("showDateForm.editDate") : t("showDateForm.newDate")}
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">{t("showDateForm.syncedFromAirtable")}</Badge>}
          </DialogTitle>
          {dialogDescription && <DialogDescription className="text-xs">{dialogDescription}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("showDateForm.production")}</Label>
            <Select value={showId} onValueChange={(v) => form.setValue("showId", v, { shouldValidate: true })} disabled={mode === "edit"}>
              <SelectTrigger><SelectValue placeholder={t("showDateForm.chooseProduction")} /></SelectTrigger>
              <SelectContent>
                {activeShows.map((s) => <SelectItem key={s.id} value={s.id}>{showIdentityLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            {err.showId && <p className="text-xs text-destructive">{err.showId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>{t("showDateForm.date")}</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" data-testid="date-trigger" disabled={synced} className="w-full justify-start font-normal">
                  {selectedDate ? formatDateDMY(selectedDate) : t("showDateForm.pickDate")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" weekStartsOn={1} selected={selectedDate}
                  onSelect={(d) => d && form.setValue("date", toDateKey(d), { shouldValidate: true })} />
              </PopoverContent>
            </Popover>
            {/* log_show_date_schedule_change only fires on session_1/2/3/status, never on the
                date column itself, so moving this dialog's own headline field notifies nobody.
                Tied to changeNote's own visibility so it only appears when the schedule note
                above it does (edit mode, not synced, notifications actually a live concept). */}
            {changeNote && (
              <p className="text-xs text-muted-foreground">{t("showDateForm.movingDateNote")}</p>
            )}
            {err.date && <p className="text-xs text-destructive">{err.date.message}</p>}
            {dupWarning && <p className="text-xs text-warning">{dupWarning}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(["session1", "session2", "session3"] as const).map((name, i) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name}>{t("showDateForm.session", { n: i + 1 })}</Label>
                <Input id={name} placeholder={t("showDateForm.sessionPlaceholder")} disabled={synced} {...form.register(name)} />
                {err[name] && <p className="text-xs text-destructive">{err[name]?.message}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="venue">{t("showDateForm.venue")}</Label>
              <Input id="venue" disabled={synced} {...form.register("venue")} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("showDateForm.city")}</Label>
              <Select value={form.watch("cityId")} onValueChange={(v) => form.setValue("cityId", v)} disabled={synced}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">{t("showDateForm.notes")}</Label>
            <Textarea id="notes" {...form.register("notes")} />
          </div>

          {mode === "create" && !(flow && !flow.artist_acceptance) && (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox id="open-offers" checked={openOffers} disabled={!slotsConfigured} onCheckedChange={(c) => setOpenOffers(!!c)} />
              <Label htmlFor="open-offers" className={`font-normal ${slotsConfigured ? "" : "text-muted-foreground"}`}>
                {slotsConfigured ? t("showDateForm.openTier1Now") : t("showDateForm.openTier1NowConfigure")}
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? t("showDateForm.saving") : mode === "edit" ? t("showDateForm.saveDate") : t("showDateForm.createDate")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
