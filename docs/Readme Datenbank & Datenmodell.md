# 🗄️ Datenbank & Datenmodell

> Dieses Dokument erklärt, **wie und wo Louis Smart CRM Ihre Daten speichert** — für Anwender vereinfacht, für Entwickler im Detail. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Wo liegen meine Daten?

Louis Smart CRM hat ein **doppeltes Sicherheitsnetz** für die Speicherung:

1. **Normalfall: eine Datenbank (PostgreSQL)** — strukturiert, schnell, mit integrierter KI-Suchfunktion (Vektorsuche für semantische Ähnlichkeit).
2. **Notfall: eine lokale Datei** — ist die Datenbank nicht erreichbar (z. B. beim Testen ohne Server), wechselt das System **automatisch und unbemerkt** auf eine lokale Datei. Sie merken davon nichts, und nichts geht verloren.

Zusätzlich gibt es **Daten-Ordner („Vaults“)** für Dokumente: Unternehmensdateien, Kontaktdateien und Wissensdokumente liegen als echte Dateien auf der Festplatte — sie werden von Louis durchsucht und für KI-Antworten genutzt.

## Was wird gespeichert?

* **Stammdaten:** Benutzerkonten, Unternehmen, Kontakte (mit Datenschutz-Einwilligungen)
* **Belege:** Rechnungen, Angebote (inkl. aller Positionen und Beträge)
* **KI-Daten:** Gesprächshistorien, Wissens-Chunks (für die Suchfunktion), Workflows, Agent-Jobs, Merkzettel von Louis
* **Verbindungen:** E-Mail-Server-Einstellungen, Telegram, MCP-Server, Spracherkennung
* **Sicherheitsprotokoll:** das unveränderbare Audit-Log

## Wer sieht welche Daten?

Das System ist **mandantenfähig**: Jede Firma/Nutzer sieht nur ihre eigenen Daten — wie getrennte Aktenschränke. Technisch wird das über eine `tenant_id` (Mandantenkennung) auf allen Datensätzen erzwungen.

## Sind meine Daten sicher?

* **Regelmäßige Backups:** Vor wichtigen Änderungen (z. B. Updates) wird empfohlen, ein Backup zu erstellen — der Ablauf ist dokumentiert.
* **Kein Datenverlust bei Updates:** Das System führt **nur ergänzende (additive) Änderungen** an der Datenbank durch; alte Daten bleiben erhalten und werden automatisch an neue Formate angepasst (nie gelöscht).
* **Revisionssicherheit:** Rechnungen und Protokolle können nicht verändert oder gelöscht werden (gesetzliche Pflicht).

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Dual-Storage-Architektur (`src/server/db.ts`)

* **PostgreSQL-Pfad**: `pg.Pool` mit parametrisierten Queries; Erweiterung `vector` für **1536-dimensionale Embeddings**; Mandanten-Isolation über `tenant_id`.
* **JSON-Fallback-Pfad**: Der Fallback schreibt atomar in eine lokale JSON-Datei; In-Memory-Vektorsuche (Cosine Similarity); selbstheilende Migrationen beim Laden.
* **Weiche**: Router rufen generische Helper auf; die Pfadwahl (Datenbank oder Fallback) erfolgt transparent.

**Regel:** Jede neue Funktion muss beide Pfade unterstützen (Dual-Store-Pflicht).

## 2. Kerntabellen

| Tabelle | Inhalt |
|---|---|
| `auth_access_identities` | Benutzerkonten, Rollen (admin, user), Zugriffsrechte |
| `core_registry_companies` | Unternehmen: Anschrift, Steuernummern, IBAN/BIC, Leitweg-ID, Vektor-Embeddings |
| `core_registry_contacts` | Kontakte: Kommunikation, DSGVO-Opt-ins, Embeddings, `associated_company_id` |
| `fiscal_billing_invoices` | Rechnungen: Positionen (`invoice_line_items_json`), Netto/Brutto, ZUGFeRD-Metadaten, Status (`draft/issued/paid/overdue/cancelled`) |
| `offers` | Angebote: Gültigkeit, Positionen, Status, Konvertierung |
| `core_registry_my_company_table` | Eigenes Unternehmen: Nummernkreise (Rechnung/Angebot), Bankverbindung, Logo |
| `kanban_boards` / `kanban_columns` / `kanban_cards` / `kanban_approvals` | Kanban-Pipeline |
| `council_sessions` / `council_messages` | Council-Debatten |
| `sys_louis_ai_sessions` / `sys_louis_ai_chat_history` | Agenten-Sessions & Gesprächshistorien |
| `sys_louis_ai_knowledge_metadata` / `sys_louis_ai_knowledge_chunks` | RAG-Wissensbasis (Chunks + Embeddings) |
| `sys_louis_ai_custom_workflows` | Workflows (inkl. `dag_structure`, `skill_version`, `version_history`) |
| `sys_louis_ai_agent_jobs` | Agent-Jobs (script/monitor) |
| `sys_louis_ai_user_memory` | Langzeitgedächtnis des Assistenten |
| `sys_louis_mail_drafts` | E-Mail-Entwürfe (`PENDING/APPROVED/REJECTED/SENT/FAILED`) |
| `sys_comms_email_templates` / `sys_comms_invoice_text_templates` / `sys_comms_invoice_item_templates` / `sys_comms_signatures` | Vorlagen & Signaturen |
| `sys_integrations_smtp_nodes` | SMTP-Server-Konfiguration |
| `sys_integrations_telegram_settings` | Telegram-Gateway |
| `sys_integrations_stt_config` | Speech-to-Text-Konfiguration |
| `sys_integrations_louis_ai_config` | KI-Konfiguration (Provider, Modell, Temp …) |
| `sys_mcp_api_keys` / `sys_mcp_external_servers` / `sys_mcp_discovered_tools` / `sys_mcp_oauth_tokens` | MCP-Server & Client (API-Keys, Server, Tools, OAuth) |
| `sys_audit_log` | Append-Only-Audit-Log |
| `sys_louis_ai_questions` | Persistierte Rückfragen (ask_user_question) |

## 3. Migrationen & Abwärtskompatibilität

* **Nur additive Migrationen**: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — idempotent.
* **Keine Destruktion**: Kein unaufgefordertes `DROP TABLE`/`TRUNCATE`/hartes `DELETE` für Kernentitäten.
* **Auto-Migration von Altdaten**: z. B. lineare Workflows ohne `dag_structure` werden beim App-Start automatisch in DAGs konvertiert (nicht gelöscht); Legacy-Statusfelder werden normalisiert.
* **Migration**: TIMER-Last-Run-Marker werden idempotent migriert.

## 4. Daten-Governance & Events

* **Mandanten-Isolation**: `tenant_id` auf allen Tabellen/Stores; Standard-Mandant `'1'`.
* **Event-Driven**: Mutationen emittieren `workflowEventBus.emitEvent(tenantId, 'entity.action', payload)` → Workflow-Trigger.
* **Revisionssicherheit**: Rechnungsdaten bleiben nach GoBD 10 Jahre erhalten; Löschungen sind kaskadierend und datenschutzkonform (siehe [Readme Sicherheit](Readme%20Sicherheit%2C%20Transparenz%20%26%20DSGVO-Compliance.md)).

## 5. QA-Hinweise


* **Testdaten-Pflicht**: QA nur mit Musterfirma GmbH-Daten und „Test Testkunde“ — niemals echte Kontakte/Unternehmen.
* **Backups**: Vor DB-Migrationen immer ein Backup erstellen (Ablage in einem separaten Backup-Verzeichnis außerhalb des Repos).
