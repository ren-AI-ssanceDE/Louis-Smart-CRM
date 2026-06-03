import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, logAuditEvent, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { getEntityStoragePath, generateEmbedding } from "../storage.js";
import { ContactSchema, ContactFullSchema } from "../../lib/schemas.js";

export const contactsRouter = router({
  getContacts: protectedProcedure
    .output(z.array(ContactFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return fallbackStore.contacts.map(c => {
          const comp = fallbackStore.companies.find(co => co.id_uuid === c.associated_company_id);
          return {
            ...c,
            company_name: comp ? comp.full_legal_name : undefined
          };
        });
      }
      const res = await pool.query(`
        SELECT c.*, co.full_legal_name as company_name 
        FROM core_registry_contacts c
        LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
        WHERE c.tenant_id = $1 OR c.tenant_id = '1'
        ORDER BY c.created_at_utc DESC
      `, [ctx.tenantId]);
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

  createContact: protectedProcedure
    .input(ContactSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      const id = uuidv4();
      const fullLegalName = `${input.first_name || ''} ${input.last_name}`.trim();
      const embedding = await generateEmbedding(`${fullLegalName} ${input.email_address} ${input.city} ${input.responsible_person}`, ctx.tenantId);
      
      if (isUsingFallback) {
        const newContact: z.infer<typeof ContactFullSchema> = { 
          ...input, 
          id_uuid: id, 
          full_legal_name: fullLegalName, 
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString(),
          ai_confidence_score: 1.0,
          is_verified_by_human: true,
          created_by_identity: 'human'
        };
        fallbackStore.contacts.unshift(newContact);
        saveFallbackStore();
        getEntityStoragePath("contacts", id, fullLegalName, ctx.tenantId);
        return { id_uuid: id };
      }
      await pool.query(`
        INSERT INTO core_registry_contacts (
          id_uuid, tenant_id, first_name, last_name, full_legal_name, responsible_person, salutation, gender_identity, 
          date_of_birth, region, street, house_number, postal_code, city, 
          email_address, email_2, website, phone_number, fax_number, mobile_number, 
          language, labels_json, opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone,
          tax_vat_id, iban, bic_swift, 
          payment_term, price_list, custom_documents, associated_company_id, 
          created_by_identity, ai_confidence_score, is_verified_by_human, embedding
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
      `, [
        id, ctx.tenantId, input.first_name, input.last_name, fullLegalName, input.responsible_person, input.salutation, input.gender_identity,
        input.date_of_birth, input.region, input.street, input.house_number, input.postal_code, input.city,
        input.email_address, input.email_2, input.website, input.phone_number, input.fax_number, input.mobile_number,
        input.language, JSON.stringify(input.labels), input.opt_in_marketing, input.opt_in_social_media,
        input.opt_in_direct_message, input.opt_in_sms, input.opt_in_phone,
        input.tax_vat_id, input.iban, input.bic_swift, input.payment_term, input.price_list, input.custom_documents,
        input.associated_company_id, 'human', 1.0, true,
        embedding ? `[${embedding.join(',')}]` : null
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'CREATE',
        entityType: 'CONTACT',
        entityId: id,
        eventDetails: `Created contact: ${fullLegalName}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      getEntityStoragePath("contacts", id, fullLegalName, ctx.tenantId);
      return { id_uuid: id };
    }),

  updateContact: protectedProcedure
    .input(ContactSchema.extend({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      const { id_uuid, ...data } = input;
      const fullLegalName = `${data.first_name || ''} ${data.last_name}`.trim();
      const embedding = await generateEmbedding(`${fullLegalName} ${data.email_address} ${data.city} ${data.responsible_person}`, ctx.tenantId);
      
      if (isUsingFallback) {
        const idx = fallbackStore.contacts.findIndex(c => c.id_uuid === id_uuid);
        if (idx !== -1) {
          fallbackStore.contacts[idx] = { 
            ...fallbackStore.contacts[idx], 
            ...data, 
            full_legal_name: fullLegalName, 
            updated_at_utc: new Date().toISOString(),
            is_verified_by_human: true,
            created_by_identity: 'human'
          };
          saveFallbackStore();
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE core_registry_contacts 
        SET first_name = $1, last_name = $2, full_legal_name = $3, responsible_person = $4, salutation = $5, 
            gender_identity = $6, date_of_birth = $7, region = $8, street = $9, 
            house_number = $10, postal_code = $11, city = $12, email_address = $13, 
            email_2 = $14, website = $15, phone_number = $16, fax_number = $17, 
            mobile_number = $18, language = $19, labels_json = $20, opt_in_marketing = $21, 
            opt_in_social_media = $22, opt_in_direct_message = $23, opt_in_sms = $24, opt_in_phone = $25,
            tax_vat_id = $26, iban = $27, bic_swift = $28, payment_term = $29, 
            price_list = $30, custom_documents = $31, associated_company_id = $32, 
            updated_at_utc = CURRENT_TIMESTAMP, embedding = $33,
            is_verified_by_human = TRUE, created_by_identity = 'human'
        WHERE id_uuid = $34 AND (tenant_id = $35 OR tenant_id = '1')
      `, [
        data.first_name, data.last_name, fullLegalName, data.responsible_person, data.salutation, data.gender_identity,
        data.date_of_birth, data.region, data.street, data.house_number, data.postal_code, data.city,
        data.email_address, data.email_2, data.website, data.phone_number, data.fax_number, data.mobile_number,
        data.language, JSON.stringify(data.labels), data.opt_in_marketing, 
        data.opt_in_social_media, data.opt_in_direct_message, data.opt_in_sms, data.opt_in_phone,
        data.tax_vat_id, data.iban, data.bic_swift, data.payment_term, data.price_list, data.custom_documents,
        data.associated_company_id, 
        embedding ? `[${embedding.join(',')}]` : null,
        id_uuid, ctx.tenantId
      ]);

      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'CONTACT',
        entityId: id_uuid,
        eventDetails: `Updated contact: ${fullLegalName}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });

      return { success: true };
    }),

  importContacts: protectedProcedure
    .input(z.array(ContactSchema))
    .output(z.object({ importedCount: z.number(), updatedCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      input = cleanLigatureHacksFromValue(input);
      let importedCount = 0;
      let updatedCount = 0;
      for (const rawItem of input) {
        // Map any undefined values to null for safe pg parameters alignment
        const item: any = { ...rawItem };
        for (const key of Object.keys(item)) {
          if (item[key] === undefined) {
            item[key] = null;
          }
        }
        // Ensure imported entities are marked as verified by human and not AI-generated drafts
        item.is_verified_by_human = true;
        item.created_by_identity = 'human';

        let id = item.id_uuid || uuidv4();
        const fullLegalName = `${item.first_name || ''} ${item.last_name || ''}`.trim();
        const embedding = await generateEmbedding(`${fullLegalName} ${item.email_address || ''} ${item.city || ''} ${item.responsible_person || ''}`, ctx.tenantId);
        
        if (isUsingFallback) {
          const idx = fallbackStore.contacts.findIndex(c => c.id_uuid === id);
          if (idx !== -1) {
            fallbackStore.contacts[idx] = {
              ...fallbackStore.contacts[idx],
              ...item,
              id_uuid: id,
              full_legal_name: fullLegalName,
              updated_at_utc: new Date().toISOString()
            };
            updatedCount++;
          } else {
            const newContact = {
              ...item,
              id_uuid: id,
              full_legal_name: fullLegalName,
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString(),
              ai_confidence_score: item.ai_confidence_score ?? 1.0,
              is_verified_by_human: true
            };
            fallbackStore.contacts.unshift(newContact);
            importedCount++;
          }
          saveFallbackStore();
          getEntityStoragePath("contacts", id, fullLegalName, ctx.tenantId);
          continue;
        }

        const checkRes = await pool.query("SELECT id_uuid, tenant_id FROM core_registry_contacts WHERE id_uuid = $1", [id]);
        if (checkRes.rows.length > 0) {
          await pool.query(`
            UPDATE core_registry_contacts 
            SET first_name = $1, last_name = $2, full_legal_name = $3, responsible_person = $4, salutation = $5, gender_identity = $6, 
                date_of_birth = $7, region = $8, street = $9, house_number = $10, postal_code = $11, city = $12, 
                email_address = $13, email_2 = $14, website = $15, phone_number = $16, fax_number = $17, mobile_number = $18, 
                language = $19, labels_json = $20, opt_in_marketing = $21, opt_in_social_media = $22, opt_in_direct_message = $23, opt_in_sms = $24, opt_in_phone = $25,
                tax_vat_id = $26, iban = $27, bic_swift = $28, 
                payment_term = $29, price_list = $30, custom_documents = $31, associated_company_id = $32, 
                updated_at_utc = CURRENT_TIMESTAMP, embedding = $33,
                is_verified_by_human = true, created_by_identity = 'human',
                tenant_id = $34
            WHERE id_uuid = $35
          `, [
            item.first_name, item.last_name, fullLegalName, item.responsible_person, item.salutation, item.gender_identity,
            item.date_of_birth, item.region, item.street, item.house_number, item.postal_code, item.city,
            item.email_address, item.email_2, item.website, item.phone_number, item.fax_number, item.mobile_number,
            item.language, JSON.stringify(item.labels || []), item.opt_in_marketing, item.opt_in_social_media,
            item.opt_in_direct_message, item.opt_in_sms, item.opt_in_phone,
            item.tax_vat_id, item.iban, item.bic_swift, item.payment_term, item.price_list, item.custom_documents,
            item.associated_company_id,
            embedding ? `[${embedding.join(',')}]` : null,
            ctx.tenantId, id
          ]);
          updatedCount++;
        } else {
          await pool.query(`
            INSERT INTO core_registry_contacts (
              id_uuid, tenant_id, first_name, last_name, full_legal_name, responsible_person, salutation, gender_identity, 
              date_of_birth, region, street, house_number, postal_code, city, 
              email_address, email_2, website, phone_number, fax_number, mobile_number, 
              language, labels_json, opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone,
              tax_vat_id, iban, bic_swift, 
              payment_term, price_list, custom_documents, associated_company_id, 
              created_by_identity, ai_confidence_score, is_verified_by_human, embedding
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
          `, [
            id, ctx.tenantId, item.first_name, item.last_name, fullLegalName, item.responsible_person, item.salutation, item.gender_identity,
            item.date_of_birth, item.region, item.street, item.house_number, item.postal_code, item.city,
            item.email_address, item.email_2, item.website, item.phone_number, item.fax_number, item.mobile_number,
            item.language || 'de', JSON.stringify(item.labels || []), item.opt_in_marketing || false, item.opt_in_social_media || false,
            item.opt_in_direct_message || false, item.opt_in_sms || false, item.opt_in_phone || false,
            item.tax_vat_id, item.iban, item.bic_swift, item.payment_term, item.price_list, item.custom_documents,
            item.associated_company_id, 'human',
            item.ai_confidence_score ?? 1.0, true,
            embedding ? `[${embedding.join(',')}]` : null
          ]);
          importedCount++;
        }

        await logAuditEvent({
          tenantId: ctx.tenantId,
          eventType: 'CREATE',
          entityType: 'CONTACT',
          entityId: id,
          eventDetails: `Imported/Upserted contact via mass import: ${fullLegalName}`,
          actorIdentity: ctx.session?.user?.email || 'admin'
        });

        getEntityStoragePath("contacts", id, fullLegalName, ctx.tenantId);
      }
      return { importedCount, updatedCount };
    }),

  deleteContact: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.contacts = fallbackStore.contacts.filter(c => c.id_uuid !== input.id_uuid);
        saveFallbackStore();
        return { success: true };
      }
      await pool.query("UPDATE fiscal_billing_invoices SET associated_contact_id = NULL WHERE associated_contact_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await pool.query("UPDATE sys_louis_ai_knowledge_metadata SET associated_contact_id = NULL WHERE associated_contact_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await pool.query("DELETE FROM core_registry_contacts WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.id_uuid, ctx.tenantId]);
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'DELETE',
        entityType: 'CONTACT',
        entityId: input.id_uuid,
        eventDetails: `Deleted contact: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });
      return { success: true };
    }),

  verifyContact: protectedProcedure
    .input(z.object({ id_uuid: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        const idx = fallbackStore.contacts.findIndex(c => c.id_uuid === input.id_uuid);
        if (idx !== -1) {
          fallbackStore.contacts[idx] = { 
            ...fallbackStore.contacts[idx], 
            is_verified_by_human: true,
            updated_at_utc: new Date().toISOString() 
          };
          saveFallbackStore();
        }
        return { success: true };
      }
      await pool.query(`
        UPDATE core_registry_contacts 
        SET is_verified_by_human = TRUE, updated_at_utc = CURRENT_TIMESTAMP
        WHERE id_uuid = $1 AND tenant_id = $2
      `, [input.id_uuid, ctx.tenantId]);
      
      await logAuditEvent({
        tenantId: ctx.tenantId,
        eventType: 'UPDATE',
        entityType: 'CONTACT',
        entityId: input.id_uuid,
        eventDetails: `Verified/Approved contact draft: ${input.id_uuid}`,
        actorIdentity: ctx.session?.user?.email || 'unknown'
      });
      return { success: true };
    })
});
