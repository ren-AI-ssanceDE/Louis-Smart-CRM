# 📝 KI-Textgenerierung & Dialogsteuerung

> Louis kann für Sie **Briefe, E-Mails und Erinnerungen formulieren** — im gewünschten Ton, mit den richtigen Kundendaten, und Sie behalten die Endkontrolle. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist die KI-Textgenerierung?

Ein praktischer „Schreibassistent“: Sie sagen Louis, **worüber und in welchem Ton** geschrieben werden soll — Louis entwirft den Text. Sie können ihn dann direkt bearbeiten, verfeinern oder übernehmen.

## So funktioniert es

1. **Thema wählen** — z. B. „Zahlungserinnerung“, „Dankschreiben“, „Angebotsbegleitung“.
2. **Ton wählen** — mit einem Klick:
   * 🍃 **Freundlich** — für partnerschaftliche Beziehungen, erste Erinnerungen
   * 🏢 **Professionell** — der sachliche Standard für den Geschäftsverkehr
   * ⚠️ **Mahnend** — höflich, aber bestimmt bei überfälligen Beträgen
   * 💡 **Kreativ / Locker** — für Marketingaktionen oder informelle Absprachen
3. **Kontext kommt automatisch mit** — Louis kennt den Kunden, den offenen Betrag, die Rechnungsnummer und das Fälligkeitsdatum und baut sie in den Text ein. Sie müssen nichts tippen.
4. **Entwurf bearbeiten** — Sie können den Text ändern oder Louis verfeinern lassen:
   * *„Mache den Text etwas kürzer.“*
   * *„Füge hinzu, dass wir bis zum 15.06. im Betriebsurlaub sind.“*
5. **Übernehmen** — mit einem Klick landet der Text im E-Mail-Formular (oder der Vorlage).

## Wichtig zu wissen

* **Sie entscheiden immer:** Der generierte Text ist ein Entwurf — nichts wird automatisch versendet.
* **Vorlagen zuerst:** Wenn Sie eine firmeneigene Vorlage haben (mit Bankverbindung, rechtlichen Klauseln), verwendet Louis diese als Basis und verbessert nur die Formulierung. Ihre wichtigen Bausteine bleiben erhalten.
* **Datenschutz:** Der Kontext (Kunde, Beträge) wird nur für die Text-Erstellung verwendet und nicht anderweitig weitergegeben.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Das Generierungs-Interface (`AiTextGeneratorDialog`)

Der Dialog kann aus verschiedenen Bereichen der Anwendung aufgerufen werden (E-Mail-Versand, Vorlagenverwaltung, Angebote):

* **Thema definieren**: Auswahl des Schreibens (z. B. „Zahlungserinnerung“, „Dankschreiben“).
* **Tonalität (Tones)**:
  * 🍃 **Freundlich** — partnerschaftliche Beziehungen, erste Erinnerungen
  * 🏢 **Professionell** — sachlicher B2B-Standardton
  * ⚠️ **Mahnend** — höflich, aber bestimmt bei überfälligen Beträgen
  * 💡 **Kreativ / Locker** — Marketingaktionen, informelle Absprachen
* **Kontext-Einspeisung**: Der Dialog extrahiert im Hintergrund Kunden- und Rechnungskontext (Name, offener Betrag, Rechnungsnummer, Fälligkeitsdatum) und speist ihn in das Modell ein.

## 2. Technischer Generierungsprozess (Backend)

Die Generierung läuft über den tRPC-Endpunkt `generateCrmText` bzw. `getTextGeneratorConfig` (`src/server/routers/louisAi.ts` / `settings.ts`).

### Prompt-Struktur (Beispiel)
```typescript
const systemPrompt = `
Du bist Louis, der intelligente Schreibassistent für Louis Smart CRM.
Generiere einen überzeugenden CRM-Text basierend auf den Vorgaben des Benutzers.
Berücksichtige folgende Parameter:
- Tonalität: ${tone}
- Empfänger: ${recipientName}
- Zusatzkontext: ${context}

Regeln:
1. Schreibe direkt im finalen Wortlaut, ohne Vorbemerkungen wie "Hier ist Ihr Text...".
2. Verwende korrekte Grammatik und fehlerfreie Rechtschreibung (Deutsch).
3. Halte dich an bewährte geschäftliche Kommunikationsstandards.
`;
```

## 3. Dynamische Platzhalter-Ersetzung

Vor dem Rendern im Mail-Formular ersetzt das System Variablen automatisch:

* `{first_name}` / `{last_name}` — Ansprechpartner
* `{company_name}` — Kundenunternehmen
* `{invoice_number}` — Belegnummer
* `{due_date}` — Fälligkeitsdatum
* `{total_amount}` — Brutto-Zahlbetrag

Weitere Details: [Readme Vorlagen](Readme%20Vorlagen.md).

## 4. Qualitätssicherung & Bearbeitung

Nach der KI-Generierung kann der Anwender im Editor:
1. Den Text direkt manuell bearbeiten.
2. Einen **Verfeinerungs-Prompt** eingeben (z. B. „Mache den Text etwas kürzer“, „Erwähne unseren Betriebsurlaub bis 15.06.“).
3. Die Änderungen per Klick in das übergeordnete Mail-/Angebotsformular übernehmen.

## 5. KI-Tool `text_generator`

Der Agent kann Texte direkt über das System-Tool `text_generator` (Domäne `CORE`) erzeugen — eine hochgradig konfigurierbare Text- & Branding-Engine, die dieselben Tonalitäts- und Kontextparameter nutzt. Generierte Inhalte landen als Vorschlag/Entwurf (Draft-Flow), nie direkt im Postausgang.
