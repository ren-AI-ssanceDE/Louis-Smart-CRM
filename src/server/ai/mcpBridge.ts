import { pool, isUsingFallback, fallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { McpDiscoveredTool } from "../../types.js";
import { McpClientEngine } from "../mcp/mcpClientEngine.js";

/**
 * Fetch all discovered MCP tools enabled for Louis AI
 */
export async function getActiveLouisMcpTools(tenantId: string = "1"): Promise<McpDiscoveredTool[]> {
  if (isUsingFallback) {
    const list = fallbackStore.mcp_discovered_tools || [];
    return list.filter(
      (t) => (t.tenant_id === tenantId || t.tenant_id === "1") && t.is_enabled_for_louis
    );
  }

  try {
    const res = await pool.query(
      `SELECT t.* 
       FROM sys_mcp_discovered_tools t
       JOIN sys_mcp_external_servers s ON t.server_id_uuid = s.id_uuid
       WHERE (t.tenant_id = $1 OR t.tenant_id = '1')
         AND t.is_enabled_for_louis = true
         AND s.is_active = true`,
      [tenantId]
    );
    return res.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r))) as McpDiscoveredTool[];
  } catch (err) {
    console.error("Failed to fetch active Louis MCP tools:", err);
    return [];
  }
}

/**
 * Execute an external MCP tool by normalized tool name
 */
export async function executeMcpBridgeTool(
  normalizedToolName: string,
  rawQueryOrArgs: string | Record<string, unknown>,
  tenantId: string = "1"
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  meta?: {
    toolName: string;
    serverName?: string;
    timestamp: string;
  };
}> {
  let parsedArgs: Record<string, unknown> = {};

  if (typeof rawQueryOrArgs === "string") {
    try {
      parsedArgs = JSON.parse(rawQueryOrArgs);
    } catch {
      parsedArgs = { query: rawQueryOrArgs, search: rawQueryOrArgs, input: rawQueryOrArgs };
    }
  } else if (typeof rawQueryOrArgs === "object" && rawQueryOrArgs !== null) {
    parsedArgs = rawQueryOrArgs;
  }

  const result = await McpClientEngine.executeTool(
    {
      normalized_tool_name: normalizedToolName,
      arguments: parsedArgs
    },
    tenantId
  );

  if (!result.success) {
    return {
      success: false,
      error: result.error || "Execution failed",
      meta: {
        toolName: normalizedToolName,
        serverName: result.server_name,
        timestamp: new Date().toISOString()
      }
    };
  }

  return {
    success: true,
    data: result.result,
    meta: {
      toolName: normalizedToolName,
      serverName: result.server_name,
      timestamp: new Date().toISOString()
    }
  };
}
