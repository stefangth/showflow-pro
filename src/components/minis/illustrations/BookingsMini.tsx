import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniWell, MiniRow, MiniAvatar, MiniCheck, MiniMeter, MiniWeek, MiniButton } from '../atoms';

/**
 * The four Bookings-mini illustrations, in step order:
 *   Tier opens · Artist responds · You confirm · Fully filled
 * Token-only likenesses of the real Shows & Bookings flow. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const bookingsArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Tier opens — offers go out to the tier
  <MiniCard key="b1">
    <MiniWell label="Tier 1 · Berlin Principal" trailing="6 offers" />
    <MiniRow
      avatar={<MiniAvatar initials="IV" tone="bg-accent-500" />}
      name="Ines Vermeer"
      trailing={<Badge variant="hold" dot>Offer pending</Badge>}
    />
    <MiniRow
      avatar={<MiniAvatar initials="PJ" tone="bg-accent-600" />}
      name="Pavel Janák"
      trailing={<Badge variant="hold" dot>Offer pending</Badge>}
    />
  </MiniCard>,

  // 02 Artist responds — the offer window, accept or decline
  <MiniCard key="b2">
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-semibold text-foreground">July</span>
      <span className="flex-1" />
      <Badge variant="accent" dot>Offer · Jul 24</Badge>
    </div>
    <MiniWeek
      days={[
        { n: 21, tone: 'muted' },
        { n: 22, tone: 'muted' },
        { n: 23, tone: 'idle' },
        { n: 24, tone: 'offer' },
        { n: 25, tone: 'muted' },
        { n: 26, tone: 'muted' },
        { n: 27, tone: 'muted' },
      ]}
    />
    <div className="flex gap-2">
      <MiniButton primary>Accept</MiniButton>
      <MiniButton>Decline</MiniButton>
    </div>
  </MiniCard>,

  // 03 You confirm — bulk-confirm soft-booked artists
  <MiniCard key="b3">
    <MiniRow
      avatar={<MiniAvatar initials="TB" tone="bg-accent-700" />}
      name="Theo Brandt"
      sub="Accepted · Jul 24"
      trailing={<Badge variant="hold">Soft-booked</Badge>}
    />
    <MiniRow
      avatar={<MiniAvatar initials="NR" tone="bg-accent-500" />}
      name="Nadia Raab"
      sub="Accepted · Jul 24"
      trailing={<Badge variant="confirmed">Confirmed</Badge>}
    />
    <MiniButton primary>Confirm selected</MiniButton>
  </MiniCard>,

  // 04 Fully filled — slots met, hire orders drafted
  <MiniCard key="b4">
    <MiniMeter pct={100} label="4/4 main" />
    <MiniMeter pct={50} label="1/2 understudy" />
    <MiniWell icon={<MiniCheck />} label="Hire orders" trailing="4 drafted" />
  </MiniCard>,
];
