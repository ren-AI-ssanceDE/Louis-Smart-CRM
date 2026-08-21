# 🔌 Model Context Protocol (MCP) — CRM-Integration

> MCP („Model Context Protocol“) ist ein offener Standard, mit dem KI-Programme **sicher mit anderen Programmen und Datenquellen** verbunden werden. Louis Smart CRM kann dabei beides sein: Anbieter **und** Nutzer. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist MCP — und was bedeutet es für Sie?

MCP ist wie eine **genormte Steckdose für KI-Werkzeuge**: Jedes Programm, das MCP spricht, kann mit jedem anderen sprechen — ohne Spezial-Anpassungen. Louis Smart CRM nutzt das auf zwei Arten:

### 1. Louis kann seine Fähigkeiten anbieten (CRM als „Server“)
Andere KI-Programme — z. B. **Claude Desktop**, **Cursor** (Programmier-Editor) oder der **Telegram-Bot** — können sich mit Ihrem CRM verbinden und darin suchen oder Entwürfe anlegen. Beispiel: Sie fragen Ihren KI-Editor „Suche den Kontakt Julia Sommer im CRM“ — und er findet ihn.

### 2. Louis kann sich mit anderen Werkzeugen verbinden (CRM als „Client“)
Louis kann **externe MCP-Server** anbinden — z. B. Google Workspace, Jira, eigene Wissensdatenbanken oder Ihren Obsidian-Notizschatz. Dann kann Louis z. B. ein Jira-Ticket anlegen (mit Ihrer Freigabe!) oder in Ihren Notizen suchen.

## Wie sicher ist das?

* **Nur mit Ihrer Freigabe:** Schreibende Aktionen von Louis (z. B. „Jira-Ticket erstellen“) werden gestoppt und erscheinen als **Freigabe-Frage im Chat** — „Louis möchte folgendes Jira-Ticket erstellen … Zulassen / Ablehnen“.
* **Lesen ist erlaubt, Schreiben wird geprüft:** Reine Lese-Abfragen laufen sofort; alles, was etwas verändert, braucht Ihr OK.
* **Zugang geschützt:** Externe Programme brauchen einen **API-Schlüssel** (wird im Admin vergeben).
* **Ihre Daten bleiben bei Ihnen:** Die Verbindungen laufen lokal in Ihrem Netzwerk.

## Der eingebaute Vault-Server (Obsidian)

Im Lieferumfang ist ein fertiger MCP-Server enthalten, der Ihren **Obsidian-Notizordner** anbindet: Louis kann darin lesen, suchen und (nur in einem eigenen Bereich `_louis/`) Notizen ablegen. Private Ordner (`Privat/`, `RO/`) sind technisch gesperrt.

## Wie richte ich externe Verbindungen ein?

1. **Admin → MCP-Verbindungen** öffnen.
2. Server hinzufügen (Adresse/Token) — oder aus dem **Presets-Katalog** mit einem Klick installieren (z. B. Google Workspace).
3. Verbinden, Tools werden automatisch erkannt und erscheinen bei Louis.
4. Fertig — Louis kann die neuen Werkzeuge nutzen (mit Freigabe).

> 💡 **Tipp für Docker-Betrieb:** Wenn Louis im Docker-Container läuft und der externe MCP-Server **auf dem Host-Rechner** (z. B. `localhost:9333`), dann `localhost` im Louis-Container **nicht** den Host — der Container erreicht den Host nur über `http://host.docker.internal:PORT`. Adressen, die mit `localhost:` beginnen, werden sonst nicht gefunden (Tool-Erkennung findet 0 Tools).

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Rollen im Überblick

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ EXTERNE MCP-CLIENTS          │        │ EXTERNE MCP-SERVER           │
│ Claude Desktop, Cursor,      │        │ Google Workspace, Jira,      │
│ Windsurf, Telegram-Gateway   │        │ Filesystem, eigene Dienste,  │
│ (Local REST API MCP)          │        │ Obsidian-MCP (Tier 1)          │
└──────────────┬───────────────┘        └──────────────┬───────────────┘
               │ SSE / JSON-RPC 2.0                    │ STDIO / HTTP / SSE
               ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     LOUIS CRM EXPRESS SERVER                         │
│  MCP-SERVER: /api/mcp/sse + /api/mcp/message (API-Key-Auth)          │
│  MCP-CLIENT: McpClientEngine (Discovery, OAuth, Presets, Execution)  │
│  → Tools stehen Louis AI als mcp_<server>_<tool> zur Verfügung     │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Louis CRM als MCP-Server

Externe Clients können CRM-Funktionen über natürliche Sprache ansprechen.

### Endpunkte (`server.ts`)
| Endpunkt | Zweck |
|---|---|
| `GET /api/mcp` / `POST /api/mcp` | JSON-RPC 2.0 (mit API-Key via `mcpAuthMiddleware`) |
| `GET /api/mcp/sse` | SSE-Stream: `event: endpoint` + `sessionId`, Keep-Alive alle 20 s |
| `POST /api/mcp/message?sessionId=…` | JSON-RPC-Methoden: `initialize` (Protokoll 2024-11-05, `louis-crm-server`), `tools/list`, `tools/call` |
| `GET /api/mcp/oauth/callback` | OAuth-Callback für externe Server-Anbindung |

### Deklarierte Tools (Auswahl)
| Tool | Funktion |
|---|---|
| `search_contacts` | Kontaktsuche (Name, E-Mail, Telefon, Stadt) |
| `crm_data_analyst` | Komplexe Such- & Reporting-Anfragen (Vektor + SQL) |
| `create_invoice_draft` | Rechnungsentwurf (immer `draft`) |
| `create_company_draft` / `create_contact_draft` | Entwürfe (Freigabe erforderlich) |
| `chat_with_louis` | Kontextuelle Konversation mit dem ReAct-Agenten |
| `clear_louis_chat` | Session-Kontext zurücksetzen (Datenschutz) |

> **Sicherheit:** Externe Clients erzeugen ausschließlich **Drafts**; die finale Freigabe liegt immer beim Benutzer im CRM.

## 3. Louis CRM als MCP-Client (McpClientEngine)

Die Client-Engine (`src/server/mcp/mcpClientEngine.ts`) verbindet Louis AI mit externen MCP-Servern:

### Datenhaltung & Verbindungsmanagement

Jede Server-Konfiguration liegt in `sys_mcp_external_servers` (verwaltet über `mcpClientRouter` in `src/server/routers/mcpClient.ts`):

* `id_uuid` / `server_name` — Identifikation
* `type` — `stdio` (command + args + env) oder `sse`/`http` (url + headers)
* `transportConfig` — z. B. `npx -y @modelcontextprotocol/server-postgres …` oder eine HTTPS-/SSE-URL
* `enabled` — Aktiv/Inaktiv
* `auth_token_encrypted` — Zugangs-Token, **AES-256-GCM-verschlüsselt** (Secret aus Container-Env `LOUIS_SECRET_KEY`, Magic `lv1:` — siehe `src/server/mcp/secretCrypto.ts`)

Der Connection Manager (`src/server/mcp/`) steuert den Lifecycle (seit dem SDK-Umbau 2026-08 über `src/server/mcp/sdkTransport.ts`/`src/server/mcp/serverLifecycle.ts` auf Basis von `@modelcontextprotocol/sdk` v1.30):
* **STDIO**: `child_process.spawn`, JSON-RPC 2.0 über STDIN/STDOUT, Fail-Safe-Restarts (`stderr: inherit`, Hard-Timeouts via `Promise.race`)
* **HTTP/SSE**: Streamable-HTTP-Handshake + SSE-Parsing, HTTPS mit selbstsignierten Zertifikaten
* **Heartbeat**: Periodische Konnektivitätsprüfung; Ausfall → „Offline“ im UI, ohne die KI-Engine zu blockieren

### Serververwaltung, Discovery & Tool-Mapping

* **Serververwaltung** (`mcpClientRouter`): `listServers`, `createServer`, `updateServer`, `deleteServer`, `pingServer`
* **Tool-Discovery**: `discoverTools` → `tools/list` → Cache; Hot-Reload bei Änderungen (TTL-Cache mit Admin-Basismenge, Chatprofil-Filter läuft bei jedem Aufruf)
* **Namespace-Mapping**: Normalisierte Tool-Namen `mcp_<server>_<tool>` (z. B. `mcp_e2e_mock_server_014_echo_text`) — `getToolByNormalizedName` matcht **exakt zuerst**, Suffix-Fallback nur wenn nichts exakt passt (verhindert Kollisionen bei gleichen Tool-Namen über mehrere Server)
* **Universal-Übersetzer**: JSON-Schema → Gemini `FunctionDeclaration` bzw. OpenAI-kompatible Tool-Formate
* **Kompatibilitäts-Fallback**: Einige Google-Pakete (z. B. ältere mcp-gmail/server-gdrive-Versionen) lieferten `$schema`-Input-Schemas ohne `type`/`properties` — ein Raw-Kompatibilitäts-Fallback (roher JSON-RPC-Client) fängt diese Fälle ab. Der Kalender-Server `@cocal/google-calendar-mcp` (seit 2.1.2) liefert vollständige Schemas mit `properties`.
* **OAuth**: `initiateOAuth` für geschützte Server (Tokens in `sys_mcp_oauth_tokens`, werden vom Server-Prozess selbst refresht)
* **Presets**: `getPresetsCatalog` + `installPreset` — 1-Klick-Integration bekannter Server (exakt die 8 freigegebenen Presets; im Entwicklungsprozess durch einen Katalog-Guard abgesichert)
* **Tool-Mappings** (`mcpExecutionRouter`): `executeDomainAction`, `listToolMappings`, `saveToolMapping`, `deleteToolMapping` — domänenbasierte Zuordnung externer Tools
* **Ausführung**: `executeTool` → `tools/call` → Ergebnis an den Orchestrator (`result = { content }`, volles MCP-Result)

### Sicherheits-Gateway
* **Orchestrator-Integration**: Beim Chat-Start fragt der Orchestrator alle aktiven MCP-Clients ab und hängt deren Funktionen an die System-Tools an — externe Tools wirken wie native.
* **Lese-Tools** (read-only): sofort ausführbar.
* **Schreib-/kritische Tools** (send_email, create_ticket, delete_file …): Dispatch stoppt → Freigabe-Anfrage im Chat („Louis möchte folgendes Jira-Ticket erstellen … Zulassen / Ablehnen“).
* **Governance-Regeln**: Lösch-/Schreib-Zugriffe folgen den Admin-Governance-Regeln (z. B. Löschen blockieren); Audit-Log protokolliert alle Schreibzugriffe.
* **Admin-Verwaltungs-UI**: Tab **„MCP-Verbindungen“** im Admin-Panel — Server anlegen/aktivieren/deaktivieren/löschen, Verbindungsstatus + Fehler-Log, Tool-Inspektor mit Test-Schaltfläche, Presets, OAuth.

### Praxisbeispiel

*„Erstelle ein Jira-Ticket für das fehlerhafte PDF-Layout.“*

1. Louis AI erkennt den Intent und wählt `mcp_jira_create_issue`.
2. Das Sicherheits-Gateway stoppt den Dispatch → Freigabe-Card im Chat.
3. Nach Zustimmung führt der Dispatcher `tools/call` gegen den Jira-Server aus.
4. Ergebnis wird formatiert und im Chat präsentiert; Aktion landet im Audit-Log.

### MCP-Architektur-Dateien

| Datei | Funktion |
|---|---|
| `src/server/mcp/mcpServer.ts` | CRM als MCP-Server (SSE/JSON-RPC, API-Key-Auth) |
| `src/server/mcp/mcpClientEngine.ts` | Client-Engine (Discovery, Mapping, Execution) |
| `src/server/mcp/sdkTransport.ts` | SDK-Transport (Streamable-HTTP/SSE/STDIO, `@modelcontextprotocol/sdk` v1.30) |
| `src/server/mcp/serverLifecycle.ts` | Server-Prozess-Lebenszyklus (Spawn, Health, Restarts) |
| `src/server/mcp/secretCrypto.ts` | AES-256-GCM-Verschlüsselung der Zugangs-Tokens (`lv1:`) |
| `src/server/mcp/chatProfiles.ts` | Chatprofil-Tool-Filter (effektive Tool-Menge pro Profil) |
| `src/server/mcp/presets.ts` | Preset-Katalog (8 freigegebene Vorlagen) |
| `src/server/mcp/oauthHandler.ts` | OAuth-Flow für geschützte Anbieter |
| `src/server/routers/mcpClient.ts` | tRPC: Serververwaltung, Presets, OAuth |
| `src/server/routers/mcpExecution.ts` | tRPC: Domain-Actions, Tool-Mappings |

## 4. Obsidian-Anbindung: Local REST API MCP-Plugin

Seit 2026-08-16 ist das **Local REST API Plugin** (coddingtonbear) die Obsidian-Wissensanbindung — das Plugin ist **selbst ein MCP-Server** (Streamable-HTTP). Es arbeitet auf dem **aktuell in Obsidian geöffneten Vault** (beim CRM: der eigene CRM-Vault mit `Willkommen.md` + `_louis/`). Kein Dateisystem-Zugriff, keine Pfad-Konfiguration im Code.

**Einrichtung in Obsidian (einmalig):**
1. Einstellungen → Community-Plugins → **Local REST API** installieren + aktivieren
2. Einstellungen → Local REST API → **„Binding host" auf `0.0.0.0`** setzen (sonst für Docker-Container unerreichbar — Loopback)
3. **API Key** kopieren (nur den Hex-Schlüssel, **ohne** „Bearer "-Präfix)
4. Plugin kurz aus-/einschalten, damit der Server neu lauscht (Port **27124**, HTTPS mit selbstsigniertem Zertifikat)

**Einrichtung in Louis (Admin → Verbindungen → Marktplatz → „Obsidian Vault (Tier 1)"):**

| Feld | Wert |
|---|---|
| Obsidian MCP URL | `https://host.docker.internal:27124/mcp/` |
| Obsidian Local REST API Key | der Hex-Schlüssel aus Schritt 3 |

**Tools (16):** `vault_list`, `vault_read`, `vault_write`, `vault_append`, `vault_patch`, `vault_delete`, `vault_move`, `vault_copy`, `vault_get_document_map`, `active_file_get_path`, `search_simple`, `search_query`, `tag_list`, `command_list`, `command_execute`, `open_file`.

### Beispiele (Live verifiziert 2026-08-16)

**Volltextsuche (`search_simple`)** — einfacher String:
```json
{ "query": "Projektnotizen" }
```

**Strukturierte Suche (`search_query`)** — erwartet ein **JsonLogic-Objekt** (kein String!):
```json
{ "query": { "in": ["tags", ["Projektnotizen"]] } }
```
⚠️ Ein einfacher String führt zu `MCP error -32602: Expected object, received string at query`.

**Abschnitt patchen (`vault_patch`)** — `target` muss ein **Array** von Überschriftstexten sein (kein String!):
```json
{
  "path": "_louis/meine-notiz.md",
  "targetType": "heading",
  "target": ["Meine Überschrift"],
  "operation": "replace",
  "content": "Neuer Inhalt des Abschnitts"
}
```
⚠️ `target: "Meine Überschrift"` (String) wird abgelehnt: *„a heading target must be an array of heading texts, or null for the document root"*.

**Datei lesen (`vault_read`)** — optional mit `scope`/`target`/`targetType` (z. B. nur einen Abschnitt lesen).

## 5. Das Telegram Bot Gateway als MCP-Client

Der Daemon `services/telegram-bot-gate` verbindet sich beim Start per SSE mit dem MCP-Server (`http://app:3000/api/mcp/sse`), fragt die Tools ab und vermittelt Chat-Anfragen — einfache Suchen direkt, komplexe Anweisungen über `chat_with_louis`. Details: [Readme Telegram](Readme%20Telegram.md).

## 6. Sicherheitsaspekte & Datenhoheit

* **Human-in-the-Loop Standard**: Über MCP erzeugte Entitäten verbleiben im Status `draft`. Kein Client kann fertige Rechnungen buchen oder E-Mails versenden.
* **API-Key-Auth**: Der Server-Endpunkt ist per API-Key geschützt (`sys_mcp_api_keys`).
* **DSGVO-konform**: Der MCP-Verkehr läuft im lokalen Docker-Netzwerk bzw. über vertrauenswürdige Verbindungen; keine Weitergabe an unautorisierte Clouds.
* **Vault-Governance**: Pfad-Sanitierung (kein Path-Traversal, NUL-Bytes, absolute Pfade) auf App- und Server-Ebene.

## 7. Externe MCP-Clients anbinden (z. B. Claude Desktop)

Claude-Desktop-Konfiguration (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "louis-crm": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/client-sse", "http://localhost:3000/api/mcp/sse"]
    }
  }
}
```

Nach Neustart stehen der KI alle registrierten Louis-CRM-Tools zur Verfügung.
