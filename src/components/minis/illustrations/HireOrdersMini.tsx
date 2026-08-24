import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniCheck, MiniButton } from '../atoms';
import { Token } from '@/components/ui/token';
import { Metric } from '@/components/ui/metric';

/**
 * The four Hire orders-mini illustrations, in step order:
 *   Draft from booking · Issue and send · Countersign · Set it up once
 * Token-only likenesses of the real Hire orders surfaces. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const hireOrdersArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Draft from booking — the auto-drafted order snapshot
  <MiniCard key="h1">
    <div className="flex items-center justify-between gap-2">
      <Token className="text-eyebrow font-semibold">SF-2026-0724-1</Token>
      <Badge variant="neutral">Draft</Badge>
    </div>
    <MiniField label="Artist">Theo Brandt</MiniField>
    <MiniField label="Fee">
      <Metric>€480.00</Metric> <Badge variant="neutral">Manual</Badge>
    </MiniField>
    <MiniField label="Duration">90 min <Badge variant="neutral">Default</Badge></MiniField>
  </MiniCard>,

  // 02 Issue and send — the PDF goes out for countersign
  <MiniCard key="h2">
    <MiniRow avatar={<MiniAvatar initials="TB" tone="bg-accent-700" />} name="Theo Brandt" sub="theo.brandt@posteo.de" />
    <MiniField label="PDF">
      <Token className="text-eyebrow">SF-2026-0724-1.pdf</Token>
    </MiniField>
    <MiniField label="Status">
      <Badge variant="hold">Awaiting countersign</Badge>
    </MiniField>
  </MiniCard>,

  // 03 Countersign — the per-order timeline of who signed when
  <MiniCard key="h3">
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Drafted</div>
        <Metric className="block text-eyebrow text-muted-foreground/70">22/07 · 09:14</Metric>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Issued</div>
        <Metric className="block text-eyebrow text-muted-foreground/70">22/07 · 11:02</Metric>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-caption text-foreground">Opened by artist</div>
        <Metric className="block text-eyebrow text-muted-foreground/70">22/07 · 18:47</Metric>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <span className="mt-1 inline-block h-[18px] w-[18px] rounded-full border-[0.5px] border-border bg-well-tint" />
      <div>
        <div className="text-caption text-muted-foreground">Countersigned</div>
        <div className="text-eyebrow text-muted-foreground/70">waiting</div>
      </div>
    </div>
  </MiniCard>,

  // 04 Set it up once — letterhead / terms / countersign readiness
  <MiniCard key="h4">
    <MiniField label="Letterhead">
      <MiniCheck /> Set
    </MiniField>
    <MiniField label="Terms">
      <Badge variant="risk" dot>Empty</Badge>
    </MiniField>
    <MiniField label="Countersign">Manual</MiniField>
    <MiniButton>Open setup checklist</MiniButton>
  </MiniCard>,
];
