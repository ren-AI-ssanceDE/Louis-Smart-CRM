// ============================================================================
// hase 2 (Parität): Kontext-Kompression
// #9 Threshold-basiert (Anteil des Kontextfensters statt fester Nachrichtenzahl)
// #9a Modell→Kontextfenster-Map (Config-Feld compression_model_context_map, NULL = Backend-Default)
// #10 Per-Modell-Threshold-Override (in der Map, Muster context_compressor.py resolve_model_threshold)
// #11 Head/Tail-Schutz (Kopf + letzte ~20K Tokens bleiben voll; nur die Mitte wird komprimiert)
// #12 Session-Persistenz/-Trim (Summary + komprimierte History in DB, Recall bleibt möglich)
// #13 Kein 4s-Timeout-Race — Kompression läuft im Background, NIE auf dem Antwort-Pfad
// #14 Feasibility-Probe (Aux-Modell-Fenster → effektiven Threshold ableiten)
// #15 Native-Compaction-Pfad (provider-agnostisch — Modelle mit eigenem Context-Management
// werden durchgereicht, NIE auf DeepSeek optimiert — Regel 11)
// Reine, deterministische Kernlogik (testbar) + Background-Orchestrierung mit Dual-Store.
// Kein any (Regel 4).
// ============================================================================

import { ConversationMessage } from "../../types.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../db.js";
import { generateContentUniversal } from "./geminiHelper.js";
import { getTenantAiConfig } from "./orchestrator.js";
import { v4 as uuidv4 } from "uuid";

// ── #9a Backend-Default-Fenster-Map (Regel 12: NULL = Default; Admin-Overwrite via
// compression_model_context_map als JSON { "regex-pattern": { "window_tokens": N, "threshold_percent": P } })
// Modell-Familien pro Regex — provider-agnostisch (ollama/openai/anthropic/gemini/deepseek). ──
interface ModelWindowEntry {
  window_tokens: number;
  threshold_percent?: number;
}

const DEFAULT_MODEL_CONTEXT_MAP: Record<string, ModelWindowEntry> = {
  // OpenAI
  "gpt-4o|gpt-4\\.1|gpt-4\\.5|gpt-4-turbo": { window_tokens: 128000 },
  "gpt-3\\.5": { window_tokens: 16385 },
  "o[1-4](-mini|-pro)?": { window_tokens: 200000 },
  // Anthropic
  "claude-3\\.5|claude-3\\.7|claude-4|claude-sonnet|claude-opus|claude-haiku": { window_tokens: 200000 },
  // Google (natives Context-Management → #15)
  "gemini-2\\.5|gemini-3|gemini-2\\.0|gemini-1\\.5|gemini-pro|gemini-flash": { window_tokens: 1000000 },
  // DeepSeek
  "deepseek-chat|deepseek-v[0-9]|deepseek-r1|deepseek-reasoner": { window_tokens: 128000 },
  // Meta / lokale Ollama-Familien (kleinere Fenster → konservativerer Threshold)
  "llama-?3\\.?[0-9]?": { window_tokens: 128000, threshold_percent: 60 },
  "qwen2\\.5|qwen3": { window_tokens: 131072, threshold_percent: 60 },
  "mistral|mixtral": { window_tokens: 32768, threshold_percent: 60 },
  "phi-?3|phi-?4": { window_tokens: 128000, threshold_percent: 60 },
  "command-r": { window_tokens: 128000 },
};

// #9a Fallback: unbekannte Modelle → 128K (konservativ sicher)
const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_THRESHOLD_PERCENT = 75;

export interface ResolvedModelWindow {
  windowTokens: number;
  thresholdPercent: number;
}

function matchesModel(name: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(name || "");
  } catch {
    return false;
  }
}

/** Parst die Admin-Config-Map (JSON) fehlertolerant und validiert die Struktur. */
export function parseModelContextMap(raw: unknown): Record<string, ModelWindowEntry> | null {
  if (raw === null || raw === undefined || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const result: Record<string, ModelWindowEntry> = {};
  for (const [pattern, entry] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof pattern !== "string" || !pattern) continue;
    const e = entry as Record<string, unknown>;
    const windowTokens = e?.window_tokens;
    if (typeof windowTokens !== "number" || !Number.isFinite(windowTokens) || windowTokens <= 0) continue;
    const threshold = e?.threshold_percent;
    result[pattern] = {
      window_tokens: Math.floor(windowTokens),
      ...(typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0 && threshold <= 100
        ? { threshold_percent: Math.floor(threshold) }
        : {})
    };
  }
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * #9a/#10: Modell → { Fenster, Threshold } — erste passende Regex gewinnt.
 * Reine Funktion, deterministisch, testbar. Kein any (Regel 4).
 */
export function resolveModelWindow(modelName: string, rawMap?: unknown): ResolvedModelWindow {
  const map = parseModelContextMap(rawMap) ?? DEFAULT_MODEL_CONTEXT_MAP;
  for (const [pattern, entry] of Object.entries(map)) {
    if (matchesModel(modelName || "", pattern)) {
      return {
        windowTokens: entry.window_tokens,
        thresholdPercent: entry.threshold_percent ?? DEFAULT_THRESHOLD_PERCENT
      };
    }
  }
  return { windowTokens: DEFAULT_CONTEXT_WINDOW, thresholdPercent: DEFAULT_THRESHOLD_PERCENT };
}

/** Grobe Token-Schätzung (Zeichen / 3.8, identisch zur bestehenden Louis-Schätzung). */
export function estimateHistoryTokens(history: ReadonlyArray<Pick<ConversationMessage, "content">>): number {
  if (!history || history.length === 0) return 0;
  return history.reduce((sum, msg) => sum + Math.ceil((msg.content || "").length / 3.8), 0);
}

/**
 * #11 Head/Tail-Schutz: Kopf (erste Nachrichten, ~15 % des Tail-Budgets, max 10) und
 * Schwanz (letzte ~tailTokenBudget Tokens) bleiben VOLL erhalten; nur die Mitte wird
 * zur Kompression markiert. Deterministisch, testbar.
 */
export function splitHeadTail(
  history: ConversationMessage[],
  tailTokenBudget: number
): { head: ConversationMessage[]; middle: ConversationMessage[]; tail: ConversationMessage[] } {
  if (!history || history.length === 0) return { head: [], middle: [], tail: [] };
  const budget = tailTokenBudget > 0 ? tailTokenBudget : 20000;
  const headTokenBudget = Math.max(1, Math.floor(budget * 0.15));

  // Tail von hinten füllen
  const tail: ConversationMessage[] = [];
  let tailTokens = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const tokens = Math.ceil((msg.content || "").length / 3.8);
    if (tailTokens + tokens > budget && tail.length >= 2) break;
    tail.unshift(msg);
    tailTokens += tokens;
  }
  const tailCount = tail.length;
  const beforeTail = history.slice(0, history.length - tailCount);

  // Head von vorne füllen
  const head: ConversationMessage[] = [];
  let headTokens = 0;
  for (const msg of beforeTail) {
    const tokens = Math.ceil((msg.content || "").length / 3.8);
    if (headTokens + tokens > headTokenBudget && head.length >= 2) break;
    head.push(msg);
    headTokens += tokens;
    if (head.length >= 10) break;
  }
  const middle = beforeTail.slice(head.length);

  return { head, middle, tail };
}

/**
 * #15 Native-Compaction-Pfad (provider-agnostisch): Modelle mit nativem Context-Management
 * (z. B. Gemini-Familie) werden durchgereicht — keine eigene Kompression. Erkennung über
 * die Fenster-Map (Eintrag mit window_tokens >= 512000 gilt als natives Context-Management).
 */
export function supportsNativeCompaction(modelName: string, rawMap?: unknown): boolean {
  const map = parseModelContextMap(rawMap) ?? DEFAULT_MODEL_CONTEXT_MAP;
  for (const [pattern, entry] of Object.entries(map)) {
    if (matchesModel(modelName || "", pattern)) {
      return entry.window_tokens >= 512000;
    }
  }
  return false;
}

/** #9 Entscheidungslogik: komprimieren oder nicht (reine Funktion, testbar). */
export interface CompressionDecision {
  needsCompression: boolean;
  nativeCompaction: boolean;
  windowTokens: number;
  historyTokens: number;
  effectiveThresholdPercent: number;
  tailTokenBudget: number;
  reason: string;
}

export function decideCompression(
  history: ConversationMessage[],
  opts: {
    modelName: string;
    rawContextMap?: unknown;
    thresholdPercent?: number | null;
    tailTokenBudget?: number | null;
    enabled?: boolean | null;
  }
): CompressionDecision {
  if (opts.enabled === false) {
    return { needsCompression: false, nativeCompaction: false, windowTokens: 0, historyTokens: 0, effectiveThresholdPercent: 0, tailTokenBudget: 0, reason: "compression disabled" };
  }
  const resolved = resolveModelWindow(opts.modelName || "", opts.rawContextMap);
  const windowTokens = resolved.windowTokens;
  const thresholdPercent = opts.thresholdPercent ?? resolved.thresholdPercent;
  const historyTokens = estimateHistoryTokens(history);
  const native = supportsNativeCompaction(opts.modelName || "", opts.rawContextMap);
  if (native) {
    return {
      needsCompression: false,
      nativeCompaction: true,
      windowTokens,
      historyTokens,
      effectiveThresholdPercent: thresholdPercent,
      tailTokenBudget: opts.tailTokenBudget ?? 20000,
      reason: "native compaction (Modell verwaltet Kontext selbst)"
    };
  }
  const needed = Math.ceil((windowTokens * thresholdPercent) / 100);
  if (historyTokens >= needed) {
    return {
      needsCompression: true,
      nativeCompaction: false,
      windowTokens,
      historyTokens,
      effectiveThresholdPercent: thresholdPercent,
      tailTokenBudget: opts.tailTokenBudget ?? 20000,
      reason: `historyTokens ${historyTokens} >= Fenster ${windowTokens} * ${thresholdPercent}% = ${needed}`
    };
  }
  return {
    needsCompression: false,
    nativeCompaction: false,
    windowTokens,
    historyTokens,
    effectiveThresholdPercent: thresholdPercent,
    tailTokenBudget: opts.tailTokenBudget ?? 20000,
    reason: `historyTokens ${historyTokens} < Fenster ${windowTokens} * ${thresholdPercent}% = ${needed}`
  };
}

/**
 * #14 Feasibility-Probe (Muster conversation_compression.py check_compression_model_feasibility):
 * Kann das Aux-Modell ein Threshold-großes Fenster fassen? Wenn sein eigenes Fenster kleiner
 * ist als das benötigte Kompressionsfenster, wird der effektive Threshold gesenkt
 * (auf ~90 % des Aux-Fensters relativ zum Hauptfenster). Ohne LLM-Call — abgeleitet aus der Map.
 */
export function resolveEffectiveCompressionThreshold(
  auxModelName: string,
  mainModelName: string,
  rawContextMap?: unknown,
  configuredThresholdPercent?: number | null
): { effectiveThresholdPercent: number; auxFeasible: boolean; reason: string } {
  const main = resolveModelWindow(mainModelName || "", rawContextMap);
  const threshold = configuredThresholdPercent ?? main.thresholdPercent;
  const neededTokens = Math.ceil((main.windowTokens * threshold) / 100);
  const aux = resolveModelWindow(auxModelName || mainModelName || "", rawContextMap);
  if (aux.windowTokens >= neededTokens) {
    return { effectiveThresholdPercent: threshold, auxFeasible: true, reason: `Aux-Fenster ${aux.windowTokens} >= nötig ${neededTokens}` };
  }
  const reduced = Math.max(5, Math.floor((aux.windowTokens / main.windowTokens) * 100 * 0.9));
  return {
    effectiveThresholdPercent: reduced,
    auxFeasible: false,
    reason: `Aux-Fenster ${aux.windowTokens} < nötig ${neededTokens} → Threshold auf ${reduced}% gesenkt`
  };
}

/**
 * Kompakter Kontext-Marker, der bei Session-Trim (#12) an den Anfang der History wandert,
 * damit der Agent den konsolidierten Stand auch nach dem Trim sicher sieht.
 */
export function buildSummaryContextBlock(summary: string): ConversationMessage {
  return {
    role: "system",
    content: `[Komprimierte Chat-Vorgeschichte — vollständig in der Session-Zusammenfassung]:\n${summary}`,
    timestamp_utc: new Date().toISOString()
  };
}

/**
 * #13: Summarize-Prompt für die Mitte (Aux-Modell). Provider-agnostisch, deutsch (bestehende
 * Louis-Konvention), max 1000 Token Output. Reine Funktion — testbar.
 */
export function buildSummarizationPrompt(
  middle: ConversationMessage[],
  currentSummaryText: string,
  head: ConversationMessage[],
  tail: ConversationMessage[]
): string {
  return `Deine Aufgabe ist es, als passives CRM-Gedächtnis-Tool den MITTLEREN Teil eines CRM-Chatverlaufes strukturiert zusammenzufassen.
Konsolidiere alle wichtigen und kritischen Fakten in einer kompakten, leicht zu lesenden Liste.

Elemente, die du unbedingt festhalten musst:
- Entscheidungen und getroffene Vereinbarungen des Nutzers.
- Diskutierte Entitäten (Firmennamen, Ansprechpartner, E-Mails, IBANs, etc.).
- Spezifische finanzielle Summen, Rechnungsnummern oder offene Beträge.
- Vom Nutzer formulierte, sitzungsinterne Instruktionen.

Bisherige Zusammenfassung dieses Chats (falls vorhanden):
"${currentSummaryText || 'Keine bisherige Zusammenfassung vorhanden.'}"

Zu komprimierender Verlaufsauszug (nur der mittlere Teil — Kopf und aktuelle Nachrichten bleiben voll erhalten):
${JSON.stringify(middle)}

Zum Kontext: Die ersten Nachrichten (${
    head.length
  }) und die letzten Nachrichten (${
    tail.length
  }) bleiben unkomprimiert — fasse NUR den obigen Auszug zusammen, ohne dessen Inhalte zu wiederholen.

Antworte mit der neuen, konsolidierten und aktualisierten Zusammenfassung auf Deutsch.
Überschreite keinesfalls 1000 Token. Nutze strukturiertes Markdown.`;
}

// ============================================================================
// #13 Background-Kompression (NIE auf dem Antwort-Pfad) + #12 Session-Trim.
// Muster: synchroner Background-Worker (Background-Worker, seriell, nie inline).
// - Entscheidung rein über die Kernlogik (Threshold/Fenster/Native).
// - LLM-Call mit großzügigem Timeout (30s) — bei Fehler wird NICHTS persistiert
// (kein stilles Weiterverwenden des alten Summary, kein stiller Fallback).
// - Persistenz: short_term_summary_text + Session-History-Trim (Kopf + Schwanz +
// Summary-Marker bleiben; Mitte wandert in den Summary). Dual-Store (Regel 3).
// - Modul-Lock pro Session: keine parallelen Doppel-Läufe auf derselben Session.
// ============================================================================

const compressionInFlight = new Set<string>();
const BACKGROUND_TIMEOUT_MS = 30_000;

// ============================================================================
// P0-B: Kompressions-Lock (bewährtes Muster compression_locks +
// BUSY_WAIT — TTL als Crash-Sicherheitsnetz)
// ----------------------------------------------------------------------------
// Während scheduleBackgroundCompression läuft (LLM-Summarisierung), hält die
// Session einen Lock. sendMessage prüft den Lock VOR der Session-Verarbeitung,
// wartet kurz (BUSY_WAIT_MS) und antwortet danach mit compressionInProgress
// statt die Session parallel zu beschreiben — sonst gingen Nachrichten verloren,
// die während der Kompression in die alte Session wandern (Plan-Review 038).
// TTL als Sicherheitsnetz bei Crash: ein verwaister Lock verfällt automatisch.
// ============================================================================

const COMPRESSION_LOCK_TTL_MS = 60_000;
const COMPRESSION_BUSY_WAIT_MS = 5_000;
const COMPRESSION_BUSY_POLL_MS = 250;

const compressionLocks = new Map<string, number>();

/** Lock für eine Session akquirieren (true = akquiriert, false = schon vergeben). */
export function tryAcquireCompressionLock(sessionId: string, ttlMs: number = COMPRESSION_LOCK_TTL_MS): boolean {
  const now = Date.now();
  const existing = compressionLocks.get(sessionId);
  if (existing && existing > now) return false;
  compressionLocks.set(sessionId, now + ttlMs);
  return true;
}

/** Lock freigeben (im finally von scheduleBackgroundCompression). */
export function releaseCompressionLock(sessionId: string): void {
  compressionLocks.delete(sessionId);
}

/** Ist die Session aktuell kompressions-gesperrt? (verfallene Locks gelten als frei) */
export function isCompressionLocked(sessionId: string): boolean {
  const until = compressionLocks.get(sessionId);
  if (!until) return false;
  if (until <= Date.now()) {
    compressionLocks.delete(sessionId);
    return false;
  }
  return true;
}

/**
 * Wartet bis zu BUSY_WAIT_MS auf den Lock (Polling). Liefert true, wenn der Lock
 * frei wurde (Session darf verarbeitet werden); false, wenn die Wartezeit
 * abgelaufen ist → Aufrufer antwortet mit compressionInProgress statt zu schreiben.
 */
export async function waitForCompressionLock(sessionId: string, waitMs: number = COMPRESSION_BUSY_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (!isCompressionLocked(sessionId)) return true;
    await new Promise((resolve) => setTimeout(resolve, COMPRESSION_BUSY_POLL_MS));
  }
  return !isCompressionLocked(sessionId);
}

// ============================================================================
// P0: Session-Rotation-Registry (bewährtes Rotations-Muster)
// ----------------------------------------------------------------------------
// Wenn die Background-Kompression eine Session rotiert (Eltern-Session bleibt mit
// Voll-History stehen, Kind-Session übernimmt die getrimmte History), merkt sich
// diese Registry die Zuordnung altSessionId → childSessionId. Der nächste
// sendMessage mit der alten SessionId wird auf die Kind-Session umgeleitet und
// gibt deren ID in der Antwort zurück (das Frontend übernimmt sie bereits,
// LouisAi.tsx Z. 620-621). Fallback: Registry-Eintrag fehlt (Neustart) → die alte
// Session wird weitergeführt (kein Bruch, nur keine Rotation).
// ============================================================================

const sessionRotationRegistry = new Map<string, { childId: string; expiresAt: number }>();

// P1 (B2): TTL für Registry-Einträge — verhindert unbegrenztes Map-Wachstum,
// wenn ein Client nie wieder mit der alten SessionId sendet. Die Umleitung selbst ist
// IDEMPOTENT: jeder Request mit der alten SessionId wird umgeleitet, bis der Client
// nachweislich auf der Kind-Session ist (oder der Eintrag verfällt).
const SESSION_ROTATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** Alt-SessionId → Kind-SessionId registrieren (tenant-scoped, mit TTL). */
export function registerSessionRotation(tenantId: string, oldSessionId: string, childSessionId: string): void {
  sessionRotationRegistry.set(`${tenantId}|${oldSessionId}`, {
    childId: childSessionId,
    expiresAt: Date.now() + SESSION_ROTATION_TTL_MS
  });
}

/** Kind-SessionId zu einer alten SessionId auflösen (undefined = keine aktive Rotation). */
export function resolveRotatedSessionId(tenantId: string, sessionId: string): string | undefined {
  const entry = sessionRotationRegistry.get(`${tenantId}|${sessionId}`);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    sessionRotationRegistry.delete(`${tenantId}|${sessionId}`);
    return undefined;
  }
  return entry.childId;
}

/** Registry-Eintrag entfernen. */
export function forgetSessionRotation(tenantId: string, sessionId: string): void {
  sessionRotationRegistry.delete(`${tenantId}|${sessionId}`);
}

/**
 * P1 (B2): Einträge entfernen, deren Kind-SessionId übergeben wird —
 * der Client hat nachweislich die neue SessionId übernommen (er sendet direkt mit ihr),
 * die Umleitung für die alte ID ist damit überflüssig. O(n)-Scan, Map ist klein (TTL 24h).
 */
export function forgetSessionRotationByChild(tenantId: string, childSessionId: string): void {
  const prefix = `${tenantId}|`;
  for (const [key, entry] of sessionRotationRegistry) {
    if (key.startsWith(prefix) && entry.childId === childSessionId) {
      sessionRotationRegistry.delete(key);
    }
  }
}

export interface BackgroundCompressionOptions {
  tenantId: string;
  sessionId: string;
  history: ConversationMessage[];
  currentSummary: string;
  modelName: string;
  rawContextMap?: string | null;
  thresholdPercent?: number | null;
  tailTokenBudget?: number | null;
  persistSummary?: boolean;
  auxModel?: string | null;
}

/**
 * Persistiert Summary + getrimmte History (Dual-Store, Regel 3) MIT Session-Rotation
 * (P0): Die bisherige Session wird zur abgeschlossenen ELTERN-Session
 * (Voll-History bleibt erhalten!), eine neue KIND-Session übernimmt die getrimmte
 * History + Summary und verlinkt via parent_session_id. Wirft bei Fehlern.
 * Rückgabe: childSessionId (die neue aktive Session) — oder undefined, wenn die
 * Session nicht gefunden wurde (dann bleibt alles unverändert).
 * Exportiert (wrappbar-Regel) — wird von Unit-Tests direkt getestet.
 */
export async function persistCompressionResult(
  tenantId: string,
  sessionId: string,
  summary: string,
  trimmedHistory: ConversationMessage[]
): Promise<string | undefined> {
  const childSessionId = uuidv4();
  if (isUsingFallback || !pool) {
    const sessions = fallbackStore.louisAiSessions || [];
    const parent = sessions.find((s) => s.id_uuid === sessionId && s.tenant_id === tenantId);
    if (!parent) return undefined;
    // Eltern-Session: Summary aktualisieren, aber HISTORY BLEIBT VOLLSTÄNDIG (Rotation!)
    parent.short_term_summary_text = summary;
    parent.updated_at_utc = new Date().toISOString();
    // Kind-Session: getrimmte History + Summary, parent_session_id → Eltern-ID
    const parentTitle = typeof parent.session_title === "string" ? parent.session_title : "";
    sessions.push({
      id_uuid: childSessionId,
      tenant_id: tenantId,
      session_title: parentTitle ? `${parentTitle} (Fortsetzung)` : "Fortsetzung",
      conversation_history_json: trimmedHistory as never,
      short_term_summary_text: summary,
      parent_session_id: parent.id_uuid,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    });
    saveFallbackStore();
    registerSessionRotation(tenantId, sessionId, childSessionId);
    return childSessionId;
  }
  // PG-Zweig: Eltern-Session abschließen (NUR Summary — History bleibt vollständig).
  // Titel VOR dem Update lesen (Plan-Review 038: nicht hart „Fortsetzung" schreiben).
  let parentTitle = "";
  const titleRes = await pool.query(
    "SELECT session_title FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1",
    [sessionId, tenantId]
  );
  if (titleRes.rows.length > 0) {
    parentTitle = String(titleRes.rows[0].session_title || "");
  }
  const upd = await pool.query(
    `UPDATE sys_louis_ai_sessions
     SET short_term_summary_text = $1, updated_at_utc = CURRENT_TIMESTAMP
     WHERE id_uuid = $2 AND tenant_id = $3`,
    [summary, sessionId, tenantId]
  );
  if ((upd.rowCount ?? 0) === 0) return undefined;
  // Kind-Session anlegen (getrimmte History + Summary + parent_session_id)
  await pool.query(
    `INSERT INTO sys_louis_ai_sessions
       (id_uuid, tenant_id, session_title, conversation_history_json, short_term_summary_text, parent_session_id, created_at_utc, updated_at_utc)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [childSessionId, tenantId, parentTitle ? `${parentTitle} (Fortsetzung)` : "Fortsetzung", JSON.stringify(trimmedHistory), summary, sessionId]
  );
  registerSessionRotation(tenantId, sessionId, childSessionId);
  return childSessionId;
}

/**
 * #13/#12: Background-Kompression — fire-and-forget, liefert ein Promise (vom Aufrufer
 * mit .catch abgesichert). Läuft NIE auf dem Antwort-Pfad; das Ergebnis wirkt ab dem
 * nächsten Request. Fehler werden geloggt und es wird NICHTS persistiert.
 */
export async function scheduleBackgroundCompression(opts: BackgroundCompressionOptions): Promise<void> {
  const lockKey = `${opts.tenantId}|${opts.sessionId}`;
  if (compressionInFlight.has(lockKey)) return;
  compressionInFlight.add(lockKey);
  try {
    const decision = decideCompression(opts.history, {
      modelName: opts.modelName,
      rawContextMap: opts.rawContextMap ?? undefined,
      thresholdPercent: opts.thresholdPercent,
      tailTokenBudget: opts.tailTokenBudget,
      enabled: true
    });
    if (!decision.needsCompression) return; // native Compaction oder unter Threshold → nichts tun

    // #14: Effektiven Threshold fürs Aux-Modell ableiten (Fenster-Probe)
    const auxModel = opts.auxModel && opts.auxModel.trim() ? opts.auxModel : opts.modelName;
    const feasibility = resolveEffectiveCompressionThreshold(
      auxModel,
      opts.modelName,
      opts.rawContextMap ?? undefined,
      opts.thresholdPercent
    );
    const decision2 = decideCompression(opts.history, {
      modelName: opts.modelName,
      rawContextMap: opts.rawContextMap ?? undefined,
      thresholdPercent: feasibility.effectiveThresholdPercent,
      tailTokenBudget: opts.tailTokenBudget,
      enabled: true
    });
    if (!decision2.needsCompression) return; // nach Feasibility-Senkung unter Threshold

    const { head, middle, tail } = splitHeadTail(opts.history, decision2.tailTokenBudget);
    if (middle.length === 0) return;

 // P0-B: Lock akquirieren VOR dem LLM-Call — sendMessage wartet dann
    // kurz und schreibt nicht parallel in die Session (sonst Nachrichtenverlust).
    if (!tryAcquireCompressionLock(opts.sessionId)) {
      console.warn(`[038 P0-B] Kompressions-Lock für Session ${opts.sessionId} war bereits vergeben — Lauf übersprungen.`);
      return;
    }
    try {
      const config = await getTenantAiConfigCached(opts.tenantId);
      const provider = (config.provider_type || "ollama") as "ollama" | "anthropic" | "openai" | "gemini";
      let cleanApiKey = typeof config.api_key_secret === "string" ? config.api_key_secret.trim() : "";
      if (cleanApiKey.includes("@") || cleanApiKey === "******") cleanApiKey = "";

      const prompt = buildSummarizationPrompt(middle, opts.currentSummary, head, tail);
      const completion = await Promise.race([
        generateContentUniversal({
          provider_type: provider,
          model_name: auxModel,
          api_key_secret: cleanApiKey,
          base_url: (config.base_url as string) || undefined,
          temperature: 0.2,
          contents: prompt
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Background-Kompression Timeout nach ${BACKGROUND_TIMEOUT_MS}ms`)), BACKGROUND_TIMEOUT_MS)
        )
      ]);
      const newSummary = (completion.text as string | undefined)?.trim();
      if (!newSummary) {
        // Timeout/leere Antwort: NICHTS persistieren — der alte Summary bleibt stehen,
        // wird aber nicht stillschweigend als "komprimiert" ausgegeben.
        console.warn(`[Kompressions-Warnung] Background-Kompression lieferte keine Zusammenfassung (Session ${opts.sessionId}) — nichts persistiert.`);
        return;
      }

      if (opts.persistSummary === false) return;
      const trimmedHistory = [buildSummaryContextBlock(newSummary), ...head, ...tail];
      await persistCompressionResult(opts.tenantId, opts.sessionId, newSummary, trimmedHistory);
      console.log(`[Kompression] Background-Kompression ok (Session ${opts.sessionId}): ${opts.history.length} → ${trimmedHistory.length} Nachrichten, Summary ${newSummary.length} Zeichen.`);
    } finally {
      releaseCompressionLock(opts.sessionId);
    }
  } catch (err) {
    console.warn(`[Kompression] Background-Kompression fehlgeschlagen (nichts persistiert): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    compressionInFlight.delete(lockKey);
  }
}

// Lazily gecachte Tenant-Config für den Background-Pfad (kein doppelter Query pro Lauf).
let cachedTenantConfig: { tenantId: string; config: Awaited<ReturnType<typeof getTenantAiConfig>> } | null = null;
async function getTenantAiConfigCached(tenantId: string): Promise<Awaited<ReturnType<typeof getTenantAiConfig>>> {
  if (cachedTenantConfig?.tenantId === tenantId) return cachedTenantConfig.config;
  const config = await getTenantAiConfig(tenantId);
  cachedTenantConfig = { tenantId, config };
  return config;
}
