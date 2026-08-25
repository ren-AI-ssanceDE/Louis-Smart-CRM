# Louis Smart CRM

<img width="2064" height="1110" alt="louis_smart_crm_release" src="https://github.com/user-attachments/assets/8033d26b-97c3-4587-868e-033392c28694" />

> **Version 2.1.7** — Das KI-gestützte CRM für kleine Unternehmen, Freiberufler und Solo-Selbstständige.
> Highlight der Version: Moderne MCP Server, Rückfragen deines Agenten beantwortest du direkt im Kontext oder klassisch im Adminpanel. Dazu kleinere Anpassungen am Design des LLM Council und Bug-Fixes.
> Probier's aus - einfach herunterladen und installieren!
---

## 🧑‍💼 Teil 1 — Anwender

### Was ist Louis Smart CRM?

Louis Smart CRM ist ein webbasiertes CRM mit eingebautem KI-Assistenten. Du arbeitest über einen **Chat** (wie bei einem Messaging-Dienst): Louis versteht deine Anfrage in natürlicher Sprache und führt Aufgaben direkt im CRM aus — vom Anlegen eines Kontakts bis zum Versand eines Angebots.

### Die wichtigsten Bereiche

| Bereich | Was du damit machst |
|---|---|
| **Chat mit Louis** | Aufgaben in natürlicher Sprache: „Lege einen Kontakt für Firma X an", „Erstelle ein Angebot über 1.000 €", „Was haben wir letzte Woche besprochen?" |
| **Firmen & Kontakte** | Adressbuch mit Dokumenten-Ablage (Vault) pro Firma/Kontakt, Opt-in-Verwaltung |
| **Angebote & Rechnungen** | Angebote erstellen und versenden, Rechnungen mit **ZUGFeRD/XRechnung** (e-Rechnung) als PDF/A-3 |
| **Wissensdatenbank** | Dokumente hochladen — Louis durchsucht sie bei Fragen (RAG) |
| **Workflows** | Automatisierungen: „Wenn eine Rechnung fällig wird, schreibe eine Mahnung" — visueller DAG-Editor |
| **Admin-Bereich** | Einstellungen, MCP-Server, API-Schlüssel, Agent-Jobs, Governance-Regeln, Audit-Log |

### Start & Login

1. **Volume-Setup:** `npm run setup:volumes` — erkennt das vorhandene PostgreSQL-Volume auf deinem System (kein Umbenennen, deine Daten bleiben unangetastet) und schreibt den Namen in `.env` (frische Installationen legen automatisch `louis-crm_postgres_data` an)
2. Stack starten: `docker compose up -d` (siehe Teil 2)
3. Browser öffnen: **http://localhost:3000**
4. Login: `admin@louis-crm.de` / `admin` (beim ersten Login ändern!)

### KI-Assistent — so arbeitest du mit Louis

- **Direkt ansprechen:** Louis führt Schreib-Aktionen zunächst als **Entwurf** aus und fragt bei Änderungen nach (Freigabe). Bestätigst du, wird geschrieben.
- **Kontext:** Louis merkt sich Präferenzen und Gespräche (Memory) und erinnert sich an frühere Sitzungen.
- **Zwei Wissens-Bereiche:** Der **Obsidian-Vault** (Notizen, Skills, Memory — schreibend nur unter `_louis/`) und der **interne Wissensvault** (`knowledge_data_vault`, z. B. hochgeladene Dokumente) sind getrennt. Louis nutzt für jeden Bereich die passenden Werkzeuge (`vault_read`/`vault_search` für Obsidian, `knowledge_*` für intern).
- **Dokumente anhängen:** PDF, DOCX, XLSX, CSV, TXT u. v. m. im Chat hochladen (max. 5, je 25 MB) — optional in die Wissensdatenbank indizieren.
- **Grenzen:** Louis nutzt einen konfigurierten LLM-Provider. Schreibende Aktionen erzeugen zuerst Entwürfe; Workflows und MCP-Zugriffe folgen den Governance-Regeln.
- **Tool-Steuerung (Chatprofile):** Louis' eigene Tools sind immer verfügbar (CRM, Wissensvault, Kanban u. a.). Externe MCP-Tools (z. B. Google Workspace, Obsidian) steuerst du über **Chatprofile** — Auswahl im Chat-Header, Konfiguration im Admin (Tab „Chatprofile"): welches Profil welche externen Tools nutzen darf, inkl. Freigaben und Session-Override.

### Sicherheit & Datenschutz

- Passwörter werden mit **bcrypt** (per-User-Salt) gespeichert; alte Hashes werden beim nächsten Login automatisch migriert.
- **MCP-API-Schlüssel** sind widerrufbar und protokolliert; jeder Schreibzugriff landet im **Audit-Log** (filterbar, exportierbar).
- **Audit-Protokolle:** Es werden nur Compliance-relevante Ereignisse (Anlegen/Ändern/Löschen + Governance) protokolliert — keine Laufzeit-Telemetrie. Optional kann im Admin-Panel eine automatische Bereinigung nach X Tagen aktiviert werden (Standard: aus).
- **Chat-Verlauf:** Lange Gespräche werden von Louis automatisch zusammengefasst (komprimiert) — dabei wird der Verlauf kurzzeitig gesperrt (Nachrichten warten oder werden mit einem Hinweis beantwortet). Inaktive Sessions können im Admin-Panel optional nach X Tagen automatisch gelöscht werden (Standard: aus).
- Mandanten sind isoliert (Tenant-Prinzip); die Liste der bekannten Restlücken findest du in der Entwickler-Doku.

---

## 🔧 Teil 2 — Entwickler

### Stack & Architektur

| Komponente | Technologie | Container |
|---|---|---|
| Frontend + API | TypeScript, React (Vite), tRPC, Express | `louis-crm-app` (:3000) |
| Datenbank | PostgreSQL 15 + pgvector (RAG-Embeddings) | `louis-crm-db` (:5432, db `louis_crm`) |
| LLM-Anbindung | Provider-agnostisch (OpenAI/DeepSeek, Anthropic, Gemini, Ollama) | — |
| E-Rechnung | ZUGFeRD/XRechnung, Mustang-Validator, Ghostscript (PDF/A-3) | in `louis-crm-app` |
| MCP | MCP-Server-Engine (Katalog + Presets + externe Server) | `louis-crm-app` |
| Wissensanbindung | Obsidian-MCP (Local REST API Plugin) | extern/Obsidian |
| Zusatzdienste | Whisper (:8000), Telegram-Gate, Ollama | compose |

**Wichtige Projektregeln (Auszug):**
- **Kein ORM** — nur parametrisiertes SQL (`pg`)
- **zod als Single Source of Truth** — jeder tRPC-Endpunkt mit Input-/Output-Schema
- **i18n-Pflicht** — alle UI-Texte über `t()` mit `de.json` + `en.json`

### Vault-Architektur (zwei Wissens-Welten)

Louis kennt **zwei getrennte Vaults** — Tool-Namen sind disambiguiert (`knowledge_*` = intern, `vault_*` = Obsidian):

| Vault | Ziel | Katalog-Tools | Schreib-Governance |
|---|---|---|---|
| **Interner Wissensvault** | `knowledge_data_vault/<tenantId>/` (App-Dateisystem) | `knowledge_write`, `knowledge_update`, `knowledge_delete`, `list_knowledge_files`, `knowledge_search` | Pfad-Traversal-saniert, nur `.md/.txt/.json/.csv`; Audit-Log `VAULT_*` |
| **Obsidian-Vault (Tier 1)** | Obsidian Local-REST-API-Plugin (MCP, Port 27123/27124) | `vault_read`, `vault_search` (+ `save_skill`, `update_skill`, `delete_skill`, `update_memory`) | `_louis/`-Zwang für Schreiben; `Privat/`, `RO/` blockiert; Pfad-Sanitisierung in `vaultStore.ts` |

- **Alias-Namen:** Die früheren internen Namen `vault_write`/`vault_update`/`vault_delete`/`list_vault_files`/`local_knowledge` bleiben als **Dispatch-Aliase** gültig (Workflows, MCP-Katalog, Alt-Sessions) — im LLM-Prompt erscheinen sie nicht mehr als eigene Tools.
- **MCP-Exposition:** Der externe `MCP_TOOLS_CATALOG` behält die Namen `vault_search`/`vault_write`/`vault_update`/`vault_delete` (API-Vertrag) und zeigt auf den **internen** Vault — Dispatch über die `executeKnowledge*`-Aliase.
- **Obsidian-MCP-Tools:** Die 16 `mcp_obsidian_vault__tier_1_*`-Tools bleiben aktiv (vaultStore nutzt sie per `getToolByNormalizedName`); im Prompt werden die gekapselten (`vault_read`/`vault_write`/`vault_delete`/`vault_list`/`search_simple`) als „gekapselt — nutze Katalog-Tools" markiert.
- **Governance:** `vaultToolClassification.ts` klassifiziert suffix-basiert (logisch UND normalisiert, z. B. `mcp_<server>_knowledge_write` → write) für Governance & Duplicate-Block; `VAULT_WRITE_ACTION_MAP` deckt beide Familien ab.

### Audit-Log (Event-Disziplin + Retention)

- **Event-Disziplin (Allowlist):** `logAuditEvent` (db.ts) persistiert NUR Compliance-relevante Events — CRUD (`CREATE`/`UPDATE`/`DELETE` + Draft/Note/Board/User/Knowledge-Varianten), Governance (`GOVERNANCE_*`, `UPDATE_CONFIG`) und `FINALIZE`/`MEMORY_UPDATE`/`STATUS_CORRECTION`. Laufzeit-Telemetrie (`AGENT_PIPELINE_OPTIMIZED_EXECUTE`, `MEMORY_SYNC`, `TELEMETRY`, `AGENT_JOB*`, `SUB_TASK`, `RUN_WORKFLOW*`, `ERROR`, `WORKFLOW_MACRO`, `VAULT_*_FAILED`, …) wird verworfen (console.debug). Zentrale Allowlist: `AUDIT_WORTHY_EVENT_TYPES` / `isAuditWorthyEvent` — neue Event-Typen müssen dort BEWUSST ergänzt werden (Regel „Audit-Log NUR CRUD/Governance").
- **Retention (Regel 12):** Admin-Config `audit_retention_days` (Louis AI Config → Agenten-Laufzeit) — Tage, nach denen der Scheduler Audit-Einträge löscht. **NULL/leer = kein Auto-Prune** (empfohlen für Compliance-Historie; Opt-in).
- **Prune-Job:** `pruneAuditLogs`/`runAuditPruneBatches` (db.ts, CTE über `ctid`, Batches à 500, idempotent) — vom Scheduler (`tickWorkflowScheduler`) pro Tenant mit gesetzter Config aufgerufen. Der Prune selbst wird als `DELETE`-Audit (entity `audit_log`) protokolliert.
- **Audit-UI:** Tab „Audit-Protokolle" (Admin) mit Filtern (Typ/Akteur/Entität/Volltext), 10er-Pagination und CSV-Export (`getAuditLogs` in filesAndLogs.ts).

### Chat-Sessions (Kompression + Rotation + Retention)

- **Kontext-Kompression:** `scheduleBackgroundCompression` (contextCompressor.ts) fasst die Verlaufs-Mitte zusammen (Threshold-basiert, Head/Tail-Schutz, Aux-Modell) — NIE auf dem Antwort-Pfad (fire-and-forget).
- **Session-Rotation:** Statt die History in-place zu überschreiben (früher: Datenverlust), wird die bisherige Session zur abgeschlossenen **ELTERN-Session** (Voll-History bleibt erhalten!) und eine **KIND-Session** übernimmt die getrimmte History + Summary via `parent_session_id` (Titel: „<Eltern-Titel> (Fortsetzung)"). `persistCompressionResult` ist exportiert und testbar.
- **Rotation-Registry:** `registerSessionRotation`/`resolveRotatedSessionId` (Modul-Level, tenant-scoped) leitet den nächsten `sendMessage` mit alter SessionId auf die Kind-Session um und liefert deren ID in der Antwort — das Frontend übernimmt sie automatisch (LouisAi.tsx). Einträge werden nach Übernahme entfernt (`forgetSessionRotation`); bei Neustart fällt die Rotation sauber zurück (alte Session wird weitergeführt).
- **Kompressions-Lock:** Während der Zusammenfassung hält die Session einen Lock (TTL 60 s als Crash-Sicherheitsnetz). `sendMessage` wartet kurz (max 5 s, Polling 250 ms) und antwortet danach mit `compressionInProgress: true` statt parallel in die Session zu schreiben — die Chat-UI zeigt den Hinweis „🗜️ Louis komprimiert den Verlauf…" (Badge + „bitte kurz warten", i18n). Kein Button-Disabled im Voraus (Client kennt den Zustand nicht).
- **Retention (Regel 12):** Admin-Config `session_retention_days` (Louis AI Config → Agenten-Laufzeit) — Tage, nach denen der Scheduler **inaktive** Sessions löscht. **NULL/leer = kein Auto-Prune.** Kriterium ist Aktivität (`updated_at_utc`), da `sys_louis_ai_sessions` keinen Ende-Marker hat (Kriterium: Aktivität — Louis-Äquivalent zu `last_activity`).
- **Session-Prune:** `pruneSessions`/`runSessionPruneBatches` (db.ts, CTE über `ctid`, Batches à 500, idempotent) — vom Scheduler (`pruneSessionsIfConfigured`). **Kinder werden VOR dem Löschen verwaist** (parent → NULL); Konsequenz: recall verliert für verwaiste Kinder den Eltern-Bezug (bewusste Entscheidung). Der Prune selbst wird als `DELETE`-Audit (entity `session`) protokolliert.
- **Session-Recall:** Volltextsuche über Titel, Summary UND Nachrichten-Inhalte — über die generierte Spalte `history_searchable_text` (nur `content`-Felder, kein JSON-Rauschen), gewichtete `ts_rank` (Titel A=1.0 > Summary B=0.4 > History C=0.3) + Recency-Bonus 15 % (90 Tage).

### Betrieb & Troubleshooting

- **Health:** `curl localhost:3000/api/health` → `{"status":"ok"}`
- **Logs:** `docker logs louis-crm-app`
- **Bekannter Build-Fix:** Lato-Fonts werden aus dem Build-Kontext kopiert (kein GitHub-Download); Mustang-CLI wird beim Build geladen (Netz nötig)
- **MCP-Test-Key:** `RAW="louis_mcp_<name>"` → `sha256sum` → INSERT in `mcp_api_keys`, nach Tests löschen

