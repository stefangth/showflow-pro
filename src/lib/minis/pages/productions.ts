import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const LABELS = {
  aShow: { en: 'The {{show}}', de: '{{Show}}' },
  itsDates: { en: 'Its {{showDates}}', de: 'Die {{ShowDates}}' },
  slots: { en: 'Slots per {{show}}', de: 'Slots je {{Show}}' },
  synced: { en: 'Synced {{showDates}}', de: 'Synchronisierte {{showDates}}' },
} as const;

const STEP1 = {
  label: LABELS.aShow,
  text: {
    en: '{{Shows}} are the template in your catalog, one row per program and sub-program pair, not per {{showDate}}.',
    de: '{{Shows}} sind die Vorlage im Katalog, eine Zeile je Programm und Unterprogramm, nicht je {{showDate}}.',
  },
};
const STEP2 = {
  label: LABELS.itsDates,
  text: {
    en: 'Each {{showDate}} is one event: city, venue, session times. Status is derived from its bookings.',
    de: '{{ShowDates}} sind die einzelnen Einsätze: Stadt, Ort, Sessionzeiten. Der Status ergibt sich aus den Buchungen.',
  },
};
const STEP3 = {
  label: LABELS.slots,
  text: {
    en: 'Until main and {{understudy}} slots are set, {{showDates}} can never reach fully filled. They read Unconfigured.',
    de: 'Solange die Slots für Hauptpositionen und {{understudies}} nicht gesetzt sind, werden {{showDates}} nie voll besetzt. Sie stehen auf Nicht konfiguriert.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: LABELS.synced,
    text: {
      en: '{{ShowDates}} from Airtable are owned by the sync. You control the mapping in Settings · Airtable sync.',
      de: '{{ShowDates}} aus Airtable gehören der Synchronisierung. Das Mapping steuerst du in Einstellungen · Airtable-Sync.',
    },
  },
];

const producer: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: LABELS.synced,
    text: {
      en: '{{ShowDates}} that arrive from Airtable are owned by the sync, edit them at the source, not here.',
      de: '{{ShowDates}}, die aus Airtable kommen, gehören der Synchronisierung. Bearbeite sie an der Quelle, nicht hier.',
    },
  },
];

export const productionsMini: MiniDef = {
  page: 'productions',
  route: ROUTES.PRODUCTIONS,
  eyebrow: { en: 'How the catalog works', de: 'Wie der Katalog funktioniert' },
  variants: { admin, producer, super: admin },
};
