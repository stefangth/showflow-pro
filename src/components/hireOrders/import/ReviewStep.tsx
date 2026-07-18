import type { OrderFieldKey } from "@/lib/hireOrders/types";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** Raw per-row edits typed into the Review step's fee/date cells. Kept as raw
 *  strings (never re-parsed here) — they flow into `resolveFields`'s `manual`
 *  layer verbatim at submit time, same convention as every other manual field
 *  in the hire-order pure lib. */
export interface ManualEdit {
  date?: string;
  fee?: string;
}

/** A resolved import row plus the EFFECTIVE status/issues after folding in the
 *  Resolve step's local artist links (buildOrderRows has no notion of a
 *  user-picked link, so the caller overlays that before handing rows here). */
export interface ReviewRow {
  rowIndex: number;
  sheet: Partial<Record<OrderFieldKey, unknown>>;
  status: "ready" | "attention" | "skipped";
  issues: string[];
}

const ISSUE_LABELS: Record<string, string> = {
  unknown_artist: "Unknown artist",
  unparseable_date: "Unreadable date",
  missing_date: "Missing date",
  ambiguous_date: "Ambiguous date",
  venue_city_mismatch: "Venue/city mismatch",
  missing_fee: "Missing fee",
  ambiguous_fee: "Ambiguous fee",
};

function describeIssues(issues: string[]): string {
  return issues.map((i) => ISSUE_LABELS[i] ?? i).join(", ");
}

interface Props {
  rows: ReviewRow[];
  selection: Set<number>;
  onToggleRow: (rowIndex: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  manualEdits: Record<number, ManualEdit>;
  onEditFee: (rowIndex: number, value: string) => void;
  onEditDate: (rowIndex: number, value: string) => void;
}

/**
 * Review step: Ready / Needs attention / Skipped count tiles, then a per-row
 * table with a preselected-when-ready checkbox (skipped rows are never
 * selectable) and inline-editable fee/date cells. Edits are reported upward via
 * onEditFee/onEditDate — this component holds no derivation of its own, it only
 * renders whatever status/issues the caller already resolved. A header
 * checkbox mirrors "all selectable (non-skipped) rows are selected" and calls
 * onToggleAll to select/clear them all at once.
 */
export function ReviewStep({ rows, selection, onToggleRow, onToggleAll, manualEdits, onEditFee, onEditDate }: Props) {
  const readyCount = rows.filter((r) => r.status === "ready").length;
  const attentionCount = rows.filter((r) => r.status === "attention").length;
  const skippedCount = rows.filter((r) => r.status === "skipped").length;

  const selectableRows = rows.filter((r) => r.status !== "skipped");
  const selectedCount = selectableRows.filter((r) => selection.has(r.rowIndex)).length;
  const allSelected = selectableRows.length > 0 && selectedCount === selectableRows.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Ready</p>
          <p className="text-2xl font-semibold text-foreground">{readyCount}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Needs attention</p>
          <p className="text-2xl font-semibold text-foreground">{attentionCount}</p>
        </div>
        <div className="rounded-md bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">Skipped</p>
          <p className="text-2xl font-semibold text-muted-foreground">{skippedCount}</p>
        </div>
      </div>

      <div className="max-h-72 overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  disabled={selectableRows.length === 0}
                  onCheckedChange={(v) => onToggleAll(!!v)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Artist</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isSkipped = row.status === "skipped";
              const artistName = (row.sheet.artist_name as string | undefined) || `Row ${row.rowIndex}`;
              const dateValue = manualEdits[row.rowIndex]?.date ?? (row.sheet.date as string | undefined) ?? "";
              const feeValue = manualEdits[row.rowIndex]?.fee ?? (row.sheet.fee as string | undefined) ?? "";
              return (
                <TableRow key={row.rowIndex} className={isSkipped ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={!isSkipped && selection.has(row.rowIndex)}
                      disabled={isSkipped}
                      onCheckedChange={(v) => onToggleRow(row.rowIndex, !!v)}
                      aria-label={`Select ${artistName}`}
                    />
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">
                    {isSkipped ? `Row ${row.rowIndex} (blank)` : artistName}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="date"
                      value={dateValue}
                      disabled={isSkipped}
                      className="h-8 w-36"
                      aria-label={`Date for ${artistName}`}
                      onChange={(e) => onEditDate(row.rowIndex, e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={feeValue}
                      disabled={isSkipped}
                      className="h-8 w-28"
                      aria-label={`Fee for ${artistName}`}
                      onChange={(e) => onEditFee(row.rowIndex, e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    {isSkipped ? (
                      <Badge variant="neutral">Skipped</Badge>
                    ) : row.status === "ready" ? (
                      <Badge variant="accent">Ready</Badge>
                    ) : (
                      <Badge variant="hold">{describeIssues(row.issues)}</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
