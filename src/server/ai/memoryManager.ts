// ============================================================================
// Phase 3 (Parität): Memory-Mechanismen
// #18 Query-abhängiges Prefetch pro Turn (relevante Notizen zuerst, Budget-gesteuert)
// #19 Background-Sync nach Turn (fakten extrahieren → direkt persistieren, Dedupe 24h,
// Audit-Event — nie auf dem Antwort-Pfad; Muster memory_manager.py sync_all)
// #22 Konsolidierung bei Überlauf (älteste Notizen per LLM zusammenfassen statt droppen,
// Budget-gesteuert; Muster memory_tool.py Konsolidierungs-Loop)
// #23 Terminal-Success-Response (update_memory antwortet terminal — kein Modell-Thrash)
// #24 Skill-Scaffolding-Stripping (Skill-/Workflow-Turns verschmutzen Memory nicht)
// #26 Auto-Memory-Scan (ADDITIV: PII-/Credential-/Zeichen-Muster → flagged; bei 0 Treffern
// greifen die bestehenden Louis-Bedingungen unverändert — kein Fallback-Ersatz)
// Reine Kernlogik (testbar) + Background-Orchestrierung mit Dual-Store. Kein any (Regel 4).
// ============================================================================

import { ConversationMessage } from "../../types.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { generateContentUniversal } from "./geminiHelper.js";
import { getTenantAiConfig } from "./orchestrator.js";
import { readUserMemoryVault, writeUserMemoryVault } from "./vaultStore.js";

// ── #26 Auto-Memory-Scan (additiv — Muster tools/memory_tool.py _scan_memory_content) ──
export interface MemoryScanResult {
  flagged: boolean;
  reasons: string[];
}

const CREDENTIAL_PATTERNS: RegExp[] = [
  /(api[_-]?key|apikey|password|passwort|secret|token|private[_-]?key|bearer)\s*[=:]\s*["']?[A-Za-z0-9_\-\.]{12,}/i,
  // Whitespace-getrennt ("API-Key sk-abc123…", "Token abcdef…")
  /(api[_-]?key|apikey|secret|token|passwort|password)\s+[A-Za-z0-9_\-\.]{12,}/i,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/, // JWT
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|-----BEGIN CERTIFICATE-----)/,
  /AKIA[0-9A-Z]{16}/ // AWS Access Key
];

const SUSPICIOUS_CHAR_PATTERNS: RegExp[] = [
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/, // Steuerzeichen
  /([0-9a-fA-F]{2}[\s:]){16,}/, // lange Hex-Sequenz (Blob/Key)
  /[﹤﹥︿﹀＜＞｛｝｟｠]/, // Unicode-Konfusionszeichen (DSML-Maskierung)
  /(?:[A-Za-z0-9+/]{40,}={0,2})/ // base64-artiger Blob
];

export function scanMemoryContent(content: string): MemoryScanResult {
  const text = content || "";
  const reasons: string[] = [];
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(text)) {
      reasons.push("credential");
      break;
    }
  }
  for (const re of SUSPICIOUS_CHAR_PATTERNS) {
    if (re.test(text)) {
      reasons.push("suspicious_chars");
      break;
    }
  }
  return { flagged: reasons.length > 0, reasons };
}

// ── #24 Skill-Scaffolding-Stripping (Muster memory_manager.py _strip_skill_scaffolding) ──
const SCAFFOLDING_PATTERNS: RegExp[] = [
  /```(?:json|md|markdown)?[\s\S]*```/,
  /"tool_chain_sequence"/,
  /"workflow_name"\s*:/,
  /<REACT_LOOP_STATE>/,
  /ReAct-Iteration|Iteration \[\d+ of \d+\]/,
  /"name"\s*:\s*"[a-z_]+"\s*,\s*"description"\s*:/, // Skill-Definition-JSON
  /Thought:\s*.{0,80}finalDraftText/
];

export function isSkillScaffoldingContent(content: string): boolean {
  const text = content || "";
  return SCAFFOLDING_PATTERNS.some((re) => re.test(text));
}

// ── #18 Query-abhängiges Prefetch (Muster memory_manager.py prefetch_all) ──
export interface PrefetchResult {
  notes: Array<{ id_uuid: string; content: string; created_at_utc: string }>;
  relevantCount: number;
  dropped: number;
}

/** Token-Overlap-Score zwischen Nutzer-Nachricht und Notiz (Wörter, de+en tolerant). */
export function scoreNoteRelevance(userMessage: string, noteContent: string): number {
  const terms = (userMessage || "")
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((w) => w.length > 2);
  const note = (noteContent || "").toLowerCase();
  if (terms.length === 0) return 0;
  return terms.reduce((sum, term) => (note.includes(term) ? sum + 1 : sum), 0);
}

/**
 * Sortiert Notizen nach Relevanz (Score absteigend, dann neueste zuerst) und füllt das
 * Token-Budget wie renderBudgetedMemoryNotes. Reine Funktion, deterministisch — testbar.
 */
export function prefetchRelevantMemoryNotes(
  userMessage: string,
  notes: Array<{ id_uuid: string; content: string; created_at_utc: string }>,
  budgetTokens: number
): PrefetchResult {
  if (!notes || notes.length === 0) return { notes: [], relevantCount: 0, dropped: 0 };
  const scored = notes.map((n) => ({ n, score: scoreNoteRelevance(userMessage, n.content) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(b.n.created_at_utc).localeCompare(String(a.n.created_at_utc));
  });
  const lines: Array<{ id_uuid: string; content: string; created_at_utc: string }> = [];
  let usedTokens = 0;
  for (const { n } of scored) {
    const estTokens = Math.ceil(n.content.length / 3.8);
    // 051 (2026-08-21, 050-B2): Budget HART durchsetzen. Der frühere Code ließ den
    // ERSTEN Eintrag immer komplett rein, auch wenn er das Budget sprengte (z. B.
    // 8.000-Zeichen-E-Rechnungs-Eintrag ≈ 2.000 Tokens bei Budget 800) → Token-Explosion.
    if (usedTokens + estTokens > budgetTokens) {
      if (lines.length === 0 && budgetTokens > 0) {
        // Erster Eintrag allein größer als Budget → kürzen statt sprengen (Fail-open:
        // Information bleibt erhalten, Budget wird nie überschritten).
        const maxChars = Math.max(Math.floor(budgetTokens * 3.8), 80);
        lines.push({ ...n, content: n.content.slice(0, maxChars) });
        usedTokens = budgetTokens;
      }
      break;
    }
    lines.push(n);
    usedTokens += estTokens;
  }
  return {
    notes: lines,
    relevantCount: lines.filter((l) => scoreNoteRelevance(userMessage, l.content) > 0).length,
    dropped: notes.length - lines.length
  };
}

// ── #22 Konsolidierung (Muster memory_tool.py Konsolidierungs-Loop) ──
export function buildConsolidationPrompt(
  oldestNotes: Array<{ content: string; created_at_utc: string }>,
  language: string
): string {
  return `Du bist das Gedächtnis-Verwaltungssystem von Louis CRM. Die ältesten Notizen über den Nutzer
überschreiten das Speicherbudget und werden sonst gelöscht. Fasse sie zu EINER kompakten Notiz zusammen,
ohne Fakten zu verlieren (Entscheidungen, IDs, Präferenzen, Beträge). Keine Einleitung, nur die Notiz.

Sprache: ${language === "en" ? "English" : "Deutsch"}

Älteste Notizen:
${JSON.stringify(oldestNotes)}

Antworte mit der konsolidierten Notiz (max. 400 Token).`;
}

// ── #19 Fakten-Extraktion (Muster sync_all: seriell, nie inline) ──
export function buildFactExtractionPrompt(userMessage: string, replyText: string, language: string): string {
  return `Du bist das Gedächtnis-Verwaltungssystem von Louis CRM. Extrahiere aus dem folgenden Chat-Turn
höchstens 2 dauerhafte, merkwürdige Fakten über den Nutzer, die für künftige Gespräche wichtig sind
(Entscheidungen, Präferenzen, IDs, Vereinbarungen). KEINE temporären Details (z. B. "hat gefragt nach"),
keine Wiederholungen von Offensichtlichem. Gibt es nichts Dauerhaftes, antworte mit: KEINE_FAKTEN

Nutzer-Nachricht: ${userMessage.slice(0, 2000)}
Antwort: ${replyText.slice(0, 2000)}

Antworte als JSON-Array von Strings (max 2 Elemente), z. B. ["Präferenz X", "Entscheidung Y"] — auf Deutsch (bzw. Englisch bei Sprache ${language}).`;
}

// ── #23 Terminal-Success-Response (Muster memory_tool.py:702) ──
export function buildTerminalMemoryMessage(savedText: string, source: string): string {
  return `Gespeichert (${source}). Diese Bestätigung ist endgültig — update_memory NICHT erneut aufrufen, nicht wiederholen und nicht verifizieren. Gespeichert: ${savedText.slice(0, 120)}`;
}

// ============================================================================
// #19 Background-Sync + #22 Konsolidierung — Background-Worker (nie Antwort-Pfad).
// ============================================================================

const memoryJobsInFlight = new Set<string>();
const BACKGROUND_TIMEOUT_MS = 30_000;

export interface BackgroundMemorySyncOptions {
  tenantId: string;
  userId: string;
  userMessage: string;
  replyText: string;
  language: string;
  autoScanEnabled: boolean;
  modelName: string;
  rawContextMap?: string | null;
}

function parseFacts(raw: string): string[] {
  const text = (raw || "").trim();
  if (!text || /KEINE_FAKTEN/i.test(text)) return [];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : text;
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (Array.isArray(parsed)) {
      return parsed.filter((f): f is string => typeof f === "string" && f.trim().length > 8).map((f) => f.trim());
    }
  } catch {
    // kein JSON → Zeilen-Fallback
  }
  return candidate
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 8 && !/KEINE_FAKTEN/i.test(l))
    .slice(0, 2);
}

async function persistMemoryFact(tenantId: string, userId: string, fact: string): Promise<void> {
  const current = (await readUserMemoryVault(tenantId, userId)) || {
    response_preferences_text: "",
    frequently_used_tools_json: [],
    chat_notes_json: []
  };
  // Dedupe 24h (Muster executeUpdateMemory agentRuntime.ts:1608)
  const now = Date.now();
  const duplicate = current.chat_notes_json.some((n) => {
    const same = n.content.trim().toLowerCase() === fact.trim().toLowerCase();
    const within24h = Math.abs(now - new Date(n.created_at_utc).getTime()) < 24 * 60 * 60 * 1000;
    return same && within24h;
  });
  if (duplicate) return;
  current.chat_notes_json.push({ id_uuid: `sync-${now}`, content: fact, created_at_utc: new Date().toISOString() });
  const writeRes = await writeUserMemoryVault(tenantId, userId, current);
  // DB-Spiegel (Tier 3, best-effort)
  try {
    if (isUsingFallback || !pool) {
      const records = fallbackStore.louisAiUserMemory || [];
      const rec = records.find((m) => m.user_id === userId && m.tenant_id === tenantId);
      if (rec) {
        rec.chat_notes_json = current.chat_notes_json as never;
        saveFallbackStore();
      }
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
         VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4::jsonb)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET chat_notes_json = EXCLUDED.chat_notes_json, updated_at_utc = CURRENT_TIMESTAMP`,
        [tenantId, userId, current.response_preferences_text, JSON.stringify(current.chat_notes_json)]
      );
    }
  } catch (err) {
    console.warn("[Memory-Sync] DB-Spiegel fehlgeschlagen (Vault bleibt Quelle):", err);
  }
  await logAuditEvent({
    tenantId,
    eventType: "MEMORY_SYNC",
    entityType: "user_memory",
    eventDetails: `${userId}: background sync note (${writeRes.source})`,
    actorIdentity: userId
  });
}

/**
 * #19 Background-Sync nach Turn: extrahiert dauerhafte Fakten aus dem Turn und persistiert
 * sie DIREKT (kein Freigabe-Flow — Memory ist User-Daten). Fire-and-forget; Fehler non-fatal;
 * nie auf dem Antwort-Pfad. #24/#26 greifen als Filter VOR dem Speichern.
 */
export async function scheduleBackgroundMemorySync(opts: BackgroundMemorySyncOptions): Promise<void> {
  const lockKey = `${opts.tenantId}|${opts.userId}`;
  if (memoryJobsInFlight.has(lockKey)) return;
  memoryJobsInFlight.add(lockKey);
  try {
    // #24: Skill-/Workflow-Scaffolding-Turns nie als Memory speichern
    if (isSkillScaffoldingContent(opts.userMessage) || isSkillScaffoldingContent(opts.replyText)) {
      return;
    }
    // Nur substantielle Turns (Antwort > 120 Zeichen) — sonst Token-Verschwendung
    if ((opts.replyText || "").trim().length < 120) return;

    const config = await getTenantAiConfig(opts.tenantId);
    const provider = (config.provider_type || "ollama") as "ollama" | "anthropic" | "openai" | "gemini";
    let cleanApiKey = typeof config.api_key_secret === "string" ? config.api_key_secret.trim() : "";
    if (cleanApiKey.includes("@") || cleanApiKey === "******") cleanApiKey = "";

    const prompt = buildFactExtractionPrompt(opts.userMessage, opts.replyText, opts.language);
    const completion = await Promise.race([
      generateContentUniversal({
        provider_type: provider,
        model_name: opts.modelName,
        api_key_secret: cleanApiKey,
        base_url: (config.base_url as string) || undefined,
        temperature: 0.2,
        contents: prompt
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Memory-Sync Timeout nach ${BACKGROUND_TIMEOUT_MS}ms`)), BACKGROUND_TIMEOUT_MS)
      )
    ]);
    const facts = parseFacts((completion.text as string | undefined) || "");
    if (facts.length === 0) return;

    for (const fact of facts) {
      // #26: Auto-Memory-Scan (additiv — bei 0 Treffern greifen die Louis-Bedingungen unverändert)
      if (opts.autoScanEnabled) {
        const scan = scanMemoryContent(fact);
        if (scan.flagged) {
          console.warn(`[Memory-Scan] Auto-Scan blockt Fakt (${scan.reasons.join(",")}): ${fact.slice(0, 80)}`);
          continue;
        }
      }
      await persistMemoryFact(opts.tenantId, opts.userId, fact);
    }
    console.log(`[Memory-Sync] Background-Sync: ${facts.length} Fakt(en) persistiert (Session ${opts.userId}).`);
  } catch (err) {
    console.warn(`[Memory-Sync] Background-Sync fehlgeschlagen (ignoriert): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    memoryJobsInFlight.delete(lockKey);
  }
}

/**
 * #22 Konsolidierung bei Überlauf: älteste Notizen, die das Budget sprengen würden, per LLM
 * zusammenfassen und als EINE Notiz ersetzen (statt droppen). Background, nie Antwort-Pfad.
 */
export async function scheduleMemoryConsolidation(opts: {
  tenantId: string;
  userId: string;
  language: string;
  budgetTokens: number;
  modelName: string;
}): Promise<void> {
  const lockKey = `consolidate|${opts.tenantId}|${opts.userId}`;
  if (memoryJobsInFlight.has(lockKey)) return;
  memoryJobsInFlight.add(lockKey);
  try {
    const current = await readUserMemoryVault(opts.tenantId, opts.userId);
    if (!current || current.chat_notes_json.length === 0) return;
    const sorted = current.chat_notes_json.slice().sort((a, b) => String(a.created_at_utc).localeCompare(String(b.created_at_utc)));
    let usedTokens = 0;
    let withinBudget = 0;
    for (const n of sorted) {
      if (usedTokens + Math.ceil(n.content.length / 3.8) > opts.budgetTokens) break;
      usedTokens += Math.ceil(n.content.length / 3.8);
      withinBudget++;
    }
    if (withinBudget >= sorted.length) return; // kein Überlauf → nichts zu tun

    const overflow = sorted.slice(0, Math.max(1, withinBudget - 1));
    if (overflow.length === 0) return;

    const config = await getTenantAiConfig(opts.tenantId);
    const provider = (config.provider_type || "ollama") as "ollama" | "anthropic" | "openai" | "gemini";
    let cleanApiKey = typeof config.api_key_secret === "string" ? config.api_key_secret.trim() : "";
    if (cleanApiKey.includes("@") || cleanApiKey === "******") cleanApiKey = "";

    const completion = await Promise.race([
      generateContentUniversal({
        provider_type: provider,
        model_name: opts.modelName,
        api_key_secret: cleanApiKey,
        base_url: (config.base_url as string) || undefined,
        temperature: 0.2,
        contents: buildConsolidationPrompt(overflow, opts.language)
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Memory-Konsolidierung Timeout nach ${BACKGROUND_TIMEOUT_MS}ms`)), BACKGROUND_TIMEOUT_MS)
      )
    ]);
    const consolidated = (completion.text as string | undefined)?.trim();
    if (!consolidated) return;

    const overflowIds = new Set(overflow.map((n) => n.id_uuid));
    current.chat_notes_json = [
      ...current.chat_notes_json.filter((n) => !overflowIds.has(n.id_uuid)),
      { id_uuid: `consolidated-${Date.now()}`, content: consolidated, created_at_utc: new Date().toISOString() }
    ];
    await writeUserMemoryVault(opts.tenantId, opts.userId, current);
    console.log(`[Memory-Sync] Konsolidierung: ${overflow.length} alte Notizen → 1 zusammengefasste (${consolidated.length} Zeichen).`);
  } catch (err) {
    console.warn(`[Memory-Sync] Konsolidierung fehlgeschlagen (ignoriert): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    memoryJobsInFlight.delete(lockKey);
  }
}

export type { ConversationMessage };
