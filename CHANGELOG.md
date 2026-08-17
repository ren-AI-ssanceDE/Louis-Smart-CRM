# Changelog — Louis Smart CRM

Alle wesentlichen Änderungen pro Version. Format basiert auf [Keep a Changelog](https://keepachangelog.com/).

## [2.0.0] — 2026-08-17

> **Hinweis:** V2 ist noch nicht öffentlich — alle Fixes gehören in diese Version (Tag `2.0.0` auf dem Stand inkl. N3).

Release der Produktionsreife: 103 Commits seit dem Import aus Google AI Studio (V1-Basis), abgesichert durch 316 Unit-Tests, Live-E2E (102/103), MCP-Volltest (45/45) und ZUGFeRD-Referenzvalidierung.

### 🚀 Highlights V2

- **KI-Assistent (Louis AI)**: ReAct-Loop mit nativem Tool-Calling (3 Ausgabepfade: strukturierte `tool_calls`, XML-Tool-Calls, JSON-Freitext), einheitlicher Draft-Flow mit Freigabe, LLM-Kritikschleife nur bei CRM-Änderungen, Ankündigungs-Schutz mit Tool-Call-Retry, XML-Sanitizer für Chat-Antworten, Chat-Datei-Upload (5 Dateien, 25 MB, optionale Wissensdatenbank-Indizierung), Session-Recall, Memory & Skills (Hermes-Annäherung), Subtask-Delegation mit Output-Schemas.
- **Workflows**: DAG als einziger Workflow-Pfad (mit Auto-Migration), visueller DAG-Editor (React Flow), Vorlagen-Bibliothek, Versionierung, Dry-Run/Simulation, 5-Felder-Cron + weekly, Trigger-Events (offer/kanban/invoice), Human-Gates, WAIT-Knoten, `ask_user_question`- und `delegate_subtask`-Schritte.
- **MCP**: Katalog 24 → 42 Tools (Notizen, Vault, Mails, Kanban, Templates, Angebote, Sessions, Workflows), Preset-Katalog mit Admin-Aktivierung und deprecated-Nachfolgern, Tenant-Isolation im Get-Pfad, Streamable-HTTP-Handshake + SSE-Parsing, HTTPS-MCP mit selbstsignierten Zertifikaten, widerrufbare API-Schlüssel.
- **Obsidian-Anbindung**: echtes Obsidian-MCP über das Local REST API Plugin (bearer, Admin-Felder), vaultStore auf Plugin-Tools gemappt, Tier-1-Integration mit Upsert + Skills-Fallback.
- **E-Rechnung**: ZUGFeRD/XRechnung als PDF/A-3 mit Mustang-Validierungs-Gate und Ghostscript-Normalisierung (heilige Datei `src/lib/zugferd.ts`, unangetastet).
- **Sicherheit**: Passwort-Hashing auf bcrypt (per-User-Salt, Kostenfaktor 10) mit Lazy-Migration bestehender Hashes; vollständige MCP-Audit-Pflicht (CREATE/UPDATE/DELETE) mit filterbarem/exportierbarem Audit-Log.

### 🐛 Wichtige Fixes (Auswahl)

- **Auth-Secret in der DB statt Code/Env (021-F):** Das Session-Secret wird beim ersten Start generiert und in `sys_app_security` gespeichert — kein hartkodierter Fallback mehr (Regel: keine Einstellungen in Dateien; alle Konfiguration über Admin-Panel/DB).
- **Workflow-Notiz persistiert wirklich (N3):** `create_note_draft`-Schritte im linearen Workflow-Executor und im DAG-Executor (Dispatch `executeCreateNoteDraft` + LLM-Dispatch `CreateNote`) übergeben `bypassApproval=true` — vorher liefen alle drei Pfade als No-Op (nur Draft-Meldung bzw. nur Audit ohne DB-Eintrag). Live verifiziert: Notiz in `sys_louis_ai_notes` (Test Testkunde, `ai_workflow(_dag)`).
- Council-MCP: Session-Upsert (INSERT … ON CONFLICT) — `crm_run_council_deliberation` benutzbar
- Angebots-Finalisierung: „Output validation failed" behoben (ISO-Mapper für pg-Date-Spalten in offers-Router)
- MCP-Mapping-Cluster: `notes_create` persistiert wirklich; Feldnamen-Drift (`invoice_line_items`, `note_id_uuid`, `draft_id_uuid`) behoben + Drift-Guard-Test
- Obsidian-Lesezugriff robust gegen MCP-Fehlerantworten; XML-Tool-Call-Parsing robuster (unvollständige Blöcke, Attribut-Parameter)
- Scheduler/WAIT: kein Endlos-Loop, ISO-Mapper für `execute_at_utc`
- Audit-Konsistenz (nur CREATE/UPDATE/DELETE), Admin-Usability (Token-Verbrauch, Agent-Jobs, Governance)
- 429-Build-Fix: Lato-Fonts aus dem Build-Kontext statt GitHub-Download

### 🔧 Infrastruktur & Tests

- Qualitäts-Gates: `check:rules` (any-Verbot, i18n, **Heilige-Dateien-Guard**), lint, test:unit, build; pre-commit-Hook
- Test-Infra: 316 Unit-Tests, Mock-MCP-Server-Auto-Start (globalSetup), MCP-Volltest 45/45, Live-E2E 102/103 (nur bekannter F24-LLM-Flake), Workflow-QA-Suite
- Stack: Docker Compose (App, DB+pgvector, Whisper, Telegram-Gate, Ollama), lokales LLM devstral-small-2:24b für Coding-Subtasks (Kaltstart-Fix, VRAM-Optimierung)

### ⚠️ Bekannte Restrisiken (akzeptiert für V2)

- Tenant-List-Vektor (`OR tenant_id = '1'`-Muster in Listen-Tools) — Auftrag 018 offen
- Lokaler-LLM-Subtask-Pfad unter paralleler LLM-Last (Timeout) — Nachfolge zu Auftrag 024
- Workflow-Schritt `create_note_draft` persistiert nicht (No-Op) — Freigabe ausstehend
- Bestands-Ordner `…__musterfirma_gmbh_` (trailing `_`, Windows-Mount) — kosmetisch, App findet ihn per ID

---

## [1.0.0] — 2026-08-04 (Basis)

Import aus Google AI Studio („Run and deploy your AI Studio app"): CRM-Grundgerüst (Firmen, Kontakte, Angebote, Rechnungen), Chat mit Google-GenAI, ZUGFeRD-Erzeugung, Docker-Stack. Danach 13 Aufträge (001–013) mit laufenden Funktions- und Qualitätserweiterungen, die in 2.0.0 münden.
