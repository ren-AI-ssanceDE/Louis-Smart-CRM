// ============================================================================
// 089: Reine Status-Logik für die Council-Tisch-Fortschrittsanzeige.
// Kein React-Import — Unit-testbar in node-Env (R-AR-10, wrappbar).
// Status je Council-Member: waiting (wartet) → working (arbeitet) → done (Antwort da).
// Phase: idle | brainstorming | peer-review | synthesis (Chairman arbeitet).
// ============================================================================

export type CouncilMemberStatus = 'waiting' | 'working' | 'done';
export type CouncilTablePhase = 'idle' | 'brainstorming' | 'peer-review' | 'synthesis';

export interface CouncilTableMessageLike {
  participantId: string;
  roundNumber: number;
}

export interface CouncilMemberStatusParams {
  participantId: string;
  messages: CouncilTableMessageLike[];
  /** Aktive Runde (currentRound) — Status ist rundengebunden (R2-Reset). */
  round: number;
  isRunning: boolean;
  phase: CouncilTablePhase;
}

/** Status eines Council-Members für die aktive Runde. */
export function getCouncilMemberStatus(params: CouncilMemberStatusParams): CouncilMemberStatus {
  const { participantId, messages, round, isRunning, phase } = params;
  const hasAnswer = messages.some((m) => m.participantId === participantId && m.roundNumber === round);
  if (hasAnswer) return 'done';
  if (isRunning && phase !== 'idle') return 'working';
  return 'waiting';
}

export interface CouncilPhaseParams {
  isRunning: boolean;
  currentRound: number;
  maxRounds: number;
  participantsCount: number;
  messages: CouncilTableMessageLike[];
}

/**
 * Phase der Council-Ausführung:
 * - idle: nicht in einer Runde (Bereit-Ansicht)
 * - brainstorming: Runde 1 läuft, Antworten fehlen noch
 * - peer-review: Runde 2+ läuft, Antworten fehlen noch
 * - synthesis: letzte Runde (currentRound === maxRounds) UND alle Antworten da
 *   → der Chairman (Vorsitzende) arbeitet an der Synthese (läuft in derselben
 *   executeStep-Mutation nach den letzten Rollen-Antworten).
 */
export function getCouncilPhase(params: CouncilPhaseParams): CouncilTablePhase {
  const { isRunning, currentRound, maxRounds, participantsCount, messages } = params;
  if (!isRunning) return 'idle';

  const roundAnswers = messages.filter((m) => m.roundNumber === currentRound).length;
  if (currentRound === maxRounds && roundAnswers >= participantsCount) return 'synthesis';
  if (currentRound === 1) return 'brainstorming';
  return 'peer-review';
}

/** Anzahl der fertigen Antworten der aktiven Runde (für den Zähler „x/total"). */
export function countRoundAnswers(messages: CouncilTableMessageLike[], round: number): number {
  return messages.filter((m) => m.roundNumber === round).length;
}

/**
 * 090: Auto-Modus — soll nach einer beendeten Runde automatisch die nächste
 * gestartet werden? (Die letzte Runde enthält die Synthese in derselben
 * Mutation; die Kette endet nach completed.)
 */
export function shouldAutoAdvance(params: {
  autoMode: boolean;
  status: string;
  currentRound: number;
  maxRounds: number;
}): boolean {
  const { autoMode, status, currentRound, maxRounds } = params;
  if (!autoMode) return false;
  if (status === 'completed') return false;
  return currentRound < maxRounds;
}
