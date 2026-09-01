import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Loader2, CheckCircle2, Crown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { CouncilParticipant, CouncilMessage } from '../../types';
import {
  getCouncilMemberStatus,
  getCouncilPhase,
  countRoundAnswers,
  CouncilMemberStatus,
  CouncilTablePhase,
} from '../../lib/councilStatus';

// ============================================================================
// 090: Tisch-Fortschrittsanzeige des LLM Council (Optik-Überarbeitung).
// Tisch-Oval mit scharfer Kontur + zentralem Label; 5 Member-Plätze rundum +
// Vorsitzender an der Kopfseite (mit klarem Abstand zum Aktionsbereich).
// Member-Status live: waiting (grau) → working (amber, animiert) → done (grün).
// Status/Zähler beziehen sich auf die AKTIVE TAB-Runde (activeRound); die Phase
// (brainstorming/peer-review/synthesis) auf den Session-Stand (currentRound).
// Reine Darstellung — Status-Logik in src/lib/councilStatus.ts (unit-getestet).
// ============================================================================

interface CouncilTableProps {
  participants: CouncilParticipant[];
  messages: CouncilMessage[];
  /** Aktive Tab-Runde (bestimmt Member-Status + Zähler) */
  activeRound: number;
  /** Session-Stand (bestimmt die Phase, inkl. Chairman-Synthese) */
  currentRound: number;
  maxRounds: number;
  isRunning: boolean;
  roundStartedAt: number | null;
}

// Plätze um den Tisch (left%, top%) — alle so gesetzt, dass die Plätze samt
// Namen/Status im Container bleiben und Abstand zu Titel (oben) und Button
// (unten) halten. hinten-mitte schwebt über dem Oval, Chairman vorn-mitte.
const MEMBER_POSITIONS: Array<{ left: number; top: number }> = [
  { left: 14, top: 20 },  // links oben
  { left: 86, top: 20 },  // rechts oben
  { left: 14, top: 80 },  // links unten
  { left: 86, top: 80 },  // rechts unten
  { left: 50, top: 12 },  // hinten Mitte (über dem Oval, mit Luft zu Titel UND Oval)
];
const CHAIRMAN_POSITION = { left: 50, top: 90 };

function memberStatusClasses(status: CouncilMemberStatus): string {
  switch (status) {
    case 'working':
      return 'bg-amber-500/15 border-amber-400 text-amber-300 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]';
    case 'done':
      return 'bg-emerald-500/15 border-emerald-400 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]';
    default:
      return 'bg-slate-800/80 border-slate-600/60 text-slate-400';
  }
}

function memberStatusIcon(status: CouncilMemberStatus) {
  if (status === 'working') return <Loader2 size={18} className="animate-spin" />;
  if (status === 'done') return <CheckCircle2 size={18} />;
  return <User size={18} />;
}

export const CouncilTable = ({
  participants,
  messages,
  activeRound,
  currentRound,
  maxRounds,
  isRunning,
  roundStartedAt,
}: CouncilTableProps) => {
  const { t } = useTranslation('council');

  const phase: CouncilTablePhase = getCouncilPhase({
    isRunning,
    currentRound,
    maxRounds,
    participantsCount: participants.length,
    messages,
  });

  const doneCount = countRoundAnswers(messages, activeRound);
  const chairmanWorking = phase === 'synthesis';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning || !roundStartedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, roundStartedAt]);

  const elapsed = isRunning && roundStartedAt ? Math.max(0, Math.floor((now - roundStartedAt) / 1000)) : 0;
  const longRunning = elapsed > 120 && isRunning;

  return (
    <div data-testid="council-table" className="space-y-4">
      {/* Tisch-Szene */}
      <div className="relative w-full h-80 md:h-96 select-none">
        {/* Tisch-Oval: scharfe Kontur, Verlauf, innerer Ring, zentrales Label + Zähler */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[50%] h-[46%] rounded-[50%] border border-accent-orange/40 bg-[radial-gradient(ellipse_at_center,rgba(249,115,22,0.10),rgba(0,0,0,0.28))] shadow-[inset_0_0_30px_rgba(0,0,0,0.45)]">
          <div className="absolute inset-2 rounded-[50%] border border-accent-orange/15" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-[10px] font-display uppercase tracking-[0.35em] text-accent-orange/30 pl-1">
              {t('council:table_label', { defaultValue: 'Council' })}
            </span>
            <div className="flex items-center gap-3">
              <span
                data-testid="council-progress"
                className="text-[11px] font-mono uppercase tracking-wider text-slate-400"
              >
                {t('council:table_progress', {
                  defaultValue: '{{done}}/{{total}} Antworten',
                  done: doneCount,
                  total: participants.length,
                })}
              </span>
              {isRunning && roundStartedAt && (
                <span className="text-[11px] font-mono text-slate-500">
                  {t('council:table_elapsed', { defaultValue: 'Laufzeit: {{s}}s', s: elapsed })}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Member-Plätze */}
        {participants.slice(0, 5).map((participant, idx) => {
          const pos = MEMBER_POSITIONS[idx] || MEMBER_POSITIONS[MEMBER_POSITIONS.length - 1];
          const status = getCouncilMemberStatus({
            participantId: participant.id,
            messages,
            round: activeRound,
            isRunning,
            phase,
          });
          const label =
            status === 'done'
              ? t('council:table_member_done', { defaultValue: 'Antwort' })
              : status === 'working'
                ? t('council:table_member_working', { defaultValue: 'arbeitet…' })
                : t('council:table_member_waiting', { defaultValue: 'wartet' });
          // Antwortzeit je Member: created_at der Antwort minus Rundenstart (client-seitig)
          const answerMsg = messages.find((m) => m.participantId === participant.id && m.roundNumber === activeRound);
          const answerSeconds =
            status === 'done' && answerMsg && roundStartedAt
              ? Math.max(0, Math.round((new Date(answerMsg.createdAt).getTime() - roundStartedAt) / 1000))
              : null;
          return (
            <div
              key={participant.id}
              data-testid="council-member"
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 w-28"
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            >
              <div
                className={cn(
                  'h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300',
                  memberStatusClasses(status)
                )}
              >
                {memberStatusIcon(status)}
              </div>
              <span className="text-[10px] font-mono text-slate-300 text-center leading-tight max-w-[110px] break-words">
                {participant.name}
              </span>
              <span
                className={cn(
                  'text-[9px] font-mono uppercase tracking-wide',
                  status === 'done' ? 'text-emerald-400' : status === 'working' ? 'text-amber-400' : 'text-slate-500'
                )}
              >
                {label}
              </span>
              {answerSeconds !== null && (
                <span className="text-[9px] font-mono text-emerald-500/80">
                  {t('council:table_answer_time', { defaultValue: 'in {{s}}s', s: answerSeconds })}
                </span>
              )}
            </div>
          );
        })}

        {/* Vorsitzender (Chairman) — mit Abstand zum Aktionsbereich */}
        <div
          data-testid="council-chairman"
          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 w-28"
          style={{ left: `${CHAIRMAN_POSITION.left}%`, top: `${CHAIRMAN_POSITION.top}%` }}
        >
          <div
            className={cn(
              'h-10 w-10 rounded-full border flex items-center justify-center transition-all duration-300',
              chairmanWorking
                ? 'bg-amber-500/15 border-amber-400 text-amber-300 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                : 'bg-slate-800/80 border-slate-600/60 text-slate-400'
            )}
          >
            {chairmanWorking ? <Loader2 size={18} className="animate-spin" /> : <Crown size={18} />}
          </div>
          <span className="text-[10px] font-mono text-slate-300 text-center leading-tight max-w-[110px] break-words">
            {t('council:table_chairman', { defaultValue: 'Vorsitzender' })}
          </span>
          <span className={cn('text-[9px] font-mono uppercase tracking-wide', chairmanWorking ? 'text-amber-400' : 'text-slate-500')}>
            {chairmanWorking
              ? t('council:table_synthesis_working', { defaultValue: 'arbeitet…' })
              : t('council:table_member_waiting', { defaultValue: 'wartet' })}
          </span>
        </div>
      </div>

      {/* Langlauf-Hinweis: beruhigt statt Timeout-Gefühl */}
      {longRunning && (
        <p className="text-[11px] font-mono text-amber-400/90 text-center">
          {t('council:table_long_running_hint', {
            defaultValue: 'Läuft noch — einzelne Antworten dauern unterschiedlich lange. Kein Timeout.',
          })}
        </p>
      )}
    </div>
  );
};
