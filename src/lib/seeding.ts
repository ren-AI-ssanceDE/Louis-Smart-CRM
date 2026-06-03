import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { seedData } from "./seedData.js";
import { Company, Contact, Invoice, EmailTemplate, Signature, MyCompany, SmtpSettings, SeedInvoice } from "../types";

export async function runSeeding(pool: Pool, tenantId: string = '1') {
  console.log(`[Seeding] Starting seeding process for tenant: ${tenantId}...`);

  try {
    // 1. My Company
    const myCompanyCheck = await pool.query("SELECT COUNT(*) FROM core_registry_my_company WHERE tenant_id = $1", [tenantId]);
    if (parseInt(myCompanyCheck.rows[0].count) === 0) {
      console.log(`[Seeding] Inserting "My Company" for tenant: ${tenantId}`);
      await pool.query(`
        INSERT INTO core_registry_my_company (
          id_uuid, tenant_id, full_legal_name, tax_vat_id, responsible_person, 
          first_name, last_name, street, house_number, postal_code, city, country_code, 
          email_address, website, phone_number, iban, bic_swift, bank_name, leitweg_id, 
          vat_rate, currency_code, language, created_by_identity,
          invoice_number_prefix, invoice_number_year_fixed, invoice_number_next_seq, invoice_number_min_digits
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
        )
      `, [
        uuidv4(), tenantId, seedData.myCompany.full_legal_name, seedData.myCompany.tax_vat_id, 
        seedData.myCompany.responsible_person, seedData.myCompany.first_name, seedData.myCompany.last_name,
        seedData.myCompany.street, seedData.myCompany.house_number, seedData.myCompany.postal_code, 
        seedData.myCompany.city, seedData.myCompany.country_code, seedData.myCompany.email_address, 
        seedData.myCompany.website, seedData.myCompany.phone_number, seedData.myCompany.iban, 
        seedData.myCompany.bic_swift, seedData.myCompany.bank_name || 'Cyberdyne Bundesbank', seedData.myCompany.leitweg_id, seedData.myCompany.vat_rate, 
        seedData.myCompany.currency_code, seedData.myCompany.language, 'system',
        seedData.myCompany.invoice_number_prefix, seedData.myCompany.invoice_number_year_fixed,
        seedData.myCompany.invoice_number_next_seq, seedData.myCompany.invoice_number_min_digits
      ]);
    }

    // 2. Companies (Only in non-production/dev environments)
    if (process.env.NODE_ENV !== "production") {
      for (const corp of seedData.companies) {
        const check = await pool.query(
          "SELECT COUNT(*) FROM core_registry_companies WHERE full_legal_name = $1 AND tenant_id = $2",
          [corp.full_legal_name, tenantId]
        );
        if (parseInt(check.rows[0].count) === 0) {
          console.log(`[Seeding] Inserting company: ${corp.full_legal_name} for tenant: ${tenantId}`);
          const id = uuidv4();
          await pool.query(`
            INSERT INTO core_registry_companies (
              id_uuid, tenant_id, full_legal_name, tax_vat_id, responsible_person, 
              street, house_number, city, postal_code, country_code, 
              email_address, website, iban, bic_swift, language,
              payment_term, price_list, created_by_identity, ai_confidence_score, is_verified_by_human
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
            )
          `, [
            id, tenantId, corp.full_legal_name, corp.tax_vat_id, corp.responsible_person,
            corp.street, corp.house_number, corp.city, corp.postal_code, corp.country_code,
            corp.email_address, corp.website, corp.iban, corp.bic_swift, corp.language,
            corp.payment_term, corp.price_list, 'system', corp.ai_confidence_score, corp.is_verified_by_human
          ]);
        }
      }

      // 3. Contacts (Need to map to companies, only in non-production)
      for (const contact of seedData.contacts) {
        const check = await pool.query(
          "SELECT COUNT(*) FROM core_registry_contacts WHERE first_name = $1 AND last_name = $2 AND tenant_id = $3",
          [contact.first_name, contact.last_name, tenantId]
        );
        if (parseInt(check.rows[0].count) === 0) {
          console.log(`[Seeding] Inserting contact: ${contact.first_name} ${contact.last_name} for tenant: ${tenantId}`);
          // Find company ID
          const companyRes = await pool.query(
            "SELECT id_uuid FROM core_registry_companies WHERE full_legal_name = $1 AND tenant_id = $2", 
            [contact.company_name, tenantId]
          );
          const companyId = companyRes.rows[0]?.id_uuid;

          await pool.query(`
            INSERT INTO core_registry_contacts (
              id_uuid, tenant_id, full_legal_name, first_name, last_name, 
              salutation, gender_identity, email_address, phone_number, 
              language, associated_company_id, created_by_identity, is_verified_by_human
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            )
          `, [
            uuidv4(), tenantId, `${contact.first_name} ${contact.last_name}`, 
            contact.first_name, contact.last_name, contact.salutation, 
            contact.gender_identity, contact.email_address, contact.phone_number, 
            'de', companyId, 'system', true
          ]);
        }
      }

      // 4. Invoices (Only in non-production)
      for (const inv of seedData.invoices as unknown as SeedInvoice[]) {
        const check = await pool.query(
          "SELECT COUNT(*) FROM fiscal_billing_invoices WHERE invoice_number = $1 AND tenant_id = $2",
          [inv.invoice_number, tenantId]
        );
        if (parseInt(check.rows[0].count) === 0) {
          console.log(`[Seeding] Inserting invoice: ${inv.invoice_number} for tenant: ${tenantId}`);
          const companyRes = await pool.query(
            "SELECT id_uuid FROM core_registry_companies WHERE full_legal_name = $1 AND tenant_id = $2", 
            [inv.company_name, tenantId]
          );
          const companyId = companyRes.rows[0]?.id_uuid;

          const lineItemsJson = JSON.stringify(inv.line_items || []);
          await pool.query(`
            INSERT INTO fiscal_billing_invoices (
              id_uuid, tenant_id, invoice_number, associated_company_id,
              total_gross_amount, total_net_amount, total_vat_amount,
              currency_code, issue_date, due_date, payment_status, invoice_line_items_json, created_at_utc
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP
            )
          `, [
            uuidv4(), tenantId, inv.invoice_number, companyId,
            inv.total_gross, inv.total_net, inv.total_vat,
            inv.currency_code, inv.issue_date_utc, inv.due_date_utc || null, inv.status, lineItemsJson
          ]);
        }
      }
    }

    // 5. Default Email Templates (Always seed standard "Vorlagen")
    const emailTemplatesCheck = await pool.query("SELECT COUNT(*) FROM sys_comms_email_templates WHERE tenant_id = $1 OR tenant_id = '1'", [tenantId]);
    if (parseInt(emailTemplatesCheck.rows[0].count) === 0) {
      console.log(`[Seeding] Inserting default email templates for tenant: ${tenantId}`);
      await pool.query(`
        INSERT INTO sys_comms_email_templates (
          id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content,
          created_by_identity, ai_confidence_score, is_verified_by_human
        ) VALUES 
        ('00000000-0000-4000-8000-000000000021', $1, 'Standard-Rechnungsvorlage', 'Rechnung {{invoice_number}} von {{my_company_name}}', '<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie Ihre Rechnung mit der Nummer <strong>{{invoice_number}}</strong> über den Bruttobetrag von <strong>{{total_gross}} {{currency}}</strong>.</p><p>Bitte überweisen Sie den Betrag bis zum <strong>{{due_date}}</strong> auf unser angegebenes Bankkonto.</p><p>Vielen Dank für die angenehme Zusammenarbeit!</p><p>Mit freundlichen Grüßen,<br>{{my_contact_person}}</p>', 'system', 1.0, true),
        ('00000000-0000-4000-8000-000000000022', $1, 'Freundliche Zahlungserinnerung', 'Zahlungserinnerung: Rechnung {{invoice_number}}', '<p>Sehr geehrte Damen und Herren,</p><p>sicherlich ist es im Trubel des Alltags untergegangen, aber wir konnten für die Rechnung <strong>{{invoice_number}}</strong> bisher noch keinen Zahlungseingang feststellen.</p><p>Wir möchten Sie daher höflich bitten, den Bruttobetrag von <strong>{{total_gross}} {{currency}}</strong> zeitnah anzuweisen.</p><p>Sollte sich die Zahlung mit dieser E-Mail überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p><p>Mit freundlichen Grüßen,<br>{{my_contact_person}}</p>', 'system', 1.0, true)
      `, [tenantId]);
    }

    // 6. Default Signatures
    const signaturesCheck = await pool.query("SELECT COUNT(*) FROM sys_comms_signatures WHERE tenant_id = $1 OR tenant_id = '1'", [tenantId]);
    if (parseInt(signaturesCheck.rows[0].count) === 0) {
      console.log(`[Seeding] Inserting default signatures for tenant: ${tenantId}`);
      await pool.query(`
        INSERT INTO sys_comms_signatures (
          id_uuid, tenant_id, signature_name_text, signature_body_content, is_default_signature,
          created_by_identity, ai_confidence_score, is_verified_by_human
        ) VALUES 
        ('00000000-0000-4000-8000-000000000031', $1, 'Standard-Signatur', '<p>—<br><strong>Louis Smart CRM Service</strong><br>Telefon: +49 30 1234567<br>E-Mail: info@louis-crm.de<br>Web: <a href="https://louis-crm.de" target="_blank">www.louis-crm.de</a></p>', true, 'system', 1.0, true)
      `, [tenantId]);
    }

    // 7. Default Invoice Text Templates
    const textTemplatesCheck = await pool.query("SELECT COUNT(*) FROM sys_comms_invoice_text_templates WHERE tenant_id = $1 OR tenant_id = '1'", [tenantId]);
    if (parseInt(textTemplatesCheck.rows[0].count) === 0) {
      console.log(`[Seeding] Inserting default invoice text templates for tenant: ${tenantId}`);
      await pool.query(`
        INSERT INTO sys_comms_invoice_text_templates (
          id_uuid, tenant_id, template_name_text, template_type_code, template_body_content,
          created_by_identity, ai_confidence_score, is_verified_by_human
        ) VALUES 
        ('00000000-0000-4000-8000-000000000041', $1, 'Standard-Einleitung', 'introductory', 'Sehr geehrte Damen und Herren,\n\nhiermit erlauben wir uns, Ihnen die folgenden Leistungen für das abgeschlossene Projekt in Rechnung zu stellen.', 'system', 1.0, true),
        ('00000000-0000-4000-8000-000000000042', $1, 'Standard-Abschluss', 'closing', 'Wir bedanken uns herzlich für Ihr Vertrauen und die partnerschaf\u0323tliche Zusammenarbeit! Bei Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.', 'system', 1.0, true)
      `, [tenantId]);
    }

    // 8. Default Invoice Item Templates
    const itemTemplatesCheck = await pool.query("SELECT COUNT(*) FROM sys_comms_invoice_item_templates WHERE tenant_id = $1 OR tenant_id = '1'", [tenantId]);
    if (parseInt(itemTemplatesCheck.rows[0].count) === 0) {
      console.log(`[Seeding] Inserting default invoice item templates for tenant: ${tenantId}`);
      await pool.query(`
        INSERT INTO sys_comms_invoice_item_templates (
          id_uuid, tenant_id, template_name_text, description, quantity, unit_price, vat_rate, unit_code,
          created_by_identity, ai_confidence_score, is_verified_by_human
        ) VALUES 
        ('00000000-0000-4000-8000-000000000051', $1, 'Softwareentwicklung (Senior)', 'Dienstleistungen im Bereich Softwareentwicklung durch einen erfahrenen Senior Consultant.', 1.0, 120.00, 19.00, 'HUR', 'system', 1.0, true),
        ('00000000-0000-4000-8000-000000000052', $1, 'Projektmanagement Pauschale', 'Monatliche Pauschale für Projektleitung, Koordination und Qualitätssicherung.', 1.0, 1500.00, 19.00, 'MON', 'system', 1.0, true)
      `, [tenantId]);
    }

    console.log("[Seeding] Complete.");
  } catch (error) {
    console.error("[Seeding] Error during seeding:", error);
  }
}

interface FallbackDatabaseStore {
  companies: Company[];
  contacts: Contact[];
  invoices: Invoice[];
  smtpSettings: SmtpSettings | null;
  myCompany: MyCompany | null;
  emailTemplates: EmailTemplate[];
  signatures: Signature[];
}

export function runInProcessSeedingFallback(store: FallbackDatabaseStore) {
  console.log("[Seeding Fallback] Checking if in-memory store needs seeding...");
  if (store.companies.length > 0) return;

  const companyId1 = uuidv4();
  const companyId2 = uuidv4();
  const contactId1 = uuidv4();
  const contactId2 = uuidv4();

  // 1. My Company
  store.myCompany = {
    ...seedData.myCompany,
    id_uuid: uuidv4(),
    created_at_utc: new Date().toISOString(),
    updated_at_utc: new Date().toISOString(),
    created_by_identity: 'system',
    ai_confidence_score: 1.0,
    is_verified_by_human: true
  };

  // 2. Companies
  store.companies.push(
    { 
      ...seedData.companies[0],
      id_uuid: companyId1, 
      tenant_id: '1',
      created_at_utc: new Date().toISOString(), 
      updated_at_utc: new Date().toISOString(), 
      created_by_identity: 'system', 
      labels: [],
    },
    { 
      ...seedData.companies[1],
      id_uuid: companyId2, 
      tenant_id: '1',
      created_at_utc: new Date().toISOString(), 
      updated_at_utc: new Date().toISOString(), 
      created_by_identity: 'system', 
      labels: []
    }
  );

  // 3. Contacts
  store.contacts.push(
    { 
      ...seedData.contacts[0],
      id_uuid: contactId1, 
      tenant_id: '1',
      full_legal_name: `${seedData.contacts[0].first_name} ${seedData.contacts[0].last_name}`,
      associated_company_id: companyId1, 
      company_name: seedData.companies[0].full_legal_name, 
      created_at_utc: new Date().toISOString(), 
      updated_at_utc: new Date().toISOString(), 
      created_by_identity: 'system', 
      is_verified_by_human: true, 
      language: 'de', 
      labels: [],
    },
    { 
      ...seedData.contacts[1],
      id_uuid: contactId2, 
      tenant_id: '1',
      full_legal_name: `${seedData.contacts[1].first_name} ${seedData.contacts[1].last_name}`,
      associated_company_id: companyId2, 
      company_name: seedData.companies[1].full_legal_name, 
      created_at_utc: new Date().toISOString(), 
      updated_at_utc: new Date().toISOString(), 
      created_by_identity: 'system', 
      is_verified_by_human: true, 
      language: 'en', 
      labels: [],
    }
  );

  // 4. Invoices
  store.invoices.push(
    { 
      id_uuid: uuidv4(), 
      tenant_id: '1',
      invoice_number: seedData.invoices[0].invoice_number, 
      total_gross_amount: seedData.invoices[0].total_gross, 
      total_net_amount: seedData.invoices[0].total_net, 
      total_vat_amount: seedData.invoices[0].total_vat, 
      vat_rate: 19, 
      is_vat_inclusive: false, 
      currency_code: seedData.invoices[0].currency_code, 
      payment_status: seedData.invoices[0].status as 'pending' | 'paid' | 'overdue' | 'draft', 
      company_name: seedData.invoices[0].company_name, 
      issue_date: seedData.invoices[0].issue_date_utc, 
      created_at_utc: new Date().toISOString(), 
      updated_at_utc: new Date().toISOString(), 
      invoice_line_items_json: '[]', 
      invoice_line_items: [],
      created_by_identity: 'system',
      ai_confidence_score: 1.0,
      is_verified_by_human: true
    }
  );

  console.log("[Seeding Fallback] In-memory seeding complete.");
}
