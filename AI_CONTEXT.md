# AI Technical Context & Architecture Manifest

## 1. Core Vision
**Project Name:** Louis Smart CRM (Semantic E-Invoicing Edition)
**Objective:** A localized, high-integrity CRM designed for the European market, specializing in **ZUGFeRD 2.4 / Factur-X (EN16931 comfort profile) and XRechnung 3.0 (CII)** compliant e-invoicing. The system prioritizes "AI-Readiness"—meaning data structures are named semantically and indexed for LLM integrations, while maintaining a strict, systematic audit trail for every single fiscal and registry entity. **Every generated PDF is gated by Mustangproject's validator before it can land in a tenant vault.**
**Local-First** The application is designed to run autonomously and locally, without utilizing external services such as Google, unless expressly requested by the user.
---

## 2. Tech Stack
- **Frontend:** Vite (React 19), TypeScript.
- **Styling:** Tailwind CSS v4.
- **Animations:** Framer Motion (`motion/react`).
- **Data Fetching:** **tRPC** (End-to-End Type Safety) + **TanStack Query** (React Query).
- **Validation:** **Zod** (Strict schema enforcement for all input/output fields).
- **Localization:** `i18next` + `react-i18next` with robust Multi-Language support (German/English).
- **Backend:** Node.js Express server running on-the-fly TypeScript execution via `tsx`.
- **Mailing:** **Nodemailer** (SMTP relay integration for automated invoicing & reminders).
- **Database (Dual-Mode Engine):**
  - **Primary:** **PostgreSQL** with the **pgvector** extension for semantic embedding lookups.
  - **Adaptive Fallback:** A **Persistent Local JSON File Store (`.local_fallback_db.json`)** in the workspace root. When PostgreSQL is absent or starting up, the system auto-switches to this fallback seamlessly, enabling robust offline preview and zero-config hosting (e.g. standard Cloud Run containers).
- **Invoice Renderer:** Hybrid Architecture consisting of:
  1. **`pdf-lib`** programmatically renders the visual layout and writes the **minimum PDF/A-1b markers** (XMP `pdfaid:part=1`, trailer ID) needed for Mustang's exporter to accept the input. Heavy PDF/A-3b sealing (OutputIntent, `/AFRelationship`, `/AF` catalog, Factur-X XMP) is **delegated** to Mustang to avoid the dual-metadata fight that the legacy implementation suffered.
  2. **`src/lib/zugferd.ts`** serializes the EN 16931 CII XML for both `zugferd-comfort` and `xrechnung-3.0` profiles. Profile is auto-detected via `inferProfileFromInvoice()` from the presence of a valid Leitweg-ID. XRechnung enforces Leitweg-ID regex, mandatory `DefinedTradeContact` (BT-41/42/43), `URIUniversalCommunication` on both parties (BT-34/49) and `BusinessProcessSpecifiedDocumentContextParameter` (BT-23).
  3. **Mustang CLI** (`mustang-cli.jar`, version 2.23.0) runs `--action combine` to promote PDF/A-1 → PDF/A-3b and embed the XML, then `--action validate` as a gate. The combine flags include `--no-additional-attachments` (prevents an interactive stdin prompt) and `--ignorefileextension` (lenient PDF/A input).
  4. **Validation gate** (`validateInvoicePdf`) parses Mustang's structured XML report into `{ ok, errors, warnings, notices, raw }`. On failure, the output PDF is deleted before exposure and `validation_<invoiceId>.log` is persisted for GoBD audit. The HTTP layer surfaces failures as `422 INVOICE_FAILED_VALIDATION` with structured payload.

  **Zero-egress at runtime** is guaranteed: `scripts/setup-assets.mjs` vendors `Lato-Regular.ttf`, `Lato-Bold.ttf` and `mustang-cli.jar` at install / Docker build time; runtime never invokes `fetch()` against any external host.

---

## 3. Directory Layout (Modular Architecture)
- `/src/lib/schemas.ts`: Central source of truth for **Zod validation schemas** (e.g., mail configurations, invoicing parameters, LLM settings, customized workflows validation).
- `/src/lib/trpc.ts`: tRPC client React hook initialization.
- `/src/lib/bankUtils.ts`: European/German Bank sorting/routing routines for BLZ validation and IBAN generation.
- `/src/lib/zugferd.ts`: Factur-X / ZUGFeRD compliance invoice XML serialization.
- `/src/i18n`: Global context locale initialization (`/locales/de.json` & `/locales/en.json`).
- `/src/components/admin/`: Admin section modular forms:
  - `LouisAiSettingsForm.tsx`: Orchestrates the server LLM model thresholds, temperatures, context lengths, and connection configurations.
  - `LouisAiWorkflowsTab.tsx`: A comprehensive, interactive control panel enabling managers to search, inspect, create, edit, and delete learned custom ReAct tools and workflow sequences.
  - `MyCompanyForm.tsx`: Corporate branding identity editor, financial identification inputs, and logo storage.
  - `SmtpSettingsForm.tsx`: SMTP node routing server setup.
  - `TemplatesTab.tsx`: Dynamic standard mail reminders, invoice templates, and product catalogs editor.
- `/src/server/`: Backend modular system controllers:
  - `db.ts`: Handles dual-mode database pool connection, PostgreSQL vector indices, initial table seeders, and local fallback JSON synchronization (`.local_fallback_db.json`).
  - `router.ts`: The primary **tRPC App Router** combining specialized modular sub-routers.
  - `pdfHelper.ts`: Visual PDF engine powered by `pdf-lib` wrapping text formatting, coordinates tracking, tables formatting, and Mustang integration.
  - `storage.ts`: Folder filesystem vault directory manager and Gemini API embeddings generator.
  - `auth.ts`: Express session credentials validation and multi-tenant security verification hooks.
  - `trpc.ts`: Main tRPC backend context extractor (resolves session authentication and matches active `tenantId`).
- `/src/server/routers/`:
  - `companies.ts`: Corporate directory registry, automated contact linkages, and pgvector embeddings lookup.
  - `contacts.ts`: Individual personal directory registry.
  - `invoices.ts`: Financial ledger, ZUGFeRD compiler, validator gate, and SMTP dispatchers.
  - `louisAi.ts`: ReAct agent execution loop, user memory retrieval, local knowledge indexing, and learned custom workflows CRUD mutations.
  - `settings.ts`: SMTP details list query routers, company profiles updates, and template managers.
  - `filesAndLogs.ts`: System log browser and the unalterable GoBD system audit trails.
- `/companies_data_vault`: Isolated persistent storage for corporate documents (partitioned by tenant).
- `/contacts_data_vault`: Isolated persistent storage for individual documents (partitioned by tenant).
- `/server.ts`: Node-Express entry point routing tRPC middleware, static assets, uploading endpoints, and file routing.

---

## 4. Multi-Tenant Database Schema (AI-Ready)
All primary keys are strict **UUID (v4)**. Columns are designed using descriptive semantic labels to assist AI contexts, and core registries contain a `vector(1536)` embedding column for rich, semantic search capabilities via **pgvector**.

- **`auth_access_identities`**: Registered users and credentials with `account_role`.
- **`core_registry_companies`**: Corporate clients containing metadata embeddings and bank details (`iban`, `bic_swift`).
- **`core_registry_contacts`**: Personnel registry linked to companies with communications opt-in vectors.
- **`fiscal_billing_invoices`**: Financial invoices storing items natively in `invoice_line_items_json` along with billing metadata.
- **`core_registry_my_company`**: Legal identity & company numbers of the node operator (contains corporate prefixes, IBAN, bank configurations, and logo URLs).
- **`sys_integrations_smtp_nodes`**: Outbound SMTP configurations configured by Tenant.
- **`sys_comms_email_templates`**: Pre-formatted template engines (e.g., standard invoices, collection alerts) with dynamic template injection (e.g., `{{invoice_number}}`).
- **`sys_comms_signatures`**: Dynamic signatures appended automatically to outgoing mail.
- **`sys_comms_invoice_text_templates`**: Predefined intro and closing paragraphs to drag-and-drop onto drafts.
- **`sys_comms_invoice_item_templates`**: Predefined catalog products/services to quickly insert as invoice positions.
- **`sys_bank_directory`**: European Central Bank directory mapping sorting codes (`BLZ`) allowing real-time bank name lookups and BIC cross-verification.
- **`sys_integrations_louis_ai_config`**: Configuration settings (model name, temperature, context length, provider) for the active LLM router.
- **`sys_louis_ai_custom_workflows`**: Stored sequential tools learned by the ReAct agent, mapping predefined tool-chain sequences to specific structured step guides.
- **`sys_louis_ai_sessions`**: Session-level parameters recording executed ReAct tool traces, intermediate variables, and trace histories.
- **`sys_louis_ai_user_memory`**: Long-term episodic and semantic memory blocks indexed vectorially to allow personalized AI contextual cues.
- **`sys_louis_ai_knowledge_metadata`**: Ingestion catalog indexing uploaded documents (PDFs, spreadsheets, text guides) ingested into the local RAG knowledge archive.
- **`sys_louis_ai_knowledge_chunks`**: High-dimensional content chunks mapped to vectors for localized semantic knowledge retrieval.
- **`sys_audit_event_logs`**: System event logs documenting exact changes for critical tracking (`CREATE`, `UPDATE`, `DELETE`, `APPROVE_SUGGESTION`).

---

## 5. Security & Multi-Tenancy Rules

### I. Session-Level Isolation
- Every tRPC endpoint uses a `protectedProcedure` enforcing a valid session.
- The `tenantId` is extracted automatically inside `createContext` and appended as a strict row-level search restriction in all SQL queries or JSON lookup loops.

### II. Dynamic Local File Isolation
- Document vaults are strictly partitioned inside filesystem vaults: `/companies_data_vault/{tenant_id}/{entity_uuid}__name/` and `/contacts_data_vault/{tenant_id}/{entity_uuid}__name/`.
- File upload handlers verify permission scopes before writing to the corresponding folder structure.

### III. AI Metadata Standards
Entities store unified semantic telemetry fields:
- `created_by_identity`: `'human' | 'ai_assistant' | 'system'` (classifies origin of the database entry).
- `ai_confidence_score`: Float value (0.0 to 1.0) indicating parsing accuracy.
- `is_verified_by_human`: Boolean flag setting lockouts on machine-learned mutations.
- **Embeddings**: Generated server-side using the `gemini-embedding-2-preview` model via `@google/genai` on model updates.

### IV. Fiscal Governance & Audit Trails
- State changes to core financial records or registry settings trigger an immediate asynchronous dispatch write to `sys_audit_event_logs`.
- Logs record the unique event taxonomy, database target, user session identity, timestamp, and metadata payload, building a secure history trail.

---

## 6. Primary Business Logic Flows

### High-Fidelity PDF/A-3 E-Invoices
- **Pipeline:**
  1. `buildInvoicePDFBuffer` (pdf-lib) → visual PDF with PDF/A-1b markers.
  2. `generateZugferdXML(invoice, myCompany, profile)` → EN 16931 CII XML, profile-aware.
  3. `mergePdfAndXmlWithMustang(visual, xml, out, profile)` → calls `java -jar mustang-cli.jar --action combine --format zf --version 2 --profile {E|X} --no-additional-attachments --ignorefileextension`.
  4. `validateInvoicePdf(out)` → calls `--action validate --disable-file-logging`, parses the XML report.
  5. On `ok=true`: PDF is copied to the human-readable vault path, `validation_<invoiceId>.log` is persisted.
  6. On `ok=false`: PDF is deleted, `validation_<invoiceId>.log` is persisted, error bubbles up as `422 INVOICE_FAILED_VALIDATION { code, message, errors, warnings, logPath }`.

- **Known nuance — PDF/A ToUnicode notice:** Mustang's veraPDF stage may flag a single notice (ISO 19005-3 §6.2.11.7.2) about Lato's `tt` OpenType ligature glyph lacking a Unicode mapping. This stems from a pdf-lib + fontkit interaction with OpenType GSUB shaping. Mustang's **overall** summary remains `status="valid"`, KoSIT (XRechnung official validator) inspects only the embedded XML and is unaffected. If strict pure PDF/A-3b is required, swap Lato for a non-GSUB font or pre-process the visual PDF through GhostScript `-dPDFA=1`.

### Automated SMTP Relay dispatch
- Node SMTP nodes are configured partitioned per tenant in settings.
- Nodemailer constructs multi-stage transactional emails utilizing user templates (such as Standard Invoice drafts and Friendly Reminders), attaches the PDF invoices directly from the vaults, and routes the SMTP relays transparently.

### Regional Bank Directories
- A fully integrated database indexing routing numbers enables local UI components to instantly auto-detect and resolve bic/bank names on inputting German/European bank codes, ensuring flawless bank connection verification.

### LOUIS AI Custom Workflows & ReAct Tool Orchestrator
- **Workflow Synthesis:** During conversation with LOUIS AI, complex multi-step routines can be learned and stored as "Custom Workflows" in `sys_louis_ai_custom_workflows`.
- **Custom step selection:** Custom workflow steps map to available system tools such as:
  - `executeDataArchitect`: Performing relational or schema queries on core CRM entities.
  - `executeWebSearch`: Searching real-time external information on companies and partners online.
  - `executeLocalKnowledgeSearch`: Retrieval of specific operational data inside uploaded text, PDFs, or spreadsheet knowledge context chunks (RAG).
- **Admin Management Portal:** Under the **Admin Page's "LOUIS AI Workflows" tab (`louis_workflows`)**, users can:
  - Monitor all learned workflows registered for the active tenant.
  - Inspect exact multi-step execution graphs and the associated prompt parameters in the visual Timeline Flow flowchart inspector.
  - Instantly create new customized workflow sequences, or edit and tweak fine-grained instructions for learned tools.
  - Delete unused or obsolete workflows safely. State changes are registered real-time in the GoBD-compliant global audit trails.

---

## 7. LOUIS AI - System & Funktionsweise

### Was ist LOUIS AI?
**LOUIS AI** ist der zentrale, kontextsensitive ReAct-Agent (Reasoning and Acting) von *Louis Smart CRM*. Er agiert als voll integrierter digitaler Partner für administrative CRM-Prozesse, regulatorische E-Rechnungsprüfungen und semantische Analysen. LOUIS AI versteht natürliche Sprache, plant autonome Lösungswege über strukturierte Denksequenzen ("Thoughts") und führt komplexe Aktionen transparent aus.

### Wie funktioniert LOUIS AI? (Architektur & Pipeline)

Der Agent basiert auf einem hochentwickelten mehrstufigen Lebenszyklus, der im Hintergrund abläuft:

```
                  [ USER ANFRAGE (Prompt) ]
                               │
                               ▼
             ┌──────────────────────────────────┐
             │   Intent-Klassifizierung &       │
             │   Kurzzeit-Gedächtnis-Injection  │
             └─────────────────┬────────────────┘
                               │
                               ▼
             ┌──────────────────────────────────┐
             │     ReAct-Schleife (Thinking)    │◄──────┐
             │   - Thought: Logisches Denken    │       │
             │   - Action: Tool-Anforderung     │       │ Tool-Rückgabe
             └─────────────────┬────────────────┘       │ (Result)
                               │                        │
                               ▼                        │
             ┌──────────────────────────────────┐       │
             │      Tool-Execution Engine       ├───────┘
             │  - DataArchitect (CRM SQL)       │
             │  - WebSearch (Online-Suche)      │
             │  - LocalKnowledge (RAG-Suche)    │
             └─────────────────┬────────────────┘
                               │ ReAct abgeschlossen
                               ▼
             ┌──────────────────────────────────┐
             │       Critic-Prüfschleife        │
             │  - Mathematische Validierung     │
             │  - Halluzinationen Filtern       │
             └─────────────────┬────────────────┘
                               │ Draft Proposal generiert
                               ▼
                   [ HUMAN-IN-THE-LOOP GATE ]
             (Benutzer muss Vorschlag im UI bestätigen)
```

#### 1. ReAct-Loop Orchestrator (`orchestrator.ts`)
*   **Ablauf:** Der Orchestrator steuert die logische Schleife aus **Denken (Thoughts)** und **Handeln (Actions)**. Bei Eingang einer Nachricht entscheidet der Agent über den erkannten *Intent* (`DATA_CREATION`, `DATA_CHANGE`, `ANALYSIS`, `CUSTOM_TOOL` oder `GENERAL`).
*   **Ausführung:** Über das `@google/genai` (Gemini SDK) generiert der Agent iterativ Planungsschritte und fordert bei Bedarf spezialisierte Tools an, um Echtzeitdaten zu erheben.

#### 2. Integriertes Tool-Ökosystem (`tools.ts`)
Der Agent besitzt exklusiven Zugriff auf drei hochperformante System-Tools:
*   **`executeDataArchitect` (CRM-Abfrageschicht):** Übersetzt natürlich formulierte Business-Fragen ("Zeige mir alle Kunden mit Außenständen über 5000 €") in präzise, tenant-isolierte Datenbankabfragen. Er verifiziert Tabellenstrukturen automatisch im Hintergrund und liefert bereinigte Datenstrukturen.
*   **`executeWebSearch` (Internet-Recherche):** Ermöglicht dem Agenten, Echtzeitdaten über Geschäftspartner, Steuerregelungen, Handelsregister-Einträge oder Marktpreise im Web zu recherchieren, ohne lokale Systemgrenzen zu verletzen.
*   **`executeLocalKnowledgeSearch` (RAG-Vektorsuche):** Durchsucht hochgeladene PDF-Dokumente, Preislisten, Dokumentationen und Verträge. Die Dokumente werden in hochdimensionale Embeddings (`gemini-embedding-2-preview`) zerlegt, in `sys_louis_ai_knowledge_chunks` persistiert und über eine Kosinus-Ähnlichkeitssuche sekundenschnell als fundierte Wissensgrundlage in den LLM-Context injiziert.

#### 3. Die doppelt isolierte Critic-Schleife (`critic.ts`)
*   **Sicherheitsgatter:** Bevor LOUIS AI eine zustandsverändernde Operation (z.B. Erstellung einer neuen Rechnung oder Änderung kritischer Kundeninformationen) vorschlagen darf, greift der autonome *Critic*.
*   **Validierung:** Der Critic prüft alle kalkulierten Steuersätze, Positionsberechnungen auf arithmetische Exaktheit, ZUGFeRD-Kompatibilität sowie Schemavalidität. Schlägt die mathematische oder logische Validierung fehl, korrigiert der Critic den Entwurf des Agenten, bevor dieser das UI erreicht.

#### 4. Gedächtnis-Architektur ("Episodic & Semantic Memories")
*   **Langzeitgedächtnis (`sys_louis_ai_user_memory`):** Der Agent lernt Präferenzen, wiederkehrende Fakten oder tenantspezifische Gewohnheiten und speichert diese als semantische Vektoren. Bei Folgegesprächen werden relevante Gedächtnisfragmente automatisch geladen.
*   **Kontext-Kompression (`executePassiveShortTermCompression`):** Um Context-Window-Overflows und unpräzises Verhalten bei langen Chat-Sitzungen zu eliminieren, läuft ein stiller Hintergrundprozess, welcher historische Chatnachrichten komprimiert und in einer semantisch verdichteten Zusammenfassung mitsendet.

#### 5. Absolute Compliance durch Human-in-the-Loop-Gating
*   **Vorschlagswesen:** LOUIS AI darf niemals Einträge direkt und ungesehen in den produktiven Datenbestand schreiben.
*   **Schnittstelle:** Jede vorgeschlagene Änderung wird als visuelle "Proposal-Card" im UI gerendert. Erst wenn der Nutzer diesen Vorschlag manuell freigibt, wird die Mutation produktiv geschaltet und revisionssicher in den GoBD-Audit-Logs (`sys_audit_event_logs`) verbucht.

---

## 8. Global Architectural Guidelines
1. **TypeScript First:** Strict typing with zero fallback to `any` where possible.
2. **React Functional Hooks:** Exclusively utilize React 19 hooks and tRPC client queries. Avoid any legacy class representations.
3. **Optimized Multi-Platform Build:** Build target leverages lightweight Node deployment utilizing standard tsx directly, with a self-repairing database connection resilient to transient PostgreSQL connection drops.

---

## 9. Vibe Coding Blueprint & Safety Prohibitions (CRITICAL RULES FOR AI AGENTS)

When participating in "Vibe Coding" sessions on this codebase, AI Assistants **MUST** treat the following rules as absolute constraints. Breaking these compromises French/German electronic accounting compliance (GoBD/EN 16931) and damages system security.

### I. Forbidden Modifications (Strictly Read-Only)
The following files must **NEVER** be touched, edited, or modified by any automated agent:
- **`src/lib/zugferd.ts`** — Holds standardized XML serializations, tag alignments, and `roundFiscal()` fiscal rounding handlers.
- **`src/server/pdfHelper.ts`** — Manages `pdf-lib` fonts layout and the local Mustang project compilation hook.
- **`Dockerfile` / `docker-compose.yml`** — Packs headless JRE 17 dependencies.
- **`scripts/PDFA_def.ps`** — Ghostscript conversion profiles.

### II. State Parity & Fallback Database Synchronization
All modifications to database structures or queries **MUST** support the dual-mode runtime engine:
- If a new SQL query is introduced inside a router, a corresponding Javascript-equivalent block **MUST** be implemented inside the `isUsingFallback` conditional scope to operate on `fallbackStore`.
- Operations on `fallbackStore` must synchronize changes to disk immediately by invoking the local saver modules to persist data inside `.local_fallback_db.json`.

### III. Aesthetic Guardrails & No AI-Slop Design
Maintain clean visual design standards:
- **No Unsolicited Telemetry**: Do not clutter headers, sidebars, or pages with structural metadata, internal runtime details, or port statements (e.g. `PORT: 3000`). Keep designs focused strictly on core functional elements.
- **Micro-Animations**: Pair all route additions or page transitions with Framer Motion entering animations (`motion/react`) for smooth, cohesive visual rendering.
- **Compliance Triggers**: Ensure that state changes to companies, contacts, or invoices trigger audit logging commands to update `sys_audit_event_logs`.

---
*Manifest manifest-version: 2.4.0 | Updated for EN 16931 / XRechnung 3.0 / zero-egress / validation gate / dynamic Custom Workflows / Vibe Coding Guidelines*
