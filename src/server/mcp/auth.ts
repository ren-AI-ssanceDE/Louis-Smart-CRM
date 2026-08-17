import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";
import { getSession } from "@auth/express";
import { authConfig } from "../auth.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue, FallbackStoreMcpApiKey } from "../db.js";
import { McpApiKey, McpApiKeyScopeSchema } from "../../lib/schemas.js";

export interface McpContext {
  tenantId: string;
  userId: string;
  keyInfo: McpApiKey;
}

export interface McpAuthenticatedRequest extends Request {
  mcpContext?: McpContext;
}

export function hashMcpKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function normalizeMcpApiKey(rawRow: unknown): McpApiKey {
  if (!rawRow || typeof rawRow !== "object") return rawRow as unknown as McpApiKey;
  const cleaned = cleanDbRow(rawRow as Record<string, unknown>) as Record<string, unknown>;

  // Parse & normalize scopes (handles PostgreSQL string representation like '{"read","write"}' or arrays with whitespace)
  let scopes: string[] = [];
  if (Array.isArray(cleaned.scopes)) {
    scopes = cleaned.scopes.map((s: unknown) => String(s).trim()).filter(Boolean);
  } else if (typeof cleaned.scopes === "string") {
    scopes = cleaned.scopes
      .replace(/^\{|\}$/g, "")
      .split(",")
      .map((s: string) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  }

  const validScopeValues = [
    "read",
    "write",
    "invoices",
    "contacts",
    "companies",
    "offers",
    "kanban",
    "vault",
    "council",
    "admin",
    "full_access"
  ];

  const filteredScopes = scopes.filter((s) => validScopeValues.includes(s));
  cleaned.scopes = filteredScopes.length > 0 ? filteredScopes : ["read", "write", "admin"];

  cleaned.is_active = Boolean(cleaned.is_active ?? true);
  
  if (cleaned.created_at) {
    cleaned.created_at = cleaned.created_at instanceof Date ? cleaned.created_at.toISOString() : String(cleaned.created_at);
  } else {
    cleaned.created_at = new Date().toISOString();
  }

  if (cleaned.updated_at) {
    cleaned.updated_at = cleaned.updated_at instanceof Date ? cleaned.updated_at.toISOString() : String(cleaned.updated_at);
  } else {
    cleaned.updated_at = new Date().toISOString();
  }

  if (cleaned.last_used_at) {
    cleaned.last_used_at = cleaned.last_used_at instanceof Date ? cleaned.last_used_at.toISOString() : String(cleaned.last_used_at);
  }

  if (cleaned.expires_at) {
    cleaned.expires_at = cleaned.expires_at instanceof Date ? cleaned.expires_at.toISOString() : String(cleaned.expires_at);
  }

  return cleanLigatureHacksFromValue(cleaned) as unknown as McpApiKey;
}

export async function generateMcpApiKey(params: {
  key_name: string;
  scopes: string[];
  expires_in_days?: number | null;
  tenant_id?: string;
  user_id?: string;
}): Promise<{ api_key: string; key_info: McpApiKey }> {
  const tenantId = params.tenant_id || "1";
  const userId = params.user_id || "admin";
  const idUuid = uuidv4();

  // Format: louis_mcp_live_<32 hex chars>
  const randomHex = crypto.randomBytes(16).toString("hex");
  const rawKey = `louis_mcp_live_${randomHex}`;
  const keyPrefix = `louis_mcp_live_${randomHex.substring(0, 8)}`;
  const keyHash = hashMcpKey(rawKey);

  const now = new Date().toISOString();
  let expiresAt: string | null = null;
  if (params.expires_in_days && params.expires_in_days > 0) {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + params.expires_in_days);
    expiresAt = expDate.toISOString();
  }

  const validScopes = params.scopes.filter((s) =>
    McpApiKeyScopeSchema.safeParse(s).success
  );

  if (isUsingFallback) {
    const newRecord: FallbackStoreMcpApiKey = {
      id_uuid: idUuid,
      tenant_id: tenantId,
      key_name: params.key_name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: validScopes.length > 0 ? validScopes : ["read", "write", "admin"],
      is_active: true,
      last_used_at: null,
      expires_at: expiresAt,
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
    };

    if (!fallbackStore.mcp_api_keys) {
      fallbackStore.mcp_api_keys = [];
    }
    fallbackStore.mcp_api_keys.push(newRecord);
    saveFallbackStore();

    const cleaned = normalizeMcpApiKey(newRecord);
    return {
      api_key: rawKey,
      key_info: cleaned,
    };
  } else {
    const query = `
      INSERT INTO mcp_api_keys (
        id_uuid, tenant_id, key_name, key_hash, key_prefix, scopes,
        is_active, last_used_at, expires_at, created_by_user_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, true, null, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `;

    const res = await pool.query(query, [
      idUuid,
      tenantId,
      params.key_name,
      keyHash,
      keyPrefix,
      validScopes.length > 0 ? validScopes : ["read", "write", "admin"],
      expiresAt,
      userId,
    ]);

    const cleaned = normalizeMcpApiKey(res.rows[0]);
    return {
      api_key: rawKey,
      key_info: cleaned,
    };
  }
}

export async function validateMcpApiKey(rawKey: string): Promise<McpApiKey | null> {
  if (!rawKey || !rawKey.startsWith("louis_mcp_")) {
    return null;
  }

  const hash = hashMcpKey(rawKey);
  const nowIso = new Date().toISOString();

  if (isUsingFallback) {
    if (!fallbackStore.mcp_api_keys) return null;
    const keyRecord = fallbackStore.mcp_api_keys.find(
      (k) => k.key_hash === hash && k.is_active
    );

    if (!keyRecord) return null;

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return null;
    }

    keyRecord.last_used_at = nowIso;
    saveFallbackStore();

    return normalizeMcpApiKey(keyRecord);
  } else {
    const res = await pool.query(
      `SELECT * FROM mcp_api_keys WHERE key_hash = $1 AND is_active = true`,
      [hash]
    );

    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return null;
    }

    // Async update last_used_at
    pool
      .query(
        `UPDATE mcp_api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id_uuid = $1`,
        [row.id_uuid]
      )
      .catch((err) => console.warn("[MCP Auth] Error updating last_used_at:", err));

    return normalizeMcpApiKey(row);
  }
}

export async function listMcpApiKeys(tenantId: string): Promise<McpApiKey[]> {
  const tId = tenantId || "1";

  if (isUsingFallback) {
    // Auftrag 016 P1-1: auch widerrufene Keys listen (is_active=false) — sonst verschwinden sie aus der Historie
    const keys = (fallbackStore.mcp_api_keys || []).filter(
      (k) => k.tenant_id === tId || k.tenant_id === "1"
    );
    return keys.map((k) => normalizeMcpApiKey(k));
  } else {
    // Auftrag 016 P1-1: Filter auf aktive Keys entfernt — widerrufene (is_active=false) bleiben sichtbar (Historie, Inaktiv-Badge)
    const res = await pool.query(
      `SELECT * FROM mcp_api_keys WHERE (tenant_id = $1 OR tenant_id = '1') ORDER BY created_at DESC`,
      [tId]
    );
    return res.rows.map((r) => normalizeMcpApiKey(r));
  }
}

export async function revokeMcpApiKey(idUuid: string, tenantId: string): Promise<boolean> {
  const tId = tenantId || "1";
  const nowIso = new Date().toISOString();

  if (isUsingFallback) {
    if (!fallbackStore.mcp_api_keys) return false;
    const keyRecord = fallbackStore.mcp_api_keys.find(
      (k) => k.id_uuid === idUuid && (k.tenant_id === tId || k.tenant_id === "1")
    );
    if (!keyRecord) return false;
    keyRecord.is_active = false;
    keyRecord.updated_at = nowIso;
    saveFallbackStore();
    return true;
  } else {
    const res = await pool.query(
      `UPDATE mcp_api_keys SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [idUuid, tId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export async function deleteMcpApiKey(idUuid: string, tenantId: string): Promise<boolean> {
  const tId = tenantId || "1";

  if (isUsingFallback) {
    if (!fallbackStore.mcp_api_keys) return false;
    const initialLen = fallbackStore.mcp_api_keys.length;
    fallbackStore.mcp_api_keys = fallbackStore.mcp_api_keys.filter(
      (k) => !(k.id_uuid === idUuid && (k.tenant_id === tId || k.tenant_id === "1"))
    );
    saveFallbackStore();
    return fallbackStore.mcp_api_keys.length < initialLen;
  } else {
    const res = await pool.query(
      `DELETE FROM mcp_api_keys WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [idUuid, tId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}

export async function mcpAuthMiddleware(
  req: McpAuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  let rawKey: string | undefined;

  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    rawKey = authHeader.substring(7).trim();
  } else if (typeof req.query.api_key === "string") {
    rawKey = req.query.api_key;
  }

  if (!rawKey) {
    try {
      const sessionRes = await getSession(req, authConfig);
      const user = sessionRes?.user as { id?: string; tenant_id?: string; email?: string } | undefined;
      if (user) {
        req.mcpContext = {
          tenantId: user.tenant_id || "1",
          userId: user.id || user.email || "session_user",
          keyInfo: {
            id_uuid: "session_key",
            tenant_id: user.tenant_id || "1",
            key_name: "Session Key",
            key_hash: "",
            key_prefix: "",
            scopes: ["read", "write", "admin", "full_access"],
            is_active: true,
            last_used_at: new Date().toISOString(),
            expires_at: null,
            created_by_user_id: user.id || "session_user",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        };
        return next();
      }
    } catch (err) {
      console.warn("[MCP Auth] Session lookup error:", err);
    }

    res.status(401).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Unauthorized: Missing Authorization Bearer token, api_key parameter, or active session",
      },
    });
    return;
  }

  const keyInfo = await validateMcpApiKey(rawKey);

  if (!keyInfo) {
    res.status(401).json({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Unauthorized: Invalid or expired MCP API Key",
      },
    });
    return;
  }

  req.mcpContext = {
    tenantId: keyInfo.tenant_id || "1",
    userId: keyInfo.created_by_user_id || "mcp_agent",
    keyInfo,
  };

  next();
}
