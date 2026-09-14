import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'One thread per {{showDate}}', de: 'Ein Thread je {{showDate}}' },
  text: {
    en: 'Threads are created per {{showDate}}. There is no free-form channel to keep track of.',
    de: 'Threads entstehen je {{showDate}}. Es gibt keinen freien Kanal, den du im Blick behalten musst.',
  },
};
const STEP2 = {
  label: { en: 'Who is in it', de: 'Wer dabei ist' },
  text: {
    en: 'Membership follows the booking. {{Artists}} join when they accept and leave if it is cancelled.',
    de: 'Die Mitgliedschaft folgt der Buchung. {{Artists}} kommen beim Annehmen dazu und gehen bei einer Stornierung wieder raus.',
  },
};
const STEP3 = {
  label: { en: 'Talk about the {{showDate}}', de: 'Über {{showDates}} reden' },
  text: {
    en: 'Everything about one {{showDate}} sits in one place, next to the {{cast}} and the times it refers to.',
    de: 'Alles, was {{ShowDates}} betrifft, liegt an einem Ort, direkt neben den {{casts}} und den zugehörigen Zeiten.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Archived', de: 'Archiviert' },
    text: {
      en: 'A thread freezes 30 days past the {{showDate}}. Admins keep full access to archived threads.',
      de: 'Ein Thread friert 30 Tage nach dem Datum ein. Admins behalten vollen Zugriff auf archivierte Threads.',
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
      en: 'A thread freezes 30 days past the {{showDate}}. It stays readable for everyone who was in it.',
      de: 'Ein Thread friert 30 Tage nach dem Datum ein. Er bleibt für alle lesbar, die dabei waren.',
    },
  },
];

const artist: MiniSteps = [
  {
    label: { en: 'Only your {{showDates}}', de: 'Nur deine {{showDates}}' },
    text: {
      en: 'You see a thread for each {{showDate}} you are booked on. There is nothing else to scroll through.',
      de: 'Du siehst einen Thread für alle {{showDates}}, für die du gebucht bist. Mehr gibt es nicht zu scrollen.',
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
    label: { en: 'Ask about the {{showDate}}', de: '{{ShowDate}} besprechen' },
    text: {
      en: 'Call times, changes and questions live next to the {{showDate}} they are about, not in your inbox.',
      de: 'Startzeiten, Änderungen und Fragen stehen im passenden Thread, nicht in deinem Postfach.',
    },
  },
  {
    label: { en: 'Archived', de: 'Archiviert' },
    text: {
      en: 'A thread freezes 30 days past the {{showDate}}. You keep reading it, you just cannot post.',
      de: 'Ein Thread friert 30 Tage nach dem Datum ein. Du liest weiter mit, kannst nur nichts mehr posten.',
    },
  },
];

export const chatsMini: MiniDef = {
  page: 'chats',
  route: ROUTES.CHATS,
  eyebrow: { en: 'How threads work', de: 'Wie Threads funktionieren' },
  variants: { admin, producer, artist, super: admin },
};
