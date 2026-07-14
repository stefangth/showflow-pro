import type { UpNextItem } from "@/lib/bookingCockpit";

const DOT: Record<UpNextItem["tone"], string> = {
  violet: "bg-primary",
  amber: "bg-[var(--amber-500)]",
  neutral: "bg-muted-foreground",
};

export function UpNextStrip({ items }: { items: UpNextItem[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Up next</span>
      {items.map((i) => (
        <span key={i.text} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[i.tone]}`} />
          {i.text}
        </span>
      ))}
    </div>
  );
}
