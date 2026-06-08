import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { generateInvoiceFilesOnDisk } from "../pdfHelper.js";
import { getEntityStoragePath } from "../storage.js";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { 
  pool, 
  isUsingFallback, 
  fallbackStore, 
  saveFallbackStore, 
  logAuditEvent,
  SavedChatNote
} from "../db.js";
import { 
  LouisAiConfigSchema, 
  CustomWorkflowSchema, 
  ProposedDiffSchema,
  UserMemorySchema,
  SaveEntityNoteSchema,
  TextGeneratorConfigSchema
} from "../../lib/schemas.js";
import { runLouisAiFlow, executePassiveShortTermCompression } from "../ai/orchestrator.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { workflowExecutor } from "../ai/workflowExecutor.js";
import { getLearnedWorkflows, learnWorkflow, deleteWorkflow } from "../ai/tools.js";
import { generateContentSafe, generateContentUniversal } from "../ai/geminiHelper.js";
import { generateEmbedding, getRagConfig } from "../ai/embeddingHelper.js";
import { forceManualIngest, unindexFileFromRag, isTextBasedFile, mimeTypeFromFilename, intelligentChunkAndProcess, ingestEmailToRag } from "../storage.js";
import { ChatMessage, Company, Contact, Invoice, LouisAiConfig, CustomWorkflow, SmtpSettings } from "../../types.js";

interface EntityNote {
  id_uuid: string;
  content: string;
  created_at_utc: string;
  created_by_identity: string;
}

/**
 * Recursively search for a filename across all known storage buckets/vaults.
 * Used as a robust fallback to guarantee draft attachments can be resolved even if the source is misaligned.
 */
function searchFileAcrossAllVaults(filename: string, tenantId: string): { path: string; source: 'knowledge' | 'vault'; entityId?: string; entityType?: 'companies' | 'contacts' } | null {
  const cleanFilename = filename.toLowerCase().trim();
  if (!cleanFilename) return null;

  // Helper to find match in a list of files (exact or case-insensitive or partial)
  const findMatchInList = (files: string[], target: string): string | undefined => {
    // 1. Exact match
    let found = files.find(f => f.toLowerCase() === target);
    if (found) return found;
    // 2. Exact match excluding timestamps (e.g. 1717354923000_my_document.pdf vs my_document.pdf)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF === target;
    });
    if (found) return found;
    // 3. Contains match (target is in folder filename)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF.includes(target) || target.includes(cleanF);
    });
    if (found) return found;
    // 4. Raw includes
    return files.find(f => f.toLowerCase().includes(target));
  };

  // 1. Check knowledge_data_vault for tenant
  const kDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
  if (fs.existsSync(kDir)) {
    const files = fs.readdirSync(kDir);
    const matched = findMatchInList(files, cleanFilename);
    if (matched) {
      return { path: path.join(kDir, matched), source: 'knowledge' };
    }
  }

  // 2. Check knowledge_data_vault for fallback tenant "1"
  if (tenantId !== "1") {
    const kDirFallback = path.resolve(process.cwd(), "knowledge_data_vault", "1");
    if (fs.existsSync(kDirFallback)) {
      const files = fs.readdirSync(kDirFallback);
      const matched = findMatchInList(files, cleanFilename);
      if (matched) {
        return { path: path.join(kDirFallback, matched), source: 'knowledge' };
      }
    }
  }

  // Helper to search in vault directory
  const searchInVaultDir = (vaultRoot: string, type: 'companies' | 'contacts'): { path: string; source: 'vault'; entityId: string; entityType: 'companies' | 'contacts' } | null => {
    if (!fs.existsSync(vaultRoot)) return null;
    const entityDirs = fs.readdirSync(vaultRoot);
    for (const dir of entityDirs) {
      const dirPath = path.join(vaultRoot, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
         const files = fs.readdirSync(dirPath);
         const matched = findMatchInList(files, cleanFilename);
         if (matched) {
           const entityId = dir.split("__")[0];
           return {
             path: path.join(dirPath, matched),
             source: 'vault',
             entityId,
             entityType: type
           };
         }
      }
    }
    return null;
  };

  // 3. Check companies_data_vault for tenant
  const comVault = path.resolve(process.cwd(), "companies_data_vault", tenantId);
  const matchedCom = searchInVaultDir(comVault, 'companies');
  if (matchedCom) return matchedCom;

  // 4. Check contacts_data_vault for tenant
  const conVault = path.resolve(process.cwd(), "contacts_data_vault", tenantId);
  const matchedCon = searchInVaultDir(conVault, 'contacts');
  if (matchedCon) return matchedCon;

  // 5. Check companies_data_vault for tenant "1" fallback
  if (tenantId !== "1") {
    const comVaultFb = path.resolve(process.cwd(), "companies_data_vault", "1");
    const matchedComFb = searchInVaultDir(comVaultFb, 'companies');
    if (matchedComFb) return matchedComFb;

    const conVaultFb = path.resolve(process.cwd(), "contacts_data_vault", "1");
    const matchedConFb = searchInVaultDir(conVaultFb, 'contacts');
    if (matchedConFb) return matchedConFb;
  }

  // 6. Direct check in parent vaults directories if files are misplaced/uploaded directly there
  const parentComRoot = path.resolve(process.cwd(), "companies_data_vault");
  if (fs.existsSync(parentComRoot)) {
    const files = fs.readdirSync(parentComRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentComRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  const parentConRoot = path.resolve(process.cwd(), "contacts_data_vault");
  if (fs.existsSync(parentConRoot)) {
    const files = fs.readdirSync(parentConRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentConRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  return null;
}

export const louisAiRouter = router({
  getConfig: protectedProcedure
    .output(z.object({
      id_uuid: z.string().optional(),
      provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini']),
      api_key_secret: z.string().optional().nullable(),
      base_url: z.string().optional().nullable(),
      model_name: z.string(),
      temperature: z.number(),
      top_p: z.number(),
      top_k: z.number(),
      num_ctx: z.number(),
      embedding_provider: z.enum(['ollama', 'openai', 'gemini']).optional().default('gemini'),
      embedding_api_key_secret: z.string().optional().nullable().default(''),
      embedding_base_url: z.string().optional().nullable().default(''),
      embedding_model_name: z.string().optional().default('gemini-embedding-2-preview'),
      vector_dimensions: z.number().optional().default(3072),
      keep_alive_minutes: z.number().optional().default(5),
      parallel_slots: z.number().optional().default(1),
      chunk_size: z.number().optional().default(500),
      chunk_overlap: z.number().optional().default(50),
    }))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;

      if (isUsingFallback) {
        const list = fallbackStore.louisAiConfig || [];
        const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
        if (found) {
          return {
            id_uuid: found.id_uuid,
            provider_type: found.provider_type,
            api_key_secret: found.api_key_secret,
            base_url: found.base_url,
            model_name: found.model_name,
            temperature: found.temperature,
            top_p: found.top_p,
            top_k: found.top_k,
            num_ctx: found.num_ctx,
            embedding_provider: found.embedding_provider || 'gemini',
            embedding_api_key_secret: found.embedding_api_key_secret || '',
            embedding_base_url: found.embedding_base_url || '',
            embedding_model_name: found.embedding_model_name || 'gemini-embedding-2-preview',
            vector_dimensions: found.vector_dimensions || 3072,
            keep_alive_minutes: found.keep_alive_minutes ?? 5,
            parallel_slots: found.parallel_slots ?? 1,
            chunk_size: found.chunk_size ?? 500,
            chunk_overlap: found.chunk_overlap ?? 50,
          };
        }
      } else {
        const res = await pool.query(
          `SELECT id_uuid, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx,
                  embedding_provider, embedding_api_key_secret, embedding_base_url, embedding_model_name, vector_dimensions,
                  keep_alive_minutes, parallel_slots, chunk_size, chunk_overlap
           FROM sys_integrations_louis_ai_config 
           WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1`,
          [tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id_uuid: row.id_uuid,
            provider_type: row.provider_type as LouisAiConfig['provider_type'],
            api_key_secret: row.api_key_secret,
            base_url: row.base_url,
            model_name: row.model_name,
            temperature: row.temperature,
            top_p: row.top_p,
            top_k: row.top_k,
            num_ctx: row.num_ctx,
            embedding_provider: (row.embedding_provider as LouisAiConfig['embedding_provider']) || 'gemini',
            embedding_api_key_secret: row.embedding_api_key_secret || '',
            embedding_base_url: row.embedding_base_url || '',
            embedding_model_name: row.embedding_model_name || 'gemini-embedding-2-preview',
            vector_dimensions: row.vector_dimensions ?? 3072,
            keep_alive_minutes: row.keep_alive_minutes ?? 5,
            parallel_slots: row.parallel_slots ?? 1,
            chunk_size: row.chunk_size ?? 500,
            chunk_overlap: row.chunk_overlap ?? 50,
          };
        }
      }

      // Return default config
      return {
        provider_type: 'gemini',
        api_key_secret: '',
        base_url: '',
        model_name: 'gemini-2.5-flash',
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 8192,
        embedding_provider: 'gemini',
        embedding_api_key_secret: '',
        embedding_base_url: '',
        embedding_model_name: 'gemini-embedding-2-preview',
        vector_dimensions: 3072,
        keep_alive_minutes: 5,
        parallel_slots: 1,
        chunk_size: 500,
        chunk_overlap: 50,
      };
    }),

  saveConfig: protectedProcedure
    .input(LouisAiConfigSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const id = input.id_uuid || uuidv4();

      if (isUsingFallback) {
        if (!fallbackStore.louisAiConfig) {
          fallbackStore.louisAiConfig = [];
        }
        // Remove existing config
        fallbackStore.louisAiConfig = fallbackStore.louisAiConfig.filter((c) => c.tenant_id !== tenantId);
        fallbackStore.louisAiConfig.push({
          ...input,
          id_uuid: id,
          tenant_id: tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_integrations_louis_ai_config (
            id_uuid, tenant_id, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx,
            embedding_provider, embedding_api_key_secret, embedding_base_url, embedding_model_name, vector_dimensions,
            keep_alive_minutes, parallel_slots, chunk_size, chunk_overlap, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id)
          DO UPDATE SET 
            provider_type = EXCLUDED.provider_type,
            api_key_secret = EXCLUDED.api_key_secret,
            base_url = EXCLUDED.base_url,
            model_name = EXCLUDED.model_name,
            temperature = EXCLUDED.temperature,
            top_p = EXCLUDED.top_p,
            top_k = EXCLUDED.top_k,
            num_ctx = EXCLUDED.num_ctx,
            embedding_provider = EXCLUDED.embedding_provider,
            embedding_api_key_secret = EXCLUDED.embedding_api_key_secret,
            embedding_base_url = EXCLUDED.embedding_base_url,
            embedding_model_name = EXCLUDED.embedding_model_name,
            vector_dimensions = EXCLUDED.vector_dimensions,
            keep_alive_minutes = EXCLUDED.keep_alive_minutes,
            parallel_slots = EXCLUDED.parallel_slots,
            chunk_size = EXCLUDED.chunk_size,
            chunk_overlap = EXCLUDED.chunk_overlap,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          id,
          tenantId,
          input.provider_type,
          input.api_key_secret,
          input.base_url,
          input.model_name,
          input.temperature,
          input.top_p,
          input.top_k,
          input.num_ctx,
          input.embedding_provider || 'gemini',
          input.embedding_api_key_secret || '',
          input.embedding_base_url || '',
          input.embedding_model_name || 'gemini-embedding-2-preview',
          input.vector_dimensions || 3072,
          input.keep_alive_minutes || 5,
          input.parallel_slots || 1,
          input.chunk_size || 500,
          input.chunk_overlap || 50
        ]);
      }

      await logAuditEvent({
        tenantId,
        eventType: "UPDATE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: "LOUIS AI config updated."
      });

      return { success: true };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      message: z.string().min(1),
      sessionId: z.string().uuid().optional(),
      language: z.string().default('de')
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";
      let sessionId = input.sessionId || uuidv4();
      let history: ChatMessage[] = [];
      let currentSummary = "";

      // 1. Load History
      if (isUsingFallback) {
        if (!fallbackStore.louisAiSessions) {
          fallbackStore.louisAiSessions = [];
        }
        const session = fallbackStore.louisAiSessions.find((s) => s.id_uuid === sessionId && s.tenant_id === tenantId);
        if (session) {
          history = typeof session.conversation_history_json === 'string'
            ? JSON.parse(session.conversation_history_json)
            : session.conversation_history_json;
          currentSummary = session.short_term_summary_text || "";
        } else {
          fallbackStore.louisAiSessions.push({
            id_uuid: sessionId,
            tenant_id: tenantId,
            session_title: input.message.slice(0, 40),
            conversation_history_json: [],
            short_term_summary_text: "",
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          });
          saveFallbackStore();
        }
      } else {
        const res = await pool.query(
          "SELECT conversation_history_json, short_term_summary_text FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1",
          [sessionId, tenantId]
        );
        if (res.rows.length > 0) {
          const rawHist = res.rows[0].conversation_history_json;
          history = typeof rawHist === 'string' ? JSON.parse(rawHist) : rawHist;
          currentSummary = res.rows[0].short_term_summary_text || "";
        } else {
          await pool.query(`
            INSERT INTO sys_louis_ai_sessions (id_uuid, tenant_id, session_title, conversation_history_json, short_term_summary_text)
            VALUES ($1, $2, $3, '[]'::jsonb, '')
          `, [sessionId, tenantId, input.message.slice(0, 40)]);
        }
      }

      // Add user message to local history array
      history.push({ role: 'user', content: input.message, timestamp_utc: new Date().toISOString() });

      // Run compression if needed
      const updatedSummary = await executePassiveShortTermCompression(tenantId, history, currentSummary);

      // Retrieve Tenant specific language configuration
      let tenantLang = input.language || 'de';
      if (isUsingFallback) {
        if (fallbackStore.myCompany && fallbackStore.myCompany.language) {
          tenantLang = fallbackStore.myCompany.language;
        }
      } else {
        try {
          const companyRes = await pool.query(
            "SELECT language FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (companyRes.rows.length > 0 && companyRes.rows[0].language) {
            tenantLang = companyRes.rows[0].language;
          }
        } catch (err) {
          console.warn("Could not query tenant language from core_registry_my_company", err);
        }
      }

      // We pass the up-to-date summary and a trimmed version of conversationHistory (last 5 items) to runLouisAiFlow
      // This reduces token footprint and improves model performance drastically, while memory maintains context.
      const trimmedHistory = history.length > 5 ? history.slice(-5) : history;
      const result = await runLouisAiFlow(tenantId, userId, input.message, trimmedHistory, tenantLang, updatedSummary);

      // Append assistant outcome
      history.push({
        role: 'assistant',
        content: result.replyText,
        thought_log: result.thoughtLog,
        proposed_changes: result.proposedChanges,
        timestamp_utc: new Date().toISOString(),
        metrics: result.metrics
      });

      // 2. Persist updated History & updated short-term summary
      if (isUsingFallback) {
        const session = fallbackStore.louisAiSessions.find((s) => s.id_uuid === sessionId && s.tenant_id === tenantId);
        if (session) {
          session.conversation_history_json = history;
          session.short_term_summary_text = updatedSummary;
          saveFallbackStore();
        }
      } else {
        await pool.query(`
          UPDATE sys_louis_ai_sessions
          SET conversation_history_json = $1, short_term_summary_text = $2, updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $3 AND tenant_id = $4
        `, [JSON.stringify(history), updatedSummary, sessionId, tenantId]);
      }

      return {
        replyText: result.replyText,
        thoughtLog: result.thoughtLog,
        proposedChanges: result.proposedChanges,
        sessionId,
        metrics: result.metrics
      };
    }),

  approveProposal: protectedProcedure
    .input(ProposedDiffSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const actorIdentity = "ai_assistant";
      const appliedId = input.id_uuid || uuidv4();
      const action = input.action; // CREATE, UPDATE, DELETE
      const entityType = input.entity_type; // 'companies' | 'contacts' | 'invoices'

      if (entityType === "emails") {
        // ACTUALLY SEND THE SMTP EMAIL NOW THAT THE HUMAN APPROVED IT!
        const pState = input.proposed_state;
        const recipient = String(pState.recipient_email_address || "").trim();
        if (!recipient) {
          throw new Error("Fehler: Bitte geben Sie eine gültige E-Mail-Adresse als Empfänger an, bevor Sie diese E-Mail freigeben.");
        }
        const subject = String(pState.email_subject_text || "").trim();
        const body = String(pState.email_body_content || "").trim();
        const invoiceId = pState.invoice_id && pState.invoice_id !== 'null' ? String(pState.invoice_id).trim() : undefined;

        // Retrieve SMTP Settings
        let smtp: SmtpSettings | undefined;
        if (isUsingFallback) {
          smtp = fallbackStore.smtpSettings;
        } else {
          const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [tenantId]);
          smtp = res.rows[0];
        }

        if (!smtp) {
          throw new Error("Fehler: SMTP-Verbindung ist nicht eingerichtet. Bitte konfigurieren Sie SMTP unter Admin > Verbindungen.");
        }

        const transporter = nodemailer.createTransport({
          host: smtp.smtp_host_name,
          port: smtp.smtp_port_number,
          secure: smtp.is_secure_connection,
          auth: {
            user: smtp.smtp_user_name,
            pass: smtp.smtp_password_secret,
          },
          tls: {
            rejectUnauthorized: false
          }
        });

        const attachments: { filename: string; path: string }[] = [];
        if (invoiceId) {
          try {
            console.log(`[SMTP AI Human-In-The-Loop] Compiling invoice files from disk for Invoice-UUID: ${invoiceId}`);
            await generateInvoiceFilesOnDisk(invoiceId, tenantId);
            let invoice: (Invoice & { entityType?: string; entityId?: string; entityName?: string; co_name?: string; ct_name?: string; company_name?: string }) | null = null;
            if (isUsingFallback) {
              const found = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
              if (found) {
                invoice = { ...found };
                if (invoice.associated_company_id) {
                  const co = fallbackStore.companies.find(c => c.id_uuid === invoice.associated_company_id);
                  invoice.entityType = "companies";
                  invoice.entityId = co?.id_uuid;
                  invoice.entityName = co?.full_legal_name;
                } else if (invoice.associated_contact_id) {
                  const ct = fallbackStore.contacts.find(c => c.id_uuid === invoice.associated_contact_id);
                  invoice.entityType = "contacts";
                  invoice.entityId = ct?.id_uuid;
                  invoice.entityName = ct?.full_legal_name;
                }
              }
            } else {
              const invoiceRes = await pool.query(`
                SELECT i.*, 
                       co.full_legal_name as co_name, 
                       ct.full_legal_name as ct_name
                FROM fiscal_billing_invoices i
                LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
                LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
                WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
              `, [invoiceId, tenantId]);
              invoice = invoiceRes.rows[0];
              if (invoice) {
                if (invoice.associated_company_id) {
                  invoice.entityType = "companies";
                  invoice.entityId = invoice.associated_company_id;
                  invoice.entityName = invoice.co_name;
                } else if (invoice.associated_contact_id) {
                  invoice.entityType = "contacts";
                  invoice.entityId = invoice.associated_contact_id;
                  invoice.entityName = invoice.ct_name;
                }
              }
            }

            if (invoice && invoice.entityId) {
              const cleanNum = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
              const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, tenantId);
              const displayPdfPath = path.join(entityStoragePath, `rechnung_${cleanNum}.pdf`);
              const recipientName = invoice.entityName || invoice.company_name || 'Empfaenger';
              const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
              const filename = `Rechnung - ${cleanRecipient} - ${cleanNum}.pdf`;

              if (fs.existsSync(displayPdfPath)) {
                attachments.push({
                  filename: filename,
                  path: displayPdfPath
                });
                console.log(`[SMTP Human-In-The-Loop] Attached PDF: ${displayPdfPath}`);
              } else {
                console.warn(`[SMTP Human-In-The-Loop] PDF does not exist at path: ${displayPdfPath}`);
              }
            }
          } catch (pdfErr) {
            console.error("Failed to compile attachment PDF in SMTP human approved send:", pdfErr);
          }
        }

        // Process other attachments if any (from knowledge_data_vault or contact/company vaults)
        if (Array.isArray(pState.attachments)) {
          for (const att of pState.attachments) {
            const filename = String(att.filename || "").trim();
            const source = String(att.source || "knowledge").toLowerCase();
            if (!filename) continue;

            let resolvedPath = "";
            let eId = att.entity_id || att.entityId;
            let eType = att.entity_type || att.entityType;

            if (source === "knowledge") {
              const baseDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
              let tempPath = path.join(baseDir, filename);
              if (fs.existsSync(tempPath)) {
                resolvedPath = tempPath;
              } else {
                // Try case-insensitive list or partial contains-matching
                if (fs.existsSync(baseDir)) {
                  const filesInDir = fs.readdirSync(baseDir);
                  const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                  filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                  if (matched) {
                    resolvedPath = path.join(baseDir, matched);
                  }
                }
                // Try fallback to tenant "1"
                if (!resolvedPath && tenantId !== "1") {
                  const fallbackBaseDir = path.resolve(process.cwd(), "knowledge_data_vault", "1");
                  const fallbackPath = path.join(fallbackBaseDir, filename);
                  if (fs.existsSync(fallbackPath)) {
                    resolvedPath = fallbackPath;
                  } else if (fs.existsSync(fallbackBaseDir)) {
                    const filesInDir = fs.readdirSync(fallbackBaseDir);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(fallbackBaseDir, matched);
                    }
                  }
                }
                // Try fallback to root folder
                if (!resolvedPath) {
                  const rootBaseDir = path.resolve(process.cwd(), "knowledge_data_vault");
                  const rootPath = path.join(rootBaseDir, filename);
                  if (fs.existsSync(rootPath)) {
                    resolvedPath = rootPath;
                  }
                }
              }
            } else if (source === "vault") {
              const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();
              
              // If entity_id or entity_type is missing, try to resolve via recipient contact first, then company
              if (!eId || !eType) {
                let contact: Contact | null = null;
                if (isUsingFallback) {
                  contact = fallbackStore.contacts?.find((c: Contact) => 
                    c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
                  ) || null;
                } else {
                  try {
                    const contactRes = await pool.query(
                      `SELECT c.* FROM core_registry_contacts c WHERE LOWER(c.email_address) = LOWER($1) AND (c.tenant_id = $2 OR c.tenant_id = '1') LIMIT 1`,
                      [cleanRecipient, tenantId]
                    );
                    if (contactRes.rows.length > 0) {
                      contact = contactRes.rows[0];
                    }
                  } catch (e) {}
                }
                if (contact) {
                  eId = contact.id_uuid;
                  eType = "contacts";
                } else {
                  // Fallback to company
                  let company: Company | null = null;
                  if (isUsingFallback) {
                    company = fallbackStore.companies?.find((co: Company) => 
                      co.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && co.tenant_id === tenantId
                    ) || null;
                  } else {
                    try {
                      const companyRes = await pool.query(
                        `SELECT * FROM core_registry_companies WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
                        [cleanRecipient, tenantId]
                      );
                      if (companyRes.rows.length > 0) {
                        company = companyRes.rows[0];
                      }
                    } catch (e) {}
                  }
                  if (company) {
                    eId = company.id_uuid;
                    eType = "companies";
                  }
                }
              }

              if (eId && eType) {
                let entityName = "Vault";
                if (isUsingFallback) {
                  if (eType === "companies" || eType === "company") {
                    const co = fallbackStore.companies?.find(c => c.id_uuid === eId);
                    if (co) entityName = co.full_legal_name || "Vault";
                  } else {
                    const ct = fallbackStore.contacts?.find(c => c.id_uuid === eId);
                    if (ct) {
                      entityName = ct.full_legal_name || `${ct.first_name || ''} ${ct.last_name || ''}`.trim() || "Vault";
                    }
                  }
                } else {
                  try {
                    const isCompany = eType === "companies" || eType === "company";
                    const table = isCompany ? "core_registry_companies" : "core_registry_contacts";
                    if (isCompany) {
                      const res = await pool.query(`SELECT full_legal_name FROM ${table} WHERE id_uuid = $1 LIMIT 1`, [eId]);
                      if (res.rows.length > 0) {
                        entityName = res.rows[0].full_legal_name || "Vault";
                      }
                    } else {
                      const res = await pool.query(`SELECT full_legal_name, first_name, last_name FROM ${table} WHERE id_uuid = $1 LIMIT 1`, [eId]);
                      if (res.rows.length > 0) {
                        const r = res.rows[0];
                        entityName = r.full_legal_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || "Vault";
                      }
                    }
                  } catch (err) {
                    console.warn("Could not query entity name for approved attachment resolv:", err);
                  }
                }
                const entityPath = getEntityStoragePath(eType, eId, entityName, tenantId);
                let tempPath = path.join(entityPath, filename);
                if (fs.existsSync(tempPath)) {
                  resolvedPath = tempPath;
                } else {
                  // Try case-insensitive or partial contains-matching inside entity Path!
                  if (fs.existsSync(entityPath)) {
                    const filesInDir = fs.readdirSync(entityPath);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(entityPath, matched);
                    }
                  }
                }
              }
            }

            // Double fallback: if not found, check reciprocal sources
            if (!resolvedPath) {
              // If source says vault but not found, check knowledge
              if (source === "vault") {
                const baseDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
                if (fs.existsSync(baseDir)) {
                  const filesInDir = fs.readdirSync(baseDir);
                  const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                  filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                  if (matched) {
                    resolvedPath = path.join(baseDir, matched);
                  }
                }
              } else {
                // If source says knowledge but not found, try to search the recipient contact/company vault
                const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();
                let contact: Contact | null = null;
                if (isUsingFallback) {
                  contact = fallbackStore.contacts?.find((c: Contact) => 
                    c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
                  ) || null;
                } else {
                  try {
                    const contactRes = await pool.query(
                      `SELECT id_uuid, full_legal_name, first_name, last_name FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
                      [cleanRecipient, tenantId]
                    );
                    contact = contactRes.rows[0];
                  } catch (_) {}
                }
                if (contact) {
                  const entityName = contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || "Vault";
                  const entityPath = getEntityStoragePath("contacts", contact.id_uuid, entityName, tenantId);
                  if (fs.existsSync(entityPath)) {
                    const filesInDir = fs.readdirSync(entityPath);
                    const matched = filesInDir.find(f => f.toLowerCase() === filename.toLowerCase()) ||
                                    filesInDir.find(f => f.toLowerCase().includes(filename.toLowerCase()));
                    if (matched) {
                      resolvedPath = path.join(entityPath, matched);
                    }
                  }
                }
              }
            }

            if (!resolvedPath) {
              const fallbackSearch = searchFileAcrossAllVaults(filename, tenantId);
              if (fallbackSearch && fs.existsSync(fallbackSearch.path)) {
                resolvedPath = fallbackSearch.path;
                console.log(`[SMTP Human-In-The-Loop] File found via robust search fallback: ${resolvedPath}`);
              }
            }

            if (resolvedPath && fs.existsSync(resolvedPath)) {
              // Clean timestamp prefix (e.g. 1717354923000_my_document.pdf -> my_document.pdf)
              const displayFilename = path.basename(resolvedPath).replace(/^\d+_/g, '');
              attachments.push({
                filename: displayFilename,
                path: resolvedPath
              });
              console.log(`[SMTP Human-In-The-Loop] Attached file from ${source}: ${resolvedPath} as ${displayFilename}`);
            } else {
              console.warn(`[SMTP Human-In-The-Loop] Attachment file not found relative to ${source}: ${filename}`);
            }
          }
        }

        await transporter.sendMail({
          from: smtp.sender_display_name 
            ? `"${smtp.sender_display_name}" <${smtp.sender_email_address}>`
            : smtp.sender_email_address,
          to: recipient,
          subject: subject,
          text: body.replace(/<[^>]*>/g, ''),
          html: body,
          attachments,
        });

        try {
          await ingestEmailToRag({
            tenantId,
            recipient: recipient,
            senderType: 'AI',
            subject: subject,
            body: body,
            attachments: attachments
          });
        } catch (ragErr) {
          console.error("[approveProposedChange] Failed to ingest sent mail to RAG:", ragErr);
        }

        console.log(`[SMTP Human-In-The-Loop] Mail successfully sent to ${recipient} via approved proposal.`);
      } else if (isUsingFallback) {
        // Fallback Store mutations
        if (entityType === "companies") {
          if (action === "DELETE") {
            fallbackStore.companies = fallbackStore.companies.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.companies.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.companies[idx] = { 
                ...fallbackStore.companies[idx], 
                ...(input.proposed_state as Partial<Company>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.companies[number];
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            let existingIdx = fallbackStore.companies.findIndex((c) => c.id_uuid === appliedId);
            if (existingIdx === -1 && pState.full_legal_name) {
              existingIdx = fallbackStore.companies.findIndex((c) => c.full_legal_name?.toLowerCase() === (pState.full_legal_name as string).toLowerCase() && c.tenant_id === tenantId);
            }
            if (existingIdx >= 0) {
              const targetId = fallbackStore.companies[existingIdx].id_uuid;
              fallbackStore.companies[existingIdx] = {
                ...fallbackStore.companies[existingIdx],
                ...pState,
                id_uuid: targetId,
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.companies[number];
            } else {
              fallbackStore.companies.unshift({
                ...(input.proposed_state as unknown as Company),
                id_uuid: appliedId,
                tenant_id: tenantId,
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.companies[number]);
            }
            workflowEventBus.emitEvent(tenantId, 'company.created', { id_uuid: existingIdx >= 0 ? fallbackStore.companies[existingIdx].id_uuid : appliedId, ...pState });
          }
        } else if (entityType === "contacts") {
          if (action === "DELETE") {
            fallbackStore.contacts = fallbackStore.contacts.filter((c) => c.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.contacts.findIndex((c) => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.contacts[idx] = { 
                ...fallbackStore.contacts[idx], 
                ...(input.proposed_state as Partial<Contact>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.contacts[number];
            }
          } else {
            const pState = input.proposed_state as Record<string, unknown>;
            let existingIdx = fallbackStore.contacts.findIndex((c) => c.id_uuid === appliedId);
            if (existingIdx === -1 && pState.email_address) {
              existingIdx = fallbackStore.contacts.findIndex((c) => c.email_address?.toLowerCase() === (pState.email_address as string).toLowerCase() && c.tenant_id === tenantId);
            }
            if (existingIdx === -1 && pState.last_name) {
              existingIdx = fallbackStore.contacts.findIndex((c) => (c.first_name || '').toLowerCase() === ((pState.first_name as string) || '').toLowerCase() && c.last_name?.toLowerCase() === (pState.last_name as string).toLowerCase() && c.tenant_id === tenantId);
            }

            if (existingIdx >= 0) {
              const targetId = fallbackStore.contacts[existingIdx].id_uuid;
              fallbackStore.contacts[existingIdx] = {
                ...fallbackStore.contacts[existingIdx],
                ...pState,
                id_uuid: targetId,
                full_legal_name: (pState.full_legal_name as string) || fallbackStore.contacts[existingIdx].full_legal_name || `${(pState.first_name as string) || fallbackStore.contacts[existingIdx].first_name || ''} ${(pState.last_name as string) || fallbackStore.contacts[existingIdx].last_name || ''}`.trim(),
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.contacts[number];
            } else {
              const fullName = pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name || ''}`.trim() || 'Unbekannter Kontakt';
              fallbackStore.contacts.unshift({
                ...(input.proposed_state as unknown as Contact),
                full_legal_name: fullName,
                id_uuid: appliedId,
                tenant_id: tenantId,
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.contacts[number]);
            }
            workflowEventBus.emitEvent(tenantId, 'contact.created', { id_uuid: existingIdx >= 0 ? fallbackStore.contacts[existingIdx].id_uuid : appliedId, ...pState });
          }
        } else if (entityType === "invoices") {
          if (action === "DELETE") {
            fallbackStore.invoices = fallbackStore.invoices.filter((i) => i.id_uuid !== appliedId);
          } else if (action === "UPDATE") {
            const idx = fallbackStore.invoices.findIndex((i) => i.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.invoices[idx] = { 
                ...fallbackStore.invoices[idx], 
                ...(input.proposed_state as Partial<Invoice>), 
                id_uuid: appliedId, 
                updated_at_utc: new Date().toISOString() 
              } as typeof fallbackStore.invoices[number];
            }
          } else {
            const pState = input.proposed_state as unknown as Invoice;
            let existingIdx = fallbackStore.invoices.findIndex((i) => i.id_uuid === appliedId);
            if (existingIdx === -1 && pState.invoice_number) {
              existingIdx = fallbackStore.invoices.findIndex((i) => i.invoice_number?.toLowerCase() === pState.invoice_number.toLowerCase() && i.tenant_id === tenantId);
            }

            if (existingIdx >= 0) {
              const targetId = fallbackStore.invoices[existingIdx].id_uuid;
              fallbackStore.invoices[existingIdx] = {
                ...fallbackStore.invoices[existingIdx],
                ...pState,
                id_uuid: targetId,
                invoice_line_items_json: JSON.stringify(pState.invoice_line_items || fallbackStore.invoices[existingIdx].invoice_line_items || []),
                is_verified_by_human: true,
                updated_at_utc: new Date().toISOString()
              } as typeof fallbackStore.invoices[number];
            } else {
              fallbackStore.invoices.unshift({
                ...pState,
                id_uuid: appliedId,
                tenant_id: tenantId,
                invoice_line_items_json: JSON.stringify(pState.invoice_line_items || []),
                created_by_identity: "ai_assistant",
                ai_confidence_score: 1.0,
                is_verified_by_human: true,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              } as unknown as typeof fallbackStore.invoices[number]);
            }
            
            workflowEventBus.emitEvent(tenantId, 'invoice.created', {
              id_uuid: existingIdx >= 0 ? fallbackStore.invoices[existingIdx].id_uuid : appliedId,
              invoice_number: pState.invoice_number,
              total_gross_amount: pState.total_gross_amount,
              associated_company_id: pState.associated_company_id,
              associated_contact_id: pState.associated_contact_id
            });
          }
        }
        saveFallbackStore();
      } else {
        // PostgreSQL operations 
        if (entityType === "companies") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE core_registry_companies 
              SET full_legal_name = $1, tax_vat_id = $2, tax_number = $3, responsible_person = $4,
                  street = $5, house_number = $6, city = $7, postal_code = $8, country_code = $9,
                  email_address = $10, phone_number = $11, iban = $12, bic_swift = $13, leitweg_id = $14,
                  is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $15 AND tenant_id = $16
            `, [
              pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
              pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
              pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
              appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if company already exists by appliedId or name
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.full_legal_name) {
              const nameCheck = await pool.query("SELECT id_uuid FROM core_registry_companies WHERE LOWER(full_legal_name) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.full_legal_name, tenantId]);
              if (nameCheck.rows.length > 0) {
                existingId = nameCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE core_registry_companies 
                SET full_legal_name = $1, tax_vat_id = $2, tax_number = $3, responsible_person = $4,
                    street = $5, house_number = $6, city = $7, postal_code = $8, country_code = $9,
                    email_address = $10, phone_number = $11, iban = $12, bic_swift = $13, leitweg_id = $14,
                    is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $15 AND tenant_id = $16
              `, [
                pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
                pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
                pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
                existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO core_registry_companies (
                  id_uuid, tenant_id, full_legal_name, tax_vat_id, tax_number, responsible_person, street, house_number,
                  city, postal_code, country_code, email_address, phone_number, iban, bic_swift, leitweg_id,
                  created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.full_legal_name, pState.tax_vat_id, pState.tax_number, pState.responsible_person,
                pState.street, pState.house_number, pState.city, pState.postal_code, pState.country_code,
                pState.email_address, pState.phone_number, pState.iban, pState.bic_swift, pState.leitweg_id,
                actorIdentity
              ]);
            }
            workflowEventBus.emitEvent(tenantId, 'company.created', { id_uuid: existingId, ...pState });
          }
        } else if (entityType === "contacts") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM core_registry_contacts WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE core_registry_contacts 
              SET first_name = $1, last_name = $2, full_legal_name = $3, email_address = $4, phone_number = $5,
                  salutation = $6, associated_company_id = $7, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $8 AND tenant_id = $9
            `, [
              pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
              pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
              appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if contact already exists by appliedId, email, or name
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.email_address) {
              const emailCheck = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.email_address, tenantId]);
              if (emailCheck.rows.length > 0) {
                existingId = emailCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            } else if (pState.last_name) {
              const nameCheck = await pool.query("SELECT id_uuid FROM core_registry_contacts WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2) AND tenant_id = $3 LIMIT 1", [pState.first_name || '', pState.last_name, tenantId]);
              if (nameCheck.rows.length > 0) {
                existingId = nameCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE core_registry_contacts 
                SET first_name = $1, last_name = $2, full_legal_name = $3, email_address = $4, phone_number = $5,
                    salutation = $6, associated_company_id = $7, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $8 AND tenant_id = $9
              `, [
                pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
                pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
                existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO core_registry_contacts (
                  id_uuid, tenant_id, first_name, last_name, full_legal_name, email_address, phone_number, salutation,
                  associated_company_id, created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.first_name, pState.last_name, pState.full_legal_name || `${pState.first_name || ''} ${pState.last_name}`.trim(),
                pState.email_address, pState.phone_number, pState.salutation, pState.associated_company_id,
                actorIdentity
              ]);
            }
            workflowEventBus.emitEvent(tenantId, 'contact.created', { id_uuid: existingId, ...pState });
          }
        } else if (entityType === "invoices") {
          if (action === "DELETE") {
            await pool.query("DELETE FROM fiscal_billing_invoices WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
          } else if (action === "UPDATE") {
            const pState = input.proposed_state;
            await pool.query(`
              UPDATE fiscal_billing_invoices 
              SET invoice_number = $1, issue_date = $2, due_date = $3, bank_account = $4,
                  total_net_amount = $5, total_vat_amount = $6, total_gross_amount = $7, 
                  payment_status = $8, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $9 AND tenant_id = $10
            `, [
              pState.invoice_number, pState.issue_date, pState.due_date, pState.bank_account,
              pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
              pState.payment_status, appliedId, tenantId
            ]);
          } else {
            const pState = input.proposed_state;
            // Check if invoice already exists by id_uuid or invoice_number
            let existingId = appliedId;
            let alreadyExists = false;
            const checkRes = await pool.query("SELECT id_uuid FROM fiscal_billing_invoices WHERE id_uuid = $1 AND tenant_id = $2", [appliedId, tenantId]);
            if (checkRes.rows.length > 0) {
              alreadyExists = true;
            } else if (pState.invoice_number) {
              const numCheck = await pool.query("SELECT id_uuid FROM fiscal_billing_invoices WHERE LOWER(invoice_number) = LOWER($1) AND tenant_id = $2 LIMIT 1", [pState.invoice_number, tenantId]);
              if (numCheck.rows.length > 0) {
                existingId = numCheck.rows[0].id_uuid;
                alreadyExists = true;
              }
            }

            if (alreadyExists) {
              await pool.query(`
                UPDATE fiscal_billing_invoices 
                SET invoice_number = $1, issue_date = $2, due_date = $3, bank_account = $4,
                    total_net_amount = $5, total_vat_amount = $6, total_gross_amount = $7, 
                    payment_status = $8, is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
                WHERE id_uuid = $9 AND tenant_id = $10
              `, [
                pState.invoice_number, pState.issue_date, pState.due_date, pState.bank_account,
                pState.total_net_amount, pState.total_vat_amount, pState.total_gross_amount,
                pState.payment_status, existingId, tenantId
              ]);
            } else {
              await pool.query(`
                INSERT INTO fiscal_billing_invoices (
                  id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id, bank_account,
                  issue_date, due_date, total_net_amount, total_vat_amount, total_gross_amount, currency_code,
                  payment_status, invoice_line_items_json, created_by_identity, ai_confidence_score, is_verified_by_human
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1.0, TRUE)
              `, [
                appliedId, tenantId, pState.invoice_number, pState.associated_company_id, pState.associated_contact_id,
                pState.bank_account, pState.issue_date, pState.due_date, pState.total_net_amount, pState.total_vat_amount,
                pState.total_gross_amount, pState.currency_code || "EUR", pState.payment_status || "pending",
                JSON.stringify(pState.invoice_line_items || []), actorIdentity
              ]);
            }
            
            workflowEventBus.emitEvent(tenantId, 'invoice.created', {
              id_uuid: existingId,
              invoice_number: pState.invoice_number,
              total_gross_amount: pState.total_gross_amount,
              associated_company_id: pState.associated_company_id,
              associated_contact_id: pState.associated_contact_id
            });
          }
        }
      }

      await logAuditEvent({
        tenantId,
        eventType: action,
        entityType,
        entityId: appliedId,
        eventDetails: `Approved AI modification: ${input.explanation_rational}`,
        actorIdentity
      });

      return { success: true, appliedId };
    }),

  getWorkflows: protectedProcedure
    .query(async ({ ctx }) => {
      return getLearnedWorkflows(ctx.tenantId);
    }),

  learnWorkflow: protectedProcedure
    .input(CustomWorkflowSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      // Resolve actual Admin identity instead of default "Demo User" / "ai_assistant"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      const result = await learnWorkflow(
        tenantId, 
        input.workflow_name, 
        input.workflow_description, 
        input.tool_chain_sequence, 
        actorIdentity,
        input.trigger_type,
        input.trigger_config,
        input.is_active,
        input.id_uuid,
        input.direct_send_email
      );
      return result;
    }),

  deleteWorkflow: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const success = await deleteWorkflow(tenantId, input.id_uuid);
      await logAuditEvent({
        tenantId,
        eventType: "DELETE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: `Deleted LOUIS AI workflow tool: ${input.id_uuid}`
      });
      return { success };
    }),

  getWorkflowInstancesLog: protectedProcedure
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
      }
      try {
        const res = await pool.query(
          "SELECT id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, created_at_utc, updated_at_utc FROM sys_louis_ai_workflow_instances WHERE tenant_id = $1 ORDER BY created_at_utc DESC",
          [tenantId]
        );
        return res.rows.map(row => ({
          ...row,
          initial_payload: typeof row.initial_payload === 'string' ? JSON.parse(row.initial_payload) : row.initial_payload,
          execution_log: typeof row.execution_log === 'string' ? JSON.parse(row.execution_log) : row.execution_log
        }));
      } catch (err) {
        console.error("Failed to query postgres workflow instances, utilizing fallback store:", err);
        return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
      }
    }),

  updateWorkflowTrigger: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      trigger_type: z.enum(['MANUAL', 'CRM_EVENT', 'TIMER']),
      trigger_config: z.record(z.string(), z.unknown()).nullable().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].trigger_type = input.trigger_type;
          fallbackStore.customWorkflows[idx].trigger_config = input.trigger_config || {};
          saveFallbackStore();
          return { success: true };
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

      try {
        const res = await pool.query(
          "UPDATE sys_louis_ai_custom_workflows SET trigger_type = $1, trigger_config = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND tenant_id = $4 RETURNING id_uuid",
          [input.trigger_type, JSON.stringify(input.trigger_config || {}), input.id_uuid, tenantId]
        );
        if (res.rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde in Postgres nicht gefunden" });
        }
        return { success: true };
      } catch (err: unknown) {
        // Safe write-through in case write fails
        console.error("Postgres updateWorkflowTrigger failed, using fallback:", err);
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].trigger_type = input.trigger_type;
          fallbackStore.customWorkflows[idx].trigger_config = input.trigger_config || {};
          saveFallbackStore();
          return { success: true };
        }
        const errMsg = err instanceof Error ? err.message : "Fehler beim Aktualisieren";
        throw new TRPCError({ code: "NOT_FOUND", message: errMsg });
      }
    }),

  toggleWorkflowStatus: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      is_active: z.boolean()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].is_active = input.is_active;
          saveFallbackStore();
          return { success: true };
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

      try {
        const res = await pool.query(
          "UPDATE sys_louis_ai_custom_workflows SET is_active = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 AND tenant_id = $3 RETURNING id_uuid",
          [input.is_active, input.id_uuid, tenantId]
        );
        if (res.rows.length === 0) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde in Postgres nicht gefunden" });
        }
        return { success: true };
      } catch (err: unknown) {
        console.error("Postgres toggleWorkflowStatus failed, using fallback:", err);
        const idx = (fallbackStore.customWorkflows || []).findIndex(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId);
        if (idx !== -1) {
          fallbackStore.customWorkflows[idx].is_active = input.is_active;
          saveFallbackStore();
          return { success: true };
        }
        const errMsg = err instanceof Error ? err.message : "Fehler beim Umschalten";
        throw new TRPCError({ code: "NOT_FOUND", message: errMsg });
      }
    }),

  triggerWorkflowManually: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let workflow: CustomWorkflow | null = null;

      if (isUsingFallback) {
        workflow = (fallbackStore.customWorkflows || []).find(w => w.id_uuid === input.id_uuid && w.tenant_id === tenantId) || null;
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, tenantId]);
        if (res.rows.length > 0) {
          workflow = res.rows[0];
        }
      }

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workflow wurde nicht gefunden" });
      }

       // Convert tool chain sequence format to standard array if it's string JSON
      let steps = workflow.tool_chain_sequence;
      if (typeof steps === "string") {
        try {
          steps = JSON.parse(steps);
        } catch (_) {}
      }

      let config = workflow.trigger_config;
      if (typeof config === "string") {
        try {
          config = JSON.parse(config);
        } catch (_) {}
      }

      const workflowToRun: CustomWorkflow = {
        id_uuid: workflow.id_uuid,
        tenant_id: tenantId,
        workflow_name: workflow.workflow_name,
        workflow_description: workflow.workflow_description || (workflow as { description?: string }).description || "",
        tool_chain_sequence: steps,
        trigger_type: workflow.trigger_type || "MANUAL",
        trigger_config: config || {},
        is_active: workflow.is_active !== false,
        direct_send_email: workflow.direct_send_email === true,
        created_at_utc: workflow.created_at_utc,
        updated_at_utc: workflow.updated_at_utc
      };

      const payload = {
        triggered_by: "manual_ui",
        timestamp: new Date().toISOString()
      };

      // Trigger the background scheduler / executor
      workflowExecutor.execute(workflowToRun, payload).catch((err: unknown) => {
        console.error(`[triggerWorkflowManually] Error executing workflow ID ${input.id_uuid}:`, err);
      });

      return { success: true };
    }),

  getUserMemory: protectedProcedure
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      if (isUsingFallback) {
        if (!fallbackStore.louisAiUserMemory) {
          fallbackStore.louisAiUserMemory = [];
        }
        const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
        if (memory) {
          return memory;
        }
        return {
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          user_id: userId,
          response_preferences_text: "",
          frequently_used_tools_json: [],
          chat_notes_json: []
        };
      } else {
        const res = await pool.query(
          "SELECT id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id_uuid: row.id_uuid,
            tenant_id: row.tenant_id,
            user_id: row.user_id,
            response_preferences_text: row.response_preferences_text || "",
            frequently_used_tools_json: typeof row.frequently_used_tools_json === 'string' ? JSON.parse(row.frequently_used_tools_json) : row.frequently_used_tools_json || [],
            chat_notes_json: typeof row.chat_notes_json === 'string' ? JSON.parse(row.chat_notes_json) : row.chat_notes_json || []
          };
        }
        return {
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          user_id: userId,
          response_preferences_text: "",
          frequently_used_tools_json: [],
          chat_notes_json: []
        };
      }
    }),

  updateUserMemory: protectedProcedure
    .input(UserMemorySchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      if (isUsingFallback) {
        if (!fallbackStore.louisAiUserMemory) {
          fallbackStore.louisAiUserMemory = [];
        }
        let memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
        if (memory) {
          memory.response_preferences_text = input.response_preferences_text;
          memory.updated_at_utc = new Date().toISOString();
        } else {
          memory = {
            id_uuid: uuidv4(),
            tenant_id: tenantId,
            user_id: userId,
            response_preferences_text: input.response_preferences_text,
            frequently_used_tools_json: [],
            chat_notes_json: [],
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          };
          fallbackStore.louisAiUserMemory.push(memory);
        }
        saveFallbackStore();
        return { success: true, id_uuid: memory.id_uuid };
      } else {
        const res = await pool.query(
          "SELECT id_uuid, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        let memId = uuidv4();
        let freqTools: unknown[] = [];
        let chatNotes: unknown[] = [];
        if (res.rows.length > 0) {
          memId = res.rows[0].id_uuid;
          freqTools = typeof res.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(res.rows[0].frequently_used_tools_json) : res.rows[0].frequently_used_tools_json || [];
          chatNotes = typeof res.rows[0].chat_notes_json === 'string' ? JSON.parse(res.rows[0].chat_notes_json) : res.rows[0].chat_notes_json || [];
        }

        await pool.query(`
          INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          ON CONFLICT (tenant_id, user_id)
          DO UPDATE SET 
            response_preferences_text = EXCLUDED.response_preferences_text,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [memId, tenantId, userId, input.response_preferences_text, JSON.stringify(freqTools), JSON.stringify(chatNotes)]);

        return { success: true, id_uuid: memId };
      }
    }),

  saveNoteToEntity: protectedProcedure
    .input(SaveEntityNoteSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";
      
      // Resolve actual Admin identity instead of default "Demo User"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      const noteId = uuidv4();
      const timestamp = new Date().toISOString();

      const newNote = {
        id_uuid: noteId,
        content: input.content,
        created_at_utc: timestamp,
        created_by_identity: actorIdentity
      };

      // 1. UPDATE CRM ENTITY METADATA & CUSTOM_DOCUMENTS MARKDOWN
      let entityName = "Unbekannt";
      let entityFound = false;
      if (input.entity_type === 'user') {
        entityFound = true; // User memory notes have no CRM table mirror
        entityName = actorIdentity || "Eigene Notiz";
      } else if (isUsingFallback) {
        let list: (Company | Contact)[] = [];
        if (input.entity_type === 'company') list = fallbackStore.companies || [];
        else if (input.entity_type === 'contact') list = fallbackStore.contacts || [];

        const entity = list.find((e) => e.id_uuid === input.entity_id && e.tenant_id === tenantId);
        if (entity) {
          entityFound = true;
          entityName = entity.full_legal_name || entity.id_uuid || "Unbekannt";
          
          const metadata = (entity.metadata || {}) as Record<string, any>;
          if (!Array.isArray(metadata.notes)) {
            metadata.notes = [];
          }
          metadata.notes.push(newNote);
          entity.metadata = metadata;

          const existingDocs = entity.custom_documents || "";
          const formattedDate = new Date().toLocaleDateString('de-DE');
          const markdownNote = `---

🤖 **LOUIS AI** | Freigegeben durch: *${actorIdentity}* am *${formattedDate}*

${input.content.trim()}

---`;
          entity.custom_documents = existingDocs ? `${existingDocs.trim()}\n\n${markdownNote}` : markdownNote;
          
          saveFallbackStore();
        }
      } else {
        let tableName = "";
        if (input.entity_type === 'company') tableName = "core_registry_companies";
        else if (input.entity_type === 'contact') tableName = "core_registry_contacts";

        if (tableName && input.entity_id) {
          const r = await pool.query(`SELECT metadata, custom_documents, full_legal_name FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [input.entity_id, tenantId]);
          if (r.rows.length > 0) {
            entityFound = true;
            entityName = r.rows[0].full_legal_name || input.entity_id;
            const metadataObj = r.rows[0].metadata || {};
            if (!metadataObj.notes) metadataObj.notes = [];
            metadataObj.notes.push(newNote);

            const existingDocs = r.rows[0].custom_documents || "";
            const formattedDate = new Date().toLocaleDateString('de-DE');
            const markdownNote = `---

🤖 **LOUIS AI** | Freigegeben durch: *${actorIdentity}* am *${formattedDate}*

${input.content.trim()}

---`;
            const updatedDocs = existingDocs ? `${existingDocs.trim()}\n\n${markdownNote}` : markdownNote;

            await pool.query(
              `UPDATE ${tableName} SET metadata = $1, custom_documents = $2 WHERE id_uuid = $3 AND tenant_id = $4`,
              [JSON.stringify(metadataObj), updatedDocs, input.entity_id, tenantId]
            );
          }
        }
      }

      if (!entityFound) {
        throw new Error(`CRM Entity ${input.entity_type} with ID ${input.entity_id} not found.`);
      }

      // 2. APPEND NOTE TO USER MEMORY (chat_notes_json) - ONLY FOR USER ENTITY TYPE
      if (input.entity_type === 'user') {
        const userMemoryNote = {
          id_uuid: noteId,
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          content: input.content,
          created_at_utc: timestamp,
          is_rag_indexed: !!input.is_rag_indexed
        };

        if (isUsingFallback) {
          if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
          let memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (!memory) {
            memory = {
              id_uuid: uuidv4(),
              tenant_id: tenantId,
              user_id: userId,
              response_preferences_text: "",
              frequently_used_tools_json: [],
              chat_notes_json: [],
              created_at_utc: timestamp,
              updated_at_utc: timestamp
            };
            fallbackStore.louisAiUserMemory.push(memory);
          }
          if (!memory.chat_notes_json) memory.chat_notes_json = [];
          memory.chat_notes_json.push(userMemoryNote);
          saveFallbackStore();
        } else {
          const memRes = await pool.query(
            "SELECT id_uuid, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
            [userId, tenantId]
          );
          let chatNotes: unknown[] = [];
          let responsePreferences = "";
          let freqTools: unknown[] = [];
          let memId = uuidv4();
          if (memRes.rows.length > 0) {
            memId = memRes.rows[0].id_uuid;
            responsePreferences = memRes.rows[0].response_preferences_text || "";
            freqTools = typeof memRes.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(memRes.rows[0].frequently_used_tools_json) : memRes.rows[0].frequently_used_tools_json || [];
            chatNotes = typeof memRes.rows[0].chat_notes_json === 'string' ? JSON.parse(memRes.rows[0].chat_notes_json) : memRes.rows[0].chat_notes_json || [];
          }
          chatNotes.push(userMemoryNote);

          await pool.query(`
            INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
            ON CONFLICT (tenant_id, user_id)
            DO UPDATE SET chat_notes_json = EXCLUDED.chat_notes_json, updated_at_utc = CURRENT_TIMESTAMP
          `, [memId, tenantId, userId, responsePreferences, JSON.stringify(freqTools), JSON.stringify(chatNotes)]);
        }

        // Automatic RAG indexing if requested
        if (input.is_rag_indexed) {
          try {
            const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
            if (!fs.existsSync(KNOWLEDGE_ROOT)) {
              fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
            }
            const filename = `notiz_${noteId}.txt`;
            const filePath = path.join(KNOWLEDGE_ROOT, filename);
            fs.writeFileSync(filePath, input.content, "utf8");
            await forceManualIngest(filePath, filename, tenantId, "global");
            console.log(`[RAG Ingestion] Note "${noteId}" directly indexed during creation context`);
          } catch (err) {
            console.error(`[RAG Ingestion] Failed to automatically index note "${noteId}" on creation:`, err);
          }
        }
      }

      // 3. LOG AUDIT EVENT
      let detailSnippet = input.content.slice(0, 80);
      if (input.content.length > 80) detailSnippet += "...";

      let auditDetails = "";
      if (input.entity_type === 'user') {
        auditDetails = `Persönliche Wissensnotiz im Langzeitgedächtnis des Benutzers angelegt: "${detailSnippet}"`;
      } else if (input.entity_type === 'company') {
        auditDetails = `Notiz als Markdown im Bereich 'Notizen & Dokumente' für Firma "${entityName}" (ID: ${input.entity_id}) gespeichert: "${detailSnippet}"`;
      } else if (input.entity_type === 'contact') {
        auditDetails = `Notiz als Markdown im Bereich 'Notizen & Dokumente' für Kontakt "${entityName}" (ID: ${input.entity_id}) gespeichert: "${detailSnippet}"`;
      }

      await logAuditEvent({
        tenantId,
        eventType: "CREATE_NOTE",
        entityType: input.entity_type,
        entityId: input.entity_id,
        eventDetails: auditDetails,
        actorIdentity: ctx.session?.user?.name || "LOUIS CRM AI"
      });

      return { success: true, noteId };
    }),

  getTextGeneratorConfig: protectedProcedure
    .output(z.object({
      id_uuid: z.string().optional(),
      system_prompt: z.string(),
      temperature: z.number(),
      max_tokens: z.number(),
      model_name: z.string(),
    }))
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;

      if (isUsingFallback) {
        const list = fallbackStore.textGeneratorConfig || [];
        const found = list.find((c) => c.tenant_id === tenantId);
        if (found) {
          return {
            id_uuid: found.id_uuid,
            system_prompt: found.system_prompt,
            temperature: found.temperature,
            max_tokens: found.max_tokens,
            model_name: found.model_name || "gemini-3.5-flash",
          };
        }
      } else {
        try {
          const res = await pool.query(
            "SELECT id_uuid, system_prompt, temperature, max_tokens, model_name FROM sys_integrations_text_generator_config WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            return {
              id_uuid: row.id_uuid,
              system_prompt: row.system_prompt,
              temperature: row.temperature,
              max_tokens: row.max_tokens,
              model_name: row.model_name || "gemini-3.5-flash",
            };
          }
        } catch (err) {
          console.warn("sys_integrations_text_generator_config query failed:", err);
        }
      }

      // Default configuration
      return {
        system_prompt: "Du bist eine hochentwickelte Text-Schreib-KI für das Louis Smart CRM-System. Schreibe den angeforderten Text elegant, präzise und fehlerfrei. Benutze professionelle Formulierungen und folge exakt den Anweisungen. Wenn Platzhalter (wie {{invoice_number}}, {{my_company_name}}, etc.) im Ausgangstext oder Kontext vorkommen, übernehme und erhalte sie exakt so, wie sie definiert sind.",
        temperature: 0.7,
        max_tokens: 2000,
        model_name: "gemini-3.5-flash"
      };
    }),

  saveTextGeneratorConfig: protectedProcedure
    .input(TextGeneratorConfigSchema)
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const id = input.id_uuid || uuidv4();

      if (isUsingFallback) {
        if (!fallbackStore.textGeneratorConfig) {
          fallbackStore.textGeneratorConfig = [];
        }
        fallbackStore.textGeneratorConfig = fallbackStore.textGeneratorConfig.filter((c) => c.tenant_id !== tenantId);
        fallbackStore.textGeneratorConfig.push({
          ...input,
          id_uuid: id,
          tenant_id: tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_integrations_text_generator_config (
            id_uuid, tenant_id, system_prompt, temperature, max_tokens, model_name, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
          ON CONFLICT (tenant_id)
          DO UPDATE SET 
            system_prompt = EXCLUDED.system_prompt,
            temperature = EXCLUDED.temperature,
            max_tokens = EXCLUDED.max_tokens,
            model_name = EXCLUDED.model_name,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          id,
          tenantId,
          input.system_prompt,
          input.temperature,
          input.max_tokens,
          input.model_name
        ]);
      }

      await logAuditEvent({
        tenantId,
        eventType: "UPDATE",
        entityType: "settings",
        actorIdentity: "human",
        eventDetails: "Louis AI Text Generator config updated."
      });

      return { success: true };
    }),

  generateText: protectedProcedure
    .input(z.object({
      fieldId: z.string(),
      currentValue: z.string().optional().nullable(),
      context: z.string(),
      userInstructions: z.string(),
      chatHistory: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string()
      })).default([])
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      // 1. Get configs
      let aiConfig: {
        provider_type: string;
        model_name: string;
        temperature: number;
        top_p: number;
        top_k: number;
        num_ctx: number;
        api_key_secret?: string;
        base_url?: string;
      } | null = null;
      try {
        if (isUsingFallback) {
          const list = fallbackStore.louisAiConfig || [];
          const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
          if (found) {
            aiConfig = {
              provider_type: found.provider_type,
              model_name: found.model_name,
              temperature: found.temperature,
              top_p: found.top_p,
              top_k: found.top_k,
              num_ctx: found.num_ctx,
              api_key_secret: found.api_key_secret,
              base_url: found.base_url
            };
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            aiConfig = res.rows[0];
          }
        }
      } catch (err) {
        console.warn("Failed to load Louis AI config:", err);
      }

      if (!aiConfig) {
        aiConfig = {
          provider_type: 'gemini',
          model_name: "gemini-3.5-flash",
          temperature: 0.2,
          top_p: 0.9,
          top_k: 40,
          num_ctx: 8192
        };
      }

      const provider = aiConfig.provider_type || 'gemini';
      let cleanApiKey = aiConfig.api_key_secret?.trim() || '';
      if (cleanApiKey.includes('@') || cleanApiKey === '******') {
        cleanApiKey = '';
      }

      const needsApiKey = provider !== 'ollama';
      if (needsApiKey && !cleanApiKey) {
        throw new Error(`Fehler: Kein gültiger API-Schlüssel für '${provider.toUpperCase()}' in den LOUIS AI-Einstellungen konfiguriert.`);
      }

      // Load text generator settings
      let systemPrompt = "Du bist eine hochentwickelte Text-Schreib-KI für das Louis Smart CRM-System. Schreibe den angeforderten Text elegant, präzise und fehlerfrei. Benutze professionelle Formulierungen und folge exakt den Anweisungen. Wenn Platzhalter (wie {{invoice_number}}, {{my_company_name}}, etc.) im Ausgangstext oder Kontext vorkommen, übernehme und erhalte sie exakt so, wie sie definiert sind.";
      let temp = 0.7;
      let maxTokens = 2000;

      try {
        if (isUsingFallback) {
          const list = fallbackStore.textGeneratorConfig || [];
          const found = list.find((c) => c.tenant_id === tenantId);
          if (found) {
            systemPrompt = found.system_prompt;
            temp = found.temperature;
            maxTokens = found.max_tokens;
          }
        } else {
          const res = await pool.query(
            "SELECT system_prompt, temperature, max_tokens FROM sys_integrations_text_generator_config WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (res.rows.length > 0) {
            const row = res.rows[0];
            systemPrompt = row.system_prompt;
            temp = row.temperature;
            maxTokens = row.max_tokens;
          }
        }
      } catch (err) {
        console.warn("Failed to load text generator config, using defaults:", err);
      }

      // Construct a tailored prompt enclosing context, current element value & user instructions
      const userMessageText = `
        ## CONTEXT:
        Current edited element/field: "${input.fieldId}" (${input.context})
        
        ## CURRENT FIELD VALUE:
        \`\`\`
        ${input.currentValue || '--- (Leer) ---'}
        \`\`\`

        ## USER INSTRUCTIONS / AMENDMENTS:
        ${input.userInstructions}

        ## OUTPUT REQUIREMENTS:
        - Output ONLY the newly drafted or refined text content. No conversational introduction ("Hier ist dein Entwurf..."), no markdown code blocks unless the element actually edits html (only if context is 'email_body' or 'signature' should you generate formatted HTML paragraphs, otherwise output plain text).
        - Act precisely on the instructions.
        - Erhalte CRM Platzhalter wie {{invoice_number}}, {{due_date}}, usw. unverändert!
      `;

      // Construct chat structures and contents
      const contentsList: unknown[] = [];
      // Push history
      for (const msg of input.chatHistory) {
        contentsList.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        });
      }
      // Push final message
      contentsList.push({
        role: 'user',
        parts: [{ text: userMessageText }]
      });

      try {
        const aiResponse = await generateContentUniversal({
          provider_type: provider as 'gemini' | 'ollama' | 'openai' | 'anthropic',
          model_name: aiConfig.model_name || 'gemini-3.5-flash',
          api_key_secret: cleanApiKey,
          base_url: aiConfig.base_url,
          temperature: temp,
          contents: contentsList,
          systemInstruction: systemPrompt
        });

        const textOutput = aiResponse.text || "Fehler: Antwort konnte nicht generiert werden.";
        return { text: textOutput };
      } catch (err) {
        console.error("Text Gen Call failed:", err);
        return { text: `Fehler bei der Textgenerierung: ${(err as Error).message}` };
      }
    }),

  listAvailableModels: protectedProcedure
    .input(z.object({
      provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini']),
      api_key_secret: z.string().optional().nullable(),
      base_url: z.string().optional().nullable(),
    }))
    .output(z.object({
      success: z.boolean(),
      models: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
      })),
      error: z.string().optional().nullable()
    }))
    .query(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;

      if (input.provider_type === 'gemini') {
        let apiKey = input.api_key_secret?.trim() || '';

        if (apiKey.includes('@') || apiKey === '******') {
          apiKey = '';
        }

        if (!apiKey) {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret.trim();
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret.trim();
            }
          }
        }

        if (apiKey.includes('@') || apiKey === '******') {
          apiKey = '';
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Empfohlenes Standardmodell (Text)' },
              { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Leichtes, schnelles Modell' },
              { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', description: 'Hochpräzises Entwickler-Modell' },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Schnelles, stabiles Produktionsmodell' },
              { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Leistungsstarkes Vorschau-Modell' }
            ],
            error: "Es wurde kein Gemini API-Schlüssel in den Einstellungen gefunden."
          };
        }

        try {
          const gAI = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              }
            }
          });
          const listRes = await gAI.models.list();
          const listArr = listRes ? (Array.isArray(listRes) ? listRes : (listRes.page || (listRes as unknown as Record<string, unknown>).models || [])) : [];
          
          const rawModels = (listArr as Record<string, unknown>[]).map((m) => {
            const id = String(m.name || '').replace(/^models\//, '') || String(m.name || '') || '';
            const name = String(m.displayName || id);
            return {
              id,
              name,
              description: m.description ? String(m.description) : null
            };
          });

          // Filtere nach relevanten Generierungsmodellen
          const filteredModels = rawModels.filter((m) => 
            m.id.toLowerCase().includes("gemini") && 
            !m.id.toLowerCase().includes("embedding") &&
            !m.id.toLowerCase().includes("bidi") &&
            !m.id.toLowerCase().includes("aqa") &&
            !m.id.toLowerCase().includes("classification")
          );

          if (filteredModels.length === 0) {
            return {
              success: true,
              models: rawModels.slice(0, 20),
              error: null
            };
          }

          return {
            success: true,
            models: filteredModels,
            error: null
          };
        } catch (err: unknown) {
          console.error("Gemini models.list call failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Empfohlenes Standardmodell (Text)' },
              { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Leichtes, schnelles Modell' },
              { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Stabil' }
            ],
            error: `API-Abfrage fehlgeschlagen: ${errMsg}`
          };
        }
      }

      if (input.provider_type === 'ollama') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'http://localhost:11434';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `http://${u}`;
        }
        if (!u) {
          u = 'http://localhost:11434';
        }
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds
          const res = await fetch(`${u}/api/tags`, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { models?: Record<string, any>[] };
          if (data && Array.isArray(data.models)) {
            const parsed = data.models.map((m) => ({
              id: String(m.name),
              name: String(m.name),
              description: `Größe: ${(Number(m.size) / (1024*1024*1024)).toFixed(2)} GB, Details: ${m.details?.parameter_size || 'N/A'}`
            }));
            return {
              success: true,
              models: parsed,
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Keine Modelle gefunden."
          };
        } catch (err: unknown) {
          console.error("Ollama list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'llama3:latest', name: 'llama3:latest', description: 'Sehr populäres 8B Modell' },
              { id: 'llama3.1', name: 'llama3.1', description: 'Sehr populäres 8B Modell' },
              { id: 'llama3:8b', name: 'llama3:8b', description: 'Älteres Llama 3 Modell' },
              { id: 'mistral', name: 'mistral', description: 'Kompakt' },
              { id: 'gemma2', name: 'gemma2', description: 'Googles Gemma 2' },
              { id: 'phi3', name: 'phi3', description: 'Microsofts kleines Modell' }
            ],
            error: `Ollama-Abruf fehlgeschlagen unter ${u}: ${errMsg}. Lokaler Server läuft eventuell nicht.`
          };
        }
      }

      if (input.provider_type === 'openai') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'https://api.openai.com';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `https://${u}`;
        }
        if (!u) {
          u = 'https://api.openai.com';
        }
        let apiKey = input.api_key_secret;
        if (!apiKey || apiKey === '******' || apiKey === '') {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret;
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret;
            }
          }
        }

        if (!apiKey || apiKey === '******' || apiKey === '') {
          apiKey = process.env.OPENAI_API_KEY;
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'gpt-4o', name: 'gpt-4o', description: 'High-intelligence flagship' },
              { id: 'gpt-4o-mini', name: 'gpt-4o-mini', description: 'Fast, lightweight intelligence' },
              { id: 'o1-mini', name: 'o1-mini', description: 'Reasoning model for math & logic' }
            ],
            error: "Es wurde kein OpenAI API-Schlüssel konfiguriert. Zeige Standard-Modelle."
          };
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${u}/v1/models`, {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { data?: Record<string, any>[] };
          if (data && Array.isArray(data.data)) {
            const textModels = data.data
              .filter((m) => 
                String(m.id).includes("gpt") || 
                String(m.id).includes("o1") || 
                String(m.id).includes("o3")
              )
              .map((m) => ({
                id: String(m.id),
                name: String(m.id),
                description: `Eigentümer: ${m.owned_by || 'OpenAI'}`
              }));
            return {
              success: true,
              models: textModels.length > 0 ? textModels : data.data.slice(0, 15).map((m) => ({ id: String(m.id), name: String(m.id) })),
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Antwort hatte ein ungültiges Format."
          };
        } catch (err: unknown) {
          console.error("OpenAI model list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'gpt-4o', name: 'gpt-4o', description: 'Flaggschiff' },
              { id: 'gpt-4o-mini', name: 'gpt-4o-mini', description: 'Schnelle Intelligenz' }
            ],
            error: `OpenAI-Abruf fehlgeschlagen: ${errMsg}`
          };
        }
      }

      if (input.provider_type === 'anthropic') {
        let u = input.base_url?.trim() || '';
        if (u.includes('@')) {
          u = 'https://api.anthropic.com';
        }
        if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
          u = `https://${u}`;
        }
        if (!u) {
          u = 'https://api.anthropic.com';
        }
        let apiKey = input.api_key_secret;
        if (!apiKey || apiKey === '******' || apiKey === '') {
          if (isUsingFallback) {
            const list = fallbackStore.louisAiConfig || [];
            const found = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
            if (found && found.api_key_secret) apiKey = found.api_key_secret;
          } else {
            const res = await pool.query(
              "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
              [tenantId]
            );
            if (res.rows.length > 0 && res.rows[0].api_key_secret) {
              apiKey = res.rows[0].api_key_secret;
            }
          }
        }

        if (!apiKey || apiKey === '******' || apiKey === '') {
          apiKey = process.env.ANTHROPIC_API_KEY;
        }

        if (!apiKey) {
          return {
            success: false,
            models: [
              { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Hochpräzise Allround-Fähigkeiten (Empfohlen)' },
              { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Schnorchel-Modell für schnelle Chats' },
              { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', description: 'Komplexes System- und Programmierdenken' }
            ],
            error: "Es wurde kein Anthropic API-Schlüssel konfiguriert. Zeige Standard-Auswahl."
          };
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(`${u}/v1/models`, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json() as { data?: Record<string, any>[] };
          if (data && Array.isArray(data.data)) {
            const parsed = data.data.map((m) => ({
              id: String(m.id),
              name: String(m.display_name || m.id),
              description: `Typ: ${m.type || 'Anthropic Model'}`
            }));
            return {
              success: true,
              models: parsed,
              error: null
            };
          }
          return {
            success: true,
            models: [],
            error: "Keine Modelle gelistet."
          };
        } catch (err: unknown) {
          console.error("Anthropic model list failed:", err);
          const errMsg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            models: [
              { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', description: 'Fallback Sonnet' },
              { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Fallback Haiku' }
            ],
            error: `Anthropic-Abruf fehlgeschlagen: ${errMsg}`
          };
        }
      }

      return {
        success: false,
        models: [],
        error: "Unbekannter Provider"
      };
    }),

  editEntityNote: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      content: z.string().min(1).max(10000)
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // 1. Update in sys_louis_ai_user_memory (chat_notes_json)
      let foundType: 'user' | 'company' | 'contact' = 'user';
      let foundEntityId: string | undefined = undefined;
      let noteRef: SavedChatNote | null = null;

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            const note = memory.chat_notes_json.find((n) => n.id_uuid === input.id_uuid);
            if (note) {
              note.content = input.content;
              note.updated_at_utc = new Date().toISOString();
              const typeVal = note.entity_type || 'user';
              if (typeVal === 'company' || typeVal === 'contact') {
                foundType = typeVal;
              } else {
                foundType = 'user';
              }
              foundEntityId = note.entity_id;
              noteRef = note;
            }
          }
        }
        
        // 2. Also update mirror in CRM entities if needed
        if (foundType !== 'user' && foundEntityId) {
          let list: (Company | Contact)[] = [];
          if (foundType === 'company') list = fallbackStore.companies || [];
          else if (foundType === 'contact') list = fallbackStore.contacts || [];

          const entity = list.find((e) => e.id_uuid === foundEntityId && e.tenant_id === tenantId);
          if (entity && entity.metadata) {
            const metadataObj = entity.metadata as Record<string, any>;
            if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
              const notes = metadataObj.notes as EntityNote[];
              const noteMirror = notes.find((n) => n.id_uuid === input.id_uuid);
              if (noteMirror) {
                noteMirror.content = input.content;
                metadataObj.notes = notes;
                entity.metadata = metadataObj;
              }
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          let chatNotes: SavedChatNote[] = typeof memRes.rows[0].chat_notes_json === 'string' 
            ? JSON.parse(memRes.rows[0].chat_notes_json) 
            : memRes.rows[0].chat_notes_json || [];
          
          const note = chatNotes.find((n) => n.id_uuid === input.id_uuid);
          if (note) {
            note.content = input.content;
            note.updated_at_utc = new Date().toISOString();
            const typeVal = note.entity_type || 'user';
            if (typeVal === 'company' || typeVal === 'contact') {
              foundType = typeVal;
            } else {
              foundType = 'user';
            }
            foundEntityId = note.entity_id;
            noteRef = note;

            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memRes.rows[0].id_uuid, tenantId]);
          }
        }

        // Mirror check in Postgres
        if (foundType !== 'user' && foundEntityId) {
          let tableName = "";
          if (foundType === 'company') tableName = "core_registry_companies";
          else if (foundType === 'contact') tableName = "core_registry_contacts";

          if (tableName) {
            const er = await pool.query(`SELECT metadata FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [foundEntityId, tenantId]);
            if (er.rows.length > 0) {
              const metadataObj = er.rows[0].metadata || {};
              if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
                const notes = metadataObj.notes as EntityNote[];
                const noteMirror = notes.find((n) => n.id_uuid === input.id_uuid);
                if (noteMirror) {
                  noteMirror.content = input.content;
                  metadataObj.notes = notes;
                  await pool.query(`UPDATE ${tableName} SET metadata = $1 WHERE id_uuid = $2 AND tenant_id = $3`, [JSON.stringify(metadataObj), foundEntityId, tenantId]);
                }
              }
            }
          }
        }
      }

      // Automatically re-ingest updated note text if it is marked as indexed in RAG
      if (noteRef && noteRef.is_rag_indexed) {
        try {
          const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
          if (!fs.existsSync(KNOWLEDGE_ROOT)) {
            fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
          }
          const filename = `notiz_${input.id_uuid}.txt`;
          const filePath = path.join(KNOWLEDGE_ROOT, filename);
          fs.writeFileSync(filePath, input.content, "utf8");
          await forceManualIngest(filePath, filename, tenantId, "global");
          console.log(`[RAG Ingestion] Re-indexed modified note "${input.id_uuid}" successfully`);
        } catch (err) {
          console.error(`[RAG Ingestion] Failed to re-index edited note "${input.id_uuid}":`, err);
        }
      }

      return { success: true };
    }),

  deleteEntityNote: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // Resolve actual Admin identity instead of default "Demo User"
      let actorIdentity = "Admin";
      if (isUsingFallback) {
        if (fallbackStore.myCompany) {
          const fn = fallbackStore.myCompany.first_name || "";
          const ln = fallbackStore.myCompany.last_name || "";
          const resolved = `${fn} ${ln}`.trim();
          if (resolved && resolved !== "Demo User") {
            actorIdentity = resolved;
          }
        }
      } else {
        try {
          const compRes = await pool.query(
            "SELECT first_name, last_name FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
          );
          if (compRes.rows.length > 0) {
            const fn = compRes.rows[0].first_name || "";
            const ln = compRes.rows[0].last_name || "";
            const resolved = `${fn} ${ln}`.trim();
            if (resolved && resolved !== "Demo User") {
              actorIdentity = resolved;
            }
          }
        } catch (e) {
          // fallback to Admin
        }
      }

      let foundType: 'user' | 'company' | 'contact' = 'user';
      let foundEntityId: string | undefined = undefined;
      let deletedContentPreview = "";

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            const index = memory.chat_notes_json.findIndex((n) => n.id_uuid === input.id_uuid);
            if (index !== -1) {
              const note = memory.chat_notes_json[index];
              const typeVal = note.entity_type || 'user';
              if (typeVal === 'company' || typeVal === 'contact') {
                foundType = typeVal;
              } else {
                foundType = 'user';
              }
              foundEntityId = note.entity_id;
              deletedContentPreview = note.content || "";
              memory.chat_notes_json.splice(index, 1);
            }
          }
        }
        
        if (foundType !== 'user' && foundEntityId) {
          let list: (Company | Contact)[] = [];
          if (foundType === 'company') list = fallbackStore.companies || [];
          else if (foundType === 'contact') list = fallbackStore.contacts || [];

          const entity = list.find((e) => e.id_uuid === foundEntityId && e.tenant_id === tenantId);
          if (entity && entity.metadata) {
            const metadataObj = entity.metadata as Record<string, unknown>;
            const notes = metadataObj.notes;
            if (notes && Array.isArray(notes)) {
              const index = notes.findIndex((n: unknown) => {
                const noteObj = n as Record<string, unknown>;
                return noteObj.id_uuid === input.id_uuid;
              });
              if (index !== -1) {
                notes.splice(index, 1);
                entity.metadata = metadataObj;
              }
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          let chatNotes: SavedChatNote[] = typeof memRes.rows[0].chat_notes_json === 'string' 
            ? JSON.parse(memRes.rows[0].chat_notes_json) 
            : memRes.rows[0].chat_notes_json || [];
          
          const index = chatNotes.findIndex((n) => n.id_uuid === input.id_uuid);
          if (index !== -1) {
            const note = chatNotes[index];
            const typeVal = note.entity_type || 'user';
            if (typeVal === 'company' || typeVal === 'contact') {
              foundType = typeVal;
            } else {
              foundType = 'user';
            }
            foundEntityId = note.entity_id;
            deletedContentPreview = note.content || "";
            chatNotes.splice(index, 1);

            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memRes.rows[0].id_uuid, tenantId]);
          }
        }

        if (foundType !== 'user' && foundEntityId) {
          let tableName = "";
          if (foundType === 'company') tableName = "core_registry_companies";
          else if (foundType === 'contact') tableName = "core_registry_contacts";

          if (tableName) {
            const er = await pool.query(`SELECT metadata FROM ${tableName} WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1`, [foundEntityId, tenantId]);
            if (er.rows.length > 0) {
              const metadataObj = er.rows[0].metadata || {};
              if (metadataObj.notes && Array.isArray(metadataObj.notes)) {
                const index = metadataObj.notes.findIndex((n) => n.id_uuid === input.id_uuid);
                if (index !== -1) {
                  metadataObj.notes.splice(index, 1);
                  await pool.query(`UPDATE ${tableName} SET metadata = $1 WHERE id_uuid = $2 AND tenant_id = $3`, [JSON.stringify(metadataObj), foundEntityId, tenantId]);
                }
              }
            }
          }
        }
      }

      // Cleanup associated RAG document and vector chunks on deletion
      try {
        const filename = `notiz_${input.id_uuid}.txt`;
        const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
        const filePath = path.join(KNOWLEDGE_ROOT, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        await unindexFileFromRag(filename, tenantId);
        console.log(`[RAG Ingestion] Note "${input.id_uuid}" fully unindexed and cleaned up on delete`);
      } catch (err) {
        console.error(`[RAG Ingestion] Cleanup failed for note deletion "${input.id_uuid}":`, err);
      }

      // Log Audit Event
      let contentSnippet = deletedContentPreview.slice(0, 80);
      if (deletedContentPreview.length > 80) contentSnippet += "...";

      await logAuditEvent({
        tenantId,
        eventType: "DELETE_NOTE",
        entityType: foundType,
        entityId: foundEntityId,
        eventDetails: `Wissensnotiz aus dem Langzeitgedächtnis entfernt. Inhalt: "${contentSnippet}"`,
        actorIdentity: actorIdentity || "LOUIS CRM AI"
      });

      return { success: true };
    }),

  toggleNoteRagIndex: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      is_rag_indexed: z.boolean()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const userId = ctx.session?.user?.id || ctx.session?.user?.email || "human_user";

      // 1. Get user memory and locate note
      let chatNotes: SavedChatNote[] = [];
      let foundNote: SavedChatNote | null = null;
      let memId = "";
      let responsePreferences = "";
      let freqTools: unknown[] = [];

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === tenantId);
          if (memory && memory.chat_notes_json) {
            foundNote = memory.chat_notes_json.find((n) => n.id_uuid === input.id_uuid) || null;
            if (foundNote) {
              foundNote.is_rag_indexed = input.is_rag_indexed;
            }
          }
        }
        saveFallbackStore();
      } else {
        const memRes = await pool.query(
          "SELECT id_uuid, response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, tenantId]
        );
        if (memRes.rows.length > 0) {
          memId = memRes.rows[0].id_uuid;
          responsePreferences = memRes.rows[0].response_preferences_text || "";
          freqTools = typeof memRes.rows[0].frequently_used_tools_json === 'string' ? JSON.parse(memRes.rows[0].frequently_used_tools_json) : memRes.rows[0].frequently_used_tools_json || [];
          chatNotes = typeof memRes.rows[0].chat_notes_json === 'string' ? JSON.parse(memRes.rows[0].chat_notes_json) : memRes.rows[0].chat_notes_json || [];
          
          foundNote = chatNotes.find((n) => n.id_uuid === input.id_uuid) || null;
          if (foundNote) {
            foundNote.is_rag_indexed = input.is_rag_indexed;
            await pool.query(`
              UPDATE sys_louis_ai_user_memory 
              SET chat_notes_json = $1, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $2 AND tenant_id = $3
            `, [JSON.stringify(chatNotes), memId, tenantId]);
          }
        }
      }

      if (!foundNote) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Notiz nicht gefunden."
        });
      }

      // 2. Perform RAG indexing or unindexing
      const filename = `notiz_${input.id_uuid}.txt`;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      const filePath = path.join(KNOWLEDGE_ROOT, filename);

      if (input.is_rag_indexed) {
        try {
          if (!fs.existsSync(KNOWLEDGE_ROOT)) {
            fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
          }
          fs.writeFileSync(filePath, foundNote.content || "", "utf8");
          await forceManualIngest(filePath, filename, tenantId, "global");
          console.log(`[RAG Ingestion] Note "${input.id_uuid}" indexed manually successfully via toggle`);
        } catch (err) {
          console.error(`[RAG Ingestion] Ingestion failed inside toggleNoteRagIndex for "${input.id_uuid}":`, err);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Notiz-Indizierung fehlgeschlagen."
          });
        }
      } else {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
          await unindexFileFromRag(filename, tenantId);
          console.log(`[RAG Ingestion] Note "${input.id_uuid}" removed manually successfully via toggle`);
        } catch (err) {
          console.error(`[RAG Ingestion] Unindexing failed inside toggleNoteRagIndex for "${input.id_uuid}":`, err);
        }
      }

      // 3. Log Audit Event
      let contentSnippet = (foundNote.content || "").slice(0, 80);
      if ((foundNote.content || "").length > 80) contentSnippet += "...";

      await logAuditEvent({
        tenantId,
        eventType: input.is_rag_indexed ? "INDEX_NOTE_RAG" : "UNINDEX_NOTE_RAG",
        entityType: "user",
        entityId: input.id_uuid,
        eventDetails: input.is_rag_indexed 
          ? `Wissensnotiz in RAG Wissensdatenbank indiziert: "${contentSnippet}"`
          : `Wissensnotiz aus RAG Wissensdatenbank entfernt: "${contentSnippet}"`,
        actorIdentity: "Admin"
      });

      return { success: true };
    }),

  getKnowledgeFiles: protectedProcedure
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        if (!fs.existsSync(KNOWLEDGE_ROOT)) {
          fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
        }

        let indexedFiles: { file_name: string; chunk_count?: number }[] = [];

        if (isUsingFallback || !pool) {
          const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
          const chunks = fallbackStore.louisAiKnowledgeChunks || [];
          const matchedMeta = metadata.filter((m) => m.tenant_id === tenantId);
          indexedFiles = matchedMeta.map((m) => {
            const chunkCount = chunks.filter((c) => c.document_id === m.id_uuid).length;
            return { file_name: m.file_name, chunk_count: chunkCount };
          });
        } else {
          try {
            const res = await pool.query(
              `SELECT m.file_name, COUNT(c.id_uuid) as chunk_count
               FROM sys_louis_ai_knowledge_metadata m
               LEFT JOIN sys_louis_ai_knowledge_chunks c ON m.id_uuid = c.document_id
               WHERE m.tenant_id = $1
               GROUP BY m.id_uuid, m.file_name`,
              [tenantId]
            );
            indexedFiles = res.rows.map((row) => ({
              file_name: String(row.file_name),
              chunk_count: parseInt(String(row.chunk_count || 0))
            }));
          } catch (err) {
            console.error("Failed to query RAG document metadata in louisAiRouter:", err);
          }
        }
        
        const files = fs.readdirSync(KNOWLEDGE_ROOT);
        return files.map(file => {
          try {
            const fullPath = path.join(KNOWLEDGE_ROOT, file);
            const stats = fs.statSync(fullPath);
            const matchingMeta = indexedFiles.find(m => 
              file === m.file_name || file.endsWith("_" + m.file_name)
            );
            return {
              name: file,
              size: stats.size,
              mtime: stats.mtime.toISOString(),
              isIndexed: !!matchingMeta,
              chunkCount: matchingMeta ? (matchingMeta.chunk_count || 0) : 0,
            };
          } catch (e) {
            return null;
          }
        }).filter((item): item is NonNullable<typeof item> => item !== null);
      } catch (err) {
        console.error("Error getKnowledgeFiles:", err);
        return [];
      }
    }),

  saveKnowledgeFile: protectedProcedure
    .input(z.object({
      filename: z.string(),
      content: z.string(), // base64 encoded
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        if (!fs.existsSync(KNOWLEDGE_ROOT)) {
          fs.mkdirSync(KNOWLEDGE_ROOT, { recursive: true });
        }
        
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        const buffer = Buffer.from(input.content, 'base64');
        fs.writeFileSync(filePath, buffer);

        // Calculate metadata hash for duplicate checking
        const docHash = crypto.createHash('md5').update(buffer).digest('hex');
        const docId = uuidv4();
        const mimeType = mimeTypeFromFilename(input.filename);
        
        let isDuplicate = false;

        if (isUsingFallback || !pool) {
          if (!fallbackStore.louisAiKnowledgeMetadata) {
            fallbackStore.louisAiKnowledgeMetadata = [];
          }
          const existing = fallbackStore.louisAiKnowledgeMetadata.find(
            (m) => m.tenant_id === tenantId && m.document_hash === docHash
          );
          if (existing) {
            isDuplicate = true;
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND document_hash = $2 LIMIT 1",
            [tenantId, docHash]
          );
          if (res.rows.length > 0) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) {
          console.log(`[RAG Ingestion] Document "${input.filename}" (Hash: ${docHash}) already indexed.`);
          return { success: true, message: "Dokument bereits indiziert." };
        }

        // Ingest and save metadata record
        const metadataRecord = {
          id_uuid: docId,
          tenant_id: tenantId,
          file_name: input.filename,
          file_size_bytes: buffer.length,
          mime_type: mimeType,
          document_hash: docHash,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        };

        if (isUsingFallback || !pool) {
          fallbackStore.louisAiKnowledgeMetadata.push(metadataRecord);
        } else {
          await pool.query(
            `INSERT INTO sys_louis_ai_knowledge_metadata (id_uuid, tenant_id, file_name, file_size_bytes, mime_type, document_hash, created_at_utc, updated_at_utc)
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [docId, tenantId, input.filename, buffer.length, mimeType, docHash]
          );
        }

        // Check if format is text-parseable and chunk/index
        const isParseable = isTextBasedFile(input.filename);
        if (isParseable) {
          const ragConfig = await getRagConfig(tenantId);
          const chunks = await intelligentChunkAndProcess(buffer, input.filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

          if (chunks.length === 0) {
            console.log(`[saveKnowledgeFile] No chunks extracted from "${input.filename}". Skipped indexing.`);
            return { success: true, message: "Datei gespeichert, aber keine Text-Extrahierung möglich." };
          }

          console.log(`[RAG Ingestion] Extracted ${chunks.length} chunks for "${input.filename}" (Mime: ${mimeType}) using intelligent parsing`);

          for (const textChunk of chunks) {
            const chunkId = uuidv4();
            let embeddingValues: number[] | null = null;
            try {
              embeddingValues = await generateEmbedding(textChunk, tenantId);
            } catch (embedErr) {
              console.warn(`[RAG Ingestion] Failed to generate embedding for chunk:`, embedErr);
            }

            if (isUsingFallback || !pool) {
              if (!fallbackStore.louisAiKnowledgeChunks) {
                fallbackStore.louisAiKnowledgeChunks = [];
              }
              fallbackStore.louisAiKnowledgeChunks.push({
                id_uuid: chunkId,
                tenant_id: tenantId,
                document_id: docId,
                chunk_text: textChunk,
                embedding: embeddingValues,
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
            } else {
              const vectorStr = embeddingValues ? `[${embeddingValues.join(",")}]` : null;
              await pool.query(
                `INSERT INTO sys_louis_ai_knowledge_chunks (id_uuid, tenant_id, document_id, chunk_text, embedding, created_at_utc, updated_at_utc)
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [chunkId, tenantId, docId, textChunk, vectorStr]
              );
            }
          }
          if (isUsingFallback || !pool) {
            saveFallbackStore();
          }
        }

        await logAuditEvent({
          tenantId,
          eventType: "UPLOAD_KNOWLEDGE",
          entityType: "settings",
          actorIdentity: "human",
          eventDetails: `Knowledge document uploaded and RAG-indexed: ${input.filename}`
        });

        return { success: true };
      } catch (err: unknown) {
        console.error("Error saveKnowledgeFile:", err);
        const errMsg = err instanceof Error ? err.message : "Fehler beim Speichern der Datei.";
        throw new Error(errMsg);
      }
    }),

  forceIngestKnowledgeToRag: protectedProcedure
    .input(z.object({
      filename: z.string()
    }))
    .output(z.object({ success: z.boolean(), chunkCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const tenantId = ctx.tenantId;
        const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        
        if (!fs.existsSync(filePath)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datei nicht gefunden."
          });
        }

        const chunkCount = await forceManualIngest(filePath, input.filename, tenantId, "global");
        return { success: true, chunkCount };
      } catch (err) {
        console.error("[forceIngestKnowledgeToRag] Manual RAG Ingest failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Manueller RAG Ingest fehlgeschlagen."
        });
      }
    }),

  deleteKnowledgeFile: protectedProcedure
    .input(z.object({
      filename: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      
      try {
        const filePath = path.join(KNOWLEDGE_ROOT, input.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }

        // Retrieve and delete metadata node chunks
        if (isUsingFallback || !pool) {
          if (fallbackStore.louisAiKnowledgeMetadata) {
            const found = fallbackStore.louisAiKnowledgeMetadata.find(
              (m) => m.tenant_id === tenantId && m.file_name === input.filename
            );
            if (found) {
              const docId = found.id_uuid;
              fallbackStore.louisAiKnowledgeMetadata = fallbackStore.louisAiKnowledgeMetadata.filter((m) => m.id_uuid !== docId);
              if (fallbackStore.louisAiKnowledgeChunks) {
                fallbackStore.louisAiKnowledgeChunks = fallbackStore.louisAiKnowledgeChunks.filter((c) => c.document_id !== docId);
              }
              saveFallbackStore();
            }
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND file_name = $2 LIMIT 1",
            [tenantId, input.filename]
          );
          if (res.rows.length > 0) {
            const docId = res.rows[0].id_uuid;
            await pool.query("DELETE FROM sys_louis_ai_knowledge_metadata WHERE id_uuid = $1 AND tenant_id = $2", [docId, tenantId]);
            // cascade constraints on database automatically remove all chunks of docId
          }
        }

        await logAuditEvent({
          tenantId,
          eventType: "DELETE_KNOWLEDGE",
          entityType: "settings",
          actorIdentity: "human",
          eventDetails: `Knowledge document deleted & unindexed: ${input.filename}`
        });

        return { success: true };
      } catch (err: unknown) {
        console.error("Error deleteKnowledgeFile:", err);
        const errMsg = err instanceof Error ? err.message : "Fehler beim Löschen der Datei.";
        throw new Error(errMsg);
      }
    }),
});
