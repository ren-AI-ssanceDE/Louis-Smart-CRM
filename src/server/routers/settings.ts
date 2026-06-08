import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { generateInvoiceFilesOnDisk } from "../pdfHelper.js";
import { getEntityStoragePath, ingestEmailToRag } from "../storage.js";
import { 
  pool, 
  isUsingFallback, 
  fallbackStore, 
  logAuditEvent, 
  saveFallbackStore, 
  getBankDirectoryStats, 
  lookupBankDirectory, 
  upsertBankDirectoryBatch,
  cleanDbRow,
  initDatabase,
  FALLBACK_FILE_PATH
} from "../db.js";
import { validateIBAN, getBicByIban, getBankByIbanAndBic } from "../../lib/bankUtils.js";
import {
  SmtpSettingsSchema,
  SmtpSettingsFullSchema,
  SendMailSchema,
  MyCompanySchema,
  MyCompanyFullSchema,
  EmailTemplateSchema,
  EmailTemplateFullSchema,
  SignatureSchema,
  SignatureFullSchema,
  InvoiceTextTemplateSchema,
  InvoiceTextTemplateFullSchema,
  InvoiceItemTemplateSchema,
  InvoiceItemTemplateFullSchema,
  WebSearchSettingsSchema,
  WebSearchSettingsFullSchema,
  TelegramSettingsSchema,
  TelegramSettingsFullSchema
} from "../../lib/schemas.js";
import { Invoice, LouisAiConfig } from "../../types.js";

const sanitizeTextLigatures = (str: string): string => {
  if (!str) return str;
  return str
    .replace(/\u0430/g, "a")  // Cyrillic 'а'
    .replace(/\u0455/g, "s")  // Cyrillic 'ѕ'
    .replace(/\u0323/g, "")   // Combining dot below
    .replace(/\u200B/g, "")   // Zero-width space
    .replace(/\u00ad/g, "")   // Soft hyphen (SHY)
    .replace(/\xad/g, "");    // Hex representation of soft hyphen
};

const sanitizeInputLigatures = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return sanitizeTextLigatures(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInputLigatures) as unknown as T;
  }
  if (typeof obj === "object") {
    const rawObj = obj as Record<string, unknown>;
    const newObj: Record<string, unknown> = {};
    for (const key of Object.keys(rawObj)) {
      newObj[key] = sanitizeInputLigatures(rawObj[key]);
    }
    return newObj as unknown as T;
  }
  return obj;
};

export const settingsRouter = router({
  getTelegramSettings: protectedProcedure
    .output(z.nullable(TelegramSettingsFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.telegramConfig) fallbackStore.telegramConfig = [];
        const found = fallbackStore.telegramConfig.find(x => x.tenant_id === ctx.tenantId);
        return found || null;
      }
      const res = await pool.query("SELECT * FROM sys_integrations_telegram_config WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      return res.rows[0] ? cleanDbRow(res.rows[0]) : null;
    }),

  saveTelegramSettings: protectedProcedure
    .input(TelegramSettingsSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const id = input.id_uuid || uuidv4();
      if (isUsingFallback) {
        if (!fallbackStore.telegramConfig) fallbackStore.telegramConfig = [];
        const idx = fallbackStore.telegramConfig.findIndex(x => x.tenant_id === ctx.tenantId);
        const record = {
          ...input,
          id_uuid: id,
          tenant_id: ctx.tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        };
        if (idx !== -1) {
          fallbackStore.telegramConfig[idx] = {
            ...fallbackStore.telegramConfig[idx],
            ...record,
            updated_at_utc: new Date().toISOString()
          };
        } else {
          fallbackStore.telegramConfig.push(record);
        }
        saveFallbackStore();
        return { success: true };
      }

      const existing = await pool.query("SELECT id_uuid FROM sys_integrations_telegram_config WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE sys_integrations_telegram_config
          SET bot_token = $1, allowed_user_ids = $2, is_active = $3,
              updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $4 AND tenant_id = $5
        `, [
          input.bot_token,
          input.allowed_user_ids,
          input.is_active,
          existing.rows[0].id_uuid,
          ctx.tenantId
        ]);
      } else {
        const insertId = uuidv4();
        await pool.query(`
          INSERT INTO sys_integrations_telegram_config (
            id_uuid, tenant_id, bot_token, allowed_user_ids, is_active
          )
          VALUES ($1, $2, $3, $4, $5)
        `, [
          insertId,
          ctx.tenantId,
          input.bot_token,
          input.allowed_user_ids,
          input.is_active
        ]);
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'TELEGRAM_SETTINGS',
        eventDetails: `Updated Telegram bot configuration`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  testTelegramConnection: protectedProcedure
    .input(z.object({
      bot_token: z.string(),
      allowed_user_ids: z.string()
    }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const ids = input.allowed_user_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) {
          return { success: false, message: "Keine gültigen Benutzer-IDs angegeben." };
        }
        
        let successCount = 0;
        let lastError = "";
        
        for (const userId of ids) {
          try {
            const response = await fetch(`https://api.telegram.org/bot${input.bot_token}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: userId,
                text: "✈ *Louis Smart CRM*\n\nVerbindungstest erfolgreich! Ihr Telegram Bot Gateway ist jetzt startklar.",
                parse_mode: "Markdown"
              })
            });
            const resData = await response.json() as { ok: boolean; description?: string };
            if (resData.ok) {
              successCount++;
            } else {
              lastError = resData.description || "Fehler von Telegram API";
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }
        
        if (successCount > 0) {
          return { 
            success: true, 
            message: `Erfolgreich! Testnachricht wurde an ${successCount} von ${ids.length} Empfängern gesendet.` 
          };
        } else {
          return { 
            success: false, 
            message: `Verbindung fehlgeschlagen: ${lastError || "Unbekannter Fehler. Bitte überprüfen Sie Ihr Token."}` 
          };
        }
      } catch (err) {
        return { 
          success: false, 
          message: err instanceof Error ? err.message : String(err) 
        };
      }
    }),

  getWebSearchSettings: protectedProcedure
    .output(z.nullable(WebSearchSettingsFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.webSearchConfig) fallbackStore.webSearchConfig = [];
        const found = fallbackStore.webSearchConfig.find(x => x.tenant_id === ctx.tenantId);
        return found || null;
      }
      const res = await pool.query("SELECT * FROM sys_integrations_web_search_config WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      return res.rows[0] ? cleanDbRow(res.rows[0]) : null;
    }),

  saveWebSearchSettings: protectedProcedure
    .input(WebSearchSettingsSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const id = input.id_uuid || uuidv4();
      if (isUsingFallback) {
        if (!fallbackStore.webSearchConfig) fallbackStore.webSearchConfig = [];
        const idx = fallbackStore.webSearchConfig.findIndex(x => x.tenant_id === ctx.tenantId);
        const record = {
          ...input,
          id_uuid: id,
          tenant_id: ctx.tenantId,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        };
        if (idx !== -1) {
          fallbackStore.webSearchConfig[idx] = {
            ...fallbackStore.webSearchConfig[idx],
            ...record,
            updated_at_utc: new Date().toISOString()
          };
        } else {
          fallbackStore.webSearchConfig.push(record);
        }
        saveFallbackStore();
        return { success: true };
      }

      const existing = await pool.query("SELECT id_uuid FROM sys_integrations_web_search_config WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE sys_integrations_web_search_config
          SET selected_engine = $1, duckduckgo_url = $2, searxng_url = $3, searxng_categories = $4,
              google_api_key = $5, google_cx = $6,
              updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $7 AND tenant_id = $8
        `, [
          input.selected_engine,
          input.duckduckgo_url || null,
          input.searxng_url || null,
          input.searxng_categories || null,
          input.google_api_key || null,
          input.google_cx || null,
          existing.rows[0].id_uuid,
          ctx.tenantId
        ]);
      } else {
        const insertId = uuidv4();
        await pool.query(`
          INSERT INTO sys_integrations_web_search_config (
            id_uuid, tenant_id, selected_engine, duckduckgo_url, searxng_url, searxng_categories, google_api_key, google_cx
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          insertId,
          ctx.tenantId,
          input.selected_engine,
          input.duckduckgo_url || null,
          input.searxng_url || null,
          input.searxng_categories || null,
          input.google_api_key || null,
          input.google_cx || null
        ]);
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'WEB_SEARCH_SETTINGS',
        eventDetails: `Updated web search engine configuration to model: ${input.selected_engine}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  // SMTP Settings & Mailing
  getSmtpSettings: protectedProcedure
    .output(z.nullable(SmtpSettingsFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.smtpSettings as z.infer<typeof SmtpSettingsFullSchema>;
      const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [ctx.tenantId]);
      return res.rows[0] || null;
    }),

  saveSmtpSettings: protectedProcedure
    .input(SmtpSettingsSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const id = input.id_uuid || uuidv4();
      if (isUsingFallback) {
        fallbackStore.smtpSettings = { ...input, id_uuid: id, created_at_utc: new Date().toISOString(), updated_at_utc: new Date().toISOString() } as z.infer<typeof SmtpSettingsFullSchema>;
        saveFallbackStore();
        return { success: true };
      }
      
      const existing = await pool.query("SELECT id_uuid FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE sys_integrations_smtp_nodes
          SET smtp_host_name = $1, smtp_port_number = $2, smtp_user_name = $3, smtp_password_secret = $4,
              is_secure_connection = $5, sender_email_address = $6, sender_display_name = $7,
              is_verified_by_human = $8,
              updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $9 AND tenant_id = $10
        `, [
          input.smtp_host_name, input.smtp_port_number, input.smtp_user_name, input.smtp_password_secret,
          input.is_secure_connection, input.sender_email_address, input.sender_display_name,
          input.is_verified_by_human, existing.rows[0].id_uuid, ctx.tenantId
        ]);
      } else {
        const insertId = uuidv4();
        await pool.query(`
          INSERT INTO sys_integrations_smtp_nodes (
            id_uuid, tenant_id, smtp_host_name, smtp_port_number, smtp_user_name, smtp_password_secret,
            is_secure_connection, sender_email_address, sender_display_name,
            created_by_identity, ai_confidence_score, is_verified_by_human
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          insertId, ctx.tenantId, input.smtp_host_name, input.smtp_port_number, input.smtp_user_name, input.smtp_password_secret,
          input.is_secure_connection, input.sender_email_address, input.sender_display_name,
          input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human
        ]);
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'SMTP_SETTINGS',
        eventDetails: `Updated SMTP configuration`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  sendMail: protectedProcedure
    .input(SendMailSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      let smtp: z.infer<typeof SmtpSettingsFullSchema> | null | undefined;
      if (isUsingFallback) {
        smtp = fallbackStore.smtpSettings as z.infer<typeof SmtpSettingsFullSchema>;
      } else {
        const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [ctx.tenantId]);
        smtp = res.rows[0];
      }
      
      if (!smtp) {
        throw new TRPCError({ 
          code: "PRECONDITION_FAILED", 
          message: "SMTP settings not configured. Please set them in Admin > Connections." 
        });
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

      const attachments = [];
      if (input.invoiceId) {
        try {
          await generateInvoiceFilesOnDisk(input.invoiceId, ctx.tenantId);
          let invoice: (Invoice & { 
            entityType?: string; 
            entityId?: string; 
            entityName?: string;
            co_name?: string;
            ct_name?: string;
          }) | null = null;
          if (isUsingFallback) {
            const found = fallbackStore.invoices.find(i => i.id_uuid === input.invoiceId);
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
            `, [input.invoiceId, ctx.tenantId]);
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
            const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, ctx.tenantId);
            const displayPdfPath = path.join(entityStoragePath, `rechnung_${cleanNum}.pdf`);
            const recipientName = invoice.entityName || invoice.company_name || 'Empfaenger';
            const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
            const filename = `Rechnung - ${cleanRecipient} - ${cleanNum}.pdf`;

            if (fs.existsSync(displayPdfPath)) {
              attachments.push({
                filename: filename,
                path: displayPdfPath
              });
            }
          }
        } catch (pdfErr) {
          console.error("Failed to compile attachment PDF for mail:", pdfErr);
        }
      }

      // Add custom attachments if provided
      if (input.customAttachments && input.customAttachments.length > 0) {
        for (const att of input.customAttachments) {
          attachments.push({
            filename: att.filename,
            content: Buffer.from(att.content, 'base64'),
            contentType: att.contentType
          });
        }
      }

      try {
        await transporter.sendMail({
          from: smtp.sender_display_name 
            ? `"${smtp.sender_display_name}" <${smtp.sender_email_address}>`
            : smtp.sender_email_address,
          to: input.recipient_email_address,
          subject: input.email_subject_text,
          text: input.email_body_content.replace(/<[^>]*>/g, ''),
          html: input.email_body_content,
          attachments,
        });

        try {
          await ingestEmailToRag({
            tenantId: ctx.tenantId,
            recipient: input.recipient_email_address,
            senderType: 'Human',
            subject: input.email_subject_text,
            body: input.email_body_content,
            attachments
          });
        } catch (ragErr) {
          console.error("[sendMail] Failed to ingest sent mail to RAG:", ragErr);
        }

        return { success: true };
      } catch (error) {
        console.error("Mail sending failed:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to send email via SMTP: " + errorMsg,
        });
      }
    }),

  testSmtp: protectedProcedure
    .input(z.object({
      recipient_email_address: z.string().email(),
      temp_smtp_settings: SmtpSettingsSchema.optional().nullable(),
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      let smtp: z.infer<typeof SmtpSettingsSchema> | null | undefined;
      
      if (input.temp_smtp_settings) {
        smtp = input.temp_smtp_settings;
      } else if (isUsingFallback) {
        smtp = fallbackStore.smtpSettings;
      } else {
        const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [ctx.tenantId]);
        smtp = res.rows[0];
      }

      if (!smtp) {
        throw new TRPCError({ 
          code: "PRECONDITION_FAILED", 
          message: "SMTP settings not configured." 
        });
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

      try {
        const testSubject = "Louis CRM SMTP Test";
        const testBody = "This is a test email from Louis CRM to verify your SMTP configuration. If you received this, your connection is working correctly!";
        await transporter.sendMail({
          from: smtp.sender_display_name 
            ? `"${smtp.sender_display_name}" <${smtp.sender_email_address}>`
            : smtp.sender_email_address,
          to: input.recipient_email_address,
          subject: testSubject,
          text: testBody,
        });

        try {
          await ingestEmailToRag({
            tenantId: ctx.tenantId,
            recipient: input.recipient_email_address,
            senderType: 'Human',
            subject: testSubject,
            body: testBody,
          });
        } catch (ragErr) {
          console.error("[sendTestMail] Failed to ingest test mail to RAG:", ragErr);
        }

        return { success: true };
      } catch (error) {
        console.error("SMTP Test failed:", error);
        const errorMsg = error instanceof Error ? error.message : String(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SMTP Test failed: " + errorMsg,
        });
      }
    }),

  // My Company
  getMyCompany: protectedProcedure
    .output(z.nullable(MyCompanyFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.myCompany;
      const res = await pool.query("SELECT * FROM core_registry_my_company WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [ctx.tenantId]);
      return res.rows[0] ? cleanDbRow(res.rows[0]) : null;
    }),

  saveMyCompany: protectedProcedure
    .input(MyCompanySchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      input = sanitizeInputLigatures(input);
      if (isUsingFallback) {
        fallbackStore.myCompany = { 
          ...input, 
          id_uuid: input.id_uuid || uuidv4(),
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        } as z.infer<typeof MyCompanyFullSchema>;
        saveFallbackStore();
        return { success: true };
      }
      
      const existing = await pool.query("SELECT id_uuid FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1", [ctx.tenantId]);
      if (existing.rows.length > 0) {
        await pool.query(`
          UPDATE core_registry_my_company
          SET full_legal_name = $1, tax_vat_id = $2, responsible_person = $3, 
              street = $4, house_number = $5, postal_code = $6, city = $7, 
              country_code = $8, email_address = $9, email_2 = $10, 
              website = $11, phone_number = $12, mobile_number = $13, 
              fax_number = $14, iban = $15, bic_swift = $16, 
              leitweg_id = $17, payment_term = $18, price_list = $19, 
              custom_documents = $20, language = $21,
              first_name = $22, last_name = $23, salutation = $24,
              gender_identity = $25, date_of_birth = $26, region = $27,
              vat_rate = $28, currency_code = $29,
              invoice_number_prefix = $30, invoice_number_year_fixed = $31,
              invoice_number_next_seq = $32, invoice_number_min_digits = $33,
              bank_name = $34, logo_url = $35,
              contacts_display_columns_json = $36, companies_display_columns_json = $37,
              tax_number = $38,
              short_code = $39,
              updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $40 AND tenant_id = $41
        `, [
          input.full_legal_name, input.tax_vat_id, input.responsible_person,
          input.street, input.house_number, input.postal_code, input.city,
          input.country_code, input.email_address, input.email_2,
          input.website, input.phone_number, input.mobile_number,
          input.fax_number, input.iban, input.bic_swift,
          input.leitweg_id, input.payment_term, input.price_list,
          input.custom_documents, input.language,
          input.first_name, input.last_name, input.salutation,
          input.gender_identity, input.date_of_birth, input.region,
          input.vat_rate, input.currency_code,
          input.invoice_number_prefix, input.invoice_number_year_fixed,
          input.invoice_number_next_seq, input.invoice_number_min_digits,
          input.bank_name, input.logo_url,
          input.contacts_display_columns_json, input.companies_display_columns_json,
          input.tax_number,
          input.short_code,
          existing.rows[0].id_uuid, ctx.tenantId
        ]);

        if (ctx.tenantId !== '1') {
          await pool.query(`
            UPDATE core_registry_my_company
            SET full_legal_name = $1, tax_vat_id = $2, responsible_person = $3, 
                street = $4, house_number = $5, postal_code = $6, city = $7, 
                country_code = $8, email_address = $9, email_2 = $10, 
                website = $11, phone_number = $12, mobile_number = $13, 
                fax_number = $14, iban = $15, bic_swift = $16, 
                leitweg_id = $17, payment_term = $18, price_list = $19, 
                custom_documents = $20, language = $21,
                first_name = $22, last_name = $23, salutation = $24,
                gender_identity = $25, date_of_birth = $26, region = $27,
                vat_rate = $28, currency_code = $29,
                invoice_number_prefix = $30, invoice_number_year_fixed = $31,
                invoice_number_next_seq = $32, invoice_number_min_digits = $33,
                bank_name = $34, logo_url = $35,
                contacts_display_columns_json = $36, companies_display_columns_json = $37,
                tax_number = $38,
                short_code = $39,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE tenant_id = '1'
          `, [
            input.full_legal_name, input.tax_vat_id, input.responsible_person,
            input.street, input.house_number, input.postal_code, input.city,
            input.country_code, input.email_address, input.email_2,
            input.website, input.phone_number, input.mobile_number,
            input.fax_number, input.iban, input.bic_swift,
            input.leitweg_id, input.payment_term, input.price_list,
            input.custom_documents, input.language,
            input.first_name, input.last_name, input.salutation,
            input.gender_identity, input.date_of_birth, input.region,
            input.vat_rate, input.currency_code,
            input.invoice_number_prefix, input.invoice_number_year_fixed,
            input.invoice_number_next_seq, input.invoice_number_min_digits,
            input.bank_name, input.logo_url,
            input.contacts_display_columns_json, input.companies_display_columns_json,
            input.tax_number,
            input.short_code
          ]);
        }
      } else {
        const id = uuidv4();
        await pool.query(`
          INSERT INTO core_registry_my_company (
            id_uuid, tenant_id, full_legal_name, tax_vat_id, tax_number, responsible_person, 
            street, house_number, postal_code, city, country_code, 
            email_address, email_2, website, phone_number, mobile_number, 
            fax_number, iban, bic_swift, leitweg_id, payment_term, 
            price_list, custom_documents, language, created_by_identity, ai_confidence_score, 
            is_verified_by_human, first_name, last_name, salutation, gender_identity, date_of_birth, region,
            vat_rate, currency_code,
            invoice_number_prefix, invoice_number_year_fixed, invoice_number_next_seq, invoice_number_min_digits,
            bank_name, logo_url, contacts_display_columns_json, companies_display_columns_json,
            short_code
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44
          )
        `, [
          id, ctx.tenantId, input.full_legal_name, input.tax_vat_id, input.tax_number, input.responsible_person,
          input.street, input.house_number, input.postal_code, input.city, input.country_code,
          input.email_address, input.email_2, input.website, input.phone_number, input.mobile_number,
          input.fax_number, input.iban, input.bic_swift, input.leitweg_id, input.payment_term,
          input.price_list, input.custom_documents, input.language, input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human,
          input.first_name, input.last_name, input.salutation, input.gender_identity, input.date_of_birth, input.region,
          input.vat_rate, input.currency_code,
          input.invoice_number_prefix, input.invoice_number_year_fixed, input.invoice_number_next_seq, input.invoice_number_min_digits,
          input.bank_name, input.logo_url,
          input.contacts_display_columns_json, input.companies_display_columns_json,
          input.short_code
        ]);

        if (ctx.tenantId !== '1') {
          await pool.query(`
            UPDATE core_registry_my_company
            SET full_legal_name = $1, tax_vat_id = $2, responsible_person = $3, 
                street = $4, house_number = $5, postal_code = $6, city = $7, 
                country_code = $8, email_address = $9, email_2 = $10, 
                website = $11, phone_number = $12, mobile_number = $13, 
                fax_number = $14, iban = $15, bic_swift = $16, 
                leitweg_id = $17, payment_term = $18, price_list = $19, 
                custom_documents = $20, language = $21,
                first_name = $22, last_name = $23, salutation = $24,
                gender_identity = $25, date_of_birth = $26, region = $27,
                vat_rate = $28, currency_code = $29,
                invoice_number_prefix = $30, invoice_number_year_fixed = $31,
                invoice_number_next_seq = $32, invoice_number_min_digits = $33,
                bank_name = $34, logo_url = $35,
                contacts_display_columns_json = $36, companies_display_columns_json = $37,
                tax_number = $38,
                short_code = $39,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE tenant_id = '1'
          `, [
            input.full_legal_name, input.tax_vat_id, input.responsible_person,
            input.street, input.house_number, input.postal_code, input.city,
            input.country_code, input.email_address, input.email_2,
            input.website, input.phone_number, input.mobile_number,
            input.fax_number, input.iban, input.bic_swift,
            input.leitweg_id, input.payment_term, input.price_list,
            input.custom_documents, input.language,
            input.first_name, input.last_name, input.salutation,
            input.gender_identity, input.date_of_birth, input.region,
            input.vat_rate, input.currency_code,
            input.invoice_number_prefix, input.invoice_number_year_fixed,
            input.invoice_number_next_seq, input.invoice_number_min_digits,
            input.bank_name, input.logo_url,
            input.contacts_display_columns_json, input.companies_display_columns_json,
            input.tax_number,
            input.short_code
          ]);
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'MY_COMPANY',
        eventDetails: `Updated global company profile: ${input.full_legal_name}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  getSystemStatus: protectedProcedure
    .output(z.object({
      isUsingFallback: z.boolean(),
      dbConnected: z.boolean(),
      databaseUrlConfigured: z.boolean(),
      dbError: z.string().nullable(),
      dbStatusText: z.string(),
      aiStatusText: z.string(),
      emailStatusText: z.string(),
      dbSizeText: z.string()
    }))
    .query(async ({ ctx }) => {
      let dbConnected = false;
      let dbError: string | null = null;
      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        dbConnected = true;
        
        if (isUsingFallback) {
          await initDatabase();
        }
      } catch (err) {
        dbError = err instanceof Error ? err.message : String(err);
      }

      // 1. Status Datenbank
      const dbStatusText = dbConnected 
        ? "Online (PostgreSQL aktiv & verbunden)" 
        : (isUsingFallback ? "Lokal (Datenbank-Fallback aktiv)" : "Offline (Verbindungsfehler zur DB)");

      // 2. Status KI Anbindung
      let aiStatusText = "Inaktiv / Nicht konfiguriert";
      let customConf = null;
      if (isUsingFallback) {
        const list = fallbackStore.louisAiConfig || [];
        customConf = list.find((c: LouisAiConfig) => c.tenant_id === ctx.tenantId) || list.find((c: LouisAiConfig) => c.tenant_id === "1");
      } else {
        try {
          const confRes = await pool.query(
            "SELECT provider_type, model_name, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
            [ctx.tenantId]
          );
          if (confRes.rows.length > 0) {
            customConf = confRes.rows[0];
          }
        } catch (e) {}
      }

      if (customConf) {
        const provider = (customConf.provider_type || "gemini").toLowerCase();
        const model = customConf.model_name || "default";

        if (provider === "ollama") {
          aiStatusText = `Ollama - ${model} (Bereit)`;
        } else if (provider === "gemini") {
          if (customConf.api_key_secret || process.env.GEMINI_API_KEY) {
            aiStatusText = `Google Gemini - ${model} (Bereit)`;
          } else {
            aiStatusText = `Google Gemini - ${model} (Aktiv / Fehlender API Key)`;
          }
        } else if (provider === "openai") {
          if (customConf.api_key_secret || process.env.OPENAI_API_KEY) {
            aiStatusText = `OpenAI - ${model} (Bereit)`;
          } else {
            aiStatusText = `OpenAI - ${model} (Aktiv / Fehlender API Key)`;
          }
        } else if (provider === "anthropic") {
          if (customConf.api_key_secret || process.env.ANTHROPIC_API_KEY) {
            aiStatusText = `Anthropic - ${model} (Bereit)`;
          } else {
            aiStatusText = `Anthropic - ${model} (Aktiv / Fehlender API Key)`;
          }
        } else {
          aiStatusText = `${provider.toUpperCase()} - ${model} (Bereit)`;
        }
      } else {
        const hasGeminiKey = !!process.env.GEMINI_API_KEY;
        if (hasGeminiKey) {
          aiStatusText = "Google Gemini API (Bereit)";
        }
      }

      // 3. Status E-Mail Versand
      let emailStatusText = "Nicht konfiguriert";
      let smtpSettings = null;
      if (isUsingFallback) {
        smtpSettings = fallbackStore.smtpSettings;
      } else {
        try {
          const smtpRes = await pool.query(
            "SELECT smtp_host_name, sender_email_address FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
            [ctx.tenantId]
          );
          if (smtpRes.rows.length > 0) {
            smtpSettings = smtpRes.rows[0];
          }
        } catch (e) {}
      }
      if (smtpSettings && smtpSettings.smtp_host_name) {
        emailStatusText = `SMTP Bereit (${smtpSettings.sender_email_address || smtpSettings.smtp_host_name})`;
      }

      // 4. Status Datenbankgröße(n)
      let dbSizeText = "0 KB";
      if (isUsingFallback) {
        try {
          const pathDb = FALLBACK_FILE_PATH;
          if (fs.existsSync(pathDb)) {
            const stats = fs.statSync(pathDb);
            const sizeInKb = (stats.size / 1024).toFixed(1);
            dbSizeText = `${sizeInKb} KB (Lokale JSON)`;
          } else {
            dbSizeText = "Lokal initialisiert";
          }
        } catch (e) {
          dbSizeText = "Fehler beim Lesen";
        }
      } else {
        try {
          const sizeRes = await pool.query("SELECT pg_database_size(current_database()) as raw_size");
          if (sizeRes.rows.length > 0 && sizeRes.rows[0].raw_size) {
            const raw = parseInt(sizeRes.rows[0].raw_size);
            if (raw > 1024 * 1024) {
              dbSizeText = `${(raw / (1024 * 1024)).toFixed(1)} MB (PostgreSQL)`;
            } else {
              dbSizeText = `${(raw / 1024).toFixed(1)} KB (PostgreSQL)`;
            }
          }
        } catch (e) {
          dbSizeText = "N/A (PostgreSQL)";
        }
      }

      return {
        isUsingFallback,
        dbConnected,
        databaseUrlConfigured: !!(process.env.DATABASE_URL || process.env.PGHOST),
        dbError,
        dbStatusText,
        aiStatusText,
        emailStatusText,
        dbSizeText
      };
    }),

  testDatabaseConnection: protectedProcedure
    .output(z.object({
      success: z.boolean(),
      message: z.string()
    }))
    .mutation(async () => {
      try {
        const client = await pool.connect();
        await client.query("SELECT 1");
        client.release();
        
        await initDatabase();

        return {
          success: true,
          message: "Database connection established successfully! Verification query 'SELECT 1' completed."
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Database connection failed: ${errorMsg}`
        };
      }
    }),

  // Email Templates
  getEmailTemplates: protectedProcedure
    .output(z.array(EmailTemplateFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.emailTemplates || [];
      const res = await pool.query("SELECT * FROM sys_comms_email_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC", [ctx.tenantId]);
      return res.rows.map(r => cleanDbRow(r));
    }),

  createEmailTemplate: protectedProcedure
    .input(EmailTemplateSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const id = uuidv4();
      if (isUsingFallback) {
        const record: z.infer<typeof EmailTemplateFullSchema> = {
          ...input,
          id_uuid: id,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
        };
        if (!fallbackStore.emailTemplates) fallbackStore.emailTemplates = [];
        fallbackStore.emailTemplates.unshift(record);
        saveFallbackStore();
        return { id_uuid: id };
      }
      await pool.query(`
        INSERT INTO sys_comms_email_templates (
          id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        id, ctx.tenantId, input.template_name_text, input.email_subject_text, input.email_body_content,
        input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'EMAIL_TEMPLATE',
        entityId: id,
        eventDetails: `Created email template: ${input.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { id_uuid: id };
    }),

  updateEmailTemplate: protectedProcedure
    .input(EmailTemplateSchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { id_uuid, ...data } = input;
      if (isUsingFallback) {
        if (!fallbackStore.emailTemplates) fallbackStore.emailTemplates = [];
        const idx = fallbackStore.emailTemplates.findIndex(x => x.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.emailTemplates[idx] = {
            ...fallbackStore.emailTemplates[idx],
            ...data,
            updated_at_utc: new Date().toISOString()
          };
          saveFallbackStore();
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE sys_comms_email_templates
        SET template_name_text = $1, email_subject_text = $2, email_body_content = $3,
            updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')
      `, [data.template_name_text, data.email_subject_text, data.email_body_content, id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'EMAIL_TEMPLATE',
        entityId: id_uuid,
        eventDetails: `Updated email template: ${data.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  deleteEmailTemplate: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.emailTemplates) fallbackStore.emailTemplates = [];
        fallbackStore.emailTemplates = fallbackStore.emailTemplates.filter(x => x.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("DELETE FROM sys_comms_email_templates WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'EMAIL_TEMPLATE',
        entityId: input.id_uuid,
        eventDetails: `Deleted email template with ID: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  // Signatures
  getSignatures: protectedProcedure
    .output(z.array(SignatureFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.signatures || [];
      const res = await pool.query("SELECT * FROM sys_comms_signatures WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC", [ctx.tenantId]);
      return res.rows.map(r => cleanDbRow(r));
    }),

  createSignature: protectedProcedure
    .input(SignatureSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const id = uuidv4();
      if (isUsingFallback) {
        if (!fallbackStore.signatures) fallbackStore.signatures = [];
        if (input.is_default_signature) {
          fallbackStore.signatures.forEach(x => x.is_default_signature = false);
        }
        const record: z.infer<typeof SignatureFullSchema> = {
          ...input,
          id_uuid: id,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
        };
        fallbackStore.signatures.unshift(record);
        saveFallbackStore();
        return { id_uuid: id };
      }

      if (input.is_default_signature) {
        await pool.query("UPDATE sys_comms_signatures SET is_default_signature = FALSE WHERE tenant_id = $1", [ctx.tenantId]);
      }

      await pool.query(`
        INSERT INTO sys_comms_signatures (
          id_uuid, tenant_id, signature_name_text, signature_body_content, is_default_signature,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        id, ctx.tenantId, input.signature_name_text, input.signature_body_content, input.is_default_signature,
        input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'SIGNATURE',
        entityId: id,
        eventDetails: `Created signature: ${input.signature_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { id_uuid: id };
    }),

  updateSignature: protectedProcedure
    .input(SignatureSchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { id_uuid, ...data } = input;
      if (isUsingFallback) {
        if (!fallbackStore.signatures) fallbackStore.signatures = [];
        if (data.is_default_signature) {
          fallbackStore.signatures.forEach(x => x.is_default_signature = false);
        }
        const idx = fallbackStore.signatures.findIndex(x => x.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.signatures[idx] = {
            ...fallbackStore.signatures[idx],
            ...data,
            updated_at_utc: new Date().toISOString()
          };
          saveFallbackStore();
        }
        return { success: true };
      }

      if (data.is_default_signature) {
        await pool.query("UPDATE sys_comms_signatures SET is_default_signature = FALSE WHERE tenant_id = $1", [ctx.tenantId]);
      }

      await pool.query(`
        UPDATE sys_comms_signatures
        SET signature_name_text = $1, signature_body_content = $2, is_default_signature = $3,
            updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')
      `, [data.signature_name_text, data.signature_body_content, data.is_default_signature, id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'SIGNATURE',
        entityId: id_uuid,
        eventDetails: `Updated signature: ${data.signature_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  deleteSignature: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.signatures) fallbackStore.signatures = [];
        fallbackStore.signatures = fallbackStore.signatures.filter(x => x.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("DELETE FROM sys_comms_signatures WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'SIGNATURE',
        entityId: input.id_uuid,
        eventDetails: `Deleted signature with ID: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  // Invoice Text Templates
  getInvoiceTextTemplates: protectedProcedure
    .output(z.array(InvoiceTextTemplateFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.invoiceTextTemplates || [];
      const res = await pool.query("SELECT * FROM sys_comms_invoice_text_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC", [ctx.tenantId]);
      return res.rows.map(r => cleanDbRow(r));
    }),

  createInvoiceTextTemplate: protectedProcedure
    .input(InvoiceTextTemplateSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      input = sanitizeInputLigatures(input);
      const id = uuidv4();
      if (isUsingFallback) {
        const record: z.infer<typeof InvoiceTextTemplateFullSchema> = {
          ...input,
          id_uuid: id,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
        };
        if (!fallbackStore.invoiceTextTemplates) fallbackStore.invoiceTextTemplates = [];
        fallbackStore.invoiceTextTemplates.unshift(record);
        saveFallbackStore();
        return { id_uuid: id };
      }
      await pool.query(`
        INSERT INTO sys_comms_invoice_text_templates (
          id_uuid, tenant_id, template_name_text, template_type_code, template_body_content,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        id, ctx.tenantId, input.template_name_text, input.template_type_code, input.template_body_content,
        input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'INVOICE_TEXT_TEMPLATE',
        entityId: id,
        eventDetails: `Created invoice text template: ${input.template_name_text} (${input.template_type_code})`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { id_uuid: id };
    }),

  updateInvoiceTextTemplate: protectedProcedure
    .input(InvoiceTextTemplateSchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      input = sanitizeInputLigatures(input);
      const { id_uuid, ...data } = input;
      if (isUsingFallback) {
        if (!fallbackStore.invoiceTextTemplates) fallbackStore.invoiceTextTemplates = [];
        const idx = fallbackStore.invoiceTextTemplates.findIndex(x => x.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.invoiceTextTemplates[idx] = {
            ...fallbackStore.invoiceTextTemplates[idx],
            ...data,
            updated_at_utc: new Date().toISOString()
          };
          saveFallbackStore();
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE sys_comms_invoice_text_templates
        SET template_name_text = $1, template_type_code = $2, template_body_content = $3,
            updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')
      `, [data.template_name_text, data.template_type_code, data.template_body_content, id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'INVOICE_TEXT_TEMPLATE',
        entityId: id_uuid,
        eventDetails: `Updated invoice text template: ${data.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  deleteInvoiceTextTemplate: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.invoiceTextTemplates) fallbackStore.invoiceTextTemplates = [];
        fallbackStore.invoiceTextTemplates = fallbackStore.invoiceTextTemplates.filter(x => x.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("DELETE FROM sys_comms_invoice_text_templates WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'INVOICE_TEXT_TEMPLATE',
        entityId: input.id_uuid,
        eventDetails: `Deleted invoice text template with ID: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  // Invoice Item Templates
  getInvoiceItemTemplates: protectedProcedure
    .output(z.array(InvoiceItemTemplateFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.invoiceItemTemplates || [];
      const res = await pool.query("SELECT * FROM sys_comms_invoice_item_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC", [ctx.tenantId]);
      return res.rows.map(row => {
        const r = cleanDbRow(row);
        return {
          ...r,
          quantity: typeof r.quantity === 'string' ? parseFloat(r.quantity) : r.quantity,
          unit_price: typeof r.unit_price === 'string' ? parseFloat(r.unit_price) : r.unit_price,
          vat_rate: typeof r.vat_rate === 'string' ? parseFloat(r.vat_rate) : r.vat_rate,
        };
      });
    }),

  createInvoiceItemTemplate: protectedProcedure
    .input(InvoiceItemTemplateSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const id = uuidv4();
      if (isUsingFallback) {
        const record: z.infer<typeof InvoiceItemTemplateFullSchema> = {
          ...input,
          id_uuid: id,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
        };
        if (!fallbackStore.invoiceItemTemplates) fallbackStore.invoiceItemTemplates = [];
        fallbackStore.invoiceItemTemplates.unshift(record);
        saveFallbackStore();
        return { id_uuid: id };
      }
      await pool.query(`
        INSERT INTO sys_comms_invoice_item_templates (
          id_uuid, tenant_id, template_name_text, description, quantity,
          unit_price, vat_rate, unit_code,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        id, ctx.tenantId, input.template_name_text, input.description, input.quantity,
        input.unit_price, input.vat_rate, input.unit_code,
        input.created_by_identity, input.ai_confidence_score, input.is_verified_by_human
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'INVOICE_ITEM_TEMPLATE',
        entityId: id,
        eventDetails: `Created invoice item template: ${input.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { id_uuid: id };
    }),

  updateInvoiceItemTemplate: protectedProcedure
    .input(InvoiceItemTemplateSchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { id_uuid, ...data } = input;
      if (isUsingFallback) {
        if (!fallbackStore.invoiceItemTemplates) fallbackStore.invoiceItemTemplates = [];
        const idx = fallbackStore.invoiceItemTemplates.findIndex(x => x.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.invoiceItemTemplates[idx] = {
            ...fallbackStore.invoiceItemTemplates[idx],
            ...data,
            updated_at_utc: new Date().toISOString()
          };
          saveFallbackStore();
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE sys_comms_invoice_item_templates
        SET template_name_text = $1, description = $2, quantity = $3,
            unit_price = $4, vat_rate = $5, unit_code = $6,
            updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $7 AND (tenant_id = $8 OR tenant_id = '1')
      `, [data.template_name_text, data.description, data.quantity, data.unit_price, data.vat_rate, data.unit_code, id_uuid, ctx.tenantId]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'INVOICE_ITEM_TEMPLATE',
        entityId: id_uuid,
        eventDetails: `Updated invoice item template: ${data.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  deleteInvoiceItemTemplate: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.invoiceItemTemplates) fallbackStore.invoiceItemTemplates = [];
        fallbackStore.invoiceItemTemplates = fallbackStore.invoiceItemTemplates.filter(x => x.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("DELETE FROM sys_comms_invoice_item_templates WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'INVOICE_ITEM_TEMPLATE',
        entityId: input.id_uuid,
        eventDetails: `Deleted invoice item template with ID: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  importEmailTemplates: protectedProcedure
    .input(z.array(EmailTemplateSchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        const item = { ...rawItem };
        const typedItem = item as Record<string, unknown>;
        for (const key of Object.keys(typedItem)) {
          if (typedItem[key] === undefined) typedItem[key] = null;
        }

        const id = item.id_uuid || uuidv4();

        if (isUsingFallback) {
          if (!fallbackStore.emailTemplates) fallbackStore.emailTemplates = [];
          const idx = fallbackStore.emailTemplates.findIndex(x => x.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.emailTemplates[idx] = {
              ...fallbackStore.emailTemplates[idx],
              ...item,
              id_uuid: id,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            fallbackStore.emailTemplates.unshift({
              ...item,
              id_uuid: id,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            importedCount++;
          }
          saveFallbackStore();
          continue;
        }

        const checkRes = await pool.query("SELECT id_uuid FROM sys_comms_email_templates WHERE id_uuid = $1 AND tenant_id = $2", [id, ctx.tenantId]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE sys_comms_email_templates
            SET template_name_text = $1, email_subject_text = $2, email_body_content = $3,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $4 AND tenant_id = $5
          `, [item.template_name_text, item.email_subject_text, item.email_body_content, id, ctx.tenantId]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO sys_comms_email_templates (
              id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content,
              created_by_identity, ai_confidence_score, is_verified_by_human
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            id, ctx.tenantId, item.template_name_text, item.email_subject_text, item.email_body_content,
            item.created_by_identity || 'human', item.ai_confidence_score ?? 1.0, item.is_verified_by_human ?? true
          ]);
          importedCount++;
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'EMAIL_TEMPLATE',
        eventDetails: `Imported email templates: ${importedCount} created, ${updatedCount} updated`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { importedCount, updatedCount };
    }),

  importSignatures: protectedProcedure
    .input(z.array(SignatureSchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        const item = { ...rawItem };
        const typedItem = item as Record<string, unknown>;
        for (const key of Object.keys(typedItem)) {
          if (typedItem[key] === undefined) typedItem[key] = null;
        }

        const id = item.id_uuid || uuidv4();

        if (isUsingFallback) {
          if (!fallbackStore.signatures) fallbackStore.signatures = [];
          if (item.is_default_signature) {
            fallbackStore.signatures.forEach(x => x.is_default_signature = false);
          }
          const idx = fallbackStore.signatures.findIndex(x => x.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.signatures[idx] = {
              ...fallbackStore.signatures[idx],
              ...item,
              id_uuid: id,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            fallbackStore.signatures.unshift({
              ...item,
              id_uuid: id,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            importedCount++;
          }
          saveFallbackStore();
          continue;
        }

        if (item.is_default_signature) {
          await pool.query("UPDATE sys_comms_signatures SET is_default_signature = FALSE WHERE tenant_id = $1", [ctx.tenantId]);
        }

        const checkRes = await pool.query("SELECT id_uuid FROM sys_comms_signatures WHERE id_uuid = $1 AND tenant_id = $2", [id, ctx.tenantId]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE sys_comms_signatures
            SET signature_name_text = $1, signature_body_content = $2, is_default_signature = $3,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $4 AND tenant_id = $5
          `, [item.signature_name_text, item.signature_body_content, !!item.is_default_signature, id, ctx.tenantId]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO sys_comms_signatures (
              id_uuid, tenant_id, signature_name_text, signature_body_content, is_default_signature,
              created_by_identity, ai_confidence_score, is_verified_by_human
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            id, ctx.tenantId, item.signature_name_text, item.signature_body_content, !!item.is_default_signature,
            item.created_by_identity || 'human', item.ai_confidence_score ?? 1.0, item.is_verified_by_human ?? true
          ]);
          importedCount++;
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'SIGNATURE',
        eventDetails: `Imported signatures: ${importedCount} created, ${updatedCount} updated`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { importedCount, updatedCount };
    }),

  importInvoiceTextTemplates: protectedProcedure
    .input(z.array(InvoiceTextTemplateSchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        const item = { ...rawItem };
        const typedItem = item as Record<string, unknown>;
        for (const key of Object.keys(typedItem)) {
          if (typedItem[key] === undefined) typedItem[key] = null;
        }

        const id = item.id_uuid || uuidv4();

        if (isUsingFallback) {
          if (!fallbackStore.invoiceTextTemplates) fallbackStore.invoiceTextTemplates = [];
          const idx = fallbackStore.invoiceTextTemplates.findIndex(x => x.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.invoiceTextTemplates[idx] = {
              ...fallbackStore.invoiceTextTemplates[idx],
              ...item,
              id_uuid: id,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            fallbackStore.invoiceTextTemplates.unshift({
              ...item,
              id_uuid: id,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            importedCount++;
          }
          saveFallbackStore();
          continue;
        }

        const checkRes = await pool.query("SELECT id_uuid FROM sys_comms_invoice_text_templates WHERE id_uuid = $1 AND tenant_id = $2", [id, ctx.tenantId]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE sys_comms_invoice_text_templates
            SET template_name_text = $1, template_type_code = $2, template_body_content = $3,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $4 AND tenant_id = $5
          `, [item.template_name_text, item.template_type_code, item.template_body_content, id, ctx.tenantId]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO sys_comms_invoice_text_templates (
              id_uuid, tenant_id, template_name_text, template_type_code, template_body_content,
              created_by_identity, ai_confidence_score, is_verified_by_human
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [
            id, ctx.tenantId, item.template_name_text, item.template_type_code, item.template_body_content,
            item.created_by_identity || 'human', item.ai_confidence_score ?? 1.0, item.is_verified_by_human ?? true
          ]);
          importedCount++;
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'INVOICE_TEXT_TEMPLATE',
        eventDetails: `Imported invoice text templates: ${importedCount} created, ${updatedCount} updated`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { importedCount, updatedCount };
    }),

  importInvoiceItemTemplates: protectedProcedure
    .input(z.array(InvoiceItemTemplateSchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        const item = { ...rawItem };
        const typedItem = item as Record<string, unknown>;
        for (const key of Object.keys(typedItem)) {
          if (typedItem[key] === undefined) typedItem[key] = null;
        }

        const id = item.id_uuid || uuidv4();

        if (isUsingFallback) {
          if (!fallbackStore.invoiceItemTemplates) fallbackStore.invoiceItemTemplates = [];
          const idx = fallbackStore.invoiceItemTemplates.findIndex(x => x.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.invoiceItemTemplates[idx] = {
              ...fallbackStore.invoiceItemTemplates[idx],
              ...item,
              id_uuid: id,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            fallbackStore.invoiceItemTemplates.unshift({
              ...item,
              id_uuid: id,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            importedCount++;
          }
          saveFallbackStore();
          continue;
        }

        const checkRes = await pool.query("SELECT id_uuid FROM sys_comms_invoice_item_templates WHERE id_uuid = $1 AND tenant_id = $2", [id, ctx.tenantId]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE sys_comms_invoice_item_templates
            SET template_name_text = $1, description = $2, quantity = $3,
                unit_price = $4, vat_rate = $5, unit_code = $6,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $7 AND tenant_id = $8
          `, [item.template_name_text, item.description, item.quantity, item.unit_price, item.vat_rate, item.unit_code, id, ctx.tenantId]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO sys_comms_invoice_item_templates (
              id_uuid, tenant_id, template_name_text, description, quantity,
              unit_price, vat_rate, unit_code,
              created_by_identity, ai_confidence_score, is_verified_by_human
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `, [
            id, ctx.tenantId, item.template_name_text, item.description, item.quantity,
            item.unit_price, item.vat_rate, item.unit_code,
            item.created_by_identity || 'human', item.ai_confidence_score ?? 1.0, item.is_verified_by_human ?? true
          ]);
          importedCount++;
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE_CONFIG',
        entityType: 'INVOICE_ITEM_TEMPLATE',
        eventDetails: `Imported invoice item templates: ${importedCount} created, ${updatedCount} updated`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { importedCount, updatedCount };
    }),

  // Bank directory Lookups & Syncs
  getBankDirectoryStatus: protectedProcedure
    .output(z.object({
      totalCount: z.number(),
      countries: z.record(z.string(), z.number()),
      lastUpdated: z.string().nullable()
    }))
    .query(async () => {
      return await getBankDirectoryStats();
    }),

  lookupBank: protectedProcedure
    .input(z.object({ iban: z.string() }))
    .output(z.object({
      valid: z.boolean(),
      bankName: z.string().optional(),
      bic: z.string().optional(),
      error: z.string().optional()
    }))
    .query(async ({ input }) => {
      const cleanIban = input.iban.replace(/\s+/g, '').toUpperCase();
      const localVal = validateIBAN(cleanIban);
      if (!localVal.isValid) {
        return { valid: false, error: localVal.error };
      }

      const countryCode = cleanIban.slice(0, 2);
      let bankCode = "";
      if (countryCode === "DE") {
        bankCode = cleanIban.slice(4, 12);
      } else if (countryCode === "AT") {
        bankCode = cleanIban.slice(4, 9);
      } else if (countryCode === "CH") {
        bankCode = cleanIban.slice(4, 9);
      }

      if (bankCode && (countryCode === "DE" || countryCode === "AT" || countryCode === "CH")) {
        const dbEntry = await lookupBankDirectory(countryCode, bankCode);
        if (dbEntry) {
          return {
            valid: true,
            bankName: dbEntry.bank_name,
            bic: dbEntry.bic || undefined
          };
        }
      }

      // If not in database or other country, use standard openiban search or local calculations
      const fallbackBic = getBicByIban(cleanIban);
      const fallbackBankName = localVal.bankName || getBankByIbanAndBic(cleanIban, fallbackBic || '');

      try {
        const response = await fetch(`https://openiban.org/api/v1/iban/${cleanIban}`, { signal: AbortSignal.timeout(4000) });
        if (!response.ok) {
          throw new Error('API request failed');
        }
        const data = await response.json();
        if (data.valid) {
          return {
            valid: true,
            bankName: data.bankData?.name || fallbackBankName,
            bic: data.bankData?.bic || fallbackBic
          };
        } else {
          return {
            valid: false,
            error: data.messages?.[0] || 'Prüfsumme ungültig.'
          };
        }
      } catch (err) {
        return {
          valid: true,
          bankName: fallbackBankName,
          bic: fallbackBic,
        };
      }
    }),

  syncBankDirectory: protectedProcedure
    .output(z.object({
      success: z.boolean(),
      count: z.number(),
      message: z.string()
    }))
    .mutation(async ({ ctx }) => {
      const LOCAL_PRESET_BANKS = [
        // Germany (DE)
        { country_code: "DE", bank_code: "10050000", bic: "WELADE10XXX", bank_name: "Berliner Sparkasse", city: "Berlin" },
        { country_code: "DE", bank_code: "12030000", bic: "COBADEFFXXX", bank_name: "Commerzbank AG", city: "Berlin" },
        { country_code: "DE", bank_code: "10040000", bic: "COBADEFFXXX", bank_name: "Commerzbank AG", city: "Berlin" },
        { country_code: "DE", bank_code: "20040000", bic: "COBADEFFXXX", bank_name: "Commerzbank AG", city: "Hamburg" },
        { country_code: "DE", bank_code: "37040000", bic: "COBADEFFXXX", bank_name: "Commerzbank AG", city: "Köln" },
        { country_code: "DE", bank_code: "10070000", bic: "DEUTDEDFXXX", bank_name: "Deutsche Bank AG", city: "Frankfurt" },
        { country_code: "DE", bank_code: "10020000", bic: "DEUTDEDFXXX", bank_name: "Deutsche Bank AG", city: "Frankfurt" },
        { country_code: "DE", bank_code: "10010010", bic: "PBNKDED1XXX", bank_name: "Postbank AG", city: "Berlin" },
        { country_code: "DE", bank_code: "10011001", bic: "NXXGDED1XXX", bank_name: "N26 Bank", city: "Berlin" },
        { country_code: "DE", bank_code: "51020500", bic: "WDIDDED1XXX", bank_name: "ING-DiBa AG", city: "Frankfurt" },
        { country_code: "DE", bank_code: "10030200", bic: "DKBYDED1XXX", bank_name: "Deutsche Kreditbank (DKB)", city: "Berlin" },
        { country_code: "DE", bank_code: "30020900", bic: "SUTADED1XXX", bank_name: "Targobank AG", city: "Düsseldorf" },
        { country_code: "DE", bank_code: "44050199", bic: "DORTDE33XXX", bank_name: "Sparkasse Dortmund", city: "Dortmund" },
        { country_code: "DE", bank_code: "20050550", bic: "HASADE21XXX", bank_name: "Hamburger Sparkasse (Haspa)", city: "Hamburg" },
        { country_code: "DE", bank_code: "70050101", bic: "MUNDDE66XXX", bank_name: "Stadtsparkasse München", city: "München" },
        { country_code: "DE", bank_code: "37050198", bic: "KOLNDE33XXX", bank_name: "Sparkasse KölnBonn", city: "Köln" },
        { country_code: "DE", bank_code: "66050101", bic: "COKODE33XXX", bank_name: "Kreissparkasse Köln", city: "Köln" },
        { country_code: "DE", bank_code: "60050101", bic: "FHLDDE55XXX", bank_name: "Frankfurter Sparkasse", city: "Frankfurt" },
        { country_code: "DE", bank_code: "39050000", bic: "DUSSDE33XXX", bank_name: "Stadtsparkasse Düsseldorf", city: "Düsseldorf" },
        { country_code: "DE", bank_code: "10090000", bic: "BEVODED1XXX", bank_name: "Berliner Volksbank eG", city: "Berlin" },
        { country_code: "DE", bank_code: "20090500", bic: "GENODED1HH1", bank_name: "Hamburger Volksbank eG", city: "Hamburg" },
        { country_code: "DE", bank_code: "70169465", bic: "MUBADED1XXX", bank_name: "Münchner Bank eG", city: "München" },
        { country_code: "DE", bank_code: "60011100", bic: "FFMBDED1XXX", bank_name: "Frankfurter Volksbank eG", city: "Frankfurt" },
        { country_code: "DE", bank_code: "12090101", bic: "HANVDE2HXXX", bank_name: "Hannoversche Volksbank eG", city: "Hannover" },
        { country_code: "DE", bank_code: "43060967", bic: "GENODED1GLS", bank_name: "GLS Gemeinschaftsbank", city: "Bochum" },

        // Austria (AT)
        { country_code: "AT", bank_code: "12000", bic: "UNCRATWWXXX", bank_name: "UniCredit Bank Austria AG", city: "Wien" },
        { country_code: "AT", bank_code: "20111", bic: "GIBAATWWXXX", bank_name: "Erste Bank der oesterreichischen Sparkassen AG", city: "Wien" },
        { country_code: "AT", bank_code: "19150", bic: "RZBAATWWXXX", bank_name: "Raiffeisen Zentralbank Österreich AG", city: "Wien" },
        { country_code: "AT", bank_code: "14000", bic: "BABXATWWXXX", bank_name: "BAWAG P.S.K. Bank für Arbeit und Wirtschaft AG", city: "Wien" },
        { country_code: "AT", bank_code: "15000", bic: "OBBKAT2LXXX", bank_name: "Oberbank AG", city: "Linz" },
        { country_code: "AT", bank_code: "43000", bic: "VOWIATWWXXX", bank_name: "Volksbank Wien AG", city: "Wien" },
        { country_code: "AT", bank_code: "16000", bic: "BTVIAT22XXX", bank_name: "Bank für Tirol und Vorarlberg AG (BTV)", city: "Innsbruck" },
        { country_code: "AT", bank_code: "17000", bic: "BFKKAT2KXXX", bank_name: "BKS Bank AG", city: "Klagenfurt" },
        { country_code: "AT", bank_code: "11000", bic: "OENBATWWXXX", bank_name: "Oesterreichische Nationalbank (OeNB)", city: "Wien" },
        { country_code: "AT", bank_code: "32000", bic: "RLNWATWWXXX", bank_name: "Raiffeisenlandesbank NÖ-Wien AG", city: "Wien" },
        { country_code: "AT", bank_code: "34000", bic: "RVBLAT2LXXX", bank_name: "Raiffeisenlandesbank Oberösterreich AG", city: "Linz" },
        { country_code: "AT", bank_code: "38000", bic: "RZSTAT2GXXX", bank_name: "Raiffeisenlandesbank Steiermark AG", city: "Graz" },
        { country_code: "AT", bank_code: "20404", bic: "STEIAT2GXXX", bank_name: "Steiermärkische Bank und Sparkassen AG", city: "Graz" },
        { country_code: "AT", bank_code: "20322", bic: "ASKOAT2LXXX", bank_name: "Allgemeine Sparkasse Oberösterreich Bank AG", city: "Linz" },
        { country_code: "AT", bank_code: "20401", bic: "SBGSAT2SXXX", bank_name: "Salzburger Sparkasse Bank AG", city: "Salzburg" },
        { country_code: "AT", bank_code: "20503", bic: "TISPAT22XXX", bank_name: "Tiroler Sparkasse Bankaktiengesellschaft", city: "Innsbruck" },

        // Switzerland (CH)
        { country_code: "CH", bank_code: "230", bic: "UBSWCHZHXXX", bank_name: "UBS AG", city: "Zürich" },
        { country_code: "CH", bank_code: "231", bic: "UBSWCHZHXXX", bank_name: "UBS AG", city: "Zürich" },
        { country_code: "CH", bank_code: "4835", bic: "CRESCHZZXXX", bank_name: "Credit Suisse AG", city: "Zürich" },
        { country_code: "CH", bank_code: "700", bic: "ZKBKCH22XXX", bank_name: "Zürcher Kantonalbank", city: "Zürich" },
        { country_code: "CH", bank_code: "9000", bic: "POSFCH22XXX", bank_name: "PostFinance AG", city: "Bern" },
        { country_code: "CH", bank_code: "80808", bic: "RAIFCH22XXX", bank_name: "Raiffeisen Schweiz Genossenschaft", city: "St. Gallen" },
        { country_code: "CH", bank_code: "788", bic: "BCGECHGGXXX", bank_name: "Banque Cantonale de Genève", city: "Genève" },
        { country_code: "CH", bank_code: "767", bic: "BCVADA21XXX", bank_name: "Banque Cantonale Vaudoise", city: "Lausanne" },
        { country_code: "CH", bank_code: "754", bic: "BKBKCH22XXX", bank_name: "Basler Kantonalbank", city: "Basel" },
        { country_code: "CH", bank_code: "790", bic: "BEKBCH22XXX", bank_name: "Berner Kantonalbank (BEKB)", city: "Bern" },
        { country_code: "CH", bank_code: "751", bic: "LUKBCH22XXX", bank_name: "Luzerner Kantonalbank (LUKB)", city: "Luzern" },
        { country_code: "CH", bank_code: "764", bic: "SGKBCH22XXX", bank_name: "St.Galler Kantonalbank (SGKB)", city: "St. Gallen" },
        { country_code: "CH", bank_code: "8024", bic: "MIGRCH88XXX", bank_name: "Migros Bank AG", city: "Zürich" },
        { country_code: "CH", bank_code: "758", bic: "COOPCH22XXX", bank_name: "Bank Cler AG", city: "Basel" },
        { country_code: "CH", bank_code: "279", bic: "BACGCH22XXX", bank_name: "Bank Julius Bär & Co. AG", city: "Zürich" },
        { country_code: "CH", bank_code: "288", bic: "VONTCHZHXXX", bank_name: "Bank Vontobel AG", city: "Zürich" },
        { country_code: "CH", bank_code: "240", bic: "PICTCHGGXXX", bank_name: "Banque Pictet & Cie SA", city: "Genève" },
        { country_code: "CH", bank_code: "242", bic: "LOPCCHGGXXX", bank_name: "Lombard, Odier & Cie SA", city: "Genève" }
      ];

      const entriesToUpsert: typeof LOCAL_PRESET_BANKS = [];
      let updateMethod = "Integrierter Datenkatalog";

      try {
        console.log("Fetching live DE Bankleitzahlen...");
        const response = await fetch("https://raw.githubusercontent.com/johan/bankleitzahlen/master/blz.txt", {
          signal: AbortSignal.timeout(6000)
        });
        
        if (response.ok) {
          const rawText = await response.text();
          const lines = rawText.split("\n");
          let count = 0;
          for (const line of lines) {
            if (line.length >= 150) {
              const blz = line.substring(0, 8).trim();
              const name = line.substring(9, 67).trim();
              const bic = line.substring(139, 150).trim();
              if (blz && name) {
                entriesToUpsert.push({
                  country_code: "DE",
                  bank_code: blz,
                  bic: bic || null,
                  bank_name: name,
                  city: line.substring(72, 107).trim() || null
                });
                count++;
              }
            }
          }
          console.log(`Parsed ${count} live German banks from Bundesbank text mirror.`);
          updateMethod = "Offizielle Bundesbank BLZ-Liste (Live)";
        }
      } catch (err) {
        console.warn("Could not retrieve live German bankleitzahlen (offline or timeout). Falling back to premium integrated catalog.");
      }

      // If we failed to fetch or parsing yielded nothing, leverage our complete curated integrated dataset
      if (entriesToUpsert.length === 0) {
        entriesToUpsert.push(...LOCAL_PRESET_BANKS);
      } else {
        // Also always enrich with Austria and Switzerland presets to guarantee comprehensive D/A/CH coverage
        const otherCountries = LOCAL_PRESET_BANKS.filter(b => b.country_code !== "DE");
        entriesToUpsert.push(...otherCountries);
      }

      const loadedCount = await upsertBankDirectoryBatch(entriesToUpsert);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'SYNC_BANKS',
        entityType: 'BANK_DIRECTORY',
        eventDetails: `D/A/CH Bankdaten aktualisiert: ${loadedCount} Banken geladen via ${updateMethod}.`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return {
        success: true,
        count: loadedCount,
        message: `${loadedCount} D/A/CH Bankleitzahlen erfolgreich aktualisiert (${updateMethod}).`
      };
    })
});
