import { z } from "zod";
import fs from "fs";
import path from "path";
import { router, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../db.js";
import { CouncilSettingsSchema, CANONICAL_COUNCIL_ROLES, PEER_REVIEW_SYSTEM_PROMPT, CHAIRMAN_SYSTEM_PROMPT } from "../../lib/schemas.js";
import { getCouncilSession, getCouncilMessages, executeCouncilStep } from "../council/councilEngine.js";
import { forceManualIngest } from "../storage.js";
import { v4 as uuidv4 } from "uuid";
import { CouncilSession } from "../../types.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";

const CouncilParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number(),
  roleId: z.string().optional()
});

const CouncilSessionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  mode: z.enum(['multi-role', 'multi-model']),
  status: z.enum(['draft', 'active', 'completed']),
  maxRounds: z.number(),
  currentRound: z.number(),
  createdAt: z.string(),
  participants: z.array(CouncilParticipantSchema),
  finalConclusion: z.string().optional()
});

const CouncilMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  roundNumber: z.number(),
  participantId: z.string(),
  role: z.string().optional(),
  content: z.string(),
  createdAt: z.string(),
  fallbackMetadata: z.object({
    usedFallback: z.boolean().optional(),
    originalModel: z.string().optional(),
    fallbackModel: z.string().optional(),
    reason: z.string().optional()
  }).optional()
});

const defaultSettings = {
  enabled: true,
  defaultMode: 'multi-role' as const,
  defaultMaxRounds: 2,
  providers: [],
  roles: CANONICAL_COUNCIL_ROLES,
  peerReviewSystemPrompt: PEER_REVIEW_SYSTEM_PROMPT,
  chairmanSystemPrompt: CHAIRMAN_SYSTEM_PROMPT,
  availableModels: []
};

export const councilRouter = router({
  getSettings: protectedProcedure
    .output(CouncilSettingsSchema)
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return fallbackStore.councilSettings || defaultSettings;
      }
      const res = await pool.query(
        "SELECT settings_json FROM council_settings WHERE tenant_id = $1 LIMIT 1",
        [ctx.tenantId]
      );
      if (res.rows.length === 0) {
        return defaultSettings;
      }
      return {
        ...defaultSettings,
        ...res.rows[0].settings_json
      };
    }),

  updateSettings: protectedProcedure
    .input(CouncilSettingsSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.councilSettings = input;
        saveFallbackStore();
        return { success: true };
      }
      await pool.query(
        `INSERT INTO council_settings (tenant_id, settings_json, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id) DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = CURRENT_TIMESTAMP`,
        [ctx.tenantId, JSON.stringify(input)]
      );
      return { success: true };
    }),

  getCouncilSessions: protectedProcedure
    .output(z.array(CouncilSessionSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return fallbackStore.councilSessions || [];
      }
      const res = await pool.query(
        "SELECT id, topic, mode, status, max_rounds, current_round, participants, final_conclusion, created_at FROM council_sessions WHERE tenant_id = $1 ORDER BY created_at DESC",
        [ctx.tenantId]
      );
      return res.rows.map(r => ({
        id: r.id,
        topic: r.topic,
        mode: r.mode as 'multi-role' | 'multi-model',
        status: r.status as 'draft' | 'active' | 'completed',
        maxRounds: r.max_rounds,
        currentRound: r.current_round,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        participants: typeof r.participants === 'string' ? JSON.parse(r.participants) : r.participants,
        finalConclusion: r.final_conclusion || undefined
      }));
    }),

  getCouncilSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({
      session: CouncilSessionSchema,
      messages: z.array(CouncilMessageSchema)
    }))
    .query(async ({ input, ctx }) => {
      const session = await getCouncilSession(input.id, ctx.tenantId);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session nicht gefunden." });
      }
      const messages = await getCouncilMessages(input.id, ctx.tenantId);
      return {
        session,
        messages
      };
    }),

  createSession: protectedProcedure
    .input(z.object({
      topic: z.string().min(1),
      mode: z.enum(['multi-role', 'multi-model']),
      maxRounds: z.number().min(1).max(5),
      participants: z.array(z.object({
        id: z.string(),
        name: z.string(),
        providerId: z.string(),
        modelId: z.string(),
        systemPrompt: z.string(),
        temperature: z.number().min(0).max(2)
      }))
    }))
    .output(CouncilSessionSchema)
    .mutation(async ({ input, ctx }) => {
      const id = uuidv4();
      const session: CouncilSession = {
        id,
        topic: input.topic,
        mode: input.mode,
        status: 'draft',
        maxRounds: input.maxRounds,
        currentRound: 1,
        createdAt: new Date().toISOString(),
        participants: input.participants
      };

      if (isUsingFallback) {
        if (!fallbackStore.councilSessions) fallbackStore.councilSessions = [];
        fallbackStore.councilSessions.unshift(session);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO council_sessions (id, tenant_id, topic, mode, status, max_rounds, current_round, participants, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            ctx.tenantId,
            session.topic,
            session.mode,
            session.status,
            session.maxRounds,
            session.currentRound,
            JSON.stringify(session.participants),
            session.createdAt
          ]
        );
      }

      return session;
    }),

  executeStep: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .output(z.object({
      session: CouncilSessionSchema,
      messages: z.array(CouncilMessageSchema)
    }))
    .mutation(async ({ input, ctx }) => {
      await executeCouncilStep(input.sessionId, ctx.tenantId);
      const session = await getCouncilSession(input.sessionId, ctx.tenantId);
      const messages = await getCouncilMessages(input.sessionId, ctx.tenantId);

      // Event-Emission falls Fallbacks verwendet wurden
      const hasFallbacks = messages.some(m => m.fallbackMetadata?.usedFallback);
      if (hasFallbacks) {
        workflowEventBus.emitEvent(ctx.tenantId, 'council.session_degraded_fallback', {
          sessionId: input.sessionId,
          degradedMessagesCount: messages.filter(m => m.fallbackMetadata?.usedFallback).length
        });
      }

      return { session, messages };
    }),

  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        if (fallbackStore.councilSessions) {
          fallbackStore.councilSessions = fallbackStore.councilSessions.filter(s => s.id !== input.id);
        }
        if (fallbackStore.councilMessages) {
          fallbackStore.councilMessages = fallbackStore.councilMessages.filter(m => m.sessionId !== input.id);
        }
        saveFallbackStore();
      } else {
        await pool.query("DELETE FROM council_messages WHERE session_id = $1 AND tenant_id = $2", [input.id, ctx.tenantId]);
        await pool.query("DELETE FROM council_sessions WHERE id = $1 AND tenant_id = $2", [input.id, ctx.tenantId]);
      }
      return { success: true };
    }),

  saveToKnowledgeBase: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      saveOption: z.enum(['full', 'summary_only'])
    }))
    .output(z.object({ success: z.boolean(), fileName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const session = await getCouncilSession(input.sessionId, ctx.tenantId);
      if (!session) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Session nicht gefunden." });
      }
      const messages = await getCouncilMessages(input.sessionId, ctx.tenantId);

      let content = `# LLM Council: ${session.topic}\n\n`;
      content += `- **Thema:** ${session.topic}\n`;
      content += `- **Modus:** ${session.mode}\n`;
      content += `- **Status:** ${session.status}\n`;
      content += `- **Erstellt am:** ${new Date(session.createdAt).toLocaleString('de-DE')}\n`;
      if (session.participants && session.participants.length > 0) {
        content += `- **Teilnehmer:** ${session.participants.map(p => `${p.name} (${p.modelId || 'Louis AI'})`).join(', ')}\n`;
      }
      content += `\n---\n\n`;

      if (input.saveOption === 'full') {
        content += `## Debattenverlauf (Alle Runden & Zwischenergebnisse)\n\n`;
        const maxRound = Math.max(...messages.map(m => m.roundNumber), 1);
        for (let r = 1; r <= maxRound; r++) {
          const roundMsgs = messages.filter(m => m.roundNumber === r);
          if (roundMsgs.length > 0) {
            content += `### Runde ${r}\n\n`;
            for (const msg of roundMsgs) {
              const part = session.participants.find(p => p.id === msg.participantId);
              const name = part ? part.name : 'Debattant';
              content += `#### ${name}\n\n${msg.content}\n\n`;
            }
          }
        }
        content += `---\n\n`;
      }

      content += `## Endergebnis / Synthese\n\n`;
      if (session.finalConclusion) {
        content += `${session.finalConclusion}\n\n`;
      } else {
        content += `*Keine finale Synthese vorhanden.*\n\n`;
      }

      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", ctx.tenantId);
      if (!fs.existsSync(KNOWLEDGE_ROOT)) {
        fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
      }

      const safeTopic = session.topic.replace(/[^a-z0-9äöüß]/gi, '_').substring(0, 30);
      const fileName = `Council_${input.saveOption === 'full' ? 'Gesamt' : 'Synthese'}_${safeTopic}_${session.id.slice(0, 8)}.md`;
      const filePath = path.join(KNOWLEDGE_ROOT, fileName);

      fs.writeFileSync(filePath, content, "utf8");

      await forceManualIngest(filePath, fileName, ctx.tenantId, "global", undefined, "LLM Council");

      return { success: true, fileName };
    })
});
