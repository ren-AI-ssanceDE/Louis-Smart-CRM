// src/server/ai/workflowGraphExecutor.ts

import { IWorkflowDAG, IWorkflowNode, IWorkflowContextState } from "../../types/workflows.js";
import { localModelClient } from "./localModelClient.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { resolveAttachmentPhysicalPath } from "./tools/messaging.js";
import { MailDraftAttachment, WorkflowExecutionLogEntry, WorkflowInstance } from "../../types.js";

export class WorkflowGraphExecutor {
  /**
   * Main entry point to run or resume a Directed Acyclic Graph (DAG) workflow.
   */
  public async executeDAG(
    dag: IWorkflowDAG,
    state: IWorkflowContextState,
    currentNodeId: string,
    tenantId: string = "1",
    instanceId?: string
  ): Promise<void> {
    const activeInstanceId = instanceId || uuidv4();
    const node = dag.nodes.find(n => n.node_id === currentNodeId);
    if (!node) {
      throw new Error(`Knoten ${currentNodeId} existiert nicht im DAG.`);
    }

    // 1. Interpolate variables in instruction template
    let processedInstructions = this.interpolate(node.instructions_template, state);

    // Perform RAG retrieval if enabled
    let retrievedContext = "";
    if (node.rag_enabled) {
      try {
        const { executeLocalKnowledgeSearch } = await import("./tools/knowledge.js");
        const ragQ = node.rag_query ? this.interpolate(node.rag_query, state) : node.name;
        console.log(`[WorkflowGraphExecutor] Node ${node.node_id} RAG query: "${ragQ}"`);
        const ragRes = await executeLocalKnowledgeSearch(tenantId, ragQ);
        retrievedContext = (ragRes.data?.message as string) || (ragRes.error ? "" : JSON.stringify(ragRes.data || {}));
      } catch (ragErr) {
        console.warn(`[WorkflowGraphExecutor] RAG search failed for node ${node.node_id}:`, ragErr);
      }
    }

    if (retrievedContext) {
      processedInstructions = `${processedInstructions}\n\n=== RELEVANTER WISSENSKONTEXT AUS DATEN-TRESOR (RAG) ===\n${retrievedContext}\n======================================================`;
    }

    // Prepare log entry structure
    const logEntry = {
      timestamp: new Date().toISOString(),
      node_id: node.node_id,
      node_name: node.name,
      node_type: node.type,
      processed_instructions: processedInstructions,
      status: "EXECUTING"
    };

    try {
      console.log(`[WorkflowGraphExecutor] [Instance: ${activeInstanceId}] Executing Node: ${node.name} (${node.node_id}) [Type: ${node.type}]`);

      // 2. Persist the state update before doing operations
      await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "RUNNING", currentNodeId, state, logEntry);

      if (node.type === "CONDITIONAL") {
        // Run conditional branching through Model Selection or default localModelClient
        const isTrue = await this.evaluateConditionalNode(tenantId, node, processedInstructions, state);
        
        const outcomeEntry = {
          ...logEntry,
          status: "SUCCESS",
          details: `Bedingungs-Prüfung ergab: ${isTrue ? "JA / TRUE" : "NEIN / FALSE"}`
        };

        const nextId = isTrue 
          ? (node.next_node_ids[0] || null) 
          : (node.fallback_node_id || node.next_node_ids[1] || null);

        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "RUNNING", currentNodeId, state, outcomeEntry);

        if (nextId) {
          await this.executeDAG(dag, state, nextId, tenantId, activeInstanceId);
        } else {
          console.log(`[WorkflowGraphExecutor] No follow-up branch to execute after conditional node ${node.node_id}`);
          await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "COMPLETED", null, state, {
            timestamp: new Date().toISOString(),
            node_id: node.node_id,
            node_name: node.name,
            status: "COMPLETED",
            details: "Workflow erfolgreich beendet (Zweigpfad-Ende)."
          });
        }

      } else if (node.type === "WAIT") {
        // Evaluate seconds delay
        const seconds = this.parseWaitDurationToSeconds(processedInstructions);
        const executeAt = new Date(Date.now() + seconds * 1000).toISOString();

        const waitEntry = {
          ...logEntry,
          status: "SUSPENDED_WAIT",
          details: `Warte-Schritt: ${seconds} Sekunden Verzögerung aktiv. Fortsetzung geplant für ${executeAt}`
        };

        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "PENDING_DELAY", currentNodeId, state, waitEntry, executeAt);
        console.log(`[WorkflowGraphExecutor] ⏰ Paused workflow instance ${activeInstanceId} for ${seconds}s. Planned execute_at_utc: ${executeAt}`);
        return;

      } else if (node.type === "HUMAN_GATE") {
        // Human Gate: Put instance into validation mode
        const gateEntry = {
          ...logEntry,
          status: "SUSPENDED_GATE",
          details: `Eingefroren im Human Approval Gate. Wartet auf manuelle Benutzerfreigabe.`
        };

        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "PENDING_APPROVAL", currentNodeId, state, gateEntry);
        console.log(`[WorkflowGraphExecutor] 🛑 Human gate reached on node ${node.node_id}. Execution suspended.`);
        return;

      } else {
        // Standard ACTION node dispatch
        const actionResult = await this.dispatchAction(tenantId, node, processedInstructions, state, activeInstanceId);
        
        // Save the result inside global node_results context
        state.node_results[node.node_id] = actionResult;

 // 4B (Live-Bugfix 2): ask_user_question pausiert die DAG-Instanz
        // (PENDING_QUESTION) — analog WAIT/HUMAN_GATE; Resume im Scheduler-Tick.
        const isAskUser =
          node.tool_identifier === "AskUserQuestion" ||
          node.tool_identifier === "ask_user_question" ||
          node.tool_identifier === "executeAskUserQuestion";
        const actionResultObj = actionResult as Record<string, unknown>;
        const pendingQId = isAskUser
          ? (typeof actionResultObj?.result === "string" ? (() => {
              try {
                const parsed = JSON.parse(actionResultObj.result as string);
                return parsed.question_id || null;
              } catch { return null; }
            })() : null)
          : undefined;

        if (isAskUser && pendingQId) {
          const questionEntry = {
            ...logEntry,
            status: "SUSPENDED_QUESTION",
            details: `Rückfrage ${pendingQId} gespeichert. Wartet auf Antwort im Dashboard (PENDING_QUESTION).`
          };
          await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "PENDING_QUESTION", currentNodeId, state, questionEntry, undefined, pendingQId);
          console.log(`[WorkflowGraphExecutor] ❓ ask_user_question auf Knoten ${node.node_id} — Instanz ${activeInstanceId} pausiert (PENDING_QUESTION ${pendingQId}).`);
          return;
        }

        const actionEntry = {
          ...logEntry,
          status: "SUCCESS",
          outputs: actionResult,
          details: `Knoten-Aktion erfolgreich abgeschlossen: ${node.tool_identifier}.`
        };

        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "RUNNING", currentNodeId, state, actionEntry);

        // Forking / Parallel processing next nodes if multiple exist
        if (node.next_node_ids.length > 0) {
          await Promise.all(
            node.next_node_ids.map(nextId => 
              this.executeDAG(dag, state, nextId, tenantId, activeInstanceId)
            )
          );
        } else {
          // No more nodes -> mark workflow instance as completed
          await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "COMPLETED", null, state, {
            timestamp: new Date().toISOString(),
            node_id: node.node_id,
            node_name: node.name,
            status: "COMPLETED",
            details: "Workflow erfolgreich abgeschlossen."
          });
          console.log(`[WorkflowGraphExecutor] Successfully completed DAG execution for ${dag.title} [Instance: ${activeInstanceId}]`);
        }
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowGraphExecutor] Fehler bei Ausführung von Knoten ${node.name}: ${msg}`);

      const failLogEntry = {
        ...logEntry,
        status: "FAILED",
        details: `Fehlgeschlagen wegen: ${msg}`
      };

      if (node.fallback_node_id) {
        // Fallback node execution
        console.log(`[WorkflowGraphExecutor] Heading to fallback node: ${node.fallback_node_id}`);
        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "RUNNING", currentNodeId, state, failLogEntry);
        await this.executeDAG(dag, state, node.fallback_node_id, tenantId, activeInstanceId);
      } else {
        // Complete execution state as FAILED
        await this.saveInstanceState(activeInstanceId, tenantId, dag.workflow_id, "FAILED", currentNodeId, state, failLogEntry);
        throw err;
      }
    }
  }

  /**
   * Local Code Interpolator without Chat History bloat. Resolves fields dynamically.
   */
  private interpolate(template: string, state: IWorkflowContextState): string {
    if (!template) return "";
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
      const parts = path.trim().split(".");
      let current: unknown = state;
      for (const part of parts) {
        if (current && typeof current === "object" && part in current) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return ""; // fail gracefully by returning empty representation
        }
      }
      return String(current !== undefined && current !== null ? current : "");
    });
  }

  /**
   * Conditional model-agnostic classification (Evaluates Yes/No decision tree).
   */
  private async evaluateConditionalNode(
    tenantId: string,
    node: IWorkflowNode,
    instructions: string,
    state: IWorkflowContextState
  ): Promise<boolean> {
    const prompt = `
Du bist LOUIS, ein präzises CRM-Entscheidungssystem. Werte folgenden logischen Schritt auf Basis der Instruktionen und Daten aus.

ENTSCHEIDUNGS-VORLAGE:
- Regel: "${node.name}"
- Bedingungs-Instruktion: "${instructions}"

BENUTZERDATEN & PAYLOADS:
${JSON.stringify(state, null, 2)}

Antworte bitte ausschließlich im folgenden JSON Format:
{
  "outcome_decision": boolean,
  "reasoning_brief": "Deine Begründung auf Deutsch"
}
`;

    try {
      const modelSelection = node.model_selection || undefined;
      const responsePayload = await localModelClient.executeInference(tenantId, prompt, {
        jsonFormat: true,
        modelOverride: modelSelection,
        systemInstruction: "Du bist eine deterministische Logik-Engine. Gib ausschließlich JSON aus.",
        temperature: 0.1
      });
      const responseText = responsePayload.text || "";

      const parsed = JSON.parse(responseText);
      console.log(`[WorkflowGraphExecutor] Conditional node ${node.node_id} evaluated with result:`, parsed);
      return !!parsed.outcome_decision;
    } catch (err) {
      console.warn(`[WorkflowGraphExecutor] Conditional Node logic fallback to false:`, err);
      return false;
    }
  }

  /**
   * Action dispatch mapping. Translates tool_identifier onto real CRM microservices.
   */
  private async dispatchAction(
    tenantId: string,
    node: IWorkflowNode,
    instructions: string,
    state: IWorkflowContextState,
    instanceId: string
  ): Promise<Record<string, unknown>> {
    const modelSelection = node.model_selection || undefined;

    if (node.tool_identifier === "SendEmail") {
      const prompt = `
Du bist LOUIS, die KI-Mailing-Schnittstelle. Generiere eine professionelle, bezugsaktuelle E-Mail basierend auf der folgenden Instruktion.

INSTRUKTION:
"${instructions}"

CRM CONTEXT DATEN:
${JSON.stringify(state, null, 2)}

Erstelle den Inhalt. Du MUSST im folgenden JSON-Format antworten:
{
  "subject": "Dein Betreffzeilen-Text",
  "body": "Dein vollständiger E-Mail-Inhalt (formatiert)"
}
`;

      const responsePayload = await localModelClient.executeInference(tenantId, prompt, {
        jsonFormat: true,
        modelOverride: modelSelection,
        systemInstruction: "Du bist ein professioneller Kundenservice-Mailing-Agent. Generiere ausschließlich valides JSON.",
        temperature: 0.3
      });
      const responseText = responsePayload.text || "";

      const parsed = JSON.parse(responseText);
      const emailSubject = parsed.subject || `${node.name}`;
      const emailBody = parsed.body || responseText;

      // Scan for potential attachments in instructions or text
      const attachments: MailDraftAttachment[] = [];
      const filenameRegex = /['"«»]?(?:([a-zA-Z0-9_\-\säöüÄÖÜß]+)\.(pdf|txt|docx|doc|zip|png|jpg|jpeg|csv|xlsx))['"«»]?/gi;
      const textToScan = instructions + " " + emailBody;
      const matches = textToScan.match(filenameRegex);
      if (matches) {
        for (const match of matches) {
          const cleanFilename = match.replace(/^['"«»\s]+|['"«»\s]+$/g, "").trim();
          if (cleanFilename && !cleanFilename.includes("\n")) {
            const resolvedPath = resolveAttachmentPhysicalPath(tenantId, cleanFilename);
            if (resolvedPath) {
              const fileBase = path.basename(resolvedPath).replace(/^\d+_/g, "").toLowerCase();
              if (fileBase === cleanFilename.toLowerCase() || fileBase.includes(cleanFilename.toLowerCase())) {
                if (!attachments.some(att => att.filename.toLowerCase() === fileBase)) {
                  attachments.push({ filename: cleanFilename, source: "knowledge" });
                }
              }
            }
          }
        }
      }

      // Find recipient address from state payload or context
      let recipientAddress = "no-recipient@crm.local";
      const possiblePayloads = [state.initial_payload, ...(Object.values(state.node_results || {}))];
      for (const pl of possiblePayloads) {
        if (pl && typeof pl === "object") {
          const data = (pl as Record<string, unknown>).data || pl;
          const email = (data as Record<string, unknown>).email_address || (data as Record<string, unknown>).email;
          if (typeof email === "string" && email.includes("@")) {
            recipientAddress = email;
            break;
          }
        }
      }

      // Create Mail Draft (Pending approval)
      const draftId = uuidv4();
      if (isUsingFallback) {
        if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
        fallbackStore.mailDrafts.push({
          id_uuid: draftId,
          tenant_id: tenantId,
          workflow_instance_id: instanceId,
          recipient: recipientAddress,
          subject: emailSubject,
          body: emailBody,
          attachments_json: attachments,
          status: 'PENDING',
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, workflow_instance_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `, [draftId, tenantId, instanceId, recipientAddress, emailSubject, emailBody, JSON.stringify(attachments)]);
      }

      await logAuditEvent({
        tenantId,
        eventType: "CREATE",
        entityType: "MAIL_DRAFT",
        entityId: draftId,
        eventDetails: `Workflow E-Mail-Entwurf für '${recipientAddress}' erstellt. Betreff: ${emailSubject}`,
        actorIdentity: "ai_workflow"
      });

      return {
        status: "success",
        tool: "SendEmail",
        recipient: recipientAddress,
        draft_id: draftId,
        subject: emailSubject,
        body: emailBody,
        attachments
      };

    } else if (node.tool_identifier === "CreateNote") {
      // Create Note Action
      const crmMod = await import("./tools/crm.js");
      const prompt = `
Du bist LOUIS, ein präzises CRM-Verarbeitungssystem. Fasse folgenden Kontext in einer kurzen, objektiven CRM-Kontaktnotiz zusammen.

NOTIZ-ANFORDERUNG:
"${instructions}"

CRM CONTEXT DATEN:
${JSON.stringify(state, null, 2)}

Generiere einen kompakten Absatz für die Notiz (maximal 500 Zeichen).
`;

      const responsePayload = await localModelClient.executeInference(tenantId, prompt, {
        modelOverride: modelSelection,
        systemInstruction: "Antworte direkt mit dem erstellten Notiztext. Keine Kommentare, keine zusätzlichen Floskeln.",
        temperature: 0.2
      });
      const responseText = responsePayload.text || "";

      let associatedContactId: string | null = null;
      let associatedCompanyId: string | null = null;

      const posibles = [state.initial_payload, ...(Object.values(state.node_results || {}))];
      for (const pl of posibles) {
        if (pl && typeof pl === "object") {
          const data = (pl as Record<string, unknown>).data || pl;
          if (typeof (data as Record<string, unknown>).associated_contact_id === "string") {
            associatedContactId = (data as Record<string, unknown>).associated_contact_id as string;
          }
          if (typeof (data as Record<string, unknown>).associated_company_id === "string") {
            associatedCompanyId = (data as Record<string, unknown>).associated_company_id as string;
          }
          if (typeof (data as Record<string, unknown>).id_uuid === "string") {
            const uuidVal = (data as Record<string, unknown>).id_uuid as string;
            if ((pl as Record<string, unknown>).payment_status) {
              // It's an invoice, check associates
              if (typeof (pl as Record<string, unknown>).associated_contact_id === "string") {
                associatedContactId = (pl as Record<string, unknown>).associated_contact_id as string;
              }
              if (typeof (pl as Record<string, unknown>).associated_company_id === "string") {
                associatedCompanyId = (pl as Record<string, unknown>).associated_company_id as string;
              }
            }
          }
        }
      }

      // If contact or company found, append CRM note to communications db
      const commId = uuidv4();
      const noteContent = responseText.trim();

      // /N3 (V2-2-Klasse): Die generierte Notiz wird WIRKLICH persistiert
      // (executeCreateNoteDraft mit bypassApproval=true) — vorher nur Audit, kein DB-Eintrag.
      let persistedNoteId: string | null = null;
      if (associatedContactId || associatedCompanyId) {
        const noteResult = await crmMod.executeCreateNoteDraft(
          tenantId,
          JSON.stringify({
            contact_id_uuid: associatedContactId || undefined,
            company_id_uuid: associatedCompanyId || undefined,
            note_text: noteContent,
          }),
          "ai_workflow_dag",
          true
        );
        if (noteResult.success && noteResult.data?.id_uuid) {
          persistedNoteId = String(noteResult.data.id_uuid);
        }
        await logAuditEvent({
          tenantId,
          eventType: "UPDATE",
          entityType: associatedContactId ? "CONTACT" : "COMPANY",
          entityId: associatedContactId || associatedCompanyId,
          eventDetails: `CRM Kontaktnotiz via AI-Workflow angehängt: ${noteContent}`,
          actorIdentity: "ai_workflow"
        });
      }

      return {
        status: "success",
        tool: "CreateNote",
        note_id: persistedNoteId || commId,
        content: noteContent,
        associated_contact_id: associatedContactId,
        associated_company_id: associatedCompanyId
      };

    } else if (node.tool_identifier === "TelegramNotify") {
      // Post Notification representation or logs
      const prompt = `
Du bist ein CRM Alerting-System. Generiere eine kurze, markante Telegram Push-Nachricht (maximal 150 Zeichen) basierend auf diesem Kontext:
"${instructions}"

CONTEXT:
${JSON.stringify(state, null, 2)}
`;
      const telegramAlertRes = await localModelClient.executeInference(tenantId, prompt, {
        modelOverride: modelSelection,
        systemInstruction: "Antworte direkt mit dem auszugebenden Telegram-Meldetext. Halte dich extrem kurz.",
        temperature: 0.3
      });
      const telegramAlertMsg = telegramAlertRes.text || "";

      console.log(`[WorkflowGraphExecutor] Post push logic: "${telegramAlertMsg.trim()}"`);

      // Mock bot notification registry (Telegram Settings Gateway Integration)
      await logAuditEvent({
        tenantId,
        eventType: "TELEMETRY",
        entityType: "TELEGRAM",
        entityId: uuidv4(),
        eventDetails: `System Telegram Meldung ausgelöst: "${telegramAlertMsg.trim()}"`,
        actorIdentity: "ai_workflow"
      });

      return {
        status: "success",
        tool: "TelegramNotify",
        alert_message: telegramAlertMsg.trim()
      };
    } else if (
      node.tool_identifier === "create_kanban_card" || node.tool_identifier === "CreateKanbanCard" ||
      node.tool_identifier === "move_kanban_card" || node.tool_identifier === "MoveKanbanCard" ||
      node.tool_identifier === "update_kanban_card" || node.tool_identifier === "UpdateKanbanCard" ||
      node.tool_identifier === "delete_kanban_card" || node.tool_identifier === "DeleteKanbanCard"
    ) {
      const toolName = (node.tool_identifier as string).toLowerCase();
      let schemaInstructions = "";
      if (toolName.includes("create")) {
        schemaInstructions = `Generate a JSON object matching this schema:
{
  "title": "string (Titel der Karte)",
  "description": "optional string",
  "board_id_uuid": "optional string (UUID)",
  "column_id_uuid": "optional string (UUID)",
  "column_title": "optional string (Titel der Spalte, z.B. 'In Bearbeitung')",
  "priority": "optional string ('low' | 'medium' | 'high' | 'urgent')",
  "due_date": "optional string (ISO 8601 Datum)",
  "company_id_uuid": "optional string (UUID)",
  "contact_id_uuid": "optional string (UUID)",
  "labels": ["optional array of strings"]
}`;
      } else if (toolName.includes("move")) {
        schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "target_column_id_uuid": "optional string (UUID)",
  "target_column_title": "optional string (Titel der Zielspalte)",
  "new_position": number (optional, default 0)
}`;
      } else if (toolName.includes("update")) {
        schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "title": "optional string",
  "description": "optional string",
  "priority": "optional string ('low' | 'medium' | 'high' | 'urgent')",
  "due_date": "optional string (ISO 8601 Datum)",
  "labels": ["optional array of strings"]
}`;
      } else if (toolName.includes("delete")) {
        schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der zu löschenden Karte)"
}`;
      }

      const prompt = `
You are compiling structured JSON arguments for tool "${node.tool_identifier}".
Instructions: "${instructions}"

Context:
${JSON.stringify(state, null, 2)}

Requirements:
${schemaInstructions}

IMPORTANT: Output ONLY a valid raw JSON object. Do not wrap in markdown code blocks like \`\`\`json.
`;

      const responsePayload = await localModelClient.executeInference(tenantId, prompt, {
        jsonFormat: true,
        modelOverride: modelSelection,
        systemInstruction: "Du bist eine deterministische Logik-Engine. Gib ausschließlich JSON aus.",
        temperature: 0.1
      });
      const responseText = responsePayload.text || "";

      let cleanArgs = responseText.trim();
      if (cleanArgs.startsWith("```")) {
        cleanArgs = cleanArgs.replace(/^```[a-zA-Z0-9]*\s*/, "").replace(/\s*```$/, "").trim();
      }

      const {
        executeCreateKanbanCard,
        executeMoveKanbanCard,
        executeUpdateKanbanCard,
        executeDeleteKanbanCard
      } = await import("./tools/crm.js");

      let rawResult: unknown = "";
      if (toolName.includes("create")) {
        rawResult = await executeCreateKanbanCard(tenantId, cleanArgs, "ai_workflow_dag");
      } else if (toolName.includes("move")) {
        rawResult = await executeMoveKanbanCard(tenantId, cleanArgs, "ai_workflow_dag");
      } else if (toolName.includes("update")) {
        rawResult = await executeUpdateKanbanCard(tenantId, cleanArgs, "ai_workflow_dag");
      } else if (toolName.includes("delete")) {
        rawResult = await executeDeleteKanbanCard(tenantId, cleanArgs, "ai_workflow_dag");
      }

      return {
        status: "success",
        tool: node.tool_identifier,
        result: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult),
        arguments: cleanArgs
      };
    } else if (
      node.tool_identifier.startsWith("execute") ||
      node.tool_identifier === "AskUserQuestion" || node.tool_identifier === "ask_user_question" ||
      node.tool_identifier === "DelegateSubtask" || node.tool_identifier === "delegate_subtask"
    ) {
      // ======================================================================
 // 4B (Live-Bugfix): Generischer Tool-Dispatch für ALLE
      // executeX-Tools (Analyst, WebSearch, TextGenerator, Vault, Memory,
      // Templates, ask_user_question, delegate_subtask, …). Die DAG-Engine
      // kannte bisher nur SendEmail/CreateNote/TelegramNotify/Kanban — alle
      // übrigen schlugen mit „Nicht unterstützter Werkzeugbezeichner" fehl.
      // ======================================================================
      try {
        const crmMod = await import("./tools/crm.js");
        const knowledgeMod = await import("./tools/knowledge.js");
        const textMod = await import("./tools/text.js");
        const messagingMod = await import("./tools/messaging.js");
        const vaultStoreMod = await import("./vaultStore.js");
        const agentRuntimeMod = await import("./agentRuntime.js");

        const toolName = node.tool_identifier;
        let rawResult: unknown = "";

        // CRM-/Analyst-/Draft-/Kanban-/Offer-Tools
        if (toolName === "executeCrmDataAnalyst" || toolName === "crm_data_analyst") {
          rawResult = await crmMod.executeCrmDataAnalyst(tenantId, instructions);
        } else if (toolName === "executeTextGenerator" || toolName === "text_generator") {
          rawResult = await textMod.executeTextGenerator(tenantId, instructions);
        } else if (toolName === "executeWebSearch" || toolName === "web_search") {
          const { executeWebSearch } = await import("./tools/search.js");
          rawResult = await executeWebSearch(instructions, 1, tenantId);
        } else if (toolName === "executeLocalKnowledgeSearch" || toolName === "local_knowledge") {
          rawResult = await knowledgeMod.executeLocalKnowledgeSearch(tenantId, instructions);
        } else if (toolName === "executeCreateDraftInvoice" || toolName === "create_invoice_draft") {
          rawResult = await crmMod.executeCreateDraftInvoice(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftCompany" || toolName === "create_company_draft") {
          rawResult = await crmMod.executeCreateDraftCompany(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftContact" || toolName === "create_contact_draft") {
          rawResult = await crmMod.executeCreateDraftContact(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftOffer" || toolName === "create_offer_draft") {
          rawResult = await crmMod.executeCreateDraftOffer(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeFinalizeAndSendOffer" || toolName === "finalize_and_send_offer") {
          rawResult = await crmMod.executeFinalizeAndSendOffer(tenantId, instructions, "ai_workflow_dag");
        } else if (toolName === "executeSendSmtpEmail" || toolName === "send_smtp_email") {
          // E-Mail: Versand über die bestehende Messaging-Schnittstelle
          const { executeSendSmtpEmail } = await import("./tools/messaging.js");
          rawResult = await executeSendSmtpEmail(tenantId, instructions);
        } else if (toolName === "executeListKanbanBoards" || toolName === "list_kanban_boards") {
          rawResult = await crmMod.executeListKanbanBoards(tenantId);
        } else if (toolName === "executeGetKanbanBoardDetails" || toolName === "get_kanban_board_details") {
          rawResult = await crmMod.executeGetKanbanBoardDetails(tenantId, instructions);
        } else if (toolName === "executeGetTemplates" || toolName === "get_templates") {
          const { executeGetTemplates } = await import("./tools/templates.js");
          rawResult = await executeGetTemplates(tenantId, instructions);
        } else if (toolName === "executeGetTemplateDetails" || toolName === "get_template_details") {
          const { executeGetTemplateDetails } = await import("./tools/templates.js");
          rawResult = await executeGetTemplateDetails(tenantId, instructions);
        } else if (toolName === "executeApplyTemplate" || toolName === "apply_template") {
          const { executeApplyTemplate } = await import("./tools/templates.js");
          rawResult = await executeApplyTemplate(tenantId, instructions);
        } else if (toolName === "executeCreateNoteDraft" || toolName === "create_note_draft") {
          // /N3 (V2-2-Klasse): Workflow-Schritt persistiert die Notiz WIRKLICH
          // (bypassApproval=true, wie alle Workflow-Schreib-Tools) — vorher No-Op.
          rawResult = await crmMod.executeCreateNoteDraft(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeVaultSearch" || toolName === "vault_search") {
          rawResult = JSON.stringify(await vaultStoreMod.vaultSearch(tenantId, instructions, 5));
        } else if (toolName === "executeVaultRead" || toolName === "vault_read") {
          const rel = instructions.trim().replace(/^path[:：]\s*/i, "");
          rawResult = JSON.stringify(await vaultStoreMod.vaultReadText(tenantId, rel));
        } else if (toolName === "executeListVaultFiles" || toolName === "list_vault_files"
          || toolName === "list_knowledge_files" || toolName === "executeListKnowledgeFiles") {
          rawResult = await knowledgeMod.executeListVaultFiles(tenantId);
        } else if (toolName === "executeRecallSessions" || toolName === "recall_sessions") {
          rawResult = await knowledgeMod.executeRecallSessions(tenantId, instructions);
        } else if (toolName === "executeUpdateMemory" || toolName === "update_memory") {
          const mem = await vaultStoreMod.readUserMemoryVault(tenantId, "ai_workflow_dag");
          let prefs = mem?.response_preferences_text || "";
          let notes = mem?.chat_notes_json || [];
          try {
            const parsed = JSON.parse(instructions);
            if (parsed.preference) prefs = prefs ? `${prefs}\n${parsed.preference}` : parsed.preference;
            if (parsed.note) notes = [...notes, { id_uuid: uuidv4(), content: String(parsed.note), created_at_utc: new Date().toISOString() }];
          } catch { if (instructions) prefs = prefs ? `${prefs}\n${instructions}` : instructions; }
          rawResult = JSON.stringify(await vaultStoreMod.writeUserMemoryVault(tenantId, "ai_workflow_dag", {
            response_preferences_text: prefs,
            frequently_used_tools_json: mem?.frequently_used_tools_json || [],
            chat_notes_json: notes
          }));
        } else if (toolName === "executeSaveSkill" || toolName === "save_skill") {
          let skillName = "Workflow-Skill";
          try {
            const parsed = JSON.parse(instructions);
            skillName = parsed.name || skillName;
          } catch { /* Freitext */ }
          rawResult = JSON.stringify({ status: "VORSCHLAG", name: skillName, hint: "save_skill läuft immer über den Freigabe-Flow (Vorschlag protokolliert)." });
        } else if (toolName === "executeGetWorkflows" || toolName === "get_workflows") {
          rawResult = await knowledgeMod.executeWorkflowMacro(tenantId, "get_workflows", "{}");
        } else if (toolName === "executeLearnWorkflow" || toolName === "learn_workflow") {
          rawResult = await knowledgeMod.executeLearnWorkflow(tenantId, instructions);
        } else if (toolName === "executeAskUserQuestion" || toolName === "ask_user_question" || toolName === "AskUserQuestion") {
          // Persistierte Rückfrage (analog linearem Executor) — Workflow pausiert
          let question = instructions || "Bitte bestätige den nächsten Schritt.";
          let choices: string[] = [];
          let ctxText = `dag:${instanceId}`;
          try {
            const parsed = JSON.parse(instructions);
            if (parsed.question) question = String(parsed.question);
            if (Array.isArray(parsed.choices)) choices = parsed.choices.map(String);
            if (parsed.context) ctxText = String(parsed.context);
          } catch { /* Freitext */ }
          const qId = uuidv4();
          if (isUsingFallback || !pool) {
            if (!fallbackStore.aiQuestions) fallbackStore.aiQuestions = [];
            fallbackStore.aiQuestions.push({
              id_uuid: qId, tenant_id: tenantId, question,
              choices_json: JSON.stringify(choices), context_text: ctxText,
              status: "OPEN", answer: "", created_by: "ai_workflow_dag",
              created_at_utc: new Date().toISOString(), answered_at_utc: null
            });
            saveFallbackStore();
          } else {
            await pool.query(
              `INSERT INTO sys_louis_ai_questions (id_uuid, tenant_id, question, choices_json, context_text, status, created_by)
               VALUES ($1, $2, $3, $4::jsonb, $5, 'OPEN', 'ai_workflow_dag')`,
              [qId, tenantId, question, JSON.stringify(choices), ctxText]
            );
          }
          rawResult = JSON.stringify({ question_id: qId, message: `Rückfrage gespeichert (ID ${qId}).` });
        } else if (toolName === "executeDelegateSubtask" || toolName === "delegate_subtask" || toolName === "DelegateSubtask") {
          const { runSubTasksStandalone } = agentRuntimeMod;
          const config = await this.getTenantConfig(tenantId);
          const results = await runSubTasksStandalone(tenantId, "ai_workflow_dag", config, instructions, "de");
          rawResult = JSON.stringify(results.map((r) => ({
            subtask_id: r.subtask_id, status: r.status,
            final_text: (r.final_text || "").slice(0, 500), tool_trace: r.tool_trace, error: r.error
          })));
        } else if (toolName === "executeUpdateDraftCompany" || toolName === "update_company_draft") {
          rawResult = await crmMod.executeUpdateDraftCompany(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeUpdateDraftContact" || toolName === "update_contact_draft") {
          rawResult = await crmMod.executeUpdateDraftContact(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeUpdateDraftInvoice" || toolName === "update_invoice_draft") {
          rawResult = await crmMod.executeUpdateDraftInvoice(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeUpdateDraftOffer" || toolName === "update_offer_draft") {
          rawResult = await crmMod.executeUpdateDraftOffer(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeListNotes" || toolName === "list_notes") {
          rawResult = await crmMod.executeListNotes(tenantId, instructions);
        } else if (toolName === "executeUpdateNote" || toolName === "update_note") {
          rawResult = await crmMod.executeUpdateNote(tenantId, instructions, "ai_workflow_dag");
        } else if (toolName === "executeDeleteNote" || toolName === "delete_note") {
          rawResult = await crmMod.executeDeleteNote(tenantId, instructions, "ai_workflow_dag");
        } else if (toolName === "executeCreateKanbanBoard" || toolName === "create_kanban_board") {
 // : Workflow-Graph-Pfad schreibt direkt (bypassApproval=true)
          rawResult = await crmMod.executeCreateKanbanBoard(tenantId, instructions, "ai_workflow_dag", true);
        } else if (toolName === "executeListMailDrafts" || toolName === "list_mail_drafts") {
          rawResult = await messagingMod.executeListMailDrafts(tenantId, instructions);
        } else if (toolName === "executeVaultWrite" || toolName === "vault_write"
          || toolName === "knowledge_write" || toolName === "executeKnowledgeWrite") {
          rawResult = await knowledgeMod.executeVaultWrite(tenantId, instructions, "ai_workflow_dag");
        } else if (toolName === "executeVaultUpdate" || toolName === "vault_update"
          || toolName === "knowledge_update" || toolName === "executeKnowledgeUpdate") {
          rawResult = await knowledgeMod.executeVaultUpdate(tenantId, instructions, "ai_workflow_dag");
        } else if (toolName === "executeVaultDelete" || toolName === "vault_delete"
          || toolName === "knowledge_delete" || toolName === "executeKnowledgeDelete") {
          rawResult = await knowledgeMod.executeVaultDelete(tenantId, instructions, "ai_workflow_dag");
        } else {
          throw new Error(`Nicht unterstützter Werkzeugbezeichner: ${node.tool_identifier}`);
        }

        return {
          status: "success",
          tool: node.tool_identifier,
          result: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult)
        };
      } catch (dispatchErr: unknown) {
        const errMsg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
        return {
          status: "error",
          tool: node.tool_identifier,
          result: errMsg,
          error: errMsg
        };
      }
    }

    throw new Error(`Nicht unterstützter Werkzeugbezeichner: ${node.tool_identifier}`);
  }

  /** 4B: Tenant-Konfiguration für Sub-Agent-Delegation laden */
  private async getTenantConfig(tenantId: string) {
    try {
      const res = await pool.query(
        `SELECT id_uuid, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx,
                max_iterations, max_history_tokens, tool_result_truncate_chars, react_keep_last_results,
                react_compaction_from_iteration, early_exit_after_tools, prompt_directives_mode, react_tool_call_mode
         FROM sys_integrations_louis_ai_config
         WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1`,
        [tenantId]
      );
      if (res.rows.length > 0) return res.rows[0];
    } catch (err) {
      console.warn("[WorkflowGraphExecutor] getTenantConfig failed:", err);
    }
    return {
      provider_type: "ollama", model_name: "qwen2.5:7b", base_url: "",
      max_iterations: null, max_history_tokens: null, tool_result_truncate_chars: null,
      react_keep_last_results: null, react_compaction_from_iteration: null,
      early_exit_after_tools: null, prompt_directives_mode: "always", react_tool_call_mode: "auto"
    };
  }

  /**
   * Helper to parse time window descriptors.
   */
  private parseWaitDurationToSeconds(instruction: string): number {
    const raw = (instruction || "").toLowerCase();
    
    // Check for minutes
    const minMatch = raw.match(/(\d+)\s*(?:minute|minuten|min)/);
    if (minMatch && minMatch[1]) {
      return parseInt(minMatch[1], 10) * 60;
    }

    // Check for hours
    const hourMatch = raw.match(/(\d+)\s*(?:hour|stunde|stunden|h)/);
    if (hourMatch && hourMatch[1]) {
      return parseInt(hourMatch[1], 10) * 3600;
    }

    // Check for days
    const dayMatch = raw.match(/(\d+)\s*(?:day|tag|tage|t)/);
    if (dayMatch && dayMatch[1]) {
      return parseInt(dayMatch[1], 10) * 86400;
    }

    // Defaults / raw seconds match
    const secMatch = raw.match(/(\d+)\s*(?:seconds|sekunden|sek|sec|s)/);
    if (secMatch && secMatch[1]) {
      return parseInt(secMatch[1], 10);
    }

    const defaultDigits = raw.match(/(\d+)/);
    if (defaultDigits && defaultDigits[1]) {
      return parseInt(defaultDigits[1], 10);
    }

    return 60; // default to 60 seconds
  }

  /**
   * State updater for graph-based instances.
   */
  private async saveInstanceState(
    instanceId: string,
    tenantId: string,
    workflowId: string,
    status: string,
    currentNodeId: string | null,
    state: IWorkflowContextState,
    logEntry: Record<string, unknown>,
    executeAtStr?: string,
    pendingQuestionId?: string | null
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    if (isUsingFallback) {
      if (!fallbackStore.workflowInstances) fallbackStore.workflowInstances = [];
      let instance = fallbackStore.workflowInstances.find(i => i.id_uuid === instanceId);
      
      if (!instance) {
        instance = {
          id_uuid: instanceId,
          tenant_id: tenantId,
          workflow_id: workflowId,
          status: status as 'PENDING_DELAY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING_FOR_DRAFT_APPROVAL' | 'PENDING_APPROVAL' | 'PENDING_QUESTION',
          initial_payload: state.initial_payload,
          current_step_index: 0,
          execution_log: [logEntry as unknown as WorkflowExecutionLogEntry],
          execute_at_utc: executeAtStr || null,
          created_at_utc: nowIso,
          updated_at_utc: nowIso,
          current_node_id: currentNodeId || undefined,
          node_results: state.node_results,
          pending_question_id: pendingQuestionId || null
        };
        fallbackStore.workflowInstances.unshift(instance);
      } else {
        instance.status = status as 'PENDING_DELAY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING_FOR_DRAFT_APPROVAL' | 'PENDING_APPROVAL' | 'PENDING_QUESTION';
        instance.current_node_id = currentNodeId || undefined;
        instance.node_results = state.node_results;
        if (executeAtStr) instance.execute_at_utc = executeAtStr;
        if (pendingQuestionId !== undefined) instance.pending_question_id = pendingQuestionId || null;
        instance.execution_log.push(logEntry as unknown as WorkflowExecutionLogEntry);
        instance.updated_at_utc = nowIso;
      }
      saveFallbackStore();
    } else {
      try {
        // Query to check if exists
        const res = await pool.query("SELECT id_uuid, execution_log FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [instanceId]);
        
        let accumulatedLogs: unknown[] = [logEntry];
        if (res.rows.length > 0) {
          const rowLogs = typeof res.rows[0].execution_log === "string" 
            ? JSON.parse(res.rows[0].execution_log) 
            : (res.rows[0].execution_log || []);
          accumulatedLogs = [...rowLogs, logEntry];
        }

        await pool.query(`
          INSERT INTO sys_louis_ai_workflow_instances (
            id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, current_node_id, node_results, pending_question_id, created_at_utc, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (id_uuid)
          DO UPDATE SET 
            status = EXCLUDED.status, 
            current_node_id = EXCLUDED.current_node_id,
            node_results = EXCLUDED.node_results,
            execution_log = EXCLUDED.execution_log, 
            execute_at_utc = EXCLUDED.execute_at_utc,
            pending_question_id = EXCLUDED.pending_question_id,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          instanceId,
          tenantId,
          workflowId,
          status,
          JSON.stringify(state.initial_payload),
          JSON.stringify(accumulatedLogs),
          executeAtStr || null,
          currentNodeId,
          JSON.stringify(state.node_results || {}),
          pendingQuestionId || null
        ]);
      } catch (err) {
        console.error("[WorkflowGraphExecutor] Postgres DB write failed, fallback used:", err);
      }
    }
  }
}

export const workflowGraphExecutor = new WorkflowGraphExecutor();
