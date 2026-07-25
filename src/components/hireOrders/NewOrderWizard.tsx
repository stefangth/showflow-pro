import { useEffect, useMemo, useRef, useState } from "react";
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
import { computeFeeTotal, type FeeBasis } from "@/lib/hireOrders/feeBasis";
import type { SessionOverride } from "@/lib/hireOrders/engagementDates";
import { copyDurationToAll } from "@/lib/hireOrders/durationFill";
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

/** A single linked date's editable running order in step 3, seeded from that
 *  date's own synced sessions/duration and diffed against them on submit. */
interface DateSchedule { sessions: SessionRow[]; durationMin: string }

/** Seed a date's step-3 running order from its synced sessions/duration. An
 *  empty synced session list still shows one blank row to type into.
 *  Lossless round-trip invariant: `session_1/2/3` are always plain "HH:MM"
 *  (enforced by `ShowDateFormDialog`'s zod schema and `airtable-poll`'s
 *  `parseTime`, both of which only ever produce/accept a bare time string,
 *  never a labelled one), so seeding the whole synced string into `time` with
 *  an empty `label` is always faithful, and `sessionRowsToStrings` folding it
 *  back with no label prefix reproduces the original string exactly when the
 *  row is left unedited. */
function seedDateSchedule(date: ShowDateLite | undefined): DateSchedule {
  return {
    sessions:
      date && date.sessions.length > 0
        ? date.sessions.map((time) => ({ label: "", time }))
        : [{ label: "", time: "" }],
    durationMin: date?.duration_minutes != null ? String(date.duration_minutes) : "",
  };
}

/** Fold session rows into the wire strings the edge function expects: a labelled
 *  row becomes "Label time", an unlabelled one just the time; blank times drop. */
function sessionRowsToStrings(rows: SessionRow[]): string[] {
  return rows
    .filter((s) => s.time.trim() !== "")
    .map((s) => (s.label.trim() ? `${s.label.trim()} ${s.time.trim()}` : s.time.trim()));
}

/** A duration input's string to the wire number|null (blank clears it). */
function parseDurationValue(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/** Kept in sync with the CURRENCIES list in OrderDefaultsCard.tsx / CURRENCY_SYMBOLS in money.ts. */
const CURRENCIES = ["EUR", "USD", "CHF"];

interface OrderDefaultsLite { default_fee: number | null; currency: string; default_fee_basis: FeeBasis }
const DEFAULTS_FALLBACK: OrderDefaultsLite = { default_fee: null, currency: "EUR", default_fee_basis: "per_date" };

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
      if (defaultsQuery.data.default_fee_basis) setFeeBasis(defaultsQuery.data.default_fee_basis);
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
  const [feeBasis, setFeeBasis] = useState<FeeBasis>("per_date");
  const [currency, setCurrency] = useState("EUR");
  const [durationMin, setDurationMin] = useState("");
  const [manualSessions, setManualSessions] = useState<SessionRow[]>([{ label: "", time: "" }]);
  // Linked mode: one editable running order per assigned date, keyed by show_date_id.
  const [dateSchedules, setDateSchedules] = useState<Record<string, DateSchedule>>({});
  const [submitting, setSubmitting] = useState<"draft" | "issue" | null>(null);
  const [result, setResult] = useState<WizardResult | null>(null);

  function resetForm() {
    setStep(1); setManualMode(false); setSelectedArtistIds([]); setSelectedShowDateIds([]); setArtistDateIds({});
    setManualArtistName(""); setManualEmail(""); setManualDate(""); setManualVenue(""); setManualCity("");
    setFee(""); setFeeBasis("per_date"); setDurationMin(""); setManualSessions([{ label: "", time: "" }]);
    setDateSchedules({});
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
      const nextArtistDateIds = { ...artistDateIds };
      delete nextArtistDateIds[id];
      setSelectedArtistIds((ids) => ids.filter((artistId) => artistId !== id));
      setArtistDateIds(nextArtistDateIds);
      return;
    }
    setSelectedArtistIds((ids) => [...ids, id]);
    // Seed a newly selected artist with every date already picked above, so the
    // common case (everyone plays every selected date) needs no grid work.
    // This reads selectedShowDateIds (a sibling state, not artistDateIds's own
    // prior value) because a brand-new artist needs a full snapshot of what is
    // currently selected, not an incremental append - unlike toggleShowDate's
    // append-only case below, there is no way to derive that snapshot from
    // artistDateIds's own updater alone. Safe because this handler never
    // mutates selectedShowDateIds itself, so repeated calls in one batch (e.g.
    // a future "select all artists" action) all read the same correct value;
    // the same closure-read-of-a-sibling-state pattern is already used,
    // unchanged, by toggleArtistDate below.
    setArtistDateIds((current) => ({
      ...current,
      [id]: current[id] ?? [...selectedShowDateIds],
    }));
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
    // Assign the new date to every selected artist by default. Each artist's
    // list is always kept as an order-preserving subsequence of
    // selectedShowDateIds (see the deselect branch above, toggleArtistDate,
    // and applySelectedDatesToAll), and selectedShowDateIds only ever grows by
    // appending the new id at the end, so appending it here too keeps that
    // invariant. Both setters are now fully functional and read only their
    // own prior state plus the constant `id` - no dependency on the other's
    // just-computed value, so a bulk caller invoking this repeatedly in one
    // batch can never drop an update (setters must stay pure and cannot call
    // each other, so precomputing a shared "next" value up front is not an
    // option here).
    setArtistDateIds((current) =>
      Object.fromEntries(
        Object.entries(current).map(([artistId, ids]) => [artistId, [...ids, id]]),
      ),
    );
  }

  function applySelectedDatesToAll() {
    setArtistDateIds(
      Object.fromEntries(
        selectedArtistIds.map((artistId) => [artistId, [...selectedShowDateIds]]),
      ),
    );
  }

  function toggleArtistDate(artistId: string, showDateId: string) {
    const assigned = new Set(artistDateIds[artistId] ?? []);
    if (assigned.has(showDateId)) assigned.delete(showDateId);
    else assigned.add(showDateId);
    setArtistDateIds((current) => ({
      ...current,
      [artistId]: selectedShowDateIds.filter((id) => assigned.has(id)),
    }));
  }

  // The dates that will actually produce orders: the union of every selected
  // artist's assignments, ordered by the common-date picker for stable display.
  const assignedDateIds = useMemo(() => {
    const assigned = new Set<string>();
    for (const artistId of selectedArtistIds) {
      for (const dateId of artistDateIds[artistId] ?? []) assigned.add(dateId);
    }
    return selectedShowDateIds.filter((id) => assigned.has(id));
  }, [selectedArtistIds, selectedShowDateIds, artistDateIds]);

  // Keep the per-date running orders in step with the assigned set: seed a newly
  // assigned date from its synced sessions/duration, drop one no longer assigned,
  // and preserve edits for a date that stays assigned. Compares keys (not values)
  // so it never fights a producer's in-progress edits or loops.
  useEffect(() => {
    setDateSchedules((current) => {
      const desired = new Set(assignedDateIds);
      const needsAdd = assignedDateIds.some((id) => !(id in current));
      const needsDrop = Object.keys(current).some((id) => !desired.has(id));
      if (!needsAdd && !needsDrop) return current;
      const next: Record<string, DateSchedule> = {};
      for (const id of assignedDateIds) {
        next[id] = current[id] ?? seedDateSchedule(showDates.find((d) => d.id === id));
      }
      return next;
    });
  }, [assignedDateIds, showDates]);

  const canContinueStep1 = manualMode
    ? manualArtistName.trim() !== ""
    : selectedArtistIds.length > 0 &&
      selectedArtistIds.every((artistId) => (artistDateIds[artistId]?.length ?? 0) > 0);
  const canContinueStep2 = fee.trim() !== "" && !Number.isNaN(Number(fee));
  const canContinue = step === 1 ? canContinueStep1 : step === 2 ? canContinueStep2 : true;

  // Manual mode's single running order (linked mode edits per-date state instead).
  function addSessionRow() {
    setManualSessions((rows) => (rows.length >= 3 ? rows : [...rows, { label: "", time: "" }]));
  }
  function removeSessionRow(i: number) {
    setManualSessions((rows) => rows.filter((_, idx) => idx !== i));
  }
  function updateSessionRow(i: number, patch: Partial<SessionRow>) {
    setManualSessions((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  // Linked mode's per-date running orders. Each helper no-ops if the date is not
  // (yet) in state, so a stale callback can never resurrect a dropped date.
  function patchDateSchedule(dateId: string, update: (schedule: DateSchedule) => DateSchedule) {
    setDateSchedules((current) =>
      current[dateId] ? { ...current, [dateId]: update(current[dateId]) } : current,
    );
  }
  function addDateSessionRow(dateId: string) {
    patchDateSchedule(dateId, (s) =>
      s.sessions.length >= 3 ? s : { ...s, sessions: [...s.sessions, { label: "", time: "" }] },
    );
  }
  function removeDateSessionRow(dateId: string, i: number) {
    patchDateSchedule(dateId, (s) => ({ ...s, sessions: s.sessions.filter((_, idx) => idx !== i) }));
  }
  function updateDateSessionRow(dateId: string, i: number, patch: Partial<SessionRow>) {
    patchDateSchedule(dateId, (s) => ({
      ...s,
      sessions: s.sessions.map((r, idx) => (idx === i ? { ...r, ...patch } : r)),
    }));
  }
  function setDateDuration(dateId: string, value: string) {
    patchDateSchedule(dateId, (s) => ({ ...s, durationMin: value }));
  }

  function buildManualDict(): Partial<Record<EditableOrderFieldKey, unknown>> {
    const manual: Partial<Record<EditableOrderFieldKey, unknown>> = {};
    if (fee.trim() !== "" && !Number.isNaN(Number(fee))) manual.fee = Number(fee);
    if (currency) manual.currency = currency;
    // In linked mode the running order is per-date (date_overrides), so sessions
    // and duration_min stay OUT of the shared manual dict; only manual mode's
    // single editor still folds them in here.
    if (manualMode) {
      if (manualArtistName.trim()) manual.artist_name = manualArtistName.trim();
      if (manualEmail.trim()) manual.recipient_email = manualEmail.trim();
      if (manualDate.trim()) manual.date = manualDate.trim();
      if (manualVenue.trim()) manual.venue = manualVenue.trim();
      if (manualCity.trim()) manual.city = manualCity.trim();
      if (durationMin.trim() !== "" && !Number.isNaN(Number(durationMin))) manual.duration_min = Number(durationMin);
      const sessions = sessionRowsToStrings(manualSessions);
      if (sessions.length > 0) manual.sessions = sessions;
    }
    return manual;
  }

  // Diff each assigned date's edited running order against its synced baseline,
  // emitting an override ONLY for dates that changed and, within a date, ONLY the
  // field that changed (an empty sessions array is an explicit clear). Untouched
  // dates resolve from sync server-side, so they never appear here.
  function buildDateOverrides(): Record<string, SessionOverride> {
    const overrides: Record<string, SessionOverride> = {};
    for (const dateId of assignedDateIds) {
      const schedule = dateSchedules[dateId];
      if (!schedule) continue;
      const synced = showDates.find((d) => d.id === dateId);
      const baselineSessions = synced?.sessions ?? [];
      const baselineDuration = synced?.duration_minutes ?? null;
      const editedSessions = sessionRowsToStrings(schedule.sessions);
      const editedDuration = parseDurationValue(schedule.durationMin);
      const sessionsChanged =
        editedSessions.length !== baselineSessions.length ||
        editedSessions.some((s, i) => s !== baselineSessions[i]);
      const durationChanged = editedDuration !== baselineDuration;
      if (!sessionsChanged && !durationChanged) continue;
      const override: SessionOverride = {};
      if (sessionsChanged) override.sessions = editedSessions;
      if (durationChanged) override.duration_min = editedDuration;
      overrides[dateId] = override;
    }
    return overrides;
  }

  // Client-side preview of what the fee resolves to server-side, so the step-4
  // summary matches what actually gets stored. Manual mode also previews its
  // artist/date fields from the manual dict; linked mode reads its running order
  // straight from the per-date state below, so only fee/currency matter here.
  const previewShowflow: Partial<Record<EditableOrderFieldKey, unknown>> = {};
  const previewDefaults: Partial<Record<EditableOrderFieldKey, unknown>> = {
    currency: defaultsQuery.data?.currency ?? "EUR",
  };
  if (defaultsQuery.data?.default_fee != null) previewDefaults.fee = defaultsQuery.data.default_fee;
  const manualDict = buildManualDict();
  const previewLayers: FieldLayers = { showflow: previewShowflow, manual: manualDict, defaults: previewDefaults };
  const reviewData = resolveFields(previewLayers);

  // Per-artist date counts drive the fee summary: with a per-date basis each
  // artist's total is their own count x the unit price, so unequal counts have no
  // single total to show.
  const feeAmountNum = fee.trim() !== "" && !Number.isNaN(Number(fee)) ? Number(fee) : null;
  const artistDateCounts = manualMode
    ? [1]
    : selectedArtistIds.map((id) => (artistDateIds[id] ?? []).length).filter((n) => n > 0);
  const minDateCount = artistDateCounts.length > 0 ? Math.min(...artistDateCounts) : 1;
  const maxDateCount = artistDateCounts.length > 0 ? Math.max(...artistDateCounts) : 1;

  function feeSummaryText(): string {
    if (feeAmountNum === null) return "Not set";
    const unit = formatMoney(feeAmountNum, currency);
    if (feeBasis === "total") return `${unit} total for all dates`;
    if (maxDateCount === 1 && minDateCount === 1) return `${unit} per date`;
    if (minDateCount === maxDateCount) {
      const total = formatMoney(computeFeeTotal(feeAmountNum, maxDateCount, "per_date"), currency);
      return `${unit} per date x ${maxDateCount} dates = ${total}`;
    }
    const low = formatMoney(computeFeeTotal(feeAmountNum, minDateCount, "per_date"), currency);
    const high = formatMoney(computeFeeTotal(feeAmountNum, maxDateCount, "per_date"), currency);
    return `${unit} per date. Totals range from ${low} to ${high} by artist.`;
  }

  // Step 4's per-artist equivalent of feeSummaryText(): when artists have
  // unequal date counts there is no single aggregate total (feeSummaryText
  // shows a range for that), but each artist's OWN total is always exact, so
  // step 4 shows it directly rather than making the producer re-derive it from
  // the range. Same wording as feeSummaryText's equal-count branch, computed
  // via computeFeeTotal (never inline multiplication).
  function artistFeeLine(dateCount: number): string {
    if (feeAmountNum === null) return "Not set";
    const unit = formatMoney(feeAmountNum, currency);
    if (feeBasis === "total") return `${unit} total for all dates`;
    if (dateCount <= 1) return `${unit} per date`;
    const total = formatMoney(computeFeeTotal(feeAmountNum, dateCount, "per_date"), currency);
    return `${unit} per date x ${dateCount} dates = ${total}`;
  }

  function draftBody() {
    if (!manualMode) {
      const dateOverrides = buildDateOverrides();
      return {
        action: "draft-batch" as const,
        org_id: orgId,
        artists: selectedArtistIds.map((artist_id) => ({
          artist_id,
          show_date_ids: artistDateIds[artist_id] ?? [],
        })),
        manual: buildManualDict(),
        fee_basis: feeBasis,
        // Only sent when the producer edited at least one date's running order.
        ...(Object.keys(dateOverrides).length > 0 ? { date_overrides: dateOverrides } : {}),
      };
    }
    return {
      action: "draft-manual" as const,
      org_id: orgId,
      manual: buildManualDict(),
      fee_basis: feeBasis,
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
      // the success screen after the issue attempt either way, so a network
      // hiccup doesn't strand the user on step 4 with no way back to the order
      // they just created (they can retry via "Issue now" on the success screen).
      try {
        const issueRes = (await action.mutateAsync({
          action: "issue",
          org_id: orgId,
          order_ids: nextResult.created,
        })) as { issued?: string[] };
        setResult({
          ...nextResult,
          issued: nextResult.created.filter((id) => (issueRes.issued ?? []).includes(id)),
        });
      } catch {
        // useHireOrderAction already toasts the issue failure; the draft itself
        // still succeeded, so the success screen stays up with "Issue now".
        setResult(nextResult);
      }
    } catch {
      // useHireOrderAction already toasts the draft failure.
    } finally {
      setSubmitting(null);
    }
  }

  async function handleIssueNow() {
    if (!orgId || !result) return;
    const alreadyIssued = new Set(result.issued);
    const pendingOrderIds = result.created.filter((id) => !alreadyIssued.has(id));
    if (pendingOrderIds.length === 0) return;
    setSubmitting("issue");
    try {
      const issueRes = (await action.mutateAsync({
        action: "issue",
        org_id: orgId,
        order_ids: pendingOrderIds,
      })) as { issued?: string[] };
      const newlyIssued = new Set(issueRes.issued ?? []);
      setResult({
        ...result,
        issued: result.created.filter((id) => alreadyIssued.has(id) || newlyIssued.has(id)),
      });
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
                      Reset all to selected dates
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
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-fee">Engagement fee</Label>
                    <Input
                      id="wiz-fee" type="number" inputMode="decimal" min="0" step="0.01"
                      value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wiz-fee-basis">Fee basis</Label>
                    <Select value={feeBasis} onValueChange={(v) => setFeeBasis(v as FeeBasis)}>
                      <SelectTrigger id="wiz-fee-basis" aria-label="Fee basis"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_date">Per date</SelectItem>
                        <SelectItem value="total">Total for all dates</SelectItem>
                      </SelectContent>
                    </Select>
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
                  <p className="text-xs text-accent-700" data-testid="wiz-fee-summary">
                    {feeSummaryText()}
                  </p>
                </div>
              </div>
            )}

            {step === 3 && (
              manualMode ? (
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
              ) : (
                <div className="space-y-6">
                  <p className="text-sm text-muted-foreground">
                    Each date starts from its synced running order. Edit a date to override just that date.
                  </p>
                  {assignedDateIds.map((dateId) => {
                    const date = showDates.find((d) => d.id === dateId);
                    const schedule = dateSchedules[dateId];
                    if (!schedule) return null;
                    const label = date ? dateOptionLabel(date) : dateId;
                    return (
                      <div key={dateId} role="group" aria-label={`${label} running order`} className="space-y-4 rounded-lg border p-3">
                        <p className="font-medium text-foreground">{label}</p>
                        <div className="space-y-1.5">
                          <Label htmlFor={`wiz-duration-${dateId}`}>Duration (minutes)</Label>
                          <Input
                            id={`wiz-duration-${dateId}`} type="number" min="0"
                            value={schedule.durationMin}
                            onChange={(e) => setDateDuration(dateId, e.target.value)}
                          />
                          {/* Once this date has a valid duration and there is more than one
                              assigned date, offer to stamp it into every other date. */}
                          {assignedDateIds.length > 1 && parseDurationValue(schedule.durationMin) !== null && (
                            <Button
                              type="button" variant="link" size="sm"
                              className="h-auto p-0 text-xs"
                              aria-label={`Copy to all dates (${label})`}
                              onClick={() => {
                                setDateSchedules((current) => copyDurationToAll(current, dateId));
                                toast.success("Applied this duration to all dates");
                              }}
                            >
                              Copy to all dates
                            </Button>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>Sessions</Label>
                          <div className="space-y-2">
                            {schedule.sessions.map((row, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <Input
                                  placeholder="Label (optional)" value={row.label}
                                  onChange={(e) => updateDateSessionRow(dateId, i, { label: e.target.value })}
                                  aria-label={`${label} session ${i + 1} label`}
                                />
                                <Input
                                  type="time" value={row.time}
                                  onChange={(e) => updateDateSessionRow(dateId, i, { time: e.target.value })}
                                  aria-label={`${label} session ${i + 1} time`}
                                />
                                {schedule.sessions.length > 1 && (
                                  <Button type="button" variant="ghost" size="icon" onClick={() => removeDateSessionRow(dateId, i)} aria-label={`${label} remove session ${i + 1}`}>
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            ))}
                            {schedule.sessions.length < 3 && (
                              <Button type="button" variant="outline" size="sm" onClick={() => addDateSessionRow(dateId)}>
                                <Plus className="mr-1 h-4 w-4" /> Add session
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
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
                      <p className="text-sm text-foreground" data-testid="wiz-fee-summary">{feeSummaryText()}</p>
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
                            <p
                              className="mt-2 text-xs text-muted-foreground"
                              data-testid={`wiz-artist-fee-${artistId}`}
                            >
                              {artistFeeLine((artistDateIds[artistId] ?? []).length)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      {assignedDateIds.map((dateId) => {
                        const date = showDates.find((d) => d.id === dateId);
                        const schedule = dateSchedules[dateId];
                        if (!schedule) return null;
                        const label = date ? dateOptionLabel(date) : dateId;
                        const durationText = schedule.durationMin.trim() !== "" ? `${schedule.durationMin} min` : "Not set";
                        const sessionsText = sessionRowsToStrings(schedule.sessions).join(" · ") || "Not set";
                        return (
                          <div key={dateId} role="group" aria-label={`${label} running order`} className="rounded-lg border p-3">
                            <p className="font-medium text-foreground">{label}</p>
                            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                              <div className="space-y-0.5">
                                <p className="text-xs text-muted-foreground">Duration</p>
                                <p className="text-sm text-foreground">{durationText}</p>
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-xs text-muted-foreground">Sessions</p>
                                <p className="text-sm text-foreground">{sessionsText}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-foreground">Fee</p>
                        <p className="text-sm text-foreground" data-testid="wiz-fee-summary">{feeSummaryText()}</p>
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
