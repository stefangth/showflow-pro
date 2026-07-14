import { useEffect, useMemo, useState } from "react";
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
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { openOfferTier, fetchOpenedTiers } from "@/data/bookings";
import { fetchShowDatesForShow } from "@/data/showDates";
import { isSyncedDate, findDuplicateDate } from "@/lib/catalog";
import { shouldAutoOpenTier1 } from "@/lib/bookings";
import { showSlots } from "@/lib/settings";
import { showLabel } from "@/types";
import { toDateKey, parseDateOnly, formatDateDMY } from "@/lib/dates";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  const { currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const { data: shows } = useShows();
  const { data: cities } = useCities();
  const { data: flow } = useBookingFlow();
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

  // Default the "open offers" checkbox from the org's booking flow. Kept in its own effect
  // (deps: open, flow) so it stays reactive when the flow query resolves after the dialog
  // opens, without a flow refetch resetting the user's typed form fields above.
  useEffect(() => {
    if (open) setOpenOffers((flow?.auto_open_tier1 ?? true) && (flow?.artist_acceptance ?? true));
  }, [open, flow]);

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
        toast.success("Date updated");
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
              if (res.offersCreated > 0) toast.success(`Tier 1 opened automatically · ${res.offersCreated} offers sent`);
            }
          } catch (e) {
            toast.error((e as Error).message);
          }
        }
      } else {
        if (!currentOrg) { toast.error("No active organization"); return; }
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
            toast.success(res.offersCreated > 0 ? `Date created · ${res.offersCreated} offer(s) opened` : "Date created");
          } catch { toast.success("Date created (offers could not be opened)"); }
        } else {
          toast.success("Date created");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "edit" ? "Edit date" : "New date"}
            {synced && <Badge variant="secondary" className="bg-muted text-muted-foreground">Synced from Airtable</Badge>}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Production</Label>
            <Select value={showId} onValueChange={(v) => form.setValue("showId", v, { shouldValidate: true })} disabled={mode === "edit"}>
              <SelectTrigger><SelectValue placeholder="Choose a production" /></SelectTrigger>
              <SelectContent>
                {activeShows.map((s) => <SelectItem key={s.id} value={s.id}>{showLabel(s)}</SelectItem>)}
              </SelectContent>
            </Select>
            {err.showId && <p className="text-xs text-destructive">{err.showId.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" data-testid="date-trigger" disabled={synced} className="w-full justify-start font-normal">
                  {selectedDate ? formatDateDMY(selectedDate) : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" weekStartsOn={1} selected={selectedDate}
                  onSelect={(d) => d && form.setValue("date", toDateKey(d), { shouldValidate: true })} />
              </PopoverContent>
            </Popover>
            {err.date && <p className="text-xs text-destructive">{err.date.message}</p>}
            {dupWarning && <p className="text-xs text-warning">{dupWarning}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            {(["session1", "session2", "session3"] as const).map((name, i) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={name}>Session {i + 1}</Label>
                <Input id={name} placeholder="HH:MM" disabled={synced} {...form.register(name)} />
                {err[name] && <p className="text-xs text-destructive">{err[name]?.message}</p>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="venue">Venue</Label>
              <Input id="venue" disabled={synced} {...form.register("venue")} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Select value={form.watch("cityId")} onValueChange={(v) => form.setValue("cityId", v)} disabled={synced}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {(cities ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" {...form.register("notes")} />
          </div>

          {mode === "create" && !(flow && !flow.artist_acceptance) && (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox id="open-offers" checked={openOffers} disabled={!slotsConfigured} onCheckedChange={(c) => setOpenOffers(!!c)} />
              <Label htmlFor="open-offers" className={`font-normal ${slotsConfigured ? "" : "text-muted-foreground"}`}>
                Open tier-1 offers now{!slotsConfigured && " (configure slots first)"}
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save date" : "Create date"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
