import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, Search, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { parseSheet, MAX_IMPORT_ROWS, type ParsedSheet } from '@/lib/artistImport/parseSheet';
import { guessMapping, type FieldMapping } from '@/lib/artistImport/guessMapping';
import { buildImportRows, type ImportRow } from '@/lib/artistImport/buildImportRows';
import { bulkImportArtists, type BulkImportRowInput, type BulkImportResult } from '@/data/artistImport';
import { fetchPublicSheetCsv } from '@/data/remoteSheet';
import { inviteArtistToApp } from '@/data/invitations';

export interface ArtistImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  existingEmails: string[];
  /** Whether the "also send login invites" option is offered (Spec A). Defaults true. */
  canInvite?: boolean;
}

type Step = 'source' | 'map' | 'review' | 'done';
type RowFilter = 'all' | 'new' | 'skipped' | 'error';
const IGNORE = '__ignore__';

const FIELDS: { key: keyof FieldMapping; required?: boolean }[] = [
  { key: 'name', required: true },
  { key: 'email' },
  { key: 'phone' },
  { key: 'bio' },
];

const STEPS: { key: Step }[] = [
  { key: 'source' },
  { key: 'map' },
  { key: 'review' },
  { key: 'done' },
];

export function ArtistImportDialog({ open, onOpenChange, orgId, existingEmails, canInvite = true }: ArtistImportDialogProps) {
  const { t } = useTranslation('artists');
  const { toast } = useToast();
  const qc = useQueryClient();

  const STEP_LABELS: Record<Step, string> = {
    source: t('import.steps.source'),
    map: t('import.steps.map'),
    review: t('import.steps.review'),
    done: t('import.steps.done'),
  };
  const FIELD_LABELS: Record<keyof FieldMapping, string> = {
    name: t('import.fields.name'),
    email: t('import.fields.email'),
    phone: t('import.fields.phone'),
    bio: t('import.fields.bio'),
  };

  const [step, setStep] = useState<Step>('source');
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [linkUrl, setLinkUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [alsoInvite, setAlsoInvite] = useState(false);
  const [summary, setSummary] = useState<{ created: number; skipped: number; errors: number; invited: number; inviteFailed: number } | null>(null);

  function reset() {
    setStep('source'); setParsed(null); setMapping({}); setLinkUrl(''); setFetching(false);
    setFilter('all'); setSearchTerm(''); setSelected(new Set()); setAlsoInvite(false); setSummary(null);
  }

  function close(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function ingest(sheet: ParsedSheet) {
    if (sheet.headers.length === 0) { toast({ title: t('import.toast.noColumns'), description: t('import.toast.noColumnsDesc'), variant: 'destructive' }); return; }
    setParsed(sheet);
    setMapping(guessMapping(sheet.headers));
    setStep('map');
  }

  async function onFile(file: File) {
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const sheet = isXlsx
        ? await parseSheet(await file.arrayBuffer(), 'xlsx')
        : await parseSheet(await file.text(), 'csv');
      ingest(sheet);
    } catch (e) {
      toast({ title: t('import.toast.readError'), description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function onFetchLink() {
    if (!linkUrl.trim()) return;
    setFetching(true);
    try {
      const csv = await fetchPublicSheetCsv(supabase, linkUrl.trim(), orgId);
      ingest(await parseSheet(csv, 'csv'));
    } catch (e) {
      toast({ title: t('import.toast.fetchError'), description: (e as Error).message, variant: 'destructive' });
    } finally {
      setFetching(false);
    }
  }

  function downloadTemplate() {
    const blob = new Blob(['name,email,phone,bio\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'artists-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const importRows: ImportRow[] = useMemo(
    () => (parsed ? buildImportRows(parsed.rows, mapping, existingEmails) : []),
    [parsed, mapping, existingEmails],
  );

  const counts = useMemo(() => ({
    all: importRows.length,
    new: importRows.filter((r) => r.status === 'new').length,
    skipped: importRows.filter((r) => r.status === 'skipped_existing').length,
    error: importRows.filter((r) => r.status === 'error').length,
  }), [importRows]);

  function enterReview() {
    setSelected(new Set(importRows.filter((r) => r.status === 'new').map((r) => r.index)));
    setFilter('all'); setSearchTerm('');
    setStep('review');
  }

  const visibleRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return importRows.filter((r) => {
      if (filter === 'new' && r.status !== 'new') return false;
      if (filter === 'skipped' && r.status !== 'skipped_existing') return false;
      if (filter === 'error' && r.status !== 'error') return false;
      if (q && !r.values.name.toLowerCase().includes(q) && !(r.values.email ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [importRows, filter, searchTerm]);

  function toggleRow(index: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(index); else next.delete(index);
      return next;
    });
  }

  const commit = useMutation({
    mutationFn: async () => {
      const chosen = importRows.filter((r) => r.status === 'new' && selected.has(r.index));
      const rows: BulkImportRowInput[] = chosen.map((r) => ({
        index: r.index, name: r.values.name, email: r.values.email, phone: r.values.phone, bio: r.values.bio,
      }));
      const results: BulkImportResult[] = await bulkImportArtists(supabase, { orgId, rows });

      let invited = 0;
      let inviteFailed = 0;
      if (alsoInvite && canInvite) {
        const createdById = new Map(results.filter((x) => x.status === 'created' && x.artist_id).map((x) => [x.index, x.artist_id!]));
        const targets = chosen
          .map((r) => ({ aid: createdById.get(r.index), email: r.values.email }))
          .filter((t): t is { aid: string; email: string } => !!t.aid && !!t.email);
        // Bounded concurrency so a large import doesn't fire hundreds of edge calls at once.
        const CONCURRENCY = 6;
        for (let i = 0; i < targets.length; i += CONCURRENCY) {
          const batch = targets.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(
            batch.map((t) => inviteArtistToApp(supabase, { orgId, artistId: t.aid, email: t.email })),
          );
          settled.forEach((res, j) => {
            if (res.status === 'fulfilled') invited++;
            else { inviteFailed++; console.error('invite-on-import failed for', batch[j].email, res.reason); }
          });
        }
      }
      return { results, invited, inviteFailed };
    },
    onSuccess: ({ results, invited, inviteFailed }) => {
      qc.invalidateQueries({ queryKey: ['artists'] }); // prefix also busts ['artists','pending-invites']
      // Server result is authoritative; fold in preview-skipped/errored rows we never sent.
      const created = results.filter((r) => r.status === 'created').length;
      const skipped = counts.skipped + results.filter((r) => r.status === 'skipped_existing').length;
      const errors = counts.error + results.filter((r) => r.status === 'error').length;
      setSummary({ created, skipped, errors, invited, inviteFailed });
      setStep('done');
    },
    onError: (e: Error) => toast({ title: t('import.toast.importFailed'), description: e.message, variant: 'destructive' }),
  });

  const selectedNewCount = importRows.filter((r) => r.status === 'new' && selected.has(r.index)).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs">
          {STEPS.map((s, i) => {
            const activeIdx = STEPS.findIndex((x) => x.key === step);
            const state = i < activeIdx ? 'done' : i === activeIdx ? 'current' : 'todo';
            return (
              <div key={s.key} className="flex items-center gap-2">
                <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${state === 'current' ? 'bg-primary text-primary-foreground' : state === 'done' ? 'bg-success text-success-foreground' : 'border border-border text-muted-foreground'}`}>
                  {state === 'done' ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className={state === 'current' ? 'font-medium' : 'text-muted-foreground'}>{STEP_LABELS[s.key]}</span>
                {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
              </div>
            );
          })}
        </div>

        {step === 'source' && (
          <div className="space-y-4">
            <label
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center cursor-pointer hover:bg-muted/50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm">{t('import.source.dropzone')}</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                aria-label={t('import.source.uploadAria')}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>

            <div className="flex items-center gap-2">
              <Input
                placeholder={t('import.source.linkPlaceholder')}
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={onFetchLink} disabled={fetching || !linkUrl.trim()}>
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : t('import.source.fetch')}
              </Button>
            </div>

            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Download className="h-3 w-3" /> {t('import.source.downloadTemplate')}
            </button>
            <p className="text-xs text-muted-foreground">{t('import.source.rowLimit', { max: MAX_IMPORT_ROWS.toLocaleString() })}</p>
          </div>
        )}

        {step === 'map' && parsed && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('import.map.intro')}</p>
            <div className="space-y-3">
              {FIELDS.map((f) => {
                const col = mapping[f.key];
                const samples = col ? parsed.rows.slice(0, 3).map((r) => r[col]).filter(Boolean).join(', ') : '';
                return (
                  <div key={f.key} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3">
                    <span className="text-sm">{FIELD_LABELS[f.key]}{f.required && <span className="text-destructive"> *</span>}</span>
                    <Select
                      value={col ?? IGNORE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === IGNORE ? undefined : v }))}
                    >
                      <SelectTrigger aria-label={t('import.map.columnAria', { field: FIELD_LABELS[f.key] })}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>{t('import.map.ignore')}</SelectItem>
                        {parsed.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground truncate">{samples || '—'}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('source')}>{t('import.back')}</Button>
              <Button type="button" onClick={enterReview} disabled={!mapping.name}>{t('import.continue')}</Button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t('import.review.toImport')}</p><p className="text-2xl font-semibold">{counts.new}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t('import.review.duplicate')}</p><p className="text-2xl font-semibold text-muted-foreground">{counts.skipped}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{t('import.review.needAttention')}</p><p className="text-2xl font-semibold text-destructive">{counts.error}</p></div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'new', 'skipped', 'error'] as RowFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs ${filter === f ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
                >
                  {f === 'all' ? t('import.filter.all') : f === 'new' ? t('import.filter.new') : f === 'skipped' ? t('import.filter.skipped') : t('import.filter.errors')} {counts[f]}
                </button>
              ))}
              <div className="ml-auto relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder={t('import.review.searchPlaceholder')} className="h-8 w-40 pl-7 text-xs" />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>{t('import.review.colName')}</TableHead>
                    <TableHead>{t('import.review.colEmail')}</TableHead>
                    <TableHead className="w-36">{t('import.review.colStatus')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.index} className={r.status !== 'new' ? 'text-muted-foreground' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(r.index)}
                          disabled={r.status !== 'new'}
                          onCheckedChange={(v) => toggleRow(r.index, !!v)}
                          aria-label={t('import.review.selectAria', { label: r.values.name || t('import.review.rowLabel', { index: r.index }) })}
                        />
                      </TableCell>
                      <TableCell className="truncate">{r.values.name || '—'}</TableCell>
                      <TableCell className="truncate">{r.values.email ?? '(no email)'}</TableCell>
                      <TableCell>
                        {r.status === 'new' && <Badge variant="secondary" className="bg-success/10 text-success">{t('import.review.statusNew')}</Badge>}
                        {/* i18n: this status label is pinned by a co-located test to the em-dash form
                            ("Duplicate — skip"); copyLint forbids em dashes in the catalog, so it can't
                            be migrated without breaking one gate or the other. Left as a literal. */}
                        {r.status === 'skipped_existing' && <span className="text-xs">Duplicate — skip</span>}
                        {r.status === 'error' && <Badge variant="secondary" className="bg-destructive/10 text-destructive">{r.error}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleRows.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">{t('import.review.noRows')}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {canInvite && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={alsoInvite} onCheckedChange={(v) => setAlsoInvite(!!v)} />
                {t('import.review.alsoInvite')}
              </label>
            )}

            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('map')}>{t('import.back')}</Button>
              <Button type="button" onClick={() => commit.mutate()} disabled={selectedNewCount === 0 || commit.isPending}>
                {commit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('import.review.importBtn', { count: selectedNewCount })}
              </Button>
            </div>
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-4 text-center py-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Check className="h-6 w-6 text-success" />
            </div>
            <div>
              <p className="text-lg font-medium">{t('import.done.imported', { count: summary.created })}</p>
              <p className="text-sm text-muted-foreground">
                {t('import.done.skipped', { count: summary.skipped })}{summary.errors ? t('import.done.errorsSuffix', { count: summary.errors }) : ''}
                {summary.invited ? t('import.done.invitedSuffix', { count: summary.invited }) : ''}
              </p>
              {summary.inviteFailed > 0 && (
                <p className="text-sm text-warning">
                  {t('import.done.inviteFailed', { count: summary.inviteFailed })}
                </p>
              )}
            </div>
            <div className="flex justify-center gap-2">
              <Button type="button" onClick={() => close(false)}>{t('import.done.done')}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
