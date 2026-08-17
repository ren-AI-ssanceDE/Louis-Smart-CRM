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

> 💡 **Tipp für Docker-Betrieb (BUG-11, Auftrag 015):** Wenn Louis im Docker-Container läuft und der externe MCP-Server **auf dem Host-Rechner** (z. B. `localhost:9333`), dann `localhost` im Louis-Container **nicht** den Host — der Container erreicht den Host nur über `http://host.docker.internal:PORT`. Adressen, die mit `localhost:` beginnen, werden sonst nicht gefunden (Tool-Erkennung findet 0 Tools).

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
│  → Tools stehen Louis AI als mcp__<server>__<tool> zur Verfügung     │
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

* **Serververwaltung** (`mcpClientRouter`): `listServers`, `createServer`, `updateServer`, `deleteServer`, `pingServer`
* **Transporte**: STDIO (spawn) und HTTP/SSE
* **Tool-Discovery**: `discoverTools` → `tools/list` → Cache; Hot-Reload bei Änderungen
* **Namespace-Mapping**: `mcp__<server_name>__<tool_name>` (z. B. `mcp__jira__search_issues`) — verhindert Namenskollisionen
* **Universal-Übersetzer**: JSON-Schema → Gemini `FunctionDeclaration` bzw. OpenAI-kompatible Tool-Formate
* **OAuth**: `initiateOAuth` für geschützte Server (Tokens in `sys_mcp_oauth_tokens`)
* **Presets**: `getPresetsCatalog` + `installPreset` — 1-Klick-Integration bekannter Server
* **Tool-Mappings** (`mcpExecutionRouter`): `executeDomainAction`, `listToolMappings`, `saveToolMapping`, `deleteToolMapping` — domänenbasierte Zuordnung externer Tools
* **Ausführung**: `executeTool` → `tools/call` → Ergebnis an den Orchestrator

### Sicherheits-Gateway
* **Lese-Tools** (read-only): sofort ausführbar.
* **Schreib-/kritische Tools** (send_email, create_ticket, delete_file …): Dispatch stoppt → Freigabe-Anfrage im Chat („Louis möchte folgendes Jira-Ticket erstellen … Zulassen / Ablehnen“).

## 4. Obsidian-Anbindung: Local REST API MCP-Plugin (S10 Tier-1)

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
{ "query": "Regelkatalog" }
```

**Strukturierte Suche (`search_query`)** — erwartet ein **JsonLogic-Objekt** (kein String!):
```json
{ "query": { "in": ["tags", ["Regelkatalog"]] } }
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
