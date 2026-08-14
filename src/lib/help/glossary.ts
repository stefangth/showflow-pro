import type { GlossaryEntry } from './types';

/** "The words we use" cards. The card title is TERMS[term][lang]; the body is def[lang].
 *  German bodies use the TERMS vocabulary (Besetzung, Stufe, Engagementvertrag, ...). */
export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: 'hold',
    def: {
      en: 'An artist accepted an offer, but the production team has not confirmed it yet. The date is reserved, not booked.',
      de: 'Ein Artist hat ein Angebot angenommen, aber das Produktionsteam hat es noch nicht bestätigt. Der Termin ist reserviert, nicht gebucht.',
    },
  },
  {
    term: 'softBooked',
    def: {
      en: 'The production-team side of the same state. The slot is claimed and waiting on a confirm.',
      de: 'Die Seite des Produktionsteams für denselben Zustand. Der Slot ist belegt und wartet auf eine Bestätigung.',
    },
  },
  {
    term: 'cast',
    def: {
      en: 'A named group of artists. Your casts, and the skills they require, decide which dates you are offered.',
      de: 'Eine benannte Gruppe von Artists. Deine Besetzungen, und die Skills, die sie verlangen, entscheiden, welche Termine dir angeboten werden.',
    },
  },
  {
    term: 'tierLadder',
    def: {
      en: 'The order casts get asked in. Opening the next tier widens the offer to the next group down the ladder.',
      de: 'Die Reihenfolge, in der Besetzungen angefragt werden. Öffnest du die nächste Stufe, geht das Angebot an die nächste Gruppe weiter unten in der Rangfolge.',
    },
  },
  {
    term: 'responseWindow',
    def: {
      en: 'How long an offer stays open for you. Miss it and the offer expires and passes to the next tier.',
      de: 'Wie lange ein Angebot für dich offen bleibt. Verpasst du es, läuft das Angebot ab und geht an die nächste Stufe.',
    },
  },
  {
    term: 'digest',
    def: {
      en: 'The one daily email that carries your open offers, and a second that carries confirmations. Your organization sets the hours.',
      de: 'Die eine tägliche E-Mail mit deinen offenen Angeboten, und eine zweite mit den Bestätigungen. Deine Organisation legt die Uhrzeiten fest.',
    },
  },
  {
    term: 'understudy',
    def: {
      en: 'Cover for a confirmed artist. If someone cancels, the understudy whose skills fit best is promoted automatically.',
      de: 'Absicherung für einen bestätigten Artist. Sagt jemand ab, rückt automatisch die Zweitbesetzung nach, deren Skills am besten passen.',
    },
  },
  {
    term: 'hireOrder',
    def: {
      en: 'The engagement document for a booking: dates, fee, terms. Drafted on fill, issued by a person, then signed.',
      de: 'Das Engagement-Dokument für eine Buchung: Termine, Gage, Konditionen. Wird beim Füllen als Entwurf angelegt, von einer Person ausgestellt und dann unterschrieben.',
    },
  },
  {
    term: 'voidOrder',
    def: {
      en: 'An issued order cannot be edited. Void it and issue a fresh one instead.',
      de: 'Ein ausgestellter Engagementvertrag lässt sich nicht mehr bearbeiten. Mach ihn ungültig und stell stattdessen einen neuen aus.',
    },
  },
  {
    term: 'blockedDate',
    def: {
      en: 'A date you marked as unavailable. You stop being offered it. Dates you are already booked for are not affected.',
      de: 'Ein Termin, den du als nicht verfügbar markiert hast. Er wird dir nicht mehr angeboten. Termine, für die du schon gebucht bist, bleiben davon unberührt.',
    },
  },
] as const;
