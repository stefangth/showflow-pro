import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const artist: MiniSteps = [
  {
    label: { en: 'Eligible {{showDates}}', de: 'Passende {{showDates}}' },
    text: {
      en: '{{ShowDates}} appear when one {{cast}} you are in is eligible for them and you hold every required {{skill}}.',
      de: '{{ShowDates}} tauchen auf, wenn {{casts}}, in denen du bist, dafür infrage kommen und du alle nötigen {{skills}} hast.',
    },
  },
  {
    label: { en: 'Block {{showDates}}', de: '{{ShowDates}} sperren' },
    text: {
      en: 'Blocked {{showDates}} never reach you as an offer. Nobody has to chase you for a no.',
      de: 'Gesperrte {{showDates}} erreichen dich nie als Angebot. Niemand muss dir wegen einer Absage hinterherlaufen.',
    },
  },
  {
    label: { en: 'Answer an offer', de: 'Angebot beantworten' },
    text: {
      en: 'Accepting says yes. {{roleProducer}} confirms next, and the confirmation digest tells you when.',
      de: 'Mit dem Annehmen wirst du vorläufig gebucht. Das {{roleProducer}} bestätigt, und die Bestätigungsübersicht sagt dir, wann.',
    },
  },
  {
    label: { en: 'Confirmed', de: 'Bestätigt' },
    text: {
      en: 'Once confirmed you are on the {{cast}} list, in the {{showDate}} chat, and any {{hireOrder}} comes to you.',
      de: 'Sobald du bestätigt bist, stehst du auf der Personenliste, bist im {{ShowDate}}-Chat und ein etwaiger {{hireOrder}} kommt zu dir.',
    },
  },
];

export const availabilityMini: MiniDef = {
  page: 'availability',
  route: ROUTES.AVAILABILITY,
  eyebrow: { en: 'How your calendar works', de: 'Wie dein Kalender funktioniert' },
  subnote: {
    en: 'You only see {{showDates}} you are eligible for',
    de: 'Du siehst nur {{showDates}}, für die du infrage kommst',
  },
  variants: { artist, super: artist },
};
