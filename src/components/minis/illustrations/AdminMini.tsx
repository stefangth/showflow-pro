import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniCheck, MiniButton } from '../atoms';

/**
 * The four Admin-mini illustrations, in step order:
 *   Invite by email · Duplicates caught · They accept · Roles later
 * Token-only likenesses of the real Admin > People flow. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const adminArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Invite by email — the invite form
  <MiniCard key="d1">
    <MiniField label="Email">
      <span className="font-mono text-[11px]">mila.kern@example.com</span>
    </MiniField>
    <MiniField label="Role">
      <Badge variant="neutral">Producer</Badge>
    </MiniField>
    <MiniButton primary>Send invite</MiniButton>
  </MiniCard>,

  // 02 Duplicates caught — live duplicate detection
  <MiniCard key="d2">
    <MiniRow
      avatar={<MiniAvatar initials="MK" tone="bg-accent-600" />}
      name="Mila Kern"
      sub="already a member"
      trailing={<Badge variant="risk" dot>Duplicate</Badge>}
    />
  </MiniCard>,

  // 03 They accept — the invite-to-membership timeline
  <MiniCard key="d3">
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-[12px] text-foreground">Invite sent</div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground/70">22/07 · 09:14</div>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-[12px] text-foreground">Link opened</div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground/70">22/07 · 10:03</div>
      </div>
    </div>
    <div className="flex items-start gap-2">
      <MiniCheck />
      <div>
        <div className="text-[12px] text-foreground">Membership written</div>
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground/70">role: producer</div>
      </div>
    </div>
  </MiniCard>,

  // 04 Roles later — the member roster with role badges
  <MiniCard key="d4">
    <MiniRow
      avatar={<MiniAvatar initials="MK" tone="bg-accent-600" />}
      name="Mila Kern"
      trailing={<Badge variant="neutral">Producer</Badge>}
    />
    <MiniRow
      avatar={<MiniAvatar initials="SP" tone="bg-accent-500" />}
      name="Sam Producer"
      trailing={<Badge variant="accent">Admin</Badge>}
    />
  </MiniCard>,
];
