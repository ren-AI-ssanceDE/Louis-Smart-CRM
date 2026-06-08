import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { workflowEventBus } from "./workflowEventBus.js";
import { workflowExecutor } from "./workflowExecutor.js";
import { getLearnedWorkflows } from "./tools.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { CustomWorkflow, WorkflowInstance, Invoice, InvoiceOverduePayload } from "../../types.js";

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
      (inv: Invoice) => inv.payment_status === "pending"
    ) as Invoice[];
  } else {
    try {
      const res = await pool.query(
        "SELECT * FROM fiscal_billing_invoices WHERE payment_status = 'pending'"
      );
      pendingInvoices = res.rows as Invoice[];
    } catch (err: unknown) {
      console.error("[WorkflowScheduler] Fehler beim Abfragen ausstehender Rechnungen:", err);
      return;
    }
  }

  for (const inv of pendingInvoices) {
    const dueDate = inv.due_date;
    if (!dueDate) continue;

    const dueDateStr = dueDate.split("T")[0];

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
 * Executes a background check for fällige delayed and periodic workflows.
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
    }

    for (const wf of timerWorkflows) {
      try {
        const config = (wf.trigger_config || {}) as TimerTriggerConfig;
        const frequency = config.frequency || "daily"; // 'hourly', 'daily'
        const time = config.time || "08:30"; // e.g. "08:30"
        
        const lastRunKey = `last_run_${wf.id_uuid}`;
        let lastRunMeta: string | null = null;
        
        // Match marker inside louisAiUserMemory or similar
        if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
        let memoryIdx = fallbackStore.louisAiUserMemory.findIndex(m => m.user_id === lastRunKey);
        if (memoryIdx !== -1) {
          lastRunMeta = fallbackStore.louisAiUserMemory[memoryIdx].response_preferences_text || "";
        }

        const runTimerWorkflow = async () => {
          console.log(`[WorkflowScheduler] ⏰ Triggering TIMER workflow sequence "${wf.workflow_name}" (${wf.id_uuid})`);
          const nowStamp = new Date().toISOString();
          
          if (memoryIdx !== -1) {
            fallbackStore.louisAiUserMemory[memoryIdx].response_preferences_text = nowStamp;
            fallbackStore.louisAiUserMemory[memoryIdx].updated_at_utc = nowStamp;
          } else {
            fallbackStore.louisAiUserMemory.push({
              id_uuid: uuidv4(),
              tenant_id: wf.tenant_id,
              user_id: lastRunKey,
              response_preferences_text: nowStamp,
              frequently_used_tools_json: [],
              chat_notes_json: [],
              created_at_utc: nowStamp,
              updated_at_utc: nowStamp
            });
            memoryIdx = fallbackStore.louisAiUserMemory.length - 1;
          }
          saveFallbackStore();

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
        }
      } catch (err) {
        console.error(`[WorkflowScheduler] Error evaluating Timer workflow "${wf.workflow_name}":`, err);
      }
    }

  } catch (globalErr) {
    console.error("[WorkflowScheduler] Global tick process error:", globalErr);
  }
}

let isEngineInitialized = false;

interface WorkflowEventPayload {
  tenantId: string;
  eventName: string;
  data: Record<string, unknown>;
  timestamp?: string;
}

const processedEventsCache = new Map<string, number>();

// Asynchroner Garbage-Collector für den Speicher (Ressourcenschonend)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of processedEventsCache.entries()) {
    if (now - timestamp > 60 * 1000) { // Behalte Signaturen für 60 Sekunden gesperrt
      processedEventsCache.delete(key);
    }
  }
}, 30000); // Läuft entkoppelt alle 30 Sekunden im Hintergrund

function generateEventSignature(workflowId: string, eventName: string, data: unknown): string {
  if (!data) return `${workflowId}:${eventName}:empty`;
  
  // 1. Suche nach bekannten ID-Schlüsseln
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
  
  if (lastTime && (now - lastTime < 30000)) { // 30 Sekunden Sperrfrist
    return true; // Gefunden -> Double Submission!
  }
  
  processedEventsCache.set(signature, now);
  return false; // Einmalig -> Darf ausgeführt werden
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
  }, 10000);
}
