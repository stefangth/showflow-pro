import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const STEP1 = {
  label: { en: 'A talent record', de: 'Ein Talentprofil' },
  text: {
    en: 'An artist exists in your catalog whether or not they ever log in. External artists are normal.',
    de: 'Ein Artist existiert in deinem Katalog, ob er sich jemals anmeldet oder nicht. Externe Artists sind normal.',
  },
};
const STEP2 = {
  label: { en: 'Skills', de: 'Skills' },
  text: {
    en: 'Skills gate offers. An artist must hold every skill a show and its date require, not just one.',
    de: 'Skills steuern Angebote. Ein Artist muss jeden Skill haben, den eine Show und ihr Termin verlangen, nicht nur einen.',
  },
};
const STEP3 = {
  label: { en: 'Casts', de: 'Besetzungen' },
  text: {
    en: 'Casts are how eligibility and the offer ladder are expressed. Priority is set per city.',
    de: 'Über Besetzungen werden Eignung und Angebotsreihenfolge ausgedrückt. Die Priorität wird je Stadt gesetzt.',
  },
};

const admin: MiniSteps = [
  STEP1,
  STEP2,
  STEP3,
  {
    label: { en: 'Invite and link', de: 'Einladen und verknüpfen' },
    text: {
      en: 'Invite an artist and their login links to this record on accept, offers then go to their login email.',
      de: 'Lädst du einen Artist ein, verknüpft sich sein Login beim Annehmen mit diesem Profil, Angebote gehen dann an seine Login-Adresse.',
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
      en: 'You can see whether an artist has an account. Inviting one is an admin action.',
      de: 'Du siehst, ob ein Artist ein Konto hat. Das Einladen ist eine Admin-Aktion.',
    },
  },
];

export const artistsMini: MiniDef = {
  page: 'artists',
  route: ROUTES.ARTISTS,
  eyebrow: { en: 'How the roster works', de: 'Wie das Ensemble verwaltet wird' },
  variants: { admin, producer, super: admin },
};
