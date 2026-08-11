# Datenschutzerklärung

_Stand: 11. August 2026_

Diese Datenschutzerklärung erläutert, wie ShowFlow Pro ("**wir**", "**uns**", "**ShowFlow Pro**") personenbezogene Daten verarbeitet, wenn Sie die Web-Anwendung von ShowFlow Pro und die zugehörigen transaktionalen E-Mails (zusammen der "**Dienst**") nutzen. Sie ist nach den Anforderungen der Artikel 12–14 der Datenschutz-Grundverordnung (DSGVO) und § 25 des Telekommunikation-Telemedien-Datenschutz-Gesetzes (TTDSG) verfasst.

Bei Abweichungen zwischen dieser deutschen Fassung und der englischen Übersetzung ist die deutsche Fassung maßgeblich.

---

## 1. Verantwortlicher

Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO ist:

**ShowFlow Pro**
Pohlstr. 82
10785 Berlin
Deutschland

E-Mail: contact@showflow.pro

Wir haben keinen Datenschutzbeauftragten benannt, da wir hierzu nach Art. 37 DSGVO nicht verpflichtet sind. Sie erreichen die für den Datenschutz verantwortliche Person unter der oben genannten E-Mail-Adresse.

---

## 2. Geltungsbereich

Diese Erklärung gilt für:

- die ShowFlow-Pro-Web-Anwendung unter unseren Domains,
- die transaktionalen E-Mails, die wir Ihnen senden (Angebote, Bestätigungen, Zusammenfassungen, Kontomeldungen), sowie
- die In-App-Nachrichten- und Benachrichtigungsfunktionen des Dienstes.

Sie gilt **nicht** für Websites Dritter, auf die wir verlinken, oder für die Nutzung eigener Instanzen des Dienstes durch andere Organisationen, mit denen Sie als externer Gast interagieren.

---

## 3. Kategorien personenbezogener Daten

Wir verarbeiten ausschließlich Daten, die wir für den Betrieb des Dienstes benötigen. Die Kategorien entsprechen unserem Datenbankschema.

### 3.1 Konto und Authentifizierung
Aus den Tabellen `profiles`, `user_roles` und `user_approvals`: Ihre Nutzer-ID, E-Mail-Adresse, Anzeigename, Telefonnummer (optional), Avatar-URL, die bei der Registrierung beantragte Rolle (Admin, Producer oder Artist) sowie Status, Grund und Zeitpunkt der Admin-Entscheidung über Ihre Freigabe.

### 3.2 Artist-Daten
Aus den Tabellen `artists`, `artist_skills` und `availability`: Künstlername, E-Mail, Telefon, Biografie (Freitext), verknüpfte Skills sowie die Termine, an denen Sie sich als verfügbar, nicht verfügbar oder vorbehaltlich verfügbar erklärt haben, einschließlich etwaiger Wiederholungsregeln.

### 3.3 Buchungsdaten
Aus den Tabellen `bookings` und `booking_audit_log`: Zuordnungen von Artists zu Showterminen, Statusänderungen (vorgeschlagen, vorgemerkt, bestätigt, storniert), Freitextnotizen, Stornierungsgründe, die handelnde Person und Zeitstempel. Das Audit-Log wird als manipulationssicheres Änderungsprotokoll vorgehalten.

### 3.4 Kommunikation
Aus den Tabellen `chats`, `chat_messages` und `notifications`: Inhalt und Metadaten Ihrer Nachrichten in den pro Showtermin geführten Chats sowie an Sie gerichtete In-App-Benachrichtigungen.

### 3.5 E-Mail-Zustellbarkeit
Aus den Tabellen `email_send_log`, `suppressed_emails` und `email_unsubscribe_tokens`: ein Protokoll der an Sie gesendeten transaktionalen E-Mails (Template, Status, Message-ID), von unserem E-Mail-Provider zurückgemeldete Bounce- und Beschwerdesignale sowie von Ihnen verwendete Abmelde-Token.

### 3.6 Technische Daten und Logs
Server-Zugriffs-Logs unserer Hosting- und Datenbank-Provider (Vercel, Supabase), typischerweise IP-Adresse, User-Agent, aufgerufene URL, Antwortstatus und Zeitstempel. Mit Ihrer Einwilligung erhalten wir zusätzlich clientseitige Fehlerberichte über Sentry (Stack-Traces, Browser, Betriebssystem, Nutzer-ID) sowie Produktanalyse-Events über PostHog (Seitenaufrufe, Klicks, Funktionsnutzung). Bei Einwilligung in Session-Replay zeichnet PostHog zusätzlich eine anonymisierte Aufzeichnung Ihrer Interaktionen mit dem Dienst auf.

### 3.7 Besondere Kategorien (Art. 9 DSGVO)
Wir erheben **keine** besonderen Kategorien personenbezogener Daten (z. B. Gesundheit, rassische oder ethnische Herkunft, religiöse Überzeugungen, sexuelle Orientierung, biometrische Daten). Bitte geben Sie solche Informationen nicht in Freitextfelder wie Artist-Biografie, Buchungsnotizen oder Chatnachrichten ein.

---

## 4. Zwecke und Rechtsgrundlagen

| Nr. | Zweck | Kategorien | Rechtsgrundlage |
|---|---|---|---|
| a | Bereitstellung des Dienstes: Konto, Authentifizierung, rollenbasierter Zugriff, Anzeige von Shows/Terminen/Verfügbarkeit, Buchungsabwicklung, Versand transaktionaler E-Mails. | 3.1–3.5 | Art. 6 Abs. 1 lit. b DSGVO — Vertragserfüllung. |
| b | Admin-Freigabe und Rollenvergabe für neue Konten. | 3.1 | Art. 6 Abs. 1 lit. b DSGVO und Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Verhinderung unbefugter Zugriffe auf Producer-/Admin-Funktionen. |
| c | Betrieb des In-App-Chats je Showtermin. | 3.4 | Art. 6 Abs. 1 lit. b DSGVO. |
| d | Führung des Buchungs-Audit-Logs und Missbrauchsprävention. | 3.3 | Art. 6 Abs. 1 lit. c DSGVO (Aufbewahrungspflichten) und Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Aufklärung von Streitfällen und Sicherheitsvorfällen. |
| e | E-Mail-Zustellbarkeit (Bounce-/Beschwerdebearbeitung, Abmeldungen). | 3.5 | Art. 6 Abs. 1 lit. c DSGVO (Art. 21 DSGVO) und Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse an der Reputation als Absender. |
| f | Hosting- und Infrastruktur-Logs. | 3.6 | Art. 6 Abs. 1 lit. f DSGVO — berechtigtes Interesse am Betrieb, der Sicherheit und der Fehleranalyse des Dienstes. |
| g | Clientseitige Fehlerverfolgung (Sentry). | 3.6 | Art. 6 Abs. 1 lit. a DSGVO — Einwilligung über das Cookie-Banner; jederzeit widerrufbar über „Cookie-Einstellungen verwalten". |
| h | Produktanalyse einschließlich Session-Replay (PostHog). | 3.6 | Art. 6 Abs. 1 lit. a DSGVO — Einwilligung über das Cookie-Banner. |
| i | Speicherung unbedingt erforderlicher Cookies (Supabase Auth/Session). | 3.6 | § 25 Abs. 2 Nr. 2 TTDSG — unbedingt erforderlich für den von Ihnen ausdrücklich gewünschten Dienst; in Verbindung mit Art. 6 Abs. 1 lit. b DSGVO für die zugrunde liegende Verarbeitung. |
| j | Speicherung nicht erforderlicher Cookies und ähnlicher Technologien (PostHog, Sentry). | 3.6 | § 25 Abs. 1 TTDSG — Einwilligung über das Cookie-Banner. |

Eine Interessenabwägung gemäß Art. 6 Abs. 1 lit. f DSGVO stellen wir auf Anfrage unter contact@showflow.pro zur Verfügung.

---

## 5. Empfänger und Auftragsverarbeiter

Personenbezogene Daten werden innerhalb des Dienstes nur nach dem Need-to-know-Prinzip an andere Nutzer weitergegeben, gesteuert durch rollenbasierte Zugriffskontrolle und Row-Level-Security-Richtlinien (Admins, für die jeweilige Show buchende Producer, sowie für den jeweiligen Showtermin in Frage kommende Artists).

Darüber hinaus setzen wir folgende Auftragsverarbeiter gemäß Art. 28 DSGVO ein:

| Auftragsverarbeiter | Leistung | Standort | Übermittlungsgrundlage |
|---|---|---|---|
| Supabase Inc. | Datenbank, Authentifizierung, Datei-Speicher, Edge Functions | USA und EU-Regionen | Nutzung der EU-Region, soweit verfügbar; Zertifizierung nach dem EU-US Data Privacy Framework (DPF) und EU-Standardvertragsklauseln (SCC) für US-Übermittlungen. |
| Resend, Inc. | Transaktionaler E-Mail-Versand | USA | DPF und SCC. |
| Vercel, Inc. | Hosting der Web-Anwendung und Edge-Netzwerk | USA und EU | DPF und SCC. |
| Google LLC | Auslieferung der Web-Schriften (Geist und Geist Mono, abgerufen von fonts.googleapis.com und fonts.gstatic.com) | USA | DPF und SCC. |
| Airtable, Inc. | Show-Datensynchronisation (derzeit deaktiviert; wird aktiviert, sobald die Airtable-Integration in Betrieb geht) | USA | DPF und SCC. |
| Functional Software, Inc. dba Sentry | Clientseitige Fehlerverfolgung | EU- und US-Regionen | EU-Region soweit verfügbar; DPF und SCC für US-Übermittlungen. |
| PostHog, Inc. | Produktanalyse und Session-Replay | EU- und US-Regionen | EU-Region soweit verfügbar; DPF und SCC für US-Übermittlungen. |

Die Web-Schriften werden bereits während des Seitenaufbaus abgerufen, also bevor eine Einwilligungsentscheidung gespeichert ist. Google erhält dadurch bei jedem Seitenaufruf Ihre IP-Adresse und Ihren User-Agent, auch auf den Seiten, die die Einwilligung abfragen. Der Abruf setzt kein Cookie und speichert nichts auf Ihrem Gerät.

Wir verkaufen keine personenbezogenen Daten und geben sie nicht an Werbenetzwerke weiter.

---

## 6. Übermittlungen in Drittländer

Einige unserer Auftragsverarbeiter sind in den USA niedergelassen. Bei Übermittlungen in Länder außerhalb des Europäischen Wirtschaftsraums stützen wir uns auf eine oder mehrere der folgenden Garantien nach Kapitel V DSGVO:

- den Angemessenheitsbeschluss der Europäischen Kommission vom 10. Juli 2023 zum EU-US Data Privacy Framework (sofern der Empfänger zertifiziert ist), oder
- die Standardvertragsklauseln der Europäischen Kommission vom 4. Juni 2021, gegebenenfalls ergänzt durch technische und organisatorische Maßnahmen (Verschlüsselung bei Übertragung und Speicherung, Pseudonymisierung von Nutzer-IDs).

Eine Kopie der einschlägigen Garantien stellen wir auf Anfrage unter contact@showflow.pro zur Verfügung.

---

## 7. Speicherdauer

Wir speichern Ihre personenbezogenen Daten nur so lange, wie es für die in dieser Erklärung beschriebenen Zwecke erforderlich ist:

- **Konto- und Profildaten:** für die Dauer Ihres Kontos zuzüglich 30 Tage nach Löschung, um versehentliche Löschungen wiederherstellen zu können.
- **Buchungen und Audit-Log:** drei (3) Jahre ab dem jeweiligen Showtermin, zur kaufmännischen Beweisführung und Streitbeilegung.
- **Chatnachrichten:** 30 Tage nach dem Showtermin in der Chat-Liste ausgeblendet (`CHAT_ARCHIVE_DAYS`); endgültige Löschung nach 12 Monaten. Die Datenbank gewährt Admins und dem Produktionsteam bis zur Löschung Zugriff auf einen Thread. Nach Ablauf des Archivzeitraums entfernt der Dienst den Thread für alle aus der Chat-Liste, zeigt Admins die Nachrichten nur noch lesend an und blendet die Nachrichten für das Produktionsteam aus.
- **E-Mail-Versandprotokoll und Sperrliste:** 24 Monate, zur Berücksichtigung Ihres Abmeldewunsches und zur Wahrung der Absenderreputation.
- **Hosting-/Supabase-Logs:** gemäß Standardrichtlinien unserer Anbieter (typischerweise 7–30 Tage).
- **Sentry-Fehlerberichte:** 90 Tage.
- **PostHog-Events und Session-Replays:** 12 Monate.
- **Sicherungen (Backups):** Aufbewahrung höchstens 30 Tage; in der Live-Datenbank gelöschte Daten werden innerhalb dieses Zeitraums auch aus Backups entfernt. Dies ist eine Höchstspeicherdauer und keine Zusage, dass 30 Tage wiederherstellbarer Sicherungen vorgehalten werden.

Nach Ablauf dieser Fristen werden die Daten gelöscht oder vollständig anonymisiert.

---

## 8. Ihre Rechte

Nach Maßgabe der Art. 15–22 DSGVO haben Sie das Recht auf:

- Auskunft (Art. 15),
- Berichtigung unrichtiger Daten (Art. 16),
- Löschung („Recht auf Vergessenwerden", Art. 17),
- Einschränkung der Verarbeitung (Art. 18),
- Datenübertragbarkeit (Art. 20),
- Widerspruch gegen auf berechtigte Interessen gestützte Verarbeitungen (Art. 21) sowie
- jederzeitigen Widerruf erteilter Einwilligungen, ohne dass die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung berührt wird (Art. 7 Abs. 3).

Zur Ausübung dieser Rechte wenden Sie sich bitte an **contact@showflow.pro**. Wir antworten innerhalb eines (1) Monats nach Art. 12 Abs. 3 DSGVO. Vor einer Auskunft können wir Ihre Identität überprüfen.

Die Einwilligung in nicht erforderliche Cookies (Analyse, Fehlerverfolgung, Session-Replay) können Sie jederzeit über den Link **„Cookie-Einstellungen verwalten"** im Footer der Login-Seite und im Cookie-Banner widerrufen.

---

## 9. Cookies und ähnliche Technologien

Der Dienst nutzt folgende Cookies und Local-Storage-Einträge:

| Name / Muster | Zweck | Kategorie | Speicherort | Dauer |
|---|---|---|---|---|
| `sb-*` | Supabase-Authentifizierungssitzung | Unbedingt erforderlich | localStorage / Cookies | Bis Abmeldung oder Ablauf der Sitzung |
| `showflow.consent.v1` | Ihre Cookie-Einwilligungsentscheidung | Unbedingt erforderlich | localStorage | 12 Monate |
| `ph_*` | PostHog-Analyse und Funktionsnutzung | Einwilligung (Analyse) | Cookies / localStorage | Bis 12 Monate |
| PostHog Session-Replay | Anonymisierte Aufzeichnung Ihrer Interaktionen | Einwilligung (Session-Replay, Unterkategorie Analyse) | Speicherung bei PostHog | 12 Monate |
| Sentry-SDK-Identifier | Verknüpfung von Fehlerberichten innerhalb einer Sitzung | Einwilligung (Fehlerverfolgung) | localStorage | Sitzung |

Unbedingt erforderliche Cookies bedürfen nach § 25 Abs. 2 Nr. 2 TTDSG keiner Einwilligung. Alle übrigen werden erst gesetzt, nachdem Sie ihnen im Cookie-Banner zugestimmt haben. Ihre Entscheidung können Sie jederzeit über „Cookie-Einstellungen verwalten" ändern.

---

## 10. Automatisierte Entscheidungsfindung

Der Dienst enthält eine Buchungsvorschlags-Engine, die vorschlägt, welchen Artists ein Showtermin angeboten werden soll. Diese Vorschläge sind **reine Entscheidungshilfen**. Ein menschlicher Producer prüft und bestätigt jede Buchung. Eine automatisierte Entscheidungsfindung im Sinne des Art. 22 DSGVO mit rechtlicher Wirkung oder ähnlich erheblicher Beeinträchtigung findet nicht statt.

---

## 11. Sicherheit

Zum Schutz personenbezogener Daten setzen wir u. a. folgende Maßnahmen ein:

- TLS-Verschlüsselung der Übertragung zwischen Ihnen und dem Dienst,
- Verschlüsselung im Ruhezustand in unserer Supabase-Postgres-Datenbank,
- Row-Level-Security-(RLS-)Richtlinien für rollenbasierte Zugriffe bei jedem Lese- und Schreibvorgang,
- Prinzip der geringsten Rechte für Admin- und Producer-Zugriffe sowie
- Security-Definer-Funktionen für sicherheitskritische Rollenprüfungen.

Kein System ist zu 100 % sicher. Wir melden Verletzungen des Schutzes personenbezogener Daten der zuständigen Aufsichtsbehörde innerhalb von 72 Stunden, soweit nach Art. 33 DSGVO geboten, und unterrichten gegebenenfalls Sie unmittelbar nach Art. 34 DSGVO.

---

## 12. Änderungen dieser Erklärung

Wir überprüfen diese Datenschutzerklärung regelmäßig. Das Datum oben gibt die letzte Änderung an. Wenn eine Änderung Ihre Rechte wesentlich berührt, weisen wir Sie im Dienst (z. B. per In-App-Benachrichtigung oder E-Mail) darauf hin und holen Ihre Cookie-Einwilligung erneut ein.

---

## 13. Beschwerden

Sie haben das Recht, bei einer Aufsichtsbehörde Beschwerde einzulegen. Zuständige Aufsichtsbehörde für ShowFlow Pro ist:

**Berliner Beauftragte für Datenschutz und Informationsfreiheit (BlnBDI)**
Friedrichstr. 219
10969 Berlin
Deutschland
Web: https://www.datenschutz-berlin.de/

Sie können sich auch an die Aufsichtsbehörde des EU-Mitgliedstaats Ihres gewöhnlichen Aufenthalts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes wenden.
