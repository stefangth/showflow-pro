import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const LABELS = {
  aShow: { en: 'A show', de: 'Eine Show' },
  itsDates: { en: 'Its dates', de: 'Ihre Termine' },
  slots: { en: 'Slots per show', de: 'Slots je Show' },
  synced: { en: 'Synced dates', de: 'Synchronisierte Termine' },
} as const;

const STEP1 = {
  label: LABELS.aShow,
  text: {
    en: 'A show is the production template, one row per program and sub-program pair, not per night.',
    de: 'Eine Show ist die Produktionsvorlage, eine Zeile je Programm und Unterprogramm, nicht je Abend.',
  },
};
const STEP2 = {
  label: LABELS.itsDates,
  text: {
    en: 'Each date is one performance: city, venue, session times. Status is derived from its bookings.',
    de: 'Jeder Termin ist eine Vorstellung: Stadt, Spielort, Sessionzeiten. Der Status ergibt sich aus den Buchungen.',
  },
};
const STEP3 = {
  label: LABELS.slots,
  text: {
    en: 'Until main and understudy slots are set, a date can never reach fully filled. It reads Unconfigured.',
    de: 'Solange Haupt- und Zweitbesetzungs-Slots nicht gesetzt sind, wird ein Termin nie voll besetzt. Er steht auf Nicht konfiguriert.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: LABELS.synced,
    text: {
      en: 'Dates from Airtable are owned by the sync. You control the mapping in Settings · Airtable sync.',
      de: 'Termine aus Airtable gehören der Synchronisierung. Das Mapping steuerst du in Einstellungen · Airtable-Sync.',
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
      en: 'Dates that arrive from Airtable are owned by the sync, edit them at the source, not here.',
      de: 'Termine, die aus Airtable kommen, gehören der Synchronisierung. Bearbeite sie an der Quelle, nicht hier.',
    },
  },
];

export const productionsMini: MiniDef = {
  page: 'productions',
  route: ROUTES.PRODUCTIONS,
  eyebrow: { en: 'How the catalog works', de: 'Wie der Katalog funktioniert' },
  variants: { admin, producer, super: admin },
};
