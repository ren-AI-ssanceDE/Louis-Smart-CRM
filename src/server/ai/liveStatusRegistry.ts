// ============================================================================
// 052 (2026-08-21, 048-B1): Live-Status-Registry für den Chat.
// ----------------------------------------------------------------------------
// Hält pro Session eine REFERENZ auf das laufende thoughtLog-Array des
// Agent-Pipeline-Contexts (agentRuntime.ts: result.thoughtLog === context.thoughtLog).
// KEIN Kopieren, KEIN zusätzlicher Push-Code — getChatRunStatus liest live.
// TTL-Cleanup (Lehre 038): Eintrag wird 30s nach Lauf-Ende gelöscht (Grace für
// den letzten Poll), damit die Map nicht wächst.
// ============================================================================
import type { AgentPipelineContext } from "./agentTypes.js";

export type LiveStatusKind = "tool" | "workflow" | "skill" | "phase";

export interface LiveStatusEntry {
  /** Das thoughtLog-Array des laufenden Pipeline-Contexts (Referenz, kein Copy). */
  lines: string[];
  startedAt: number;
  /** Set wenn der Lauf beendet ist (finally) — TTL-Timer läuft dann. */
  endedAt?: number;
}

export interface ChatRunStatus {
  active: boolean;
  current: { kind: LiveStatusKind; label: string } | null;
  lines: string[];
}

const registry = new Map<string, LiveStatusEntry>();
const TTL_AFTER_END_MS = 30_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clearTimer(sessionId: string): void {
  const t = timers.get(sessionId);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(sessionId);
  }
}

/** Registriert den Lauf VOR executePipeline (Referenz auf context.thoughtLog). */
export function registerChatRun(sessionId: string, lines: string[]): void {
  if (!sessionId) return;
  clearTimer(sessionId);
  registry.set(sessionId, { lines, startedAt: Date.now() });
}

/** Markiert Lauf-Ende (finally) — TTL-Timer startet. */
export function markChatRunEnded(sessionId: string): void {
  const entry = registry.get(sessionId);
  if (!entry) return;
  entry.endedAt = Date.now();
  clearTimer(sessionId);
  timers.set(
    sessionId,
    setTimeout(() => {
      registry.delete(sessionId);
      timers.delete(sessionId);
    }, TTL_AFTER_END_MS)
  );
}

/** Für Tests: Registry leeren (kein Export in Produktion nötig). */
export function _clearChatRunRegistryForTests(): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  registry.clear();
}

/**
 * Parst ThoughtLog-Zeilen in einen kompakten Live-Status.
 * - `Executing tool "X"` (agentRuntime.ts:2359) → tool
 * - `[S5] Führe Workflow "X" aus` (052-neu) → workflow
 * - `Verwendete Skills: x, y` → skill
 * - `[Runtime Phase N] …` → phase
 * Gibt die LETZTE relevante Zeile zurück (aktuellster Zustand).
 */
export function extractLiveStatus(lines: string[] | undefined | null): { kind: LiveStatusKind; label: string } | null {
  if (!lines || lines.length === 0) return null;
  let current: { kind: LiveStatusKind; label: string } | null = null;
  for (const raw of lines) {
    const line = String(raw || "");
    const tool = line.match(/^Executing tool "([^"]+)"/);
    if (tool) {
      current = { kind: "tool", label: tool[1] };
      continue;
    }
    const workflow = line.match(/Führe Workflow "([^"]+)"/);
    if (workflow) {
      current = { kind: "workflow", label: workflow[1] };
      continue;
    }
    const skills = line.match(/Verwendete Skills:\s*(.+)/);
    if (skills && skills[1].trim()) {
      current = { kind: "skill", label: skills[1].split(",")[0].trim() };
      continue;
    }
    const phase = line.match(/^\[Runtime Phase (\d+)\]/);
    if (phase) {
      current = { kind: "phase", label: `Phase ${phase[1]}` };
    }
  }
  return current;
}

/** tRPC-Antwort: Fail-open (kein Eintrag/abgelaufen → active:false). */
export function getChatRunStatus(sessionId: string): ChatRunStatus {
  const entry = sessionId ? registry.get(sessionId) : undefined;
  if (!entry) {
    return { active: false, current: null, lines: [] };
  }
  return {
    active: entry.endedAt === undefined,
    current: extractLiveStatus(entry.lines),
    lines: entry.lines,
  };
}
