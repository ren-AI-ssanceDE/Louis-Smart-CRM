# 📝 Wiki: KI-Textgenerierung & Dialogsteuerung

Die Erstellung von Kundenanschreiben, E-Mail-Texten und Zahlungserinnerungen wird in **Louis Smart CRM** über ein integriertes Vorlagen- und KI-Generierungs-Interface gesteuert. 

---

## 🎨 1. Das Generierungs-Interface (`src/components/AiTextGeneratorDialog.tsx`)

Das Herzstück der manuellen KI-Textunterstützung im CRM ist der `AiTextGeneratorDialog`. Dieser Dialog kann aus verschiedenen Bereichen der Anwendung (z.B. beim E-Mail-Versand oder der Vorlagenverwaltung) aufgerufen werden.

### Funktionsweise:
* **Thema definieren**: Der Benutzer wählt aus, worum es in dem Schreiben gehen soll (z.B. *"Zahlungserinnerung"* oder *"Dankschreiben"*).
* **Tonalität (Tones)**: Über Schnellwahl-Schaltflächen kann die Stimmung des Textes dynamisch angepasst werden:
  * 🍃 **Freundlich**: Für partnerschaftliche Kundenbeziehungen und erste Erinnerungen.
  * 🏢 **Professionell**: Der sachliche Standardton für den B2B-Geschäftsverkehr.
  * ⚠️ **Mahnend**: Höflich, aber bestimmt zur Einforderung überfälliger Beträge.
  * 💡 **Kreativ / Locker**: Für Marketingaktionen oder informelle Absprachen.
* **Kontext-Einspeisung**: Der Dialog extrahiert im Hintergrund den aktuellen Kunden- und Rechnungs-Kontext (Name des Kontakts, ausstehender Betrag, Rechnungsnummer, Fälligkeitsdatum) und füttert das Gemini-Modell damit, sodass stets maßgeschneiderte Texte entstehen.

---

## 🏗️ 2. Technischer Generierungsprozess im Backend

Die eigentliche Textgenerierung läuft über den tRPC-Endpunkt `generateCrmText` in `/src/server/routers/settings.ts` oder `/src/server/routers/louisAi.ts`.

### Prompts-Strukturierung (Beispiel):
Das Backend schickt einen reichhaltigen System-Prompt an das Gemini-Modell, der die Rahmenbedingungen festlegt:
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
2. Verwende eine korrekte Grammatik und fehlerfreie Rechtschreibung (Deutsch).
3. Halte dich an bewährte geschäftliche Kommunikationsstandards.
`;
```

---

## 🔁 3. Dynamische Platzhalter-Ersetzung

Um die Texte noch feiner abzustimmen, können auch vordefinierte Platzhalter in die Vorlagen eingebunden werden. Das System ersetzt diese Variablen vor dem Rendern im Mail-Formular automatisch:

* `{first_name}` / `{last_name}`: Name des Ansprechpartners.
* `{company_name}`: Name des Kunden-Unternehmens.
* `{invoice_number}`: Die zugehörige Belegnummer.
* `{due_date}`: Das Fälligkeitsdatum der Forderung.
* `{total_amount}`: Der Brutto-Zahlbetrag der Rechnung.

---

## 📈 4. Qualitätssicherung & Bearbeitung

Nachdem die KI den Text generiert hat, wird dieser im Editor-Fenster des Dialogs geladen. Der Anwender kann:
1. Den Text direkt manuell bearbeiten.
2. Einen Verfeinerungs-Prompt eingeben (z.B. *"Mache den Text etwas kürzer"* oder *"Füge hinzu, dass wir bis zum 15.06. im Betriebsurlaub sind"*).
3. Die Änderungen mit einem Klick in das übergeordnete Mail-Fenster übernehmen.
