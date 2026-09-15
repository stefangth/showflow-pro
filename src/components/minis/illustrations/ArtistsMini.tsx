import type { ReactNode } from 'react';
import type { Vocabulary } from '@/lib/orgKind';
import { Badge, MiniCard, MiniField, MiniWell, MiniRow, MiniAvatar } from '../atoms';

/**
 * The four Artists-mini illustrations, in step order:
 *   Talent record · Skills · Casts · Invite and link
 * Token-only likenesses of the real Artists tabs. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const artistsArt = (vocab: Vocabulary): readonly [ReactNode, ReactNode, ReactNode, ReactNode] => [
  // 01 A talent record — identity + booking contact
  <MiniCard key="r1">
    <MiniRow
      avatar={<MiniAvatar initials="IV" tone="bg-accent-500" />}
      name="Ines Vermeer"
      sub="ines.vermeer@posteo.de"
      trailing={<Badge variant="confirmed">Active</Badge>}
    />
    <MiniField label="Booking phone">
      <span className="tabular-nums">+49 30 1234 567</span>
    </MiniField>
  </MiniCard>,

  // 02 Skills — held skill chips + missing-required-skill guard
  <MiniCard key="r2">
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="neutral">Aerial silk</Badge>
      <Badge variant="neutral">Handstand</Badge>
      <Badge variant="neutral">Duo trapeze</Badge>
      <Badge variant="neutral">Live vocal</Badge>
    </div>
    <div className="flex items-center gap-2">
      <Badge variant="risk" dot>{`Missing a required ${vocab.skill}`}</Badge>
    </div>
    <div className="text-eyebrow text-muted-foreground">{`No offer until every required ${vocab.skill} is held`}</div>
  </MiniCard>,

  // 03 Casts — grouping into named tiers
  <MiniCard key="r3">
    <MiniWell label="Berlin Principal" trailing="Tier 1 · 12" />
    <MiniWell label="Berlin Ensemble" trailing="Tier 2 · 18" />
  </MiniCard>,

  // 04 Invite and link — pending invite that links back to this record
  <MiniCard key="r4">
    <MiniRow
      avatar={<MiniAvatar initials="NR" tone="bg-accent-700" />}
      name="Nadia Raab"
      sub="nadia@example.com"
      trailing={<Badge variant="hold">Invited</Badge>}
    />
    <div className="text-eyebrow text-muted-foreground">On accept, login links to this record</div>
  </MiniCard>,
];
