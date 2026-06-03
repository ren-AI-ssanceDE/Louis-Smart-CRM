import pg from "pg";
import fs from "fs";
import path from "path";
import os from "os";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { 
  CompanyFullSchema, 
  ContactFullSchema, 
  InvoiceFullSchema, 
  SmtpSettingsSchema, 
  SmtpSettingsFullSchema,
  MyCompanyFullSchema,
  EmailTemplateFullSchema,
  SignatureFullSchema,
  InvoiceTextTemplateFullSchema,
  InvoiceItemTemplateSchema,
  InvoiceItemTemplateFullSchema
} from "../lib/schemas.js";
import { runSeeding, runInProcessSeedingFallback } from "../lib/seeding.js";
import { 
  LouisAiConfig, 
  CustomWorkflow, 
  LouisAiKnowledgeMetadata, 
  LouisAiKnowledgeChunk, 
  TextGeneratorConfig, 
  WebSearchConfig,
  ChatMessage
} from "../types.js";
import * as dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || "5432"),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
});

// Patch the query methods to ensure that core_registry_my_company SELECT queries
// without an ORDER BY are normalized to prioritize the active tenant ($1) over fallback ('1')
const originalPoolQuery = pool.query.bind(pool);
pool.query = function (this: any, ...args: any[]): any {
  let queryText = args[0];
  if (typeof queryText === "string") {
    const normalized = queryText.replace(/\s+/g, " ").trim();
    if (
      normalized.includes("FROM core_registry_my_company") &&
      normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
      !normalized.includes("ORDER BY")
    ) {
      if (normalized.includes("LIMIT 1")) {
        queryText = queryText.replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
      } else {
        queryText = queryText + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
      }
      args[0] = queryText;
    }
  } else if (queryText && typeof queryText === "object" && typeof queryText.text === "string") {
    const normalized = queryText.text.replace(/\s+/g, " ").trim();
    if (
      normalized.includes("FROM core_registry_my_company") &&
      normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
      !normalized.includes("ORDER BY")
    ) {
      if (normalized.includes("LIMIT 1")) {
        queryText.text = queryText.text.replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
      } else {
        queryText.text = queryText.text + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
      }
    }
  }
  return originalPoolQuery(...args);
};

function patchClient(client: any) {
  if (client && !client._queryPatched) {
    client._queryPatched = true;
    const originalClientQuery = client.query.bind(client);
    client.query = function (this: any, ...cArgs: any[]): any {
      let queryText = cArgs[0];
      if (typeof queryText === "string") {
        const normalized = queryText.replace(/\s+/g, " ").trim();
        if (
          normalized.includes("FROM core_registry_my_company") &&
          normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
          !normalized.includes("ORDER BY")
        ) {
          if (normalized.includes("LIMIT 1")) {
            queryText = queryText.replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
          } else {
            queryText = queryText + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
          }
          cArgs[0] = queryText;
        }
      } else if (queryText && typeof queryText === "object" && typeof queryText.text === "string") {
        const normalized = queryText.text.replace(/\s+/g, " ").trim();
        if (
          normalized.includes("FROM core_registry_my_company") &&
          normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
          !normalized.includes("ORDER BY")
        ) {
          if (normalized.includes("LIMIT 1")) {
            queryText.text = queryText.text.replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
          } else {
            queryText.text = queryText.text + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
          }
        }
      }
      return originalClientQuery(...cArgs);
    };
  }
}

const originalConnect = pool.connect.bind(pool);
pool.connect = function (this: any, ...args: any[]): any {
  const callback = args[0];
  if (typeof callback === "function") {
    return originalConnect((err: any, client: any, release: any) => {
      if (client) {
        patchClient(client);
      }
      callback(err, client, release);
    });
  } else {
    const promise = originalConnect();
    return promise.then((client: any) => {
      if (client) {
        patchClient(client);
      }
      return client;
    });
  }
} as any;

export let isUsingFallback = !(process.env.DATABASE_URL || process.env.PGHOST);

export interface BankDirectoryEntry {
  id_uuid: string;
  country_code: string;
  bank_code: string;
  bic: string | null;
  bank_name: string;
  city: string | null;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface SavedChatNote {
  id_uuid: string;
  content: string;
  created_at_utc: string;
  updated_at_utc?: string;
  entity_type?: 'user' | 'contact' | 'company' | string;
  entity_id?: string;
  is_rag_indexed?: boolean;
}

export interface LouisAiUserMemory {
  id_uuid: string;
  tenant_id: string;
  user_id: string;
  response_preferences_text: string;
  frequently_used_tools_json: { tool: string; count: number }[];
  chat_notes_json: SavedChatNote[];
  created_at_utc: string;
  updated_at_utc: string;
}

export interface DatabaseStore {
  companies: z.infer<typeof CompanyFullSchema>[];
  contacts: z.infer<typeof ContactFullSchema>[];
  invoices: z.infer<typeof InvoiceFullSchema>[];
  smtpSettings: z.infer<typeof SmtpSettingsSchema> | null;
  myCompany: z.infer<typeof MyCompanyFullSchema> | null;
  auditLogs?: {
    id_uuid: string;
    tenant_id: string;
    event_type: string;
    entity_type: string;
    entity_id: string | null;
    event_details: string | null;
    actor_identity: string;
    created_at_utc: string;
    updated_at_utc: string;
  }[];
  emailTemplates: z.infer<typeof EmailTemplateFullSchema>[];
  signatures: z.infer<typeof SignatureFullSchema>[];
  invoiceTextTemplates: z.infer<typeof InvoiceTextTemplateFullSchema>[];
  invoiceItemTemplates?: z.infer<typeof InvoiceItemTemplateFullSchema>[];
  bankDirectory?: BankDirectoryEntry[];
  louisAiConfig?: LouisAiConfig[];
  customWorkflows?: CustomWorkflow[];
  louisAiSessions?: {
    id_uuid: string;
    tenant_id: string;
    session_title: string;
    conversation_history_json: ChatMessage[];
    short_term_summary_text?: string;
    created_at_utc: string; // strict stamp
    updated_at_utc: string; // strict stamp
  }[];
  louisAiKnowledgeMetadata?: LouisAiKnowledgeMetadata[];
  louisAiKnowledgeChunks?: LouisAiKnowledgeChunk[];
  louisAiUserMemory?: LouisAiUserMemory[];
  textGeneratorConfig?: TextGeneratorConfig[];
  webSearchConfig?: WebSearchConfig[];
  authAccessIdentities?: {
    id_uuid: string;
    email_address: string;
    full_legal_name: string;
    account_role: string;
    password_hash: string;
    created_at_utc: string;
    updated_at_utc: string;
  }[];
}

export const fallbackStore: DatabaseStore = {
  authAccessIdentities: [],
  auditLogs: [],
  companies: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000001",
      tenant_id: "1",
      full_legal_name: "Muster GmbH & Co. KG",
      tax_vat_id: "DE123456789",
      tax_number: "21/440/12345",
      responsible_person: "Manfred Muster",
      street: "Beispielstraße",
      house_number: "42",
      city: "Musterstadt",
      postal_code: "12345",
      country_code: "DE",
      email_address: "info@muster-gmbh.de",
      phone_number: "+49 123 456789",
      iban: "DE00123456780000123456",
      bic_swift: "ABCDEFGH123",
      language: "de",
      vat_rate: 19,
      currency_code: "EUR",
      labels: ["Kunde", "Prio 1"],
      opt_in_marketing: true,
      opt_in_social_media: false,
      opt_in_direct_message: false,
      opt_in_sms: false,
      opt_in_phone: false,
      created_by_identity: 'system',
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000003",
      tenant_id: "1",
      full_legal_name: "Louis CRM Demo AG",
      tax_vat_id: "DE888888888",
      responsible_person: "Stefan Schmidt",
      street: "Demostraße",
      house_number: "1",
      city: "Berlin",
      postal_code: "10115",
      country_code: "DE",
      email_address: "demo@louis-crm.de",
      phone_number: "+49 30 123456",
      iban: "DE88888888888888888888",
      bic_swift: "DEMOXXXX",
      language: "de",
      vat_rate: 19,
      currency_code: "EUR",
      labels: ["Partner"],
      opt_in_marketing: false,
      opt_in_social_media: true,
      opt_in_direct_message: false,
      opt_in_sms: false,
      opt_in_phone: false,
      created_by_identity: 'system',
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000004",
      tenant_id: "1",
      full_legal_name: "InnoTech Solutions",
      tax_vat_id: "DE555666777",
      responsible_person: "Dr. Julia Weber",
      street: "Technologiepark",
      house_number: "7",
      city: "Hamburg",
      postal_code: "20457",
      country_code: "DE",
      email_address: "contact@innotech.example",
      phone_number: "+49 40 5557788",
      iban: "DE55555555555555555555",
      bic_swift: "INNOTXXX",
      language: "de",
      vat_rate: 19,
      currency_code: "EUR",
      labels: ["Lead", "High Volume"],
      opt_in_marketing: true,
      opt_in_social_media: false,
      opt_in_direct_message: true,
      opt_in_sms: true,
      opt_in_phone: false,
      created_by_identity: 'system',
      ai_confidence_score: 0.95,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  contacts: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000002",
      tenant_id: "1",
      full_legal_name: "Max Mustermann",
      first_name: "Max",
      last_name: "Mustermann",
      salutation: "Herr",
      email_address: "max.mustermann@example.com",
      phone_number: "+49 170 1234567",
      language: "de",
      associated_company_id: "00000000-0000-4000-8000-000000000001",
      labels: ["Ansprechpartner"],
      opt_in_marketing: true,
      opt_in_social_media: false,
      opt_in_direct_message: false,
      opt_in_sms: false,
      opt_in_phone: false,
      created_by_identity: 'system',
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  invoices: [
    {
      id_uuid: uuidv4(),
      tenant_id: "1",
      invoice_number: "RE-2024-001",
      total_gross_amount: 1190.00,
      total_net_amount: 1000.00,
      total_vat_amount: 190.00,
      vat_rate: 19,
      is_vat_inclusive: false,
      currency_code: "EUR",
      issue_date: "2024-05-10",
      payment_status: "draft",
      company_name: "Muster GmbH & Co. KG",
      associated_company_id: "00000000-0000-4000-8000-000000000001",
      associated_contact_id: "00000000-0000-4000-8000-000000000002",
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString(),
      invoice_line_items: [{ description: "CRM Consulting", quantity: 1, unit_price: 1000, vat_rate: 19, total_net: 1000, unit_code: "HUR" }],
      invoice_line_items_json: JSON.stringify([{ description: "CRM Consulting", quantity: 1, unit_price: 1000, vat_rate: 19, total_net: 1000, unit_code: "HUR" }]),
      introductory_text: "",
      closing_text: "",
      created_by_identity: 'system',
      ai_confidence_score: 1.0,
      is_verified_by_human: true
    }
  ],
  smtpSettings: null,
  myCompany: {
    id_uuid: "00000000-0000-4000-8000-000000000000",
    tenant_id: "1",
    full_legal_name: "CYBERDYNE SYSTEMS GmbH",
    tax_vat_id: "DE 123 456 789",
    tax_number: "143/102/12345",
    responsible_person: "Miles Dyson",
    first_name: "Admin",
    last_name: "User",
    street: "Innovation Blvd",
    house_number: "101",
    postal_code: "80331",
    city: "München",
    country_code: "DE",
    email_address: "contact@cyberdyne.io",
    website: "https://cyberdyne.io",
    phone_number: "+49 89 0000000",
    iban: "DE12 3456 7890 1234 5678 00",
    bic_swift: "CYBERDEXXX",
    leitweg_id: "991:12345-67890-99",
    vat_rate: 19,
    currency_code: "EUR",
    language: "de",
    invoice_number_prefix: "RE-",
    invoice_number_year_fixed: true,
    invoice_number_next_seq: 1,
    invoice_number_min_digits: 4,
    logo_url: null,
    contacts_display_columns_json: '["responsible","comms","company","address"]',
    companies_display_columns_json: '["responsible","comms","address","invoice"]',
    created_by_identity: "system",
    ai_confidence_score: 1,
    is_verified_by_human: true,
    created_at_utc: "2026-05-24T07:53:11Z",
    updated_at_utc: "2026-05-24T07:53:11Z"
  },
  emailTemplates: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000021",
      tenant_id: "1",
      template_name_text: "Standard-Rechnungsvorlage",
      email_subject_text: "Rechnung {{invoice_number}} von {{my_company_name}}",
      email_body_content: "<p>Sehr geehrte Damen und Herren,</p><p>anbei erhalten Sie Ihre Rechnung mit der Nummer <strong>{{invoice_number}}</strong> über den Bruttobetrag von <strong>{{total_gross}} {{currency}}</strong>.</p><p>Bitte überweisen Sie den Betrag bis zum <strong>{{due_date}}</strong> auf unser angegebenes Bankkonto.</p><p>Vielen Dank für die angenehme Zusammenarbeit!</p><p>Mit freundlichen Grüßen,<br>{{my_contact_person}}</p>",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000022",
      tenant_id: "1",
      template_name_text: "Freundliche Zahlungserinnerung",
      email_subject_text: "Zahlungserinnerung: Rechnung {{invoice_number}}",
      email_body_content: "<p>Sehr geehrte Damen und Herren,</p><p>sicherlich ist es im Trubel des Alltags untergegangen, aber wir konnten für die Rechnung <strong>{{invoice_number}}</strong> bisher noch keinen Zahlungseingang feststellen.</p><p>Wir möchten Sie daher höflich bitten, den Bruttobetrag von <strong>{{total_gross}} {{currency}}</strong> zeitnah anzuweisen.</p><p>Sollte sich die Zahlung mit dieser E-Mail überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.</p><p>Mit freundlichen Grüßen,<br>{{my_contact_person}}</p>",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  signatures: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000031",
      tenant_id: "1",
      signature_name_text: "Standard-Signatur",
      signature_body_content: "<p>—<br><strong>Louis Smart CRM Service</strong><br>Telefon: +49 30 1234567<br>E-Mail: info@louis-crm.de<br>Web: <a href=\"https://louis-crm.de\" target=\"_blank\">www.louis-crm.de</a></p>",
      is_default_signature: true,
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  invoiceTextTemplates: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000041",
      tenant_id: "1",
      template_name_text: "Standard-Einleitung",
      template_type_code: "introductory",
      template_body_content: "Sehr geehrte Damen und Herren,\n\nhiermit erlauben wir uns, Ihnen die folgenden Leistungen für das abgeschlossene Projekt in Rechnung zu stellen.",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000042",
      tenant_id: "1",
      template_name_text: "Standard-Abschluss",
      template_type_code: "closing",
      template_body_content: "Wir bedanken uns herzlich für Ihr Vertrauen und die partnerschaf\u0323tliche Zusammenarbeit! Bei Rückfragen stehen wir Ihnen jederzeit gerne zur Verfügung.",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  invoiceItemTemplates: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000051",
      tenant_id: "1",
      template_name_text: "Softwareentwicklung (Senior)",
      description: "Dienstleistungen im Bereich Softwareentwicklung durch einen erfahrenen Senior Consultant.",
      quantity: 1,
      unit_price: 120.00,
      vat_rate: 19,
      unit_code: "HUR",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000052",
      tenant_id: "1",
      template_name_text: "Projektmanagement Pauschale",
      description: "Monatliche Pauschale für Projektleitung, Koordination und Qualitätssicherung.",
      quantity: 1,
      unit_price: 1500.00,
      vat_rate: 19,
      unit_code: "MON",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  bankDirectory: [],
  louisAiConfig: [],
  customWorkflows: [],
  louisAiSessions: [],
  louisAiKnowledgeMetadata: [],
  louisAiKnowledgeChunks: [],
  louisAiUserMemory: [],
  textGeneratorConfig: [],
  webSearchConfig: []
};

export let FALLBACK_FILE_PATH = path.join(process.cwd(), ".local_fallback_db.json");

// Determine the actual path for fallback database dynamically
const READONLY_FALLBACK_FILE_PATH = path.join(process.cwd(), ".local_fallback_db.json");
const WRITABLE_FALLBACK_FILE_PATH_TMP = path.join(os.tmpdir(), ".local_fallback_db.json");

try {
  const testFile = path.join(process.cwd(), ".db_write_test_tmp_" + uuidv4() + ".tmp");
  fs.writeFileSync(testFile, "test", "utf8");
  fs.unlinkSync(testFile);
  FALLBACK_FILE_PATH = READONLY_FALLBACK_FILE_PATH;
} catch (e) {
  FALLBACK_FILE_PATH = WRITABLE_FALLBACK_FILE_PATH_TMP;
  console.log(`[Database Fallback] Shifted database file to writable OS temporary location: ${FALLBACK_FILE_PATH}`);
}

let isSavingFallback = false;
let needsSaveFallback = false;

export function saveFallbackStore() {
  if (isSavingFallback) {
    needsSaveFallback = true;
    return;
  }

  isSavingFallback = true;
  const tempPath = FALLBACK_FILE_PATH + ".tmp";

  fs.promises.writeFile(tempPath, JSON.stringify(fallbackStore, null, 2), "utf8")
    .then(() => fs.promises.rename(tempPath, FALLBACK_FILE_PATH))
    .catch((err) => {
      console.warn("Failed to save local fallback DB asynchronously:", err);
    })
    .finally(() => {
      isSavingFallback = false;
      if (needsSaveFallback) {
        needsSaveFallback = false;
        saveFallbackStore();
      }
    });
}

export const cleanLigatureHacksFromValue = <T>(obj: T): T => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(/\u0430/g, "a")  // Cyrillic 'а'
      .replace(/\u0435/g, "e")  // Cyrillic 'е'
      .replace(/\u0455/g, "s")  // Cyrillic 'ѕ'
      .replace(/\u043e/g, "o")  // Cyrillic 'о'
      .replace(/\u0441/g, "c")  // Cyrillic 'с'
      .replace(/\u0456/g, "i")  // Cyrillic 'і'
      .replace(/\u0443/g, "y")  // Cyrillic 'у'
      .replace(/\u0440/g, "p")  // Cyrillic 'р'
      .replace(/\u0445/g, "x")  // Cyrillic 'х'
      .replace(/\u0323/g, "")   // Combining dot below
      .replace(/\u200B/g, "")   // Zero-width space
      .replace(/\u200b/g, "")   // Zero-width space
      .replace(/\u200C/g, "")   // Zero-width non-joiner
      .replace(/\u200c/g, "")   // Zero-width non-joiner
      .replace(/\u200D/g, "")   // Zero-width joiner
      .replace(/\u200d/g, "")   // Zero-width joiner
      .replace(/\u200E/g, "")   // LTR mark
      .replace(/\u200e/g, "")   // LTR mark
      .replace(/\u200F/g, "")   // RTL mark
      .replace(/\u200f/g, "")   // RTL mark
      .replace(/\u00ad/g, "")   // Soft hyphen
      .replace(/\xad/g, "") as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanLigatureHacksFromValue) as unknown as T;
  }
  if (typeof obj === "object") {
    const newObj: any = {};
    for (const key of Object.keys(obj)) {
      newObj[key] = cleanLigatureHacksFromValue((obj as any)[key]);
    }
    return newObj as T;
  }
  return obj;
};

export function loadFallbackStore() {
  try {
    // If the path is different from the original project path, copy/seed from readonly file if it doesn't exist yet
    if (FALLBACK_FILE_PATH !== READONLY_FALLBACK_FILE_PATH && !fs.existsSync(FALLBACK_FILE_PATH)) {
      if (fs.existsSync(READONLY_FALLBACK_FILE_PATH)) {
        try {
          fs.copyFileSync(READONLY_FALLBACK_FILE_PATH, FALLBACK_FILE_PATH);
          console.log("[Database Fallback] Seeded fallback database from project bundle to writable temporary location.");
        } catch (copyErr) {
          console.warn("[Database Fallback] Failed to seed fallback database to temporary location:", copyErr);
        }
      }
    }

    if (fs.existsSync(FALLBACK_FILE_PATH)) {
      const savedData = JSON.parse(fs.readFileSync(FALLBACK_FILE_PATH, "utf8"));
      Object.assign(fallbackStore, savedData);

      // Clean fallback DB records of Cyrillic / ligature hacks / soft hyphens
      for (const key of Object.keys(fallbackStore)) {
        (fallbackStore as any)[key] = cleanLigatureHacksFromValue((fallbackStore as any)[key]);
      }
      saveFallbackStore();
    } else {
      saveFallbackStore();
    }
  } catch (err) {
    console.warn("Failed to load local fallback DB:", err);
  }
}

if (isUsingFallback) {
  loadFallbackStore();
}

export async function initDatabase() {
  try {
    const client = await pool.connect();
    client.release();
    // Enable pgvector extension
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");

    // Migrate core_registry_my_company base table to core_registry_my_company_table if it exists
    await pool.query(`
      DO $mig$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'core_registry_my_company' AND table_type = 'BASE TABLE'
        ) THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'core_registry_my_company_table'
          ) THEN
            ALTER TABLE core_registry_my_company RENAME TO core_registry_my_company_table;
          ELSE
            DROP TABLE core_registry_my_company CASCADE;
          END IF;
        END IF;
      END $mig$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS auth_access_identities (
        id_uuid UUID PRIMARY KEY,
        email_address TEXT UNIQUE NOT NULL,
        full_legal_name TEXT NOT NULL,
        account_role TEXT NOT NULL,
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS core_registry_companies (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        full_legal_name TEXT NOT NULL,
        short_code TEXT,
        tax_vat_id TEXT,
        tax_number TEXT,
        responsible_person TEXT,
        street TEXT,
        house_number TEXT,
        city TEXT,
        postal_code TEXT,
        country_code TEXT,
        email_address TEXT,
        email_2 TEXT,
        website TEXT,
        phone_number TEXT,
        mobile_number TEXT,
        fax_number TEXT,
        iban TEXT,
        bic_swift TEXT,
        leitweg_id TEXT,
        payment_term TEXT,
        price_list TEXT,
        custom_documents TEXT,
        language TEXT DEFAULT 'de',
        labels_json JSONB DEFAULT '[]',
        opt_in_marketing BOOLEAN DEFAULT FALSE,
        opt_in_social_media BOOLEAN DEFAULT FALSE,
        opt_in_direct_message BOOLEAN DEFAULT FALSE,
        opt_in_sms BOOLEAN DEFAULT FALSE,
        opt_in_phone BOOLEAN DEFAULT FALSE,
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_by_identity TEXT,
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        embedding vector(1536)
      );

      CREATE TABLE IF NOT EXISTS core_registry_contacts (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        full_legal_name TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT NOT NULL,
        responsible_person TEXT,
        salutation TEXT,
        gender_identity TEXT,
        date_of_birth TEXT,
        region TEXT,
        street TEXT,
        house_number TEXT,
        postal_code TEXT,
        city TEXT,
        email_address TEXT,
        email_2 TEXT,
        website TEXT,
        phone_number TEXT,
        fax_number TEXT,
        mobile_number TEXT,
        language TEXT DEFAULT 'de',
        labels_json JSONB DEFAULT '[]',
        opt_in_marketing BOOLEAN DEFAULT FALSE,
        opt_in_social_media BOOLEAN DEFAULT FALSE,
        opt_in_direct_message BOOLEAN DEFAULT FALSE,
        opt_in_sms BOOLEAN DEFAULT FALSE,
        opt_in_phone BOOLEAN DEFAULT FALSE,
        tax_vat_id TEXT,
        iban TEXT,
        bic_swift TEXT,
        payment_term TEXT,
        price_list TEXT,
        custom_documents TEXT,
        associated_company_id UUID REFERENCES core_registry_companies(id_uuid),
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_by_identity TEXT,
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        embedding vector(1536)
      );

      CREATE TABLE IF NOT EXISTS fiscal_billing_invoices (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        invoice_number TEXT NOT NULL,
        associated_company_id UUID REFERENCES core_registry_companies(id_uuid),
        associated_contact_id UUID REFERENCES core_registry_contacts(id_uuid),
        bank_account TEXT,
        issue_date DATE NOT NULL,
        service_date DATE,
        due_date DATE,
        payment_term TEXT,
        is_vat_inclusive BOOLEAN DEFAULT FALSE,
        total_net_amount DECIMAL(15, 2) NOT NULL,
        total_vat_amount DECIMAL(15, 2) NOT NULL,
        total_gross_amount DECIMAL(15, 2) NOT NULL,
        vat_rate DECIMAL(5, 2) DEFAULT 19,
        currency_code TEXT DEFAULT 'EUR',
        leitweg_id TEXT,
        invoice_line_items_json JSONB DEFAULT '[]',
        payment_status TEXT DEFAULT 'pending',
        zugferd_xml_metadata TEXT,
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        introductory_text TEXT,
        closing_text TEXT,
        created_by_identity TEXT,
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, invoice_number)
      );

      CREATE TABLE IF NOT EXISTS sys_integrations_smtp_nodes (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        smtp_host_name TEXT NOT NULL,
        smtp_port_number INTEGER NOT NULL,
        smtp_user_name TEXT NOT NULL,
        smtp_password_secret TEXT NOT NULL,
        is_secure_connection BOOLEAN DEFAULT TRUE,
        sender_email_address TEXT NOT NULL,
        sender_display_name TEXT,
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score DOUBLE PRECISION DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS core_registry_my_company_table (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        full_legal_name TEXT NOT NULL,
        short_code TEXT,
        tax_vat_id TEXT,
        tax_number TEXT,
        responsible_person TEXT,
        first_name TEXT,
        last_name TEXT,
        salutation TEXT,
        gender_identity TEXT,
        date_of_birth TEXT,
        region TEXT,
        street TEXT,
        house_number TEXT,
        postal_code TEXT,
        city TEXT,
        country_code TEXT DEFAULT 'DE',
        email_address TEXT,
        email_2 TEXT,
        website TEXT,
        phone_number TEXT,
        mobile_number TEXT,
        fax_number TEXT,
        iban TEXT,
        bic_swift TEXT,
        bank_name TEXT,
        leitweg_id TEXT,
        payment_term TEXT,
        price_list TEXT,
        custom_documents TEXT,
        vat_rate DOUBLE PRECISION DEFAULT 19.0,
        currency_code TEXT DEFAULT 'EUR',
        language TEXT DEFAULT 'de',
        invoice_number_prefix TEXT DEFAULT 'RE-',
        invoice_number_year_fixed BOOLEAN DEFAULT TRUE,
        invoice_number_next_seq INTEGER DEFAULT 1,
        invoice_number_min_digits INTEGER DEFAULT 4,
        logo_url TEXT,
        raw_source_data TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_comms_email_templates (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        template_name_text TEXT NOT NULL,
        email_subject_text TEXT NOT NULL,
        email_body_content TEXT NOT NULL,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_comms_signatures (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        signature_name_text TEXT NOT NULL,
        signature_body_content TEXT NOT NULL,
        is_default_signature BOOLEAN DEFAULT FALSE,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_comms_invoice_text_templates (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        template_name_text TEXT NOT NULL,
        template_type_code TEXT NOT NULL,
        template_body_content TEXT NOT NULL,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_comms_invoice_item_templates (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        template_name_text TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        quantity DOUBLE PRECISION NOT NULL DEFAULT 1.0,
        unit_price DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
        vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 19.00,
        unit_code TEXT NOT NULL DEFAULT 'HUR',
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_bank_directory (
        id_uuid UUID PRIMARY KEY,
        country_code TEXT NOT NULL,
        bank_code TEXT NOT NULL,
        bic TEXT,
        bank_name TEXT NOT NULL,
        city TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (country_code, bank_code)
      );
      CREATE INDEX IF NOT EXISTS idx_sys_bank_directory_lookup ON sys_bank_directory (country_code, bank_code);

      CREATE TABLE IF NOT EXISTS sys_integrations_louis_ai_config (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        provider_type TEXT NOT NULL,
        api_key_secret TEXT,
        base_url TEXT,
        model_name TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.2,
        top_p REAL NOT NULL DEFAULT 0.9,
        top_k INTEGER NOT NULL DEFAULT 40,
        num_ctx INTEGER NOT NULL DEFAULT 8192,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id)
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_custom_workflows (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        workflow_name TEXT NOT NULL,
        workflow_description TEXT NOT NULL,
        tool_chain_sequence JSONB NOT NULL,
        created_by_identity TEXT DEFAULT 'ai_assistant',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, workflow_name)
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_sessions (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        session_title TEXT NOT NULL,
        conversation_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_user_memory (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        user_id TEXT NOT NULL,
        response_preferences_text TEXT DEFAULT '',
        frequently_used_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        chat_notes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_knowledge_metadata (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        file_name TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        mime_type TEXT NOT NULL,
        document_hash TEXT NOT NULL,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_knowledge_chunks (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        document_id UUID REFERENCES sys_louis_ai_knowledge_metadata(id_uuid) ON DELETE CASCADE,
        chunk_text TEXT NOT NULL,
        embedding vector(1536),
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_integrations_text_generator_config (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        system_prompt TEXT NOT NULL,
        temperature REAL NOT NULL DEFAULT 0.7,
        max_tokens INTEGER NOT NULL DEFAULT 2000,
        model_name TEXT NOT NULL DEFAULT 'gemini-3.5-flash',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id)
      );

      CREATE TABLE IF NOT EXISTS sys_integrations_web_search_config (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        selected_engine TEXT NOT NULL DEFAULT 'duckduckgo',
        duckduckgo_url TEXT,
        searxng_url TEXT,
        searxng_categories TEXT,
        google_api_key TEXT,
        google_cx TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id)
      );
    `);

    await pool.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fiscal_billing_invoices' AND column_name='payment_status_node') THEN
          ALTER TABLE fiscal_billing_invoices RENAME COLUMN payment_status_node TO payment_status;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='auth_access_identities' AND column_name='account_role_node') THEN
          ALTER TABLE auth_access_identities RENAME COLUMN account_role_node TO account_role;
        END IF;
      END $$;

      ALTER TABLE core_registry_companies ADD COLUMN IF NOT EXISTS short_code TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS short_code TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS first_name TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS last_name TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS salutation TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS gender_identity TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS date_of_birth TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS region TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS bank_name TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS vat_rate DOUBLE PRECISION DEFAULT 19.0;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'EUR';
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS invoice_number_prefix TEXT DEFAULT 'RE-';
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS invoice_number_year_fixed BOOLEAN DEFAULT TRUE;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS invoice_number_next_seq INTEGER DEFAULT 1;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS invoice_number_min_digits INTEGER DEFAULT 4;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS logo_url TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS contacts_display_columns_json TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS companies_display_columns_json TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS raw_source_data TEXT;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS tax_number TEXT;

      ALTER TABLE core_registry_companies ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT '1';
      ALTER TABLE core_registry_companies ADD COLUMN IF NOT EXISTS tax_number TEXT;
      ALTER TABLE core_registry_contacts ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT '1';
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT '1';
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS created_by_identity TEXT;
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS ai_confidence_score REAL DEFAULT 1.0;
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS is_verified_by_human BOOLEAN DEFAULT FALSE;
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS introductory_text TEXT;
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS closing_text TEXT;
      ALTER TABLE sys_integrations_smtp_nodes ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT '1';

      ALTER TABLE sys_integrations_web_search_config ADD COLUMN IF NOT EXISTS google_api_key TEXT;
      ALTER TABLE sys_integrations_web_search_config ADD COLUMN IF NOT EXISTS google_cx TEXT;

      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS short_term_summary_text TEXT DEFAULT '';
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global';
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS associated_company_id UUID REFERENCES core_registry_companies(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS associated_contact_id UUID REFERENCES core_registry_contacts(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS created_by_identity TEXT NOT NULL DEFAULT 'human';
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS is_verified_by_human BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE auth_access_identities ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE auth_access_identities ADD COLUMN IF NOT EXISTS password_hash TEXT;
      ALTER TABLE core_registry_companies ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE core_registry_contacts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE fiscal_billing_invoices ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sys_integrations_smtp_nodes ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sys_comms_email_templates ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sys_comms_signatures ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE sys_comms_invoice_text_templates ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

      CREATE TABLE IF NOT EXISTS sys_audit_event_logs (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id UUID,
        event_details TEXT,
        actor_identity TEXT NOT NULL,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE sys_audit_event_logs ADD COLUMN IF NOT EXISTS updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_provider TEXT DEFAULT 'gemini';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_api_key_secret TEXT DEFAULT '';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_base_url TEXT DEFAULT '';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_model_name TEXT DEFAULT 'text-embedding-004';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS vector_dimensions INTEGER DEFAULT 1536;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS keep_alive_minutes INTEGER DEFAULT 5;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS parallel_slots INTEGER DEFAULT 1;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS chunk_size INTEGER DEFAULT 500;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS chunk_overlap INTEGER DEFAULT 50;

      -- embedding column is dynamically checked and self-healed on demand
      -- to avoid dropping all embeddings on startup.
      CREATE INDEX IF NOT EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx ON sys_louis_ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON sys_louis_ai_knowledge_chunks (document_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_id ON sys_louis_ai_knowledge_chunks (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_companies_name ON core_registry_companies (full_legal_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON core_registry_contacts (full_legal_name);
      CREATE INDEX IF NOT EXISTS idx_invoices_number ON fiscal_billing_invoices (invoice_number);
    `);
    console.log("PostgreSQL schema initialized with pgvector and audit logs.");

    await runSeeding(pool, '1');

    // Self-healing migration to clean up any legacy 'open' payment statuses to 'pending' from earlier seeding
    await pool.query(`
      UPDATE fiscal_billing_invoices 
      SET payment_status = 'pending' 
      WHERE payment_status = 'open' OR payment_status = 'unpaid';
    `);

    // Self-healing text cleanup migration for Cyrillic / ligature hacks / soft hyphens in Postgres schema
    try {
      await pool.query(`
        UPDATE core_registry_companies 
        SET full_legal_name = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(full_legal_name, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), ''),
            responsible_person = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(responsible_person, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), '');
      `);
      
      await pool.query(`
        UPDATE core_registry_my_company_table
        SET full_legal_name = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(full_legal_name, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), '');
      `);
      
      await pool.query(`
        UPDATE fiscal_billing_invoices
        SET introductory_text = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(introductory_text, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), ''),
            closing_text = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(closing_text, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), ''),
            invoice_line_items_json = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(invoice_line_items_json::text, 'Wirtschаftѕförderung', 'Wirtschaftsförderung'), 'wirtschаftѕförderung', 'wirtschaftsförderung'), 'partnerschaf\u0323tliche', 'partnerschaftliche'), 'Partnerschaf\u0323tliche', 'Partnerschaftliche'), chr(173), ''), chr(8203), '')::jsonb;
      `);
    } catch (migErr) {
      console.warn("PostgreSQL self-healing text cleanup migration failed:", migErr);
    }

    // Create view and set up INSTEAD OF triggers for core_registry_my_company to cleanly align tenant fallback
    try {
      await pool.query(`
        -- Create or replace VIEW core_registry_my_company
        CREATE OR REPLACE VIEW core_registry_my_company AS
        SELECT * FROM core_registry_my_company_table
        ORDER BY CASE WHEN tenant_id = '1' THEN 1 ELSE 0 END;

        -- Trigger function for INSERT
        CREATE OR REPLACE FUNCTION trg_core_registry_my_company_insert()
        RETURNS TRIGGER AS $insert_func$
        BEGIN
          INSERT INTO core_registry_my_company_table (
            id_uuid, tenant_id, full_legal_name, short_code, tax_vat_id, tax_number,
            responsible_person, first_name, last_name, salutation, gender_identity,
            date_of_birth, region, street, house_number, postal_code, city, country_code,
            email_address, email_2, website, phone_number, mobile_number, fax_number,
            iban, bic_swift, bank_name, leitweg_id, payment_term, price_list, custom_documents,
            vat_rate, currency_code, language, invoice_number_prefix, invoice_number_year_fixed,
            invoice_number_next_seq, invoice_number_min_digits, logo_url, raw_source_data,
            metadata, created_by_identity, ai_confidence_score, is_verified_by_human,
            created_at_utc, updated_at_utc, contacts_display_columns_json, companies_display_columns_json
          ) VALUES (
            COALESCE(NEW.id_uuid, gen_random_uuid()), COALESCE(NEW.tenant_id, '1'), NEW.full_legal_name, NEW.short_code, NEW.tax_vat_id, NEW.tax_number,
            NEW.responsible_person, NEW.first_name, NEW.last_name, NEW.salutation, NEW.gender_identity,
            NEW.date_of_birth, NEW.region, NEW.street, NEW.house_number, NEW.postal_code, NEW.city, NEW.country_code,
            NEW.email_address, NEW.email_2, NEW.website, NEW.phone_number, NEW.mobile_number, NEW.fax_number,
            NEW.iban, NEW.bic_swift, NEW.bank_name, NEW.leitweg_id, NEW.payment_term, NEW.price_list, NEW.custom_documents,
            NEW.vat_rate, NEW.currency_code, NEW.language, NEW.invoice_number_prefix, NEW.invoice_number_year_fixed,
            NEW.invoice_number_next_seq, NEW.invoice_number_min_digits, NEW.logo_url, NEW.raw_source_data,
            NEW.metadata, NEW.created_by_identity, NEW.ai_confidence_score, NEW.is_verified_by_human,
            COALESCE(NEW.created_at_utc, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at_utc, CURRENT_TIMESTAMP),
            NEW.contacts_display_columns_json, NEW.companies_display_columns_json
          );
          RETURN NEW;
        END;
        $insert_func$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_my_company_insert ON core_registry_my_company;
        CREATE TRIGGER trg_my_company_insert
        INSTEAD OF INSERT ON core_registry_my_company
        FOR EACH ROW EXECUTE FUNCTION trg_core_registry_my_company_insert();


        -- Trigger function for UPDATE
        CREATE OR REPLACE FUNCTION trg_core_registry_my_company_update()
        RETURNS TRIGGER AS $update_func$
        BEGIN
          UPDATE core_registry_my_company_table
          SET tenant_id = NEW.tenant_id,
              full_legal_name = NEW.full_legal_name,
              short_code = NEW.short_code,
              tax_vat_id = NEW.tax_vat_id,
              tax_number = NEW.tax_number,
              responsible_person = NEW.responsible_person,
              first_name = NEW.first_name,
              last_name = NEW.last_name,
              salutation = NEW.salutation,
              gender_identity = NEW.gender_identity,
              date_of_birth = NEW.date_of_birth,
              region = NEW.region,
              street = NEW.street,
              house_number = NEW.house_number,
              postal_code = NEW.postal_code,
              city = NEW.city,
              country_code = NEW.country_code,
              email_address = NEW.email_address,
              email_2 = NEW.email_2,
              website = NEW.website,
              phone_number = NEW.phone_number,
              mobile_number = NEW.mobile_number,
              fax_number = NEW.fax_number,
              iban = NEW.iban,
              bic_swift = NEW.bic_swift,
              bank_name = NEW.bank_name,
              leitweg_id = NEW.leitweg_id,
              payment_term = NEW.payment_term,
              price_list = NEW.price_list,
              custom_documents = NEW.custom_documents,
              vat_rate = NEW.vat_rate,
              currency_code = NEW.currency_code,
              language = NEW.language,
              invoice_number_prefix = NEW.invoice_number_prefix,
              invoice_number_year_fixed = NEW.invoice_number_year_fixed,
              invoice_number_next_seq = NEW.invoice_number_next_seq,
              invoice_number_min_digits = NEW.invoice_number_min_digits,
              logo_url = NEW.logo_url,
              raw_source_data = NEW.raw_source_data,
              metadata = NEW.metadata,
              created_by_identity = NEW.created_by_identity,
              ai_confidence_score = NEW.ai_confidence_score,
              is_verified_by_human = NEW.is_verified_by_human,
              updated_at_utc = CURRENT_TIMESTAMP,
              contacts_display_columns_json = NEW.contacts_display_columns_json,
              companies_display_columns_json = NEW.companies_display_columns_json
          WHERE id_uuid = OLD.id_uuid;
          RETURN NEW;
        END;
        $update_func$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_my_company_update ON core_registry_my_company;
        CREATE TRIGGER trg_my_company_update
        INSTEAD OF UPDATE ON core_registry_my_company
        FOR EACH ROW EXECUTE FUNCTION trg_core_registry_my_company_update();


        -- Trigger function for DELETE
        CREATE OR REPLACE FUNCTION trg_core_registry_my_company_delete()
        RETURNS TRIGGER AS $delete_func$
        BEGIN
          DELETE FROM core_registry_my_company_table WHERE id_uuid = OLD.id_uuid;
          RETURN OLD;
        END;
        $delete_func$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_my_company_delete ON core_registry_my_company;
        CREATE TRIGGER trg_my_company_delete
        INSTEAD OF DELETE ON core_registry_my_company
        FOR EACH ROW EXECUTE FUNCTION trg_core_registry_my_company_delete();
      `);
      console.log("[db] Successfully configured priority-sort VIEW and INSTEAD OF triggers for core_registry_my_company.");
    } catch (viewErr) {
      console.error("[db] Failed to set up Priority VIEW for core_registry_my_company:", viewErr);
    }

    isUsingFallback = false;
  } catch (err) {
    console.warn("PostgreSQL connection failed. Switching to PERSISTENT LOCAL FILE FALLBACK for preview/demo.");
    isUsingFallback = true;
    loadFallbackStore();
  }
}

export async function seedDatabase() {
  if (isUsingFallback) {
    runInProcessSeedingFallback(fallbackStore);
    return;
  }
  await runSeeding(pool, '1');
}

export async function logAuditEvent(event: {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId?: string;
  eventDetails?: string;
  actorIdentity: string;
}) {
  if (isUsingFallback) {
    if (!fallbackStore.auditLogs) {
      fallbackStore.auditLogs = [];
    }
    fallbackStore.auditLogs.unshift({
      id_uuid: uuidv4(),
      tenant_id: event.tenantId,
      event_type: event.eventType,
      entity_type: event.entityType,
      entity_id: event.entityId || null,
      event_details: event.eventDetails || null,
      actor_identity: event.actorIdentity,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    });
    // Limit to 200 items so the local JSON stays within bounds.
    if (fallbackStore.auditLogs.length > 200) {
      fallbackStore.auditLogs = fallbackStore.auditLogs.slice(0, 200);
    }
    saveFallbackStore();
    return;
  }
  try {
    await pool.query(`
      INSERT INTO sys_audit_event_logs (id_uuid, tenant_id, event_type, entity_type, entity_id, event_details, actor_identity)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [uuidv4(), event.tenantId, event.eventType, event.entityType, event.entityId, event.eventDetails, event.actorIdentity]);
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}

export async function lookupBankDirectory(countryCode: string, bankCode: string): Promise<BankDirectoryEntry | null> {
  const normCC = countryCode.toUpperCase().trim();
  const normBC = bankCode.toUpperCase().trim();

  if (isUsingFallback) {
    if (!fallbackStore.bankDirectory) fallbackStore.bankDirectory = [];
    const entry = fallbackStore.bankDirectory.find(e => e.country_code === normCC && e.bank_code === normBC);
    return entry || null;
  }

  try {
    const res = await pool.query(
      "SELECT id_uuid, country_code, bank_code, bic, bank_name, city, created_at_utc, updated_at_utc FROM sys_bank_directory WHERE country_code = $1 AND bank_code = $2 LIMIT 1",
      [normCC, normBC]
    );
    if (res.rows.length > 0) {
      const r = res.rows[0];
      return {
        id_uuid: r.id_uuid,
        country_code: r.country_code,
        bank_code: r.bank_code,
        bic: r.bic,
        bank_name: r.bank_name,
        city: r.city,
        created_at_utc: r.created_at_utc instanceof Date ? r.created_at_utc.toISOString() : r.created_at_utc,
        updated_at_utc: r.updated_at_utc instanceof Date ? r.updated_at_utc.toISOString() : r.updated_at_utc,
      };
    }
  } catch (err) {
    console.error("Error looking up bank in sys_bank_directory:", err);
  }
  return null;
}

export async function upsertBankDirectoryBatch(entries: Omit<BankDirectoryEntry, 'id_uuid' | 'created_at_utc' | 'updated_at_utc'>[]): Promise<number> {
  if (isUsingFallback) {
    if (!fallbackStore.bankDirectory) {
      fallbackStore.bankDirectory = [];
    }

    const map = new Map<string, BankDirectoryEntry>();
    for (const e of fallbackStore.bankDirectory) {
      map.set(`${e.country_code}:${e.bank_code}`, e);
    }

    const now = new Date().toISOString();
    for (const entry of entries) {
      const key = `${entry.country_code}:${entry.bank_code}`;
      const existing = map.get(key);
      if (existing) {
        existing.bank_name = entry.bank_name;
        existing.bic = entry.bic;
        existing.city = entry.city;
        existing.updated_at_utc = now;
      } else {
        const newEntry: BankDirectoryEntry = {
          id_uuid: uuidv4(),
          country_code: entry.country_code,
          bank_code: entry.bank_code,
          bic: entry.bic,
          bank_name: entry.bank_name,
          city: entry.city,
          created_at_utc: now,
          updated_at_utc: now
        };
        fallbackStore.bankDirectory.push(newEntry);
        map.set(key, newEntry);
      }
    }
    saveFallbackStore();
    return entries.length;
  }

  if (entries.length === 0) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN;");
    const queryText = `
      INSERT INTO sys_bank_directory (id_uuid, country_code, bank_code, bic, bank_name, city, created_at_utc, updated_at_utc)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (country_code, bank_code) 
      DO UPDATE SET 
        bic = EXCLUDED.bic,
        bank_name = EXCLUDED.bank_name,
        city = EXCLUDED.city,
        updated_at_utc = CURRENT_TIMESTAMP;
    `;

    for (const entry of entries) {
      await client.query(queryText, [
        uuidv4(),
        entry.country_code,
        entry.bank_code,
        entry.bic,
        entry.bank_name,
        entry.city
      ]);
    }
    await client.query("COMMIT;");
    return entries.length;
  } catch (err) {
    await client.query("ROLLBACK;");
    console.error("Error upserting bank directory batch in Postgres:", err);
    throw err;
  } finally {
    client.release();
  }
}

export async function getBankDirectoryStats(): Promise<{ totalCount: number; countries: Record<string, number>; lastUpdated: string | null }> {
  if (isUsingFallback) {
    const list = fallbackStore.bankDirectory || [];
    const countries: Record<string, number> = {};
    let latest: string | null = null;
    for (const e of list) {
      countries[e.country_code] = (countries[e.country_code] || 0) + 1;
      if (!latest || e.updated_at_utc > latest) {
        latest = e.updated_at_utc;
      }
    }
    return {
      totalCount: list.length,
      countries,
      lastUpdated: latest
    };
  }

  try {
    const totalRes = await pool.query("SELECT COUNT(*) as count, MAX(updated_at_utc) as last_updated FROM sys_bank_directory");
    const groupsRes = await pool.query("SELECT country_code, COUNT(*) as count FROM sys_bank_directory GROUP BY country_code");
    
    const countries: Record<string, number> = {};
    for (const r of groupsRes.rows) {
      countries[r.country_code] = parseInt(r.count || "0");
    }

    const lastUpdatedRaw = totalRes.rows[0]?.last_updated;

    return {
      totalCount: parseInt(totalRes.rows[0]?.count || "0"),
      countries,
      lastUpdated: lastUpdatedRaw instanceof Date ? lastUpdatedRaw.toISOString() : (lastUpdatedRaw || null)
    };
  } catch (err) {
    console.error("Error getting bank directory stats:", err);
    return { totalCount: 0, countries: {}, lastUpdated: null };
  }
}

export function cleanDbRow<T = unknown>(row: T): T {
  if (!row) return row;
  const cleaned = { ...row } as any;
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === null) {
      delete cleaned[key];
    }
  }
  return cleaned;
}

export function cleanDbRows<T = unknown>(rows: T[]): T[] {
  if (!rows) return [];
  return rows.map(r => cleanDbRow(r));
}


