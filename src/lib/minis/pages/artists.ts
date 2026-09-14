import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'A talent record', de: 'Ein Talentprofil' },
  text: {
    en: '{{Artists}} exist in your catalog whether or not they ever log in. External {{artists}} are normal.',
    de: '{{Artists}} existieren in deinem Katalog, ob sie sich jemals anmelden oder nicht. Externe {{artists}} sind normal.',
  },
};
const STEP2 = {
  label: { en: '{{Skills}}', de: '{{Skills}}' },
  text: {
    en: '{{Skills}} gate offers. {{Artists}} must hold every {{skill}} the {{show}} and its {{showDate}} require, not just one.',
    de: '{{Skills}} steuern Angebote. {{Artists}} müssen alle geforderten {{skills}} haben, nicht nur einzelne.',
  },
};
const STEP3 = {
  label: { en: '{{Casts}}', de: '{{Casts}}' },
  text: {
    en: '{{Casts}} are how eligibility and the offer ladder are expressed. Priority is set per city.',
    de: 'Über {{casts}} werden Eignung und Angebotsreihenfolge ausgedrückt. Die Priorität wird je Stadt gesetzt.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Invite and link', de: 'Einladen und verknüpfen' },
    text: {
      en: 'Invite one {{artist}} and their login links to this record on accept, offers then go to their login email.',
      de: 'Lädst du {{artists}} ein, verknüpft sich ihr Login beim Annehmen mit diesem Profil, Angebote gehen dann an ihre Login-Adresse.',
    },
  },
];

const producer: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Accounts', de: 'Konten' },
    text: {
      en: 'You can see whether each {{artist}} has an account. Inviting one is an admin action.',
      de: 'Du siehst, ob ein {{artist}} ein Konto hat. Das Einladen ist eine Admin-Aktion.',
    },
  },
];

export const artistsMini: MiniDef = {
  page: 'artists',
  route: ROUTES.ARTISTS,
  eyebrow: { en: 'How the roster works', de: 'Wie die {{Artists}} verwaltet werden' },
  variants: { admin, producer, super: admin },
};
