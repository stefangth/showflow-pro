import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DatePeek } from "@/lib/bookingCockpit";
import { SlotMeter } from "@/components/shows/date/SlotMeter";

const EYEBROW_TONE: Record<DatePeek["tone"], string> = {
  filled: "text-[var(--green-600)]",
  "at-risk": "text-[var(--amber-600)]",
  neutral: "text-accent-600",
};

export interface RowPeekProps {
  dateLabel: string;
  peek: DatePeek | null;
  canConfirm: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onOpen: () => void;
}

export function RowPeek({ dateLabel, peek, canConfirm, confirming, onConfirm, onOpen }: RowPeekProps) {
  return (
    <div className="w-80 p-3.5">
      <p className={cn("text-[11px] font-semibold uppercase tracking-[1.6px]", peek ? EYEBROW_TONE[peek.tone] : "text-muted-foreground")}>
        {dateLabel}{peek ? ` · ${peek.eyebrowSuffix}` : " · unconfigured"}
      </p>
      {peek ? (
        <>
          <p className="mt-1.5 text-sm font-medium">{peek.headline}</p>
          <SlotMeter className="mt-2.5" tones={peek.meter.map((s) => s.tone)} />
        </>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">Set cast slots in Settings to track fill.</p>
      )}
      <div className="mt-3.5 flex gap-2">
        {peek?.confirmable && canConfirm && (
          <Button className="h-9 flex-1 text-sm" disabled={confirming} onClick={onConfirm}>
            {confirming ? "Confirming…" : `Confirm ${peek.acceptedWaiting}`}
          </Button>
        )}
        <Button
          variant="outline"
          className="h-9 flex-1 border-[0.5px] border-[var(--line-strong)] bg-[var(--surface)] text-sm hover:bg-[var(--surface-2)]"
          onClick={onOpen}
        >
          Open date
        </Button>
      </div>
      <p className="mt-2.5 font-mono text-[11px] text-[var(--text-faint)]">Space to peek · Enter to open</p>
    </div>
  );
}
