import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { Agent as UndiciAgent } from "undici";
import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
// Auftrag 025 Phase 7 (#54): MCP-Schema-Normalisierung (doppelt gewrappte inputSchema unwrappen)
import { unwrapWrappedSchema } from "../ai/toolSchemas.js";
import { getMcpOAuthToken } from "./oauthHandler.js";
import { normalizeAuthToken } from "./authTokenNormalize.js";
// C.4 (Plan 2026-08-19): echte Secret-Verschlüsselung (: auth_token_encrypted war Klartext)
import { decryptSecret, encryptSecret, isEncryptedSecret } from "./secretCrypto.js";
// C.7 (Plan 2026-08-19): Chatprofile — Session-Profil + effektive Toolmenge
import { getSessionProfile, getChatProfileById, profileToolNames } from "./chatProfiles.js";
// Phase B (Plan 2026-08-19): SDK-Transport-Schicht
import {
  openSession,
  sessionListTools,
  sessionCallTool,
  sessionPing,
  sessionClose,
  sanitizeErrorText,
  isMethodNotFoundError,
  McpSessionHandle,
  ServerWithConfig
} from "./sdkTransport.js";
// Phase C.1 (Plan 2026-08-19): stdio-Lebenszyklus
import { PoolEntry, shouldRecycle, enforceStdioLimit, cleanupOAuthTempFiles } from "./serverLifecycle.js";
import {
  McpExternalServer,
  McpDiscoveredTool,
  McpToolMapping,
  McpToolExecutionInput,
  McpToolExecutionResult,
  McpApprovalRequestRecord,
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

  // Auftrag 046 Schritt 3 (C2+C5, Go 2026-08-20): Schema-Respekt statt Raten.
  // Das inputSchema ist die einzige verlässliche Typ-Quelle — ist es leer (keine
  // properties, z. B. mcp-google-calendar), werden Argumente TYP-ERHALTEND
  // durchgereicht (String bleibt String, Objekt bleibt Objekt). Vorher baute die
  // Engine bei leerem Schema mutmaßlich {dateTime,timeZone}-Objekte (C2) und
  // zerlegte JsonLogic-Query-Objekte in Strings (C5) — beides brach die Server.
  const schemaProps = (inputSchema && typeof inputSchema === "object" && inputSchema.properties && typeof inputSchema.properties === "object")
    ? (inputSchema.properties as Record<string, Record<string, unknown>>)
    : null;
  const schemaPropType = (key: string): string | undefined => {
    const p = schemaProps?.[key];
    return (p && typeof p === "object" && typeof p.type === "string") ? p.type : undefined;
  };
  const eventSchema = (schemaProps?.event && typeof schemaProps.event === "object" && schemaProps.event.properties && typeof schemaProps.event.properties === "object")
    ? (schemaProps.event.properties as Record<string, Record<string, unknown>>)
    : null;
  const eventPropType = (key: string): string | undefined => {
    const p = eventSchema?.[key];
    return (p && typeof p === "object" && typeof p.type === "string") ? p.type : undefined;
  };

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
      // C2-Fix (046 Schritt 3): Format-Expansion (YYYY-MM-DD → ISO mit T00:00:00Z)
      // NUR bei explizitem date-time-Schema. Bei unbekanntem/leerem Schema bleibt das
      // Format erhaltend — mcp-google-calendar erwartet für Ganztages-Events reines
      // YYYY-MM-DD (start: {date: ...}); die Expansion erzeugte 400 Bad Request.
      const wantsDatetime =
        (schemaPropType("start") === "string" && schemaProps?.start && (schemaProps.start as Record<string, unknown>).format === "date-time") ||
        (eventPropType("start") === "string" && eventSchema?.start && (eventSchema.start as Record<string, unknown>).format === "date-time");
      if (wantsDatetime && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
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
      // C2-Fix (046 Schritt 3): wie start — Format-Expansion nur bei date-time-Schema
      const wantsDatetime =
        (schemaPropType("end") === "string" && schemaProps?.end && (schemaProps.end as Record<string, unknown>).format === "date-time") ||
        (eventPropType("end") === "string" && eventSchema?.end && (eventSchema.end as Record<string, unknown>).format === "date-time");
      if (wantsDatetime && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
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
    // C2-Fix (046 Schritt 3): start bleibt String, wenn das Schema String erwartet
    // ODER das Schema nichts sagt (typ-erhaltend). Objekt nur bei explizitem
    // Objekt-Schema (dateTime/timeZone) — z. B. Google-API-Stil.
    const wantsStartObj = schemaPropType("start") === "object" || eventPropType("start") === "object";
    normalized["start"] = wantsStartObj ? (startObj || isoStart) : isoStart;
  }

  if (isoEnd) {
    normalized["timeMax"] = isoEnd;
    normalized["time_max"] = isoEnd;
    normalized["endsAt"] = isoEnd;
    normalized["endTime"] = isoEnd;
    normalized["end_time"] = isoEnd;
    const wantsEndObj = schemaPropType("end") === "object" || eventPropType("end") === "object";
    normalized["end"] = wantsEndObj ? (endObj || isoEnd) : isoEnd;
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
  // C5-Fix (046 Schritt 3): JsonLogic-Objekte (Obsidian search_query) bleiben Objekte,
  // wenn das Schema object erwartet ODER nichts sagt (typ-erhaltend). Nur bei
  // explizitem String-Schema wird ein Objekt-Query zu String zerlegt.
  if ("query" in normalized) {
    const querySchemaType = schemaPropType("query");
    if (typeof normalized.query === "object" && normalized.query !== null) {
      if (querySchemaType === "string") {
        const qObj = normalized.query as Record<string, unknown>;
        normalized.query = String(qObj.q || qObj.text || qObj.search || qObj.query || JSON.stringify(qObj));
      }
      // sonst (object-Schema oder Schema ohne Typ-Angabe): Objekt durchreichen
    }
    // String-query bleibt String — nichts zu tun
  } else if ("q" in normalized && typeof normalized.q === "string" && schemaPropType("query") !== "object") {
    normalized.query = normalized.q;
  } else if ("search" in normalized && typeof normalized.search === "string" && schemaPropType("query") !== "object") {
    normalized.query = normalized.search;
  }

  // 8. Event object synchronization (for MCP tools expecting nested 'event' parameter)

  if (summaryVal || isoStart || schemaProps?.event) {
    const eventSummary = summaryVal || "Termin";
    // C2-Fix (046 Schritt 3): event.start/event.end typ-erhaltend — String bei
    // String-Schema (mcp-google-calendar) oder unbekanntem Schema, Objekt nur
    // bei explizitem Objekt-Schema (Google-API-Stil).
    const eventStart = eventPropType("start") === "object" ? (startObj || isoStart) : isoStart;
    const eventEnd = eventPropType("end") === "object" ? (endObj || isoEnd) : isoEnd;
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

// Phase B/C (Plan 2026-08-19): SDK-Session-Pool — persistente Handles pro Server-Eintrag.
// C.1: stdio-Lifecycle (idle/age-Recycle, Ressourcen-Limit 5, Temp-Cleanup) via serverLifecycle.ts.
const sdkSessionPool = new Map<string, PoolEntry<McpSessionHandle>>();
const SDK_POOL_TTL_MS = 5 * 60 * 1000;

async function closePoolEntry(entry: PoolEntry<McpSessionHandle>, server: McpExternalServer): Promise<void> {
  stopKeepalive(server.id_uuid);
  await sessionClose(entry.handle).catch(() => undefined);
  cleanupOAuthTempFiles(server as ServerWithConfig);
}

// C.2: Keepalive-Manager — Liveness-Pings halten HTTP/SSE-Sessions über die Server-TTL am Leben.
// Keepalive-Probe: ping → -32601 → list_tools; echte Fehler → Reconnect.
const keepaliveTimers = new Map<string, ReturnType<typeof setInterval>>();
const KEEPALIVE_DEFAULT_S = 180;
// Explizite Werte < 5 s sind erlaubt (Tests/Server mit kurzer Session-TTL); Default 180 s.

function startKeepalive(server: McpExternalServer, handle: McpSessionHandle): void {
  const transport = server.transport_type;
  if (transport !== "http" && transport !== "sse" && transport !== "streamable_http") return; // stdio lebt durch den Prozess
  const configured = (server as ServerWithConfig).keepalive_interval_s;
  const intervalS = configured !== undefined && configured !== null ? Math.max(configured, 1) : KEEPALIVE_DEFAULT_S;
  const intervalMs = intervalS * 1000;
  if (keepaliveTimers.has(server.id_uuid)) return;
  const timer = setInterval(() => {
    void (async () => {
      const entry = sdkSessionPool.get(server.id_uuid);
      if (!entry) {
        clearInterval(timer);
        keepaliveTimers.delete(server.id_uuid);
        return;
      }
      const ping = await sessionPing(entry.handle);
      if (ping.ok) return;
      if (isMethodNotFoundError(new Error(ping.error || ""))) {
        // ping nicht implementiert → list_tools als Liveness-Probe (nur wenn die Session lebt)
        try {
          await sessionListTools(entry.handle);
        } catch {
          /* tote Session → unten invalidieren */
          await invalidateSdkSession(server.id_uuid).catch(() => undefined);
        }
        return;
      }
      // Echter Liveness-Fehler (Timeout, Session expired, Transport zu) → Reconnect beim nächsten Call
      console.log(`[MCP Keepalive] Session für Server ${server.id_uuid} verloren (${sanitizeErrorText(ping.error || "unbekannt")}) — invalidiert`);
      await invalidateSdkSession(server.id_uuid).catch(() => undefined);
    })();
  }, intervalMs);
  keepaliveTimers.set(server.id_uuid, timer);
}

function stopKeepalive(serverId: string): void {
  const timer = keepaliveTimers.get(serverId);
  if (timer) {
    clearInterval(timer);
    keepaliveTimers.delete(serverId);
  }
}

// --- C.6: Tool-Filtering (include/exclude) ------------------------------------
// include gewinnt bei beidem; exakte Namen zuerst, fnmatch-Globs nur bei Metazeichen.
function escapeRegexPart(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchesNameFilter(toolName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const p = String(pattern || "").trim();
    if (!p) return false;
    if (!/[?*[]/.test(p)) return toolName === p; // exakter Name
    // fnmatch-artiger Glob: * und ? (case-sensitive)
    const re = new RegExp(
      "^" + p.split("*").map((part) => escapeRegexPart(part).replace(/\?/g, ".")).join(".*") + "$"
    );
    return re.test(toolName);
  });
}

/** Filtert einen Tool-Namen gemäß Server-Regeln: true = Tool ist deaktiviert (gefiltert). */
export function isToolFilteredByName(server: ServerWithConfig, toolName: string): boolean {
  const include = server.tools_include_json;
  const exclude = server.tools_exclude_json;
  if (Array.isArray(include) && include.length > 0) {
    // include gewinnt: nur gelistete Tools bleiben aktiv
    return !matchesNameFilter(toolName, include);
  }
  if (Array.isArray(exclude) && exclude.length > 0) {
    return matchesNameFilter(toolName, exclude);
  }
  return false;
}

/** Wendet die Filter-Regeln auf alle entdeckten Tools eines Servers an (Regel-Änderung + Discovery-Nachlauf). */
export async function applyToolFilters(serverId: string, tenantId: string): Promise<void> {
  const server = await McpClientEngine.getServerById(serverId, tenantId);
  if (!server) return;
  const include = (server as ServerWithConfig).tools_include_json;
  const exclude = (server as ServerWithConfig).tools_exclude_json;
  if (!Array.isArray(include) && !Array.isArray(exclude)) return;

  if (isUsingFallback) {
    for (const t of fallbackStore.mcp_discovered_tools || []) {
      if (t.server_id_uuid !== serverId) continue;
      const disabled = isToolFilteredByName(server as ServerWithConfig, t.original_tool_name);
      t.is_enabled_for_louis = !disabled;
      t.is_enabled_for_ui = !disabled;
    }
    saveFallbackStore();
    return;
  }
  // DB: nur Tools des Servers aktualisieren (Regeln sind Systemebene → überschreiben Toggles)
  const rows = await pool.query(
    `SELECT id_uuid, original_tool_name FROM sys_mcp_discovered_tools WHERE server_id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
    [serverId, tenantId]
  );
  for (const row of rows.rows) {
    const disabled = isToolFilteredByName(server as ServerWithConfig, row.original_tool_name);
    await pool.query(
      `UPDATE sys_mcp_discovered_tools SET is_enabled_for_louis = $1, is_enabled_for_ui = $2 WHERE id_uuid = $3`,
      [!disabled, !disabled, row.id_uuid]
    );
  }
}

// C.5 (Plan 2026-08-19): Parallel-Tool-Calls — Opt-in pro Server (supports_parallel_tool_calls,
// Default false = sequenziell wie bisher). stdio bleibt IMMER gelockt (ein Prozess, sequenzielle Requests).
const serverCallLocks = new Map<string, Promise<unknown>>();

async function withServerLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = serverCallLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  serverCallLocks.set(key, next.catch(() => undefined));
  return next;
}

// --- C.4: Genehmigungs-Queue (Trust-Gate) -------------------------------------
// untrusted-Server: Write-Tools brauchen eine Admin-Freigabe (Human-Gate-Muster).
// Entscheider = NUR Admin (Entscheid 2026-08-19); wartender Call pollt (2-s-Intervall)
// bis zur Entscheidung oder dem Timeout (mcp_approval_timeout_s, Default 120 s).

async function getMcpAdminConfig(tenantId: string): Promise<{ approvalTimeoutS: number; stdioMaxSessions: number }> {
  if (isUsingFallback) return { approvalTimeoutS: 120, stdioMaxSessions: 5 };
  try {
    const res = await pool.query(
      `SELECT mcp_approval_timeout_s, mcp_stdio_max_sessions FROM sys_integrations_louis_ai_config
       WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1`,
      [tenantId]
    );
    const row = res.rows[0] || {};
    return {
      approvalTimeoutS: row.mcp_approval_timeout_s ?? 120,
      stdioMaxSessions: row.mcp_stdio_max_sessions ?? 5
    };
  } catch {
    return { approvalTimeoutS: 120, stdioMaxSessions: 5 };
  }
}

export async function listMcpApprovalRequests(tenantId: string): Promise<McpApprovalRequestRecord[]> {
  if (isUsingFallback) {
    const list = fallbackStore.mcpApprovalRequests || [];
    return [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)) as McpApprovalRequestRecord[];
  }
  const res = await pool.query(
    `SELECT * FROM sys_mcp_approval_requests WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC LIMIT 200`,
    [tenantId]
  );
  return res.rows.map((r) => cleanDbRow(r) as McpApprovalRequestRecord);
}

async function getApprovalStatus(idUuid: string, tenantId: string): Promise<string> {
  if (isUsingFallback) {
    const rec = (fallbackStore.mcpApprovalRequests || []).find((r) => r.id_uuid === idUuid);
    return rec?.status ?? "pending";
  }
  const res = await pool.query(
    `SELECT status FROM sys_mcp_approval_requests WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
    [idUuid, tenantId]
  );
  return res.rows[0]?.status ?? "pending";
}

async function insertApprovalRequest(record: McpApprovalRequestRecord): Promise<void> {
  if (isUsingFallback) {
    if (!fallbackStore.mcpApprovalRequests) fallbackStore.mcpApprovalRequests = [];
    fallbackStore.mcpApprovalRequests.push(record);
    saveFallbackStore();
    return;
  }
  await pool.query(
    `INSERT INTO sys_mcp_approval_requests (
      id_uuid, tenant_id, server_id_uuid, server_name, tool_id_uuid, normalized_tool_name,
      original_tool_name, tool_arguments_json, requested_by, status, created_at_utc
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', CURRENT_TIMESTAMP)`,
    [
      record.id_uuid,
      record.tenant_id,
      record.server_id_uuid,
      record.server_name,
      record.tool_id_uuid,
      record.normalized_tool_name,
      record.original_tool_name,
      JSON.stringify(record.tool_arguments_json ?? {}),
      record.requested_by
    ]
  );
}

async function requestToolApproval(
  server: McpExternalServer,
  tool: McpDiscoveredTool,
  args: unknown,
  tenantId: string
): Promise<{ status: "approved" | "rejected" | "expired"; error?: string }> {
  const idUuid = uuidv4();
  const { approvalTimeoutS } = await getMcpAdminConfig(tenantId);
  const record: McpApprovalRequestRecord = {
    id_uuid: idUuid,
    tenant_id: tenantId,
    server_id_uuid: server.id_uuid,
    server_name: server.server_name,
    tool_id_uuid: tool.id_uuid,
    normalized_tool_name: tool.normalized_tool_name,
    original_tool_name: tool.original_tool_name,
    tool_arguments_json: args ?? {},
    requested_by: "louis_ai",
    status: "pending",
    created_at: new Date().toISOString()
  };
  await insertApprovalRequest(record);

  // Polling (2-s-Intervall) bis Entscheidung oder Timeout
  const deadline = Date.now() + approvalTimeoutS * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = await getApprovalStatus(idUuid, tenantId);
    if (status === "approved") return { status: "approved" };
    if (status === "rejected") {
      return { status: "rejected", error: `MCP-Tool-Ausführung abgelehnt (Server "${server.server_name}", Tool "${tool.original_tool_name}")` };
    }
  }
  return { status: "expired", error: `Genehmigung ausstehend (Timeout ${approvalTimeoutS}s) — Tool "${tool.original_tool_name}" auf Server "${server.server_name}" nicht ausgeführt` };
}

/** Admin-Entscheidung (NUR Admin — Router erzwingt adminProcedure). */
export async function decideMcpApprovalRequest(
  idUuid: string,
  decision: "approve" | "reject",
  tenantId: string,
  decidedBy: string,
  comment?: string
): Promise<McpApprovalRequestRecord | null> {
  const status = decision === "approve" ? "approved" : "rejected";
  if (isUsingFallback) {
    const list = fallbackStore.mcpApprovalRequests || [];
    const idx = list.findIndex((r) => r.id_uuid === idUuid && (r.tenant_id === tenantId || r.tenant_id === "1"));
    if (idx < 0) return null;
    if (list[idx].status !== "pending") return list[idx] as McpApprovalRequestRecord;
    list[idx] = {
      ...list[idx],
      status,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
      decision_comment: comment || null
    };
    saveFallbackStore();
    return list[idx] as McpApprovalRequestRecord;
  }
  const res = await pool.query(
    `UPDATE sys_mcp_approval_requests SET status = $1, decided_by = $2, decided_at = CURRENT_TIMESTAMP, decision_comment = $3
     WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1') AND status = 'pending' RETURNING *`,
    [status, decidedBy, comment || null, idUuid, tenantId]
  );
  return res.rows.length > 0 ? (cleanDbRow(res.rows[0]) as McpApprovalRequestRecord) : null;
}

async function getOrOpenSdkSession(server: McpExternalServer): Promise<McpSessionHandle> {
  const poolKey = server.id_uuid;
  const now = Date.now();
  const cached = sdkSessionPool.get(poolKey);
  if (cached) {
    const { recycle, reason } = shouldRecycle(cached, server as ServerWithConfig, now);
    if (recycle) {
      console.log(`[MCP Lifecycle] Session für "${server.server_name}" recycled (${reason})`);
      await closePoolEntry(cached, server);
      sdkSessionPool.delete(poolKey);
    } else {
      cached.lastUsedAt = now;
      return cached.handle;
    }
  }
  // Ressourcen-Limit: älteste idle stdio-Session schließen (C.1/C.4, Admin-Config mcp_stdio_max_sessions, Default 5)
  if (server.transport_type === "stdio") {
    const { stdioMaxSessions } = await getMcpAdminConfig(server.tenant_id || "1");
    for (const key of enforceStdioLimit(sdkSessionPool, stdioMaxSessions, now)) {
      const entry = sdkSessionPool.get(key);
      if (entry) {
        await closePoolEntry(entry, { id_uuid: key } as McpExternalServer);
        sdkSessionPool.delete(key);
      }
    }
  }
  const { envVars, headers } = await McpClientEngine.getEnrichedServerEnvAndHeaders(server, server.tenant_id);
  const handle = await openSession({ server: server as ServerWithConfig, headers, envVars });
  sdkSessionPool.set(poolKey, {
    handle,
    lastUsedAt: now,
    openedAt: now,
    isStdio: server.transport_type === "stdio"
  });
  startKeepalive(server, handle);
  return handle;
}

async function invalidateSdkSession(serverId: string): Promise<void> {
  const cached = sdkSessionPool.get(serverId);
  if (cached) {
    await closePoolEntry(cached, { id_uuid: serverId } as McpExternalServer);
    sdkSessionPool.delete(serverId);
  }
}

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
export async function parseMcpResponseBody(res: Response, serverId?: string): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    // SSE-Format: JEDES data:-Event einzeln parsen (nicht zu einem JSON joinen!)
    // #45 (026 P1-2): Server-Notification-Events werden behandelt (list_changed → Cache-Refresh),
    // das letzte Event mit Antwort (result/error) ist die Response.
    const jsonBlocks: string[] = [];
    let inData = false;
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data:")) { jsonBlocks.push(line.slice(5).trim()); inData = true; }
      else if (line.startsWith("event:") || line.startsWith("id:") || line.startsWith("retry:")) { inData = false; }
      else if (inData && line.trim() !== "") { jsonBlocks[jsonBlocks.length - 1] += line.trim(); }
    }
    if (jsonBlocks.length === 0) return null;
    let lastAnswer: unknown = null;
    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (isServerNotification(parsed)) {
          if (serverId) void handleServerNotification(serverId, String(parsed.method));
          continue;
        }
        lastAnswer = parsed;
      } catch {
        // einzelnes Event nicht parsebar — ignorieren, weitersuchen
      }
    }
    return lastAnswer ?? { raw: jsonBlocks.join("\n") };
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

// Auftrag 025 Phase 7 (#55): MCP-Timeout pro Aufruf — hängende MCP-Server dürfen den
// Agent-Loop nie blockieren (Muster mcp.py:186). AbortController statt globalem Hängen.
function mcpFetchWithTimeout(url: string, init?: RequestInit, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return mcpFetch(url, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId))
    .catch((err) => {
      const aborted = controller.signal.aborted;
      throw new Error(`MCP-Request ${aborted ? `Timeout nach ${timeoutMs}ms` : "fehlgeschlagen"}: ${err instanceof Error ? err.message : String(err)}`);
    });
}

function getAuthHeaders(server: McpExternalServer): Record<string, string> {
  const headers: Record<string, string> = { ...server.headers };
  //  2026-08-17: "Bearer "-Präfix defensiv entfernen — Nutzer kopieren oft den
  // Plugin-Anzeige-Text ("Bearer <hex>") statt des Hex-Keys → sonst "Bearer Bearer …" → 401.
  // C.3: auth_token_encrypted kann verschlüsselt sein (lv1:) — vor Nutzung entschlüsseln.
  const token = normalizeAuthToken(decryptSecret(server.auth_token_encrypted));

  // D.1 (Plan 2026-08-19): custom = Header-Map (JSON-String, verschlüsselt speicherbar) —
  // vorher still ignoriert (Lücke im transport_type/auth_type-Enum).
  const customHeadersRaw = (server as ServerWithConfig).custom_headers;
  if (customHeadersRaw) {
    try {
      const parsed = JSON.parse(decryptSecret(customHeadersRaw)) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") headers[k] = v;
      }
    } catch {
      console.warn(`[MCP Client] custom_headers für Server "${server.server_name}" ist kein gültiges JSON — ignoriert`);
    }
  }

  if ((server.auth_type === "bearer" || server.auth_type === "bearer_token") && token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (server.auth_type === "api_key" && token) {
    headers["X-API-Key"] = token;
  } else if (server.auth_type === "basic" && token) {
    headers["Authorization"] = `Basic ${Buffer.from(token).toString("base64")}`;
  }
  return headers;
}

// Auftrag 025 Phase 7 (#43): Discovery-In-Progress-Lock (Server-Refresh) — parallele
// Discovery-Aufrufe für denselben Server werden übersprungen statt doppelt ausgeführt.
const discoveryInProgress: Set<string> = new Set();
// TTL-Cache für listToolsForLouis (Pro-Tenant, Muster mcp.py discovery_cached)
const mcpToolsCache: Map<string, { tools: McpDiscoveredTool[]; fetchedAt: number }> = new Map();

// Auftrag 026 P1-2 (#45): mcp-2.0-ServerNotification-Union robust verarbeiten.
// Eine Server-Notification hat KEIN id/result/error, aber method — sie ist keine
// Antwort auf unseren Request und darf nie als Fehler gewertet werden.
export function isServerNotification(msg: unknown): msg is { method: string; params?: unknown } {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  return typeof m.method === "string" && !("id" in m) && !("result" in m) && !("error" in m);
}

/**
 * #45: Notification behandeln — bei tools/list_changed den TTL-Cache invalidieren und
 * einen async Refresh anstoßen (der Discovery-Lock verhindert Doppel-Refresh).
 * Nie werfend (Best-Effort, Hintergrund).
 */
async function handleServerNotification(serverId: string, method: string): Promise<void> {
  if (method === "notifications/tools/list_changed" || method === "tools/list_changed") {
    mcpToolsCache.delete(serverId);
    console.log(`[MCP #45] tools/list_changed von Server ${serverId} — TTL-Cache invalidiert, async Refresh.`);
    void McpClientEngine.discoverTools(serverId, "1").catch((err) =>
      console.warn(`[MCP #45] Refresh nach list_changed fehlgeschlagen (ignoriert):`, err instanceof Error ? err.message : String(err))
    );
  }
  // Weitere Notification-Typen (z. B. progress, cancelled) sind für Louis als Client unkritisch
  // und werden bewusst ignoriert (kein Crash, keine Fehlbehandlung).
}

export class McpClientEngine {
  static async getEnrichedServerEnvAndHeaders(server: McpExternalServer, tenantId: string = "1") {
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
        // UID-spezifischer Temp-Pfad ( 2026-08-19): Docker-Exec-Diagnosen (root) und die
        // App (User 'app', UID 999) kollidieren sonst auf demselben Ordner → EACCES für die App.
        const uidPart = typeof process.getuid === "function" ? String(process.getuid()) : "app";
        const mcpDir = path.join(os.tmpdir(), `louis-mcp-${uidPart}`, `mcp_server_${server.id_uuid}`);
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

        // Defensive Bereinigung ( 2026-08-19): Fremde Dateien (z. B. von root-Prozessen
        // erstellt) blockieren das Überschreiben mit EACCES. Vor jedem Write: Datei entfernen
        // (force — existiert nicht → kein Fehler), dann frisch schreiben → Rechte folgen dem
        // aktuellen User. Der Ordner selbst wird nach dem mkdir auf den aktuellen User geprüft.
        try {
          fs.mkdirSync(mcpDir, { recursive: true, mode: 0o700 });
        } catch {
          // EACCES auf fremden Ordner → rekursiv entfernen (wenn möglich) + neu anlegen
          fs.rmSync(mcpDir, { recursive: true, force: true });
          fs.mkdirSync(mcpDir, { recursive: true, mode: 0o700 });
        }
        const writeFresh = (p: string, data: string): void => {
          fs.rmSync(p, { force: true });
          fs.writeFileSync(p, data, { encoding: "utf8", mode: 0o600 });
        };

        // Write OAuth client keys files
        writeFresh(clientSecretsPath, JSON.stringify(clientSecretsData, null, 2));
        writeFresh(credentialsKeysPath, JSON.stringify(clientSecretsData, null, 2));

        // Write token files
        writeFresh(tokenFilePath, JSON.stringify(tokenData, null, 2));
        writeFresh(gcalTokenFilePath, JSON.stringify(tokenData, null, 2));

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

        // mcp-gmail ( 2026-08-19): unterstützt KEINEN Env-Pfad für die OAuth-Keys —
        // es sucht ~/.gmail-mcp/gcp-oauth.keys.json (HOME-abhängig). HOME der App ist /app
        // (root:root, 0755) → mkdir ~/.gmail-mcp scheitert mit EACCES. Fix: HOME auf den
        // UID-Temp-Ordner setzen + die Keys dort im .gmail-mcp-Unterordner ablegen.
        // npm_config_cache explizit auf /app/.npm (Volume) — bleibt unabhängig von HOME persistent.
        envVars["HOME"] = mcpDir;
        envVars["npm_config_cache"] = "/app/.npm";
        try {
          const gmailMcpDir = path.join(mcpDir, ".gmail-mcp");
          fs.mkdirSync(gmailMcpDir, { recursive: true, mode: 0o700 });
          writeFresh(path.join(gmailMcpDir, "gcp-oauth.keys.json"), JSON.stringify(clientSecretsData, null, 2));
          writeFresh(path.join(gmailMcpDir, "token.json"), JSON.stringify(tokenData, null, 2));
        } catch (err) {
          console.warn(`[MCP Engine] Could not write gmail-mcp keys:`, err);
        }

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
      // Phase B: SDK-Session öffnen (initialize-Handshake inklusive) → ehrliches Health.
      // Fallback auf list_tools, wenn der Server ping nicht implementiert (-32601).
      const handle = await getOrOpenSdkSession(server);
      const ping = await sessionPing(handle);
      if (ping.ok) {
        healthy = true;
      } else if (
        isMethodNotFoundError(new Error(ping.error || "")) ||
        /timeout|timed out/i.test(ping.error || "")
      ) {
        // Server ohne ping-Handler (ältere Pakete, z. B. Google-MCP) beantworten ping nie
        // (Timeout) oder melden -32601 — Liveness dann über tools/list ( 2026-08-19).
        try {
          const tools = await sessionListTools(handle);
          healthy = tools.length > 0;
          if (!healthy) errorMessage = "Server hat keine Tools (weder ping noch tools/list)";
        } catch (err) {
          errorMessage = `list_tools-Fallback fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        errorMessage = sanitizeErrorText(ping.error || "ping fehlgeschlagen");
      }
    } catch (err) {
      errorMessage = sanitizeErrorText(err instanceof Error ? err.message : String(err));
      healthy = false;
      await invalidateSdkSession(server.id_uuid).catch(() => undefined);
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
              if (parsed && typeof parsed === "object") {
                // #45 (026 P1-2): Server-Notification (kein id/result/error) ist KEINE Antwort —
                // überspringen und weiter nach der echten Response suchen (kein Crash).
                if (isServerNotification(parsed)) {
                  console.log(`[MCP #45] stdio-Notification übersprungen: ${String(parsed.method)}`);
                  continue;
                }
                if ("result" in parsed || "error" in parsed) {
                  if (parsed.error) {
                    const errMsg = typeof parsed.error === "object" ? parsed.error.message || JSON.stringify(parsed.error) : String(parsed.error);
                    resolve({ error: errMsg });
                  } else {
                    resolve({ result: parsed.result });
                  }
                  return;
                }
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
    // Auftrag 025 Phase 7 (#43): Discovery-In-Progress-Lock — parallele Discovery-Aufrufe
    // für denselben Server werden übersprungen statt doppelt ausgeführt (MCP-Refresh-Lock).
    const lockKey = `${tenantId}:${serverId}`;
    if (discoveryInProgress.has(lockKey)) {
      return [];
    }
    discoveryInProgress.add(lockKey);
    try {
      return await this.discoverToolsInner(serverId, tenantId);
    } finally {
      discoveryInProgress.delete(lockKey);
    }
  }

  private static async discoverToolsInner(serverId: string, tenantId: string = "1"): Promise<McpDiscoveredTool[]> {
    const server = await this.getServerById(serverId, tenantId);
    if (!server) {
      throw new Error(`MCP external server ${serverId} not found`);
    }

    const now = new Date().toISOString();
    let rawTools: Array<{ name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }> = [];

    const oauthToken = await getMcpOAuthToken(tenantId, server.id_uuid);
    if (server.auth_type === "oauth2" && !oauthToken) {
      throw new Error(`OAuth 2.0 Autorisierung erforderlich: Bitte klicken Sie bei "${server.server_name}" auf "OAuth Autorisieren", um Zugriff auf den Service zu gewähren.`);
    }
    // D.2 (Plan 2026-08-19): abgelaufener Token → ehrliche Meldung statt kryptischer 401.
    // NUR blocken, wenn KEIN refresh_token existiert — die externen OAuth-Prozesse (Google)
    // refreshen selbst via refresh_token (Env); ohne Refresh-Möglichkeit ist Re-Autorisierung nötig.
    if (server.auth_type === "oauth2" && oauthToken) {
      const expiresAt = oauthToken.expires_at ? new Date(oauthToken.expires_at).getTime() : null;
      const hasRefresh = !!oauthToken.refresh_token;
      if (!hasRefresh && expiresAt && expiresAt < Date.now() - 5 * 60 * 1000) {
        throw new Error(`OAuth-Token für "${server.server_name}" ist abgelaufen und hat keinen Refresh-Token — bitte "OAuth Autorisieren" erneut ausführen.`);
      }
    }

    // Phase B: SDK-Session (initialize/stateless-Negotiation) → tools/list.
    // Unbekannter Transport wirft (Fehler statt Stille).
    let handle: McpSessionHandle;
    try {
      handle = await getOrOpenSdkSession(server);
    } catch (err) {
      await invalidateSdkSession(server.id_uuid).catch(() => undefined);
      throw new Error(sanitizeErrorText(`Failed to open MCP session (${server.server_name}): ${err instanceof Error ? err.message : String(err)}`));
    }
    try {
      rawTools = await sessionListTools(handle);
    } catch (err) {
      await invalidateSdkSession(server.id_uuid).catch(() => undefined);
      throw new Error(sanitizeErrorText(`Failed to list tools from MCP server ${server.server_name}: ${err instanceof Error ? err.message : String(err)}`));
    }

    const discoveredTools: McpDiscoveredTool[] = [];
    const serverCleanName = normalizeName(server.server_name);

    for (const tool of rawTools) {
      const origName = tool.name;
      const normalizedName = `mcp_${serverCleanName}_${normalizeName(origName)}`;
      const toolId = uuidv4();

      // Auftrag 025 Phase 7 (#54): MCP-Schema-Normalisierung — doppelt gewrappte
      // inputSchema unwrappen, bevor sie an den Agent-Katalog gehen (wie #8).
      const normalizedSchema = unwrapWrappedSchema(tool.inputSchema || {});

      // C.4: readOnlyHint des Servers erfassen (nur exakt true = read-only;
      // fehlender Hint = write-capable — fail-closed-Semantik für Trust-Gate).
      const readonlyHint = tool.annotations?.readOnlyHint === true;

      // C.6: Filter-Regeln (include/exclude) belegen die Toggles bei Discovery vor
      // (Systemebene — manuell überschreibbar in der Tool-Mappings-UI).
      const serverWithCfg = server as ServerWithConfig;
      const toolDisabled = isToolFilteredByName(serverWithCfg, origName);

      const discoveredTool: McpDiscoveredTool = {
        id_uuid: toolId,
        tenant_id: tenantId,
        server_id_uuid: server.id_uuid,
        original_tool_name: origName,
        normalized_tool_name: normalizedName,
        description: tool.description || null,
        input_schema: normalizedSchema,
        is_enabled_for_louis: !toolDisabled,
        is_enabled_for_ui: !toolDisabled,
        category: "custom",
        last_discovered_at: now,
        readonly_hint: readonlyHint
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

    // C.6: Fail-closed — deaktivierte Tools (Filter-Regeln/Toggle) sind auch per direktem
    // executeTool nicht ausführbar (sonst umgehbar über bekannten normalisierten Namen).
    if (tool.is_enabled_for_louis === false && tool.is_enabled_for_ui === false) {
      return {
        success: false,
        result: null,
        error: `MCP Tool '${tool.original_tool_name}' ist deaktiviert (Filter-Regeln des Servers '${server.server_name}')`,
        execution_time_ms: Date.now() - startTime,
        server_name: server.server_name
      };
    }

    let success = false;
    let result: unknown = null;
    let error: string | null = null;

    // C.4: Trust-Gate — untrusted-Server + Write-Tool (kein readOnlyHint) → Genehmigungs-Queue.
    // Semantik: readOnlyHint nur exakt true = read-only; fehlender Hint = write-capable (fail-closed).
    const trust = (server as ServerWithConfig).trust ?? "full";
    const isWrite = tool.readonly_hint !== true;
    if (trust === "untrusted" && isWrite) {
      const approval = await requestToolApproval(server, tool, input.arguments || {}, tenantId);
      if (approval.status !== "approved") {
        return {
          success: false,
          result: null,
          error: approval.error || "MCP-Tool-Ausführung nicht genehmigt",
          execution_time_ms: Date.now() - startTime,
          server_name: server.server_name
        };
      }
    }

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

      // Phase B: SDK-Session → tools/call. isError-Result wird als Fehler behandelt (B3-Fix).
      // Reconnect-on-failure: tote Session (z. B. stdio-Prozess beendet) → invalidieren + 1 Retry.
      // C.5: Parallel nur bei Opt-in (supports_parallel_tool_calls) UND HTTP/SSE; sonst Server-Lock (sequenziell).
      const allowParallel =
        (server as ServerWithConfig).supports_parallel_tool_calls === true &&
        server.transport_type !== "stdio";

      const callBlock = async (): Promise<void> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const handle = await getOrOpenSdkSession(server);
            const res = await sessionCallTool(handle, tool.original_tool_name, normalizedArgs);
          if (res.error) {
            // Retry NUR bei toter Session/Verbindung — Timeout ist ein echter Fehler (kein Retry, sonst doppelte Latenz)
            if (!res.timedOut && /not connected|closed|beendet|exit|session not found|not initialized|invalid session|404/i.test(res.error)) {
              await invalidateSdkSession(server.id_uuid).catch(() => undefined);
              if (attempt === 0) continue; // 1 Retry mit frischer Session
            }
            error = sanitizeErrorText(res.error);
            break;
          } else if (res.isError) {
            // MCP-Fehlerantworten NIE als Erfolg behandeln (B3): Text aus content[0] ziehen
            const content = res.content as Array<{ type?: string; text?: string }> | undefined;
            error = sanitizeErrorText(content?.[0]?.text || "MCP-Tool meldete einen Fehler (isError)");
            break;
          } else {
            success = true;
            // Fassaden-Vertrag (Bestand): result = volles MCP-Result-Objekt { content } — NICHT nur das Array
            result = { content: res.content };
            break;
          }
        } catch (err) {
          await invalidateSdkSession(server.id_uuid).catch(() => undefined);
          if (attempt === 0) continue;
          error = sanitizeErrorText(err instanceof Error ? err.message : String(err));
          break;
        }
      }
      };

      if (allowParallel) {
        await callBlock();
      } else {
        await withServerLock(server.id_uuid, callBlock);
      }

      if (success && result !== null && result !== undefined) {
        const pruned = pruneMcpToolResult(result);
        result = pruned.data;
      }
    } catch (err) {
      success = false;
      error = sanitizeErrorText(err instanceof Error ? err.message : String(err));
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

  // C.6: public gemacht für applyToolFilters (Filter-Regeln nach Server-Update anwenden)
  static async getServerById(serverId: string, tenantId: string = "1"): Promise<McpExternalServer | null> {
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

  /**
   * Auftrag 025 Phase 7 (#43): MCP-Tools mit TTL-Cache (Refresh-Intervall, NULL = 300 s) —
   * der DB-Read läuft nicht bei jedem Agent-Request, sondern höchstens alle
   * refreshIntervalS Sekunden pro Tenant (Muster mcp.py discovery_cached).
   */
  static async listToolsForLouis(tenantId: string = "1", refreshIntervalS?: number | null, sessionId?: string): Promise<McpDiscoveredTool[]> {
    const ttlMs = (refreshIntervalS ?? 300) * 1000;
    const now = Date.now();
    const cached = mcpToolsCache.get(tenantId);

    // C.7-Fix ( 2026-08-19): Der Cache speichert die Admin-freigegebene BASISMENGE —
    // der Chatprofil-Filter (sessionId) läuft bei JEDEM Aufruf, auch bei Cache-Hits. Vorher
    // machte der Hit ein early return → Filter wirkte nur beim ersten Aufruf pro TTL-Fenster.
    let tools: McpDiscoveredTool[];
    if (cached && now - cached.fetchedAt < ttlMs) {
      tools = cached.tools;
    } else {
    if (isUsingFallback) {
      tools = (fallbackStore.mcp_discovered_tools || [])
        .filter((t) => t.is_enabled_for_louis && (t.tenant_id === tenantId || (t.tenant_id === '1' && tenantId === '1')))
        .map((t) => ({
          ...t,
          input_schema: typeof t.input_schema === 'string' ? JSON.parse(t.input_schema) : (t.input_schema || {})
        })) as McpDiscoveredTool[];
    } else {
      const res = await pool.query(
        `SELECT * FROM sys_mcp_discovered_tools WHERE is_enabled_for_louis = true AND (tenant_id = $1 OR (tenant_id = '1' AND $1 = '1'))`,
        [tenantId]
      );
      tools = res.rows.map((row) => {
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

    mcpToolsCache.set(tenantId, { tools, fetchedAt: now });
    }

    // C.7 (Plan 2026-08-19): Chatprofil-Filter — effektive Toolmenge =
    // Admin-Freigabe ∩ (Session-Override | Chatprofil-Tools | Main = alle)
    if (sessionId) {
      const sessionProfile = await getSessionProfile(tenantId, sessionId).catch(() => null);
      if (sessionProfile) {
        let allowedNames: string[] | null = null;
        if (Array.isArray(sessionProfile.overrideTools)) {
          // Override vorhanden (auch leer = User hat alle abgewählt) → gewinnt über Profil
          allowedNames = sessionProfile.overrideTools;
        } else if (sessionProfile.profileId) {
          const profile = await getChatProfileById(tenantId, sessionProfile.profileId).catch(() => null);
          allowedNames = profileToolNames(profile); // tools_json (auch []) oder null (Main ohne Auswahl = alle)
        }
        if (allowedNames !== null) {
          const allowed = new Set(allowedNames);
          tools = tools.filter((t) => allowed.has(t.normalized_tool_name));
        }
      }
    }

    return tools;
  }

  static async getToolByNormalizedName(normalizedName: string, tenantId: string): Promise<McpDiscoveredTool | null> {
    const rawTarget = (normalizedName || "").toLowerCase().trim();
    const cleanTarget = rawTarget.replace(/^mcp_/, "");

    if (isUsingFallback) {
      const list = (fallbackStore.mcp_discovered_tools || []).filter(
        (t) => t.tenant_id === tenantId || t.tenant_id === "1"
      );
      // Phase B (2026-08-19,  E6): EXAKTE Auflösung zuerst — der lose Suffix-Fallback
      // (endsWith) matchte bei mehreren Servern mit gleichen Tool-Namen das ERSTE (falsche) Tool.
      const normOf = (t: McpDiscoveredTool) => (t.normalized_tool_name || "").toLowerCase();
      const origOf = (t: McpDiscoveredTool) => (t.original_tool_name || "").toLowerCase();
      const normCleanOf = (t: McpDiscoveredTool) => normOf(t).replace(/^mcp_/, "");

      const exact = list.find((t) => {
        const norm = normOf(t);
        const orig = origOf(t);
        return (
          norm === rawTarget ||
          norm === `mcp_${rawTarget}` ||
          normCleanOf(t) === cleanTarget ||
          orig === rawTarget ||
          orig === cleanTarget
        );
      });
      const tool = exact ?? list.find((t) => {
        const normClean = normCleanOf(t);
        const orig = origOf(t);
        return (
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

    // DB-Zweig: exakte Treffer zuerst (LIMIT 1), Suffix nur wenn exakt nichts gefunden
    const exactRes = await pool.query(
      `SELECT * FROM sys_mcp_discovered_tools 
       WHERE (
         LOWER(normalized_tool_name) = $1 
         OR LOWER(normalized_tool_name) = 'mcp_' || $1
         OR LOWER(REGEXP_REPLACE(normalized_tool_name, '^mcp_', '')) = $2
         OR LOWER(original_tool_name) = $1
         OR LOWER(original_tool_name) = $2
       )
       AND (tenant_id = $3 OR (tenant_id = '1' AND $3 = '1')) 
       LIMIT 1`,
      [rawTarget, cleanTarget, tenantId]
    );
    let row = exactRes.rows[0];
    if (!row) {
      const looseRes = await pool.query(
        `SELECT * FROM sys_mcp_discovered_tools 
         WHERE (
           LOWER(REGEXP_REPLACE(normalized_tool_name, '^mcp_[^_]+_', '')) = $2
           OR LOWER(normalized_tool_name) LIKE '%' || $2
         )
         AND (tenant_id = $3 OR (tenant_id = '1' AND $3 = '1')) 
         LIMIT 1`,
        [rawTarget, cleanTarget, tenantId]
      );
      row = looseRes.rows[0];
    }
    if (!row) return null;
    const cleaned = cleanLigatureHacksFromValue(cleanDbRow(row)) as Record<string, unknown>;
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
