# ⚙️ Workflows & Tool-Integration

> Mit Workflows automatisieren Sie **wiederkehrende Abläufe** — ohne Programmierung. Sie bauen Prozesse aus Bausteinen zusammen, und Louis Smart CRM führt sie aus. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist ein Workflow?

Ein Workflow ist eine **automatisierte Abfolge von Schritten** — wie ein Rezept: „Wenn X passiert, dann mache Y und danach Z.“ Sie bauen das Rezept einmal im **visuellen Editor** zusammen (Kästen und Pfeile, per Maus), und das System führt es von da an automatisch aus — immer mit Ihrer Freigabe an kritischen Stellen.

## Beispiel: Der automatische Mahnlauf

```
Rechnung wird überfällig  →  Notiz in der Timeline  →  Kunde bekommt Label
„In Verzug“  →  E-Mail-Entwurf erstellen  →  🛑 SIE prüfen und geben frei  →  Versand
```

Sie sehen: Der Workflow erledigt die Vorarbeit, aber die **E-Mail geht erst nach Ihrer Freigabe raus**.

## Was können Workflows tun?

| Baustein | Beispiel |
|---|---|
| **Aktion** | E-Mail vorbereiten/versenden, Notiz schreiben, Label setzen, Kanban-Karte anlegen, Kontakt aktualisieren … (alle Louis-Tools) |
| **Bedingung** | „Wenn Betrag > 1.000 €, dann X — sonst Y“ |
| **Warten** | „Warte 3 Tage, dann weiter“ |
| **Menschliche Freigabe** | „Stopp und warte, bis ein Mitarbeiter freigibt“ |
| **Wissensabfrage (RAG)** | „Suche in unseren Dokumenten nach den Zahlungsbedingungen“ |
| **Rückfrage** | „Frage den Benutzer: Zahlungsziel 14 oder 30 Tage?“ |

## Wie startet ein Workflow? (Trigger)

1. **Manuell** — Sie klicken „Starten“ oder sagen Louis Bescheid.
2. **Automatisch bei Ereignis** — z. B. wenn eine Rechnung überfällig wird, ein Kontakt angelegt oder eine Kanban-Karte verschoben wird.
3. **Nach Zeitplan** — z. B. jeden Werktag um 08:30 Uhr (oder nach Cron-Regel, z. B. „monatlich am 1. um 9 Uhr“).

## Fertige Vorlagen nutzen

Unter **Admin → Louis AI Workflows** finden Sie 1-Klick-Starter: **Zahlungserinnerung**, **Angebot nachfassen**, **Onboarding**, **Overdue-Report**. Ein Klick — und der fertige Workflow ist da; Sie passen ihn nach Bedarf an.

## Testen ohne Risiko: „Trockenlauf“

Vor dem Aktivieren können Sie einen Workflow im **Trockenlauf (Simulation)** testen — er läuft komplett durch, ohne etwas zu verändern. So sehen Sie, ob alles korrekt verkettet ist.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Die DAG-Workflow-Engine

Seit August 2026 ist der **DAG-Graph der einzige Workflow-Pfad** (lineare Sequenzen werden beim Start automatisch in Graphen migriert — Abwärtskompatibilität).

### Knotentypen (Node-Typen)

| Typ | Bedeutung |
|---|---|
| `ACTION` | Führt ein Tool aus (z. B. `SendEmail`, `CreateNote`, `create_kanban_card`, alle Agent-Tools) |
| `CONDITIONAL` | Bedingte Verzweigung (If/Else über Fallback-Kante) |
| `WAIT` | Verzögerung (`delay_seconds`) oder Warten auf Zeitpunkt (`execute_at_utc`) |
| `HUMAN_GATE` | Pausiert, bis ein Mensch freigibt (`approveWorkflowHumanGate`) |
| `RAG` | Wissensabfrage (RAG) als dedizierter Schritt (`rag_enabled`, `rag_query`) |
| `ASK_USER` | Persistierte Rückfrage an den Benutzer (`ask_user_question`) |

### Eigenschaften eines Knotens (`IWorkflowNode`)
* `tool_identifier` — auszuführendes Tool (inkl. aller Agent-Tools)
* `instructions_template` — Instruktion mit Variablen `{{customer.name}}`
* `next_node_ids` — mehrere IDs erlauben **parallele Zweige (Fork)**
* `fallback_node_id` — Fehler-/Else-Pfad
* `model_selection` — dediziertes Modell für den Knoten
* `rag_enabled` / `rag_query` — RAG-Suche für den Schritt

### Engine-Komponenten
* **`workflowEngine.ts`** — Scheduler & Lebenszyklus (10-Sekunden-Heartbeat, Delayed Queue, Idempotenz-Guard)
* **`workflowGraphExecutor.ts`** — DAG-Ausführung (Topologie, Variablen-Interpolation, Fallback-Handling)
* **`workflowEventBus.ts`** — Ereignis-Bus (`entity.action`)
* **`workflowExecutor.ts`** — Schritt-Abarbeitung (E-Mail-Drafts, Labels, Notizen)

## 2. Die registrierten System-Tools (Kern)

1. **`crm_data_analyst`** — strukturierte DB-Abfragen & Aggregationen (Fuzzy-Suche, Stoppwort-Filter, Levenshtein im Fallback)
2. **`list_companies` / `list_contacts` / `list_invoices`** — Suche mit Paginierung & Fuzzy-Matching
3. **`create_company_draft` / `create_contact_draft` / `create_invoice_draft` / `create_offer_draft` / `create_note_draft`** — Entwurfs-Erzeugung (Draft-Flow)
4. **`update_company_draft` / `update_contact_draft` / `update_invoice_draft` / `update_offer_draft`** — Partial-Updates als Freigabe
5. **`finalize_and_send_offer`** — Angebot finalisieren + PDF erzeugen
6. **`send_smtp_email`** — E-Mail-Entwurf zur Freigabe (GoBD-konform, nie direkter Versand)
7. **`list_mail_drafts`** — E-Mail-Entwürfe auflisten (Status-Filter)
8. **`web_search`** — 4 Suchverfahren (Gemini Grounding, Google CSE, SearXNG, DuckDuckGo-Scraper mit Backoff)
9. **`local_knowledge` / `list_vault_files` / `vault_write` / `vault_update` / `vault_delete`** — Wissensvault (RAG, Path-Traversal-Schutz)
10. **`vault_search` / `vault_read`** — Obsidian-Vault-Zugriff (über das Obsidian-MCP, Local REST API Plugin)
11. **`recall_sessions`** — Volltextsuche über vergangene KI-Sessions
12. **`update_memory`** — Langzeitgedächtnis (Präferenzen/Notizen)
13. **`save_skill`** — Wissens-Skill im Vault anlegen (Freigabe)
14. **Kanban-Tools** — `list_kanban_boards`, `get_kanban_board_details`, `create_kanban_board`, `create/update/move/delete_kanban_card`
15. **Vorlagen-Tools** — `get_templates`, `get_template_details`, `apply_template`
16. **Workflow-Tools** — `learn_workflow`, `get_workflows`, `delegate_subtask` (Sub-Agents), `verify_subtask`, `ask_user_question`

> **Governance:** Schreibende Tools (CREATE/UPDATE/DELETE) sind in der `WRITE_ACTION_MAP` registriert; Aktionen laufen über `proposedChanges` bzw. Human-Gates. Lese-Tools (READ) sind sofort ausführbar.

## 3. Workflow-Verwaltung (Admin)

* **Editor**: `src/components/admin/DagWorkflowEditor.tsx` — React-Flow-Canvas mit Palette, Kanten, Zyklen-Validierung, Auto-Layout, „Linear → DAG“-Konvertierung.
* **Tool-Picker**: Alle Agent-Tools als Workflow-Schritte (i18n-Labels DE/EN).
* **Versionierung**: `skill_version` + `version_history` (Changelog pro Workflow).
* **Vorlagen-Bibliothek**: 1-Klick-Starter — `Zahlungserinnerung`, `Angebot nachfassen`, `Onboarding`, `Overdue-Report`.
* **Dry-Run/Simulation**: `dryRunWorkflow` führt einen Workflow ohne Seiteneffekte aus — ideal zum Testen.
* **Trigger**: Siehe [Readme Workflow-Triggers](Readme%20Workflow-Triggers.md).

## 4. Workflow-Executor & Schritt-Abarbeitung

### Unterstützte Schritt-Aktionen
* **Mailing (`SendEmail` / `send_smtp_email`)**:
  * `direct_send_email: true` → sofortiger SMTP-Versand + Dateisystem-Archivierung
  * `direct_send_email: false` → Draft (`PENDING`) + Zustand `WAITING_FOR_DRAFT_APPROVAL`; Fortsetzung nach Freigabe im `EmailDraftsApprovalPanel`
  * RAG-Integration: gesendete E-Mails werden als Interaktionsverlauf indexiert
* **Labeling (`AddLabel` / `UpdateContactLabels`)**: Tags mit automatischer De-Duplizierung
* **Timeline-Notizen (`CreateEntityNote`)**: strukturierte Notizen + auditierbare Events
* **Alle Agent-Tools**: DAG-Knoten können jedes System-Tool aufrufen (inkl. Kanban, Vault, Vorlagen)

### Fehlerbehandlung & Resilienz
* Einzelschritt-Fehler → Zustand `FAILED` + exakte Ursache mit Zeitstempel im `execution_log`
* **Idempotenz-Guard**: In-Memory-Sliding-Window (15 s) + DB-Pipeline-Sperre gegen Doppel-Ausführung
* **Sub-Agent-Support**: `delegate_subtask` mit `verify_subtask`-Verifikation (Selbst-Reporte)

## 5. Agent-Jobs (zeitgesteuerte Automatisierung)

Zusätzlich zur Workflow-Engine unterstützt das System **Agent-Jobs**: cron-artige Jobs, die Scripte ausführen oder Monitor-Läufe anstoßen (siehe [Readme Agent-Jobs](Readme%20Agent-Jobs.md)).
