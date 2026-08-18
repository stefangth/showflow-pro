import type { ReactNode } from 'react';
import type { RegisteredPageKey } from '@/lib/minis';
import { settingsArt } from './SettingsMini';
import { bookingsArt } from './BookingsMini';
import { availabilityArt } from './AvailabilityMini';
import { chatsArt } from './ChatsMini';
import { productionsArt } from './ProductionsMini';
import { artistsArt } from './ArtistsMini';
import { platformArt } from './PlatformMini';
import { hireOrdersArt } from './HireOrdersMini';

type ArtTuple = readonly [ReactNode, ReactNode, ReactNode, ReactNode];

/** The four illustration nodes for each registered page, keyed by PageKey. */
export const ART: Record<RegisteredPageKey, ArtTuple> = {
  settings: settingsArt,
  bookings: bookingsArt,
  availability: availabilityArt,
  chats: chatsArt,
  productions: productionsArt,
  artists: artistsArt,
  platform: platformArt,
  hireOrders: hireOrdersArt,
};
