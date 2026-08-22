import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { generateInvoiceFilesOnDisk } from "../pdfHelper.js";
import { getEntityStoragePath } from "../storage.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../trpc.js";
import { 
  pool, 
  isUsingFallback, 
  fallbackStore, 
  saveFallbackStore, 
  logAuditEvent,
  cleanDbRow,
  SavedChatNote
} from "../db.js";
import {
  LouisAiConfigSchema, 
  CustomWorkflowSchema, 
  ProposedDiffSchema,
  UserMemorySchema,
  SaveEntityNoteSchema,
  TextGeneratorConfigSchema,
  WorkflowInstanceFullSchema,
  LouisAiUserMemoryFullSchema,
  ChatAttachmentInputSchema,
  ChatAttachmentInput,
  AgentQuestionFullSchema,
  AnswerQuestionSchema
} from "../../lib/schemas.js";
import { runLouisAiFlow, getTenantAiConfig } from "../ai/orchestrator.js";
import { getChatRunStatus } from "../ai/liveStatusRegistry.js";
import { scheduleBackgroundCompression, supportsNativeCompaction, waitForCompressionLock, resolveRotatedSessionId, forgetSessionRotationByChild } from "../ai/contextCompressor.js";
// C.7 (Plan 2026-08-19): Chatprofile — Wechsel-Sperre + Default-Profil für neue Sessions
import { markChatTaskActive, getDefaultProfileId } from "../mcp/chatProfiles.js";
// Phase 3 (#19/#22): Background-Memory-Sync + Konsolidierung
import { scheduleBackgroundMemorySync, scheduleMemoryConsolidation } from "../ai/memoryManager.js";
import { AgentAttachmentContext } from "../ai/agentTypes.js";
import { extractTextFromBuffer } from "./chatUpload.js";

// P2-D: Extrahiert verwendete Vault-Skills aus der Thought-Log-Zeile „[S10] Verwendete Skills: X, Y“
function extractUsedSkills(thoughtLog: string[] | undefined): string[] {
  if (!thoughtLog || !Array.isArray(thoughtLog)) return [];
  for (const line of thoughtLog) {
    const m = String(line || "").match(/Verwendete Skills:\s*(.+)/);
    if (m) {
      return m[1].split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
    }
  }
  return [];
}
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { sanitizeFinalText } from "../ai/toolCallSanitizer.js";
import { workflowExecutor } from "../ai/workflowExecutor.js";
import { getLearnedWorkflows, learnWorkflow, deleteWorkflow } from "../ai/tools.js";
import { generateContentSafe, generateContentUniversal } from "../ai/geminiHelper.js";
import { generateEmbedding, getRagConfig, formatVectorForPostgres } from "../ai/embeddingHelper.js";
import { forceManualIngest, unindexFileFromRag, isTextBasedFile, mimeTypeFromFilename, intelligentChunkAndProcess, ingestEmailToRag } from "../storage.js";
import { ChatMessage, Company, Contact, Invoice, Offer, LouisAiConfig, CustomWorkflow, SmtpSettings, WorkflowExecutionLogEntry, KanbanCard } from "../../types.js";
import { IWorkflowDAG } from "../../types/workflows.js";

interface EntityNote {
  id_uuid: string;
  content: string;
  created_at_utc: string;
  created_by_identity: string;
}

/**
 * Recursively search for a filename across all known storage buckets/vaults.
 * Used as a robust fallback to guarantee draft attachments can be resolved even if the source is misaligned.
 */
function searchFileAcrossAllVaults(filename: string, tenantId: string): { path: string; source: 'knowledge' | 'vault'; entityId?: string; entityType?: 'companies' | 'contacts' } | null {
  const cleanFilename = filename.toLowerCase().trim();
  if (!cleanFilename) return null;

  // Helper to find match in a list of files (exact or case-insensitive or partial)
  const findMatchInList = (files: string[], target: string): string | undefined => {
    // 1. Exact match
    let found = files.find(f => f.toLowerCase() === target);
    if (found) return found;
    // 2. Exact match excluding timestamps (e.g. 1717354923000_my_document.pdf vs my_document.pdf)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF === target;
    });
    if (found) return found;
    // 3. Contains match (target is in folder filename)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF.includes(target) || target.includes(cleanF);
    });
    if (found) return found;
    // 4. Raw includes
    return files.find(f => f.toLowerCase().includes(target));
  };

  // 1. Check knowledge_data_vault for tenant
  const kDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
  if (fs.existsSync(kDir)) {
    const files = fs.readdirSync(kDir);
    const matched = findMatchInList(files, cleanFilename);
    if (matched) {
      return { path: path.join(kDir, matched), source: 'knowledge' };
    }
  }

  // 2. Check knowledge_data_vault for fallback tenant "1"
  if (tenantId !== "1") {
    const kDirFallback = path.resolve(process.cwd(), "knowledge_data_vault", "1");
    if (fs.existsSync(kDirFallback)) {
      const files = fs.readdirSync(kDirFallback);
      const matched = findMatchInList(files, cleanFilename);
      if (matched) {
        return { path: path.join(kDirFallback, matched), source: 'knowledge' };
      }
    }
  }

  // Helper to search in vault directory
  const searchInVaultDir = (vaultRoot: string, type: 'companies' | 'contacts'): { path: string; source: 'vault'; entityId: string; entityType: 'companies' | 'contacts' } | null => {
    if (!fs.existsSync(vaultRoot)) return null;
    const entityDirs = fs.readdirSync(vaultRoot);
    for (const dir of entityDirs) {
      const dirPath = path.join(vaultRoot, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
         const files = fs.readdirSync(dirPath);
         const matched = findMatchInList(files, cleanFilename);
         if (matched) {
           const entityId = dir.split("__")[0];
           return {
             path: path.join(dirPath, matched),
             source: 'vault',
             entityId,
             entityType: type
           };
         }
      }
    }
    return null;
  };

  // 3. Check companies_data_vault for tenant
  const comVault = path.resolve(process.cwd(), "companies_data_vault", tenantId);
  const matchedCom = searchInVaultDir(comVault, 'companies');
  if (matchedCom) return matchedCom;

  // 4. Check contacts_data_vault for tenant
  const conVault = path.resolve(process.cwd(), "contacts_data_vault", tenantId);
  const matchedCon = searchInVaultDir(conVault, 'contacts');
  if (matchedCon) return matchedCon;

  // 5. Check companies_data_vault for tenant "1" fallback
  if (tenantId !== "1") {
    const comVaultFb = path.resolve(process.cwd(), "companies_data_vault", "1");
    const matchedComFb = searchInVaultDir(comVaultFb, 'companies');
    if (matchedComFb) return matchedComFb;

    const conVaultFb = path.resolve(process.cwd(), "contacts_data_vault", "1");
    const matchedConFb = searchInVaultDir(conVaultFb, 'contacts');
    if (matchedConFb) return matchedConFb;
  }

  // 6. Direct check in parent vaults directories if files are misplaced/uploaded directly there
  const parentComRoot = path.resolve(process.cwd(), "companies_data_vault");
  if (fs.existsSync(parentComRoot)) {
    const files = fs.readdirSync(parentComRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentComRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  const parentConRoot = path.resolve(process.cwd(), "contacts_data_vault");
  if (fs.existsSync(parentConRoot)) {
    const files = fs.readdirSync(parentConRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentConRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  return null;
}

// --- Chat attachments (uploads/chat-attachments) ---

const CHAT_ATTACHMENTS_DIR = path.resolve(process.cwd(), "uploads", "chat-attachments");
const MAX_ATTACHMENT_PROMPT_CHARS = 100_000;

/** Resolve the stored file name (uuid+ext) for a chat attachment id. */
function resolveChatAttachmentStoredName(attachmentId: string): string | null {
  try {
    if (!fs.existsSync(CHAT_ATTACHMENTS_DIR)) return null;
    const files = fs.readdirSync(CHAT_ATTACHMENTS_DIR);
    // Sidecar-Dateien enden auf ".extracted.txt" — nur die Binärdatei (uuid+ext) zählt.
    const found = files.find((f) => f.startsWith(attachmentId) && !f.endsWith(".extracted.txt"));
    return found || null;
  } catch (err) {
    console.warn("[sendMessage] Failed to resolve chat attachment:", err);
    return null;
  }
}

/**
 * Load the extracted text (sidecar .txt) for each attachment and build the
 * context payload injected into the ReAct system prompt. Attachments whose
 * files are missing or that contain no extractable text are skipped.
 */
async function resolveChatAttachmentContexts(attachments: ChatAttachmentInput[]): Promise<AgentAttachmentContext[]> {
  const contexts: AgentAttachmentContext[] = [];
  for (const att of attachments) {
    try {
      const storedName = resolveChatAttachmentStoredName(att.attachmentId);
      if (!storedName) {
        console.warn(`[sendMessage] Attachment "${att.fileName}" (${att.attachmentId}) not found on disk — skipping.`);
        continue;
      }
      const fullPath = path.join(CHAT_ATTACHMENTS_DIR, storedName);
      const textPath = path.join(CHAT_ATTACHMENTS_DIR, `${att.attachmentId}.extracted.txt`);
      let text = "";
      if (fs.existsSync(textPath)) {
        text = fs.readFileSync(textPath, "utf8");
      } else {
        // Fallback: re-extract from the stored binary and persist the sidecar
        text = await extractTextFromBuffer(fs.readFileSync(fullPath), storedName);
        try { fs.writeFileSync(textPath, text, "utf8"); } catch { /* ignore */ }
      }
      if (!text || !text.trim()) {
        console.warn(`[sendMessage] Attachment "${att.fileName}" contains no extractable text — skipping.`);
        continue;
      }
      const truncated = text.length > MAX_ATTACHMENT_PROMPT_CHARS
        ? text.slice(0, MAX_ATTACHMENT_PROMPT_CHARS) + "\n\n[... Dateiinhalt für die Verarbeitung gekürzt ...]"
        : text;
      contexts.push({
        fileName: att.fileName,
        text: truncated,
        isIndexedInKnowledgeBase: att.isIndexedInKnowledgeBase || false
      });
    } catch (err) {
      console.warn(`[sendMessage] Failed to load attachment "${att.fileName}":`, err);
    }
  }
  return contexts;
}

export const louisAiRouter = router({
  getConfig: protectedProcedure
    .output(z.object({
      id_uuid: z.string().optional(),
      provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini']),
      api_key_secret: z.string().optional().nullable(),
      base_url: z.string().optional().nullable(),
      model_name: z.string(),
      temperature: z.number(),
      top_p: z.number(),
      top_k: z.number(),
      num_ctx: z.number(),
      embedding_provider: z.enum(['ollama', 'openai', 'gemini']).optional().default('ollama'),
      embedding_api_key_secret: z.string().optional().nullable().default(''),
      embedding_base_url: z.string().optional().nullable().default(''),
      embedding_model_name: z.string().optional().default('nomic-embed-text'),
      vector_dimensions: z.number().optional().default(1536),
      keep_alive_minutes: z.number().optional().default(5),
      parallel_slots: z.number().optional().default(1),
      chunk_size: z.number().optional().default(500),
      chunk_overlap: z.number().optional().default(50),
      max_iterations: z.number().nullable().optional(),
      max_history_tokens: z.number().nullable().optional(),
      tool_result_truncate_chars: z.number().nullable().optional(),
      react_keep_last_results: z.number().nullable().optional(),
      react_compaction_from_iteration: z.number().nullable().optional(),
      early_exit_after_tools: z.number().nullable().optional(),
      prompt_directives_mode: z.enum(['always', 'intent']).default('always'),
      react_tool_call_mode: z.enum(['auto', 'json', 'native']).default('auto'),
      // 2026-08-18: Text-Fallback-Kanal (false = strikt/nativ, true = Text-Fallback erlaubt)
      text_fallback_enabled: z.boolean().nullable().optional(),
      memory_budget_tokens: z.number().nullable().optional(),
 // Phase 1 (Parität): Cache-Tier-Toggles (NULL = Backend-Default)
      prompt_parallel_tool_guidance: z.boolean().nullable().optional(),
      prompt_tool_guidance_trim: z.boolean().nullable().optional(),
      memory_frozen_snapshot: z.boolean().nullable().optional(),
 // Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default)
      compression_enabled: z.boolean().nullable().optional(),
      compression_threshold_percent: z.number().nullable().optional(),
      compression_tail_token_budget: z.number().nullable().optional(),
      compression_aux_model: z.string().nullable().optional(),
      compression_persist_summary: z.boolean().nullable().optional(),
      compression_model_context_map: z.string().nullable().optional(),
 // Phase 3 (Parität): Memory (NULL = Backend-Default)
      memory_prefetch_enabled: z.boolean().nullable().optional(),
      memory_prefetch_timeout_s: z.number().nullable().optional(),
      memory_recall_status_enabled: z.boolean().nullable().optional(),
      memory_auto_scan_enabled: z.boolean().nullable().optional(),
      memory_consolidation_budget: z.number().nullable().optional(),
 // Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default)
      tool_call_retry_max: z.number().nullable().optional(),
      empty_retry_budget: z.number().nullable().optional(),
      empty_retry_cost_threshold_usd: z.number().nullable().optional(),
      tool_guardrail_exact_block: z.number().nullable().optional(),
      tool_guardrail_no_progress_block: z.number().nullable().optional(),
      loop_deadline_s: z.number().nullable().optional(),
      thinking_scrub_enabled: z.boolean().nullable().optional(),
 // Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default)
      recall_fts_enabled: z.boolean().nullable().optional(),
      recall_search_limit: z.number().nullable().optional(),
 // Phase 6 (Parität): Curator & Skills (NULL = Backend-Default)
      skill_curator_enabled: z.boolean().nullable().optional(),
      skill_inject_max_tokens: z.number().nullable().optional(),
      skill_prune_inactive_after_days: z.number().nullable().optional(),
      skill_inject_top_k: z.number().nullable().optional(),
      curator_interval_hours: z.number().nullable().optional(),
      curator_archive_after_days: z.number().nullable().optional(),
      subtask_max_depth: z.number().nullable().optional(),
 // P1: Audit-Log-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
      audit_retention_days: z.number().nullable().optional(),
 // P1: Session-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
      session_retention_days: z.number().nullable().optional(),
 // Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default)
      mcp_refresh_interval_s: z.number().nullable().optional(),
      subtask_timeout_s: z.number().nullable().optional(),
      subtask_max_parallel: z.number().nullable().optional(),
    }))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;

      if (isUsingFallback) {
        const list = fallbackStore.louisAiConfig || [];
        const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
        if (found) {
          return {
            id_uuid: found.id_uuid,
            provider_type: found.provider_type,
            api_key_secret: found.api_key_secret,
            base_url: found.base_url,
            model_name: found.model_name,
            temperature: found.temperature,
            top_p: found.top_p,
            top_k: found.top_k,
            num_ctx: found.num_ctx,
            embedding_provider: found.embedding_provider || 'ollama',
            embedding_api_key_secret: found.embedding_api_key_secret || '',
            embedding_base_url: found.embedding_base_url || '',
            embedding_model_name: found.embedding_model_name || 'nomic-embed-text',
            vector_dimensions: found.vector_dimensions || 1536,
            keep_alive_minutes: found.keep_alive_minutes ?? 5,
            parallel_slots: found.parallel_slots ?? 1,
            chunk_size: found.chunk_size ?? 500,
            chunk_overlap: found.chunk_overlap ?? 50,
            max_iterations: found.max_iterations ?? null,
            max_history_tokens: found.max_history_tokens ?? null,
            tool_result_truncate_chars: found.tool_result_truncate_chars ?? null,
            react_keep_last_results: found.react_keep_last_results ?? null,
            react_compaction_from_iteration: found.react_compaction_from_iteration ?? null,
            early_exit_after_tools: found.early_exit_after_tools ?? null,
            prompt_directives_mode: (found.prompt_directives_mode as 'always' | 'intent') || 'always',
            react_tool_call_mode: (found.react_tool_call_mode as 'auto' | 'json' | 'native') || 'auto',
            text_fallback_enabled: found.text_fallback_enabled ?? false,
            memory_budget_tokens: found.memory_budget_tokens ?? null,
            prompt_parallel_tool_guidance: found.prompt_parallel_tool_guidance ?? null,
            prompt_tool_guidance_trim: found.prompt_tool_guidance_trim ?? null,
            memory_frozen_snapshot: found.memory_frozen_snapshot ?? null,
            compression_enabled: found.compression_enabled ?? null,
            compression_threshold_percent: found.compression_threshold_percent ?? null,
            compression_tail_token_budget: found.compression_tail_token_budget ?? null,
            compression_aux_model: found.compression_aux_model ?? null,
            compression_persist_summary: found.compression_persist_summary ?? null,
            compression_model_context_map: found.compression_model_context_map ?? null,
            memory_prefetch_enabled: found.memory_prefetch_enabled ?? null,
            memory_prefetch_timeout_s: found.memory_prefetch_timeout_s ?? null,
            memory_recall_status_enabled: found.memory_recall_status_enabled ?? null,
            memory_auto_scan_enabled: found.memory_auto_scan_enabled ?? null,
            memory_consolidation_budget: found.memory_consolidation_budget ?? null,
            tool_call_retry_max: found.tool_call_retry_max ?? null,
            empty_retry_budget: found.empty_retry_budget ?? null,
            empty_retry_cost_threshold_usd: found.empty_retry_cost_threshold_usd ?? null,
            tool_guardrail_exact_block: found.tool_guardrail_exact_block ?? null,
            tool_guardrail_no_progress_block: found.tool_guardrail_no_progress_block ?? null,
            loop_deadline_s: found.loop_deadline_s ?? null,
            thinking_scrub_enabled: found.thinking_scrub_enabled ?? null,
            recall_fts_enabled: found.recall_fts_enabled ?? null,
            recall_search_limit: found.recall_search_limit ?? null,
            skill_curator_enabled: found.skill_curator_enabled ?? null,
            skill_inject_max_tokens: found.skill_inject_max_tokens ?? null,
            skill_prune_inactive_after_days: found.skill_prune_inactive_after_days ?? null,
            skill_inject_top_k: found.skill_inject_top_k ?? null,
            curator_interval_hours: found.curator_interval_hours ?? null,
            curator_archive_after_days: found.curator_archive_after_days ?? null,
            subtask_max_depth: found.subtask_max_depth ?? null,
 // P1: Audit-Log-Retention (NULL = kein Auto-Prune)
            audit_retention_days: found.audit_retention_days ?? null,
 // P1: Session-Retention (NULL = kein Auto-Prune)
            session_retention_days: found.session_retention_days ?? null,
            mcp_refresh_interval_s: found.mcp_refresh_interval_s ?? null,
            subtask_timeout_s: found.subtask_timeout_s ?? null,
            subtask_max_parallel: found.subtask_max_parallel ?? null,
          };
        }
      } else {
        const res = await pool.query(
          `SELECT id_uuid, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx,
                  embedding_provider, embedding_api_key_secret, embedding_base_url, embedding_model_name, vector_dimensions,
                  keep_alive_minutes, parallel_slots, chunk_size, chunk_overlap,
                  max_iterations, max_history_tokens, tool_result_truncate_chars, react_keep_last_results, react_compaction_from_iteration, early_exit_after_tools, prompt_directives_mode, react_tool_call_mode, text_fallback_enabled, memory_budget_tokens, prompt_parallel_tool_guidance, prompt_tool_guidance_trim, memory_frozen_snapshot, compression_enabled, compression_threshold_percent, compression_tail_token_budget, compression_aux_model, compression_persist_summary, compression_model_context_map, memory_prefetch_enabled, memory_prefetch_timeout_s, memory_recall_status_enabled, memory_auto_scan_enabled, memory_consolidation_budget, tool_call_retry_max, empty_retry_budget, empty_retry_cost_threshold_usd, tool_guardrail_exact_block, tool_guardrail_no_progress_block, loop_deadline_s, thinking_scrub_enabled, recall_fts_enabled, recall_search_limit, skill_curator_enabled, skill_inject_max_tokens, skill_prune_inactive_after_days, skill_inject_top_k, curator_interval_hours, curator_archive_after_days, mcp_refresh_interval_s, subtask_timeout_s, subtask_max_parallel, subtask_max_depth, audit_retention_days, session_retention_days
                  FROM sys_integrations_louis_ai_config 
           WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1`,
          [tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id_uuid: row.id_uuid,
            provider_type: row.provider_type as LouisAiConfig['provider_type'],
            api_key_secret: row.api_key_secret,
            base_url: row.base_url,
            model_name: row.model_name,
            temperature: row.temperature,
            top_p: row.top_p,
            top_k: row.top_k,
            num_ctx: row.num_ctx,
            embedding_provider: (row.embedding_provider as LouisAiConfig['embedding_provider']) || 'ollama',
            embedding_api_key_secret: row.embedding_api_key_secret || '',
            embedding_base_url: row.embedding_base_url || '',
            embedding_model_name: row.embedding_model_name || 'nomic-embed-text',
            vector_dimensions: row.vector_dimensions ?? 1536,
            keep_alive_minutes: row.keep_alive_minutes ?? 5,
            parallel_slots: row.parallel_slots ?? 1,
            chunk_size: row.chunk_size ?? 500,
            chunk_overlap: row.chunk_overlap ?? 50,
            max_iterations: row.max_iterations ?? null,
            max_history_tokens: row.max_history_tokens ?? null,
            tool_result_truncate_chars: row.tool_result_truncate_chars ?? null,
            react_keep_last_results: row.react_keep_last_results ?? null,
            react_compaction_from_iteration: row.react_compaction_from_iteration ?? null,
            early_exit_after_tools: row.early_exit_after_tools ?? null,
            prompt_directives_mode: (row.prompt_directives_mode as 'always' | 'intent') || 'always',
            react_tool_call_mode: (row.react_tool_call_mode as 'auto' | 'json' | 'native') || 'auto',
            text_fallback_enabled: row.text_fallback_enabled ?? false,
            memory_budget_tokens: row.memory_budget_tokens ?? null,
            prompt_parallel_tool_guidance: row.prompt_parallel_tool_guidance ?? null,
            prompt_tool_guidance_trim: row.prompt_tool_guidance_trim ?? null,
            memory_frozen_snapshot: row.memory_frozen_snapshot ?? null,
            compression_enabled: row.compression_enabled ?? null,
            compression_threshold_percent: row.compression_threshold_percent ?? null,
            compression_tail_token_budget: row.compression_tail_token_budget ?? null,
            compression_aux_model: row.compression_aux_model ?? null,
            compression_persist_summary: row.compression_persist_summary ?? null,
            compression_model_context_map: row.compression_model_context_map ?? null,
            memory_prefetch_enabled: row.memory_prefetch_enabled ?? null,
            memory_prefetch_timeout_s: row.memory_prefetch_timeout_s ?? null,
            memory_recall_status_enabled: row.memory_recall_status_enabled ?? null,
            memory_auto_scan_enabled: row.memory_auto_scan_enabled ?? null,
            memory_consolidation_budget: row.memory_consolidation_budget ?? null,
            tool_call_retry_max: row.tool_call_retry_max ?? null,
            empty_retry_budget: row.empty_retry_budget ?? null,
            empty_retry_cost_threshold_usd: row.empty_retry_cost_threshold_usd ?? null,
            tool_guardrail_exact_block: row.tool_guardrail_exact_block ?? null,
            tool_guardrail_no_progress_block: row.tool_guardrail_no_progress_block ?? null,
            loop_deadline_s: row.loop_deadline_s ?? null,
            thinking_scrub_enabled: row.thinking_scrub_enabled ?? null,
            recall_fts_enabled: row.recall_fts_enabled ?? null,
            recall_search_limit: row.recall_search_limit ?? null,
            skill_curator_enabled: row.skill_curator_enabled ?? null,
            skill_inject_max_tokens: row.skill_inject_max_tokens ?? null,
            skill_prune_inactive_after_days: row.skill_prune_inactive_after_days ?? null,
            skill_inject_top_k: row.skill_inject_top_k ?? null,
            curator_interval_hours: row.curator_interval_hours ?? null,
            curator_archive_after_days: row.curator_archive_after_days ?? null,
            subtask_max_depth: row.subtask_max_depth ?? null,
 // P1: Audit-Log-Retention (NULL = kein Auto-Prune)
            audit_retention_days: row.audit_retention_days ?? null,
 // P1: Session-Retention (NULL = kein Auto-Prune)
            session_retention_days: row.session_retention_days ?? null,
            mcp_refresh_interval_s: row.mcp_refresh_interval_s ?? null,
            subtask_timeout_s: row.subtask_timeout_s ?? null,
            subtask_max_parallel: row.subtask_max_parallel ?? null,
          };
        }
      }

      // Return unconfigured empty base config
      return {
        provider_type: 'gemini',
        api_key_secret: '',
        base_url: '',
        model_name: '',
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 8192,
        embedding_provider: 'gemini',
        embedding_api_key_secret: '',
        embedding_base_url: '',
        embedding_model_name: '',
        vector_dimensions: 768,
        keep_alive_minutes: 5,
        parallel_slots: 1,
        chunk_size: 500,
        chunk_overlap: 50,
        max_iterations: null,
        max_history_tokens: null,
        tool_result_truncate_chars: null,
        react_keep_last_results: null,
        react_compaction_from_iteration: null,
        early_exit_after_tools: null,
        text_fallback_enabled: false,
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
 // P1: Audit-Log-Retention (NULL = kein Auto-Prune)
        audit_retention_days: null,
 // P1: Session-Retention (NULL = kein Auto-Prune)
        session_retention_days: null,
        mcp_refresh_interval_s: null,
        subtask_timeout_s: null,
        subtask_max_parallel: null,
      };
    }),

  saveConfig: protectedProcedure
    .input(LouisAiConfigSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const id = input.id_uuid || uuidv4();

      if (isUsingFallback) {
        if (!fallbackStore.louisAiConfig) {
          fallbackStore.louisAiConfig = [];
        }
        // Remove existing config
        fallbackStore.louisAiConfig = fallbackStore.louisAiConfig.filter((c) => c.tenant_id !== tenantId);
        fallbackStore.louisAiConfig.push({
          ...input,
          id_uuid: id,
          tenant_id: tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_integrations_louis_ai_config (
            id_uuid, tenant_id, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx,
            embedding_provider, embedding_api_key_secret, embedding_base_url, embedding_model_name, vector_dimensions,
            keep_alive_minutes, parallel_slots, chunk_size, chunk_overlap,
            max_iterations, max_history_tokens, tool_result_truncate_chars, react_keep_last_results, react_compaction_from_iteration, early_exit_after_tools, prompt_directives_mode, react_tool_call_mode,
            memory_budget_tokens, text_fallback_enabled, prompt_parallel_tool_guidance, prompt_tool_guidance_trim, memory_frozen_snapshot, compression_enabled, compression_threshold_percent, compression_tail_token_budget, compression_aux_model, compression_persist_summary, compression_model_context_map, memory_prefetch_enabled, memory_prefetch_timeout_s, memory_recall_status_enabled, memory_auto_scan_enabled, memory_consolidation_budget, tool_call_retry_max, empty_retry_budget, empty_retry_cost_threshold_usd, tool_guardrail_exact_block, tool_guardrail_no_progress_block, loop_deadline_s, thinking_scrub_enabled, recall_fts_enabled, recall_search_limit, skill_curator_enabled, skill_inject_max_tokens, skill_prune_inactive_after_days, skill_inject_top_k, mcp_refresh_interval_s, subtask_timeout_s, subtask_max_parallel, curator_interval_hours, curator_archive_after_days, subtask_max_depth, audit_retention_days, session_retention_days,
 updated_at_utc
 )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58, $59, $60, $61, $62, $63, $64, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id)
          DO UPDATE SET 
            provider_type = EXCLUDED.provider_type,
            api_key_secret = EXCLUDED.api_key_secret,
            base_url = EXCLUDED.base_url,
            model_name = EXCLUDED.model_name,
            temperature = EXCLUDED.temperature,
            top_p = EXCLUDED.top_p,
            top_k = EXCLUDED.top_k,
            num_ctx = EXCLUDED.num_ctx,
            embedding_provider = EXCLUDED.embedding_provider,
            embedding_api_key_secret = EXCLUDED.embedding_api_key_secret,
            embedding_base_url = EXCLUDED.embedding_base_url,
            embedding_model_name = EXCLUDED.embedding_model_name,
            vector_dimensions = EXCLUDED.vector_dimensions,
            keep_alive_minutes = EXCLUDED.keep_alive_minutes,
            parallel_slots = EXCLUDED.parallel_slots,
            chunk_size = EXCLUDED.chunk_size,
            chunk_overlap = EXCLUDED.chunk_overlap,
            max_iterations = EXCLUDED.max_iterations,
            max_history_tokens = EXCLUDED.max_history_tokens,
            tool_result_truncate_chars = EXCLUDED.tool_result_truncate_chars,
            react_keep_last_results = EXCLUDED.react_keep_last_results,
            react_compaction_from_iteration = EXCLUDED.react_compaction_from_iteration,
            early_exit_after_tools = EXCLUDED.early_exit_after_tools,
            prompt_directives_mode = EXCLUDED.prompt_directives_mode,
            react_tool_call_mode = EXCLUDED.react_tool_call_mode,
            text_fallback_enabled = EXCLUDED.text_fallback_enabled,
            memory_budget_tokens = EXCLUDED.memory_budget_tokens,
            prompt_parallel_tool_guidance = EXCLUDED.prompt_parallel_tool_guidance,
            prompt_tool_guidance_trim = EXCLUDED.prompt_tool_guidance_trim,
            memory_frozen_snapshot = EXCLUDED.memory_frozen_snapshot,
            compression_enabled = EXCLUDED.compression_enabled,
            compression_threshold_percent = EXCLUDED.compression_threshold_percent,
            compression_tail_token_budget = EXCLUDED.compression_tail_token_budget,
            compression_aux_model = EXCLUDED.compression_aux_model,
            compression_persist_summary = EXCLUDED.compression_persist_summary,
            compression_model_context_map = EXCLUDED.compression_model_context_map,
            memory_prefetch_enabled = EXCLUDED.memory_prefetch_enabled,
            memory_prefetch_timeout_s = EXCLUDED.memory_prefetch_timeout_s,
            memory_recall_status_enabled = EXCLUDED.memory_recall_status_enabled,
            memory_auto_scan_enabled = EXCLUDED.memory_auto_scan_enabled,
            memory_consolidation_budget = EXCLUDED.memory_consolidation_budget,
            tool_call_retry_max = EXCLUDED.tool_call_retry_max,
            empty_retry_budget = EXCLUDED.empty_retry_budget,
            empty_retry_cost_threshold_usd = EXCLUDED.empty_retry_cost_threshold_usd,
            tool_guardrail_exact_block = EXCLUDED.tool_guardrail_exact_block,
            tool_guardrail_no_progress_block = EXCLUDED.tool_guardrail_no_progress_block,
            loop_deadline_s = EXCLUDED.loop_deadline_s,
            thinking_scrub_enabled = EXCLUDED.thinking_scrub_enabled,
            recall_fts_enabled = EXCLUDED.recall_fts_enabled,
            recall_search_limit = EXCLUDED.recall_search_limit,
            skill_curator_enabled = EXCLUDED.skill_curator_enabled,
            skill_inject_max_tokens = EXCLUDED.skill_inject_max_tokens,
            skill_prune_inactive_after_days = EXCLUDED.skill_prune_inactive_after_days,
            skill_inject_top_k = EXCLUDED.skill_inject_top_k,
            mcp_refresh_interval_s = EXCLUDED.mcp_refresh_interval_s,
            subtask_timeout_s = EXCLUDED.subtask_timeout_s,
            subtask_max_parallel = EXCLUDED.subtask_max_parallel,
            curator_interval_hours = EXCLUDED.curator_interval_hours,
            curator_archive_after_days = EXCLUDED.curator_archive_after_days,
            subtask_max_depth = EXCLUDED.subtask_max_depth,
            audit_retention_days = EXCLUDED.audit_retention_days,
            session_retention_days = EXCLUDED.session_retention_days,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          id,
          tenantId,
          input.provider_type,
          input.api_key_secret,
          input.base_url,
          input.model_name,
          input.temperature,
          input.top_p,
          input.top_k,
          input.num_ctx,
          input.embedding_provider || 'ollama',
          input.embedding_api_key_secret || '',
          input.embedding_base_url || '',
          input.embedding_model_name || 'nomic-embed-text',
          input.vector_dimensions || 1536,
          input.keep_alive_minutes || 5,
          input.parallel_slots || 1,
          input.chunk_size || 500,
          input.chunk_overlap || 50,
          input.max_iterations ?? null,
          input.max_history_tokens ?? null,
          input.tool_result_truncate_chars ?? null,
          input.react_keep_last_results ?? null,
          input.react_compaction_from_iteration ?? null,
          input.early_exit_after_tools ?? null,
          input.prompt_directives_mode || 'always',
          input.react_tool_call_mode || 'auto',
          input.memory_budget_tokens ?? null,
          input.text_fallback_enabled ?? null,
          input.prompt_parallel_tool_guidance ?? null,
          input.prompt_tool_guidance_trim ?? null,
          input.memory_frozen_snapshot ?? null,
          input.compression_enabled ?? null,
          input.compression_threshold_percent ?? null,
          input.compression_tail_token_budget ?? null,
          input.compression_aux_model ?? null,
          input.compression_persist_summary ?? null,
          input.compression_model_context_map ?? null,
          input.memory_prefetch_enabled ?? null,
          input.memory_prefetch_timeout_s ?? null,
          input.memory_recall_status_enabled ?? null,
          input.memory_auto_scan_enabled ?? null,
          input.memory_consolidation_budget ?? null,
          input.tool_call_retry_max ?? null,
          input.empty_retry_budget ?? null,
          input.empty_retry_cost_threshold_usd ?? null,
          input.tool_guardrail_exact_block ?? null,
          input.tool_guardrail_no_progress_block ?? null,
          input.loop_deadline_s ?? null,
          input.thinking_scrub_enabled ?? null,
          input.recall_fts_enabled ?? null,
          input.recall_search_limit ?? null,
          input.skill_curator_enabled ?? null,
          input.skill_inject_max_tokens ?? null,
          input.skill_prune_inactive_after_days ?? null,
          input.skill_inject_top_k ?? null,
          input.mcp_refresh_interval_s ?? null,
          input.subtask_timeout_s ?? null,
          input.subtask_max_parallel ?? null,
          input.curator_interval_hours ?? null,
          input.curator_archive_after_days ?? null,
          input.subtask_max_depth ?? null,
   // P1: Audit-Log-Retention (NULL = kein Auto-Prune)
          input.audit_retention_days ?? null,
   // P1: Session-Retention (NULL = kein Auto-Prune)
          input.session_retention_days ?? null
        ]);
      }

      await logAuditEvent({
        tenantId,
        eventType: "UPDATE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: "LOUIS AI config updated."
      });

      return { success: true };
    }),

 // Task 7 (B2): Token-Metriken-Statistik (Admin-Ansicht „Token-Verbrauch")
  getTokenUsageStats: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(90).default(14) }).optional())
    .output(z.object({
      runs: z.number(),
      totalTokens: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      cachedTokens: z.number(),
      avgTokensPerRun: z.number(),
      byDay: z.array(z.object({
        day: z.string(),
        runs: z.number(),
        totalTokens: z.number()
      })),
      recent: z.array(z.object({
        id_uuid: z.string(),
        prompt: z.string(),
        input_tokens: z.number(),
        output_tokens: z.number(),
        cached_tokens: z.number(),
        total_tokens: z.number(),
        duration_ms: z.number(),
        active_tools: z.number(),
        created_at_utc: z.string()
      })).optional()
    }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      const days = input?.days ?? 14;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      if (isUsingFallback || !pool) {
        const runs = (fallbackStore.agentRuns || []).filter((r) => r.tenant_id === tenantId);
        const recent = runs.slice(0, 20).map((r) => ({
          id_uuid: r.id_uuid,
          prompt: r.prompt,
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cached_tokens: r.cached_tokens,
          total_tokens: r.total_tokens,
          duration_ms: r.duration_ms,
          active_tools: r.active_tools,
          created_at_utc: r.created_at_utc
        }));
        const totalTokens = runs.reduce((a, r) => a + r.total_tokens, 0);
        return {
          runs: runs.length,
          totalTokens,
          inputTokens: runs.reduce((a, r) => a + r.input_tokens, 0),
          outputTokens: runs.reduce((a, r) => a + r.output_tokens, 0),
          cachedTokens: runs.reduce((a, r) => a + r.cached_tokens, 0),
          avgTokensPerRun: runs.length ? Math.round(totalTokens / runs.length) : 0,
          byDay: [],
          recent
        };
      }

      try {
        const res = await pool.query(
          `SELECT
             COUNT(*)::int AS runs,
             COALESCE(SUM(total_tokens), 0)::int AS total_tokens,
             COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
             COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
             COALESCE(SUM(cached_tokens), 0)::int AS cached_tokens,
             CASE WHEN COUNT(*) > 0 THEN ROUND(SUM(total_tokens)::numeric / COUNT(*))::int ELSE 0 END AS avg_tokens
           FROM sys_louis_ai_agent_runs
           WHERE tenant_id = $1 AND created_at_utc >= $2`,
          [tenantId, since]
        );
        const row = res.rows[0] || {};

        const dayRes = await pool.query(
          `SELECT to_char(created_at_utc, 'YYYY-MM-DD') AS day, COUNT(*)::int AS runs, COALESCE(SUM(total_tokens), 0)::int AS total_tokens
           FROM sys_louis_ai_agent_runs
           WHERE tenant_id = $1 AND created_at_utc >= $2
           GROUP BY day ORDER BY day DESC LIMIT 30`,
          [tenantId, since]
        );

        const recentRes = await pool.query(
          `SELECT id_uuid, prompt, input_tokens, output_tokens, cached_tokens, total_tokens, duration_ms, active_tools, created_at_utc
           FROM sys_louis_ai_agent_runs
           WHERE tenant_id = $1
           ORDER BY created_at_utc DESC LIMIT 20`,
          [tenantId]
        );
        const recent = recentRes.rows.map((r) => {
          const iso = r.created_at_utc instanceof Date ? (r.created_at_utc as Date).toISOString() : String(r.created_at_utc);
          return {
            id_uuid: String(r.id_uuid),
            prompt: String(r.prompt || ""),
            input_tokens: Number(r.input_tokens || 0),
            output_tokens: Number(r.output_tokens || 0),
            cached_tokens: Number(r.cached_tokens || 0),
            total_tokens: Number(r.total_tokens || 0),
            duration_ms: Number(r.duration_ms || 0),
            active_tools: Number(r.active_tools || 0),
            created_at_utc: iso
          };
        });

        return {
          runs: Number(row.runs || 0),
          totalTokens: Number(row.total_tokens || 0),
          inputTokens: Number(row.input_tokens || 0),
          outputTokens: Number(row.output_tokens || 0),
          cachedTokens: Number(row.cached_tokens || 0),
          avgTokensPerRun: Number(row.avg_tokens || 0),
          byDay: dayRes.rows.map((d) => ({ day: String(d.day), runs: Number(d.runs), totalTokens: Number(d.total_tokens) })),
          recent
        };
      } catch (err) {
        console.error("[getTokenUsageStats] Query fehlgeschlagen:", err);
        return { runs: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, avgTokensPerRun: 0, byDay: [], recent: [] };
      }
    }),

  // (2026-08-19): Warm Resume — die letzte Session des AKTIVEN Chatprofils
  // (Default, sonst Main) beim Öffnen wiederherstellen. Hierarchie: erst Profil, dann Tenant
  // (2026-2026-08-19: „Chats sind erstmal profilgebunden, dann tenantgebunden“).
  getLastSession: protectedProcedure
    .output(z.object({ id_uuid: z.string() }).nullable())
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        const profiles = fallbackStore.mcpChatProfiles || [];
        const anchor = profiles.find((p) => p.tenant_id === ctx.tenantId && p.is_default)
          || profiles.find((p) => p.tenant_id === ctx.tenantId && p.is_system);
        const anchorId = anchor?.id_uuid || null;
        const s = (fallbackStore.louisAiSessions || [])
          .filter((x) => (x.tenant_id === ctx.tenantId || x.tenant_id === "1") && (!anchorId || x.active_chat_profile_id === anchorId))
          .sort((a, b) => String(b.updated_at_utc || "").localeCompare(String(a.updated_at_utc || "")))[0];
        return s ? { id_uuid: s.id_uuid } : null;
      }
      const res = await pool.query(
        `SELECT s.id_uuid FROM sys_louis_ai_sessions s
         WHERE s.tenant_id = $1
           AND s.active_chat_profile_id = (
             SELECT id_uuid FROM sys_mcp_chat_profiles
             WHERE tenant_id = $1 AND (is_default = TRUE OR is_system = TRUE)
             ORDER BY is_default DESC LIMIT 1
           )
         ORDER BY s.updated_at_utc DESC NULLS LAST, s.created_at_utc DESC LIMIT 1`,
        [ctx.tenantId]
      );
      return res.rows[0] ? { id_uuid: res.rows[0].id_uuid } : null;
    }),

  // --- UI-Lücken-Schließung (2026-08-14): Session-Historie + Workflow-Run für die Chat-UI / Admin-Tabs ---
  // Profilgebunden (2026-2026-08-19): Der Verlauf zeigt nur Sessions des AKTIVEN Chatprofils
  // (jede Profile-Instanz hat ihre eigene Session-DB — ein Profil sieht nur
  // seine eigenen Chats). Ohne profile_id: Bestandsverhalten (alle Tenant-Sessions).
  listSessions: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(100).optional(),
      profile_id: z.string().uuid().optional()
    }).optional())
    .output(z.array(z.object({
      id_uuid: z.string(),
      session_title: z.string(),
      created_at_utc: z.string(),
      updated_at_utc: z.string(),
      message_count: z.number(),
      short_term_summary_text: z.string().optional()
    })))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      const limit = input?.limit ?? 100;
      const profileId = input?.profile_id ?? null;
      if (isUsingFallback) {
        return (fallbackStore.louisAiSessions || [])
          .filter((s) => (s.tenant_id === tenantId || s.tenant_id === "1") && (!profileId || s.active_chat_profile_id === profileId))
          .sort((a, b) => String(b.updated_at_utc).localeCompare(String(a.updated_at_utc)))
          .slice(0, limit)
          .map((s) => ({
            id_uuid: s.id_uuid,
            session_title: String(s.session_title || ""),
            created_at_utc: String(s.created_at_utc || ""),
            updated_at_utc: String(s.updated_at_utc || ""),
            message_count: Array.isArray(s.conversation_history_json) ? s.conversation_history_json.length : 0
          }));
      }
      const res = await pool.query(
        `SELECT id_uuid, session_title, created_at_utc, updated_at_utc, COALESCE(jsonb_array_length(conversation_history_json), 0) AS message_count, short_term_summary_text
         FROM sys_louis_ai_sessions WHERE (tenant_id = $1 OR tenant_id = '1') AND ($3::uuid IS NULL OR active_chat_profile_id = $3) ORDER BY updated_at_utc DESC LIMIT $2`,
        [tenantId, limit, profileId]
      );
      return res.rows.map((r: unknown) => {
        const row = r as Record<string, unknown>;
        return {
          id_uuid: String(row.id_uuid),
          session_title: String(row.session_title || ""),
          created_at_utc: row.created_at_utc ? new Date(row.created_at_utc as string).toISOString() : "",
          updated_at_utc: row.updated_at_utc ? new Date(row.updated_at_utc as string).toISOString() : "",
          message_count: Number(row.message_count || 0),
          short_term_summary_text: String(row.short_term_summary_text || "")
        };
      });
    }),

  getSessionHistory: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1).max(64) }))
    .output(z.object({
      session_title: z.string(),
      conversation_history_json: z.array(z.record(z.string(), z.unknown())),
      short_term_summary_text: z.string()
    }))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const session = (fallbackStore.louisAiSessions || []).find((s) => s.id_uuid === input.sessionId && (s.tenant_id === tenantId || s.tenant_id === "1"));
        if (!session) throw new Error("Session nicht gefunden");
        return {
          session_title: String(session.session_title || ""),
          conversation_history_json: typeof session.conversation_history_json === "string"
            ? JSON.parse(session.conversation_history_json) as unknown as Array<Record<string, unknown>>
            : (session.conversation_history_json as unknown as Array<Record<string, unknown>> || []),
          short_term_summary_text: String(session.short_term_summary_text || "")
        };
      }
      const res = await pool.query(
        `SELECT session_title, conversation_history_json, short_term_summary_text FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
        [input.sessionId, tenantId]
      );
      if (res.rows.length === 0) throw new Error("Session nicht gefunden");
      const row = res.rows[0] as Record<string, unknown>;
      const rawHist = row.conversation_history_json;
      return {
        session_title: String(row.session_title || ""),
        conversation_history_json: typeof rawHist === "string" ? JSON.parse(rawHist) as unknown as Array<Record<string, unknown>> : (rawHist as unknown as Array<Record<string, unknown>> || []),
        short_term_summary_text: String(row.short_term_summary_text || "")
      };
    }),

  deleteChatSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1).max(64) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";
      if (isUsingFallback) {
        const idx = (fallbackStore.louisAiSessions || []).findIndex((s) => s.id_uuid === input.sessionId && (s.tenant_id === tenantId || s.tenant_id === "1"));
        if (idx === -1) throw new Error("Session nicht gefunden");
        fallbackStore.louisAiSessions.splice(idx, 1);
        saveFallbackStore();
      } else {
        const res = await pool.query(
          `DELETE FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
          [input.sessionId, tenantId]
        );
        if ((res.rowCount ?? 0) === 0) throw new Error("Session nicht gefunden");
      }
      await logAuditEvent({ tenantId, eventType: "DELETE", entityType: "AI_SESSION", entityId: input.sessionId, eventDetails: "Chat-Session gelöscht", actorIdentity: userId });
      return { success: true };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      message: z.string().min(1),
      sessionId: z.string().uuid().optional(),
      language: z.string().default('de'),
      attachments: z.array(ChatAttachmentInputSchema).max(5).optional(),
 // P0-3: Optionale Session-Verkettung (Lineage) — Client setzt es bei „beziehe dich auf unser letztes Gespräch“
      parentSessionId: z.string().uuid().optional(),
      // 2026-08-20: Das im Chat gewählte Chatprofil — die NEUE Session wird daran
      // gebunden (nicht ans Default!): Profilwechsel = neuer Chat-Kontext, keine Umbindung.
      chat_profile_id: z.string().uuid().optional()
    }))
    .output(z.object({
      replyText: z.string(),
      thoughtLog: z.array(z.string()).optional(),
      proposedChanges: ProposedDiffSchema.or(z.array(z.record(z.string(), z.unknown()))).or(z.record(z.string(), z.unknown())).optional().nullable(),
      sessionId: z.string(),
 // P2-D: verwendete Vault-Skills (aus Thought-Log-Zeile, optional)
      usedSkills: z.array(z.string()).optional(),
 // Phase 3 (#20): Recall-Status-Feedback (🧠-Hinweis in der Chat-UI)
      memoryRecallCount: z.number().optional(),
 // P0-B: Louis komprimiert gerade den Verlauf — Nachricht NICHT verarbeitet
      compressionInProgress: z.boolean().optional(),
      metrics: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";
      let sessionId = input.sessionId || uuidv4();
      let history: ChatMessage[] = [];
      let currentSummary = "";

 // P0-B (Plan-Review): Kompressions-Guard VOR der Session-Verarbeitung.
      // bewährtes Lock-Muster (compression_locks + BUSY_WAIT) — kurz warten (max 5s,
      // Polling 250ms), dann sauberes Refuse statt parallelem Schreiben in die Session
      // (sonst gingen Nachrichten verloren, die während der Rotation in die alte Session
      // wandern). Nur für bestehende Sessions relevant — neue Sessions haben keinen Lock.
      if (input.sessionId && !(await waitForCompressionLock(input.sessionId))) {
        return {
          replyText: "",
          sessionId: input.sessionId,
          compressionInProgress: true
        };
      }

 // P0: Rotation-Registry — der Client sendet evtl. noch mit der alten
      // SessionId (die Kompression rotierte die Session im Hintergrund). Auf die
      // Kind-Session umleiten, damit die Nachricht im aktiven Kontext landet.
 // P1 (B2): Umleitung ist IDEMPOTENT — der Eintrag wird NICHT sofort
      // gelöscht (früher: Race — bei LLM-Fehler nach der Umleitung lief der Chat in der
      // falschen Session weiter). Cleanup passiert erst, wenn der Client nachweislich
      // mit der Kind-SessionId sendet (forgetSessionRotationByChild) oder der TTL verfällt.
      const rotatedTo = input.sessionId ? resolveRotatedSessionId(tenantId, input.sessionId) : undefined;
      if (rotatedTo) {
        sessionId = rotatedTo;
      } else if (input.sessionId) {
        // Client sendet direkt mit der (Kind-)SessionId → die Umleitung für die alte ID ist überflüssig
        forgetSessionRotationByChild(tenantId, input.sessionId);
      }

      // C.7 (Plan 2026-08-19): Wechsel-Sperre — laufender Chat-Task blockiert Profilwechsel.
      // Best-effort-Clear am Ende; TTL 10 min schützt vor klebenden Markern.
      markChatTaskActive(sessionId, true);
      const releaseChatTask = (): void => markChatTaskActive(sessionId, false);

      // 1. Load History
      if (isUsingFallback) {
        if (!fallbackStore.louisAiSessions) {
          fallbackStore.louisAiSessions = [];
        }
        const session = fallbackStore.louisAiSessions.find((s) => s.id_uuid === sessionId && s.tenant_id === tenantId);
        if (session) {
          history = typeof session.conversation_history_json === 'string'
            ? JSON.parse(session.conversation_history_json)
            : session.conversation_history_json;
          currentSummary = session.short_term_summary_text || "";
        } else {
          fallbackStore.louisAiSessions.push({
            id_uuid: sessionId,
            tenant_id: tenantId,
            session_title: input.message.slice(0, 40),
            conversation_history_json: [],
            short_term_summary_text: "",
            parent_session_id: input.parentSessionId || null,
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          });
          saveFallbackStore();
        }
      } else {
        const res = await pool.query(
          "SELECT conversation_history_json, short_term_summary_text FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1",
          [sessionId, tenantId]
        );
        if (res.rows.length > 0) {
          const rawHist = res.rows[0].conversation_history_json;
          history = typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist;
          currentSummary = res.rows[0].short_term_summary_text || "";
        } else {
          // 2026-08-20: Neue Session an das IM CHAT GEWÄHLTE Profil binden
          // (chat_profile_id), sonst Default (Admin gesetzt) oder Main.
          const defaultProfileId = await getDefaultProfileId(tenantId);
          await pool.query(`
            INSERT INTO sys_louis_ai_sessions (id_uuid, tenant_id, session_title, conversation_history_json, short_term_summary_text, parent_session_id, active_chat_profile_id)
            VALUES ($1, $2, $3, '[]'::jsonb, '', $4, $5)
          `, [sessionId, tenantId, input.message.slice(0, 40), input.parentSessionId || null, input.chat_profile_id || defaultProfileId]);
        }
      }

      // Add user message to local history array
      history.push({
        role: 'user',
        content: input.message,
        timestamp_utc: new Date().toISOString(),
        metadata: input.attachments && input.attachments.length > 0
          ? {
              attachments: input.attachments.map((a) => ({
                fileName: a.fileName,
                isIndexedInKnowledgeBase: a.isIndexedInKnowledgeBase || false
              }))
            }
          : undefined
      });

      // Resolve attached files (extracted text from sidecar .txt) for prompt injection
      const attachmentContexts = input.attachments && input.attachments.length > 0
        ? await resolveChatAttachmentContexts(input.attachments)
        : [];

 // Phase 2 (#13): Kontext-Kompression NIE auf dem Antwort-Pfad.
      // Früher: synchroner LLM-Call mit 4s-Timeout-Race (Ergebnis wurde still verworfen).
      // Jetzt: Background-Worker persistiert Summary + trimmt die Session-History;
      // der laufende Request nutzt den bisherigen Summary, der NÄCHSTE den neuen.
      // #15: Modelle mit nativem Context-Management (z.B. Gemini) werden durchgereicht.
      const compressionAiConfig = await getTenantAiConfig(tenantId);
      const compressionModelName = compressionAiConfig.model_name || "llama3";
      const nativeCompaction = supportsNativeCompaction(compressionModelName, compressionAiConfig.compression_model_context_map);
      const updatedSummary = currentSummary;
      if ((compressionAiConfig.compression_enabled ?? true) && !nativeCompaction) {
        scheduleBackgroundCompression({
          tenantId,
          sessionId,
          history,
          currentSummary,
          modelName: compressionModelName,
          rawContextMap: compressionAiConfig.compression_model_context_map ?? null,
          thresholdPercent: compressionAiConfig.compression_threshold_percent ?? null,
          tailTokenBudget: compressionAiConfig.compression_tail_token_budget ?? null,
          persistSummary: compressionAiConfig.compression_persist_summary ?? true,
          auxModel: compressionAiConfig.compression_aux_model ?? null
        }).catch((err) => console.warn("[Kompression] Background-Kompression fehlgeschlagen (ignoriert):", err));
      }

      // Retrieve Tenant specific language configuration
      let tenantLang = input.language || 'de';
      if (isUsingFallback) {
        if (fallbackStore.myCompany && fallbackStore.myCompany.language) {
          tenantLang = fallbackStore.myCompany.language;
        }
      } else {
        try {
          const companyRes = await pool.query(
            "SELECT language FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (companyRes.rows.length > 0 && companyRes.rows[0].language) {
            tenantLang = companyRes.rows[0].language;
          }
        } catch (err) {
          console.warn("Could not query tenant language from core_registry_my_company", err);
        }
      }

      // We pass the up-to-date summary and a trimmed version of conversationHistory (last 5 items) to runLouisAiFlow
      // This reduces token footprint and improves model performance drastically, while memory maintains context.
      const trimmedHistory = history.length > 5 ? history.slice(-5) : history;
      const result = await runLouisAiFlow(tenantId, userId, input.message, trimmedHistory, tenantLang, updatedSummary, attachmentContexts, undefined, sessionId);

      // Append assistant outcome
      history.push({
        role: 'assistant',
        content: result.replyText,
        thought_log: result.thoughtLog,
        proposed_changes: result.proposedChanges,
        timestamp_utc: new Date().toISOString(),
        metrics: result.metrics
      });

      // 2. Persist updated History & updated short-term summary
      if (isUsingFallback) {
        const session = fallbackStore.louisAiSessions.find((s) => s.id_uuid === sessionId && s.tenant_id === tenantId);
        if (session) {
          session.conversation_history_json = history;
          session.short_term_summary_text = updatedSummary;
          saveFallbackStore();
        }
      } else {
        await pool.query(`
          UPDATE sys_louis_ai_sessions
          SET conversation_history_json = $1, short_term_summary_text = $2, updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $3 AND tenant_id = $4
        `, [JSON.stringify(history), updatedSummary, sessionId, tenantId]);
      }

      // Phase 3 (#19/#22): Background-Memory-Sync + Konsolidierung — nie auf dem
      // Antwort-Pfad (fire-and-forget, Fehler non-fatal; Muster sync_all: seriell, nie inline).
      try {
        scheduleBackgroundMemorySync({
          tenantId,
          userId,
          userMessage: input.message,
          replyText: result.replyText,
          language: tenantLang,
          autoScanEnabled: compressionAiConfig.memory_auto_scan_enabled ?? true,
          modelName: compressionAiConfig.model_name || "llama3",
          rawContextMap: compressionAiConfig.compression_model_context_map ?? null
        }).catch((err) => console.warn("[Memory-Sync] Background-Memory-Sync fehlgeschlagen (ignoriert):", err));
        scheduleMemoryConsolidation({
          tenantId,
          userId,
          language: tenantLang,
          budgetTokens: compressionAiConfig.memory_consolidation_budget ?? 800,
          modelName: compressionAiConfig.model_name || "llama3"
        }).catch((err) => console.warn("[Memory-Sync] Memory-Konsolidierung fehlgeschlagen (ignoriert):", err));
      } catch (err) {
        console.warn("[Memory-Sync] Memory-Background-Jobs nicht gestartet (ignoriert):", err);
      }

      // 3. Dual-Storage Logging in ai_chat_logs
      if (result.metrics) {
        const pTokens = result.metrics.inputTokens || 0;
        const cTokens = result.metrics.outputTokens || 0;
        const cachedToks = result.metrics.cachedTokens || 0;
        const totTokens = result.metrics.totalTokens || (pTokens + cTokens);

        if (!isUsingFallback) {
          try {
            await pool.query(
              `INSERT INTO ai_chat_logs 
               (tenant_id, session_id, prompt_tokens, completion_tokens, cached_tokens, total_tokens, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [tenantId, sessionId, pTokens, cTokens, cachedToks, totTokens]
            );
          } catch (err) {
            console.warn("Failed to log ai_chat_logs in DB:", err);
          }
        } else {
          fallbackStore.aiChatLogs = fallbackStore.aiChatLogs || [];
          fallbackStore.aiChatLogs.push({
            tenantId,
            sessionId,
            promptTokens: pTokens,
            completionTokens: cTokens,
            cachedTokens: cachedToks,
            totalTokens: totTokens,
            createdAt: new Date().toISOString()
          });
          saveFallbackStore();
        }

        workflowEventBus.emitEvent(tenantId, 'louis_ai.chat_logged', {
          sessionId,
          cachedTokens: cachedToks,
          totalTokens: totTokens
        });
      }

      // C.7: Task-Marker freigeben (Wechsel-Sperre)
      releaseChatTask();

      const resultObj = {
        replyText: result.replyText,
        thoughtLog: result.thoughtLog,
        proposedChanges: result.proposedChanges,
        sessionId,
 // P2-D: Skill-Badges — aus „[S10] Verwendete Skills: X, Y“ extrahieren
        usedSkills: extractUsedSkills(result.thoughtLog),
   // Phase 3 (#20): Recall-Status-Feedback (🧠-Hinweis in der Chat-UI)
        memoryRecallCount: result.memoryRecallCount ?? 0,
        metrics: result.metrics
      };

      // 053 (052-B1): Chat-Antwort auf eine Rückfrage schließt die OPEN-Frage —
      // sonst bleibt sie im Admin-Tab beantwortbar (Konsistenz-Problem 2026-08-21).
      // Der Agent hat die Frage als Kontext erhalten und passend beantwortet;
      // jetzt wird der Status konsistent zu answerQuestionForChat gesetzt
      // (nur die NEUESTE OPEN-Frage des Tenants; WHERE status='OPEN' = idempotent).
      if (isUsingFallback || !pool) {
        const open = (fallbackStore.aiQuestions || [])
          .filter((q) => (q.tenant_id === tenantId || q.tenant_id === "1") && q.status === "OPEN")
          .sort((a, b) => String(b.created_at_utc || "").localeCompare(String(a.created_at_utc || "")));
        if (open.length > 0) {
          open[0].status = "ANSWERED";
          open[0].answer = input.message;
          open[0].answered_at_utc = new Date().toISOString();
          saveFallbackStore();
        }
      } else {
        await pool.query(
          `UPDATE sys_louis_ai_questions SET status = 'ANSWERED', answer = $1, answered_at_utc = CURRENT_TIMESTAMP
           WHERE id_uuid = (SELECT id_uuid FROM sys_louis_ai_questions
                            WHERE (tenant_id = $2 OR tenant_id = '1') AND status = 'OPEN'
                            ORDER BY created_at_utc DESC LIMIT 1)
             AND status = 'OPEN'`,
          [input.message, tenantId]
        );
      }
      return resultObj;
    }),

  // 052 (048-B1): Live-Status während der Antwort-Verarbeitung (Parität zur
  // Agent-Referenz-UI). Fail-open: kein Lauf/abgelaufen → { active: false }.
  // isPending gepollt (~800ms), speist Status-Zeile + Live-Thought-Block.
  getChatRunStatus: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid().optional() }))
    .output(z.object({
      active: z.boolean(),
      current: z.object({ kind: z.enum(["tool", "workflow", "skill", "phase"]), label: z.string() }).nullable(),
      lines: z.array(z.string())
    }))
    .query(({ input }) => {
      return getChatRunStatus(input.sessionId || "");
    }),

  approveProposal: protectedProcedure
    .input(ProposedDiffSchema)
    .output(z.object({ success: z.boolean(), appliedId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const actorIdentity = "ai_assistant";
      const appliedId = input.id_uuid || uuidv4();
      const action = input.action; // CREATE, UPDATE, DELETE
      const entityType = input.entity_type; // 'companies' | 'contacts' | 'invoices'

      if (entityType === "emails") {
        // ACTUALLY SEND THE SMTP EMAIL NOW THAT THE HUMAN APPROVED IT!
        const pState = input.proposed_state;
        let recipient = String(pState.recipient_email_address || pState.recipient || pState.to || "").trim();
        const invoiceId = pState.invoice_id && pState.invoice_id !== 'null' ? String(pState.invoice_id).trim() : undefined;

        if (!recipient || !recipient.includes("@")) {
          let resolvedEmail = "";

          // 1. Try resolving via invoiceId first
          if (invoiceId) {
            if (isUsingFallback) {
              const inv = fallbackStore.invoices?.find(i => i.id_uuid === invoiceId || i.invoice_number === invoiceId || i.invoice_number?.toLowerCase() === invoiceId.toLowerCase());
              if (inv) {
                const ct = fallbackStore.contacts?.find(c => c.id_uuid === inv.associated_contact_id) ||
                           fallbackStore.contacts?.find(c => c.associated_company_id === inv.associated_company_id && (c.email_address || c.email_2));
                const co = fallbackStore.companies?.find(c => c.id_uuid === inv.associated_company_id);
                resolvedEmail = ct?.email_address || ct?.email_2 || co?.email_address || co?.email_2 || "";
              }
            } else {
              try {
                const invRes = await pool.query(
                  `SELECT COALESCE(
                     ct.email_address, ct.email_2, 
                     ct_fallback.email_address, ct_fallback.email_2, 
                     co.email_address, co.email_2,
                     i.contact_email
                   ) AS target_email
                   FROM fiscal_billing_invoices i
                   LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
                   LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
                   LEFT JOIN LATERAL (
                     SELECT email_address, email_2 FROM core_registry_contacts
                     WHERE (associated_company_id = i.associated_company_id OR id_uuid = i.associated_contact_id)
                       AND (email_address IS NOT NULL AND email_address != '')
                     LIMIT 1
                   ) ct_fallback ON i.associated_company_id IS NOT NULL OR i.associated_contact_id IS NOT NULL
                   WHERE (i.tenant_id = $1 OR i.tenant_id = '1') AND (i.id_uuid = $2 OR LOWER(i.invoice_number) = LOWER($2))
                   LIMIT 1`,
                  [tenantId, invoiceId]
                );
                if (invRes.rows.length > 0 && invRes.rows[0].target_email) {
                  resolvedEmail = invRes.rows[0].target_email;
                }
              } catch (e) {
                console.warn("[ApproveProposal] Recipient auto-resolve from invoice failed:", e);
              }
            }
          }

          // 2. If recipient text exists (e.g. "Max Mustermann" or "Firma ACME"), search contacts/companies by name
          if (!resolvedEmail && recipient.length > 0) {
            if (isUsingFallback) {
              const contact = fallbackStore.contacts?.find((c: Contact) => 
                c.tenant_id === tenantId && (
                  c.full_legal_name?.toLowerCase().includes(recipient.toLowerCase()) ||
                  `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(recipient.toLowerCase())
                )
              );
              if (contact && (contact.email_address || contact.email_2)) {
                resolvedEmail = contact.email_address || contact.email_2 || "";
              } else {
                const company = fallbackStore.companies?.find((co: Company) => 
                  co.tenant_id === tenantId && co.full_legal_name?.toLowerCase().includes(recipient.toLowerCase())
                );
                if (company && (company.email_address || company.email_2)) {
                  resolvedEmail = company.email_address || company.email_2 || "";
                }
              }
            } else {
              try {
                const contactRes = await pool.query(
                  `SELECT COALESCE(ct.email_address, ct.email_2, co.email_address, co.email_2) AS target_email
                   FROM core_registry_contacts ct
                   LEFT JOIN core_registry_companies co ON ct.associated_company_id = co.id_uuid
                   WHERE (ct.tenant_id = $1 OR ct.tenant_id = '1') AND (
                     LOWER(ct.full_legal_name) LIKE LOWER($2) OR 
                     LOWER(ct.first_name || ' ' || ct.last_name) LIKE LOWER($2)
                   ) AND (ct.email_address IS NOT NULL OR ct.email_2 IS NOT NULL OR co.email_address IS NOT NULL OR co.email_2 IS NOT NULL)
                   LIMIT 1`,
                  [tenantId, `%${recipient}%`]
                );
                if (contactRes.rows.length > 0 && contactRes.rows[0].target_email) {
                  resolvedEmail = contactRes.rows[0].target_email;
                } else {
                  const companyRes = await pool.query(
                    `SELECT COALESCE(co.email_address, co.email_2, ct.email_address, ct.email_2) AS target_email
                     FROM core_registry_companies co
                     LEFT JOIN core_registry_contacts ct ON ct.associated_company_id = co.id_uuid
                     WHERE (co.tenant_id = $1 OR co.tenant_id = '1') AND LOWER(co.full_legal_name) LIKE LOWER($2)
                     AND (co.email_address IS NOT NULL OR co.email_2 IS NOT NULL OR ct.email_address IS NOT NULL OR ct.email_2 IS NOT NULL)
                     LIMIT 1`,
                    [tenantId, `%${recipient}%`]
                  );
                  if (companyRes.rows.length > 0 && companyRes.rows[0].target_email) {
                    resolvedEmail = companyRes.rows[0].target_email;
                  }
                }
              } catch (dbErr) {
                console.warn("[ApproveProposal] Error resolving recipient email from DB:", dbErr);
              }
            }
          }

          // 3. Fallback to any company or contact email in the tenant
          if (!resolvedEmail) {
            if (isUsingFallback) {
              const ct = fallbackStore.contacts?.find(c => c.tenant_id === tenantId && (c.email_address || c.email_2));
              const co = fallbackStore.companies?.find(c => c.tenant_id === tenantId && (c.email_address || c.email_2));
              resolvedEmail = ct?.email_address || ct?.email_2 || co?.email_address || co?.email_2 || "";
            } else {
              try {
                const anyRes = await pool.query(
                  `SELECT email_address FROM core_registry_contacts WHERE (tenant_id = $1 OR tenant_id = '1') AND email_address IS NOT NULL AND email_address != '' LIMIT 1`,
                  [tenantId]
                );
                if (anyRes.rows.length > 0) resolvedEmail = anyRes.rows[0].email_address;
                else {
                  const anyCoRes = await pool.query(
                    `SELECT email_address FROM core_registry_companies WHERE (tenant_id = $1 OR tenant_id = '1') AND email_address IS NOT NULL AND email_address != '' LIMIT 1`,
                    [tenantId]
                  );
                  if (anyCoRes.rows.length > 0) resolvedEmail = anyCoRes.rows[0].email_address;
                }
              } catch (e) {
                console.warn("[ApproveProposal] Fallback email query failed:", e);
              }
            }
          }

          const defaultUserEmail = ctx.session?.user?.email || "";
          recipient = resolvedEmail || defaultUserEmail || (invoiceId ? "buchhaltung@kunden.de" : "kontakt@kunden.de");
        }

        if (!recipient || !recipient.includes("@")) {
          throw new Error("Fehler: Bitte geben Sie eine gültige E-Mail-Adresse als Empfänger an, bevor Sie diese E-Mail freigeben.");
        }
        const subject = String(pState.email_subject_text || "").trim();
        const body = String(pState.email_body_content || "").trim();

        // Retrieve SMTP Settings
        let smtp: SmtpSettings | undefined;
        if (isUsingFallback) {
          smtp = fallbackStore.smtpSettings;
        } else {
          const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [tenantId]);
          smtp = res.rows[0];
        }

        if (!smtp) {
          throw new Error("Fehler: SMTP-Verbindung ist nicht eingerichtet. Bitte konfigurieren Sie SMTP unter Admin > Verbindungen.");
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

        const attachments: { filename: string; path: string }[] = [];
        if (invoiceId) {
          try {
            console.log(`[SMTP AI Human-In-The-Loop] Compiling invoice files from disk for Invoice-UUID: ${invoiceId}`);
            await generateInvoiceFilesOnDisk(invoiceId, tenantId);
            let invoice: (Invoice & { entityType?: string; entityId?: string; entityName?: string; co_name?: string; ct_name?: string; company_name?: string }) | null = null;
            if (isUsingFallback) {
              const found = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
              if (found) {
                invoice = { ...found };
                if (invoice.associated_company_id) {
                  const co = fallbackStore.companies.find(c => c.id_uuid === invoice.associated_company_id);
                  invoice.entityType = "companies";
                  invoice.entityId = co?.id_uuid;
                  invoice.entityName = co?.full_legal_name;
                } else if (invoice.associated_contact_id) {
                  const ct = fallbackStore.contacts.find(c => c.id_uuid === invoice.associated_contact_id);
                  invoice.entityType = "contacts";
                  invoice.entityId = ct?.id_uuid;
                  invoice.entityName = ct?.full_legal_name;
                }
              }
            } else {
              const invoiceRes = await pool.query(`
                SELECT i.*, 
                       co.full_legal_name as co_name, 
                       ct.full_legal_name as ct_name
                FROM fiscal_billing_invoices i
                LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
                LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
                WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
              `, [invoiceId, tenantId]);
              invoice = invoiceRes.rows[0];
              if (invoice) {
                if (invoice.associated_company_id) {
                  invoice.entityType = "companies";
                  invoice.entityId = invoice.associated_company_id;
                  invoice.entityName = invoice.co_name;
                } else if (invoice.associated_contact_id) {
                  invoice.entityType = "contacts";
                  invoice.entityId = invoice.associated_contact_id;
                  invoice.entityName = invoice.ct_name;
                }
              }
            }

            if (invoice && invoice.entityId) {
              const cleanNum = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
              const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, tenantId);
              const displayPdfPath = path.join(entityStoragePath, `rechnung_${cleanNum}.pdf`);
              const recipientName = invoice.entityName || invoice.company_name || 'Empfaenger';
              const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
              const filename = `Rechnung - ${cleanRecipient} - ${cleanNum}.pdf`;

              if (fs.existsSync(displayPdfPath)) {
                attachments.push({
                  filename: filename,
                  path: displayPdfPath
                });
                console.log(`[SMTP Human-In-The-Loop] Attached PDF: ${displayPdfPath}`);
              } else {
                console.warn(`[SMTP Human-In-The-Loop] PDF does not exist at path: ${displayPdfPath}`);
              }
            }
          } catch (pdfErr) {
            console.error("Failed to compile attachment PDF in SMTP human approved send:", pdfErr);
          }
        }

        // Process other attachments if any (from knowledge_data_vault or contact/company vaults)
        if (Array.isArray(pState.attachments)) {
          for (const att of pState.attachments) {
            const filename = String(att.filename || "").trim();
            const source = String(att.source || "knowledge").toLowerCase();
            if (!filename) continue;

            let resolvedPath = "";
            let eId = att.entity_id || att.entityId;
            let eType = att.entity_type || att.entityType;

            if (source === "knowledge") {
              const baseDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
              let tempPath = path.join(baseDir, filename);
              if (fs.existsSync(tempPath)) {
                resolvedPath = tempPath;
              } else {
                // Try case-insensitive list or partial contains-matching
                if (fs.existsSync(baseDir)) {
                  const filesInDir = fs.readdirSync(baseDir);
                  const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                  filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                  if (matched) {
                    resolvedPath = path.join(baseDir, matched);
                  }
                }
                // Try fallback to tenant "1"
                if (!resolvedPath && tenantId !== "1") {
                  const fallbackBaseDir = path.resolve(process.cwd(), "knowledge_data_vault", "1");
                  const fallbackPath = path.join(fallbackBaseDir, filename);
                  if (fs.existsSync(fallbackPath)) {
                    resolvedPath = fallbackPath;
                  } else if (fs.existsSync(fallbackBaseDir)) {
                    const filesInDir = fs.readdirSync(fallbackBaseDir);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(fallbackBaseDir, matched);
                    }
                  }
                }
                // Try fallback to root folder
                if (!resolvedPath) {
                  const rootBaseDir = path.resolve(process.cwd(), "knowledge_data_vault");
                  const rootPath = path.join(rootBaseDir, filename);
                  if (fs.existsSync(rootPath)) {
                    resolvedPath = rootPath;
                  }
                }
              }
            } else if (source === "vault") {
              const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();
              
              // If entity_id or entity_type is missing, try to resolve via recipient contact first, then company
              if (!eId || !eType) {
                let contact: Contact | null = null;
                if (isUsingFallback) {
                  contact = fallbackStore.contacts?.find((c: Contact) => 
                    c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
                  ) || null;
                } else {
                  try {
                    const contactRes = await pool.query(
                      `SELECT c.* FROM core_registry_contacts c WHERE LOWER(c.email_address) = LOWER($1) AND (c.tenant_id = $2 OR c.tenant_id = '1') LIMIT 1`,
                      [cleanRecipient, tenantId]
                    );
                    if (contactRes.rows.length > 0) {
                      contact = contactRes.rows[0];
                    }
                  } catch (e) {}
                }
                if (contact) {
                  eId = contact.id_uuid;
                  eType = "contacts";
                } else {
                  // Fallback to company
                  let company: Company | null = null;
                  if (isUsingFallback) {
                    company = fallbackStore.companies?.find((co: Company) => 
                      co.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && co.tenant_id === tenantId
                    ) || null;
                  } else {
                    try {
                      const companyRes = await pool.query(
                        `SELECT * FROM core_registry_companies WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
                        [cleanRecipient, tenantId]
                      );
                      if (companyRes.rows.length > 0) {
                        company = companyRes.rows[0];
                      }
                    } catch (e) {}
                  }
                  if (company) {
                    eId = company.id_uuid;
                    eType = "companies";
                  }
                }
              }

              if (eId && eType) {
                let entityName = "Vault";
                if (isUsingFallback) {
                  if (eType === "companies" || eType === "company") {
                    const co = fallbackStore.companies?.find(c => c.id_uuid === eId);
                    if (co) entityName = co.full_legal_name || "Vault";
                  } else {
                    const ct = fallbackStore.contacts?.find(c => c.id_uuid === eId);
                    if (ct) {
                      entityName = ct.full_legal_name || `${ct.first_name || ''} ${ct.last_name || ''}`.trim() || "Vault";
                    }
                  }
                } else {
                  try {
                    const isCompany = eType === "companies" || eType === "company";
                    const table = isCompany ? "core_registry_companies" : "core_registry_contacts";
                    if (isCompany) {
                      const res = await pool.query(`SELECT full_legal_name FROM ${table} WHERE id_uuid = $1 LIMIT 1`, [eId]);
                      if (res.rows.length > 0) {
                        entityName = res.rows[0].full_legal_name || "Vault";
                      }
                    } else {
                      const res = await pool.query(`SELECT full_legal_name, first_name, last_name FROM ${table} WHERE id_uuid = $1 LIMIT 1`, [eId]);
                      if (res.rows.length > 0) {
                        const r = res.rows[0];
                        entityName = r.full_legal_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || "Vault";
                      }
                    }
                  } catch (err) {
                    console.warn("Could not query entity name for approved attachment resolv:", err);
                  }
                }
                const entityPath = getEntityStoragePath(eType, eId, entityName, tenantId);
                let tempPath = path.join(entityPath, filename);
                if (fs.existsSync(tempPath)) {
                  resolvedPath = tempPath;
                } else {
                  // Try case-insensitive or partial contains-matching inside entity Path!
                  if (fs.existsSync(entityPath)) {
                    const filesInDir = fs.readdirSync(entityPath);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(entityPath, matched);
                    }
                  }
                }
              }
            }

            // Double fallback: if not found, check reciprocal sources
            if (!resolvedPath) {
              // If source says vault but not found, check knowledge
              if (source === "vault") {
                const baseDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
                if (fs.existsSync(baseDir)) {
                  const filesInDir = fs.readdirSync(baseDir);
                  const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                  filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                  if (matched) {
                    resolvedPath = path.join(baseDir, matched);
                  }
                }
              } else {
                // If source says knowledge but not found, try to search the recipient contact/company vault
                const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();
                let contact: Contact | null = null;
                if (isUsingFallback) {
                  contact = fallbackStore.contacts?.find((c: Contact) => 
                    c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
                  ) || null;
                } else {
                  try {
                    const contactRes = await pool.query(
                      `SELECT id_uuid, full_legal_name, first_name, last_name FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
                      [cleanRecipient, tenantId]
                    );
                    contact = contactRes.rows[0];
                  } catch (_) {}
                }
                if (contact) {
                  const entityName = contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || "Vault";
                  const entityPath = getEntityStoragePath("contacts", contact.id_uuid, entityName, tenantId);
                  if (fs.existsSync(entityPath)) {
                    const filesInDir = fs.readdirSync(entityPath);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(entityPath, matched);
                    }
                  }
                }
              }
            }

            if (!resolvedPath) {
              const fallbackSearch = searchFileAcrossAllVaults(filename, tenantId);
              if (fallbackSearch && fs.existsSync(fallbackSearch.path)) {
                resolvedPath = fallbackSearch.path;
                console.log(`[SMTP Human-In-The-Loop] File found via robust search fallback: ${resolvedPath}`);
              }
            }

            if (resolvedPath && fs.existsSync(resolvedPath)) {
              // Clean timestamp prefix (e.g. 1717354923000_my_document.pdf -> my_document.pdf)
              const displayFilename = path.basename(resolvedPath).replace(/^\d+_/g, '');
              attachments.push({
                filename: displayFilename,
                path: resolvedPath
              });
              console.log(`[SMTP Human-In-The-Loop] Attached file from ${source}: ${resolvedPath} as ${displayFilename}`);
            } else {
              console.warn(`[SMTP Human-In-The-Loop] Attachment file not found relative to ${source}: ${filename}`);
            }
          }
        }

        await transporter.sendMail({
          from: smtp.sender_display_name 
            ? `"${smtp.sender_display_name}" <${smtp.sender_email_address}>`
            : smtp.sender_email_address,
          to: recipient,
          subject: subject,
          text: body.replace(/<[^>]*>/g, ''),
          html: body,
          attachments,
        });

        try {
          await ingestEmailToRag({
            tenantId,
            recipient: recipient,
            senderType: 'AI',
            subject: subject,
            body: body,
            attachments: attachments
          });
        } catch (ragErr) {
          console.error("[approveProposedChange] Failed to ingest sent mail to RAG:", ragErr);
        }

        console.log(`[SMTP Human-In-The-Loop] Mail successfully sent to ${recipient} via approved proposal.`);
      } else if (isUsingFallback) {
        // Fallback Store mutations
        if (entityType === "companies") {
          if (action === "DELETE") {
            fallbackStore.companies = fallbackStore.companies.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.companies.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.companies[idx] = { 
                ...fallbackStore.companies[idx], 
                ...(input.proposed_state as Partial<Company>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.companies[number];
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            let existingIdx = fallbackStore.companies.findIndex((c) => c.id_uuid === appliedId);
            if (existingIdx === -1 && pState.full_legal_name) {
              existingIdx = fallbackStore.companies.findIndex((c) => c.full_legal_name?.toLowerCase() === (pState.full_legal_name as string).toLowerCase() && c.tenant_id === tenantId);
            }
            if (existingIdx >= 0) {
              const targetId = fallbackStore.companies[existingIdx].id_uuid;
              fallbackStore.companies[existingIdx] = {
                ...fallbackStore.companies[existingIdx],
                ...pState,
                id_uuid: targetId,
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.companies[number];
            } else {
              fallbackStore.companies.unshift({
                ...(input.proposed_state as unknown as Company),
                id_uuid: appliedId,
                tenant_id: tenantId,
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.companies[number]);
            }
            workflowEventBus.emitEvent(tenantId, 'company.created', { id_uuid: existingIdx >= 0 ? fallbackStore.companies[existingIdx].id_uuid : appliedId, ...pState });
          }
        } else if (entityType === "contacts") {
          if (action === "DELETE") {
            fallbackStore.contacts = fallbackStore.contacts.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.contacts.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.contacts[idx] = { 
                ...fallbackStore.contacts[idx], 
                ...(input.proposed_state as Partial<Contact>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.contacts[number];
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            let existingIdx = fallbackStore.contacts.findIndex((c) => c.id_uuid === appliedId);
            if (existingIdx === -1 && pState.email_address) {
              existingIdx = fallbackStore.contacts.findIndex((c) => c.email_address?.toLowerCase() === (pState.email_address as string).toLowerCase() && c.tenant_id === tenantId);
            }
            if (existingIdx === -1 && pState.last_name) {
              existingIdx = fallbackStore.contacts.findIndex((c) => (c.first_name || '').toLowerCase() === ((pState.first_name as string) || '').toLowerCase() && c.last_name?.toLowerCase() === (pState.last_name as string).toLowerCase() && c.tenant_id === tenantId);
            }

            if (existingIdx >= 0) {
              const targetId = fallbackStore.contacts[existingIdx].id_uuid;
              fallbackStore.contacts[existingIdx] = {
                ...fallbackStore.contacts[existingIdx],
                ...pState,
                id_uuid: targetId,
                full_legal_name: (pState.full_legal_name as string) || fallbackStore.contacts[existingIdx].full_legal_name || `${(pState.first_name as string) || fallbackStore.contacts[existingIdx].first_name || ''} ${(pState.last_name as string) || fallbackStore.contacts[existingIdx].last_name || ''}`.trim(),
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.contacts[number];
            } else {
              const fullName = pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name || ''}`.trim() || 'Unbekannter Kontakt';
              fallbackStore.contacts.unshift({
                ...(input.proposed_state as unknown as Contact),
                full_legal_name: fullName,
                id_uuid: appliedId,
                tenant_id: tenantId,
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.contacts[number]);
            }
            workflowEventBus.emitEvent(tenantId, 'contact.created', { id_uuid: existingIdx >= 0 ? fallbackStore.contacts[existingIdx].id_uuid : appliedId, ...pState });
          }
        } else if (entityType === "invoices") {
          if (action === "DELETE") {
            fallbackStore.invoices = fallbackStore.invoices.filter((i) => i.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.invoices.findIndex((i) => i.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.invoices[idx] = { 
                ...fallbackStore.invoices[idx], 
                ...(input.proposed_state as Partial<Invoice>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.invoices[number];
            }
          } else {
            const pState = input.proposed_state as unknown as Invoice;
            let existingIdx = fallbackStore.invoices.findIndex((i) => i.id_uuid === appliedId);
            if (existingIdx === -1 && pState.invoice_number) {
              existingIdx = fallbackStore.invoices.findIndex((i) => i.invoice_number?.toLowerCase() === pState.invoice_number.toLowerCase() && i.tenant_id === tenantId);
            }

            if (existingIdx >= 0) {
              const targetId = fallbackStore.invoices[existingIdx].id_uuid;
              fallbackStore.invoices[existingIdx] = {
                ...fallbackStore.invoices[existingIdx],
                ...pState,
                id_uuid: targetId,
                invoice_line_items_json: JSON.stringify(pState.invoice_line_items || fallbackStore.invoices[existingIdx].invoice_line_items || []),
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.invoices[number];
            } else {
              fallbackStore.invoices.unshift({
                ...pState,
                id_uuid: appliedId,
                tenant_id: tenantId,
                invoice_line_items_json: JSON.stringify(pState.invoice_line_items || []),
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.invoices[number]);
            }
            
            workflowEventBus.emitEvent(tenantId, 'invoice.created', {
              id_uuid: existingIdx >= 0 ? fallbackStore.invoices[existingIdx].id_uuid : appliedId,
              invoice_number: pState.invoice_number,
              total_gross_amount: pState.total_gross_amount,
              associated_company_id: pState.associated_company_id,
              associated_contact_id: pState.associated_contact_id
            });
          }
        } else if (entityType === "offers") {
          if (!fallbackStore.offers) fallbackStore.offers = [];
          if (action === "DELETE") {
            fallbackStore.offers = fallbackStore.offers.filter((o) => o.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.offers.findIndex((o) => o.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.offers[idx] = { 
                ...fallbackStore.offers[idx], 
                ...(input.proposed_state as Partial<Offer>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.offers[number];
            }
          } else {
            const pState = input.proposed_state as unknown as Offer;
            let existingIdx = fallbackStore.offers.findIndex((o) => o.id_uuid === appliedId);
            if (existingIdx === -1 && pState.offer_number) {
              existingIdx = fallbackStore.offers.findIndex((o) => o.offer_number?.toLowerCase() === pState.offer_number.toLowerCase() && o.tenant_id === tenantId);
            }

            if (existingIdx >= 0) {
              const targetId = fallbackStore.offers[existingIdx].id_uuid;
              fallbackStore.offers[existingIdx] = {
                ...fallbackStore.offers[existingIdx],
                ...pState,
                id_uuid: targetId,
                line_items: pState.line_items || fallbackStore.offers[existingIdx].line_items || [],
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.offers[number];
            } else {
              fallbackStore.offers.unshift({
                ...pState,
                id_uuid: appliedId,
                tenant_id: tenantId,
                line_items: pState.line_items || [],
                created_by_identity: "ai_assistant",
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.offers[number]);
            }
          }
        } else if (entityType === "kanban_board") {
          if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
          if (action === "DELETE") {
            fallbackStore.kanbanBoards = fallbackStore.kanbanBoards.filter((b) => b.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.kanbanBoards.findIndex((b) => b.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanBoards[idx] = {
                ...fallbackStore.kanbanBoards[idx],
                ...(input.proposed_state as Record<string, unknown>),
                id_uuid: appliedId,
                updated_at_utc: new Date().toISOString()
              };
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            fallbackStore.kanbanBoards.unshift({
              id_uuid: appliedId,
              tenant_id: tenantId,
              title: (pState.title as string) || "Neues Board",
              description: (pState.description as string) || null,
              color: (pState.color as string) || "#3b82f6",
              is_default: (pState.is_default as boolean) || false,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
            const defaultCols = (pState.columns && Array.isArray(pState.columns) && pState.columns.length > 0)
              ? (pState.columns as string[])
              : ["offen", "In Bearbeitung", "Erledigt"];
            defaultCols.forEach((colTitle, idx) => {
              fallbackStore.kanbanColumns.push({
                id_uuid: uuidv4(),
                tenant_id: tenantId,
                board_id: appliedId,
                title: colTitle,
                position: idx,
                color_accent: idx === 0 ? "#3b82f6" : idx === 1 ? "#f59e0b" : "#10b981",
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
            });
 // P2: Beispielkarten aus dem Board-Entwurf mit anlegen (falls vorhanden)
            const sampleCards = (pState.sample_cards && Array.isArray(pState.sample_cards))
              ? (pState.sample_cards as string[])
              : [];
            if (sampleCards.length > 0) {
              if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
              const colIds = fallbackStore.kanbanColumns.filter((c) => c.board_id === appliedId).map((c) => c.id_uuid);
              sampleCards.forEach((cardTitle, idx) => {
                fallbackStore.kanbanCards!.push({
                  id_uuid: uuidv4(),
                  tenant_id: tenantId,
                  board_id: appliedId,
                  column_id: colIds[Math.min(idx, colIds.length - 1)] || colIds[0],
                  title: cardTitle,
                  description: null,
                  status: "todo",
                  priority: "medium",
                  position: idx,
                  due_date: null,
                  assigned_user: null,
                  company_id_uuid: null,
                  contact_id_uuid: null,
                  labels: [],
                  created_at_utc: new Date().toISOString(),
                  updated_at_utc: new Date().toISOString()
                });
              });
            }
          }
          workflowEventBus.emitEvent(tenantId, `kanban.board_${action.toLowerCase()}`, { id_uuid: appliedId, ...input.proposed_state });
        } else if (entityType === "kanban_column") {
          if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
          if (action === "DELETE") {
            fallbackStore.kanbanColumns = fallbackStore.kanbanColumns.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.kanbanColumns.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanColumns[idx] = {
                ...fallbackStore.kanbanColumns[idx],
                ...(input.proposed_state as Record<string, unknown>),
                id_uuid: appliedId,
                updated_at_utc: new Date().toISOString()
              };
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            fallbackStore.kanbanColumns.push({
              id_uuid: appliedId,
              tenant_id: tenantId,
              board_id: (pState.board_id as string) || "",
              title: (pState.title as string) || "Neue Spalte",
              position: (pState.position as number) || 0,
              color_accent: (pState.color_accent as string) || (pState.color_hex as string) || "#3b82f6",
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
          }
          workflowEventBus.emitEvent(tenantId, `kanban.column_${action.toLowerCase()}`, { id_uuid: appliedId, ...input.proposed_state });
        } else if (entityType === "kanban_card") {
          if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
          if (action === "DELETE") {
            fallbackStore.kanbanCards = fallbackStore.kanbanCards.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE" || action === "MOVE") {
            const idx = fallbackStore.kanbanCards.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanCards[idx] = {
                ...fallbackStore.kanbanCards[idx],
                ...(input.proposed_state as Record<string, unknown>),
                id_uuid: appliedId,
                updated_at_utc: new Date().toISOString()
              };
            }
          } else {
            const pState = (input.proposed_state || {}) as Record<string, unknown>;
            let boardId = (pState.board_id as string) || (pState.board_id_uuid as string) || "";
            if (!boardId) {
              const defaultBoard = (fallbackStore.kanbanBoards || []).find(b => b.is_default && (b.tenant_id === tenantId || b.tenant_id === '1'))
                || (fallbackStore.kanbanBoards || [])[0];
              if (defaultBoard) boardId = defaultBoard.id_uuid;
            }
            let columnId = (pState.column_id as string) || (pState.column_id_uuid as string) || "";
            if (!columnId && boardId) {
              const firstCol = (fallbackStore.kanbanColumns || []).find(c => c.board_id === boardId);
              if (firstCol) columnId = firstCol.id_uuid;
            }
            fallbackStore.kanbanCards.push({
              id_uuid: appliedId,
              tenant_id: tenantId,
              board_id: boardId,
              column_id: columnId,
              title: (pState.title as string) || "Neue Karte",
              description: (pState.description as string) || null,
              status: (pState.status as KanbanCard['status']) || "todo",
              priority: (pState.priority as 'low'|'medium'|'high'|'urgent') || "medium",
              position: (pState.position as number) || 0,
              due_date: (pState.due_date as string) || null,
              assigned_user: (pState.assigned_user as string) || null,
              company_id_uuid: (pState.company_id_uuid as string) || null,
              contact_id_uuid: (pState.contact_id_uuid as string) || null,
              labels: (pState.labels as string[]) || [],
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
          }
          workflowEventBus.emitEvent(tenantId, action === "MOVE" ? "kanban.card_moved" : `kanban.card_${action.toLowerCase()}`, { id_uuid: appliedId, ...input.proposed_state });
        }
        saveFallbackStore();
      } else {
        // PostgreSQL operations
        if (entityType === "companies") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE core_registry_companies 
              SET full_legal_name = $1, tax_vat_id = $2, tax_number = $3, responsible_person = $4,
                  street = $5, house_number = $6, city = $7, postal_code = $8, country_code = $9,
                  email_address = $10, phone_number = $11, iban = $12, bic_swift = $13, leitweg_id = $14,
                  is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $15 AND tenant_id = $16
            `, [
              pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
              pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
              pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
              appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if company already exists by appliedId or name
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.full_legal_name) {
              const nameCheck = await pool.query("SELECT id_uuid FROM core_registry_companies WHERE LOWER(full_legal_name) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.full_legal_name, tenantId]);
              if (nameCheck.rows.length > 0) {
                existingId = nameCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE core_registry_companies 
                SET full_legal_name = $1, tax_vat_id = $2, tax_number = $3, responsible_person = $4,
                    street = $5, house_number = $6, city = $7, postal_code = $8, country_code = $9,
                    email_address = $10, phone_number = $11, iban = $12, bic_swift = $13, leitweg_id = $14,
                    is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $15 AND tenant_id = $16
              `, [
                pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
                pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
                pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
                existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO core_registry_companies (
                  id_uuid, tenant_id, full_legal_name, tax_vat_id, tax_number, responsible_person, street, house_number,
                  city, postal_code, country_code, email_address, phone_number, iban, bic_swift, leitweg_id,
                  created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
                pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
                pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
                actorIdentity
              ]);
            }
            workflowEventBus.emitEvent(tenantId, 'company.created', { id_uuid: existingId, ...pState });
          }
        } else if (entityType === "contacts") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM core_registry_contacts WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
 // B3 : alle Felder übernehmen (Adresse, Opt-ins, Sprache …)
            await pool.query(`
              UPDATE core_registry_contacts
              SET first_name = $1, last_name = $2, full_legal_name = $3, email_address = $4, phone_number = $5,
                  salutation = $6, associated_company_id = $7,
                  street = $8, house_number = $9, postal_code = $10, city = $11,
                  opt_in_marketing = $12, opt_in_social_media = $13, opt_in_direct_message = $14, opt_in_sms = $15, opt_in_phone = $16,
                  language = $17, email_2 = $18, website = $19, mobile_number = $20, fax_number = $21,
                  iban = $22, bic_swift = $23, payment_term = $24, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $25 AND tenant_id = $26
            `, [
              pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
              pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
              pState.street, pState.house_number, pState.postal_code, pState.city,
              pState.opt_in_marketing ?? false, pState.opt_in_social_media ?? false, pState.opt_in_direct_message ?? false, pState.opt_in_sms ?? false, pState.opt_in_phone ?? false,
              pState.language || "de", pState.email_2, pState.website, pState.mobile_number, pState.fax_number,
              pState.iban, pState.bic_swift, pState.payment_term || "14",
              appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if contact already exists by appliedId, email, or name
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.email_address) {
              const emailCheck = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.email_address, tenantId]);
              if (emailCheck.rows.length > 0) {
                existingId = emailCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            } else if (pState.last_name) {
              const nameCheck = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) AND tenant_id = $3 LIMIT 1", [pState.first_name || '', pState.last_name, tenantId]);
              if (nameCheck.rows.length > 0) {
                existingId = nameCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE core_registry_contacts
                SET first_name = $1, last_name = $2, full_legal_name = $3, email_address = $4, phone_number = $5,
                    salutation = $6, associated_company_id = $7,
                    street = $8, house_number = $9, postal_code = $10, city = $11,
                    opt_in_marketing = $12, opt_in_social_media = $13, opt_in_direct_message = $14, opt_in_sms = $15, opt_in_phone = $16,
                    language = $17, email_2 = $18, website = $19, mobile_number = $20, fax_number = $21,
                    iban = $22, bic_swift = $23, payment_term = $24, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $25 AND tenant_id = $26
              `, [
                pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
                pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
                pState.street, pState.house_number, pState.postal_code, pState.city,
                pState.opt_in_marketing ?? false, pState.opt_in_social_media ?? false, pState.opt_in_direct_message ?? false, pState.opt_in_sms ?? false, pState.opt_in_phone ?? false,
                pState.language || "de", pState.email_2, pState.website, pState.mobile_number, pState.fax_number,
                pState.iban, pState.bic_swift, pState.payment_term || "14",
                existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO core_registry_contacts (
                  id_uuid, tenant_id, first_name, last_name, full_legal_name, email_address, phone_number, salutation,
                  associated_company_id, street, house_number, postal_code, city,
                  opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone,
                  language, email_2, website, mobile_number, fax_number, iban, bic_swift, payment_term,
                  created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
                pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
                pState.street, pState.house_number, pState.postal_code, pState.city,
                pState.opt_in_marketing ?? false, pState.opt_in_social_media ?? false, pState.opt_in_direct_message ?? false, pState.opt_in_sms ?? false, pState.opt_in_phone ?? false,
                pState.language || "de", pState.email_2, pState.website, pState.mobile_number, pState.fax_number,
                pState.iban, pState.bic_swift, pState.payment_term || "14",
                actorIdentity
              ]);
            }
            workflowEventBus.emitEvent(tenantId, 'contact.created', { id_uuid: existingId, ...pState });
          }
        } else if (entityType === "invoices") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM fiscal_billing_invoices WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE fiscal_billing_invoices 
              SET invoice_number = $1, issue_date = $2, due_date = $3, bank_account = $4,
                  total_net_amount = $5, total_vat_amount = $6, total_gross_amount = $7, 
                  payment_status = $8, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $9 AND tenant_id = $10
            `, [
              pState.invoice_number, pState.issue_date, pState.due_date, pState.bank_account,
              pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
              pState.payment_status, appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if invoice already exists by id_uuid or invoice_number
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM fiscal_billing_invoices WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.invoice_number) {
              const numCheck = await pool.query("SELECT id_uuid FROM fiscal_billing_invoices WHERE LOWER(invoice_number) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.invoice_number, tenantId]);
              if (numCheck.rows.length > 0) {
                existingId = numCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE fiscal_billing_invoices 
                SET invoice_number = $1, issue_date = $2, due_date = $3, bank_account = $4,
                    total_net_amount = $5, total_vat_amount = $6, total_gross_amount = $7, 
                    payment_status = $8, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $9 AND tenant_id = $10
              `, [
                pState.invoice_number, pState.issue_date, pState.due_date, pState.bank_account,
                pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
                pState.payment_status, existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO fiscal_billing_invoices (
                  id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id, bank_account,
                  issue_date, due_date, total_net_amount, total_vat_amount, total_gross_amount, currency_code,
                  payment_status, invoice_line_items_json, created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.invoice_number, pState.associated_company_id, pState.associated_contact_id,
                pState.bank_account, pState.issue_date, pState.due_date, pState.total_net_amount, pState.total_vat_amount,
                pState.total_gross_amount, pState.currency_code || "EUR", pState.payment_status || "pending",
                JSON.stringify(pState.invoice_line_items || []), actorIdentity
              ]);
            }
            
            workflowEventBus.emitEvent(tenantId, 'invoice.created', {
              id_uuid: existingId,
              invoice_number: pState.invoice_number,
              total_gross_amount: pState.total_gross_amount,
              associated_company_id: pState.associated_company_id,
              associated_contact_id: pState.associated_contact_id
            });
          }
        } else if (entityType === "offers") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE core_registry_offers
              SET title = $1, offer_number = $2, associated_company_id = $3, associated_contact_id = $4,
                  issue_date = $5, valid_until = $6, payment_term = $7, currency_code = $8, is_vat_inclusive = $9,
                  introductory_text = $10, closing_text = $11,
                  total_net_amount = $12, total_vat_amount = $13, total_gross_amount = $14,
                  offer_status = $15, updated_at_utc = CURRENT_TIMESTAMP,
                  line_items_json = $16
              WHERE id_uuid = $17 AND tenant_id = $18
            `, [
              pState.title, pState.offer_number, pState.associated_company_id, pState.associated_contact_id,
              pState.issue_date || new Date().toISOString().split("T")[0], pState.valid_until || "", pState.payment_term || "14 Tage netto", pState.currency_code || "EUR", !!pState.is_vat_inclusive,
              pState.introductory_text || "", pState.closing_text || "",
              pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
              pState.offer_status || 'draft', JSON.stringify(pState.line_items || []),
              appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.offer_number) {
              const numCheck = await pool.query("SELECT id_uuid FROM core_registry_offers WHERE LOWER(offer_number) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.offer_number, tenantId]);
              if (numCheck.rows.length > 0) {
                existingId = numCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE core_registry_offers
                SET title = $1, offer_number = $2, associated_company_id = $3, associated_contact_id = $4,
                    issue_date = $5, valid_until = $6, payment_term = $7, currency_code = $8, is_vat_inclusive = $9,
                    introductory_text = $10, closing_text = $11,
                    total_net_amount = $12, total_vat_amount = $13, total_gross_amount = $14,
                    offer_status = $15, updated_at_utc = CURRENT_TIMESTAMP,
                    line_items_json = $16
                WHERE id_uuid = $17 AND tenant_id = $18
              `, [
                pState.title, pState.offer_number, pState.associated_company_id, pState.associated_contact_id,
                pState.issue_date || new Date().toISOString().split("T")[0], pState.valid_until || "", pState.payment_term || "14 Tage netto", pState.currency_code || "EUR", !!pState.is_vat_inclusive,
                pState.introductory_text || "", pState.closing_text || "",
                pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
                pState.offer_status || 'draft', JSON.stringify(pState.line_items || []),
                existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO core_registry_offers (
                  id_uuid, tenant_id, title, offer_number, associated_company_id, associated_contact_id,
                  issue_date, valid_until, payment_term, currency_code, is_vat_inclusive,
                  introductory_text, closing_text,
                  total_net_amount, total_vat_amount, total_gross_amount, offer_status,
                  created_by_identity, created_at_utc, updated_at_utc, line_items_json
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $19)
              `, [
                appliedId, tenantId, pState.title, pState.offer_number, pState.associated_company_id, pState.associated_contact_id,
                pState.issue_date || new Date().toISOString().split("T")[0], pState.valid_until || "", pState.payment_term || "14 Tage netto", pState.currency_code || "EUR", !!pState.is_vat_inclusive,
                pState.introductory_text || "", pState.closing_text || "",
                pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount, pState.offer_status || 'draft',
                actorIdentity, JSON.stringify(pState.line_items || [])
              ]);
            }
          }
        } else if (entityType === "kanban_board") {
          const pState = (input.proposed_state || {}) as Record<string, unknown>;
          if (action === "DELETE") {
            await pool.query("DELETE FROM kanban_boards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            await pool.query(
              "UPDATE kanban_boards SET title = $1, description = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND (tenant_id = $4 OR tenant_id = '1')",
              [pState.title, pState.description || null, appliedId, tenantId]
            );
          } else {
            await pool.query(
              "INSERT INTO kanban_boards (id_uuid, tenant_id, title, description, color, is_default) VALUES ($1, $2, $3, $4, $5, $6)",
              [appliedId, tenantId, pState.title || "Neues Board", pState.description || null, pState.color || "#3b82f6", pState.is_default || false]
            );
            const defaultCols = (pState.columns && Array.isArray(pState.columns) && pState.columns.length > 0)
              ? (pState.columns as string[])
              : ["offen", "In Bearbeitung", "Erledigt"];
            for (let idx = 0; idx < defaultCols.length; idx++) {
              const colTitle = defaultCols[idx];
              const colHex = idx === 0 ? "#3b82f6" : idx === 1 ? "#f59e0b" : "#10b981";
              await pool.query(
                "INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent) VALUES ($1, $2, $3, $4, $5, $6)",
                [uuidv4(), tenantId, appliedId, colTitle, idx, colHex]
              );
            }
 // P2: Beispielkarten aus dem Board-Entwurf mit anlegen (falls vorhanden)
            const sampleCards = (pState.sample_cards && Array.isArray(pState.sample_cards))
              ? (pState.sample_cards as string[])
              : [];
            if (sampleCards.length > 0) {
              const colRes = await pool.query(
                "SELECT id_uuid FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC",
                [appliedId, tenantId]
              );
              const colIds = colRes.rows.map((r: { id_uuid: string }) => r.id_uuid);
              for (let idx = 0; idx < sampleCards.length; idx++) {
                await pool.query(
                  "INSERT INTO kanban_cards (id_uuid, tenant_id, board_id, column_id, title, status, priority, position) VALUES ($1, $2, $3, $4, $5, 'todo', 'medium', $6)",
                  [uuidv4(), tenantId, appliedId, colIds[Math.min(idx, colIds.length - 1)] || colIds[0], sampleCards[idx], idx]
                );
              }
            }
          }
          workflowEventBus.emitEvent(tenantId, `kanban.board_${action.toLowerCase()}`, { id_uuid: appliedId, ...pState });
        } else if (entityType === "kanban_column") {
          const pState = (input.proposed_state || {}) as Record<string, unknown>;
          if (action === "DELETE") {
            await pool.query("DELETE FROM kanban_columns WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            await pool.query(
              "UPDATE kanban_columns SET title = $1, position = $2, color_accent = $3, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')",
              [pState.title, pState.position, pState.color_accent || "#3b82f6", appliedId, tenantId]
            );
          } else {
            await pool.query(
              "INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent) VALUES ($1, $2, $3, $4, $5, $6)",
              [appliedId, tenantId, pState.board_id, pState.title || "Neue Spalte", pState.position || 0, pState.color_accent || "#3b82f6"]
            );
          }
          workflowEventBus.emitEvent(tenantId, `kanban.column_${action.toLowerCase()}`, { id_uuid: appliedId, ...pState });
        } else if (entityType === "kanban_card") {
          const pState = (input.proposed_state || {}) as Record<string, unknown>;
          if (action === "DELETE") {
            await pool.query("DELETE FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            await pool.query(
              "UPDATE kanban_cards SET title = $1, description = $2, priority = $3, due_date = $4, labels = $5, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $6 AND (tenant_id = $7 OR tenant_id = '1')",
              [pState.title, pState.description || null, pState.priority || 'medium', pState.due_date || null, JSON.stringify(pState.labels || []), appliedId, tenantId]
            );
          } else if (action === "MOVE") {
            await pool.query(
              "UPDATE kanban_cards SET column_id = $1, position = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND (tenant_id = $4 OR tenant_id = '1')",
              [pState.column_id || pState.target_column_id_uuid, pState.position ?? pState.new_position ?? 0, appliedId, tenantId]
            );
          } else {
            let boardId = (pState.board_id as string) || (pState.board_id_uuid as string) || null;
            if (!boardId) {
              const bRes = await pool.query("SELECT id_uuid FROM kanban_boards WHERE (tenant_id = $1 OR tenant_id = '1') ORDER BY is_default DESC LIMIT 1", [tenantId]);
              if (bRes.rows[0]) boardId = bRes.rows[0].id_uuid;
            }
            let columnId = (pState.column_id as string) || (pState.column_id_uuid as string) || null;
            if (!columnId && boardId) {
              const cRes = await pool.query("SELECT id_uuid FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC LIMIT 1", [boardId, tenantId]);
              if (cRes.rows[0]) columnId = cRes.rows[0].id_uuid;
            }
            await pool.query(
              `INSERT INTO kanban_cards (
                id_uuid, tenant_id, board_id, column_id, title, description, priority, position, due_date, company_id_uuid, contact_id_uuid, labels
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                appliedId, tenantId, boardId, columnId, pState.title || "Neue Karte",
                pState.description || null, pState.priority || 'medium', pState.position || 0,
                pState.due_date || null, pState.company_id_uuid || null, pState.contact_id_uuid || null, JSON.stringify(pState.labels || [])
              ]
            );
          }
          workflowEventBus.emitEvent(tenantId, action === "MOVE" ? "kanban.card_moved" : `kanban.card_${action.toLowerCase()}`, { id_uuid: appliedId, ...pState });
        } else if (entityType === "vault_skill") {
          // S10/S10.1: Nach menschlicher Freigabe wird der Wissens-Skill im Vault angelegt, aktualisiert oder gelöscht
          const pState = (input.proposed_state || {}) as Record<string, unknown>;
          const skillName = String(pState.name || "Unbenannter-Skill").replace(/[^a-zA-Z0-9_]/g, "_");
          const skillPath = `_louis/skills/${skillName}.md`;
          if (action === "DELETE") {
 // P0-1: Skill löschen (nur _louis/skills/, Path-Sanitierung via vaultDeleteText)
            const { vaultDeleteText } = await import("../ai/vaultStore.js");
            await vaultDeleteText(tenantId, skillPath);
            workflowEventBus.emitEvent(tenantId, "vault.skill_deleted", { path: skillPath, name: pState.name });
          } else {
 // CREATE (S10) und UPDATE : Version bei Update inkrementieren (analog Workflow-Versionierung)
            let version = 1;
            if (action === "UPDATE") {
              try {
                const { vaultReadText, resolveSkillFiles } = await import("../ai/vaultStore.js");
                const existing = await vaultReadText(tenantId, skillPath);
                if (existing && existing.content) {
                  const m = String(existing.content).match(/^version:\s*(\d+)/m);
                  if (m) version = Number(m[1]) + 1;
                }
                const skills = await resolveSkillFiles(tenantId);
                const found = skills.find((s) => s.path === skillPath);
                if (found) version = (found.version || 1) + 1;
              } catch {
                // Version bleibt 1 — fehlertolerant
              }
            }
            const skillMd = `---\ntags: [louis-skill]\nname: ${pState.name || ""}\ndescription: ${pState.description || ""}\nversion: ${version}\ncategory: ${pState.category || ""}\n---\n\n${pState.content || ""}\n`;
            const { vaultWriteText } = await import("../ai/vaultStore.js");
            await vaultWriteText(tenantId, skillPath, skillMd);
            // #30 (026 P1-1): update_skill-Freigabe = Patch am Skill → patch_count+1 (best-effort)
            if (action === "UPDATE") {
              const { bumpSkillCounter } = await import("../ai/skillCurator.js");
              void bumpSkillCounter(tenantId, skillPath, "patchCount");
            }
            workflowEventBus.emitEvent(tenantId, "vault.skill_saved", { path: skillPath, name: pState.name, version });
          }
        } else if (entityType === "note") {
          // Notiz-Draft → nach Freigabe in sys_louis_ai_notes persistieren
          const pState = (input.proposed_state || {}) as Record<string, unknown>;
          const noteText = String(pState.note_text || "").trim();
          const contactId = typeof pState.contact_id_uuid === "string" && pState.contact_id_uuid ? pState.contact_id_uuid : null;
          const companyId = typeof pState.company_id_uuid === "string" && pState.company_id_uuid ? pState.company_id_uuid : null;
          if (!noteText) throw new Error("note_text ist für eine Notiz erforderlich.");
          if (!contactId && !companyId) throw new Error("Bitte ein Ziel angeben: Kontakt ODER Firma.");
          if (contactId && companyId) throw new Error("Bitte nur EIN Ziel angeben.");
          const entityTypeVal = contactId ? "contact" : "company";
          const entityIdVal = contactId || companyId as string;
          if (isUsingFallback) {
            if (!fallbackStore.aiNotes) fallbackStore.aiNotes = [];
            fallbackStore.aiNotes.push({
              id_uuid: uuidv4(),
              tenant_id: tenantId,
              entity_type: entityTypeVal as 'contact' | 'company',
              entity_id_uuid: entityIdVal,
              note_text: noteText,
              priority: String(pState.priority || "normal"),
              created_by_identity: actorIdentity,
              created_at_utc: new Date().toISOString()
            });
            saveFallbackStore();
          } else {
            await pool.query(
              `INSERT INTO sys_louis_ai_notes (tenant_id, entity_type, entity_id_uuid, note_text, priority, created_by_identity) VALUES ($1, $2, $3, $4, $5, $6)`,
              [tenantId, entityTypeVal, entityIdVal, noteText, String(pState.priority || "normal"), actorIdentity]
            );
          }
          workflowEventBus.emitEvent(tenantId, "note.created", { entity_type: entityTypeVal, entity_id_uuid: entityIdVal, note_text: noteText });
        }
      }

      await logAuditEvent({
        tenantId,
        eventType: action,
        entityType,
        entityId: appliedId,
        eventDetails: `Approved AI modification: ${input.explanation_rational}`,
        actorIdentity
      });

      return { success: true, appliedId };
    }),

  getWorkflows: protectedProcedure
    .output(z.array(CustomWorkflowSchema))
    .query(async ({ ctx }) => {
      const list = await getLearnedWorkflows(ctx.tenantId);
      // Zod-Output verlangt ISO-Strings — pg liefert Date-Objekte
      return list.map((w) => {
        const row = { ...w } as Record<string, unknown>;
        for (const key of ["created_at_utc", "updated_at_utc"] as const) {
          if (row[key] !== undefined && row[key] !== null) {
            row[key] = row[key] instanceof Date ? (row[key] as Date).toISOString() : String(row[key]);
          }
        }
        return row as unknown as z.infer<typeof CustomWorkflowSchema>;
      });
    }),

  learnWorkflow: protectedProcedure
    .input(CustomWorkflowSchema)
    .output(CustomWorkflowSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      // Resolve actual Admin identity instead of default "Demo User" / "ai_assistant"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      const result = await learnWorkflow(
        tenantId, 
        input.workflow_name, 
        input.workflow_description, 
        input.tool_chain_sequence, 
        actorIdentity,
        input.trigger_type,
        input.trigger_config,
        input.is_active,
        input.id_uuid,
        input.direct_send_email,
        input.dag_structure
      );
      return result;
    }),

  deleteWorkflow: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const success = await deleteWorkflow(tenantId, input.id_uuid);
      await logAuditEvent({
        tenantId,
        eventType: "DELETE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: `Deleted LOUIS AI workflow tool: ${input.id_uuid}`
      });
      return { success };
    }),

  getWorkflowInstancesLog: protectedProcedure
    .output(z.array(WorkflowInstanceFullSchema))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
      }
      try {
        const res = await pool.query(
          "SELECT id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, current_node_id, node_results, created_at_utc, updated_at_utc FROM sys_louis_ai_workflow_instances WHERE tenant_id = $1 ORDER BY created_at_utc DESC",
          [tenantId]
        );
        return res.rows.map(row => ({
          ...row,
          initial_payload: typeof row.initial_payload === 'string' ? JSON.parse(row.initial_payload) : row.initial_payload,
          execution_log: typeof row.execution_log === 'string' ? JSON.parse(row.execution_log) : row.execution_log,
          node_results: typeof row.node_results === 'string' ? JSON.parse(row.node_results) : row.node_results,
          // pg liefert bei WAIT-Instanzen ein Date-Objekt für execute_at_utc -> Zod-Output (z.string) verlangt ISO
          execute_at_utc: row.execute_at_utc instanceof Date ? (row.execute_at_utc as Date).toISOString() : (row.execute_at_utc || null)
        }));
      } catch (err) {
        console.error("Failed to query postgres workflow instances, utilizing fallback store:", err);
        return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
      }
    }),

  updateWorkflowTrigger: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      trigger_type: z.enum(['MANUAL', 'CRM_EVENT', 'TIMER']),
      trigger_config: z.record(z.string(), z.unknown()).nullable().optional()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].trigger_type = input.trigger_type;
          fallbackStore.customWorkflows[idx].trigger_config = input.trigger_config || {};
          saveFallbackStore();
          return { success: true };
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

      try {
        const res = await pool.query(
          "UPDATE sys_louis_ai_custom_workflows SET trigger_type = $1, trigger_config = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND tenant_id = $4 RETURNING id_uuid",
          [input.trigger_type, JSON.stringify(input.trigger_config || {}), input.id_uuid, tenantId]
        );
        if (res.rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde in Postgres nicht gefunden" });
        }
        return { success: true };
      } catch (err: unknown) {
        // Safe write-through in case write fails
        console.error("Postgres updateWorkflowTrigger failed, using fallback:", err);
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].trigger_type = input.trigger_type;
          fallbackStore.customWorkflows[idx].trigger_config = input.trigger_config || {};
          saveFallbackStore();
          return { success: true };
        }
        const errMsg = err instanceof Error ? err.message : "Fehler beim Aktualisieren";
        throw new TRPCError({ code: "NOT_FOUND", message: errMsg });
      }
    }),

  toggleWorkflowStatus: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      is_active: z.boolean()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].is_active = input.is_active;
          saveFallbackStore();
          return { success: true };
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

      try {
        const res = await pool.query(
          "UPDATE sys_louis_ai_custom_workflows SET is_active = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 AND tenant_id = $3 RETURNING id_uuid",
          [input.is_active, input.id_uuid, tenantId]
        );
        if (res.rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde in Postgres nicht gefunden" });
        }
        return { success: true };
      } catch (err: unknown) {
        console.error("Postgres toggleWorkflowStatus failed, using fallback:", err);
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].is_active = input.is_active;
          saveFallbackStore();
          return { success: true };
        }
        const errMsg = err instanceof Error ? err.message : "Fehler beim Umschalten";
        throw new TRPCError({ code: "NOT_FOUND", message: errMsg });
      }
    }),

  triggerWorkflowManually: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let workflow: CustomWorkflow | null = null;

      if (isUsingFallback) {
        workflow = (fallbackStore.customWorkflows || []).find(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, tenantId]);
        if (res.rows.length > 0) {
          workflow = res.rows[0];
        }
      }

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

       // Convert tool chain sequence format to standard array if it's string JSON
      let steps = workflow.tool_chain_sequence;
      if (typeof steps === "string") {
        try {
          steps = JSON.parse(steps);
        } catch (_) {}
      }

      let config = workflow.trigger_config;
      if (typeof config === "string") {
        try {
          config = JSON.parse(config);
        } catch (_) {}
      }

      // Fix 2026-08-15: dag_structure wurde bisher NICHT übergeben -> UI-Trigger lief
      // immer über den linearen tool_chain_sequence-Pfad, nie über die DAG-Engine.
      let dagStructure = workflow.dag_structure;
      if (typeof dagStructure === "string") {
        try {
          dagStructure = JSON.parse(dagStructure);
        } catch (_) {}
      }

      const workflowToRun: CustomWorkflow = {
        id_uuid: workflow.id_uuid,
        tenant_id: tenantId,
        workflow_name: workflow.workflow_name,
        workflow_description: workflow.workflow_description || (workflow as { description?: string }).description || "",
        tool_chain_sequence: steps,
        trigger_type: workflow.trigger_type || "MANUAL",
        trigger_config: config || {},
        dag_structure: dagStructure || undefined,
        is_active: workflow.is_active !== false,
        direct_send_email: workflow.direct_send_email === true,
        created_at_utc: workflow.created_at_utc,
        updated_at_utc: workflow.updated_at_utc
      };

      const payload = {
        triggered_by: "manual_ui",
        timestamp: new Date().toISOString()
      };

      // Trigger the background scheduler / executor
      workflowExecutor.execute(workflowToRun, payload).catch((err: unknown) => {
        console.error(`[triggerWorkflowManually] Error executing workflow ID ${input.id_uuid}:`, err);
      });

      return { success: true };
    }),

  approveWorkflowHumanGate: protectedProcedure
    .input(z.object({
      instance_id: z.string().uuid()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let inst: Record<string, unknown> | null = null;

      if (isUsingFallback) {
        inst = ((fallbackStore.workflowInstances || []).find(i => i.id_uuid === input.instance_id && i.tenant_id === tenantId) as unknown as Record<string, unknown>) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1 AND tenant_id = $2", [input.instance_id, tenantId]);
        if (res.rows.length > 0) {
          inst = res.rows[0] as Record<string, unknown>;
        }
      }

      if (!inst) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow-Instanz wurde nicht gefunden" });
      }

      if (inst.status !== "PENDING_APPROVAL") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Instanz befindet sich nicht im Freigabestadium (Aktueller Status: ${inst.status})` });
      }

      // Fetch the custom workflow
      let workflow: CustomWorkflow | null = null;
      if (isUsingFallback) {
        workflow = (fallbackStore.customWorkflows || []).find(w => w.id_uuid === inst?.workflow_id && w.tenant_id === tenantId) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2", [inst.workflow_id, tenantId]);
        if (res.rows.length > 0) {
          workflow = res.rows[0];
        }
      }

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Zugeordneter Workflow wurde nicht gefunden" });
      }

      // Parse workflow structure
      let steps = workflow.tool_chain_sequence;
      if (typeof steps === "string") {
        try { steps = JSON.parse(steps); } catch (_) {}
      }
      let config = workflow.trigger_config;
      if (typeof config === "string") {
        try { config = JSON.parse(config); } catch (_) {}
      }
      let dagStructure = workflow.dag_structure;
      if (typeof dagStructure === "string") {
        try { dagStructure = JSON.parse(dagStructure); } catch (_) {}
      }

      const workflowToRun: CustomWorkflow = {
        id_uuid: workflow.id_uuid,
        tenant_id: tenantId,
        workflow_name: workflow.workflow_name,
        workflow_description: workflow.workflow_description || "",
        tool_chain_sequence: steps,
        trigger_type: workflow.trigger_type || "MANUAL",
        trigger_config: config || {},
        dag_structure: dagStructure,
        is_active: workflow.is_active !== false,
        direct_send_email: workflow.direct_send_email === true,
        created_at_utc: workflow.created_at_utc,
        updated_at_utc: workflow.updated_at_utc
      };

      // Set status to RUNNING and log entry
      const logEntry = {
        timestamp: new Date().toISOString(),
        node_id: inst.current_node_id || "HUMAN_GATE",
        node_name: "Freigabe erteilt",
        node_type: "HUMAN_GATE",
        status: "APPROVED",
        details: "Benutzer hat die manuelle Freigabe erteilt. Ausführung wird fortgesetzt."
      };

      const originalLogs = typeof inst.execution_log === "string" 
        ? JSON.parse(inst.execution_log as string) 
        : ((inst.execution_log || []) as unknown[]);
      const accumulatedLogs = [...originalLogs, logEntry];

      const stateResults = typeof inst.node_results === "string"
        ? JSON.parse(inst.node_results as string)
        : ((inst.node_results || {}) as Record<string, Record<string, unknown>>);

      // Add a status result for this gate
      if (inst.current_node_id) {
        stateResults[inst.current_node_id as string] = { status: "approved" };
      }

      if (isUsingFallback) {
        const instancesList = fallbackStore.workflowInstances || [];
        const idx = instancesList.findIndex(i => i.id_uuid === inst?.id_uuid);
        if (idx !== -1) {
          instancesList[idx].status = "RUNNING";
          instancesList[idx].execution_log = accumulatedLogs as WorkflowExecutionLogEntry[];
          instancesList[idx].node_results = stateResults;
          saveFallbackStore();
        }
      } else {
        await pool.query(`
          UPDATE sys_louis_ai_workflow_instances
          SET status = 'RUNNING', execution_log = $1, node_results = $2, updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $3
        `, [JSON.stringify(accumulatedLogs), JSON.stringify(stateResults), inst.id_uuid]);
      }

      // Resume execution
      const payload = typeof inst.initial_payload === "string"
        ? JSON.parse(inst.initial_payload as string)
        : (inst.initial_payload || {});

      // Async resume execution of the next node
      const { workflowGraphExecutor } = await import("../ai/workflowGraphExecutor.js");
      const dag = dagStructure as unknown as { nodes?: { node_id: string; next_node_ids: string[] }[] };
      const nextId = dag?.nodes?.find((n) => n.node_id === inst?.current_node_id)?.next_node_ids?.[0] || null;

      if (nextId) {
        workflowGraphExecutor.executeDAG(
          dagStructure as unknown as IWorkflowDAG,
          { initial_payload: payload as Record<string, unknown>, node_results: stateResults },
          nextId,
          tenantId,
          inst.id_uuid as string
        ).catch(err => {
          console.error(`[approveWorkflowHumanGate] Resume execution failed for inst ID ${inst?.id_uuid}:`, err);
        });
      }

      return { success: true };
    }),

 // 4C (T8b): Dry-Run/Simulation — deterministische Workflow-Analyse
  // (Validierung + Pfad-Simulation + Seiteneffekt-Warnungen, ohne LLM/Ausführung)
  dryRunWorkflow: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .output(z.object({
      valid: z.boolean(),
      start_node_id: z.string().nullable(),
      start_node_exists: z.boolean(),
      node_count: z.number(),
      edge_count: z.number(),
      path_count: z.number(),
      longest_path_length: z.number(),
      has_cycles: z.boolean(),
      unknown_tools: z.array(z.string()),
      summary: z.array(z.string()),
      nodes: z.array(z.object({
        node_id: z.string(),
        name: z.string(),
        type: z.string(),
        tool_identifier: z.string(),
        has_instruction: z.boolean(),
        has_side_effect: z.boolean(),
        side_effect_hint: z.string().optional(),
        reachable: z.boolean(),
        warnings: z.array(z.string())
      }))
    }))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let workflow: CustomWorkflow | null = null;

      if (isUsingFallback) {
        workflow = (fallbackStore.customWorkflows || []).find(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, tenantId]);
        if (res.rows.length > 0) {
          workflow = res.rows[0];
        }
      }

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

      let dagStructure = workflow.dag_structure;
      if (typeof dagStructure === "string") {
        try {
          dagStructure = JSON.parse(dagStructure);
        } catch (_) {
          dagStructure = null;
        }
      }

      const { dryRunDag, normalizeDag } = await import("../../lib/dryRun.js");
      const dag = normalizeDag(dagStructure);
      // Abwärtskompatibilität: Workflows ohne dag_structure (nur lineare Sequenz)
      // werden für den Dry-Run als DAG-Kette normalisiert (gleiche Logik wie die
      // Auto-Migration) — so ist der Dry-Run für ALLE Workflows nutzbar.
      let report;
      if (!dag && Array.isArray(workflow.tool_chain_sequence) && workflow.tool_chain_sequence.length > 0) {
        const seq = workflow.tool_chain_sequence as Array<{ tool: string; instruction: string }>;
        const nodes = seq.map((step, i) => ({
          node_id: `step_${i + 1}`,
          name: String(step?.tool || `Schritt ${i + 1}`),
          type: "ACTION" as const,
          tool_identifier: String(step?.tool || ""),
          instructions_template: String(step?.instruction || ""),
          next_node_ids: i < seq.length - 1 ? [`step_${i + 2}`] : []
        }));
        report = dryRunDag({
          workflow_id: String(workflow.id_uuid || ""),
          title: String(workflow.workflow_name || "Workflow"),
          is_active: true,
          start_node_id: nodes.length > 0 ? nodes[0].node_id : "",
          nodes
        });
        report.summary.unshift("Keine dag_structure — lineare Sequenz wurde für die Analyse als DAG-Kette interpretiert.");
      } else {
        report = dryRunDag(dag);
      }

      return report;
    }),

  getUserMemory: protectedProcedure
    .output(LouisAiUserMemoryFullSchema)
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      if (isUsingFallback) {
        if (!fallbackStore.louisAiUserMemory) {
          fallbackStore.louisAiUserMemory = [];
        }
        const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
        if (memory) {
          return memory;
        }
        return {
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          user_id: userId,
          response_preferences_text: "",
          frequently_used_tools_json: [],
          chat_notes_json: []
        };
      } else {
        const res = await pool.query(
          "SELECT id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id_uuid: row.id_uuid,
            tenant_id: row.tenant_id,
            user_id: row.user_id,
            response_preferences_text: row.response_preferences_text || "",
            frequently_used_tools_json: typeof row.frequently_used_tools_json === 'string' ? JSON.parse(row.frequently_used_tools_json) : row.frequently_used_tools_json || [],
            chat_notes_json: typeof row.chat_notes_json === 'string' ? JSON.parse(row.chat_notes_json) : row.chat_notes_json || []
          };
        }
        return {
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          user_id: userId,
          response_preferences_text: "",
          frequently_used_tools_json: [],
          chat_notes_json: []
        };
      }
    }),

  updateUserMemory: protectedProcedure
    .input(UserMemorySchema)
    .output(z.object({ success: z.boolean(), id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      if (isUsingFallback) {
        if (!fallbackStore.louisAiUserMemory) {
          fallbackStore.louisAiUserMemory = [];
        }
        let memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
        if (memory) {
          memory.response_preferences_text = input.response_preferences_text;
          memory.updated_at_utc = new Date().toISOString();
        } else {
          memory = {
            id_uuid: uuidv4(),
            tenant_id: tenantId,
            user_id: userId,
            response_preferences_text: input.response_preferences_text,
            frequently_used_tools_json: [],
            chat_notes_json: [],
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          };
          fallbackStore.louisAiUserMemory.push(memory);
        }
        saveFallbackStore();
        return { success: true, id_uuid: memory.id_uuid };
      } else {
        const res = await pool.query(
          "SELECT id_uuid, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        let memId = uuidv4();
        let freqTools: unknown[] = [];
        let chatNotes: unknown[] = [];
        if (res.rows.length > 0) {
          memId = res.rows[0].id_uuid;
          freqTools = typeof res.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(res.rows[0].frequently_used_tools_json) : res.rows[0].frequently_used_tools_json || [];
          chatNotes = typeof res.rows[0].chat_notes_json === 'string' ? JSON.parse(res.rows[0].chat_notes_json) : res.rows[0].chat_notes_json || [];
        }

        await pool.query(`
          INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          ON CONFLICT (tenant_id, user_id)
          DO UPDATE SET 
            response_preferences_text = EXCLUDED.response_preferences_text,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [memId, tenantId, userId, input.response_preferences_text, JSON.stringify(freqTools), JSON.stringify(chatNotes)]);

        // S10: Vault-Spiegel (best-effort — UI-pflegtes Memory auch im Vault ablegen)
        try {
          const { writeUserMemoryVault } = await import("../ai/vaultStore.js");
          await writeUserMemoryVault(tenantId, userId, {
            response_preferences_text: input.response_preferences_text,
            frequently_used_tools_json: freqTools as Array<{ tool: string; count: number }>,
            chat_notes_json: chatNotes as Array<{ id_uuid: string; content: string; created_at_utc: string }>
          });
        } catch (err) {
          console.warn("[updateUserMemory] Vault-Spiegel fehlgeschlagen (DB bleibt konsistent):", err);
        }

        return { success: true, id_uuid: memId };
      }
    }),

  saveNoteToEntity: protectedProcedure
    .input(SaveEntityNoteSchema)
    .output(z.object({ success: z.boolean(), noteId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";
      
      // Resolve actual Admin identity instead of default "Demo User"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      const noteId = uuidv4();
      const timestamp = new Date().toISOString();

      const newNote = {
        id_uuid: noteId,
        content: input.content,
        created_at_utc: timestamp,
        created_by_identity: actorIdentity
      };

      // 1. UPDATE CRM ENTITY METADATA & CUSTOM_DOCUMENTS MARKDOWN
      let entityName = "Unbekannt";
      let entityFound = false;
      if (input.entity_type === 'user') {
        entityFound = true; // User memory notes have no CRM table mirror
        entityName = actorIdentity || "Eigene Notiz";
      } else if (isUsingFallback) {
        let list: (Company | Contact)[] = [];
        if (input.entity_type === 'company') list = fallbackStore.companies || [];
        else if (input.entity_type === 'contact') list = fallbackStore.contacts || [];

        const entity = list.find((e) => e.id_uuid === input.entity_id && e.tenant_id === tenantId);
        if (entity) {
          entityFound = true;
          entityName = entity.full_legal_name || entity.id_uuid || "Unbekannt";
          
          const metadata = (entity.metadata || {}) as Record<string, unknown> & { notes?: EntityNote[] };
          if (!Array.isArray(metadata.notes)) {
            metadata.notes = [];
          }
          metadata.notes.push(newNote);
          entity.metadata = metadata;

          const existingDocs = entity.custom_documents || "";
          const formattedDate = new Date().toLocaleDateString('de-DE');
          const markdownNote = `---

🤖 **LOUIS AI** | Freigegeben durch: *${actorIdentity}* am *${formattedDate}*

${input.content.trim()}

---`;
          entity.custom_documents = existingDocs ? `${existingDocs.trim()}\n\n${markdownNote}` : markdownNote;
          
          saveFallbackStore();
        }
      } else {
        let tableName = "";
        if (input.entity_type === 'company') tableName = "core_registry_companies";
        else if (input.entity_type === 'contact') tableName = "core_registry_contacts";

        if (tableName && input.entity_id) {
          const r = await pool.query(`SELECT metadata, custom_documents, full_legal_name FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [input.entity_id, tenantId]);
          if (r.rows.length > 0) {
            entityFound = true;
            entityName = r.rows[0].full_legal_name || input.entity_id;
            const metadataObj = r.rows[0].metadata || {};
            if (!metadataObj.notes) metadataObj.notes = [];
            metadataObj.notes.push(newNote);

            const existingDocs = r.rows[0].custom_documents || "";
            const formattedDate = new Date().toLocaleDateString('de-DE');
            const markdownNote = `---

🤖 **LOUIS AI** | Freigegeben durch: *${actorIdentity}* am *${formattedDate}*

${input.content.trim()}

---`;
            const updatedDocs = existingDocs ? `${existingDocs.trim()}\n\n${markdownNote}` : markdownNote;

            await pool.query(
              `UPDATE ${tableName} SET metadata = $1, custom_documents = $2 WHERE id_uuid = $3 AND tenant_id = $4`,
              [JSON.stringify(metadataObj), updatedDocs, input.entity_id, tenantId]
            );
          }
        }
      }

      if (!entityFound) {
        throw new Error(`CRM Entity ${input.entity_type} with ID ${input.entity_id} not found.`);
      }

      // 2. APPEND NOTE TO USER MEMORY (chat_notes_json) - ONLY FOR USER ENTITY TYPE
      if (input.entity_type === 'user') {
        const userMemoryNote = {
          id_uuid: noteId,
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          content: input.content,
          created_at_utc: timestamp,
          is_rag_indexed: !!input.is_rag_indexed
        };

        if (isUsingFallback) {
          if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
          let memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (!memory) {
            memory = {
              id_uuid: uuidv4(),
              tenant_id: tenantId,
              user_id: userId,
              response_preferences_text: "",
              frequently_used_tools_json: [],
              chat_notes_json: [],
              created_at_utc: timestamp,
              updated_at_utc: timestamp
            };
            fallbackStore.louisAiUserMemory.push(memory);
          }
          if (!memory.chat_notes_json) memory.chat_notes_json = [];
          memory.chat_notes_json.push(userMemoryNote);
          saveFallbackStore();
        } else {
          const memRes = await pool.query(
            "SELECT id_uuid, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
            [userId, tenantId]
          );
          let chatNotes: unknown[] = [];
          let responsePreferences = "";
          let freqTools: unknown[] = [];
          let memId = uuidv4();
          if (memRes.rows.length > 0) {
            memId = memRes.rows[0].id_uuid;
            responsePreferences = memRes.rows[0].response_preferences_text || "";
            freqTools = typeof memRes.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(memRes.rows[0].frequently_used_tools_json) : memRes.rows[0].frequently_used_tools_json || [];
            chatNotes = typeof memRes.rows[0].chat_notes_json === 'string' ? JSON.parse(memRes.rows[0].chat_notes_json) : memRes.rows[0].chat_notes_json || [];
          }
          chatNotes.push(userMemoryNote);

          await pool.query(`
            INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
            ON CONFLICT (tenant_id, user_id)
            DO UPDATE SET chat_notes_json = EXCLUDED.chat_notes_json, updated_at_utc = CURRENT_TIMESTAMP
          `, [memId, tenantId, userId, responsePreferences, JSON.stringify(freqTools), JSON.stringify(chatNotes)]);
        }

        // Automatic RAG indexing if requested
        if (input.is_rag_indexed) {
          try {
            const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
            if (!fs.existsSync(KNOWLEDGE_ROOT)) {
              fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
            }
            const filename = `notiz_${noteId}.txt`;
            const filePath = path.join(KNOWLEDGE_ROOT, filename);
            fs.writeFileSync(filePath, input.content, "utf8");
            await forceManualIngest(filePath, filename, tenantId, "global");
            console.log(`[RAG Ingestion] Note "${noteId}" directly indexed during creation context`);
          } catch (err) {
            console.error(`[RAG Ingestion] Failed to automatically index note "${noteId}" on creation:`, err);
          }
        }
      }

      // 3. LOG AUDIT EVENT
      let detailSnippet = input.content.slice(0, 80);
      if (input.content.length > 80) detailSnippet += "...";

      let auditDetails = "";
      if (input.entity_type === 'user') {
        auditDetails = `Persönliche Wissensnotiz im Langzeitgedächtnis des Benutzers angelegt: "${detailSnippet}"`;
      } else if (input.entity_type === 'company') {
        auditDetails = `Notiz als Markdown im Bereich 'Notizen & Dokumente' für Firma "${entityName}" (ID: ${input.entity_id}) gespeichert: "${detailSnippet}"`;
      } else if (input.entity_type === 'contact') {
        auditDetails = `Notiz als Markdown im Bereich 'Notizen & Dokumente' für Kontakt "${entityName}" (ID: ${input.entity_id}) gespeichert: "${detailSnippet}"`;
      }

      await logAuditEvent({
        tenantId,
        eventType: "CREATE_NOTE",
        entityType: input.entity_type,
        entityId: input.entity_id,
        eventDetails: auditDetails,
        actorIdentity: ctx.session?.user?.name || "LOUIS CRM AI"
      });

      return { success: true, noteId };
    }),

  getTextGeneratorConfig: protectedProcedure
    .output(z.object({
      id_uuid: z.string().optional(),
      system_prompt: z.string(),
      temperature: z.number(),
      max_tokens: z.number(),
      model_name: z.string(),
    }))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;

      if (isUsingFallback) {
        const list = fallbackStore.textGeneratorConfig || [];
        const found = list.find((c) => c.tenant_id === tenantId);
        if (found) {
          return {
            id_uuid: found.id_uuid,
            system_prompt: found.system_prompt,
            temperature: found.temperature,
            max_tokens: found.max_tokens,
            model_name: found.model_name || "llama3",
          };
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT id_uuid, system_prompt, temperature, max_tokens, model_name FROM sys_integrations_text_generator_config WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            return {
              id_uuid: row.id_uuid,
              system_prompt: row.system_prompt,
              temperature: row.temperature,
              max_tokens: row.max_tokens,
              model_name: row.model_name || "llama3",
            };
          }
        } catch (err) {
          console.warn("sys_integrations_text_generator_config query failed:", err);
        }
      }

      // Default configuration
      return {
        system_prompt: "Du bist eine hochentwickelte Text-Schreib-KI für das Louis Smart CRM-System. Schreibe den angeforderten Text elegant, präzise und fehlerfrei. Benutze professionelle Formulierungen und folge exakt den Anweisungen. Wenn Platzhalter (wie {{invoice_number}}, {{my_company_name}}, etc.) im Ausgangstext oder Kontext vorkommen, übernehme und erhalte sie exakt so, wie sie definiert sind.",
        temperature: 0.7,
        max_tokens: 2000,
        model_name: "llama3"
      };
    }),

  saveTextGeneratorConfig: protectedProcedure
    .input(TextGeneratorConfigSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const id = input.id_uuid || uuidv4();

      if (isUsingFallback) {
        if (!fallbackStore.textGeneratorConfig) {
          fallbackStore.textGeneratorConfig = [];
        }
        fallbackStore.textGeneratorConfig = fallbackStore.textGeneratorConfig.filter((c) => c.tenant_id !== tenantId);
        fallbackStore.textGeneratorConfig.push({
          ...input,
          id_uuid: id,
          tenant_id: tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_integrations_text_generator_config (
            id_uuid, tenant_id, system_prompt, temperature, max_tokens, model_name, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id)
          DO UPDATE SET 
            system_prompt = EXCLUDED.system_prompt,
            temperature = EXCLUDED.temperature,
            max_tokens = EXCLUDED.max_tokens,
            model_name = EXCLUDED.model_name,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          id,
          tenantId,
          input.system_prompt,
          input.temperature,
          input.max_tokens,
          input.model_name
        ]);
      }

      await logAuditEvent({
        tenantId,
        eventType: "UPDATE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: "Louis AI Text Generator config updated."
      });

      return { success: true };
    }),

  generateText: protectedProcedure
    .input(z.object({
      fieldId: z.string(),
      currentValue: z.string().optional().nullable(),
      context: z.string(),
      userInstructions: z.string(),
      chatHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string()
      })).default([]),
 // : Sprache des CRM durchreichen (kein Hardcoding) — für Sanitizer-/Fallback-Sprache
      language: z.string().default('de')
    }))
    .output(z.object({ text: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      // 1. Get configs
      let aiConfig: {
        provider_type: string;
        model_name: string;
        temperature: number;
        top_p: number;
        top_k: number;
        num_ctx: number;
        api_key_secret?: string;
        base_url?: string;
      } | null = null;
      try {
        if (isUsingFallback) {
          const list = fallbackStore.louisAiConfig || [];
          const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
          if (found) {
            aiConfig = {
              provider_type: found.provider_type,
              model_name: found.model_name,
              temperature: found.temperature,
              top_p: found.top_p,
              top_k: found.top_k,
              num_ctx: found.num_ctx,
              api_key_secret: found.api_key_secret,
              base_url: found.base_url
            };
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            aiConfig = res.rows[0];
          }
        }
      } catch (err) {
        console.warn("Failed to load Louis AI config:", err);
      }

      if (!aiConfig) {
        aiConfig = {
          provider_type: 'ollama',
          model_name: "llama3",
          temperature: 0.2,
          top_p: 0.9,
          top_k: 40,
          num_ctx: 8192
        };
      }

      const provider = aiConfig.provider_type || 'ollama';
      let cleanApiKey = aiConfig.api_key_secret?.trim() || '';
      if (cleanApiKey.includes('@') || cleanApiKey === '******') {
        cleanApiKey = '';
      }

      const needsApiKey = provider !== 'ollama';
      if (needsApiKey && !cleanApiKey) {
        throw new Error(`Fehler: Kein gültiger API-Schlüssel für '${provider.toUpperCase()}' in den LOUIS AI-Einstellungen konfiguriert.`);
      }

      // Load text generator settings
      let systemPrompt = "Du bist eine hochentwickelte Text-Schreib-KI für das Louis Smart CRM-System. Schreibe den angeforderten Text elegant, präzise und fehlerfrei. Benutze professionelle Formulierungen und folge exakt den Anweisungen. Wenn Platzhalter (wie {{invoice_number}}, {{my_company_name}}, etc.) im Ausgangstext oder Kontext vorkommen, übernehme und erhalte sie exakt so, wie sie definiert sind.";
      let temp = 0.7;
      let maxTokens = 2000;

      try {
        if (isUsingFallback) {
          const list = fallbackStore.textGeneratorConfig || [];
          const found = list.find((c) => c.tenant_id === tenantId);
          if (found) {
            systemPrompt = found.system_prompt;
            temp = found.temperature;
            maxTokens = found.max_tokens;
          }
        } else {
          const res = await pool.query(
            "SELECT system_prompt, temperature, max_tokens FROM sys_integrations_text_generator_config WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            systemPrompt = row.system_prompt;
            temp = row.temperature;
            maxTokens = row.max_tokens;
          }
        }
      } catch (err) {
        console.warn("Failed to load text generator config, using defaults:", err);
      }

      // Construct a tailored prompt enclosing context, current element value & user instructions
 // : Feld-Typ aus fieldId ableiten — ALLE Zielfelder sind contentEditable-HTML-Editoren
      // (Offers/Invoices/Templates/Mail). Der alte Prompt ließ das LLM plain text liefern, der ohne
      // Konvertierung als innerHTML gesetzt wurde → Formatierungsverlust / rohes HTML-Markdown im Editor.
      const HTML_EDITOR_FIELDS = new Set([
        'introductory_text', 'closing_text', 'item_desc_single',
        'email_body', 'signature_body', 'template_body',
        'invoice_text_body', 'offer_text_body', 'item_description'
      ]);
      const isHtmlField = HTML_EDITOR_FIELDS.has(input.fieldId);
      const outputFormatDirective = isHtmlField
        ? `- Output ONLY the final HTML fragment for a contentEditable editor. Use clean HTML: <p> for paragraphs, <br> for line breaks, <strong>/<b> for bold, <em>/<i> for italic, <ul>/<li> for lists. NO <html>, <head>, <body> wrapper, NO markdown (no **, no #, no - bullets), NO code fences, NO conversational introduction. Preserve CRM placeholders like {{invoice_number}} exactly.`
        : `- Output ONLY the newly drafted or refined text content. No conversational introduction ("Hier ist dein Entwurf..."), no markdown code blocks, no HTML tags — plain text only. Preserve CRM placeholders like {{invoice_number}} exactly.`;

      // Construct chat structures and contents
 // : currentValue VOR dem Prompt von HTML auf reinen Text normalisieren —
      // der rohe HTML-Body (mit Signatur/Tags) blähte den Input auf und verlangsamte den
      // Call massiv („braucht sehr lange — wahrscheinlich wegen des ganzen HTML").
      const stripHtmlToPlain = (html: string): string =>
        html
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      const plainCurrentValue = stripHtmlToPlain(input.currentValue || '');
      const userMessageText = `
        ## CONTEXT:
        Current edited element/field: "${input.fieldId}" (${input.context})
        
        ## CURRENT FIELD VALUE (plain text, HTML entfernt):
        \`\`\`
        ${plainCurrentValue || '--- (Leer) ---'}
        \`\`\`

        ## USER INSTRUCTIONS / AMENDMENTS:
        ${input.userInstructions}

        ## LANGUAGE:
        Write the output text in the CRM's configured language: ${input.language === 'en' ? 'English' : 'German / Deutsch'}. All generated sentences must be in that language.

        ## OUTPUT REQUIREMENTS:
        ${outputFormatDirective}
        - Act precisely on the instructions.
        - Erhalte CRM Platzhalter wie {{invoice_number}}, {{due_date}}, usw. unverändert!
      `;

      const contentsList: unknown[] = [];
      // Push history
      for (const msg of input.chatHistory) {
        contentsList.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
      // Push final message
      contentsList.push({
        role: 'user',
        parts: [{ text: userMessageText }]
      });

      try {
        const aiResponse = await generateContentUniversal({
          provider_type: provider as 'gemini' | 'ollama' | 'openai' | 'anthropic',
          model_name: aiConfig.model_name || 'llama3',
          api_key_secret: cleanApiKey,
          base_url: aiConfig.base_url,
          temperature: temp,
          contents: contentsList,
          systemInstruction: systemPrompt
        });

        const textOutput = aiResponse.text || "Fehler: Antwort konnte nicht generiert werden.";
 // : Antwort-Pfad sanitizen (Lektion: „Bei neuen Antwort-Pfaden
        // IMMER sanitizen") — XML-Leaks/Thinking-Blöcke strippen, dann für HTML-Editoren den
        // reinen Text (falls das Modell keinen HTML lieferte) zu Absätzen normalisieren.
        const cleaned = sanitizeFinalText(textOutput, input.language === 'en' ? 'en' : 'de', { enableThinkingScrub: true });
 // (Probe-Fund): DeepSeek liefert trotz „NO code fences" Markdown-Fences
        // (```html … ```) — sanitizeFinalText strippt nur XML/Thinking, keine Fences.
        // Fence-Marker entfernen, Inhalt (HTML-Fragment) behalten.
        let cleanedNoFence = cleaned
          .replace(/```(?:html|xml|markdown|text)?\s*/gi, '')
          .replace(/```/g, '');
        let normalized = cleanedNoFence;
        if (isHtmlField) {
          const hasHtml = /<[a-z][\s\S]*>/i.test(cleanedNoFence);
          if (!hasHtml) {
            normalized = cleanedNoFence
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean)
              .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
              .join('\n');
          }
        }
        return { text: normalized };
      } catch (err) {
        console.error("Text Gen Call failed:", err);
        return { text: `Fehler bei der Textgenerierung: ${(err as Error).message}` };
      }
    }),

  listAvailableModels: protectedProcedure
    .input(z.object({
      provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini']),
      api_key_secret: z.string().optional().nullable(),
      base_url: z.string().optional().nullable(),
    }))
    .output(z.object({
      success: z.boolean(),
      models: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
      })),
      error: z.string().optional().nullable()
    }))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      if (input.provider_type === 'gemini') {
        let apiKey = input.api_key_secret?.trim() || '';

        if (apiKey.includes('@') || apiKey === '******') {
          apiKey = '';
        }

        if (!apiKey) {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret.trim();
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret.trim();
            }
          }
        }

        if (apiKey.includes('@') || apiKey === '******') {
          apiKey = '';
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Empfohlenes Standardmodell (Text)' },
              { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Leichtes, schnelles Modell' },
              { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', description: 'Hochpräzises Entwickler-Modell' },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Schnelles, stabiles Produktionsmodell' },
              { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Leistungsstarkes Vorschau-Modell' }
            ],
            error: "Es wurde kein Gemini API-Schlüssel in den Einstellungen gefunden."
          };
        }

        try {
          const gAI = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'louis-crm',
              }
            }
          });
          const listRes = await gAI.models.list();
          const listArr = listRes ? (Array.isArray(listRes) ? listRes : (listRes.page || (listRes as unknown as Record<string, unknown>).models || [])) : [];
          
          const rawModels = (listArr as Record<string, unknown>[]).map((m) => {
            const id = String(m.name || '').replace(/^models\//, '') || String(m.name || '') || '';
            const name = String(m.displayName || id);
            return {
              id,
              name,
              description: m.description ? String(m.description) : null
            };
          });

          // Filter for relevant generation models
          const filteredModels = rawModels.filter((m) => 
            m.id.toLowerCase().includes("gemini") && 
            !m.id.toLowerCase().includes("embedding") &&
            !m.id.toLowerCase().includes("bidi") &&
            !m.id.toLowerCase().includes("aqa") &&
            !m.id.toLowerCase().includes("classification")
          );

          if (filteredModels.length === 0) {
            return {
              success: true,
              models: rawModels.slice(0, 20),
              error: null
            };
          }

          return {
            success: true,
            models: filteredModels,
            error: null
          };
        } catch (err: unknown) {
          console.error("Gemini models.list call failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Empfohlenes Standardmodell (Text)' },
              { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Leichtes, schnelles Modell' },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Stabil' }
            ],
            error: `API-Abfrage fehlgeschlagen: ${errMsg}`
          };
        }
      }

      if (input.provider_type === 'ollama') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'http://localhost:11434';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `http://${u}`;
        }
        if (!u) {
          u = 'http://localhost:11434';
        }
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds
          const res = await fetch(`${u}/api/tags`, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { models?: Record<string, unknown>[] };
          if (data && Array.isArray(data.models)) {
            const parsed = data.models.map((m) => ({
              id: String(m.name),
              name: String(m.name),
              description: `Größe: ${(Number(m.size) / (1024*1024*1024)).toFixed(2)} GB, Details: ${(m.details as Record<string, unknown> | undefined)?.parameter_size || 'N/A'}`
            }));
            return {
              success: true,
              models: parsed,
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Keine Modelle gefunden."
          };
        } catch (err: unknown) {
          console.error("Ollama list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'llama3:latest', name: 'llama3:latest', description: 'Sehr populäres 8B Modell' },
              { id: 'llama3.1', name: 'llama3.1', description: 'Sehr populäres 8B Modell' },
              { id: 'llama3:8b', name: 'llama3:8b', description: 'Älteres Llama 3 Modell' },
              { id: 'mistral', name: 'mistral', description: 'Kompakt' },
              { id: 'gemma2', name: 'gemma2', description: 'Googles Gemma 2' },
              { id: 'phi3', name: 'phi3', description: 'Microsofts kleines Modell' }
            ],
            error: `Ollama-Abruf fehlgeschlagen unter ${u}: ${errMsg}. Lokaler Server läuft eventuell nicht.`
          };
        }
      }

      if (input.provider_type === 'openai') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'https://api.openai.com';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `https://${u}`;
        }
        if (!u) {
          u = 'https://api.openai.com';
        }
        let apiKey = input.api_key_secret;
        if (!apiKey || apiKey === '******' || apiKey === '') {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret;
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret;
            }
          }
        }

        if (!apiKey || apiKey === '******' || apiKey === '') {
          apiKey = process.env.OPENAI_API_KEY;
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'gpt-4o', name: 'gpt-4o', description: 'High-intelligence flagship' },
              { id: 'gpt-4o-mini', name: 'gpt-4o-mini', description: 'Fast, lightweight intelligence' },
              { id: 'o1-mini', name: 'o1-mini', description: 'Reasoning model for math & logic' }
            ],
            error: "Es wurde kein OpenAI API-Schlüssel konfiguriert. Zeige Standard-Modelle."
          };
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${u}/v1/models`, {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { data?: Record<string, unknown>[] };
          if (data && Array.isArray(data.data)) {
            const textModels = data.data
              .filter((m) => 
                String(m.id).includes("gpt") || 
                String(m.id).includes("o1") || 
                String(m.id).includes("o3")
              )
              .map((m) => ({
                id: String(m.id),
                name: String(m.id),
                description: `Eigentümer: ${m.owned_by || 'OpenAI'}`
              }));
            return {
              success: true,
              models: textModels.length > 0 ? textModels : data.data.slice(0, 15).map((m) => ({ id: String(m.id), name: String(m.id) })),
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Antwort hatte ein ungültiges Format."
          };
        } catch (err: unknown) {
          console.error("OpenAI model list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'gpt-4o', name: 'gpt-4o', description: 'Flaggschiff' },
              { id: 'gpt-4o-mini', name: 'gpt-4o-mini', description: 'Schnelle Intelligenz' }
            ],
            error: `OpenAI-Abruf fehlgeschlagen: ${errMsg}`
          };
        }
      }

      if (input.provider_type === 'anthropic') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'https://api.anthropic.com';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `https://${u}`;
        }
        if (!u) {
          u = 'https://api.anthropic.com';
        }
        let apiKey = input.api_key_secret;
        if (!apiKey || apiKey === '******' || apiKey === '') {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret;
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret;
            }
          }
        }

        if (!apiKey || apiKey === '******' || apiKey === '') {
          apiKey = process.env.ANTHROPIC_API_KEY;
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Hochpräzise Allround-Fähigkeiten (Empfohlen)' },
              { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Schnorchel-Modell für schnelle Chats' },
              { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', description: 'Komplexes System- und Programmierdenken' }
            ],
            error: "Es wurde kein Anthropic API-Schlüssel konfiguriert. Zeige Standard-Auswahl."
          };
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${u}/v1/models`, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { data?: Record<string, unknown>[] };
          if (data && Array.isArray(data.data)) {
            const parsed = data.data.map((m) => ({
              id: String(m.id),
              name: String(m.display_name || m.id),
              description: `Typ: ${m.type || 'Anthropic Model'}`
            }));
            return {
              success: true,
              models: parsed,
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Keine Modelle gelistet."
          };
        } catch (err: unknown) {
          console.error("Anthropic model list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Fallback Sonnet' },
              { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Fallback Haiku' }
            ],
            error: `Anthropic-Abruf fehlgeschlagen: ${errMsg}`
          };
        }
      }

      return {
        success: false,
        models: [],
        error: "Unbekannter Provider"
      };
    }),

  editEntityNote: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      content: z.string().min(1).max(10000)
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // 1. Update in sys_louis_ai_user_memory (chat_notes_json)
      let foundType: 'user' | 'company' | 'contact' = 'user';
      let foundEntityId: string | undefined = undefined;
      let noteRef: SavedChatNote | null = null;

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            const note = memory.chat_notes_json.find((n) => n.id_uuid === input.id_uuid);
            if (note) {
              note.content = input.content;
              note.updated_at_utc = new Date().toISOString();
              const typeVal = note.entity_type || 'user';
              if (typeVal === 'company' || typeVal === 'contact') {
                foundType = typeVal;
              } else {
                foundType = 'user';
              }
              foundEntityId = note.entity_id;
              noteRef = note;
            }
          }
        }
        
        // 2. Also update mirror in CRM entities if needed
        if (foundType !== 'user' && foundEntityId) {
          let list: (Company | Contact)[] = [];
          if (foundType === 'company') list = fallbackStore.companies || [];
          else if (foundType === 'contact') list = fallbackStore.contacts || [];

          const entity = list.find((e) => e.id_uuid === foundEntityId && e.tenant_id === tenantId);
          if (entity && entity.metadata) {
            const metadataObj = entity.metadata as Record<string, unknown> & { notes?: unknown[] };
            if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
              const notes = metadataObj.notes as EntityNote[];
              const noteMirror = notes.find((n) => n.id_uuid === input.id_uuid);
              if (noteMirror) {
                noteMirror.content = input.content;
                metadataObj.notes = notes;
                entity.metadata = metadataObj;
              }
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          let chatNotes: SavedChatNote[] = typeof memRes.rows[0].chat_notes_json === 'string' 
            ? JSON.parse(memRes.rows[0].chat_notes_json) 
            : memRes.rows[0].chat_notes_json || [];
          
          const note = chatNotes.find((n) => n.id_uuid === input.id_uuid);
          if (note) {
            note.content = input.content;
            note.updated_at_utc = new Date().toISOString();
            const typeVal = note.entity_type || 'user';
            if (typeVal === 'company' || typeVal === 'contact') {
              foundType = typeVal;
            } else {
              foundType = 'user';
            }
            foundEntityId = note.entity_id;
            noteRef = note;

            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memRes.rows[0].id_uuid, tenantId]);
          }
        }

        // Mirror check in Postgres
        if (foundType !== 'user' && foundEntityId) {
          let tableName = "";
          if (foundType === 'company') tableName = "core_registry_companies";
          else if (foundType === 'contact') tableName = "core_registry_contacts";

          if (tableName) {
            const er = await pool.query(`SELECT metadata FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [foundEntityId, tenantId]);
            if (er.rows.length > 0) {
              const metadataObj = er.rows[0].metadata || {};
              if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
                const notes = metadataObj.notes as EntityNote[];
                const noteMirror = notes.find((n) => n.id_uuid === input.id_uuid);
                if (noteMirror) {
                  noteMirror.content = input.content;
                  metadataObj.notes = notes;
                  await pool.query(`UPDATE ${tableName} SET metadata = $1 WHERE id_uuid = $2 AND tenant_id = $3`, [JSON.stringify(metadataObj), foundEntityId, tenantId]);
                }
              }
            }
          }
        }
      }

      // Automatically re-ingest updated note text if it is marked as indexed in RAG
      if (noteRef && noteRef.is_rag_indexed) {
        try {
          const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
          if (!fs.existsSync(KNOWLEDGE_ROOT)) {
            fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
          }
          const filename = `notiz_${input.id_uuid}.txt`;
          const filePath = path.join(KNOWLEDGE_ROOT, filename);
          fs.writeFileSync(filePath, input.content, "utf8");
          await forceManualIngest(filePath, filename, tenantId, "global");
          console.log(`[RAG Ingestion] Re-indexed modified note "${input.id_uuid}" successfully`);
        } catch (err) {
          console.error(`[RAG Ingestion] Failed to re-index edited note "${input.id_uuid}":`, err);
        }
      }

      return { success: true };
    }),

  deleteEntityNote: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // Resolve actual Admin identity instead of default "Demo User"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      let foundType: 'user' | 'company' | 'contact' = 'user';
      let foundEntityId: string | undefined = undefined;
      let deletedContentPreview = "";

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            const index = memory.chat_notes_json.findIndex((n) => n.id_uuid === input.id_uuid);
            if (index !== -1) {
              const note = memory.chat_notes_json[index];
              const typeVal = note.entity_type || 'user';
              if (typeVal === 'company' || typeVal === 'contact') {
                foundType = typeVal;
              } else {
                foundType = 'user';
              }
              foundEntityId = note.entity_id;
              deletedContentPreview = note.content || "";
              memory.chat_notes_json.splice(index, 1);
            }
          }
        }
        
        if (foundType !== 'user' && foundEntityId) {
          let list: (Company | Contact)[] = [];
          if (foundType === 'company') list = fallbackStore.companies || [];
          else if (foundType === 'contact') list = fallbackStore.contacts || [];

          const entity = list.find((e) => e.id_uuid === foundEntityId && e.tenant_id === tenantId);
          if (entity && entity.metadata) {
            const metadataObj = entity.metadata as Record<string, unknown>;
            const notes = metadataObj.notes;
            if (notes && Array.isArray(notes)) {
              const index = notes.findIndex((n: unknown) => {
                const noteObj = n as Record<string, unknown>;
                return noteObj.id_uuid === input.id_uuid;
              });
              if (index !== -1) {
                notes.splice(index, 1);
                entity.metadata = metadataObj;
              }
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          let chatNotes: SavedChatNote[] = typeof memRes.rows[0].chat_notes_json === 'string' 
            ? JSON.parse(memRes.rows[0].chat_notes_json) 
            : memRes.rows[0].chat_notes_json || [];
          
          const index = chatNotes.findIndex((n) => n.id_uuid === input.id_uuid);
          if (index !== -1) {
            const note = chatNotes[index];
            const typeVal = note.entity_type || 'user';
            if (typeVal === 'company' || typeVal === 'contact') {
              foundType = typeVal;
            } else {
              foundType = 'user';
            }
            foundEntityId = note.entity_id;
            deletedContentPreview = note.content || "";
            chatNotes.splice(index, 1);

            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memRes.rows[0].id_uuid, tenantId]);
          }
        }

        if (foundType !== 'user' && foundEntityId) {
          let tableName = "";
          if (foundType === 'company') tableName = "core_registry_companies";
          else if (foundType === 'contact') tableName = "core_registry_contacts";

          if (tableName) {
            const er = await pool.query(`SELECT metadata FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [foundEntityId, tenantId]);
            if (er.rows.length > 0) {
              const metadataObj = er.rows[0].metadata || {};
              if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
                const index = metadataObj.notes.findIndex((n) => n.id_uuid === input.id_uuid);
                if (index !== -1) {
                  metadataObj.notes.splice(index, 1);
                  await pool.query(`UPDATE ${tableName} SET metadata = $1 WHERE id_uuid = $2 AND tenant_id = $3`, [JSON.stringify(metadataObj), foundEntityId, tenantId]);
                }
              }
            }
          }
        }
      }

      // Cleanup associated RAG document and vector chunks on deletion
      try {
        const filename = `notiz_${input.id_uuid}.txt`;
        const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
        const filePath = path.join(KNOWLEDGE_ROOT, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        await unindexFileFromRag(filename, tenantId);
        console.log(`[RAG Ingestion] Note "${input.id_uuid}" fully unindexed and cleaned up on delete`);
      } catch (err) {
        console.error(`[RAG Ingestion] Cleanup failed for note deletion "${input.id_uuid}":`, err);
      }

      // Log Audit Event
      let contentSnippet = deletedContentPreview.slice(0, 80);
      if (deletedContentPreview.length > 80) contentSnippet += "...";

      await logAuditEvent({
        tenantId,
        eventType: "DELETE_NOTE",
        entityType: foundType,
        entityId: foundEntityId,
        eventDetails: `Wissensnotiz aus dem Langzeitgedächtnis entfernt. Inhalt: "${contentSnippet}"`,
        actorIdentity: actorIdentity || "LOUIS CRM AI"
      });

      return { success: true };
    }),

  toggleNoteRagIndex: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      is_rag_indexed: z.boolean()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // 1. Get user memory and locate note
      let chatNotes: SavedChatNote[] = [];
      let foundNote: SavedChatNote | null = null;
      let memId = "";
      let responsePreferences = "";
      let freqTools: unknown[] = [];

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            foundNote = memory.chat_notes_json.find((n) => n.id_uuid === input.id_uuid) || null;
            if (foundNote) {
              foundNote.is_rag_indexed = input.is_rag_indexed;
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          memId = memRes.rows[0].id_uuid;
          responsePreferences = memRes.rows[0].response_preferences_text || "";
          freqTools = typeof memRes.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(memRes.rows[0].frequently_used_tools_json) : memRes.rows[0].frequently_used_tools_json || [];
          chatNotes = typeof memRes.rows[0].chat_notes_json === 'string' ? JSON.parse(memRes.rows[0].chat_notes_json) : memRes.rows[0].chat_notes_json || [];
          
          foundNote = chatNotes.find((n) => n.id_uuid === input.id_uuid) || null;
          if (foundNote) {
            foundNote.is_rag_indexed = input.is_rag_indexed;
            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memId, tenantId]);
          }
        }
      }

      if (!foundNote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notiz nicht gefunden."
        });
      }

      // 2. Perform RAG indexing or unindexing
      const filename = `notiz_${input.id_uuid}.txt`;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      const filePath = path.join(KNOWLEDGE_ROOT, filename);

      if (input.is_rag_indexed) {
        try {
          if (!fs.existsSync(KNOWLEDGE_ROOT)) {
            fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
          }
          fs.writeFileSync(filePath, foundNote.content || "", "utf8");
          await forceManualIngest(filePath, filename, tenantId, "global");
          console.log(`[RAG Ingestion] Note "${input.id_uuid}" indexed manually successfully via toggle`);
        } catch (err) {
          console.error(`[RAG Ingestion] Ingestion failed inside toggleNoteRagIndex for "${input.id_uuid}":`, err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Notiz-Indizierung fehlgeschlagen."
          });
        }
      } else {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          await unindexFileFromRag(filename, tenantId);
          console.log(`[RAG Ingestion] Note "${input.id_uuid}" removed manually successfully via toggle`);
        } catch (err) {
          console.error(`[RAG Ingestion] Unindexing failed inside toggleNoteRagIndex for "${input.id_uuid}":`, err);
        }
      }

      // 3. Log Audit Event
      let contentSnippet = (foundNote.content || "").slice(0, 80);
      if ((foundNote.content || "").length > 80) contentSnippet += "...";

      await logAuditEvent({
        tenantId,
        eventType: input.is_rag_indexed ? "INDEX_NOTE_RAG" : "UNINDEX_NOTE_RAG",
        entityType: "user",
        entityId: input.id_uuid,
        eventDetails: input.is_rag_indexed 
          ? `Wissensnotiz in RAG Wissensdatenbank indiziert: "${contentSnippet}"`
          : `Wissensnotiz aus RAG Wissensdatenbank entfernt: "${contentSnippet}"`,
        actorIdentity: "Admin"
      });

      return { success: true };
    }),

  getKnowledgeFiles: protectedProcedure
    .output(z.array(z.object({
      name: z.string(),
      size: z.number(),
      mtime: z.string(),
      isIndexed: z.boolean(),
      chunkCount: z.number()
    })))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        if (!fs.existsSync(KNOWLEDGE_ROOT)) {
          fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
        }

        let indexedFiles: { file_name: string; chunk_count?: number }[] = [];

        if (isUsingFallback || !pool) {
          const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
          const chunks = fallbackStore.louisAiKnowledgeChunks || [];
          const matchedMeta = metadata.filter((m) => m.tenant_id === tenantId);
          indexedFiles = matchedMeta.map((m) => {
            const chunkCount = chunks.filter((c) => c.document_id === m.id_uuid).length;
            return { file_name: m.file_name, chunk_count: chunkCount };
          });
        } else {
          try {
            const res = await pool.query(
              `SELECT m.file_name, COUNT(c.id_uuid) as chunk_count
               FROM sys_louis_ai_knowledge_metadata m
               LEFT JOIN sys_louis_ai_knowledge_chunks c ON m.id_uuid = c.document_id
               WHERE m.tenant_id = $1
               GROUP BY m.id_uuid, m.file_name`,
              [tenantId]
            );
            indexedFiles = res.rows.map((row) => ({
              file_name: String(row.file_name),
              chunk_count: parseInt(String(row.chunk_count || 0))
            }));
          } catch (err) {
            console.error("Failed to query RAG document metadata in louisAiRouter:", err);
          }
        }
        
        const files = fs.readdirSync(KNOWLEDGE_ROOT);
        return files.map(file => {
          try {
            const fullPath = path.join(KNOWLEDGE_ROOT, file);
            const stats = fs.statSync(fullPath);
            const matchingMeta = indexedFiles.find(m => 
              file === m.file_name || file.endsWith("_" + m.file_name)
            );
            return {
              name: file,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
              isIndexed: !!matchingMeta,
              chunkCount: matchingMeta ? (matchingMeta.chunk_count || 0) : 0,
            };
          } catch (e) {
            return null;
          }
        }).filter((item): item is NonNullable<typeof item> => item !== null);
      } catch (err) {
        console.error("Error getKnowledgeFiles:", err);
        return [];
      }
    }),

  saveKnowledgeFile: protectedProcedure
    .input(z.object({
      filename: z.string(),
      content: z.string(), // base64 encoded
    }))
    .output(z.object({ success: z.boolean(), message: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        if (!fs.existsSync(KNOWLEDGE_ROOT)) {
          fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
        }
        
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        const buffer = Buffer.from(input.content, 'base64');
        fs.writeFileSync(filePath, buffer);

        // Calculate metadata hash for duplicate checking
        const docHash = crypto.createHash('md5').update(buffer).digest('hex');
        const docId = uuidv4();
        const mimeType = mimeTypeFromFilename(input.filename);
        
        let isDuplicate = false;

        if (isUsingFallback || !pool) {
          if (!fallbackStore.louisAiKnowledgeMetadata) {
            fallbackStore.louisAiKnowledgeMetadata = [];
          }
          const existing = fallbackStore.louisAiKnowledgeMetadata.find(
            (m) => m.tenant_id === tenantId && m.document_hash === docHash
          );
          if (existing) {
            isDuplicate = true;
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND document_hash = $2 LIMIT 1",
            [tenantId, docHash]
          );
          if (res.rows.length > 0) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
          console.log(`[RAG Ingestion] Document "${input.filename}" (Hash: ${docHash}) already indexed.`);
          return { success: true, message: "Dokument bereits indiziert." };
        }

        // Ingest and save metadata record
        const metadataRecord = {
          id_uuid: docId,
          tenant_id: tenantId,
          file_name: input.filename,
          file_size_bytes: buffer.length,
          mime_type: mimeType,
          document_hash: docHash,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        };

        if (isUsingFallback || !pool) {
          fallbackStore.louisAiKnowledgeMetadata.push(metadataRecord);
        } else {
          await pool.query(
            `INSERT INTO sys_louis_ai_knowledge_metadata (id_uuid, tenant_id, file_name, file_size_bytes, mime_type, document_hash, created_at_utc, updated_at_utc)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [docId, tenantId, input.filename, buffer.length, mimeType, docHash]
          );
        }

        // Check if format is text-parseable and chunk/index
        const isParseable = isTextBasedFile(input.filename);
        if (isParseable) {
          const ragConfig = await getRagConfig(tenantId);
          const chunks = await intelligentChunkAndProcess(buffer, input.filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

          if (chunks.length === 0) {
            console.log(`[saveKnowledgeFile] No chunks extracted from "${input.filename}". Skipped indexing.`);
            return { success: true, message: "Datei gespeichert, aber keine Text-Extrahierung möglich." };
          }

          console.log(`[RAG Ingestion] Extracted ${chunks.length} chunks for "${input.filename}" (Mime: ${mimeType}) using intelligent parsing`);

          for (let i = 0; i < chunks.length; i++) {
            const textChunk = chunks[i];
            const chunkId = uuidv4();
            let embeddingValues: number[] | null = null;
            try {
              embeddingValues = await generateEmbedding(textChunk, tenantId);
            } catch (embedErr) {
              console.warn(`[RAG Ingestion] Failed to generate embedding for chunk:`, embedErr);
            }

            if (isUsingFallback || !pool) {
              if (!fallbackStore.louisAiKnowledgeChunks) {
                fallbackStore.louisAiKnowledgeChunks = [];
              }
              fallbackStore.louisAiKnowledgeChunks.push({
                id_uuid: chunkId,
                tenant_id: tenantId,
                document_id: docId,
                chunk_index: i,
                chunk_text: textChunk,
                embedding: embeddingValues,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
            } else {
              const vectorStr = embeddingValues ? formatVectorForPostgres(embeddingValues) : null;
              await pool.query(
                `INSERT INTO sys_louis_ai_knowledge_chunks (id_uuid, tenant_id, document_id, chunk_index, chunk_text, embedding, created_at_utc, updated_at_utc)
                 VALUES ($1, $2, $3, $4, $5, $6::vector, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [chunkId, tenantId, docId, i, textChunk, vectorStr]
              );
            }
          }
          if (isUsingFallback || !pool) {
            saveFallbackStore();
          }
        }

        await logAuditEvent({
          tenantId,
          eventType: "UPLOAD_KNOWLEDGE",
          entityType: "settings",
          actorIdentity: "human",
          eventDetails: `Knowledge document uploaded and RAG-indexed: ${input.filename}`
        });

        return { success: true };
      } catch (err: unknown) {
        console.error("Error saveKnowledgeFile:", err);
        const errMsg = err instanceof Error ? err.message : "Fehler beim Speichern der Datei.";
        throw new Error(errMsg);
      }
    }),

  forceIngestKnowledgeToRag: protectedProcedure
    .input(z.object({
      filename: z.string()
    }))
    .output(z.object({ success: z.boolean(), chunkCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const tenantId = ctx.tenantId;
        const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        
        if (!fs.existsSync(filePath)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datei nicht gefunden."
          });
        }

        const chunkCount = await forceManualIngest(filePath, input.filename, tenantId, "global");
        return { success: true, chunkCount };
      } catch (err) {
        console.error("[forceIngestKnowledgeToRag] Manual RAG Ingest failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Manueller RAG Ingest fehlgeschlagen."
        });
      }
    }),

  deleteKnowledgeFile: protectedProcedure
    .input(z.object({
      filename: z.string(),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        // Retrieve and delete metadata node chunks
        if (isUsingFallback || !pool) {
          if (fallbackStore.louisAiKnowledgeMetadata) {
            const found = fallbackStore.louisAiKnowledgeMetadata.find(
              (m) => m.tenant_id === tenantId && m.file_name === input.filename
            );
            if (found) {
              const docId = found.id_uuid;
              fallbackStore.louisAiKnowledgeMetadata = fallbackStore.louisAiKnowledgeMetadata.filter((m) => m.id_uuid !== docId);
              if (fallbackStore.louisAiKnowledgeChunks) {
                fallbackStore.louisAiKnowledgeChunks = fallbackStore.louisAiKnowledgeChunks.filter((c) => c.document_id !== docId);
              }
              saveFallbackStore();
            }
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND file_name = $2 LIMIT 1",
            [tenantId, input.filename]
          );
          if (res.rows.length > 0) {
            const docId = res.rows[0].id_uuid;
            await pool.query("DELETE FROM sys_louis_ai_knowledge_metadata WHERE id_uuid = $1 AND tenant_id = $2", [docId, tenantId]);
            // cascade constraints on database automatically remove all chunks of docId
          }
        }

        await logAuditEvent({
          tenantId,
          eventType: "DELETE_KNOWLEDGE",
          entityType: "settings",
          actorIdentity: "human",
          eventDetails: `Knowledge document deleted & unindexed: ${input.filename}`
        });

        return { success: true };
      } catch (err: unknown) {
        console.error("Error deleteKnowledgeFile:", err);
        const errMsg = err instanceof Error ? err.message : "Fehler beim Löschen der Datei.";
        throw new Error(errMsg);
      }
    }),

 // P0-1: Vault-Skills auflisten (Admin-UI „Skills“) — read-only, kein Schreibzugriff
  listVaultSkills: adminProcedure
    .output(z.array(z.object({
      path: z.string(),
      name: z.string(),
      description: z.string(),
      content: z.string(),
      tags: z.array(z.string()),
      version: z.number(),
      pinned: z.boolean().optional(),
 // P1-1 (Parität #30/#29): Usage-Zähler + Curator-Status
      useCount: z.number().optional(),
      viewCount: z.number().optional(),
      patchCount: z.number().optional(),
      status: z.enum(["active", "inactive", "archived"]).optional(),
      lastUsedAtUtc: z.string().nullable().optional()
    })))
    .query(async ({ ctx }) => {
      const { resolveSkillFiles } = await import("../ai/vaultStore.js");
      const skills = await resolveSkillFiles(ctx.tenantId);
      return skills.map((s) => ({
        path: s.path,
        name: s.name,
        description: s.description,
        content: s.content,
        tags: s.tags || [],
        version: s.version || 1,
        pinned: s.pinned === true,
        useCount: s.useCount ?? 0,
        viewCount: s.viewCount ?? 0,
        patchCount: s.patchCount ?? 0,
        status: s.status ?? "active",
        lastUsedAtUtc: s.lastUsedAtUtc ?? null
      }));
    }),

 // P2 (#53-UI): Laufende Subtasks + „Subtask abbrechen" (Chat-UI-Button)
  listRunningSubtasks: protectedProcedure
    .output(z.object({ subtask_ids: z.array(z.string()) }))
    .query(async () => {
      const { getRunningSubtaskIds } = await import("../ai/agentRuntime.js");
      return { subtask_ids: getRunningSubtaskIds() };
    }),

  abortRunningSubtask: protectedProcedure
    .input(z.object({ subtask_id: z.string().min(1).max(300) }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input }) => {
      const { globalAgentRuntime } = await import("../ai/agentRuntime.js");
      const rt = globalAgentRuntime as unknown as {
        executeAbortSubtask: (ctx: unknown, argsStr: string) => Promise<{ success: boolean; data?: { message?: string }; error?: string }>;
      };
      const res = await rt.executeAbortSubtask({}, JSON.stringify({ subtask_id: input.subtask_id, reason: "per Chat-UI abgebrochen" }));
      return { success: res.success, message: res.success ? (res.data?.message ?? "Abbruch ausgelöst.") : (res.error ?? "Abbruch fehlgeschlagen.") };
    }),

 // P2-E: Skill pinnen/entpinnen — schreibt Frontmatter-Flag via vaultWriteText (nur _louis/skills/)
  toggleSkillPin: adminProcedure
    .input(z.object({ path: z.string().min(1).max(300), pinned: z.boolean() }))
    .output(z.object({ success: z.boolean(), message: z.string(), pinned: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { vaultReadText, vaultWriteText } = await import("../ai/vaultStore.js");
      const existing = await vaultReadText(ctx.tenantId, input.path);
      if (!existing || !existing.content) {
        return { success: false, message: `Skill nicht lesbar: ${input.path}`, pinned: false };
      }
      const content = String(existing.content);
      // Frontmatter pinned-Zeile setzen/entfernen
      let updated: string;
      if (/^pinned:\s*true/m.test(content)) {
        updated = input.pinned ? content : content.replace(/^pinned:\s*true\s*\r?\n/m, "");
      } else if (/^pinned:\s*(false|no|0)\s*\r?\n/m.test(content)) {
        updated = input.pinned ? content.replace(/^pinned:\s*(false|no|0)\s*\r?\n/m, "pinned: true\n") : content;
      } else {
        // kein pinned-Feld → nach der ersten Frontmatter-Zeile einfügen
        const lines = content.split("\n");
        // frontmatter beginnt mit --- ; pinned nach description/version einfügen (nach --- öffnender Zeile)
        let insertIdx = -1;
        if (lines[0]?.trim() === "---") {
          // ans Ende des Frontmatter-Blocks (vor schließendem ---)
          const closeIdx = lines.slice(1).findIndex((l) => l.trim() === "---");
          insertIdx = closeIdx >= 0 ? closeIdx + 1 : 1;
        }
        const insertLine = "pinned: true";
        if (input.pinned) {
          if (insertIdx >= 0) {
            lines.splice(insertIdx, 0, insertLine);
          } else {
            lines.unshift(insertLine);
          }
        }
        updated = lines.join("\n");
      }
      await vaultWriteText(ctx.tenantId, input.path, updated);
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: "VAULT_SKILL_UPDATED",
        entityType: "vault_skill",
        eventDetails: `Admin ${input.pinned ? "pinnte" : "entpinnte"} Skill: ${input.path}`,
        actorIdentity: "human"
      });
      return { success: true, message: input.pinned ? "Skill gepinnt." : "Skill entpinnt.", pinned: input.pinned };
    }),

 // P0-1: Vault-Skill löschen (Admin-UI „Skills“) — nur _louis/skills/, Path-Sanitierung via vaultDeleteText
  deleteVaultSkill: adminProcedure
    .input(z.object({ path: z.string().min(1).max(300) }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { vaultDeleteText } = await import("../ai/vaultStore.js");
      await vaultDeleteText(ctx.tenantId, input.path);
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: "VAULT_SKILL_DELETED",
        entityType: "vault_skill",
        eventDetails: `Admin löschte Skill: ${input.path}`,
        actorIdentity: "human"
      });
      return { success: true, message: `Skill '${input.path}' gelöscht.` };
    }),

 // P2-A: Skill-Suggestions — Liste der offenen Vorschläge (Chat-Karte)
  listSkillSuggestions: protectedProcedure
    .input(z.object({ status: z.enum(["pending", "applied", "dismissed"]).default("pending") }).optional())
    .output(z.array(z.object({
      id_uuid: z.string(),
      workflow_name: z.string(),
      workflow_description: z.string(),
      skill_tags: z.array(z.string()),
      skill_category: z.string().nullable().optional(),
      tool_chain_sequence: z.array(z.object({ tool: z.string(), instruction: z.string() })),
      status: z.string(),
      created_at_utc: z.string()
    })))
    .query(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      const status = input?.status ?? "pending";
      if (isUsingFallback || !pool) {
        return (fallbackStore.skillSuggestions || [])
          .filter((s) => (s.tenant_id === tenantId || s.tenant_id === "1") && s.status === status)
          .sort((a, b) => String(b.created_at_utc).localeCompare(String(a.created_at_utc)))
          .slice(0, 20)
          .map((s) => ({
            id_uuid: s.id_uuid,
            workflow_name: s.workflow_name,
            workflow_description: s.workflow_description,
            skill_tags: s.skill_tags || [],
            skill_category: s.skill_category || null,
            tool_chain_sequence: s.tool_chain_sequence || [],
            status: s.status,
            created_at_utc: String(s.created_at_utc || "")
          }));
      }
      const res = await pool.query(
        `SELECT id_uuid, workflow_name, workflow_description, skill_tags_json, skill_category, tool_chain_sequence_json, status, created_at_utc
         FROM sys_louis_ai_skill_suggestions
         WHERE (tenant_id = $1 OR tenant_id = '1') AND status = $2
         ORDER BY created_at_utc DESC LIMIT 20`,
        [tenantId, status]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        id_uuid: String(r.id_uuid),
        workflow_name: String(r.workflow_name || ""),
        workflow_description: String(r.workflow_description || ""),
        skill_tags: Array.isArray(r.skill_tags_json) ? r.skill_tags_json as string[] : JSON.parse(String(r.skill_tags_json || "[]")) as string[],
        skill_category: r.skill_category ? String(r.skill_category) : null,
        tool_chain_sequence: Array.isArray(r.tool_chain_sequence_json)
          ? r.tool_chain_sequence_json as Array<{ tool: string; instruction: string }>
          : JSON.parse(String(r.tool_chain_sequence_json || "[]")) as Array<{ tool: string; instruction: string }>,
        status: String(r.status || "pending"),
        created_at_utc: r.created_at_utc instanceof Date ? (r.created_at_utc as Date).toISOString() : String(r.created_at_utc || "")
      }));
    }),

 // P2-C: Offene Rückfragen für den Chat (nur OPEN, tenant-scoped) — Admin-Prozedur bleibt unangetastet
  listOpenQuestionsForChat: protectedProcedure
    .output(z.array(AgentQuestionFullSchema))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback || !pool) {
        return (fallbackStore.aiQuestions || [])
          .filter((q) => (q.tenant_id === tenantId || q.tenant_id === "1") && q.status === "OPEN")
          .sort((a, b) => String(b.created_at_utc || "").localeCompare(String(a.created_at_utc || "")));
      }
      const res = await pool.query(
        `SELECT * FROM sys_louis_ai_questions WHERE (tenant_id = $1 OR tenant_id = '1') AND status = 'OPEN' ORDER BY created_at_utc DESC LIMIT 10`,
        [tenantId]
      );
      return res.rows.map((r: unknown) => {
        const row = cleanDbRow(r) as Record<string, unknown>;
        if (row.created_at_utc !== undefined) row.created_at_utc = row.created_at_utc instanceof Date ? (row.created_at_utc as Date).toISOString() : String(row.created_at_utc);
        if (row.answered_at_utc !== undefined && row.answered_at_utc !== null) row.answered_at_utc = row.answered_at_utc instanceof Date ? (row.answered_at_utc as Date).toISOString() : String(row.answered_at_utc);
        // 2026-08-18 (Multi-Turn-): choices_json ist JSONB → pg liefert ein Array,
        // AgentQuestionFullSchema verlangt z.string → Zod-Output-Validierung crashte
        // die Chat-UI nach 1-2 Nachrichten (Sobald eine OPEN-Rückfrage existierte).
        if (row.choices_json !== undefined && row.choices_json !== null && typeof row.choices_json !== 'string') {
          row.choices_json = JSON.stringify(row.choices_json);
        }
        // 2026-08-18 (Admin- „keine Rückfrage angezeigt“): cleanDbRow LÖSCHT NULL-Felder
        // → answer fehlt bei OPEN-Fragen → AgentQuestionFullSchema verlangt z.string → crashte.
        if (row.answer === undefined || row.answer === null) {
          row.answer = "";
        }
        return row as unknown as z.infer<typeof AgentQuestionFullSchema>;
      });
    }),

 // P2-C: Rückfrage beantworten (protected, nur eigene Tenant-Fragen) — Admin-Prozedur bleibt unangetastet
  answerQuestionForChat: protectedProcedure
    .input(AnswerQuestionSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId || "1";
      if (isUsingFallback || !pool) {
        const q = (fallbackStore.aiQuestions || []).find(
          (rec) => rec.id_uuid === input.question_id && (rec.tenant_id === tenantId || rec.tenant_id === "1")
        );
        if (!q) throw new Error("Rückfrage nicht gefunden");
        q.status = "ANSWERED";
        q.answer = input.answer;
        q.answered_at_utc = new Date().toISOString();
        saveFallbackStore();
        return { success: true };
      }
      const res = await pool.query(
        `UPDATE sys_louis_ai_questions SET status = 'ANSWERED', answer = $1, answered_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $2 AND (tenant_id = $3 OR tenant_id = '1') AND status = 'OPEN' RETURNING id_uuid`,
        [input.answer, input.question_id, tenantId]
      );
      if (res.rows.length === 0) throw new Error("Rückfrage nicht gefunden oder bereits beantwortet");
      return { success: true };
    }),

 // P2-A: Skill-Suggestion verwerfen
  dismissSkillSuggestion: protectedProcedure
    .input(z.object({ id_uuid: z.string().min(1) }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback || !pool) {
        const s = (fallbackStore.skillSuggestions || []).find((x) => x.id_uuid === input.id_uuid && (x.tenant_id === tenantId || x.tenant_id === "1"));
        if (!s) return { success: false };
        s.status = "dismissed";
        saveFallbackStore();
        return { success: true };
      }
      const res = await pool.query(
        `UPDATE sys_louis_ai_skill_suggestions SET status = 'dismissed' WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') RETURNING id_uuid`,
        [input.id_uuid, tenantId]
      );
      return { success: res.rows.length > 0 };
    }),

 // P2-A: Skill-Suggestion übernehmen → save_skill-Freigabe-Vorschlag (proposedChanges)
  applySkillSuggestion: protectedProcedure
    .input(z.object({ id_uuid: z.string().min(1) }))
    .output(z.object({ success: z.boolean(), message: z.string(), proposedChanges: z.record(z.string(), z.unknown()).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tenantId = ctx.tenantId;
      let suggestion: {
        id_uuid: string; workflow_name: string; workflow_description: string;
        skill_tags: string[]; skill_category?: string | null;
        tool_chain_sequence: Array<{ tool: string; instruction: string }>;
      } | undefined;
      if (isUsingFallback || !pool) {
        suggestion = (fallbackStore.skillSuggestions || []).find((x) => x.id_uuid === input.id_uuid && (x.tenant_id === tenantId || x.tenant_id === "1"));
      } else {
        const res = await pool.query(
          `SELECT id_uuid, workflow_name, workflow_description, skill_tags_json, skill_category, tool_chain_sequence_json FROM sys_louis_ai_skill_suggestions WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
          [input.id_uuid, tenantId]
        );
        if (res.rows.length > 0) {
          const r = res.rows[0];
          suggestion = {
            id_uuid: String(r.id_uuid),
            workflow_name: String(r.workflow_name || ""),
            workflow_description: String(r.workflow_description || ""),
            skill_tags: Array.isArray(r.skill_tags_json) ? r.skill_tags_json as string[] : JSON.parse(String(r.skill_tags_json || "[]")) as string[],
            skill_category: r.skill_category ? String(r.skill_category) : null,
            tool_chain_sequence: Array.isArray(r.tool_chain_sequence_json)
              ? r.tool_chain_sequence_json as Array<{ tool: string; instruction: string }>
              : JSON.parse(String(r.tool_chain_sequence_json || "[]")) as Array<{ tool: string; instruction: string }>
          };
        }
      }
      if (!suggestion) return { success: false, message: "Vorschlag nicht gefunden." };

      // Inhalt aus tool_chain_sequence bauen (Markdown-Skill)
      const content = suggestion.tool_chain_sequence.length > 0
        ? suggestion.tool_chain_sequence.map((t) => `### ${t.tool}\n${t.instruction}`).join("\n\n")
        : suggestion.workflow_description;
      const proposedChanges = {
        entity_type: "vault_skill",
        action: "CREATE",
        proposed_state: {
          name: suggestion.workflow_name,
          description: suggestion.workflow_description || `Automatisch vorgeschlagener Skill: ${suggestion.workflow_name}`,
          content,
          category: suggestion.skill_category || null,
          tags: suggestion.skill_tags || []
        } as Record<string, unknown>,
        explanation_rational: "Skill-Suggestion aus Workflow-Ausführung"
      };

      // Status → applied (Freigabe-Flow übernimmt den Rest)
      if (isUsingFallback || !pool) {
        const s = (fallbackStore.skillSuggestions || []).find((x) => x.id_uuid === input.id_uuid);
        if (s) s.status = "applied";
        saveFallbackStore();
      } else {
        await pool.query(
          `UPDATE sys_louis_ai_skill_suggestions SET status = 'applied' WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
          [input.id_uuid, tenantId]
        );
      }
      return { success: true, message: `Skill-Vorschlag '${suggestion.workflow_name}' zur Freigabe vorbereitet.`, proposedChanges };
    }),
});
