import type { StageDef } from './types';

/** The six journey stages, in order. Section headers on the Help page. */
export const STAGES: readonly StageDef[] = [
  {
    title: { en: 'Invitation', de: 'Einladung' },
    moment: { en: 'Before you have an account', de: 'Bevor du ein Konto hast' },
  },
  {
    title: { en: 'Getting in', de: 'Reinkommen' },
    moment: { en: 'Accepting and signing in', de: 'Annehmen und anmelden' },
  },
  {
    title: { en: 'First session', de: 'Erste Sitzung' },
    moment: { en: 'The first look at the app', de: 'Der erste Blick in die App' },
  },
  {
    title: { en: 'First real task', de: 'Erste echte Aufgabe' },
    moment: { en: 'The first thing your role actually does', de: 'Das Erste, was deine Rolle wirklich macht' },
  },
  {
    title: { en: 'Everyday use', de: 'Alltag' },
    moment: { en: 'Week to week', de: 'Woche für Woche' },
  },
  {
    title: { en: 'When things change', de: 'Wenn sich etwas ändert' },
    moment: { en: 'Cancellations, exits, edge cases', de: 'Absagen, Austritte, Sonderfälle' },
  },
] as const;
