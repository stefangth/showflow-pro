import type { MiniDef, PageKey } from './types';
import { settingsMini } from './pages/settings';

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
} as const satisfies Partial<Record<PageKey, MiniDef>>;

export type RegisteredPageKey = keyof typeof MINIS;
export const PAGE_KEYS = Object.keys(MINIS) as RegisteredPageKey[];
