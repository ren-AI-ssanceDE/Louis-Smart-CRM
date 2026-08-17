# 🔌 MCP-Client-Integration (Ist-Stand)

> **Historie:** Dieses Dokument war ursprünglich ein 3-Schritte-Implementierungsplan („Dynamischer MCP-Client“). Alle drei Schritte sind **umgesetzt und produktiv** — der Inhalt wurde auf den Ist-Stand (August 2026) aktualisiert.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist der „MCP-Client“ für Sie?

Es ist die Funktion, mit der **Louis sich mit anderen Programmen verbinden** kann — z. B. mit Google Workspace, Jira oder einer eigenen Wissensdatenbank. Sobald eine Verbindung eingerichtet ist, kann Louis die Werkzeuge dieser Programme nutzen — **aber nur mit Ihrer Freigabe**.

### Beispiel aus dem Alltag

> *„Erstelle ein Jira-Ticket für das fehlerhafte PDF-Layout.“*

1. Louis erkennt: Dafür gibt es ein Werkzeug vom Jira-Server (`mcp__jira__create_issue`).
2. **Louis stoppt** und fragt Sie: „Louis möchte folgendes Jira-Ticket erstellen: […] **Zulassen / Ablehnen**“.
3. Erst nach Ihrem „Zulassen“ führt Louis das Werkzeug aus.
4. Das Ergebnis (z. B. Ticket-Nummer) erscheint im Chat.

### Was Sie im Admin sehen

Im Bereich **„MCP-Verbindungen“** (Admin) sehen Sie alle verbundenen Server:
* **Status:** Verbunden / Verbindet… / Fehler
* **Werkzeug-Inspektor:** Welche Tools ein Server anbietet — inklusive Test-Schaltfläche
* **Presets:** Fertige Verbindungsvorlagen (z. B. Google Workspace) per Klick installierbar

### Sicherheit

* **Lesen ja, Schreiben nur mit Freigabe** — schreibende Aktionen (E-Mail senden, Ticket anlegen, Datei löschen) werden immer gestoppt und zur Bestätigung vorgelegt.
* **Kein Datenabfluss:** Verbindungen laufen über Ihre eigene Installation; Tokens liegen verschlüsselt im System.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Datenhaltung & Verbindungsmanagement (`McpConnectionManager`)

Jede Server-Konfiguration liegt in `sys_mcp_servers` (verwaltet über `mcpClientRouter`):

* `id` / `name` — Identifikation
* `type` — `stdio` (command + args + env) oder `sse`/`http` (url + headers)
* `transportConfig` — z. B. `npx -y @modelcontextprotocol/server-postgres …` oder `https://jira-mcp-connector.local/sse`
* `enabled` — Aktiv/Inaktiv

Der Connection Manager (`src/server/mcp/`) steuert den Lifecycle:
* **STDIO**: `child_process.spawn`, JSON-RPC 2.0 über STDIN/STDOUT, Fail-Safe-Restarts
* **HTTP/SSE**: POST für ausgehende, SSE für eingehende Nachrichten
* **Heartbeat**: Periodische Konnektivitätsprüfung; Ausfall → „Offline“ im UI, ohne die KI-Engine zu blockieren

## 2. Dynamische Service-Discovery & Tool-Translation

1. **Discovery (`tools/list`)**: Nach Verbindungsaufbau fragt der Manager die Tool-Liste ab (Name, Beschreibung, JSON-Schema) und cached sie (Hot-Reload bei Änderungen/Restarts).
2. **Universal-Übersetzer (`McpToolTranslator`)**:
   * Gemini SDK (`@google/genai`) → `FunctionDeclaration`
   * OpenAI-kompatible APIs / Ollama → `chat.completion.tool`-Format
   * **Namespace-Mapping**: `mcp__[server_name]__[tool_name]` (z. B. `mcp__jira__search_issues`) — verhindert Kollisionen bei gleichen Tool-Namen
3. **Dispatcher (`tools/call`)**: Der Orchestrator fängt `mcp__`-Präfixe ab, extrahiert Server + Tool, leitet Argumente an den Connection Manager und formatiert das Ergebnis zurück.

## 3. Sicherheits-Gateway & Orchestrator-Schleife

* **Orchestrator-Integration**: Beim Chat-Start fragt der Orchestrator alle aktiven MCP-Clients ab und hängt deren Funktionen an die System-Tools an — externe Tools wirken wie native.
* **Human-in-the-Loop-Gateway**:
  * **Lese-Tools** (read-only): sofort ausführbar
  * **Schreib-/kritische Tools** (send_email, create_ticket, delete_file): Dispatch stoppt → WebSocket/Broadcast `MCP_APPROVAL_REQUIRED` → Bestätigungs-Card im Chat („Zulassen / Ablehnen“) → erst nach Bestätigung `tools/call`
* **Admin-Verwaltungs-UI**: Tab **„MCP-Verbindungen“** im Admin-Panel:
  * Server hinzufügen/aktivieren/deaktivieren/löschen
  * Verbindungsstatus („Verbunden“, „Verbindet…“, „Fehler“) + Fehler-Log
  * **Tool-Inspektor**: listet erkannte Tools inkl. Test-Schaltfläche
  * **Presets-Katalog** (`getPresetsCatalog` / `installPreset`): 1-Klick-Integration bekannter Server
  * **OAuth**: `initiateOAuth` für geschützte Anbieter

## 4. Praxisbeispiel

*„Erstelle ein Jira-Ticket für das fehlerhafte PDF-Layout.“*

1. Louis AI erkennt den Intent und wählt `mcp__jira__create_issue`.
2. Das Sicherheits-Gateway stoppt den Dispatch → Freigabe-Card im Chat.
3. Nach Zustimmung führt der Dispatcher `tools/call` gegen den Jira-Server aus.
4. Ergebnis wird formatiert und im Chat präsentiert; Aktion landet im Audit-Log.

## 5. MCP-Architektur-Dateien

| Datei | Funktion |
|---|---|
| `src/server/mcp/mcpServer.ts` | CRM als MCP-Server (SSE/JSON-RPC, API-Key-Auth) |
| `src/server/mcp/mcpClientEngine.ts` | Client-Engine (Discovery, Mapping, Execution) |
| `src/server/mcp/mcpBridge.ts` | Brücke zwischen Agent-Runtime und MCP |
| `src/server/routers/mcpClient.ts` | tRPC: Serververwaltung, Presets, OAuth |
| `src/server/routers/mcpExecution.ts` | tRPC: Domain-Actions, Tool-Mappings |

## 6. Verwandte Dokumente

* [Readme Model Context Protocol (MCP)](Readme%20Model%20Context%20Protocol%20(MCP).md) — Gesamtüberblick Server + Client + Telegram
* [Readme Louis AI Assistent](Readme%20Louis%20AI%20Assistent.md) — Tool-Integration im ReAct-Loop
