import type { ReactNode } from 'react';
import type { RegisteredPageKey } from '@/lib/minis';
import { settingsArt } from './SettingsMini';

/** The four illustration nodes for each registered page, keyed by PageKey. */
export const ART: Record<RegisteredPageKey, readonly [ReactNode, ReactNode, ReactNode, ReactNode]> = {
  settings: settingsArt,
};
