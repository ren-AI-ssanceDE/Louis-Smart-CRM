# 🏗️ Systemarchitektur & Datenfluss

> Dieses Dokument erklärt, wie **Louis Smart CRM** technisch aufgebaut ist — für Anwender vereinfacht, für Entwickler im Detail. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Wie ist das System aufgebaut? (im Bild)

Stellen Sie sich das System wie ein Restaurant vor:

```
┌───────────────────────────────────────────────────────┐
│  🍽️ SERVICE (das, was Sie sehen)                      │
│  Dashboard, Kundenlisten, Rechnungen, Chat mit Louis  │
└──────────────────────┬────────────────────────────────┘
                       │  Der Kellner (tRPC) bringt Bestellungen
                       │  sicher zur Küche — immer nach dem
                       │  gleichen, geprüften Ablauf
                       ▼
┌───────────────────────────────────────────────────────┐
│  👨‍🍳 KÜCHE (die Logik)                                 │
│  Louis (KI), Rechnungs-Engine, Workflow-Automatik,    │
│  MCP-Verbindungen, Spracherkennung                    │
└──────────────────────┬────────────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────────────┐
│  🗄️ LAGER (die Daten)                                  │
│  Datenbank ODER lokale Datei (automatischer Wechsel)  │
└───────────────────────────────────────────────────────┘
```

**Das Wichtigste in einfachen Worten:**

* **Sie sehen nur den Service-Bereich.** Die Oberfläche („Frontend“) ist bewusst getrennt von der Logik („Backend“) — so können keine Sicherheitslücken entstehen, z. B. dass KI-Schlüssel im Browser sichtbar werden.
* **Ihre Daten sind doppelt geschützt gespeichert.** Normalerweise in einer Datenbank. Ist diese nicht erreichbar, wechselt das System **automatisch und unbemerkt** auf eine lokale Datei — Sie merken davon nichts, und nichts geht verloren.
* **Alles ist mandantenfähig.** Falls mehrere Firmen das System nutzen, sieht jede nur ihre eigenen Daten — wie getrennte Lagerräume.

## Was bedeutet „Ereignis-gesteuert“?

Im System gibt es einen unsichtbaren „Schwarzen Brett“-Dienst: Sobald etwas passiert (z. B. eine Rechnung wird überfällig), hängt das System eine Nachricht ans Brett. Automatisierte Abläufe (Workflows), die auf diese Nachricht warten, starten dann ihre Arbeit — z. B. einen Mahnentwurf vorbereiten. Sie behalten dabei immer die Freigabe-Kontrolle.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Architektur-Übersicht (Schichtenmodell)

```
┌───────────────────────────────────────────────────────────────────────┐
│ 1. PRÄSENTATIONSSCHICHT — React 19 (Vite, Tailwind v4, i18n DE/EN)    │
│    Dashboard · Unternehmen · Kontakte · Rechnungen · Angebote ·        │
│    Kanban · Louis AI Studio · Council · Admin-Panel                    │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │ tRPC v11 (typsichere Prozeduren)
                                  ▼
┌───────────────────────────────────────────────────────────────────────┐
│ 2. LOGIKSCHICHT — Express 4 + tRPC-Router (src/server/routers/*)      │
│                                                                       │
│   ┌───────────────────────────┐   ┌────────────────────────────────┐  │
│   │ 2a. LOUIS AI ENGINE       │   │ 2b. CORE-LOGIK / FACHMODULE    │  │
│   │  ReAct-Loop (agentRuntime)│   │  ZUGFeRD (zugferd.ts), PDF,     │  │
│   │  QA-Critic (critic.ts)    │   │  Council, Workflow-DAG, Kanban, │  │
│   │  MCP-Bridge, Tools        │   │  MCP-Server/-Client, STT        │  │
│   └────────────┬──────────────┘   └───────────────┬────────────────┘  │
│                └────────────────┬─────────────────┘                    │
│                                 ▼ (Transaktionen & Events)            │
│            workflowEventBus: 'entity.action' → Workflow-Engine         │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  ▼
┌───────────────────────────────────────────────────────────────────────┐
│ 3. DATENSCHICHT — Dual-Storage (src/server/db.ts)                     │
│    PostgreSQL + pgvector  ODER  JSON-Fallback (lokale Datei)         │
│    + Daten-Vaults (companies/contacts/knowledge_data_vault)           │
└───────────────────────────────────────────────────────────────────────┘
```

## 2. Typsicheres Kommunikations-Protokoll (tRPC)

* **Zod als Vertrag**: Jede Query/Mutation definiert `.input(Schema)` und `.output(Schema)` — Änderungen am Backend-Typ brechen sofort die Frontend-Kompilierung.
* **Kein API-Key-Leakage**: Das Frontend fragt niemals externe APIs (Gemini, SMTP, MCP-Server) direkt an — der gesamte Traffic läuft über tRPC im Backend.
* **Mandantenfähigkeit**: Jede Abfrage filtert strikt über die Mandanten-ID (`ctx.tenantId`).
* **REST-Ergänzungen** (in `server.ts`): `/api/mcp` (SSE + JSON-RPC), `/api/upload`, `/api/voice/transcribe`, `/api/chat`, `/api/invoices/:id/download-pdf|-xml`, `/api/notes/download/:id`, `/api/telegram/config`, `/api/health`, `/api/auth/*`.

## 3. Louis AI: ReAct-Loop & QA-Critic

1. **Context Setup**: Historie, Mandantenkontext, aktuelles Datum, Tool-Budget.
2. **Dynamic ReAct Decider Loop** (max. 5 Iterationen): Fast-Path-Intent-Klassifikation aktiviert nur die benötigten Tool-Domänen (`CRM_READ`, `CRM_WRITE`, `KNOWLEDGE`, `KANBAN`, `TEMPLATES`, `WORKFLOWS`, `CORE`).
3. **Tool-Ausführung**: Über 40 registrierte Tools + dynamisch entdeckte MCP-Tools. Schreibende Aktionen erzeugen `proposedChanges` statt direktem DB-Write (Human-in-the-Loop, Draft-Flow).
4. **Math- & Schema-Gate** (`critic.ts`): Nettosumme + MwSt = Bruttosumme, Pflichtfelder, IBAN-Konsistenz.
5. **Compliance- & Critique-Loop**: Sekundärer LLM-Pass prüft Tonfall, Vollständigkeit und DSGVO-Konformität.
6. **Audit & Events**: Protokollierung in `sys_audit_log`, Emission über `workflowEventBus`.

## 4. Duales Speicherkonzept (Resilienz)

* **PostgreSQL-Pfad**: `pg.Pool` mit parametrisierten Queries; `pgvector` für 1536-dimensionale Embeddings (`CREATE EXTENSION IF NOT EXISTS vector;`).
* **JSON-Fallback-Pfad**: Der Fallback schreibt atomar in eine lokale JSON-Datei — inklusive In-Memory-Vektorsuche (Cosine Similarity) und selbstheilender Migrationen (Legacy-Felder, Mandanten-Normalisierung).
* **Transparente API**: Router rufen generische Helper auf; die Selektion des Pfads (Datenbank oder Fallback) erfolgt automatisch.

## 5. Event-System & Workflow-Engine

Mutationen emittieren Events über `workflowEventBus.emitEvent(tenantId, 'entity.action', payload)`:

* **Kern-Entitäten**: `company.*`, `contact.*`, `invoice.*` (created, updated, finalized, paid, overdue, status_changed), `offer.*`, `kanban.*` (board/card/column/approval), `file.uploaded`, `council.session_degraded_fallback`.
* **Workflow-Engine** (`workflowEngine.ts`): Scheduler prüft TIMER/Cron-Jobs (10-Sekunden-Heartbeat), verzögerte Schritte (`PENDING_DELAY`), Idempotenz-Guard (15-Sekunden-Sliding-Window + DB-Pipeline-Sperre).
* **DAG-Executor** (`workflowGraphExecutor.ts`): Führt gerichtete Graphen mit Knoten ACTION/CONDITIONAL/WAIT/HUMAN_GATE/RAG/ASK_USER aus; unterstützt parallele Zweige (`next_node_ids`), Fallback-Kanten und Variablen-Interpolation (`{{customer.name}}`).

## 6. Wichtige Datenbank-Tabellen

| Tabelle | Inhalt |
|---|---|
| `auth_access_identities` | Benutzerkonten & Rollen (admin, user) |
| `core_registry_companies` / `core_registry_contacts` | Firmen & Kontakte (inkl. Embeddings, Opt-ins) |
| `fiscal_billing_invoices` | Rechnungen mit Positionen, Zahlungsstatus, ZUGFeRD-Metadaten |
| `offers` | Angebote inkl. Gültigkeit & Konvertierung |
| `core_registry_my_company_table` | Eigenes Unternehmen (Nummernkreise, Bankdaten, Logo) |
| `kanban_boards/columns/cards/approvals` | Kanban-Pipeline |
| `sys_louis_ai_*` | Sessions, Historien, Knowledge-Chunks, Workflows, Agent-Jobs, Memory |
| `sys_mcp_*` | MCP-API-Keys, externe Server, Discovered Tools, OAuth-Tokens |
| `sys_comms_*` | SMTP-Nodes, E-Mail-/Rechnungstext-/Artikel-Vorlagen, Mail-Drafts |
| `sys_audit_log` | Append-Only-Audit-Log |

## 7. Integrations-Architektur (MCP, Telegram, STT)

* **MCP-Server**: SSE-Endpoint `GET /api/mcp/sse` + JSON-RPC `POST /api/mcp/message` (API-Key-Auth) — externe Clients nutzen CRM-Tools.
* **MCP-Client-Engine** (`mcpClientEngine.ts`): Verbindet sich zu externen Servern (STDIO/HTTP), entdeckt Tools (`mcp_<server>_<tool>`-Namespace), unterstützt OAuth und Presets.
* **Telegram-Gateway** (`services/telegram-bot-gate`): Dezentraler MCP-Client via SSE; Zero-Trust-Allowlist.
* **STT** (`/api/voice/transcribe`): Whisper (lokal via Docker `speaches` oder OpenAI), Admin-konfigurierbar (Provider, Modell, Sprache, Device, Quantisierung).
