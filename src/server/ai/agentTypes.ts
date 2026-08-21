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
  // C.7 (Plan 2026-08-19): aktive Chat-Session → Chatprofil-Filter für MCP-Tools
  sessionId?: string;
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
  // Auftrag 025 Phase 1 (Parität): Cache-Tier-Toggles (NULL = Backend-Default, Regel 12)
  promptParallelToolGuidance?: boolean;
  promptToolGuidanceTrim?: boolean;
  memoryFrozenSnapshot?: boolean;
  // Auftrag 025 Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12)
  compressionEnabled?: boolean;
  compressionThresholdPercent?: number | null;
  compressionTailTokenBudget?: number | null;
  compressionAuxModel?: string | null;
  compressionPersistSummary?: boolean;
  compressionModelContextMap?: string | null;
  // Auftrag 025 Phase 3 (Parität): Memory (NULL = Backend-Default, Regel 12)
  memoryPrefetchEnabled?: boolean;
  memoryPrefetchTimeoutS?: number | null;
  memoryRecallStatusEnabled?: boolean;
  memoryAutoScanEnabled?: boolean;
  memoryConsolidationBudget?: number | null;
  // #20: Anzahl der per Prefetch injizierten relevanten Memory-Einträge (Chat-Feedback)
  memoryRecallCount?: number;
  // Auftrag 025 Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12)
  toolCallRetryMax?: number | null;
  emptyRetryBudget?: number | null;
  emptyRetryCostThresholdUsd?: number | null;
  toolGuardrailExactBlock?: number | null;
  toolGuardrailNoProgressBlock?: number | null;
  loopDeadlineS?: number | null;
  thinkingScrubEnabled?: boolean;
  // Auftrag 025 Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12)
  recallFtsEnabled?: boolean;
  recallSearchLimit?: number | null;
  // Auftrag 025 Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12)
  skillCuratorEnabled?: boolean;
  skillInjectMaxTokens?: number | null;
  skillPruneInactiveAfterDays?: number | null;
  skillInjectTopK?: number | null;
  // Auftrag 026 P1-1 (Parität): Curator-Tick/Archiv (NULL = Backend-Default, Regel 12)
  curatorIntervalHours?: number | null;
  curatorArchiveAfterDays?: number | null;
  // Auftrag 026 P1-3 (Parität): Spawn-Depth (#55) + Steering (#53)
  subtaskMaxDepth?: number | null;
  // Auftrag 037 P1: Audit-Log-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  auditRetentionDays?: number | null;
  // Auftrag 038 P1: Session-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  sessionRetentionDays?: number | null;
  subtaskDepth?: number;
  /** #53: Steering-Handle für Sub-Agenten (abbrechen + Steer-Nachrichten). */
  steering?: { signal: AbortSignal; queue: string[]; injected: string[] };
  // Auftrag 025 Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12)
  mcpRefreshIntervalS?: number | null;
  subtaskTimeoutS?: number | null;
  subtaskMaxParallel?: number | null;
  // 2026-08-18: Text-Fallback-Kanal AUS (true = strikt: nur native Tool-Calls, kein XML/JSON-Textweg)
  textFallbackEnabled?: boolean;
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
  // Auftrag 025 Phase 3 (#20): Anzahl der per Prefetch injizierten relevanten Memory-Einträge
  memoryRecallCount?: number;
  skillSuggestion?: {
    workflow_name: string;
    workflow_description: string;
    skill_tags: string[];
    skill_category?: string;
    tool_chain_sequence: Array<{ tool: string; instruction: string }>;
  } | null;
}
