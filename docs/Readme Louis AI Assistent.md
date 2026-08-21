# 🤖 Louis AI Assistent — Der CRM Copilot

> **Louis** ist der eingebaute KI-Assistent von Louis Smart CRM: Sie schreiben oder sprechen mit ihm in normaler Sprache — er erledigt Aufgaben im CRM und legt Ihnen alles zur Freigabe vor. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was kann Louis für Sie tun?

Louis ist wie ein sehr gut informierter **Mitarbeiter, der nie schläft** — aber nur mit Ihrer Erlaubnis handelt:

| Sie sagen … | Louis tut … |
|---|---|
| „Lege einen neuen Kontakt Julia Sommer an, E-Mail julia@sommer.de“ | Erstellt einen Kontakt-**Entwurf** → Sie geben frei |
| „Schreibe eine Rechnung an die Acme AG über 5 Stunden Beratung à 150 €“ | Erstellt einen Rechnungs-**Entwurf** (inkl. MwSt-Berechnung) → Sie geben frei |
| „Welche Rechnungen sind überfällig?“ | Sucht und fasst zusammen (reine Auskunft, sofort) |
| „Erinnere mich: Julia Sommer ist im August im Urlaub“ | Speichert eine Notiz am Kontakt |
| „Erstelle eine freundliche Zahlungserinnerung an die Müller GmbH“ | Formuliert den Text, legt einen E-Mail-**Entwurf** an → Sie geben frei |
| „Lege ein Kanban-Board ‚ToDo‘ an“ | Erstellt ein Board mit Spalten → Sie geben frei |

## Das wichtigste Prinzip: Human-in-the-Loop

> **Louis kann NICHTS von alleine speichern, buchen oder versenden.**

Jede Änderung erscheint als **Freigabe-Karte** („proposedChanges“) — Sie sehen genau, was Louis vorhat (z. B. „Neuer Kontakt: Julia Sommer, julia@sommer.de“) und klicken **Freigeben** oder **Ablehnen**. Nur was Sie freigeben, wird Wirklichkeit.

## Was Sie im Chat sehen

* **Echtzeit-Status:** Louis zeigt an, was er gerade tut („Louis sucht in Dokumenten…“) — keine Black Box.
* **Gedankenprotokoll:** Sie können die Denkschritte von Louis einsehen („Louis hat die Firma Acme AG gefunden, Zahlungsziel 14 Tage“).
* **Freigabe-Panel:** rechts im Chat liegen alle Vorschläge, die auf Ihre Entscheidung warten.

## Zusätzliche Fähigkeiten

* **Dateien hochladen:** Sie können Louis Dokumente schicken (Rechnungen, Verträge, PDFs) — er liest sie und merkt sich den Inhalt für spätere Fragen (Wissensdatenbank).
* **Sprachbefehle:** Sprechen Sie mit Louis — er versteht Sie (Spracherkennung, siehe [Readme Sprachsteuerung](Readme%20Sprachsteuerung%20(Voice%20%26%20STT).md)).
* **Gedächtnis:** Louis merkt sich dauerhafte Präferenzen („Ich bevorzuge 14 Tage Zahlungsziel“) — einstellbar und löschbar.
* **Rückfragen:** Wenn Louis etwas nicht weiß, **fragt er Sie** statt zu raten.

## Einrichtung

Louis ist nach der Installation sofort verfügbar (Google-Gemini-Schlüssel in der Konfiguration erforderlich). Im **Admin-Bereich → Louis AI** können Sie Modell, Temperatur und Verhalten anpassen.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Benutzer-Schnittstelle (`src/pages/LouisAi.tsx`)

* **Echtzeit-Chat**: Spracheingaben mit gestaffelten Antworten; Statusanzeigen („Louis überlegt…“, „Louis sucht in Dokumenten…“) machen den Prozess transparent (kein Black Box).
* **Gedankenprotokoll-Inspektor (Thought Log)**: Der Benutzer sieht die Reasoning-Schritte des Agenten.
* **proposedChanges-Panel**: Alle Datenmanipulationen (Kontakte, Firmen, Rechnungen, Angebote, Notizen, E-Mails) erscheinen als Freigabe-Karten — **Freigeben / Ablehnen** per Klick.
* **Datei-Upload & RAG**: Dateien direkt im Chat hochladen (`/api/chat`, Multer) — sie werden automatisch in den Wissensspeicher indexiert.
* **Sprachsteuerung**: Audio-Aufnahme im Chat (Whisper-STT, siehe [Readme Sprachsteuerung](Readme%20Sprachsteuerung%20(Voice%20%26%20STT).md)).
* **i18n**: Komplett zweisprachig (DE/EN).

## 2. Funktionsweise des ReAct-Agentenloops

```
                  ┌──────────────────────────────┐
                  │   Benutzer: "Schreibe eine   │
                  │    Rechnung an Firma X"      │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 1. CONTEXT SETUP             │
                  │  Historie, Mandant, Datum,   │
                  │  Tool-Budget                 │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 2. REASONING (Decider)       │
                  │  Fast-Path: nur benötigte    │
                  │  Tool-Domänen aktivieren     │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 3. ACTING (Tool-Call)        │
                  │  z. B. list_companies →      │
                  │  create_invoice_draft        │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 4. OBSERVATION + CRITIC      │
                  │  (Mathematik, Compliance,    │
                  │   IBAN-Konsistenz)           │
                  └──────────────┬───────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 5. HUMAN APPROVAL            │
                  │  proposedChanges → Freigabe  │
                  └──────────────────────────────┘
```

* Der Loop wiederholt sich autonom (max. **5 Iterationen**), bis die Anweisung abgearbeitet ist.
* **Malformed-Tool-Calls** werden durch den `toolCallSanitizer.ts` abgefangen (XML-Bereinigung, robustes Parsing).

## 3. Tool-Katalog (Überblick)

| Domäne | Tools |
|---|---|
| `CORE` | `crm_data_analyst`, `text_generator`, `update_memory`, `verify_subtask`, `ask_user_question` |
| `CRM_READ` | `list_companies`, `list_contacts`, `list_invoices`, `list_notes`, `list_mail_drafts` |
| `CRM_WRITE` | `create_company_draft`, `create_contact_draft`, `create_invoice_draft`, `create_offer_draft`, `create_note_draft`, `update_company_draft`, `update_contact_draft`, `update_invoice_draft`, `update_offer_draft`, `update_note`, `delete_note`, `finalize_and_send_offer`, `send_smtp_email` |
| `KNOWLEDGE` | `web_search`, `knowledge_write`, `knowledge_update`, `knowledge_delete`, `list_knowledge_files`, `knowledge_search`, `recall_sessions`, `vault_read`, `vault_search` |
| `KANBAN` | `list_kanban_boards`, `get_kanban_board_details`, `create_kanban_board`, `create_kanban_card`, `update_kanban_card`, `move_kanban_card`, `delete_kanban_card` |
| `TEMPLATES` | `get_templates`, `get_template_details`, `apply_template` |
| `WORKFLOWS` | `learn_workflow`, `get_workflows`, `save_skill`, `delegate_subtask` (Sub-Agents, max. 3 parallel) |
| **MCP (dynamisch)** | Externe Tools via `mcp_<server>__<tool>` (Namespace-Mapping) |

## 4. QA-Critic (`critic.ts`)

Jeder erzeugte Beleg durchläuft vor dem Speichern den **Louis QA Critic**:
1. **Mathematische Revision**: Positionsfehler, Zwischensummen, Bruttobeträge.
2. **Compliance-Check**: Pflichtangaben (Steuernummern, IBAN) für die rechtsgültige E-Rechnung.
3. **Halluzinationsschutz**: IBAN-Abweichungen von den Systemeinstellungen werden korrigiert oder an den Benutzer zurückgegeben.
4. **Compliance-LLM-Pass**: Tonfall, Vollständigkeit, DSGVO/Rechtskonformität des Antwortentwurfs.

## 5. Human-in-the-Loop Freigabeprozess (einheitlicher Draft-Flow)

* **Alle** schreibenden KI-Aktionen (Kontakt, Firma, Rechnung, Angebot, Notiz, E-Mail, Update) erzeugen **nur** einen Freigabe-Entwurf — kein direkter DB-Write.
* Die Freigabe (`approveProposal`) übernimmt die **vollständigen Felder** aus dem Vorschlag in die Datenbank (inkl. Opt-ins, Adressen, Zahlungsbedingungen).
* Erst nach Freigabe wird gebucht, PDF erzeugt oder E-Mail versendet.
* Workflow-Instanzen pausieren bei Bedarf im Zustand `WAITING_FOR_DRAFT_APPROVAL`, bis ein Mensch entscheidet.

## 6. Erweiterte Fähigkeiten

* **Langzeitgedächtnis**: `update_memory` / `getUserMemory` (Benutzerpräferenzen, Notizen).
* **Session-Recall**: `recall_sessions` durchsucht vergangene KI-Sessions per Volltextsuche (gewichtete `ts_rank` + Recency-Bonus über die generierte Spalte `history_searchable_text`).
* **Skills**: `save_skill` legt Wissens-Skills im Vault an (Freigabe erforderlich).
* **Sub-Agents**: `delegate_subtask` parallelisiert Teilaufgaben in isolierten Agenten (read-only).
* **Rückfragen**: `ask_user_question` persistiert Rückfragen an den Benutzer (Governance).
* **Council**: Für komplexe Entscheidungen kann Louis einen Multi-Model-Rat einberufen (siehe [Readme Council Engine](Readme%20Council%20Engine.md)).
* **MCP**: Externe MCP-Server-Tools werden nahtlos in den Katalog gemerged (siehe [Readme MCP](Readme%20Model%20Context%20Protocol%20(MCP).md)).
* **Chatprofile** (seit 2.1.0): Profil-Auswahl im Chat-Header (z. B. Main/Schalter) mit eigener Tool-Auswahl und eigenem Verlauf; Warm-Resume lädt beim Öffnen die letzte Session des Default-Profils. Freigaben + Tool-Konfiguration im Admin (Tab „Chatprofile“).
* **Kontext-Kompression & Session-Rotation** (seit 2.1.0): Lange Gespräche werden automatisch zusammengefasst — die bisherige Session wird zur abgeschlossenen Eltern-Session, eine Kind-Session übernimmt die getrimmte History. Während der Kompression zeigt der Chat den Hinweis „🗜️ Louis komprimiert den Verlauf…“.

## 7. Konfiguration (Admin)

* **Provider/Modell**: Gemini-API-Key + Modellwahl; alternative lokale Modelle (Ollama/OpenAI-kompatibel) über `localModelClient`.
* **Inference-Einstellungen**: Temperatur, Token-Budget, Tool-Auswahl — im Admin-Panel (`LouisAiSettingsForm`, `GovernanceRulesTab`).
* **Token-Überwachung**: `getTokenUsageStats` (Admin-Tab „Token-Verbrauch“, paginiert).
* **Agent-Jobs**: zeitgesteuerte Script-/Monitor-Jobs (siehe [Readme Agent-Jobs](Readme%20Agent-Jobs.md)).
