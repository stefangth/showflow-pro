import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniField, MiniRow, MiniAvatar, MiniButton } from '../atoms';
import { Token } from '@/components/ui/token';

/**
 * The four Platform-mini illustrations, in step order:
 *   Provision an org · Modules per org · Users across orgs · System health
 * Token-only likenesses of the real Platform console. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const platformArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 Provision an org — org name + first admin, then provision
  <MiniCard key="f1">
    <MiniField label="Organization">Zirkus Nord</MiniField>
    <MiniField label="First admin">
      <Token className="text-eyebrow">ada@zirkusnord.de</Token>
    </MiniField>
    <MiniButton primary>Provision</MiniButton>
  </MiniCard>,

  // 02 Modules per org — entitlements toggled on/off
  <MiniCard key="f2">
    <MiniField label="Booking flow">
      <Badge variant="confirmed">On</Badge>
    </MiniField>
    <MiniField label="Hire orders">
      <Badge variant="neutral">Off</Badge>
    </MiniField>
  </MiniCard>,

  // 03 Users across orgs — cross-org directory rows
  <MiniCard key="f3">
    <MiniRow
      avatar={<MiniAvatar initials="MK" tone="bg-accent-600" />}
      name="Mila Kern"
      sub="2 orgs · producer, admin"
      trailing={<Badge variant="confirmed">Active</Badge>}
    />
    <MiniRow
      avatar={<MiniAvatar initials="TB" tone="bg-accent-700" />}
      name="Theo Brandt"
      sub="1 org · artist"
      trailing={<Badge variant="risk">Suspended</Badge>}
    />
  </MiniCard>,

  // 04 System health — crons + email deliverability
  <MiniCard key="f4">
    <MiniField label="Crons">
      <Badge variant="confirmed">12 healthy</Badge>
    </MiniField>
    <MiniField label="Email">
      <Badge variant="risk">Degraded</Badge>
    </MiniField>
    <div className="text-eyebrow text-muted-foreground">30-day uptime</div>
  </MiniCard>,
];
