import { Badge } from './badge';
import { StatusDot } from './status-dot';
import { TONES, type Tone } from './tones';

/**
 * The one status pill. Domain to tone mapping lives at the call site (see
 * HireOrderStatusBadge for the pattern), but the tone to colour mapping lives
 * only in TONES, so "at risk" is the same red on every surface.
 */
export function StatusPill({ tone, dot = false, children }: { tone: Tone; dot?: boolean; children: React.ReactNode }) {
  return (
    <Badge variant="tone" className={`${TONES[tone].bg} ${TONES[tone].fg} border-transparent`}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </Badge>
  );
}
