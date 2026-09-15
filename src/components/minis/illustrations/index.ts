import type { ReactNode } from 'react';
import type { RegisteredPageKey } from '@/lib/minis';
import type { Vocabulary } from '@/lib/orgKind';
import { settingsArt } from './SettingsMini';
import { bookingsArt } from './BookingsMini';
import { availabilityArt } from './AvailabilityMini';
import { chatsArt } from './ChatsMini';
import { productionsArt } from './ProductionsMini';
import { artistsArt } from './ArtistsMini';
import { platformArt } from './PlatformMini';
import { hireOrdersArt } from './HireOrdersMini';

export type ArtTuple = readonly [ReactNode, ReactNode, ReactNode, ReactNode];
/** An illustration set is either static nodes, or a factory taking the org's workspace-type
 *  vocabulary (English forms) so its domain-noun labels read in that vocabulary. Illustrations
 *  are English decorative previews, so the factory receives the English kind table, swapping
 *  only the production/staffing dimension (e.g. "Understudy" to "Standby"). */
export type ArtEntry = ArtTuple | ((vocab: Vocabulary) => ArtTuple);

/** The four illustration nodes for each registered page, keyed by PageKey. */
export const ART: Record<RegisteredPageKey, ArtEntry> = {
  settings: settingsArt,
  bookings: bookingsArt,
  availability: availabilityArt,
  chats: chatsArt,
  productions: productionsArt,
  artists: artistsArt,
  platform: platformArt,
  hireOrders: hireOrdersArt,
};

/** Resolve an ART entry to its four nodes, passing vocabulary to the factory forms. */
export const resolveArt = (entry: ArtEntry, vocab: Vocabulary): ArtTuple =>
  typeof entry === 'function' ? entry(vocab) : entry;
