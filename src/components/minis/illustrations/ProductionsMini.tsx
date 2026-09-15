import type { ReactNode } from 'react';
import type { Vocabulary } from '@/lib/orgKind';
import { Badge, MiniCard, MiniField, MiniWell, MiniRow, MiniMeter } from '../atoms';

/**
 * The four Productions-mini illustrations, in step order:
 *   A show · Its dates · Slots per show · Synced dates
 * Token-only likenesses of the real Productions catalog. Copy lives in src/lib/minis;
 * these illustrations are role-invariant; domain nouns read in the org's (English)
 * workspace-type vocabulary.
 */
export const productionsArt = (vocab: Vocabulary): readonly [ReactNode, ReactNode, ReactNode, ReactNode] => [
  // 01 A show — the program / sub-program / status
  <MiniCard key="p1">
    <MiniField label="Program">Nachtlicht</MiniField>
    <MiniField label="Sub-program">Hauptprogramm</MiniField>
    <MiniField label="Status">
      <Badge variant="confirmed">Active</Badge>
    </MiniField>
  </MiniCard>,

  // 02 Its dates — the per-date fill status
  <MiniCard key="p2">
    <MiniWell label="24/07 · Chamäleon" trailing={<Badge variant="accent">Open</Badge>} />
    <MiniWell label="25/07 · Chamäleon" trailing={<Badge variant="hold">Partially filled</Badge>} />
    <MiniWell label="26/07 · Nachtlicht" trailing={<Badge variant="confirmed">Fully filled</Badge>} />
  </MiniCard>,

  // 03 Slots per show — main cast / understudy / confirmed fill
  <MiniCard key="p3">
    <MiniField label={`Main ${vocab.cast}`}>4</MiniField>
    <MiniField label={vocab.Understudy}>2</MiniField>
    <MiniMeter pct={75} label="3/4 confirmed" />
  </MiniCard>,

  // 04 Synced dates — the Airtable poll + a synced date row
  <MiniCard key="p4">
    <MiniWell label="Airtable poll" trailing="every 5 min" />
    <MiniRow name="27/07 · Chamäleon · Berlin" trailing={<Badge variant="confirmed">Synced</Badge>} />
  </MiniCard>,
];
