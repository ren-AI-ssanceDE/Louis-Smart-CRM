import { GoogleGenAI, Type, Schema } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { ModelUsageMetadata } from "../../types.js";
import { generateContentSafe, generateContentUniversal } from "./geminiHelper.js";
import { 
  executeWebSearch, 
  executeLocalKnowledgeSearch, 
  executeCrmDataAnalyst, 
  learnWorkflow,
  getLearnedWorkflows,
  executeTextGenerator,
  executeCreateDraftInvoice,
  executeCreateDraftCompany,
  executeCreateDraftContact,
  executeSendSmtpEmail
} from "./tools.js";
import { validateProposalMathAndSchema, executeCritiqueLoop } from "./critic.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { z } from "zod";

// Typisierte Teilstrukturen zur Vermeidung von losem Wildcard-Typing
export const CompanyProposalSchema = z.object({
  name: z.string().min(1),
  vat_number: z.string().optional(),
  iban: z.string().optional(),
  bic_swift: z.string().optional(),
  city: z.string().optional(),
  street: z.string().optional(),
  zip_code: z.string().optional(),
  country_code: z.string().length(2).optional(),
});

export const ContactProposalSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export const InvoiceProposalSchema = z.object({
  invoice_number: z.string().optional(),
  issue_date: z.string().optional(),
  due_date: z.string().optional(),
  service_date: z.string().optional(),
  vat_rate: z.number().optional(),
  invoice_line_items_json: z.array(z.object({
    description: z.string(),
    quantity: z.number(),
    unit_price: z.number(),
    vat_rate: z.number()
  })).optional(),
  leitweg_id: z.string().optional(),
});

// Zentraler strukturierter Ausgabetyp der AI-Entscheidung
export interface ReActDecision {
  thought: string;
  isComplete: boolean;
  callToolName: 'web_search' | 'local_knowledge' | 'crm_data_analyst' | 'learn_workflow' | 'get_workflows' | 'text_generator' | 'create_draft_invoice' | 'create_draft_company' | 'create_draft_contact' | 'send_smtp_email' | string | null;
  callToolQuery: string | null;
  parallelToolCalls?: {
    toolName: 'web_search' | 'local_knowledge' | 'crm_data_analyst' | 'learn_workflow' | 'get_workflows' | 'text_generator' | 'create_draft_invoice' | 'create_draft_company' | 'create_draft_contact' | 'send_smtp_email' | string;
    toolQuery: string;
  }[] | null;
  finalDraftText: string | null;
  proposedChanges: {
    entity_type: 'companies' | 'contacts' | 'invoices' | 'emails';
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND';
    id_uuid?: string;
    proposed_state: any;
    explanation_rational: string;
  } | null;
}

// Definition des Schemas für das Google GenAI SDK (kein import type für Enums!)
export const getOrchestratorResponseSchema = (): Schema => {
  return {
    type: Type.OBJECT,
    properties: {
      thought: { 
        type: Type.STRING, 
        description: "Gedankengang des Modells über den aktuellen Zustand des ReAct-Loops." 
      },
      isComplete: { 
        type: Type.BOOLEAN, 
        description: "True, wenn die Endantwort bereitsteht oder ein User-Proposal finalisiert wurde." 
      },
      callToolName: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Name des aufzurufenden System-Tools oder dynamischen Workflow-Makros." 
      },
      callToolQuery: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Argumente/Query für das Tool." 
      },
      parallelToolCalls: {
        type: Type.ARRAY,
        nullable: true,
        description: "Liste von mehreren optionalen Tool-Aufrufen, die parallel/asynchron im Backend ausgeführt werden können. Nutze dies, um mehrere Suchen oder Abfragen in einem einzigen Durchlauf auszuführen.",
        items: {
          type: Type.OBJECT,
          properties: {
            toolName: { 
              type: Type.STRING, 
              description: "Name des Tools, z.B. local_knowledge, crm_data_analyst, web_search, etc." 
            },
            toolQuery: { 
              type: Type.STRING, 
              description: "Argumente oder Suchbegriff für das Tool." 
            }
          },
          required: ["toolName", "toolQuery"]
        }
      },
      finalDraftText: { 
        type: Type.STRING, 
        nullable: true, 
        description: "Der finale Antworttext für das Chat-Fenster (in der Benutzersprache)." 
      },
      proposedChanges: {
        type: Type.OBJECT,
        nullable: true,
        description: "Kritischer Änderungsvorschlag für das CRM. Muss vom Nutzer im UI freigegeben werden.",
        properties: {
          entity_type: { 
            type: Type.STRING, 
            enum: ["companies", "contacts", "invoices", "emails"] 
          },
          action: { 
            type: Type.STRING, 
            enum: ["CREATE", "UPDATE", "DELETE", "SEND"] 
          },
          id_uuid: { 
            type: Type.STRING, 
            nullable: true 
          },
          proposed_state: { 
            type: Type.OBJECT, 
            description: "Der bereinigte, typisierte Zustand der Entität nach Schema-Konventionen." 
          },
          explanation_rational: { 
            type: Type.STRING, 
            description: "Warum dieser Vorschlag gemacht wird (Erklärung für das UI)." 
          }
        },
        required: ["entity_type", "action", "proposed_state", "explanation_rational"]
      }
    },
    required: ["thought", "isComplete", "callToolName", "callToolQuery", "finalDraftText", "proposedChanges"]
  };
};

export interface TenantAiConfig {
  id_uuid?: string;
  tenant_id?: string;
  provider_type: "ollama" | "anthropic" | "openai" | "gemini";
  api_key_secret?: string;
  base_url?: string;
  model_name: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_ctx?: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  content: string;
  thought_log?: string | string[];
  proposed_changes?: ReActDecision['proposedChanges'] | null;
  timestamp_utc?: string;
  metrics?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface LearnedWorkflow {
  id_uuid: string;
  workflow_name: string;
  workflow_description?: string;
  description?: string;
  tool_chain_sequence: string | { tool: string; instruction: string }[];
}

export interface WorkflowStepResult {
  stepIndex: number;
  tool: string;
  result: unknown;
}

export interface WorkflowRunOutcome {
  status: 'success' | 'failed';
  workflowName: string;
  totalSteps: number;
  stepsExecuted: { tool: string; status: 'completed' | 'failed' }[];
  finalResultSummary: WorkflowStepResult[];
}

export type ToolResultPayload =
  | string
  | WorkflowRunOutcome
  | Record<string, unknown>
  | Record<string, unknown>[]
  | unknown;

export interface ToolExecutionRecord {
  toolName: string;
  query: string;
  result: ToolResultPayload;
}

export interface ExecutionContext {
  userId: string;
  tenantId: string;
  userMessage: string;
  intent: 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL';
  planningSteps: string[];
  toolResults: ToolExecutionRecord[];
  thoughtLog: string[];
  isComplete: boolean;
  proposedChanges: ReActDecision['proposedChanges'] | null;
  finalDraftText?: string;
  criticFeedback?: string;
}

/**
 * Reads Tenant config from database or fallback Store
 */
export async function getTenantAiConfig(tenantId: string): Promise<TenantAiConfig> {
  if (isUsingFallback) {
    const list: TenantAiConfig[] = fallbackStore.louisAiConfig || [];
    const record = list.find((c) => c.tenant_id === tenantId) || list.find((c) => c.tenant_id === '1');
    if (record) return record;
  } else {
    try {
      const res = await pool.query(
        "SELECT id_uuid, tenant_id, provider_type, api_key_secret, base_url, model_name, temperature, top_p, top_k, num_ctx FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        return res.rows[0];
      }
    } catch (err) {
      console.warn("AI config query failed:", err);
    }
  }

  // Default configuration
  return {
    provider_type: "gemini",
    model_name: "gemini-3.5-flash",
    temperature: 0.2,
    top_p: 0.9,
    top_k: 40,
    num_ctx: 8192
  };
}

/**
 * Primary ReAct Loop orchestrator
 */
export async function runLouisAiFlow(
  tenantId: string,
  userId: string,
  userMessage: string,
  conversationHistory: ConversationMessage[] = [],
  language: string = 'de',
  shortTermSummaryText: string = ''
): Promise<{
  replyText: string;
  thoughtLog: string[];
  proposedChanges: ReActDecision['proposedChanges'] | null;
  sessionId: string;
  metrics?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}> {
  const startTime = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;

  // 1. Get configs
  const config = await getTenantAiConfig(tenantId);
  const provider = (config.provider_type || 'gemini') as "ollama" | "anthropic" | "openai" | "gemini";

  // Clean potential browser-autofill garbage in credentials
  let cleanApiKey = config.api_key_secret?.trim() || '';
  if (cleanApiKey.includes('@') || cleanApiKey === '******') {
    cleanApiKey = '';
  }

  // Check if a key is required for the chosen provider
  const needsApiKey = provider !== 'ollama';
  const apiKeyValue = cleanApiKey;

  if (needsApiKey && !apiKeyValue) {
    return {
      replyText: language === 'de' 
        ? `LOUIS AI ist auf den Provider '${provider.toUpperCase()}' konfiguriert, aber es wurde kein gültiger API-Schlüssel hinterlegt. Bitte pflege deinen API-Schlüssel unter Admin > LOUIS AI Config ein.`
        : `LOUIS AI is configured for ${provider.toUpperCase()}, but no valid API Key was found. Please add the API Key in the settings under Admin > LOUIS AI Config.`,
      thoughtLog: [`System Check: API Key for provider "${provider}" is missing. Aborting early.`],
      proposedChanges: null,
      sessionId: uuidv4()
    };
  }

  // Load user long-term memory & preferences
  let userPreferences = "";
  let userNotesSummary = "";

  if (isUsingFallback) {
    if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
    const memory = fallbackStore.louisAiUserMemory.find(m => m.user_id === userId && m.tenant_id === tenantId);
    if (memory) {
      userPreferences = memory.response_preferences_text || "";
      if (memory.chat_notes_json && memory.chat_notes_json.length > 0) {
        userNotesSummary = (memory.chat_notes_json as { created_at_utc: string; content: string }[]).map(n => `- [${n.created_at_utc.slice(0, 10)}] ${n.content}`).join("\n");
      }
    }
  } else {
    try {
      const memRes = await pool.query(
        "SELECT response_preferences_text, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
        [userId, tenantId]
      );
      if (memRes.rows.length > 0) {
        const row = memRes.rows[0];
        userPreferences = row.response_preferences_text || "";
        const notesList = typeof row.chat_notes_json === 'string' ? JSON.parse(row.chat_notes_json) : row.chat_notes_json || [];
        if (notesList && notesList.length > 0) {
          userNotesSummary = (notesList as { created_at_utc?: string; content?: string }[]).map((n) => `- [${(n.created_at_utc || '').slice(0, 10)}] ${n.content || ''}`).join("\n");
        }
      }
    } catch (err) {
      console.warn("Failed to load user memory for AI flow:", err);
    }
  }

  // Load actual knowledge documents in database and disk
  let dbMetadataFiles: string[] = [];
  if (isUsingFallback || !pool) {
    const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
    dbMetadataFiles = metadata.filter((m: any) => m.tenant_id === tenantId).map((m: any) => m.file_name);
  } else {
    try {
      const res = await pool.query(
        "SELECT file_name FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1",
        [tenantId]
      );
      if (res && res.rows) {
        dbMetadataFiles = res.rows.map((row: any) => String(row.file_name));
      }
    } catch (err) {
      console.warn("Failed to read database metadata files inside runLouisAiFlow:", err);
    }
  }

  let diskFiles: string[] = [];
  try {
    const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
    if (fs.existsSync(KNOWLEDGE_ROOT)) {
      diskFiles = fs.readdirSync(KNOWLEDGE_ROOT);
    }
  } catch (err) {
    console.warn("Failed to read disk files inside runLouisAiFlow:", err);
  }

  const allFiles = Array.from(new Set([...diskFiles, ...dbMetadataFiles]));
  let tenantFilesListStr = "";
  if (allFiles.length > 0) {
    tenantFilesListStr = allFiles
      .map((f) => `- ${f} (${dbMetadataFiles.includes(f) ? "Indiziert im RAG / Suchbereit" : "Hochgeladen"})`)
      .join("\n");
  } else {
    tenantFilesListStr = "Keine Dateien vorhanden.";
  }

  // Define a stable GoogleGenAI instance for downstream tools (like embeddings) if needed
  const ai = new GoogleGenAI({
    apiKey: apiKeyValue || "dummy",
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const modelToUse = config.model_name || (provider === 'gemini' ? "gemini-3.5-flash" : "llama3");

  // Build the context object
  const context: ExecutionContext = {
    userId,
    tenantId,
    userMessage,
    intent: 'GENERAL',
    planningSteps: [],
    toolResults: [],
    thoughtLog: [],
    isComplete: false,
    proposedChanges: null
  };

  context.thoughtLog.push(`Trigger: Received user message in language "${language}"`);

  // Detect Intent via quick model pass or heuristic
  try {
    const promptObj = `
      Analyze the user message and categorize into one of the following main intents:
      - 'DATA_CREATION': User wants to create/insert a new company, contact, or invoice in the CRM
      - 'DATA_CHANGE': User wants to alter, update, or remove an existing item
      - 'ANALYSIS': User wants financial analysis, data aggregations, or reports 
      - 'CUSTOM_TOOL': User wants to automate a custom sequence or use a learned workflow
      - 'GENERAL': Simple question, greeting, general knowledge discussion, or generic assistance

      Message: "${userMessage}"
      Output exactly one word matching the intent string.
    `;
    const intentRes = await generateContentUniversal({
      provider_type: provider,
      model_name: modelToUse,
      api_key_secret: cleanApiKey,
      base_url: config.base_url,
      temperature: 0.1,
      contents: promptObj
    });
    if (intentRes.usageMetadata) {
      const metadata = intentRes.usageMetadata as ModelUsageMetadata;
      inputTokens += metadata.promptTokenCount || metadata.prompt_token_count || 0;
      outputTokens += metadata.candidatesTokenCount || metadata.candidates_token_count || 0;
    }
    const cleaned = intentRes.text?.trim().toUpperCase();
    if (cleaned && ['DATA_CREATION', 'DATA_CHANGE', 'ANALYSIS', 'CUSTOM_TOOL', 'GENERAL'].includes(cleaned)) {
      context.intent = cleaned as 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL';
    }
    context.thoughtLog.push(`Intent Classification: Detected intent taxonomy as "${context.intent}"`);
  } catch (err) {
    context.thoughtLog.push(`Intent Detection Bypass: defaulting to GENERAL (Failure: ${(err as Error).message})`);
  }

  // 2. RUN ReAct Loop (Max 5 rounds)
  let loopCount = 0;
  const maxLoops = 5;

  while (!context.isComplete && loopCount < maxLoops) {
    loopCount++;
    context.thoughtLog.push(`ReAct Iteration [Round ${loopCount}]: Analyzing system states...`);

    // Query learned custom workflows dynamically for Function Calling and Prompt awareness
    let learnedWorkflows: LearnedWorkflow[] = [];
    try {
      learnedWorkflows = await getLearnedWorkflows(tenantId);
    } catch (err) {
      console.warn("Failed to get learned workflows for dynamic tool injection:", err);
    }

    const workflowDeclarations = learnedWorkflows.map((w) => {
      const sanitizedName = `workflow_${w.workflow_name.replace(/[^a-zA-Z0-9_]/g, '_')}`;
      return {
        name: sanitizedName,
        description: `Custom gelerter Workflow: ${w.workflow_name}. Beschreibung: ${w.workflow_description || w.description || 'Keine Beschreibung vorhanden'}.`,
        parameters: {
          type: Type.OBJECT,
          properties: {
            instruction: {
              type: Type.STRING,
              description: "Die spezifische Anweisung oder der Parameter-Input fuer diese custom Workflow-Sequenz."
            }
          },
          required: ["instruction"]
        }
      };
    });

    const activeTools = workflowDeclarations.length > 0
      ? [{ functionDeclarations: workflowDeclarations }]
      : undefined;

    // We formulate a prompt describing the current environment, available tools, history of answers and query.
    // We expect the model to choose either a tool to call or finish.
    const preferredLanguageName = (() => {
      const code = (language || 'de').toLowerCase();
      if (code.startsWith('de')) return 'German / Deutsch';
      if (code.startsWith('fr')) return 'French / Français';
      if (code.startsWith('es')) return 'Spanish / Español';
      if (code.startsWith('it')) return 'Italian / Italiano';
      if (code.startsWith('en')) return 'English';
      return code;
    })();

    const executedToolNames = new Set(context.toolResults.map(r => r.toolName));

    const toolDescriptions = [
      {
        name: "web_search",
        desc: "1. 'web_search': Queries the web via DuckDuckGo scraper (Benchmarking, Vat rates, directories, external validations). Example arguments string format: \"what is standard vat rate in Germany 2026\""
      },
      {
        name: "local_knowledge",
        desc: "2. 'local_knowledge': Scans local uploaded PDF files / documentation blocks in tenant vault via vector semantic similarity index. Use this tool when the query refers to files, documents, inner-CRM notes, uploads, contracts, e-invoice files of a company/contact, or local specifications. Example argument string format: \"Docker Version Weyland-Yutani\" or \"ZUGFeRD layout specs\"."
      },
      {
        name: "crm_data_analyst",
        desc: "3. 'crm_data_analyst': Analyzes and aggregation-queries existing tenant companies, contacts or invoices. Use this to lookup IDs, verify legal structures, or calculate summaries, IBANs, or payment histories. Format: \"Query string to lookup i.e. Muster GmbH or statistical overview\""
      },
      {
        name: "learn_workflow",
        desc: "4. 'learn_workflow': Teaches a custom workflow chain and persists as an automatic recipe sequence."
      },
      {
        name: "get_workflows",
        desc: "5. 'get_workflows': Retrieves learned custom automated layouts."
      },
      {
        name: "text_generator",
        desc: "6. 'text_generator': Fully custom, highly configurable branding and writing engine designed specifically to write CRM context emails, summaries description texts and template revisions. Output follows administrative parameters and structure guidelines perfectly. Format: \"Text instruction or brand writing outline\""
      },
      {
        name: "create_draft_invoice",
        desc: "7. 'create_draft_invoice': Prepares and creates a new compliant invoice draft immediately in the draft storage of the CRM. Expects query to be a fully qualified JSON string representation of the draft properties. Format: \"{\\\"company_id\\\": \\\"uuid\\\", \\\"contact_id\\\": \\\"uuid\\\", \\\"is_vat_inclusive\\\": true/false, \\\"items_list\\\": [{\\\"description\\\": \\\"Text\\\", \\\"quantity\\\": 1, \\\"unit_price\\\": 10, \\\"vat_rate\\\": 19}], \\\"introductory_text\\\": \\\"Hi\\\", \\\"closing_text\\\": \\\"Tschüss\\\", \\\"payment_term\\\": \\\"14\\\"}\""
      },
      {
        name: "create_draft_company",
        desc: "8. 'create_draft_company': Prepares and creates a new unverified company draft immediately in the CRM registry. Expects query to be a fully qualified JSON string representation of the company properties. Format: \"{\\\"full_legal_name\\\": \\\"Muster GmbH\\\", \\\"street\\\": \\\"Musterstr.\\\", \\\"house_number\\\": \\\"4\\\", \\\"postal_code\\\": \\\"12345\\\", \\\"city\\\": \\\"Musterstadt\\\", \\\"email_address\\\": \\\"info@muster.de\\\", \\\"phone_number\\\": \\\"0123-456789\\\", \\\"tax_vat_id\\\": \\\"DE123456789\\\", \\\"tax_number\\\": \\\"12/345/67890\\\"}\""
      },
      {
        name: "create_draft_contact",
        desc: "9. 'create_draft_contact': Prepares and creates a new unverified contact draft immediately in the CRM registry. Expects query to be a fully qualified JSON string representation of the contact properties. Format: \"{\\\"first_name\\\": \\\"Max\\\", \\\"last_name\\\": \\\"Mustermann\\\", \\\"salutation\\\": \\\"Herr\\\", \\\"email_address\\\": \\\"max@muster.de\\\", \\\"phone_number\\\": \\\"0123-456789\\\", \\\"associated_company_id\\\": \\\"co-uuid\\\", \\\"street\\\": \\\"Musterstr.\\\", \\\"house_number\\\": \\\"4\\\", \\\"postal_code\\\": \\\"12345\\\", \\\"city\\\": \\\"Musterstadt\\\"}\""
      },
      {
        name: "send_smtp_email",
        desc: "10. 'send_smtp_email': Prepares an email draft that will NOT be sent directly but must be proposed to the user for human-in-the-loop review. You MUST finish the ReAct chain (isComplete: true) and propose it via 'proposedChanges' with entity_type 'emails' and action 'SEND'. Can auto-generate and attach invoice PDFs when invoice_id is specified. Can also find and attach documents from the knowledge base or the contact/company vaults by specifying a list of attachments. Expects a fully qualified JSON string representation of the mail parameters, OR can handle unstructured natural language instructions when executed as part of custom automated workflow chains. Format: \"{\\\"recipient_email_address\\\": \\\"receiver@example.com\\\", \\\"email_subject_text\\\": \\\"Mail Subject\\\", \\\"email_body_content\\\": \\\"<strong>HTML or text body</strong>\\\", \\\"invoice_id\\\": \\\"optional-invoice-uuid\\\", \\\"attachments\\\": [{\\\"filename\\\": \\\"document.pdf\\\", \\\"source\\\": \\\"knowledge\\\"}]}\""
      }
    ];

    const activeToolsStr = toolDescriptions
      .filter(td => !executedToolNames.has(td.name))
      .map(td => td.desc)
      .join("\n");

    const dynamicLearnedWorkflowsStr = learnedWorkflows.length > 0
      ? "\n## Learned Workflow Custom Macro-Tools (Already executed workflows are excluded):\n" + learnedWorkflows
          .filter(w => !executedToolNames.has(`workflow_${w.workflow_name.replace(/[^a-zA-Z0-9_]/g, '_')}`))
          .map((w, idx) => `${idx + 11}. 'workflow_${w.workflow_name.replace(/[^a-zA-Z0-9_]/g, '_')}': Gelerter custom Workflow Makro-Schritt. Beschreibung: ${w.workflow_description || w.description || 'Keine Beschreibung'}. Format: "Specific string command instruction query for this custom action sequenced macro"`).join('\n')
      : '';

    const earlyExitDirective = (loopCount > 1 && context.toolResults.length > 0)
      ? `
      🚨🚨🚨 SYSTEM EARLY-EXIT COMPULSION MANDATE 🚨🚨🚨
      You have already run primary CRM or Knowledge Vault searches (which yielded results).
      The user's query can now be answered completely and robustly with the existing results.
      You are STRICTLY FORBIDDEN from calling any more tools.
      You MUST terminate the ReAct loop now:
      - Set "isComplete" to true
      - Set "callToolName" to null and "callToolQuery" to null
      - Assemble and write your complete final response directly in "finalDraftText" in ${preferredLanguageName}.
      `
      : '';

    const loopPrompt = `
      You are the Orchestrator (Louis Visionary), the master brain of LOUIS AI in Louis Smart CRM.
      You are running inside a ReAct reasoning-acting loop (Round ${loopCount} of ${maxLoops}).
      
      ## Active Context:
      - Tenant ID: "${context.tenantId}"
      - User's primary message: "${context.userMessage}"
      - Context Intent: "${context.intent}"
      - Preferred language output: "${preferredLanguageName}"
 
      # 🧠 ACTIVE COGNITIVE MEMORY SYSTEM
 
      ## 1. KURZZEIT-KONTEXT (Deterministisch generiertes Gesamt-Sitzungswissen):
      ${shortTermSummaryText || "Kein aktiver Verlaufskontext vorhanden."}
 
      ## 2. LANGZEIT-PREFERENZEN (Ständige administrative Tonalitäts- & Antwortvorgaben):
      ${userPreferences || "Keine spezifischen Präferenzen konfiguriert."}
 
      ## 3. HISTORISCHE USER-FAKTEN (Gelerntes Wissen aus früheren CRM-Sitzungen):
      ${userNotesSummary || "Keine historischen Notizen vorhanden."}
 
      ## 4. DATEIBESTAND DER WISSENSDATENBANK (Die echten, hochgeladenen Wissensdokumente):
      ${tenantFilesListStr || "Keine Dokumente in der Wissensdatenbank abgelegt."}
 
      # 🛠️ SYSTEM-ANWEISUNG ZUR AUTHENTIZITÄT UND SPRACHKONSISTENZ:
      - Du bist LOUIS AI, das hochgradig präzise administrative CRM-Hirn von Louis Smart CRM.
      - Führe deine Antworten ("finalDraftText"), Gedanken ("thought") und Erklärungsvorschläge ("proposedChanges.explanation_rational") konsequent und zwingend in derselben Sprache aus, in der die Anfrage des Benutzers vorliegt bzw. die unter 'Preferred language output' angegeben ist (Zielsprache: ${preferredLanguageName}). Wenn der Benutzer Deutsch spricht, schreibe finalDraftText, thought und explanation_rational vollständig auf Deutsch! Wenn der Benutzer Englisch spricht, antworte vollständig auf Englisch! Übersetze niemals eigenmächtig in eine falsche Sprache.
      - Verwende für Rechnungsbegriffe die regional korrekten Buchhaltungsstandards:
        * DE (German): "USt-IdNr", "Steuernummer", "IBAN", "Leitweg-ID", "Rechnungsdatum", "Leistungsdatum"
        * EN (English): "VAT ID", "Tax Number", "IBAN", "Routing-Identifier", "Invoice Date", "Service Date"
      - Passe deine Sprache, Formulierung und Tonalität präzise den Langzeit-Präferenzen an (z.B. Du vs. Sie, formell vs. informell, Bulletpoints vs. Fließtext).
      - Berücksichtige alle historischen Vereinbarungen und Entitäten aus dem Kurzzeit-Kontext sowie historische User-Fakten, sodass der CRM-Mitarbeiter eine nahtlose, intelligente Zusammenarbeit erfährt, ohne sich wiederholen zu müssen.
 
      ## Conversation History:
      ${JSON.stringify(conversationHistory.slice(-5))}
 
      ## Your previous thinking steps and tool executions:
      ${context.toolResults.map((t, idx) => `[Action #${idx+1}] Tool: ${t.toolName} | Query: ${t.query} | Yield result: ${JSON.stringify(t.result).slice(0, 30000)}`).join("\n")}
 
      ## Available Tools to invoke (Already executed tools are excluded to save tokens and inference effort):
      ${activeToolsStr}
      ${dynamicLearnedWorkflowsStr}

      ${earlyExitDirective}
 
      ## 🚨 CRITICAL ORCHESTRATION RULES FOR LOCAL RAG FILE SEARCH:
      - If the user's inquiry asks about files, attachments, uploaded documents, notes, CRM records, or any target data related to a specific company or contact ("in den Dateien steht...", "welche Docker-Version hat...", "was steht im PDF...", "schau mal im CRM nach Dateien von weyland"), you MUST select 'local_knowledge' as the primary research tool!
      - DO NOT call 'web_search' first or blindly as a fallback when searching for company-internal or CRM-internal records (e.g. Docker Version of a specific CRM registry entry). Only use 'web_search' if the user asks for globally public facts, external validation, or general guidelines. Fictional companies in your database (e.g. Weyland-Yutani) do not have accurate real public web info, they reside strictly in 'local_knowledge' or 'crm_data_analyst'!
      - When invoking 'local_knowledge', write a concise, precise, and targeted 'callToolQuery'. Do not paste conversational sentences. If the user asks "welche Docker Version sie benutzen", query "Docker Version" paired with company key terms like "Docker Version Weyland-Yutani". This allows the keyword-focused Hybrid Semantic ranker to match chunks perfectly!
 
      ## 🚨 CRITICAL DIRECTIVE FOR CRM DATABASE LOOKUPS (PREVENT WEB_SEARCH HIJACKS):
      - If the user's inquiry asks about companies, contacts, or invoices registered in the CRM, or queries like "Welche Unternehmen sind in Berlin registriert?" or "Welche Kontakte sind in Berlin?", you MUST use 'crm_data_analyst' as the primary query tool.
      - NEVER choose 'web_search' to find databases entries, registered companies, or contacts of the tenant. Standard web search on public Google/DuckDuckGo cannot access your CRM database, and choosing it for database-internal search queries is a major logical failure! Use 'crm_data_analyst' first to retrieve matched entities.
 
      ## EXKLUSIVE REGELN ZUR ERSTELLUNG VON UNTERNEHMEN UND KONTAKTEN (CRITICAL EXCLUSIVITY):
      - Bist du aufgefordert, ein UNTERNEHMEN (Company / Firma / GmbH / etc.) anzulegen, darfst du STRENGSTENS NUR das Tool 'create_draft_company' nutzen. Es ist dir ABSOLUT VERBOTEN, zusätzlich 'create_draft_contact' zu verwenden, selbst wenn ein Verantwortlicher, Ansprechpartner oder ein Geburtsdatum im Benutzertext genannt wird!
      - Bist du aufgefordert, einen KONTAKT (Contact / Ansprechpartner / Mitarbeiter / Person) anzulegen, darfst du STRENGSTENS NUR das Tool 'create_draft_contact' nutzen.
      - **WICHTIGE AUSNAHME**: Wird ein KONTAKT neu angelegt ("create_draft_contact"), darf und soll dies auch passieren, wenn dieser Kontakt einem Unternehmen zugeordnet wird (z. B. wenn das Unternehmen im Text genannt wird oder bereits im System existiert). Du darfst und sollst den Kontakt anlegen und ihm – falls vorhanden – die UUID des zugehörigen Unternehmens als 'associated_company_id' zuordnen. Suche bei Bedarf das Unternehmen vorab mit 'crm_data_analyst'! Es ist dir dabei jedoch untersagt, zusätzlich eine neue Firma mittels 'create_draft_company' anzulegen; du darfst den Kontakt nur einer bestehenden/zuvor gesuchten Firma zuordnen.
      - Daten wie ein Geburtsdatum oder ein Verantwortlicher sind für das Schema eines Unternehmens komplett irrelevant und MÜSSEN einfach ignoriert werden!

      ## E-MAIL-VERSANDSICHERHEIT (HUMAN-IN-THE-LOOP MANDATE):
      - Du darfst E-Mails NIEMALS direkt oder eigenmächtig über den SMTP-Node versenden! Jede prepare_smtp_email- oder send_smtp_email-Aktion MUSS zwingend als Vorschlag im 'proposedChanges'-Pfad mit entity_type: 'emails', action: 'SEND' ausgegeben werden, damit der menschliche Nutzer den schließlichen Versand durch Klick auf 'Freigeben' anstoßen kann.

      ## PARALLEL TOOL INVOCATION OPTIMIZATION:
      - If you recognize that multiple tools can be queried independently to resolve the user request faster (e.g. database lookup for existing company via 'crm_data_analyst' AND a 'local_knowledge' search for associated files, or performing a 'crm_data_analyst' and a 'web_search' at the same time), you SHOULD execute them in parallel.
      - Set "parallelToolCalls" to an array of tool call objects, each containing "toolName" and "toolQuery".
      - When using "parallelToolCalls", you can set "callToolName" and "callToolQuery" to null or set them to the first tool in your parallel list as a fallback.
      - Do NOT use parallel sandbox creations (e.g. create_draft_company and create_draft_contact at same time) if they depend on each other.

      If your research is fully complete to resolve the user's intent, you must decide to either:
      A. Finalize with a textual reply because it's a general/analytical question (No data change wanted).
      B. Finalize by proposing a data alteration schema draft (Diff object) because the user wants a CREATE, UPDATE or DELETE operation on companies, contacts, or invoices.

      IMPORTANT RULE: YOU ARE STRICTLY PROHIBITED FROM DIRECTLY WRITING/CREATING/MUTATING records in production tables! Any creation or update MUST remain as a proposal diff inside the "proposedChanges" block for the user to approve physically on screen. EXCEPT for 'create_draft_invoice', 'create_draft_company', and 'create_draft_contact' which are secure design-approved draft creation sandbox tools and directly write a DRAFT-status/unverified model to database.
      
      CRITICAL INSTRUCTION ON "isComplete":
      - Set "isComplete" to true when you want to send your response to the user.
      - If you have already executed one of the sandbox tools ('create_draft_company', etc.) in a previous round, and now want to report the result to the user or ask them for more details/feedback, you MUST set "isComplete" to true and put your response in "finalDraftText".
      - "isComplete" MUST be true if "callToolName" is null. Never set "isComplete" to false if you are not calling a tool.

      Output your planning and action state exactly as a single valid JSON object:
      {
        "thought": "Your internal technical thought log stating why we call a tool or why we can finish and what has been discovered.",
        "isComplete": boolean,
        "callToolName": "web_search" | "local_knowledge" | "crm_data_analyst" | "learn_workflow" | "get_workflows" | "text_generator" | "create_draft_invoice" | "create_draft_company" | "create_draft_contact" | "send_smtp_email" | null,
        "callToolQuery": "String argument input parameter for the tool",
        "parallelToolCalls": [
          { "toolName": "tool_name", "toolQuery": "parameters" }
        ], // Set to an array of objects to run multiple tools in parallel, OR set to null/omit if you only need one or zero tools.
        "finalDraftText": "Your full comprehensive final answer text to present to the user in the selected output language (Must contain your response when isComplete is true!)",
        "proposedChanges": {
          "entity_type": "companies" | "contacts" | "invoices" | "emails",
          "action": "CREATE" | "UPDATE" | "DELETE" | "SEND",
          "id_uuid": "optional-uuid-string-if-updating-or-deleting",
          "proposed_state": {
             // Fully structured fields matching the database schema properties
          },
          "explanation_rational": "Short 1-sentence motivation for the user why this CRM change is drafted"
        } // Set null if no database insert/change is requested
      }
    `;

    try {
      const res = await generateContentUniversal({
        provider_type: provider,
        model_name: modelToUse,
        api_key_secret: cleanApiKey,
        base_url: config.base_url,
        temperature: config.temperature ?? 0.2,
        contents: loopPrompt,
        jsonFormat: true,
        responseSchema: provider === 'gemini' ? getOrchestratorResponseSchema() : undefined,
        tools: activeTools
      });

      if (res.usageMetadata) {
        const metadata = res.usageMetadata as ModelUsageMetadata;
        inputTokens += metadata.promptTokenCount || metadata.prompt_token_count || 0;
        outputTokens += metadata.candidatesTokenCount || metadata.candidates_token_count || 0;
      }

      const decision = safeParseReActDecision(res.text || "{}");
      context.thoughtLog.push(`Orchestrator Thought: "${decision.thought}"`);

      let pChanges = decision.proposedChanges || null;
      if (pChanges) {
        const hasStateProps = pChanges.proposed_state && typeof pChanges.proposed_state === 'object' && Object.keys(pChanges.proposed_state).length > 0;
        const isMutationIntent = context.intent === 'DATA_CREATION' || context.intent === 'DATA_CHANGE';
        
        // Clean out dummy or incomplete proposals generated by the model's schema compliance bias
        if (!hasStateProps || !pChanges.entity_type || !pChanges.action) {
          pChanges = null;
        } else if (!isMutationIntent && pChanges.entity_type !== 'emails') {
          // If the model generated proposal changes for a non-mutation intent (e.g. ANALYSIS/GENERAL),
          // check if it's a genuine database creation or if it's probably a false positive
          const isAskingForCreate = /erstelle|create|add|neu|zufügen/i.test(context.userMessage);
          if (!isAskingForCreate) {
            pChanges = null;
          }
        }
      }

      if (decision.isComplete) {
        context.isComplete = true;
        context.finalDraftText = decision.finalDraftText || "";
        
        // Discard redundant on-screen proposal cards if direct database sandbox mutations have already run successfully
        const sandboxToolExecuted = context.toolResults.some(r => 
          ["create_draft_contact", "create_draft_company", "create_draft_invoice"].includes(r.toolName) &&
          typeof r.result === "string" && r.result.startsWith("Erfolg!")
        );
        if (sandboxToolExecuted) {
          context.proposedChanges = null;
          context.thoughtLog.push(`Orchestrator Cleanup: Discarded redundant proposedChanges because a sandbox draft creation tool completed successfully.`);
        } else {
          context.proposedChanges = pChanges;
        }

        context.thoughtLog.push(`ReAct Loop completed successfully.`);
        break;
      }

      // Determine tools to run in parallel
      const toolsToRun: { toolName: string; toolQuery: string }[] = [];

      if (decision.parallelToolCalls && Array.isArray(decision.parallelToolCalls) && decision.parallelToolCalls.length > 0) {
        for (const tc of decision.parallelToolCalls) {
          if (tc.toolName) {
            toolsToRun.push({
              toolName: tc.toolName,
              toolQuery: tc.toolQuery || ""
            });
          }
        }
      } else if (decision.callToolName) {
        toolsToRun.push({
          toolName: decision.callToolName,
          toolQuery: decision.callToolQuery || ""
        });
      }

      if (toolsToRun.length > 0) {
        context.thoughtLog.push(`Parallel Tool Invocation: Executing ${toolsToRun.length} tools concurrently...`);

        const toolPromises = toolsToRun.map(async (toolSpec) => {
          const { toolName, toolQuery } = toolSpec;
          context.thoughtLog.push(`Executing tool "${toolName}" with query: "${toolQuery}"`);

          // Track and increment frequently used tools telemetry
          try {
            if (isUsingFallback) {
              if (!fallbackStore.louisAiUserMemory) fallbackStore.louisAiUserMemory = [];
              let memory = fallbackStore.louisAiUserMemory.find(m => m.user_id === userId && m.tenant_id === tenantId);
              if (!memory) {
                memory = {
                  id_uuid: uuidv4(),
                  tenant_id: tenantId,
                  user_id: userId,
                  response_preferences_text: '',
                  frequently_used_tools_json: [],
                  chat_notes_json: [],
                  created_at_utc: new Date().toISOString(),
                  updated_at_utc: new Date().toISOString()
                };
                fallbackStore.louisAiUserMemory.push(memory);
              }
              const tools = (memory.frequently_used_tools_json || []) as { tool: string; count: number }[];
              const existingTool = tools.find((t) => t.tool === toolName);
              if (existingTool) {
                existingTool.count++;
              } else {
                tools.push({ tool: toolName, count: 1 });
              }
              memory.frequently_used_tools_json = tools;
              saveFallbackStore();
            } else {
              const memRes = await pool.query(
                "SELECT id_uuid, frequently_used_tools_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
                [userId, tenantId]
              );
              let tools: { tool: string; count: number }[] = [];
              let memId = uuidv4();
              if (memRes.rows.length > 0) {
                memId = memRes.rows[0].id_uuid;
                tools = typeof memRes.rows[0].frequently_used_tools_json === 'string'
                  ? JSON.parse(memRes.rows[0].frequently_used_tools_json)
                  : memRes.rows[0].frequently_used_tools_json || [];
              }
              const existingTool = tools.find((t) => t.tool === toolName);
              if (existingTool) {
                existingTool.count++;
              } else {
                tools.push({ tool: toolName, count: 1 });
              }
              await pool.query(`
                INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, frequently_used_tools_json)
                VALUES ($1, $2, $3, $4::jsonb)
                ON CONFLICT (tenant_id, user_id)
                DO UPDATE SET frequently_used_tools_json = EXCLUDED.frequently_used_tools_json, updated_at_utc = CURRENT_TIMESTAMP
              `, [memId, tenantId, userId, JSON.stringify(tools)]);
            }
          } catch (memErr) {
            console.warn("Telemetry tracking error (non-fatal):", memErr);
          }

          let result: ToolResultPayload = null;
          let allowedToExecute = true;

          if (toolName === "create_draft_company") {
            const alreadyCreatedContact = context.toolResults.some(r => r.toolName === "create_draft_contact") ||
                                           toolsToRun.some(t => t.toolName === "create_draft_contact");
            if (alreadyCreatedContact) {
              context.thoughtLog.push(`Programmatic Guard: Ignored 'create_draft_company' because 'create_draft_contact' was already executed or scheduled in this session.`);
              allowedToExecute = false;
              result = "System-Hinweis: Um einen Kontakt anzulegen, darf NICHT zusätzlich das Tool 'create_draft_company' genutzt werden. Die Erstellung wurde blockiert.";
            } else {
              const isContactIntent = /kontakt|ansprechpartner|mitarbeiter|person\b/i.test(userMessage.toLowerCase()) && !/unternehmen|firma|company|gmbh|co\s+kg|gbr|ag\b/i.test(userMessage.toLowerCase());
              if (isContactIntent) {
                context.thoughtLog.push(`Programmatic Guard: Blocked 'create_draft_company' because query has contact intent and company creation must be ignored.`);
                allowedToExecute = false;
                result = "System-Hinweis: Um einen Kontakt anzulegen, darf NICHT zusätzlich das Tool 'create_draft_company' genutzt werden. Die Erstellung einer separaten Firma wurde blockiert.";
              }
            }
          } else if (toolName === "create_draft_contact") {
            const alreadyCreatedCompany = context.toolResults.some(r => r.toolName === "create_draft_company") ||
                                           toolsToRun.some(t => t.toolName === "create_draft_company");
            if (alreadyCreatedCompany) {
              context.thoughtLog.push(`Programmatic Guard: Ignored 'create_draft_contact' because 'create_draft_company' was already executed or scheduled in this session.`);
              allowedToExecute = false;
              result = "System-Hinweis: Um ein Unternehmen anzulegen, darf NICHT zusätzlich das Tool 'create_draft_contact' genutzt werden. Die Erstellung wurde blockiert.";
            }
          }

          if (allowedToExecute) {
            if (toolName.startsWith("workflow_")) {
              const matched = learnedWorkflows.find(w => `workflow_${w.workflow_name.replace(/[^a-zA-Z0-9_]/g, '_')}` === toolName);
              if (matched) {
                context.thoughtLog.push(`Dynamic Workflow Interceptor: Triggering learned multi-step workflow "${matched.workflow_name}"`);
                
                // 1. Audit Log: RUN_WORKFLOW
                await logAuditEvent({
                  tenantId,
                  eventType: "RUN_WORKFLOW",
                  entityType: "louis_ai_workflow",
                  entityId: matched.id_uuid,
                  eventDetails: `Started workflow execution for "${matched.workflow_name}" with query: "${toolQuery}"`,
                  actorIdentity: userId
                });

                // Parse tool chain sequence
                let steps: { tool: string; instruction: string }[] = [];
                if (Array.isArray(matched.tool_chain_sequence)) {
                  steps = matched.tool_chain_sequence;
                } else if (typeof matched.tool_chain_sequence === 'string') {
                  try {
                    steps = JSON.parse(matched.tool_chain_sequence);
                  } catch (e) {
                    console.warn("Failed to parse tool_chain_sequence string", e);
                  }
                }

                const chainResults: WorkflowStepResult[] = [];
                
                // Execute each step sequentially
                for (let i = 0; i < steps.length; i++) {
                  const step = steps[i];
                  context.thoughtLog.push(`[Workflow step ${i + 1}/${steps.length}] Running sub-tool "${step.tool}"`);
                  
                  let stepResult: unknown = null;
                  const stepQuery = `${step.instruction} ${toolQuery}`.trim();
                  
                  if (step.tool === "web_search" || step.tool === "executeWebSearch") {
                    stepResult = await executeWebSearch(stepQuery, 1, tenantId, ai);
                  } else if (step.tool === "local_knowledge" || step.tool === "executeLocalKnowledgeSearch") {
                    stepResult = await executeLocalKnowledgeSearch(tenantId, stepQuery, ai);
                  } else if (step.tool === "crm_data_analyst" || step.tool === "executeCrmDataAnalyst" || step.tool === "data_architect" || step.tool === "executeDataArchitect") {
                    stepResult = await executeCrmDataAnalyst(tenantId, stepQuery);
                  } else if (step.tool === "text_generator" || step.tool === "executeTextGenerator") {
                    const fullTextQuery = `${step.instruction}\nContext from previous steps:\n${JSON.stringify(chainResults)}\nUser Instructions: ${toolQuery}`;
                    stepResult = await executeTextGenerator(tenantId, fullTextQuery, ai);
                  } else if (step.tool === "create_draft_invoice" || step.tool === "executeCreateDraftInvoice") {
                    stepResult = await executeCreateDraftInvoice(tenantId, stepQuery, userId);
                  } else if (step.tool === "create_draft_company" || step.tool === "executeCreateDraftCompany") {
                    stepResult = await executeCreateDraftCompany(tenantId, stepQuery, userId);
                  } else if (step.tool === "create_draft_contact" || step.tool === "executeCreateDraftContact") {
                    stepResult = await executeCreateDraftContact(tenantId, stepQuery, userId);
                  } else if (step.tool === "send_smtp_email" || step.tool === "executeSendSmtpEmail") {
                    stepResult = await executeSendSmtpEmail(tenantId, stepQuery, userId, ai);
                  } else {
                    stepResult = `Unsupported sub-tool in workflow chain: ${step.tool}`;
                  }

                  chainResults.push({
                    stepIndex: i + 1,
                    tool: step.tool,
                    result: stepResult
                  });
                }

                // 2. Audit Log: RUN_WORKFLOW_SUCCESS
                await logAuditEvent({
                  tenantId,
                  eventType: "RUN_WORKFLOW_SUCCESS",
                  entityType: "louis_ai_workflow",
                  entityId: matched.id_uuid,
                  eventDetails: `Success executing workflow "${matched.workflow_name}" with ${steps.length} steps.`,
                  actorIdentity: userId
                });

                result = {
                  status: "success",
                  workflowName: matched.workflow_name,
                  totalSteps: steps.length,
                  stepsExecuted: chainResults.map(cr => ({ tool: cr.tool, status: "completed" })),
                  finalResultSummary: chainResults
                };
              } else {
                result = `Custom workflow tool "${toolName}" was called but no matching workflow definition was found for tenant.`;
              }
            } else if (toolName === "web_search") {
              result = await executeWebSearch(toolQuery, 1, tenantId, ai);
            } else if (toolName === "local_knowledge") {
              result = await executeLocalKnowledgeSearch(tenantId, toolQuery, ai);
            } else if (toolName === "crm_data_analyst" || toolName === "data_architect") {
              result = await executeCrmDataAnalyst(tenantId, toolQuery);
            } else if (toolName === "learn_workflow") {
              // Teaches standard template chain
              result = await learnWorkflow(tenantId, "Automated AI Recipe", toolQuery, [{tool: "crm_data_analyst", instruction: toolQuery}]);
            } else if (toolName === "get_workflows") {
              result = await getLearnedWorkflows(tenantId);
            } else if (toolName === "text_generator") {
              result = await executeTextGenerator(tenantId, toolQuery, ai);
            } else if (toolName === "create_draft_invoice") {
              result = await executeCreateDraftInvoice(tenantId, toolQuery, userId);
            } else if (toolName === "create_draft_company") {
              result = await executeCreateDraftCompany(tenantId, toolQuery, userId);
            } else if (toolName === "create_draft_contact") {
              result = await executeCreateDraftContact(tenantId, toolQuery, userId);
            } else if (toolName === "send_smtp_email") {
              result = await executeSendSmtpEmail(tenantId, toolQuery, userId, ai);
            } else {
              result = `Unknown tool: ${toolName}`;
            }
          }

          return {
            toolName,
            query: toolQuery,
            result
          };
        });

        const parallelResults = await Promise.all(toolPromises);
        for (const pr of parallelResults) {
          context.toolResults.push(pr);
          context.thoughtLog.push(`Parallel execution of tool "${pr.toolName}" finished. Packed outcome results to executionContext.`);
        }
      } else {
        // Model didn't select a tool. Check if we have finalDraftText we can use anyway to be graceful, or fall back to thought
        if (decision.finalDraftText && decision.finalDraftText.trim().length > 0) {
          context.thoughtLog.push(`Orchestrator returned isComplete: false but without a tool. Utilizing provided finalDraftText: "${decision.finalDraftText.slice(0, 100)}..."`);
          context.isComplete = true;
          context.finalDraftText = decision.finalDraftText;
        } else if (decision.thought && decision.thought.trim().length > 0) {
          context.thoughtLog.push(`Orchestrator returned isComplete: false but without a tool. Utilizing thought log as fallback response: "${decision.thought.slice(0, 100)}..."`);
          context.isComplete = true;
          context.finalDraftText = decision.thought;
        } else {
          context.thoughtLog.push("Warning: Orchestrator failed to select a tool or declare completion. Terminating loop to prevent infinite runs.");
          context.isComplete = true;
          context.finalDraftText = language === 'de' 
            ? "Ich konnte leider keine eindeutigen Werkzeuge zur Abarbeitung der Anfrage wählen." 
            : "Unfortunately, I could not choose a precise tool to execute your task.";
        }
      }

    } catch (err) {
      context.thoughtLog.push(`ReAct Loop Execution Error: ${(err as Error).message}`);
      context.isComplete = true;
      context.finalDraftText = `ReAct running failed: ${(err as Error).message}`;
    }
  }

  // 3. SECURE QA CRITIC GATE
  if (context.proposedChanges) {
    context.thoughtLog.push(`Compliance Check: Proposed changes detected. Invoking Critic Audit Gate...`);
    let val = { isValid: true, errors: [] as string[] };
    if (context.proposedChanges.entity_type !== 'emails') {
      val = validateProposalMathAndSchema(
        context.proposedChanges.entity_type as any,
        context.proposedChanges.action as any,
        context.proposedChanges.proposed_state
      );
    }

    if (!val.isValid) {
      context.thoughtLog.push(`Critic Warning: Mathematical or validation errors found! Errors:\n${val.errors.join("\n")}`);
      // Send errors back as critic feedback so we rewrite or block invalid proposals
      // In a real multi-agent cycle, we'd do a loop. Now, we bypass or polish the text response to explain compliance mismatch.
      
      let errorTitleDe = "⚠️ **Zertifikat-Validierung fehlgeschlagen!** LOUIS AI hat versucht, Daten anzupassen, aber der Entwurf verstößt gegen die GoBD- oder Schema-Sicherheitsregeln:\n";
      let errorTitleEn = "⚠️ **Compliance Validation Mismatch!** LOUIS AI attempted to draft a database change, but the proposal violates financial or Zod validation schemas:\n";
      
      const entityType = context.proposedChanges.entity_type;
      if (entityType === 'companies') {
        errorTitleDe = "⚠️ **Unternehmensdaten-Prüfung fehlgeschlagen!** Der Entwurf für das Unternehmen enthält fehlerhafte oder unvollständige Pflichtfelder:\n";
        errorTitleEn = "⚠️ **Company Schema Validation Failed!** The company draft contains invalid or missing required properties:\n";
      } else if (entityType === 'contacts') {
        errorTitleDe = "⚠️ **Kontaktdaten-Prüfung fehlgeschlagen!** Der Entwurf für den Kontakt enthält fehlerhafte oder unvollständige Pflichtfelder:\n";
        errorTitleEn = "⚠️ **Contact Schema Validation Failed!** The contact draft contains invalid or missing required properties:\n";
      } else if (entityType === 'emails') {
        errorTitleDe = "⚠️ **E-Mail-Entwurf ungültig!** Der Entwurf für den E-Mail-Versand enthält fehlerhafte oder unvollständige Felder:\n";
        errorTitleEn = "⚠️ **Email Draft Invalid!** The outgoing email draft contains invalid or missing fields:\n";
      } else if (entityType === 'invoices') {
        errorTitleDe = "⚠️ **Rechnungs-Validierung fehlgeschlagen!** Die Rechnungs-Berechnung oder Schema-Attribute verstoßen gegen die GoBD- oder steuerlichen Sicherheitsregeln (EN 16931):\n";
        errorTitleEn = "⚠️ **Invoice Tax Compliance Validation Failed!** The draft invoice violates GoBD or European e-invoicing standards (EN 16931):\n";
      }

      context.finalDraftText = (language === 'de' ? errorTitleDe : errorTitleEn) + 
        val.errors.map(e => `- ${e}`).join("\n") + "\n\n" + (language === 'de' 
        ? "Der Änderungsvorschlag wurde blockiert und nicht freigegeben." 
        : "The proposed database mutation was blocked securely.");
      context.proposedChanges = null;
    } else {
      context.thoughtLog.push(`Critic Success: Proposed state passed all mathematical sum assertions and strict Zod validation.`);
      
      // Execute text critique pass for clean summaries
      const summaryPass = await executeCritiqueLoop(
        ai,
        modelToUse,
        userMessage,
        context.finalDraftText || "",
        context.proposedChanges,
        language
      );
      if (summaryPass.promptTokenCount) {
        inputTokens += summaryPass.promptTokenCount;
      }
      if (summaryPass.candidatesTokenCount) {
        outputTokens += summaryPass.candidatesTokenCount;
      }
      context.finalDraftText = summaryPass.correctedDraft;
      context.thoughtLog.push(`Critic Commentary: "${summaryPass.log}"`);
    }
  } else {
    context.thoughtLog.push(`Compliance Check: No proposed data mutations. Clean Q&A output.`);
  }

  // 4. APPEND CLICKABLE SEARCH SOURCES
  const searchSources: { title: string; url: string }[] = [];
  const uniqUrls = new Set<string>();

  for (const toolRes of context.toolResults) {
    if (toolRes.toolName === 'web_search' && typeof toolRes.result === 'string') {
      const text = toolRes.result;
      
      // Parse of formatted DuckDuckGo or SearXNG formats
      // DDG format: Title: <title> \n Snippet: ... \n URL: <url>
      const ddgRegex = /Title:\s*([^\n]+)[\s\S]*?URL:\s*(https?:\/\/[^\s\n]+)/gi;
      let match;
      while ((match = ddgRegex.exec(text)) !== null) {
        const title = match[1].trim();
        const url = match[2].trim();
        if (url && !uniqUrls.has(url)) {
          uniqUrls.add(url);
          searchSources.push({ title, url });
        }
      }
      
      // Secondary fallback general url format
      const genRegex = /([^\n]+)\n[^\n]*\nURL:\s*(https?:\/\/[^\s\n]+)/gi;
      genRegex.lastIndex = 0;
      let genMatch;
      while ((genMatch = genRegex.exec(text)) !== null) {
        const title = genMatch[1].trim();
        const url = genMatch[2].trim();
        if (url && !uniqUrls.has(url)) {
          if (!title.startsWith("Title:") && !title.startsWith("Result #") && !title.startsWith("Snippet:")) {
            uniqUrls.add(url);
            searchSources.push({ title, url });
          }
        }
      }

      // If we still found no sources but there are raw URLs, add them
      if (searchSources.length === 0) {
        const urlRegex = /URL:\s*(https?:\/\/[^\s\n]+)/gi;
        let urlMatch;
        while ((urlMatch = urlRegex.exec(text)) !== null) {
          const url = urlMatch[1].trim();
          if (url && !uniqUrls.has(url)) {
            uniqUrls.add(url);
            searchSources.push({ title: url, url });
          }
        }
      }
    }
  }

  if (searchSources.length > 0 && context.finalDraftText) {
    const sourcesHeader = language === 'de' ? "\n\n### Verwendete Quellen:\n" : "\n\n### Sources used:\n";
    if (!context.finalDraftText.includes(sourcesHeader.trim())) {
      const sourcesList = searchSources.map(s => `- [${s.title}](${s.url})`).join("\n");
      context.finalDraftText = context.finalDraftText.trim() + sourcesHeader + sourcesList;
    }
  }

  return {
    replyText: context.finalDraftText || (language === 'de' ? "Ich konnte leider keine Antwort verfassen." : "I was unable to draft a valid response."),
    thoughtLog: context.thoughtLog,
    proposedChanges: context.proposedChanges,
    sessionId: uuidv4(),
    metrics: {
      durationMs: Date.now() - startTime,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  };
}

/**
 * Ein passives, synchrones Hilfstool zur Sitzungskompression.
 * Wird vor dem Starten der ReAct Schleife aufgerufen, wenn der Verlauf anschwillt.
 */
export async function executePassiveShortTermCompression(
  tenantId: string, 
  history: ConversationMessage[], 
  currentSummaryText: string,
  modelNameSelected?: string
): Promise<string> {
  // Wenn der Verlauf noch kompakt ist (<= 6 Nachrichten), ist keine Kompression erforderlich
  if (history.length <= 6) return currentSummaryText;

  const config = await getTenantAiConfig(tenantId);
  const provider = (config.provider_type || 'gemini') as "ollama" | "anthropic" | "openai" | "gemini";

  // Clean potential browser-autofill garbage
  let cleanApiKey = config.api_key_secret?.trim() || '';
  if (cleanApiKey.includes('@') || cleanApiKey === '******') {
    cleanApiKey = '';
  }

  const modelName = modelNameSelected || config.model_name || (provider === 'gemini' ? 'gemini-3.5-flash' : 'llama3');
  // Wir nehmen alle Nachrichten BIS auf die letzten 4 Turns zur Kompression her.
  // Das sorgt dafür, dass der aktive Chat-Kontext flüssig und ungefiltert bleibt,
  // während alte Informationen in ein stabiles, persistentes Gedächtnis übergehen.
  const oldHistoryToCompress = history.slice(0, -4);

  const summarizationPrompt = `
    Deine Aufgabe ist es, als passives CRM-Gedächtnis-Tool den älteren Teil eines CRM-Chatverlaufes strukturiert zusammenzufassen.
    Konsolidiere alle wichtigen und kritischen Fakten in einer kompakten, leicht zu lesenden Liste.
    
    Elemente, die du unbedingt festhalten musst:
    - Entscheidungen und getroffene Vereinbarungen des Nutzers.
    - Diskutierte Entitäten (Firmennamen, Ansprechpartner, E-Mails, IBANs, etc.).
    - Spezifische finanzielle Summen, Rechnungsnummern oder offene Beträge.
    - Vom Nutzer formulierte, sitzungsinterne Instruktionen.

    Bisherige Zusammenfassung dieses Chats (falls vorhanden):
    "${currentSummaryText || 'Keine bisherige Zusammenfassung vorhanden.'}"

    Zu komprimierender Verlaufsauszug:
    ${JSON.stringify(oldHistoryToCompress)}

    Antworte mit der neuen, konsolidierten und aktualisierten Zusammenfassung auf Deutsch.
    Überschreite keinesfalls 1000 Token. Nutze strukturiertes Markdown.
  `;

  try {
    const response = await generateContentUniversal({
      provider_type: provider,
      model_name: modelName,
      api_key_secret: cleanApiKey,
      base_url: config.base_url,
      temperature: 0.2,
      contents: summarizationPrompt,
    });
    return response.text || currentSummaryText;
  } catch (err) {
    console.warn("Passive short term memory compression tool failed, keeping previous context:", err);
    return currentSummaryText;
  }
}

/**
 * Resiliente Hilfsfunktion zur JSON-Extraktion und Ausfallssicherung (Heuristic Fallback).
 * Fängt unvollständige LLM JSON-Ausgaben oder Markdown-Codeblöcke robust ab.
 */
export function safeParseReActDecision(rawText: string): ReActDecision {
  let cleaned = rawText.trim();
  
  // 1. Bereinigung von Markdown-Blöcken
  const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
  const match = cleaned.match(jsonBlockRegex);
  if (match && match[1]) {
    cleaned = match[1].trim();
  }
  
  try {
    const parsed = JSON.parse(cleaned);
    return parsed as ReActDecision;
  } catch (error) {
    // 2. Heuristisches Suchen nach dem äußersten JSON-Objekt
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const sliced = cleaned.slice(startIdx, endIdx + 1);
        return JSON.parse(sliced) as ReActDecision;
      } catch (nestedError) {
        console.error("Heuristic slicing failed to yield valid JSON Structure. Engaging Safe-Fallback.", nestedError);
      }
    }
    
    // 3. Ausfallsichere Rückfallstruktur
    return {
      thought: "LLM-Parse-Fehler resilient abgefangen. Konvertiere Rohtext in gesichertes Format.",
      isComplete: true,
      callToolName: null,
      callToolQuery: null,
      finalDraftText: rawText,
      proposedChanges: null
    };
  }
}

