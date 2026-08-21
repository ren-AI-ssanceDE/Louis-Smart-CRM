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
  InvoiceItemTemplateFullSchema,
  ItemCategoryFullSchema,
  TelegramSettingsFullSchema,
  SpeechToTextSettingsFullSchema,
  OfferTextTemplateFullSchema,
  KanbanBoardFullSchema,
  KanbanColumnFullSchema,
  KanbanCardFullSchema
} from "../lib/schemas.js";
import { runSeeding } from "../lib/seeding.js";
import { 
  LouisAiConfig, 
  CustomWorkflow, 
  WorkflowInstance,
  LouisAiKnowledgeMetadata, 
  LouisAiKnowledgeChunk, 
  ReembeddingQueueItem,
  TextGeneratorConfig, 
  WebSearchConfig,
  ChatMessage,
  MailDraft,
  Offer,
  OfferTextTemplate,
  CouncilSettings,
  CouncilSession,
  CouncilMessage,
  KanbanBoard,
  KanbanColumn,
  KanbanCard,
  KanbanApprovalRecord,
  McpExternalServer,
  McpDiscoveredTool,
  McpToolMapping,
  McpOAuthTokenRecord,
  McpApprovalRequestRecord,
  ChatProfileRecord,
  AgentJob,
  GovernanceRule
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
const originalPoolQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
pool.query = function (this: unknown, ...args: unknown[]): Promise<unknown> {
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
      (args as unknown[])[0] = queryText;
    }
  } else if (queryText && typeof queryText === "object" && typeof (queryText as Record<string, unknown>).text === "string") {
    const textObj = queryText as Record<string, unknown>;
    const normalized = (textObj.text as string).replace(/\s+/g, " ").trim();
    if (
      normalized.includes("FROM core_registry_my_company") &&
      normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
      !normalized.includes("ORDER BY")
    ) {
      if (normalized.includes("LIMIT 1")) {
        textObj.text = (textObj.text as string).replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
      } else {
        textObj.text = (textObj.text as string) + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
      }
    }
  }
  return originalPoolQuery(...args);
} as unknown as typeof pool.query;

function patchClient(client: unknown) {
  if (client && typeof client === "object") {
    const clientObj = client as Record<string, unknown>;
    if (!clientObj._queryPatched) {
      clientObj._queryPatched = true;
      const originalClientQuery = (clientObj.query as (...args: unknown[]) => Promise<unknown>).bind(clientObj);
      clientObj.query = function (this: unknown, ...cArgs: unknown[]): Promise<unknown> {
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
        } else if (queryText && typeof queryText === "object" && typeof (queryText as Record<string, unknown>).text === "string") {
          const textObj = queryText as Record<string, unknown>;
          const normalized = (textObj.text as string).replace(/\s+/g, " ").trim();
          if (
            normalized.includes("FROM core_registry_my_company") &&
            normalized.includes("tenant_id = $1 OR tenant_id = '1'") &&
            !normalized.includes("ORDER BY")
          ) {
            if (normalized.includes("LIMIT 1")) {
              textObj.text = (textObj.text as string).replace(/LIMIT\s+1/i, "ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1");
            } else {
              textObj.text = (textObj.text as string) + " ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END";
            }
          }
        }
        return originalClientQuery(...cArgs);
      };
    }
  }
}

const originalConnect = pool.connect.bind(pool) as (...args: unknown[]) => Promise<unknown>;
pool.connect = function (this: unknown, ...args: unknown[]): Promise<unknown> {
  const callback = args[0];
  if (typeof callback === "function") {
    return originalConnect((err: unknown, client: unknown, release: unknown) => {
      if (client) {
        patchClient(client);
      }
      (callback as (err: unknown, client: unknown, release: unknown) => void)(err, client, release);
    });
  } else {
    const promise = originalConnect();
    return promise.then((client: unknown) => {
      if (client) {
        patchClient(client);
      }
      return client;
    });
  }
} as unknown as typeof pool.connect;

export let isUsingFallback = !(process.env.DATABASE_URL || process.env.PGHOST);

export interface FallbackStoreMcpApiKey {
  id_uuid: string;
  tenant_id: string;
  key_name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

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

export interface AiChatLogItem {
  id?: string;
  tenantId: string;
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalTokens: number;
  createdAt: string;
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
  // (V2-6-Folge): Auth-Secret für den Fallback-Modus (stabil über Neustarts)
  authSecret?: string;
  offers?: Offer[];
  offerTextTemplates?: z.infer<typeof OfferTextTemplateFullSchema>[];
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
  itemCategories?: z.infer<typeof ItemCategoryFullSchema>[];
  bankDirectory?: BankDirectoryEntry[];
  louisAiConfig?: LouisAiConfig[];
  customWorkflows?: CustomWorkflow[];
  workflowInstances?: WorkflowInstance[];
  agentJobs?: AgentJob[];
  governanceRules?: GovernanceRule[];
 // Task 7 (B2): Token-Metriken pro Agent-Lauf
  agentRuns?: Array<{
    id_uuid: string;
    tenant_id: string;
    user_id: string;
    prompt: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    total_tokens: number;
    duration_ms: number;
    active_tools: number;
    created_at_utc: string;
  }>;
  aiSubtasks?: Array<{
    id_uuid: string;
    tenant_id: string;
    parent_session_id?: string | null;
    task_prompt: string;
    required_tools_json: string[];
    status: string;
    result_json?: Record<string, unknown> | null;
    created_at_utc: string;
    updated_at_utc: string;
  }>;
  aiQuestions?: Array<{
    id_uuid: string;
    tenant_id: string;
    question: string;
    choices_json: string;
    context_text: string;
    status: 'OPEN' | 'ANSWERED';
    answer: string;
    created_by: string;
    created_at_utc: string;
    answered_at_utc?: string | null;
  }>;
  aiNotes?: Array<{
    id_uuid: string;
    tenant_id: string;
    entity_type: 'contact' | 'company';
    entity_id_uuid: string;
    note_text: string;
    priority?: string;
    created_by_identity?: string;
    created_at_utc?: string;
  }>;
  louisAiSessions?: {
    id_uuid: string;
    tenant_id: string;
    session_title: string;
    conversation_history_json: ChatMessage[];
    short_term_summary_text?: string;
    parent_session_id?: string | null; // P0-3: Lineage (optional)
    // C.7 (Plan 2026-08-19): aktives Chatprofil + Session-Override (Tool-Panel)
    active_chat_profile_id?: string | null;
    active_mcp_tools_json?: string[] | null;
    created_at_utc: string; // strict stamp
    updated_at_utc: string; // strict stamp
  }[];
  louisAiKnowledgeMetadata?: LouisAiKnowledgeMetadata[];
  louisAiKnowledgeChunks?: LouisAiKnowledgeChunk[];
  louisAiReembeddingQueue?: ReembeddingQueueItem[];
  louisAiUserMemory?: LouisAiUserMemory[];
 // P2-A: Skill-Suggestions (Fallback-Store)
  skillSuggestions?: Array<{
    id_uuid: string;
    tenant_id: string;
    workflow_name: string;
    workflow_description: string;
    skill_tags: string[];
    skill_category?: string | null;
    tool_chain_sequence: Array<{ tool: string; instruction: string }>;
    status: "pending" | "applied" | "dismissed";
    created_at_utc: string;
  }>;
  textGeneratorConfig?: TextGeneratorConfig[];
  webSearchConfig?: WebSearchConfig[];
  mailDrafts?: MailDraft[];
  telegramConfig?: z.infer<typeof TelegramSettingsFullSchema>[];
  sttConfig?: z.infer<typeof SpeechToTextSettingsFullSchema>[];
  councilSettings?: CouncilSettings | null;
  councilSessions?: CouncilSession[];
  councilMessages?: CouncilMessage[];
  kanbanBoards?: z.infer<typeof KanbanBoardFullSchema>[];
  kanbanColumns?: z.infer<typeof KanbanColumnFullSchema>[];
  kanbanCards?: z.infer<typeof KanbanCardFullSchema>[];
  kanbanApprovals?: KanbanApprovalRecord[];
  mcp_api_keys?: FallbackStoreMcpApiKey[];
  mcp_external_servers?: McpExternalServer[];
  mcp_discovered_tools?: McpDiscoveredTool[];
  mcp_tool_mappings?: McpToolMapping[];
  mcpOauthTokens?: McpOAuthTokenRecord[];
  // C.4 (Plan 2026-08-19): Genehmigungs-Queue (Trust-Gate)
  mcpApprovalRequests?: McpApprovalRequestRecord[];
  // C.7/C.8 (Plan 2026-08-19): Chatprofile + History-Archiv
  mcpChatProfiles?: ChatProfileRecord[];
  sessionProfileHistories?: Array<{
    session_id: string;
    chat_profile_id: string;
    conversation_history_json: unknown;
    short_term_summary_text: string;
    updated_at_utc?: string;
  }>;
  aiChatLogs?: AiChatLogItem[];
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
  mcpOauthTokens: [],
  mcpApprovalRequests: [],
  mcpChatProfiles: [],
  sessionProfileHistories: [],
  authAccessIdentities: [],
  auditLogs: [],
  companies: [],
  contacts: [],
  invoices: [],
  offers: [],
  offerTextTemplates: [
    {
      id_uuid: "00000000-0000-4000-8000-000000000061",
      tenant_id: "1",
      template_name_text: "Standard-Einleitung",
      template_type_code: "introductory",
      template_body_content: "Sehr geehrte Damen und Herren,\n\nvielen Dank für das angenehme Gespräch. Gerne senden wir Ihnen hiermit unser unverbindliches Angebot für die besprochenen Leistungen.",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    },
    {
      id_uuid: "00000000-0000-4000-8000-000000000062",
      tenant_id: "1",
      template_name_text: "Standard-Abschluss",
      template_type_code: "closing",
      template_body_content: "Wir bedanken uns für Ihr Vertrauen und freuen uns auf eine erfolgreiche Zusammenarbeit. Dieses Angebot ist gültig bis zum {{valid_until}}.",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
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
    offer_number_prefix: "AN-",
    offer_number_year_fixed: true,
    offer_number_next_seq: 1,
    offer_number_min_digits: 4,
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
      email_body_content: "\x3cp\x3eSehr geehrte Damen und Herren,\x3c/p\x3e\x3cp\x3eanbei erhalten Sie Ihre Rechnung mit der Nummer \x3cstrong\x3e{{invoice_number}}\x3c/strong\x3e über den Bruttobetrag von \x3cstrong\x3e{{total_gross}} {{currency}}\x3c/strong\x3e.\x3c/p\x3e\x3cp\x3eBitte überweisen Sie den Betrag bis zum \x3cstrong\x3e{{due_date}}\x3c/strong\x3e auf unser angegebenes Bankkonto.\x3c/p\x3e\x3cp\x3eVielen Dank für die angenehme Zusammenarbeit!\x3c/p\x3e\x3cp\x3eMit freundlichen Grüßen,\x3cbr\x3e{{my_contact_person}}\x3c/p\x3e",
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
      email_body_content: "\x3cp\x3eSehr geehrte Damen und Herren,\x3c/p\x3e\x3cp\x3esicherlich ist es im Trubel des Alltags untergegangen, aber wir konnten für die Rechnung \x3cstrong\x3e{{invoice_number}}\x3c/strong\x3e bisher noch keinen Zahlungseingang feststellen.\x3c/p\x3e\x3cp\x3eWir möchten Sie daher höflich bitten, den Bruttobetrag von \x3cstrong\x3e{{total_gross}} {{currency}}\x3c/strong\x3e zeitnah anzuweisen.\x3c/p\x3e\x3cp\x3eSollte sich die Zahlung mit dieser E-Mail überschnitten haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\x3c/p\x3e\x3cp\x3eMit freundlichen Grüßen,\x3cbr\x3e{{my_contact_person}}\x3c/p\x3e",
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
      usage_scope: "both",
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
      usage_scope: "both",
      created_by_identity: "system",
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    }
  ],
  itemCategories: [],
  bankDirectory: [],
  louisAiConfig: [],
  customWorkflows: [],
  workflowInstances: [],
  agentJobs: [],
  governanceRules: [],
  aiSubtasks: [],
  aiQuestions: [],
  aiNotes: [],
  louisAiSessions: [],
  louisAiKnowledgeMetadata: [],
  louisAiKnowledgeChunks: [],
  louisAiReembeddingQueue: [],
  louisAiUserMemory: [],
  skillSuggestions: [],
  textGeneratorConfig: [],
  webSearchConfig: [],
  mailDrafts: [],
  telegramConfig: [],
  sttConfig: [],
  councilSettings: null,
  councilSessions: [],
  councilMessages: [],
  kanbanBoards: [],
  kanbanColumns: [],
  kanbanCards: [],
  kanbanApprovals: [],
  mcp_api_keys: [],
  mcp_external_servers: [],
  mcp_discovered_tools: [],
  mcp_tool_mappings: [],
  aiChatLogs: []
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
  if (!isUsingFallback) return;
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
  if (typeof obj === "object" && obj !== null) {
    const newObj: Record<string, unknown> = {};
    const record = obj as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      newObj[key] = cleanLigatureHacksFromValue(record[key]);
    }
    return newObj as unknown as T;
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

      if (!fallbackStore.companies) fallbackStore.companies = [];
      if (!fallbackStore.contacts) fallbackStore.contacts = [];
      if (!fallbackStore.invoices) fallbackStore.invoices = [];
      if (!fallbackStore.offers) fallbackStore.offers = [];
      if (!fallbackStore.offerTextTemplates) fallbackStore.offerTextTemplates = [];
      if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
      if (!fallbackStore.emailTemplates) fallbackStore.emailTemplates = [];
      if (!fallbackStore.signatures) fallbackStore.signatures = [];
      if (!fallbackStore.invoiceTextTemplates) fallbackStore.invoiceTextTemplates = [];
      if (!fallbackStore.invoiceItemTemplates) fallbackStore.invoiceItemTemplates = [];
      if (!fallbackStore.itemCategories) fallbackStore.itemCategories = [];
      if (!fallbackStore.bankDirectory) fallbackStore.bankDirectory = [];
      if (!fallbackStore.louisAiConfig) fallbackStore.louisAiConfig = [];
      if (!fallbackStore.customWorkflows) fallbackStore.customWorkflows = [];
      if (!fallbackStore.workflowInstances) fallbackStore.workflowInstances = [];
      if (!fallbackStore.louisAiSessions) fallbackStore.louisAiSessions = [];
      if (!fallbackStore.louisAiKnowledgeMetadata) fallbackStore.louisAiKnowledgeMetadata = [];
      if (!fallbackStore.louisAiKnowledgeChunks) fallbackStore.louisAiKnowledgeChunks = [];
      if (!fallbackStore.louisAiReembeddingQueue) fallbackStore.louisAiReembeddingQueue = [];
      if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
      if (!fallbackStore.textGeneratorConfig) fallbackStore.textGeneratorConfig = [];
      if (!fallbackStore.webSearchConfig) fallbackStore.webSearchConfig = [];
      if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
      if (!fallbackStore.telegramConfig) fallbackStore.telegramConfig = [];
      if (!fallbackStore.sttConfig) fallbackStore.sttConfig = [];
      if (!fallbackStore.councilSessions) fallbackStore.councilSessions = [];
      if (!fallbackStore.councilMessages) fallbackStore.councilMessages = [];
      if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
      if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
      if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
      if (!fallbackStore.kanbanApprovals) fallbackStore.kanbanApprovals = [];
      if (!fallbackStore.mcp_api_keys) fallbackStore.mcp_api_keys = [];
      if (!fallbackStore.mcp_external_servers) fallbackStore.mcp_external_servers = [];
      if (!fallbackStore.mcp_discovered_tools) fallbackStore.mcp_discovered_tools = [];
      if (!fallbackStore.mcp_tool_mappings) fallbackStore.mcp_tool_mappings = [];
      if (!fallbackStore.mcpOauthTokens) fallbackStore.mcpOauthTokens = [];
      if (!fallbackStore.aiChatLogs) fallbackStore.aiChatLogs = [];
      if (!fallbackStore.authAccessIdentities) fallbackStore.authAccessIdentities = [];

      // Clean fallback DB records of Cyrillic / ligature hacks / soft hyphens
      const storeObj = fallbackStore as unknown as Record<string, unknown>;
      for (const key of Object.keys(storeObj)) {
        storeObj[key] = cleanLigatureHacksFromValue(storeObj[key]);
      }

      // Self-healing migration for fallbackStore offers from 'status' to 'offer_status' and mapping legacy values
      if (fallbackStore.offers && Array.isArray(fallbackStore.offers)) {
        for (const offer of (fallbackStore.offers as unknown) as Record<string, unknown>[]) {
          if (offer) {
            if (offer.status !== undefined && offer.offer_status === undefined) {
              offer.offer_status = offer.status;
              delete offer.status;
            }
            if (offer.offer_status === 'not_sent') offer.offer_status = 'draft';
            if (offer.offer_status === 'declined') offer.offer_status = 'rejected';
          }
        }
      }

      // Self-healing migration for fallbackStore invoices from 'status' to 'payment_status' and mapping legacy values
      if (fallbackStore.invoices && Array.isArray(fallbackStore.invoices)) {
        for (const inv of (fallbackStore.invoices as unknown) as Record<string, unknown>[]) {
          if (inv) {
            if (inv.status !== undefined && inv.payment_status === undefined) {
              inv.payment_status = inv.status;
              delete inv.status;
            }
            if (inv.payment_status === 'pending' || inv.payment_status === 'open' || inv.payment_status === 'unpaid') {
              inv.payment_status = 'issued';
            }
          }
        }
      }

      // Self-healing migration for fallbackStore kanbanCards status
      if (fallbackStore.kanbanCards && Array.isArray(fallbackStore.kanbanCards)) {
        for (const card of (fallbackStore.kanbanCards as unknown) as Record<string, unknown>[]) {
          if (card && (!card.status || card.status === null)) {
            card.status = 'todo';
          }
        }
      }

      // Self-healing migration for fallbackStore tenant_id normalization to '1' across ALL collections
      for (const key of Object.keys(storeObj)) {
        const val = storeObj[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            if (item && typeof item === "object" && "tenant_id" in item) {
              const itemObj = item as Record<string, unknown>;
              if (itemObj.tenant_id === null || itemObj.tenant_id === undefined || itemObj.tenant_id === "") {
                itemObj.tenant_id = "1";
              }
            }
          }
        } else if (val && typeof val === "object" && "tenant_id" in val) {
          const itemObj = val as Record<string, unknown>;
          if (itemObj.tenant_id === null || itemObj.tenant_id === undefined || itemObj.tenant_id === "") {
            itemObj.tenant_id = "1";
          }
        }
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
  const hasDbConfig = !!(process.env.DATABASE_URL || process.env.PGHOST);
  if (isUsingFallback && !hasDbConfig) {
    console.log("[db] Using JSON fallback store. No database connection needed.");
    return;
  }
  let client;
  if (hasDbConfig) {
    const maxRetries = 15;
    const retryDelayMs = 1000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        client = await pool.connect();
        console.log(`[db] Successfully connected to PostgreSQL database on attempt ${attempt}.`);
        break;
      } catch (err) {
        if (attempt === maxRetries) {
          console.warn(`[db] PostgreSQL connection failed after ${maxRetries} attempts.`);
          throw err;
        }
        console.log(`[db] PostgreSQL database connection attempt ${attempt} failed. Retrying in ${retryDelayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
  } else {
    throw new Error("No database credentials/host configured.");
  }

  try {
    if (client) {
      client.release();
    }
    // Enable pgvector extension
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");

    // Migrate core_registry_my_company base table to core_registry_my_company_table if it exists
    await pool.query(`
      DO $mig$
      DECLARE
        r record;
        j jsonb;
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
            -- Copy records from core_registry_my_company to core_registry_my_company_table dynamically before dropping
            FOR r IN EXECUTE 'SELECT * FROM core_registry_my_company' LOOP
              j := to_jsonb(r);
              BEGIN
                INSERT INTO core_registry_my_company_table (id_uuid, tenant_id, full_legal_name)
                VALUES (
                  (j->>'id_uuid')::uuid, 
                  COALESCE(j->>'tenant_id', '1'), 
                  COALESCE(j->>'full_legal_name', 'My Company')
                )
                ON CONFLICT (id_uuid) DO NOTHING;

                -- Update non-null columns if they exist in the JSON
                UPDATE core_registry_my_company_table
                SET 
                  short_code = COALESCE(j->>'short_code', short_code),
                  tax_vat_id = COALESCE(j->>'tax_vat_id', tax_vat_id),
                  tax_number = COALESCE(j->>'tax_number', tax_number),
                  responsible_person = COALESCE(j->>'responsible_person', responsible_person),
                  first_name = COALESCE(j->>'first_name', first_name),
                  last_name = COALESCE(j->>'last_name', last_name),
                  salutation = COALESCE(j->>'salutation', salutation),
                  gender_identity = COALESCE(j->>'gender_identity', gender_identity),
                  date_of_birth = COALESCE(j->>'date_of_birth', date_of_birth),
                  region = COALESCE(j->>'region', region),
                  street = COALESCE(j->>'street', street),
                  house_number = COALESCE(j->>'house_number', house_number),
                  postal_code = COALESCE(j->>'postal_code', postal_code),
                  city = COALESCE(j->>'city', city),
                  country_code = COALESCE(j->>'country_code', country_code),
                  email_address = COALESCE(j->>'email_address', email_address),
                  email_2 = COALESCE(j->>'email_2', email_2),
                  website = COALESCE(j->>'website', website),
                  phone_number = COALESCE(j->>'phone_number', phone_number),
                  mobile_number = COALESCE(j->>'mobile_number', mobile_number),
                  fax_number = COALESCE(j->>'fax_number', fax_number),
                  iban = COALESCE(j->>'iban', iban),
                  bic_swift = COALESCE(j->>'bic_swift', bic_swift),
                  bank_name = COALESCE(j->>'bank_name', bank_name),
                  leitweg_id = COALESCE(j->>'leitweg_id', leitweg_id),
                  payment_term = COALESCE(j->>'payment_term', payment_term),
                  price_list = COALESCE(j->>'price_list', price_list),
                  custom_documents = COALESCE(j->>'custom_documents', custom_documents),
                  vat_rate = COALESCE((j->>'vat_rate')::double precision, vat_rate),
                  currency_code = COALESCE(j->>'currency_code', currency_code),
                  language = COALESCE(j->>'language', language),
                  invoice_number_prefix = COALESCE(j->>'invoice_number_prefix', invoice_number_prefix),
                  invoice_number_year_fixed = COALESCE((j->>'invoice_number_year_fixed')::boolean, invoice_number_year_fixed),
                  invoice_number_next_seq = COALESCE((j->>'invoice_number_next_seq')::integer, invoice_number_next_seq),
                  invoice_number_min_digits = COALESCE((j->>'invoice_number_min_digits')::integer, invoice_number_min_digits),
                  logo_url = COALESCE(j->>'logo_url', logo_url),
                  contacts_display_columns_json = COALESCE(j->>'contacts_display_columns_json', contacts_display_columns_json),
                  companies_display_columns_json = COALESCE(j->>'companies_display_columns_json', companies_display_columns_json)
                WHERE id_uuid = (j->>'id_uuid')::uuid;
              EXCEPTION WHEN OTHERS THEN
                -- Catch single row failure to let other rows succeed
              END;
            END LOOP;

            EXECUTE 'DROP TABLE core_registry_my_company CASCADE';
          END IF;
        END IF;
      END $mig$;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sys_app_security (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_secret TEXT NOT NULL,
        created_at_utc TIMESTAMPTZ DEFAULT now(),
        updated_at_utc TIMESTAMPTZ DEFAULT now()
      );
      -- App-weites Auth-Secret in der DB (Regel: keine Einstellungen in Dateien;
      -- NULL = beim ersten Start generiert). Singleton-Zeile, Races via ON CONFLICT abgesichert.
      INSERT INTO sys_app_security (auth_secret)
      SELECT gen_random_uuid()::text || gen_random_uuid()::text
      WHERE NOT EXISTS (SELECT 1 FROM sys_app_security);

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

      CREATE TABLE IF NOT EXISTS sys_comms_item_categories (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        category_name_text TEXT NOT NULL,
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
        usage_scope TEXT DEFAULT 'both',
        category_id_uuid UUID REFERENCES sys_comms_item_categories(id_uuid) ON DELETE SET NULL,
        created_by_identity TEXT DEFAULT 'human',
        ai_confidence_score REAL DEFAULT 1.0,
        is_verified_by_human BOOLEAN DEFAULT FALSE,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE sys_comms_invoice_item_templates ADD COLUMN IF NOT EXISTS usage_scope TEXT DEFAULT 'both';
      ALTER TABLE sys_comms_invoice_item_templates ADD COLUMN IF NOT EXISTS category_id_uuid UUID REFERENCES sys_comms_item_categories(id_uuid) ON DELETE SET NULL;

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
        trigger_type TEXT NOT NULL DEFAULT 'MANUAL',
        trigger_config JSONB DEFAULT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by_identity TEXT DEFAULT 'ai_assistant',
        dag_structure JSONB DEFAULT NULL,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, workflow_name)
      );

      CREATE TABLE IF NOT EXISTS sys_louis_ai_workflow_instances (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        workflow_id UUID REFERENCES sys_louis_ai_custom_workflows(id_uuid) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'RUNNING',
        initial_payload JSONB DEFAULT '{}'::jsonb,
        current_step_index INTEGER NOT NULL DEFAULT 0,
        execution_log JSONB DEFAULT '[]'::jsonb,
        execute_at_utc TIMESTAMP WITH TIME ZONE DEFAULT NULL,
        current_node_id TEXT DEFAULT NULL,
        node_results JSONB DEFAULT '{}'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_louis_mail_drafts (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workflow_instance_id UUID REFERENCES sys_louis_ai_workflow_instances(id_uuid) ON DELETE SET NULL,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments_json JSONB DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
        chunk_index INTEGER NOT NULL DEFAULT 0,
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
        model_name TEXT NOT NULL DEFAULT 'llama3',
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

      CREATE TABLE IF NOT EXISTS sys_integrations_telegram_config (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        bot_token TEXT NOT NULL,
        allowed_user_ids TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id)
      );

      CREATE TABLE IF NOT EXISTS sys_integrations_stt_config (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        stt_provider TEXT NOT NULL DEFAULT 'disabled',
        stt_endpoint TEXT NOT NULL DEFAULT 'http://localhost:8000/v1/audio/transcriptions',
        stt_api_key TEXT,
        stt_model TEXT NOT NULL DEFAULT 'whisper-1',
        stt_language TEXT NOT NULL DEFAULT 'de',
        stt_prompt TEXT NOT NULL DEFAULT 'Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices',
        stt_device TEXT NOT NULL DEFAULT 'auto',
        stt_quantization TEXT NOT NULL DEFAULT 'none',
        stt_unload_llm_on_demand BOOLEAN DEFAULT FALSE,
        stt_fallback_on_cpu BOOLEAN DEFAULT FALSE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id)
      );

      CREATE TABLE IF NOT EXISTS council_settings (
        tenant_id VARCHAR(50) PRIMARY KEY,
        settings_json JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS council_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(50) NOT NULL,
        topic TEXT NOT NULL,
        mode VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        max_rounds INT NOT NULL DEFAULT 3,
        current_round INT NOT NULL DEFAULT 1,
        participants JSONB NOT NULL,
        final_conclusion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS council_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID REFERENCES council_sessions(id) ON DELETE CASCADE,
        tenant_id VARCHAR(50) NOT NULL,
        participant_id VARCHAR(50) NOT NULL,
        round_number INT NOT NULL DEFAULT 1,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE council_messages ADD COLUMN IF NOT EXISTS fallback_metadata JSONB DEFAULT NULL;
      ALTER TABLE council_sessions ADD COLUMN IF NOT EXISTS has_degraded_responses BOOLEAN DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS kanban_boards (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(50) NOT NULL DEFAULT '1',
        title VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(50) DEFAULT '#3b82f6',
        is_default BOOLEAN DEFAULT false,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS kanban_columns (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(50) NOT NULL DEFAULT '1',
        board_id UUID NOT NULL REFERENCES kanban_boards(id_uuid) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        position INT NOT NULL DEFAULT 0,
        color_accent VARCHAR(50) DEFAULT '#64748b',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS kanban_cards (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(50) NOT NULL DEFAULT '1',
        board_id UUID NOT NULL REFERENCES kanban_boards(id_uuid) ON DELETE CASCADE,
        column_id UUID NOT NULL REFERENCES kanban_columns(id_uuid) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        position INT NOT NULL DEFAULT 0,
        due_date VARCHAR(50),
        assigned_user VARCHAR(100),
        company_id_uuid UUID REFERENCES core_registry_companies(id_uuid) ON DELETE SET NULL,
        contact_id_uuid UUID REFERENCES core_registry_contacts(id_uuid) ON DELETE SET NULL,
        labels TEXT[],
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_louis_kanban_approvals (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(50) NOT NULL DEFAULT '1',
        workflow_instance_id UUID REFERENCES sys_louis_ai_workflow_instances(id_uuid) ON DELETE CASCADE,
        entity_type VARCHAR(50) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        target_id_uuid UUID,
        proposed_payload JSONB NOT NULL,
        explanation_text TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS council_settings (
        tenant_id TEXT PRIMARY KEY,
        settings_json JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inference_settings (
        tenant_id TEXT PRIMARY KEY,
        settings_json JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mcp_api_keys (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(255) NOT NULL DEFAULT '1',
        key_name VARCHAR(255) NOT NULL,
        key_hash VARCHAR(255) NOT NULL,
        key_prefix VARCHAR(32) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{"read","write","admin"}',
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_used_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_by_user_id VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ai_chat_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id VARCHAR(255) NOT NULL DEFAULT '1',
        session_id VARCHAR(255) NOT NULL,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        cached_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE ai_chat_logs ADD COLUMN IF NOT EXISTS cached_tokens INTEGER DEFAULT 0;

      CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_tenant_session ON ai_chat_logs(tenant_id, session_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_hash ON mcp_api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_mcp_api_keys_tenant ON mcp_api_keys(tenant_id);

      CREATE INDEX IF NOT EXISTS idx_kanban_appr_tenant_status ON sys_louis_kanban_approvals(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_kanban_appr_wf_inst ON sys_louis_kanban_approvals(workflow_instance_id);

      CREATE EXTENSION IF NOT EXISTS pg_trgm;

      CREATE INDEX IF NOT EXISTS idx_companies_trgm_name ON core_registry_companies USING gin (full_legal_name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_companies_trgm_city ON core_registry_companies USING gin (city gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_contacts_trgm_name ON core_registry_contacts USING gin (full_legal_name gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_contacts_trgm_email ON core_registry_contacts USING gin (email_address gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_invoices_trgm_number ON fiscal_billing_invoices USING gin (invoice_number gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_trgm_content ON sys_louis_ai_knowledge_chunks USING gin (chunk_text gin_trgm_ops);
    `);

    await pool.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fiscal_billing_invoices' AND column_name='payment_status_node') THEN
          ALTER TABLE fiscal_billing_invoices RENAME COLUMN payment_status_node TO payment_status;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'fiscal_billing_invoices' AND column_name = 'status'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'fiscal_billing_invoices' AND column_name = 'payment_status'
        ) THEN
          ALTER TABLE fiscal_billing_invoices RENAME COLUMN status TO payment_status;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'fiscal_billing_invoices' AND column_name = 'payment_status'
        ) THEN
          ALTER TABLE fiscal_billing_invoices ADD COLUMN payment_status TEXT DEFAULT 'pending';
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
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS offer_number_prefix TEXT DEFAULT 'AN-';
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS offer_number_year_fixed BOOLEAN DEFAULT TRUE;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS offer_number_next_seq INTEGER DEFAULT 1;
      ALTER TABLE core_registry_my_company_table ADD COLUMN IF NOT EXISTS offer_number_min_digits INTEGER DEFAULT 4;
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

      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'MANUAL';
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS trigger_config JSONB DEFAULT NULL;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS direct_send_email BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS dag_structure JSONB DEFAULT NULL;

      -- S5: Skill-Frontmatter (Workflows als Skill-Module) + pgvector-Embedding (Reihenfolge zwingend: erst Spalten, dann Index)
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_description TEXT DEFAULT '';
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_version INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_category TEXT;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_pitfalls JSONB NOT NULL DEFAULT '[]'::jsonb;
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS skill_embedding vector(768);
      CREATE INDEX IF NOT EXISTS sys_louis_ai_custom_workflows_embedding_hnsw_idx ON sys_louis_ai_custom_workflows USING hnsw (skill_embedding vector_cosine_ops);

      -- S7: Agentic Cron-Jobs (prompt-basierte Agent-Jobs) + Last-Run-Marker an custom_workflows (Trennung vom Memory-Missbrauch)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_agent_jobs (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        job_name TEXT NOT NULL,
        job_prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL DEFAULT 'daily',
        schedule_time TEXT,
        schedule_weekday INTEGER,
        deliver_to TEXT NOT NULL DEFAULT 'session',
        deliver_target TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_run_at_utc TIMESTAMPTZ,
        created_at_utc TIMESTAMPTZ DEFAULT NOW(),
        updated_at_utc TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_jobs_tenant_active ON sys_louis_ai_agent_jobs(tenant_id, is_active);
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS last_run_at_utc TIMESTAMPTZ;
      --4C (T8): Versionierung — Changelog-Historie (JSONB-Array von Versionseinträgen)
      ALTER TABLE sys_louis_ai_custom_workflows ADD COLUMN IF NOT EXISTS version_history JSONB DEFAULT '[]'::jsonb;

      -- S8: Governance-Rules-Engine (Regeln pro Tenant, Priorität BLOCK > ASK > REQUIRE_APPROVAL > ALLOW)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_governance_rules (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        rule_name TEXT NOT NULL,
        entity_type TEXT,
        action TEXT NOT NULL,
        effect TEXT NOT NULL DEFAULT 'REQUIRE_APPROVAL',
        note TEXT NOT NULL DEFAULT '',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at_utc TIMESTAMPTZ DEFAULT NOW(),
        updated_at_utc TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_governance_rules_tenant ON sys_louis_ai_governance_rules(tenant_id, is_active);
      -- Default-Seed (idempotent): Löschen grundsätzlich blockieren
      INSERT INTO sys_louis_ai_governance_rules (tenant_id, rule_name, entity_type, action, effect, note, is_active)
      SELECT '1', 'Löschen blockieren (Standard)', NULL, 'DELETE', 'BLOCK', 'Löschvorgänge sind im Louis Smart CRM grundsätzlich blockiert.', TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM sys_louis_ai_governance_rules WHERE tenant_id = '1' AND action = 'DELETE' AND entity_type IS NULL
      );
      -- S10: Seed — Skill-Speicherung nur mit Freigabe (vault_skill CREATE → REQUIRE_APPROVAL); KEINE Regel für vault_memory UPDATE (Default ALLOW)
      INSERT INTO sys_louis_ai_governance_rules (tenant_id, rule_name, entity_type, action, effect, note, is_active)
      SELECT '1', 'Skill-Speicherung nur mit Freigabe (Standard)', 'vault_skill', 'CREATE', 'REQUIRE_APPROVAL', 'Wissens-Skills werden nur nach Freigabe gespeichert.', TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM sys_louis_ai_governance_rules WHERE tenant_id = '1' AND action = 'CREATE' AND entity_type = 'vault_skill'
      );

      -- S9: Sub-Agent-Delegation (isolierte Sub-Contexts, Nachvollziehbarkeit + Audit)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_subtasks (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        parent_session_id TEXT,
        task_prompt TEXT NOT NULL,
        required_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'PENDING',
        result_json JSONB,
        created_at_utc TIMESTAMPTZ DEFAULT NOW(),
        updated_at_utc TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtasks_tenant ON sys_louis_ai_subtasks(tenant_id, status);

      -- S11 Teil A: Delegations-Verifikation (subtask_id + verification an sys_louis_ai_subtasks)
      ALTER TABLE sys_louis_ai_subtasks ADD COLUMN IF NOT EXISTS subtask_id TEXT;
      ALTER TABLE sys_louis_ai_subtasks ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED';
      ALTER TABLE sys_louis_ai_subtasks ADD COLUMN IF NOT EXISTS verification_evidence TEXT;
      CREATE INDEX IF NOT EXISTS idx_subtasks_subtask_id ON sys_louis_ai_subtasks(subtask_id);

      -- S11 Teil B: Watchdog-Cron (job_type/script_path/monitor_* an sys_louis_ai_agent_jobs; Default 'agent' → S7-Altbestand unverändert)
      ALTER TABLE sys_louis_ai_agent_jobs ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'agent';
      --P1-3: Tool-Domänen-Limit pro Job (NULL = alle Domänen, additiv/abwärtskompatibel)
      ALTER TABLE sys_louis_ai_agent_jobs ADD COLUMN IF NOT EXISTS allowed_domains JSONB;
      ALTER TABLE sys_louis_ai_agent_jobs ADD COLUMN IF NOT EXISTS script_path TEXT;
      ALTER TABLE sys_louis_ai_agent_jobs ADD COLUMN IF NOT EXISTS monitor_hash TEXT;
      ALTER TABLE sys_louis_ai_agent_jobs ADD COLUMN IF NOT EXISTS monitor_last_output TEXT;

      -- S11 Teil C: ASK-Governance (persistierte Rückfragen)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_questions (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        question TEXT NOT NULL,
        choices_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        context_text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN',
        answer TEXT,
        created_by TEXT NOT NULL DEFAULT 'ai_assistant',
        created_at_utc TIMESTAMPTZ DEFAULT NOW(),
        answered_at_utc TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_ai_questions_tenant_status ON sys_louis_ai_questions(tenant_id, status);

      -- Notizen an Kontakten/Unternehmen (fehlendes Notiz-Tool, 2026-08-14)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_notes (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'company')),
        entity_id_uuid UUID NOT NULL,
        note_text TEXT NOT NULL,
        priority TEXT DEFAULT 'normal',
        created_by_identity TEXT NOT NULL DEFAULT 'ai_assistant',
        created_at_utc TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ai_notes_entity ON sys_louis_ai_notes(tenant_id, entity_type, entity_id_uuid);

      -- Standard-Vorlagen (Bestand war fast leer, keine 'Standard'-Vorlage)
      -- created_by_identity='seed' ist schema-ungültig
      -- (nur human|ai_assistant|system erlaubt) → getEmailTemplates-Antwort
      -- wird von Zod verworfen → UI zeigt keine Vorlagen. Fix: 'system'.
      INSERT INTO sys_comms_email_templates (id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content, created_by_identity)
      SELECT gen_random_uuid(), '1', 'Standard', '{{subject}}',
        'Sehr geehrte Damen und Herren,\n\n{{body}}\n\nMit freundlichen Grüßen\n{{my_company_name}}\n{{my_contact_person}}',
        'system'
      WHERE NOT EXISTS (SELECT 1 FROM sys_comms_email_templates WHERE template_name_text = 'Standard' AND tenant_id = '1');
      INSERT INTO sys_comms_email_templates (id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content, created_by_identity)
      SELECT gen_random_uuid(), '1', 'Zahlungserinnerung', 'Zahlungserinnerung zu Rechnung {{invoice_number}}',
        'Sehr geehrte Damen und Herren,\n\nwir möchten Sie freundlich an die offene Rechnung {{invoice_number}} über {{total_gross}} {{currency}} erinnern. Der Zahlungstermin war der {{due_date}}.\n\nSollten Sie die Zahlung bereits veranlasst haben, betrachten Sie diese E-Mail als gegenstandslos.\n\nMit freundlichen Grüßen\n{{my_company_name}}',
        'system'
      WHERE NOT EXISTS (SELECT 1 FROM sys_comms_email_templates WHERE template_name_text = 'Zahlungserinnerung' AND tenant_id = '1');
      INSERT INTO sys_comms_email_templates (id_uuid, tenant_id, template_name_text, email_subject_text, email_body_content, created_by_identity)
      SELECT gen_random_uuid(), '1', 'Angebots-E-Mail', 'Ihr Angebot {{offer_number}} vom {{offer_date}}',
        'Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unser Angebot {{offer_number}} über {{total_gross}} {{currency}} mit Zahlungsziel bis zum {{due_date}}.\n\nWir freuen uns auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen\n{{my_company_name}}',
        'system'
      WHERE NOT EXISTS (SELECT 1 FROM sys_comms_email_templates WHERE template_name_text = 'Angebots-E-Mail' AND tenant_id = '1');

      ALTER TABLE sys_louis_ai_workflow_instances ADD COLUMN IF NOT EXISTS current_node_id TEXT DEFAULT NULL;
      ALTER TABLE sys_louis_ai_workflow_instances ADD COLUMN IF NOT EXISTS node_results JSONB DEFAULT '{}'::jsonb;
      --4A T1-Nachtrag (A1): Referenz auf persistierte Rückfrage (PENDING_QUESTION-Resume)
      ALTER TABLE sys_louis_ai_workflow_instances ADD COLUMN IF NOT EXISTS pending_question_id UUID DEFAULT NULL;

      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS short_term_summary_text TEXT DEFAULT '';
      --P0-3: Session-Lineage (additiv, optional — alte Daten bleiben unverändert)
      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS parent_session_id UUID;

      --P2-A: Skill-Suggestions (Backend-Event → persistiert → Chat-Karte)
      CREATE TABLE IF NOT EXISTS sys_louis_ai_skill_suggestions (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        workflow_name TEXT NOT NULL,
        workflow_description TEXT NOT NULL DEFAULT '',
        skill_tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        skill_category TEXT,
        tool_chain_sequence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at_utc TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_skill_suggestions_tenant_status ON sys_louis_ai_skill_suggestions(tenant_id, status);

      -- S1: Volltext-Index für Session-Recall (inkl. Summary — COALESCE wegen NULL-Spalte)
      --: alter Index (JSON::text-Rauschen) wird durch v2 (history_searchable_text) ersetzt.
      DROP INDEX IF EXISTS idx_sys_louis_ai_sessions_fts;

      --P0 (Option B): Recall ohne JSON-Rauschen — IMMUTABLE-Helper extrahiert
      -- NUR die content-Felder aus conversation_history_json; generierte Spalte wird von PG
      -- automatisch gepflegt (kein Schreibpfad-Change). Alte FTS bleibt bis zur Verifikation,
      -- neuer Index (v2) ersetzt sie danach (DROP im Abschluss nach Live-Check).
      CREATE OR REPLACE FUNCTION louis_history_content_text(h JSONB)
      RETURNS TEXT
      LANGUAGE sql
      IMMUTABLE
      AS $$
        SELECT COALESCE(string_agg(elem->>'content', ' '), '')
        FROM jsonb_array_elements(COALESCE(h, '[]'::jsonb)) AS elem
      $$;
      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS history_searchable_text TEXT GENERATED ALWAYS AS (louis_history_content_text(conversation_history_json)) STORED;
      CREATE INDEX IF NOT EXISTS idx_sys_louis_ai_sessions_fts_v2 ON sys_louis_ai_sessions USING GIN (to_tsvector('german', COALESCE(history_searchable_text, '')));
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global';
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS associated_company_id UUID REFERENCES core_registry_companies(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS associated_contact_id UUID REFERENCES core_registry_contacts(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS created_by_identity TEXT NOT NULL DEFAULT 'human';
      ALTER TABLE sys_louis_ai_knowledge_metadata ADD COLUMN IF NOT EXISTS is_verified_by_human BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS scope TEXT DEFAULT 'global';
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS associated_company_id UUID REFERENCES core_registry_companies(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS associated_contact_id UUID REFERENCES core_registry_contacts(id_uuid) ON DELETE CASCADE;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'document';
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS needs_reembedding BOOLEAN DEFAULT FALSE;
      ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN IF NOT EXISTS tsv_chunk_text tsvector GENERATED ALWAYS AS (to_tsvector('german', chunk_text)) STORED;

      -- C.4 (Plan 2026-08-19): Genehmigungs-Queue für Write-Tools auf untrusted-Servern
      CREATE TABLE IF NOT EXISTS sys_mcp_approval_requests (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        server_id_uuid UUID NOT NULL,
        server_name TEXT NOT NULL,
        tool_id_uuid UUID NOT NULL,
        normalized_tool_name TEXT NOT NULL,
        original_tool_name TEXT NOT NULL,
        tool_arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        requested_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        decided_by TEXT,
        decided_at TIMESTAMP WITH TIME ZONE,
        decision_comment TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_approval_requests_pending ON sys_mcp_approval_requests (tenant_id, status, created_at_utc);

      -- C.4 (Regel 12): Timeout für offene Freigabe-Anfragen (Default 120 s, NULL = 120)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS mcp_approval_timeout_s INTEGER;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS mcp_stdio_max_sessions INTEGER;

      -- C.7 (Plan 2026-08-19): Chatprofile — benannte Tool-Sets pro Chat
      CREATE TABLE IF NOT EXISTS sys_mcp_chat_profiles (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        profile_name TEXT NOT NULL,
        description TEXT,
        tools_json JSONB,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_by_user_id TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, profile_name)
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_chat_profiles_tenant ON sys_mcp_chat_profiles (tenant_id);
      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS active_chat_profile_id UUID;
      ALTER TABLE sys_louis_ai_sessions ADD COLUMN IF NOT EXISTS active_mcp_tools_json JSONB;

      -- C.8 (Plan 2026-08-19): History-Archiv je (Session, Chatprofil) — aktive History bleibt in der Session-Spalte
      CREATE TABLE IF NOT EXISTS sys_louis_ai_session_profile_histories (
        session_id UUID NOT NULL,
        chat_profile_id UUID NOT NULL,
        conversation_history_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        short_term_summary_text TEXT DEFAULT '',
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (session_id, chat_profile_id)
      );

      -- C.7: Main-Profil-Seed (pro Tenant einmalig; Main = alle Admin-freigegebenen Tools)
      INSERT INTO sys_mcp_chat_profiles (id_uuid, tenant_id, profile_name, description, tools_json, is_system, is_default)
      SELECT gen_random_uuid(), '1', 'main', 'Alle freigegebenen Tools', NULL, TRUE, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM sys_mcp_chat_profiles WHERE tenant_id = '1' AND profile_name = 'main');

      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv_gin ON sys_louis_ai_knowledge_chunks USING gin (tsv_chunk_text);
      CREATE INDEX IF NOT EXISTS idx_chunks_tenant_scope ON sys_louis_ai_knowledge_chunks (tenant_id, scope);
      CREATE INDEX IF NOT EXISTS idx_chunks_company_scope ON sys_louis_ai_knowledge_chunks (associated_company_id) WHERE associated_company_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_chunks_contact_scope ON sys_louis_ai_knowledge_chunks (associated_contact_id) WHERE associated_contact_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_chunks_reembedding_flag ON sys_louis_ai_knowledge_chunks (needs_reembedding) WHERE needs_reembedding = TRUE;

      CREATE TABLE IF NOT EXISTS sys_louis_ai_reembedding_queue (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        chunk_id UUID NOT NULL REFERENCES sys_louis_ai_knowledge_chunks(id_uuid) ON DELETE CASCADE,
        target_dimension INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_reembed_queue_status ON sys_louis_ai_reembedding_queue (tenant_id, status);

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

      -- Deduplicate core_registry_my_company_table and add UNIQUE constraint on tenant_id
      DO $$
      BEGIN
        DELETE FROM core_registry_my_company_table t1
        WHERE t1.id_uuid IN (
          SELECT id_uuid
          FROM (
            SELECT id_uuid,
                   ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY updated_at_utc DESC, created_at_utc DESC, id_uuid DESC) as rn
            FROM core_registry_my_company_table
          ) t2
          WHERE t2.rn > 1
        );

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_name='core_registry_my_company_table' 
            AND constraint_type='UNIQUE' 
            AND constraint_name='uq_core_registry_my_company_tenant'
        ) THEN
          ALTER TABLE core_registry_my_company_table ADD CONSTRAINT uq_core_registry_my_company_tenant UNIQUE (tenant_id);
        END IF;
      END $$;

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

      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_provider TEXT DEFAULT 'ollama';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_api_key_secret TEXT DEFAULT '';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_base_url TEXT DEFAULT '';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS embedding_model_name TEXT DEFAULT 'nomic-embed-text';
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS vector_dimensions INTEGER DEFAULT 1536;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS keep_alive_minutes INTEGER DEFAULT 5;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS parallel_slots INTEGER DEFAULT 1;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS chunk_size INTEGER DEFAULT 500;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS chunk_overlap INTEGER DEFAULT 50;
      --P0-2: Memory-Budget (Tokens) für die User-Memory-Injektion (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_budget_tokens INTEGER;
      --Task 0: ReAct-Laufzeitparameter (NULL = Backend-Default → Admin-einstellbar, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS max_iterations INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS max_history_tokens INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS tool_result_truncate_chars INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS react_keep_last_results INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS react_compaction_from_iteration INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS early_exit_after_tools INTEGER DEFAULT NULL;
      --B3: Prompt-Direktiven-Modus ('always' = bisheriges Verhalten, 'intent' = nur bei E-Mail-Bezug)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS prompt_directives_mode TEXT DEFAULT 'always';
      --T5: Tool-Call-Modus ('auto' = native mit JSON-Fallback, 'json' = bisheriges Verhalten, 'native' = erzwungen)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS react_tool_call_mode TEXT DEFAULT 'auto';
      -- 2026-08-18: Text-Fallback-Kanal (false = strikt: NUR native Tool-Calls; true = XML/JSON-Text-Fallback erlaubt; NULL = Backend-Default false)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS text_fallback_enabled BOOLEAN DEFAULT NULL;
      --Phase 1 (Parität): Cache-Tier-Architektur (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS prompt_parallel_tool_guidance BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS prompt_tool_guidance_trim BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_frozen_snapshot BOOLEAN DEFAULT NULL;
      --Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_threshold_percent INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_tail_token_budget INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_aux_model TEXT DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_persist_summary BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS compression_model_context_map TEXT DEFAULT NULL;
      --Phase 3 (Parität): Memory (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_prefetch_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_prefetch_timeout_s INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_recall_status_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_auto_scan_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS memory_consolidation_budget INTEGER DEFAULT NULL;
      --Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS tool_call_retry_max INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS empty_retry_budget INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS empty_retry_cost_threshold_usd NUMERIC DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS tool_guardrail_exact_block INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS tool_guardrail_no_progress_block INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS loop_deadline_s INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS thinking_scrub_enabled BOOLEAN DEFAULT NULL;
      --Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS recall_fts_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS recall_search_limit INTEGER DEFAULT NULL;
      --Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS skill_curator_enabled BOOLEAN DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS skill_inject_max_tokens INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS skill_prune_inactive_after_days INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS skill_inject_top_k INTEGER DEFAULT NULL;
      --P1-1 (Parität): Curator-Tick/Archiv (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS curator_interval_hours INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS curator_archive_after_days INTEGER DEFAULT NULL;
      --P1-3 (Parität): Subagent-Spawn-Depth (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS subtask_max_depth INTEGER DEFAULT NULL;
      --P1: Audit-Log-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS audit_retention_days INTEGER DEFAULT NULL;
      --P1: Session-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS session_retention_days INTEGER DEFAULT NULL;
      --Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12)
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS mcp_refresh_interval_s INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS subtask_timeout_s INTEGER DEFAULT NULL;
      ALTER TABLE sys_integrations_louis_ai_config ADD COLUMN IF NOT EXISTS subtask_max_parallel INTEGER DEFAULT NULL;

      --Task 7 (B2): Token-Metriken pro Agent-Lauf (Admin-Ansicht „Token-Verbrauch")
      CREATE TABLE IF NOT EXISTS sys_louis_ai_agent_runs (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        user_id TEXT NOT NULL DEFAULT 'human_user',
        prompt TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        active_tools INTEGER NOT NULL DEFAULT 0,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_created ON sys_louis_ai_agent_runs (tenant_id, created_at_utc DESC);

      -- embedding column is dynamically checked and self-healed on demand
      -- to avoid dropping all embeddings on startup.
      CREATE INDEX IF NOT EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx ON sys_louis_ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS core_registry_companies_embedding_hnsw_idx ON core_registry_companies USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS core_registry_contacts_embedding_hnsw_idx ON core_registry_contacts USING hnsw (embedding vector_cosine_ops);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON sys_louis_ai_knowledge_chunks (document_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tenant_id ON sys_louis_ai_knowledge_chunks (tenant_id);
      CREATE INDEX IF NOT EXISTS idx_companies_name ON core_registry_companies (full_legal_name);
      CREATE INDEX IF NOT EXISTS idx_contacts_name ON core_registry_contacts (full_legal_name);
      CREATE INDEX IF NOT EXISTS idx_invoices_number ON fiscal_billing_invoices (invoice_number);
      
      CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_running_instance_idx 
      ON sys_louis_ai_workflow_instances (workflow_id, tenant_id) 
      WHERE (status = 'RUNNING' OR status = 'PENDING_DELAY');

      CREATE TABLE IF NOT EXISTS sys_comms_offer_templates (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '1',
        template_name TEXT NOT NULL,
        subject_line TEXT NOT NULL,
        introductory_text_template TEXT NOT NULL,
        closing_text_template TEXT NOT NULL,
        default_payment_term TEXT DEFAULT '',
        default_validity_days INTEGER DEFAULT 30,
        default_items_json JSONB DEFAULT '[]'::jsonb,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_comms_offer_text_templates (
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

      CREATE TABLE IF NOT EXISTS core_registry_offers (
        id_uuid UUID PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        offer_number TEXT NOT NULL,
        associated_company_id UUID REFERENCES core_registry_companies(id_uuid) ON DELETE SET NULL,
        associated_contact_id UUID REFERENCES core_registry_contacts(id_uuid) ON DELETE SET NULL,
        title TEXT NOT NULL,
        introductory_text TEXT,
        closing_text TEXT,
        issue_date DATE NOT NULL,
        valid_until DATE NOT NULL,
        payment_term TEXT,
        currency_code TEXT DEFAULT 'EUR',
        is_vat_inclusive BOOLEAN DEFAULT FALSE,
        line_items_json JSONB DEFAULT '[]'::jsonb,
        total_net_amount DECIMAL(15, 2) NOT NULL,
        total_vat_amount DECIMAL(15, 2) NOT NULL,
        total_gross_amount DECIMAL(15, 2) NOT NULL,
        offer_status TEXT DEFAULT 'draft',
        pdf_file_path TEXT,
        created_by_identity TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, offer_number)
      );

      CREATE INDEX IF NOT EXISTS idx_offers_company ON core_registry_offers(associated_company_id);

      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_date ON fiscal_billing_invoices (tenant_id, payment_status, issue_date DESC);
      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_company ON fiscal_billing_invoices (tenant_id, associated_company_id);
      CREATE INDEX IF NOT EXISTS idx_invoices_tenant_contact ON fiscal_billing_invoices (tenant_id, associated_contact_id);

      CREATE INDEX IF NOT EXISTS idx_offers_tenant_status_date ON core_registry_offers (tenant_id, offer_status, issue_date DESC);
      CREATE INDEX IF NOT EXISTS idx_offers_tenant_company ON core_registry_offers (tenant_id, associated_company_id);
      CREATE INDEX IF NOT EXISTS idx_offers_tenant_contact ON core_registry_offers (tenant_id, associated_contact_id);

      CREATE INDEX IF NOT EXISTS idx_contacts_tenant_company ON core_registry_contacts (tenant_id, associated_company_id);
      CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created ON core_registry_contacts (tenant_id, created_at_utc DESC);
      CREATE INDEX IF NOT EXISTS idx_companies_tenant_created ON core_registry_companies (tenant_id, created_at_utc DESC);

      CREATE INDEX IF NOT EXISTS idx_kanban_cards_board_col_pos ON kanban_cards (tenant_id, board_id, column_id, position ASC);
      CREATE INDEX IF NOT EXISTS idx_wf_inst_tenant_status_created ON sys_louis_ai_workflow_instances (tenant_id, status, created_at_utc DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON sys_audit_event_logs (tenant_id, created_at_utc DESC);

      CREATE TABLE IF NOT EXISTS sys_mcp_external_servers (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        server_name TEXT NOT NULL,
        description TEXT,
        transport_type TEXT NOT NULL,
        endpoint_or_command TEXT NOT NULL,
        command_args JSONB DEFAULT '[]'::jsonb,
        env_vars JSONB DEFAULT '{}'::jsonb,
        headers JSONB DEFAULT '{}'::jsonb,
        auth_type TEXT DEFAULT 'none',
        auth_token_encrypted TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        health_status TEXT DEFAULT 'unknown',
        last_ping_at TIMESTAMP WITH TIME ZONE,
        last_error_message TEXT,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_mcp_discovered_tools (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        server_id_uuid UUID REFERENCES sys_mcp_external_servers(id_uuid) ON DELETE CASCADE,
        original_tool_name TEXT NOT NULL,
        normalized_tool_name TEXT NOT NULL,
        description TEXT,
        input_schema JSONB DEFAULT '{}'::jsonb,
        is_enabled_for_louis BOOLEAN DEFAULT TRUE,
        is_enabled_for_ui BOOLEAN DEFAULT TRUE,
        category TEXT DEFAULT 'custom',
        last_discovered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sys_mcp_tool_mappings (
        id_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL DEFAULT '1',
        target_domain TEXT NOT NULL,
        action_type TEXT NOT NULL,
        tool_id_uuid UUID REFERENCES sys_mcp_discovered_tools(id_uuid) ON DELETE CASCADE,
        field_mappings JSONB DEFAULT '{}'::jsonb,
        is_primary BOOLEAN DEFAULT FALSE,
        created_at_utc TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL DEFAULT '1',
        server_id VARCHAR(64) NOT NULL,
        provider VARCHAR(32) NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMP WITH TIME ZONE,
        scopes TEXT[],
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON sys_mcp_external_servers(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON sys_mcp_discovered_tools(server_id_uuid);
      CREATE INDEX IF NOT EXISTS idx_mcp_tools_tenant ON sys_mcp_discovered_tools(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_mappings_domain ON sys_mcp_tool_mappings(tenant_id, target_domain);
      CREATE INDEX IF NOT EXISTS idx_mcp_oauth_tenant_server ON mcp_oauth_tokens(tenant_id, server_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_tools_tenant_server_orig ON sys_mcp_discovered_tools(tenant_id, server_id_uuid, original_tool_name);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_oauth_tenant_server ON mcp_oauth_tokens(tenant_id, server_id);

      -- C.3 (Plan 2026-08-19, PR-6 2026-08-20): MCP-Client-Konfigurationsfelder
      -- (additiv, Defaults = bisheriges Verhalten). NACH den CREATE TABLEs —
      -- bei frischer DB existieren die Tabellen sonst noch nicht (ALTER-vor-
      -- CREATE-Reihenfolge ließ initDatabase crashen → Fallback; Korrektur PR-6).
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS protocol TEXT;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS keepalive_interval_s INTEGER;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS connect_timeout_s INTEGER;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS ssl_verify BOOLEAN;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS client_cert TEXT;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS client_key TEXT;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS custom_headers TEXT;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS supports_parallel_tool_calls BOOLEAN;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS trust TEXT DEFAULT 'full';
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS tools_include_json JSONB;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS tools_exclude_json JSONB;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS idle_timeout_s INTEGER;
      ALTER TABLE sys_mcp_external_servers ADD COLUMN IF NOT EXISTS max_lifetime_s INTEGER;
      ALTER TABLE sys_mcp_discovered_tools ADD COLUMN IF NOT EXISTS readonly_hint BOOLEAN;
    `);
    console.log("PostgreSQL schema initialized with pgvector and audit logs.");

    // Self-healing migration for MCP tables deduplication & unique constraint enforcement
    try {
      await pool.query(`
        DO $$
        BEGIN
          -- Deduplicate mcp_oauth_tokens
          DELETE FROM mcp_oauth_tokens t1
          WHERE t1.id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id, server_id ORDER BY updated_at DESC) as rn
              FROM mcp_oauth_tokens
            ) sub WHERE sub.rn > 1
          );

          -- Deduplicate sys_mcp_discovered_tools
          DELETE FROM sys_mcp_discovered_tools t1
          WHERE t1.id_uuid IN (
            SELECT id_uuid FROM (
              SELECT id_uuid, ROW_NUMBER() OVER (PARTITION BY tenant_id, server_id_uuid, original_tool_name ORDER BY last_discovered_at DESC) as rn
              FROM sys_mcp_discovered_tools
            ) sub WHERE sub.rn > 1
          );
        END $$;

        CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_oauth_tenant_server ON mcp_oauth_tokens(tenant_id, server_id);
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_tools_tenant_server_orig ON sys_mcp_discovered_tools(tenant_id, server_id_uuid, original_tool_name);
      `);
    } catch (err) {
      console.warn("MCP unique index self-healing notice:", err);
    }

    // Self-healing migration to rename status to offer_status in core_registry_offers if it exists
    try {
      await pool.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 
            FROM information_schema.columns 
            WHERE table_name='core_registry_offers' AND column_name='status'
          ) THEN
            ALTER TABLE core_registry_offers RENAME COLUMN status TO offer_status;
          END IF;
        END $$;
      `);
    } catch (err) {
      console.error("Migration to rename status to offer_status failed:", err);
    }

    // Self-healing migration to ensure all columns exist on core_registry_offers
    try {
      await pool.query(`
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS introductory_text TEXT;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS closing_text TEXT;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS payment_term TEXT;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'EUR';
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS is_vat_inclusive BOOLEAN DEFAULT FALSE;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS line_items_json JSONB DEFAULT '[]'::jsonb;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS pdf_file_path TEXT;
        ALTER TABLE core_registry_offers ADD COLUMN IF NOT EXISTS created_by_identity TEXT DEFAULT 'human';
      `);
    } catch (err) {
      console.error("Migration to add columns to core_registry_offers failed:", err);
    }

    await runSeeding(pool, '1');

    // Self-healing migration to clean up any legacy payment statuses and offer statuses to canonical values
    await pool.query(`
      ALTER TABLE kanban_cards ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'todo';

      UPDATE fiscal_billing_invoices 
      SET payment_status = 'issued' 
      WHERE payment_status = 'pending' OR payment_status = 'open' OR payment_status = 'unpaid';

      UPDATE core_registry_offers SET offer_status = 'draft' WHERE offer_status = 'not_sent';
      UPDATE core_registry_offers SET offer_status = 'rejected' WHERE offer_status = 'declined';
      UPDATE kanban_cards SET status = 'todo' WHERE status IS NULL;
    `);

    // Self-healing migration to normalize any legacy or incorrect UUID tenant_id values to '1' across ALL tables dynamically
    try {
      await pool.query(`
        DO $mig_tenant$
        DECLARE
          t_name text;
        BEGIN
          -- Clean up duplicate default seeded configurations to avoid UNIQUE constraint violations during update
          BEGIN
            DELETE FROM sys_integrations_louis_ai_config WHERE tenant_id = '1' AND EXISTS (SELECT 1 FROM sys_integrations_louis_ai_config WHERE tenant_id <> '1');
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_integrations_text_generator_config WHERE tenant_id = '1' AND EXISTS (SELECT 1 FROM sys_integrations_text_generator_config WHERE tenant_id <> '1');
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_integrations_web_search_config WHERE tenant_id = '1' AND EXISTS (SELECT 1 FROM sys_integrations_web_search_config WHERE tenant_id <> '1');
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_integrations_telegram_config WHERE tenant_id = '1' AND EXISTS (SELECT 1 FROM sys_integrations_telegram_config WHERE tenant_id <> '1');
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_integrations_stt_config WHERE tenant_id = '1' AND EXISTS (SELECT 1 FROM sys_integrations_stt_config WHERE tenant_id <> '1');
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM fiscal_billing_invoices i1
            WHERE i1.tenant_id = '1'
              AND EXISTS (
                SELECT 1 FROM fiscal_billing_invoices i2
                WHERE i2.tenant_id <> '1' AND i2.invoice_number = i1.invoice_number
              );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_louis_ai_custom_workflows w1
            WHERE w1.tenant_id = '1'
              AND EXISTS (
                SELECT 1 FROM sys_louis_ai_custom_workflows w2
                WHERE w2.tenant_id <> '1' AND w2.workflow_name = w1.workflow_name
              );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM sys_louis_ai_user_memory m1
            WHERE m1.tenant_id = '1'
              AND EXISTS (
                SELECT 1 FROM sys_louis_ai_user_memory m2
                WHERE m2.tenant_id <> '1' AND m2.user_id = m1.user_id
              );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          BEGIN
            DELETE FROM core_registry_my_company_table
            WHERE id_uuid = '00000000-0000-4000-8000-000000000000'
              AND EXISTS (
                SELECT 1 FROM core_registry_my_company_table
                WHERE id_uuid <> '00000000-0000-4000-8000-000000000000'
              );
          EXCEPTION WHEN OTHERS THEN NULL;
          END;

          -- Dynamic loops to perform tenant ID updates
          FOR t_name IN 
            SELECT c.table_name 
            FROM information_schema.columns c
            JOIN information_schema.tables t ON c.table_name = t.table_name AND c.table_schema = t.table_schema
            WHERE c.column_name = 'tenant_id' 
              AND c.table_schema = 'public' 
              AND t.table_type = 'BASE TABLE'
          LOOP
            BEGIN
              EXECUTE format('UPDATE %I SET tenant_id = %L WHERE tenant_id IS NULL', t_name, '1');
            EXCEPTION WHEN OTHERS THEN
              RAISE WARNING 'Could not update tenant_id in table %: %', t_name, SQLERRM;
            END;
          END LOOP;
        END $mig_tenant$;
      `);
      console.log("[db] Dynamic self-healing tenant_id migration completed for PostgreSQL.");
    } catch (tenantMigErr) {
      console.warn("PostgreSQL dynamic self-healing tenant_id migration failed:", tenantMigErr);
    }

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
            offer_number_prefix, offer_number_year_fixed, offer_number_next_seq, offer_number_min_digits,
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
            COALESCE(NEW.offer_number_prefix, 'AN-'), COALESCE(NEW.offer_number_year_fixed, TRUE),
            COALESCE(NEW.offer_number_next_seq, 1), COALESCE(NEW.offer_number_min_digits, 4),
            NEW.metadata, NEW.created_by_identity, NEW.ai_confidence_score, NEW.is_verified_by_human,
            COALESCE(NEW.created_at_utc, CURRENT_TIMESTAMP), COALESCE(NEW.updated_at_utc, CURRENT_TIMESTAMP),
            NEW.contacts_display_columns_json, NEW.companies_display_columns_json
          )
          ON CONFLICT (tenant_id) DO UPDATE SET
            full_legal_name = EXCLUDED.full_legal_name,
            short_code = EXCLUDED.short_code,
            tax_vat_id = EXCLUDED.tax_vat_id,
            tax_number = EXCLUDED.tax_number,
            responsible_person = EXCLUDED.responsible_person,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            salutation = EXCLUDED.salutation,
            gender_identity = EXCLUDED.gender_identity,
            date_of_birth = EXCLUDED.date_of_birth,
            region = EXCLUDED.region,
            street = EXCLUDED.street,
            house_number = EXCLUDED.house_number,
            postal_code = EXCLUDED.postal_code,
            city = EXCLUDED.city,
            country_code = EXCLUDED.country_code,
            email_address = EXCLUDED.email_address,
            email_2 = EXCLUDED.email_2,
            website = EXCLUDED.website,
            phone_number = EXCLUDED.phone_number,
            mobile_number = EXCLUDED.mobile_number,
            fax_number = EXCLUDED.fax_number,
            iban = EXCLUDED.iban,
            bic_swift = EXCLUDED.bic_swift,
            bank_name = EXCLUDED.bank_name,
            leitweg_id = EXCLUDED.leitweg_id,
            payment_term = EXCLUDED.payment_term,
            price_list = EXCLUDED.price_list,
            custom_documents = EXCLUDED.custom_documents,
            vat_rate = EXCLUDED.vat_rate,
            currency_code = EXCLUDED.currency_code,
            language = EXCLUDED.language,
            invoice_number_prefix = EXCLUDED.invoice_number_prefix,
            invoice_number_year_fixed = EXCLUDED.invoice_number_year_fixed,
            invoice_number_next_seq = EXCLUDED.invoice_number_next_seq,
            invoice_number_min_digits = EXCLUDED.invoice_number_min_digits,
            offer_number_prefix = EXCLUDED.offer_number_prefix,
            offer_number_year_fixed = EXCLUDED.offer_number_year_fixed,
            offer_number_next_seq = EXCLUDED.offer_number_next_seq,
            offer_number_min_digits = EXCLUDED.offer_number_min_digits,
            logo_url = EXCLUDED.logo_url,
            raw_source_data = EXCLUDED.raw_source_data,
            metadata = EXCLUDED.metadata,
            contacts_display_columns_json = EXCLUDED.contacts_display_columns_json,
            companies_display_columns_json = EXCLUDED.companies_display_columns_json,
            updated_at_utc = CURRENT_TIMESTAMP;
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
              offer_number_prefix = NEW.offer_number_prefix,
              offer_number_year_fixed = NEW.offer_number_year_fixed,
              offer_number_next_seq = NEW.offer_number_next_seq,
              offer_number_min_digits = NEW.offer_number_min_digits,
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

    // DAG als einziger Workflow-Pfad.
    // ABWÄRTSKOMPATIBILITÄT: Bestands-Workflows OHNE dag_structure werden beim
    // App-Start automatisch aus tool_chain_sequence zu DAGs konvertiert (idempotent,
    // NUR fehlende DAGs — bestehende bleiben unangetastet, nichts wird gelöscht).
    try {
      const legacyRes = await pool.query(
        "SELECT id_uuid, workflow_name, tool_chain_sequence, dag_structure FROM sys_louis_ai_custom_workflows WHERE dag_structure IS NULL"
      );
      let migrated = 0;
      for (const row of legacyRes.rows) {
        let seq: Array<{ tool: string; instruction: string }> = [];
        try {
          seq = typeof row.tool_chain_sequence === "string"
            ? JSON.parse(row.tool_chain_sequence)
            : (row.tool_chain_sequence || []);
        } catch {
          continue; // unparsbar — unangetastet lassen
        }
        if (!Array.isArray(seq) || seq.length === 0) continue;
        // Linear → DAG (Kette; identisch zur lib-dagMappers.linearToDag-Logik)
        const nodes = seq.map((step, i) => ({
          node_id: `step_${i + 1}`,
          name: String(step?.tool || `Schritt ${i + 1}`),
          type: "ACTION",
          tool_identifier: String(step?.tool || ""),
          instructions_template: String(step?.instruction || ""),
          next_node_ids: i < seq.length - 1 ? [`step_${i + 2}`] : []
        }));
        const dag = {
          workflow_id: String(row.id_uuid || ""),
          title: String(row.workflow_name || "Workflow"),
          is_active: true,
          start_node_id: nodes.length > 0 ? nodes[0].node_id : "",
          nodes
        };
        await pool.query(
          "UPDATE sys_louis_ai_custom_workflows SET dag_structure = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2",
          [JSON.stringify(dag), row.id_uuid]
        );
        migrated++;
      }
      if (migrated > 0) {
        console.log(`[db] Abwärtskompatibilität: ${migrated} Legacy-Workflow(s) automatisch zu DAGs migriert (tool_chain_sequence → dag_structure).`);
      }
    } catch (migErr) {
      console.warn("[db] Legacy-Workflow-DAG-Migration fehlgeschlagen (unschädlich):", migErr);
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
    return;
  }
  await runSeeding(pool, '1');
}

// ============================================================================
// Event-Disziplin — Audit-Log NUR CRUD/Governance (Regel)
// ----------------------------------------------------------------------------
// Problem (2026-08-19): Telemetrie-Events (AGENT_PIPELINE_OPTIMIZED_EXECUTE,
// MEMORY_SYNC, TELEMETRY, AGENT_JOB*, SUB_TASK, RUN_WORKFLOW*, ERROR, …)
// blähten das Audit-Log auf (4.827 Einträge, davon ≈2.290 Telemetrie = 47 %).
// Lösung: ALLOWLIST — nur Compliance-relevante Event-Typen werden persistiert;
// alles andere wird verworfen (console.debug für Transparenz, kein DB-Write).
// Neue Event-Typen müssen hier BEWUSST ergänzt werden (Allowlist-Prinzip).
// ============================================================================

/** Audit-würdige Event-Typen (CRUD + Governance) — Allowlist. */
export const AUDIT_WORTHY_EVENT_TYPES: ReadonlySet<string> = new Set([
  // CRUD
  "CREATE", "UPDATE", "DELETE",
  "CREATE_DRAFT", "UPDATE_DRAFT",
  "CREATE_BOARD",
  "CREATE_NOTE", "UPDATE_NOTE", "DELETE_NOTE",
  "CREATE_USER", "UPDATE_USER", "DELETE_USER",
  "UPLOAD_KNOWLEDGE", "DELETE_KNOWLEDGE",
  "FINALIZE",
  "MEMORY_UPDATE",
  "STATUS_CORRECTION",
  // Governance & Konfiguration
  "GOVERNANCE_ASK", "GOVERNANCE_ASK_ANSWERED", "GOVERNANCE_ASK_DELETED",
  "GOVERNANCE_BLOCK", "GOVERNANCE_RULE",
  "UPDATE_CONFIG"
]);

/** Prüft, ob ein Event-Typ ins Compliance-Audit-Log gehört (Allowlist). */
export function isAuditWorthyEvent(eventType: string): boolean {
  return AUDIT_WORTHY_EVENT_TYPES.has(eventType);
}

export async function logAuditEvent(event: {
  tenantId: string;
  eventType: string;
  entityType: string;
  entityId?: string;
  eventDetails?: string;
  actorIdentity: string;
}) {
 // P0: Telemetrie-/System-Events nicht ins Compliance-Audit schreiben.
  if (!isAuditWorthyEvent(event.eventType)) {
    console.debug(`[Audit] Event '${event.eventType}' übersprungen (nicht audit-würdig): ${event.eventDetails || ""}`);
    return;
  }
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

// ============================================================================
// P2: Audit-Log-Prune (Scheduler, opt-in über audit_retention_days)
// ----------------------------------------------------------------------------
// Löscht Audit-Einträge älter als retentionDays in Batches (DELETE mit LIMIT
// ist in PG nicht direkt möglich → CTE über ctid). Idempotent (DELETE ist
// idempotent). Nur PG-Zweig — der Fallback-Store kappt bereits bei 200 und
// ist nicht retention-pflichtig. Rückgabe: Anzahl gelöschter Zeilen.
// ============================================================================

export interface AuditPruneResult {
  pruned: number;
  batches: number;
}

/**
 * Führt die Batch-Lösch-Schleife aus (testbar — queryFn wird injiziert).
 * Löscht Einträge älter als retentionDays in Batches; stoppt, wenn eine
 * Charge < batchSize liefert. CTE über ctid (DELETE mit LIMIT ist in PG
 * nicht direkt möglich). Idempotent: DELETE ist idempotent.
 */
export async function runAuditPruneBatches(
  queryFn: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>,
  tenantId: string,
  retentionDays: number,
  batchSize: number = 500
): Promise<AuditPruneResult> {
  let pruned = 0;
  let batches = 0;
  for (;;) {
    const res = await queryFn(
      `WITH to_delete AS (
         SELECT ctid FROM sys_audit_event_logs
         WHERE tenant_id = $1 AND created_at_utc < NOW() - make_interval(days => $2)
         LIMIT $3
       )
       DELETE FROM sys_audit_event_logs WHERE ctid IN (SELECT ctid FROM to_delete)`,
      [tenantId, retentionDays, batchSize]
    );
    const deleted = res.rowCount ?? 0;
    pruned += deleted;
    batches += 1;
    if (deleted < batchSize) break;
  }
  return { pruned, batches };
}

export async function pruneAuditLogs(
  tenantId: string,
  retentionDays: number,
  batchSize: number = 500
): Promise<AuditPruneResult> {
  if (!retentionDays || retentionDays <= 0 || isUsingFallback || !pool) {
    return { pruned: 0, batches: 0 };
  }
  try {
    const result = await runAuditPruneBatches(
      (sql, params) => pool!.query(sql, params),
      tenantId,
      retentionDays,
      batchSize
    );
    if (result.pruned > 0) {
      // Transparenz: der Prune selbst wird als DELETE-Ereignis auditierbar gemacht
      // (läuft durch die Allowlist — DELETE ist audit-würdig).
      await logAuditEvent({
        tenantId,
        eventType: "DELETE",
        entityType: "audit_log",
        eventDetails: `Prune-Job: ${result.pruned} Einträge älter als ${retentionDays} Tage gelöschtt (${result.batches} Batches)`,
        actorIdentity: "scheduler"
      });
    }
    return result;
  } catch (err) {
    console.error("Failed to prune audit logs:", err);
    return { pruned: 0, batches: 0 };
  }
}

// ============================================================================
// P2: Session-Prune (Scheduler, opt-in über session_retention_days)
// ----------------------------------------------------------------------------
// Kriterium (Plan-Review 038): Aktivität — sys_louis_ai_sessions hat KEINEN
// Ende-Marker (kein ended_at/end_reason). Es werden Sessions gelöscht, deren
// updated_at_utc älter als retentionDays ist (die aktive Session wird bei jeder
// Antwort geupdated → nie älter als retention). Bewusste Abweichung vom Referenz-System
// (der ended_at nutzt) — Aktivität ist das Louis-Äquivalent zu last_activity.
// Kind-Sessions werden VOR dem Löschen verwaist (parent_session_id → NULL,
// bewährtes Muster) — Konsequenz: recall verliert für verwaiste Kinder den
// Eltern-Bezug (bewusste Entscheidung, Referenz-System identisch).
// ============================================================================

export interface SessionPruneResult {
  pruned: number;
  batches: number;
  orphaned: number;
}

/**
 * Batch-Lösch-Schleife für Sessions (testbar — queryFn wird injiziert, wrappbar).
 * Jede Charge: (1) Kinder verwaisten (UPDATE parent→NULL), (2) Batch löschen.
 * Stoppt, wenn eine Charge < batchSize liefert. Idempotent.
 */
export async function runSessionPruneBatches(
  queryFn: (sql: string, params: unknown[]) => Promise<{ rowCount: number | null }>,
  tenantId: string,
  retentionDays: number,
  batchSize: number = 500
): Promise<SessionPruneResult> {
  let pruned = 0;
  let batches = 0;
  let orphaned = 0;
  for (;;) {
    // 1) Kinder der zu löschenden Eltern verwaisten (Muster: parent → NULL)
    const orphan = await queryFn(
      `WITH to_delete AS (
         SELECT id_uuid FROM sys_louis_ai_sessions
         WHERE tenant_id = $1 AND updated_at_utc < NOW() - make_interval(days => $2)
         LIMIT $3
       )
       UPDATE sys_louis_ai_sessions SET parent_session_id = NULL
       WHERE parent_session_id IN (SELECT id_uuid FROM to_delete)`,
      [tenantId, retentionDays, batchSize]
    );
    orphaned += orphan.rowCount ?? 0;
    // 2) Batch löschen (CTE über ctid — DELETE mit LIMIT ist in PG nicht direkt möglich)
    const del = await queryFn(
      `WITH to_delete AS (
         SELECT ctid FROM sys_louis_ai_sessions
         WHERE tenant_id = $1 AND updated_at_utc < NOW() - make_interval(days => $2)
         LIMIT $3
       )
       DELETE FROM sys_louis_ai_sessions WHERE ctid IN (SELECT ctid FROM to_delete)`,
      [tenantId, retentionDays, batchSize]
    );
    const deleted = del.rowCount ?? 0;
    pruned += deleted;
    batches += 1;
    if (deleted < batchSize) break;
  }
  return { pruned, batches, orphaned };
}

export async function pruneSessions(
  tenantId: string,
  retentionDays: number,
  batchSize: number = 500
): Promise<SessionPruneResult> {
  if (!retentionDays || retentionDays <= 0 || isUsingFallback || !pool) {
    return { pruned: 0, batches: 0, orphaned: 0 };
  }
  try {
    const result = await runSessionPruneBatches(
      (sql, params) => pool!.query(sql, params),
      tenantId,
      retentionDays,
      batchSize
    );
    if (result.pruned > 0) {
      await logAuditEvent({
        tenantId,
        eventType: "DELETE",
        entityType: "session",
        eventDetails: `Session-Prune: ${result.pruned} inaktive Sessions (aelter als ${retentionDays} Tage) geloescht, ${result.orphaned} Kinder verwaist (${result.batches} Batches)`,
        actorIdentity: "scheduler"
      });
    }
    return result;
  } catch (err) {
    console.error("Failed to prune sessions:", err);
    return { pruned: 0, batches: 0, orphaned: 0 };
  }
}

// Task 7 (B2): Token-Metriken pro Agent-Lauf persistieren (Admin-Ansicht „Token-Verbrauch")
export async function recordAgentRun(run: {
  tenantId: string;
  userId: string;
  prompt: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  durationMs: number;
  activeTools: number;
}): Promise<void> {
  try {
    if (isUsingFallback || !pool) {
      if (!fallbackStore.agentRuns) fallbackStore.agentRuns = [];
      fallbackStore.agentRuns.unshift({
        id_uuid: uuidv4(),
        tenant_id: run.tenantId,
        user_id: run.userId,
        prompt: run.prompt,
        input_tokens: run.inputTokens,
        output_tokens: run.outputTokens,
        cached_tokens: run.cachedTokens,
        total_tokens: run.totalTokens,
        duration_ms: run.durationMs,
        active_tools: run.activeTools,
        created_at_utc: new Date().toISOString()
      });
      if (fallbackStore.agentRuns.length > 500) fallbackStore.agentRuns = fallbackStore.agentRuns.slice(0, 500);
      saveFallbackStore();
      return;
    }
    await pool.query(
      `INSERT INTO sys_louis_ai_agent_runs (id_uuid, tenant_id, user_id, prompt, input_tokens, output_tokens, cached_tokens, total_tokens, duration_ms, active_tools)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [uuidv4(), run.tenantId, run.userId, run.prompt, run.inputTokens, run.outputTokens, run.cachedTokens, run.totalTokens, run.durationMs, run.activeTools]
    );
  } catch (err) {
    console.error("Failed to record agent run:", err);
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
  const cleaned = { ...row } as unknown as Record<string, unknown>;
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === null) {
      delete cleaned[key];
    }
  }
  if (cleaned.status !== undefined && cleaned.payment_status === undefined && cleaned.offer_status === undefined && cleaned.board_id === undefined) {
    cleaned.payment_status = cleaned.status;
  }
  if (cleaned.payment_status === 'pending') {
    cleaned.payment_status = 'issued';
  }
  if (cleaned.offer_status === 'not_sent') {
    cleaned.offer_status = 'draft';
  }
  if (cleaned.offer_status === 'declined') {
    cleaned.offer_status = 'rejected';
  }
  return cleaned as unknown as T;
}

export function cleanDbRows<T = unknown>(rows: T[]): T[] {
  if (!rows) return [];
  return rows.map(r => cleanDbRow(r));
}


