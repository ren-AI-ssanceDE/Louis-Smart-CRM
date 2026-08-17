# 🛠️ Tech-Stack & Entwicklungs-Richtlinien

> Dieses Dokument beschreibt die Technologien, auf denen **Louis Smart CRM** aufbaut — für Anwender vereinfacht, für Entwickler im Detail inklusive Coding-Regeln. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Aus welchen „Zutaten“ besteht das System?

Stellen Sie sich das System wie ein gut ausgestattetes Büro vor:

| Baustein | Einfach erklärt | Konkretes Produkt |
|---|---|---|
| **Die Schaufenster** (Oberfläche) | Das, was Sie im Browser sehen — modern, schnell, auf Deutsch/Englisch | React 19, Vite, Tailwind CSS |
| **Der Schreibtisch** (Server) | Die „Zentrale“, die alle Aufgaben verarbeitet und Ihre Daten verwaltet | Node.js, Express, tRPC |
| **Der Aktenschrank** (Datenbank) | Wo Ihre Kunden, Rechnungen und Dokumente sicher liegen | PostgreSQL (mit Vektor-Suche für die KI) |
| **Der Assistent** (KI) | Louis — das Sprachmodell, das Anweisungen versteht und Texte/Entwürfe erstellt | Google Gemini (+ optional lokale Modelle) |
| **Die Druckerei** (Rechnungen) | Erzeugt die rechtskonformen PDF-Rechnungen | pdf-lib + Mustangproject (Java) |
| **Der Postbote** (E-Mail) | Versendet E-Mails über Ihren Mailserver | Nodemailer (SMTP) |
| **Das Sicherheitspersonal** (Zugang) | Stellt sicher, dass nur berechtigte Personen Zugriff haben | Auth.js |

## Warum ist das gut für Sie?

* **Schnell & modern:** Die Oberfläche reagiert flüssig, funktioniert am PC, Tablet und Handy.
* **Sicher:** Ihre Zugangsdaten und KI-Schlüssel bleiben im Server — der Browser sieht sie nie.
* **Flexibel:** Das System läuft mit Datenbank oder ohne; mit Google-KI oder optional auch mit lokal laufenden KI-Modellen.
* **Zweisprachig:** Deutsch und Englisch, umschaltbar.

## Was bedeutet „die Regeln“ für Sie?

Für Entwickler gelten strenge Qualitätsregeln (keine unsicheren Typen, keine vergessenen Übersetzungen, keine ungeprüften Änderungen an der Rechnungs-Engine). **Ihr Vorteil:** Das System ist stabil, sicher und rechtssicher — und bleibt es auch bei jedem Update.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Frontend-Stack (Client)

* **Framework**: **React 19** (funktionale Komponenten & Hooks)
* **Build-System**: **Vite 6** (HMR, schnelle Dev-Iteration)
* **Typisierung**: **TypeScript 5.8** im strikten Modus (`strict: true`)
* **Styling**: **Tailwind CSS v4** (Utility-First, Dark-Mode-fähig) mit Schriftarten **Inter** (UI) und **JetBrains Mono** (Daten/Code)
* **Animationen**: **Motion** (`motion/react`, vormals Framer Motion)
* **Charts**: **Recharts** & **D3.js** für Dashboard-Visualisierungen
* **Datenabfragen (Client)**: **TanStack React Query** v5 (Server-State, Caching, Optimistic Updates)
* **i18n**: **react-i18next** / **i18next** v26 mit Locale-Dateien `de.json` & `en.json`
* **Drag & Drop**: **@dnd-kit** (core/sortable/utilities)
* **Workflow-Editor**: **@xyflow/react** (React Flow) für den visuellen DAG-Editor
* **Icons**: **lucide-react**

## 2. Backend-Stack (Server)

* **HTTP-Server**: **Express 4**
* **API-Standard**: **tRPC v11** — Router in `src/server/routers/*`, zusammengeführt in `src/server/router.ts`; Input/Output per **Zod**-Vertrag
* **Authentifizierung**: **Auth.js** (`@auth/express`, `@auth/pg-adapter`, `@auth/core`) mit Session-Cookies
* **Datenbank-Zugriff**: **pg** (node-postgres) — **kein ORM**; ausschließlich parametrisierte Queries
* **KI-Schnittstelle**: **@google/genai** (Gemini API) + eigener lokaler Modell-Client (`localModelClient.ts`, z. B. Ollama/OpenAI-kompatible Endpunkte)
* **E-Rechnung/PDF**: **pdf-lib** (+ fontkit) für PDF-Rendering, **Mustangproject CLI** (Java) für ZUGFeRD/Factur-X-XML-Verschmelzung, **pdf-parse**, **mammoth** (DOCX), **juice** (HTML-Inlining)
* **Datei-Upload**: **multer** (inkl. RAG-Ingestion im Hintergrund)
* **Mailing**: **nodemailer** v7 (TLS/SMTP)
* **Archiv/ZIP**: **jszip** (DSGVO-Exporte)

## 3. Datenbank & Persistenz

* **Produktivdatenbank**: **PostgreSQL 14+** mit Erweiterung **pgvector** (1536-dimensionale Embeddings, `<=>`-Ähnlichkeitssuche)
* **Fallback**: Lokaler **JSON-Store** (`.local_fallback_db.json`) — kompletter Funktionsumfang ohne DB (Hybrid-Storage-Pattern, `isUsingFallback`)
* **Datei-Vaults**: `companies_data_vault/`, `contacts_data_vault/`, `knowledge_data_vault/` (persistente Mounts, RAG-indexiert)
* **Mandantenfähigkeit**: `tenant_id` auf allen Tabellen/Stores (Standard-Mandant `'1'`)

## 4. KI-Stack & Agenten-Architektur

* **ReAct-Runtime** (`src/server/ai/agentRuntime.ts`): 5-phasige Pipeline, dynamische Tool-Set-Aktivierung, max. 5 Loop-Iterationen
* **Tool-Catalog**: 40+ System-Tools in Domänen (`CORE`, `CRM_READ`, `CRM_WRITE`, `KNOWLEDGE`, `KANBAN`, `TEMPLATES`, `WORKFLOWS`) + dynamische MCP-Tools
* **QA-Critic** (`critic.ts`): deterministische Mathematik-/Schema-Validierung + sekundärer LLM-Compliance-Pass
* **Council Engine** (`src/server/council/`): Multi-Model-/Multi-Rollen-Debatten (Gemini, GPT, Claude, Llama …)
* **RAG**: pgvector bzw. In-Memory-Cosine-Similarity; Wissens-Chunks (`sys_louis_ai_knowledge_*`), Vault-Suche
* **Workflow-Engine**: Scheduler + DAG-Executor (`workflowGraphExecutor.ts`) mit Knoten ACTION/CONDITIONAL/WAIT/HUMAN_GATE/RAG/ASK_USER
* **MCP**: Server (`mcpServer.ts`) + Client-Engine (`mcpClientEngine.ts`), OAuth, Tool-Discovery
* **STT**: Whisper via `/api/voice/transcribe` (Provider `disabled | local-whisper | openai-whisper`)

## 5. Qualitätssicherung & CI

| Gate | Werkzeug | Umfang |
|---|---|---|
| Projektregeln | Automatisierte Regeln (`npm run check:rules`, pre-commit) | `any`-Verbot, i18n-Pflicht, Schutz kritischer Dateien, additive Migrationen |
| Lint/Typen | `tsc --noEmit` (`npm run lint`) | Volle Typprüfung |
| Unit/Integration | **Vitest** (interne Suite) | Schemas, Router, DAG-Mapper, AI-Tools, Draft-Flow, Sanitizer, Cron-Matcher |
| E2E | **Playwright** (interne Suite) | Live gegen den Stack — Admin, Workflows, AI-Tools, Chat-Upload, DAG-Editor, Token-Usage |
| E-Rechnungs-Validierung | Interne ZUGFeRD-E2E (`test:zugferd`) | Single-Line, Multi-Line, Mixed-VAT, XRechnung B2G → `/e2e-out/summary.json` |

## 6. Programmier-Richtlinien (verbindlich)

### A. `any`-Verbot
`any` ist bis auf wenige System-Hydrationsebenen verboten. Stattdessen `unknown` + Type-Guards, Zod-Inferenzen (`z.infer<typeof Schema>`) oder abgeleitete Typen. Wird per `check:rules` + pre-commit-Hook erzwungen.

### B. Keine hartkodierten UI-Texte
Jede Benutzer-sichtbare Zeichenkette MUSS über i18n laufen (`de.json`/`en.json`). Verstöße blockieren den Commit (`extract-missing-i18n.mjs`).

### C. Keine hardcodierten Einstellungen
Verhaltens- und Laufzeitparameter (KI-Provider, MCPs, Embeddings, Voice, STT, Web-Suche) liegen in der DB-Config (`sys_integrations_louis_ai_config` etc.) und sind im Admin-Panel einstellbar — `NULL` = Systemdefault. Neue Funktionen müssen mit **allen** Backend-Einstellungen funktionieren.

### D. Additive Migrationen & Abwärtskompatibilität
Nur `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Neue Versionen dürfen alte DBs/Vorlagen nie zerstören — Altdaten werden beim Update automatisch konvertiert (z. B. lineare Workflows → DAG), nie gelöscht.

### E. Heilige Dateien (Read-Only)
`src/lib/zugferd.ts`, `src/server/pdfHelper.ts`, `scripts/PDFA_def.ps`, `Dockerfile`, `docker-entrypoint.sh` — zertifizierte E-Rechnungs-Komponenten, nicht verändern.

### F. Dual-Store-Pflicht
Neue Backend-Funktionen müssen beide Pfade unterstützen: `if (isUsingFallback) { ... fallbackStore ... } else { await pool.query(...) }`.

### G. Schreibzugriffe über Freigaben
KI-Werkzeuge, die CRM-Daten verändern, liefern `proposedChanges` (Draft-Flow) statt direkter DB-Writes — Human-in-the-Loop bleibt Pflicht.

### H. Event-Driven
Mutationen beenden ihren Zyklus mit `workflowEventBus.emitEvent(tenantId, 'entity.action', payload)`.
