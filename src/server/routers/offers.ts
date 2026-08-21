import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { router, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { 
  pool, 
  isUsingFallback, 
  fallbackStore, 
  logAuditEvent, 
  saveFallbackStore, 
  cleanDbRow, 
  cleanLigatureHacksFromValue 
} from "../db.js";
import { getEntityStoragePath, ingestFileToRag } from "../storage.js";
import { 
  OfferInputSchema, 
  OfferUpdateInputSchema,
  OfferTextTemplateSchema,
  OfferFullSchema,
  OfferTextTemplateFullSchema
} from "../../lib/schemas.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { Offer, OfferTextTemplate, Company, Contact } from "../../types.js";
import { buildOfferPDFBuffer, MyCompany } from "../pdfOfferHelper.js";

// (V2-4): pg liefert für date/timestamp-Spalten Date-Objekte, die das
// Zod-Output-Schema (z.string) nicht akzeptiert -> "Output validation failed"
// in getOfferById (u. a. aus executeFinalizeAndSendOffer). ISO-Mapper wie im
// Projektmuster (mapXDates) — angewendet auf ALLEN DB-Rückgabepfaden.
const OFFER_DATE_KEYS = ["issue_date", "valid_until"] as const; // date-Spalten -> YYYY-MM-DD
const OFFER_TIMESTAMP_KEYS = ["created_at_utc", "updated_at_utc"] as const; // timestamptz -> ISO
export function mapOfferDates<T extends Record<string, unknown>>(row: T): T {
  const mapped = { ...row };
  for (const key of OFFER_DATE_KEYS) {
    const v = mapped[key];
    if (v instanceof Date) {
      (mapped as Record<string, unknown>)[key] = v.toISOString().slice(0, 10);
    }
  }
  for (const key of OFFER_TIMESTAMP_KEYS) {
    const v = mapped[key];
    if (v instanceof Date) {
      (mapped as Record<string, unknown>)[key] = v.toISOString();
    }
  }
  return mapped;
}

export const offersRouter = router({
  getOffers: protectedProcedure
    .output(z.array(OfferFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return (fallbackStore.offers || [])
          .filter(o => o.tenant_id === ctx.tenantId)
          .map(o => {
            const fallbackStatus: Offer['offer_status'] = (o.offer_status || (o as { status?: Offer['offer_status'] }).status || 'draft') as Offer['offer_status'];
            return {
              ...o,
              offer_status: fallbackStatus,
              status: fallbackStatus
            };
          });
      }
      const res = await pool.query(
        `SELECT * FROM core_registry_offers WHERE tenant_id = $1 ORDER BY created_at_utc DESC`,
        [ctx.tenantId]
      );
      return res.rows.map(row => {
        const cleaned = cleanDbRow(row);
        let items = [];
        if (cleaned.line_items_json) {
          items = typeof cleaned.line_items_json === "string"
            ? JSON.parse(cleaned.line_items_json)
            : cleaned.line_items_json;
        }
        return {
          ...mapOfferDates(cleaned),
          offer_status: cleaned.offer_status || cleaned.status || 'draft',
          status: cleaned.offer_status || cleaned.status || 'draft',
          line_items: items,
          total_net_amount: Number(cleaned.total_net_amount),
          total_vat_amount: Number(cleaned.total_vat_amount),
          total_gross_amount: Number(cleaned.total_gross_amount)
        } as Offer;
      });
    }),

  getOfferById: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(OfferFullSchema)
    .query(async ({ input, ctx }) => {
      if (isUsingFallback) {
        const found = (fallbackStore.offers || []).find(
          o => o.id_uuid === input.id_uuid && o.tenant_id === ctx.tenantId
        );
        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "offer_not_found" });
        }
        const fallbackStatus: Offer['offer_status'] = (found.offer_status || (found as { status?: Offer['offer_status'] }).status || 'draft') as Offer['offer_status'];
        return {
          ...found,
          offer_status: fallbackStatus,
          status: fallbackStatus
        };
      }
      const res = await pool.query(
        `SELECT * FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2`,
        [input.id_uuid, ctx.tenantId]
      );
      if (res.rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "offer_not_found" });
      }
      const cleaned = cleanDbRow(res.rows[0]);
      let items = [];
      if (cleaned.line_items_json) {
        items = typeof cleaned.line_items_json === "string"
          ? JSON.parse(cleaned.line_items_json)
          : cleaned.line_items_json;
      }
      return {
        ...mapOfferDates(cleaned),
        offer_status: cleaned.offer_status || cleaned.status || 'draft',
        status: cleaned.offer_status || cleaned.status || 'draft',
        line_items: items,
        total_net_amount: Number(cleaned.total_net_amount),
        total_vat_amount: Number(cleaned.total_vat_amount),
        total_gross_amount: Number(cleaned.total_gross_amount)
      } as Offer;
    }),

  createOffer: protectedProcedure
    .input(OfferInputSchema)
    .output(OfferFullSchema)
    .mutation(async ({ input, ctx }) => {
      const cleanedInput = cleanLigatureHacksFromValue(input);
      const id = uuidv4();
      const currentYear = new Date().getFullYear();
      const yearPrefix = `AG-${currentYear}-`;
      let nextSeq = 1;

      // Calculate next sequence number
      if (isUsingFallback) {
        const yearOffers = (fallbackStore.offers || []).filter(
          o => o.tenant_id === ctx.tenantId && o.offer_number.startsWith(yearPrefix)
        );
        let maxSeq = 0;
        for (const o of yearOffers) {
          const numPart = o.offer_number.replace(yearPrefix, "");
          const seq = parseInt(numPart, 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
        nextSeq = maxSeq + 1;
      } else {
        const res = await pool.query(
          `SELECT offer_number FROM core_registry_offers WHERE tenant_id = $1 AND offer_number LIKE $2`,
          [ctx.tenantId, `${yearPrefix}%`]
        );
        let maxSeq = 0;
        for (const row of res.rows) {
          const numPart = row.offer_number.replace(yearPrefix, "");
          const seq = parseInt(numPart, 10);
          if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
          }
        }
        nextSeq = maxSeq + 1;
      }

      const offerNumber = `${yearPrefix}${String(nextSeq).padStart(4, "0")}`;

      // Calculate totals
      let totalNet = 0;
      let totalVat = 0;
      let totalGross = 0;

      const processedLineItems = cleanedInput.line_items.map(item => {
        const itemNet = Number((item.quantity * item.unit_price).toFixed(2));
        const itemVat = Number((itemNet * (item.vat_rate / 100)).toFixed(2));
        const itemGross = Number((itemNet + itemVat).toFixed(2));
        
        totalNet += itemNet;
        totalVat += itemVat;
        totalGross += itemGross;

        return {
          ...item,
          total_net: itemNet,
          total_gross: itemGross
        };
      });

      totalNet = Number(totalNet.toFixed(2));
      totalVat = Number(totalVat.toFixed(2));
      totalGross = Number(totalGross.toFixed(2));

      const newOffer: Offer = {
        id_uuid: id,
        tenant_id: ctx.tenantId,
        offer_number: offerNumber,
        associated_company_id: cleanedInput.associated_company_id ?? null,
        associated_contact_id: cleanedInput.associated_contact_id ?? null,
        title: cleanedInput.title,
        introductory_text: cleanedInput.introductory_text,
        closing_text: cleanedInput.closing_text,
        issue_date: cleanedInput.issue_date,
        valid_until: cleanedInput.valid_until,
        payment_term: cleanedInput.payment_term,
        currency_code: cleanedInput.currency_code,
        is_vat_inclusive: cleanedInput.is_vat_inclusive,
        line_items: processedLineItems,
        total_net_amount: totalNet,
        total_vat_amount: totalVat,
        total_gross_amount: totalGross,
        offer_status: cleanedInput.offer_status,
        pdf_file_path: null,
        created_by_identity: ctx.session?.user?.role || "human",
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      };

      if (isUsingFallback) {
        if (!fallbackStore.offers) fallbackStore.offers = [];
        fallbackStore.offers.unshift(newOffer);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO core_registry_offers (
            id_uuid, tenant_id, offer_number, associated_company_id, associated_contact_id,
            title, introductory_text, closing_text, issue_date, valid_until, payment_term,
            currency_code, is_vat_inclusive, line_items_json, total_net_amount, total_vat_amount,
            total_gross_amount, offer_status, pdf_file_path, created_by_identity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            newOffer.id_uuid,
            newOffer.tenant_id,
            newOffer.offer_number,
            newOffer.associated_company_id,
            newOffer.associated_contact_id,
            newOffer.title,
            newOffer.introductory_text,
            newOffer.closing_text,
            newOffer.issue_date,
            newOffer.valid_until,
            newOffer.payment_term,
            newOffer.currency_code,
            newOffer.is_vat_inclusive,
            JSON.stringify(newOffer.line_items),
            newOffer.total_net_amount,
            newOffer.total_vat_amount,
            newOffer.total_gross_amount,
            newOffer.offer_status,
            newOffer.pdf_file_path,
            newOffer.created_by_identity
          ]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: "CREATE",
          entityType: "OFFER",
          entityId: id,
          eventDetails: `Created offer: ${offerNumber} - ${cleanedInput.title}`,
          actorIdentity: ctx.session?.user?.email || "unknown"
        });
      }

      // Generate & save PDF to Company Vault / RAG immediately upon creation
      let destFilePath = "";
      let pdfRelativePath = "";
      const filename = `angebot_${newOffer.offer_number}.pdf`;

      try {
        let company: Company | null = null;
        let contact: Contact | null = null;

        if (newOffer.associated_company_id) {
          if (isUsingFallback) {
            company = (fallbackStore.companies || []).find(c => c.id_uuid === newOffer.associated_company_id) || null;
          } else {
            const res = await pool.query(`SELECT * FROM core_registry_companies WHERE id_uuid = $1`, [newOffer.associated_company_id]);
            if (res.rows.length > 0) {
              company = cleanDbRow(res.rows[0]) as Company;
            }
          }
        }

        if (newOffer.associated_contact_id) {
          if (isUsingFallback) {
            contact = (fallbackStore.contacts || []).find(c => c.id_uuid === newOffer.associated_contact_id) || null;
          } else {
            const res = await pool.query(`SELECT * FROM core_registry_contacts WHERE id_uuid = $1`, [newOffer.associated_contact_id]);
            if (res.rows.length > 0) {
              contact = cleanDbRow(res.rows[0]) as Contact;
            }
          }
        }

        let myCompanyDetails: MyCompany | null = null;
        if (isUsingFallback) {
          myCompanyDetails = fallbackStore.myCompany;
        } else {
          const res = await pool.query(`SELECT * FROM core_registry_my_company_table WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1`, [ctx.tenantId]);
          if (res.rows.length > 0) {
            myCompanyDetails = cleanDbRow(res.rows[0]);
          }
        }

        // Build PDF Buffer
        const pdfBuffer = await buildOfferPDFBuffer(newOffer, company, contact, myCompanyDetails, "de");

        if (newOffer.associated_company_id && company) {
          const dirPath = getEntityStoragePath("companies", newOffer.associated_company_id, company.full_legal_name, ctx.tenantId);
          destFilePath = path.join(dirPath, filename);
          fs.writeFileSync(destFilePath, pdfBuffer);

          ingestFileToRag(destFilePath, filename, ctx.tenantId, "company", newOffer.associated_company_id).catch(err => {
            console.error(`[createOffer] RAG ingestion failed for company ${newOffer.associated_company_id}:`, err);
          });

          pdfRelativePath = `companies/${ctx.tenantId}/${newOffer.associated_company_id}/${filename}`;
        } else {
          const vaultRoot = path.join(process.cwd(), "knowledge_vault", "offers");
          if (!fs.existsSync(vaultRoot)) {
            fs.mkdirSync(vaultRoot, { recursive: true });
          }
          destFilePath = path.join(vaultRoot, filename);
          fs.writeFileSync(destFilePath, pdfBuffer);

          ingestFileToRag(destFilePath, filename, ctx.tenantId, "global", undefined).catch(err => {
            console.error("[createOffer] RAG ingestion failed globally:", err);
          });

          pdfRelativePath = `knowledge_vault/offers/${filename}`;
        }

        newOffer.pdf_file_path = pdfRelativePath;
        
        // Update database with the pdfRelativePath
        if (isUsingFallback) {
          const idx = fallbackStore.offers!.findIndex(o => o.id_uuid === newOffer.id_uuid);
          if (idx !== -1) {
            fallbackStore.offers![idx].pdf_file_path = pdfRelativePath;
            saveFallbackStore();
          }
        } else {
          await pool.query(
            `UPDATE core_registry_offers SET pdf_file_path = $1 WHERE id_uuid = $2 AND tenant_id = $3`,
            [pdfRelativePath, newOffer.id_uuid, ctx.tenantId]
          );
        }
      } catch (pdfErr) {
        console.error("Failed to automatically generate and save offer PDF during creation:", pdfErr);
      }

      return newOffer;
    }),

  updateOffer: protectedProcedure
    .input(OfferUpdateInputSchema)
    .output(OfferFullSchema)
    .mutation(async ({ input, ctx }) => {
      const cleanedInput = cleanLigatureHacksFromValue(input);
      const { id_uuid, ...data } = cleanedInput;

      // Verify draft status before updates
      let existingOffer: Offer | null = null;
      if (isUsingFallback) {
        existingOffer = (fallbackStore.offers || []).find(
          o => o.id_uuid === id_uuid && o.tenant_id === ctx.tenantId
        ) || null;
      } else {
        const res = await pool.query(
          `SELECT * FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2`,
          [id_uuid, ctx.tenantId]
        );
        if (res.rows.length > 0) {
          const cleaned = cleanDbRow(res.rows[0]);
          let items = [];
          if (cleaned.line_items_json) {
            items = typeof cleaned.line_items_json === "string"
              ? JSON.parse(cleaned.line_items_json)
              : cleaned.line_items_json;
          }
          existingOffer = {
            ...cleaned,
            line_items: items,
            total_net_amount: Number(cleaned.total_net_amount),
            total_vat_amount: Number(cleaned.total_vat_amount),
            total_gross_amount: Number(cleaned.total_gross_amount)
          } as Offer;
        }
      }

      if (!existingOffer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "offer_not_found" });
      }

      if (existingOffer.offer_status === "accepted" || existingOffer.offer_status === "rejected" || (existingOffer.offer_status as string) === "declined") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "cannot_modify_completed_offer"
        });
      }

      // Re-calculate totals
      let totalNet = 0;
      let totalVat = 0;
      let totalGross = 0;

      const processedLineItems = data.line_items.map(item => {
        const itemNet = Number((item.quantity * item.unit_price).toFixed(2));
        const itemVat = Number((itemNet * (item.vat_rate / 100)).toFixed(2));
        const itemGross = Number((itemNet + itemVat).toFixed(2));
        
        totalNet += itemNet;
        totalVat += itemVat;
        totalGross += itemGross;

        return {
          ...item,
          total_net: itemNet,
          total_gross: itemGross
        };
      });

      totalNet = Number(totalNet.toFixed(2));
      totalVat = Number(totalVat.toFixed(2));
      totalGross = Number(totalGross.toFixed(2));

      const updatedOffer: Offer = {
        ...existingOffer,
        associated_company_id: data.associated_company_id ?? null,
        associated_contact_id: data.associated_contact_id ?? null,
        title: data.title,
        introductory_text: data.introductory_text,
        closing_text: data.closing_text,
        issue_date: data.issue_date,
        valid_until: data.valid_until,
        payment_term: data.payment_term,
        currency_code: data.currency_code,
        is_vat_inclusive: data.is_vat_inclusive,
        line_items: processedLineItems,
        total_net_amount: totalNet,
        total_vat_amount: totalVat,
        total_gross_amount: totalGross,
        offer_status: data.offer_status,
        updated_at_utc: new Date().toISOString()
      };

      if (isUsingFallback) {
        const idx = fallbackStore.offers!.findIndex(o => o.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.offers![idx] = updatedOffer;
          saveFallbackStore();
        }
      } else {
        await pool.query(
          `UPDATE core_registry_offers SET
            associated_company_id = $1, associated_contact_id = $2, title = $3,
            introductory_text = $4, closing_text = $5, issue_date = $6, valid_until = $7,
            payment_term = $8, currency_code = $9, is_vat_inclusive = $10, line_items_json = $11,
            total_net_amount = $12, total_vat_amount = $13, total_gross_amount = $14,
            offer_status = $15, updated_at_utc = $16
          WHERE id_uuid = $17 AND tenant_id = $18`,
          [
            updatedOffer.associated_company_id,
            updatedOffer.associated_contact_id,
            updatedOffer.title,
            updatedOffer.introductory_text,
            updatedOffer.closing_text,
            updatedOffer.issue_date,
            updatedOffer.valid_until,
            updatedOffer.payment_term,
            updatedOffer.currency_code,
            updatedOffer.is_vat_inclusive,
            JSON.stringify(updatedOffer.line_items),
            updatedOffer.total_net_amount,
            updatedOffer.total_vat_amount,
            updatedOffer.total_gross_amount,
            updatedOffer.offer_status,
            updatedOffer.updated_at_utc,
            id_uuid,
            ctx.tenantId
          ]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: "UPDATE",
          entityType: "OFFER",
          entityId: id_uuid,
          eventDetails: `Updated offer: ${updatedOffer.offer_number} - ${updatedOffer.title}`,
          actorIdentity: ctx.session?.user?.email || "unknown"
        });
      }

      workflowEventBus.emitEvent(ctx.tenantId, 'offer.status_updated', {
        id_uuid: id_uuid,
        offer_status: updatedOffer.offer_status,
        offer_number: updatedOffer.offer_number
      });

      return updatedOffer;
    }),

  deleteOffer: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      let existingOffer: Offer | null = null;
      if (isUsingFallback) {
        existingOffer = (fallbackStore.offers || []).find(
          o => o.id_uuid === input.id_uuid && o.tenant_id === ctx.tenantId
        ) || null;
      } else {
        const res = await pool.query(
          `SELECT offer_status FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2`,
          [input.id_uuid, ctx.tenantId]
        );
        if (res.rows.length > 0) {
          existingOffer = cleanDbRow(res.rows[0]) as Offer;
        }
      }

      if (!existingOffer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "offer_not_found" });
      }

      if (existingOffer.offer_status === "accepted" || existingOffer.offer_status === "rejected" || (existingOffer.offer_status as string) === "declined") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "cannot_delete_completed_offer"
        });
      }

      if (isUsingFallback) {
        fallbackStore.offers = (fallbackStore.offers || []).filter(o => o.id_uuid !== input.id_uuid);
        saveFallbackStore();
      } else {
        await pool.query(
          `DELETE FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2`,
          [input.id_uuid, ctx.tenantId]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: "DELETE",
          entityType: "OFFER",
          entityId: input.id_uuid,
          eventDetails: `Deleted offer: ${input.id_uuid}`,
          actorIdentity: ctx.session?.user?.email || "unknown"
        });
      }

      return { success: true };
    }),

  getTemplates: protectedProcedure
    .output(z.array(OfferTextTemplateFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return (fallbackStore.offerTextTemplates || []).filter(t => t.tenant_id === ctx.tenantId);
      }
      const res = await pool.query(
        `SELECT * FROM sys_comms_offer_text_templates WHERE tenant_id = $1 ORDER BY created_at_utc DESC`,
        [ctx.tenantId]
      );
      return res.rows.map(row => cleanDbRow(row) as OfferTextTemplate);
    }),

  createTemplate: protectedProcedure
    .input(OfferTextTemplateSchema)
    .output(OfferTextTemplateFullSchema)
    .mutation(async ({ input, ctx }) => {
      const cleanedInput = cleanLigatureHacksFromValue(input);
      const id = uuidv4();

      const newTemplate = {
        id_uuid: id,
        tenant_id: ctx.tenantId,
        template_name_text: cleanedInput.template_name_text,
        template_type_code: cleanedInput.template_type_code,
        template_body_content: cleanedInput.template_body_content,
        created_by_identity: (cleanedInput.created_by_identity || 'human') as 'human' | 'ai_assistant' | 'system',
        ai_confidence_score: cleanedInput.ai_confidence_score ?? 1.0,
        is_verified_by_human: cleanedInput.is_verified_by_human ?? false,
        metadata: cleanedInput.metadata || {},
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      };

      if (isUsingFallback) {
        if (!fallbackStore.offerTextTemplates) fallbackStore.offerTextTemplates = [];
        fallbackStore.offerTextTemplates.unshift(newTemplate);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_comms_offer_text_templates (
            id_uuid, tenant_id, template_name_text, template_type_code, template_body_content,
            created_by_identity, ai_confidence_score, is_verified_by_human, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            newTemplate.id_uuid,
            newTemplate.tenant_id,
            newTemplate.template_name_text,
            newTemplate.template_type_code,
            newTemplate.template_body_content,
            newTemplate.created_by_identity,
            newTemplate.ai_confidence_score,
            newTemplate.is_verified_by_human,
            typeof newTemplate.metadata === 'object' ? JSON.stringify(newTemplate.metadata) : '{}'
          ]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: "CREATE",
          entityType: "OFFER_TEXT_TEMPLATE",
          entityId: id,
          eventDetails: `Created offer text template: ${cleanedInput.template_name_text}`,
          actorIdentity: ctx.session?.user?.email || "unknown"
        });
      }

      return newTemplate;
    }),

  updateTemplate: protectedProcedure
    .input(OfferTextTemplateSchema.extend({ id_uuid: z.string().uuid() }))
    .output(OfferTextTemplateFullSchema)
    .mutation(async ({ input, ctx }) => {
      const cleanedInput = cleanLigatureHacksFromValue(input);
      const { id_uuid, ...data } = cleanedInput;

      if (isUsingFallback) {
        const idx = (fallbackStore.offerTextTemplates || []).findIndex(
          t => t.id_uuid === id_uuid && t.tenant_id === ctx.tenantId
        );
        if (idx === -1) {
          throw new TRPCError({ code: "NOT_FOUND", message: "template_not_found" });
        }
        const updated = {
          ...fallbackStore.offerTextTemplates![idx],
          ...data,
          updated_at_utc: new Date().toISOString()
        };
        fallbackStore.offerTextTemplates![idx] = updated;
        saveFallbackStore();
        return updated as OfferTextTemplate;
      }

      const res = await pool.query(
        `SELECT id_uuid FROM sys_comms_offer_text_templates WHERE id_uuid = $1 AND tenant_id = $2`,
        [id_uuid, ctx.tenantId]
      );
      if (res.rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "template_not_found" });
      }

      const updated_at = new Date().toISOString();
      await pool.query(
        `UPDATE sys_comms_offer_text_templates SET
          template_name_text = $1, template_type_code = $2, template_body_content = $3,
          created_by_identity = $4, ai_confidence_score = $5, is_verified_by_human = $6,
          metadata = $7, updated_at_utc = $8
        WHERE id_uuid = $9 AND tenant_id = $10`,
        [
          data.template_name_text,
          data.template_type_code,
          data.template_body_content,
          data.created_by_identity || 'human',
          data.ai_confidence_score ?? 1.0,
          data.is_verified_by_human ?? false,
          typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : '{}',
          updated_at,
          id_uuid,
          ctx.tenantId
        ]
      );

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: "UPDATE",
        entityType: "OFFER_TEXT_TEMPLATE",
        entityId: id_uuid,
        eventDetails: `Updated offer text template: ${data.template_name_text}`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return {
        id_uuid,
        tenant_id: ctx.tenantId,
        ...data,
        updated_at_utc: updated_at
      } as OfferTextTemplate;
    }),

  deleteTemplate: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        const found = (fallbackStore.offerTextTemplates || []).some(
          t => t.id_uuid === input.id_uuid && t.tenant_id === ctx.tenantId
        );
        if (!found) {
          throw new TRPCError({ code: "NOT_FOUND", message: "template_not_found" });
        }
        fallbackStore.offerTextTemplates = fallbackStore.offerTextTemplates!.filter(t => t.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }

      const res = await pool.query(
        `DELETE FROM sys_comms_offer_text_templates WHERE id_uuid = $1 AND tenant_id = $2`,
        [input.id_uuid, ctx.tenantId]
      );
      if (res.rowCount === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "template_not_found" });
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: "DELETE",
        entityType: "OFFER_TEXT_TEMPLATE",
        entityId: input.id_uuid,
        eventDetails: `Deleted offer text template: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return { success: true };
    }),

  generateOfferPdf: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ filePath: z.string(), success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      // 1. Load Offer
      let offer: Offer | null = null;
      if (isUsingFallback) {
        offer = (fallbackStore.offers || []).find(o => o.id_uuid === input.id_uuid && o.tenant_id === ctx.tenantId) || null;
      } else {
        const res = await pool.query(`SELECT * FROM core_registry_offers WHERE id_uuid = $1 AND tenant_id = $2`, [input.id_uuid, ctx.tenantId]);
        if (res.rows.length > 0) {
          const cleaned = cleanDbRow(res.rows[0]);
          let items = [];
          if (cleaned.line_items_json) {
            items = typeof cleaned.line_items_json === "string" ? JSON.parse(cleaned.line_items_json) : cleaned.line_items_json;
          }
          offer = {
            ...cleaned,
            line_items: items,
            total_net_amount: Number(cleaned.total_net_amount),
            total_vat_amount: Number(cleaned.total_vat_amount),
            total_gross_amount: Number(cleaned.total_gross_amount)
          } as Offer;
        }
      }

      if (!offer) {
        throw new TRPCError({ code: "NOT_FOUND", message: "offer_not_found" });
      }

      // 2. Fetch Recipient Company/Contact
      let company: Company | null = null;
      let contact: Contact | null = null;

      if (offer.associated_company_id) {
        if (isUsingFallback) {
          company = (fallbackStore.companies || []).find(c => c.id_uuid === offer!.associated_company_id) || null;
        } else {
          const res = await pool.query(`SELECT * FROM core_registry_companies WHERE id_uuid = $1`, [offer.associated_company_id]);
          if (res.rows.length > 0) {
            company = cleanDbRow(res.rows[0]) as Company;
          }
        }
      }

      if (offer.associated_contact_id) {
        if (isUsingFallback) {
          contact = (fallbackStore.contacts || []).find(c => c.id_uuid === offer!.associated_contact_id) || null;
        } else {
          const res = await pool.query(`SELECT * FROM core_registry_contacts WHERE id_uuid = $1`, [offer.associated_contact_id]);
          if (res.rows.length > 0) {
            contact = cleanDbRow(res.rows[0]) as Contact;
          }
        }
      }

      // 3. Fetch My Company details for sender address
      let myCompanyDetails: MyCompany | null = null;
      if (isUsingFallback) {
        myCompanyDetails = fallbackStore.myCompany;
      } else {
        const res = await pool.query(`SELECT * FROM core_registry_my_company_table WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1`, [ctx.tenantId]);
        if (res.rows.length > 0) {
          myCompanyDetails = cleanDbRow(res.rows[0]);
        }
      }

      // 4. Generate PDF buffer using our isolated pdfOfferHelper
      const pdfBuffer = await buildOfferPDFBuffer(offer, company, contact, myCompanyDetails, "de");

      // 5. Save PDF in storage path & register with RAG
      let destFilePath = "";
      const filename = `angebot_${offer.offer_number}.pdf`;

      if (offer.associated_company_id && company) {
        const dirPath = getEntityStoragePath("companies", offer.associated_company_id, company.full_legal_name, ctx.tenantId);
        destFilePath = path.join(dirPath, filename);
        fs.writeFileSync(destFilePath, pdfBuffer);

        // Register in company vault with scope "company"
        ingestFileToRag(destFilePath, filename, ctx.tenantId, "company", offer.associated_company_id).catch(err => {
          console.error(`[generateOfferPdf] RAG ingestion failed for company ${offer!.associated_company_id}:`, err);
        });
      } else {
        // Free Quote (Neukunde / No Company) -> Central offers folder
        const vaultRoot = path.join(process.cwd(), "knowledge_vault", "offers");
        if (!fs.existsSync(vaultRoot)) {
          fs.mkdirSync(vaultRoot, { recursive: true });
        }
        destFilePath = path.join(vaultRoot, filename);
        fs.writeFileSync(destFilePath, pdfBuffer);

        // Register globally in Wissensdatenbank with scope "global"
        ingestFileToRag(destFilePath, filename, ctx.tenantId, "global", undefined).catch(err => {
          console.error("[generateOfferPdf] RAG ingestion failed globally:", err);
        });
      }

      // 6. Update Offer with pdf_file_path and change status to 'sent'
      const pdfRelativePath = offer.associated_company_id 
        ? `companies/${ctx.tenantId}/${offer.associated_company_id}/${filename}`
        : `knowledge_vault/offers/${filename}`;

      if (isUsingFallback) {
        const idx = fallbackStore.offers!.findIndex(o => o.id_uuid === input.id_uuid);
        if (idx !== -1) {
          fallbackStore.offers![idx].pdf_file_path = pdfRelativePath;
          fallbackStore.offers![idx].offer_status = "sent";
          saveFallbackStore();
        }
      } else {
        await pool.query(
          `UPDATE core_registry_offers SET pdf_file_path = $1, offer_status = $2, updated_at_utc = $3 WHERE id_uuid = $4 AND tenant_id = $5`,
          [pdfRelativePath, "sent", new Date().toISOString(), input.id_uuid, ctx.tenantId]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: "UPDATE",
          entityType: "OFFER",
          entityId: input.id_uuid,
          eventDetails: `Generated & finalized PDF for Offer: ${offer.offer_number}. Status updated to 'sent'.`,
          actorIdentity: ctx.session?.user?.email || "unknown"
        });
      }

      return { filePath: pdfRelativePath, success: true };
    }),

  importOfferTemplates: protectedProcedure
    .input(z.array(z.object({
      id_uuid: z.string().uuid().optional(),
      template_name_text: z.string().min(1),
      template_type_code: z.string().min(1),
      template_body_content: z.string()
    })))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      let importedCount = 0;
      let updatedCount = 0;
      for (const item of input) {
        const id = item.id_uuid || uuidv4();
        if (isUsingFallback) {
          if (!fallbackStore.offerTextTemplates) fallbackStore.offerTextTemplates = [];
          const idx = fallbackStore.offerTextTemplates.findIndex(x => x.id_uuid === id && x.tenant_id === ctx.tenantId);
          if (idx !== -1) {
            fallbackStore.offerTextTemplates[idx] = {
              ...fallbackStore.offerTextTemplates[idx],
              template_name_text: item.template_name_text,
              template_type_code: item.template_type_code,
              template_body_content: item.template_body_content,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            fallbackStore.offerTextTemplates.unshift({
              id_uuid: id,
              tenant_id: ctx.tenantId,
              template_name_text: item.template_name_text,
              template_type_code: item.template_type_code,
              template_body_content: item.template_body_content,
              created_by_identity: 'human',
              ai_confidence_score: 1.0,
              is_verified_by_human: false,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
            importedCount++;
          }
          saveFallbackStore();
          continue;
        }

        const checkRes = await pool.query(
          "SELECT id_uuid FROM sys_comms_offer_text_templates WHERE id_uuid = $1 AND tenant_id = $2",
          [id, ctx.tenantId]
        );
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE sys_comms_offer_text_templates
            SET template_name_text = $1, template_type_code = $2, template_body_content = $3, updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $4 AND tenant_id = $5
          `, [
            item.template_name_text, item.template_type_code, item.template_body_content, id, ctx.tenantId
          ]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO sys_comms_offer_text_templates (
              id_uuid, tenant_id, template_name_text, template_type_code, template_body_content
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            id, ctx.tenantId, item.template_name_text, item.template_type_code, item.template_body_content
          ]);
          importedCount++;
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: "UPDATE_CONFIG",
        entityType: "OFFER_TEXT_TEMPLATE",
        eventDetails: `Imported offer text templates: ${importedCount} created, ${updatedCount} updated`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return { importedCount, updatedCount };
    })
});
