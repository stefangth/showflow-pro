import type { GlossaryEntry } from './types';

/** "The words we use" cards. The card title is TERMS[term][lang]; the body is def[lang].
 *  German bodies use the TERMS vocabulary (Besetzung, Engagementvertrag, ...). */
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'hold',
    def: {
      en: 'How many said-yes {{artists}} are still waiting on your last word, shown on the dashboard queue. The {{showDate}} is reserved for them, not booked, until you act.',
      de: 'Wie viele {{artists}}, die zugesagt haben, noch auf dein letztes Wort warten, gezeigt in der Dashboard-Queue. Die Position ist für sie reserviert, aber erst gebucht, wenn du handelst.',
    },
  },
  {
    term: 'softBooked',
    def: {
      en: 'The status on an individual booking once the {{artist}} says yes but before it is booked. The spot is claimed, waiting on the last word, wherever your organization keeps one.',
      de: 'Der Status einer einzelnen Buchung, sobald ein {{artist}} zugesagt hat, aber bevor sie gebucht ist. Die Position ist belegt und wartet auf das letzte Wort, sofern deine Organisation sich eines vorbehält.',
    },
  },
  {
    term: 'cast',
    def: {
      en: 'A named group of {{artists}}. Your {{casts}}, and the {{skills}} they require, decide which {{showDates}} you are asked about.',
      de: 'Eine benannte Gruppe von {{artists}}. Deine {{Casts}}, und die {{skills}}, die sie verlangen, entscheiden, welche {{showDates}} für dich infrage kommen.',
    },
  },
  {
    term: 'tierLadder',
    def: {
      en: 'The order {{casts}} get asked in. Opening it up further widens who gets asked to the next group down.',
      de: 'Die Reihenfolge, in der {{casts}} gefragt werden. Öffnest du es für mehr Leute, weitet sich der Kreis der Gefragten auf die nächste Gruppe aus.',
    },
  },
  {
    term: 'responseWindow',
    def: {
      en: 'How long you have to answer an ask. Miss it and the ask expires and passes to the next {{cast}}.',
      de: 'Wie lange du Zeit hast, eine Anfrage zu beantworten. Verpasst du es, läuft die Anfrage ab und geht an die nächste Gruppe.',
    },
  },
  {
    term: 'digest',
    def: {
      en: 'The one daily email that carries your open asks, and a second that carries bookings. Your organization sets the hours.',
      de: 'Die eine tägliche E-Mail mit deinen offenen Anfragen, und eine zweite mit den Buchungen. Deine Organisation legt die Uhrzeiten fest.',
    },
  },
  {
    term: 'understudy',
    def: {
      en: 'Cover for a booked {{artist}}. If someone cancels, the {{understudy}} whose {{skills}} fit best is promoted automatically.',
      de: 'Absicherung für gebuchte {{artists}}. Sagt jemand ab, rückt automatisch die Person mit den passendsten {{skills}} nach.',
    },
  },
  {
    term: 'hireOrder',
    def: {
      en: 'The document for a booking: {{showDates}}, fee, terms. Drafted on fill, issued by a person, then signed.',
      de: 'Das Dokument zu einer Buchung: {{ShowDates}}, Gage, Konditionen. Wird beim Füllen als Entwurf angelegt, von einer Person ausgestellt und dann unterschrieben.',
    },
  },
  {
    term: 'voidOrder',
    def: {
      en: 'An issued {{hireOrder}} cannot be edited. Void it and issue a fresh one instead.',
      de: 'Ein ausgestellter {{hireOrder}} lässt sich nicht mehr bearbeiten. Mach ihn ungültig und stell stattdessen einen neuen aus.',
    },
  },
  {
    term: 'blockedDate',
    def: {
      en: 'Any {{showDate}} you marked as not free. You stop being asked about it. {{ShowDates}} you are already booked for are not affected.',
      de: '{{ShowDates}}, die du als nicht frei markiert hast. Du wirst dazu nicht mehr gefragt. {{ShowDates}}, für die du schon gebucht bist, bleiben davon unberührt.',
    },
  },
] as const;
