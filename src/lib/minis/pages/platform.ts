import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const superAdmin: MiniSteps = [
  {
    label: { en: 'Provision an org', de: 'Org bereitstellen' },
    text: {
      en: 'One action creates the org, seeds its catalog, and invites the first admin.',
      de: 'Eine Aktion legt die Org an, befüllt ihren Katalog und lädt den ersten Admin ein.',
    },
  },
  {
    label: { en: 'Modules per org', de: 'Module je Org' },
    text: {
      en: 'Entitlements are per org. A module that is off locks its nav item instead of hiding it.',
      de: 'Berechtigungen gelten je Org. Ein ausgeschaltetes Modul sperrt seinen Navigationseintrag, statt ihn zu verstecken.',
    },
  },
  {
    label: { en: 'Users across orgs', de: 'Nutzer über Orgs' },
    text: {
      en: 'One directory over every org: memberships, artist links, email changes, suspend, delete.',
      de: 'Ein Verzeichnis über alle Orgs: Mitgliedschaften, Artist-Verknüpfungen, E-Mail-Änderungen, Sperren, Löschen.',
    },
  },
  {
    label: { en: 'System health', de: 'Systemzustand' },
    text: {
      en: 'Cron and edge-function health, recomputed every 15 minutes and kept for 30 days.',
      de: 'Zustand von Cron und Edge-Functions, alle 15 Minuten neu berechnet und 30 Tage lang aufbewahrt.',
    },
  },
];

export const platformMini: MiniDef = {
  page: 'platform',
  route: ROUTES.PLATFORM,
  eyebrow: { en: 'What the console controls', de: 'Was die Konsole steuert' },
  subnote: {
    en: 'Super-admin only · across every org',
    de: 'Nur Super-Admin · über alle Orgs hinweg',
  },
  variants: { super: superAdmin },
};
