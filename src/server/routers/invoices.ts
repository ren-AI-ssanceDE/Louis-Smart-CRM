import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, logAuditEvent, saveFallbackStore, cleanDbRow } from "../db.js";
import { getEntityStoragePath } from "../storage.js";
import { InvoiceSchema, InvoiceFullSchema } from "../../lib/schemas.js";
import { Invoice, InvoicePaidPayload } from "../../types.js";
import { generateInvoiceFilesOnDisk } from "../pdfHelper.js";
import { compareInvoiceNumbers } from "../../lib/utils.js";
import { TRPCError } from "@trpc/server";
import { workflowEventBus } from "../ai/workflowEventBus.js";

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
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      newObj[key] = sanitizeInputLigatures((obj as any)[key]);
    }
    return newObj as T;
  }
  return obj;
};

export const invoicesRouter = router({
  getInvoices: protectedProcedure
    .output(z.array(InvoiceFullSchema))
    .query(async ({ ctx }) => {
      try {
        if (isUsingFallback) {
          return (fallbackStore.invoices || []).map(inv => {
            const company = fallbackStore.companies.find(c => c.id_uuid === inv.associated_company_id);
            const contact = fallbackStore.contacts.find(c => c.id_uuid === inv.associated_contact_id);
            
            let computedDueDate = inv.due_date;
            if (!computedDueDate && inv.issue_date) {
              const days = parseInt(inv.payment_term || "14", 10);
              if (!isNaN(days)) {
                const d = new Date(inv.issue_date);
                d.setDate(d.getDate() + days);
                computedDueDate = d.toISOString().split('T')[0];
              }
            }

            const rawScore = inv.ai_confidence_score !== undefined && inv.ai_confidence_score !== null ? inv.ai_confidence_score : 1.0;
            const confidence = rawScore > 1 ? (rawScore / 100) : rawScore;
            
            return {
              ...inv,
              due_date: computedDueDate || null,
              ai_confidence_score: confidence,
              company_name: company ? company.full_legal_name : (inv.company_name || ''),
              contact_full_name: contact ? (contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()) : (inv.contact_full_name || ''),
            };
          });
        }
        const res = await pool.query(`
          SELECT i.*, co.full_legal_name as company_name, ct.full_legal_name as contact_full_name
          FROM fiscal_billing_invoices i
          LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
          LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
          WHERE i.tenant_id = $1 OR i.tenant_id = '1'
          ORDER BY i.issue_date DESC, i.created_at_utc DESC
        `, [ctx.tenantId]);
        
        const mapped = res.rows.map(row => {
          const r = cleanDbRow(row);
          let items = [];
          if (r.invoice_line_items_json) {
            items = typeof r.invoice_line_items_json === 'string'
              ? JSON.parse(r.invoice_line_items_json)
              : r.invoice_line_items_json;
          }
          const rawScore = r.ai_confidence_score !== undefined && r.ai_confidence_score !== null ? r.ai_confidence_score : 1.0;
          const confidence = rawScore > 1 ? (rawScore / 100) : rawScore;

          const dataToValidate = {
            ...r,
            ai_confidence_score: confidence,
            invoice_line_items_json: typeof r.invoice_line_items_json === 'string'
              ? r.invoice_line_items_json
              : JSON.stringify(r.invoice_line_items_json || []),
            total_net_amount: typeof r.total_net_amount === 'string' ? parseFloat(r.total_net_amount) : r.total_net_amount,
            total_vat_amount: typeof r.total_vat_amount === 'string' ? parseFloat(r.total_vat_amount) : r.total_vat_amount,
            total_gross_amount: typeof r.total_gross_amount === 'string' ? parseFloat(r.total_gross_amount) : r.total_gross_amount,
            vat_rate: r.vat_rate !== undefined && r.vat_rate !== null ? (typeof r.vat_rate === 'string' ? parseFloat(r.vat_rate) : r.vat_rate) : 19,
            issue_date: r.issue_date instanceof Date ? r.issue_date.toISOString().split('T')[0] : (r.issue_date || ""),
            service_date: r.service_date instanceof Date ? r.service_date.toISOString().split('T')[0] : (r.service_date || null),
            due_date: (() => {
              const storedDue = r.due_date instanceof Date ? r.due_date.toISOString().split('T')[0] : (r.due_date || null);
              if (storedDue) return storedDue;
              const isDate = r.issue_date instanceof Date ? r.issue_date.toISOString().split('T')[0] : r.issue_date;
              if (isDate) {
                const days = parseInt(r.payment_term || "14", 10);
                if (!isNaN(days)) {
                  const d = new Date(isDate);
                  d.setDate(d.getDate() + days);
                  return d.toISOString().split('T')[0];
                }
              }
              return null;
            })(),
            invoice_line_items: items,
            company_name: r.company_name || '',
            contact_full_name: r.contact_full_name || '',
          };

          const parsed = InvoiceFullSchema.safeParse(dataToValidate);
          if (!parsed.success) {
            const errorStr = `Invoice row ${r.invoice_number || r.id_uuid} validation error: ${JSON.stringify(parsed.error.format())}`;
            console.error(errorStr);
            fs.appendFileSync("/server_errors.log", `${new Date().toISOString()} - Mapped Validation failure: ${errorStr}\n`);
          }
          return dataToValidate;
        });

        return mapped;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errMsg = error.stack || error.message || String(err);
        fs.appendFileSync("/server_errors.log", `${new Date().toISOString()} - getInvoices error: ${errMsg}\n`);
        console.error("Error in getInvoices:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fehler in getInvoices: ${error.message}`
        });
      }
    }),

  createInvoice: protectedProcedure
    .input(InvoiceSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        input = sanitizeInputLigatures(input);
        const id = uuidv4();
        
        // 1. Retrieve numbering settings from MyCompany profile
        let nextSeq = 1;
        let minDigits = 4;
        let prefix = "RE-";
        let yearFixed = true;

        if (isUsingFallback) {
          const mc = fallbackStore.myCompany;
          if (mc) {
            prefix = mc.invoice_number_prefix ?? "RE-";
            yearFixed = mc.invoice_number_year_fixed ?? true;
            nextSeq = mc.invoice_number_next_seq ?? 1;
            minDigits = mc.invoice_number_min_digits ?? 4;
          }
        } else {
          const mcRes = await pool.query(
            "SELECT invoice_number_prefix, invoice_number_year_fixed, invoice_number_next_seq, invoice_number_min_digits FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [ctx.tenantId]
          );
          if (mcRes.rows.length > 0) {
            const row = mcRes.rows[0];
            prefix = row.invoice_number_prefix ?? "RE-";
            yearFixed = row.invoice_number_year_fixed ?? true;
            nextSeq = row.invoice_number_next_seq ?? 1;
            minDigits = row.invoice_number_min_digits ?? 4;
          }
        }

        // 2. Parse issue_date's calendar year
        const issueDateYear = input.issue_date ? new Date(input.issue_date).getFullYear() : new Date().getFullYear();
        const finalYear = isNaN(issueDateYear) ? new Date().getFullYear() : issueDateYear;

        // 3. Generate final compliant non-colliding invoice number
        let computedInvoiceNumber = "";
        let isDuplicate = true;
        let attempts = 0;
        const maxAttempts = 1000;

        while (isDuplicate && attempts < maxAttempts) {
          const paddedSeq = String(nextSeq).padStart(minDigits, "0");

          if (yearFixed) {
            if (prefix.includes("YYYY")) {
              computedInvoiceNumber = prefix.replace("YYYY", String(finalYear)) + paddedSeq;
            } else if (prefix.includes("{year}")) {
              computedInvoiceNumber = prefix.replace("{year}", String(finalYear)) + paddedSeq;
            } else {
              computedInvoiceNumber = `${prefix}${finalYear}-${paddedSeq}`;
            }
          } else {
            computedInvoiceNumber = `${prefix}${paddedSeq}`;
          }

          if (isUsingFallback) {
            isDuplicate = fallbackStore.invoices.some(i => i.invoice_number === computedInvoiceNumber);
          } else {
            const checkRes = await pool.query(
              "SELECT 1 FROM fiscal_billing_invoices WHERE tenant_id = $1 AND invoice_number = $2 LIMIT 1",
              [ctx.tenantId, computedInvoiceNumber]
            );
            isDuplicate = checkRes.rows.length > 0;
          }

          if (isDuplicate) {
            nextSeq++;
            attempts++;
          }
        }

        let finalDueDate = input.due_date;
        if (!finalDueDate && input.issue_date) {
          const days = parseInt(input.payment_term || "14", 10);
          if (!isNaN(days)) {
            const d = new Date(input.issue_date);
            d.setDate(d.getDate() + days);
            finalDueDate = d.toISOString().split('T')[0];
          } else {
            finalDueDate = input.issue_date;
          }
        }

        // 5. Save invoice database record using computed number
        if (isUsingFallback) {
          const newInvoice: z.infer<typeof InvoiceFullSchema> = { 
            ...input, 
            id_uuid: id, 
            invoice_number: computedInvoiceNumber,
            due_date: finalDueDate || null,
            created_by_identity: 'human',
            ai_confidence_score: 1.0,
            is_verified_by_human: true,
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString(),
            invoice_line_items_json: JSON.stringify(input.invoice_line_items)
          } as z.infer<typeof InvoiceFullSchema>;
          fallbackStore.invoices.unshift(newInvoice);
          
          // Increment the counter for next invoices in mock store
          if (fallbackStore.myCompany) {
            fallbackStore.myCompany.invoice_number_next_seq = nextSeq + 1;
          }
          saveFallbackStore();
          
          await logAuditEvent({
            tenantId: ctx.tenantId,
            eventType: 'CREATE',
            entityType: 'INVOICE',
            entityId: id,
            eventDetails: `Created invoice: ${computedInvoiceNumber}`,
            actorIdentity: ctx.session?.user?.email || 'unknown'
          });
          
          // Automatically generate PDF and XML on disk for File Manager
          await generateInvoiceFilesOnDisk(id, ctx.tenantId);

          workflowEventBus.emitEvent(ctx.tenantId, 'invoice.created', {
            id_uuid: id,
            invoice_number: computedInvoiceNumber,
            total_gross_amount: input.total_gross_amount,
            associated_company_id: input.associated_company_id,
            associated_contact_id: input.associated_contact_id
          });

          return { id_uuid: id };
        }

        await pool.query(`
          INSERT INTO fiscal_billing_invoices (
            id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id, bank_account, 
            issue_date, service_date, due_date, payment_term, is_vat_inclusive,
            total_net_amount, total_vat_amount, total_gross_amount, vat_rate, 
            currency_code, leitweg_id, invoice_line_items_json, raw_source_data,
            payment_status, created_by_identity, ai_confidence_score, is_verified_by_human,
            introductory_text, closing_text, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        `, [
          id, ctx.tenantId, computedInvoiceNumber, input.associated_company_id, input.associated_contact_id, input.bank_account,
          input.issue_date, input.service_date, finalDueDate, input.payment_term, input.is_vat_inclusive,
          input.total_net_amount, input.total_vat_amount, input.total_gross_amount, input.vat_rate,
          input.currency_code, input.leitweg_id, JSON.stringify(input.invoice_line_items), input.raw_source_data,
          input.payment_status, 'human', 1.0, true,
          input.introductory_text || '', input.closing_text || '', JSON.stringify(input.metadata || {})
        ]);

        // Increment next serial number registry sequence context with non-colliding sequence
        await pool.query(
          "UPDATE core_registry_my_company SET invoice_number_next_seq = $1 WHERE tenant_id = $2",
          [nextSeq + 1, ctx.tenantId]
        );

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'CREATE',
          entityType: 'INVOICE',
          entityId: id,
          eventDetails: `Created invoice: ${computedInvoiceNumber}`,
          actorIdentity: ctx.session?.user?.email || 'unknown'
        });

        // Automatically generate PDF and XML on disk for File Manager
        await generateInvoiceFilesOnDisk(id, ctx.tenantId);

        workflowEventBus.emitEvent(ctx.tenantId, 'invoice.created', {
          id_uuid: id,
          invoice_number: computedInvoiceNumber,
          total_gross_amount: input.total_gross_amount,
          associated_company_id: input.associated_company_id,
          associated_contact_id: input.associated_contact_id
        });

        return { id_uuid: id };
      } catch (err: unknown) {
        console.error("Error creating invoice:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fehler beim Erstellen der Rechnung: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }),

  createDraft: protectedProcedure
    .input(InvoiceSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const id = uuidv4();
        const computedInvoiceNumber = `ENTWURF-${id}`;
        
        let finalDueDate = input.due_date;
        if (!finalDueDate && input.issue_date) {
          const days = parseInt(input.payment_term || "14", 10);
          if (!isNaN(days)) {
            const d = new Date(input.issue_date);
            d.setDate(d.getDate() + days);
            finalDueDate = d.toISOString().split('T')[0];
          } else {
            finalDueDate = input.issue_date;
          }
        }

        if (isUsingFallback) {
          const newInvoice: z.infer<typeof InvoiceFullSchema> = { 
            ...input, 
            id_uuid: id, 
            invoice_number: computedInvoiceNumber,
            due_date: finalDueDate || null,
            payment_status: 'draft',
            created_by_identity: 'human',
            ai_confidence_score: 1.0,
            is_verified_by_human: true,
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString(),
            invoice_line_items_json: JSON.stringify(input.invoice_line_items)
          } as z.infer<typeof InvoiceFullSchema>;
          fallbackStore.invoices.unshift(newInvoice);
          saveFallbackStore();
          
          await logAuditEvent({
            tenantId: ctx.tenantId,
            eventType: 'CREATE_DRAFT',
            entityType: 'INVOICE',
            entityId: id,
            eventDetails: `Created invoice draft: ${computedInvoiceNumber}`,
            actorIdentity: ctx.session?.user?.email || 'unknown'
          });
          
          return { id_uuid: id };
        }

        await pool.query(`
          INSERT INTO fiscal_billing_invoices (
            id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id, bank_account, 
            issue_date, service_date, due_date, payment_term, is_vat_inclusive,
            total_net_amount, total_vat_amount, total_gross_amount, vat_rate, 
            currency_code, leitweg_id, invoice_line_items_json, raw_source_data,
            payment_status, created_by_identity, ai_confidence_score, is_verified_by_human,
            introductory_text, closing_text, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
        `, [
          id, ctx.tenantId, computedInvoiceNumber, input.associated_company_id, input.associated_contact_id, input.bank_account,
          input.issue_date, input.service_date, finalDueDate, input.payment_term, input.is_vat_inclusive,
          input.total_net_amount, input.total_vat_amount, input.total_gross_amount, input.vat_rate,
          input.currency_code, input.leitweg_id, JSON.stringify(input.invoice_line_items), input.raw_source_data,
          'draft', 'human', 1.0, true,
          input.introductory_text || '', input.closing_text || '', JSON.stringify(input.metadata || {})
        ]);

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'CREATE_DRAFT',
          entityType: 'INVOICE',
          entityId: id,
          eventDetails: `Created invoice draft: ${computedInvoiceNumber}`,
          actorIdentity: ctx.session?.user?.email || 'unknown'
        });

        return { id_uuid: id };
      } catch (err: unknown) {
        console.error("Error creating draft invoice:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fehler beim Erstellen des Rechnungsentwurfs: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }),

  finalizeDraft: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean(), invoice_number: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { id_uuid } = input;
        
        let draft: Invoice | null = null;
        if (isUsingFallback) {
          draft = fallbackStore.invoices.find(i => i.id_uuid === id_uuid) || null;
        } else {
          const draftRes = await pool.query(
            "SELECT * FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
            [id_uuid, ctx.tenantId]
          );
          if (draftRes.rows.length > 0) {
            draft = draftRes.rows[0] as Invoice;
          }
        }

        if (!draft) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Entwurf nicht gefunden."
          });
        }

        if (draft.payment_status !== 'draft') {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Diese Rechnung ist kein Entwurf und kann nicht finalisiert werden."
          });
        }

        let nextSeq = 1;
        let minDigits = 4;
        let prefix = "RE-";
        let yearFixed = true;

        if (isUsingFallback) {
          const mc = fallbackStore.myCompany;
          if (mc) {
            prefix = mc.invoice_number_prefix ?? "RE-";
            yearFixed = mc.invoice_number_year_fixed ?? true;
            nextSeq = mc.invoice_number_next_seq ?? 1;
            minDigits = mc.invoice_number_min_digits ?? 4;
          }
        } else {
          const mcRes = await pool.query(
            "SELECT invoice_number_prefix, invoice_number_year_fixed, invoice_number_next_seq, invoice_number_min_digits FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
            [ctx.tenantId]
          );
          if (mcRes.rows.length > 0) {
            const row = mcRes.rows[0];
            prefix = row.invoice_number_prefix ?? "RE-";
            yearFixed = row.invoice_number_year_fixed ?? true;
            nextSeq = row.invoice_number_next_seq ?? 1;
            minDigits = row.invoice_number_min_digits ?? 4;
          }
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const issueDateYear = new Date(todayStr).getFullYear();

        // Generate final compliant non-colliding invoice number
        let computedInvoiceNumber = "";
        let isDuplicate = true;
        let attempts = 0;
        const maxAttempts = 1000;

        while (isDuplicate && attempts < maxAttempts) {
          const paddedSeq = String(nextSeq).padStart(minDigits, "0");

          if (yearFixed) {
            if (prefix.includes("YYYY")) {
              computedInvoiceNumber = prefix.replace("YYYY", String(issueDateYear)) + paddedSeq;
            } else if (prefix.includes("{year}")) {
              computedInvoiceNumber = prefix.replace("{year}", String(issueDateYear)) + paddedSeq;
            } else {
              computedInvoiceNumber = `${prefix}${issueDateYear}-${paddedSeq}`;
            }
          } else {
            computedInvoiceNumber = `${prefix}${paddedSeq}`;
          }

          if (isUsingFallback) {
            isDuplicate = fallbackStore.invoices.some(i => i.invoice_number === computedInvoiceNumber);
          } else {
            const checkRes = await pool.query(
              "SELECT 1 FROM fiscal_billing_invoices WHERE tenant_id = $1 AND invoice_number = $2 LIMIT 1",
              [ctx.tenantId, computedInvoiceNumber]
            );
            isDuplicate = checkRes.rows.length > 0;
          }

          if (isDuplicate) {
            nextSeq++;
            attempts++;
          }
        }

        let finalDueDate = todayStr;
        const days = parseInt(draft.payment_term || "14", 10);
        if (!isNaN(days)) {
          const d = new Date(todayStr);
          d.setDate(d.getDate() + days);
          finalDueDate = d.toISOString().split('T')[0];
        }

        if (isUsingFallback) {
          const idx = fallbackStore.invoices.findIndex(i => i.id_uuid === id_uuid);
          if (idx !== -1) {
            fallbackStore.invoices[idx] = {
              ...fallbackStore.invoices[idx],
              invoice_number: computedInvoiceNumber,
              payment_status: 'pending',
              issue_date: todayStr,
              due_date: finalDueDate,
              updated_at_utc: new Date().toISOString()
            } as any;
          }
          if (fallbackStore.myCompany) {
            fallbackStore.myCompany.invoice_number_next_seq = nextSeq + 1;
          }
          saveFallbackStore();
        } else {
          await pool.query(`
            UPDATE fiscal_billing_invoices
            SET invoice_number = $1,
                payment_status = 'pending',
                issue_date = $2,
                due_date = $3,
                updated_at_utc = CURRENT_TIMESTAMP
            WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')
          `, [computedInvoiceNumber, todayStr, finalDueDate, id_uuid, ctx.tenantId]);

          await pool.query(
            "UPDATE core_registry_my_company SET invoice_number_next_seq = $1 WHERE tenant_id = $2",
            [nextSeq + 1, ctx.tenantId]
          );
        }

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'FINALIZE_DRAFT',
          entityType: 'INVOICE',
          entityId: id_uuid,
          eventDetails: `Finalized invoice draft ${draft.invoice_number} as official invoice ${computedInvoiceNumber}`,
          actorIdentity: ctx.session?.user?.email || 'unknown'
        });

        await generateInvoiceFilesOnDisk(id_uuid, ctx.tenantId);

        workflowEventBus.emitEvent(ctx.tenantId, 'invoice.created', {
          id_uuid: id_uuid,
          invoice_number: computedInvoiceNumber,
          total_gross_amount: draft.total_gross_amount,
          associated_company_id: draft.associated_company_id,
          associated_contact_id: draft.associated_contact_id
        });

        return { success: true, invoice_number: computedInvoiceNumber };
      } catch (err: unknown) {
        console.error("Error finalizing draft invoice:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fehler beim Finalisieren des Rechnungsentwurfs: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }),

  updateInvoice: protectedProcedure
    .input(InvoiceSchema.extend({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        input = sanitizeInputLigatures(input);
        const { id_uuid, ...data } = input;

      // 1. Fetch current (soon-to-be old) invoice from DB or fallbackStore BEFORE doing update so we can delete its old files on disk
      let oldInvoice: (Invoice & { entityType?: string; entityId?: string; entityName?: string; co_name?: string; ct_name?: string }) | null = null;
      if (isUsingFallback) {
        const found = fallbackStore.invoices.find(i => i.id_uuid === id_uuid);
        if (found) {
          oldInvoice = { ...found } as typeof oldInvoice;
          if (oldInvoice.associated_company_id) {
            const co = fallbackStore.companies.find(c => c.id_uuid === oldInvoice.associated_company_id);
            oldInvoice.entityType = "companies";
            oldInvoice.entityId = co?.id_uuid;
            oldInvoice.entityName = co?.full_legal_name;
          } else if (oldInvoice.associated_contact_id) {
            const ct = fallbackStore.contacts.find(c => c.id_uuid === oldInvoice.associated_contact_id);
            oldInvoice.entityType = "contacts";
            oldInvoice.entityId = ct?.id_uuid;
            oldInvoice.entityName = ct?.full_legal_name;
          }
        }
      } else {
        const oldRes = await pool.query(`
          SELECT i.*, 
                 co.full_legal_name as co_name, 
                 ct.full_legal_name as ct_name
          FROM fiscal_billing_invoices i
          LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
          LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
          WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
        `, [id_uuid, ctx.tenantId]);
        if (oldRes.rows.length > 0) {
          oldInvoice = oldRes.rows[0];
          if (oldInvoice.associated_company_id) {
            oldInvoice.entityType = "companies";
            oldInvoice.entityId = oldInvoice.associated_company_id;
            oldInvoice.entityName = oldInvoice.co_name;
          } else if (oldInvoice.associated_contact_id) {
            oldInvoice.entityType = "contacts";
            oldInvoice.entityId = oldInvoice.associated_contact_id;
            oldInvoice.entityName = oldInvoice.ct_name;
          }
        }
      }

      // Delete the old files on disk to prevent orphans and immediately update the file context
      if (oldInvoice) {
        let isFinalized = false;
        try {
          const meta = typeof oldInvoice.metadata === 'string' ? JSON.parse(oldInvoice.metadata) : (oldInvoice.metadata || {});
          if (meta.is_finalized || oldInvoice.payment_status === 'paid') {
            isFinalized = true;
          }
        } catch (_) {}
        if (isFinalized) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Diese Rechnung ist final abgeschlossen und kann nicht mehr bearbeitet werden."
          });
        }
      }

      if (oldInvoice && oldInvoice.entityId) {
        try {
          const oldStoragePath = getEntityStoragePath(oldInvoice.entityType!, oldInvoice.entityId!, oldInvoice.entityName!, ctx.tenantId);
          const oldCleanNum = oldInvoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
          
          const oldPdfPath = path.join(oldStoragePath, `rechnung_${oldCleanNum}.pdf`);
          const oldXmlPath = path.join(oldStoragePath, `zugferd_${oldCleanNum}.xml`);
          const oldSubPdfPath = path.join(oldStoragePath, "invoices", `invoice_${id_uuid}.pdf`);
          const oldSubXmlPath = path.join(oldStoragePath, "invoices", `zugferd_${id_uuid}.xml`);

          if (fs.existsSync(oldPdfPath)) fs.unlinkSync(oldPdfPath);
          if (fs.existsSync(oldXmlPath)) fs.unlinkSync(oldXmlPath);
          if (fs.existsSync(oldSubPdfPath)) fs.unlinkSync(oldSubPdfPath);
          if (fs.existsSync(oldSubXmlPath)) fs.unlinkSync(oldSubXmlPath);
          console.log(`[updateInvoice] Cleared old invoice files on disk for invoice: ${oldInvoice.invoice_number}`);
        } catch (err) {
          console.error("[updateInvoice] Error deleting old invoice files:", err);
        }
      }

      let finalDueDate = data.due_date;
      if (!finalDueDate && data.issue_date) {
        const days = parseInt(data.payment_term || "14", 10);
        if (!isNaN(days)) {
          const d = new Date(data.issue_date);
          d.setDate(d.getDate() + days);
          finalDueDate = d.toISOString().split('T')[0];
        } else {
          finalDueDate = data.issue_date;
        }
      }

      if (isUsingFallback) {
        const idx = fallbackStore.invoices.findIndex(i => i.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.invoices[idx] = { 
            ...fallbackStore.invoices[idx], 
            ...data, 
            due_date: finalDueDate || null,
            invoice_line_items_json: JSON.stringify(data.invoice_line_items),
            updated_at_utc: new Date().toISOString() 
          } as z.infer<typeof InvoiceFullSchema>;
          saveFallbackStore();
          
          await logAuditEvent({
            tenantId: ctx.tenantId,
            eventType: 'UPDATE',
            entityType: 'INVOICE',
            entityId: id_uuid,
            eventDetails: `Updated invoice: ${fallbackStore.invoices[idx].invoice_number}`,
            actorIdentity: ctx.session?.user?.email || 'unknown'
          });

          // Generate/update PDF & XML on disk
          if (fallbackStore.invoices[idx].payment_status !== 'draft') {
            await generateInvoiceFilesOnDisk(id_uuid, ctx.tenantId);
          }
        }
        return { success: true };
      }

      await pool.query(`
        UPDATE fiscal_billing_invoices
        SET associated_company_id = $1,
            associated_contact_id = $2,
            bank_account = $3,
            issue_date = $4,
            service_date = $5,
            due_date = $6,
            payment_term = $7,
            is_vat_inclusive = $8,
            total_net_amount = $9,
            total_vat_amount = $10,
            total_gross_amount = $11,
            vat_rate = $12,
            currency_code = $13,
            leitweg_id = $14,
            invoice_line_items_json = $15,
            raw_source_data = $16,
            payment_status = $17,
            invoice_number = $18,
            introductory_text = $19,
            closing_text = $20,
            metadata = $21,
            updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $22 AND (tenant_id = $23 OR tenant_id = '1')
      `, [
        data.associated_company_id, data.associated_contact_id, data.bank_account,
        data.issue_date, data.service_date, finalDueDate, data.payment_term, data.is_vat_inclusive,
        data.total_net_amount, data.total_vat_amount, data.total_gross_amount, data.vat_rate,
        data.currency_code, data.leitweg_id, JSON.stringify(data.invoice_line_items), data.raw_source_data,
        data.payment_status, data.invoice_number, data.introductory_text || '', data.closing_text || '', JSON.stringify(data.metadata || {}), id_uuid, ctx.tenantId
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'INVOICE',
        entityId: id_uuid,
        eventDetails: `Updated invoice: ${data.invoice_number}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      // Generate/update PDF & XML on disk
      if (data.payment_status !== 'draft') {
        await generateInvoiceFilesOnDisk(id_uuid, ctx.tenantId);
      }

      return { success: true };
      } catch (err: unknown) {
        console.error("Error updating invoice:", err);
        const errMsg = err instanceof Error ? err.stack || err.message : String(err);
        try {
          fs.appendFileSync("/server_errors.log", `${new Date().toISOString()} - updateInvoice error: ${errMsg}\n`);
        } catch (_) {}
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fehler beim Bearbeiten der Rechnung: ${err instanceof Error ? err.message : String(err)}`
        });
      }
    }),

  generateFiscalPdf: protectedProcedure
    .input(z.object({ invoiceId: z.string().uuid(), locale: z.string().optional() }))
    .output(z.object({ success: z.boolean(), path: z.string().optional(), xmlEmbedded: z.boolean().optional(), error: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      try {
        await generateInvoiceFilesOnDisk(input.invoiceId, ctx.tenantId, input.locale);
        return { success: true, xmlEmbedded: true };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { success: false, error: errorMsg };
      }
    }),

  deleteInvoice: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { id_uuid } = input;

      // 1. Fetch the target invoice
      let targetInvoice: Invoice | null = null;
      let allInvoices: Invoice[] = [];

      if (isUsingFallback) {
        targetInvoice = fallbackStore.invoices.find(i => i.id_uuid === id_uuid) || null;
        allInvoices = fallbackStore.invoices || [];
      } else {
        const targetRes = await pool.query(
          "SELECT * FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
          [id_uuid, ctx.tenantId]
        );
        if (targetRes.rows.length > 0) {
          targetInvoice = targetRes.rows[0] as Invoice;
        }

        const allRes = await pool.query(
          "SELECT * FROM fiscal_billing_invoices WHERE tenant_id = $1 OR tenant_id = '1'",
          [ctx.tenantId]
        );
        allInvoices = allRes.rows as Invoice[];
      }

      if (!targetInvoice) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rechnung nicht gefunden."
        });
      }

      // Check if invoice is finalized
      if (targetInvoice) {
        let isFinalized = false;
        try {
          const meta = typeof targetInvoice.metadata === 'string' ? JSON.parse(targetInvoice.metadata) : (targetInvoice.metadata || {});
          if (meta.is_finalized || targetInvoice.payment_status === 'paid') {
            isFinalized = true;
          }
        } catch (_) {}
        if (isFinalized) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Diese Rechnung ist final abgeschlossen und kann nicht gelöscht werden."
          });
        }
      }

      // 2. Perform the restriction check: only the latest invoice is deletable
      // Find the absolute latest invoice across the tenant's invoices by invoice_number comparison
      const isDraft = targetInvoice.payment_status === 'draft';
      if (!isDraft) {
        const nonDraftInvoices = allInvoices.filter(i => i.payment_status !== 'draft');
        const latestInvoice = nonDraftInvoices.reduce((max, current) => {
          if (!max) return current;
          return compareInvoiceNumbers(current.invoice_number, max.invoice_number) > 0 ? current : max;
        }, null as any);

        if (latestInvoice && latestInvoice.id_uuid !== targetInvoice.id_uuid) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Es kann nur die letzte Rechnung gelöscht werden. Die aktuelle letzte Rechnung ist ${latestInvoice.invoice_number}.`
          });
        }
      }

      // 3. Delete files from disk first
      let entityType: string | null = null;
      let entityId: string | null = null;
      let entityName: string | null = null;

      if (targetInvoice.associated_company_id) {
        entityType = "companies";
        entityId = targetInvoice.associated_company_id;
        if (isUsingFallback) {
          const co = fallbackStore.companies.find(c => c.id_uuid === entityId);
          entityName = co ? co.full_legal_name : null;
        } else {
          const coRes = await pool.query("SELECT full_legal_name FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1", [entityId]);
          entityName = coRes.rows[0]?.full_legal_name || null;
        }
      } else if (targetInvoice.associated_contact_id) {
        entityType = "contacts";
        entityId = targetInvoice.associated_contact_id;
        if (isUsingFallback) {
          const ct = fallbackStore.contacts.find(c => c.id_uuid === entityId);
          entityName = ct ? ct.full_legal_name : null;
        } else {
          const ctRes = await pool.query("SELECT full_legal_name FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1", [entityId]);
          entityName = ctRes.rows[0]?.full_legal_name || null;
        }
      }

      if (entityType && entityId && entityName) {
        try {
          const storagePath = getEntityStoragePath(entityType, entityId, entityName, ctx.tenantId);
          const cleanNum = targetInvoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
          
          const pdfPath = path.join(storagePath, `rechnung_${cleanNum}.pdf`);
          const xmlPath = path.join(storagePath, `zugferd_${cleanNum}.xml`);
          const subPdfPath = path.join(storagePath, "invoices", `invoice_${id_uuid}.pdf`);
          const subXmlPath = path.join(storagePath, "invoices", `zugferd_${id_uuid}.xml`);

          if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
          if (fs.existsSync(xmlPath)) fs.unlinkSync(xmlPath);
          if (fs.existsSync(subPdfPath)) fs.unlinkSync(subPdfPath);
          if (fs.existsSync(subXmlPath)) fs.unlinkSync(subXmlPath);
          console.log(`[deleteInvoice] Cleared files on disk for invoice: ${targetInvoice.invoice_number}`);
        } catch (err) {
          console.error("[deleteInvoice] Error deleting invoice files from disk:", err);
        }
      }

      // 4. Decrement the invoice seq number in myCompany (if is deleting the latest invoice)
      if (isUsingFallback) {
        if (!isDraft && fallbackStore.myCompany && fallbackStore.myCompany.invoice_number_next_seq && fallbackStore.myCompany.invoice_number_next_seq > 1) {
          fallbackStore.myCompany.invoice_number_next_seq -= 1;
        }
        fallbackStore.invoices = fallbackStore.invoices.filter(i => i.id_uuid !== id_uuid);
        saveFallbackStore();
      } else {
        if (!isDraft) {
          await pool.query(
            "UPDATE core_registry_my_company SET invoice_number_next_seq = GREATEST(1, invoice_number_next_seq - 1) WHERE tenant_id = $1",
            [ctx.tenantId]
          );
        }
        await pool.query(
          "DELETE FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [id_uuid, ctx.tenantId]
        );
      }

      // 5. Post to audited system logs
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'INVOICE',
        entityId: id_uuid,
        eventDetails: `Deleted invoice: ${targetInvoice.invoice_number}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  finalizeInvoice: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      payment_date: z.string(),
      payment_method: z.string(),
      payment_amount: z.number()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const { id_uuid, payment_date, payment_method, payment_amount } = input;

      // 1. Fetch the target invoice
      let targetInvoice: Invoice | null = null;
      if (isUsingFallback) {
        targetInvoice = fallbackStore.invoices.find(i => i.id_uuid === id_uuid) || null;
      } else {
        const targetRes = await pool.query(
          "SELECT * FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
          [id_uuid, ctx.tenantId]
        );
        if (targetRes.rows.length > 0) {
          targetInvoice = targetRes.rows[0] as Invoice;
        }
      }

      if (!targetInvoice) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Rechnung nicht gefunden."
        });
      }

      // Check if already finalized
      let isFinalized = false;
      let existingMetadata: Record<string, unknown> = {};
      try {
        existingMetadata = typeof targetInvoice.metadata === 'string' 
          ? JSON.parse(targetInvoice.metadata) 
          : (targetInvoice.metadata as Record<string, unknown> || {});
      } catch (_) {}

      if (existingMetadata.is_finalized || targetInvoice.payment_status === 'paid') {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Diese Rechnung ist bereits final abgeschlossen."
        });
      }

      // 2. Prepare new metadata
      const newMetadata = {
        ...existingMetadata,
        is_finalized: true,
        finalized_at_utc: new Date().toISOString(),
        payment_date,
        payment_method,
        payment_amount
      };

      // 3. Update invoice in database
      if (isUsingFallback) {
        const idx = fallbackStore.invoices.findIndex(i => i.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.invoices[idx] = {
            ...fallbackStore.invoices[idx],
            payment_status: 'paid',
            metadata: newMetadata,
            updated_at_utc: new Date().toISOString()
          } as any;
          saveFallbackStore();
        }
      } else {
        await pool.query(`
          UPDATE fiscal_billing_invoices
          SET payment_status = 'paid',
              metadata = $1,
              updated_at_utc = CURRENT_TIMESTAMP
          WHERE id_uuid = $2 AND (tenant_id = $3 OR tenant_id = '1')
        `, [JSON.stringify(newMetadata), id_uuid, ctx.tenantId]);
      }

      // 4. Log audit log
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'INVOICE',
        entityId: id_uuid,
        eventDetails: `Rechnung ${targetInvoice.invoice_number} abgeschlossen. Zahlung erhalten am ${payment_date} via ${payment_method} über ${payment_amount} EUR.`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      // 5. Regenerate files on disk to reflect the update and ensure files exist
      await generateInvoiceFilesOnDisk(id_uuid, ctx.tenantId);

      const paidPayload: InvoicePaidPayload = {
        id_uuid,
        invoice_number: targetInvoice.invoice_number,
        payment_date,
        payment_method,
        payment_amount,
        total_gross_amount: targetInvoice.total_gross_amount,
        total_net_amount: targetInvoice.total_net_amount,
        tax_amount: targetInvoice.total_vat_amount || 0,
        currency: targetInvoice.currency_code || 'EUR',
        associated_company_id: targetInvoice.associated_company_id || null,
        associated_contact_id: targetInvoice.associated_contact_id || null
      };

      workflowEventBus.emitEvent(ctx.tenantId, 'invoice.paid', paidPayload);

      workflowEventBus.emitEvent(ctx.tenantId, 'invoice.finalized', { 
        id_uuid, 
        payment_date, 
        payment_method, 
        payment_amount, 
        invoice_number: targetInvoice.invoice_number, 
        total_gross_amount: targetInvoice.total_gross_amount, 
        associated_company_id: targetInvoice.associated_company_id, 
        associated_contact_id: targetInvoice.associated_contact_id 
      });

      return { success: true };
    })
});
