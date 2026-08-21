import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import {
  McpExternalServerSchema,
  McpExternalServerInputSchema,
  McpDiscoveredToolSchema,
  McpToolExecutionInputSchema,
  McpToolExecutionResultSchema,
  mcpPresetDefinitionSchema,
  installMcpPresetInputSchema,
  initiateMcpOAuthInputSchema,
  McpApprovalRequestSchema,
  McpChatProfileSchema
} from "../../lib/schemas.js";
import { McpClientEngine, listMcpApprovalRequests, decideMcpApprovalRequest, applyToolFilters } from "../mcp/mcpClientEngine.js";
import {
  listChatProfiles,
  createChatProfile,
  updateChatProfileDescription,
  updateChatProfile,
  deleteChatProfile,
  setDefaultChatProfile,
  switchSessionProfile,
  setSessionToolOverride,
  getSessionProfile
} from "../mcp/chatProfiles.js";
import { resolveRotatedSessionId } from "../ai/contextCompressor.js";
import { McpExternalServer, McpDiscoveredTool } from "../../types.js";
import { MCP_PRESETS_CATALOG, interpolatePresetConfig } from "../mcp/presets.js";
import { buildOAuthAuthUrl } from "../mcp/oauthHandler.js";
import { normalizeAuthToken } from "../mcp/authTokenNormalize.js";
import { encryptSecret } from "../mcp/secretCrypto.js";

function normalizeServerRow(row: unknown): McpExternalServer {
  if (!row || typeof row !== "object") throw new Error("Server row not found");
  const cleaned = cleanLigatureHacksFromValue(cleanDbRow(row as Record<string, unknown>)) as Record<string, unknown>;

  if (!cleaned.id_uuid) {
    cleaned.id_uuid = uuidv4();
  }

  // 1. command_args
  if (typeof cleaned.command_args === 'string') {
    try {
      cleaned.command_args = JSON.parse(cleaned.command_args);
    } catch {
      cleaned.command_args = [];
    }
  }
  if (!Array.isArray(cleaned.command_args)) {
    cleaned.command_args = [];
  } else {
    cleaned.command_args = cleaned.command_args.map((x: unknown) => String(x));
  }

  // 2. env_vars
  if (typeof cleaned.env_vars === 'string') {
    try {
      cleaned.env_vars = JSON.parse(cleaned.env_vars);
    } catch {
      cleaned.env_vars = {};
    }
  }
  if (!cleaned.env_vars || typeof cleaned.env_vars !== 'object' || Array.isArray(cleaned.env_vars)) {
    cleaned.env_vars = {};
  } else {
    const normEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(cleaned.env_vars as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        normEnv[k] = String(v);
      }
    }
    cleaned.env_vars = normEnv;
  }

  // 3. headers
  if (typeof cleaned.headers === 'string') {
    try {
      cleaned.headers = JSON.parse(cleaned.headers);
    } catch {
      cleaned.headers = {};
    }
  }
  if (!cleaned.headers || typeof cleaned.headers !== 'object' || Array.isArray(cleaned.headers)) {
    cleaned.headers = {};
  } else {
    const normHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(cleaned.headers as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        normHeaders[k] = String(v);
      }
    }
    cleaned.headers = normHeaders;
  }

  // 4. auth_type
  const validAuthTypes = ['none', 'bearer', 'api_key', 'basic', 'oauth2', 'bearer_token', 'custom'];
  if (!cleaned.auth_type || typeof cleaned.auth_type !== 'string' || !validAuthTypes.includes(cleaned.auth_type)) {
    cleaned.auth_type = 'none';
  }

  // 5. health_status
  const validHealth = ['unknown', 'healthy', 'degraded', 'error', 'offline'];
  if (!cleaned.health_status || typeof cleaned.health_status !== 'string' || !validHealth.includes(cleaned.health_status)) {
    cleaned.health_status = 'unknown';
  }

  // 6. transport_type
  const validTransport = ['stdio', 'sse', 'http', 'streamable_http'];
  if (!cleaned.transport_type || typeof cleaned.transport_type !== 'string' || !validTransport.includes(cleaned.transport_type)) {
    cleaned.transport_type = 'http';
  }

  // 7. is_active
  cleaned.is_active = Boolean(cleaned.is_active ?? true);

  // 8. string/null fields
  cleaned.description = typeof cleaned.description === 'string' ? cleaned.description : (cleaned.description ? String(cleaned.description) : null);
  cleaned.auth_token_encrypted = typeof cleaned.auth_token_encrypted === 'string' ? cleaned.auth_token_encrypted : null;
  cleaned.last_error_message = typeof cleaned.last_error_message === 'string' ? cleaned.last_error_message : null;
  if (cleaned.last_ping_at) {
    const rawPing = typeof cleaned.last_ping_at === 'object' && cleaned.last_ping_at && 'toISOString' in cleaned.last_ping_at ? (cleaned.last_ping_at as { toISOString: () => string }).toISOString() : String(cleaned.last_ping_at);
    const d = new Date(rawPing);
    cleaned.last_ping_at = !isNaN(d.getTime()) ? d.toISOString() : null;
  } else {
    cleaned.last_ping_at = null;
  }

  // 9. timestamps
  const nowIso = new Date().toISOString();
  if (cleaned.created_at_utc && !cleaned.created_at) {
    cleaned.created_at = typeof cleaned.created_at_utc === 'object' && cleaned.created_at_utc && 'toISOString' in cleaned.created_at_utc ? (cleaned.created_at_utc as { toISOString: () => string }).toISOString() : String(cleaned.created_at_utc);
  }
  if (!cleaned.created_at) {
    cleaned.created_at = nowIso;
  }

  if (cleaned.updated_at_utc && !cleaned.updated_at) {
    cleaned.updated_at = typeof cleaned.updated_at_utc === 'object' && cleaned.updated_at_utc && 'toISOString' in cleaned.updated_at_utc ? (cleaned.updated_at_utc as { toISOString: () => string }).toISOString() : String(cleaned.updated_at_utc);
  }
  if (!cleaned.updated_at) {
    cleaned.updated_at = nowIso;
  }

  return cleaned as unknown as McpExternalServer;
}

function normalizeDiscoveredToolRow(row: unknown): McpDiscoveredTool {
  if (!row || typeof row !== "object") throw new Error("Discovered tool row not found");
  const cleaned = cleanLigatureHacksFromValue(cleanDbRow(row as Record<string, unknown>)) as Record<string, unknown>;

  if (typeof cleaned.input_schema === 'string') {
    try {
      cleaned.input_schema = JSON.parse(cleaned.input_schema);
    } catch {
      cleaned.input_schema = {};
    }
  }
  if (!cleaned.input_schema || typeof cleaned.input_schema !== 'object' || Array.isArray(cleaned.input_schema)) {
    cleaned.input_schema = {};
  }

  cleaned.is_enabled_for_louis = Boolean(cleaned.is_enabled_for_louis ?? true);
  cleaned.is_enabled_for_ui = Boolean(cleaned.is_enabled_for_ui ?? true);
  cleaned.category = typeof cleaned.category === 'string' ? cleaned.category : 'custom';
  cleaned.description = typeof cleaned.description === 'string' ? cleaned.description : (cleaned.description ? String(cleaned.description) : null);
  cleaned.last_discovered_at = cleaned.last_discovered_at
    ? (typeof cleaned.last_discovered_at === 'object' && cleaned.last_discovered_at && 'toISOString' in cleaned.last_discovered_at ? (cleaned.last_discovered_at as { toISOString: () => string }).toISOString() : String(cleaned.last_discovered_at))
    : undefined;

  return cleaned as unknown as McpDiscoveredTool;
}

export const mcpClientRouter = router({
  listServers: protectedProcedure
    .input(z.object({}).optional())
    .output(z.array(McpExternalServerSchema))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback) {
        const list = (fallbackStore.mcp_external_servers || []).filter(
          (s) => s.tenant_id === tenantId || s.tenant_id === "1"
        );
        return list.map(normalizeServerRow);
      }

      const res = await pool.query(
        `SELECT * FROM sys_mcp_external_servers WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC`,
        [tenantId]
      );
      return res.rows.map(normalizeServerRow);
    }),

  createServer: protectedProcedure
    .input(McpExternalServerInputSchema)
    .output(McpExternalServerSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const idUuid = uuidv4();
      const now = new Date().toISOString();

      const newServer: McpExternalServer = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        server_name: input.server_name,
        description: input.description || null,
        transport_type: input.transport_type,
        endpoint_or_command: input.endpoint_or_command,
        command_args: input.command_args || [],
        env_vars: input.env_vars || {},
        headers: input.headers || {},
        auth_type: input.auth_type || "none",
        // 2026-08-17: "Bearer " / "Basic "-Präfix beim Persistieren entfernen
        // C.3: auth_token + neue Secret-Felder verschlüsselt speichern (echte AES-256-GCM)
        auth_token_encrypted: encryptSecret(normalizeAuthToken(input.auth_token_encrypted)),
        is_active: input.is_active ?? true,
        health_status: "unknown",
        last_ping_at: null,
        last_error_message: null,
        created_at: now,
        updated_at: now,
        // C.3: neue Konfigurationsfelder
        protocol: input.protocol ?? null,
        keepalive_interval_s: input.keepalive_interval_s ?? null,
        connect_timeout_s: input.connect_timeout_s ?? null,
        ssl_verify: input.ssl_verify ?? null,
        client_cert: encryptSecret(input.client_cert),
        client_key: encryptSecret(input.client_key),
        custom_headers: encryptSecret(input.custom_headers),
        supports_parallel_tool_calls: input.supports_parallel_tool_calls ?? null,
        trust: input.trust ?? 'full',
        tools_include_json: input.tools_include_json ?? null,
        tools_exclude_json: input.tools_exclude_json ?? null,
        idle_timeout_s: input.idle_timeout_s ?? null,
        max_lifetime_s: input.max_lifetime_s ?? null
      };

      if (isUsingFallback) {
        if (!fallbackStore.mcp_external_servers) fallbackStore.mcp_external_servers = [];
        fallbackStore.mcp_external_servers.push(newServer);
        saveFallbackStore();
        return normalizeServerRow(newServer);
      } else {
        const res = await pool.query(
          `INSERT INTO sys_mcp_external_servers (
            id_uuid, tenant_id, server_name, description, transport_type, endpoint_or_command,
            command_args, env_vars, headers, auth_type, auth_token_encrypted, is_active,
            protocol, keepalive_interval_s, connect_timeout_s, ssl_verify, client_cert, client_key,
            custom_headers, supports_parallel_tool_calls, trust, tools_include_json, tools_exclude_json,
            idle_timeout_s, max_lifetime_s,
            health_status, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING *`,
          [
            idUuid,
            tenantId,
            newServer.server_name,
            newServer.description,
            newServer.transport_type,
            newServer.endpoint_or_command,
            JSON.stringify(newServer.command_args),
            JSON.stringify(newServer.env_vars),
            JSON.stringify(newServer.headers),
            newServer.auth_type,
            newServer.auth_token_encrypted,
            newServer.is_active,
            newServer.protocol,
            newServer.keepalive_interval_s,
            newServer.connect_timeout_s,
            newServer.ssl_verify,
            newServer.client_cert,
            newServer.client_key,
            newServer.custom_headers,
            newServer.supports_parallel_tool_calls,
            newServer.trust,
            newServer.tools_include_json ? JSON.stringify(newServer.tools_include_json) : null,
            newServer.tools_exclude_json ? JSON.stringify(newServer.tools_exclude_json) : null,
            newServer.idle_timeout_s,
            newServer.max_lifetime_s
          ]
        );

        const createdRow = normalizeServerRow(res.rows[0]);

        // Automatically trigger ping and discovery in background
        McpClientEngine.pingServer(createdRow)
          .then(() => McpClientEngine.discoverTools(idUuid, tenantId))
          .catch((err) => console.warn(`[MCP Client] Auto-discovery error for server ${idUuid}:`, err));

        return createdRow;
      }
    }),

  updateServer: protectedProcedure
    .input(
      z.object({
        id_uuid: z.string().uuid(),
        data: McpExternalServerInputSchema.partial()
      })
    )
    .output(McpExternalServerSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const { id_uuid, data } = input;
      const now = new Date().toISOString();

      if (isUsingFallback) {
        const server = fallbackStore.mcp_external_servers?.find((s) => s.id_uuid === id_uuid);
        if (!server) throw new Error(`MCP External Server ${id_uuid} not found`);
        Object.assign(server, data, { updated_at: now });
        saveFallbackStore();
        return normalizeServerRow(server);
      }

      const updateFields: string[] = [];
      const values: unknown[] = [id_uuid, tenantId];
      let paramIdx = 3;

      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined) {
          if (["command_args", "env_vars", "headers"].includes(key)) {
            updateFields.push(`${key} = $${paramIdx}`);
            values.push(JSON.stringify(val));
          } else if (key === "auth_token_encrypted") {
            // 2026-08-17: "Bearer " / "Basic "-Präfix auch beim Update entfernen; C.3: verschlüsseln
            updateFields.push(`${key} = $${paramIdx}`);
            values.push(typeof val === "string" ? encryptSecret(normalizeAuthToken(val)) : val);
          } else if (["client_cert", "client_key", "custom_headers"].includes(key)) {
            // C.3: neue Secret-Felder verschlüsselt speichern
            updateFields.push(`${key} = $${paramIdx}`);
            values.push(typeof val === "string" ? encryptSecret(val) : val);
          } else if (["tools_include_json", "tools_exclude_json"].includes(key)) {
            // C.3: Array-Felder als JSONB serialisieren
            updateFields.push(`${key} = $${paramIdx}`);
            values.push(Array.isArray(val) ? JSON.stringify(val) : val);
          } else {
            updateFields.push(`${key} = $${paramIdx}`);
            values.push(val);
          }
          paramIdx++;
        }
      }

      if (updateFields.length === 0) {
        const current = await pool.query(
          `SELECT * FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
          [id_uuid, tenantId]
        );
        if (current.rows.length === 0) throw new Error(`MCP External Server ${id_uuid} not found`);
        return normalizeServerRow(current.rows[0]);
      }

      updateFields.push(`updated_at_utc = CURRENT_TIMESTAMP`);

      const res = await pool.query(
        `UPDATE sys_mcp_external_servers SET ${updateFields.join(", ")} 
         WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') RETURNING *`,
        values
      );

      if (res.rows.length === 0) throw new Error(`MCP External Server ${id_uuid} not found`);

      // C.6: Filter-Regeln geändert → betroffene entdeckte Tools sofort neu filtern (Systemebene)
      if (data.tools_include_json !== undefined || data.tools_exclude_json !== undefined) {
        await applyToolFilters(id_uuid, tenantId).catch((err) =>
          console.warn(`[MCP Client] applyToolFilters fehlgeschlagen für ${id_uuid}:`, err)
        );
      }

      return normalizeServerRow(res.rows[0]);
    }),

  deleteServer: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const { id_uuid } = input;

      if (isUsingFallback) {
        if (fallbackStore.mcp_external_servers) {
          fallbackStore.mcp_external_servers = fallbackStore.mcp_external_servers.filter((s) => s.id_uuid !== id_uuid);
        }
        if (fallbackStore.mcp_discovered_tools) {
          fallbackStore.mcp_discovered_tools = fallbackStore.mcp_discovered_tools.filter((t) => t.server_id_uuid !== id_uuid);
        }
        saveFallbackStore();
        return { success: true };
      }

      await pool.query(
        `DELETE FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [id_uuid, tenantId]
      );
      return { success: true };
    }),

  pingServer: protectedProcedure
    .input(z.object({ server_id_uuid: z.string().uuid() }))
    .output(
      z.object({
        healthy: z.boolean(),
        latencyMs: z.number(),
        errorMessage: z.string().optional().nullable()
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      let server: McpExternalServer | null = null;

      if (isUsingFallback) {
        server = fallbackStore.mcp_external_servers?.find((s) => s.id_uuid === input.server_id_uuid) || null;
      } else {
        const res = await pool.query(
          `SELECT * FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
          [input.server_id_uuid, tenantId]
        );
        if (res.rows.length > 0) {
          server = cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as McpExternalServer;
        }
      }

      if (!server) {
        throw new Error(`MCP External Server ${input.server_id_uuid} not found`);
      }

      return await McpClientEngine.pingServer(server);
    }),

  discoverTools: protectedProcedure
    .input(z.object({ server_id_uuid: z.string().uuid() }))
    .output(z.array(McpDiscoveredToolSchema))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const tools = await McpClientEngine.discoverTools(input.server_id_uuid, tenantId);
      return tools.map(normalizeDiscoveredToolRow);
    }),

  listDiscoveredTools: protectedProcedure
    .input(
      z.object({
        server_id_uuid: z.string().uuid().optional(),
        category: z.string().optional()
      }).optional()
    )
    .output(z.array(McpDiscoveredToolSchema))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const serverId = input?.server_id_uuid;
      const category = input?.category;

      if (isUsingFallback) {
        let tools = fallbackStore.mcp_discovered_tools || [];
        tools = tools.filter((t) => t.tenant_id === tenantId || t.tenant_id === "1");
        if (serverId) tools = tools.filter((t) => t.server_id_uuid === serverId);
        if (category) tools = tools.filter((t) => t.category === category);
        return tools.map(normalizeDiscoveredToolRow);
      }

      const conditions: string[] = ["(tenant_id = $1 OR tenant_id = '1')"];
      const values: unknown[] = [tenantId];
      let pIdx = 2;

      if (serverId) {
        conditions.push(`server_id_uuid = $${pIdx}`);
        values.push(serverId);
        pIdx++;
      }

      if (category) {
        conditions.push(`category = $${pIdx}`);
        values.push(category);
        pIdx++;
      }

      const res = await pool.query(
        `SELECT * FROM sys_mcp_discovered_tools WHERE ${conditions.join(" AND ")} ORDER BY normalized_tool_name ASC`,
        values
      );

      return res.rows.map(normalizeDiscoveredToolRow);
    }),

  toggleToolState: protectedProcedure
    .input(
      z.object({
        id_uuid: z.string().uuid(),
        is_enabled_for_louis: z.boolean().optional(),
        is_enabled_for_ui: z.boolean().optional()
      })
    )
    .output(McpDiscoveredToolSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const { id_uuid, is_enabled_for_louis, is_enabled_for_ui } = input;

      if (isUsingFallback) {
        const tool = fallbackStore.mcp_discovered_tools?.find((t) => t.id_uuid === id_uuid);
        if (!tool) throw new Error(`Discovered tool ${id_uuid} not found`);
        if (is_enabled_for_louis !== undefined) tool.is_enabled_for_louis = is_enabled_for_louis;
        if (is_enabled_for_ui !== undefined) tool.is_enabled_for_ui = is_enabled_for_ui;
        saveFallbackStore();
        return normalizeDiscoveredToolRow(tool);
      }

      const updates: string[] = [];
      const values: unknown[] = [id_uuid, tenantId];
      let idx = 3;

      if (is_enabled_for_louis !== undefined) {
        updates.push(`is_enabled_for_louis = $${idx}`);
        values.push(is_enabled_for_louis);
        idx++;
      }

      if (is_enabled_for_ui !== undefined) {
        updates.push(`is_enabled_for_ui = $${idx}`);
        values.push(is_enabled_for_ui);
        idx++;
      }

      if (updates.length === 0) {
        const cur = await pool.query(`SELECT * FROM sys_mcp_discovered_tools WHERE id_uuid = $1`, [id_uuid]);
        return normalizeDiscoveredToolRow(cur.rows[0]);
      }

      const res = await pool.query(
        `UPDATE sys_mcp_discovered_tools SET ${updates.join(", ")} 
         WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') RETURNING *`,
        values
      );

      if (res.rows.length === 0) throw new Error(`Discovered tool ${id_uuid} not found`);
      return normalizeDiscoveredToolRow(res.rows[0]);
    }),

  executeTool: protectedProcedure
    .input(McpToolExecutionInputSchema)
    .output(McpToolExecutionResultSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      return await McpClientEngine.executeTool(input, tenantId);
    }),

  getPresetsCatalog: protectedProcedure
    .output(z.array(mcpPresetDefinitionSchema))
    .query(async () => {
      return MCP_PRESETS_CATALOG;
    }),

  // C.4 (Plan 2026-08-19): Genehmigungs-Queue — NUR Admin (adminProcedure erzwingt Rolle)
  listMcpApprovalRequests: adminProcedure
    .output(z.array(McpApprovalRequestSchema))
    .query(async ({ ctx }) => {
      return listMcpApprovalRequests(ctx.tenantId);
    }),

  decideMcpApprovalRequest: adminProcedure
    .input(
      z.object({
        id_uuid: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        comment: z.string().max(500).optional()
      })
    )
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const sessionUser = ctx.session?.user as { email?: string; id?: string } | undefined;
      const decidedBy = sessionUser?.email || sessionUser?.id || "admin";
      const rec = await decideMcpApprovalRequest(input.id_uuid, input.decision, ctx.tenantId, decidedBy, input.comment);
      if (!rec) {
        return { success: false, message: "Freigabe-Anfrage nicht gefunden oder bereits entschieden" };
      }
      return { success: true, message: input.decision === "approve" ? "Freigabe erteilt" : "Freigabe abgelehnt" };
    }),

  // --- C.7 (Plan 2026-08-19): Chatprofile -------------------------------------

  listChatProfiles: protectedProcedure
    .output(z.array(McpChatProfileSchema))
    .query(async ({ ctx }) => {
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "";
      return listChatProfiles(ctx.tenantId, userId);
    }),

  createChatProfile: protectedProcedure
    .input(
      z.object({
        profile_name: z.string().min(1).max(60),
        description: z.string().max(500).optional(),
        tools: z.array(z.string()).max(500).optional(),
        team_wide: z.boolean().default(false)
      })
    )
    .output(McpChatProfileSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.team_wide && ctx.session?.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Team-weite Chatprofile darf nur der Admin anlegen." });
      }
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "user";
      return createChatProfile(ctx.tenantId, userId, input);
    }),

  updateChatProfile: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid(), description: z.string().max(500).nullable().optional(), tools: z.array(z.string()).max(500).nullable().optional() }))
    .output(McpChatProfileSchema.nullable())
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id || "admin";
      return updateChatProfile(ctx.tenantId, input.id_uuid, userId, { description: input.description ?? undefined, tools: input.tools ?? undefined });
    }),

  deleteChatProfile: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "user";
      const ok = await deleteChatProfile(ctx.tenantId, input.id_uuid, userId);
      if (!ok) throw new TRPCError({ code: "FORBIDDEN", message: "Profil nicht gefunden, ist das System-Profil oder gehört Ihnen nicht." });
      return { success: true };
    }),

  setDefaultChatProfile: adminProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      return { success: await setDefaultChatProfile(ctx.tenantId, input.id_uuid) };
    }),

  switchSessionProfile: protectedProcedure
    .input(z.object({ session_id: z.string().uuid(), profile_id: z.string().uuid() }))
    .output(z.object({ success: z.boolean(), error: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      // 2026-08-19: Nach Session-Rotation (Kompression) kennt die UI nur die ELTERN-ID —
      // ohne Auflösung findet der Server die Session nicht → stiller Fehler → „Switch geht nicht"
      const resolved = await resolveRotatedSessionId(ctx.tenantId, input.session_id);
      return switchSessionProfile(ctx.tenantId, resolved ?? input.session_id, input.profile_id);
    }),

  setSessionToolOverride: protectedProcedure
    .input(z.object({ session_id: z.string().uuid(), tools: z.array(z.string()).nullable() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      // 2026-08-19: Session-Rotation auflösen (siehe switchSessionProfile)
      const resolved = await resolveRotatedSessionId(ctx.tenantId, input.session_id);
      return { success: await setSessionToolOverride(ctx.tenantId, resolved ?? input.session_id, input.tools) };
    }),

  getSessionProfileInfo: protectedProcedure
    .input(z.object({ session_id: z.string().uuid() }))
    .output(z.object({ profile_id: z.string().nullable(), override_tools: z.array(z.string()).nullable() }))
    .query(async ({ input, ctx }) => {
      const info = await getSessionProfile(ctx.tenantId, input.session_id);
      return { profile_id: info?.profileId || null, override_tools: info?.overrideTools || null };
    }),

  installPreset: protectedProcedure
    .input(installMcpPresetInputSchema)
    .output(z.object({ success: z.boolean(), serverId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const preset = MCP_PRESETS_CATALOG.find((p) => p.id === input.presetId);
      if (!preset) {
        throw new Error(`MCP Preset with ID '${input.presetId}' not found`);
      }

      const interpolated = interpolatePresetConfig(preset, input.fieldValues);
      const serverId = uuidv4();
      const now = new Date().toISOString();

      // Auth-Token aus den Preset-Feldern ableiten (2026-08-16): bearer/basic/api_key brauchen
      // den Token (z. B. Obsidian Local REST API Key) — vorher wurde er nie gesetzt.
      const fieldValues = input.fieldValues || {};
      const authToken =
        typeof fieldValues.auth_token === "string" && fieldValues.auth_token
          ? fieldValues.auth_token
          : (typeof fieldValues.OBSIDIAN_API_KEY === "string" && fieldValues.OBSIDIAN_API_KEY
              ? fieldValues.OBSIDIAN_API_KEY
              : typeof fieldValues.API_KEY === "string" && fieldValues.API_KEY
                ? fieldValues.API_KEY
                : null);

      const envVarsWithPreset: Record<string, string> = {
        ...(interpolated.env || {}),
        __preset_id: preset.id
      };

      const newServer: McpExternalServer = {
        id_uuid: serverId,
        tenant_id: tenantId,
        server_name: input.displayName,
        description: preset.description,
        transport_type: preset.transportType,
        endpoint_or_command: interpolated.url || interpolated.command || "npx",
        command_args: interpolated.args || [],
        env_vars: envVarsWithPreset,
        headers: {},
        auth_type: preset.authType === "oauth2" ? "oauth2" : (preset.authType === "api_key" || preset.authType === "bearer" || preset.authType === "basic") ? preset.authType : "none",
        // 2026-08-17: "Bearer " / "Basic "-Präfix auch beim Preset-Install entfernen
        auth_token_encrypted: normalizeAuthToken(authToken),
        is_active: true,
        health_status: "unknown",
        last_ping_at: null,
        last_error_message: null,
        created_at: now,
        updated_at: now
      };

      if (isUsingFallback) {
        if (!fallbackStore.mcp_external_servers) fallbackStore.mcp_external_servers = [];
        fallbackStore.mcp_external_servers.push(newServer);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_mcp_external_servers (
            id_uuid, tenant_id, server_name, description, transport_type, endpoint_or_command,
            command_args, env_vars, headers, auth_type, auth_token_encrypted, is_active,
            health_status, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            serverId,
            tenantId,
            newServer.server_name,
            newServer.description,
            newServer.transport_type,
            newServer.endpoint_or_command,
            JSON.stringify(newServer.command_args),
            JSON.stringify(newServer.env_vars),
            JSON.stringify(newServer.headers),
            newServer.auth_type,
            newServer.auth_token_encrypted,
            newServer.is_active
          ]
        );
      }

      if (input.autoConnect && preset.authType !== 'oauth2') {
        McpClientEngine.pingServer(newServer)
          .then(() => McpClientEngine.discoverTools(serverId, tenantId))
          .catch((err) => console.warn(`[MCP Preset] Auto-connect error for server ${serverId}:`, err));
      }

      return { success: true, serverId };
    }),

  initiateOAuth: protectedProcedure
    .input(initiateMcpOAuthInputSchema)
    .output(z.object({ authUrl: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const { serverId, provider, redirectUri } = input;

      let clientId = process.env.GOOGLE_CLIENT_ID || "";
      let presetId: string | undefined = undefined;
      if (isUsingFallback) {
        const s = fallbackStore.mcp_external_servers?.find((srv) => srv.id_uuid === serverId);
        if (s?.env_vars?.GOOGLE_CLIENT_ID) clientId = s.env_vars.GOOGLE_CLIENT_ID;
        if (s?.env_vars?.__preset_id) presetId = s.env_vars.__preset_id;
      } else {
        const res = await pool.query(
          `SELECT env_vars FROM sys_mcp_external_servers WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
          [serverId, tenantId]
        );
        if (res.rows.length > 0) {
          const envs = cleanDbRow(res.rows[0]).env_vars;
          if (envs?.GOOGLE_CLIENT_ID) clientId = envs.GOOGLE_CLIENT_ID;
          if (envs?.__preset_id) presetId = envs.__preset_id;
        }
      }

      // (2026-08-20): requiredScopes des Presets an den OAuth-Flow
      // durchreichen — vorher fiel buildOAuthAuthUrl auf die readonly-Defaults
      // zurück (kein gmail.send/gmail.modify → Senden/Labels unmöglich).
      // Abwärtskompatibel: kein Preset/keine Scopes → bisheriges Verhalten.
      let scopes: string[] = [];
      if (presetId) {
        const preset = MCP_PRESETS_CATALOG.find((p) => p.id === presetId);
        if (preset?.requiredScopes && preset.requiredScopes.length > 0) {
          scopes = preset.requiredScopes;
        }
      }

      const stateObj = { tenantId, serverId, provider, redirectUri };
      const state = Buffer.from(JSON.stringify(stateObj)).toString("base64");

      const authUrl = buildOAuthAuthUrl(provider, clientId, redirectUri, state, scopes);
      return { authUrl };
    })
});
