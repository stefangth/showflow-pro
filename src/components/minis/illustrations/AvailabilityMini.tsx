import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniWell, MiniCheck, MiniButton, MiniWeek } from '../atoms';

/**
 * The four Availability-mini illustrations, in step order:
 *   Eligible dates · Block a date · Answer an offer · Confirmed
 * Token-only likenesses of the real Availability page. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const availabilityArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Eligible dates — the month strip showing which dates are open to declare
  <MiniCard key="a1">
    <div className="flex items-center gap-2">
      <span className="text-caption font-semibold">July</span>
      <span className="text-eyebrow text-muted-foreground">Nachtlicht · Berlin</span>
    </div>
    <MiniWeek
      days={[
        { n: 21, tone: 'muted' },
        { n: 22, tone: 'idle' },
        { n: 23, tone: 'muted' },
        { n: 24, tone: 'muted' },
        { n: 25, tone: 'idle' },
        { n: 26, tone: 'muted' },
        { n: 27, tone: 'idle' },
      ]}
    />
  </MiniCard>,

  // 02 Block a date — marking dates unavailable
  <MiniCard key="a2">
    <MiniWeek
      days={[
        { n: 21, tone: 'muted' },
        { n: 22, tone: 'blocked' },
        { n: 23, tone: 'muted' },
        { n: 24, tone: 'muted' },
        { n: 25, tone: 'blocked' },
        { n: 26, tone: 'muted' },
        { n: 27, tone: 'muted' },
      ]}
    />
    <MiniWell label="Blocked" trailing="2 dates" />
  </MiniCard>,

  // 03 Answer an offer — session times + response deadline + accept/decline
  <MiniCard key="a3">
    <div className="flex items-center gap-2">
      <span className="text-caption font-medium">Nachtlicht · Jul 24</span>
      <Badge variant="accent" dot>Offer</Badge>
    </div>
    <MiniField label="Sessions">
      <span className="font-mono tabular-nums">S1 19:30 · S2 22:00</span>
    </MiniField>
    <MiniField label="Answer by">
      <span className="font-mono tabular-nums">25/07 · 19:00</span>
    </MiniField>
    <div className="flex gap-2">
      <MiniButton primary>Accept</MiniButton>
      <MiniButton>Decline</MiniButton>
    </div>
  </MiniCard>,

  // 04 Confirmed — accepted, producer-confirmed, chat opens
  <MiniCard key="a4">
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Accepted</div>
        <div className="font-mono text-eyebrow tabular-nums text-muted-foreground/70">22/07 · 20:11</div>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Confirmed by producer</div>
        <div className="font-mono text-eyebrow tabular-nums text-muted-foreground/70">23/07 · 09:02</div>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Chat opens</div>
        <div className="font-mono text-eyebrow tabular-nums text-muted-foreground/70">with the date</div>
      </div>
    </div>
  </MiniCard>,
];
