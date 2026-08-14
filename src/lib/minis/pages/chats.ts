import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'One thread per date', de: 'Ein Thread je Termin' },
  text: {
    en: 'Threads are created per show date. There is no free-form channel to keep track of.',
    de: 'Threads entstehen je Showtermin. Es gibt keinen freien Kanal, den du im Blick behalten musst.',
  },
};
const STEP2 = {
  label: { en: 'Who is in it', de: 'Wer dabei ist' },
  text: {
    en: 'Membership follows the booking. An artist joins when they accept and leaves if it is cancelled.',
    de: 'Die Mitgliedschaft folgt der Buchung. Ein Artist kommt beim Annehmen dazu und geht bei einer Stornierung wieder raus.',
  },
};
const STEP3 = {
  label: { en: 'Talk about the date', de: 'Über den Termin reden' },
  text: {
    en: 'Everything about one date sits in one place, next to the cast and the times it refers to.',
    de: 'Alles zu einem Termin liegt an einem Ort, direkt neben der Besetzung und den zugehörigen Zeiten.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Archived', de: 'Archiviert' },
    text: {
      en: 'A thread freezes 30 days past the show date. Admins keep full access to archived threads.',
      de: 'Ein Thread friert 30 Tage nach dem Showtermin ein. Admins behalten vollen Zugriff auf archivierte Threads.',
    },
  },
];

const producer: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Archived', de: 'Archiviert' },
    text: {
      en: 'A thread freezes 30 days past the show date. It stays readable for everyone who was in it.',
      de: 'Ein Thread friert 30 Tage nach dem Showtermin ein. Er bleibt für alle lesbar, die dabei waren.',
    },
  },
];

const artist: MiniSteps = [
  {
    label: { en: 'Only your dates', de: 'Nur deine Termine' },
    text: {
      en: 'You see a thread for each date you are booked on. There is nothing else to scroll through.',
      de: 'Du siehst einen Thread für jeden Termin, für den du gebucht bist. Mehr gibt es nicht zu scrollen.',
    },
  },
  {
    label: { en: 'You join on accept', de: 'Beim Annehmen dabei' },
    text: {
      en: 'Accepting an offer puts you in the thread. Declining or cancelling takes you out of it.',
      de: 'Ein Angebot anzunehmen bringt dich in den Thread. Ablehnen oder Stornieren nimmt dich wieder raus.',
    },
  },
  {
    label: { en: 'Ask about the date', de: 'Zum Termin fragen' },
    text: {
      en: 'Call times, changes and questions live next to the date they are about, not in your inbox.',
      de: 'Startzeiten, Änderungen und Fragen stehen neben dem Termin, um den es geht, nicht in deinem Postfach.',
    },
  },
  {
    label: { en: 'Archived', de: 'Archiviert' },
    text: {
      en: 'A thread freezes 30 days past the show date. You keep reading it, you just cannot post.',
      de: 'Ein Thread friert 30 Tage nach dem Showtermin ein. Du liest weiter mit, kannst nur nichts mehr posten.',
    },
  },
];

export const chatsMini: MiniDef = {
  page: 'chats',
  route: ROUTES.CHATS,
  eyebrow: { en: 'How threads work', de: 'Wie Threads funktionieren' },
  variants: { admin, producer, artist, super: admin },
};
