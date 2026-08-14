import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

// Shared step labels (admin, producer and super use the same four labels here).
const LABELS = {
  bookingEngine: { en: 'Booking engine', de: 'Buchungs-Engine' },
  castsCities: { en: 'Casts and cities', de: 'Besetzungen und Städte' },
  hireOrders: { en: 'Hire orders', de: 'Engagementverträge' },
  auditTrail: { en: 'Audit trail', de: 'Änderungsprotokoll' },
} as const;

const admin: MiniSteps = [
  {
    label: LABELS.bookingEngine,
    text: {
      en: 'These hours decide when artists hear about an offer and how long they have to answer it.',
      de: 'Diese Uhrzeiten legen fest, wann Artists von einem Angebot erfahren und wie lange sie zum Antworten haben.',
    },
  },
  {
    label: LABELS.castsCities,
    text: {
      en: 'The priority ladder per city. It is the order the offer engine walks when a tier falls short.',
      de: 'Die Rangfolge je Stadt. In dieser Reihenfolge geht die Angebots-Engine vor, wenn eine Stufe nicht reicht.',
    },
  },
  {
    label: LABELS.hireOrders,
    text: {
      en: 'Letterhead, terms and countersign mode are yours. Orders cannot be issued on empty terms.',
      de: 'Briefkopf, Konditionen und Gegenzeichnungsmodus liegen bei dir. Ohne Konditionen lässt sich kein Engagementvertrag ausstellen.',
    },
  },
  {
    label: LABELS.auditTrail,
    text: {
      en: 'Every settings change records who changed what, so an odd booking outcome can be traced back.',
      de: 'Jede Änderung hält fest, wer was geändert hat, damit sich ein seltsames Buchungsergebnis zurückverfolgen lässt.',
    },
  },
];

const producer: MiniSteps = [
  {
    label: LABELS.bookingEngine,
    text: {
      en: 'These hours decide when your artists hear about an offer and how long they have to answer.',
      de: 'Diese Uhrzeiten legen fest, wann deine Artists von einem Angebot erfahren und wie lange sie zum Antworten haben.',
    },
  },
  {
    label: LABELS.castsCities,
    text: {
      en: 'The ladder the offer engine walks per city. Read it here to know who gets offered next.',
      de: 'Die Rangfolge, die die Angebots-Engine je Stadt durchläuft. Hier siehst du, wer als Nächstes ein Angebot bekommt.',
    },
  },
  {
    label: LABELS.hireOrders,
    text: {
      en: 'Until an admin sets the terms, no order can be issued. The blocker is listed so you know why.',
      de: 'Solange ein Admin die Konditionen nicht gesetzt hat, lässt sich kein Engagementvertrag ausstellen. Der Grund steht dabei.',
    },
  },
  {
    label: LABELS.auditTrail,
    text: {
      en: 'When a booking behaves oddly, this says which setting changed, who changed it, and when.',
      de: 'Wenn sich eine Buchung seltsam verhält, steht hier, welche Einstellung sich geändert hat, wer es war und wann.',
    },
  },
];

export const settingsMini: MiniDef = {
  page: 'settings',
  route: ROUTES.SETTINGS,
  eyebrow: { en: 'What settings decide', de: 'Was Einstellungen festlegen' },
  variants: { admin, producer, super: admin },
};
