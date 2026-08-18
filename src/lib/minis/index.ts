import type { MiniDef, PageKey } from './types';
import { settingsMini } from './pages/settings';
import { bookingsMini } from './pages/bookings';
import { availabilityMini } from './pages/availability';
import { chatsMini } from './pages/chats';
import { productionsMini } from './pages/productions';
import { artistsMini } from './pages/artists';
import { platformMini } from './pages/platform';
import { hireOrdersMini } from './pages/hireOrders';

export * from './types';
export { resolveMiniRole } from './resolveMiniRole';
export type { MiniRoleCtx } from './resolveMiniRole';

/**
 * Every page mini, keyed by PageKey. Adding a page: author ./pages/<page>.ts, add it
 * here, add its illustration in src/components/minis/illustrations, and drop
 * <PageMini page="<page>" /> into the page below its setup rail.
 */
export const MINIS = {
  settings: settingsMini,
  bookings: bookingsMini,
  availability: availabilityMini,
  chats: chatsMini,
  productions: productionsMini,
  artists: artistsMini,
  platform: platformMini,
  hireOrders: hireOrdersMini,
} as const satisfies Record<PageKey, MiniDef>;

export type RegisteredPageKey = keyof typeof MINIS;
export const PAGE_KEYS = Object.keys(MINIS) as RegisteredPageKey[];
