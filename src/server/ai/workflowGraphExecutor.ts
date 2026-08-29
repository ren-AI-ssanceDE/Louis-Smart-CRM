// src/server/ai/workflowGraphExecutor.ts

import { IWorkflowDAG, IWorkflowNode, IWorkflowContextState } from "../../types/workflows.js";
import { localModelClient } from "./localModelClient.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { resolveAttachmentPhysicalPath } from "./tools/messaging.js";
import { MailDraftAttachment, WorkflowExecutionLogEntry, WorkflowInstance } from "../../types.js";

/**
 * Single Source of Truth: Tool-Namen, die der DAG-Executor (WorkflowGraphExecutor)
 * als Workflow-Schritt-Tools tatsächlich ausführen kann. Hintergrund:
 * validateWorkflowTools prüfte gegen den LLM-Katalog — list_contacts wurde gespeichert,
 * crashte aber bei der Ausführung mit „Nicht unterstützter Werkzeugbezeichner".
 *
 * Gelernte Workflows laufen IMMER über die DAG-Engine (learnWorkflow erzeugt
 * dag_structure) — daher ist DIESE Liste der Maßstab für learn_workflow.
 * Enthält: snake_case-Namen der Dispatch-Zweige (Z. 635–777) + Spezialnamen
 * (SendEmail/CreateNote/TelegramNotify, Kanban-PascalCase). execute*-Präfixe und
 * workflow_*-Präfixe werden separat als gültig behandelt (generischer Dispatch).
 */
export const WORKFLOW_EXECUTOR_TOOL_NAMES: ReadonlySet<string> = new Set([
  // CRM / Analyse / Text
  "crm_data_analyst", "data_architect", "text_generator", "web_search", "local_knowledge",
  // Draft-Tools (Workflow-Pfad schreibt direkt, bypassApproval=true)
  "create_invoice_draft", "create_company_draft", "create_contact_draft", "create_offer_draft",
  "update_company_draft", "update_contact_draft", "update_invoice_draft", "update_offer_draft",
  "finalize_and_send_offer", "send_smtp_email",
  // Kanban
  "list_kanban_boards", "get_kanban_board_details", "create_kanban_board",
  "create_kanban_card", "move_kanban_card", "update_kanban_card", "delete_kanban_card",
  "CreateKanbanCard", "MoveKanbanCard", "UpdateKanbanCard", "DeleteKanbanCard",
  // Templates
  "get_templates", "get_template_details", "apply_template",
  // Notizen
  "create_note_draft", "list_notes", "update_note", "delete_note",
  // Vault / Wissen (interne + vault_-Namen)
  "vault_search", "vault_read", "vault_write", "vault_update", "vault_delete",
  "list_vault_files", "list_knowledge_files",
  "knowledge_search", "knowledge_write", "knowledge_update", "knowledge_delete",
  // Memory / Skills / Workflows
  "recall_sessions", "update_memory", "save_skill", "get_workflows", "learn_workflow",
  // Interaktion / Delegation
  "ask_user_question", "delegate_subtask",
  // Mail
  "list_mail_drafts",
  // Spezialnamen (dedizierte Zweige Z. 283/391/481)
  "SendEmail", "CreateNote", "TelegramNotify"
]);
// Hinweis: Lineare-Executor-Aliase (EmailClient, AddLabel, wait, delay …) sind hier
// bewusst NICHT enthalten — sie werden separat via KNOWN_EXECUTOR_TOOL_ALIASES in
// validateWorkflowTools erlaubt (Bestands-Workflows ohne dag_structure). Die DAG-Engine
// kann sie nicht ausführen; neue Workflows laufen immer über die DAG-Engine.

// FIX B-059-3 (060 P0): Erkennt WAIT-Schritte, die als ACTION-Tool gelernt wurden
// (learn_workflow speichert "wait"/"delay" als tool_identifier statt als WAIT-Knoten).
// Exportiert (P P1-1): workflowExecutor nutzt sie im Resume-Pfad (WAIT-Sprung).
export function isWaitToolNode(node: IWorkflowNode): boolean {
  const t = String(node.tool_identifier || "").toLowerCase();
  return t === "wait" || t === "delay" || t === "executewait" || t === "executedelay"
    || t.includes("wait") || t.includes("delay");
}

// P1-1: Ziel-Entität aus der natürlichen Sprache auflösen (Kontakt/Firma per
// Name oder E-Mail → UUID). Workflows werden in natürlicher Sprache gelernt
// ("am Testkontakt", "an den Kontakt mit der E-Mail X") — ohne Auflösung kann
// der Schema-Synthesizer keine contact_id_uuid/company_id_uuid erzeugen und der
// Schritt scheitert still. Deterministisch per DB-Suche, KEIN LLM.
export async function resolveTargetEntityId(
  instruction: string,
  tenantId: string,
  context?: { node_results?: Record<string, unknown>; state?: Record<string, unknown> }
): Promise<{ contact_id_uuid?: string; company_id_uuid?: string; hint: string }> {
  const text = String(instruction || "");
  const hint = text.slice(0, 120);
  // Nur auflösen, wenn eine Referenz auf "Kontakt"/"Firma"/"Unternehmen" vorkommt
  const hasContactRef = /kontakt|contact|kunde|person/i.test(text);
  const hasCompanyRef = /firma|unternehmen|company/i.test(text);
  if (!hasContactRef && !hasCompanyRef) return { hint };

  // UUID schon in der Instruktion? Dann nichts tun.
  const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuidMatch) return { hint };

  // P1-1: Vorherige Schritt-Ergebnisse durchsuchen — wenn ein früherer Schritt
  // einen Kontakt/Firma angelegt hat (z.B. "lege einen Kontakt an" als Schritt 1),
  // steht dessen ID in node_results. Dann braucht die Instruktion keinen Namen:
  // "lege eine Notiz am Kontakt ab" bezieht sich auf den gerade angelegten.
  const nodeResults = context?.node_results || {};
  for (const [, nodeResult] of Object.entries(nodeResults)) {
    const nr = nodeResult as Record<string, unknown>;
    const resultStr = typeof nr.result === "string" ? nr.result : JSON.stringify(nr.result || nr || "");
    if (!resultStr) continue;
    // Kontakt-ID aus create_contact_draft-Ergebnis (message enthält "Datenbank-ID: <uuid>")
    if (hasContactRef && !hasCompanyRef) {
      const contactUuid = resultStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      const isContactTool = /create_contact|contact.*(?:erstellt|angelegt|id)/i.test(resultStr) || /kontakt/i.test(resultStr);
      if (contactUuid && isContactTool) return { contact_id_uuid: contactUuid[0], hint };
    }
    // Firmen-ID aus create_company_draft-Ergebnis
    if (hasCompanyRef) {
      const companyUuid = resultStr.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      const isCompanyTool = /create_company|firma.*(?:erstellt|angelegt|id)|unternehmen.*(?:erstellt|angelegt)/i.test(resultStr);
      if (companyUuid && isCompanyTool) return { company_id_uuid: companyUuid[0], hint };
    }
  }

  // E-Mail-Adresse in der Instruktion? (Kontakt- oder Firmen-Ziel)
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const nameMatch = text.match(/(?:namens?|Name)\s+["']?([A-Za-zÀ-ÿ0-9 _-]{3,60})["']?/i);

  // Namens-Fragment: "am Testkontakt" → "Testkontakt", "an Neuer Kunde" → "Neuer Kunde",
  // "am Kontakt Test Testkunde" → "Test Testkunde" (Zielwort "Kontakt/Firma/..." überspringen)
  let searchTerm = "";
  if (emailMatch) {
    searchTerm = emailMatch[0];
  } else if (nameMatch) {
    searchTerm = nameMatch[1].trim();
  } else if (hasContactRef) {
    // Nach "am/an/dem/den/der" ein optionales Zielwort (Kontakt/Firma/Unternehmen/
    // Person) überspringen und erst das DARAUFFOLGENDE als Namen nehmen:
    // "am Kontakt Test Testkunde" → "Test Testkunde" (nicht "Kontakt").
    // Lazy-Capture + Stopp vor "mit/und/text/inhalt/an" (Satz-Rest nicht mitnehmen).
    const m = text.match(/(?:am|an|dem|den|der)\s+(?:(?:die|der|das|dem|den)\s+)?(?:(?:kontakt|contact|kunde|firma|unternehmen|company|person|benutzer|user)\s+)?([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 _-]*?)(?=\s+(?:mit|und|text|inhalt|an)\b|$)/i);
    if (m && !/^(die|der|das|einen?|eine?|einem?|einer?|diesen?|diese|diesem|seine|ihre|unseren?)\b/i.test(m[1])) {
      searchTerm = m[1].trim();
    }
  }
  if (!searchTerm) return { hint };

  const { pool, isUsingFallback, fallbackStore } = await import("../db.js");
  try {
    if (hasContactRef && !hasCompanyRef) {
      if (isUsingFallback) {
        const c = (fallbackStore.contacts || []).find((x: { tenant_id?: string; full_legal_name?: string; email_address?: string; first_name?: string; last_name?: string }) =>
          x.tenant_id === tenantId && (
            (x.email_address || "").toLowerCase() === searchTerm.toLowerCase() ||
            (x.full_legal_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            `${x.first_name || ""} ${x.last_name || ""}`.toLowerCase().includes(searchTerm.toLowerCase())
          )
        );
        if (c) return { contact_id_uuid: c.id_uuid, hint };
      } else {
        // P1-1: Erst exakter Match, dann Token-Fallback (ein Wort des
        // Suchbegriffs reicht — "Testkontakt" → "Test Testkunde").
        let res = await pool.query(
          `SELECT id_uuid FROM core_registry_contacts WHERE tenant_id = $1 AND
             (LOWER(email_address) = LOWER($2) OR LOWER(full_legal_name) LIKE LOWER($3)
              OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE LOWER($3))
           LIMIT 1`,
          [tenantId, searchTerm, `%${searchTerm}%`]
        );
        if (res.rows.length === 0) {
          // Kompositum-/Kürzel-Fallback: "Testkontakt" → Präfixe ("Test") suchen,
          // die in echten Namen vorkommen ("Test Testkunde").
          const tokens = searchTerm.split(/\s+/).filter((t) => t.length >= 3);
          const prefixes = new Set<string>();
          for (const tok of tokens) {
            for (let len = Math.min(tok.length, 8); len >= 3; len--) {
              prefixes.add(tok.slice(0, len));
            }
          }
          for (const pre of prefixes) {
            res = await pool.query(
              `SELECT id_uuid FROM core_registry_contacts WHERE tenant_id = $1 AND
                 (LOWER(full_legal_name) LIKE LOWER($2) OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE LOWER($2))
               LIMIT 1`,
              [tenantId, `%${pre}%`]
            );
            if (res.rows.length > 0) break;
          }
        }
        if (res.rows.length > 0) return { contact_id_uuid: String(res.rows[0].id_uuid), hint };
      }
    }
    if (hasCompanyRef) {
      if (isUsingFallback) {
        const c = (fallbackStore.companies || []).find((x: { tenant_id?: string; company_name?: string; email_address?: string }) =>
          x.tenant_id === tenantId && (
            (x.email_address || "").toLowerCase() === searchTerm.toLowerCase() ||
            (x.company_name || "").toLowerCase().includes(searchTerm.toLowerCase())
          )
        );
        if (c) return { company_id_uuid: c.id_uuid, hint };
      } else {
        const res = await pool.query(
          `SELECT id_uuid FROM core_registry_companies WHERE tenant_id = $1 AND
             (LOWER(email_address) = LOWER($2) OR LOWER(full_legal_name) LIKE LOWER($3))
           LIMIT 1`,
          [tenantId, searchTerm, `%${searchTerm}%`]
        );
        if (res.rows.length > 0) return { company_id_uuid: String(res.rows[0].id_uuid), hint };
      }
    }
  } catch (err) {
    console.warn(`[resolveTargetEntityId] Auflösung fehlgeschlagen (${hint}):`, err);
  }
  return { hint };
}

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

    // Vorgänger-Ergebnisse als deterministischen Kontext anhängen —
    // NUR für ACTION-Nodes (Daten-Tools). Steuer-Nodes (WAIT/CONDITIONAL/
    // HUMAN_GATE) parsen ihre Instruktion deterministisch (z. B. Warte-Dauer)
    // und dürfen nicht durch Vorgänger-JSON kontaminiert werden.
    // (Regression: WAIT-Parser las eine falsche Zahl aus dem Kontext-Block.)
    const predecessorEntries: string[] = [];
    if (node.type === "ACTION") {
      predecessorEntries.push(...Object.entries(state.node_results || {})
        .filter(([nodeId]) => nodeId !== node.node_id)
        .map(([nodeId, res]) => {
          const resObj = res as Record<string, unknown>;
          const resultText = typeof resObj?.result === "string" ? resObj.result : JSON.stringify(resObj || {});
          const truncated = resultText.length > 2000 ? `${resultText.slice(0, 2000)}…` : resultText;
          // E-Mail-Ergebnisse können direkt, unter data., oder als JSON-String in
          // result liegen (dispatchAction returned { status, tool, result: string }).
          const inner = (resObj?.data && typeof resObj.data === "object") ? (resObj.data as Record<string, unknown>) : null;
          let parsedResult: Record<string, unknown> | null = null;
          if (typeof resObj?.result === "string") {
            try { parsedResult = JSON.parse(resObj.result); } catch { parsedResult = null; }
          }
          const parsedData = parsedResult && typeof parsedResult.data === "object"
            ? (parsedResult.data as Record<string, unknown>) : null;
          const body = typeof resObj?.renderedBody === "string" ? resObj.renderedBody
            : (inner && typeof inner.renderedBody === "string" ? inner.renderedBody
            : (parsedData && typeof parsedData.renderedBody === "string" ? parsedData.renderedBody : ""));
          const subject = typeof resObj?.renderedSubject === "string" ? resObj.renderedSubject
            : (inner && typeof inner.renderedSubject === "string" ? inner.renderedSubject
            : (parsedData && typeof parsedData.renderedSubject === "string" ? parsedData.renderedSubject : ""));
          if (body || subject) {
            const lines: string[] = [];
            if (subject) lines.push(`Betreff: ${subject}`);
            if (body) lines.push(`Inhalt: ${body}`);
            return `${nodeId}:\n${lines.join("\n")}`;
          }
          return `${nodeId}: ${truncated}`;
        }));
    }
    if (predecessorEntries.length > 0) {
      const predecessorContext = `\n\n=== ERGEBNISSE VORHERIGER SCHRITTE ===\n${predecessorEntries.join("\n")}\n==========================================`;
      processedInstructions = `${processedInstructions}${predecessorContext}`;
      console.log(`[WorkflowGraphExecutor] Node ${node.node_id}: ${predecessorEntries.length} Vorgänger-Ergebnis(se) als Kontext angehängt.`);
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

      } else if (node.type === "WAIT" || isWaitToolNode(node)) {
        // Evaluate seconds delay — unterstützt auch WAITs, die als ACTION-Schritt
        // gelernt wurden (tool_identifier "wait"/"delay"/"executeWait", FIX B-059-3):
        // learn_workflow speichert WAIT als Tool-Schritt, nicht als WAIT-Knotentyp.
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
      WORKFLOW_EXECUTOR_TOOL_NAMES.has(node.tool_identifier) ||
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

        // FIX B-059-3 (060 P0): Draft-/Schreib-Tools brauchen strukturierte JSON-
        // Argumente — die Klartext-Instruktion wird per Schema-Synthesizer in das
        // Tool-JSON gewandelt (gleiche Logik wie im linearen workflowExecutor).
        // Vorher: rohe Instruktion → JSON.parse-Fehler → stille Fehlschläge bei
        // allen per Chat gelernten Workflows (dag_structure-Pfad).
        const needsSynthesizedArgs =
          toolName.includes("invoice") || toolName.includes("company") ||
          toolName.includes("contact") || toolName.includes("offer") ||
          (toolName.includes("kanban") && (toolName.includes("create") || toolName.includes("move") || toolName.includes("update") || toolName.includes("delete"))) ||
          (toolName.includes("vault") || toolName.includes("knowledge")) &&
            (toolName.includes("write") || toolName.includes("update") || toolName.includes("delete")) ||
          (toolName.includes("note") && (toolName.includes("update") || toolName.includes("delete")));
        let synthesizedInstructions = instructions;
        if (needsSynthesizedArgs) {
          try {
            // P1-1: Ziel-Entität aus natürlicher Sprache auflösen und in den
            // Kontext injizieren — der Synthesizer kann sonst keine
            // contact_id_uuid/company_id_uuid erzeugen.
            let synthContext: Record<string, unknown> = {
              state,
              node_results: state.node_results || {}
            };
            if (toolName.includes("note") || toolName.includes("contact") || toolName.includes("invoice") || toolName.includes("offer")) {
              const resolved = await resolveTargetEntityId(instructions, tenantId, {
                node_results: state.node_results || {},
                state: state as unknown as Record<string, unknown>
              });
              if (resolved.contact_id_uuid) synthContext.resolved_contact_id_uuid = resolved.contact_id_uuid;
              if (resolved.company_id_uuid) synthContext.resolved_company_id_uuid = resolved.company_id_uuid;
            }
            const { synthesizeDraftArgs } = await import("./workflowExecutor.js");
            const cfg = await this.getTenantConfig(tenantId);
            synthesizedInstructions = await synthesizeDraftArgs({
              toolName,
              instruction: instructions,
              config: cfg,
              contextJson: JSON.stringify(synthContext)
            });
          } catch (synthErr) {
            console.warn(`[workflowGraphExecutor] Argument-Synthese fehlgeschlagen für ${toolName}, nutze Roh-Instruktion:`, synthErr);
          }
        }

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
          rawResult = await crmMod.executeCreateDraftInvoice(tenantId, synthesizedInstructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftCompany" || toolName === "create_company_draft") {
          rawResult = await crmMod.executeCreateDraftCompany(tenantId, synthesizedInstructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftContact" || toolName === "create_contact_draft") {
          rawResult = await crmMod.executeCreateDraftContact(tenantId, synthesizedInstructions, "ai_workflow_dag", true);
        } else if (toolName === "executeCreateDraftOffer" || toolName === "create_offer_draft") {
          rawResult = await crmMod.executeCreateDraftOffer(tenantId, synthesizedInstructions, "ai_workflow_dag", true);
        } else if (toolName === "executeFinalizeAndSendOffer" || toolName === "finalize_and_send_offer") {
          rawResult = await crmMod.executeFinalizeAndSendOffer(tenantId, synthesizedInstructions, "ai_workflow_dag");
        } else if (toolName === "executeSendSmtpEmail" || toolName === "send_smtp_email") {
          // E-Mail: Versand über die bestehende Messaging-Schnittstelle.
          // Standard: Dashboard-Draft; nur bei direct_send_email=true Sofortversand.
          const { executeSendSmtpEmail } = await import("./tools/messaging.js");
          const directSend = !!(state.initial_payload?.direct_send_email);
          rawResult = await executeSendSmtpEmail(tenantId, instructions, "ai_workflow_dag", undefined, { forceDraft: !directSend });
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
          // FIX B-059-3 (060 P0): Instruktion in JSON wrappen (toNoteDraftJson) —
          // rohe Klartext-Instruktionen scheiterten still bei JSON.parse; das
          // Ziel (contact_id_uuid/company_id_uuid) wird aus der Instruktion
          // extrahiert (gleiche Logik wie im linearen workflowExecutor).
          // P1-1: Zusätzlich die im Synthesizer-Kontext aufgelöste Ziel-ID
          // aus vorherigen Schritten übernehmen ("lege eine Notiz am Kontakt ab"
          // nach "lege einen Kontakt an" — ohne Namensnennung).
          const { toNoteDraftJson } = await import("./workflowExecutor.js");
          let noteContactId: string | undefined;
          let noteCompanyId: string | undefined;
          try {
            const resolvedNote = await resolveTargetEntityId(instructions, tenantId, {
              node_results: state.node_results || {},
              state: state as unknown as Record<string, unknown>
            });
            noteContactId = resolvedNote.contact_id_uuid;
            noteCompanyId = resolvedNote.company_id_uuid;
          } catch (noteErr) {
            console.warn("[workflowGraphExecutor] Notiz-Ziel-Auflösung fehlgeschlagen, nutze Instruktion:", noteErr);
          }
          rawResult = await crmMod.executeCreateNoteDraft(tenantId, toNoteDraftJson(instructions, noteContactId, noteCompanyId), "ai_workflow_dag", true);
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
          rawResult = await crmMod.executeUpdateNote(tenantId, synthesizedInstructions, "ai_workflow_dag");
        } else if (toolName === "executeDeleteNote" || toolName === "delete_note") {
          rawResult = await crmMod.executeDeleteNote(tenantId, synthesizedInstructions, "ai_workflow_dag");
        } else if (toolName === "executeCreateKanbanBoard" || toolName === "create_kanban_board") {
// : Workflow-Graph-Pfad schreibt direkt (bypassApproval=true)
          rawResult = await crmMod.executeCreateKanbanBoard(tenantId, synthesizedInstructions, "ai_workflow_dag", true);
        } else if (toolName === "executeListMailDrafts" || toolName === "list_mail_drafts") {
          rawResult = await messagingMod.executeListMailDrafts(tenantId, instructions);
        } else if (toolName === "executeVaultWrite" || toolName === "vault_write"
          || toolName === "knowledge_write" || toolName === "executeKnowledgeWrite") {
          // FIX B-059-3 (060 P0): synthetisierte JSON-Argumente statt Roh-Instruktion
          rawResult = await knowledgeMod.executeVaultWrite(tenantId, synthesizedInstructions, "ai_workflow_dag");
        } else if (toolName === "executeVaultUpdate" || toolName === "vault_update"
          || toolName === "knowledge_update" || toolName === "executeKnowledgeUpdate") {
          rawResult = await knowledgeMod.executeVaultUpdate(tenantId, synthesizedInstructions, "ai_workflow_dag");
        } else if (toolName === "executeVaultDelete" || toolName === "vault_delete"
          || toolName === "knowledge_delete" || toolName === "executeKnowledgeDelete") {
          rawResult = await knowledgeMod.executeVaultDelete(tenantId, synthesizedInstructions, "ai_workflow_dag");
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
