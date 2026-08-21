// ============================================================================
// Phase 4 (Parität): Fehlerfestigkeit — Response-Guards
// #31 Empty-Response-Guard (leer/zu kurz → Retry; deterministischer Streak + Kostenbudget → Abbruch)
// #32 Repetition-Guard (60+-Zeichen-Fragment > 50 % der Antwort → abfangen)
// #41 Turn-Finalizer (reine Tool-Call-Tails + Verifikations-Scaffolding aus finaler Antwort entfernen)
// #42 Tool-Result-Klassifikation (Tool-Ergebnis als Fehler/Erfolg — Grundlage für Guardrails)
// Reine, deterministische Funktionen — kein any (Regel 4), testbar. Fail-open:
// Guards blocken NIE legitime Antworten (nur klare Muster).
// ============================================================================

// ── #31 Empty-Response-Guard ─────────────────────────────────────────────────
/** Antwort ist leer oder nur Whitespace → Retry-Kandidat. */
export function isEmptyResponse(text: string | null | undefined): boolean {
  return !text || text.trim().length < 3;
}

/**
 * Deterministischer Streak: N aufeinanderfolgende leere Antworten mit 0 Output-Tokens
 * (gleiche Signatur) → Abbruch statt sinnlosem Retry (Muster empty_response_guard.py).
 */
export interface EmptyStreakState {
  streak: number;
  spentUsd: number;
}

export function isDeterministicEmptyStreak(streak: number, minStreak: number): boolean {
  return streak >= minStreak;
}

/** Kostenbudget: teurer Streak → früher abbrechen (Muster empty_response_guard.py:254). */
export function exceedsEmptyRetryCost(spentUsd: number, thresholdUsd: number): boolean {
  return spentUsd > 0 && thresholdUsd > 0 && spentUsd >= thresholdUsd;
}

// ── #32 Repetition-Guard ─────────────────────────────────────────────────────
/**
 * Längstes sich wiederholendes Fragment (≥ fragmentMinLen) als Anteil der Antwort.
 * Implementierung: Vergleich des Texts mit sich selbst bei Verschiebung i — die längste
 * übereinstimmende Kette ist ein wiederholtes Fragment. O(n²) — Antworten sind kurz.
 */
export function findLongestRepeatedFragment(text: string): { fragment: string; length: number } {
  const t = text || "";
  if (t.length < 2) return { fragment: "", length: 0 };
  let bestLen = 0;
  let bestStart = 0;
  const n = t.length;
  for (let shift = 1; shift < n; shift++) {
    let run = 0;
    let runStart = 0;
    for (let i = 0; i + shift < n; i++) {
      if (t[i] === t[i + shift]) {
        if (run === 0) runStart = i;
        run++;
        if (run > bestLen) {
          bestLen = run;
          bestStart = runStart;
        }
      } else {
        run = 0;
      }
    }
  }
  return { fragment: t.slice(bestStart, bestStart + bestLen), length: bestLen };
}

/**
 * Antwort von Wiederholungen dominiert? Fragment ≥ 60 Zeichen UND > 50 % der Antwort.
 * Fail-open: nur bei klarem Muster true (Muster repetition_guard.py:43).
 */
export function isRepetitionDominated(
  text: string | null | undefined,
  fragmentMinLen: number = 60,
  ratioThreshold: number = 0.5
): boolean {
  const t = (text || "").trim();
  if (t.length < fragmentMinLen * 2) return false;
  const { length } = findLongestRepeatedFragment(t);
  if (length < fragmentMinLen) return false;
  return length / t.length > ratioThreshold;
}

// ── #41 Turn-Finalizer ───────────────────────────────────────────────────────
/** Reine Tool-Call-/Scaffolding-Tails aus der finalen Antwort entfernen (fail-open). */
const FINALIZER_TAIL_PATTERNS: RegExp[] = [
  // Nachklappende Verifikations-/Tool-Protokoll-Sätze
  /(?:\n|^)(?:Verifiziert|Tool(?:[ -]?Ausführung| execution)? (?:abgeschlossen|complete)|Ausführung abgeschlossen|Ich habe (?:die )?folgende[n]? (?:Tools|Schritte|Aktionen)|Alle (?:Tools|Schritte) (?:wurden|sind)|Datenbank-?(?:Check|Verifikation)|DB-?Verifikation)[^\n]*\n?/gi,
  // JSON-Objekt als letzter Rest (Tool-Query-Format) — nur wenn es am ENDE steht
  /(?:\n|^)\{[^{}]*"query"\s*:[\s\S]{0,200}\}\s*$/,
  // "Thought:"-Zeilen am Ende (internes Reasoning)
  /(?:\n|^)Thought:\s*[^\n]*$/gi
];

export function stripTurnFinalizerScaffolding(text: string | null | undefined): string {
  if (!text) return "";
  let out = (text || "").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of FINALIZER_TAIL_PATTERNS) {
      const m = pattern.exec(out);
      if (m) {
        // Tail = der Match steht am ENDE (danach kommt nur noch Whitespace) — nie mitten in der Antwort
        const afterMatch = out.slice(m.index + m[0].length);
        const isTail = afterMatch.trim() === "";
        if (isTail) {
          const before = out.slice(0, m.index).replace(/[\s,;:]+$/, "");
          if (before.trim().length > 0) {
            out = before;
            changed = true;
          }
        }
      }
    }
    // Mehrfach-Durchlauf für verkettete Tails
    if (changed && out.length < 40) break; // Rest zu kurz → fertig
  }
  return out.trim();
}

// ── #42 Tool-Result-Klassifikation ───────────────────────────────────────────
export type ToolResultClass = "success" | "error" | "unknown";

/**
 * Klassifiziert ein Tool-Ergebnis als Fehler/Erfolg (Grundlage für Guardrail-Feedback).
 * Fail-open: unbekannte Formate gelten als success (nie legitime Antworten blocken).
 */
export function classifyToolResult(toolName: string, result: unknown): ToolResultClass {
  void toolName;
  if (typeof result === "string") {
    const t = result.trim().toLowerCase();
    if (t.length === 0) return "unknown";
    if (/^(fehler|error|❌|failed|failure)/i.test(t)) return "error";
    return "success";
  }
  if (typeof result === "object" && result !== null) {
    const r = result as Record<string, unknown>;
    if (r.success === false || r.ok === false) return "error";
    if (typeof r.error === "string" && r.error.length > 0) return "error";
    if (typeof r.result === "string" && /^(fehler|error|❌)/i.test(r.result)) return "error";
    if (r.success === true || r.ok === true) return "success";
  }
  return "unknown";
}
