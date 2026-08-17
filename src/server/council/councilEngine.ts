import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../db.js";
import { callCouncilModelResilient } from "./multiModelClient.js";
import { CouncilSession, CouncilMessage, CouncilParticipant } from "../../types.js";
import { PEER_REVIEW_SYSTEM_PROMPT, CHAIRMAN_SYSTEM_PROMPT, CANONICAL_COUNCIL_ROLES } from "../../lib/schemas.js";
import { v4 as uuidv4 } from "uuid";

const ANONYMOUS_LABELS = ['Antwort A', 'Antwort B', 'Antwort C', 'Antwort D', 'Antwort E', 'Antwort F', 'Antwort G', 'Antwort H'];

export function truncateCouncilMessageContent(content: string, maxTokens: number = 800): string {
  if (!content) return "";
  const estimatedTokens = Math.ceil(content.length / 3.8);
  if (estimatedTokens <= maxTokens) return content;
  
  const charLimit = Math.floor(maxTokens * 3.8);
  return content.slice(0, charLimit) + `\n... [Gekürzt für Räte-Synthese-Budget]`;
}

export async function getCouncilSettings(tenantId: string) {
  if (isUsingFallback) {
    return fallbackStore.councilSettings || {
      enabled: true,
      defaultMode: 'multi-role',
      defaultMaxRounds: 2,
      providers: [],
      roles: CANONICAL_COUNCIL_ROLES,
      peerReviewSystemPrompt: PEER_REVIEW_SYSTEM_PROMPT,
      chairmanSystemPrompt: CHAIRMAN_SYSTEM_PROMPT,
      availableModels: []
    };
  }
  try {
    const res = await pool.query(
      "SELECT settings_json FROM council_settings WHERE tenant_id = $1 LIMIT 1",
      [tenantId]
    );
    if (res.rows.length === 0) {
      return {
        enabled: true,
        defaultMode: 'multi-role',
        defaultMaxRounds: 2,
        providers: [],
        roles: CANONICAL_COUNCIL_ROLES,
        peerReviewSystemPrompt: PEER_REVIEW_SYSTEM_PROMPT,
        chairmanSystemPrompt: CHAIRMAN_SYSTEM_PROMPT,
        availableModels: []
      };
    }
    return {
      peerReviewSystemPrompt: PEER_REVIEW_SYSTEM_PROMPT,
      chairmanSystemPrompt: CHAIRMAN_SYSTEM_PROMPT,
      ...res.rows[0].settings_json
    };
  } catch (err) {
    return {
      enabled: true,
      defaultMode: 'multi-role',
      defaultMaxRounds: 2,
      providers: [],
      roles: CANONICAL_COUNCIL_ROLES,
      peerReviewSystemPrompt: PEER_REVIEW_SYSTEM_PROMPT,
      chairmanSystemPrompt: CHAIRMAN_SYSTEM_PROMPT,
      availableModels: []
    };
  }
}

export async function getCouncilSession(sessionId: string, tenantId: string): Promise<CouncilSession | null> {
  if (isUsingFallback) {
    const list = fallbackStore.councilSessions || [];
    const found = list.find(s => s.id === sessionId);
    return found || null;
  } else {
    const res = await pool.query(
      "SELECT id, topic, mode, status, max_rounds, current_round, participants, final_conclusion, created_at, has_degraded_responses FROM council_sessions WHERE id = $1 AND tenant_id = $2 LIMIT 1",
      [sessionId, tenantId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      topic: r.topic,
      mode: r.mode,
      status: r.status as 'draft' | 'active' | 'completed',
      maxRounds: r.max_rounds,
      currentRound: r.current_round,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      participants: typeof r.participants === 'string' ? JSON.parse(r.participants) : r.participants,
      finalConclusion: r.final_conclusion || undefined,
      hasDegradedResponses: r.has_degraded_responses || false
    };
  }
}

export async function updateCouncilSession(session: CouncilSession, tenantId: string): Promise<void> {
  const hasDegraded = session.participants?.some(p => p.isDegraded) || false;
  session.hasDegradedResponses = hasDegraded;

  if (isUsingFallback) {
    const list = fallbackStore.councilSessions || [];
    const idx = list.findIndex(s => s.id === session.id);
    if (idx !== -1) {
      list[idx] = session;
    } else {
      list.push(session);
    }
    saveFallbackStore();
  } else {
    // Upsert: runCouncilDeliberation (MCP-Pfad) legt die Session direkt per updateCouncilSession an
    // (INSERT … ON CONFLICT DO UPDATE), der Router-Pfad nutzt createSession mit eigenem INSERT.
    await pool.query(
      `INSERT INTO council_sessions (id, tenant_id, topic, mode, status, max_rounds, current_round, participants, final_conclusion, has_degraded_responses, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         topic = EXCLUDED.topic,
         mode = EXCLUDED.mode,
         status = EXCLUDED.status,
         max_rounds = EXCLUDED.max_rounds,
         current_round = EXCLUDED.current_round,
         participants = EXCLUDED.participants,
         final_conclusion = EXCLUDED.final_conclusion,
         has_degraded_responses = EXCLUDED.has_degraded_responses`,
      [
        session.id,
        tenantId,
        session.topic,
        session.mode,
        session.status,
        session.maxRounds,
        session.currentRound,
        JSON.stringify(session.participants),
        session.finalConclusion || null,
        hasDegraded,
        session.createdAt || new Date().toISOString()
      ]
    );
  }
}

export async function saveCouncilMessage(msg: Omit<CouncilMessage, 'id' | 'createdAt'>, tenantId: string): Promise<CouncilMessage> {
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const fullMsg: CouncilMessage = {
    ...msg,
    id,
    createdAt
  };

  if (isUsingFallback) {
    if (!fallbackStore.councilMessages) {
      fallbackStore.councilMessages = [];
    }
    fallbackStore.councilMessages.push(fullMsg);
    saveFallbackStore();
  } else {
    await pool.query(
      `INSERT INTO council_messages (id, session_id, tenant_id, participant_id, round_number, content, created_at, fallback_metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        msg.sessionId,
        tenantId,
        msg.participantId,
        msg.roundNumber,
        msg.content,
        createdAt,
        msg.fallbackMetadata ? JSON.stringify(msg.fallbackMetadata) : null
      ]
    );
  }

  return fullMsg;
}

export async function getCouncilMessages(sessionId: string, tenantId: string): Promise<CouncilMessage[]> {
  if (isUsingFallback) {
    const list = fallbackStore.councilMessages || [];
    return list.filter(m => m.sessionId === sessionId);
  } else {
    const res = await pool.query(
      "SELECT id, session_id, participant_id, round_number, content, created_at, fallback_metadata FROM council_messages WHERE session_id = $1 AND tenant_id = $2 ORDER BY round_number ASC, created_at ASC",
      [sessionId, tenantId]
    );
    return res.rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      participantId: r.participant_id,
      roundNumber: r.round_number,
      content: r.content,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      fallbackMetadata: r.fallback_metadata ? (typeof r.fallback_metadata === 'string' ? JSON.parse(r.fallback_metadata) : r.fallback_metadata) : undefined
    }));
  }
}

export async function runSessionSynthesis(session: CouncilSession, tenantId: string): Promise<string> {
  const allMessages = await getCouncilMessages(session.id, tenantId);
  const phase1Msgs = allMessages.filter(m => m.roundNumber === 1);
  const phase2Msgs = allMessages.filter(m => m.roundNumber >= 2);
  
  let chairmanContext = `URSPRÜNGLICHE ANFRAGE / TOPIC:\n"${session.topic}"\n\n`;

  chairmanContext += `=== PHASE 1: DIE INITIALEN LÖSUNGSANSÄTZE DER BERATER-ROLLEN ===\n\n`;
  phase1Msgs.forEach((msg, idx) => {
    const label = ANONYMOUS_LABELS[idx] || `Antwort ${idx + 1}`;
    const part = session.participants.find(p => p.id === msg.participantId);
    const fallbackNote = msg.fallbackMetadata?.usedFallback ? ` (via Fallback-Modell ${msg.fallbackMetadata.actualProviderId})` : '';
    const truncatedContent = truncateCouncilMessageContent(msg.content, 700);
    chairmanContext += `[${label} - Rolle: ${part?.name || 'Berater'}${fallbackNote}]\n${truncatedContent}\n\n`;
  });

  if (phase2Msgs.length > 0) {
    chairmanContext += `=== PHASE 2: PEER-REVIEWS, BEWERTUNGEN & RANKINGS ===\n\n`;
    phase2Msgs.forEach((msg) => {
      const part = session.participants.find(p => p.id === msg.participantId);
      const truncatedContent = truncateCouncilMessageContent(msg.content, 600);
      chairmanContext += `[Gutachten von Reviewer ${part?.name || 'Gutachter'} (Runde ${msg.roundNumber})]\n${truncatedContent}\n\n`;
    });
  }

  const userPrompt = `${chairmanContext}\nBitte erstelle als Chairman des Expertenrats nun das finale Urteil, die Konsensanalyse sowie die konkrete Handlungsempfehlung mit den nächsten drei Schritten.`;

  const settings = await getCouncilSettings(tenantId);
  const chairmanPrompt = settings.chairmanSystemPrompt || CHAIRMAN_SYSTEM_PROMPT;

  const result = await callCouncilModelResilient({
    providerId: 'louis-chat',
    modelId: '',
    systemPrompt: chairmanPrompt,
    userPrompt,
    temperature: 0.4,
    tenantId,
    participantName: 'Chairman des Expertenrats'
  });

  return result.text;
}

export async function executeCouncilStep(sessionId: string, tenantId: string): Promise<void> {
  const session = await getCouncilSession(sessionId, tenantId);
  if (!session) throw new Error("Session nicht gefunden.");
  if (session.status === 'completed') return;

  const currentRound = session.currentRound;
  const isFirstRound = currentRound === 1;
  const allMessages = await getCouncilMessages(sessionId, tenantId);

  if (isFirstRound) {
    // PHASE 1: Brainstorming (Parallelisierte Ausführung der Berater-Rollen)
    const participantPromises = session.participants.map(async (participant) => {
      const userPrompt = `Das Thema zur Diskussion lautet:\n"${session.topic}"\n\nBitte analysiere dieses Thema exakt aus deiner zugewiesenen Spezialrolle ("${participant.name}") heraus und erstelle einen ersten detaillierten Lösungsentwurf.`;

      const result = await callCouncilModelResilient({
        providerId: participant.providerId,
        modelId: participant.modelId,
        systemPrompt: participant.systemPrompt,
        userPrompt,
        temperature: participant.temperature,
        tenantId,
        participantName: participant.name
      });

      if (result.metadata.usedFallback) {
        participant.isDegraded = true;
      }

      await saveCouncilMessage({
        sessionId,
        participantId: participant.id,
        roundNumber: 1,
        content: result.text,
        fallbackMetadata: result.metadata
      }, tenantId);
    });

    await Promise.all(participantPromises);
  } else {
    // PHASE 2: Anonymisiertes Peer Review (Parallelisierte Ausführung)
    const settings = await getCouncilSettings(tenantId);
    const basePeerReviewPrompt = settings.peerReviewSystemPrompt || PEER_REVIEW_SYSTEM_PROMPT;

    const prevRoundMsgs = allMessages.filter(m => m.roundNumber === currentRound - 1);

    let anonymizedAnswers = '';
    prevRoundMsgs.forEach((msg, idx) => {
      const label = ANONYMOUS_LABELS[idx] || `Antwort ${idx + 1}`;
      const truncatedContent = truncateCouncilMessageContent(msg.content, 600);
      anonymizedAnswers += `=== ${label} ===\n${truncatedContent}\n\n`;
    });

    const participantPromises = session.participants.map(async (participant) => {
      const userPrompt = `URSPRÜNGLICHE FRAGE / THEMA:\n"${session.topic}"\n\nVORLIEGENDE ANONYMISIERTE LÖSUNGSANSÄTZE AUS RUNDE ${currentRound - 1}:\n\n${anonymizedAnswers}\nBitte erstelle deine unabhängige Bewertung, Kritik und dein Ranking der Lösungsansätze unter Berücksichtigung deiner Spezialrolle "${participant.name}".`;

      const reviewSystemPrompt = `${basePeerReviewPrompt}\n\nBehalte dabei deine spezifische Perspektive als "${participant.name}" bei:\n${participant.systemPrompt}`;

      const result = await callCouncilModelResilient({
        providerId: participant.providerId,
        modelId: participant.modelId,
        systemPrompt: reviewSystemPrompt,
        userPrompt,
        temperature: participant.temperature,
        tenantId,
        participantName: participant.name
      });

      if (result.metadata.usedFallback) {
        participant.isDegraded = true;
      }

      await saveCouncilMessage({
        sessionId,
        participantId: participant.id,
        roundNumber: currentRound,
        content: result.text,
        fallbackMetadata: result.metadata
      }, tenantId);
    });

    await Promise.all(participantPromises);
  }

  if (currentRound >= session.maxRounds) {
    session.status = 'completed';
    session.finalConclusion = await runSessionSynthesis(session, tenantId);
  } else {
    session.currentRound += 1;
    session.status = 'active';
  }

  await updateCouncilSession(session, tenantId);
}

export async function runCouncilDeliberation(params: {
  prompt: string;
  tenantId: string;
  mode?: 'multi-role' | 'multi-model';
}) {
  const sessionId = uuidv4();
  const settings = await getCouncilSettings(params.tenantId);
  const session: CouncilSession = {
    id: sessionId,
    topic: params.prompt,
    mode: params.mode || (settings.defaultMode as 'multi-role' | 'multi-model') || 'multi-role',
    status: 'active',
    maxRounds: settings.defaultMaxRounds || 2,
    currentRound: 1,
    createdAt: new Date().toISOString(),
    participants: (settings.roles || CANONICAL_COUNCIL_ROLES).map((r: { roleName?: string; name?: string; systemPrompt?: string }, idx: number) => ({
      id: `p-${idx + 1}`,
      name: r.roleName || r.name || `Rolle ${idx + 1}`,
      systemPrompt: r.systemPrompt || '',
      providerId: 'louis-chat',
      modelId: '',
      temperature: 0.7
    }))
  };

  await updateCouncilSession(session, params.tenantId);
  await executeCouncilStep(sessionId, params.tenantId);
  const updatedSession = await getCouncilSession(sessionId, params.tenantId);
  const messages = await getCouncilMessages(sessionId, params.tenantId);

  return {
    session: updatedSession,
    messages
  };
}
