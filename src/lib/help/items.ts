import type { HelpItem } from './types';

export type { HelpItem } from './types';

/**
 * The full Help center FAQ. EN copy is verbatim from the design comp; DE copy is
 * the approved German ("Du" form, no dashes) using the TERMS vocabulary. Status is
 * only 'new' or 'ok' — the design's single "still open" item (A5.1) is now 'ok'.
 */
export const HELP_ITEMS: readonly HelpItem[] = [
  // ---------- ADMIN ----------
  {
    id: 'A0.1', role: 'admin', stage: 0, status: 'new', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'What is ShowFlow, and what does it do?', de: 'Was ist ShowFlow, und was macht es?' },
    a: {
      en: 'ShowFlow is where your organization plans its shows and books the artists for them. Your invitation email now opens with that line, before it asks you to accept anything.',
      de: 'ShowFlow ist der Ort, an dem deine Organisation ihre Shows plant und die Artists dafür bucht. Deine Einladungs-E-Mail beginnt jetzt mit genau diesem Satz, bevor sie dich um irgendeine Zusage bittet.',
    },
  },
  {
    id: 'A0.2', role: 'admin', stage: 0, status: 'new', surface: 'Invitation email · role descriptions', updated: '2026-08-18',
    q: { en: 'What does being the admin mean? What am I signing up to own?', de: 'Was heißt es, Admin zu sein? Wofür übernehme ich die Verantwortung?' },
    a: {
      en: 'The invitation now spells the role out instead of appending it as a suffix. As admin you decide how booking works for the organization, invite the team, and confirm bookings. The same role descriptions appear in the role menu in Settings, People.',
      de: 'Die Einladung schreibt die Rolle jetzt aus, statt sie nur als Zusatz anzuhängen. Als Admin entscheidest du, wie das Buchen für die Organisation funktioniert, lädst das Team ein und bestätigst Buchungen. Dieselben Rollenbeschreibungen findest du im Rollenmenü unter Einstellungen, Personen.',
    },
  },
  {
    id: 'A0.3', role: 'admin', stage: 0, status: 'new', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'Is this legitimate? Who sent it?', de: 'Ist das echt? Wer hat das geschickt?' },
    a: {
      en: 'The email names the person who invited you alongside the organization. If their display name is missing, their email address is shown instead.',
      de: 'Die E-Mail nennt die Person, die dich eingeladen hat, zusammen mit der Organisation. Fehlt ihr Anzeigename, wird stattdessen ihre E-Mail-Adresse gezeigt.',
    },
  },
  {
    id: 'A0.4', role: 'admin', stage: 0, status: 'new', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'How long do I have to accept?', de: 'Wie lange habe ich Zeit anzunehmen?' },
    a: {
      en: 'The expiry date is read from your invitation and stated in the email, not buried in a footer. An expired invitation cannot be resent: ask for it to be revoked and sent again.',
      de: 'Das Ablaufdatum wird aus deiner Einladung gelesen und steht in der E-Mail, nicht versteckt in der Fußzeile. Eine abgelaufene Einladung lässt sich nicht erneut senden: bitte darum, sie zu widerrufen und neu zu verschicken.',
    },
  },
  {
    id: 'A1.1', role: 'admin', stage: 1, status: 'new', surface: 'Invitation email · accept invite', updated: '2026-08-14',
    q: { en: 'Do I create an account, or sign in?', de: 'Erstelle ich ein Konto, oder melde ich mich an?' },
    a: {
      en: 'Both paths work, and the email now tells you which one you are on. If you are new, the link takes you to set a password. If you already have a ShowFlow account, you sign in and land back on the invitation.',
      de: 'Beide Wege funktionieren, und die E-Mail sagt dir jetzt, auf welchem du bist. Bist du neu, führt dich der Link zum Setzen eines Passworts. Hast du schon ein ShowFlow-Konto, meldest du dich an und landest wieder bei der Einladung.',
    },
  },
  {
    id: 'A1.2', role: 'admin', stage: 1, status: 'new', surface: 'Accept invite, success card', updated: '2026-08-14',
    q: { en: 'Which organization am I joining, and as what?', de: 'Welcher Organisation trete ich bei, und als was?' },
    a: {
      en: 'Accepting now ends on a success card that names the organization, your role, and the single next step that role should take. Membership is created at invite time, so the card confirms what happened rather than asking you to confirm it again.',
      de: 'Das Annehmen endet jetzt auf einer Erfolgs-Karte, die die Organisation nennt, deine Rolle, und den einen nächsten Schritt, den diese Rolle gehen sollte. Die Mitgliedschaft entsteht schon beim Einladen, also bestätigt die Karte, was passiert ist, statt dich erneut um eine Bestätigung zu bitten.',
    },
  },
  {
    id: 'A1.3', role: 'admin', stage: 1, status: 'new', surface: 'Accept invite, success card', updated: '2026-08-18',
    q: { en: 'What is my next move after accepting?', de: 'Was ist mein nächster Schritt nach dem Annehmen?' },
    a: {
      en: 'The success card names it. As admin or on the production team it names the Get running board and how far the workspace still is from its first offer, with an Open Get running button. As an artist it points you straight to your availability.',
      de: 'Die Erfolgs-Karte nennt ihn. Als Admin oder im Produktionsteam nennt sie das Get running Board und wie weit der Arbeitsbereich noch von seinem ersten Angebot entfernt ist, mit einem Button Get running öffnen. Als Artist verweist sie dich direkt auf deine Verfügbarkeit.',
    },
  },
  {
    id: 'A2.1', role: 'admin', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'Where am I? Is this thing empty, or broken?', de: 'Wo bin ich? Ist das hier leer, oder kaputt?' },
    a: {
      en: 'Neither. The dashboard shows your organization’s real numbers straight away, starting at zero. Get running, in the sidebar under Workspace, is the walk through for the setup that still needs doing, in order.',
      de: 'Weder noch. Das Dashboard zeigt dir sofort die echten Zahlen deiner Organisation, sie fangen einfach bei null an. Get running, in der Sidebar unter Workspace, ist der Rundgang durch das Setup, das noch aussteht, der Reihe nach.',
    },
  },
  {
    id: 'A2.2', role: 'admin', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'What do I do first, and how long will it take?', de: 'Was mache ich zuerst, und wie lange dauert es?' },
    a: {
      en: 'Open Get running from the sidebar. It walks you through the setup tasks in order, and its header adds up how long what is left will take, about 3 minutes for each task still blocking your first offer.',
      de: 'Öffne Get running in der Sidebar. Es führt dich der Reihe nach durch die Setup-Aufgaben, und die Kopfzeile rechnet dir zusammen, wie lange der Rest noch dauert, etwa 3 Minuten pro Aufgabe, die noch dein erstes Angebot blockiert.',
    },
  },
  {
    id: 'A2.3', role: 'admin', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'What blocks what? Can I explore without breaking things?', de: 'Was blockiert was? Kann ich mich umsehen, ohne etwas kaputtzumachen?' },
    a: {
      en: 'Each task carries a chip: blocks offers, blocks booking, blocks issuing, or holds up filling. Nothing on the Get running board stops you using the rest of the app.',
      de: 'Jede Aufgabe trägt einen Chip: blockiert Angebote, blockiert Buchungen, blockiert den Versand, oder hält die Vollbesetzung auf. Nichts auf dem Get running Board hält dich davon ab, den Rest der App zu nutzen.',
    },
  },
  {
    id: 'A2.4', role: 'admin', stage: 2, status: 'ok', surface: 'Sidebar · module footers', updated: '2026-08-14',
    q: { en: 'Why can I not see a module?', de: 'Warum sehe ich ein Modul nicht?' },
    a: {
      en: 'Modules your organization has not turned on stay visible in the sidebar as a locked item, with a footer saying who can switch them on. Hiding them would leave you unable to tell they exist.',
      de: 'Module, die deine Organisation nicht aktiviert hat, bleiben in der Sidebar als gesperrter Eintrag sichtbar, mit einer Fußzeile, die sagt, wer sie einschalten kann. Würde man sie verstecken, wüsstest du gar nicht, dass es sie gibt.',
    },
  },
  {
    id: 'A3.2', role: 'admin', stage: 3, status: 'new', surface: 'Get running board, add your artists task', updated: '2026-08-18',
    q: { en: 'How do my people get in? How do artists get accounts?', de: 'Wie kommen meine Leute rein? Wie bekommen Artists ein Konto?' },
    a: {
      en: 'Get running has an Add your artists task, so you can no longer finish setup with nobody in the workspace. It counts as done once there is at least one active artist. Offers reach booking email addresses without app accounts, so adding artists to the roster is the real prerequisite and login invites are optional.',
      de: 'Get running hat eine Aufgabe Deine Artists hinzufügen, du kannst das Setup also nicht abschließen, wenn niemand im Workspace ist. Sie gilt als erledigt, sobald es mindestens einen aktiven Artist gibt. Angebote erreichen Buchungs-E-Mail-Adressen auch ohne App-Konto, das eigentliche Muss ist also, Artists in die Künstlerliste aufzunehmen, Login-Einladungen sind optional.',
    },
  },
  {
    id: 'A3.1', role: 'admin', stage: 3, status: 'new', surface: 'Get running board · Help center', updated: '2026-08-18',
    q: { en: 'What are casts, ladders and tiers? What is the mental model?', de: 'Was sind Besetzungen, Rangfolgen und Stufen? Was ist das Denkmodell dahinter?' },
    a: {
      en: 'The Rank your casts and Check who is eligible tasks on Get running assume those concepts, and each links straight to the Help center, which carries the model end to end.',
      de: 'Die Aufgaben Deine Besetzungen reihen und Prüfen, wer berechtigt ist auf Get running setzen diese Konzepte voraus, und beide verlinken direkt auf das Hilfe-Center, das das Modell von Anfang bis Ende erklärt.',
    },
  },
  {
    id: 'A3.3', role: 'admin', stage: 3, status: 'new', surface: 'Get running board, timing task', updated: '2026-08-18',
    q: { en: 'What happens tonight, once I finish setup?', de: 'Was passiert heute Abend, sobald ich das Setup abgeschlossen habe?' },
    a: {
      en: 'The Confirm the offer timing task narrates it from your own flow rather than a generic example: whether offers go out the moment a tier opens, wait for the evening digest, or are switched off entirely.',
      de: 'Die Aufgabe Angebotszeitpunkt bestätigen erzählt es aus deinem eigenen Flow, nicht aus einem allgemeinen Beispiel: ob Angebote in dem Moment rausgehen, in dem eine Stufe öffnet, auf die Abend-Tagesübersicht warten, oder ganz ausgeschaltet sind.',
    },
  },
  {
    id: 'A3.4', role: 'admin', stage: 3, status: 'new', surface: 'Editor toolbar, view as', updated: '2026-08-18',
    q: { en: 'Do artists see what I see? What does their side look like?', de: 'Sehen Artists dasselbe wie ich? Wie sieht ihre Seite aus?' },
    a: {
      en: 'Use view as in the editor toolbar to look at the app as an artist, scoped to what the picker can genuinely show.',
      de: 'Nutz View as in der Editor-Leiste, um die App als Artist zu sehen, begrenzt auf das, was der Umschalter wirklich zeigen kann.',
    },
  },
  {
    id: 'A3.5', role: 'admin', stage: 3, status: 'ok', surface: 'Settings, booking flow', updated: '2026-08-14',
    q: { en: 'Which booking flow should I pick? What is the difference?', de: 'Welchen Booking-Flow soll ich wählen? Was ist der Unterschied?' },
    a: {
      en: 'Classic, Fast-track, Direct book, or Custom, each with a one line consequence. You can change it later, and every change is recorded next to the editor.',
      de: 'Classic, Fast-track, Direct book oder Custom, jeweils mit einer einzeiligen Konsequenz. Du kannst es später ändern, und jede Änderung wird neben dem Editor protokolliert.',
    },
  },
  {
    id: 'A3.6', role: 'admin', stage: 3, status: 'ok', surface: 'Shows and bookings, rehearsal', updated: '2026-08-14',
    q: { en: 'Can I test this without emailing real people?', de: 'Kann ich das testen, ohne echten Leuten E-Mails zu schicken?' },
    a: {
      en: 'Yes. Rehearse the next date shows exactly who would be offered and when. Nothing is created and no email leaves.',
      de: 'Ja. Rehearse the next date zeigt genau, wem wann ein Angebot gemacht würde. Es wird nichts angelegt, und keine E-Mail geht raus.',
    },
  },
  {
    id: 'A3.7', role: 'admin', stage: 3, status: 'new', surface: 'Settings, Organization', updated: '2026-08-15',
    q: { en: 'What language do the emails and hire order PDFs go out in?', de: 'In welcher Sprache gehen die E-Mails und Engagementvertrag-PDFs raus?' },
    a: {
      en: 'In your workspace language, set once under Settings then Organization. When it is German, offer, confirmation, and hire order emails, and the hire order PDFs, are sent in German with German dates and money formatting. This is separate from the app language each person picks for themselves in the account menu, which only changes what that one person sees on screen.',
      de: 'In der Sprache deines Arbeitsbereichs, die du einmal unter Einstellungen dann Organisation festlegst. Steht sie auf Deutsch, gehen Angebots-, Bestätigungs- und Engagementvertrag-E-Mails sowie die Engagementvertrag-PDFs auf Deutsch raus, mit deutschem Datums- und Geldformat. Das ist getrennt von der App-Sprache, die jede Person im Kontomenü für sich wählt und die nur ändert, was diese eine Person auf dem Bildschirm sieht.',
    },
  },
  {
    id: 'A4.1', role: 'admin', stage: 4, status: 'new', surface: 'Notifications', updated: '2026-08-14',
    q: { en: 'Why does clicking a notification do nothing?', de: 'Warum passiert nichts, wenn ich auf eine Benachrichtigung klicke?' },
    a: {
      en: 'It does something now. Notifications open the date, order, or page they are about, as long as your role and your organization’s modules can actually reach it.',
      de: 'Jetzt passiert etwas. Benachrichtigungen öffnen den Termin, den Engagementvertrag oder die Seite, um die es geht, solange deine Rolle und die Module deiner Organisation da wirklich hinkommen.',
    },
  },
  {
    id: 'A4.2', role: 'admin', stage: 4, status: 'new', surface: 'Sync-held email · Settings, Airtable', updated: '2026-08-14',
    q: { en: 'Did the Airtable sync work? Why are dates missing?', de: 'Hat der Airtable-Sync funktioniert? Warum fehlen Termine?' },
    a: {
      en: 'A held sync now emails you as well as posting in app, once per affected set rather than once per record, and points at Settings, Airtable. There the Overview tab lists every held record under "Needs your attention", grouped by cause with a one click fix, and the Activity tab shows the full run history. Held records are never dropped: fix the cause and they import on the next run.',
      de: 'Ein zurückgehaltener Sync schickt dir jetzt zusätzlich zur In-App-Meldung eine E-Mail, einmal pro betroffenem Set statt einmal pro Datensatz, und verweist auf Einstellungen, Airtable. Dort listet der Tab Überblick jeden zurückgehaltenen Datensatz unter "Braucht deine Aufmerksamkeit", nach Ursache gruppiert und mit einer Korrektur per Klick, und der Tab Aktivität zeigt die vollständige Lauf-Historie. Zurückgehaltene Datensätze gehen nie verloren: Behebe die Ursache, dann kommen sie beim nächsten Lauf rein.',
    },
  },
  {
    id: 'A4.3', role: 'admin', stage: 4, status: 'new', surface: 'Settings, People', updated: '2026-08-18',
    q: { en: 'How do I change someone’s role or remove them, and what happens to their data?', de: 'Wie ändere ich die Rolle von jemandem oder entferne die Person, und was passiert mit ihren Daten?' },
    a: {
      en: 'Settings, People handles the mechanics (the old Admin page now redirects there). The remove dialog narrates the consequences before you confirm, and the role menu carries a description of what each role can do.',
      de: 'Einstellungen, Personen übernimmt den Ablauf (die alte Admin Seite leitet jetzt dorthin weiter). Der Entfernen-Dialog erklärt die Folgen, bevor du bestätigst, und das Rollenmenü trägt eine Beschreibung, was jede Rolle darf.',
    },
  },
  {
    id: 'A4.4', role: 'admin', stage: 4, status: 'new', surface: 'Show date edit', updated: '2026-08-14',
    q: { en: 'Who gets notified when I change a schedule?', de: 'Wer wird benachrichtigt, wenn ich einen Zeitplan ändere?' },
    a: {
      en: 'The edit surface now says who hears about the change and when, read from your organization’s digest settings. If digests are off it says so rather than promising an email that never goes out.',
      de: 'Die Bearbeitungsansicht sagt jetzt, wer von der Änderung erfährt und wann, gelesen aus den Tagesübersicht-Einstellungen deiner Organisation. Sind die Tagesübersichten aus, sagt sie das, statt eine E-Mail zu versprechen, die nie rausgeht.',
    },
  },
  {
    id: 'A4.5', role: 'admin', stage: 4, status: 'ok', surface: 'Settings, How this org works · Help center', updated: '2026-08-18',
    q: { en: 'What runs automatically, and what still needs a person?', de: 'Was läuft automatisch, und was braucht noch einen Menschen?' },
    a: {
      en: 'Settings, How this org works is a read-only list of the rules currently in effect (booking flow, offer timing, cast coverage, paperwork), each one showing who set it and when. It is there from day one, and once your Get running board is complete, its own How this org works button lands you on the same page. The Help center explains how those rules play out.',
      de: 'Einstellungen, Wie diese Organisation funktioniert ist eine schreibgeschützte Liste der Regeln, die gerade gelten (Booking Flow, Angebotszeitpunkt, Besetzungsabdeckung, Papierkram), jede mit Angabe, wer sie wann festgelegt hat. Das gibt es von Anfang an, und sobald dein Get running Board fertig ist, führt dessen eigener Wie diese Organisation funktioniert Button auf dieselbe Seite. Das Hilfe-Center erklärt, wie sich diese Regeln auswirken.',
    },
  },
  {
    id: 'A4.6', role: 'admin', stage: 4, status: 'ok', surface: 'Dashboard queue', updated: '2026-08-14',
    q: { en: 'What is waiting on me today?', de: 'Was wartet heute auf mich?' },
    a: {
      en: 'The dashboard queue leads with it, including how many artists are waiting on a confirm from you.',
      de: 'Die Dashboard-Queue führt genau damit, samt der Zahl der Artists, die auf eine Bestätigung von dir warten.',
    },
  },
  {
    id: 'A5.1', role: 'admin', stage: 5, status: 'ok', surface: 'Suspended workspace screen', updated: '2026-08-14',
    q: { en: 'Why is my organization suspended, and who do I contact?', de: 'Warum ist meine Organisation gesperrt, und an wen wende ich mich?' },
    a: {
      en: 'The screen confirms your data is safe and tells you to contact your platform administrator. The contact line is built and ready, but no support address is configured yet, so the live screen still shows no address. It is a platform-level value, so once it is set it switches on everywhere.',
      de: 'Der Screen bestätigt, dass deine Daten sicher sind, und sagt dir, du sollst deinen Plattform-Administrator kontaktieren. Die Kontaktzeile ist gebaut und bereit, aber es ist noch keine Support-Adresse hinterlegt, daher zeigt der Live-Screen weiter keine Adresse. Es ist ein Wert auf Plattform-Ebene, sobald er gesetzt ist, schaltet er sich überall frei.',
    },
  },
  {
    id: 'A5.2', role: 'admin', stage: 5, status: 'ok', surface: 'Profile · platform console', updated: '2026-08-14',
    q: { en: 'Can I export everything, or delete the organization?', de: 'Kann ich alles exportieren, oder die Organisation löschen?' },
    a: {
      en: 'You can export your own data from your profile at any time. Deleting a whole organization and exporting it wholesale are platform actions, on purpose, not self-serve buttons.',
      de: 'Du kannst deine eigenen Daten jederzeit aus deinem Profil exportieren. Eine ganze Organisation zu löschen oder komplett zu exportieren sind bewusst Plattform-Aktionen, keine Self-Service-Buttons.',
    },
  },
  {
    id: 'A5.3', role: 'admin', stage: 5, status: 'new', surface: 'Page guide', updated: '2026-08-14',
    q: { en: 'What is the four-step panel at the top of a page, and can I hide it?', de: 'Was ist das Panel mit vier Schritten oben auf einer Seite, und kann ich es ausblenden?' },
    a: {
      en: 'It is the page guide: a short, role-aware explainer of what that page\'s module does and which step is yours. Hide dismisses it for that page in this browser and leaves a slim bar you can Resume from.',
      de: 'Das ist der Seitenüberblick: ein kurzer, rollenbezogener Erklärer, was das Modul dieser Seite macht und welcher Schritt deiner ist. Mit Ausblenden verschwindet er für diese Seite in diesem Browser, und es bleibt eine schmale Leiste, über die du ihn wieder einblenden kannst.',
    },
  },

  // ---------- PRODUCTION TEAM ----------
  {
    id: 'P0.1', role: 'producer', stage: 0, status: 'ok', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'What is ShowFlow, and what is my part in it?', de: 'Was ist ShowFlow, und was ist meine Rolle darin?' },
    a: {
      en: 'Your invitation says it plainly: your role is Production Team. You plan productions and show dates, and book artists into them.',
      de: 'Deine Einladung sagt es klar: deine Rolle ist Produktionsteam. Du planst Produktionen und Show-Termine und buchst Artists dafür.',
    },
  },
  {
    id: 'P0.2', role: 'producer', stage: 0, status: 'new', surface: 'Get running board · Help center', updated: '2026-08-18',
    q: { en: 'What is the difference between me and an admin?', de: 'Was ist der Unterschied zwischen mir und einem Admin?' },
    a: {
      en: 'Broadly: you run the work, an admin sets the rules. The Production Team note at the bottom of Get running carries a short line on what Production Team covers, with a link to what each role can do in the Help center.',
      de: 'Grob gesagt: du machst die Arbeit, ein Admin setzt die Regeln. Die Production-Team-Notiz unten auf Get running trägt eine kurze Zeile dazu, was das Produktionsteam abdeckt, mit einem Link darauf, was jede Rolle darf, im Hilfe-Center.',
    },
  },
  {
    id: 'P2.1', role: 'producer', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'Is this organization ready, or still being built?', de: 'Ist diese Organisation startklar, oder noch im Aufbau?' },
    a: {
      en: 'Get running, in the sidebar under Workspace, says which. While setup is still open its header lists what is yours to do and what waits on an admin. Once nothing is left, it says the workspace is running.',
      de: 'Get running in der Sidebar unter Workspace sagt dir, was zutrifft. Solange das Setup offen ist, listet die Kopfzeile, was deine Aufgabe ist und was auf einen Admin wartet. Ist nichts mehr offen, sagt es, dass der Workspace läuft.',
    },
  },
  {
    id: 'P2.2', role: 'producer', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'Why is everything empty? Is it me, or the organization?', de: 'Warum ist alles leer? Liegt es an mir, oder an der Organisation?' },
    a: {
      en: 'It is the organization. Get running says so directly at the top: it is there so you know why Shows and Bookings looks empty, not so you can fix all of it.',
      de: 'Es liegt an der Organisation. Get running sagt das oben direkt: es ist da, damit du weißt, warum Shows und Bookings leer aussieht, nicht damit du alles davon lösen kannst.',
    },
  },
  {
    id: 'P2.3', role: 'producer', stage: 2, status: 'new', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'Who exactly do I ask to finish setup?', de: 'Wen genau frage ich, um das Setup abzuschließen?' },
    a: {
      en: 'Get running names your first admin, for example waits on Nadia, on every task and chip that is not yours to do. Only members of your own organization, and only the one name on record. With nobody named yet it falls back to the generic waits on an admin.',
      de: 'Get running nennt deinen ersten Admin, zum Beispiel wartet auf Nadia, bei jeder Aufgabe und jedem Chip, der nicht deine ist. Nur Mitglieder deiner eigenen Organisation, und nur der eine hinterlegte Name. Ist noch keiner hinterlegt, greift es auf die allgemeine Zeile wartet auf einen Admin zurück.',
    },
  },
  {
    id: 'P2.4', role: 'producer', stage: 2, status: 'ok', surface: 'Get running board', updated: '2026-08-18',
    q: { en: 'What can I do while I wait?', de: 'Was kann ich tun, während ich warte?' },
    a: {
      en: 'Plan dates now, offer later. Nothing stops you adding dates and sessions before the booking rules exist, and Get running never blocks you from doing that either.',
      de: 'Termine jetzt planen, später anbieten. Nichts hält dich davon ab, Termine und Sessions anzulegen, bevor die Buchungsregeln existieren, und auch Get running hält dich nicht davon ab.',
    },
  },
  {
    id: 'P3.1', role: 'producer', stage: 3, status: 'new', surface: 'New show date dialog', updated: '2026-08-14',
    q: { en: 'Where do dates come from? Can I add one by hand?', de: 'Woher kommen die Termine? Kann ich einen von Hand anlegen?' },
    a: {
      en: 'Both. Dates sync in from Airtable and you can create one manually. The create dialog now says so, and holds true whether or not Airtable is configured for your organization.',
      de: 'Beides. Termine kommen per Sync aus Airtable, und du kannst einen manuell anlegen. Der Anlegen-Dialog sagt das jetzt, und zwar egal, ob Airtable für deine Organisation eingerichtet ist oder nicht.',
    },
  },
  {
    id: 'P3.2', role: 'producer', stage: 3, status: 'new', surface: 'Show date cockpit, cast list', updated: '2026-08-14',
    q: { en: 'What does confirming actually do? Is it final?', de: 'Was macht das Bestätigen eigentlich? Ist es endgültig?' },
    a: {
      en: 'A line under the confirm control now says what the artist gets and when, read from your organization’s flow, and it only promises an email if your organization actually sends one. The confirmation toast names the artist you confirmed.',
      de: 'Eine Zeile unter dem Bestätigen-Button sagt jetzt, was der Artist bekommt und wann, gelesen aus dem Flow deiner Organisation, und verspricht nur dann eine E-Mail, wenn deine Organisation auch wirklich eine schickt. Der Bestätigungs-Toast nennt den Artist, den du bestätigt hast.',
    },
  },
  {
    id: 'P3.3', role: 'producer', stage: 3, status: 'new', surface: 'Show date cockpit · bookings list', updated: '2026-08-14',
    q: { en: 'What does soft-booked mean? Why can I not just book someone?', de: 'Was heißt vorläufig gebucht? Warum kann ich jemanden nicht einfach buchen?' },
    a: {
      en: 'Soft-booked means the artist accepted and the slot is claimed, waiting on your confirm. The Accepted and Soft-booked badges now carry that explanation on hover, on the surface where the status appears.',
      de: 'Vorläufig gebucht heißt, der Artist hat angenommen und der Slot ist belegt, wartet aber auf deine Bestätigung. Die Badges Angenommen und Vorläufig gebucht tragen diese Erklärung jetzt beim Hovern, genau dort, wo der Status erscheint.',
    },
  },
  {
    id: 'P3.4', role: 'producer', stage: 3, status: 'new', surface: 'Show date cockpit, tier picker', updated: '2026-08-14',
    q: { en: 'What is a tier, and when do I open the next one?', de: 'Was ist eine Stufe, und wann öffne ich die nächste?' },
    a: {
      en: 'A tier is one rung of the cast ladder. Opening the next one widens the offer to the next group down. The tier picker now carries that note plus a link to how casts and tiers work.',
      de: 'Eine Stufe ist eine Sprosse der Besetzungs-Rangfolge. Öffnest du die nächste, weitet sich das Angebot auf die nächste Gruppe darunter aus. Der Stufen-Auswähler trägt jetzt diese Notiz plus einen Link dazu, wie Besetzungen und Stufen funktionieren.',
    },
  },
  {
    id: 'P3.5', role: 'producer', stage: 3, status: 'new', surface: 'Show date cockpit, book list', updated: '2026-08-14',
    q: { en: 'What if I need an artist outside the eligible casts?', de: 'Was, wenn ich einen Artist außerhalb der berechtigten Besetzungen brauche?' },
    a: {
      en: 'Book them directly from the eligibility list. When a date carries no cast limits at all, a line above the list now says the list is unrestricted, instead of leaving you to infer it.',
      de: 'Buch sie direkt aus der Berechtigungsliste. Trägt ein Termin gar keine Besetzungs-Grenzen, sagt eine Zeile über der Liste jetzt, dass die Liste unbeschränkt ist, statt es dich raten zu lassen.',
    },
  },
  {
    id: 'P3.6', role: 'producer', stage: 3, status: 'new', surface: 'Show date cockpit', updated: '2026-08-14',
    q: { en: 'When do artists hear about what I just did?', de: 'Wann erfahren Artists von dem, was ich gerade gemacht habe?' },
    a: {
      en: 'At the point of action, on the two actions that never said: confirming and cancelling both now name who hears and when. Opening a tier already narrated its own delivery.',
      de: 'Im Moment der Aktion, bei den zwei Aktionen, die es nie gesagt haben: Bestätigen und Absagen nennen jetzt beide, wer wann erfährt. Eine Stufe zu öffnen hat ihre Zustellung schon vorher erzählt.',
    },
  },
  {
    id: 'P4.1', role: 'producer', stage: 4, status: 'ok', surface: 'Dashboard queue', updated: '2026-08-14',
    q: { en: 'What needs me today?', de: 'Was braucht mich heute?' },
    a: {
      en: 'The dashboard queue splits it into waiting on you, expiring today, and unfilled tiers.',
      de: 'Die Dashboard-Queue teilt es auf in wartet auf dich, läuft heute ab, und ungefüllte Stufen.',
    },
  },
  {
    id: 'P4.2', role: 'producer', stage: 4, status: 'new', surface: 'Tier at risk notification and email', updated: '2026-08-14',
    q: { en: 'A tier is at risk. What am I supposed to do about it?', de: 'Eine Stufe ist gefährdet. Was soll ich dagegen tun?' },
    a: {
      en: 'The message now suggests the two recoveries, opening the next tier or direct booking, instead of only stating the maths. There is also an email for it, sent once per newly at-risk tier and recipient rather than on every run.',
      de: 'Die Meldung schlägt jetzt die zwei Auswege vor, die nächste Stufe öffnen oder direkt buchen, statt nur die Rechnung aufzumachen. Es gibt auch eine E-Mail dazu, verschickt einmal pro neu gefährdeter Stufe und Empfänger statt bei jedem Durchlauf.',
    },
  },
  {
    id: 'P4.3', role: 'producer', stage: 4, status: 'ok', surface: 'Notifications · bookings', updated: '2026-08-14',
    q: { en: 'An understudy got promoted. Do I need to do anything?', de: 'Eine Zweitbesetzung ist nachgerückt. Muss ich etwas tun?' },
    a: {
      en: 'Only confirm. The notification lands in your confirm queue and opens bookings when you click it.',
      de: 'Nur bestätigen. Die Benachrichtigung landet in deiner Bestätigungs-Queue und öffnet die Buchungen, wenn du sie anklickst.',
    },
  },
  {
    id: 'P4.4', role: 'producer', stage: 4, status: 'new', surface: 'Bookings, Needs you lens', updated: '2026-08-15',
    q: { en: 'What is Needs you, and why do I land there first now?', de: 'Was ist Needs you, und warum lande ich jetzt zuerst dort?' },
    a: {
      en: 'Shows and bookings now opens on Needs you: everything that actually needs you today, grouped into holds expiring today, dates at risk of running short, orders ready to issue, and cancellations the cast has not heard about yet. Switch to Month, Week, Season, or Agenda for the full calendar.',
      de: 'Shows und Buchungen öffnet jetzt auf Needs you: alles, was heute wirklich von dir gebraucht wird, gruppiert in heute ablaufende Vormerkungen, Termine mit Besetzungsrisiko, ausstellbereite Engagementverträge, und Absagen, über die die Besetzung noch nicht informiert wurde. Wechsle zu Month, Week, Season oder Agenda für den vollständigen Kalender.',
    },
  },
  {
    id: 'P4.5', role: 'producer', stage: 4, status: 'new', surface: 'Hire order, void dialog', updated: '2026-08-14',
    q: { en: 'Can I undo an issued hire order?', de: 'Kann ich einen ausgestellten Engagementvertrag rückgängig machen?' },
    a: {
      en: 'Not by editing it. An issued order is frozen. The void dialog now points at the real path: void this one, then issue a fresh order.',
      de: 'Nicht durchs Bearbeiten. Ein ausgestellter Engagementvertrag ist eingefroren. Der Ungültig-Dialog weist jetzt auf den richtigen Weg: diesen ungültig machen, dann einen neuen ausstellen.',
    },
  },
  {
    id: 'P4.6', role: 'producer', stage: 4, status: 'new', surface: 'Hire order timeline', updated: '2026-08-14',
    q: { en: 'Did the artist see the order I sent?', de: 'Hat der Artist den Engagementvertrag gesehen, den ich geschickt habe?' },
    a: {
      en: 'The order timeline now shows a Seen step, reached when the linked artist opens the order in the app. It is deliberately not email open tracking.',
      de: 'Die Vertrags-Timeline zeigt jetzt einen Gesehen-Schritt, erreicht, sobald der verknüpfte Artist den Engagementvertrag in der App öffnet. Das ist bewusst kein E-Mail-Öffnungs-Tracking.',
    },
  },
  {
    id: 'P4.7', role: 'producer', stage: 4, status: 'new', surface: 'Needs you queue, cancelled card', updated: '2026-08-15',
    q: { en: 'A cancelled date sits in Needs you with a Notify cast button. Did cancelling not already tell the cast?', de: 'Ein abgesagter Termin steht mit einem Notify-cast-Button in Needs you. Wurde die Besetzung nicht schon beim Absagen informiert?' },
    a: {
      en: 'Not yet: the only automatic notice is the confirmation digest at 20:00, so a date you cancelled during the day sits here until then. Notify cast sends it immediately and clears the item.',
      de: 'Noch nicht: Die einzige automatische Benachrichtigung ist die Bestätigungs-Tagesübersicht um 20 Uhr, also bleibt ein tagsüber abgesagter Termin bis dahin hier stehen. Notify cast verschickt sie sofort und erledigt den Eintrag.',
    },
  },
  {
    id: 'P4.8', role: 'producer', stage: 4, status: 'new', surface: 'Bookings, Month and Season lens, selection bar', updated: '2026-08-15',
    q: { en: 'Can I confirm holds or generate hire orders for several dates at once?', de: 'Kann ich Vormerkungen für mehrere Termine gleichzeitig bestätigen oder Engagementverträge erstellen?' },
    a: {
      en: 'Yes, in Month or Season: drag across a span of dates, or click one date and shift-click another, to select a range. A bar appears at the bottom with Confirm holds and Generate hire orders, each applied to every selected date, and Clear to drop the selection. Both still respect your permissions and only act on dates where the action makes sense.',
      de: 'Ja, in Month oder Season: Ziehe über mehrere Termine, oder klicke einen Termin an und dann mit Shift auf einen weiteren, um einen Zeitraum auszuwählen. Unten erscheint eine Leiste mit Confirm holds und Generate hire orders, beide werden auf jeden ausgewählten Termin angewendet, und Clear hebt die Auswahl auf. Beide respektieren weiterhin deine Berechtigungen und wirken nur auf Termine, wo die Aktion sinnvoll ist.',
    },
  },
  {
    id: 'P5.1', role: 'producer', stage: 5, status: 'new', surface: 'Show date cockpit, cancel dialog', updated: '2026-08-14',
    q: { en: 'A confirmed artist pulled out. What happens if I cancel them?', de: 'Ein bestätigter Artist ist abgesprungen. Was passiert, wenn ich ihn absage?' },
    a: {
      en: 'Cancelling one artist now asks first and previews the consequence, including whether an understudy will be promoted automatically under your flow. Cancelling a whole date is a separate action and is unchanged.',
      de: 'Einen einzelnen Artist abzusagen fragt jetzt erst nach und zeigt die Folge vorab, samt der Frage, ob unter deinem Flow automatisch eine Zweitbesetzung nachrückt. Einen ganzen Termin abzusagen ist eine eigene Aktion und bleibt unverändert.',
    },
  },
  {
    id: 'P5.2', role: 'producer', stage: 5, status: 'new', surface: 'Cancel dialog', updated: '2026-08-14',
    q: { en: 'I cancelled a date. Who gets told, and when?', de: 'Ich habe einen Termin abgesagt. Wer erfährt es, und wann?' },
    a: {
      en: 'The cancel dialog uses the same who-hears line as schedule edits, and stays honest about what your organization has actually switched on.',
      de: 'Der Absage-Dialog nutzt dieselbe Wer-erfährt-es-Zeile wie Zeitplan-Änderungen und bleibt ehrlich dabei, was deine Organisation tatsächlich aktiviert hat.',
    },
  },
  {
    id: 'P5.3', role: 'producer', stage: 5, status: 'new', surface: 'Page guide', updated: '2026-08-14',
    q: { en: 'What is the four-step panel at the top of a page, and can I hide it?', de: 'Was ist das Panel mit vier Schritten oben auf einer Seite, und kann ich es ausblenden?' },
    a: {
      en: 'It is the page guide: a short, role-aware explainer of what that page\'s module does and which step is yours. Hide dismisses it for that page in this browser and leaves a slim bar you can Resume from.',
      de: 'Das ist der Seitenüberblick: ein kurzer, rollenbezogener Erklärer, was das Modul dieser Seite macht und welcher Schritt deiner ist. Mit Ausblenden verschwindet er für diese Seite in diesem Browser, und es bleibt eine schmale Leiste, über die du ihn wieder einblenden kannst.',
    },
  },

  // ---------- ARTIST ----------
  {
    id: 'R0.1', role: 'artist', stage: 0, status: 'ok', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'What is ShowFlow? Is this spam?', de: 'Was ist ShowFlow? Ist das Spam?' },
    a: {
      en: 'It is the tool your organization books with. Every invitation now opens with the same line: ShowFlow is where the organization plans its shows and books the artists for them.',
      de: 'Es ist das Tool, mit dem deine Organisation bucht. Jede Einladung beginnt jetzt mit demselben Satz: ShowFlow ist der Ort, an dem die Organisation ihre Shows plant und die Artists dafür bucht.',
    },
  },
  {
    id: 'R0.2', role: 'artist', stage: 0, status: 'new', surface: 'Invitation email', updated: '2026-08-14',
    q: { en: 'Does this invitation mean I am on the roster? What is expected of me?', de: 'Heißt diese Einladung, dass ich auf der Liste bin? Was wird von mir erwartet?' },
    a: {
      en: 'The email now says you are on the roster. Where the organization sends offers, it also says what you get and what you do: booking offers by email, accept or decline each in one tap. Organizations that book directly get the roster line without the offer promise, because for them it would not be true.',
      de: 'Die E-Mail sagt jetzt, dass du auf der Liste bist. Wo die Organisation Angebote verschickt, sagt sie auch, was du bekommst und was du tust: Buchungsangebote per E-Mail, jedes mit einem Tap annehmen oder ablehnen. Organisationen, die direkt buchen, bekommen die Listen-Zeile ohne das Angebots-Versprechen, weil es für sie nicht stimmen würde.',
    },
  },
  {
    id: 'R1.1', role: 'artist', stage: 1, status: 'ok', surface: 'Accept invite · dashboard', updated: '2026-08-14',
    q: { en: 'Did they link me to the right profile?', de: 'Haben sie mich mit dem richtigen Profil verknüpft?' },
    a: {
      en: 'Your account is linked to your artist record by email automatically. If that fails you are told so honestly, and the dashboard says an admin can link it. You cannot link it yourself.',
      de: 'Dein Konto wird automatisch per E-Mail mit deinem Artist-Datensatz verknüpft. Klappt das nicht, wird es dir ehrlich gesagt, und das Dashboard sagt, dass ein Admin die Verknüpfung herstellen kann. Selbst verknüpfen kannst du sie nicht.',
    },
  },
  {
    id: 'R2.1', role: 'artist', stage: 2, status: 'new', surface: 'Availability page', updated: '2026-08-14',
    q: { en: 'How long is my response window, really? And when does the digest arrive?', de: 'Wie lang ist meine Antwortfrist wirklich? Und wann kommt die Tagesübersicht?' },
    a: {
      en: 'Both are now shown as actual numbers, read from your organization’s settings rather than described as concepts. The line only appears for organizations that send you offers, so a directly booked artist is never promised a window that does not exist.',
      de: 'Beide werden jetzt als echte Zahlen gezeigt, gelesen aus den Einstellungen deiner Organisation, statt nur als Konzepte beschrieben. Die Zeile erscheint nur bei Organisationen, die dir Angebote schicken, ein direkt gebuchter Artist bekommt also nie eine Frist versprochen, die es gar nicht gibt.',
    },
  },
  {
    id: 'R2.2', role: 'artist', stage: 2, status: 'ok', surface: 'Artist dashboard', updated: '2026-08-14',
    q: { en: 'What is this page, and what do I do first?', de: 'Was ist diese Seite, und was mache ich zuerst?' },
    a: {
      en: 'Block the dates you cannot play first, so you only get asked about dates that work. About 2 minutes, and none of it blocks anything.',
      de: 'Sperre zuerst die Termine, an denen du nicht spielen kannst, damit du nur zu Terminen gefragt wirst, die passen. Etwa 2 Minuten, und nichts davon hält irgendetwas auf.',
    },
  },
  {
    id: 'R3.1', role: 'artist', stage: 3, status: 'new', surface: 'Accept offer', updated: '2026-08-14',
    q: { en: 'I accepted. Am I booked now?', de: 'Ich habe angenommen. Bin ich jetzt gebucht?' },
    a: {
      en: 'Usually not yet. Accepting now says: hold placed, your production team confirms next. Where your organization confirms automatically it says the other true thing instead, that you are booked.',
      de: 'Meist noch nicht. Das Annehmen sagt jetzt: Vormerkung gesetzt, dein Produktionsteam bestätigt als Nächstes. Wo deine Organisation automatisch bestätigt, sagt es stattdessen die andere wahre Sache, nämlich dass du gebucht bist.',
    },
  },
  {
    id: 'R3.2', role: 'artist', stage: 3, status: 'new', surface: 'Decline offer', updated: '2026-08-14',
    q: { en: 'If I decline, will I get fewer offers later?', de: 'Bekomme ich später weniger Angebote, wenn ich ablehne?' },
    a: {
      en: 'No. Declining now says it out loud: this just cancels this one offer, and it will not affect future offers.',
      de: 'Nein. Das Ablehnen sagt es jetzt laut: das sagt nur dieses eine Angebot ab, und es hat keinen Einfluss auf künftige Angebote.',
    },
  },
  {
    id: 'R3.3', role: 'artist', stage: 3, status: 'ok', surface: 'Expiry reminder email · availability', updated: '2026-08-14',
    q: { en: 'What happens if I simply do not answer?', de: 'Was passiert, wenn ich einfach nicht antworte?' },
    a: {
      en: 'The offer expires when your window closes and passes to the next tier. You get a reminder a day before that happens.',
      de: 'Das Angebot läuft ab, wenn deine Frist schließt, und geht an die nächste Stufe. Einen Tag bevor das passiert, bekommst du eine Erinnerung.',
    },
  },
  {
    id: 'R3.4', role: 'artist', stage: 3, status: 'new', surface: 'Availability calendar', updated: '2026-08-16',
    q: { en: 'Why is this date not offered to me?', de: 'Warum wird mir dieser Termin nicht angeboten?' },
    a: {
      en: 'Offered dates come from the casts you are in and the skills those casts require. You can still open any day: if nothing is offered to you that day, the detail panel says so.',
      de: 'Angebotene Termine ergeben sich aus den Besetzungen, in denen du bist, und den Skills, die diese Besetzungen verlangen. Du kannst trotzdem jeden Tag öffnen: Wird dir an dem Tag nichts angeboten, sagt dir das Detailfeld das.',
    },
  },
  {
    id: 'R3.5', role: 'artist', stage: 3, status: 'new', surface: 'Availability calendar, empty state', updated: '2026-08-16',
    q: { en: 'Why do I see no dates at all?', de: 'Warum sehe ich überhaupt keine Termine?' },
    a: {
      en: 'You have no offered dates yet. Dates appear once you are added to a cast that is eligible for them and you hold the required skills. The All dates lens then lists every one.',
      de: 'Du hast noch keine angebotenen Termine. Termine erscheinen, sobald du einer Besetzung hinzugefügt wirst, die dafür infrage kommt, und du die nötigen Skills hast. Die Lens Alle Termine listet dann jeden auf.',
    },
  },
  {
    id: 'R3.6', role: 'artist', stage: 3, status: 'new', surface: 'Block date', updated: '2026-08-14',
    q: { en: 'Does blocking a date affect bookings I already have?', de: 'Wirkt sich das Sperren eines Termins auf Buchungen aus, die ich schon habe?' },
    a: {
      en: 'No. Blocking stops future offers for that date, and dates you are already booked for are not affected. The block dialog now says the second half too.',
      de: 'Nein. Das Sperren stoppt künftige Angebote für diesen Termin, und Termine, für die du schon gebucht bist, bleiben unberührt. Der Sperr-Dialog sagt jetzt auch die zweite Hälfte.',
    },
  },
  {
    id: 'R4.2', role: 'artist', stage: 4, status: 'new', surface: 'Artist dashboard, meter', updated: '2026-08-14',
    q: { en: 'What does my response rate count, and does it matter?', de: 'Was zählt meine Antwortquote, und ist sie wichtig?' },
    a: {
      en: 'It counts dates you accepted or were booked for, out of dates you were offered. It is just for you. Nobody is scored on it. Organizations that book directly see a booked-dates meter instead, with its own definition.',
      de: 'Die Quote zählt Termine, die du angenommen hast oder für die du gebucht wurdest, im Verhältnis zu den Terminen, die dir angeboten wurden. Nur du siehst sie, niemand wird danach bewertet. Organisationen, die direkt buchen, sehen stattdessen einen Zähler für gebuchte Termine, mit eigener Definition.',
    },
  },
  {
    id: 'R4.3', role: 'artist', stage: 4, status: 'ok', surface: 'Chat panel', updated: '2026-08-14',
    q: { en: 'Who can see this chat? Why is there no chat for a date I was offered?', de: 'Wer kann diesen Chat sehen? Warum gibt es keinen Chat für einen Termin, der mir angeboten wurde?' },
    a: {
      en: 'Chat is only available to the production team, admins, and artists booked or soft-booked for that date. An open offer is not enough.',
      de: 'Chat gibt es nur für das Produktionsteam, Admins und Artists, die für diesen Termin gebucht oder vorläufig gebucht sind. Ein offenes Angebot reicht nicht.',
    },
  },
  {
    id: 'R4.4', role: 'artist', stage: 4, status: 'new', surface: 'Profile · artist record', updated: '2026-08-14',
    q: { en: 'Who in the organization can see my phone number and email?', de: 'Wer in der Organisation kann meine Telefonnummer und E-Mail sehen?' },
    a: {
      en: 'Admins and the production team see the contact details on your artist record, which is what they book you from. Your profile now says so, and the production-team view carries the matching note.',
      de: 'Admins und das Produktionsteam sehen die Kontaktdaten auf deinem Artist-Datensatz, denn darüber buchen sie dich. Dein Profil sagt das jetzt, und die Ansicht für das Produktionsteam trägt die passende Notiz.',
    },
  },
  {
    id: 'R4.5', role: 'artist', stage: 4, status: 'new', surface: 'Sign hire order', updated: '2026-08-14',
    q: { en: 'What am I agreeing to when I sign a hire order?', de: 'Wozu stimme ich zu, wenn ich einen Engagementvertrag unterschreibe?' },
    a: {
      en: 'The fee, dates, and terms shown on that order. Adding your signature completes it, and the final signed PDF is emailed to you. There is no later step where the organization signs after you.',
      de: 'Der Gage, den Terminen und den Konditionen, die auf diesem Engagementvertrag stehen. Deine Unterschrift schließt ihn ab, und das fertige unterschriebene PDF wird dir per E-Mail geschickt. Es gibt keinen späteren Schritt, in dem die Organisation nach dir unterschreibt.',
    },
  },
  {
    id: 'R4.6', role: 'artist', stage: 4, status: 'new', surface: 'Artist dashboard, paperwork card', updated: '2026-08-14',
    q: { en: 'Where is my fee?', de: 'Wo ist meine Gage?' },
    a: {
      en: 'On the hire order for the booking. The paperwork card now appears even when you have none yet, so you learn the feature exists before your first order arrives. Organizations that do not use paperwork still show nothing.',
      de: 'Auf dem Engagementvertrag für die Buchung. Die Papierkram-Karte erscheint jetzt auch dann, wenn du noch keinen hast, damit du weißt, dass es die Funktion gibt, bevor dein erster Engagementvertrag ankommt. Organisationen, die keinen Papierkram nutzen, zeigen weiterhin nichts.',
    },
  },
  {
    id: 'R5.1', role: 'artist', stage: 5, status: 'new', surface: 'My bookings', updated: '2026-08-14',
    q: { en: 'I am confirmed but cannot make it. How do I cancel?', de: 'Ich bin bestätigt, kann aber nicht. Wie sage ich ab?' },
    a: {
      en: 'Not from here. There is no artist-side cancel for a confirmed booking, and your bookings now say what to do instead: message your production team in the date’s chat.',
      de: 'Nicht von hier aus. Es gibt keine Absage von Artist-Seite für eine bestätigte Buchung, und deine Buchungen sagen jetzt, was du stattdessen tust: schreib deinem Produktionsteam im Chat zum Termin.',
    },
  },
  {
    id: 'R5.2', role: 'artist', stage: 5, status: 'ok', surface: 'Notifications', updated: '2026-08-14',
    q: { en: 'I was promoted from understudy. What does that mean for me?', de: 'Ich bin von der Zweitbesetzung nachgerückt. Was heißt das für mich?' },
    a: {
      en: 'You are in the main cast for that date and expected to play it. The notification says it plainly when it happens.',
      de: 'Du bist für diesen Termin im Hauptcast und wirst erwartet, ihn zu spielen. Die Benachrichtigung sagt das klar, wenn es passiert.',
    },
  },
  {
    id: 'R5.3', role: 'artist', stage: 5, status: 'new', surface: 'Confirmation digest email', updated: '2026-08-14',
    q: { en: 'The show moved. Where do I check what is current?', de: 'Die Show wurde verschoben. Wo prüfe ich, was aktuell gilt?' },
    a: {
      en: 'In the app, and the confirmation digest email now gets you there: it carries a view your bookings button, which it was the only template missing.',
      de: 'In der App, und die Bestätigungs-Tagesübersicht per E-Mail bringt dich jetzt dorthin: sie trägt einen Button Deine Buchungen ansehen, der als einziges Template noch gefehlt hat.',
    },
  },
  {
    id: 'R5.4', role: 'artist', stage: 5, status: 'new', surface: 'Profile, delete account', updated: '2026-08-14',
    q: { en: 'What happens to my things if I delete my account?', de: 'Was passiert mit meinen Sachen, wenn ich mein Konto lösche?' },
    a: {
      en: 'Your bookings history stays with the organization in de-identified form. The copy now also names your open offers, and, where paperwork is in use, that issued orders are kept as the record of an engagement. It no longer claims your details are removed from documents that keep them.',
      de: 'Deine Buchungshistorie bleibt bei der Organisation, in anonymisierter Form. Der Text nennt jetzt auch deine offenen Angebote, und, wo Papierkram im Einsatz ist, dass ausgestellte Engagementverträge als Nachweis eines Engagements aufbewahrt werden. Er behauptet nicht mehr, deine Daten würden aus Dokumenten entfernt, die sie behalten.',
    },
  },
  {
    id: 'R5.5', role: 'artist', stage: 5, status: 'ok', surface: 'Organization switcher', updated: '2026-08-14',
    q: { en: 'I work with two organizations. Which one am I looking at?', de: 'Ich arbeite mit zwei Organisationen. Welche sehe ich gerade?' },
    a: {
      en: 'The switcher at the top of the sidebar names it, and switching keeps you on the same kind of page.',
      de: 'Der Umschalter oben in der Sidebar nennt sie, und beim Wechseln bleibst du auf der gleichen Art von Seite.',
    },
  },
  {
    id: 'R5.6', role: 'artist', stage: 5, status: 'new', surface: 'Page guide', updated: '2026-08-14',
    q: { en: 'What is the panel at the top of Availability, and can I hide it?', de: 'Was ist das Panel oben in der Verfügbarkeit, und kann ich es ausblenden?' },
    a: {
      en: 'It is the page guide: a short, four-step explainer of how that page works and which step is yours. Hide dismisses it for that page in this browser and leaves a slim bar you can Resume from.',
      de: 'Das ist der Seitenüberblick: ein kurzer Vierschritt-Erklärer, wie die Seite funktioniert und welcher Schritt deiner ist. Mit Ausblenden verschwindet er für diese Seite in diesem Browser, und es bleibt eine schmale Leiste, über die du ihn wieder einblenden kannst.',
    },
  },
] as const;
