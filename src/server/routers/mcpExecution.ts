import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import {
  McpToolMappingSchema,
  McpDomainQueryInputSchema,
  McpToolExecutionResultSchema
} from "../../lib/schemas.js";
import { McpClientEngine } from "../mcp/mcpClientEngine.js";
import { McpToolMapping } from "../../types.js";

export const mcpExecutionRouter = router({
  executeDomainAction: protectedProcedure
    .input(McpDomainQueryInputSchema)
    .output(McpToolExecutionResultSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const result = await McpClientEngine.executeDomainMappedTool(
        input.domain,
        input.action,
        input.params,
        tenantId
      );

      if (!result) {
        return {
          success: false,
          result: null,
          error: `No active tool mapping found for domain '${input.domain}' and action '${input.action}'`,
          execution_time_ms: 0,
          server_name: "None"
        };
      }

      return result;
    }),

  listToolMappings: protectedProcedure
    .input(z.object({ domain: z.string().optional() }).optional())
    .output(z.array(McpToolMappingSchema))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const domain = input?.domain;

      if (isUsingFallback) {
        let list = fallbackStore.mcp_tool_mappings || [];
        list = list.filter((m) => m.tenant_id === tenantId || m.tenant_id === "1");
        if (domain) list = list.filter((m) => m.target_domain === domain);
        return list as z.infer<typeof McpToolMappingSchema>[];
      }

      const conditions: string[] = ["(tenant_id = $1 OR tenant_id = '1')"];
      const values: unknown[] = [tenantId];

      if (domain) {
        conditions.push("target_domain = $2");
        values.push(domain);
      }

      const res = await pool.query(
        `SELECT * FROM sys_mcp_tool_mappings WHERE ${conditions.join(" AND ")} ORDER BY target_domain ASC, action_type ASC`,
        values
      );

      return res.rows.map((row) => cleanLigatureHacksFromValue(cleanDbRow(row))) as z.infer<typeof McpToolMappingSchema>[];
    }),

  saveToolMapping: protectedProcedure
    .input(McpToolMappingSchema.omit({ id_uuid: true, created_at: true }))
    .output(McpToolMappingSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const idUuid = uuidv4();
      const now = new Date().toISOString();

      const newMapping: McpToolMapping = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        target_domain: input.target_domain,
        action_type: input.action_type,
        tool_id_uuid: input.tool_id_uuid,
        field_mappings: input.field_mappings || {},
        is_primary: input.is_primary ?? false,
        created_at: now
      };

      if (isUsingFallback) {
        if (!fallbackStore.mcp_tool_mappings) fallbackStore.mcp_tool_mappings = [];
        // Remove existing mapping for same domain & action if exists
        fallbackStore.mcp_tool_mappings = fallbackStore.mcp_tool_mappings.filter(
          (m) => !(m.target_domain === input.target_domain && m.action_type === input.action_type && m.tool_id_uuid === input.tool_id_uuid)
        );
        fallbackStore.mcp_tool_mappings.push(newMapping);
        saveFallbackStore();
        return newMapping;
      }

      const res = await pool.query(
        `INSERT INTO sys_mcp_tool_mappings (
          id_uuid, tenant_id, target_domain, action_type, tool_id_uuid, field_mappings, is_primary, created_at_utc
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, target_domain, action_type, tool_id_uuid) DO UPDATE SET
          field_mappings = EXCLUDED.field_mappings,
          is_primary = EXCLUDED.is_primary RETURNING *`,
        [
          idUuid,
          tenantId,
          input.target_domain,
          input.action_type,
          input.tool_id_uuid,
          JSON.stringify(input.field_mappings || {}),
          input.is_primary ?? false
        ]
      );

      return cleanLigatureHacksFromValue(cleanDbRow(res.rows[0])) as z.infer<typeof McpToolMappingSchema>;
    }),

  deleteToolMapping: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId || "1";
      const { id_uuid } = input;

      if (isUsingFallback) {
        if (fallbackStore.mcp_tool_mappings) {
          fallbackStore.mcp_tool_mappings = fallbackStore.mcp_tool_mappings.filter((m) => m.id_uuid !== id_uuid);
          saveFallbackStore();
        }
        return { success: true };
      }

      await pool.query(
        `DELETE FROM sys_mcp_tool_mappings WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [id_uuid, tenantId]
      );
      return { success: true };
    })
});
