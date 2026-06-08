# 🔌 Wiki: Model Context Protocol (MCP) — CRM-Integration

Das **Model Context Protocol (MCP)** ist ein offener, moderner Standard (entwickelt von Anthropic und Industriepartnern), der es KI-Modellen ermöglicht, auf sichere und standardisierte Weise mit lokalen oder entfernten Datenquellen, APIs und Werkzeugen (Tools) zu interagieren.

In **Louis Smart CRM** ist ein vollständiger, maßgeschneiderter MCP-Server direkt in das Hauptsystem integriert. Dadurch kann sowohl das dezentrale **Telegram Bot Gateway** als auch jeder andere kompatible MCP-Client (wie z. B. Claude Desktop, Cursor oder Windsurf-IDEs) die mächtigen CRM-Funktionen über natürliche Sprache ansprechen.

---

## 🏗️ 1. Systemarchitektur & Kommunikationstyp

Die MCP-Integration in Louis Smart CRM basiert auf der SSE (Server-Sent Events) Spezifikation des Model Context Protocols. Dies ermöglicht einen asynchronen, ressourcenschonenden Vollduplex-Kommunikationskanal zwischen dem Server und den angebundenen Clients.

```
                  ┌──────────────────────────────────────────────┐
                  │              Telegram-Benutzer               │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         │ (HTTPS Chat-Streaming)
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │         Telegram Bot Gateway Client          │
                  │             (telegram-bot-gate)              │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         │ (Model Context Protocol via SSE)
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│                           Louis CRM Express Server                             │
│                                                                                │
│   - SSE Endpoint:   `GET /api/mcp/sse` (Stream-Initialisierung & Session ID)   │
│   - POST Endpoint:  `POST /api/mcp/message?sessionId=...`                      │
│                                                                                │
└────────────────────────────────────────┬───────────────────────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │             Datenbank & Tools                │
                  │   - DB-Registry (Kunden, Kontakte, Belege)   │
                  │   - Louis AI Core (Ollama / Gemini ReAct)    │
                  └──────────────────────────────────────────────┘
```

---

## 🔌 2. Server-Endpunkte im Express-Backend (`server.ts`)

Der MCP-Server wird direkt in der zentralen `server.ts` initialisiert und verwaltet zwei Kern-Routen:

### 📡 A. Stream-Initialisierung (`GET /api/mcp/sse`)
* **Arbeitsweise**: Dieser Endpunkt baut einen dauerhaften HTTP-Kanal (`text/event-stream`) zum Client auf.
* **Protokoll-Konformität**: Registriert das Event `endpoint` und sendet dem Client unverzüglich den dedizierten Sende-Pfad inklusive einer kryptografisch eindeutigen `sessionId` zurück:
  ```text
  event: endpoint
  data: /api/mcp/message?sessionId=abcdef12345
  ```
* **Keep-Alive**: Setzt ein regelmäßiges Ping-Signal im Abstand von 20 Sekunden ab, um Verbindungsabbrüche durch Firewalls oder Reverse Proxies zu verhindern.

### ✉️ B. JSON-RPC Schnittstelle (`POST /api/mcp/message`)
* **Arbeitsweise**: Richtet sich nach dem standardisierten JSON-RPC 2.0-Protokoll, über das Befehle, Initialisierungsdaten und Werkzeugaufrufe ausgetauscht werden.
* **Protokoll-Methoden**:
  * `initialize`: Gibt die Client-Fähigkeiten, die Protokollversion (`2024-11-05`) sowie Name (`louis-crm-server`) und Version der Server-Software zurück.
  * `tools/list`: Deklariert alle für die KI-Modelle verfügbaren Datenabfragen und Aktionen im CRM.
  * `tools/call`: Führt das angeforderte Tool lokal auf der CRM-Instanz unter Einhaltung des jeweiligen Mandanten-Contexts (Tenant) sicher aus und liefert das Ergebnis im standardisierten Textformat zurück.

---

## 🛠️ 3. Deklarierte MCP-Werkzeuge (Tools)

Louis Smart CRM stellt ein umfassendes Set an Werkzeugen bereit. Jedes Tool deklariert ein exaktes JSON-Schema zur parametergenauen Eingabevalidierung, wodurch fehlerhafte Datenübergaben minimiert werden:

| Tool-Name | Beschreibung | Primäre Eingabe-Parameter | Sicherheitsmechanismus / Wirkung |
| :--- | :--- | :--- | :--- |
| **`search_contacts`** | Sucht Kontakte im CRM anhand von Name, E-Mail, Telefon oder Stadt. | `query` *(string)* | Nur Suchtreffer des angemeldeten Mandanten werden zurückgegeben. |
| **`crm_data_analyst`** | Führt komplexe Such- und Reporting-Anfragen für Kontakte, Firmen und Rechnungen durch. | `query` *(string)* | Nutzt Vektor-Embeddings und strukturierte SQL-Suchen zur Analyse von Umsätzen oder Fälligkeiten. |
| **`create_invoice_draft`** | Erstellt einen neuen sicheren Rechnungsentwurf im CRM (keine finanzamtsrelevante Finalisierung). | `items_list` *(array)*, `company_id` *(string)*, `payment_term` *(string)* | Rechnungen werden ausschließlich im Status **`draft` (Entwurf)** abgelegt. |
| **`create_company_draft`** | Erstellt einen neuen Unternehmensentwurf (Draft) in der CRM-Kundenkartei. | `full_legal_name` *(string)*, `street` *(string)*, `tax_vat_id` *(string)* | Erfordert manuelle Überprüfung im Admin-Bereich vor Aktivierung. |
| **`create_contact_draft`** | Legt einen neuen Ansprechpartner / Kontakt im Entwurfsstatus an. | `last_name` *(string)*, `first_name` *(string)*, `email_address` *(string)* | Verknüpft Kontakte optional direkt mit bestehenden Firmen. |
| **`chat_with_louis`** | Ermöglicht die kontinuierliche Konversation mit dem CRM-Copiloten Louis AI unter Beibehaltung des Kontexts. | `message` *(string)*, `session_id` *(string)* | Erlaubt logisch zusammenhängende Rückfragen und Arbeitsanweisungen im Chat-Faden. |
| **`clear_louis_chat`** | Setzt den Chat-Verlauf und das Kurzzeitgedächtnis für eine Session zurück. | `session_id` *(string)* | Löscht temporäre Context-Buffer aus Datenschutzgründen sauber aus dem Arbeitsspeicher. |

---

## 🤖 4. Das Telegram Bot Gateway als dezentraler MCP-Client

Der im Docker-Verbund laufende Daemon **`telegram-bot-gate`** (`services/telegram-bot-gate/index.js`) ist das perfekte Praxisbeispiel für einen dezentralen MCP-Client:

1. **SSE-Verbindung aufrichten**: Beim Starten verbindet sich das Gateway mit der Adresse `http://app:3000/api/mcp/sse`.
2. **Dynamic Tool Mapping**: Es fragt über `tools/list` die verfügbaren Werkzeuge ab.
3. **Conversational Interface**: Sendet der freigeschaltete Benutzer eine Nachricht über Telegram, fungiert das Gateway als intelligenter Vermittler:
   * Einfache textuelle Fragen (z. B. *"Suche nach Peter Müller"*) werden direkt an `search_contacts` weitergeleitet.
   * Allgemeine kontextuelle Unterhaltungen oder komplexe Bitten (z. B. *"Erstelle bitte eine Rechnung an Firma Max für 10 Stunden Design, 150€/Std"*) werden über `chat_with_louis` geroutet, wo der ReAct-Agentenloop die logische Aufspaltung vornimmt.
   * Das Ergebnis des Tool-Aufrufs wird ansprechend für die Telegram-Chatoberfläche aufbereitet.

---

## 🔌 5. Externe MCP-Clients anbinden (z. B. Cursor oder Claude Desktop)

Da der Server vollkommen Standard-konform ist, können Sie Louis CRM auch für Ihre eigenen lokalen Entwicklungswerkzeuge freigeben, um z. B. direkt aus Ihrer CLI oder IDE heraus Abfragen zu starten.

### Konfiguration für Claude Desktop

Fügen Sie in Ihrer Claude-Desktop-Konfigurationsdatei (in der Regel unter `~/Library/Application Support/Claude/claude_desktop_config.json` auf macOS oder `%APPDATA%\Claude\claude_desktop_config.json` auf Windows) folgendes hinzu:

```json
{
  "mcpServers": {
    "louis-crm": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/client-sse",
        "http://localhost:3000/api/mcp/sse"
      ]
    }
  }
}
```

Nach einem Neustart von Claude Desktop stehen der KI alle registrierten Louis CRM Tools unmittelbar zur Verfügung.

---

## 🛡️ 6. Sicherheitsaspekte & Datenhoheit

### Human-in-the-Loop Standard
Über das MCP erstellte Entitäten (Kontakte, Firmen, Belege) verbleiben stets im Status **`draft`**. Kein externer Client oder automatisierter Bot kann versehentlich fertige, unveränderliche ZUGFeRD-Rechnungen buchen oder ungenehmigte E-Mails an Kunden herausschicken. Die finale Entscheidung verbleibt immer beim angemeldeten Anwender im **proposedChanges**-Panel oder der administrativen Kontrollmaske des CRM.

### Lokaler Betrieb und DSGVO-Konformität
Es findet kein Transfer von CRM-Daten an unautorisierte Cloud-Dienste statt. Da die Abwicklung des MCP-Protokolls vollständig im lokalen Docker-Netzwerk bzw. über vertrauenswürdige interne Verbindungen erfolgt, bleibt das System zu 100% DSGVO-konform.
