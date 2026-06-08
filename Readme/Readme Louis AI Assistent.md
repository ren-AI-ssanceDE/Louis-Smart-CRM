# 🤖 Wiki: Louis AI Assistent — Der CRM Copilot

**Louis AI** ist das Herzstück des intelligenten CRM. Es handelt sich um ein hochentwickeltes KI-System, das tief in die Datenbankschichten, die Mailing-Schnittstellte und die E-Rechnungs-Engine integriert ist. 

Statt starren Buttons und Formularen ermöglicht Louis AI die Steuerung des gesamten CRM über natürliche Sprache.

---

## 🎨 1. Benutzer-Schnittstelle (`src/pages/LouisAi.tsx`)

Das AI-Portal bietet ein interaktives, kollaboratives Interface, das auf maximale Benutzerfreundlichkeit ausgelegt ist:
* **Echtzeit-Chat**: Schnelle Spracheingaben und direkte, gestaffelte Antworten der KI.
* **Prozess-Visualisierung**: Der Benutzer sieht zu jedem Zeitpunkt, in welchem Zustand sich Louis befindet (*"Louis überlegt..."*, *"Louis sucht in lokalen Dokumenten..."*). Dadurch wird das "Black Box"-Problem von KI-Anwendungen aufgehoben.
* ** proposedChanges Panel**: Auf der rechten Bildschirmseite befindet sich die Kontrollinstanz. Alle Datenmanipulationen, die Louis vorschlägt (z.B. neue Kundenkontakte oder Rechnungsentwürfe), werden hier übersichtlich als Karten gelistet.

---

## 🔁 2. Funktionsweise des ReAct-Agentenloops

Im Hintergrund läuft ein ReAct (*Reasoning & Acting*) Protokoll, das auf Googles Gemini-Modellen basiert:

```
                  ┌──────────────────────────────┐
                  │   Benutzer: "Schreibe eine   │
                  │    Rechnung an Firma X"      │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 1. REASONING (Nachdenken)    │
                  │ "Ich muss Firma X in der DB  │
                  │  suchen und Daten laden."    │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 2. ACTING (Werkzeugaufruf)   │
                  │ Tool: `crm_data_analyst`     │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 3. OBSERVATION (Ergebnis)    │
                  │ "Firma X gefunden, ID: ...   │
                  │  Zahlungsziel: 14 Tage."     │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │  (Zweiter Loop-Durchlauf:    │
                  │   Erstelle Rechnungsentwurf) │
                  └──────────────────────────────┘
```

Dieser Loop wiederholt sich autonom, bis die Kundenanweisung vollständig abgearbeitet wurde. Der Agent bricht nach einer vordefinierten Anzahl an Schritten (Max 10) ab, um Endlosschleifen zu unterbinden.

---

## 🔎 3. Louis QA Critic (Plausibilitätsprüfung)

Jeder vom Agenten erzeugte Beleg durchläuft vor dem Speichern den **Louis QA Critic** (`src/server/ai/critic.ts`). Das ist ein deterministischer Software-Layer, gekoppelt an ein Validierungs-LLM:

1. **Mathematische Revision**: Gibt es Rechenfehler auf Positionsebene? Stimmen Zwischensummen und Gesamtbruttobeträge überein?
2. **Compliance Check**: Fehlen erforderliche Angaben (wie Steuernummern oder IBAN) für die rechtsgültige E-Rechnung?
3. **Halluzinationsschutz**: Weicht die IBAN von den Systemeinstellungen ab? Falls Unstimmigkeiten gefunden werden, korrigiert Louis den Entwurf selbstständig oder bittet den Benutzer um manuelle Nachbesserung.

---

## 🤝 4. Human-in-the-Loop Freigabeprozess

Kritische Aktionen werden aus Sicherheitsgesründen **niemals** vollautomatisch ausgeführt:
* **Entwurf-Status**: Louis AI speichert Rechnungen und E-Mails stets im Status `draft` (Entwurf).
* **Manuelle Freigabe**: Der Benutzer muss jeden Vorschlag im `proposedChanges`-Panel explizit durch Klick auf **"Freigeben"** oder **"Ablehnen"** verifizieren. Erst nach der Freigabe wird das Dokument gebucht, das PDF erzeugt oder die E-Mail über SMTP versendet. This schützt das Unternehmen vor kostspieligen Fehlbuchungen oder fehlerhafter Kundenkommunikation.
