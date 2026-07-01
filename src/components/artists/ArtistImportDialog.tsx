import { useMemo, useState } from 'react';
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

const FIELDS: { key: keyof FieldMapping; label: string; required?: boolean }[] = [
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'bio', label: 'Bio' },
];

const STEPS: { key: Step; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'map', label: 'Map columns' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

export function ArtistImportDialog({ open, onOpenChange, orgId, existingEmails, canInvite = true }: ArtistImportDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

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
    if (sheet.headers.length === 0) { toast({ title: 'No columns found', description: 'The sheet has no header row.', variant: 'destructive' }); return; }
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
      toast({ title: 'Could not read the file', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function onFetchLink() {
    if (!linkUrl.trim()) return;
    setFetching(true);
    try {
      const csv = await fetchPublicSheetCsv(supabase, linkUrl.trim(), orgId);
      ingest(await parseSheet(csv, 'csv'));
    } catch (e) {
      toast({ title: 'Could not fetch the sheet', description: (e as Error).message, variant: 'destructive' });
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
    onError: (e: any) => toast({ title: 'Import failed', description: e.message, variant: 'destructive' }),
  });

  const selectedNewCount = importRows.filter((r) => r.status === 'new' && selected.has(r.index)).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Import artists from a sheet</DialogTitle>
          <DialogDescription>Upload a CSV/XLSX or paste a public Google Sheets link, map the columns, then review and import.</DialogDescription>
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
                <span className={state === 'current' ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
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
              <span className="text-sm">Drop a .csv or .xlsx here, or click to browse</span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                aria-label="Upload spreadsheet"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>

            <div className="flex items-center gap-2">
              <Input
                placeholder="…or paste a public Google Sheets link"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={onFetchLink} disabled={fetching || !linkUrl.trim()}>
                {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Fetch'}
              </Button>
            </div>

            <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Download className="h-3 w-3" /> Download a template CSV
            </button>
            <p className="text-xs text-muted-foreground">Up to {MAX_IMPORT_ROWS.toLocaleString()} rows. In Google Sheets: File → Download → CSV.</p>
          </div>
        )}

        {step === 'map' && parsed && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Matched your columns automatically. Adjust any below.</p>
            <div className="space-y-3">
              {FIELDS.map((f) => {
                const col = mapping[f.key];
                const samples = col ? parsed.rows.slice(0, 3).map((r) => r[col]).filter(Boolean).join(', ') : '';
                return (
                  <div key={f.key} className="grid grid-cols-[6rem_1fr_1fr] items-center gap-3">
                    <span className="text-sm">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
                    <Select
                      value={col ?? IGNORE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === IGNORE ? undefined : v }))}
                    >
                      <SelectTrigger aria-label={`${f.label} column`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={IGNORE}>Ignore this column</SelectItem>
                        {parsed.headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground truncate">{samples || '—'}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('source')}>Back</Button>
              <Button type="button" onClick={enterReview} disabled={!mapping.name}>Continue</Button>
            </div>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">To import</p><p className="text-2xl font-semibold">{counts.new}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Duplicate</p><p className="text-2xl font-semibold text-muted-foreground">{counts.skipped}</p></div>
              <div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Need attention</p><p className="text-2xl font-semibold text-destructive">{counts.error}</p></div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'new', 'skipped', 'error'] as RowFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs ${filter === f ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground'}`}
                >
                  {f === 'all' ? 'All' : f === 'new' ? 'New' : f === 'skipped' ? 'Skipped' : 'Errors'} {counts[f]}
                </button>
              ))}
              <div className="ml-auto relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search rows" className="h-8 w-40 pl-7 text-xs" />
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="w-36">Status</TableHead>
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
                          aria-label={`Select ${r.values.name || 'row ' + r.index}`}
                        />
                      </TableCell>
                      <TableCell className="truncate">{r.values.name || '—'}</TableCell>
                      <TableCell className="truncate">{r.values.email ?? '(no email)'}</TableCell>
                      <TableCell>
                        {r.status === 'new' && <Badge variant="secondary" className="bg-success/10 text-success">New</Badge>}
                        {r.status === 'skipped_existing' && <span className="text-xs">Duplicate — skip</span>}
                        {r.status === 'error' && <Badge variant="secondary" className="bg-destructive/10 text-destructive">{r.error}</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {visibleRows.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground py-6">No rows</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {canInvite && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={alsoInvite} onCheckedChange={(v) => setAlsoInvite(!!v)} />
                Also send login invites to imported artists (only rows with an email)
              </label>
            )}

            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setStep('map')}>Back</Button>
              <Button type="button" onClick={() => commit.mutate()} disabled={selectedNewCount === 0 || commit.isPending}>
                {commit.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Import {selectedNewCount} {selectedNewCount === 1 ? 'artist' : 'artists'}
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
              <p className="text-lg font-medium">Imported {summary.created} {summary.created === 1 ? 'artist' : 'artists'}</p>
              <p className="text-sm text-muted-foreground">
                {summary.skipped} skipped{summary.errors ? `, ${summary.errors} need attention` : ''}
                {summary.invited ? ` · ${summary.invited} invited` : ''}
              </p>
              {summary.inviteFailed > 0 && (
                <p className="text-sm text-warning">
                  {summary.inviteFailed} couldn't be invited — retry from each artist.
                </p>
              )}
            </div>
            <div className="flex justify-center gap-2">
              <Button type="button" onClick={() => close(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
