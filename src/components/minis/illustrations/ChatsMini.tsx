import type { ReactNode } from 'react';
import { Badge, MiniCard, MiniRow, MiniAvatar, MiniWell } from '../atoms';

/**
 * The four Chats-mini illustrations, in step order:
 *   One thread per date · Who is in it · Talk about the date · Archived
 * Token-only likenesses of the real Chats surfaces. Copy lives in src/lib/minis;
 * these illustrations are role-invariant.
 */
export const chatsArt: readonly [ReactNode, ReactNode, ReactNode, ReactNode] = [
  // 01 One thread per date — a thread list with status badges
  <MiniCard key="c1">
    <MiniRow
      avatar={<MiniAvatar initials="NL" tone="bg-accent-500" />}
      name="Nachtlicht · Jul 24"
      sub="6 people"
      trailing={<Badge variant="confirmed">Active</Badge>}
    />
    <MiniRow
      avatar={<MiniAvatar initials="KH" tone="bg-accent-700" />}
      name="Kesselhaus · Jul 12"
      sub="4 people"
      trailing={<Badge variant="neutral">Read-only</Badge>}
    />
  </MiniCard>,

  // 02 Who is in it — participant avatars + access rules
  <MiniCard key="c2">
    <div className="flex items-center gap-2">
      <span className="flex -space-x-1">
        <MiniAvatar initials="SP" tone="bg-accent-400" />
        <MiniAvatar initials="TB" tone="bg-accent-500" />
        <MiniAvatar initials="IV" tone="bg-accent-600" />
        <MiniAvatar initials="NR" tone="bg-accent-700" />
      </span>
      <span className="inline-flex h-[22px] items-center rounded-full bg-muted px-2 text-[10px] font-medium text-muted-foreground">+2</span>
    </div>
    <div className="text-[11px] text-muted-foreground">Admins and producers see every thread</div>
    <div className="text-[11px] text-muted-foreground">Artists join on confirmed and soft-booked</div>
  </MiniCard>,

  // 03 Talk about the date — outgoing and incoming chat bubbles
  <MiniCard key="c3">
    <div className="flex flex-col gap-1.5">
      <span className="ml-auto max-w-[85%] rounded-m rounded-br-none bg-accent-500 px-2.5 py-1.5 text-[11px] text-white">
        Doors 19:00, soundcheck moved to 17:30.
      </span>
      <span className="flex flex-col">
        <span className="text-[10px] font-medium text-muted-foreground">Theo Brandt</span>
        <span className="mr-auto max-w-[85%] rounded-m rounded-bl-none bg-muted px-2.5 py-1.5 text-[11px] text-foreground">
          Understood, I will be there at 17:00.
        </span>
      </span>
    </div>
  </MiniCard>,

  // 04 Archived — read-only after the retention window
  <MiniCard key="c4">
    <MiniWell label="Archived 30 days after the date" trailing={<Badge variant="neutral">Read-only</Badge>} />
    <div className="text-[11px] text-muted-foreground">Admins keep full access</div>
  </MiniCard>,
];
