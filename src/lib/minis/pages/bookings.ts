import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const LABELS = {
  tierOpens: { en: 'Tier opens', de: 'Stufe öffnet' },
  artistResponds: { en: '{{Artist}} responds', de: '{{Artist}} antwortet' },
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
    en: 'If your workspace keeps the last word, a yes waits on you to book it. Booking is yours, singly, from the queue, or across a range of {{showDates}} you select in Month or Season.',
    de: 'Behält dein Workspace das letzte Wort, wartet eine Zusage darauf, dass du buchst. Das Buchen liegt bei dir, einzeln, aus der Queue, oder für einen Zeitraum, den du in Month oder Season auswählst.',
  },
};
const STEP4 = {
  label: LABELS.fullyFilled,
  text: {
    en: 'At full main {{cast}} the {{showDate}} flips to fully filled and, if the module is on, drafts its {{hireOrders}}.',
    de: 'Sind alle Hauptpositionen besetzt, springt der Status auf voll besetzt und, wenn das Modul an ist, werden die {{hireOrders}} entworfen.',
  },
};

const admin: MiniSteps = [
  {
    label: LABELS.tierOpens,
    text: {
      en: 'The ladder you set in Settings decides who is offered. Blocked {{showDates}} and missing {{skills}} filter out first.',
      de: 'Die Rangfolge aus den Einstellungen entscheidet, wer ein Angebot bekommt. Gesperrte {{showDates}} und fehlende {{skills}} fallen zuerst raus.',
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
      en: 'Every eligible {{artist}} in the tier is offered at once.',
      de: 'Alle geeigneten {{artists}} der Stufe bekommen gleichzeitig ein Angebot.',
    },
  },
  STEP2,
  STEP3,
  STEP4,
];

export const bookingsMini: MiniDef = {
  page: 'bookings',
  route: ROUTES.BOOKINGS,
  eyebrow: { en: 'How {{showDates}} get filled', de: 'Wie {{showDates}} besetzt werden' },
  subnote: {
    en: 'Windows and digest hours from Settings · Booking engine',
    de: 'Fenster und Zeiten aus Einstellungen · Buchungs-Engine',
  },
  variants: { admin, producer, super: admin },
};
