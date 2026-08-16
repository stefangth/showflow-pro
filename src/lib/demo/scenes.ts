import { ROUTES } from '@/config/app.config';

/**
 * The six cues the demo engine supports (`run_demo_cue` RPC + demo-ops `cue` action).
 * A scene's `cues` array references these ids in the order the rep should trigger them.
 */
export const CUE_IDS = [
  'artist_accepts_offer',
  'run_clock_to_1700',
  'drop_notifications',
  'fill_date',
  'issue_hire_order',
  'advance_clock',
] as const;

export type CueId = (typeof CUE_IDS)[number];

/** Which role the rep should be viewing the app as while this scene plays. */
export type Persona = 'admin' | 'producer' | 'artist';

export interface Bilingual {
  en: string;
  de: string;
}

/** One beat of the "season handover" run-of-show: a route, a persona, a talk-track, and cues. */
export interface Scene {
  id: string;
  title: Bilingual;
  route: string;
  persona: Persona;
  /** The teleprompter "Say:" line the rep reads while on this scene. */
  say: Bilingual;
  cues: CueId[];
  estMin: number;
}

/**
 * The season-handover script: the standard walkthrough a sales rep runs for a
 * prospective producer, one beat per scene, in order. See spec §6E.
 */
export const SEASON_HANDOVER: Scene[] = [
  {
    id: 'season-stands',
    title: { en: 'Where the season stands', de: 'Wo die Spielzeit steht' },
    route: ROUTES.DASHBOARD,
    persona: 'admin',
    say: {
      en: 'Six shows, twenty plus dates, and a live fill rate. This is a real season, not a demo toy.',
      de: 'Sechs Produktionen, über zwanzig Termine und eine Besetzungsquote live. Das ist eine echte Spielzeit, kein Demospielzeug.',
    },
    cues: [],
    estMin: 2,
  },
  {
    id: 'build-routing',
    title: { en: 'Build a routing for Hamlet', de: 'Ein Routing für Hamlet aufbauen' },
    route: ROUTES.BOOKINGS,
    persona: 'producer',
    say: {
      en: 'Watch how the routing for Hamlet comes together: tier and ladder, one offer wave at a time.',
      de: 'Schau dir an, wie das Routing für Hamlet entsteht: Stufe und Rangfolge, eine Angebotswelle nach der anderen.',
    },
    cues: [],
    estMin: 3,
  },
  {
    id: 'holds-expire',
    title: { en: 'Two holds expire at 17:00', de: 'Zwei Vormerkungen laufen um 17:00 Uhr ab' },
    route: ROUTES.BOOKINGS,
    persona: 'producer',
    say: {
      en: 'Two holds expire at 17:00. Watch one artist accept, the clock run out, and the notifications land.',
      de: 'Zwei Vormerkungen laufen um 17:00 Uhr ab. Schau zu, wie eine Artistin zusagt, die Uhr abläuft und die Benachrichtigungen eintreffen.',
    },
    cues: ['artist_accepts_offer', 'run_clock_to_1700', 'drop_notifications'],
    estMin: 4,
  },
  {
    id: 'artists-side',
    title: { en: "The artist's side", de: 'Die Seite der Artists' },
    route: ROUTES.AVAILABILITY,
    persona: 'artist',
    say: {
      en: "Now flip to the artist's side: what a hold, an offer, and a blocked date look like from there.",
      de: 'Jetzt wechseln wir auf die Seite der Artists: wie eine Vormerkung, ein Angebot und ein gesperrter Termin von dort aussehen.',
    },
    cues: [],
    estMin: 3,
  },
  {
    id: 'hire-order',
    title: { en: 'Hire order, auto drafted', de: 'Engagementvertrag, automatisch entworfen' },
    route: ROUTES.BOOKINGS,
    persona: 'producer',
    say: {
      en: 'Fill the last slot and watch the hire order draft itself before you even open the tab.',
      de: 'Fülle den letzten Platz und schau zu, wie sich der Engagementvertrag von selbst entwirft, bevor du den Tab überhaupt öffnest.',
    },
    cues: ['fill_date', 'issue_hire_order'],
    estMin: 4,
  },
  {
    id: 'your-rules',
    title: { en: 'Your rules, not ours', de: 'Deine Regeln, nicht unsere' },
    route: ROUTES.SETTINGS,
    persona: 'admin',
    say: {
      en: 'Every rule here lives in settings: response windows, digest times, your terms. Nothing is hardcoded.',
      de: 'Jede Regel hier lebt in den Einstellungen: Antwortfristen, Zeiten für die Tagesübersicht, deine Bedingungen. Nichts ist fest einprogrammiert.',
    },
    cues: [],
    estMin: 2,
  },
  {
    id: 'leave-sandbox',
    title: { en: 'Leave them the sandbox', de: 'Lass ihnen die Sandbox' },
    route: ROUTES.DASHBOARD,
    persona: 'admin',
    say: {
      en: 'Hand them the keys. This sandbox resets on its own, so they can break things and try again.',
      de: 'Gib ihnen die Schlüssel. Diese Sandbox setzt sich von selbst zurück, also können sie ausprobieren und Fehler machen.',
    },
    cues: [],
    estMin: 1,
  },
];
