import { computeFunnel } from "@/lib/bookingCockpit";
import type { SlotCounts } from "@/lib/settings";

function Bar({ label, value, max, fillClass, right }: {
  label: string; value: number; max: number; fillClass: string; right: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[80px_1fr_90px] items-center gap-3">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <span className={`absolute inset-y-0 left-0 rounded-full ${fillClass}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">{right}</span>
    </div>
  );
}

export function BookingFunnel({ bookings, slots }: {
  bookings: Array<{ status: string; is_understudy: boolean }>;
  slots: SlotCounts | null;
}) {
  const f = computeFunnel(bookings);
  const totalSlots = slots ? slots.main_cast + slots.understudies : 0;
  const confirmed = f.confirmedMain + f.confirmedUnderstudy;
  const max = Math.max(f.offered, totalSlots, 1);
  return (
    <div className="space-y-2" aria-label="Booking funnel">
      <Bar label="Offered" value={f.offered} max={max} fillClass="bg-accent-200" right={`${f.offered} sent`} />
      <Bar label="Accepted" value={f.accepted} max={max} fillClass="bg-accent-400" right={`${f.accepted} of ${f.offered}`} />
      <Bar label="Confirmed" value={confirmed} max={max} fillClass="bg-[var(--green-500)]"
        right={slots ? `${confirmed} / ${totalSlots} slots` : `${confirmed}`} />
    </div>
  );
}
