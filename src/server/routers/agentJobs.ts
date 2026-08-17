// S7: Agentic Cron-Jobs — tRPC-Router (list/create/update/toggle/delete)
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, logAuditEvent, saveFallbackStore, cleanDbRow } from "../db.js";
import { AgentJobCreateSchema, AgentJobUpdateSchema, AgentJobFullSchema } from "../../lib/schemas.js";
import { AgentJob } from "../../types.js";
import { runAgentJobNow } from "../ai/workflowEngine.js";

// pg liefert DATE/TIMESTAMP-Spalten als Date-Objekte — Zod-Output (z.string()) verlangt ISO-Strings
function mapAgentJobDates(row: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["created_at_utc", "updated_at_utc", "last_run_at_utc"] as const) {
    if (row[key] !== undefined && row[key] !== null) {
      row[key] = row[key] instanceof Date ? (row[key] as Date).toISOString() : String(row[key]);
    }
  }
  return row;
}

export const agentJobsRouter = router({
  listAgentJobs: protectedProcedure
    .output(z.array(AgentJobFullSchema))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback || !pool) {
        return (fallbackStore.agentJobs || []).filter(
          (j: AgentJob) => j.tenant_id === tenantId || j.tenant_id === "1"
        );
      }
      const res = await pool.query(
        `SELECT * FROM sys_louis_ai_agent_jobs WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC`,
        [tenantId]
      );
      return res.rows.map((r: unknown) => {
        return mapAgentJobDates(cleanDbRow(r) as Record<string, unknown>) as unknown as z.infer<typeof AgentJobFullSchema>;
      });
    }),

  createAgentJob: adminProcedure
    .input(AgentJobCreateSchema)
    .output(AgentJobFullSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      const id = uuidv4();
      const now = new Date().toISOString();
      const record = {
        id_uuid: id,
        tenant_id: tenantId,
        job_name: input.job_name,
        job_prompt: input.job_prompt,
        schedule_type: input.schedule_type,
        schedule_time: input.schedule_time || null,
        schedule_weekday: input.schedule_weekday ?? null,
        deliver_to: input.deliver_to,
        deliver_target: input.deliver_target || null,
        is_active: input.is_active ?? true,
        job_type: input.job_type || "agent",
        script_path: input.script_path || null,
        allowed_domains: input.allowed_domains && input.allowed_domains.length > 0 ? input.allowed_domains : null,
        last_run_at_utc: null,
        created_at_utc: now,
        updated_at_utc: now
      };

      if (isUsingFallback || !pool) {
        if (!fallbackStore.agentJobs) fallbackStore.agentJobs = [];
        fallbackStore.agentJobs.push(record as unknown as AgentJob);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_louis_ai_agent_jobs (id_uuid, tenant_id, job_name, job_prompt, schedule_type, schedule_time, schedule_weekday, deliver_to, deliver_target, is_active, job_type, script_path, allowed_domains)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            id,
            tenantId,
            input.job_name,
            input.job_prompt,
            input.schedule_type,
            input.schedule_time || null,
            input.schedule_weekday ?? null,
            input.deliver_to,
            input.deliver_target || null,
            input.is_active ?? true,
            input.job_type || "agent",
            input.script_path || null,
            input.allowed_domains && input.allowed_domains.length > 0 ? JSON.stringify(input.allowed_domains) : null
          ]
        );
      }

      await logAuditEvent({
        tenantId,
        eventType: "AGENT_JOB",
        entityType: "agent_job",
        eventDetails: `create: ${input.job_name}`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });
      return cleanDbRow(record);
    }),

  updateAgentJob: adminProcedure
    .input(z.object({ id_uuid: z.string().min(1), data: AgentJobUpdateSchema }))
    .output(AgentJobFullSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      const d = input.data;
      if (isUsingFallback || !pool) {
        const job = (fallbackStore.agentJobs || []).find(
          (j: AgentJob) => j.id_uuid === input.id_uuid && (j.tenant_id === tenantId || j.tenant_id === "1")
        );
        if (!job) throw new Error("Agent-Job nicht gefunden");
        if (d.job_name !== undefined) job.job_name = d.job_name;
        if (d.job_prompt !== undefined) job.job_prompt = d.job_prompt;
        if (d.schedule_type !== undefined) job.schedule_type = d.schedule_type;
        if (d.schedule_time !== undefined) job.schedule_time = d.schedule_time;
        if (d.schedule_weekday !== undefined) job.schedule_weekday = d.schedule_weekday;
        if (d.deliver_to !== undefined) job.deliver_to = d.deliver_to;
        if (d.deliver_target !== undefined) job.deliver_target = d.deliver_target;
        if (d.is_active !== undefined) job.is_active = d.is_active;
        if (d.job_type !== undefined) job.job_type = d.job_type;
        if (d.script_path !== undefined) job.script_path = d.script_path;
        if (d.allowed_domains !== undefined) job.allowed_domains = d.allowed_domains && d.allowed_domains.length > 0 ? d.allowed_domains : null;
        job.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
        await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `update: ${job.job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
        return cleanDbRow(job);
      }
      const res = await pool.query(
        `SELECT * FROM sys_louis_ai_agent_jobs WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [input.id_uuid, tenantId]
      );
      if (res.rows.length === 0) throw new Error("Agent-Job nicht gefunden");
      const current = res.rows[0];
      const sets: string[] = [];
      const params: unknown[] = [];
      const push = (col: string, val: unknown) => {
        sets.push(`${col} = $${params.length + 1}`);
        params.push(val);
      };
      if (d.job_name !== undefined) push("job_name", d.job_name);
      if (d.job_prompt !== undefined) push("job_prompt", d.job_prompt);
      if (d.schedule_type !== undefined) push("schedule_type", d.schedule_type);
      if (d.schedule_time !== undefined) push("schedule_time", d.schedule_time);
      if (d.schedule_weekday !== undefined) push("schedule_weekday", d.schedule_weekday);
      if (d.deliver_to !== undefined) push("deliver_to", d.deliver_to);
      if (d.deliver_target !== undefined) push("deliver_target", d.deliver_target);
      if (d.is_active !== undefined) push("is_active", d.is_active);
      if (d.job_type !== undefined) push("job_type", d.job_type);
      if (d.script_path !== undefined) push("script_path", d.script_path);
      if (d.allowed_domains !== undefined) push("allowed_domains", JSON.stringify(d.allowed_domains && d.allowed_domains.length > 0 ? d.allowed_domains : null));
      params.push(new Date().toISOString(), input.id_uuid, tenantId);
      const updated = await pool.query(
        `UPDATE sys_louis_ai_agent_jobs SET ${sets.join(", ")}, updated_at_utc = $${sets.length + 1} WHERE id_uuid = $${sets.length + 2} AND (tenant_id = $${sets.length + 3} OR tenant_id = '1') RETURNING *`,
        params
      );
      const row = updated.rows[0];
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `update: ${row.job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
      return mapAgentJobDates(cleanDbRow(row) as Record<string, unknown>) as unknown as z.infer<typeof AgentJobFullSchema>;
    }),

  toggleAgentJob: adminProcedure
    .input(z.object({ id_uuid: z.string().min(1) }))
    .output(AgentJobFullSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback || !pool) {
        const job = (fallbackStore.agentJobs || []).find(
          (j: AgentJob) => j.id_uuid === input.id_uuid && (j.tenant_id === tenantId || j.tenant_id === "1")
        );
        if (!job) throw new Error("Agent-Job nicht gefunden");
        job.is_active = !job.is_active;
        job.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
        await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `toggle (${job.is_active ? "aktiv" : "pausiert"}): ${job.job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
        return cleanDbRow(job);
      }
      const res = await pool.query(
        `UPDATE sys_louis_ai_agent_jobs SET is_active = NOT is_active, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') RETURNING *`,
        [input.id_uuid, tenantId]
      );
      if (res.rows.length === 0) throw new Error("Agent-Job nicht gefunden");
      const row = res.rows[0];
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `toggle (${row.is_active ? "aktiv" : "pausiert"}): ${row.job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
      return mapAgentJobDates(cleanDbRow(row) as Record<string, unknown>) as unknown as z.infer<typeof AgentJobFullSchema>;
    }),

  deleteAgentJob: adminProcedure
    .input(z.object({ id_uuid: z.string().min(1) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback || !pool) {
        const idx = (fallbackStore.agentJobs || []).findIndex(
          (j: AgentJob) => j.id_uuid === input.id_uuid && (j.tenant_id === tenantId || j.tenant_id === "1")
        );
        if (idx === -1) throw new Error("Agent-Job nicht gefunden");
        const removed = fallbackStore.agentJobs.splice(idx, 1)[0];
        saveFallbackStore();
        await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `delete: ${removed.job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
        return { success: true };
      }
      const res = await pool.query(
        `DELETE FROM sys_louis_ai_agent_jobs WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') RETURNING job_name`,
        [input.id_uuid, tenantId]
      );
      if (res.rows.length === 0) throw new Error("Agent-Job nicht gefunden");
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `delete: ${res.rows[0].job_name}`, actorIdentity: ctx.session?.user?.email || "unknown" });
      return { success: true };
    }),

  // Auftrag 012 P1-3: runJobNow — Job sofort ausführen (Ad-hoc/Test), unabhängig vom Scheduler-Tick
  runJobNow: adminProcedure
    .input(z.object({ id_uuid: z.string().min(1) }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      const result = await runAgentJobNow(input.id_uuid, tenantId);
      return { success: result.success, message: result.message };
    })
});
