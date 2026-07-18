import { useMemo } from "react";
import type { RawSheet } from "@/lib/artistImport/parseSheet";
import { applyRange, type SheetRange } from "@/lib/hireOrderImport/rangeSelection";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

/** Not a virtualized grid (per the design spec) — capped to a bounded preview so a
 *  5,000-row sheet never renders 5,000 DOM rows at once. The header-row/mode/from/
 *  to controls above still operate on the FULL sheet via applyRange (a pure
 *  function), so importing beyond this cap works correctly even though the
 *  preview itself is truncated. */
const MAX_PREVIEW_ROWS = 200;

interface Props {
  sheets: RawSheet[];
  sheetIndex: number;
  onSheetIndexChange: (index: number) => void;
  range: SheetRange;
  onRangeChange: (range: SheetRange) => void;
}

/**
 * Range step: worksheet picker (xlsx multi-sheet only), header-row selector, and
 * row scope (all / range / picked rows), with a live raw-matrix preview. ALL
 * derivation (which row is the header, which rows are in scope) goes through
 * `applyRange` — this component only renders the result and edits `range`.
 */
export function RangeStep({ sheets, sheetIndex, onSheetIndexChange, range, onRangeChange }: Props) {
  const rows = useMemo(() => sheets[sheetIndex]?.rows ?? [], [sheets, sheetIndex]);
  const { headers, dataRows } = useMemo(() => applyRange(rows, range), [rows, range]);
  const includedRowNumbers = useMemo(() => new Set(dataRows.map((d) => d.rowIndex)), [dataRows]);
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS);

  function togglePicked(rowNumber: number, checked: boolean) {
    const picked = new Set(range.picked ?? []);
    if (checked) picked.add(rowNumber);
    else picked.delete(rowNumber);
    onRangeChange({ ...range, picked: Array.from(picked).sort((a, b) => a - b) });
  }

  return (
    <div className="space-y-4">
      {sheets.length > 1 && (
        <div className="space-y-1.5">
          <Label htmlFor="import-sheet">Worksheet</Label>
          <Select value={String(sheetIndex)} onValueChange={(v) => onSheetIndexChange(Number(v))}>
            <SelectTrigger id="import-sheet"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sheets.map((s, i) => (
                <SelectItem key={s.name} value={String(i)}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="import-header-row">Header row</Label>
          <Input
            id="import-header-row"
            type="number"
            min={1}
            max={Math.max(rows.length, 1)}
            value={range.headerRow}
            onChange={(e) => onRangeChange({ ...range, headerRow: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="import-mode">Rows to import</Label>
          <Select value={range.mode} onValueChange={(v) => onRangeChange({ ...range, mode: v as SheetRange["mode"] })}>
            <SelectTrigger id="import-mode"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="range">Row range</SelectItem>
              <SelectItem value="picked">Pick rows</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {range.mode === "range" && (
          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="import-range-from">From</Label>
              <Input
                id="import-range-from"
                type="number"
                min={range.headerRow + 1}
                value={range.from ?? range.headerRow + 1}
                onChange={(e) => onRangeChange({ ...range, from: Number(e.target.value) || range.headerRow + 1 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-range-to">To</Label>
              <Input
                id="import-range-to"
                type="number"
                min={range.headerRow + 1}
                value={range.to ?? rows.length}
                onChange={(e) => onRangeChange({ ...range, to: Number(e.target.value) || rows.length })}
              />
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {headers.length} column{headers.length === 1 ? "" : "s"} · {dataRows.length} row{dataRows.length === 1 ? "" : "s"} selected
      </p>

      <div className="max-h-64 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <tbody>
            {previewRows.map((cells, i) => {
              const rowNumber = i + 1;
              const isHeader = rowNumber === range.headerRow;
              const included = includedRowNumbers.has(rowNumber);
              return (
                <tr
                  key={rowNumber}
                  className={isHeader ? "bg-accent-50 font-medium" : included ? "" : "text-muted-foreground"}
                >
                  <td className="w-16 shrink-0 border-r border-border px-2 py-1 align-middle text-muted-foreground">
                    {range.mode === "picked" && !isHeader ? (
                      <Checkbox
                        checked={(range.picked ?? []).includes(rowNumber)}
                        onCheckedChange={(v) => togglePicked(rowNumber, !!v)}
                        aria-label={`Include row ${rowNumber}`}
                      />
                    ) : (
                      rowNumber
                    )}
                  </td>
                  {cells.map((cell, ci) => (
                    <td key={ci} className="max-w-[160px] truncate border-r border-border px-2 py-1 last:border-r-0">
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
