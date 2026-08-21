import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import path from "path";
import { execFile } from "child_process";
import { workflowEventBus } from "./workflowEventBus.js";
import { workflowExecutor } from "./workflowExecutor.js";
import { getLearnedWorkflows } from "./tools.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent, pruneAuditLogs, pruneSessions } from "../db.js";
import { CustomWorkflow, WorkflowInstance, Invoice, InvoiceOverduePayload, AgentJob } from "../../types.js";
import { runLouisAiFlow } from "./orchestrator.js";
import { executeSendTelegramMessage } from "./tools/messaging.js";
// Auftrag 026 P1-1 (#29): Curator-Tick im Scheduler-Heartbeat
import { maybeRunCuratorTick } from "./skillCurator.js";

/**
 * Scans and restarts workflow instances that have been running for more than 10 minutes (orphaned during system crash/reboot)
 */
async function recoverOrphanedWorkflows() {
  const timeoutThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
  let orphanedInstances: WorkflowInstance[] = [];

  if (isUsingFallback) {
    orphanedInstances = (fallbackStore.workflowInstances || []).filter(
      (i: WorkflowInstance) => i.status === "RUNNING" && (!i.updated_at_utc || i.updated_at_utc <= timeoutThreshold)
    );
  } else {
    try {
      const res = await pool.query(
        "SELECT id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, created_at_utc, updated_at_utc FROM sys_louis_ai_workflow_instances WHERE status = 'RUNNING' AND updated_at_utc <= $1",
        [timeoutThreshold]
      );
      // Map JSON fields correctly for Postgres rows
      orphanedInstances = res.rows.map((row) => ({
        id_uuid: row.id_uuid,
        tenant_id: row.tenant_id,
        workflow_id: row.workflow_id,
        status: row.status,
        initial_payload: typeof row.initial_payload === "string" ? JSON.parse(row.initial_payload) : row.initial_payload,
        current_step_index: typeof row.current_step_index === "number" ? row.current_step_index : parseInt(row.current_step_index, 10) || 0,
        execution_log: typeof row.execution_log === "string" ? JSON.parse(row.execution_log) : (row.execution_log || []),
        execute_at_utc: row.execute_at_utc,
        created_at_utc: row.created_at_utc,
        updated_at_utc: row.updated_at_utc
      })) as WorkflowInstance[];
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[WorkflowRecovery] Fehler bei der Suche nach verwaisten Workflows:", errMsg);
      return;
    }
  }

  for (const inst of orphanedInstances) {
    try {
      console.log(`[WorkflowRecovery] ♻️ Reaktivierung abgebrochener Instanz: ${inst.id_uuid} bei Schritt ${inst.current_step_index}`);
      
      // Load corresponding workflow template configuration
      let wf: CustomWorkflow | null = null;
      if (isUsingFallback) {
        wf = (fallbackStore.customWorkflows || []).find((w: CustomWorkflow) => w.id_uuid === inst.workflow_id) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1", [inst.workflow_id]);
        if (res.rows.length > 0) {
          const row = res.rows[0];
          wf = {
            id_uuid: row.id_uuid,
            tenant_id: row.tenant_id,
            workflow_name: row.workflow_name,
            workflow_description: row.workflow_description,
            tool_chain_sequence: typeof row.tool_chain_sequence === "string" ? JSON.parse(row.tool_chain_sequence) : (row.tool_chain_sequence || []),
            trigger_type: row.trigger_type,
            trigger_config: typeof row.trigger_config === "string" ? JSON.parse(row.trigger_config) : row.trigger_config,
            is_active: row.is_active,
            direct_send_email: row.direct_send_email,
            created_at_utc: row.created_at_utc,
            updated_at_utc: row.updated_at_utc
          } as CustomWorkflow;
        }
      }

      if (!wf) {
        // Safe fallback: Template no longer exists -> Complete as FAILED
        inst.status = "FAILED";
        inst.execution_log.push({
          timestamp: new Date().toISOString(),
          step: "ERROR",
          details: "Systemabbruch bei Wiederherstellung: Workflow-Vorlage wurde gelöscht."
        });
        await workflowExecutor.saveInstance(inst);
        continue;
      }

      // Append recovery log entry
      inst.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "RECOVER",
        details: `System-Crash erkannt. Workflow wird automatisch ab Schritt ${inst.current_step_index + 1} fortgesetzt.`
      });
      inst.status = "RUNNING";
      await workflowExecutor.saveInstance(inst);

      // Async resume execution step from its index
      workflowExecutor.execute(wf, inst.initial_payload, inst.current_step_index || 0, inst.id_uuid).catch((execErr: unknown) => {
        const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
        console.error(`[WorkflowRecovery] Fehler beim Wiedereinsetzen von Instanz ${inst.id_uuid}:`, errMsg);
      });

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowRecovery] Fehler bei Wiederherstellung von Instanz ${inst.id_uuid}:`, errMsg);
    }
  }
}

async function checkOverdueInvoices() {
  const todayDateStr = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
  let pendingInvoices: Invoice[] = [];

  if (isUsingFallback) {
    pendingInvoices = (fallbackStore.invoices || []).filter(
      (inv: Invoice) => inv.payment_status === "issued" || (inv.payment_status as string) === "pending"
    ) as Invoice[];
  } else {
    try {
      const res = await pool.query(
        "SELECT * FROM fiscal_billing_invoices WHERE payment_status = 'issued' OR payment_status = 'pending'"
      );
      pendingInvoices = res.rows as Invoice[];
    } catch (err: unknown) {
      console.error("[WorkflowScheduler] Fehler beim Abfragen ausstehender Rechnungen:", err);
      return;
    }
  }

  for (const inv of pendingInvoices) {
    // Fix (2026-08-14): due_date ist eine DATE-Spalte → node-postgres liefert ein Date-Objekt
    // (Restore-Daten). Der alte Aufruf dueDate.split("T") crashte jeden Tick mit
    // "TypeError: dueDate.split is not a function". Gleicher Guard wie invoices.ts:114.
    const dueDateRaw: unknown = inv.due_date;
    if (!dueDateRaw) continue;

    const dueDateStr = dueDateRaw instanceof Date
      ? dueDateRaw.toISOString().split("T")[0]
      : String(dueDateRaw).split("T")[0];

    if (dueDateStr < todayDateStr) {
      // It is overdue!
      const id_uuid = inv.id_uuid;
      if (!id_uuid) continue;
      const tenantId = (inv as unknown as Record<string, unknown>).tenant_id as string || "1";
      const invoice_number = inv.invoice_number;
      
      const diffTime = new Date(todayDateStr).getTime() - new Date(dueDateStr).getTime();
      const days_overdue = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

      console.log(`[WorkflowScheduler] ⚠️ Rechnung ${invoice_number} ist überfällig (${days_overdue} Tage)!`);

      if (isUsingFallback) {
        const foundIdx = fallbackStore.invoices.findIndex((i: Invoice) => i.id_uuid === id_uuid);
        if (foundIdx !== -1) {
          fallbackStore.invoices[foundIdx].payment_status = "overdue";
          fallbackStore.invoices[foundIdx].updated_at_utc = new Date().toISOString();
        }
        saveFallbackStore();
      } else {
        try {
          await pool.query(
            "UPDATE fiscal_billing_invoices SET payment_status = 'overdue', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1",
            [id_uuid]
          );
        } catch (dbErr: unknown) {
          console.error(`[WorkflowScheduler] Fehler beim Aktualisieren der Rechnung ${id_uuid} auf overdue:`, dbErr);
          continue;
        }
      }

      // Log audit event
      try {
        await logAuditEvent({
          tenantId,
          eventType: "UPDATE",
          entityType: "INVOICE",
          entityId: id_uuid,
          eventDetails: `Rechnung ${invoice_number} automatisch als überfällig markiert (${days_overdue} Tage überfällig).`,
          actorIdentity: "system"
        });
      } catch (auditErr: unknown) {
        console.error("[WorkflowScheduler] Fehler beim Loggen des Audit-Events:", auditErr);
      }

      // Emit event
      const payload: InvoiceOverduePayload = {
        id_uuid,
        invoice_number,
        due_date: dueDateStr,
        days_overdue,
        total_gross_amount: typeof inv.total_gross_amount === "string" ? parseFloat(inv.total_gross_amount) : (inv.total_gross_amount || 0),
        payment_status: "overdue",
        associated_company_id: inv.associated_company_id || null,
        associated_contact_id: inv.associated_contact_id || null
      };

      workflowEventBus.emitEvent(tenantId, "invoice.overdue", payload);
    }
  }
}

/**
 * Auftrag 037 P2: Audit-Log-Retention-Prune — liest audit_retention_days aus der
 * Admin-Config (NULL = kein Auto-Prune, Regel 12) und prunt in Batches.
 * Fehlertolerant: nie werfen (Scheduler läuft weiter).
 */
async function pruneAuditLogsIfConfigured(): Promise<void> {
  try {
    // Config pro Tenant laden (getTenantAiConfig ist in orchestrator.ts; hier
    // direkt über die DB, um Zirkular-Importe zu vermeiden — nur die eine Spalte).
    let tenants: string[] = [];
    if (isUsingFallback || !pool) {
      tenants = ["1"];
    } else {
      const res = await pool.query(
        "SELECT DISTINCT tenant_id FROM sys_integrations_louis_ai_config WHERE audit_retention_days IS NOT NULL"
      );
      tenants = res.rows.map((r: { tenant_id: string }) => String(r.tenant_id));
    }
    for (const tenantId of tenants) {
      let retentionDays: number | null = null;
      if (isUsingFallback || !pool) {
        const cfg = (fallbackStore.louisAiConfig || []).find((c) => c.tenant_id === tenantId);
        retentionDays = cfg?.audit_retention_days ?? null;
      } else {
        const res = await pool.query(
          "SELECT audit_retention_days FROM sys_integrations_louis_ai_config WHERE tenant_id = $1",
          [tenantId]
        );
        retentionDays = res.rows.length > 0 ? (res.rows[0].audit_retention_days ?? null) : null;
      }
      if (!retentionDays || retentionDays <= 0) continue;
      const result = await pruneAuditLogs(tenantId, retentionDays);
      if (result.pruned > 0) {
        console.log(`[WorkflowScheduler] Audit-Log-Prune: ${result.pruned} Einträge (Tenant ${tenantId}, ${result.batches} Batches)`);
      }
    }
  } catch (err) {
    console.error("[WorkflowScheduler] pruneAuditLogsIfConfigured fehlgeschlagen:", err);
  }
}

/**
 * Auftrag 038 P2: Session-Retention-Prune — liest session_retention_days aus der
 * Admin-Config (NULL = kein Auto-Prune, Regel 12) und prunt inaktive Sessions
 * in Batches (Kinder werden verwaist). Fehlertolerant: nie werfen.
 */
async function pruneSessionsIfConfigured(): Promise<void> {
  try {
    let tenants: string[] = [];
    if (isUsingFallback || !pool) {
      tenants = ["1"];
    } else {
      const res = await pool.query(
        "SELECT DISTINCT tenant_id FROM sys_integrations_louis_ai_config WHERE session_retention_days IS NOT NULL"
      );
      tenants = res.rows.map((r: { tenant_id: string }) => String(r.tenant_id));
    }
    for (const tenantId of tenants) {
      let retentionDays: number | null = null;
      if (isUsingFallback || !pool) {
        const cfg = (fallbackStore.louisAiConfig || []).find((c) => c.tenant_id === tenantId);
        retentionDays = cfg?.session_retention_days ?? null;
      } else {
        const res = await pool.query(
          "SELECT session_retention_days FROM sys_integrations_louis_ai_config WHERE tenant_id = $1",
          [tenantId]
        );
        retentionDays = res.rows.length > 0 ? (res.rows[0].session_retention_days ?? null) : null;
      }
      if (!retentionDays || retentionDays <= 0) continue;
      const result = await pruneSessions(tenantId, retentionDays);
      if (result.pruned > 0) {
        console.log(`[WorkflowScheduler] Session-Prune: ${result.pruned} Sessions (Tenant ${tenantId}, ${result.batches} Batches, ${result.orphaned} verwaist)`);
      }
    }
  } catch (err) {
    console.error("[WorkflowScheduler] pruneSessionsIfConfigured fehlgeschlagen:", err);
  }
}

/**
 * Executes a background check for due delayed and periodic workflows.
 */
async function tickWorkflowScheduler() {
  const now = new Date().toISOString();
  
  try {
    // Check for overdue invoices automatically
    try {
      await checkOverdueInvoices();
    } catch (odErr: unknown) {
      console.error("[WorkflowScheduler] Fehler bei der Überprüfung überfälliger Rechnungen:", odErr);
    }

    // Auftrag 037 P2: Audit-Log-Retention-Prune (opt-in über audit_retention_days, NULL = kein Prune)
    try {
      await pruneAuditLogsIfConfigured();
    } catch (prErr: unknown) {
      console.error("[WorkflowScheduler] Fehler im Audit-Log-Prune:", prErr);
    }

    // Auftrag 038 P2: Session-Retention-Prune (opt-in über session_retention_days, NULL = kein Prune)
    try {
      await pruneSessionsIfConfigured();
    } catch (psErr: unknown) {
      console.error("[WorkflowScheduler] Fehler im Session-Prune:", psErr);
    }

    // 0. Recover crashed or rebooted dangling RUNNING workflows
    try {
      await recoverOrphanedWorkflows();
    } catch (recErr: unknown) {
      const errMsg = recErr instanceof Error ? recErr.message : String(recErr);
      console.error("[WorkflowScheduler] Fehler im recoverOrphanedWorkflows Zyklus:", errMsg);
    }

    // 1. Process Delayed Queue (PENDING_DELAY status)
    let pendingList: WorkflowInstance[] = [];
    if (isUsingFallback) {
      pendingList = (fallbackStore.workflowInstances || []).filter(
        i => i.status === "PENDING_DELAY" && i.execute_at_utc && i.execute_at_utc <= now
      );
    } else {
      try {
        const res = await pool.query(
          "SELECT * FROM sys_louis_ai_workflow_instances WHERE status = 'PENDING_DELAY' AND execute_at_utc <= $1",
          [now]
        );
        pendingList = res.rows as WorkflowInstance[];
      } catch (err) {
        console.warn("[WorkflowScheduler] Postgres query for delayed workflows failed, using fallback:", err);
        pendingList = (fallbackStore.workflowInstances || []).filter(
          i => i.status === "PENDING_DELAY" && i.execute_at_utc && i.execute_at_utc <= now
        );
      }
    }

    for (const inst of pendingList) {
      try {
        console.log(`[WorkflowScheduler] ⏰ Resolving fällige delayed workflow instance: ${inst.id_uuid}`);
        
        // Find corresponding custom workflow template
        let wf: CustomWorkflow | null = null;
        if (isUsingFallback) {
          wf = (fallbackStore.customWorkflows || []).find(w => w.id_uuid === inst.workflow_id) || null;
        } else {
          const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1", [inst.workflow_id]);
          if (res.rows.length > 0) {
            const row = res.rows[0];
            wf = {
              ...row,
              tool_chain_sequence: typeof row.tool_chain_sequence === "string" ? JSON.parse(row.tool_chain_sequence) : (row.tool_chain_sequence || []),
              trigger_config: typeof row.trigger_config === "string" ? JSON.parse(row.trigger_config) : row.trigger_config
            } as CustomWorkflow;
          }
        }

        if (!wf) {
          console.warn(`[WorkflowScheduler] Workflow configuration not found for scheduled instance: ${inst.id_uuid}`);
          inst.status = "FAILED";
          inst.execution_log.push({
            timestamp: new Date().toISOString(),
            step: "ERROR",
            details: "Workflow-Vorlage wurde gelöscht oder nicht gefunden."
          });
          await workflowExecutor.saveInstance(inst);
          continue;
        }

        // Update status to RUNNING to trigger immediate execution
        inst.status = "RUNNING";
        inst.execution_log.push({
          timestamp: new Date().toISOString(),
          step: "SCHEDULING",
          details: "Verzögerung beendet. Ausführung gestartet."
        });
        await workflowExecutor.saveInstance(inst);

        // Execute workflow asynchronously
        workflowExecutor.execute(wf, inst.initial_payload, inst.current_step_index || 0, inst.id_uuid).catch(err => {
          console.error(`[WorkflowScheduler] Error during execution:`, err);
        });

      } catch (err) {
        console.error(`[WorkflowScheduler] Error scheduling pending instance ${inst.id_uuid}:`, err);
      }
    }

    // 1b. Auftrag 008 4A T1-Nachtrag (A1): PENDING_QUESTION-Instanzen fortsetzen,
    // sobald die zugehörige Rückfrage im Dashboard beantwortet wurde.
    try {
      let questionPending: WorkflowInstance[] = [];
      if (isUsingFallback) {
        questionPending = (fallbackStore.workflowInstances || []).filter(i => i.status === "PENDING_QUESTION");
      } else {
        const qRes = await pool.query(
          "SELECT * FROM sys_louis_ai_workflow_instances WHERE status = 'PENDING_QUESTION'"
        );
        questionPending = qRes.rows.map((r) => ({
          ...r,
          execution_log: typeof r.execution_log === "string" ? JSON.parse(r.execution_log) : (r.execution_log || []),
          initial_payload: typeof r.initial_payload === "string" ? JSON.parse(r.initial_payload) : (r.initial_payload || null)
        })) as WorkflowInstance[];
      }

      for (const inst of questionPending) {
        const qId = inst.pending_question_id;
        if (!qId) continue;

        // Antwort der Rückfrage laden
        let answerText = "";
        if (isUsingFallback) {
          const q = (fallbackStore.aiQuestions || []).find((rec) => rec.id_uuid === qId);
          if (q && q.status === "ANSWERED") answerText = q.answer || "";
        } else {
          const aRes = await pool.query(
            "SELECT status, answer FROM sys_louis_ai_questions WHERE id_uuid = $1",
            [qId]
          );
          if (aRes.rows.length > 0 && aRes.rows[0].status === "ANSWERED") {
            answerText = aRes.rows[0].answer || "";
          }
        }
        if (!answerText) continue; // noch offen

        console.log(`[WorkflowScheduler] ✅ Rückfrage ${qId} beantwortet — setze Workflow ${inst.id_uuid} fort`);
        inst.status = "RUNNING";
        inst.pending_question_id = null;
        // Weiter NACH dem Frage-Schritt (current_step_index zeigt auf den ask_user_question-Schritt)
        const nextStep = (inst.current_step_index || 0) + 1;
        inst.current_step_index = nextStep;
        inst.execution_log.push({
          timestamp: new Date().toISOString(),
          step: "QUESTION_ANSWERED",
          details: `Rückfrage ${qId} beantwortet: ${answerText.slice(0, 300)}`
        });
        // Antwort ins Payload injizieren (für nachfolgende Schritte)
        inst.initial_payload = {
          ...(inst.initial_payload || {}),
          question_answer: answerText,
          question_id: qId
        };
        await workflowExecutor.saveInstance(inst);

        const wf = isUsingFallback
          ? (fallbackStore.customWorkflows || []).find(w => w.id_uuid === inst.workflow_id) || null
          : (() => {
              // Workflow-Vorlage laden (wie Delayed-Queue-Block)
              return null; // unten über pool neu geladen
            })();
        let wfReal: CustomWorkflow | null = wf;
        if (!wfReal && !isUsingFallback) {
          const wRes = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1", [inst.workflow_id]);
          if (wRes.rows.length > 0) {
            const row = wRes.rows[0];
            wfReal = {
              ...row,
              tool_chain_sequence: typeof row.tool_chain_sequence === "string" ? JSON.parse(row.tool_chain_sequence) : (row.tool_chain_sequence || []),
              trigger_config: typeof row.trigger_config === "string" ? JSON.parse(row.trigger_config) : row.trigger_config
            } as CustomWorkflow;
          }
        }
        if (!wfReal) {
          console.warn(`[WorkflowScheduler] Workflow-Vorlage nicht gefunden für Instanz ${inst.id_uuid}`);
          continue;
        }
        workflowExecutor.execute(wfReal, inst.initial_payload, inst.current_step_index || 0, inst.id_uuid).catch(err => {
          console.error(`[WorkflowScheduler] Fehler bei Fortsetzung ${inst.id_uuid}:`, err);
        });
      }
    } catch (qErr) {
      console.error("[WorkflowScheduler] Fehler beim PENDING_QUESTION-Resume:", qErr);
    }

    // 2. Process Timer Workflows (Frequenz: hourly or daily)
    let timerWorkflows: CustomWorkflow[] = [];
    if (isUsingFallback) {
      timerWorkflows = (fallbackStore.customWorkflows || []).filter(w => w.trigger_type === "TIMER" && w.is_active !== false);
    } else {
      try {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE trigger_type = 'TIMER' AND is_active = TRUE");
        timerWorkflows = res.rows.map((row) => ({
          ...row,
          tool_chain_sequence: typeof row.tool_chain_sequence === "string" ? JSON.parse(row.tool_chain_sequence) : (row.tool_chain_sequence || []),
          trigger_config: typeof row.trigger_config === "string" ? JSON.parse(row.trigger_config) : row.trigger_config
        })) as CustomWorkflow[];
      } catch (err) {
        console.warn("[WorkflowScheduler] Postgres query for TIMER workflows failed, using fallback:", err);
        timerWorkflows = (fallbackStore.customWorkflows || []).filter(w => w.trigger_type === "TIMER" && w.is_active !== false);
      }
    }

    interface TimerTriggerConfig {
      frequency?: string;
      time?: string;
      weekday?: string | number; // Auftrag 008 4A T3: Wochentag für weekly (1=Mo..7=So)
      cron?: string; // Auftrag 008 4A T3: 5-Felder-Cron-Expression (Minute Stunde Tag Monat Wochentag)
    }

    for (const wf of timerWorkflows) {
      try {
        const config = (wf.trigger_config || {}) as TimerTriggerConfig;
        const frequency = config.frequency || "daily"; // 'hourly', 'daily'
        const time = config.time || "08:30"; // e.g. "08:30"

        // S7: Last-Run-Marker kommt aus custom_workflows.last_run_at_utc (KEIN sys_louis_ai_user_memory-Missbrauch mehr)
        const lastRunMeta = (wf as CustomWorkflow & { last_run_at_utc?: string | null }).last_run_at_utc || null;

        const runTimerWorkflow = async () => {
          console.log(`[WorkflowScheduler] ⏰ Triggering TIMER workflow sequence "${wf.workflow_name}" (${wf.id_uuid})`);
          const nowStamp = new Date().toISOString();

          // Last-Run-Marker an custom_workflows.last_run_at_utc (beide Branches, NUR UPDATE — kein Memory-Eintrag)
          if (isUsingFallback) {
            const wfLocal = (fallbackStore.customWorkflows || []).find((w) => w.id_uuid === wf.id_uuid);
            if (wfLocal) {
              (wfLocal as CustomWorkflow & { last_run_at_utc?: string | null }).last_run_at_utc = nowStamp;
              saveFallbackStore();
            }
          } else {
            try {
              await pool.query(
                "UPDATE sys_louis_ai_custom_workflows SET last_run_at_utc = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2",
                [nowStamp, wf.id_uuid]
              );
            } catch (err) {
              console.error("[WorkflowScheduler] Failed to save last_run_at_utc in DB:", err);
            }
          }

          // Execute
          workflowExecutor.execute(wf, { triggered_at: nowStamp, periodic: true }).catch(err => {
            console.error(`[WorkflowScheduler] Timer execution error for workflow "${wf.workflow_name}":`, err);
          });
        };

        if (frequency === "hourly") {
          if (!lastRunMeta || (Date.now() - new Date(lastRunMeta).getTime() >= 3600 * 1000)) {
            await runTimerWorkflow();
          }
        } else if (frequency === "daily") {
          const todayDateStr = new Date().toISOString().split("T")[0]; // e.g. "2026-06-03"
          if (!lastRunMeta || !lastRunMeta.startsWith(todayDateStr)) {
            const [schHour, schMin] = time.split(":").map(Number);
            const currentHour = new Date().getHours();
            const currentMin = new Date().getMinutes();
            
            if (currentHour > schHour || (currentHour === schHour && currentMin >= schMin)) {
              await runTimerWorkflow();
            }
          }
        } else if (frequency === "weekly") {
          // Auftrag 008 4A T3: wöchentlich (wie Agent-Jobs: schedule_weekday 1=Mo..7=So)
          const weekday = Number(config.weekday) || 1;
          const todayDow = new Date().getDay() === 0 ? 7 : new Date().getDay();
          const todayDateStr = new Date().toISOString().split("T")[0];
          if (todayDow === weekday && (!lastRunMeta || !lastRunMeta.startsWith(todayDateStr))) {
            const [schHour, schMin] = time.split(":").map(Number);
            const currentHour = new Date().getHours();
            const currentMin = new Date().getMinutes();
            if (currentHour > schHour || (currentHour === schHour && currentMin >= schMin)) {
              await runTimerWorkflow();
            }
          }
        } else if (frequency === "cron" && config.cron) {
          // Auftrag 008 4A T3: 5-Felder-Cron (Minute Stunde Tag Monat Wochentag; Wochentag 0/7=So)
          const now = new Date();
          const minuteBucket = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
          if (!lastRunMeta || !lastRunMeta.startsWith(minuteBucket)) {
            if (cronMatches(config.cron, now)) {
              await runTimerWorkflow();
            }
          }
        }
      } catch (err) {
        console.error(`[WorkflowScheduler] Error evaluating Timer workflow "${wf.workflow_name}":`, err);
      }
    }

    // S7: Agentic Cron-Jobs — in EIGENEM try/catch (Job-Fehler dürfen Recovery/Delayed-Queue/Timer nicht abbrechen)
    try {
      await processAgentJobs();
    } catch (agentErr: unknown) {
      console.error("[WorkflowScheduler] Fehler im processAgentJobs Zyklus:", agentErr);
    }

  } catch (globalErr) {
    console.error("[WorkflowScheduler] Global tick process error:", globalErr);
  }
}

let isEngineInitialized = false;

// ============================================================================
// Auftrag 008 4A T3: 5-Felder-Cron-Matcher (Minute Stunde Tag Monat Wochentag)
// Unterstützt: "*", Zahlen, "*/n"-Schritte. Wochentag: 0/7 = Sonntag, 1=Mo..6=Sa.
// Reine Funktion, kein any (Regel 4) — testbar.
// ============================================================================
export function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minuteExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;
  const minute = date.getMinutes();
  const hour = date.getHours();
  const day = date.getDate();
  const month = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0=So..6=Sa

  const fieldMatches = (expr: string, value: number): boolean => {
    if (expr === "*") return true;
    // "*/n" — Schrittweite
    const stepMatch = expr.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      return step > 0 && value % step === 0;
    }
    // Zahlenliste "1,15" oder Einzelwert
    return expr.split(",").some((part) => {
      const n = parseInt(part.trim(), 10);
      return !isNaN(n) && n === value;
    });
  };

  const dowMatches = (expr: string): boolean => {
    if (expr === "*") return true;
    const stepMatch = expr.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[1], 10);
      return step > 0 && (dow === 0 ? 7 : dow) % step === 0;
    }
    return expr.split(",").some((part) => {
      const n = parseInt(part.trim(), 10);
      if (isNaN(n)) return false;
      // 0 und 7 = Sonntag
      return n === dow || (n === 0 && dow === 0) || (n === 7 && dow === 0);
    });
  };

  return (
    fieldMatches(minuteExpr, minute) &&
    fieldMatches(hourExpr, hour) &&
    fieldMatches(dayExpr, day) &&
    fieldMatches(monthExpr, month) &&
    dowMatches(dowExpr)
  );
}

// ============================================================================
// S7: Agentic Cron-Jobs (processAgentJobs)
// ============================================================================

// Re-Entrancy-Guard gegen Doppel-Feuern bei Tick-Überlappung
const runningAgentJobIds = new Set<string>();
let timerMarkerMigrationDone = false;

/** ISO-Woche (JJJJ-Www) für weekly-Fälligkeit */
function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
}

function isJobDue(job: AgentJob): boolean {
  const lastRun = job.last_run_at_utc ? new Date(job.last_run_at_utc) : null;
  const now = new Date();

  if (job.schedule_type === "hourly") {
    if (!lastRun) return true;
    return now.getTime() - lastRun.getTime() >= 3600 * 1000;
  }
  if (job.schedule_type === "daily") {
    const today = now.toISOString().split("T")[0];
    if (lastRun && lastRun.toISOString().startsWith(today)) return false;
    const [h, m] = String(job.schedule_time || "08:30").split(":").map(Number);
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  }
  if (job.schedule_type === "weekly") {
    if (lastRun && isoWeekOf(lastRun) === isoWeekOf(now)) return false;
    const weekday = job.schedule_weekday ?? 1; // 1=Mo … 7=So
    const jsDay = now.getDay() === 0 ? 7 : now.getDay();
    if (jsDay !== weekday) return false;
    const [h, m] = String(job.schedule_time || "08:30").split(":").map(Number);
    return now.getHours() > h || (now.getHours() === h && now.getMinutes() >= m);
  }
  return false;
}

async function updateAgentJobLastRun(jobId: string, tenantId: string): Promise<void> {
  if (isUsingFallback || !pool) {
    const j = (fallbackStore.agentJobs || []).find((x) => x.id_uuid === jobId);
    if (j) {
      j.last_run_at_utc = new Date().toISOString();
      saveFallbackStore();
    }
    return;
  }
  await pool.query(
    `UPDATE sys_louis_ai_agent_jobs SET last_run_at_utc = NOW(), updated_at_utc = NOW() WHERE id_uuid = $1 AND tenant_id = $2`,
    [jobId, tenantId]
  );
}

/**
 * S7-Migration (einmalig): TIMER-Last-Run-Marker aus sys_louis_ai_user_memory
 * (user_id-Muster last_run_<uuid>) nach custom_workflows.last_run_at_utc verschieben.
 * NUR UPDATE — Memory-Zeilen bleiben als Altlast stehen (werden vom Scheduler nicht mehr gelesen).
 */
async function migrateTimerLastRunMarkers(): Promise<void> {
  if (timerMarkerMigrationDone || isUsingFallback || !pool) return;
  timerMarkerMigrationDone = true;
  try {
    const res = await pool.query(`SELECT id_uuid, tenant_id FROM sys_louis_ai_custom_workflows WHERE trigger_type = 'TIMER'`);
    for (const wf of res.rows) {
      const key = `last_run_${wf.id_uuid}`;
      const memRes = await pool.query(
        `SELECT response_preferences_text FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
        [key, wf.tenant_id || "1"]
      );
      if (memRes.rows.length > 0) {
        const marker = String(memRes.rows[0].response_preferences_text || "");
        if (marker && !isNaN(new Date(marker).getTime())) {
          await pool.query(
            `UPDATE sys_louis_ai_custom_workflows SET last_run_at_utc = $1 WHERE id_uuid = $2`,
            [marker, wf.id_uuid]
          );
        }
      }
    }
    console.log("[WorkflowScheduler] S7-Migration der TIMER-Last-Run-Marker abgeschlossen.");
  } catch (err) {
    console.warn("[WorkflowScheduler] S7-Migration fehlgeschlagen (wird beim nächsten Start erneut versucht):", err);
  }
}

/**
 * S7: Verarbeitet fällige Agent-Jobs (sys_louis_ai_agent_jobs).
 * Job → runLouisAiFlow → Delivery (telegram / mail_draft / session).
 * last_run_at_utc wird NUR bei erfolgreicher Zustellung aktualisiert (Retry-Semantik).
 */
async function processAgentJobs(): Promise<void> {
  await migrateTimerLastRunMarkers();

  let jobs: AgentJob[] = [];
  if (isUsingFallback || !pool) {
    jobs = fallbackStore.agentJobs || [];
  } else {
    try {
      const res = await pool.query(
        `SELECT * FROM sys_louis_ai_agent_jobs WHERE is_active = TRUE AND (tenant_id = $1 OR tenant_id = '1')`,
        ["1"]
      );
      jobs = res.rows as AgentJob[];
    } catch (err) {
      console.warn("[processAgentJobs] Query fehlgeschlagen:", err);
      return;
    }
  }

  for (const job of jobs) {
    if (runningAgentJobIds.has(job.id_uuid)) continue; // Re-Entrancy-Guard
    if (!isJobDue(job)) continue;

    runningAgentJobIds.add(job.id_uuid);
    const tenantId = job.tenant_id || "1";
    try {
      // S11 Teil B: Watchdog-Cron — script/monitor-Jobs werden OHNE LLM verarbeitet (Hash-Diff-Semantik)
      const jobType = job.job_type || "agent";
      if (jobType === "script" || jobType === "monitor") {
        await processScriptOrMonitorJob(job, tenantId, jobType);
        continue;
      }

      const result = await runLouisAiFlow(tenantId, "agent_job", job.job_prompt, [], "de", "", [], job.allowed_domains || undefined);
      await deliverJobOutput(job, tenantId, result.replyText, false);

      // last_run_at_utc NUR bei erfolgreicher Zustellung
      await updateAgentJobLastRun(job.id_uuid, tenantId);
      console.log(`[processAgentJobs] Job "${job.job_name}" erfolgreich ausgeführt und zugestellt (${job.deliver_to}).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[processAgentJobs] Job "${job.job_name}" fehlgeschlagen:`, msg);
      try {
        await logAuditEvent({ tenantId, eventType: "AGENT_JOB_FAILED", entityType: "agent_job", eventDetails: `${job.job_name}: ${msg}`, actorIdentity: "scheduler" });
      } catch {
        // Audit-Fehler ignorieren — Retry-Semantik bleibt (last_run_at_utc unverändert)
      }
    } finally {
      runningAgentJobIds.delete(job.id_uuid);
    }
  }
}

// Auftrag 012 P1-3: runAgentJobNow — führt einen einzelnen Agent-Job sofort aus (Ad-hoc/Test),
// unabhängig vom Scheduler-Tick. Nutzt denselben Ausführungspfad wie processAgentJobs.
export async function runAgentJobNow(jobId: string, tenantId: string): Promise<{ success: boolean; message: string }> {
  if (runningAgentJobIds.has(jobId)) {
    return { success: false, message: "Job läuft bereits (Re-Entrancy-Guard)." };
  }
  let job: AgentJob | undefined;
  if (isUsingFallback || !pool) {
    job = (fallbackStore.agentJobs || []).find((j: AgentJob) => j.id_uuid === jobId && (j.tenant_id === tenantId || j.tenant_id === "1"));
  } else {
    try {
      const res = await pool.query(
        `SELECT * FROM sys_louis_ai_agent_jobs WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
        [jobId, tenantId]
      );
      job = res.rows[0] as AgentJob | undefined;
    } catch (err) {
      return { success: false, message: `Job konnte nicht geladen werden: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
  if (!job) return { success: false, message: "Agent-Job nicht gefunden." };

  runningAgentJobIds.add(jobId);
  try {
    const jobTenant = job.tenant_id || "1";
    const jobType = job.job_type || "agent";
    if (jobType === "script" || jobType === "monitor") {
      await processScriptOrMonitorJob(job, jobTenant, jobType);
    } else {
      const result = await runLouisAiFlow(jobTenant, "agent_job", job.job_prompt, [], "de", "", [], job.allowed_domains || undefined);
      await deliverJobOutput(job, jobTenant, result.replyText, false);
    }
    await updateAgentJobLastRun(job.id_uuid, jobTenant);
    await logAuditEvent({ tenantId: jobTenant, eventType: "AGENT_JOB", entityType: "agent_job", eventDetails: `run-now: ${job.job_name}`, actorIdentity: "manual" });
    return { success: true, message: `Job '${job.job_name}' wurde ausgeführt.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB_FAILED", entityType: "agent_job", eventDetails: `run-now ${job.job_name}: ${msg}`, actorIdentity: "manual" });
    } catch {
      // Audit-Fehler ignorieren
    }
    return { success: false, message: `Job '${job.job_name}' fehlgeschlagen: ${msg}` };
  } finally {
    runningAgentJobIds.delete(jobId);
  }
}

// S11 Teil B: Skript-Ausführung (Interpreter-Mapping nach Endung, 60s Timeout)
async function runAgentJobScript(job: AgentJob): Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }> {
  const scriptsDir = process.env.LOUIS_AI_SCRIPTS_DIR || path.join(process.cwd(), "data", "louis_ai_scripts");
  const scriptPath = job.script_path || "";
  const fullPath = path.isAbsolute(scriptPath) ? scriptPath : path.join(scriptsDir, scriptPath);
  const ext = path.extname(fullPath).toLowerCase();
  let interpreter = "";
  if ([".mjs", ".js", ".cjs"].includes(ext)) interpreter = "node";
  else if ([".sh", ".bash"].includes(ext)) interpreter = "bash";
  else if (ext === ".py") interpreter = "python3";
  if (!interpreter) throw new Error(`Nicht unterstützte Skript-Endung '${ext || '(keine)'}' für ${fullPath}`);
  return new Promise((resolve) => {
    execFile(interpreter, [fullPath], { timeout: 60000, cwd: scriptsDir, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) {
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), code: 0, timedOut: false });
        return;
      }
      const errCode = (err as NodeJS.ErrnoException).code;
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        code: typeof errCode === "number" ? errCode : null,
        timedOut: errCode === "ETIMEDOUT"
      });
    });
  });
}

// S11 Teil B: Script-/Monitor-Job-Verarbeitung (OHNE LLM; Agent-Lauf nur bei CHANGE/Baseline)
async function processScriptOrMonitorJob(job: AgentJob, tenantId: string, jobType: "script" | "monitor"): Promise<void> {
  try {
    const run = await runAgentJobScript(job);
    if (run.timedOut || run.code !== 0) {
      const msg = `${run.timedOut ? "TIMEOUT" : `Exit ${run.code ?? "?"}`}: ${(run.stderr || run.stdout || "").slice(0, 300)}`;
      console.error(`[processAgentJobs] ${jobType}-Job "${job.job_name}" fehlgeschlagen:`, msg);
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB_FAILED", entityType: "agent_job", eventDetails: `${job.job_name}: ${msg}`, actorIdentity: "scheduler" });
      return; // kein last_run-Update → Retry im nächsten Tick
    }
    const stdout = run.stdout;

    if (jobType === "script") {
      // Klassischer Watchdog: stiller Erfolg bei leerem stdout; sonst Delivery
      if (stdout.trim().length === 0) {
        await updateAgentJobLastRun(job.id_uuid, tenantId);
        return;
      }
      await deliverJobOutput(job, tenantId, stdout, true);
      await updateAgentJobLastRun(job.id_uuid, tenantId);
      return;
    }

    // monitor: Baseline/CHANGED-Semantik (exakte Byte-Hashes)
    const hash = crypto.createHash("sha256").update(stdout).digest("hex");
    if (job.monitor_hash === null || job.monitor_hash === undefined) {
      // Erster Tick = Baseline: Agent-Lauf + Hash persistieren
      await runMonitorAgent(job, tenantId, `${job.job_prompt}\n\nMONITOR CHANGE DETECTED (Baseline)\n${stdout.slice(0, 2000)}`);
      await updateMonitorState(job.id_uuid, tenantId, hash, stdout);
      await updateAgentJobLastRun(job.id_uuid, tenantId);
      return;
    }
    if (hash === job.monitor_hash) {
      return; // UNCHANGED → still
    }
    // CHANGED: Agent-Lauf mit Diff; Hash erst NACH erfolgreichem Lauf aktualisieren
    const diff = diffText(job.monitor_last_output || "", stdout);
    await runMonitorAgent(job, tenantId, `${job.job_prompt}\n\nMONITOR CHANGE DETECTED\n${diff}`);
    await updateMonitorState(job.id_uuid, tenantId, hash, stdout);
    await updateAgentJobLastRun(job.id_uuid, tenantId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[processAgentJobs] ${jobType}-Job "${job.job_name}" Fehler:`, msg);
    try {
      await logAuditEvent({ tenantId, eventType: "AGENT_JOB_FAILED", entityType: "agent_job", eventDetails: `${job.job_name}: ${msg}`, actorIdentity: "scheduler" });
    } catch {
      // ignorieren — Retry-Semantik
    }
  }
}

// S11 Teil B: Agent-Lauf für Monitor-Jobs (Delivery wie agent-Job; Fehler → Hash bleibt alt → Retry)
async function runMonitorAgent(job: AgentJob, tenantId: string, prompt: string): Promise<void> {
  const result = await runLouisAiFlow(tenantId, "agent_job", prompt, [], "de", "");
  await deliverJobOutput(job, tenantId, result.replyText, false);
}

// S11 Teil B: zentrale Zustellung (agent-/script-/monitor-Jobs)
async function deliverJobOutput(job: AgentJob, tenantId: string, text: string, scriptMode: boolean): Promise<void> {
  if (job.deliver_to === "telegram") {
    const sendRes = await executeSendTelegramMessage(
      tenantId,
      JSON.stringify({ chat_id: job.deliver_target || undefined, message: text })
    );
    if (sendRes && typeof sendRes === "object" && "success" in sendRes && (sendRes as { success: boolean }).success === false) {
      throw new Error(String((sendRes as { error?: unknown }).error || "Telegram-Delivery fehlgeschlagen"));
    }
  } else if (job.deliver_to === "mail_draft") {
    if (!job.deliver_target) {
      throw new Error("deliver_target fehlt für mail_draft-Zustellung");
    }
    if (isUsingFallback || !pool) {
      if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
      fallbackStore.mailDrafts.push({
        id_uuid: uuidv4(),
        tenant_id: tenantId,
        workflow_instance_id: null,
        recipient: job.deliver_target,
        subject: job.job_name,
        body: text,
        attachments_json: [],
        status: "PENDING",
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      });
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, workflow_instance_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
         VALUES ($1, $2, NULL, $3, $4, $5, '[]'::jsonb, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), tenantId, job.deliver_target, job.job_name, text]
      );
    }
  } else {
    // deliver_to === 'session'
    const history = scriptMode
      ? [{ role: "assistant" as const, content: text }]
      : [{ role: "user" as const, content: job.job_prompt }, { role: "assistant" as const, content: text }];
    if (isUsingFallback || !pool) {
      if (!fallbackStore.louisAiSessions) fallbackStore.louisAiSessions = [];
      fallbackStore.louisAiSessions.push({
        id_uuid: uuidv4(),
        tenant_id: tenantId,
        session_title: job.job_name,
        conversation_history_json: history,
        // Auftrag 025 Phase 2 (#12): Session-Spalten befüllen (Summary + Lineage) — DDL existierte,
        // INSERT ließ sie leer (Katalog- 2026-08-18).
        short_term_summary_text: "",
        parent_session_id: null,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      });
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_sessions (id_uuid, tenant_id, session_title, conversation_history_json, short_term_summary_text, parent_session_id, created_at_utc, updated_at_utc)
         VALUES ($1, $2, $3, $4::jsonb, '', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), tenantId, job.job_name, JSON.stringify(history)]
      );
    }
  }
}

// S11 Teil B: Monitor-Zustand persistieren (Hash + letzte Ausgabe)
async function updateMonitorState(idUuid: string, tenantId: string, hash: string, output: string): Promise<void> {
  if (isUsingFallback || !pool) {
    const j = (fallbackStore.agentJobs || []).find((x) => x.id_uuid === idUuid);
    if (j) {
      (j as { monitor_hash?: string | null; monitor_last_output?: string | null }).monitor_hash = hash;
      (j as { monitor_hash?: string | null; monitor_last_output?: string | null }).monitor_last_output = output;
      saveFallbackStore();
    }
    return;
  }
  await pool.query(
    `UPDATE sys_louis_ai_agent_jobs SET monitor_hash = $1, monitor_last_output = $2, updated_at_utc = NOW() WHERE id_uuid = $3`,
    [hash, output, idUuid]
  );
}

// S11 Teil B: einfacher Zeilen-Diff für Monitor-Benachrichtigungen
function diffText(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) { endOld--; endNew--; }
  return `--- ALT ---\n${oldLines.slice(start, endOld + 1).join("\n")}\n--- NEU ---\n${newLines.slice(start, endNew + 1).join("\n")}`;
}

interface WorkflowEventPayload {
  tenantId: string;
  eventName: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

const processedEventsCache = new Map<string, number>();

// Asynchronous garbage collector for memory (resource-friendly)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedEventsCache.entries()) {
    if (now - timestamp > 60 * 1000) { // Keep signatures locked for 60 seconds
      processedEventsCache.delete(key);
    }
  }
}, 30000); // Runs decoupled in the background every 30 seconds

function generateEventSignature(workflowId: string, eventName: string, data: unknown): string {
  if (!data) return `${workflowId}:${eventName}:empty`;
  
  // 1. Search for known ID keys
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const id = obj.id_uuid || obj.id || (obj.data as Record<string, unknown> | undefined)?.id_uuid || (obj.data as Record<string, unknown> | undefined)?.id;
    if (typeof id === "string") {
      return `${workflowId}:${eventName}:${id}`;
    }
  }
  
  // 2. Fallback: Deterministische Objektsignatur (MD5 Hash)
  try {
    const rawString = JSON.stringify(data);
    const hash = crypto.createHash("md5").update(rawString).digest("hex");
    return `${workflowId}:${eventName}:hash:${hash}`;
  } catch (err) {
    return `${workflowId}:${eventName}:fallback:${Date.now()}`;
  }
}

function markAndCheckIdempotency(signature: string): boolean {
  const now = Date.now();
  const lastTime = processedEventsCache.get(signature);
  
  if (lastTime && (now - lastTime < 30000)) { // 30-second lock period
    return true; // Gefunden -> Double Submission!
  }
  
  processedEventsCache.set(signature, now);
  return false; // Unique -> Allowed to execute
}

async function enrichWorkflowPayload(tenantId: string, eventName: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const enriched = { ...data };

  // Ensure invoice_id is set to id_uuid for matches
  if (data.id_uuid && !data.invoice_id) {
    enriched.invoice_id = data.id_uuid;
  }

  if (eventName.startsWith("invoice.")) {
    let invoiceId = (data.id_uuid || data.invoice_id) as string | undefined;
    let associatedCompanyId = data.associated_company_id as string | undefined;
    let associatedContactId = data.associated_contact_id as string | undefined;
    let invoiceNumber = data.invoice_number as string | undefined;
    let totalGrossAmount = data.total_gross_amount as number | undefined;

    // 1. Fetch missing invoice properties if possible
    if (invoiceId && (!associatedCompanyId && !associatedContactId)) {
      if (isUsingFallback) {
        const inv = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
        if (inv) {
          associatedCompanyId = inv.associated_company_id || undefined;
          associatedContactId = inv.associated_contact_id || undefined;
          invoiceNumber = invoiceNumber || inv.invoice_number;
          totalGrossAmount = totalGrossAmount || inv.total_gross_amount;
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT associated_company_id, associated_contact_id, invoice_number, total_gross_amount FROM fiscal_billing_invoices WHERE id_uuid = $1 LIMIT 1",
            [invoiceId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            associatedCompanyId = row.associated_company_id || undefined;
            associatedContactId = row.associated_contact_id || undefined;
            invoiceNumber = invoiceNumber || row.invoice_number;
            totalGrossAmount = totalGrossAmount || (row.total_gross_amount ? parseFloat(String(row.total_gross_amount)) : 0);
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve invoice row for enrichment:", e);
        }
      }
    }

    if (invoiceNumber) enriched.invoice_number = invoiceNumber;
    if (totalGrossAmount !== undefined) enriched.total_gross_amount = totalGrossAmount;
    if (associatedCompanyId) enriched.associated_company_id = associatedCompanyId;
    if (associatedContactId) enriched.associated_contact_id = associatedContactId;

    // 2. Resolve contact details if associatedContactId is present
    if (associatedContactId) {
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find(c => c.id_uuid === associatedContactId);
        if (contact) {
          enriched.email_address = contact.email_address || enriched.email_address || "";
          enriched.email = contact.email_address || enriched.email || "";
          enriched.first_name = contact.first_name || "";
          enriched.last_name = contact.last_name || "";
          enriched.full_legal_name = contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
          enriched.salutation = contact.salutation || "";
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT first_name, last_name, full_legal_name, email_address, phone_number, salutation FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1",
            [associatedContactId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.email_address = row.email_address || enriched.email_address || "";
            enriched.email = row.email_address || enriched.email || "";
            enriched.first_name = row.first_name || "";
            enriched.last_name = row.last_name || "";
            enriched.full_legal_name = row.full_legal_name || `${row.first_name || ''} ${row.last_name || ''}`.trim();
            enriched.salutation = row.salutation || "";
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve contact details for invoice enrichment:", e);
        }
      }
    }

    // 3. Fallback/complement: resolve company details if associatedCompanyId is present
    if (associatedCompanyId) {
      if (isUsingFallback) {
        const company = fallbackStore.companies.find(c => c.id_uuid === associatedCompanyId);
        if (company) {
          enriched.company_name = company.full_legal_name || "";
          if (!enriched.email_address) {
            enriched.email_address = company.email_address || "";
            enriched.email = company.email_address || "";
            enriched.full_legal_name = company.full_legal_name || "";
          }
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT full_legal_name, email_address FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1",
            [associatedCompanyId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.company_name = row.full_legal_name || "";
            if (!enriched.email_address) {
              enriched.email_address = row.email_address || "";
              enriched.email = row.email_address || "";
              enriched.full_legal_name = row.full_legal_name || "";
            }
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve company details for invoice enrichment:", e);
        }
      }
    }
  }

  if (eventName.startsWith("contact.")) {
    const contactId = (data.id_uuid || data.contact_id) as string | undefined;
    if (contactId) {
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find(c => c.id_uuid === contactId);
        if (contact) {
          enriched.id_uuid = contact.id_uuid;
          enriched.first_name = contact.first_name || enriched.first_name || "";
          enriched.last_name = contact.last_name || enriched.last_name || "";
          enriched.email_address = contact.email_address || enriched.email_address || "";
          enriched.email = contact.email_address || enriched.email || "";
          enriched.full_legal_name = contact.full_legal_name || enriched.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
          enriched.salutation = contact.salutation || enriched.salutation || "";
          if (contact.responsible_person) enriched.responsible_person = contact.responsible_person;
          enriched.associated_company_id = contact.associated_company_id || enriched.associated_company_id || null;

          if (contact.associated_company_id) {
            const company = fallbackStore.companies.find(c => c.id_uuid === contact.associated_company_id);
            if (company) {
              enriched.company_name = company.full_legal_name || "";
            }
          }
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT id_uuid, first_name, last_name, full_legal_name, email_address, salutation, responsible_person, associated_company_id FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1",
            [contactId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.id_uuid = row.id_uuid;
            enriched.first_name = row.first_name || enriched.first_name || "";
            enriched.last_name = row.last_name || enriched.last_name || "";
            enriched.email_address = row.email_address || enriched.email_address || "";
            enriched.email = row.email_address || enriched.email || "";
            enriched.full_legal_name = row.full_legal_name || enriched.full_legal_name || `${row.first_name || ''} ${row.last_name || ''}`.trim();
            enriched.salutation = row.salutation || enriched.salutation || "";
            if (row.responsible_person) enriched.responsible_person = row.responsible_person;
            enriched.associated_company_id = row.associated_company_id || enriched.associated_company_id || null;

            if (row.associated_company_id) {
              const compRes = await pool.query(
                "SELECT full_legal_name FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1",
                [row.associated_company_id]
              );
              if (compRes.rows.length > 0) {
                enriched.company_name = compRes.rows[0].full_legal_name || "";
              }
            }
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve contact details for contact enrichment:", e);
        }
      }
    }
  }

  if (eventName === "file.uploaded") {
    const entityType = data.entity_type as string | undefined;
    const entityId = data.entity_id as string | undefined;

    if (entityType === "contacts" && entityId) {
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find(c => c.id_uuid === entityId);
        if (contact) {
          enriched.id_uuid = contact.id_uuid;
          enriched.first_name = contact.first_name || "";
          enriched.last_name = contact.last_name || "";
          enriched.email_address = contact.email_address || "";
          enriched.email = contact.email_address || "";
          enriched.full_legal_name = contact.full_legal_name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
          enriched.salutation = contact.salutation || "";
          if (contact.responsible_person) enriched.responsible_person = contact.responsible_person;
          enriched.associated_company_id = contact.associated_company_id || null;

          if (contact.associated_company_id) {
            const company = fallbackStore.companies.find(c => c.id_uuid === contact.associated_company_id);
            if (company) {
              enriched.company_name = company.full_legal_name || "";
            }
          }
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT id_uuid, first_name, last_name, full_legal_name, email_address, salutation, responsible_person, associated_company_id FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1",
            [entityId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.id_uuid = row.id_uuid;
            enriched.first_name = row.first_name || "";
            enriched.last_name = row.last_name || "";
            enriched.email_address = row.email_address || "";
            enriched.email = row.email_address || "";
            enriched.full_legal_name = row.full_legal_name || `${row.first_name || ""} ${row.last_name || ""}`.trim();
            enriched.salutation = row.salutation || "";
            if (row.responsible_person) enriched.responsible_person = row.responsible_person;
            enriched.associated_company_id = row.associated_company_id || null;

            if (row.associated_company_id) {
              const compRes = await pool.query(
                "SELECT full_legal_name FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1",
                [row.associated_company_id]
              );
              if (compRes.rows.length > 0) {
                enriched.company_name = compRes.rows[0].full_legal_name || "";
              }
            }
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve contact details for file.uploaded enrichment:", e);
        }
      }
    } else if (entityType === "companies" && entityId) {
      if (isUsingFallback) {
        const company = fallbackStore.companies.find(c => c.id_uuid === entityId);
        if (company) {
          enriched.id_uuid = company.id_uuid;
          enriched.company_name = company.full_legal_name || "";
          enriched.full_legal_name = company.full_legal_name || "";
          enriched.email_address = company.email_address || "";
          enriched.email = company.email_address || "";
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT id_uuid, full_legal_name, email_address FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1",
            [entityId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.id_uuid = row.id_uuid;
            enriched.company_name = row.full_legal_name || "";
            enriched.full_legal_name = row.full_legal_name || "";
            enriched.email_address = row.email_address || "";
            enriched.email = row.email_address || "";
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve company details for file.uploaded enrichment:", e);
        }
      }
    }
  }

  if (eventName.startsWith("kanban.")) {
    const companyId = data.company_id_uuid as string | undefined;
    const contactId = data.contact_id_uuid as string | undefined;

    if (contactId) {
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find(c => c.id_uuid === contactId);
        if (contact) {
          enriched.contact_name = contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
          enriched.email_address = contact.email_address || enriched.email_address || "";
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT full_legal_name, first_name, last_name, email_address FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1",
            [contactId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.contact_name = row.full_legal_name || `${row.first_name || ''} ${row.last_name || ''}`.trim();
            enriched.email_address = row.email_address || enriched.email_address || "";
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve contact for kanban enrichment:", e);
        }
      }
    }

    if (companyId) {
      if (isUsingFallback) {
        const company = fallbackStore.companies.find(c => c.id_uuid === companyId);
        if (company) {
          enriched.company_name = company.full_legal_name || "";
          if (!enriched.email_address) enriched.email_address = company.email_address || "";
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT full_legal_name, email_address FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1",
            [companyId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            enriched.company_name = row.full_legal_name || "";
            if (!enriched.email_address) enriched.email_address = row.email_address || "";
          }
        } catch (e) {
          console.warn("[WorkflowEngine] Failed to retrieve company for kanban enrichment:", e);
        }
      }
    }
  }

  return enriched;
}

export function initWorkflowEngine() {
  if (isEngineInitialized) {
    console.log("[WorkflowEngine] ⚠️ Workflow engine is already initialized. Skipping duplicate listener registration.");
    return;
  }
  isEngineInitialized = true;
  console.log("[WorkflowEngine] ⚙️ Registering event listener router for Automated Custom Workflows...");

  // Run self-healing recovery once asynchronously on system startup (boot recovery)
  recoverOrphanedWorkflows().catch((err: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[WorkflowEngine] Fehler bei initialer Workflow-Wiederherstellung beim Boot:", errMsg);
  });

  // Subscribe to all event dispatches
  workflowEventBus.on("event", async (eventPayload: WorkflowEventPayload) => {
    const { tenantId, eventName, data } = eventPayload;
    
    try {
      console.log(`[WorkflowEngine] 🔍 Event "${eventName}" empfangen für Tenant "${tenantId}". Payload-Daten:`, JSON.stringify(data, null, 2));

      // Auftrag 013 P2-A: Skill-Suggestion-Event → persistieren (Chat-Karte im Frontend)
      if (eventName === "agent.skill_suggestion") {
        try {
          const s = (data || {}) as {
            workflow_name?: string;
            workflow_description?: string;
            skill_tags?: string[];
            skill_category?: string;
            tool_chain_sequence?: Array<{ tool: string; instruction: string }>;
          };
          if (s.workflow_name) {
            const now = new Date().toISOString();
            if (isUsingFallback || !pool) {
              if (!fallbackStore.skillSuggestions) fallbackStore.skillSuggestions = [];
              fallbackStore.skillSuggestions.push({
                id_uuid: uuidv4(),
                tenant_id: tenantId,
                workflow_name: s.workflow_name,
                workflow_description: s.workflow_description || "",
                skill_tags: s.skill_tags || [],
                skill_category: s.skill_category || null,
                tool_chain_sequence: s.tool_chain_sequence || [],
                status: "pending",
                created_at_utc: now
              });
              saveFallbackStore();
            } else {
              await pool.query(
                `INSERT INTO sys_louis_ai_skill_suggestions (id_uuid, tenant_id, workflow_name, workflow_description, skill_tags_json, skill_category, tool_chain_sequence_json, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
                [uuidv4(), tenantId, s.workflow_name, s.workflow_description || "", JSON.stringify(s.skill_tags || []), s.skill_category || null, JSON.stringify(s.tool_chain_sequence || [])]
              );
            }
            console.log(`[WorkflowEngine] 💡 Skill-Suggestion "${s.workflow_name}" persistiert.`);
          }
        } catch (sErr) {
          console.warn("[WorkflowEngine] Skill-Suggestion-Persistenz fehlgeschlagen:", sErr);
        }
        return; // Suggestion-Event triggert keine Workflows
      }
      
      const enrichedData = await enrichWorkflowPayload(tenantId, eventName, data);

      // 1. Fetch all configured workflows for this specific tenant namespace
      const workflows = await getLearnedWorkflows(tenantId);
      console.log(`[WorkflowEngine] 📁 Geladen: ${workflows.length} automatisierte Workflows.`);
      
      // 2. Filter workflows matching CRM_EVENT and matching event names
      const matching = workflows.filter((w: CustomWorkflow) => {
        const triggerType = w.trigger_type || "MANUAL";
        const isActive = w.is_active !== undefined ? w.is_active : true;
        const config = w.trigger_config || {};
        const matched = triggerType === "CRM_EVENT" && isActive && config.event_name === eventName;
        
        console.log(`[WorkflowEngine] ⚡ Prüfe Workflow "${w.workflow_name}" (Trigger: ${triggerType}, Aktiv: ${isActive}, EventName: ${config.event_name}) gegen Event "${eventName}". Treffer? ${matched}`);
        return matched;
      });
      
      if (matching.length === 0) {
        console.log(`[WorkflowEngine] 🥱 Kein passender Workflow für Event "${eventName}" gefunden.`);
        return;
      }
      
      console.log(`[WorkflowEngine] 🎯 Event "${eventName}" matched ${matching.length} automated workflow recipes. Launching executor...`);
      
      const existingInstances = await workflowExecutor.getInstances(tenantId);

      for (const workflow of matching) {
        // High-precision Idempotency Guard (Memory Cache + DB Status check)
        const signature = generateEventSignature(workflow.id_uuid || "", eventName, enrichedData);
        
        if (markAndCheckIdempotency(signature)) {
          console.log(`[WorkflowEngine] 🚫 Skipping duplicate workflow execution trigger (memory cache hit) for workflow: "${workflow.workflow_name}" (ID: ${workflow.id_uuid}) with signature: "${signature}"`);
          continue;
        }

        const dbDuplicate = existingInstances.find((inst: WorkflowInstance) => {
          if (inst.workflow_id !== workflow.id_uuid) return false;
          
          // Generate signature for the db instance payload to compare with current signature
          const instSignature = generateEventSignature(workflow.id_uuid || "", eventName, inst.initial_payload);
          if (instSignature !== signature) return false;

          if (inst.status === "PENDING_DELAY" || inst.status === "RUNNING") return true;

          const lastLog = inst.execution_log[inst.execution_log.length - 1];
          if (lastLog && lastLog.timestamp) {
            const diffMs = Date.now() - new Date(lastLog.timestamp).getTime();
            if (diffMs < 15000) return true;
          }
          return false;
        });

        if (dbDuplicate) {
          console.log(`[WorkflowEngine] 🚫 Skipping duplicate workflow execution trigger (database match hit) for workflow: "${workflow.workflow_name}" (ID: ${workflow.id_uuid}) with signature: "${signature}"`);
          continue;
        }

        interface WorkflowTriggerConfig {
          delay_seconds?: string | number;
        }
        const config = (workflow.trigger_config || {}) as WorkflowTriggerConfig;
        const delaySeconds = config.delay_seconds ? parseInt(String(config.delay_seconds), 10) : 0;
        
        if (delaySeconds > 0) {
          // Delay matching
          const instanceId = uuidv4();
          const executeAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
          
          const instance: WorkflowInstance = {
            id_uuid: instanceId,
            tenant_id: tenantId,
            workflow_id: workflow.id_uuid || "",
            status: "PENDING_DELAY",
            initial_payload: enrichedData,
            current_step_index: 0,
            execution_log: [
              {
                timestamp: new Date().toISOString(),
                step: "DELAY",
                details: `Ausführung verzögerert um ${delaySeconds} Sekunden. Geplant für ${executeAt}`
              }
            ],
            execute_at_utc: executeAt
          };
          
          await workflowExecutor.saveInstance(instance);
          console.log(`[WorkflowEngine] ⏰ Scheduled delayed workflow "${workflow.workflow_name}" instance: ${instanceId}`);
        } else {
          // Execute immediately in background
          workflowExecutor.execute(workflow, enrichedData).catch((err) => {
            console.error(`[WorkflowEngine] Error in workflow execution sequence for "${workflow.workflow_name}":`, err);
          });
        }
      }
    } catch (err) {
      console.error(`[WorkflowEngine] Critical dispatch routine error for event "${eventName}":`, err);
    }
  });

  // Start background periodic heartbeats (checks delayed queue & periodic Timer jobs)
  console.log("[WorkflowEngine] ⏰ Initiating periodic 10-second heartbeat check scheduler loop...");
  setInterval(() => {
    tickWorkflowScheduler().catch(err => {
      console.error("[WorkflowEngine] Error inside ticker loop execution:", err);
    });
    // Auftrag 026 P1-1 (#29): Curator-Tick im selben Heartbeat (Fälligkeit + Config intern geprüft)
    void maybeRunCuratorTick("1").catch((err) => {
      console.warn("[SkillCurator] Heartbeat-Tick fehlgeschlagen (ignoriert):", err instanceof Error ? err.message : String(err));
    });
  }, 10000);
}
