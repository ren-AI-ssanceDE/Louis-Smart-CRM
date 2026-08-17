import { z } from "zod";
import { TenantAiConfig, ConversationMessage } from "../../types.js";
import { ProposedState } from "./critic.js";

export type AgentLanguage = 'de' | 'en';
export type ToolDomain = 'CORE' | 'CRM_READ' | 'CRM_WRITE' | 'KNOWLEDGE' | 'KANBAN' | 'TEMPLATES' | 'WORKFLOWS';

/** A file attached to a Louis AI chat message, ready for prompt injection. */
export interface AgentAttachmentContext {
  fileName: string;
  text: string;
  isIndexedInKnowledgeBase?: boolean;
}

export interface AgentUserMemory {
  response_preferences_text: string;
  frequently_used_tools_json: Array<{ tool: string; count: number }>;
  chat_notes_json: Array<{ id_uuid: string; content: string; created_at_utc: string }>;
}

export interface AgentPipelineContext {
  tenantId: string;
  userId: string;
  userMessage: string;
  language: AgentLanguage;
  aiConfig: TenantAiConfig;
  history: ConversationMessage[];
  shortTermSummary?: string;
  userMemory?: AgentUserMemory | null;
  systemPrefix?: string;
  temporalAnchor?: string;
  allowedDomains?: ToolDomain[];
  skillSuggestion?: {
    workflow_name: string;
    workflow_description: string;
    skill_tags: string[];
    skill_category?: string;
    tool_chain_sequence: Array<{ tool: string; instruction: string }>;
  } | null;
  attachments?: AgentAttachmentContext[];
  maxHistoryTokens?: number;
  // B4-Nachfolge (2026-08-16): Korrektur-Direktive bei Ankündigungs-Antworten (Retry)
  retryDirective?: string;
  isFastPath?: boolean;
  isComplex?: boolean;
  thoughtLog: string[];
  toolResults: Array<{
    toolName: string;
    query: string;
    result: unknown;
  }>;
  currentIteration: number;
  maxIterations: number;
  // Auftrag 006 Task 0: Admin-konfigurierbare ReAct-Laufzeitparameter (Regel 12)
  toolResultTruncateChars: number;
  reactKeepLastResults: number;
  reactCompactionFromIteration: number;
  earlyExitAfterTools: number;
  lastInjectedToolResults?: number;
  // Auftrag 006 B3: Prompt-Direktiven-Modus ('always' | 'intent')
  promptDirectivesMode?: 'always' | 'intent';
  // Auftrag 007: Tool-Call-Modus ('auto' | 'json' | 'native')
  toolCallMode?: 'auto' | 'json' | 'native';
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  finalDraftText: string | null;
  proposedChanges: {
    entity_type: 'companies' | 'contacts' | 'invoices' | 'emails' | 'offers' | 'kanban_board' | 'kanban_column' | 'kanban_card' | 'vault_skill' | 'note';
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND' | 'MOVE';
    id_uuid?: string;
    proposed_state: ProposedState;
    explanation_rational: string;
  } | null;
  isComplete: boolean;
}

export interface CriticValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface CritiqueLoopResult {
  approved: boolean;
  approvalScore?: number;
  correctedDraft: string;
  log: string;
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

export interface AgentExecutionResult {
  finalDraftText: string;
  proposedChanges: AgentPipelineContext['proposedChanges'];
  thoughtLog: string[];
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  executionTimeMs: number;
  skillSuggestion?: {
    workflow_name: string;
    workflow_description: string;
    skill_tags: string[];
    skill_category?: string;
    tool_chain_sequence: Array<{ tool: string; instruction: string }>;
  } | null;
}
