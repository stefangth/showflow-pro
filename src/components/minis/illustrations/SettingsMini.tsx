import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniWell, MiniCheck, MiniTimelineRow } from '../atoms';

/**
 * The four Settings-mini illustrations, in step order:
 *   Booking engine · Casts and cities · Hire orders · Audit trail
 * Token-only likenesses of the real Settings tabs. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const settingsArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Booking engine — the digest hours + response window
  <MiniCard key="s1">
    <MiniField label="Response window">48 h</MiniField>
    <MiniField label="Offer digest">
      <span className="font-mono tabular-nums">19:00</span> Berlin
    </MiniField>
    <MiniField label="Confirmation">
      <span className="font-mono tabular-nums">20:00</span> Berlin
    </MiniField>
  </MiniCard>,

  // 02 Casts and cities — the per-city priority ladder
  <MiniCard key="s2">
    <MiniWell label="Tier 1 · Berlin Principal" trailing="01" />
    <MiniWell label="Tier 2 · Berlin Ensemble" trailing="02" />
    <MiniWell label="Tier 3 · Leipzig Pool" trailing="03" />
  </MiniCard>,

  // 03 Hire orders — letterhead / terms / countersign readiness
  <MiniCard key="s3">
    <MiniField label="Letterhead">
      <MiniCheck /> Set
    </MiniField>
    <MiniField label="Terms">
      <Badge variant="risk" dot>Empty · blocks issue</Badge>
    </MiniField>
    <MiniField label="Countersign">Manual</MiniField>
  </MiniCard>,

  // 04 Audit trail — who changed what, when
  <MiniCard key="s4">
    <MiniTimelineRow initials="SP" name="Sam Producer" detail="changed response window 24 h → 48 h" time="Today · 09:14" tone="bg-accent-500" />
    <MiniTimelineRow initials="AD" name="Ada Iversen" detail="turned auto-escalate on" time="Mon · 16:02" tone="bg-accent-700" last />
  </MiniCard>,
];
