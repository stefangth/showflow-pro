import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'Draft from booking', de: 'Entwurf aus Buchung' },
  text: {
    en: 'A date that fills auto-drafts an order. Every field names where it came from.',
    de: 'Ein Termin, der voll wird, entwirft automatisch einen Vertrag. Jedes Feld nennt seine Herkunft.',
  },
};
const STEP2 = {
  label: { en: 'Issue and send', de: 'Ausstellen und senden' },
  text: {
    en: 'Issue one order or a whole batch. The artist gets the PDF by email and in the app.',
    de: 'Stelle einen Vertrag oder einen ganzen Stapel aus. Der Artist bekommt das PDF per E-Mail und in der App.',
  },
};
const STEP3 = {
  label: { en: 'Countersign', de: 'Gegenzeichnen' },
  text: {
    en: 'Mark it countersigned by hand, or the artist signs in the app and it flips itself.',
    de: 'Markiere ihn von Hand als gegengezeichnet, oder der Artist unterschreibt in der App und er springt selbst um.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Set it up once', de: 'Einmal einrichten' },
    text: {
      en: 'Letterhead, terms and countersign mode are yours to set. Drafting works before they are done.',
      de: 'Briefkopf, Konditionen und Gegenzeichnungsmodus setzt du selbst. Das Entwerfen geht schon davor.',
    },
  },
];

const producer: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Import in bulk', de: 'Sammelimport' },
    text: {
      en: 'Map columns once, link unknown artists, fix what is flagged, then draft everything at once.',
      de: 'Ordne Spalten einmal zu, verknüpfe unbekannte Artists, behebe Markiertes, dann entwirf alles auf einmal.',
    },
  },
];

export const hireOrdersMini: MiniDef = {
  page: 'hireOrders',
  route: ROUTES.HIRE_ORDERS,
  eyebrow: { en: 'How hire orders work', de: 'Wie Engagementverträge funktionieren' },
  subnote: {
    en: 'Numbering and defaults from Settings · Hire orders',
    de: 'Nummerierung und Vorgaben aus Einstellungen · Engagementverträge',
  },
  variants: { admin, producer, super: admin },
};
