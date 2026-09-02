import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import path from "path";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { generateContentUniversal } from "./geminiHelper.js";
import { CustomWorkflow, WorkflowInstance, LouisAiConfig, WorkflowExecutionLogEntry, MailDraftAttachment, SmtpSettings } from "../../types.js";
import { IWorkflowDAG, IWorkflowContextState } from "../../types/workflows.js";
import { ingestEmailToRag } from "../storage.js";
import { resolveAttachmentPhysicalPath } from "./tools/messaging.js";
import { EmailCompiler } from "../utils/emailCompiler.js";

// FIX B-059-3 (060 P0): Wandelt eine Klartext-Workflow-Instruktion in das
// JSON-Argument für executeCreateNoteDraft um. Die Funktion erwartet
// { contact_id_uuid?, company_id_uuid?, note_text, priority? } — eine rohe
// Instruktion (z. B. "Lege eine Notiz am Testkontakt an mit Text 'X'")
// scheiterte vorher still bei JSON.parse. Wenn die Instruktion bereits JSON
// ist (LLM hat strukturiert geliefert), wird sie unverändert durchgereicht.
// Zusätzlich werden explizite IDs (contact_id_uuid/company_id_uuid oder
// UUID-Muster) aus Klartext-Instruktionen extrahiert (Louis schreibt sie
// beim Lernen teils mit, z. B. "am Kontakt (contact_id_uuid abc-…)").
/**
 * Extrahiert das FUEHRENDE JSON-Objekt aus einem Text, der nach dem Objekt
 * weiteren Inhalt haben darf (z. B. angehängter Predecessor-Kontext im
 * DAG-Executor: "{...}\n\n=== ERGEBNISSE VORHERIGER SCHRITTE ===").
 * JSON.parse scheitert an Trailing-Text — dieser Scanner respektiert Strings
 * und Escapes und parst nur das erste ausgeglichene Objekt.
 */
function extractLeadingJsonObject(text: string): Record<string, unknown> | null {
  const s = text.trimStart();
  if (!s.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(s.slice(0, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function toNoteDraftJson(instruction: string, resolvedContactId?: string, resolvedCompanyId?: string): string {
  const trimmed = (instruction || "").trim();
  if (!trimmed) return JSON.stringify({ note_text: "", ...(resolvedContactId ? { contact_id_uuid: resolvedContactId } : {}), ...(resolvedCompanyId ? { company_id_uuid: resolvedCompanyId } : {}) });
  // Strukturierte Instruktion: FUEHRENDES JSON-Objekt nutzen — auch wenn der
  // DAG-Executor Vorgänger-Ergebnisse als Kontext angehängt hat (JSON.parse
  // scheitert an Trailing-Text → der ganze String wurde sonst note_text →
  // Validierungsfehler ">2000" → die Notiz wurde nie persistiert).
  const parsed = extractLeadingJsonObject(trimmed);
  if (parsed) {
    // Bereits strukturiert — nur note_text sicherstellen
    if (!parsed.note_text && typeof parsed.text === "string") parsed.note_text = parsed.text;
    // P1-1: aufgelöste Ziel-ID ergänzen, falls nicht in der Instruktion
    if (!parsed.contact_id_uuid && resolvedContactId) parsed.contact_id_uuid = resolvedContactId;
    if (!parsed.company_id_uuid && resolvedCompanyId) parsed.company_id_uuid = resolvedCompanyId;
    return JSON.stringify(parsed);
  }
  // Klartext: Text-Referenzen extrahieren (best-effort), Rest als note_text
  const textMatch = trimmed.match(/(?:Text|text|Inhalt|inhalt)\s*['"“”]?([^'"”]{2,200})/i);
  const noteText = textMatch ? textMatch[1].trim() : trimmed;
  const args: Record<string, string> = { note_text: noteText };
  // Explizite ID-Felder aus der Instruktion übernehmen
  const idField = trimmed.match(/(contact_id_uuid|company_id_uuid)\s*[:=]?\s*([0-9a-f-]{36})/i);
  if (idField) {
    args[idField[1].toLowerCase()] = idField[2];
  } else {
    // Nackte UUID als Ziel (Kontakt-Verdacht, da Notizen meist am Kontakt hängen)
    const bareUuid = trimmed.match(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
    if (bareUuid) {
      args.contact_id_uuid = bareUuid[1];
    }
    // P1-1: aufgelöste Ziel-ID aus vorherigen Schritten (node_results) ergänzen
    if (!args.contact_id_uuid && resolvedContactId) args.contact_id_uuid = resolvedContactId;
    if (!args.company_id_uuid && resolvedCompanyId) args.company_id_uuid = resolvedCompanyId;
  }
  return JSON.stringify(args);
}

// FIX B-059-3 (060 P0): Gemeinsamer Argument-Synthesizer für Workflow-
// Schreib-Tools (Draft/CRM/Kanban). Wandelt eine Klartext-Instruktion per
// LLM in das JSON-Argument des Ziel-Tools um (Schema-basiert, deterministisch
// via "nur JSON ausgeben"-System-Instruction). Vorher hatte NUR der lineare
// workflowExecutor diese Logik (Inline, Z.948-1091); der DAG-Executor
// übergab Klartext roh → JSON.parse-Fehler → stille Fehlschläge.
export async function synthesizeDraftArgs(opts: {
  toolName: string;
  instruction: string;
  config: LouisAiConfig;
  contextJson: string;
}): Promise<string> {
  const { toolName, instruction, config, contextJson } = opts;
  let schemaInstructions = "";
  if (toolName.includes("invoice")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "company_id": "optional string (UUID or matching name/ID from previous results)",
  "contact_id": "optional string (UUID or matching name/ID from previous results)",
  "is_vat_inclusive": boolean,
  "items_list": [
    {
      "description": "string",
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "unit_code": "optional string, defaults to HUR"
    }
  ],
  "introductory_text": "optional string",
  "closing_text": "optional string",
  "payment_term": "optional string representing days, e.g. 14"
}`;
  } else if (toolName.includes("company")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "full_legal_name": "string",
  "tax_vat_id": "optional string",
  "tax_number": "optional string",
  "street": "optional string",
  "city": "optional string",
  "postal_code": "optional string",
  "email_address": "optional string",
  "responsible_person": "optional string"
}`;
  } else if (toolName.includes("contact")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "first_name": "string",
  "last_name": "string",
  "full_legal_name": "optional string",
  "salutation": "optional string",
  "email_address": "optional string",
  "phone_number": "optional string",
  "associated_company_id": "optional string or UUID"
}`;
  } else if (toolName.includes("offer") && (toolName.includes("finalize") || toolName.includes("send"))) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "offer_id_uuid": "string (UUID from previous results or context)",
  "direct_send": boolean (optional, default false)
}`;
  } else if (toolName.includes("offer")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "title": "string (Angebotstitel, e.g. 'Angebot für Website-Erstellung')",
  "associated_company_id": "optional string (UUID)",
  "associated_contact_id": "optional string (UUID)",
  "introductory_text": "optional string",
  "closing_text": "optional string",
  "issue_date": "optional string in YYYY-MM-DD format",
  "valid_until": "optional string in YYYY-MM-DD format",
  "payment_term": "optional string",
  "currency_code": "optional string, defaults to EUR",
  "is_vat_inclusive": boolean (optional),
  "line_items": [
    {
      "position": number,
      "description": "optional string",
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "unit_code": "optional string, defaults to HUR"
    }
  ]
}`;
  } else if (toolName.includes("create") && toolName.includes("note")) {
    // P1-1: Notiz-CREATE — Ziel-ID aus dem aufgelösten Kontext (resolved_contact_id_uuid)
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "contact_id_uuid": "optional string (UUID des Zielkontakts — WICHTIG: falls im Kontext resolved_contact_id_uuid vorhanden, GENAU DIESEN Wert verwenden)",
  "company_id_uuid": "optional string (UUID der Zielfirma — falls im Kontext resolved_company_id_uuid vorhanden, GENAU DIESEN Wert verwenden)",
  "note_text": "string (Notiztext aus der Instruktion)",
  "priority": "optional string ('low' | 'normal' | 'high' | 'urgent')"
}`;
  } else if (toolName.includes("update") && toolName.includes("note")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "note_id_uuid": "string (UUID der Notiz, aus Kontext oder Instruktion)",
  "note_text": "string (neuer Text)",
  "priority": "optional string ('low' | 'normal' | 'high' | 'urgent')"
}`;
  } else if (toolName.includes("delete") && toolName.includes("note")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "note_id_uuid": "string (UUID der Notiz, aus Kontext oder Instruktion)"
}`;
  } else if (toolName.includes("create") && toolName.includes("kanban") && toolName.includes("board")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "title": "string (Titel des Boards)",
  "description": "optional string",
  "column_titles": ["optional array of strings (Spaltentitel)"]
}`;
  } else if (toolName.includes("create") && toolName.includes("kanban")) {
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
  } else if (toolName.includes("write") && (toolName.includes("vault") || toolName.includes("knowledge"))) {
    // FIX B-059-3 (060 P0): Vault-Schreib-Tools — die Instruktion nennt Datei
    // und Inhalt im Klartext; das Tool erwartet { file_name, content }.
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "file_name": "string (Dateiname mit .md/.txt/.json/.csv-Endung, aus der Instruktion oder generiert)",
  "content": "string (vollständiger Datei-Inhalt aus der Instruktion)"
}`;
  } else if (toolName.includes("update") && (toolName.includes("vault") || toolName.includes("knowledge"))) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "file_name": "string (bestehender Dateiname mit Endung)",
  "content": "string (neuer vollständiger Inhalt)"
}`;
  } else if (toolName.includes("delete") && (toolName.includes("vault") || toolName.includes("knowledge"))) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "file_name": "string (bestehender Dateiname mit Endung)"
}`;
  } else if (toolName.includes("move") && toolName.includes("kanban")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "target_column_id_uuid": "optional string (UUID)",
  "target_column_title": "optional string (Titel der Zielspalte)",
  "new_position": number (optional, default 0)
}`;
  } else if (toolName.includes("update") && toolName.includes("kanban")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "title": "optional string",
  "description": "optional string",
  "priority": "optional string ('low' | 'medium' | 'high' | 'urgent')",
  "due_date": "optional string (ISO 8601 Datum)",
  "labels": ["optional array of strings"]
}`;
  } else if (toolName.includes("delete") && toolName.includes("kanban")) {
    schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der zu löschenden Karte)"
}`;
  }

  const argSynthesizerPrompt = `
You are compiling structured JSON arguments for the tool "${toolName}".
The instruction for this step is: "${instruction}"

Context from the current workflow execution:
${contextJson}

Requirements:
${schemaInstructions}

IMPORTANT: Output ONLY a valid raw JSON object. Do not wrap in markdown code blocks like \`\`\`json. Do not explain anything. Just output the valid raw JSON object.
`;

  const synthesizedArgs = await generateContentUniversal({
    provider_type: config.provider_type,
    model_name: config.model_name,
    api_key_secret: config.api_key_secret,
    base_url: config.base_url,
    contents: argSynthesizerPrompt,
    systemInstruction: "Du bist eine deterministische Logik-Engine. Gib ausschließlich JSON aus."
  });

  let clean = (synthesizedArgs.text || "").trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```[a-zA-Z0-9]*\s*/, "").replace(/\s*```$/, "").trim();
  }
  return clean.trim();
}

interface LlmResultStructure {
  workflow_step_result?: {
    generated_content?: {
      body?: string;
      subject?: string;
      text?: string;
      attachments?: unknown[];
      outputs?: {
        details?: {
          body?: string;
          subject?: string;
        };
        body?: string;
        text?: string;
      };
      output?: {
        generated_text?: string;
      };
      generated_text?: string;
      email_subject_text?: string;
      email_body_content?: string;
    };
    outputs?: {
      details?: {
        body?: string;
        subject?: string;
      };
      body?: string;
      text?: string;
    };
    output?: {
      generated_text?: string;
    };
    generated_text?: string;
    email_body_content?: string;
    body?: string;
    text?: string;
    subject?: string;
    attachments?: unknown[];
    email_subject_text?: string;
  };
  generated_content?: {
    body?: string;
    subject?: string;
    text?: string;
    attachments?: unknown[];
    outputs?: {
      details?: {
        body?: string;
        subject?: string;
      };
      body?: string;
      text?: string;
    };
    output?: {
      generated_text?: string;
    };
    generated_text?: string;
    email_subject_text?: string;
    email_body_content?: string;
  };
  outputs?: {
    details?: {
      body?: string;
      subject?: string;
    };
    body?: string;
    text?: string;
  };
  output?: {
    generated_text?: string;
  };
  generated_text?: string;
  email_body_content?: string;
  body?: string;
  text?: string;
  subject?: string;
  attachments?: unknown[];
  email_subject_text?: string;
}

export class WorkflowExecutor {
  /**
   * Loaded active Louis AI Configuration dynamically based on tenant.
   */
  private async getLouisAiConfig(tenantId: string): Promise<{
    provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic';
    model_name: string;
    api_key_secret: string;
    base_url: string;
  }> {
    let provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic' = 'ollama';
    let model_name = "llama3";
    let api_key_secret = "";
    let base_url = "";

    try {
      if (isUsingFallback) {
        const list = (fallbackStore.louisAiConfig as LouisAiConfig[] || []);
        const found = list.find((c) => c.tenant_id === tenantId) || 
                      list.find((c) => c.tenant_id === '1');
        if (found) {
          if (found.provider_type) provider_type = found.provider_type;
          if (found.model_name) model_name = found.model_name;
          if (found.api_key_secret) api_key_secret = found.api_key_secret.trim();
          if (found.base_url) base_url = found.base_url.trim();
        }
      } else {
        const res = await pool.query(
          "SELECT provider_type, model_name, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
          [tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          if (row.provider_type) provider_type = row.provider_type as 'gemini' | 'ollama' | 'openai' | 'anthropic';
          if (row.model_name) model_name = row.model_name;
          if (row.api_key_secret) api_key_secret = row.api_key_secret.trim();
          if (row.base_url) base_url = row.base_url.trim();
        }
      }
    } catch (err) {
      console.warn("[WorkflowExecutor] Failed to load provider configuration from Louis AI config, using defaults:", err);
    }

    if (api_key_secret.includes('@') || api_key_secret === '******') {
      api_key_secret = process.env.GEMINI_API_KEY || '';
    }

    return {
      provider_type,
      model_name,
      api_key_secret,
      base_url
    };
  }

  /**
   * Universal method to persist workflow execution states.
   */
  public async saveInstance(instance: WorkflowInstance) {
    const nowIso = new Date().toISOString();
    if (!instance.created_at_utc) {
      instance.created_at_utc = nowIso;
    }
    instance.updated_at_utc = nowIso;

    if (isUsingFallback) {
      if (!fallbackStore.workflowInstances) {
        fallbackStore.workflowInstances = [];
      }
      const idx = fallbackStore.workflowInstances.findIndex(i => i.id_uuid === instance.id_uuid);
      if (idx !== -1) {
        fallbackStore.workflowInstances[idx] = instance;
      } else {
        fallbackStore.workflowInstances.unshift(instance);
      }
      saveFallbackStore();
    } else {
      try {
        await pool.query(`
          INSERT INTO sys_louis_ai_workflow_instances (
            id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, current_node_id, node_results, pending_question_id, created_at_utc, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (id_uuid)
          DO UPDATE SET 
            status = EXCLUDED.status, 
            current_step_index = EXCLUDED.current_step_index, 
            execution_log = EXCLUDED.execution_log, 
            execute_at_utc = EXCLUDED.execute_at_utc,
            current_node_id = EXCLUDED.current_node_id,
            node_results = EXCLUDED.node_results,
            pending_question_id = EXCLUDED.pending_question_id,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          instance.id_uuid || uuidv4(),
          instance.tenant_id,
          instance.workflow_id,
          instance.status,
          JSON.stringify(instance.initial_payload),
          instance.current_step_index,
          JSON.stringify(instance.execution_log),
          instance.execute_at_utc || null,
          instance.current_node_id || null,
          JSON.stringify(instance.node_results || {}),
          instance.pending_question_id || null
        ]);
      } catch (err) {
        console.error("[WorkflowExecutor] PostgreSQL saveInstance failed, local fallback used:", err);
        // Fallback save write-through
        if (!fallbackStore.workflowInstances) fallbackStore.workflowInstances = [];
        const idx = fallbackStore.workflowInstances.findIndex(i => i.id_uuid === instance.id_uuid);
        if (idx !== -1) {
          fallbackStore.workflowInstances[idx] = instance;
        } else {
          fallbackStore.workflowInstances.unshift(instance);
        }
        saveFallbackStore();
      }
    }
  }

  /**
   * Helper to retrieve all workflow instances for a specific tenant.
   */
  public async getInstances(tenantId: string): Promise<WorkflowInstance[]> {
    if (isUsingFallback) {
      return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
    }
    try {
      const res = await pool.query(
        "SELECT * FROM sys_louis_ai_workflow_instances WHERE tenant_id = $1 ORDER BY created_at_utc DESC",
        [tenantId]
      );
      return res.rows;
    } catch (err) {
      console.warn("[WorkflowExecutor] Postgres query for instances failed, using fallback:", err);
      return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
    }
  }

  /**
   * Execute an active custom workflow. Supports resuming from a specific step.
   */
  public async execute(
    workflow: CustomWorkflow,
    initialPayload: Record<string, unknown> | null | undefined,
    startStepIndex: number = 0,
    existingInstanceId?: string
  ) {
    if (workflow.dag_structure) {
      const { workflowGraphExecutor, isWaitToolNode } = await import("./workflowGraphExecutor.js");
      const dag = workflow.dag_structure as unknown as IWorkflowDAG;
      // Defensiv: Instanz-Workflow-ID muss zur DAG gehören (falls dag_structure ohne workflow_id erstellt wurde)
      if (!dag.workflow_id) dag.workflow_id = workflow.id_uuid || "";
      const initialPayloadObj = initialPayload || {};
      
      const isResuming = !!existingInstanceId;
      let state: IWorkflowContextState;
      let nodeId = dag.start_node_id;

      // P/2.1.7: direct_send_email des Workflows in den Payload injizieren —
      // der Graph-Executor braucht es für send_smtp_email (forceDraft vs. Sofortversand)
      if (!initialPayloadObj.direct_send_email && workflow.direct_send_email !== undefined) {
        initialPayloadObj.direct_send_email = workflow.direct_send_email;
      }

      if (isResuming) {
        let inst: Record<string, unknown> | null = null;
        if (isUsingFallback) {
          inst = ((fallbackStore.workflowInstances || []).find(i => i.id_uuid === existingInstanceId) as unknown as Record<string, unknown>) || null;
        } else {
          try {
            const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [existingInstanceId]);
            if (res.rows.length > 0) {
              inst = res.rows[0] as Record<string, unknown>;
            }
          } catch (e) {
            console.warn("[workflowExecutor] Failed to query resuming instance:", e);
          }
        }
        if (inst) {
          nodeId = (inst.current_node_id as string) || dag.start_node_id;
          const nr = typeof inst.node_results === "string" 
            ? JSON.parse(inst.node_results) 
            : (inst.node_results || {});
          state = {
            initial_payload: typeof inst.initial_payload === "string" 
              ? JSON.parse(inst.initial_payload) 
              : (inst.initial_payload as Record<string, unknown> || {}),
            node_results: nr as Record<string, Record<string, unknown>>
          };

          // WAIT-Resume-Fix (2026-08-15): current_node_id zeigt bei PENDING_DELAY auf den
          // WAIT-Knoten selbst — ein erneutes executeDAG würde den WAIT endlos neu
          // terminieren (Endlosschleife). Stattdessen zum Folgeknoten springen
          // (analog approveWorkflowHumanGate).
          // P1-1: isWaitToolNode ergänzt — learn_workflow speichert WAIT als
          // ACTION-Knoten mit tool_identifier "wait"/"delay", nicht als WAIT-Typ;
          // ohne diese Erkennung hängt der Resume endlos in PENDING_DELAY.
          const resumeNode = dag.nodes?.find((n) => n.node_id === nodeId);
          const isAskUserResume =
            (resumeNode?.tool_identifier === "AskUserQuestion" ||
            resumeNode?.tool_identifier === "ask_user_question" ||
            resumeNode?.tool_identifier === "executeAskUserQuestion") &&
            // Resume nach beantworteter Rückfrage: Status wurde vom Scheduler schon auf
            // RUNNING gesetzt, erkennbar am QUESTION_ANSWERED-Log-Eintrag (oder noch
            // PENDING_QUESTION, falls der Resume-Block ohne Statuswechsel ankommt)
            (inst.status === "PENDING_QUESTION" || ((inst.execution_log as unknown as WorkflowExecutionLogEntry[] || []).some(
              (e) => e.step === "QUESTION_ANSWERED"
            )));
          if (resumeNode?.type === "WAIT" || isWaitToolNode(resumeNode) || isAskUserResume) {
            const nextId = resumeNode.next_node_ids?.[0];
            if (nextId) {
              nodeId = nextId;
            } else {
              // WAIT/ASK_USER als letzter Knoten: Instanz als abgeschlossen markieren
              const finalLog: WorkflowExecutionLogEntry = {
                timestamp: new Date().toISOString(),
                node_id: resumeNode.node_id,
                node_name: resumeNode.name,
                node_type: resumeNode.type,
                status: "COMPLETED",
                details: resumeNode.type === "WAIT"
                  ? "Warte-Schritt beendet — kein Folgeknoten, Workflow abgeschlossen."
                  : "Rückfrage beantwortet — kein Folgeknoten, Workflow abgeschlossen."
              };
              const logs = (typeof inst.execution_log === "string"
                ? JSON.parse(inst.execution_log)
                : (inst.execution_log || [])) as WorkflowExecutionLogEntry[];
              await this.saveInstance({
                ...(inst as unknown as WorkflowInstance),
                status: "COMPLETED",
                execution_log: [...logs, finalLog],
                updated_at_utc: new Date().toISOString()
              });
              console.log(`[WorkflowExecutor] ✅ Workflow completed after final ${resumeNode.type} node: ${existingInstanceId}`);
              return;
            }
          }
        } else {
          state = {
            initial_payload: initialPayloadObj,
            node_results: {}
          };
        }
      } else {
        state = {
          initial_payload: initialPayloadObj,
          node_results: {}
        };
      }

      await workflowGraphExecutor.executeDAG(dag, state, nodeId, workflow.tenant_id || "1", existingInstanceId);
      return;
    }

    const tenantId = workflow.tenant_id || "1";
    let instanceId = existingInstanceId || uuidv4();
    const sequence = workflow.tool_chain_sequence || [];

    let instance: WorkflowInstance | null = null;
    if (existingInstanceId) {
      if (isUsingFallback) {
        instance = (fallbackStore.workflowInstances || []).find(i => i.id_uuid === existingInstanceId) || null;
      } else {
        try {
          const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [existingInstanceId]);
          if (res.rows.length > 0) {
            instance = res.rows[0];
          }
        } catch (e) {
          console.warn("Failed to find existing workflow instance by ID in Postgres:", e);
        }
      }
    }

    if (instance) {
      instance.status = "RUNNING";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "RESUME",
        details: `Workflow fortgesetzt ab Schritt ${startStepIndex + 1}`
      });
      await this.saveInstance(instance);
    } else {
      instanceId = uuidv4();
      instance = {
        id_uuid: instanceId,
        tenant_id: tenantId,
        workflow_id: workflow.id_uuid || "",
        status: "RUNNING",
        initial_payload: initialPayload,
        current_step_index: startStepIndex,
        execution_log: [
          {
            timestamp: new Date().toISOString(),
            step: "INIT",
            details: `Workflow gestartet: "${workflow.workflow_name}"`
          }
        ],
        execute_at_utc: null
      };
      await this.saveInstance(instance);
    }

    try {
      const config = await this.getLouisAiConfig(tenantId);

      for (let i = startStepIndex; i < sequence.length; i++) {
        instance.current_step_index = i;
        const step = sequence[i];
        
        console.log(`[WorkflowExecutor] Executing Step ${i + 1}/${sequence.length}: [Tool: ${step.tool}]`);
        
        const isWaitStep = [
          "executeWait",
          "wait",
          "WAIT",
          "delay",
          "DELAY"
        ].includes(step.tool || "") || 
        (typeof step.tool === "string" && (
          step.tool.toLowerCase().includes("wait") ||
          step.tool.toLowerCase().includes("delay")
        ));

        if (isWaitStep) {
          const seconds = this.parseWaitDurationToSeconds(step.instruction);
          const executeAt = new Date(Date.now() + seconds * 1000).toISOString();
          
          instance.current_step_index = i + 1;
          instance.status = "PENDING_DELAY";
          instance.execute_at_utc = executeAt;
          
          const delayLogEntry: WorkflowExecutionLogEntry = {
            step_index: i,
            tool: step.tool,
            instruction: step.instruction,
            timestamp: new Date().toISOString(),
            details: `Warte-Schritt: ${seconds} Sekunden Verzögerung aktiv. Fortsetzung geplant für ${executeAt}`
          };
          instance.execution_log.push(delayLogEntry);
          
          await this.saveInstance(instance);
          console.log(`[WorkflowExecutor] ⏰ Paused workflow instance ${instance.id_uuid} for ${seconds}s. Next resume step index: ${instance.current_step_index}`);
          return;
        }

        const logEntry: WorkflowExecutionLogEntry = {
          step_index: i,
          tool: step.tool,
          instruction: step.instruction,
          timestamp: new Date().toISOString()
        };

        // LLM prompt compilation
        const prompt = `
Du bist LOUIS, die KI-Engine des Louis Smart CRM. Deine Aufgabe ist es, einen automatisierten Workflow-Schritt auszuführen.

SCHRITT DETAILS:
- Aktueller Schritt: ${i + 1} von ${sequence.length}
- Auszuführende Aktion: ${step.tool}
- Instruktion des Autors: "${step.instruction}"

INITIALES EVENTS PAYLOAD (Der Trigger-Auslöser):
${JSON.stringify(initialPayload, null, 2)}

VORHERIGE OUTCOMES / VERLAUFS-SPEICHER:
${JSON.stringify(instance.execution_log, null, 2)}

Bitte generiere die Antwort oder das Resultat für diesen Schritt basierend auf der Instruktion und den vorliegenden Daten.
Antworte präzise, professionell und ohne Einleitungsfloskeln.
`;

        const needsApiKey = config.provider_type !== 'ollama';
        const hasApiKey = !!config.api_key_secret;
        let llmResult = "";

        if (!needsApiKey || hasApiKey) {
          try {
            const llm = await generateContentUniversal({
              provider_type: config.provider_type,
              model_name: config.model_name,
              api_key_secret: config.api_key_secret,
              base_url: config.base_url,
              contents: prompt,
              systemInstruction: "Führe den Workflow-Schritt aus und halte dich exakt an die Vorgabe des Benutzers. Nutze IMMER die korrekten Namen, Anreden (such as first_name, last_name, salutation) und E-Mail-Adressen aus dem dargelegten INITIALEN EVENTS PAYLOAD. Halluziniere oder erfinde unter keinen Umständen Personennamen, Anreden oder sonstige Kunden- oder Firmendetails. Wenn bestimmte Namensdaten nicht vorhanden sind, formuliere die Nachricht höflich und neutral (z.B. 'Sehr geehrte Damen und Herren' oder 'Hallo,') anstatt Namen zu erfinden."
            });
            llmResult = llm.text;
          } catch (llmErr: unknown) {
            const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
            console.error(`[WorkflowExecutor] LLM execution failed on step ${i + 1}:`, llmErr);
            llmResult = `[LLM Fehler: ${errMsg}]`;
          }
        } else {
          llmResult = `[Fehler: Kein ${config.provider_type.toUpperCase()} API Key konfiguriert. Schritt wurde übersprungen]`;
        }

        logEntry.outputs = { text: llmResult };

        // Handle physical actions
        if (
          step.tool === "SendEmail" ||
          step.tool === "EmailClient" ||
          step.tool === "EmailDraft" ||
          step.tool === "executeSendSmtpEmail" ||
          step.tool === "send_smtp_email"
        ) {
          const draftBody = this.extractEmailBody(llmResult, instance.execution_log);
          const draftSubject = this.extractEmailSubject(llmResult, workflow.workflow_name);
          const draftAttachments = this.extractAttachments(llmResult);

          // Proactively scan for file attachments in step instruction and LLM result string
          const filenameRegex = /['"«»]?(?:([a-zA-Z0-9_\-\säöüÄÖÜß]+)\.(pdf|txt|docx|doc|zip|png|jpg|jpeg|csv|xlsx))['"«»]?/gi;
          const textToScan = (step.instruction || "") + " " + (llmResult || "");
          const matches = textToScan.match(filenameRegex);
          if (matches) {
            for (const match of matches) {
              const cleanFilename = match.replace(/^['"«»\s]+|['"«»\s]+$/g, "").trim();
              if (cleanFilename && !cleanFilename.includes("\n")) {
                const resolvedPath = resolveAttachmentPhysicalPath(tenantId, cleanFilename);
                if (resolvedPath) {
                  const resolvedFilename = path.basename(resolvedPath).replace(/^\d+_/g, "").toLowerCase();
                  const normClean = cleanFilename.toLowerCase();
                  // Check that the resolved filename matches the clean match or is contained in it
                  // to prevent matching sentences like "Hänge die Datei hallo_new.txt"
                  if (resolvedFilename === normClean || resolvedFilename.includes(normClean)) {
                    if (!draftAttachments.some(att => att.filename.toLowerCase() === cleanFilename.toLowerCase() || att.filename.toLowerCase() === resolvedFilename)) {
                      draftAttachments.push({
                        filename: cleanFilename,
                        source: "knowledge"
                      });
                    }
                  }
                }
              }
            }
          }

          // Attempt to load SMTP Config to check if it exists in production
          let smtpExists = false;
          try {
            if (isUsingFallback) {
              smtpExists = !!fallbackStore.smtpSettings;
            } else {
              const res = await pool.query(
                "SELECT id_uuid FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1",
                [tenantId]
              );
              smtpExists = res.rows.length > 0;
            }
          } catch (e) {
            console.error("[WorkflowExecutor] Fehler bei der Überprüfung der SMTP-Einstellungen:", e);
          }

          const isProduction = process.env.NODE_ENV === "production";
          const shouldSendDirectly = workflow.direct_send_email === true && (!isProduction || smtpExists);

          if (shouldSendDirectly) {
            try {
              await this.handleMailingAktion(
                tenantId,
                initialPayload as Record<string, unknown>,
                draftBody || llmResult || step.instruction,
                logEntry as Record<string, unknown>,
                draftSubject,
                draftAttachments,
                instance.id_uuid,
                llmResult
              );

              // Protokolliere Erfolg
              logEntry.mailing_status = "Erfolgreich direkt versendet via SMTP.";

            } catch (mailErr: unknown) {
              const errorMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
              console.error(`[WorkflowExecutor] Kritischer Fehler bei E-Mail-Versand (Instanz: ${instance.id_uuid}):`, mailErr);

              logEntry.mailing_error = errorMsg;
              logEntry.mailing_status = "Kritischer Abbruch: E-Mail konnte nicht zugestellt werden.";
              instance.execution_log.push(logEntry);

              // SYSTEM PROTECTION: Force abort!
              instance.status = "FAILED";
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "ERROR",
                details: `Automatischer Versand abgebrochen: E-Mail-Versand fehlgeschlagen (SMTP-Fehler: ${errorMsg}).`
              });

              await this.saveInstance(instance);

              // Throw error to also terminate the parent execute loop
              throw new Error(`Physikalisches Senden der Mail gescheitert: ${errorMsg}`);
            }
          } else {
            // Pause & Draft!
            const draftId = uuidv4();
            const payloadObj = (initialPayload && typeof initialPayload === "object") ? initialPayload as Record<string, unknown> : {};
            const data = (payloadObj.data && typeof payloadObj.data === "object") ? payloadObj.data as Record<string, unknown> : payloadObj;
            let emailTo = typeof data.email_address === "string" ? data.email_address : (typeof data.email === "string" ? data.email : "");
            if (!emailTo) {
              emailTo = this.extractEmailRecipient(llmResult);
            }

            if (isUsingFallback) {
              if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
              fallbackStore.mailDrafts.push({
                id_uuid: draftId,
                tenant_id: tenantId,
                workflow_instance_id: instance.id_uuid,
                recipient: emailTo || "no-recipient@crm.local",
                subject: draftSubject,
                body: draftBody || llmResult || step.instruction,
                attachments_json: draftAttachments,
                status: 'PENDING',
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
              saveFallbackStore();
            } else {
              try {
                await pool.query(`
                  INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, workflow_instance_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [
                  draftId,
                  tenantId,
                  instance.id_uuid,
                  emailTo || "no-recipient@crm.local",
                  draftSubject,
                  draftBody || llmResult || step.instruction,
                  JSON.stringify(draftAttachments),
                  'PENDING'
                ]);
              } catch (draftErr: unknown) {
                console.error("Failed to insert draft into Postgres database:", draftErr);
              }
            }

            logEntry.outputs = { text: llmResult };
            if (workflow.direct_send_email === true && isProduction && !smtpExists) {
              logEntry.mailing_status = `Direktversand übersprungen: SMTP-Konfiguration fehlt in Produktion. Entwurf erhoben. ID: ${draftId}. Freigabe ausstehend.`;
            } else {
              logEntry.mailing_status = `Entwurf erhoben. ID: ${draftId}. Freigabe ausstehend.`;
            }
            instance.execution_log.push(logEntry);

            instance.status = "WAITING_FOR_DRAFT_APPROVAL";
            if (workflow.direct_send_email === true && isProduction && !smtpExists) {
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "PAUSE",
                details: `Workflow wurde pausiert bei Schritt ${i + 1}. E-Mail-Entwurf (${draftId}) erfordert Freigabe, da kein SMTP in Produktion konfiguriert ist.`
              });
            } else {
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "PAUSE",
                details: `Workflow wurde pausiert bei Schritt ${i + 1}. E-Mail-Entwurf (${draftId}) erfordert Freigabe.`
              });
            }
            await this.saveInstance(instance);
            console.log(`[WorkflowExecutor] ⏸️ Pausing workflow for draft approval. Instance: ${instance.id_uuid}, Draft: ${draftId}`);
            return; // EXIT execution method immediately!
          }
        } else if (step.tool === "AddLabel" || step.tool === "UpdateContactLabels") {
          try {
            await this.handleLabelingAktion(tenantId, initialPayload, llmResult || step.instruction, logEntry);
          } catch (lblErr: unknown) {
            logEntry.label_error = lblErr instanceof Error ? lblErr.message : String(lblErr);
          }
        } else if (step.tool === "CreateEntityNote" || step.tool === "AddNote") {
          try {
            await this.handleNotingAktion(tenantId, initialPayload, llmResult || step.instruction, logEntry);
          } catch (noteErr: unknown) {
            logEntry.note_error = noteErr instanceof Error ? noteErr.message : String(noteErr);
          }
        } else if (
          step.tool === "get_templates" || step.tool === "executeGetTemplates" ||
          step.tool === "get_template_details" || step.tool === "executeGetTemplateDetails" ||
          step.tool === "apply_template" || step.tool === "executeApplyTemplate"
        ) {
          try {
            const { executeGetTemplates, executeGetTemplateDetails, executeApplyTemplate } = await import("./tools/templates.js");
            let rawResult: unknown = "";
            if (step.tool === "get_templates" || step.tool === "executeGetTemplates") {
              rawResult = await executeGetTemplates(tenantId, step.instruction);
            } else if (step.tool === "get_template_details" || step.tool === "executeGetTemplateDetails") {
              rawResult = await executeGetTemplateDetails(tenantId, step.instruction);
            } else if (step.tool === "apply_template" || step.tool === "executeApplyTemplate") {
              rawResult = await executeApplyTemplate(tenantId, step.instruction);
            }
            logEntry.outputs = { text: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult) };
          } catch (tmplErr: unknown) {
            logEntry.tool_error = tmplErr instanceof Error ? tmplErr.message : String(tmplErr);
          }
        } else if (
          step.tool === "create_note_draft" || step.tool === "executeCreateNoteDraft" ||
          step.tool === "vault_search" || step.tool === "executeVaultSearch" ||
          step.tool === "vault_read" || step.tool === "executeVaultRead" ||
          step.tool === "list_vault_files" || step.tool === "executeListVaultFiles" ||
          step.tool === "recall_sessions" || step.tool === "executeRecallSessions" ||
          step.tool === "update_memory" || step.tool === "executeUpdateMemory" ||
          step.tool === "save_skill" || step.tool === "executeSaveSkill" ||
          step.tool === "get_workflows" || step.tool === "executeGetWorkflows" ||
          step.tool === "learn_workflow" || step.tool === "executeLearnWorkflow" ||
          step.tool === "delegate_subtask" || step.tool === "executeDelegateSubtask" ||
          step.tool === "ask_user_question" || step.tool === "executeAskUserQuestion" ||
 // G2–G8 : Update-Tools, Notizen-Vollverwaltung, Kanban-Board, Mail-Drafts, Vault-Writes
          step.tool === "update_company_draft" || step.tool === "executeUpdateDraftCompany" ||
          step.tool === "update_contact_draft" || step.tool === "executeUpdateDraftContact" ||
          step.tool === "update_invoice_draft" || step.tool === "executeUpdateDraftInvoice" ||
          step.tool === "update_offer_draft" || step.tool === "executeUpdateDraftOffer" ||
          step.tool === "list_notes" || step.tool === "executeListNotes" ||
          step.tool === "update_note" || step.tool === "executeUpdateNote" ||
          step.tool === "delete_note" || step.tool === "executeDeleteNote" ||
          step.tool === "create_kanban_board" || step.tool === "executeCreateKanbanBoard" ||
          step.tool === "list_mail_drafts" || step.tool === "executeListMailDrafts" ||
          step.tool === "vault_write" || step.tool === "executeVaultWrite" ||
          step.tool === "vault_update" || step.tool === "executeVaultUpdate" ||
          step.tool === "vault_delete" || step.tool === "executeVaultDelete" ||
 // P1: neue knowledge_*-Namen (Alias neben den vault_-Namen)
          step.tool === "knowledge_write" || step.tool === "executeKnowledgeWrite" ||
          step.tool === "knowledge_update" || step.tool === "executeKnowledgeUpdate" ||
          step.tool === "knowledge_delete" || step.tool === "executeKnowledgeDelete" ||
          step.tool === "knowledge_search" || step.tool === "executeKnowledgeSearch" ||
          step.tool === "list_knowledge_files" || step.tool === "executeListKnowledgeFiles"
        ) {
 // 4A: Zusätzliche Wissens-/Vault-/Memory-Tools als Workflow-Schritte
          try {
            const knowledgeMod = await import("./tools/knowledge.js");
            const crmMod = await import("./tools/crm.js");
            const vaultStore = await import("./vaultStore.js");
            let rawResult: unknown = "";

            if (step.tool === "create_note_draft" || step.tool === "executeCreateNoteDraft") {
              // /N3 (V2-2-Klasse): Workflow-Schritt persistiert die Notiz WIRKLICH
              // (bypassApproval=true, wie alle Workflow-Schreib-Tools) — vorher No-Op.
              // FIX B-059-3 (060 P0): Instruktion NACH JSON wrappen — die Funktion
              // erwartet { contact_id_uuid?, company_id_uuid?, note_text, priority? };
              // rohe Klartext-Instruktion scheiterte still bei JSON.parse (DAG-Pfad
              // macht es korrekt, workflowGraphExecutor Z.496-500).
              const noteArgs = toNoteDraftJson(step.instruction || "{}");
              const r = await crmMod.executeCreateNoteDraft(tenantId, noteArgs, "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "vault_search" || step.tool === "executeVaultSearch") {
              rawResult = JSON.stringify(await vaultStore.vaultSearch(tenantId, step.instruction || "", 5));
            } else if (step.tool === "vault_read" || step.tool === "executeVaultRead") {
              const rel = (step.instruction || "").trim().replace(/^path[:：]\s*/i, "");
              rawResult = JSON.stringify(await vaultStore.vaultReadText(tenantId, rel));
            } else if (step.tool === "list_vault_files" || step.tool === "executeListVaultFiles"
              || step.tool === "list_knowledge_files" || step.tool === "executeListKnowledgeFiles") {
              const r = await knowledgeMod.executeListVaultFiles(tenantId);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "recall_sessions" || step.tool === "executeRecallSessions") {
              const r = await knowledgeMod.executeRecallSessions(tenantId, step.instruction || "");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_memory" || step.tool === "executeUpdateMemory") {
              // Memory-Update: bestehende Präferenzen laden, dann merge + speichern
              const mem = await vaultStore.readUserMemoryVault(tenantId, "ai_workflow");
              let prefs = mem?.response_preferences_text || "";
              let notes = mem?.chat_notes_json || [];
              try {
                const parsed = JSON.parse(step.instruction || "{}");
                if (parsed.preference) prefs = prefs ? `${prefs}\n${parsed.preference}` : parsed.preference;
                if (parsed.note) notes = [...notes, { id_uuid: uuidv4(), content: String(parsed.note), created_at_utc: new Date().toISOString() }];
              } catch { /* Freitext → als Präferenz */ if (step.instruction) prefs = prefs ? `${prefs}\n${step.instruction}` : step.instruction; }
              const saved = await vaultStore.writeUserMemoryVault(tenantId, "ai_workflow", {
                response_preferences_text: prefs,
                frequently_used_tools_json: mem?.frequently_used_tools_json || [],
                chat_notes_json: notes
              });
              rawResult = JSON.stringify(saved);
            } else if (step.tool === "save_skill" || step.tool === "executeSaveSkill") {
              // Konsistent mit AgentRuntime (S10): save_skill läuft IMMER über den Freigabe-Flow.
              // Im Workflow-Kontext gibt es keinen Chat-Freigabe-Kanal → Schritt validiert und
              // protokolliert den Skill-Vorschlag im Log statt direkt zu schreiben.
              let skillName = "Workflow-Skill";
              let skillContent = step.instruction || "";
              try {
                const parsed = JSON.parse(step.instruction || "{}");
                skillName = parsed.name || skillName;
                skillContent = parsed.content || parsed.description || skillContent;
              } catch { /* Freitext → Inhalt */ }
              rawResult = JSON.stringify({
                status: "VORSCHLAG",
                name: skillName,
                hint: "Wissens-Skill-Vorschlag protokolliert — Freigabe über Chat erforderlich (save_skill schreibt nie direkt).",
                content_preview: String(skillContent).slice(0, 200)
              });
            } else if (step.tool === "get_workflows" || step.tool === "executeGetWorkflows") {
              const r = await knowledgeMod.executeWorkflowMacro(tenantId, "get_workflows", "{}");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "learn_workflow" || step.tool === "executeLearnWorkflow") {
              const r = await knowledgeMod.executeLearnWorkflow(tenantId, step.instruction || "");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_company_draft" || step.tool === "executeUpdateDraftCompany") {
 // G2 + B3 : Workflow schreibt direkt (bypass)
              const r = await crmMod.executeUpdateDraftCompany(tenantId, step.instruction || "{}", "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_contact_draft" || step.tool === "executeUpdateDraftContact") {
 // G2 + B3 : Workflow schreibt direkt (bypass)
              const r = await crmMod.executeUpdateDraftContact(tenantId, step.instruction || "{}", "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_invoice_draft" || step.tool === "executeUpdateDraftInvoice") {
 // G5 + B3 : Workflow schreibt direkt (bypass)
              const r = await crmMod.executeUpdateDraftInvoice(tenantId, step.instruction || "{}", "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_offer_draft" || step.tool === "executeUpdateDraftOffer") {
 // G6 + B3 : Workflow schreibt direkt (bypass)
              const r = await crmMod.executeUpdateDraftOffer(tenantId, step.instruction || "{}", "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "list_notes" || step.tool === "executeListNotes") {
 // G4 
              const r = await crmMod.executeListNotes(tenantId, step.instruction || "{}");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "update_note" || step.tool === "executeUpdateNote") {
 // G4 
              const r = await crmMod.executeUpdateNote(tenantId, step.instruction || "{}", "ai_workflow");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "delete_note" || step.tool === "executeDeleteNote") {
 // G4 
              const r = await crmMod.executeDeleteNote(tenantId, step.instruction || "{}", "ai_workflow");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "create_kanban_board" || step.tool === "executeCreateKanbanBoard") {
 // G3: Workflow-Pfad schreibt direkt (bypassApproval=true)
              const r = await crmMod.executeCreateKanbanBoard(tenantId, step.instruction || "{}", "ai_workflow", true);
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "list_mail_drafts" || step.tool === "executeListMailDrafts") {
 // G7 
              const messagingMod = await import("./tools/messaging.js");
              const r = await messagingMod.executeListMailDrafts(tenantId, step.instruction || "{}");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "vault_write" || step.tool === "executeVaultWrite"
              || step.tool === "knowledge_write" || step.tool === "executeKnowledgeWrite") {
 // G8 
              const r = await knowledgeMod.executeVaultWrite(tenantId, step.instruction || "{}", "ai_workflow");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "vault_update" || step.tool === "executeVaultUpdate"
              || step.tool === "knowledge_update" || step.tool === "executeKnowledgeUpdate") {
 // G8 
              const r = await knowledgeMod.executeVaultUpdate(tenantId, step.instruction || "{}", "ai_workflow");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "vault_delete" || step.tool === "executeVaultDelete"
              || step.tool === "knowledge_delete" || step.tool === "executeKnowledgeDelete") {
 // G8 
              const r = await knowledgeMod.executeVaultDelete(tenantId, step.instruction || "{}", "ai_workflow");
              rawResult = typeof r === "string" ? r : JSON.stringify(r);
            } else if (step.tool === "delegate_subtask" || step.tool === "executeDelegateSubtask") {
 // 4A T1-Nachtrag (B1): Sub-Agent-Delegation über globalAgentRuntime
              const { runSubTasksStandalone } = await import("./agentRuntime.js");
              const results = await runSubTasksStandalone(tenantId, "ai_workflow", config, step.instruction || "{}", "de");
              rawResult = JSON.stringify(results.map((r) => ({
                subtask_id: r.subtask_id,
                status: r.status,
                final_text: (r.final_text || "").slice(0, 500),
                tool_trace: r.tool_trace,
                error: r.error
              })));
            } else if (step.tool === "ask_user_question" || step.tool === "executeAskUserQuestion") {
 // 4A T1-Nachtrag (A1): persistierte Rückfrage → Workflow pausiert
              // (PENDING_QUESTION), Resume im Scheduler-Tick sobald die Frage beantwortet ist.
              // Idempotenz: Wenn diese Instanz bereits auf eine offene Frage wartet, KEINE neue
              // Frage anlegen — nur erneut pausieren (Schutz gegen Doppel-Anlage beim Resume).
              if (instance.status === "PENDING_QUESTION" && instance.pending_question_id) {
                logEntry.outputs = { text: `Warte weiter auf Antwort der Rückfrage ${instance.pending_question_id}.` };
                logEntry.question_id = instance.pending_question_id;
                instance.execution_log.push(logEntry);
                await this.saveInstance(instance);
                return;
              }
              let question = step.instruction || "Bitte bestätige den nächsten Schritt.";
              let choices: string[] = [];
              let ctxText = `workflow:${workflow.id_uuid}`;
              try {
                const parsed = JSON.parse(step.instruction || "{}");
                if (parsed.question) question = String(parsed.question);
                if (Array.isArray(parsed.choices)) choices = parsed.choices.map(String);
                if (parsed.context) ctxText = String(parsed.context);
              } catch { /* Freitext → Frage */ }
              const qId = uuidv4();
              if (isUsingFallback || !pool) {
                if (!fallbackStore.aiQuestions) fallbackStore.aiQuestions = [];
                fallbackStore.aiQuestions.push({
                  id_uuid: qId, tenant_id: tenantId, question,
                  choices_json: JSON.stringify(choices), context_text: ctxText,
                  status: "OPEN", answer: "", created_by: "ai_workflow",
                  created_at_utc: new Date().toISOString(), answered_at_utc: null
                });
                saveFallbackStore();
              } else {
                await pool.query(
                  `INSERT INTO sys_louis_ai_questions (id_uuid, tenant_id, question, choices_json, context_text, status, created_by)
                   VALUES ($1, $2, $3, $4::jsonb, $5, 'OPEN', 'ai_workflow')`,
                  [qId, tenantId, question, JSON.stringify(choices), ctxText]
                );
              }
              logEntry.outputs = { text: `Rückfrage gespeichert (ID ${qId}). Warte auf Antwort im Dashboard.` };
              logEntry.question_id = qId;
              instance.execution_log.push(logEntry);
              instance.status = "PENDING_QUESTION";
              instance.current_step_index = i;
              instance.pending_question_id = qId;
              await this.saveInstance(instance);
              console.log(`[WorkflowExecutor] ❓ Workflow ${instance.id_uuid} pausiert (PENDING_QUESTION ${qId}). Warte auf Antwort.`);
              return; // EXIT bis Antwort (Resume im Scheduler-Tick)
            }
            logEntry.outputs = { text: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult) };
          } catch (wfToolErr: unknown) {
            logEntry.tool_error = wfToolErr instanceof Error ? wfToolErr.message : String(wfToolErr);
          }
        } else if (
          step.tool === "create_invoice_draft" || step.tool === "executeCreateDraftInvoice" ||
          step.tool === "create_company_draft" || step.tool === "executeCreateDraftCompany" ||
          step.tool === "create_contact_draft" || step.tool === "executeCreateDraftContact" ||
          step.tool === "create_offer_draft" || step.tool === "executeCreateDraftOffer" ||
          step.tool === "finalize_and_send_offer" || step.tool === "executeFinalizeAndSendOffer" ||
          step.tool === "list_kanban_boards" || step.tool === "executeListKanbanBoards" ||
          step.tool === "get_kanban_board_details" || step.tool === "executeGetKanbanBoardDetails" ||
          step.tool === "create_kanban_card" || step.tool === "executeCreateKanbanCard" ||
          step.tool === "move_kanban_card" || step.tool === "executeMoveKanbanCard" ||
          step.tool === "update_kanban_card" || step.tool === "executeUpdateKanbanCard" ||
          step.tool === "delete_kanban_card" || step.tool === "executeDeleteKanbanCard"
        ) {
          try {
            let schemaInstructions = "";
            if (step.tool.includes("invoice")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "company_id": "optional string (UUID or matching name/ID from previous results)",
  "contact_id": "optional string (UUID or matching name/ID from previous results)",
  "is_vat_inclusive": boolean,
  "items_list": [
    {
      "description": "string",
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "unit_code": "optional string, defaults to HUR"
    }
  ],
  "introductory_text": "optional string",
  "closing_text": "optional string",
  "payment_term": "optional string representing days, e.g. 14"
}`;
            } else if (step.tool.includes("company")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "full_legal_name": "string",
  "tax_vat_id": "optional string",
  "tax_number": "optional string",
  "street": "optional string",
  "city": "optional string",
  "postal_code": "optional string",
  "email_address": "optional string",
  "responsible_person": "optional string"
}`;
            } else if (step.tool.includes("contact")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "first_name": "string",
  "last_name": "string",
  "full_legal_name": "optional string",
  "salutation": "optional string",
  "email_address": "optional string",
  "phone_number": "optional string",
  "associated_company_id": "optional string or UUID"
}`;
            } else if (step.tool.includes("offer") && (step.tool.includes("finalize") || step.tool.includes("send"))) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "offer_id_uuid": "string (UUID from previous results or context)",
  "direct_send": boolean (optional, default false)
}`;
            } else if (step.tool.includes("offer")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "title": "string (Angebotstitel, e.g. 'Angebot für Website-Erstellung')",
  "associated_company_id": "optional string (UUID)",
  "associated_contact_id": "optional string (UUID)",
  "introductory_text": "optional string",
  "closing_text": "optional string",
  "issue_date": "optional string in YYYY-MM-DD format",
  "valid_until": "optional string in YYYY-MM-DD format",
  "payment_term": "optional string",
  "currency_code": "optional string, defaults to EUR",
  "is_vat_inclusive": boolean (optional),
  "line_items": [
    {
      "position": number,
      "description": "optional string",
      "quantity": number,
      "unit_price": number,
      "vat_rate": number,
      "unit_code": "optional string, defaults to HUR"
    }
  ]
}`;
            } else if (step.tool.includes("create") && step.tool.includes("kanban")) {
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
            } else if (step.tool.includes("move") && step.tool.includes("kanban")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "target_column_id_uuid": "optional string (UUID)",
  "target_column_title": "optional string (Titel der Zielspalte)",
  "new_position": number (optional, default 0)
}`;
            } else if (step.tool.includes("update") && step.tool.includes("kanban")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der Karte)",
  "title": "optional string",
  "description": "optional string",
  "priority": "optional string ('low' | 'medium' | 'high' | 'urgent')",
  "due_date": "optional string (ISO 8601 Datum)",
  "labels": ["optional array of strings"]
}`;
            } else if (step.tool.includes("delete") && step.tool.includes("kanban")) {
              schemaInstructions = `Generate a JSON object matching this schema:
{
  "card_id_uuid": "string (UUID der zu löschenden Karte)"
}`;
            }

            const argSynthesizerPrompt = `
You are compiling structured JSON arguments for the tool "${step.tool}".
The instruction for this step is: "${step.instruction}"

Context from the current workflow execution:
${JSON.stringify(instance.execution_log, null, 2)}
Initial payload:
${JSON.stringify(initialPayload, null, 2)}

Requirements:
${schemaInstructions}

IMPORTANT: Output ONLY a valid raw JSON object. Do not wrap in markdown code blocks like \`\`\`json. Do not explain anything. Just output the valid raw JSON object.
`;

            const synthesizedArgs = await generateContentUniversal({
              provider_type: config.provider_type,
              model_name: config.model_name,
              api_key_secret: config.api_key_secret,
              base_url: config.base_url,
              contents: argSynthesizerPrompt,
              systemInstruction: "Du bist eine deterministische Logik-Engine. Gib ausschließlich JSON aus."
            });

            let cleanSynthesizedArgs = synthesizedArgs.text.trim();
            if (cleanSynthesizedArgs.startsWith("```")) {
              cleanSynthesizedArgs = cleanSynthesizedArgs.replace(/^```[a-zA-Z0-9]*\s*/, "");
              cleanSynthesizedArgs = cleanSynthesizedArgs.replace(/\s*```$/, "");
            }
            cleanSynthesizedArgs = cleanSynthesizedArgs.trim();

            let rawResult: unknown = "";
            const { 
              executeCreateDraftInvoice, 
              executeCreateDraftCompany, 
              executeCreateDraftContact,
              executeCreateDraftOffer,
              executeFinalizeAndSendOffer,
              executeListKanbanBoards,
              executeGetKanbanBoardDetails,
              executeCreateKanbanCard,
              executeMoveKanbanCard,
              executeUpdateKanbanCard,
              executeDeleteKanbanCard
            } = await import("./tools/crm.js");

            if (step.tool === "create_invoice_draft" || step.tool === "executeCreateDraftInvoice") {
              rawResult = await executeCreateDraftInvoice(tenantId, cleanSynthesizedArgs, "ai_workflow", true);
            } else if (step.tool === "create_company_draft" || step.tool === "executeCreateDraftCompany") {
              rawResult = await executeCreateDraftCompany(tenantId, cleanSynthesizedArgs, "ai_workflow", true);
            } else if (step.tool === "create_contact_draft" || step.tool === "executeCreateDraftContact") {
              rawResult = await executeCreateDraftContact(tenantId, cleanSynthesizedArgs, "ai_workflow", true);
            } else if (step.tool === "create_offer_draft" || step.tool === "executeCreateDraftOffer") {
              rawResult = await executeCreateDraftOffer(tenantId, cleanSynthesizedArgs, "ai_workflow", true);
            } else if (step.tool === "finalize_and_send_offer" || step.tool === "executeFinalizeAndSendOffer") {
              rawResult = await executeFinalizeAndSendOffer(tenantId, cleanSynthesizedArgs, "ai_workflow");
            } else if (step.tool === "list_kanban_boards" || step.tool === "executeListKanbanBoards") {
              rawResult = await executeListKanbanBoards(tenantId, cleanSynthesizedArgs);
            } else if (step.tool === "get_kanban_board_details" || step.tool === "executeGetKanbanBoardDetails") {
              rawResult = await executeGetKanbanBoardDetails(tenantId, cleanSynthesizedArgs);
            } else if (step.tool === "create_kanban_card" || step.tool === "executeCreateKanbanCard") {
              rawResult = await executeCreateKanbanCard(tenantId, cleanSynthesizedArgs, "ai_workflow");
            } else if (step.tool === "move_kanban_card" || step.tool === "executeMoveKanbanCard") {
              rawResult = await executeMoveKanbanCard(tenantId, cleanSynthesizedArgs, "ai_workflow");
            } else if (step.tool === "update_kanban_card" || step.tool === "executeUpdateKanbanCard") {
              rawResult = await executeUpdateKanbanCard(tenantId, cleanSynthesizedArgs, "ai_workflow");
            } else if (step.tool === "delete_kanban_card" || step.tool === "executeDeleteKanbanCard") {
              rawResult = await executeDeleteKanbanCard(tenantId, cleanSynthesizedArgs, "ai_workflow");
            }

            logEntry.outputs = { text: typeof rawResult === "string" ? rawResult : JSON.stringify(rawResult), synthesizedArgs: cleanSynthesizedArgs };
          } catch (execErr: unknown) {
            const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
            logEntry.tool_error = errorMsg;
            logEntry.outputs = { text: `Fehler bei Ausführung von ${step.tool}: ${errorMsg}` };
          }
        }

        instance.execution_log.push(logEntry);
        await this.saveInstance(instance);
      }

      instance.status = "COMPLETED";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "TERM",
        details: "Workflow erfolgreich abgeschlossen."
      });
      await this.saveInstance(instance);
      console.log(`[WorkflowExecutor] ✅ Workflow completed: ${instanceId}`);

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowExecutor] ❌ Critical failure during execution of instance ${instanceId}:`, err);
      instance.status = "FAILED";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "ERROR",
        details: `Kritischer Abbruch: ${errMsg}`
      });
      await this.saveInstance(instance);
    }
  }

  /**
   * Safe parser to extract and clean nested/surrounded Markdown JSON output from LLM results.
   */
  private parseLlmResultSafe(llmResult: string): LlmResultStructure | null {
    if (!llmResult) return null;
    let cleaned = llmResult.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\s*/g, "").replace(/\s*```$/g, "").trim();
    }
    try {
      return JSON.parse(cleaned) as LlmResultStructure;
    } catch (e) {
      const startIdx = cleaned.indexOf("{");
      const endIdx = cleaned.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        try {
          return JSON.parse(cleaned.substring(startIdx, endIdx + 1)) as LlmResultStructure;
        } catch (_) {}
      }
    }
    return null;
  }

  /**
   * Sends a real/simulated email based on SMTP environment nodes.
   */
  private async handleMailingAktion(
    tenantId: string,
    payload: Record<string, unknown> | null | undefined,
    bodyContent: string,
    logEntry: Record<string, unknown>,
    subject?: string,
    attachments?: unknown[],
    workflowInstanceId?: string,
    llmResult?: string
  ) {
    const payloadObj = (payload && typeof payload === "object") ? payload : {};
    const data = (payloadObj.data && typeof payloadObj.data === "object") ? payloadObj.data as Record<string, unknown> : payloadObj;
    let emailTo = typeof data.email_address === "string" ? data.email_address : (typeof data.email === "string" ? data.email : "");
    if (!emailTo && llmResult) {
      emailTo = this.extractEmailRecipient(llmResult);
    }

    if (!emailTo) {
      logEntry.mailing_status = "Skipped: Keine Empfänger-E-Mail-Adresse im Payload gefunden.";
      return;
    }

    // Attempt to load SMTP Config
    let smtp: SmtpSettings | null = null;
    if (isUsingFallback) {
      smtp = fallbackStore.smtpSettings;
    } else {
      const res = await pool.query(
        "SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      smtp = res.rows[0];
    }

    if (!smtp) {
      logEntry.mailing_status = `Simuliert: Mail an ${emailTo} gedraftet, da kein SMTP konfiguriert ist. Inhalt: ${bodyContent.substring(0, 100)}`;
      try {
        await ingestEmailToRag({
          tenantId,
          recipient: emailTo,
          senderType: "AI",
          subject: subject || `Automatisierte Benachrichtigung (Louis Smart CRM Workflow)`,
          body: bodyContent,
          attachments: attachments,
          workflowInstanceId
        });
      } catch (ragErr) {
        console.error("[WorkflowExecutor] Failed to ingest simulated mail to RAG:", ragErr);
      }
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.smtp_host_name,
      port: smtp.smtp_port_number,
      secure: smtp.is_secure_connection,
      auth: {
        user: smtp.smtp_user_name,
        pass: smtp.smtp_password_secret,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    let recipientName = "";
    if (typeof data.full_legal_name === "string") {
      recipientName = data.full_legal_name;
    } else if (typeof data.name === "string") {
      recipientName = data.name;
    } else if (typeof data.first_name === "string" || typeof data.last_name === "string") {
      recipientName = `${typeof data.first_name === "string" ? data.first_name : ""} ${typeof data.last_name === "string" ? data.last_name : ""}`.trim();
    }

    if (!recipientName && emailTo) {
      if (isUsingFallback) {
        const foundCo = fallbackStore.companies.find(c => c.email_address?.toLowerCase() === emailTo.toLowerCase());
        const foundCt = fallbackStore.contacts.find(c => c.email_address?.toLowerCase() === emailTo.toLowerCase());
        recipientName = foundCt ? (foundCt.full_legal_name || `${foundCt.first_name || ""} ${foundCt.last_name || ""}`.trim()) : (foundCo ? foundCo.full_legal_name : "");
      } else {
        const ctRes = await pool.query("SELECT full_legal_name, first_name, last_name FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) LIMIT 1", [emailTo]);
        if (ctRes.rows[0]) {
          const row = ctRes.rows[0];
          recipientName = row.full_legal_name || `${row.first_name || ""} ${row.last_name || ""}`.trim();
        } else {
          const coRes = await pool.query("SELECT full_legal_name FROM core_registry_companies WHERE LOWER(email_address) = LOWER($1) LIMIT 1", [emailTo]);
          if (coRes.rows[0]) {
            recipientName = coRes.rows[0].full_legal_name;
          }
        }
      }
    }

    const compilation = EmailCompiler.compile(bodyContent, {
      subject: subject || `Automatisierte Benachrichtigung (Louis Smart CRM Workflow)`,
      senderName: smtp.sender_display_name || "Louis CRM",
      recipientName: recipientName || undefined,
      lang: "de"
    });

    const mailOptions = {
      from: smtp.sender_display_name 
        ? `"${smtp.sender_display_name}" <${smtp.sender_email_address || smtp.smtp_user_name}>` 
        : smtp.smtp_user_name,
      to: emailTo,
      subject: subject || `Automatisierte Benachrichtigung (Louis Smart CRM Workflow)`,
      text: compilation.text,
      html: compilation.html,
      attachments: Array.isArray(attachments) ? attachments.map((att: unknown) => {
        if (typeof att === "string") {
          const resolvedPath = resolveAttachmentPhysicalPath(tenantId, att);
          return { 
            filename: resolvedPath ? path.basename(resolvedPath).replace(/^\d+_/g, "") : att, 
            path: resolvedPath || att 
          };
        } else if (att && typeof att === "object") {
          const attObj = att as Record<string, unknown>;
          const filename = typeof attObj.filename === "string" ? attObj.filename : "Anhang";
          const source = typeof attObj.source === "string" ? attObj.source : undefined;
          const entityId = typeof attObj.entity_id === "string" ? attObj.entity_id : undefined;
          const entityType = typeof attObj.entity_type === "string" ? attObj.entity_type : undefined;

          const resolvedPath = resolveAttachmentPhysicalPath(
            tenantId,
            filename,
            source,
            entityId,
            entityType
          );

          return {
            filename: filename,
            path: resolvedPath || (typeof attObj.path === "string" ? attObj.path : undefined),
            content: typeof attObj.content === "string" ? attObj.content : undefined
          };
        }
        return {};
      }).filter((item: { path?: string; content?: string }) => item.path || item.content) : undefined
    };

    await transporter.sendMail(mailOptions);
    try {
      await ingestEmailToRag({
        tenantId,
        recipient: emailTo,
        senderType: "AI",
        subject: mailOptions.subject,
        body: bodyContent,
        attachments: mailOptions.attachments,
        workflowInstanceId
      });
    } catch (ragErr) {
      console.error("[WorkflowExecutor] Failed to ingest sent mail to RAG:", ragErr);
    }
    logEntry.mailing_status = `Erfolgreich gesendet: Mail an ${emailTo} via SMTP Server.`;
  }

  /**
   * Helper to parse and extract email body safely from the step's outcome or preceding log entries.
   */
  private extractEmailBody(llmResult: string, executionLog: WorkflowExecutionLogEntry[]): string {
    const cleanOutput = (text: string): string => text.trim();

    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.body === "string") {
            return cleanOutput(details.body);
          }
          if (typeof details.text === "string") {
            return cleanOutput(details.text);
          }
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object" && typeof detailsOut.body === "string") {
            return cleanOutput(detailsOut.body);
          }
          if (typeof outputs.body === "string") {
            return cleanOutput(outputs.body);
          }
          if (typeof outputs.text === "string") {
            return cleanOutput(outputs.text);
          }
        }
        
        const output = target.output as Record<string, unknown> | undefined;
        if (output && typeof output === "object" && typeof output.generated_text === "string") {
          return cleanOutput(output.generated_text);
        }
        if (typeof target.generated_text === "string") {
          return cleanOutput(target.generated_text);
        }
        
        if (typeof target.email_body_content === "string") {
          return cleanOutput(target.email_body_content);
        }
        if (typeof target.body === "string") {
          return cleanOutput(target.body);
        }
        if (typeof target.text === "string") {
          return cleanOutput(target.text);
        }
      }
    } catch (e) {
      // Not JSON, that's fine
    }

    // Look backward in execution log for previous step outputs (e.g. general text generator output or prompt result)
    for (let i = executionLog.length - 1; i >= 0; i--) {
      const entry = executionLog[i];
      if (entry.outputs && typeof entry.outputs === "object") {
        const textVal = entry.outputs.text;
        if (typeof textVal === "string" && textVal.trim().length > 0) {
          const trimmed = textVal.trim();
          try {
            const parsedPrev = this.parseLlmResultSafe(trimmed);
            if (parsedPrev && typeof parsedPrev === "object") {
              const output = parsedPrev.output as Record<string, unknown> | undefined;
              if (output && typeof output === "object" && typeof output.generated_text === "string") {
                return cleanOutput(output.generated_text);
              }
              if (typeof parsedPrev.generated_text === "string") {
                return cleanOutput(parsedPrev.generated_text);
              }
              if (typeof parsedPrev.body === "string") {
                return cleanOutput(parsedPrev.body);
              }
              if (typeof parsedPrev.text === "string") {
                return cleanOutput(parsedPrev.text);
              }
            }
          } catch (_) {}
          
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            return trimmed;
          }
        }
      }
    }

    if (llmResult && !llmResult.trim().startsWith("{")) {
      return llmResult.trim();
    }

    return "";
  }

  /**
   * Helper to parse and extract email subject from LLM response.
   */
  private extractEmailSubject(llmResult: string, workflowName: string): string {
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.subject === "string") {
            return details.subject;
          }
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object" && typeof detailsOut.subject === "string") {
            return detailsOut.subject;
          }
          if (typeof outputs.subject === "string") {
            return outputs.subject;
          }
        }
        if (typeof target.email_subject_text === "string") {
          return target.email_subject_text;
        }
        if (typeof target.subject === "string") {
          return target.subject;
        }
      }
    } catch (e) {}
    return `Automatische Benachrichtigung (${workflowName})`;
  }

  /**
   * Helper to parse and extract email recipient from LLM response.
   */
  private extractEmailRecipient(llmResult: string): string {
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.recipient === "string") return details.recipient.trim();
          if (typeof details.recipient_email_address === "string") return details.recipient_email_address.trim();
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object") {
            if (typeof detailsOut.recipient === "string") return detailsOut.recipient.trim();
            if (typeof detailsOut.recipient_email_address === "string") return detailsOut.recipient_email_address.trim();
          }
          if (typeof outputs.recipient === "string") return outputs.recipient.trim();
          if (typeof outputs.recipient_email_address === "string") return outputs.recipient_email_address.trim();
        }

        if (typeof target.recipient === "string") return target.recipient.trim();
        if (typeof target.recipient_email_address === "string") return target.recipient_email_address.trim();
      }
    } catch (e) {}
    return "";
  }

  /**
   * Helper to parse and extract email attachments list from LLM response.
   */
  private extractAttachments(llmResult: string): MailDraftAttachment[] {
    const list: MailDraftAttachment[] = [];
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        let atts: unknown = undefined;
        if (details && typeof details === "object" && Array.isArray(details.attachments)) {
          atts = details.attachments;
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (!atts) {
          if (outputs && typeof outputs === "object") {
            const detailsOut = outputs.details as Record<string, unknown> | undefined;
            if (detailsOut && typeof detailsOut === "object" && Array.isArray(detailsOut.attachments)) {
              atts = detailsOut.attachments;
            } else if (Array.isArray(outputs.attachments)) {
              atts = outputs.attachments;
            }
          } else if (Array.isArray(target.attachments)) {
            atts = target.attachments;
          }
        }

        if (Array.isArray(atts)) {
          for (const item of atts) {
            if (item && typeof item === "object") {
              const itemObj = item as Record<string, unknown>;
              const sourceVal = (itemObj.source === "knowledge" || itemObj.source === "vault") ? itemObj.source : "knowledge";
              
              if (typeof itemObj.filename === "string") {
                list.push({
                  filename: itemObj.filename,
                  source: sourceVal,
                  entity_id: typeof itemObj.entity_id === "string" ? itemObj.entity_id : undefined,
                  entity_type: (itemObj.entity_type === "companies" || itemObj.entity_type === "contacts") ? itemObj.entity_type : undefined,
                  filePath: typeof itemObj.filePath === "string" ? itemObj.filePath : undefined
                });
              }
            }
          }
        }
      }
    } catch (e) {}
    return list;
  }

  /**
   * Appends label to contact when workflow is run.
   */
  private async handleLabelingAktion(tenantId: string, payload: Record<string, unknown> | null | undefined, labelContent: string, logEntry: Record<string, unknown>) {
    const data = payload?.data as Record<string, unknown> | undefined || payload;
    const contactId = data?.id_uuid || data?.associated_contact_id || "";

    if (!contactId) {
      logEntry.label_status = "Skipped: Keine gültige Contact-UUID im Payload ermittelt.";
      return;
    }

    // Extract tags from LLM response or instructions
    const matchedLabel = labelContent.replace(/[^a-z0-9\s_-]/gi, "").trim().split(/\s+/)[0] || "PROCESSED";
    
    if (isUsingFallback) {
      const contact = fallbackStore.contacts.find(c => c.id_uuid === contactId);
      if (contact) {
        if (!contact.labels) contact.labels = [];
        if (!contact.labels.includes(matchedLabel)) {
          contact.labels.push(matchedLabel);
          saveFallbackStore();
        }
        logEntry.label_status = `Label "${matchedLabel}" an Kontakt ${contact.full_legal_name} angeheftet.`;
      } else {
        logEntry.label_status = `Kontakt mit UUID "${contactId}" im FallbackStore nicht gefunden.`;
      }
    } else {
      const selectRes = await pool.query("SELECT labels_json, full_legal_name FROM core_registry_contacts WHERE id_uuid = $1", [contactId]);
      if (selectRes.rows.length > 0) {
        let currentLabels: string[] = [];
        try {
          const raw = selectRes.rows[0].labels_json;
          currentLabels = typeof raw === "string" ? JSON.parse(raw) : (raw || []);
        } catch (_) {}

        if (!currentLabels.includes(matchedLabel)) {
          currentLabels.push(matchedLabel);
          await pool.query(
            "UPDATE core_registry_contacts SET labels_json = $1 WHERE id_uuid = $2",
            [JSON.stringify(currentLabels), contactId]
          );
        }
        logEntry.label_status = `Label "${matchedLabel}" an Kontakt "${selectRes.rows[0].full_legal_name}" angeheftet (Postgres).`;
      } else {
        logEntry.label_status = `Kontakt mit UUID "${contactId}" in Postgres nicht gefunden.`;
      }
    }
  }

  /**
   * Appends note to target contact.
   */
  private async handleNotingAktion(tenantId: string, payload: Record<string, unknown> | null | undefined, noteContent: string, logEntry: Record<string, unknown>) {
    const data = payload?.data as Record<string, unknown> | undefined || payload;
    const contactId = (data?.id_uuid as string) || "";
    if (!contactId) {
      logEntry.note_status = "Skipped: Kontakt-UUID fehlt im Payload.";
      return;
    }
    
    // Check if noting is supported inside the CRM. We can log our note directly in the AuditLogs
    await logAuditEvent({
      tenantId,
      eventType: "UPDATE",
      entityType: "CONTACT",
      entityId: contactId,
      eventDetails: `Automatisierte Workflow-Notiz hinzugefügt: "${noteContent.substring(0, 200)}"`,
      actorIdentity: "assistant_workflow"
    });
    logEntry.note_status = `Notiz im AuditLog für Kontakt ${contactId} vermerkt.`;
  }

  /**
   * Helper parser to convert human-readable wait durations to seconds.
   */
  private parseWaitDurationToSeconds(instruction: string): number {
    if (!instruction) return 300;
    const normalized = instruction.toLowerCase().trim();

    // 1. Check hours
    const hourMatch = normalized.match(/(\d+)\s*(?:stund|hour|std|h\b)/i);
    if (hourMatch) {
      return parseInt(hourMatch[1], 10) * 3600;
    }

    // 2. Check minutes
    const minMatch = normalized.match(/(\d+)\s*(?:min|m\b)/i);
    if (minMatch) {
      return parseInt(minMatch[1], 10) * 60;
    }

    // 3. Check seconds
    const secMatch = normalized.match(/(\d+)\s*(?:sek|sec|s\b)/i);
    if (secMatch) {
      return parseInt(secMatch[1], 10);
    }

    // 4. Fallback search for any number
    const fallbackMatch = normalized.match(/(\d+)/);
    if (fallbackMatch) {
      const num = parseInt(fallbackMatch[1], 10);
      if (normalized.includes("min")) {
        return num * 60;
      }
      if (normalized.includes("stund") || normalized.includes("hour") || normalized.includes("std")) {
        return num * 3600;
      }
      return num;
    }

    return 300; // default fallback (5 minutes)
  }
}

export const workflowExecutor = new WorkflowExecutor();
