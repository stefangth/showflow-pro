import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckCircle2, ChevronsUpDown, FileText, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import { useArtistsLite, useShowDatesLite, useHireOrderAction } from "@/hooks/useHireOrders";
import type { ArtistLite, ShowDateLite } from "@/data/hireOrders";
import { resolveFields } from "@/lib/hireOrders/resolveFields";
import { formatMoney } from "@/lib/hireOrders/money";
import type { EditableOrderFieldKey, FieldLayers, OrderData } from "@/lib/hireOrders/types";
import { formatDateDMY } from "@/lib/dates";
import { ROUTES } from "@/config/app.config";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string | null;
}

type WizardStep = 1 | 2 | 3 | 4;
interface SessionRow { label: string; time: string }

/** Kept in sync with the CURRENCIES list in OrderDefaultsCard.tsx / CURRENCY_SYMBOLS in money.ts. */
const CURRENCIES = ["EUR", "USD", "CHF"];

interface OrderDefaultsLite { default_fee: number | null; currency: string }
const DEFAULTS_FALLBACK: OrderDefaultsLite = { default_fee: null, currency: "EUR" };

interface BatchOutcomeRow { artist_id: string; reason: string }
interface BatchDraftResult {
  created?: string[];
  skipped?: BatchOutcomeRow[];
  errors?: BatchOutcomeRow[];
}
interface WizardResult {
  created: string[];
  issued: string[];
  skipped: BatchOutcomeRow[];
  errors: BatchOutcomeRow[];
}

const STEPS: { step: WizardStep; label: string }[] = [
  { step: 1, label: "Confirm engagement" },
  { step: 2, label: "Fees and deposit" },
  { step: 3, label: "Running order" },
  { step: 4, label: "Review and issue" },
];

const REVIEW_ROWS: { key: EditableOrderFieldKey; label: string }[] = [
  { key: "artist_name", label: "Artist" },
  { key: "recipient_email", label: "Recipient email" },
  { key: "date", label: "Date" },
  { key: "venue", label: "Venue" },
  { key: "city", label: "City" },
  { key: "duration_min", label: "Duration" },
  { key: "sessions", label: "Sessions" },
];

function dateOptionLabel(d: ShowDateLite): string {
  const parts = [formatDateDMY(d.date)];
  if (d.venue) parts.push(d.venue);
  if (d.city) parts.push(d.city);
  return parts.join(" · ");
}

function reviewValue(key: EditableOrderFieldKey, data: OrderData): string {
  const v = data[key]?.value;
  if (v === undefined || v === null || v === "") return "Not set";
  if (key === "date" && typeof v === "string") return formatDateDMY(v);
  if (key === "duration_min") return `${v} min`;
  if (key === "sessions" && Array.isArray(v)) return (v as string[]).join(" · ");
  return String(v);
}

/** Searchable multi-select shared by the artist and common-date pickers. */
function MultiPickerCombobox<T extends { id: string }>({
  items, values, onToggle, getLabel, getSearchText, placeholder, ariaLabel, emptyText, selectionNoun,
}: {
  items: T[];
  values: string[];
  onToggle: (id: string) => void;
  getLabel: (item: T) => string;
  getSearchText: (item: T) => string;
  placeholder: string;
  ariaLabel: string;
  emptyText: string;
  selectionNoun: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const matches = needle ? items.filter((i) => getSearchText(i).toLowerCase().includes(needle)) : items;
  const singleSelection = values.length === 1 ? items.find((item) => item.id === values[0]) : null;
  const selectedLabel =
    values.length === 0
      ? placeholder
      : singleSelection
        ? getLabel(singleSelection)
        : `${values.length} ${selectionNoun} selected`;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={search} onValueChange={setSearch} />
          <CommandList>
            {matches.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {matches.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    role="checkbox"
                    aria-checked={values.includes(item.id)}
                    aria-label={getLabel(item)}
                    onSelect={() => onToggle(item.id)}
                  >
                    <Checkbox
                      checked={values.includes(item.id)}
                      onCheckedChange={() => onToggle(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select ${getLabel(item)}`}
                      tabIndex={-1}
                      className="mr-2"
                    />
                    {getLabel(item)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * V5 guided wizard: Confirm engagement -> Fees and deposit -> Running order ->
 * Review and issue. Linked engagements create one aggregate order per selected
 * artist; the no-linked-date path remains a single manual order.
 *
 * Linked engagements submit through `draft-batch`; manual engagements keep
 * using `draft-manual`. Both can stop at draft or immediately issue every order
 * that was created successfully.
 */
export function NewOrderWizard({ open, onOpenChange, orgId }: Props) {
  const navigate = useNavigate();
  const { data: artists = [] } = useArtistsLite(orgId);
  const { data: showDates = [] } = useShowDatesLite(orgId);
  const action = useHireOrderAction();

  const defaultsQuery = useQuery({
    queryKey: ["app-settings", "hire_order_defaults", orgId],
    queryFn: () => resolveOrgSetting<OrderDefaultsLite>(supabase, orgId, "hire_order_defaults", DEFAULTS_FALLBACK),
    enabled: !!orgId,
  });
  const seededDefaultsRef = useRef(false);
  useEffect(() => {
    if (defaultsQuery.data && !seededDefaultsRef.current) {
      seededDefaultsRef.current = true;
      setCurrency(defaultsQuery.data.currency);
      if (defaultsQuery.data.default_fee != null) setFee(String(defaultsQuery.data.default_fee));
    }
  }, [defaultsQuery.data]);

  const [step, setStep] = useState<WizardStep>(1);
  const [manualMode, setManualMode] = useState(false);
  const [selectedArtistIds, setSelectedArtistIds] = useState<string[]>([]);
  const [selectedShowDateIds, setSelectedShowDateIds] = useState<string[]>([]);
  const [artistDateIds, setArtistDateIds] = useState<Record<string, string[]>>({});
  const [manualArtistName, setManualArtistName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualVenue, setManualVenue] = useState("");
  const [manualCity, setManualCity] = useState("");
  const [fee, setFee] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [durationMin, setDurationMin] = useState("");
  const [manualSessions, setManualSessions] = useState<SessionRow[]>([{ label: "", time: "" }]);
  const [submitting, setSubmitting] = useState<"draft" | "issue" | null>(null);
  const [result, setResult] = useState<WizardResult | null>(null);

  function resetForm() {
    setStep(1); setManualMode(false); setSelectedArtistIds([]); setSelectedShowDateIds([]); setArtistDateIds({});
    setManualArtistName(""); setManualEmail(""); setManualDate(""); setManualVenue(""); setManualCity("");
    setFee(""); setDurationMin(""); setManualSessions([{ label: "", time: "" }]);
    setSubmitting(null); setResult(null);
    seededDefaultsRef.current = false; setCurrency("EUR");
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function switchMode(next: boolean) {
    setManualMode(next);
    if (next) {
      setSelectedArtistIds([]);
      setSelectedShowDateIds([]);
      setArtistDateIds({});
    }
  }

  function toggleArtist(id: string) {
    if (selectedArtistIds.includes(id)) {
      setSelectedArtistIds((ids) => ids.filter((artistId) => artistId !== id));
      setArtistDateIds((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setSelectedArtistIds((ids) => [...ids, id]);
    setArtistDateIds((current) => ({ ...current, [id]: current[id] ?? [] }));
  }

  function toggleShowDate(id: string) {
    if (selectedShowDateIds.includes(id)) {
      setSelectedShowDateIds((ids) => ids.filter((showDateId) => showDateId !== id));
      setArtistDateIds((current) =>
        Object.fromEntries(
          Object.entries(current).map(([artistId, ids]) => [
            artistId,
            ids.filter((showDateId) => showDateId !== id),
          ]),
        ),
      );
      return;
    }
    setSelectedShowDateIds((ids) => [...ids, id]);
  }

  function applySelectedDatesToAll() {
    setArtistDateIds(
      Object.fromEntries(selectedArtistIds.map((artistId) => [artistId, [...selectedShowDateIds]])),
    );
    const firstDate = showDates.find((date) => date.id === selectedShowDateIds[0]);
    setDurationMin(firstDate?.duration_minutes != null ? String(firstDate.duration_minutes) : "");
    setManualSessions(
      firstDate && firstDate.sessions.length > 0
        ? firstDate.sessions.map((time) => ({ label: "", time }))
        : [{ label: "", time: "" }],
    );
  }

  function toggleArtistDate(artistId: string, showDateId: string) {
    setArtistDateIds((current) => {
      const assigned = new Set(current[artistId] ?? []);
      if (assigned.has(showDateId)) assigned.delete(showDateId);
      else assigned.add(showDateId);
      return {
        ...current,
        [artistId]: selectedShowDateIds.filter((id) => assigned.has(id)),
      };
    });
  }

  const linkedArtist = !manualMode ? artists.find((a) => a.id === selectedArtistIds[0]) ?? null : null;
  const linkedDate = !manualMode ? showDates.find((d) => d.id === selectedShowDateIds[0]) ?? null : null;

  const canContinueStep1 = manualMode
    ? manualArtistName.trim() !== ""
    : selectedArtistIds.length > 0 &&
      selectedArtistIds.every((artistId) => (artistDateIds[artistId]?.length ?? 0) > 0);
  const canContinueStep2 = fee.trim() !== "" && !Number.isNaN(Number(fee));
  const canContinue = step === 1 ? canContinueStep1 : step === 2 ? canContinueStep2 : true;

  function addSessionRow() {
    setManualSessions((rows) => (rows.length >= 3 ? rows : [...rows, { label: "", time: "" }]));
  }
  function removeSessionRow(i: number) {
    setManualSessions((rows) => rows.filter((_, idx) => idx !== i));
  }
  function updateSessionRow(i: number, patch: Partial<SessionRow>) {
    setManualSessions((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function buildManualDict(): Partial<Record<EditableOrderFieldKey, unknown>> {
    const manual: Partial<Record<EditableOrderFieldKey, unknown>> = {};
    if (manualMode) {
      if (manualArtistName.trim()) manual.artist_name = manualArtistName.trim();
      if (manualEmail.trim()) manual.recipient_email = manualEmail.trim();
      if (manualDate.trim()) manual.date = manualDate.trim();
      if (manualVenue.trim()) manual.venue = manualVenue.trim();
      if (manualCity.trim()) manual.city = manualCity.trim();
    }
    if (fee.trim() !== "" && !Number.isNaN(Number(fee))) manual.fee = Number(fee);
    if (currency) manual.currency = currency;
    if (durationMin.trim() !== "" && !Number.isNaN(Number(durationMin))) manual.duration_min = Number(durationMin);
    const sessions = manualSessions
      .filter((s) => s.time.trim() !== "")
      .map((s) => (s.label.trim() ? `${s.label.trim()} ${s.time.trim()}` : s.time.trim()));
    if (sessions.length > 0) manual.sessions = sessions;
    return manual;
  }

  // Client-side preview of what draft-manual will resolve server-side, so the
  // step-4 summary matches what actually gets stored. `role` is intentionally
  // absent here (fetchArtistsLite doesn't carry cast_role) — the server-side
  // showflow layer can still resolve it from the artists table directly.
  const previewShowflow: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  if (linkedArtist) {
    previewShowflow.artist_name = linkedArtist.name;
    if (linkedArtist.email) previewShowflow.recipient_email = linkedArtist.email;
  }
  if (linkedDate) {
    previewShowflow.date = linkedDate.date;
    if (linkedDate.venue) previewShowflow.venue = linkedDate.venue;
    if (linkedDate.city) previewShowflow.city = linkedDate.city;
    if (linkedDate.duration_minutes != null) previewShowflow.duration_min = linkedDate.duration_minutes;
    if (linkedDate.sessions.length > 0) previewShowflow.sessions = linkedDate.sessions;
  }
  const previewDefaults: Partial<Record<EditableOrderFieldKey, unknown>> = {
    currency: defaultsQuery.data?.currency ?? "EUR",
  };
  if (defaultsQuery.data?.default_fee != null) previewDefaults.fee = defaultsQuery.data.default_fee;
  const manualDict = buildManualDict();
  const previewLayers: FieldLayers = { showflow: previewShowflow, manual: manualDict, defaults: previewDefaults };
  const reviewData = resolveFields(previewLayers);
  const feeDisplay =
    reviewData.fee?.value != null && reviewData.fee.value !== ""
      ? formatMoney(reviewData.fee.value as string | number, (reviewData.currency?.value as string) || currency)
      : "Not set";

  function draftBody() {
    if (!manualMode) {
      return {
        action: "draft-batch" as const,
        org_id: orgId,
        artists: selectedArtistIds.map((artist_id) => ({
          artist_id,
          show_date_ids: artistDateIds[artist_id] ?? [],
        })),
        manual: buildManualDict(),
      };
    }
    return {
      action: "draft-manual" as const,
      org_id: orgId,
      manual: buildManualDict(),
    };
  }

  function resultFromDraft(response: BatchDraftResult): WizardResult | null {
    const created = response.created ?? [];
    if (created.length === 0) {
      toast.error("Could not create any hire orders");
      return null;
    }
    return {
      created,
      issued: [],
      skipped: response.skipped ?? [],
      errors: response.errors ?? [],
    };
  }

  async function handleSaveDraft() {
    if (!orgId) return;
    setSubmitting("draft");
    try {
      const nextResult = resultFromDraft((await action.mutateAsync(draftBody())) as BatchDraftResult);
      if (nextResult) setResult(nextResult);
    } catch {
      // useHireOrderAction already toasts the failure.
    } finally {
      setSubmitting(null);
    }
  }

  async function handleIssueAndSend() {
    if (!orgId) return;
    setSubmitting("issue");
    try {
      const nextResult = resultFromDraft((await action.mutateAsync(draftBody())) as BatchDraftResult);
      if (!nextResult) return;
      // The draft now exists regardless of whether issuing below succeeds — show
      // the success screen either way, so a network hiccup on the issue call
      // doesn't strand the user on step 4 with no way back to the order they
      // just created (they can retry via "Issue now" on the success screen).
      setResult(nextResult);
      try {
        const issueRes = (await action.mutateAsync({
          action: "issue",
          org_id: orgId,
          order_ids: nextResult.created,
        })) as { issued?: string[] };
        setResult({ ...nextResult, issued: issueRes.issued ?? [] });
      } catch {
        // useHireOrderAction already toasts the issue failure; the draft itself
        // still succeeded, so the success screen stays up with "Issue now".
      }
    } catch {
      // useHireOrderAction already toasts the draft failure.
    } finally {
      setSubmitting(null);
    }
  }

  async function handleIssueNow() {
    if (!orgId || !result) return;
    setSubmitting("issue");
    try {
      const issueRes = (await action.mutateAsync({
        action: "issue",
        org_id: orgId,
        order_ids: result.created,
      })) as { issued?: string[] };
      setResult({ ...result, issued: issueRes.issued ?? [] });
    } catch {
      // useHireOrderAction already toasts the failure.
    } finally {
      setSubmitting(null);
    }
  }

  function handleOpenOrder() {
    if (!result || result.created.length !== 1) return;
    const id = result.created[0];
    handleOpenChange(false);
    navigate(ROUTES.HIRE_ORDER_DETAIL.replace(":id", id));
  }

  function handleCloseResult() {
    handleOpenChange(false);
    navigate(ROUTES.HIRE_ORDERS);
  }

  const allCreatedOrdersIssued =
    !!result && result.created.every((id) => result.issued.includes(id));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display">New hire order</DialogTitle>
          <DialogDescription>Confirm the engagement, set the fee, and issue a hire order.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 py-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-50">
              <CheckCircle2 className="h-6 w-6 text-accent-700" />
            </div>
            <p className="text-lg font-medium">
              {result.created.length} hire order{result.created.length === 1 ? "" : "s"} created
            </p>
            {(result.skipped.length > 0 || result.errors.length > 0) && (
              <div className="space-y-1 text-sm text-muted-foreground">
                {result.skipped.length > 0 && (
                  <p>{result.skipped.length} artist{result.skipped.length === 1 ? "" : "s"} skipped</p>
                )}
                {result.errors.length > 0 && (
                  <p>{result.errors.length} artist{result.errors.length === 1 ? "" : "s"} failed</p>
                )}
              </div>
            )}
            <div className="flex justify-center gap-2">
              {result.created.length === 1 ? (
                <Button type="button" variant="outline" onClick={handleOpenOrder}>Open order</Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Close and return to hire orders"
                  onClick={handleCloseResult}
                >
                  Close
                </Button>
              )}
              {!allCreatedOrdersIssued && (
                <Button type="button" onClick={handleIssueNow} disabled={submitting !== null}>Issue now</Button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* Stepper: numbered dots + accent connectors */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {STEPS.map((s, i) => {
                const state = s.step < step ? "done" : s.step === step ? "current" : "todo";
                return (
                  <div
                    key={s.step}
                    className="flex items-center gap-2"
                    aria-current={state === "current" ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full",
                        state === "todo" ? "border border-border text-muted-foreground" : "bg-accent-500 text-primary-foreground",
                      )}
                    >
                      {state === "done" ? <Check className="h-3 w-3" /> : s.step}
                    </span>
                    <span className={state === "current" ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {s.label}
                    </span>
                    {i < STEPS.length - 1 && (
                      <span className={cn("h-px w-6", s.step < step ? "bg-accent-500" : "bg-border")} />
                    )}
                  </div>
                );
              })}
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2" role="group" aria-label="Engagement source">
                  <Button type="button" size="sm" variant={!manualMode ? "default" : "outline"} onClick={() => switchMode(false)}>
                    Link a show date
                  </Button>
                  <Button type="button" size="sm" variant={manualMode ? "default" : "outline"} onClick={() => switchMode(true)}>
                    No linked date
                  </Button>
                </div>

                {!manualMode ? (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Artists</Label>
                      <MultiPickerCombobox
                        items={artists}
                        values={selectedArtistIds}
                        onToggle={toggleArtist}
                        getLabel={(a: ArtistLite) => a.name}
                        getSearchText={(a: ArtistLite) => a.name}
                        placeholder="Choose artists"
                        ariaLabel="Select artist"
                        emptyText="No artists found."
                        selectionNoun="artists"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Common show dates</Label>
                      <MultiPickerCombobox
                        items={showDates}
                        values={selectedShowDateIds}
                        onToggle={toggleShowDate}
                        getLabel={dateOptionLabel}
                        getSearchText={dateOptionLabel}
                        placeholder="Choose dates"
                        ariaLabel="Select show date"
                        emptyText="No show dates found."
                        selectionNoun="dates"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={applySelectedDatesToAll}
                      disabled={selectedArtistIds.length === 0 || selectedShowDateIds.length === 0}
                    >
                      Apply selected dates to all
                    </Button>
                    {selectedArtistIds.length > 0 && selectedShowDateIds.length > 0 && (
                      <div className="overflow-x-auto rounded-lg border">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-muted/50 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 font-medium">Artist</th>
                              {selectedShowDateIds.map((showDateId) => {
                                const date = showDates.find((item) => item.id === showDateId);
                                return (
                                  <th key={showDateId} className="min-w-32 px-3 py-2 font-medium">
                                    {date ? dateOptionLabel(date) : showDateId}
                                  </th>
                                );
                              })}
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {selectedArtistIds.map((artistId) => {
                              const artist = artists.find((item) => item.id === artistId);
                              return (
                                <tr key={artistId}>
                                  <th className="px-3 py-2 font-medium">{artist?.name ?? artistId}</th>
                                  {selectedShowDateIds.map((showDateId) => {
                                    const date = showDates.find((item) => item.id === showDateId);
                                    const dateLabel = date ? dateOptionLabel(date) : showDateId;
                                    return (
                                      <td key={showDateId} className="px-3 py-2">
                                        <Checkbox
                                          checked={(artistDateIds[artistId] ?? []).includes(showDateId)}
                                          onCheckedChange={() => toggleArtistDate(artistId, showDateId)}
                                          aria-label={`${artist?.name ?? artistId} ${dateLabel}`}
                                        />
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="wiz-artist-name">Artist name</Label>
                      <Input id="wiz-artist-name" value={manualArtistName} onChange={(e) => setManualArtistName(e.target.value)} placeholder="Full name" />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="wiz-recipient-email">Recipient email</Label>
                      <Input id="wiz-recipient-email" type="email" value={manualEmail} onChange={(e) => setManualEmail(e.target.value)} placeholder="artist@example.com" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wiz-date">Date</Label>
                      <Input id="wiz-date" type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wiz-venue">Venue</Label>
                      <Input id="wiz-venue" value={manualVenue} onChange={(e) => setManualVenue(e.target.value)} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="wiz-city">City</Label>
                      <Input id="wiz-city" value={manualCity} onChange={(e) => setManualCity(e.target.value)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-fee">Engagement fee</Label>
                    <Input
                      id="wiz-fee" type="number" inputMode="decimal" min="0" step="0.01"
                      value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-currency">Currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger id="wiz-currency"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg border border-accent-200 bg-accent-50 p-3">
                  <p className="text-xs text-accent-700">
                    Payable on performance date: {fee.trim() !== "" && !Number.isNaN(Number(fee)) ? formatMoney(Number(fee), currency) : "Not set"}
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-duration">Duration (minutes)</Label>
                  <Input id="wiz-duration" type="number" min="0" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Sessions</Label>
                  <div className="space-y-2">
                    {manualSessions.map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          placeholder="Label (optional)" value={row.label}
                          onChange={(e) => updateSessionRow(i, { label: e.target.value })}
                          aria-label={`Session ${i + 1} label`}
                        />
                        <Input
                          type="time" value={row.time}
                          onChange={(e) => updateSessionRow(i, { time: e.target.value })}
                          aria-label={`Session ${i + 1} time`}
                        />
                        {manualSessions.length > 1 && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeSessionRow(i)} aria-label={`Remove session ${i + 1}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {manualSessions.length < 3 && (
                      <Button type="button" variant="outline" size="sm" onClick={addSessionRow}>
                        <Plus className="mr-1 h-4 w-4" /> Add session
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                {manualMode ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {REVIEW_ROWS.map((r) => (
                      <div key={r.key} className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">{r.label}</p>
                        <p className="text-sm text-foreground">{reviewValue(r.key, reviewData)}</p>
                      </div>
                    ))}
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground">Fee</p>
                      <p className="text-sm text-foreground">{feeDisplay}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {selectedArtistIds.map((artistId) => {
                        const artist = artists.find((item) => item.id === artistId);
                        const assignedDates = (artistDateIds[artistId] ?? [])
                          .map((showDateId) => showDates.find((item) => item.id === showDateId))
                          .filter((date): date is ShowDateLite => !!date);
                        const artistName = artist?.name ?? artistId;
                        return (
                          <div
                            key={artistId}
                            role="group"
                            aria-label={`${artistName} dates`}
                            className="rounded-lg border p-3"
                          >
                            <p className="font-medium text-foreground">{artistName}</p>
                            <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                              {assignedDates.map((date) => (
                                <li key={date.id}>{dateOptionLabel(date)}</li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      {(["duration_min", "sessions"] as EditableOrderFieldKey[]).map((key) => (
                        <div key={key} className="space-y-0.5">
                          <p className="text-xs text-muted-foreground">
                            {key === "duration_min" ? "Duration" : "Sessions"}
                          </p>
                          <p className="text-sm text-foreground">{reviewValue(key, reviewData)}</p>
                        </div>
                      ))}
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Fee</p>
                        <p className="text-sm text-foreground">{feeDisplay}</p>
                      </div>
                    </div>
                  </>
                )}
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-border p-4 text-muted-foreground">
                  <FileText className="h-8 w-8 shrink-0" />
                  <p className="text-xs">Document preview available once the order is created.</p>
                </div>
              </div>
            )}

            {step < 4 ? (
              <div className="flex justify-between pt-2">
                <Button type="button" variant="ghost" onClick={() => setStep((s) => (s - 1) as WizardStep)} disabled={step === 1}>
                  Back
                </Button>
                <Button type="button" onClick={() => setStep((s) => (s + 1) as WizardStep)} disabled={!canContinue}>
                  Continue
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setStep(3)} disabled={submitting !== null}>
                  Back
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={handleSaveDraft} disabled={submitting !== null}>
                    Save as draft
                  </Button>
                  <Button type="button" onClick={handleIssueAndSend} disabled={submitting !== null}>
                    Issue and send to artist
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
