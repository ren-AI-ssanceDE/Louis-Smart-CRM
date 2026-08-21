import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../../db.js";
import { generateEmbedding, formatVectorForPostgres } from "../embeddingHelper.js";
import { LouisAiKnowledgeMetadata, LouisAiKnowledgeChunk, CustomWorkflow, WorkflowInstance, Company, Contact } from "../../../types.js";
import { ToolResult, createToolSuccess, createToolError, ListVaultFilesInputSchema, PaginatedToolResponse } from "./types.js";
import { normalizeQueryValue } from "../vaultStore.js";
import { RecallSessionsInputSchema } from "../../../lib/schemas.js";
import { SessionRecallHit } from "../../../types.js";
import { workflowExecutor } from "../workflowExecutor.js";
import { evaluateGovernanceRules } from "../governance.js";
import type { WorkflowRunOutcome, WorkflowStepResult } from "../orchestrator.js";
import { McpClientEngine } from "../../mcp/mcpClientEngine.js";
import { ingestFileToRag } from "../../storage.js";
import { performHybridSearch } from "../ragSearch.js";

/**
 * Kürzt lange RAG-Chunk-Texte auf relevante Treffer-Ausschnitte
 */
export function formatKnowledgeChunkForAiContext(
  fileName: string,
  chunkIndex: number,
  content: string,
  query?: string,
  maxSnippetLength: number = 1200
): { file_name: string; chunk_index: number; snippet: string } {
  let snippet = content.trim();

  // Wenn ein Query angegeben ist, zentriere das Snippet um das erste Vorkommen
  if (query && query.trim().length > 0) {
    const searchTerm = query.toLowerCase().trim();
    const matchIndex = snippet.toLowerCase().indexOf(searchTerm);

    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - 50);
      const end = Math.min(snippet.length, matchIndex + maxSnippetLength);
      let extracted = snippet.substring(start, end);

      if (start > 0) extracted = "..." + extracted;
      if (end < snippet.length) extracted = extracted + "...";
      snippet = extracted;
    }
  }

  if (snippet.length > maxSnippetLength) {
    snippet = snippet.substring(0, maxSnippetLength) + "...";
  }

  return {
    file_name: fileName,
    chunk_index: chunkIndex,
    snippet: snippet.replace(/\s+/g, " ")
  };
}

/**
 * Tool 3b: List Vault Files Tool (Retrieves paginated files from knowledge base for current tenant)
 */
export async function executeListVaultFiles(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<PaginatedToolResponse<string>>> {
  try {
    let rawArgs: unknown = {};
    if (argsStr) {
      try {
        rawArgs = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
      } catch {
        rawArgs = { filter: argsStr };
      }
    }

    const parsed = ListVaultFilesInputSchema.safeParse(rawArgs);
    const input = parsed.success ? parsed.data : ListVaultFilesInputSchema.parse({});
    const { filter, limit, offset } = input;

    let dbMetadataFiles: string[] = [];
    if (isUsingFallback || !pool) {
      const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
      dbMetadataFiles = metadata
        .filter((m: LouisAiKnowledgeMetadata) => m.tenant_id === tenantId || m.tenant_id === '1')
        .map((m: LouisAiKnowledgeMetadata) => m.file_name);
    } else {
      try {
        const res = await pool.query(
          "SELECT file_name FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 OR tenant_id = '1'",
          [tenantId]
        );
        if (res && res.rows) {
          dbMetadataFiles = res.rows.map((row: { file_name: string }) => String(row.file_name));
        }
      } catch (err) {
        console.warn("[list_vault_files] Failed to read database metadata files:", err);
      }
    }

    let diskFiles: string[] = [];
    try {
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      if (fs.existsSync(KNOWLEDGE_ROOT)) {
        diskFiles = fs.readdirSync(KNOWLEDGE_ROOT).filter(f => !f.startsWith('.'));
      }
      if (tenantId !== "1") {
        const KNOWLEDGE_FALLBACK = path.resolve(process.cwd(), "knowledge_data_vault", "1");
        if (fs.existsSync(KNOWLEDGE_FALLBACK)) {
          const fallbackDiskFiles = fs.readdirSync(KNOWLEDGE_FALLBACK).filter(f => !f.startsWith('.'));
          diskFiles = Array.from(new Set([...diskFiles, ...fallbackDiskFiles]));
        }
      }
      // Include root directory markdown and text files
      const rootFiles = fs.readdirSync(process.cwd()).filter(f => !f.startsWith('.') && /\.(md|txt)$/i.test(f));
      diskFiles = Array.from(new Set([...diskFiles, ...rootFiles]));
    } catch (err) {
      console.warn("[list_vault_files] Failed to read disk files:", err);
    }

    let allFiles = Array.from(new Set([...diskFiles, ...dbMetadataFiles]));
    if (filter && filter.trim().length > 0) {
      const cleanFilter = filter.toLowerCase().trim();
      allFiles = allFiles.filter(f => f.toLowerCase().includes(cleanFilter));
    }

    const totalCount = allFiles.length;
    const paginatedFiles = allFiles.slice(offset, offset + limit);

    return createToolSuccess({
      items: paginatedFiles,
      pagination: {
        total_count: totalCount,
        limit,
        offset,
        has_more: offset + limit < totalCount
      },
      search_meta: {
        searched_term: filter,
        fuzzy_matched: false
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Auflisten der Wissensdateien: ${msg}`);
  }
}

/**
 * S1-Tool: Recall Sessions — Volltextsuche über vergangene KI-Sessions (analog session_search).
 * Fallback: deterministisches Scoring (Titel 3 / Summary 2 / History 1) NUR für den Fallback-Store
 * (Test/Notbetrieb — nicht identisch zur PG-ts_rank-Gewichtung); PG: tsvector/plainto_tsquery (injektionssicher).
 */
function buildRecallSnippet(row: {
  conversation_history_json?: unknown;
  short_term_summary_text?: string | null;
}): string {
  let snippet = "";
  try {
    const history = row.conversation_history_json as Array<{ role?: string; content?: string }> | null | undefined;
    if (Array.isArray(history) && history.length > 0) {
      snippet = JSON.stringify(history);
    }
  } catch {
    // ignore — Fallback auf Summary
  }
  if (!snippet || snippet.length === 0) {
    snippet = row.short_term_summary_text || "";
  }
  return snippet.length > 500 ? snippet.slice(0, 500) + "…" : snippet;
}

// P0-3: Kontext-Fenster — findet die Nachricht mit dem Suchbegriff und liefert ±3 Nachrichten
function buildContextWindow(
  history: unknown,
  term: string
): Array<{ role: string; content: string; timestamp_utc?: string }> {
  try {
    const msgs = history as Array<{ role?: string; content?: string; timestamp_utc?: string }> | null | undefined;
    if (!Array.isArray(msgs) || msgs.length === 0) return [];
    const t = term.toLowerCase();
    let matchIdx = -1;
    for (let i = 0; i < msgs.length; i++) {
      const content = String(msgs[i]?.content || "");
      if (content.toLowerCase().includes(t)) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx === -1) matchIdx = msgs.length - 1; // kein Match → letzte Nachrichten
    const start = Math.max(0, matchIdx - 3);
    const end = Math.min(msgs.length, matchIdx + 4);
    return msgs.slice(start, end).map((m) => ({
      role: String(m?.role || "unknown"),
      content: String(m?.content || ""),
      ...(m?.timestamp_utc ? { timestamp_utc: String(m.timestamp_utc) } : {})
    }));
  } catch {
    return [];
  }
}

// P0-3: Lineage — lädt die Vorgänger-Session (parent_session_id) mit Titel + Snippet
async function resolveParentSession(tenantId: string, parentId: string | null | undefined): Promise<SessionRecallHit["parent_session"] | undefined> {
  if (!parentId) return undefined;
  try {
    if (isUsingFallback || !pool) {
      const sessions = fallbackStore.louisAiSessions || [];
      const parent = sessions.find((s) => s.id_uuid === parentId && (s.tenant_id === tenantId || s.tenant_id === "1"));
      if (!parent) return undefined;
      return {
        id_uuid: String(parent.id_uuid),
        session_title: String(parent.session_title || ""),
        snippet: buildRecallSnippet(parent),
        created_at_utc: String(parent.created_at_utc || "")
      };
    }
    const res = await pool.query(
      `SELECT id_uuid, session_title, conversation_history_json, short_term_summary_text, created_at_utc
       FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
      [parentId, tenantId]
    );
    if (res.rows.length === 0) return undefined;
    const row = res.rows[0];
    return {
      id_uuid: String(row.id_uuid),
      session_title: String(row.session_title || ""),
      snippet: buildRecallSnippet(row),
      created_at_utc: String(row.created_at_utc || "")
    };
  } catch {
    return undefined; // fehlertolerant — Lineage ist optional
  }
}

// Phase 5 (#48): Reines Recall-Scoring (Fallback-Store-Zweig) — Gewichte
// identisch zur PG-ts_rank-Gewichtung (Titel > Summary > History). Testbar, kein any.
export function scoreSessionForRecall(
  session: { session_title?: unknown; short_term_summary_text?: unknown; conversation_history_json?: unknown },
  term: string
): number {
  const title = String(session.session_title || "").toLowerCase();
  const summary = String(session.short_term_summary_text || "").toLowerCase();
  const historyStr = JSON.stringify(session.conversation_history_json || {}).toLowerCase();
  const t = String(term || "").toLowerCase().trim();
  if (!t) return 0;
  let score = 0;
  if (title.includes(t)) score += 3;
  if (summary.includes(t)) score += 2;
  if (historyStr.includes(t)) score += 1;
  return score;
}

export async function executeRecallSessions(
  tenantId: string,
  argsStr?: string,
 // Phase 5 (#48): Admin-Config (NULL = Backend-Default, Regel 12)
  opts?: { ftsEnabled?: boolean; defaultLimit?: number }
): Promise<ToolResult<PaginatedToolResponse<SessionRecallHit>>> {
  try {
    let rawArgs: unknown = {};
    if (argsStr) {
      try {
        rawArgs = typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr;
      } catch {
        rawArgs = { query: argsStr };
      }
    }

    const parsed = RecallSessionsInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return createToolError(`Bitte einen Suchbegriff angeben (recall_sessions): ${parsed.error.message}`);
    }
    const { query, offset } = parsed.data;
    // 050 (048-B2): Query normalisieren — Modell kann JSON-String statt Freitext liefern
    const normQuery = normalizeQueryValue(query);
    // Serverseitig hart klemmen (LLM-generierte Werte); Default aus Admin-Config (recall_search_limit)
    const clampedLimit = Math.min(parsed.data.limit ?? (opts?.defaultLimit ?? 10), 20);
    const clampedOffset = Math.min(offset, 1000);
    const ftsEnabled = opts?.ftsEnabled ?? true;

    let hits: SessionRecallHit[] = [];
    let totalCount = 0;
    let usedFallback = false;

    if (isUsingFallback || !pool) {
      const sessions = fallbackStore.louisAiSessions || [];
      const term = normQuery.toLowerCase().trim();
 // Phase 5 (#48): recall_fts_enabled=false → direkt neueste Sessions (kein FTS)
      if (!ftsEnabled) {
        const newest = sessions
          .filter((s) => s.tenant_id === tenantId || s.tenant_id === "1")
          .sort((a, b) => String(b.created_at_utc).localeCompare(String(a.created_at_utc)));
        usedFallback = true;
        totalCount = newest.length;
        for (const x of newest.slice(0, clampedLimit)) {
          hits.push({
            id_uuid: String(x.id_uuid),
            session_title: String(x.session_title || ""),
            snippet: buildRecallSnippet(x),
            relevance: 0,
            created_at_utc: String(x.created_at_utc || ""),
            context_window: buildContextWindow(x.conversation_history_json, normQuery),
            parent_session: await resolveParentSession(tenantId, x.parent_session_id)
          });
        }
      } else {
        const scored = sessions
          .filter((s) => s.tenant_id === tenantId || s.tenant_id === "1")
          .map((s) => ({ s, score: scoreSessionForRecall(s, term) }))
          .filter((x) => x.score > 0)
          .sort(
            (a, b) => b.score - a.score || String(b.s.created_at_utc).localeCompare(String(a.s.created_at_utc))
          );
        totalCount = scored.length;
 // : Fallback bei 0 Treffern → neueste Sessions liefern
        if (scored.length === 0) {
          usedFallback = true;
          const newest = sessions
            .filter((s) => s.tenant_id === tenantId || s.tenant_id === "1")
            .sort((a, b) => String(b.created_at_utc).localeCompare(String(a.created_at_utc)));
          totalCount = newest.length;
          for (const x of newest.slice(0, clampedLimit)) {
            hits.push({
              id_uuid: String(x.id_uuid),
              session_title: String(x.session_title || ""),
              snippet: buildRecallSnippet(x),
              relevance: 0,
              created_at_utc: String(x.created_at_utc || ""),
 // P0-3: Kontext-Fenster + Lineage
              context_window: buildContextWindow(x.conversation_history_json, normQuery),
              parent_session: await resolveParentSession(tenantId, x.parent_session_id)
            });
          }
        } else {
          for (const x of scored.slice(clampedOffset, clampedOffset + clampedLimit)) {
            hits.push({
              id_uuid: String(x.s.id_uuid),
              session_title: String(x.s.session_title || ""),
              snippet: buildRecallSnippet(x.s),
              relevance: x.score,
              created_at_utc: String(x.s.created_at_utc || ""),
              context_window: buildContextWindow(x.s.conversation_history_json, normQuery),
              parent_session: await resolveParentSession(tenantId, x.s.parent_session_id)
            });
          }
        }
      }
    } else {
 // Phase 5 (#48): recall_fts_enabled=false → direkt neueste Sessions (kein FTS)
      if (!ftsEnabled) {
        const fb = await pool.query(
          `SELECT id_uuid, session_title, conversation_history_json, short_term_summary_text, created_at_utc, parent_session_id
           FROM sys_louis_ai_sessions
           WHERE (tenant_id = $1 OR tenant_id = '1')
           ORDER BY created_at_utc DESC
           LIMIT $2`,
          [tenantId, clampedLimit]
        );
        usedFallback = true;
        totalCount = fb.rows.length;
        for (const row of fb.rows) {
          hits.push({
            id_uuid: String(row.id_uuid),
            session_title: String(row.session_title || ""),
            snippet: buildRecallSnippet(row),
            relevance: 0,
            created_at_utc: String(row.created_at_utc || ""),
            context_window: buildContextWindow(row.conversation_history_json, normQuery),
            parent_session: await resolveParentSession(tenantId, row.parent_session_id)
          });
        }
      } else {
        // #48 Ranking-Verbesserung: gewichtete ts_rank (Titel A=1.0 > Summary B=0.4 > History C=0.3)
        // + Recency-Bonus (+15 % für Sessions aus den letzten 90 Tagen — neuere > ältere).
 // (Option B): History via history_searchable_text (generierte Spalte, nur
        // content-Felder — kein JSON-Rauschen mehr), Gewicht C 0.2 → 0.3.
        const res = await pool.query(
          `SELECT id_uuid, session_title, conversation_history_json, short_term_summary_text, created_at_utc, parent_session_id,
                  (ts_rank('{0.1, 0.2, 0.4, 1.0}',
                           setweight(to_tsvector('german', COALESCE(session_title,'')), 'A') ||
                           setweight(to_tsvector('german', COALESCE(short_term_summary_text,'')), 'B') ||
                           setweight(to_tsvector('german', COALESCE(history_searchable_text,'')), 'C'),
                           plainto_tsquery('german', $1))
                   * (1.0 + 0.15 * GREATEST(0, 1 - EXTRACT(EPOCH FROM (NOW() - created_at_utc)) / (90.0*86400.0)))) AS relevance,
                  COUNT(*) OVER() AS total_count
           FROM sys_louis_ai_sessions
           WHERE (tenant_id = $2 OR tenant_id = '1')
             AND (setweight(to_tsvector('german', COALESCE(session_title,'')), 'A') ||
                  setweight(to_tsvector('german', COALESCE(short_term_summary_text,'')), 'B') ||
                  setweight(to_tsvector('german', COALESCE(history_searchable_text,'')), 'C'))
                 @@ plainto_tsquery('german', $1)
           ORDER BY relevance DESC, created_at_utc DESC
           LIMIT $3 OFFSET $4`,
          [query, tenantId, clampedLimit, clampedOffset]
        );
        totalCount = res.rows.length > 0 ? Number(res.rows[0].total_count || 0) : 0;
 // : Fallback bei 0 Volltext-Treffern → neueste Sessions
        if (res.rows.length === 0) {
          const fb = await pool.query(
            `SELECT id_uuid, session_title, conversation_history_json, short_term_summary_text, created_at_utc, parent_session_id
             FROM sys_louis_ai_sessions
             WHERE (tenant_id = $1 OR tenant_id = '1')
             ORDER BY created_at_utc DESC
             LIMIT $2`,
            [tenantId, clampedLimit]
          );
          usedFallback = true;
          totalCount = fb.rows.length;
          for (const row of fb.rows) {
            hits.push({
              id_uuid: String(row.id_uuid),
              session_title: String(row.session_title || ""),
              snippet: buildRecallSnippet(row),
              relevance: 0,
              created_at_utc: String(row.created_at_utc || ""),
              context_window: buildContextWindow(row.conversation_history_json, normQuery),
              parent_session: await resolveParentSession(tenantId, row.parent_session_id)
            });
          }
        } else {
          for (const row of res.rows) {
            hits.push({
              id_uuid: String(row.id_uuid),
              session_title: String(row.session_title || ""),
              snippet: buildRecallSnippet(row),
              relevance: Number(row.relevance || 0),
              created_at_utc: String(row.created_at_utc || ""),
              context_window: buildContextWindow(row.conversation_history_json, normQuery),
              parent_session: await resolveParentSession(tenantId, row.parent_session_id)
            });
          }
        }
      }
    }

    return createToolSuccess({
      items: hits,
      pagination: {
        total_count: totalCount,
        limit: clampedLimit,
        offset: clampedOffset,
        has_more: clampedOffset + hits.length < totalCount
      },
      search_meta: {
        searched_term: query,
        fuzzy_matched: false,
        fallback_used: usedFallback,
        note: usedFallback
          ? "Keine Volltext-Treffer für den Suchbegriff — neueste Sessions werden angezeigt."
          : undefined
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler bei der Session-Suche: ${msg}`);
  }
}

/**
 * Tool 3: Local Knowledge Tool (RAG searching of metadata chunks)
 */
export async function executeLocalKnowledgeSearch(tenantId: string, query: string, aiClient?: GoogleGenAI): Promise<ToolResult<Record<string, unknown>>> {
  // 050 (048-B2): Query normalisieren (JSON-String-Unwrap, modell-agnostisch)
  const normQuery = normalizeQueryValue(query).toLowerCase().trim().replace(/\s+/g, " ");

  // 0. Auto-ingest any unindexed disk files in knowledge_data_vault
  try {
    const kDirs = [path.resolve(process.cwd(), "knowledge_data_vault", tenantId)];
    if (tenantId !== "1") {
      kDirs.push(path.resolve(process.cwd(), "knowledge_data_vault", "1"));
    }

    for (const kDir of kDirs) {
      if (fs.existsSync(kDir)) {
        const diskFiles = fs.readdirSync(kDir).filter(f => !f.startsWith('.'));
        for (const filename of diskFiles) {
          const filePath = path.join(kDir, filename);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            let isIndexed = false;
            if (isUsingFallback || !pool) {
              const meta = fallbackStore.louisAiKnowledgeMetadata || [];
              isIndexed = meta.some((m: LouisAiKnowledgeMetadata) => 
                (m.tenant_id === tenantId || m.tenant_id === '1') && m.file_name.toLowerCase() === filename.toLowerCase()
              );
            } else {
              try {
                const res = await pool.query(
                  "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE (tenant_id = $1 OR tenant_id = '1') AND LOWER(file_name) = LOWER($2) LIMIT 1",
                  [tenantId, filename]
                );
                isIndexed = res.rows.length > 0;
              } catch (_) {}
            }

            if (!isIndexed) {
              console.log(`[LocalKnowledgeSearch] Auto-ingesting unindexed disk file: ${filename}`);
              await ingestFileToRag(filePath, filename, tenantId, 'global');
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[LocalKnowledgeSearch] Auto-ingest check failed:", err);
  }

  // Intercept list request to avoid RAG semantic mismatch
  const containsListRequest = /welche dateien|welche dokumente|dateien in der wissensdatenbank|liste der dateien|dateibestand|dokumentenliste|dateiliste|welche dokumente gibt|verzeichnis|wissensdokument|what files|what documents|list the files|list files/i.test(normQuery);

  if (containsListRequest) {
    return (await executeListVaultFiles(tenantId)) as unknown as ToolResult<Record<string, unknown>>;
  }

  // Map available files for targeted filename matching
  const availableFilesMap = new Map<string, { fileName: string; filePath: string }>();
  const kDirs = [
    path.resolve(process.cwd(), "knowledge_data_vault", tenantId),
    process.cwd()
  ];
  if (tenantId !== "1") {
    kDirs.push(path.resolve(process.cwd(), "knowledge_data_vault", "1"));
  }
  for (const kDir of kDirs) {
    if (fs.existsSync(kDir)) {
      for (const f of fs.readdirSync(kDir)) {
        if (!f.startsWith('.')) {
          if (kDir === process.cwd() && !/\.(md|txt)$/i.test(f)) continue;
          availableFilesMap.set(f.toLowerCase(), { fileName: f, filePath: path.join(kDir, f) });
        }
      }
    }
  }

  if (isUsingFallback || !pool) {
    const meta = fallbackStore.louisAiKnowledgeMetadata || [];
    for (const m of meta) {
      if ((m.tenant_id === tenantId || m.tenant_id === '1') && !availableFilesMap.has(m.file_name.toLowerCase())) {
        availableFilesMap.set(m.file_name.toLowerCase(), { fileName: m.file_name, filePath: '' });
      }
    }
  } else {
    try {
      const res = await pool.query("SELECT file_name FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 OR tenant_id = '1'", [tenantId]);
      if (res && res.rows) {
        for (const row of res.rows) {
          const fn = String(row.file_name);
          if (!availableFilesMap.has(fn.toLowerCase())) {
            availableFilesMap.set(fn.toLowerCase(), { fileName: fn, filePath: '' });
          }
        }
      }
    } catch (_) {}
  }

  let targetMatchedFileName: string | null = null;
  let targetMatchedFilePath: string | null = null;

  for (const [lowerName, info] of availableFilesMap.entries()) {
    const nameWithoutExt = lowerName.replace(/\.[a-z0-9]+$/, '');
    const cleanLowerName = lowerName.replace(/[^a-z0-9]/g, ' ');
    const cleanNameWithoutExt = nameWithoutExt.replace(/[^a-z0-9]/g, ' ');
    const cleanQuery = normQuery.replace(/[^a-z0-9]/g, ' ');

    if (
      normQuery.includes(lowerName) || 
      normQuery.includes(nameWithoutExt) || 
      cleanQuery.includes(cleanNameWithoutExt) ||
      (nameWithoutExt.length >= 6 && cleanQuery.includes(cleanNameWithoutExt.slice(0, 12)))
    ) {
      targetMatchedFileName = info.fileName;
      targetMatchedFilePath = info.filePath;
      break;
    }
  }

  // Direkte Dateiauslesung: Wenn eine spezifische Datei angefragt wird oder im Query gematcht wurde
  if (targetMatchedFileName) {
    let diskPathToUse: string | null = null;
    if (targetMatchedFilePath && fs.existsSync(targetMatchedFilePath)) {
      diskPathToUse = targetMatchedFilePath;
    } else {
      const candidates = [
        path.resolve(process.cwd(), "knowledge_data_vault", tenantId, targetMatchedFileName),
        path.resolve(process.cwd(), "knowledge_data_vault", "1", targetMatchedFileName),
        path.resolve(process.cwd(), targetMatchedFileName)
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          diskPathToUse = cand;
          break;
        }
      }
    }

    if (diskPathToUse && fs.existsSync(diskPathToUse)) {
      try {
        const fileText = fs.readFileSync(diskPathToUse, 'utf-8');
        const maxLen = 15000;
        const truncatedText = fileText.length > maxLen
          ? fileText.slice(0, maxLen) + "\n... [Inhalt gekürzt auf maximal 15.000 Zeichen]"
          : fileText;

        return createToolSuccess({
          message: `[Wissensdatenbank - Direkter Dateitreffer: ${targetMatchedFileName}]\nDatei: ${path.basename(diskPathToUse)}\nVollständiger Datei-Inhalt:\n\n${truncatedText}`,
          direct_file_hit: targetMatchedFileName,
          file_name: targetMatchedFileName,
          file_content: truncatedText
        });
      } catch (readErr) {
        console.warn(`[LocalKnowledgeSearch] Fehler beim Auslesen von ${diskPathToUse}:`, readErr);
      }
    }

    // Falls die Datei nicht physikalisch vorliegt: Chunks aus DB oder fallbackStore zusammenfügen
    let fullChunkText = "";
    if (isUsingFallback || !pool) {
      const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
      const doc = metadata.find((m: LouisAiKnowledgeMetadata) => 
        (m.tenant_id === tenantId || m.tenant_id === '1') && 
        m.file_name.toLowerCase() === targetMatchedFileName!.toLowerCase()
      );
      if (doc) {
        const chunks = (fallbackStore.louisAiKnowledgeChunks || [])
          .filter((c: LouisAiKnowledgeChunk) => c.document_id === doc.id_uuid)
          .sort((a: LouisAiKnowledgeChunk, b: LouisAiKnowledgeChunk) => a.chunk_index - b.chunk_index);
        fullChunkText = chunks.map((c: LouisAiKnowledgeChunk) => c.chunk_text).join("\n\n");
      }
    } else {
      try {
        const res = await pool.query(
          `SELECT c.chunk_text 
           FROM sys_louis_ai_knowledge_chunks c
           JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
           WHERE (m.tenant_id = $1 OR m.tenant_id = '1') AND LOWER(m.file_name) = LOWER($2)
           ORDER BY c.chunk_index ASC`,
          [tenantId, targetMatchedFileName]
        );
        if (res.rows.length > 0) {
          fullChunkText = res.rows.map((row: { chunk_text: string }) => row.chunk_text).join("\n\n");
        }
      } catch (dbErr) {
        console.warn("[LocalKnowledgeSearch] DB Chunk aggregation failed:", dbErr);
      }
    }

    if (fullChunkText.trim().length > 0) {
      const maxLen = 15000;
      const truncatedText = fullChunkText.length > maxLen
        ? fullChunkText.slice(0, maxLen) + "\n... [Inhalt gekürzt auf maximal 15.000 Zeichen]"
        : fullChunkText;

      return createToolSuccess({
        message: `[Wissensdatenbank - Datei-Inhalt aus RAG-Chunks: ${targetMatchedFileName}]\nVollständiger Datei-Inhalt:\n\n${truncatedText}`,
        direct_file_hit: targetMatchedFileName,
        file_name: targetMatchedFileName,
        file_content: truncatedText
      });
    }
  }

  // 1. Context-Sensitive Entity Resolution
  let resolvedCompanyId: string | null = null;
  let resolvedContactId: string | null = null;
  let activeScope: 'company' | 'contact' | 'global' = 'global';
  let entityName = '';

  let comList: Company[] = [];
  let conList: Contact[] = [];
  if (isUsingFallback || !pool) {
    comList = fallbackStore.companies || [];
    conList = fallbackStore.contacts || [];
  } else {
    try {
      const dbComs = await pool.query("SELECT id_uuid, full_legal_name FROM core_registry_companies WHERE tenant_id = $1", [tenantId]);
      comList = dbComs.rows;
      const dbCons = await pool.query("SELECT id_uuid, full_legal_name, first_name, last_name FROM core_registry_contacts WHERE tenant_id = $1", [tenantId]);
      conList = dbCons.rows;
    } catch (e) {
      console.warn("DB lookup of registries for scope detection failed:", e);
    }
  }

  // Soft word-intersection heuristics for flexible entity recognition
  const getSignificantTerms = (name: string): string[] => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/g, "")
      .split(/[\s-]+/)
      .filter(w => w.length > 2 && !["gmbh", "corp", "co", "kg", "inc", "corporation", "ag", "gbr", "gmbh & co. kg", "company", "companies"].includes(w));
  };

  // Find if any company's name is mentioned in the query
  for (const c of comList) {
    const fullLegalName = c.full_legal_name || '';
    const comNameLower = fullLegalName.toLowerCase();
    
    // Fall A: Exakter Substring-Treffer
    if (comNameLower.length > 2 && normQuery.includes(comNameLower)) {
      resolvedCompanyId = c.id_uuid;
      activeScope = 'company';
      entityName = fullLegalName;
      break;
    }
    
    // Case B: All significant terms of the company are mentioned in the query
    const terms = getSignificantTerms(fullLegalName);
    if (terms.length > 0 && terms.every(t => normQuery.includes(t))) {
      resolvedCompanyId = c.id_uuid;
      activeScope = 'company';
      entityName = fullLegalName;
      break;
    }
  }

  // Same for contacts if no company match is present
  if (activeScope === 'global') {
    for (const c of conList) {
      const fallbackName = `${c.first_name || ''} ${c.last_name || ''}`;
      const conName = (c.full_legal_name || fallbackName).trim();
      const conNameLower = conName.toLowerCase();
      
      if (conNameLower.length > 2 && normQuery.includes(conNameLower)) {
        resolvedContactId = c.id_uuid;
        activeScope = 'contact';
        entityName = conName;
        break;
      }
      
      // Weiche Vorname-Nachname-Kombination
      const firstName = (c.first_name || '').toLowerCase().trim();
      const lastName = (c.last_name || '').toLowerCase().trim();
      if (firstName.length > 2 && lastName.length > 2 && normQuery.includes(firstName) && normQuery.includes(lastName)) {
        resolvedContactId = c.id_uuid;
        activeScope = 'contact';
        entityName = conName;
        break;
      }
    }
  }

  const containsCompanyKeyword = /unternehmen|firmen|firma|company|companies/i.test(normQuery);
  const containsContactKeyword = /kontakt|kontakte|ansprechpartner|mitarbeiter|person|contacts/i.test(normQuery);

  // Try dynamic embeddings first
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await generateEmbedding(query, tenantId);
  } catch (err) {
    console.warn("[LocalKnowledgeSearch] Active embedding generation failed, reverting to keyword similarity:", err);
  }

  // Helper for in-memory cosine similarity (Float32Array optimized)
  function getCosineSimilarity(A: number[], B: number[]): number {
    const len = Math.min(A.length, B.length);
    if (len === 0) return 0;
    const fA = new Float32Array(A);
    const fB = new Float32Array(B);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      const a = fA[i];
      const b = fB[i];
      dotProduct += a * b;
      normA += a * a;
      normB += b * b;
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  const stopWords = new Set([
    "der", "die", "das", "und", "ist", "ein", "eine", "einen", "einem", "einer", "eines", 
    "in", "im", "on", "at", "with", "mit", "von", "vom", "zu", "zur", "zum", "bei", "beim",
    "fuer", "für", "den", "dem", "des", "einigen", "einige", "aus", "nach", "vor", "hinter",
    "ueber", "über", "unter", "the", "and", "this", "that", "there", "their", "they", "we", "he", "she", "it",
    "was", "were", "been", "have", "has", "had", "are", "is", "am", "be", "do", "does", "did", "of", "to", "for", 
    "as", "by", "but"
  ]);

  const queryWords = normQuery
    .split(/[\s_.]+/)
    .map(w => w.replace(/[^a-z0-9äöüß-]/g, ""))
    .filter(w => (w.length > 2 || /^\d+$/.test(w)) && !stopWords.has(w));

  // Offline or Fallback representation using in-memory logic
  if (isUsingFallback || !pool) {
    const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
    const chunks = fallbackStore.louisAiKnowledgeChunks || [];
    
    // Filter metadata IDs based on scope & resolved entities (including global documents)
    const filteredMetadataIds = metadata
      .filter((m: LouisAiKnowledgeMetadata) => {
        if (m.tenant_id !== tenantId && m.tenant_id !== '1') return false;
        
        if (resolvedCompanyId) {
          return (m.scope === 'company' && m.associated_company_id === resolvedCompanyId) || m.scope === 'global';
        }
        if (resolvedContactId) {
          return (m.scope === 'contact' && m.associated_contact_id === resolvedContactId) || m.scope === 'global';
        }
        
        if (containsCompanyKeyword) {
          return m.scope === 'company' || m.scope === 'global';
        }
        if (containsContactKeyword) {
          return m.scope === 'contact' || m.scope === 'global';
        }
        
        return true; // Search all documents of the tenant
      })
      .map((m: LouisAiKnowledgeMetadata) => m.id_uuid);

    const relevantChunks = chunks.filter((c: LouisAiKnowledgeChunk) => 
      (c.tenant_id === tenantId || c.tenant_id === '1') && 
      (filteredMetadataIds.includes(c.document_id) || !c.document_id)
    );

    const scored = relevantChunks.map((chunk: LouisAiKnowledgeChunk) => {
      let similarityScore = 0;
      if (queryEmbedding) {
        let chunkVector: number[] | null = null;
        if (typeof chunk.embedding === "string") {
          try { chunkVector = JSON.parse(chunk.embedding); } catch(e) {}
        } else if (Array.isArray(chunk.embedding)) {
          chunkVector = chunk.embedding;
        }
        similarityScore = chunkVector ? getCosineSimilarity(queryEmbedding!, chunkVector) : 0;
      }

      let keywordScore = 0;
      const textLower = chunk.chunk_text.toLowerCase().replace(/\s+/g, " ");
      const doc = metadata.find((m: LouisAiKnowledgeMetadata) => m.id_uuid === chunk.document_id);
      const fileLower = doc ? (doc.file_name || "").toLowerCase().replace(/\s+/g, " ") : "";

      if (targetMatchedFileName && fileLower.includes(targetMatchedFileName.toLowerCase())) {
        keywordScore += 25;
      }

      for (const word of queryWords) {
        if (fileLower.includes(word)) {
          keywordScore += 4;
        }
        if (textLower.includes(word)) {
          const occurrences = (textLower.match(new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length;
          keywordScore += Math.min(occurrences * 1.0, 4);
        }
      }

      const fileLowerNorm = fileLower.replace(/[_\-\.]+/g, " ").replace(/\s+/g, " ");
      const textLowerNorm = textLower.replace(/[_\-\.]+/g, " ").replace(/\s+/g, " ");
      const cleanQueryPhrase = queryWords.join(" ");
      if (cleanQueryPhrase.length >= 2) {
        if (fileLowerNorm.includes(cleanQueryPhrase)) keywordScore += 8;
        if (textLowerNorm.includes(cleanQueryPhrase)) keywordScore += 5;
      }

      const normalizedKeywordScore = Math.min(keywordScore / 25.0, 1.0);
      const vectorScore = similarityScore;
      let totalScore = queryEmbedding
        ? (vectorScore * 0.7) + (normalizedKeywordScore * 0.3)
        : normalizedKeywordScore;

      // Soft boosting for matched entity scope documents (*1.2)
      let boost = 1.0;
      if (resolvedCompanyId && doc && doc.scope === 'company' && doc.associated_company_id === resolvedCompanyId) {
        boost = 1.2;
      } else if (resolvedContactId && doc && doc.scope === 'contact' && doc.associated_contact_id === resolvedContactId) {
        boost = 1.2;
      }
      totalScore *= boost;

      return { 
         chunk_text: chunk.chunk_text, 
         file_name: doc ? doc.file_name : "Wissensdatenbank", 
         totalScore 
      };
    })
    .filter(c => c.totalScore > 0.05)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

    if (scored.length === 0) {
      if (targetMatchedFileName) {
        const potentialDiskPath = targetMatchedFilePath || path.resolve(process.cwd(), "knowledge_data_vault", tenantId, targetMatchedFileName);
        const fallbackDiskPath = path.resolve(process.cwd(), "knowledge_data_vault", "1", targetMatchedFileName);
        const diskPathToUse = fs.existsSync(potentialDiskPath) ? potentialDiskPath : (fs.existsSync(fallbackDiskPath) ? fallbackDiskPath : null);

        if (diskPathToUse && fs.existsSync(diskPathToUse)) {
          try {
            const fileText = fs.readFileSync(diskPathToUse, 'utf-8');
            const maxLen = 4000;
            const truncatedText = fileText.length > maxLen ? fileText.slice(0, maxLen) + "\n... [Inhalt gekürzt]" : fileText;
            return createToolSuccess({
              message: `[Bestand der Wissensdatenbank - Direkter Dateitreffer: ${targetMatchedFileName}]\nDatei-Inhalt (${path.basename(diskPathToUse)}):\n\n${truncatedText}`,
              direct_file_hit: targetMatchedFileName
            });
          } catch (_) {}
        }
      }
      return createToolSuccess({
        message: `No matching local knowledge files or document chunks found${entityName ? ` for "${entityName}"` : ""}.`,
        results_count: 0
      });
    }

    const message = scored.map((c, i) => {
      const formatted = formatKnowledgeChunkForAiContext(c.file_name, i + 1, c.chunk_text, query);
      return `[Result ${i + 1}] (Relevance: ${c.totalScore.toFixed(1)}, File: ${formatted.file_name})\n${formatted.snippet}`;
    }).join("\n\n");

    return createToolSuccess({
      message,
      results_count: scored.length
    });
  }

  // Postgres MODE with Reciprocal Rank Fusion (RAG Hybrid Search: Vector + Full-Text)
  try {
    const hybridHits = await performHybridSearch(tenantId, {
      query,
      scope: activeScope !== 'global' ? activeScope : (containsCompanyKeyword ? 'company' : (containsContactKeyword ? 'contact' : 'all')),
      company_id: resolvedCompanyId || undefined,
      contact_id: resolvedContactId || undefined,
      limit: 5
    });

    if (hybridHits.length === 0) {
      if (targetMatchedFileName) {
        const potentialDiskPath = targetMatchedFilePath || path.resolve(process.cwd(), "knowledge_data_vault", tenantId, targetMatchedFileName);
        const fallbackDiskPath = path.resolve(process.cwd(), "knowledge_data_vault", "1", targetMatchedFileName);
        const diskPathToUse = fs.existsSync(potentialDiskPath) ? potentialDiskPath : (fs.existsSync(fallbackDiskPath) ? fallbackDiskPath : null);

        if (diskPathToUse && fs.existsSync(diskPathToUse)) {
          try {
            const fileText = fs.readFileSync(diskPathToUse, 'utf-8');
            const maxLen = 4000;
            const truncatedText = fileText.length > maxLen ? fileText.slice(0, maxLen) + "\n... [Inhalt gekürzt]" : fileText;
            return createToolSuccess({
              message: `[Bestand der Wissensdatenbank - Direkter Dateitreffer: ${targetMatchedFileName}]\nDatei-Inhalt (${path.basename(diskPathToUse)}):\n\n${truncatedText}`,
              direct_file_hit: targetMatchedFileName
            });
          } catch (_) {}
        }
      }
      return createToolSuccess({
        message: `No matching vector or text knowledge chunks found${entityName ? ` for "${entityName}"` : ""}.`,
        results_count: 0
      });
    }

    const message = hybridHits.map((c, i) => {
      const formatted = formatKnowledgeChunkForAiContext(c.file_name || 'Wissensdatenbank', i + 1, c.chunk_text, query);
      return `[Result ${i + 1}] (RRF-Score: ${c.rrf_score.toFixed(3)}, File: ${formatted.file_name})\n${formatted.snippet}`;
    }).join("\n\n");

    return createToolSuccess({
      message,
      results_count: hybridHits.length,
      hits: hybridHits
    });

  } catch (err) {
    console.warn("[LocalKnowledgeSearch] Postgres vector search failed, executing text override fallback:", err);
    try {
      let sqlText = `
        SELECT c.chunk_text, m.file_name, 0.5 as similarity 
        FROM sys_louis_ai_knowledge_chunks c
        JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
        WHERE c.tenant_id = $1 AND c.chunk_text ILIKE $2
      `;
      const plainQuery = `%${query.replace(/%/g, "")}%`;
      const paramsText: unknown[] = [tenantId, plainQuery];

      if (resolvedCompanyId) {
        sqlText += ` AND ( (m.scope = 'company' AND m.associated_company_id = $3) OR m.scope = 'global' )`;
        paramsText.push(resolvedCompanyId);
      } else if (resolvedContactId) {
        sqlText += ` AND ( (m.scope = 'contact' AND m.associated_contact_id = $3) OR m.scope = 'global' )`;
        paramsText.push(resolvedContactId);
      }

      sqlText += " LIMIT 5";
      const resText = await pool.query(sqlText, paramsText);
      if (resText.rows.length > 0) {
        const message = resText.rows.map((row: unknown, i: number) => {
          const r = row as { file_name?: string; chunk_text: string };
          const formatted = formatKnowledgeChunkForAiContext(r.file_name || 'Wissensdatenbank', i + 1, r.chunk_text, query);
          return `[Result ${i + 1}] (Keyword MatchFallback, File: ${formatted.file_name})\n${formatted.snippet}`;
        }).join("\n\n");
        return createToolSuccess({
          message,
          results_count: resText.rows.length
        });
      }
    } catch (e) {}
    return createToolError(`Local database knowledge query failed: ${(err as Error).message}`);
  }
}

/**
 * Tool 5: Custom Tool Learning (Persist a reusable workflow recipe)
 */
export async function learnWorkflow(
  tenantId: string, 
  name: string, 
  description: string, 
  toolChain: { tool: string; instruction: string }[], 
  created_by_identity: string = "ai_assistant",
  trigger_type: 'MANUAL' | 'CRM_EVENT' | 'TIMER' = "MANUAL",
  trigger_config: Record<string, unknown> | null = null,
  is_active: boolean = true,
  id_uuid?: string,
  direct_send_email: boolean = false,
  dag_structure: Record<string, unknown> | null = null,
  skill_description?: string,
  skill_tags?: string[],
  skill_category?: string
): Promise<CustomWorkflow> {
  const final_id = id_uuid || uuidv4();

  // DAG ist der einzige Workflow-Pfad.
  // Fehlt eine dag_structure, wird sie automatisch aus der linearen Sequenz erzeugt
  // (Kette) — so laufen NEUE Workflows IMMER über die DAG-Engine (Abwärtskompatibilität:
  // bestehende dag_structure wird nie überschrieben, tool_chain_sequence bleibt erhalten).
  let finalDag = dag_structure;
  if (!finalDag && Array.isArray(toolChain) && toolChain.length > 0) {
    const nodes = toolChain.map((step, i) => ({
      node_id: `step_${i + 1}`,
      name: String(step?.tool || `Schritt ${i + 1}`),
      type: "ACTION",
      tool_identifier: String(step?.tool || ""),
      instructions_template: String(step?.instruction || ""),
      next_node_ids: i < toolChain.length - 1 ? [`step_${i + 2}`] : []
    }));
    finalDag = {
      workflow_id: final_id,
      title: name || "Workflow",
      is_active: true,
      start_node_id: nodes.length > 0 ? nodes[0].node_id : "",
      nodes
    } as Record<string, unknown>;
  }
  
  // Dual write system: Always write to local fallback first to ensure no data loss during container migrations
  if (!fallbackStore.customWorkflows) {
    fallbackStore.customWorkflows = [];
  }
  const record = {
    id_uuid: final_id,
    tenant_id: tenantId,
    workflow_name: name,
    workflow_description: description,
    tool_chain_sequence: toolChain,
    trigger_type,
    trigger_config,
    is_active,
    direct_send_email,
    created_by_identity,
    dag_structure: finalDag,
    skill_description: skill_description || "",
    skill_tags: skill_tags || [],
    skill_category: skill_category || null,
    created_at_utc: new Date().toISOString(),
    updated_at_utc: new Date().toISOString()
  };

  // Synchronise or replace same duplicate workflow if newly proposed
  fallbackStore.customWorkflows = fallbackStore.customWorkflows.filter(
    (w: CustomWorkflow) => !(w.tenant_id === tenantId && w.workflow_name === name)
  );
  fallbackStore.customWorkflows.push(record);
  
  // Save fallback store atomic instantly
  saveFallbackStore();

  if (!isUsingFallback) {
    // Postgres synchronization
    try {
 // 4C (T8): Versionierung — skill_version +1 bei Update statt fix 1,
      // version_history (Changelog) mit letztem Stand führen.
      // Bestehenden Stand lesen (nur bei Update-Fall nötig)
      let prevVersion = 0;
      let prevHistory: Array<Record<string, unknown>> = [];
      try {
        const existing = await pool.query(
          "SELECT skill_version, version_history FROM sys_louis_ai_custom_workflows WHERE tenant_id = $1 AND workflow_name = $2",
          [tenantId, name]
        );
        if (existing.rows.length > 0) {
          prevVersion = Number(existing.rows[0].skill_version) || 0;
          const rawHist = existing.rows[0].version_history;
          if (Array.isArray(rawHist)) prevHistory = rawHist as Array<Record<string, unknown>>;
          else if (typeof rawHist === "string") {
            try { prevHistory = JSON.parse(rawHist) as Array<Record<string, unknown>>; } catch { prevHistory = []; }
          }
        }
      } catch { /* kein Bestand */ }

      const historyEntry = {
        version: prevVersion,
        changed_at_utc: new Date().toISOString(),
        tool_chain_sequence: toolChain,
        dag_structure: finalDag || null,
        trigger_config: trigger_config || null,
        actor: created_by_identity
      };
      const newHistory = [...prevHistory, historyEntry];

      await pool.query(`
        INSERT INTO sys_louis_ai_custom_workflows (id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence, trigger_type, trigger_config, is_active, created_by_identity, direct_send_email, dag_structure, skill_description, skill_tags, skill_version, skill_category, skill_pitfalls, version_history)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, $14, '[]'::jsonb, $15::jsonb)
        ON CONFLICT (tenant_id, workflow_name)
        DO UPDATE SET workflow_description = EXCLUDED.workflow_description, tool_chain_sequence = EXCLUDED.tool_chain_sequence, trigger_type = EXCLUDED.trigger_type, trigger_config = EXCLUDED.trigger_config, is_active = EXCLUDED.is_active, created_by_identity = EXCLUDED.created_by_identity, direct_send_email = EXCLUDED.direct_send_email, dag_structure = EXCLUDED.dag_structure, skill_description = EXCLUDED.skill_description, skill_tags = EXCLUDED.skill_tags, skill_version = COALESCE(sys_louis_ai_custom_workflows.skill_version, 0) + 1, skill_category = EXCLUDED.skill_category, version_history = EXCLUDED.version_history, updated_at_utc = CURRENT_TIMESTAMP
      `, [final_id, tenantId, name, description, JSON.stringify(toolChain), trigger_type, trigger_config ? JSON.stringify(trigger_config) : null, is_active, created_by_identity, direct_send_email, finalDag ? JSON.stringify(finalDag) : null, skill_description || "", JSON.stringify(skill_tags || []), skill_category || null, JSON.stringify(newHistory)]);
    } catch (err) {
      console.warn("Postgres synchronization failed in learnWorkflow, fallback store used:", err);
    }
  }

  return record;
}

/**
 * Auto-healing helper to mend workflows created via Telegram / falling back improperly
 */
async function healWorkflows(tenantId: string, workflows: unknown[]): Promise<unknown[]> {
  let changed = false;
  const healed: unknown[] = [];
  for (const rawW of workflows) {
    if (!rawW) continue;
    const w = rawW as Record<string, unknown>;

    // Guarantee that serialized string fields are correctly parsed into nested JS array/objects
    if (typeof w.tool_chain_sequence === "string") {
      try {
        w.tool_chain_sequence = JSON.parse(w.tool_chain_sequence);
      } catch (err) {
        console.warn("[healWorkflows] Failed to parse tool_chain_sequence string JSON representation", err);
      }
    }
    if (typeof w.trigger_config === "string") {
      try {
        w.trigger_config = JSON.parse(w.trigger_config);
      } catch (err) {
        console.warn("[healWorkflows] Failed to parse trigger_config string JSON representation", err);
      }
    }
    if (typeof w.dag_structure === "string") {
      try {
        w.dag_structure = JSON.parse(w.dag_structure);
      } catch (err) {
        console.warn("[healWorkflows] Failed to parse dag_structure string JSON representation", err);
      }
    }

    const isFaultyName = w.workflow_name === "Automated AI Recipe";
    const hasJsonDesc = typeof w.workflow_description === 'string' && w.workflow_description.trim().startsWith('{');
    
    if (isFaultyName || hasJsonDesc) {
      try {
        let descStr = (w.workflow_description as string || "").trim();
        // Strip markdown backticks if any
        if (descStr.startsWith("```")) {
          descStr = descStr.replace(/^```[a-zA-Z0-9]*\s*/, "");
          descStr = descStr.replace(/\s*```$/, "");
        }
        descStr = descStr.trim();
        const parsed = JSON.parse(descStr);
        if (parsed && typeof parsed === 'object' && (parsed.workflow_name || parsed.name)) {
          w.workflow_name = parsed.workflow_name || parsed.name || w.workflow_name;
          w.workflow_description = parsed.workflow_description || parsed.description || w.workflow_description;
          w.trigger_type = parsed.trigger_type || w.trigger_type || "MANUAL";
          w.trigger_config = parsed.trigger_config || w.trigger_config || null;
          w.direct_send_email = parsed.direct_send_email !== undefined ? !!parsed.direct_send_email : !!w.direct_send_email;
          
          let seq = parsed.tool_chain_sequence || parsed.tool_chain || parsed.sequence || [];
          if (Array.isArray(seq) && seq.length > 0) {
            w.tool_chain_sequence = seq.map((step: unknown) => {
              if (step && typeof step === 'object') {
                const sObj = step as Record<string, unknown>;
                return {
                  tool: String(sObj.tool || "crm_data_analyst"),
                  instruction: String(sObj.instruction || sObj.description || "")
                };
              }
              return { tool: "crm_data_analyst", instruction: String(step) };
            });
          }
          
          changed = true;
          // Persist the healed workflow to PostgreSQL if not using fallback
          if (!isUsingFallback && pool) {
            try {
              await pool.query(`
                UPDATE sys_louis_ai_custom_workflows
                SET workflow_name = $1, workflow_description = $2, tool_chain_sequence = $3, trigger_type = $4, trigger_config = $5, direct_send_email = $6, skill_description = COALESCE(skill_description, ''), skill_tags = COALESCE(skill_tags, '[]'::jsonb), skill_category = skill_category, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $7 AND tenant_id = $8
              `, [
                w.workflow_name,
                w.workflow_description,
                JSON.stringify(w.tool_chain_sequence),
                w.trigger_type,
                w.trigger_config ? JSON.stringify(w.trigger_config) : null,
                w.direct_send_email,
                w.id_uuid,
                tenantId
              ]);
            } catch (err) {
              console.warn("Postgres heal sync failed:", err);
            }
          }
        }
      } catch (err) {
        // Not valid JSON or can't be healed, leave it
      }
    }
    healed.push(w);
  }
  if (changed) {
    if (fallbackStore.customWorkflows) {
      // Sync fallback store
      for (const rawW of healed) {
        const w = rawW as Record<string, unknown>;
        const idx = fallbackStore.customWorkflows.findIndex((local: CustomWorkflow) => local.id_uuid === w.id_uuid);
        if (idx >= 0) {
          fallbackStore.customWorkflows[idx] = { ...fallbackStore.customWorkflows[idx], ...w };
        }
      }
      saveFallbackStore();
    }
  }
  return healed;
}

/**
 * Tool 6: Get Learned Workflows List
 */
export async function getLearnedWorkflows(tenantId: string): Promise<CustomWorkflow[]> {
  if (isUsingFallback) {
    const list = (fallbackStore.customWorkflows || []).filter((w: CustomWorkflow) => w.tenant_id === tenantId);
    return (await healWorkflows(tenantId, list)) as CustomWorkflow[];
  }

  try {
    const result = await pool.query("SELECT id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence, trigger_type, trigger_config, is_active, direct_send_email, created_by_identity, dag_structure, skill_description, skill_tags, skill_version, skill_category, skill_pitfalls, created_at_utc, updated_at_utc FROM sys_louis_ai_custom_workflows WHERE tenant_id = $1", [tenantId]);
    
    // Auto-recovery / Dual Database Symmetrie:
    // If PostgreSQL has 0 rows, but we find workflows in our local fallback store, sync them into PG
    if (result.rows.length === 0 && fallbackStore.customWorkflows && fallbackStore.customWorkflows.length > 0) {
      const locals = fallbackStore.customWorkflows.filter((w: CustomWorkflow) => w.tenant_id === tenantId);
      if (locals.length > 0) {
        for (const local of locals) {
          try {
            await pool.query(`
              INSERT INTO sys_louis_ai_custom_workflows (id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence, trigger_type, trigger_config, is_active, direct_send_email, dag_structure, skill_description, skill_tags, skill_version, skill_category, skill_pitfalls)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, $13, '[]'::jsonb)
              ON CONFLICT (tenant_id, workflow_name) DO NOTHING
            `, [
              local.id_uuid, 
              local.tenant_id, 
              local.workflow_name, 
              local.workflow_description, 
              JSON.stringify(local.tool_chain_sequence),
              local.trigger_type || 'MANUAL',
              local.trigger_config ? JSON.stringify(local.trigger_config) : null,
              local.is_active !== undefined ? local.is_active : true,
              local.direct_send_email !== undefined ? local.direct_send_email : false,
              local.dag_structure ? JSON.stringify(local.dag_structure) : null,
              (local as CustomWorkflow & { skill_description?: string }).skill_description || "",
              JSON.stringify((local as CustomWorkflow & { skill_tags?: string[] }).skill_tags || []),
              (local as CustomWorkflow & { skill_category?: string }).skill_category || null
            ]);
          } catch (e) {
            console.warn("Failed background Postgres sync of custom workflow", e);
          }
        }
        const localsHealed = await healWorkflows(tenantId, locals);
        return localsHealed as CustomWorkflow[];
      }
    }
    const dbHealed = await healWorkflows(tenantId, result.rows);
    return dbHealed as CustomWorkflow[];
  } catch (err) {
    console.warn("Postgres query failed in getLearnedWorkflows, falling back to local fallbackStore:", err);
    return (fallbackStore.customWorkflows || []).filter((w: CustomWorkflow) => w.tenant_id === tenantId);
  }
}

/**
 * Tool 7: Delete Learned Workflow
 */
export async function deleteWorkflow(tenantId: string, id_uuid: string): Promise<boolean> {
  // Always delete from local fallback first
  let fallbackUpdated = false;
  if (!fallbackStore.customWorkflows) {
    fallbackStore.customWorkflows = [];
  }
  const initialLen = fallbackStore.customWorkflows.length;
  fallbackStore.customWorkflows = fallbackStore.customWorkflows.filter(
    (w: CustomWorkflow) => !(w.id_uuid === id_uuid && w.tenant_id === tenantId)
  );
  if (fallbackStore.customWorkflows.length < initialLen) {
    fallbackUpdated = true;
    saveFallbackStore();
  }

  let dbDeleted = false;
  if (!isUsingFallback) {
    try {
      const result = await pool.query(
        "DELETE FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2",
        [id_uuid, tenantId]
      );
      if (result.rowCount !== null && result.rowCount > 0) {
        dbDeleted = true;
      }
    } catch (err) {
      console.warn("Postgres deletion failed in deleteWorkflow, fallback data was updated:", err);
    }
  }

  return fallbackUpdated || dbDeleted;
}

interface WorkflowStepArgs {
  tool?: string;
  instruction?: string;
  description?: string;
}

interface WorkflowArgs {
  workflow_name?: string;
  name?: string;
  workflow_description?: string;
  description?: string;
  tool_chain_sequence?: WorkflowStepArgs[];
  tool_chain?: WorkflowStepArgs[];
  sequence?: WorkflowStepArgs[];
  trigger_type?: 'MANUAL' | 'CRM_EVENT' | 'TIMER';
  trigger_config?: Record<string, unknown> | null;
  direct_send_email?: boolean;
  is_active?: boolean;
  skill_description?: string;
  skill_tags?: string[];
  skill_category?: string;
}

export async function executeLearnWorkflow(
  tenantId: string,
  argsStr: string,
  actor: string = "ai_assistant"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: WorkflowArgs | null = null;
    let cleanedArgsStr = (argsStr || "").trim();
    if (cleanedArgsStr.startsWith("```")) {
      cleanedArgsStr = cleanedArgsStr.replace(/^```[a-zA-Z0-9]*\s*/, "");
      cleanedArgsStr = cleanedArgsStr.replace(/\s*```$/, "");
    }
    cleanedArgsStr = cleanedArgsStr.trim();

    try {
      rawArgs = JSON.parse(cleanedArgsStr) as WorkflowArgs;
    } catch {
      // Fallback if the AI passes unstructured string
      const fallbackName = "Automated AI Recipe";
      const fallbackDesc = argsStr;
      const fallbackSeq = [{ tool: "crm_data_analyst", instruction: argsStr }];
      const res = await learnWorkflow(tenantId, fallbackName, fallbackDesc, fallbackSeq, actor, "MANUAL", null);
      return createToolSuccess({
        message: `Workflow "${fallbackName}" wurde erfolgreich gelernt/gespeichert.`,
        workflow: res
      });
    }

    if (!rawArgs || typeof rawArgs !== "object") {
      const fallbackName = "Automated AI Recipe";
      const fallbackDesc = argsStr;
      const fallbackSeq = [{ tool: "crm_data_analyst", instruction: argsStr }];
      const res = await learnWorkflow(tenantId, fallbackName, fallbackDesc, fallbackSeq, actor, "MANUAL", null);
      return createToolSuccess({
        message: `Workflow "${fallbackName}" wurde erfolgreich gelernt/gespeichert.`,
        workflow: res
      });
    }

    const name = rawArgs.workflow_name || rawArgs.name || "Automated AI Recipe";
    const description = rawArgs.workflow_description || rawArgs.description || name;
    
    // Parse tool chain sequence
    const toolChain: { tool: string; instruction: string }[] = [];
    const seq = rawArgs.tool_chain_sequence || rawArgs.tool_chain || rawArgs.sequence || [];
    if (Array.isArray(seq) && seq.length > 0) {
      for (const step of seq) {
        if (step && typeof step === "object") {
          const tool = step.tool || "crm_data_analyst";
          const rawInst = step.instruction || step.description || "";
          
          // Clean the instruction: remove prefixes like "Schritt X:", "Step X:", "1.", etc., or system directive patterns.
          let cleanedInst = rawInst.trim();
          
          // Helper string cleanups to remove potential leading step markers
          cleanedInst = cleanedInst.replace(/^(Schritt\s+\d+|Step\s+\d+|\d+\.)\s*:\s*/i, "");
          
          toolChain.push({
            tool,
            instruction: cleanedInst
          });
        }
      }
    }

    if (toolChain.length === 0) {
      toolChain.push({
        tool: "crm_data_analyst",
        instruction: description
      });
    }

    const trigger_type = rawArgs.trigger_type || "MANUAL";
    const trigger_config = rawArgs.trigger_config || null;
    const direct_send_email = !!rawArgs.direct_send_email;
    const is_active = rawArgs.is_active !== undefined ? !!rawArgs.is_active : true;
    const skill_description = rawArgs.skill_description || "";
    const skill_tags = rawArgs.skill_tags || [];
    const skill_category = rawArgs.skill_category || null;

    const res = await learnWorkflow(
      tenantId,
      name,
      description,
      toolChain,
      actor,
      trigger_type,
      trigger_config,
      is_active,
      undefined,
      direct_send_email,
      undefined,
      skill_description,
      skill_tags,
      skill_category
    );

    // S5: Embedding-Generierung best-effort NACH erfolgreichem Save (Fehler → Feld bleibt NULL → Keyword-Fallback)
    try {
      const embeddingText = [skill_description, description, name].filter(Boolean).join(" | ");
      if (embeddingText.trim().length > 0) {
        const embedding = await generateEmbedding(embeddingText, tenantId);
        if (embedding && embedding.length > 0) {
          const vectorLiteral = formatVectorForPostgres(embedding);
          if (isUsingFallback || !pool) {
            const idx = fallbackStore.customWorkflows?.findIndex((w: CustomWorkflow) => w.id_uuid === res.id_uuid);
            if (idx !== undefined && idx >= 0 && fallbackStore.customWorkflows) {
              (fallbackStore.customWorkflows[idx] as CustomWorkflow & { skill_embedding?: unknown }).skill_embedding = embedding;
              saveFallbackStore();
            }
          } else {
            await pool.query(
              "UPDATE sys_louis_ai_custom_workflows SET skill_embedding = $2::vector WHERE id_uuid = $1",
              [res.id_uuid, vectorLiteral]
            );
          }
        }
      }
    } catch (err) {
      console.warn("[learnWorkflow] Embedding-Generierung fehlgeschlagen (Keyword-Fallback aktiv):", err);
    }

    return createToolSuccess({
      message: `Workflow "${name}" wurde erfolgreich gelernt/gespeichert.`,
      workflow: res
    });
  } catch (err) {
    return createToolError(`Fehler beim Erstellen des Workflows: ${(err as Error).message}`);
  }
}

// ============================================================================
// S5 TEIL B: Skill-Retrieval (pgvector + Keyword-Fallback)
// ============================================================================

/**
 * S6: Hängt einen Pitfall an einen Workflow-Skill an (dedupliziert, case-insensitiv).
 * KEIN blindes `skill_pitfalls || $2::jsonb` — JSONB-|| würde Duplikate erzeugen.
 */
export async function appendSkillPitfall(tenantId: string, workflowIdUuid: string, pitfall: string): Promise<ToolResult<{ success: boolean }>> {
  try {
    const dedupe = (list: unknown[]): string[] => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const p of list) {
        const key = String(p).trim().toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(String(p));
        }
      }
      return out;
    };

    if (isUsingFallback || !pool) {
      const wf = (fallbackStore.customWorkflows || []).find((w) => w.id_uuid === workflowIdUuid);
      if (!wf) return createToolError(`Workflow ${workflowIdUuid} nicht gefunden`);
      const wfWithPitfalls = wf as CustomWorkflow & { skill_pitfalls?: unknown };
      const current = Array.isArray(wfWithPitfalls.skill_pitfalls) ? (wfWithPitfalls.skill_pitfalls as unknown[]) : [];
      wfWithPitfalls.skill_pitfalls = dedupe([...current, pitfall]);
      saveFallbackStore();
    } else {
      const res = await pool.query(
        `SELECT skill_pitfalls FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [workflowIdUuid, tenantId]
      );
      if (res.rows.length === 0) return createToolError(`Workflow ${workflowIdUuid} nicht gefunden`);
      const current = Array.isArray(res.rows[0].skill_pitfalls) ? (res.rows[0].skill_pitfalls as unknown[]) : [];
      const merged = dedupe([...current, pitfall]);
      await pool.query(
        `UPDATE sys_louis_ai_custom_workflows SET skill_pitfalls = $2::jsonb, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $3 OR tenant_id = '1')`,
        [workflowIdUuid, JSON.stringify(merged), tenantId]
      );
    }

    await logAuditEvent({ tenantId, eventType: "UPDATE", entityType: "WORKFLOW", eventDetails: `Pitfall ergänzt: ${pitfall}`, actorIdentity: "agentRuntime" });
    return createToolSuccess({ success: true });
  } catch (err) {
    return createToolError(`Pitfall konnte nicht ergänzt werden: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function searchRelevantSkills(
  tenantId: string,
  userMessage: string,
  topK: number = 5
): Promise<Array<{ id_uuid: string; workflow_name: string; workflow_description: string; skill_description: string; score: number }>> {
  const clampedK = Math.min(Math.max(topK, 1), 10);
  const skillDescOf = (w: CustomWorkflow): string => String((w as CustomWorkflow & { skill_description?: string }).skill_description || "");

  try {
    if (isUsingFallback || !pool) {
      const workflows = fallbackStore.customWorkflows || [];
      const term = userMessage.toLowerCase().trim();
      const scored = workflows
        .filter((w: CustomWorkflow) => w.tenant_id === tenantId || w.tenant_id === "1")
        .map((w: CustomWorkflow) => {
          const name = String(w.workflow_name || "").toLowerCase();
          const skillDesc = skillDescOf(w).toLowerCase();
          const wfDesc = String(w.workflow_description || "").toLowerCase();
          let score = 0;
          if (name.includes(term)) score += 3;
          if (skillDesc.includes(term)) score += 2;
          if (wfDesc.includes(term)) score += 1;
          return { w, score };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, clampedK);
      return scored.map((x) => ({
        id_uuid: x.w.id_uuid,
        workflow_name: x.w.workflow_name,
        workflow_description: x.w.workflow_description || "",
        skill_description: skillDescOf(x.w),
        score: x.score
      }));
    }

    // PG-Branch: Embedding-Suche (best-effort), sonst Keyword-Fallback
    let embedding: number[] | null = null;
    try {
      const emb = await generateEmbedding(userMessage, tenantId);
      if (emb && emb.length > 0) embedding = emb;
    } catch {
      embedding = null;
    }

    if (embedding) {
      const vectorLiteral = formatVectorForPostgres(embedding);
      const res = await pool.query(
        `SELECT id_uuid, workflow_name, workflow_description, skill_description, 1 - (skill_embedding <=> $1) AS score
         FROM sys_louis_ai_custom_workflows
         WHERE (tenant_id = $2 OR tenant_id = '1') AND skill_embedding IS NOT NULL
         ORDER BY skill_embedding <=> $1
         LIMIT $3`,
        [vectorLiteral, tenantId, clampedK]
      );
      return res.rows.map((row) => ({
        id_uuid: String(row.id_uuid),
        workflow_name: String(row.workflow_name || ""),
        workflow_description: String(row.workflow_description || ""),
        skill_description: String(row.skill_description || ""),
        score: Number(row.score || 0)
      }));
    }

    const res = await pool.query(
      `SELECT id_uuid, workflow_name, workflow_description, skill_description, 1 AS score
       FROM sys_louis_ai_custom_workflows
       WHERE (tenant_id = $2 OR tenant_id = '1')
         AND (skill_description ILIKE '%' || $1 || '%' OR workflow_description ILIKE '%' || $1 || '%' OR workflow_name ILIKE '%' || $1 || '%')
       LIMIT $3`,
      [userMessage, tenantId, clampedK]
    );
    return res.rows.map((row) => ({
      id_uuid: String(row.id_uuid),
      workflow_name: String(row.workflow_name || ""),
      workflow_description: String(row.workflow_description || ""),
      skill_description: String(row.skill_description || ""),
      score: Number(row.score || 0)
    }));
  } catch (err) {
    console.warn("[searchRelevantSkills] Fehler (leeres Ergebnis, Pipeline bricht nicht):", err);
    return [];
  }
}

// ============================================================================
// S5 TEIL A: Workflow-Makro-Ausführung (executeWorkflowMacro)
// ============================================================================

// Tool-Aliase des workflowExecutor (workflowExecutor.ts Z. 345–355, 432–438, 597, 603, 609–640)
const KNOWN_EXECUTOR_TOOL_ALIASES = new Set<string>([
  'SendEmail', 'EmailClient', 'EmailDraft', 'executeSendSmtpEmail', 'executeSendEmail',
  'AddLabel', 'UpdateContactLabels', 'executeAddLabel', 'executeUpdateContactLabels',
  'CreateEntityNote', 'AddNote', 'executeCreateEntityNote', 'executeAddNote',
  'executeWait', 'wait', 'delay', 'executeDelay'
]);

/**
 * Prüft jeden Schritt der tool_chain_sequence gegen bekannte Tool-Namen.
 * workflowExecutor behandelt unbekannte Schritt-Tools STILL als COMPLETED — ohne Validierung
 * würde der S6-Pitfall-Loop bei ungültigen Workflows nie greifen. Rückgabe: erster unbekannter Tool-Name oder null.
 */
async function validateWorkflowTools(tenantId: string, steps: Array<{ tool?: string; instruction?: string }>): Promise<string | null> {
  if (!steps || steps.length === 0) return null;
  const known = new Set<string>();
  try {
    // Dynamischer Import bricht den zirkulären Import (agentRuntime → tools.js → knowledge.ts)
    const { SYSTEM_TOOL_CATALOG, INTERNAL_VAULT_TOOL_ALIASES } = await import("../agentRuntime.js");
    for (const t of SYSTEM_TOOL_CATALOG) known.add(t.name);
 // P1: alte vault_*-Alias-Namen aus dem Katalog sind nicht mehr primär,
    // bleiben aber als Workflow-Schritt-Tools gültig (Abwärtskompatibilität).
    if (INTERNAL_VAULT_TOOL_ALIASES) {
      for (const alias of INTERNAL_VAULT_TOOL_ALIASES) known.add(alias);
    }
  } catch {
    // Katalog nicht ladbar — Validierung stützt sich dann auf MCP-Tools + Executor-Aliase
  }
  try {
    const mcpTools = await McpClientEngine.listToolsForLouis(tenantId, null);
    for (const t of mcpTools) known.add(t.normalized_tool_name);
  } catch {
    // MCP-Liste nicht ladbar — ignorieren
  }
  for (const step of steps) {
    const tool = String(step.tool || "").trim();
    if (!tool) continue;
    if (known.has(tool)) continue;
    if (tool.startsWith("workflow_")) continue;
    if (tool.startsWith("execute") || KNOWN_EXECUTOR_TOOL_ALIASES.has(tool)) continue;
    return tool;
  }
  return null;
}

interface MacroInstanceView {
  status?: string;
  execution_log?: Array<Record<string, unknown>>;
  node_results?: Record<string, Record<string, unknown>> | null;
}

async function getRunningWorkflowInstanceId(tenantId: string, workflowId: string): Promise<string | null> {
  if (isUsingFallback || !pool) {
    const inst = (fallbackStore.workflowInstances || []).find(
      (i) => i.tenant_id === tenantId && i.workflow_id === workflowId && (i.status === "RUNNING" || i.status === "PENDING_DELAY")
    );
    return inst?.id_uuid || null;
  }
  const res = await pool.query(
    `SELECT id_uuid FROM sys_louis_ai_workflow_instances WHERE tenant_id = $1 AND workflow_id = $2 AND status IN ('RUNNING','PENDING_DELAY') LIMIT 1`,
    [tenantId, workflowId]
  );
  return res.rows.length > 0 ? String(res.rows[0].id_uuid) : null;
}

async function loadWorkflowInstance(tenantId: string, instanceId: string): Promise<MacroInstanceView | null> {
  if (isUsingFallback || !pool) {
    const inst = (fallbackStore.workflowInstances || []).find((i) => i.id_uuid === instanceId);
    if (!inst) return null;
    return {
      status: inst.status,
      execution_log: inst.execution_log as unknown as Array<Record<string, unknown>>,
      node_results: inst.node_results || null
    };
  }
  const res = await pool.query(
    `SELECT status, execution_log, node_results FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1`,
    [instanceId]
  );
  if (res.rows.length === 0) return null;
  const row = res.rows[0];
  return {
    status: String(row.status || ""),
    execution_log: (typeof row.execution_log === "string" ? JSON.parse(row.execution_log) : row.execution_log) as Array<Record<string, unknown>>,
    node_results: typeof row.node_results === "string" ? JSON.parse(row.node_results) : (row.node_results || null)
  };
}

async function markWorkflowInstanceFailed(tenantId: string, instanceId: string): Promise<void> {
  if (isUsingFallback || !pool) {
    const inst = (fallbackStore.workflowInstances || []).find((i) => i.id_uuid === instanceId);
    if (inst) {
      inst.status = "FAILED";
      saveFallbackStore();
    }
    return;
  }
  await pool.query(
    `UPDATE sys_louis_ai_workflow_instances SET status = 'FAILED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1`,
    [instanceId]
  );
}

/** Deterministische Status-Ableitung: Fehler-Felder des workflowExecutor (mailing_error, label_error, note_error, tool_error, 'Kritischer Abbruch') */
function stepFailed(logEntry: Record<string, unknown>): boolean {
  const errFields = ["mailing_error", "label_error", "note_error", "tool_error"];
  for (const f of errFields) {
    const v = logEntry[f];
    if (v !== undefined && v !== null && String(v).trim() !== "" && String(v) !== "null") return true;
  }
  const details = String(logEntry.details || "");
  const mailStatus = String(logEntry.mailing_status || "");
  return details.includes("Kritischer Abbruch") || mailStatus.includes("Kritischer Abbruch");
}

function deriveWorkflowRunOutcome(wf: CustomWorkflow, inst: MacroInstanceView | null): WorkflowRunOutcome {
  const totalSteps = Array.isArray(wf.tool_chain_sequence) ? wf.tool_chain_sequence.length : 0;
  const logs = inst?.execution_log || [];
  const stepsExecuted: Array<{ tool: string; status: "completed" | "failed" }> = logs
    .filter((l) => l.step_index !== undefined && l.step_index !== null)
    .map((l) => ({
      tool: String(l.tool || l.step || ""),
      status: stepFailed(l) ? ("failed" as const) : ("completed" as const)
    }));
  const hasFailedSteps = stepsExecuted.some((s) => s.status === "failed");
  const failed = inst?.status === "FAILED" || hasFailedSteps;

  const finalResultSummary: WorkflowStepResult[] = [];
  const nodeResults = inst?.node_results;
  if (nodeResults && typeof nodeResults === "object") {
    for (const [key, val] of Object.entries(nodeResults)) {
      finalResultSummary.push({ stepIndex: finalResultSummary.length, tool: key, result: val });
    }
  }

  return {
    status: failed ? "failed" : "success",
    workflowName: wf.workflow_name,
    totalSteps,
    stepsExecuted,
    finalResultSummary
  };
}

/**
 * S5 TEIL A: Führt ein gelerntes Workflow-Makro (workflow_<name>) echt aus.
 * Tool-Validierung + RUNNING-Check vor dem Lauf; Outcome wird deterministisch aus der Instanz abgeleitet.
 */
export async function executeWorkflowMacro(tenantId: string, toolName: string, argsStr: string): Promise<ToolResult<WorkflowRunOutcome>> {
  try {
    const workflows = await getLearnedWorkflows(tenantId);
    const toolSuffix = toolName.startsWith("workflow_") ? toolName.slice("workflow_".length) : toolName;
    const wf = workflows.find((w) => w.workflow_name === toolSuffix)
      || workflows.find((w) => w.workflow_name.replace(/[^a-zA-Z0-9_]/g, "_") === toolSuffix);
    if (!wf) {
      return createToolError(`Unbekannter Workflow: ${toolSuffix}`);
    }

    // S8-Governance-Hook (Workflow-Ausführung; kein Seed → Default ALLOW)
    const gov = await evaluateGovernanceRules(tenantId, "workflow", "EXECUTE");
    const govEffect = gov.effect;
    const govNote = gov.note;
    if (govEffect === "BLOCK") {
      await logAuditEvent({ tenantId, eventType: "GOVERNANCE_BLOCK", entityType: "workflow", eventDetails: `Workflow-Ausführung blockiert: ${govNote || wf.workflow_name}`, actorIdentity: "agentRuntime" });
      return createToolError(`Governance-Block: ${govNote || "Workflow-Ausführung blockiert"}`);
    }
    if (govEffect === "REQUIRE_APPROVAL" || govEffect === "ASK") {
      return createToolError(`Freigabe erforderlich (${govEffect}): ${govNote || "Workflow-Ausführung ohne Freigabe nicht erlaubt"}`);
    }

    // initialPayload: argsStr als JSON versuchen, sonst { query }
    let initialPayload: Record<string, unknown> = {};
    const trimmed = (argsStr || "").trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        initialPayload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { query: trimmed };
      } catch {
        initialPayload = { query: trimmed };
      }
    }

    // Tool-Validierung VOR der Ausführung (Vorbedingung für S6-Pitfall-Loop)
    const sequence = (wf.tool_chain_sequence || []) as Array<{ tool?: string; instruction?: string }>;
    const unknownTool = await validateWorkflowTools(tenantId, sequence);
    if (unknownTool) {
      await logAuditEvent({ tenantId, eventType: "WORKFLOW_MACRO", entityType: "workflow", eventDetails: `${wf.workflow_name}: failed (unbekanntes Tool '${unknownTool}')`, actorIdentity: "agentRuntime" });
      return createToolError(`Workflow '${wf.workflow_name}' enthält unbekanntes Tool '${unknownTool}'`);
    }

    // RUNNING-Check vor Instanz-INSERT (uq_workflow_running_instance_idx — saveInstance fängt UNIQUE-Fehler still ab)
    const runningId = await getRunningWorkflowInstanceId(tenantId, wf.id_uuid);
    if (runningId) {
      await logAuditEvent({ tenantId, eventType: "WORKFLOW_MACRO", entityType: "workflow", eventDetails: `${wf.workflow_name}: failed (läuft bereits)`, actorIdentity: "agentRuntime" });
      return createToolError(`Workflow '${wf.workflow_name}' läuft bereits.`);
    }

    // Instanz anlegen (Golden Path, beide Branches)
    const instanceId = uuidv4();
    const nowIso = new Date().toISOString();
    if (isUsingFallback || !pool) {
      if (!fallbackStore.workflowInstances) fallbackStore.workflowInstances = [];
      fallbackStore.workflowInstances.push({
        id_uuid: instanceId,
        tenant_id: tenantId,
        workflow_id: wf.id_uuid,
        status: "RUNNING",
        initial_payload: initialPayload,
        current_step_index: 0,
        execution_log: [],
        created_at_utc: nowIso,
        updated_at_utc: nowIso
      });
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_workflow_instances (id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log)
         VALUES ($1, $2, $3, 'RUNNING', $4::jsonb, 0, '[]'::jsonb)`,
        [instanceId, tenantId, wf.id_uuid, JSON.stringify(initialPayload)]
      );
    }

    try {
      await workflowExecutor.execute(wf, initialPayload, 0, instanceId);
    } catch (err) {
      await markWorkflowInstanceFailed(tenantId, instanceId);
      return createToolError(`Workflow '${wf.workflow_name}' fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }

    const inst = await loadWorkflowInstance(tenantId, instanceId);
    const outcome = deriveWorkflowRunOutcome(wf, inst);
    await logAuditEvent({ tenantId, eventType: "WORKFLOW_MACRO", entityType: "workflow", eventDetails: `${wf.workflow_name}: ${outcome.status}`, actorIdentity: "agentRuntime" });
    return createToolSuccess(outcome);
  } catch (err) {
    return createToolError(`Workflow-Ausführung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// G8 : Vault-Vollverwaltung — vault_write / vault_update / vault_delete
// Schreibt in knowledge_data_vault/<tenantId> (kanonischer Vault, wie list_vault_files).
// Dateinamen werden gegen Path-Traversal sanitized (nur Basename erlaubt).
// ============================================================================

function vaultRootFor(tenantId: string): string {
  return path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
}

function sanitizeVaultFileName(name: string): string {
  const base = path.basename(String(name || "").trim());
  if (!base || base === "." || base === "..") throw new Error("Ungültiger Dateiname.");
  if (!/\.(md|txt|json|csv)$/i.test(base)) throw new Error("Nur .md, .txt, .json oder .csv Dateien erlaubt.");
  return base;
}

/**
 * G8: vault_write — legt eine neue Datei im Wissensvault an.
 * Query JSON: { file_name, content, overwrite?: boolean } — überschreibt nur mit overwrite=true.
 */
export async function executeVaultWrite(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    const raw = JSON.parse(argsStr) as Record<string, unknown>;
    const fileName = sanitizeVaultFileName(String(raw.file_name || raw.filename || raw.name || ""));
    const content = String(raw.content || raw.text || "");
    if (!content.trim()) throw new Error("content darf nicht leer sein.");
    const overwrite = Boolean(raw.overwrite);

    const dir = vaultRootFor(tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath) && !overwrite) {
      throw new Error(`Datei '${fileName}' existiert bereits. Nutze overwrite: true zum Überschreiben.`);
    }
    fs.writeFileSync(filePath, content, "utf8");

    try {
      await logAuditEvent({ tenantId, eventType: "VAULT_WRITE", entityType: "vault_file", entityId: fileName, eventDetails: `AI vault_write: ${fileName} (${content.length} Zeichen)`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log VAULT_WRITE event:", e);
    }

    return createToolSuccess({
      message: `Erfolg! Datei '${fileName}' im Wissensvault angelegt (${content.length} Zeichen).`,
      file_name: fileName,
      path: filePath
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'vault_write': ${msg}`);
  }
}

/**
 * G8: vault_update — ändert den Inhalt einer bestehenden Vault-Datei.
 * Query JSON: { file_name, content } (legt an, wenn sie fehlt — analog upsert).
 */
export async function executeVaultUpdate(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    const raw = JSON.parse(argsStr) as Record<string, unknown>;
    const fileName = sanitizeVaultFileName(String(raw.file_name || raw.filename || raw.name || ""));
    const content = String(raw.content || raw.text || "");
    if (!content.trim()) throw new Error("content darf nicht leer sein.");

    const dir = vaultRootFor(tenantId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, content, "utf8");

    try {
      await logAuditEvent({ tenantId, eventType: "VAULT_UPDATE", entityType: "vault_file", entityId: fileName, eventDetails: `AI vault_update: ${fileName} (${content.length} Zeichen)`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log VAULT_UPDATE event:", e);
    }

    return createToolSuccess({
      message: `Erfolg! Datei '${fileName}' aktualisiert (${content.length} Zeichen).`,
      file_name: fileName,
      path: filePath
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'vault_update': ${msg}`);
  }
}

/**
 * G8: vault_delete — löscht eine Datei aus dem Wissensvault.
 * Query JSON: { file_name } — Audit-Log VAULT_DELETE.
 */
export async function executeVaultDelete(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    const raw = JSON.parse(argsStr) as Record<string, unknown>;
    const fileName = sanitizeVaultFileName(String(raw.file_name || raw.filename || raw.name || ""));

    const filePath = path.join(vaultRootFor(tenantId), fileName);
    if (!fs.existsSync(filePath)) {
      // Fallback: auch im shared Vault (tenant '1') suchen
      const sharedPath = path.join(vaultRootFor("1"), fileName);
      if (fs.existsSync(sharedPath)) {
        fs.unlinkSync(sharedPath);
        try {
          await logAuditEvent({ tenantId, eventType: "VAULT_DELETE", entityType: "vault_file", entityId: fileName, eventDetails: `AI vault_delete (shared): ${fileName}`, actorIdentity: actor });
        } catch (e) {
          console.warn("Failed to log VAULT_DELETE event:", e);
        }
        return createToolSuccess({ message: `Erfolg! Datei '${fileName}' aus dem Wissensvault gelöscht.`, file_name: fileName });
      }
      throw new Error(`Datei '${fileName}' nicht gefunden.`);
    }
    fs.unlinkSync(filePath);

    try {
      await logAuditEvent({ tenantId, eventType: "VAULT_DELETE", entityType: "vault_file", entityId: fileName, eventDetails: `AI vault_delete: ${fileName}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log VAULT_DELETE event:", e);
    }

    return createToolSuccess({ message: `Erfolg! Datei '${fileName}' aus dem Wissensvault gelöscht.`, file_name: fileName });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'vault_delete': ${msg}`);
  }
}

// ============================================================================
// P1: knowledge_*-Familie — exportierte Alias-Funktionen (wrappbar)
// Die MCP-Exposition (mcpServer.ts) und Workflow-Executoren können die neuen
// Namen aufrufen; die Implementierung bleibt in den vault_-Funktionen (DRY).
// ============================================================================

/** 036 P1: Alias für executeVaultWrite — neuer Wissensvault-Name (knowledge_write). */
export async function executeKnowledgeWrite(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  return executeVaultWrite(tenantId, argsStr, actor);
}

/** 036 P1: Alias für executeVaultUpdate — neuer Wissensvault-Name (knowledge_update). */
export async function executeKnowledgeUpdate(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  return executeVaultUpdate(tenantId, argsStr, actor);
}

/** 036 P1: Alias für executeVaultDelete — neuer Wissensvault-Name (knowledge_delete). */
export async function executeKnowledgeDelete(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  return executeVaultDelete(tenantId, argsStr, actor);
}

/** 036 P1: Alias für executeLocalKnowledgeSearch — neuer Wissensvault-Name (knowledge_search). */
export async function executeKnowledgeSearch(
  tenantId: string,
  query: string,
  aiClient?: GoogleGenAI
): Promise<ToolResult<Record<string, unknown>>> {
  return executeLocalKnowledgeSearch(tenantId, query, aiClient);
}

/** 036 P1: Alias für executeListVaultFiles — neuer Wissensvault-Name (list_knowledge_files). */
export async function executeListKnowledgeFiles(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<PaginatedToolResponse<string>>> {
  return executeListVaultFiles(tenantId, argsStr);
}

