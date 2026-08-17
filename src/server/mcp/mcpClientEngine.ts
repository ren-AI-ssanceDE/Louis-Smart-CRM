import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { Agent as UndiciAgent } from "undici";
import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { getMcpOAuthToken } from "./oauthHandler.js";
import { normalizeAuthToken } from "./authTokenNormalize.js";
import {
  McpExternalServer,
  McpDiscoveredTool,
  McpToolMapping,
  McpToolExecutionInput,
  McpToolExecutionResult,
  McpHealthStatus,
  McpSanitizeOptions,
  McpExecutionResultPruned
} from "../../types.js";

export function normalizeToolArguments(
  toolName: string,
  rawArgs: Record<string, unknown>,
  inputSchema?: Record<string, unknown>
): Record<string, unknown> {
  if (!rawArgs || typeof rawArgs !== "object") {
    return {};
  }

  const normalized: Record<string, unknown> = { ...rawArgs };
  const rawEvent = (normalized.event && typeof normalized.event === "object")
    ? (normalized.event as Record<string, unknown>)
    : null;

  // 1. Calendar ID mapping
  let calId: unknown = undefined;
  for (const key of ["calendarId", "calendar_id", "calendar", "calendarID", "id"]) {
    if (key in normalized && normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== "") {
      calId = normalized[key];
      break;
    }
  }
  if (calId === undefined && rawEvent) {
    for (const key of ["calendarId", "calendar_id", "calendar", "calendarID", "id"]) {
      if (key in rawEvent && rawEvent[key] !== undefined && rawEvent[key] !== null && rawEvent[key] !== "") {
        calId = rawEvent[key];
        break;
      }
    }
  }
  if (calId === undefined && (toolName.includes("calendar") || toolName.includes("kalender") || toolName.includes("event"))) {
    calId = "primary";
  }
  if (calId !== undefined && typeof calId === "string") {
    normalized["calendarId"] = calId;
    normalized["calendar_id"] = calId;
    normalized["calendar"] = calId;
  }

  // 2. Summary / Title mapping
  let summaryVal: string | undefined = undefined;
  for (const key of ["summary", "title", "name", "eventTitle", "subject", "topic"]) {
    if (typeof normalized[key] === "string" && (normalized[key] as string).trim() !== "") {
      summaryVal = (normalized[key] as string).trim();
      break;
    }
    if (rawEvent && typeof rawEvent[key] === "string" && (rawEvent[key] as string).trim() !== "") {
      summaryVal = (rawEvent[key] as string).trim();
      break;
    }
  }
  if (summaryVal) {
    normalized["summary"] = summaryVal;
    normalized["title"] = summaryVal;
  }

  // 3. Description mapping
  let descVal: string | undefined = undefined;
  for (const key of ["description", "details", "text", "notes", "body"]) {
    if (typeof normalized[key] === "string" && (normalized[key] as string).trim() !== "") {
      descVal = (normalized[key] as string).trim();
      break;
    }
    if (rawEvent && typeof rawEvent[key] === "string" && (rawEvent[key] as string).trim() !== "") {
      descVal = (rawEvent[key] as string).trim();
      break;
    }
  }
  if (descVal) {
    normalized["description"] = descVal;
  }

  // 4. Time Min / Start mapping
  let startRaw: unknown = undefined;
  for (const key of ["startsAt", "start", "startTime", "start_time", "timeMin", "time_min", "from"]) {
    if (key in normalized && normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== "") {
      startRaw = normalized[key];
      break;
    }
  }
  if (startRaw === undefined && rawEvent) {
    for (const key of ["startsAt", "start", "startTime", "start_time", "timeMin", "time_min", "from"]) {
      if (key in rawEvent && rawEvent[key] !== undefined && rawEvent[key] !== null && rawEvent[key] !== "") {
        startRaw = rawEvent[key];
        break;
      }
    }
  }

  // 5. Time Max / End mapping
  let endRaw: unknown = undefined;
  for (const key of ["endsAt", "end", "endTime", "end_time", "timeMax", "time_max", "to", "until"]) {
    if (key in normalized && normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== "") {
      endRaw = normalized[key];
      break;
    }
  }
  if (endRaw === undefined && rawEvent) {
    for (const key of ["endsAt", "end", "endTime", "end_time", "timeMax", "time_max", "to", "until"]) {
      if (key in rawEvent && rawEvent[key] !== undefined && rawEvent[key] !== null && rawEvent[key] !== "") {
        endRaw = rawEvent[key];
        break;
      }
    }
  }

  let isoStart: string | undefined = undefined;
  let startObj: { dateTime: string; timeZone?: string } | undefined = undefined;

  if (startRaw !== undefined) {
    if (typeof startRaw === "string") {
      let val = startRaw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        val = `${val}T00:00:00Z`;
      }
      isoStart = val;
      startObj = { dateTime: val, timeZone: "UTC" };
    } else if (typeof startRaw === "object" && startRaw !== null) {
      const sObj = startRaw as Record<string, unknown>;
      const dt = String(sObj.dateTime || sObj.date || sObj.time || "");
      if (dt) {
        isoStart = dt;
        startObj = { dateTime: dt, timeZone: String(sObj.timeZone || "UTC") };
      }
    }
  }

  let isoEnd: string | undefined = undefined;
  let endObj: { dateTime: string; timeZone?: string } | undefined = undefined;

  if (endRaw !== undefined) {
    if (typeof endRaw === "string") {
      let val = endRaw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        val = `${val}T23:59:59Z`;
      }
      isoEnd = val;
      endObj = { dateTime: val, timeZone: "UTC" };
    } else if (typeof endRaw === "object" && endRaw !== null) {
      const eObj = endRaw as Record<string, unknown>;
      const dt = String(eObj.dateTime || eObj.date || eObj.time || "");
      if (dt) {
        isoEnd = dt;
        endObj = { dateTime: dt, timeZone: String(eObj.timeZone || "UTC") };
      }
    }
  }

  if (isoStart) {
    normalized["timeMin"] = isoStart;
    normalized["time_min"] = isoStart;
    normalized["startsAt"] = isoStart;
    normalized["startTime"] = isoStart;
    normalized["start_time"] = isoStart;
    normalized["start"] = startObj || isoStart;
  }

  if (isoEnd) {
    normalized["timeMax"] = isoEnd;
    normalized["time_max"] = isoEnd;
    normalized["endsAt"] = isoEnd;
    normalized["endTime"] = isoEnd;
    normalized["end_time"] = isoEnd;
    normalized["end"] = endObj || isoEnd;
  }

  // 6. Attendees normalization
  let rawAttendees = normalized.attendees || normalized.attendee || normalized.participants || (rawEvent ? rawEvent.attendees : undefined);
  if (rawAttendees) {
    let list: unknown[] = [];
    if (Array.isArray(rawAttendees)) {
      list = rawAttendees;
    } else if (typeof rawAttendees === "string") {
      list = [rawAttendees];
    } else if (typeof rawAttendees === "object" && rawAttendees !== null) {
      list = [rawAttendees];
    }

    const attendeesObjArr: Array<{ email: string }> = [];
    const attendeesStrArr: string[] = [];

    for (const item of list) {
      if (typeof item === "string" && item.trim()) {
        attendeesObjArr.push({ email: item.trim() });
        attendeesStrArr.push(item.trim());
      } else if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        const email = String(itemObj.email || itemObj.address || itemObj.name || "").trim();
        if (email) {
          attendeesObjArr.push({ email });
          attendeesStrArr.push(email);
        }
      }
    }

    if (attendeesObjArr.length > 0) {
      normalized["attendees"] = attendeesObjArr;
    }
  }

  // 7. Query parameter normalization
  if ("query" in normalized) {
    if (typeof normalized.query === "object" && normalized.query !== null) {
      const qObj = normalized.query as Record<string, unknown>;
      normalized.query = String(qObj.q || qObj.text || qObj.search || qObj.query || JSON.stringify(qObj));
    }
  } else if ("q" in normalized && typeof normalized.q === "string") {
    normalized.query = normalized.q;
  } else if ("search" in normalized && typeof normalized.search === "string") {
    normalized.query = normalized.search;
  }

  // 8. Event object synchronization (for MCP tools expecting nested 'event' parameter)
  const schemaProps = (inputSchema && typeof inputSchema === "object" && inputSchema.properties && typeof inputSchema.properties === "object")
    ? (inputSchema.properties as Record<string, Record<string, unknown>>)
    : null;

  if (summaryVal || isoStart || schemaProps?.event) {
    const eventSummary = summaryVal || "Termin";
    const eventObjSchema = (schemaProps?.event && typeof schemaProps.event === "object" && schemaProps.event.properties && typeof schemaProps.event.properties === "object")
      ? (schemaProps.event.properties as Record<string, Record<string, unknown>>)
      : null;
    const eventStart = eventObjSchema?.start?.type === "string" ? isoStart : (startObj || isoStart);
    const eventEnd = eventObjSchema?.end?.type === "string" ? isoEnd : (endObj || isoEnd);
    const eventAttendees = normalized.attendees || [];

    normalized.event = {
      ...(rawEvent || {}),
      summary: eventSummary,
      title: eventSummary,
      description: descVal || (rawEvent?.description as string) || "",
      start: eventStart,
      end: eventEnd,
      attendees: eventAttendees
    };
  }

  return normalized;
}

export function pruneMcpToolResult(
  result: unknown,
  customOptions?: Partial<McpSanitizeOptions>
): McpExecutionResultPruned {
  const maxListItems = customOptions?.maxListItems ?? 25;
  const stripKeys = new Set(
    customOptions?.stripKeys ?? [
      "etag",
      "kind",
      "iCalUID",
      "sequence",
      "reminders",
      "conferenceData",
      "extendedProperties",
      "hangoutLink",
      "entryPoints"
    ]
  );
  const maxStringLength = customOptions?.maxStringLength ?? 8000;

  let isPruned = false;
  let totalItemsCount: number | undefined = undefined;
  let returnedItemsCount: number | undefined = undefined;

  function recursiveSanitize(val: unknown): unknown {
    if (val === null || val === undefined) return val;

    if (typeof val === "string") {
      if (val.length > maxStringLength) {
        isPruned = true;
        return val.slice(0, maxStringLength) + `... [Gekürzt: ${val.length - maxStringLength} Zeichen]`;
      }
      return val;
    }

    if (typeof val !== "object") {
      return val;
    }

    if (Array.isArray(val)) {
      if (totalItemsCount === undefined) {
        totalItemsCount = val.length;
      }
      let targetArray = val;
      if (val.length > maxListItems) {
        isPruned = true;
        targetArray = val.slice(0, maxListItems);
        if (returnedItemsCount === undefined) {
          returnedItemsCount = targetArray.length;
        }
      }
      return targetArray.map((item) => recursiveSanitize(item));
    }

    // Object processing
    const obj = val as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (stripKeys.has(key)) {
        isPruned = true;
        continue;
      }
      cleaned[key] = recursiveSanitize(value);
    }

    if (Array.isArray(obj.items) && obj.items.length > maxListItems) {
      cleaned["_summary"] = `Zeige ${maxListItems} von ${obj.items.length} Einträgen`;
    } else if (Array.isArray(obj.events) && obj.events.length > maxListItems) {
      cleaned["_summary"] = `Zeige ${maxListItems} von ${obj.events.length} Einträgen`;
    } else if (Array.isArray(obj.results) && obj.results.length > maxListItems) {
      cleaned["_summary"] = `Zeige ${maxListItems} von ${obj.results.length} Einträgen`;
    }

    return cleaned;
  }

  const sanitizedData = recursiveSanitize(result);

  return {
    isPruned,
    totalItemsCount,
    returnedItemsCount,
    data: sanitizedData
  };
}

function normalizeName(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "");
}

/**
 * MCP Streamable-HTTP-Session-Cache (2026-08-16):
 * Moderne MCP-Server (z. B. Obsidian Local REST API) verlangen einen initialize-
 * Handshake und dann eine Mcp-Session-Id pro Folge-Request — sonst 400 "Server not initialized".
 * Key: serverId (Session ist pro Server; tenant-idempotent für denselben Server-Eintrag).
 */
const mcpSessionCache = new Map<string, { sessionId: string; expiresAt: number }>();

const MCP_SESSION_TTL_MS = 5 * 60 * 1000; // 5 Minuten (Server-Timeout üblich > 5 min)

/**
 * Stellt sicher, dass eine MCP-Streamable-HTTP-Session existiert (initialize-Handshake).
 * Gibt die Mcp-Session-Id zurück (oder undefined, wenn der Server keine Session verlangt).
 */
async function ensureMcpSession(endpoint: string, headers: Record<string, string>, serverId: string): Promise<string | undefined> {
  const cached = mcpSessionCache.get(serverId);
  if (cached && cached.expiresAt > Date.now()) return cached.sessionId;

  const initPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "louis-smart-crm", version: "1.0.0" }
    }
  };

  const res = await mcpFetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(initPayload)
  });

  const sessionId = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id") || undefined;
  if (sessionId) {
    mcpSessionCache.set(serverId, { sessionId, expiresAt: Date.now() + MCP_SESSION_TTL_MS });
  }
  // Auch ohne Session-Id ok (manche Server antworten direkt) — nur bei Fehler werfen
  if (!res.ok && res.status !== 200) {
    throw new Error(`MCP initialize fehlgeschlagen (${endpoint}): HTTP ${res.status} ${res.statusText}`);
  }
  return sessionId;
}

/**
 * MCP-Antwort parsen: Server (z. B. Obsidian) antworten auf Accept
 * "application/json, text/event-stream" im SSE-Format (event: message\ndata: {...}).
 * Dieser Helper extrahiert das data-Feld und parst JSON — robust für beide Formate.
 */
async function parseMcpResponseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    // SSE-Format: letzte data:-Zeile enthält das JSON (ggf. mehrzeilig)
    const dataLines: string[] = [];
    let inData = false;
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data:")) { dataLines.push(line.slice(5).trim()); inData = true; }
      else if (line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) { inData = false; }
      else if (inData && line.trim() !== "") { dataLines[dataLines.length - 1] += line.trim(); }
    }
    const data = dataLines.join("\n");
    if (!data) return null;
    try { return JSON.parse(data); } catch { return { raw: data }; }
  }
  try { return JSON.parse(trimmed); } catch { return { raw: trimmed }; }
}

/**
 * Zentraler HTTP-Fetch für MCP-Server (2026-08-16):
 * 1) Toleriert selbstsignierte TLS-Zertifikate für lokale MCP-Server (z. B. Obsidian
 *    Local REST API auf https://host.docker.internal:27124/mcp/) — sonst schlägt Node-fetch
 *    mit "fetch failed / DEPTH_ZERO_SELF_SIGNED_CERT" fehl, obwohl der Server läuft.
 *    Node-22-fetch respektiert https.Agent({rejectUnauthorized:false}) NICHT — nur der
 *    undici-Dispatcher mit connect-Option funktioniert zuverlässig.
 * 2) Sendet Accept: application/json, text/event-stream (MCP-Streaming-Protokoll — das
 *    Obsidian-Plugin antwortet sonst mit 406 "Not Acceptable").
 * Nur für https aktiv (TLS-Toleranz); Accept-Header für alle MCP-HTTP-Requests.
 */
function mcpFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    "Accept": "application/json, text/event-stream",
    ...(init?.headers as Record<string, string> | undefined)
  };
  if (typeof url === "string" && url.startsWith("https://")) {
    const dispatcher = new UndiciAgent({ connect: { rejectUnauthorized: false } });
    return fetch(url, { ...init, headers, dispatcher } as RequestInit) as Promise<Response>;
  }
  return fetch(url, { ...init, headers } as RequestInit) as Promise<Response>;
}

function getAuthHeaders(server: McpExternalServer): Record<string, string> {
  const headers: Record<string, string> = { ...server.headers };
  // Befund 2026-08-17: "Bearer "-Präfix defensiv entfernen — Nutzer kopieren oft den
  // Plugin-Anzeige-Text ("Bearer <hex>") statt des Hex-Keys → sonst "Bearer Bearer …" → 401.
  const token = normalizeAuthToken(server.auth_token_encrypted) || "";
  if (server.auth_type === "bearer" && token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (server.auth_type === "api_key" && token) {
    headers["X-API-Key"] = token;
  } else if (server.auth_type === "basic" && token) {
    headers["Authorization"] = `Basic ${Buffer.from(token).toString("base64")}`;
  }
  return headers;
}

export class McpClientEngine {
  private static async getEnrichedServerEnvAndHeaders(server: McpExternalServer, tenantId: string = "1") {
    const oauthToken = await getMcpOAuthToken(tenantId, server.id_uuid);
    const envVars: Record<string, string> = { ...(server.env_vars || {}) };
    const headers: Record<string, string> = getAuthHeaders(server);

    const clientId = envVars["GOOGLE_CLIENT_ID"] || envVars["CLIENT_ID"] || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = envVars["GOOGLE_CLIENT_SECRET"] || envVars["CLIENT_SECRET"] || process.env.GOOGLE_CLIENT_SECRET || "";

    const baseUrl = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const redirectUri = `${baseUrl}/api/mcp/oauth/callback`;

    if (envVars["GOOGLE_CLIENT_ID"]) {
      envVars["CLIENT_ID"] = envVars["GOOGLE_CLIENT_ID"];
      envVars["GDRIVE_CLIENT_ID"] = envVars["GOOGLE_CLIENT_ID"];
    }
    if (envVars["GOOGLE_CLIENT_SECRET"]) {
      envVars["CLIENT_SECRET"] = envVars["GOOGLE_CLIENT_SECRET"];
      envVars["GDRIVE_CLIENT_SECRET"] = envVars["GOOGLE_CLIENT_SECRET"];
      envVars["GDRIVE_SECRET"] = envVars["GOOGLE_CLIENT_SECRET"];
    }

    if (oauthToken) {
      envVars["OAUTH_ACCESS_TOKEN"] = oauthToken.access_token;
      envVars["ACCESS_TOKEN"] = oauthToken.access_token;
      envVars["GOOGLE_ACCESS_TOKEN"] = oauthToken.access_token;
      envVars["GDRIVE_ACCESS_TOKEN"] = oauthToken.access_token;

      if (oauthToken.refresh_token) {
        envVars["OAUTH_REFRESH_TOKEN"] = oauthToken.refresh_token;
        envVars["REFRESH_TOKEN"] = oauthToken.refresh_token;
        envVars["GOOGLE_REFRESH_TOKEN"] = oauthToken.refresh_token;
        envVars["GDRIVE_REFRESH_TOKEN"] = oauthToken.refresh_token;
      }

      try {
        const mcpDir = path.join(os.tmpdir(), `mcp_server_${server.id_uuid}`);
        if (!fs.existsSync(mcpDir)) {
          fs.mkdirSync(mcpDir, { recursive: true });
        }

        const clientSecretsData = {
          web: {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uris: [redirectUri]
          },
          installed: {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uris: [redirectUri]
          }
        };

        const tokenData = {
          access_token: oauthToken.access_token,
          refresh_token: oauthToken.refresh_token || undefined,
          token_type: "Bearer",
          scope: oauthToken.scopes ? oauthToken.scopes.join(" ") : undefined,
          expiry_date: oauthToken.expires_at ? new Date(oauthToken.expires_at).getTime() : undefined
        };

        const clientSecretsPath = path.join(mcpDir, "gcp-oauth.keys.json");
        const credentialsKeysPath = path.join(mcpDir, "credentials.json");
        const tokenFilePath = path.join(mcpDir, "token.json");
        const gcalTokenFilePath = path.join(mcpDir, "mcp-google-calendar-token.json");

        // Write OAuth client keys files
        fs.writeFileSync(clientSecretsPath, JSON.stringify(clientSecretsData, null, 2), "utf8");
        fs.writeFileSync(credentialsKeysPath, JSON.stringify(clientSecretsData, null, 2), "utf8");

        // Write token files
        fs.writeFileSync(tokenFilePath, JSON.stringify(tokenData, null, 2), "utf8");
        fs.writeFileSync(gcalTokenFilePath, JSON.stringify(tokenData, null, 2), "utf8");

        // Also write in process.cwd() as fallbacks
        try {
          fs.writeFileSync(path.join(process.cwd(), "gcp-oauth.keys.json"), JSON.stringify(clientSecretsData, null, 2), "utf8");
          fs.writeFileSync(path.join(process.cwd(), "credentials.json"), JSON.stringify(clientSecretsData, null, 2), "utf8");
          fs.writeFileSync(path.join(process.cwd(), "mcp-google-calendar-token.json"), JSON.stringify(tokenData, null, 2), "utf8");
          fs.writeFileSync(path.join(process.cwd(), "token.json"), JSON.stringify(tokenData, null, 2), "utf8");
        } catch {
          // ignore cwd write errors
        }

        // Environment variables for different MCP implementations
        envVars["CREDENTIALS_PATH"] = credentialsKeysPath;
        envVars["GOOGLE_CREDENTIALS_PATH"] = credentialsKeysPath;
        envVars["GCAL_CREDENTIALS_PATH"] = credentialsKeysPath;
        envVars["GOOGLE_CALENDAR_CREDENTIALS_PATH"] = credentialsKeysPath;

        envVars["GMAIL_OAUTH_PATH"] = clientSecretsPath;
        envVars["GDRIVE_OAUTH_PATH"] = clientSecretsPath;

        envVars["GMAIL_CREDENTIALS_PATH"] = tokenFilePath;
        envVars["GDRIVE_CREDENTIALS_PATH"] = tokenFilePath;

      } catch (err) {
        console.warn(`[MCP Engine] Could not write temporary OAuth credentials files:`, err);
      }

      if (!headers["Authorization"]) {
        headers["Authorization"] = `Bearer ${oauthToken.access_token}`;
      }
    }

    return { envVars, headers };
  }

  /**
   * Ping an external MCP server and update its health status
   */
  static async pingServer(server: McpExternalServer): Promise<{ healthy: boolean; latencyMs: number; errorMessage?: string }> {
    const startTime = Date.now();
    let healthy = false;
    let errorMessage: string | undefined = undefined;

    try {
      const { envVars, headers } = await this.getEnrichedServerEnvAndHeaders(server, server.tenant_id);

      if (server.transport_type === "http" || server.transport_type === "sse") {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        // Try JSON-RPC initialize/ping call first
        const payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "ping",
          params: {}
        };

        const response = await mcpFetch(server.endpoint_or_command, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        }).catch(async () => {
          // Fallback to GET ping
          return await mcpFetch(server.endpoint_or_command, {
            method: "GET",
            headers,
            signal: controller.signal
          });
        });

        clearTimeout(timeoutId);

        if (response.ok || response.status === 200) {
          healthy = true;
        } else {
          errorMessage = `HTTP status ${response.status}: ${response.statusText}`;
        }
      } else if (server.transport_type === "stdio") {
        // Execute stdio command with ping request
        const res = await this.executeStdioJsonRpc(
          server.endpoint_or_command,
          server.command_args || [],
          envVars,
          { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
          5000
        );
        healthy = !res.error;
        if (res.error) {
          errorMessage = res.error;
        }
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      healthy = false;
    }

    const latencyMs = Date.now() - startTime;
    const healthStatus: McpHealthStatus = healthy ? "healthy" : "offline";
    const lastPingAt = new Date().toISOString();

    // Update status in DB or fallback store
    await this.updateServerStatus(server.id_uuid, healthStatus, lastPingAt, errorMessage);

    return { healthy, latencyMs, errorMessage };
  }

  /**
   * Helper to execute JSON-RPC request over stdio child process
   */
  private static executeStdioJsonRpc(
    command: string,
    args: string[],
    envVars: Record<string, string>,
    rpcRequest: Record<string, unknown>,
    timeoutMs = 15000
  ): Promise<{ result?: unknown; error?: string }> {
    return new Promise((resolve) => {
      let isResolved = false;
      let stdoutData = "";
      let stderrData = "";

      const childEnv: Record<string, string> = {
        ...process.env,
        npm_config_cache: "/tmp/.npm",
        NPM_CONFIG_CACHE: "/tmp/.npm",
        npm_config_userconfig: "/tmp/.npmrc",
        npm_config_update_notifier: "false",
        HOME: process.env.HOME && process.env.HOME !== "/app" ? process.env.HOME : "/tmp",
        ...envVars
      };
      if (!childEnv.npm_config_cache) {
        childEnv.npm_config_cache = "/tmp/.npm";
      }
      if (!childEnv.NPM_CONFIG_CACHE) {
        childEnv.NPM_CONFIG_CACHE = "/tmp/.npm";
      }
      const child = spawn(
        // BUG-13 (Auftrag 015): Auf Windows ist npx eine .cmd-Datei — spawn braucht cmd /c als Wrapper,
        // sonst schlägt der stdio-Spawn fehl (offizielle MCP-Empfehlung für Windows)
        process.platform === "win32" && command === "npx" ? "cmd" : command,
        process.platform === "win32" && command === "npx" ? ["/c", "npx", ...args] : args,
        {
          env: childEnv,
          stdio: ["pipe", "pipe", "pipe"]
        }
      );

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore kill errors
          }
          resolve({ error: `Process execution timed out after ${timeoutMs}ms` });
        }
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutData += chunk.toString("utf8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrData += chunk.toString("utf8");
      });

      child.on("error", (err: Error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          resolve({ error: `Failed to spawn process ${command}: ${err.message}` });
        }
      });

      child.on("close", (code: number) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(timer);

        if (code !== 0 && !stdoutData.trim()) {
          resolve({ error: `Process exited with code ${code}. Stderr: ${stderrData.trim()}` });
          return;
        }

        try {
          // Parse stdout line by line looking for JSON-RPC response
          const lines = stdoutData.split("\n").map((l) => l.trim()).filter(Boolean);
          for (let i = lines.length - 1; i >= 0; i--) {
            try {
              const parsed = JSON.parse(lines[i]);
              if (parsed && typeof parsed === "object" && ("result" in parsed || "error" in parsed)) {
                if (parsed.error) {
                  const errMsg = typeof parsed.error === "object" ? parsed.error.message || JSON.stringify(parsed.error) : String(parsed.error);
                  resolve({ error: errMsg });
                } else {
                  resolve({ result: parsed.result });
                }
                return;
              }
            } catch {
              // try previous line
            }
          }
          resolve({ error: `Invalid JSON-RPC output from stdio process. Raw output: ${stdoutData.slice(0, 300)}` });
        } catch (err) {
          resolve({ error: `Failed to parse stdio JSON-RPC output: ${err instanceof Error ? err.message : String(err)}` });
        }
      });

      // Write request to stdin with initialization sequence if needed
      try {
        const method = String(rpcRequest.method || "");
        if (method !== "initialize" && method !== "ping") {
          const initMsg = JSON.stringify({
            jsonrpc: "2.0",
            id: "init_1",
            method: "initialize",
            params: {
              protocolVersion: "2026-08-01",
              capabilities: {},
              clientInfo: { name: "louis-smart-crm-mcp-engine", version: "1.0.0" }
            }
          }) + "\n";
          const initNotification = JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized"
          }) + "\n";
          child.stdin.write(initMsg);
          child.stdin.write(initNotification);
        }
        child.stdin.write(JSON.stringify(rpcRequest) + "\n");
        child.stdin.end();
      } catch (err) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timer);
          resolve({ error: `Failed writing stdin to process: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    });
  }

  /**
   * Discover available tools from an external MCP server
   */
  static async discoverTools(serverId: string, tenantId: string = "1"): Promise<McpDiscoveredTool[]> {
    const server = await this.getServerById(serverId, tenantId);
    if (!server) {
      throw new Error(`MCP external server ${serverId} not found`);
    }

    const now = new Date().toISOString();
    let rawTools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> = [];

    const { envVars, headers } = await this.getEnrichedServerEnvAndHeaders(server, tenantId);

    const oauthToken = await getMcpOAuthToken(tenantId, server.id_uuid);
    if (server.auth_type === "oauth2" && !oauthToken) {
      throw new Error(`OAuth 2.0 Autorisierung erforderlich: Bitte klicken Sie bei "${server.server_name}" auf "OAuth Autorisieren", um Zugriff auf den Service zu gewähren.`);
    }

    if (server.transport_type === "http" || server.transport_type === "sse") {
      const payload = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      };

      // Streamable-HTTP: initialize-Handshake + Session-Id (sonst 400 "Server not initialized")
      const sessionId = await ensureMcpSession(server.endpoint_or_command, headers, server.id_uuid).catch(() => undefined);

      const response = await mcpFetch(server.endpoint_or_command, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
          ...headers
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to list tools from MCP server ${server.server_name}: HTTP ${response.status} ${response.statusText}`);
      }

      const json = (await parseMcpResponseBody(response)) as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }; error?: { message?: string } };
      if (json?.error) {
        throw new Error(`MCP Server Error (${server.server_name}): ${json.error.message || JSON.stringify(json.error)}`);
      }
      rawTools = json?.result?.tools || [];
    } else if (server.transport_type === "stdio") {
      const res = await this.executeStdioJsonRpc(
        server.endpoint_or_command,
        server.command_args || [],
        envVars,
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        30000
      );

      if (res.error) {
        if (res.error.includes("Credentials not found") || res.error.includes("run with 'auth' argument")) {
          throw new Error(`OAuth 2.0 Autorisierung erforderlich: Für "${server.server_name}" wurden keine OAuth-Anmeldedaten gefunden. Bitte klicken Sie auf "OAuth Autorisieren".`);
        }
        throw new Error(`Failed to discover tools via stdio (${server.server_name}): ${res.error}`);
      }

      const resultObj = res.result as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> } | undefined;
      rawTools = resultObj?.tools || [];
    }

    const discoveredTools: McpDiscoveredTool[] = [];
    const serverCleanName = normalizeName(server.server_name);

    for (const tool of rawTools) {
      const origName = tool.name;
      const normalizedName = `mcp_${serverCleanName}_${normalizeName(origName)}`;
      const toolId = uuidv4();

      const discoveredTool: McpDiscoveredTool = {
        id_uuid: toolId,
        tenant_id: tenantId,
        server_id_uuid: server.id_uuid,
        original_tool_name: origName,
        normalized_tool_name: normalizedName,
        description: tool.description || null,
        input_schema: tool.inputSchema || {},
        is_enabled_for_louis: true,
        is_enabled_for_ui: true,
        category: "custom",
        last_discovered_at: now
      };

      discoveredTools.push(discoveredTool);
      await this.upsertDiscoveredTool(discoveredTool);
    }

    // Mark server as healthy
    await this.updateServerStatus(server.id_uuid, "healthy", now, null);

    return discoveredTools;
  }

  /**
   * Execute a tool on an external MCP server
   */
  static async executeTool(input: McpToolExecutionInput, tenantId: string = "1"): Promise<McpToolExecutionResult> {
    const startTime = Date.now();
    let tool: McpDiscoveredTool | null = null;

    if (input.tool_id_uuid) {
      tool = await this.getToolById(input.tool_id_uuid, tenantId);
    } else if (input.normalized_tool_name) {
      tool = await this.getToolByNormalizedName(input.normalized_tool_name, tenantId);
    }

    if (!tool) {
      return {
        success: false,
        result: null,
        error: `MCP Tool not found (id: ${input.tool_id_uuid || "n/a"}, name: ${input.normalized_tool_name || "n/a"})`,
        execution_time_ms: Date.now() - startTime,
        server_name: "Unknown"
      };
    }

    const server = await this.getServerById(tool.server_id_uuid, tenantId);
    if (!server) {
      return {
        success: false,
        result: null,
        error: `External MCP Server for tool ${tool.normalized_tool_name} not found`,
        execution_time_ms: Date.now() - startTime,
        server_name: "Unknown"
      };
    }

    if (!server.is_active) {
      return {
        success: false,
        result: null,
        error: `MCP Server '${server.server_name}' is currently inactive`,
        execution_time_ms: Date.now() - startTime,
        server_name: server.server_name
      };
    }

    let success = false;
    let result: unknown = null;
    let error: string | null = null;

    try {
      const { envVars, headers } = await this.getEnrichedServerEnvAndHeaders(server, tenantId);

      const inputSchema = typeof tool.input_schema === "string"
        ? (JSON.parse(tool.input_schema) as Record<string, unknown>)
        : (tool.input_schema as Record<string, unknown> | undefined);

      const normalizedArgs = normalizeToolArguments(
        tool.normalized_tool_name,
        input.arguments || {},
        inputSchema
      );

      const rpcPayload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: tool.original_tool_name,
          arguments: normalizedArgs
        }
      };

      if (server.transport_type === "http" || server.transport_type === "sse") {
        // Streamable-HTTP: initialize-Handshake + Session-Id (sonst 400 "Server not initialized")
        const sessionId = await ensureMcpSession(server.endpoint_or_command, headers, server.id_uuid).catch(() => undefined);
        const response = await mcpFetch(server.endpoint_or_command, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
            ...headers
          },
          body: JSON.stringify(rpcPayload)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const json = (await parseMcpResponseBody(response)) as { result?: unknown; error?: { message?: string } };
        if (json?.error) {
          error = json.error.message || JSON.stringify(json.error);
        } else if (json) {
          success = true;
          result = json.result;
        } else {
          error = "Leere Antwort vom MCP-Server";
        }
      } else if (server.transport_type === "stdio") {
        const res = await this.executeStdioJsonRpc(
          server.endpoint_or_command,
          server.command_args || [],
          envVars,
          rpcPayload,
          20000
        );

        if (res.error) {
          error = res.error;
        } else {
          success = true;
          result = res.result;
        }
      }

      if (success && result !== null && result !== undefined) {
        const pruned = pruneMcpToolResult(result);
        result = pruned.data;
      }
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
    }

    const executionTimeMs = Date.now() - startTime;

    // Audit event logging
    workflowEventBus.emitEvent(tenantId, "mcp.tool_executed", {
      tool_id: tool.id_uuid,
      normalized_tool_name: tool.normalized_tool_name,
      server_name: server.server_name,
      arguments: input.arguments,
      success,
      execution_time_ms: executionTimeMs,
      error
    });

    return {
      success,
      result,
      error: error || null,
      execution_time_ms: executionTimeMs,
      server_name: server.server_name
    };
  }

  /**
   * Execute a tool mapped to a specific CRM domain & action
   */
  static async executeDomainMappedTool(
    domain: string,
    action: string,
    params: Record<string, unknown>,
    tenantId: string = "1"
  ): Promise<McpToolExecutionResult | null> {
    const mapping = await this.getToolMapping(domain, action, tenantId);
    if (!mapping) {
      return null;
    }

    // Apply field mappings if present
    const mappedArgs: Record<string, unknown> = {};
    const fieldMap = mapping.field_mappings || {};

    if (Object.keys(fieldMap).length > 0) {
      for (const [sourceKey, targetKey] of Object.entries(fieldMap)) {
        if (sourceKey in params) {
          mappedArgs[targetKey] = params[sourceKey];
        }
      }
      // Include unmapped params as fallbacks
      for (const [k, v] of Object.entries(params)) {
        if (!(k in fieldMap)) {
          mappedArgs[k] = v;
        }
      }
    } else {
      Object.assign(mappedArgs, params);
    }

    return await this.executeTool({ tool_id_uuid: mapping.tool_id_uuid, arguments: mappedArgs }, tenantId);
  }

  // ---------------------------------------------------------------------------
  // Internal Database & Fallback Store Access Helpers
  // ---------------------------------------------------------------------------

  private static async getServerById(serverId: string, tenantId: string): Promise<McpExternalServer | null> {
    if (isUsingFallback) {
      const server = fallbackStore.mcp_external_servers?.find(
        (s) => s.id_uuid === serverId && (s.tenant_id === tenantId || (s.tenant_id === '1' && tenantId === '1'))
      );
      return server || null;
    }

    const res = await pool.query(
      `SELECT * FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1')) LIMIT 1`,
      [serverId, tenantId]
    );
    if (res.rows.length === 0) return null;
    return cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as McpExternalServer;
  }

  private static async getToolById(toolId: string, tenantId: string): Promise<McpDiscoveredTool | null> {
    if (isUsingFallback) {
      const tool = fallbackStore.mcp_discovered_tools?.find(
        (t) => t.id_uuid === toolId && (t.tenant_id === tenantId || (t.tenant_id === '1' && tenantId === '1'))
      );
      return tool || null;
    }

    const res = await pool.query(
      `SELECT * FROM sys_mcp_discovered_tools WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1')) LIMIT 1`,
      [toolId, tenantId]
    );
    if (res.rows.length === 0) return null;
    return cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as McpDiscoveredTool;
  }

  static async listToolsForLouis(tenantId: string = "1"): Promise<McpDiscoveredTool[]> {
    if (isUsingFallback) {
      return (fallbackStore.mcp_discovered_tools || [])
        .filter((t) => t.is_enabled_for_louis && (t.tenant_id === tenantId || (t.tenant_id === '1' && tenantId === '1')))
        .map((t) => ({
          ...t,
          input_schema: typeof t.input_schema === 'string' ? JSON.parse(t.input_schema) : (t.input_schema || {})
        })) as McpDiscoveredTool[];
    }

    const res = await pool.query(
      `SELECT * FROM sys_mcp_discovered_tools WHERE is_enabled_for_louis = true AND (tenant_id = $1 OR (tenant_id = '1' AND $1 = '1'))`,
      [tenantId]
    );
    return res.rows.map((row) => {
      const cleaned = cleanLigatureHacksFromValue(cleanDbRow(row)) as Record<string, unknown>;
      if (typeof cleaned.input_schema === 'string') {
        try {
          cleaned.input_schema = JSON.parse(cleaned.input_schema);
        } catch {
          cleaned.input_schema = {};
        }
      }
      return cleaned as unknown as McpDiscoveredTool;
    });
  }

  static async getToolByNormalizedName(normalizedName: string, tenantId: string): Promise<McpDiscoveredTool | null> {
    const rawTarget = (normalizedName || "").toLowerCase().trim();
    const cleanTarget = rawTarget.replace(/^mcp_/, "");

    if (isUsingFallback) {
      const tool = fallbackStore.mcp_discovered_tools?.find((t) => {
        if (t.tenant_id !== tenantId && t.tenant_id !== "1") return false;
        const norm = (t.normalized_tool_name || "").toLowerCase();
        const orig = (t.original_tool_name || "").toLowerCase();
        const normClean = norm.replace(/^mcp_/, "");

        return (
          norm === rawTarget ||
          norm === `mcp_${rawTarget}` ||
          normClean === cleanTarget ||
          orig === rawTarget ||
          orig === cleanTarget ||
          normClean.endsWith(`_${cleanTarget}`) ||
          cleanTarget.endsWith(`_${orig}`) ||
          orig.endsWith(`_${cleanTarget}`)
        );
      });
      if (!tool) return null;
      return {
        ...tool,
        input_schema: typeof tool.input_schema === 'string' ? JSON.parse(tool.input_schema) : (tool.input_schema || {})
      } as McpDiscoveredTool;
    }

    const res = await pool.query(
      `SELECT * FROM sys_mcp_discovered_tools 
       WHERE (
         LOWER(normalized_tool_name) = $1 
         OR LOWER(normalized_tool_name) = 'mcp_' || $1
         OR LOWER(REGEXP_REPLACE(normalized_tool_name, '^mcp_', '')) = $2
         OR LOWER(original_tool_name) = $1
         OR LOWER(original_tool_name) = $2
         OR LOWER(REGEXP_REPLACE(normalized_tool_name, '^mcp_[^_]+_', '')) = $2
         OR LOWER(normalized_tool_name) LIKE '%' || $2
       )
       AND (tenant_id = $3 OR (tenant_id = '1' AND $3 = '1')) 
       LIMIT 1`,
      [rawTarget, cleanTarget, tenantId]
    );
    if (res.rows.length === 0) return null;
    const cleaned = cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as Record<string, unknown>;
    if (typeof cleaned.input_schema === 'string') {
      try {
        cleaned.input_schema = JSON.parse(cleaned.input_schema);
      } catch {
        cleaned.input_schema = {};
      }
    }
    return cleaned as unknown as McpDiscoveredTool;
  }

  private static async getToolMapping(domain: string, action: string, tenantId: string): Promise<McpToolMapping | null> {
    if (isUsingFallback) {
      const mapping = fallbackStore.mcp_tool_mappings?.find(
        (m) =>
          m.target_domain === domain &&
          m.action_type === action &&
          (m.tenant_id === tenantId || (m.tenant_id === '1' && tenantId === '1'))
      );
      return mapping || null;
    }

    const res = await pool.query(
      `SELECT * FROM sys_mcp_tool_mappings WHERE target_domain = $1 AND action_type = $2 AND (tenant_id = $3 OR (tenant_id = '1' AND $3 = '1')) ORDER BY is_primary DESC LIMIT 1`,
      [domain, action, tenantId]
    );
    if (res.rows.length === 0) return null;
    return cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as McpToolMapping;
  }

  private static async updateServerStatus(
    serverId: string,
    status: McpHealthStatus,
    lastPingAt: string,
    lastErrorMessage: string | null = null
  ): Promise<void> {
    if (isUsingFallback) {
      if (!fallbackStore.mcp_external_servers) fallbackStore.mcp_external_servers = [];
      const s = fallbackStore.mcp_external_servers.find((srv) => srv.id_uuid === serverId);
      if (s) {
        s.health_status = status;
        s.last_ping_at = lastPingAt;
        s.last_error_message = lastErrorMessage;
        s.updated_at = new Date().toISOString();
        saveFallbackStore();
      }
      return;
    }

    await pool.query(
      `UPDATE sys_mcp_external_servers 
       SET health_status = $1, last_ping_at = $2, last_error_message = $3, updated_at_utc = CURRENT_TIMESTAMP
       WHERE id_uuid = $4`,
      [status, lastPingAt, lastErrorMessage, serverId]
    );
  }

  private static async upsertDiscoveredTool(tool: McpDiscoveredTool): Promise<void> {
    if (isUsingFallback) {
      if (!fallbackStore.mcp_discovered_tools) fallbackStore.mcp_discovered_tools = [];
      const idx = fallbackStore.mcp_discovered_tools.findIndex(
        (t) => t.server_id_uuid === tool.server_id_uuid && t.original_tool_name === tool.original_tool_name
      );
      if (idx >= 0) {
        fallbackStore.mcp_discovered_tools[idx] = {
          ...fallbackStore.mcp_discovered_tools[idx],
          normalized_tool_name: tool.normalized_tool_name,
          description: tool.description,
          input_schema: tool.input_schema,
          last_discovered_at: tool.last_discovered_at
        };
      } else {
        fallbackStore.mcp_discovered_tools.push(tool);
      }
      saveFallbackStore();
      return;
    }

    await pool.query(
      `INSERT INTO sys_mcp_discovered_tools (
        id_uuid, tenant_id, server_id_uuid, original_tool_name, normalized_tool_name,
        description, input_schema, is_enabled_for_louis, is_enabled_for_ui, category, last_discovered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, server_id_uuid, original_tool_name) DO UPDATE SET
        normalized_tool_name = EXCLUDED.normalized_tool_name,
        description = EXCLUDED.description,
        input_schema = EXCLUDED.input_schema,
        last_discovered_at = CURRENT_TIMESTAMP`,
      [
        tool.id_uuid,
        tool.tenant_id,
        tool.server_id_uuid,
        tool.original_tool_name,
        tool.normalized_tool_name,
        tool.description,
        JSON.stringify(tool.input_schema),
        tool.is_enabled_for_louis,
        tool.is_enabled_for_ui,
        tool.category
      ]
    );
  }
}
