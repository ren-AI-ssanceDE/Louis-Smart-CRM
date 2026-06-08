import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, logAuditEvent, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { getEntityStoragePath, generateEmbedding } from "../storage.js";
import { CompanySchema, CompanyFullSchema } from "../../lib/schemas.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { CompanyUpdatedPayload } from "../../types.js";

export const companiesRouter = router({
  getCompanies: protectedProcedure
    .output(z.array(CompanyFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) return fallbackStore.companies;
      const res = await pool.query("SELECT * FROM core_registry_companies WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC", [ctx.tenantId]);
      return res.rows.map(row => {
        const r = cleanDbRow(row);
        let lbls = [];
        if (r.labels_json) {
          lbls = typeof r.labels_json === 'string'
            ? JSON.parse(r.labels_json)
            : r.labels_json;
        }
        return {
          ...r,
          labels: lbls,
        };
      });
    }),

  createCompany: protectedProcedure
    .input(CompanySchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      const id = uuidv4();
      const embedding = await generateEmbedding(`${input.full_legal_name} ${input.street} ${input.city} ${input.responsible_person}`, ctx.tenantId);
      
      if (isUsingFallback) {
        const newComp: z.infer<typeof CompanyFullSchema> = { 
          ...input, 
          id_uuid: id, 
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
          ai_confidence_score: 1.0,
          is_verified_by_human: true,
          created_by_identity: 'human'
        };
        fallbackStore.companies.unshift(newComp);
        saveFallbackStore();
        getEntityStoragePath("companies", id, input.full_legal_name, ctx.tenantId);
        workflowEventBus.emitEvent(ctx.tenantId, 'company.created', { id_uuid: id, ...input });
        return { id_uuid: id };
      }
      await pool.query(`
        INSERT INTO core_registry_companies (
          id_uuid, tenant_id, full_legal_name, short_code, tax_vat_id, tax_number, responsible_person, street, house_number,
          city, postal_code, country_code, email_address, email_2, website, 
          phone_number, mobile_number, fax_number, iban, bic_swift, leitweg_id, 
          payment_term, price_list, custom_documents, language, labels_json,
          opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone, 
          created_by_identity, ai_confidence_score, is_verified_by_human, embedding
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35)
      `, [
        id, ctx.tenantId, input.full_legal_name, input.short_code, input.tax_vat_id, input.tax_number, input.responsible_person, 
        input.street, input.house_number, input.city, input.postal_code, 
        input.country_code, input.email_address, input.email_2, input.website,
        input.phone_number, input.mobile_number, input.fax_number, input.iban,
        input.bic_swift, input.leitweg_id, input.payment_term, input.price_list,
        input.custom_documents, input.language, JSON.stringify(input.labels || []),
        input.opt_in_marketing, input.opt_in_social_media, input.opt_in_direct_message,
        input.opt_in_sms, input.opt_in_phone, 'human',
        1.0, true, 
        embedding ? `[${embedding.join(',')}]` : null
      ]);
      
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'COMPANY',
        entityId: id,
        eventDetails: `Created company: ${input.full_legal_name}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      getEntityStoragePath("companies", id, input.full_legal_name, ctx.tenantId);
      workflowEventBus.emitEvent(ctx.tenantId, 'company.created', { id_uuid: id, ...input });
      return { id_uuid: id };
    }),

  updateCompany: protectedProcedure
    .input(CompanySchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      const { id_uuid, ...data } = input;
      const embedding = await generateEmbedding(`${data.full_legal_name} ${data.street} ${data.city} ${data.responsible_person}`, ctx.tenantId);
      
      const updatedCompanyPayload: CompanyUpdatedPayload = {
        id_uuid,
        full_legal_name: data.full_legal_name,
        short_code: data.short_code || null,
        tax_vat_id: data.tax_vat_id || null,
        city: data.city || null,
        email_address: data.email_address || null,
        responsible_person: data.responsible_person || null,
        labels: Array.isArray(data.labels) ? data.labels : []
      };

      let wasDraft = false;
      if (isUsingFallback) {
        const found = fallbackStore.companies.find(c => c.id_uuid === id_uuid);
        if (found && found.is_verified_by_human === false) {
          wasDraft = true;
        }
      } else {
        const checkRes = await pool.query(
          "SELECT is_verified_by_human FROM core_registry_companies WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [id_uuid, ctx.tenantId]
        );
        if (checkRes.rows.length > 0 && checkRes.rows[0].is_verified_by_human === false) {
          wasDraft = true;
        }
      }

      if (isUsingFallback) {
        const idx = fallbackStore.companies.findIndex(c => c.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.companies[idx] = { 
            ...fallbackStore.companies[idx], 
            ...data, 
            updated_at_utc: new Date().toISOString(),
            is_verified_by_human: true,
            created_by_identity: 'human'
          };
          saveFallbackStore();
        }
        
        if (wasDraft) {
          const rowData = fallbackStore.companies.find(c => c.id_uuid === id_uuid);
          workflowEventBus.emitEvent(ctx.tenantId, 'company.created', {
            ...(rowData || {}),
            id_uuid,
            ...data,
            labels: data.labels || []
          });
        } else {
          workflowEventBus.emitEvent(ctx.tenantId, 'company.updated', updatedCompanyPayload);
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE core_registry_companies 
        SET full_legal_name = $1, short_code = $2, tax_vat_id = $3, tax_number = $4, responsible_person = $5, street = $6, house_number = $7,
            city = $8, postal_code = $9, country_code = $10, email_address = $11, email_2 = $12, website = $13,
            phone_number = $14, mobile_number = $15, fax_number = $16, iban = $17,
            bic_swift = $18, leitweg_id = $19, payment_term = $20, price_list = $21, 
            custom_documents = $22, language = $23, labels_json = $24, opt_in_marketing = $25,
            opt_in_social_media = $26, opt_in_direct_message = $27, opt_in_sms = $28, opt_in_phone = $29,
            updated_at_utc = CURRENT_TIMESTAMP, embedding = $30,
            is_verified_by_human = TRUE, created_by_identity = 'human'
        WHERE id_uuid = $31 AND (tenant_id = $32 OR tenant_id = '1')
      `, [
        data.full_legal_name, data.short_code, data.tax_vat_id, data.tax_number, data.responsible_person, data.street, data.house_number,
        data.city, data.postal_code, data.country_code, data.email_address, data.email_2, data.website,
        data.phone_number, data.mobile_number, data.fax_number, data.iban,
        data.bic_swift, data.leitweg_id, data.payment_term, data.price_list,
        data.custom_documents, data.language, JSON.stringify(data.labels || []),
        data.opt_in_marketing, data.opt_in_social_media, data.opt_in_direct_message,
        data.opt_in_sms, data.opt_in_phone, 
        embedding ? `[${embedding.join(',')}]` : null,
        id_uuid, ctx.tenantId
      ]);

      if (wasDraft) {
        const rowRes = await pool.query("SELECT * FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [id_uuid, ctx.tenantId]);
        const rowData = rowRes.rows[0];
        let labels = [];
        if (rowData) {
          if (typeof rowData.labels_json === "string") {
            try {
              labels = JSON.parse(rowData.labels_json);
            } catch (_) {}
          } else if (Array.isArray(rowData.labels_json)) {
            labels = rowData.labels_json;
          }
        }

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'UPDATE',
          entityType: 'COMPANY',
          entityId: id_uuid,
          eventDetails: `Verified/Approved company draft: ${data.full_legal_name}`,
          actorIdentity: ctx.session?.user?.email || 'unknown'
        });

        workflowEventBus.emitEvent(ctx.tenantId, 'company.created', {
          ...(rowData || {}),
          id_uuid,
          ...data,
          labels
        });
      } else {
        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'UPDATE',
          entityType: 'COMPANY',
          entityId: id_uuid,
          eventDetails: `Updated company: ${data.full_legal_name}`,
          actorIdentity: ctx.session?.user?.email || 'unknown'
        });

        workflowEventBus.emitEvent(ctx.tenantId, 'company.updated', updatedCompanyPayload);
      }

      return { success: true };
    }),

  importCompanies: protectedProcedure
    .input(z.array(CompanySchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        // Map any undefined values to null for safe pg parameters alignment
        const item = { ...rawItem };
        const typedItem = item as Record<string, unknown>;
        for (const key of Object.keys(typedItem)) {
          if (typedItem[key] === undefined) {
            typedItem[key] = null;
          }
        }
        // Ensure imported entities are marked as verified by human and not AI-generated drafts
        item.is_verified_by_human = true;
        item.created_by_identity = 'human';

        let id = item.id_uuid || uuidv4();
        const embedding = await generateEmbedding(`${item.full_legal_name} ${item.street || ''} ${item.city || ''} ${item.responsible_person || ''}`, ctx.tenantId);
        
        if (isUsingFallback) {
          const idx = fallbackStore.companies.findIndex(c => c.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.companies[idx] = {
              ...fallbackStore.companies[idx],
              ...item,
              id_uuid: id,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            const newComp = {
              ...item,
              id_uuid: id,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString(),
              ai_confidence_score: item.ai_confidence_score ?? 1.0,
              is_verified_by_human: true
            };
            fallbackStore.companies.unshift(newComp);
            importedCount++;
          }
          saveFallbackStore();
          getEntityStoragePath("companies", id, item.full_legal_name, ctx.tenantId);
          continue;
        }

        const checkRes = await pool.query("SELECT id_uuid, tenant_id FROM core_registry_companies WHERE id_uuid = $1", [id]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE core_registry_companies 
            SET full_legal_name = $1, tax_vat_id = $2, tax_number = $3, responsible_person = $4, street = $5, house_number = $6,
                city = $7, postal_code = $8, country_code = $9, email_address = $10, email_2 = $11, website = $12,
                phone_number = $13, mobile_number = $14, fax_number = $15, iban = $16,
                bic_swift = $17, leitweg_id = $18, payment_term = $19, price_list = $20, 
                custom_documents = $21, language = $22, labels_json = $23, opt_in_marketing = $24,
                opt_in_social_media = $25, opt_in_direct_message = $26, opt_in_sms = $27, opt_in_phone = $28,
                updated_at_utc = CURRENT_TIMESTAMP, embedding = $29,
                is_verified_by_human = true, created_by_identity = 'human',
                tenant_id = $30
            WHERE id_uuid = $31
          `, [
            item.full_legal_name, item.tax_vat_id, item.tax_number, item.responsible_person, item.street, item.house_number,
            item.city, item.postal_code, item.country_code, item.email_address, item.email_2, item.website,
            item.phone_number, item.mobile_number, item.fax_number, item.iban,
            item.bic_swift, item.leitweg_id, item.payment_term, item.price_list,
            item.custom_documents, item.language, JSON.stringify(item.labels || []),
            item.opt_in_marketing, item.opt_in_social_media, item.opt_in_direct_message,
            item.opt_in_sms, item.opt_in_phone, 
            embedding ? `[${embedding.join(',')}]` : null,
            ctx.tenantId, id
          ]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO core_registry_companies (
              id_uuid, tenant_id, full_legal_name, tax_vat_id, tax_number, responsible_person, street, house_number,
              city, postal_code, country_code, email_address, email_2, website, 
              phone_number, mobile_number, fax_number, iban, bic_swift, leitweg_id, 
              payment_term, price_list, custom_documents, language, labels_json,
              opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone, 
              created_by_identity, ai_confidence_score, is_verified_by_human, embedding
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
          `, [
            id, ctx.tenantId, item.full_legal_name, item.tax_vat_id, item.tax_number, item.responsible_person, 
            item.street, item.house_number, item.city, item.postal_code, 
            item.country_code, item.email_address, item.email_2, item.website,
            item.phone_number, item.mobile_number, item.fax_number, item.iban,
            item.bic_swift, item.leitweg_id, item.payment_term, item.price_list,
            item.custom_documents, item.language || 'de', JSON.stringify(item.labels || []),
            item.opt_in_marketing || false, item.opt_in_social_media || false, item.opt_in_direct_message || false,
            item.opt_in_sms || false, item.opt_in_phone || false, 'human',
            item.ai_confidence_score ?? 1.0, true, 
            embedding ? `[${embedding.join(',')}]` : null
          ]);
          importedCount++;
        }

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'CREATE',
          entityType: 'COMPANY',
          entityId: id,
          eventDetails: `Imported/Upserted company via mass import: ${item.full_legal_name}`,
          actorIdentity: ctx.session?.user?.email || 'admin'
        });

        getEntityStoragePath("companies", id, item.full_legal_name, ctx.tenantId);
      }
      return { importedCount, updatedCount };
    }),

  deleteCompany: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.companies = fallbackStore.companies.filter(c => c.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("UPDATE core_registry_contacts SET associated_company_id = NULL WHERE associated_company_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await pool.query("UPDATE fiscal_billing_invoices SET associated_company_id = NULL WHERE associated_company_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await pool.query("UPDATE sys_louis_ai_knowledge_metadata SET associated_company_id = NULL WHERE associated_company_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await pool.query("DELETE FROM core_registry_companies WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'COMPANY',
        entityId: input.id_uuid,
        eventDetails: `Deleted company: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });
      return { success: true };
    }),

  verifyCompany: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        const idx = fallbackStore.companies.findIndex(c => c.id_uuid === input.id_uuid);
        if (idx !== -1) {
          fallbackStore.companies[idx] = { 
            ...fallbackStore.companies[idx], 
            is_verified_by_human: true,
            updated_at_utc: new Date().toISOString() 
          };
          saveFallbackStore();
          // Emit company.created event to start automatic workflows
          workflowEventBus.emitEvent(ctx.tenantId, 'company.created', fallbackStore.companies[idx]);
        }
        return { success: true };
      }

      // Query company details before updating so we have the full payload (e.g. email_address, etc.) for workflow triggering
      const compRes = await pool.query("SELECT * FROM core_registry_companies WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, ctx.tenantId]);
      
      await pool.query(`
        UPDATE core_registry_companies 
        SET is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $1 AND tenant_id = $2
      `, [input.id_uuid, ctx.tenantId]);
      
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'COMPANY',
        entityId: input.id_uuid,
        eventDetails: `Verified/Approved company draft: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      if (compRes.rows.length > 0) {
        const row = compRes.rows[0];
        let labels = [];
        if (typeof row.labels_json === "string") {
          try {
            labels = JSON.parse(row.labels_json);
          } catch (_) {}
        } else if (Array.isArray(row.labels_json)) {
          labels = row.labels_json;
        }

        const companyPayload = {
          ...row,
          labels
        };
        // Emit company.created event to start automatic workflows
        workflowEventBus.emitEvent(ctx.tenantId, 'company.created', companyPayload);
      }

      return { success: true };
    })
});
