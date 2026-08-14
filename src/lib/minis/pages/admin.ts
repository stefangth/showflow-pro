import { ROUTES } from '@/config/app.config';
import type { MiniDef, MiniSteps } from '../types';

const admin: MiniSteps = [
  {
    label: { en: 'Invite by email', de: 'Per E-Mail einladen' },
    text: {
      en: 'You pick the role at invite time. Paste several addresses at once for a bulk invite.',
      de: 'Du wählst die Rolle beim Einladen. Füge mehrere Adressen auf einmal ein für eine Sammeleinladung.',
    },
  },
  {
    label: { en: 'Duplicates caught', de: 'Dubletten erkannt' },
    text: {
      en: 'The invite bar matches against members and pending invites live, before you send anything.',
      de: 'Die Einladungsleiste gleicht live mit Mitgliedern und offenen Einladungen ab, bevor du etwas sendest.',
    },
  },
  {
    label: { en: 'They accept', de: 'Einladung angenommen' },
    text: {
      en: 'Accepting writes the org membership. An artist invite also links their talent record.',
      de: 'Das Annehmen schreibt die Org-Mitgliedschaft. Eine Artist-Einladung verknüpft zusätzlich das Talentprofil.',
    },
  },
  {
    label: { en: 'Roles later', de: 'Rollen später' },
    text: {
      en: 'Change a role or remove a member here. Every check is enforced again in the database.',
      de: 'Ändere hier eine Rolle oder entferne ein Mitglied. Jede Prüfung wird in der Datenbank erneut durchgesetzt.',
    },
  },
];

export const adminMini: MiniDef = {
  page: 'admin',
  route: ROUTES.ADMIN,
  eyebrow: { en: 'How people get in', de: 'Wie Leute reinkommen' },
  variants: { admin, super: admin },
};
