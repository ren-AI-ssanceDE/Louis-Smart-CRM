// ============================================================================
// Phase 4 (Parität): Fehlerfestigkeit — Tool-Guardrails
// #40 Gleicher Tool-Call mit gleichen Args > N× fehlgeschlagen → blocken mit
// Strategie-Hinweis; No-Progress-Detection; pro-Turn-Caps.
// Muster: fail-open — nie legitime Antworten blocken).
// Reine Zustandslogik, kein any (Regel 4), testbar.
// ============================================================================

import { ToolResultClass } from "./responseGuards.js";

export interface ToolGuardrailConfig {
  /** Gleicher Tool-Call (Name+Query) mit Fehler-Klasse > N× → blocken. */
  exactFailureBlock: number;
  /** N aufeinanderfolgende Tool-Runden ohne Fortschritt → Hinweis. */
  noProgressBlock: number;
}

export interface GuardrailCheck {
  blocked: boolean;
  hint?: string;
}

interface CallRecord {
  toolName: string;
  query: string;
  errorCount: number;
}

export class ToolGuardrails {
  private readonly config: ToolGuardrailConfig;
  private readonly calls: CallRecord[] = [];
  private consecutiveNoProgress = 0;
  private totalExecutions = 0;
  private lastProgressTool = "";

  constructor(config?: Partial<ToolGuardrailConfig>) {
    this.config = {
      exactFailureBlock: config?.exactFailureBlock ?? 3,
      noProgressBlock: config?.noProgressBlock ?? 3
    };
  }

  /** Registriert einen Tool-Call mit klassifiziertem Ergebnis (#42). */
  record(toolName: string, query: string, resultClass: ToolResultClass): void {
    this.totalExecutions++;
    const existing = this.calls.find((c) => c.toolName === toolName && c.query === query);
    if (resultClass === "error") {
      if (existing) {
        existing.errorCount++;
      } else {
        this.calls.push({ toolName, query, errorCount: 1 });
      }
      this.consecutiveNoProgress++;
    } else if (resultClass === "success") {
      if (existing) existing.errorCount = 0;
      this.consecutiveNoProgress = 0;
      this.lastProgressTool = toolName;
    }
    // unknown → neutral (kein Zähler-Reset, kein Inkrement)
  }

  /**
   * Prüft VOR der Ausführung: blocken, wenn derselbe Call schon zu oft fehlgeschlagen ist.
   * Fail-open: blocken erzeugt nur einen Hinweis (retryDirective) — nie einen Loop-Abbruch.
   */
  checkExactFailure(toolName: string, query: string): GuardrailCheck {
    const rec = this.calls.find((c) => c.toolName === toolName && c.query === query);
    if (rec && rec.errorCount > this.config.exactFailureBlock) {
      return {
        blocked: true,
        hint: `🚨 GUARDRAIL: Der Tool-Aufruf "${toolName}" ist mit diesen Argumenten ${rec.errorCount}× fehlgeschlagen. Ändere die Argumente, nutze ein anderes Tool oder beende die Aufgabe mit isComplete=true.`
      };
    }
    return { blocked: false };
  }

  /** No-Progress: viele Fehler hintereinander ohne Erfolg → Strategie-Hinweis. */
  checkNoProgress(): GuardrailCheck {
    if (this.consecutiveNoProgress >= this.config.noProgressBlock) {
      return {
        blocked: true,
        hint: `🚨 GUARDRAIL: ${this.consecutiveNoProgress} Tool-Ausführungen in Folge ohne Fortschritt. Überprüfe die Strategie: andere Argumente, anderes Tool, oder die Aufgabe mit den vorhandenen Ergebnissen beenden (isComplete=true).`
      };
    }
    return { blocked: false };
  }

  get total(): number {
    return this.totalExecutions;
  }

  get noProgressCount(): number {
    return this.consecutiveNoProgress;
  }
}
