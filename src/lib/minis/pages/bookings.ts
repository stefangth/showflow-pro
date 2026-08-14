import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const LABELS = {
  tierOpens: { en: 'Tier opens', de: 'Stufe öffnet' },
  artistResponds: { en: 'Artist responds', de: 'Artist antwortet' },
  youConfirm: { en: 'You confirm', de: 'Du bestätigst' },
  fullyFilled: { en: 'Fully filled', de: 'Voll besetzt' },
} as const;

const STEP2 = {
  label: LABELS.artistResponds,
  text: {
    en: '48h from the daily digest, not from when the offer was made. Unanswered offers expire.',
    de: '48 Std. ab der Tagesübersicht, nicht ab dem Zeitpunkt des Angebots. Unbeantwortete Angebote verfallen.',
  },
};
const STEP3 = {
  label: LABELS.youConfirm,
  text: {
    en: 'Accepted offers become soft-booked depending on your setting. Confirming is yours, singly or in bulk from the date sheet.',
    de: 'Angenommene Angebote werden je nach Einstellung vorläufig gebucht. Das Bestätigen liegt bei dir, einzeln oder gesammelt im Terminblatt.',
  },
};
const STEP4 = {
  label: LABELS.fullyFilled,
  text: {
    en: 'At full main cast the date flips to fully filled and, if the module is on, drafts its hire orders.',
    de: 'Bei voller Hauptbesetzung springt der Termin auf voll besetzt und entwirft, wenn das Modul an ist, seine Engagementverträge.',
  },
};

const admin: MiniSteps = [
  {
    label: LABELS.tierOpens,
    text: {
      en: 'The ladder you set in Settings decides who is offered. Blocked dates and missing skills filter out first.',
      de: 'Die Rangfolge aus den Einstellungen entscheidet, wer ein Angebot bekommt. Gesperrte Termine und fehlende Skills fallen zuerst raus.',
    },
  },
  STEP2,
  STEP3,
  STEP4,
];

const producer: MiniSteps = [
  {
    label: LABELS.tierOpens,
    text: {
      en: 'Every eligible artist in the tier is offered at once.',
      de: 'Alle geeigneten Artists der Stufe bekommen gleichzeitig ein Angebot.',
    },
  },
  STEP2,
  STEP3,
  STEP4,
];

export const bookingsMini: MiniDef = {
  page: 'bookings',
  route: ROUTES.BOOKINGS,
  eyebrow: { en: 'How a date gets cast', de: 'Wie ein Termin besetzt wird' },
  subnote: {
    en: 'Windows and digest hours from Settings · Booking engine',
    de: 'Fenster und Zeiten aus Einstellungen · Buchungs-Engine',
  },
  variants: { admin, producer, super: admin },
};
