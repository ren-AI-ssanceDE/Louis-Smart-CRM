import { GoogleGenAI, Type, Schema } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { ModelUsageMetadata, CustomWorkflow, LouisAiKnowledgeMetadata, TenantAiConfig, ConversationMessage } from "../../types.js";
export type { ConversationMessage, TenantAiConfig };
import { generateContentSafe, generateContentUniversal } from "./geminiHelper.js";
import { containsToolCallXml, normalizeToolCallText } from "./toolCallSanitizer.js";
import { globalAgentRuntime } from "./agentRuntime.js";
import { AgentPipelineContext, AgentAttachmentContext, AgentUserMemory, ToolDomain } from "./agentTypes.js";
import { 
  executeWebSearch, 
  executeLocalKnowledgeSearch, 
  executeListVaultFiles,
  executeCrmDataAnalyst, 
  learnWorkflow,
  executeLearnWorkflow,
  getLearnedWorkflows,
  executeTextGenerator,
  executeCreateDraftInvoice,
  executeCreateDraftCompany,
  executeCreateDraftContact,
  executeSendSmtpEmail,
  executeCreateDraftOffer,
  executeFinalizeAndSendOffer,
  executeListKanbanBoards,
  executeGetKanbanBoardDetails,
  executeCreateKanbanCard,
  executeUpdateKanbanCard,
  executeMoveKanbanCard,
  executeDeleteKanbanCard,
  executeGetTemplates,
  executeGetTemplateDetails,
  executeApplyTemplate
} from "./tools.js";
import { validateProposalMathAndSchema, executeCritiqueLoop, ProposedState } from "./critic.js";
import { workflowExecutor } from "./workflowExecutor.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { z } from "zod";

// Typed sub-structures to avoid loose wildcard typing
import { 
  CreateCompanyArgs,
  CreateContactArgs,
  CreateInvoiceArgs,
  CreateOfferArgs,
  SendEmailArgsZodSchema,
  DeleteEntityArgsZodSchema,
  ProposeCrmChangesArgsZodSchema,
  ProposeCrmChangesArgs
} from "./tools/types.js";
import { ToolCall, InferenceResultPayload, InferenceMessage } from "../../types/inference.js";
// Auftrag 025 Phase 3 (#18): Query-abhängiges Memory-Prefetch
import { prefetchRelevantMemoryNotes } from "./memoryManager.js";


export const CompanyProposalSchema = z.object({
  full_legal_name: z.string().min(1),
  tax_vat_id: z.string().optional(),
  iban: z.string().optional(),
  bic_swift: z.string().optional(),
  city: z.string().optional(),
  street: z.string().optional(),
  postal_code: z.string().optional(),
  country_code: z.string().length(2).optional(),
});

export const ContactProposalSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().min(1),
  email_address: z.string().email().optional(),
  phone_number: z.string().optional(),
});

export const InvoiceProposalSchema = z.object({
  invoice_number: z.string().optional(),
  issue_date: z.string().optional(),
  due_date: z.string().optional(),
  service_date: z.string().optional(),
  vat_rate: z.number().optional(),
  invoice_line_items_json: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    vat_rate: z.number()
  })).optional(),
  leitweg_id: z.string().optional(),
});

// Central restructured output type of the AI decision
export interface ReActDecision {
  thought: string;
  isComplete: boolean;
  callToolName: 'web_search' | 'local_knowledge' | 'list_vault_files' | 'crm_data_analyst' | 'learn_workflow' | 'get_workflows' | 'text_generator' | 'create_invoice_draft' | 'create_company_draft' | 'create_contact_draft' | 'send_smtp_email' | 'create_offer_draft' | 'finalize_and_send_offer' | string | null;
  callToolQuery: string | null;
  parallelToolCalls?: {
    toolName: 'web_search' | 'local_knowledge' | 'list_vault_files' | 'crm_data_analyst' | 'learn_workflow' | 'get_workflows' | 'text_generator' | 'create_invoice_draft' | 'create_company_draft' | 'create_contact_draft' | 'send_smtp_email' | 'create_offer_draft' | 'finalize_and_send_offer' | string;
    toolQuery: string;
  }[] | null;
  finalDraftText: string | null;
  /**
   * Fix (2026-08-17): true, wenn die Rohantwort eine KAPUTTE JSON-Struktur
   * war (Klammern vorhanden, aber unparsbar) oder leer — die Antwort ist dann KEINE
   * echte Nutzerantwort, sondern ein Parse-Artefakt → ReAct-Loop startet eine
   * Korrektur-Runde (bounded) statt das Artefakt als finale Antwort auszuliefern.
   * Reine Prosa-Antworten (ohne JSON-Klammern) setzen das Flag NICHT.
   */
  parseFailed?: boolean;
  proposedChanges: {
    entity_type: 'companies' | 'contacts' | 'invoices' | 'emails' | 'offers' | 'kanban_board' | 'kanban_column' | 'kanban_card' | 'vault_skill';
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND' | 'MOVE';
    id_uuid?: string;
    proposed_state: Partial<CreateCompanyArgs> | Partial<CreateContactArgs> | Partial<CreateInvoiceArgs> | Partial<CreateOfferArgs> | z.infer<typeof SendEmailArgsZodSchema> | z.infer<typeof DeleteEntityArgsZodSchema> | Record<string, unknown> | null;
    explanation_rational: string;
  } | null;
}

// Schema definition for Google GenAI SDK (no import type for Enums!)
export const getOrchestratorResponseSchema = (): Schema => {
  return {
    type: Type.OBJECT,
    properties: {
      thought: { 
        type: Type.STRING, 
        description: "Gedankengang des Modells über den aktuellen Zustand des ReAct-Loops." 
      },
      isComplete: { 
        type: Type.BOOLEAN, 
        description: "True, wenn die Endantwort bereitsteht oder ein User-Proposal finalisiert wurde." 
      },
      callToolName: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Name des aufzurufenden System-Tools oder dynamischen Workflow-Makros." 
      },
      callToolQuery: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Argumente/Query für das Tool." 
      },
      parallelToolCalls: {
        type: Type.ARRAY,
        nullable: true,
        description: "Liste von mehreren optionalen Tool-Aufrufen, die parallel/asynchron im Backend ausgeführt werden können. Nutze dies, um mehrere Suchen oder Abfragen in einem einzigen Durchlauf auszuführen.",
        items: {
          type: Type.OBJECT,
          properties: {
            toolName: { 
              type: Type.STRING, 
              description: "Name des Tools, z.B. local_knowledge, crm_data_analyst, web_search, etc." 
            },
            toolQuery: { 
              type: Type.STRING, 
              description: "Argumente oder Suchbegriff für das Tool." 
            }
          },
          required: ["toolName", "toolQuery"]
        }
      },
      finalDraftText: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Der finale Antworttext für das Chat-Fenster (in der Benutzersprache)." 
      },
      proposedChanges: {
        type: Type.OBJECT,
        nullable: true,
        description: "Kritischer Änderungsvorschlag für das CRM. Muss vom Nutzer im UI freigegeben werden.",
        properties: {
          entity_type: { 
            type: Type.STRING, 
            enum: ["companies", "contacts", "invoices", "emails", "offers", "kanban_board", "kanban_column", "kanban_card", "vault_skill", "note"] 
          },
          action: { 
            type: Type.STRING, 
            enum: ["CREATE", "UPDATE", "DELETE", "SEND", "MOVE"] 
          },
          id_uuid: { 
            type: Type.STRING, 
            nullable: true 
          },
          proposed_state: { 
            type: Type.OBJECT, 
            description: "Der bereinigte, typisierte Zustand der Entität nach Schema-Konventionen." 
          },
          explanation_rational: { 
            type: Type.STRING, 
            description: "Warum dieser Vorschlag gemacht wird (Erklärung für das UI)." 
          }
        },
        required: ["entity_type", "action", "proposed_state", "explanation_rational"]
      }
    },
    required: ["thought", "isComplete", "callToolName", "callToolQuery", "finalDraftText", "proposedChanges"]
  };
};



export interface LearnedWorkflow {
  id_uuid: string;
  workflow_name: string;
  workflow_description?: string;
  description?: string;
  tool_chain_sequence: string | { tool: string; instruction: string }[];
}

export interface WorkflowStepResult {
  stepIndex: number;
  tool: string;
  result: unknown;
}

export interface WorkflowRunOutcome {
  status: 'success' | 'failed';
  workflowName: string;
  totalSteps: number;
  stepsExecuted: { tool: string; status: 'completed' | 'failed' }[];
  finalResultSummary: WorkflowStepResult[];
}

export type ToolResultPayload =
  | string
  | WorkflowRunOutcome
  | Record<string, unknown>
  | Record<string, unknown>[]
  | unknown;

export interface ToolExecutionRecord {
  toolName: string;
  query: string;
  result: ToolResultPayload;
  reasoning_content?: string;
}

// Auftrag 006 A1 (Regel 12): Default über Admin-Config steuerbar; 2000 als Backend-Fallback
export function truncateResult(result: unknown, maxLength = 2000): string {
  if (result === null || result === undefined) return "No result returned.";
  if (typeof result === 'string') {
    if (result.length <= maxLength) return result;
    const truncated = result.slice(0, maxLength);
    const lastNewline = truncated.lastIndexOf('\n');
    const cutPoint = lastNewline > maxLength * 0.7 ? lastNewline : maxLength;
    return result.slice(0, cutPoint) + `\n... [TRUNCATED - ${result.length - cutPoint} characters omitted for context sanity]`;
  }

  if (Array.isArray(result)) {
    const fullStr = JSON.stringify(result);
    if (fullStr.length <= maxLength) return fullStr;
    const sample = result.slice(0, Math.min(result.length, 10));
    return JSON.stringify(sample) + `\n... [Total ${result.length} items. Showing first ${sample.length} items for context sanity]`;
  }

  const str = typeof result === 'object' ? JSON.stringify(result) : String(result);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + `\n... [TRUNCATED - ${str.length - maxLength} characters omitted]`;
}

export interface ExecutionContext {
  userId: string;
  tenantId: string;
  userMessage: string;
  intent: 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL';
  planningSteps: string[];
  toolResults: ToolExecutionRecord[];
  thoughtLog: string[];
  isComplete: boolean;
  proposedChanges: ReActDecision['proposedChanges'] | null;
  finalDraftText?: string;
  criticFeedback?: string;
}

/**
 * Reads Tenant config from database or fallback Store
 */
export async function getTenantAiConfig(tenantId: string): Promise<TenantAiConfig> {
  if (isUsingFallback) {
    const list: TenantAiConfig[] = fallbackStore.louisAiConfig || [];
    const record = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
    if (record) return record;
  } else {
    try {
      const res = await pool.query(
        "SELECT id_uuid, tenant_id, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx, max_iterations, max_history_tokens, tool_result_truncate_chars, react_keep_last_results, react_compaction_from_iteration, early_exit_after_tools, prompt_directives_mode, react_tool_call_mode, text_fallback_enabled, memory_budget_tokens, prompt_parallel_tool_guidance, prompt_tool_guidance_trim, memory_frozen_snapshot, compression_enabled, compression_threshold_percent, compression_tail_token_budget, compression_aux_model, compression_persist_summary, compression_model_context_map, memory_prefetch_enabled, memory_prefetch_timeout_s, memory_recall_status_enabled, memory_auto_scan_enabled, memory_consolidation_budget, tool_call_retry_max, empty_retry_budget, empty_retry_cost_threshold_usd, tool_guardrail_exact_block, tool_guardrail_no_progress_block, loop_deadline_s, thinking_scrub_enabled, recall_fts_enabled, recall_search_limit, skill_curator_enabled, skill_inject_max_tokens, skill_prune_inactive_after_days, skill_inject_top_k, curator_interval_hours, curator_archive_after_days, mcp_refresh_interval_s, subtask_timeout_s, subtask_max_parallel, subtask_max_depth, audit_retention_days, session_retention_days, mcp_approval_timeout_s, mcp_stdio_max_sessions FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn("AI config query failed:", err);
    }
  }

  // Default configuration (ReAct-Laufzeitparameter: NULL = Backend-Default, Regel 12)
  return {
    provider_type: "ollama",
    model_name: "llama3",
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    num_ctx: 8192,
    max_iterations: null,
    max_history_tokens: null,
    tool_result_truncate_chars: null,
    react_keep_last_results: null,
    react_compaction_from_iteration: null,
    early_exit_after_tools: null,
    prompt_directives_mode: "always" as const,
    text_fallback_enabled: null,
    memory_budget_tokens: null,
    prompt_parallel_tool_guidance: null,
    prompt_tool_guidance_trim: null,
    memory_frozen_snapshot: null,
    compression_enabled: null,
    compression_threshold_percent: null,
    compression_tail_token_budget: null,
    compression_aux_model: null,
    compression_persist_summary: null,
    compression_model_context_map: null,
    memory_prefetch_enabled: null,
    memory_prefetch_timeout_s: null,
    memory_recall_status_enabled: null,
    memory_auto_scan_enabled: null,
    memory_consolidation_budget: null,
    tool_call_retry_max: null,
    empty_retry_budget: null,
    empty_retry_cost_threshold_usd: null,
    tool_guardrail_exact_block: null,
    tool_guardrail_no_progress_block: null,
    loop_deadline_s: null,
    mcp_approval_timeout_s: null,
    mcp_stdio_max_sessions: null,
    thinking_scrub_enabled: null,
    recall_fts_enabled: null,
    recall_search_limit: null,
    skill_curator_enabled: null,
    skill_inject_max_tokens: null,
    skill_prune_inactive_after_days: null,
    skill_inject_top_k: null,
    curator_interval_hours: null,
    curator_archive_after_days: null,
    subtask_max_depth: null,
    // Auftrag 037 P1: Audit-Log-Retention (NULL = kein Auto-Prune, Regel 12)
    audit_retention_days: null,
    // Auftrag 038 P1: Session-Retention (NULL = kein Auto-Prune, Regel 12)
    session_retention_days: null,
    mcp_refresh_interval_s: null,
    subtask_timeout_s: null,
    subtask_max_parallel: null
  };
}

/**
 * S2: Lädt das User-Memory (sys_louis_ai_user_memory) für Injektion in den System-Prompt.
 * S10: Vault-first — readUserMemoryVault (Tier 1/2) zuerst, sonst DB (Tier 3).
 * Auftrag 025 Phase 3 (#25): Timeout-Gate — ein hängender Vault-/Provider-Call blockiert
 * den Turn NIE (Default 8s, non-fatal; konfigurierbar via memory_prefetch_timeout_s).
 * Strikt fehlertolerant — Memory darf die Pipeline nie brechen (nie werfen).
 */
export async function getTenantUserMemory(tenantId: string, userId: string, timeoutMs: number = 8000): Promise<AgentUserMemory | null> {
  try {
    const { readUserMemoryVault } = await import("./vaultStore.js");
    const vaultMemory = await Promise.race([
      readUserMemoryVault(tenantId, userId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
    ]);
    if (vaultMemory) return vaultMemory;
    // Timeout (null vom Race) vs. Vault ohne Memory (null vom Store) sind hier nicht
    // unterscheidbar — in beiden Fällen sauber auf Tier 3 (DB) weitergehen.
  } catch {
    // Vault-Tiers down → DB-Fallback (Tier 3)
  }
  const parseJsonArray = <T>(value: unknown): T[] => {
    if (!value) return [];
    try {
      const arr = JSON.parse(String(value));
      return Array.isArray(arr) ? (arr as T[]) : [];
    } catch {
      return [];
    }
  };

  try {
    if (isUsingFallback) {
      const records = fallbackStore.louisAiUserMemory || [];
      const record = records.find((m) => m.user_id === userId && m.tenant_id === tenantId);
      if (!record) return null;
      return {
        response_preferences_text: String(record.response_preferences_text || ""),
        frequently_used_tools_json: parseJsonArray<{ tool: string; count: number }>(record.frequently_used_tools_json),
        chat_notes_json: parseJsonArray<{ id_uuid: string; content: string; created_at_utc: string }>(record.chat_notes_json)
      };
    } else {
      const res = await pool.query(
        `SELECT response_preferences_text, frequently_used_tools_json, chat_notes_json
         FROM sys_louis_ai_user_memory
         WHERE user_id = $1 AND tenant_id = $2
         LIMIT 1`,
        [userId, tenantId]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        response_preferences_text: String(row.response_preferences_text || ""),
        frequently_used_tools_json: parseJsonArray<{ tool: string; count: number }>(row.frequently_used_tools_json),
        chat_notes_json: parseJsonArray<{ id_uuid: string; content: string; created_at_utc: string }>(row.chat_notes_json)
      };
    }
  } catch (err) {
    console.warn("[getTenantUserMemory] Memory-Loading fehlgeschlagen (wird ignoriert):", err);
    return null;
  }
}

/**
 * Fast deterministic intent classification using regex and pattern matching.
 * Returns null if no definitive fast match was found (allowing LLM fallback).
 */
export function classifyIntentFastPath(message: string): 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL' | null {
  const msg = message.trim().toLowerCase();
  if (!msg) return 'GENERAL';

  // Quick greetings or simple conversational queries
  if (/^(hallo|hi|hey|guten tag|servus|moin|danke|vielen dank|hilfe|help)\b/i.test(msg) && msg.split(/\s+/).length <= 4) {
    return 'GENERAL';
  }

  // Calendar, appointments, tasks and event creation/mutations
  if (/\b(termin|kalender|calendar|event|events|meeting|meetings|treffen|einladung|erinnerung|aufgabe|task)\b/i.test(msg)) {
    if (/\b(erstelle|erstellen|anlegen|anlege|leg|lege|legen|hinzufügen|neuer|neues|neue|neu|create|add|buchen|buche|trage|eintragen|setze|setzen|lade|einladen|sende|versende|send|schicke|schicken)\b/i.test(msg) || /\ban\b/i.test(msg)) {
      return 'DATA_CREATION';
    }
  }

  // Data Creation patterns
  const creationRegex = /\b(erstelle|erstellen|anlegen|anlege|leg|lege|legen|hinzufügen|neuer|neues|neue|neu|create|add|draft|schreibe|schreiben|buchen|buche|trage|eintragen|setze|setzen|lade|einladen)\b/i;
  const crmEntities = /\b(kontakt|kontakte|unternehmen|firma|firmen|company|contact|rechnung|rechnungen|invoice|invoices|angebot|angebote|offer|offers|karte|karten|card|cards|entwurf|aufgabe|aufgaben|task|tasks|kanban|board|boards|spalte|spalten|email|e-mail|mail|mahnung|erinnerung|nachricht|termin|termine|kalender|calendar|event|events|meeting|meetings|treffen|einladung)\b/i;
  if (creationRegex.test(msg) && (crmEntities.test(msg) || /\ban\b/i.test(msg))) {
    return 'DATA_CREATION';
  }

  // Data Change / Removal / Move / Send patterns
  const changeRegex = /\b(aktualisiere|aktualisieren|bearbeite|bearbeiten|lösche|löschen|entfernen|verschiebe|verschieben|update|delete|remove|modify|move|finalisiere|finalisieren|finalize|sende|versende|send|schicke|schicken|mahn|erinnere)\b/i;
  if (changeRegex.test(msg) && (crmEntities.test(msg) || /\b(status|feld|eintrag|daten|adresse|email|telefon|position|spalte|board)\b/i.test(msg))) {
    return 'DATA_CHANGE';
  }

  // Analysis / Reports / Aggregations / Lookup patterns
  const analysisRegex = /\b(analysiere|analyse|übersicht|uebersicht|bericht|report|statistik|summe|zusammenfassung|auswertung|wieviel|wie viele|anzahl|wie viel|gesamtsumme|offene rechnungen|umsatz)\b/i;
  if (analysisRegex.test(msg)) {
    return 'ANALYSIS';
  }

  // Custom tool / workflow patterns
  const customToolRegex = /\b(workflow|automatisieren|automatisierung|ausführen|run workflow|custom tool)\b/i;
  if (customToolRegex.test(msg)) {
    return 'CUSTOM_TOOL';
  }

  return null;
}

export interface QueryComplexityResult {
  isFastPath: boolean;
  isComplex: boolean;
  intent: 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL';
}

/**
 * Classifies prompt complexity to enable fast-path single-pass execution for simple queries.
 */
export function classifyQueryComplexity(prompt: string): QueryComplexityResult {
  const intent = classifyIntentFastPath(prompt) || 'GENERAL';
  const msg = prompt.trim().toLowerCase();

  const hasMutation = /\b(erstelle|erstellen|anlegen|anlege|leg|lege|legen|hinzufügen|schreibe|schreiben|aktualisiere|aktualisieren|bearbeite|bearbeiten|lösche|löschen|entfernen|verschiebe|verschieben|update|delete|remove|move|finalisiere|finalisieren|finalize|sende|versende|send|schicke|schicken|mahn|erinnere|workflow|buchen|buche|trage|eintragen|setze|setzen|lade|einladen|termin|kalender|calendar|event|meeting)\b/i.test(msg);

  if (intent === 'DATA_CREATION' || intent === 'DATA_CHANGE' || intent === 'CUSTOM_TOOL' || hasMutation) {
    return {
      isFastPath: false,
      isComplex: true,
      intent
    };
  }

  return {
    isFastPath: true,
    isComplex: false,
    intent
  };
}

/**
 * Primary ReAct Loop orchestrator
 */
export async function runLouisAiFlow(
  tenantId: string,
  userId: string,
  userMessage: string,
  conversationHistory: ConversationMessage[] = [],
  language: string = 'de',
  shortTermSummaryText: string = '',
  attachments: AgentAttachmentContext[] = [],
  // Auftrag 012 P1-3: optionale Tool-Domänen-Einschränkung (z. B. Agent-Jobs mit allowed_domains)
  allowedDomains?: ToolDomain[],
  // C.7 (Plan 2026-08-19): aktive Chat-Session → Chatprofil-Filter für MCP-Tools
  sessionId?: string
): Promise<{
  replyText: string;
  thoughtLog: string[];
  proposedChanges: ReActDecision['proposedChanges'] | null;
  sessionId: string;
  // Auftrag 025 Phase 3 (#20): Recall-Status-Feedback (Anzahl relevanter Prefetch-Treffer)
  memoryRecallCount?: number;
  metrics?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
  };
}> {
  const aiConfig = await getTenantAiConfig(tenantId);
  // Auftrag 025 Phase 3 (#25): Prefetch-Timeout konfigurierbar (memory_prefetch_timeout_s, NULL = 8s)
  const userMemory = await getTenantUserMemory(tenantId, userId, aiConfig.memory_prefetch_timeout_s ?? 8000);
  const agentLanguage = language.toLowerCase().startsWith('en') ? 'en' : 'de';

  // Auftrag 025 Phase 3 (#18): Query-abhängiges Prefetch — relevante Memory-Einträge werden
  // VOR dem Loop nach Relevanz sortiert und budgetiert (nicht nur Budget-Injektion).
  // Ergebnis: prefetchedUserMemory (budgetierte, relevanz-sortierte Notizen) + recallCount.
  let prefetchedUserMemory: AgentUserMemory | null = userMemory;
  let memoryRecallCount = 0;
  if (userMemory && userMemory.chat_notes_json.length > 0) {
    if (aiConfig.memory_prefetch_enabled ?? true) {
      const budget = aiConfig.memory_budget_tokens ?? 800;
      const prefetch = prefetchRelevantMemoryNotes(userMessage, userMemory.chat_notes_json, budget);
      prefetchedUserMemory = { ...userMemory, chat_notes_json: prefetch.notes };
      memoryRecallCount = prefetch.relevantCount;
    }
  }

  // Auftrag 025 Phase 2 (#13): KEINE Kompression mehr auf dem Antwort-Pfad.
  // Der Summary kommt ausschließlich vom Background-Worker (sendMessage) —
  // nie ein synchroner LLM-Call im Request-Pfad, nie ein 4s-Timeout-Race.
  const activeSummary = shortTermSummaryText;

  const complexity = classifyQueryComplexity(userMessage);

  const pipelineContext: AgentPipelineContext = {
    tenantId,
    userId,
    userMessage,
    language: agentLanguage,
    aiConfig,
    history: conversationHistory,
    shortTermSummary: activeSummary,
    userMemory: prefetchedUserMemory,
    // Auftrag 025 Phase 3 (#20): Recall-Status-Feedback (Anzahl relevanter Prefetch-Treffer)
    memoryRecallCount,
    temporalAnchor: new Date().toISOString(),
    attachments,
    // C.7 (Plan 2026-08-19): Session-Kontext für den Chatprofil-Filter der MCP-Tools
    sessionId,
    // Auftrag 006 A3: History-Budget 1200 (Admin-einstellbar über max_history_tokens)
    maxHistoryTokens: aiConfig.max_history_tokens ?? 1200,
    isFastPath: complexity.isFastPath,
    isComplex: complexity.isComplex,
    thoughtLog: activeSummary ? [`[ShortTermSummary] ${activeSummary}`] : [],
    toolResults: [],
    currentIteration: 0,
    // Regel 12: maxIterations aus Admin-Config (NULL = dynamisch nach Komplexität; FastPath 3, komplex 6)
    maxIterations: aiConfig.max_iterations ?? (complexity.isFastPath ? 3 : 6),
    toolResultTruncateChars: aiConfig.tool_result_truncate_chars ?? 2000,
    reactKeepLastResults: aiConfig.react_keep_last_results ?? 2,
    reactCompactionFromIteration: aiConfig.react_compaction_from_iteration ?? 3,
    earlyExitAfterTools: aiConfig.early_exit_after_tools ?? 4,
    promptDirectivesMode: (aiConfig.prompt_directives_mode as 'always' | 'intent') || 'always',
    toolCallMode: (aiConfig.react_tool_call_mode as 'auto' | 'json' | 'native') || 'auto',
    // Auftrag 031 (Effekt-Test-Fund): text_fallback_enabled war nie verdrahtet —
    // fehlte im getTenantAiConfig-SELECT UND im Mapping → Admin-Einstellung wirkte nie.
    textFallbackEnabled: aiConfig.text_fallback_enabled ?? false,
    // Auftrag 025 Phase 1 (Parität): Cache-Tier-Toggles (NULL = Backend-Default, Regel 12)
    promptParallelToolGuidance: aiConfig.prompt_parallel_tool_guidance ?? true,
    promptToolGuidanceTrim: aiConfig.prompt_tool_guidance_trim ?? true,
    memoryFrozenSnapshot: aiConfig.memory_frozen_snapshot ?? true,
    // Auftrag 025 Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12)
    compressionEnabled: aiConfig.compression_enabled ?? true,
    compressionThresholdPercent: aiConfig.compression_threshold_percent ?? null,
    compressionTailTokenBudget: aiConfig.compression_tail_token_budget ?? null,
    compressionAuxModel: aiConfig.compression_aux_model ?? null,
    compressionPersistSummary: aiConfig.compression_persist_summary ?? true,
    compressionModelContextMap: aiConfig.compression_model_context_map ?? null,
    // Auftrag 025 Phase 3 (Parität): Memory-Toggles (NULL = Backend-Default, Regel 12)
    memoryPrefetchEnabled: aiConfig.memory_prefetch_enabled ?? true,
    memoryPrefetchTimeoutS: aiConfig.memory_prefetch_timeout_s ?? null,
    memoryRecallStatusEnabled: aiConfig.memory_recall_status_enabled ?? true,
    memoryAutoScanEnabled: aiConfig.memory_auto_scan_enabled ?? true,
    memoryConsolidationBudget: aiConfig.memory_consolidation_budget ?? null,
    // Auftrag 025 Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12)
    toolCallRetryMax: aiConfig.tool_call_retry_max ?? null,
    emptyRetryBudget: aiConfig.empty_retry_budget ?? null,
    emptyRetryCostThresholdUsd: aiConfig.empty_retry_cost_threshold_usd ?? null,
    toolGuardrailExactBlock: aiConfig.tool_guardrail_exact_block ?? null,
    toolGuardrailNoProgressBlock: aiConfig.tool_guardrail_no_progress_block ?? null,
    loopDeadlineS: aiConfig.loop_deadline_s ?? null,
    thinkingScrubEnabled: aiConfig.thinking_scrub_enabled ?? true,
    // Auftrag 025 Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12)
    recallFtsEnabled: aiConfig.recall_fts_enabled ?? true,
    recallSearchLimit: aiConfig.recall_search_limit ?? null,
    // Auftrag 025 Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12)
    skillCuratorEnabled: aiConfig.skill_curator_enabled ?? true,
    skillInjectMaxTokens: aiConfig.skill_inject_max_tokens ?? null,
    skillPruneInactiveAfterDays: aiConfig.skill_prune_inactive_after_days ?? null,
    skillInjectTopK: aiConfig.skill_inject_top_k ?? null,
    // Auftrag 026 P1-1 (Parität): Curator-Tick/Archiv (NULL = Backend-Default, Regel 12)
    curatorIntervalHours: aiConfig.curator_interval_hours ?? null,
    curatorArchiveAfterDays: aiConfig.curator_archive_after_days ?? null,
    // Auftrag 026 P1-3 (Parität): Subagent-Spawn-Depth (NULL = Backend-Default, Regel 12)
    subtaskMaxDepth: aiConfig.subtask_max_depth ?? null,
    // Auftrag 037 P1: Audit-Log-Retention (NULL = kein Auto-Prune, Regel 12)
    auditRetentionDays: aiConfig.audit_retention_days ?? null,
    // Auftrag 038 P1: Session-Retention (NULL = kein Auto-Prune, Regel 12)
    sessionRetentionDays: aiConfig.session_retention_days ?? null,
    // Auftrag 025 Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12)
    mcpRefreshIntervalS: aiConfig.mcp_refresh_interval_s ?? null,
    subtaskTimeoutS: aiConfig.subtask_timeout_s ?? null,
    subtaskMaxParallel: aiConfig.subtask_max_parallel ?? null,
    // Auftrag 012 P1-3: Domänen-Limit (nur wenn gesetzt — sonst alle Domänen wie bisher)
    ...(allowedDomains && allowedDomains.length > 0 ? { allowedDomains } : {}),
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    finalDraftText: null,
    proposedChanges: null,
    isComplete: false
  };

  const result = await globalAgentRuntime.executePipeline(pipelineContext);

  return {
    replyText: result.finalDraftText,
    thoughtLog: result.thoughtLog,
    proposedChanges: result.proposedChanges as ReActDecision['proposedChanges'] | null,
    sessionId: uuidv4(),
    // Auftrag 025 Phase 3 (#20): Recall-Status-Feedback an die Chat-UI
    memoryRecallCount: result.memoryRecallCount ?? memoryRecallCount,
    metrics: {
      durationMs: result.executionTimeMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedTokens: result.cachedTokens,
      totalTokens: result.inputTokens + result.outputTokens
    }
  };
}



/**
 * A passive, synchronous helper tool for session compression.
 * Called before starting the ReAct loop when the history swells.
 */
export async function executePassiveShortTermCompression(
  tenantId: string, 
  history: ConversationMessage[], 
  currentSummaryText: string,
  modelNameSelected?: string
): Promise<string> {
  // If the history is still compact (<= 12 messages), no compression is required
  if (history.length <= 12) return currentSummaryText;

  const config = await getTenantAiConfig(tenantId);
  const provider = (config.provider_type || 'ollama') as "ollama" | "anthropic" | "openai" | "gemini";

  // Clean potential browser-autofill garbage
  let cleanApiKey = (typeof config.api_key_secret === 'string' ? config.api_key_secret.trim() : '');
  if (cleanApiKey.includes('@') || cleanApiKey === '******') {
    cleanApiKey = '';
  }

  const modelName = modelNameSelected || config.model_name || (provider === 'gemini' ? 'gemini-3.5-flash' : 'llama3');
  const oldHistoryToCompress = history.slice(0, -4);

  const summarizationPrompt = `
    Deine Aufgabe ist es, als passives CRM-Gedächtnis-Tool den älteren Teil eines CRM-Chatverlaufes strukturiert zusammenzufassen.
    Konsolidiere alle wichtigen und kritischen Fakten in einer kompakten, leicht zu lesenden Liste.
    
    Elemente, die du unbedingt festhalten musst:
    - Entscheidungen und getroffene Vereinbarungen des Nutzers.
    - Diskutierte Entitäten (Firmennamen, Ansprechpartner, E-Mails, IBANs, etc.).
    - Spezifische finanzielle Summen, Rechnungsnummern oder offene Beträge.
    - Vom Nutzer formulierte, sitzungsinterne Instruktionen.

    Bisherige Zusammenfassung dieses Chats (falls vorhanden):
    "${currentSummaryText || 'Keine bisherige Zusammenfassung vorhanden.'}"

    Zu komprimierender Verlaufsauszug:
    ${JSON.stringify(oldHistoryToCompress)}

    Antworte mit der neuen, konsolidierten und aktualisierten Zusammenfassung auf Deutsch.
    Überschreite keinesfalls 1000 Token. Nutze strukturiertes Markdown.
  `;

  try {
    const compressionPromise = generateContentUniversal({
      provider_type: provider,
      model_name: modelName,
      api_key_secret: cleanApiKey,
      base_url: (config.base_url as string) || undefined,
      temperature: 0.2,
      contents: summarizationPrompt,
    }).then(res => (res.text as string) || currentSummaryText);

    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve(currentSummaryText), 4000);
    });

    return await Promise.race([compressionPromise, timeoutPromise]);
  } catch (err) {
    console.warn("Passive short term memory compression tool failed, keeping previous context:", err);
    return currentSummaryText;
  }
}

/**
 * Resilient helper function for JSON extraction and fallback mechanism (heuristic fallback).
 * Robustly catches incomplete LLM JSON outputs or Markdown code blocks.
 */

// 2026-08-18: XML-Parameter auto-typisieren — DeepSeek liefert Werte im XML-Pfad IMMER als Strings
// (z.B. contextLength="300", columns="[...]"). Tools erwarten aber number/boolean/array → koerzieren.
// Vorsicht: Strings mit führender Null (z.B. PLZ "01234") bleiben Strings.
const autoType = (v: string): unknown => {
  const t = v.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) return Number(t);
  if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
    try {
      return JSON.parse(t);
    } catch {
      return v;
    }
  }
  return v;
};

// Auftrag 007 T6: XML-Tool-Call-Parser (Claude/DeepSeek-Format)
// <invoke name="list_companies"><parameter name="search">Acme</parameter></invoke>
// → UniversalToolCall-ähnliche ToolCall[] (querys als JSON/plain string).
export function parseXmlToolCalls(text: string): ToolCall[] {
  // 2026-08-18: NFKC + DSML-Pipe-Normalisierung — DeepSeek liefert teils Fullwidth-
  // Konfusionszeichen (﹤ statt <) oder Maskierungen (<||DSML||tool_calls>).
  const normalized = normalizeToolCallText(text || "");
  const calls: ToolCall[] = [];
  const invokeRegex = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
  let m: RegExpExecArray | null;
  while ((m = invokeRegex.exec(normalized)) !== null) {
    const toolName = m[1].trim();
    if (!toolName) continue;
    const body = m[2] || "";
    const args: Record<string, unknown> = {};
    // Attribute wie string="true" nach dem Namen erlauben (Modell-Output, B4 2026-08-16)
    const paramRegex = /<parameter name="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/g;
    let p: RegExpExecArray | null;
    let hasParams = false;
    while ((p = paramRegex.exec(body)) !== null) {
      hasParams = true;
      args[p[1].trim()] = autoType(p[2].trim());
    }
    // Ohne <parameter>-Blöcke: Body direkt als query (falls nicht leer)
    const argumentsStr = hasParams
      ? JSON.stringify(args)
      : (body.trim() || "{}");
    calls.push({
      type: "function",
      function: { name: toolName, arguments: argumentsStr }
    });
  }

  // B4-Fix (2026-08-16): UNVOLLSTÄNDIGE <invoke>-Blöcke (Modell bricht Antwort
  // vor </invoke> ab — z. B. Token-Limit). Nur wenn keine vollständigen Calls
  // gefunden wurden UND der XML-Block am Anfang dominiert (Schutz vor Halluzination).
  if (calls.length === 0) {
    const incompleteMatch = normalized.match(/^[\s\S]*?<invoke name="([^"]+)">([\s\S]*)$/);
    if (incompleteMatch) {
      const toolName = incompleteMatch[1].trim();
      const body = incompleteMatch[2] || "";
      // Muss mindestens einen <parameter>-Anfang enthalten (sonst zu riskant)
      if (toolName && /<parameter name="[^"]+"[^>]*>/.test(body)) {
        const args: Record<string, unknown> = {};
        const paramRegex = /<parameter name="([^"]+)"[^>]*>([\s\S]*?)(?:<\/parameter>|$)/g;
        let p: RegExpExecArray | null;
        while ((p = paramRegex.exec(body)) !== null) {
          const pName = p[1].trim();
          if (pName) args[pName] = autoType(p[2].trim());
        }
        if (Object.keys(args).length > 0) {
          calls.push({
            type: "function",
            function: { name: toolName, arguments: JSON.stringify(args) }
          });
        }
      }
    }
  }
  return calls;
}

// Leitet XML-geparste Tool-Calls durch den natives Verarbeitungspfad (finalize_response,
// propose_crm_changes, Standard, Parallel) — rekursiv über safeParseReActDecision.
export function buildDecisionFromToolCalls(calls: ToolCall[], rawText: string): ReActDecision {
  return safeParseReActDecision({ text: rawText, tool_calls: calls });
}

export function safeParseReActDecision(
  res: { text: string; tool_calls?: ToolCall[] },
  opts?: { strictNativeOnly?: boolean }
): ReActDecision {
  if (res.tool_calls && res.tool_calls.length > 0) {
    const thoughtMatch = res.text.match(/<think>([\s\S]*?)<\/think>/);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : (res.text.trim() || "Native tool call invoked.");

    // Auftrag 2026-08-15 (P3): Robustheit gegen malformed Tool-Calls. DeepSeek/andere
    // Provider liefern gelegentlich Calls ohne 'function'-Objekt (oder ohne name/
    // arguments) — vorher crashte t.function.name mit "Cannot read properties of
    // undefined (reading 'id'/'name')" bei Löschversuchen. Jetzt: malformed Calls
    // werden als Text-Antwort behandelt (kein Crash, kein Endlos-Loop).
    const validCalls = (res.tool_calls || []).filter(
      (t): t is ToolCall => !!t && typeof t === "object" && !!t.function && typeof t.function.name === "string"
    );
    if (validCalls.length === 0) {
      // Kein einziger wohlgeformter Call: als finale Text-Antwort interpretieren
      return {
        thought,
        isComplete: true,
        callToolName: null,
        callToolQuery: null,
        finalDraftText: res.text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || res.text.trim(),
        proposedChanges: null
      };
    }

    // Check if one of the tools is finalize_response
    const finalizeCall = validCalls.find((t: ToolCall) => t.function.name === 'finalize_response');
    if (finalizeCall) {
      let finalArgs: Record<string, unknown> = {};
      try {
        finalArgs = typeof finalizeCall.function.arguments === 'string' ? JSON.parse(finalizeCall.function.arguments) : (finalizeCall.function.arguments as Record<string, unknown>);
      } catch (e) {}
      return {
        thought,
        isComplete: true,
        callToolName: null,
        callToolQuery: null,
        finalDraftText: (finalArgs.finalDraftText as string) || res.text || "",
        proposedChanges: null
      };
    }

    const proposeCall = validCalls.find((t: ToolCall) => t.function.name === 'propose_crm_changes');
    if (proposeCall) {
      let rawPropArgs: unknown = {};
      try {
        rawPropArgs = typeof proposeCall.function.arguments === 'string' ? JSON.parse(proposeCall.function.arguments) : proposeCall.function.arguments;
      } catch (e) {}

      const parsedRes = ProposeCrmChangesArgsZodSchema.safeParse(rawPropArgs);
      const proposedChanges: ProposeCrmChangesArgs = parsedRes.success 
        ? parsedRes.data 
        : (rawPropArgs as ProposeCrmChangesArgs);

      return {
        thought,
        isComplete: true,
        callToolName: null,
        callToolQuery: null,
        finalDraftText: res.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
        proposedChanges
      };
    }

    // Standard tool calls
    const mainTool = validCalls[0];
    let argsStr = "";
    if (typeof mainTool.function.arguments === 'string') {
      argsStr = mainTool.function.arguments;
    } else {
      argsStr = JSON.stringify(mainTool.function.arguments);
    }
    
    // Extract query parameter if it's a single string wrapping tool
    try {
      const parsedArgs = JSON.parse(argsStr);
      if (parsedArgs.query && Object.keys(parsedArgs).length === 1) {
        argsStr = parsedArgs.query;
      } else if (parsedArgs.instruction && Object.keys(parsedArgs).length === 1) {
        argsStr = parsedArgs.instruction;
      }
    } catch(e) {}

    return {
      thought,
      isComplete: false,
      callToolName: mainTool.function.name,
      callToolQuery: argsStr,
      parallelToolCalls: validCalls.length > 1 ? validCalls.map((t: ToolCall) => ({
        toolName: t.function.name,
        toolQuery: typeof t.function.arguments === 'string' ? t.function.arguments : JSON.stringify(t.function.arguments)
      })) : null,
      finalDraftText: null,
      proposedChanges: null
    };
  }

  let cleaned = (res.text || "").trim();

  // 2026-08-18: Strikter Modus (Text-Fallback-Kanal AUS) — nur strukturierte tool_calls.
  // XML-/JSON-Textpfade werden übersprungen: gültige native Calls liefen oben; Text gilt als
  // finale Antwort. Enthält der Text Tool-Call-XML (Leak-Kandidat), wird parseFailed gesetzt,
  // damit der Loop eine Korrektur-Runde (strikter Retry-Prompt) startet.
  if (opts?.strictNativeOnly) {
    // 2026-08-18 (Vorgabe): XML-Tool-Calls werden im Strict-Modus WEITERHIN ausgeführt
    // (kein Tool-Call-Verlust — F29-Lehre); der Strict-Modus verhindert nur den LEAK
    // (XML als Antworttext). Unparsbare XML-Reste → parseFailed (Korrektur-Runde).
    const xmlCalls = parseXmlToolCalls(normalizeToolCallText(res.text || ""));
    if (xmlCalls.length > 0) {
      return buildDecisionFromToolCalls(xmlCalls, res.text || "");
    }
    const rawText = (res.text || "").trim();
    const looksLikeXml = containsToolCallXml(rawText);
    return {
      thought: looksLikeXml ? "Strikter Modus: XML-Text statt strukturiertem Tool-Call erkannt." : "Strikter Modus: Textantwort.",
      isComplete: true,
      callToolName: null,
      callToolQuery: null,
      parseFailed: looksLikeXml || undefined,
      finalDraftText: rawText.length > 0 ? res.text : "Die Antwort konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.",
      proposedChanges: null
    };
  }

  // Auftrag 007 T6: XML-Tool-Call-Format (Claude/DeepSeek: <invoke name="..."><parameter name="...">)
  // → in Tool-Calls konvertieren, BEVOR der JSON-Fallback greift. Einige Modelle (z. B. DeepSeek-V4)
  // antworten trotz tools-Parameter im XML-Text-Stil.
  const xmlToolCalls = parseXmlToolCalls(res.text || "");
  if (xmlToolCalls.length > 0) {
    return buildDecisionFromToolCalls(xmlToolCalls, res.text || "");
  }
  
  // 1. Clean up Markdown blocks
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
  const match = cleaned.match(jsonBlockRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }
  
  try {
    const parsed = JSON.parse(cleaned) as ReActDecision;
    if (parsed && parsed.callToolQuery && typeof parsed.callToolQuery !== "string") {
      parsed.callToolQuery = JSON.stringify(parsed.callToolQuery);
    }
    return parsed;
  } catch (error) {
    // 2. Heuristic search for the outermost JSON object
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const sliced = cleaned.slice(startIdx, endIdx + 1);
        const parsedSliced = JSON.parse(sliced) as ReActDecision;
        if (parsedSliced && parsedSliced.callToolQuery && typeof parsedSliced.callToolQuery !== "string") {
          parsedSliced.callToolQuery = JSON.stringify(parsedSliced.callToolQuery);
        }
        return parsedSliced;
      } catch (nestedError) {
        console.error("Heuristic slicing failed to yield valid JSON Structure. Engaging Safe-Fallback.", nestedError);
      }
    }
    
    // 3. Fail-safe fallback structure
    // Fix: interner Hinweis leakte in Nutzerantworten über den thought-Fallback —
    // finalDraftText = Rohantwort (bestmögliche Antwort) oder ehrliche deutsche Fehlermeldung.
    const rawText = (res.text || "").trim();
    // Fix (2026-08-17): Klammern vorhanden (JSON-Versuch) aber unparsbar,
    // oder komplett leer → KEINE echte Nutzerantwort → parseFailed für Korrektur-Runde.
    // Reine Prosa (keine Klammern, nicht leer) bleibt eine legitime Text-Antwort.
    const looksLikeBrokenJson = (startIdx !== -1 && endIdx > startIdx) || rawText.length === 0;
    return {
      thought: "Rohantwort war kein gültiges JSON-Format — Textantwort übernommen.",
      isComplete: true,
      callToolName: null,
      callToolQuery: null,
      parseFailed: looksLikeBrokenJson || undefined,
      finalDraftText: rawText.length > 0
        ? res.text
        : "Die Antwort konnte nicht verarbeitet werden. Bitte versuchen Sie es erneut.",
      proposedChanges: null
    };
  }
}

export const orchestrator = {
  processUserPrompt: async (params: { prompt: string; sessionId: string; tenantId: string; userId?: string }) => {
    return await runLouisAiFlow(
      params.tenantId,
      params.userId || "ai_assistant",
      params.prompt
    );
  }
};

