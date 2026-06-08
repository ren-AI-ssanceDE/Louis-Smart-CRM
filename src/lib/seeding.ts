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

    // 2. Companies, 3. Contacts, 4. Invoices - Seeding of mock/sample data completely disabled per user preference to keep installation clean


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
  if (store.myCompany) return;

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

  console.log("[Seeding Fallback] In-memory configuration seeding complete with zero sample data.");
}
