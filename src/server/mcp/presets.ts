import { McpPresetDefinition, McpPresetCategory } from '../../types.js';

export const MCP_PRESETS_CATALOG: McpPresetDefinition[] = [
  {
    id: 'google-calendar',
    name: 'Google Kalender',
    description: 'Direkter Zugriff auf Termine, Erstellung von Meetings und Kalender-Synchronisation via Google Calendar MCP.',
    icon: 'Calendar',
    category: 'google',
    transportType: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-google-calendar'],
    authType: 'oauth2',
    oauthProvider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'OAuth Client ID',
        type: 'string',
        required: true,
        description: 'Google Cloud Console OAuth 2.0 Client-ID'
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        type: 'password',
        required: true,
        description: 'Google Cloud Console OAuth Client Secret'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'list_events', louisToolName: 'google_calendar_list_events', description: 'Termine aus Google Kalender auflisten', enabled: true },
      { mcpToolName: 'create_event', louisToolName: 'google_calendar_create_event', description: 'Neuen Kalendereintrag erstellen', enabled: true },
      { mcpToolName: 'delete_event', louisToolName: 'google_calendar_delete_event', description: 'Kalendereintrag löschen', enabled: true }
    ]
  },
  {
    id: 'google-gmail',
    name: 'Google Gmail (E-Mails)',
    description: 'Posteingang durchsuchen, E-Mails lesen und Nachrichten verfassen via Gmail MCP Integration.',
    icon: 'Mail',
    category: 'google',
    transportType: 'stdio',
    command: 'npx',
    args: ['-y', '@monsoft/mcp-gmail'],
    authType: 'oauth2',
    oauthProvider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'OAuth Client ID',
        type: 'string',
        required: true,
        description: 'Google Cloud Console OAuth 2.0 Client-ID'
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        type: 'password',
        required: true,
        description: 'Google Cloud Console OAuth Client Secret'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'search_emails', louisToolName: 'gmail_search_emails', description: 'Gmail Nachrichten durchsuchen', enabled: true },
      { mcpToolName: 'send_email', louisToolName: 'gmail_send_email', description: 'E-Mail über Gmail versenden', enabled: true }
    ]
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace (Drive, Docs, Sheets)',
    description: 'Zugriff und Suche in Google Drive, Docs & Sheets Dateien.',
    icon: 'Folder',
    category: 'google',
    transportType: 'stdio',
    command: 'npx',
    // BUG-13 (Auftrag 015): deprecated @modelcontextprotocol/server-gdrive → aktive Community-Lösung
    args: ['-y', '@us-all/google-drive-mcp'],
    authType: 'oauth2',
    oauthProvider: 'google',
    requiredScopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file'
    ],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'OAuth Client ID',
        type: 'string',
        required: true,
        description: 'Google Cloud Console OAuth 2.0 Client-ID'
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'OAuth Client Secret',
        type: 'password',
        required: true,
        description: 'Google Cloud Console OAuth Client Secret'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'search', louisToolName: 'gdrive_search_files', description: 'Google Drive Dateien und Dokumente durchsuchen', enabled: true }
    ]
  },
  {
    id: 'postgres-database',
    name: 'PostgreSQL DB Inspector',
    description: 'Lese- und Schreibzugriff auf externe PostgreSQL-Datenbanken für tiefere Analysen.',
    icon: 'Database',
    category: 'database',
    transportType: 'stdio',
    command: 'npx',
    // BUG-13 (Auftrag 015): deprecated @modelcontextprotocol/server-postgres → aktive Community-Lösung
    args: ['-y', '@henkey/postgres-mcp-server', '{{POSTGRES_CONNECTION_STRING}}'],
    authType: 'none',
    fields: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'Postgres Connection String',
        type: 'password',
        required: true,
        placeholder: 'postgresql://user:pass@localhost:5432/dbname',
        description: 'Vollständige DB-Verbindungs-URL'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'query_database', louisToolName: 'postgres_query', description: 'SQL Query auf Postgres ausführen', enabled: true },
      { mcpToolName: 'list_tables', louisToolName: 'postgres_list_tables', description: 'Tabellenübersicht abfragen', enabled: true }
    ]
  },
  {
    id: 'brave-search',
    name: 'Brave Web Search',
    description: 'Echtzeit-Websuche für Louis AI zur Recherche von Firmendaten und News.',
    icon: 'Globe',
    category: 'search',
    transportType: 'stdio',
    command: 'npx',
    // BUG-13 (Auftrag 015): deprecated @modelcontextprotocol/server-brave-search → aktive Community-Lösung
    args: ['-y', 'mcp-server-brave-search'],
    authType: 'api_key',
    fields: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API Key',
        type: 'password',
        required: true,
        placeholder: 'BSAxxxxxxxxxxxxxxxxxxxx',
        description: 'Brave Search API Schlüssel'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'brave_web_search', louisToolName: 'web_search_brave', description: 'Websuche via Brave Search API', enabled: true }
    ]
  },
  {
    id: 'slack',
    name: 'Slack Integration',
    description: 'Sende Nachrichten, verwalte Channels und antworte auf Slack-Threads direkt aus dem CRM.',
    icon: 'MessageSquare',
    category: 'communication',
    transportType: 'stdio',
    command: 'npx',
    // BUG-13 (Auftrag 015): deprecated @modelcontextprotocol/server-slack → aktive Community-Lösung
    args: ['-y', '@nrjdalal/slack-mcp-server'],
    authType: 'api_key',
    fields: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot User OAuth Token',
        type: 'password',
        required: true,
        placeholder: 'xoxb-xxxxxxxxxxxx',
        description: 'Slack Bot Token (xoxb-...)'
      },
      {
        key: 'SLACK_TEAM_ID',
        label: 'Workspace Team ID',
        type: 'string',
        required: true,
        placeholder: 'T01234567',
        description: 'Slack Workspace Team ID'
      }
    ],
    defaultToolMappings: [
      { mcpToolName: 'post_message', louisToolName: 'slack_post_message', description: 'Nachricht in Slack-Channel senden', enabled: true },
      { mcpToolName: 'list_channels', louisToolName: 'slack_list_channels', description: 'Slack Channels auflisten', enabled: true }
    ]
  },
  {
    id: 'obsidian-mcp',
    name: 'Obsidian Vault (Tier 1)',
    // 2026-08-16 (Projektkorrektur): ECHTES Obsidian-MCP — das Local-REST-API-Plugin
    // ist selbst ein MCP-Server (http://127.0.0.1:27123/mcp/ bzw. https :27124/mcp/).
    // Konfiguration NUR im Admin (URL + API-Key) — kein .env, kein Vault-Pfad im Code.
    // (Dateisystem-Zugriff obsidian-mcp@2 wurde verworfen — kein Backup-Preset gewünscht.)
    description: 'Echtes Obsidian-MCP: verbindet sich mit dem Local-REST-API-Plugin in Obsidian (eigener MCP-Server). Obsidian muss laufen; URL + API-Key im Admin eintragen.',
    icon: 'BookOpen',
    category: 'knowledge',
    transportType: 'http',
    url: '{{OBSIDIAN_MCP_URL}}',
    authType: 'bearer',
    fields: [
      {
        key: 'OBSIDIAN_MCP_URL',
        label: 'Obsidian MCP URL',
        type: 'string',
        required: true,
        placeholder: 'http://host.docker.internal:27123/mcp/',
        description: 'MCP-Endpunkt des Local-REST-API-Plugins (HTTP: http://127.0.0.1:27123/mcp/ — im Container: http://host.docker.internal:27123/mcp/)'
      },
      {
        key: 'OBSIDIAN_API_KEY',
        label: 'Obsidian Local REST API Key',
        type: 'password',
        required: true,
        placeholder: 'API-Key aus Obsidian: Einstellungen → Local REST API',
        description: 'Bearer-Token aus dem Local-REST-API-Plugin (Obsidian: Einstellungen → Local REST API → API Key)'
      }
    ],
    defaultToolMappings: [
      // Echte Tools des Local-REST-API-MCP-Servers (16 Tools, README verifiziert)
      { mcpToolName: 'vault_read', louisToolName: 'obsidian_vault_read', description: 'Datei aus dem Obsidian-Vault lesen', enabled: true },
      { mcpToolName: 'vault_write', louisToolName: 'obsidian_vault_write', description: 'Datei in den Obsidian-Vault schreiben', enabled: true },
      { mcpToolName: 'vault_patch', louisToolName: 'obsidian_vault_patch', description: 'Abschnitt in einer Notiz gezielt patchen', enabled: true },
      { mcpToolName: 'vault_delete', louisToolName: 'obsidian_vault_delete', description: 'Datei aus dem Vault löschen (Papierkorb)', enabled: true },
      { mcpToolName: 'search_simple', louisToolName: 'obsidian_search', description: 'Vault-Volltextsuche (Obsidian-Suche)', enabled: true },
      { mcpToolName: 'search_query', louisToolName: 'obsidian_search_query', description: 'Strukturierte Suche (JsonLogic)', enabled: true },
      { mcpToolName: 'vault_list', louisToolName: 'obsidian_vault_list', description: 'Verzeichnis im Vault auflisten', enabled: true },
      { mcpToolName: 'active_file_get_path', louisToolName: 'obsidian_active_file', description: 'Aktuell geöffnete Datei in Obsidian lesen', enabled: true }
    ]
  },
  {
    id: 'custom-sse',
    name: 'Eigener SSE MCP-Server',
    description: 'Verbinde einen benutzerdefinierten MCP-Server über Server-Sent Events (HTTP/SSE).',
    icon: 'Server',
    category: 'developer',
    transportType: 'sse',
    url: '{{sse_url}}',
    authType: 'none',
    fields: [
      {
        key: 'sse_url',
        label: 'Server Sent Events URL',
        type: 'string',
        required: true,
        placeholder: 'https://mcp.example.com/sse',
        description: 'Vollständige HTTP/HTTPS URL zum MCP SSE Endpoint'
      }
    ]
  }
];

export function getPresetById(id: string): McpPresetDefinition | undefined {
  return MCP_PRESETS_CATALOG.find((p) => p.id === id);
}

export function getPresetsByCategory(category: McpPresetCategory): McpPresetDefinition[] {
  return MCP_PRESETS_CATALOG.filter((p) => p.category === category);
}

export function interpolatePresetConfig(
  preset: McpPresetDefinition,
  fieldValues: Record<string, string>
): { command?: string; args?: string[]; url?: string; env?: Record<string, string> } {
  let command = preset.command;
  let url = preset.url;
  let args = preset.args ? [...preset.args] : undefined;
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(fieldValues)) {
    if (url) {
      url = url.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    if (command) {
      command = command.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    if (args) {
      args = args.map((arg) => arg.replace(new RegExp(`{{${key}}}`, 'g'), value));
    }
    // Also store field values in env map (e.g., GITHUB_PERSONAL_ACCESS_TOKEN, BRAVE_API_KEY, SLACK_BOT_TOKEN)
    env[key] = value;
  }

  return {
    command,
    args,
    url,
    env
  };
}
