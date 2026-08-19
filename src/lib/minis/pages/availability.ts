import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const artist: MiniSteps = [
  {
    label: { en: 'Eligible dates', de: 'Passende Termine' },
    text: {
      en: 'A date appears when a cast you are in is eligible for it and you hold every required skill.',
      de: 'Ein Termin taucht auf, wenn eine Besetzung, in der du bist, dafür infrage kommt und du alle nötigen Skills hast.',
    },
  },
  {
    label: { en: 'Block a date', de: 'Termin sperren' },
    text: {
      en: 'Blocked dates never reach you as an offer. Nobody has to chase you for a no.',
      de: 'Gesperrte Termine erreichen dich nie als Angebot. Niemand muss dir wegen einer Absage hinterherlaufen.',
    },
  },
  {
    label: { en: 'Answer an offer', de: 'Angebot beantworten' },
    text: {
      en: 'Accepting says yes. The producer confirms next, and the confirmation digest tells you when.',
      de: 'Mit dem Annehmen wirst du vorläufig gebucht. Das Produktionsteam bestätigt, und die Bestätigungsübersicht sagt dir, wann.',
    },
  },
  {
    label: { en: 'Confirmed', de: 'Bestätigt' },
    text: {
      en: 'Once confirmed you are on the cast list, in the date chat, and any contract comes to you.',
      de: 'Sobald du bestätigt bist, stehst du auf der Besetzungsliste, bist im Termin-Chat und ein etwaiger Engagementvertrag kommt zu dir.',
    },
  },
];

export const availabilityMini: MiniDef = {
  page: 'availability',
  route: ROUTES.AVAILABILITY,
  eyebrow: { en: 'How your calendar works', de: 'Wie dein Kalender funktioniert' },
  subnote: {
    en: 'You only see dates you are eligible for',
    de: 'Du siehst nur Termine, für die du infrage kommst',
  },
  variants: { artist, super: artist },
};
