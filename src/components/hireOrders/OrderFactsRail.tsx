interface Fact {
  label: string;
  value: string;
  /** Render the value in the mono face (durations, times). */
  mono?: boolean;
}

interface Props {
  /** Formatted engagement fee (e.g. "€4,500.00"), or null when unset. */
  fee: string | null;
  /** Engagement duration (e.g. "90 min"), or null. */
  duration: string | null;
  /** Session times (e.g. "Doors 20:00 · Set 21:00 to 22:30"), or null. */
  sessions: string | null;
}

/**
 * "At a glance" facts for a hire order. v1 is FEE-ONLY: the engagement fee, the
 * duration, and (when present) the session times. No deposit or balance line —
 * that is deliberately out of scope for v1.
 */
export function OrderFactsRail({ fee, duration, sessions }: Props) {
  const facts: Fact[] = [
    { label: "Fee", value: fee ?? "Not set" },
    { label: "Duration", value: duration ?? "Not set", mono: true },
  ];
  if (sessions) facts.push({ label: "Sessions", value: sessions, mono: true });

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">At a glance</h3>
      <dl className="mt-3 space-y-3">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{f.label}</dt>
            <dd className={`text-sm text-foreground text-right ${f.mono ? "font-mono" : ""}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
