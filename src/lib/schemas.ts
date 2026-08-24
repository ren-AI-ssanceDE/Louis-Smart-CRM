import { z } from 'zod';

export const CompanySchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  full_legal_name: z.string().min(1, "legal_name_required").max(255),
  short_code: z.string().trim().max(100).optional().nullable(),
  tax_vat_id: z.string().trim().max(50).optional().nullable(),
  tax_number: z.string().trim().max(50).optional().nullable(),
  responsible_person: z.string().trim().max(100).optional().nullable(),
  street: z.string().trim().optional().nullable(),
  house_number: z.string().trim().max(20).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  country_code: z.string().trim().length(2).default('DE'),
  email_address: z.string().trim().email("invalid_email").optional().nullable().or(z.literal('')),
  email_2: z.string().trim().email("invalid_email").optional().nullable().or(z.literal('')),
  website: z.string().trim().optional().nullable().or(z.literal('')),
  phone_number: z.string().trim().max(50).optional().nullable(),
  mobile_number: z.string().trim().max(50).optional().nullable(),
  fax_number: z.string().trim().max(50).optional().nullable(),
  iban: z.string().trim().max(50).optional().nullable().or(z.literal('')),
  bic_swift: z.string().trim().max(20).optional().nullable().or(z.literal('')),
  bank_name: z.string().trim().max(100).optional().nullable().or(z.literal('')),
  leitweg_id: z.string().max(50).optional().nullable(),
  payment_term: z.string().trim().optional().nullable(),
  price_list: z.string().trim().optional().nullable(),
  custom_documents: z.string().trim().optional().nullable(),
  vat_rate: z.number().nonnegative().default(19),
  currency_code: z.string().default('EUR'),
  labels: z.array(z.string().trim()).default([]),
  opt_in_marketing: z.boolean().default(false),
  opt_in_social_media: z.boolean().default(false),
  opt_in_direct_message: z.boolean().default(false),
  opt_in_sms: z.boolean().default(false),
  opt_in_phone: z.boolean().default(false),
  language: z.string().trim().default('de'),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  raw_source_data: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const MyCompanySchema = CompanySchema.extend({
  first_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().max(100).optional().nullable(),
  salutation: z.string().trim().optional().nullable(),
  gender_identity: z.string().trim().optional().nullable(),
  date_of_birth: z.string().trim().optional().nullable(),
  region: z.string().trim().optional().nullable(),
  invoice_number_prefix: z.string().trim().max(50).optional().nullable(),
  invoice_number_year_fixed: z.boolean().optional().nullable(),
  invoice_number_next_seq: z.number().int().nonnegative().optional().nullable(),
  invoice_number_min_digits: z.number().int().min(1).max(10).optional().nullable(),
  offer_number_prefix: z.string().trim().max(50).optional().nullable(),
  offer_number_year_fixed: z.boolean().optional().nullable(),
  offer_number_next_seq: z.number().int().nonnegative().optional().nullable(),
  offer_number_min_digits: z.number().int().min(1).max(10).optional().nullable(),
  logo_url: z.string().optional().nullable(),
  contacts_display_columns_json: z.string().optional().nullable(),
  companies_display_columns_json: z.string().optional().nullable(),
}).omit({ labels: true, opt_in_marketing: true, opt_in_social_media: true, opt_in_direct_message: true, opt_in_sms: true, opt_in_phone: true });
export const MyCompanyFullSchema = MyCompanySchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const ContactSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  first_name: z.string().trim().max(100).optional().nullable(),
  last_name: z.string().trim().min(1, "last_name_required").max(100),
  full_legal_name: z.string().trim().optional(),
  responsible_person: z.string().trim().max(100).optional().nullable(),
  salutation: z.string().trim().optional().nullable(),
  gender_identity: z.string().trim().optional().nullable(),
  date_of_birth: z.string().trim().optional().nullable(),
  region: z.string().trim().optional().nullable(),
  street: z.string().trim().optional().nullable(),
  house_number: z.string().trim().max(20).optional().nullable(),
  postal_code: z.string().trim().max(20).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  email_address: z.string().trim().email("invalid_email").optional().nullable().or(z.literal('')),
  email_2: z.string().trim().email("invalid_email").optional().nullable().or(z.literal('')),
  website: z.string().trim().optional().nullable().or(z.literal('')),
  phone_number: z.string().trim().max(50).optional().nullable(),
  fax_number: z.string().trim().max(50).optional().nullable(),
  mobile_number: z.string().trim().max(50).optional().nullable(),
  language: z.string().trim().default('de'),
  labels: z.array(z.string().trim()).default([]),
  opt_in_marketing: z.boolean().default(false),
  opt_in_social_media: z.boolean().default(false),
  opt_in_direct_message: z.boolean().default(false),
  opt_in_sms: z.boolean().default(false),
  opt_in_phone: z.boolean().default(false),
  tax_vat_id: z.string().trim().max(50).optional().nullable(),
  iban: z.string().trim().max(50).optional().nullable().or(z.literal('')),
  bic_swift: z.string().trim().max(20).optional().nullable().or(z.literal('')),
  payment_term: z.string().trim().optional().nullable(),
  price_list: z.string().trim().optional().nullable(),
  custom_documents: z.string().trim().optional().nullable(),
  associated_company_id: z.string().uuid().optional().nullable(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  raw_source_data: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const SmtpSettingsSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  smtp_host_name: z.string().min(1),
  smtp_port_number: z.number().int().positive(),
  smtp_user_name: z.string().min(1),
  smtp_password_secret: z.string().min(1),
  is_secure_connection: z.boolean().default(true),
  sender_email_address: z.string().email(),
  sender_display_name: z.string().optional().nullable(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  raw_source_data: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const SmtpSettingsFullSchema = SmtpSettingsSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const SendMailSchema = z.object({
  recipient_email_address: z.string().email(),
  email_subject_text: z.string().min(1),
  email_body_content: z.string().min(1),
  invoiceId: z.string().uuid().optional(),
  offerId: z.string().uuid().optional(),
  customAttachments: z.array(z.object({
    filename: z.string(),
    content: z.string(), // base64 encoded
    contentType: z.string().optional()
  })).optional(),
});

export const InvoiceLineItemSchema = z.object({
  description: z.string(),
  quantity: z.number().nonnegative(),
  unit_price: z.number().nonnegative(),
  vat_rate: z.number().nonnegative(),
  total_net: z.number().nonnegative(),
  unit_code: z.string().optional().default('HUR'),
});

export const InvoicePaymentStatusEnum = z.enum([
  'draft',
  'issued',
  'paid',
  'cancelled',
  'overdue'
]);
export type InvoicePaymentStatus = z.infer<typeof InvoicePaymentStatusEnum>;

export const InvoicePaymentStatusPreprocess = z.preprocess((val) => {
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s === 'pending' || s === 'offen' || s === 'fällig' || s === 'faellig' || s === 'ausstehend' || s === 'issued') return 'issued';
    if (s === 'bezahlt' || s === 'beglichen' || s === 'paid') return 'paid';
    if (s === 'storniert' || s === 'abgebrochen' || s === 'cancelled') return 'cancelled';
    if (s === 'überfällig' || s === 'ueberfaellig' || s === 'overdue') return 'overdue';
    if (s === 'entwurf' || s === 'draft') return 'draft';
  }
  return val;
}, InvoicePaymentStatusEnum);

export const BaseInvoiceSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  invoice_number: z.string().min(1),
  associated_company_id: z.string().uuid().optional().nullable(),
  associated_contact_id: z.string().uuid().optional().nullable(),
  bank_account: z.string().optional().nullable(),
  issue_date: z.string(),
  service_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  payment_term: z.string().optional().nullable(),
  is_vat_inclusive: z.boolean().default(false),
  total_net_amount: z.number().nonnegative(),
  total_vat_amount: z.number().nonnegative(),
  total_gross_amount: z.number().nonnegative(),
  vat_rate: z.number().nonnegative().default(19),
  currency_code: z.string().default('EUR'),
  leitweg_id: z.string().optional().nullable(),
  invoice_line_items: z.array(InvoiceLineItemSchema).default([]),
  introductory_text: z.string().optional().nullable().default(''),
  closing_text: z.string().optional().nullable().default(''),
  payment_status: InvoicePaymentStatusPreprocess.default('issued'),
  status: InvoicePaymentStatusPreprocess.optional(),
  raw_source_data: z.string().optional().nullable(),
  zugferd_xml_metadata: z.string().optional().nullable(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const InvoiceSchema = BaseInvoiceSchema.transform((data) => {
  if (data.status && !data.payment_status) {
    data.payment_status = data.status;
  }
  return data;
});

export const CompanyFullSchema = CompanySchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const ContactFullSchema = ContactSchema.extend({
  company_name: z.string().optional(),
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const InvoiceFullSchema = BaseInvoiceSchema.extend({
  company_name: z.string().optional(),
  contact_full_name: z.string().optional(),
  invoice_line_items_json: z.string().optional(),
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
}).transform((data) => {
  if (data.status && !data.payment_status) {
    data.payment_status = data.status;
  }
  return data;
});

export const EmailTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  email_subject_text: z.string().min(1),
  email_body_content: z.string(),
  // 'seed' = System-Seed-Vorlagen (db.ts: Standard/Zahlungserinnerung/Angebots-E-Mail, idempotent).
  // Fehlt der Wert im Enum, scheitert die komplette Vorlagen-Antwort (UI: „KEINE VORLAGEN GEFUNDEN").
  created_by_identity: z.enum(['human', 'ai_assistant', 'system', 'seed']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const EmailTemplateFullSchema = EmailTemplateSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const SignatureSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  signature_name_text: z.string().min(1),
  signature_body_content: z.string(),
  is_default_signature: z.boolean().default(false),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const SignatureFullSchema = SignatureSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const InvoiceTextTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  template_type_code: z.string().min(1), // Use string to support flexibility but validate with introductory/closing on frontend
  template_body_content: z.string(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const InvoiceTextTemplateFullSchema = InvoiceTextTemplateSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const ItemCategorySchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  category_name_text: z.string().min(1),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const ItemCategoryFullSchema = ItemCategorySchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const InvoiceItemTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  description: z.string().default(''),
  quantity: z.number().nonnegative().default(1),
  unit_price: z.number().nonnegative().default(0),
  vat_rate: z.number().nonnegative().default(19),
  unit_code: z.string().default('HUR'),
  usage_scope: z.enum(['offer', 'invoice', 'both']).default('both'),
  category_id_uuid: z.string().uuid().optional().nullable(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const InvoiceItemTemplateFullSchema = InvoiceItemTemplateSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export type CompanyInput = z.infer<typeof CompanySchema>;
export type ContactInput = z.infer<typeof ContactSchema>;
export type InvoiceInput = z.infer<typeof InvoiceSchema>;
export type EmailTemplateInput = z.infer<typeof EmailTemplateSchema>;
export type SignatureInput = z.infer<typeof SignatureSchema>;
export type InvoiceTextTemplateInput = z.infer<typeof InvoiceTextTemplateSchema>;
export type InvoiceItemTemplateInput = z.infer<typeof InvoiceItemTemplateSchema>;
export type ItemCategoryInput = z.infer<typeof ItemCategorySchema>;

export const LouisAiConfigSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini']),
  api_key_secret: z.string().optional().nullable(),
  base_url: z.string().url().optional().nullable().or(z.literal('')),
  model_name: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0.2),
  top_p: z.number().min(0).max(1).default(0.9),
  top_k: z.number().int().positive().default(40),
  num_ctx: z.number().int().positive().default(8192),
  embedding_provider: z.enum(['ollama', 'openai', 'gemini']).default('ollama'),
  embedding_api_key_secret: z.string().optional().nullable().default(''),
  embedding_base_url: z.string().url().optional().nullable().or(z.literal('')).default(''),
  embedding_model_name: z.string().default('nomic-embed-text'),
  vector_dimensions: z.number().int().positive().default(1536),
  keep_alive_minutes: z.number().int().nonnegative().default(5),
  parallel_slots: z.number().int().positive().default(1),
  chunk_size: z.number().int().positive().default(500),
  chunk_overlap: z.number().int().nonnegative().default(50),
 // Task 0: ReAct-Laufzeitparameter (NULL = Backend-Default, Admin-einstellbar — Regel 12)
  max_iterations: z.number().int().min(1).max(15).nullable().optional(),
  max_history_tokens: z.number().int().min(200).max(8000).nullable().optional(),
  tool_result_truncate_chars: z.number().int().min(200).max(20000).nullable().optional(),
  // C.4 (Plan 2026-08-19, Regel 12): MCP-Genehmigungs-Timeout (s) + stdio-Session-Limit
  mcp_approval_timeout_s: z.number().int().min(5).max(3600).nullable().optional(),
  mcp_stdio_max_sessions: z.number().int().min(1).max(50).nullable().optional(),
  react_keep_last_results: z.number().int().min(1).max(10).nullable().optional(),
  react_compaction_from_iteration: z.number().int().min(2).max(20).nullable().optional(),
  early_exit_after_tools: z.number().int().min(1).max(20).nullable().optional(),
 // B3: Prompt-Direktiven-Modus ('always' default, 'intent' spart Tokens bei Nicht-E-Mail-Requests)
  prompt_directives_mode: z.enum(['always', 'intent']).default('always'),
 // T5: Tool-Call-Modus ('auto' default = native mit JSON-Fallback, 'json' = JSON-Freitext, 'native' = erzwungen)
  react_tool_call_mode: z.enum(['auto', 'json', 'native']).default('auto'),
  // 2026-08-18: Text-Fallback-Kanal (false = strikt/nativ; true = Fallback für Modelle ohne function calling; NULL = Default false)
  text_fallback_enabled: z.boolean().nullable().optional(),
 // P0-2: Memory-Budget (Tokens) für die User-Memory-Injektion (NULL = Backend-Default 800, Regel 12)
  memory_budget_tokens: z.number().int().min(200).max(8000).nullable().optional(),
 // Phase 1 (Parität): Cache-Tier-Architektur (NULL = Backend-Default, Regel 12)
  prompt_parallel_tool_guidance: z.boolean().nullable().optional(),
  prompt_tool_guidance_trim: z.boolean().nullable().optional(),
  memory_frozen_snapshot: z.boolean().nullable().optional(),
 // Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12)
  compression_enabled: z.boolean().nullable().optional(),
  compression_threshold_percent: z.number().int().min(10).max(95).nullable().optional(),
  compression_tail_token_budget: z.number().int().min(2000).max(100000).nullable().optional(),
  compression_aux_model: z.string().nullable().optional(),
  compression_persist_summary: z.boolean().nullable().optional(),
  compression_model_context_map: z.string().nullable().optional(),
 // Phase 3 (Parität): Memory (NULL = Backend-Default, Regel 12)
  memory_prefetch_enabled: z.boolean().nullable().optional(),
  memory_prefetch_timeout_s: z.number().int().min(1).max(30).nullable().optional(),
  memory_recall_status_enabled: z.boolean().nullable().optional(),
  memory_auto_scan_enabled: z.boolean().nullable().optional(),
  memory_consolidation_budget: z.number().int().min(200).max(4000).nullable().optional(),
 // Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12)
  tool_call_retry_max: z.number().int().min(0).max(10).nullable().optional(),
  empty_retry_budget: z.number().int().min(1).max(10).nullable().optional(),
  empty_retry_cost_threshold_usd: z.number().min(0.001).max(1).nullable().optional(),
  tool_guardrail_exact_block: z.number().int().min(1).max(10).nullable().optional(),
  tool_guardrail_no_progress_block: z.number().int().min(1).max(10).nullable().optional(),
  loop_deadline_s: z.number().int().min(10).max(600).nullable().optional(),
  thinking_scrub_enabled: z.boolean().nullable().optional(),
 // Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12)
  recall_fts_enabled: z.boolean().nullable().optional(),
  recall_search_limit: z.number().int().min(1).max(20).nullable().optional(),
 // Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12)
  skill_curator_enabled: z.boolean().nullable().optional(),
  skill_inject_max_tokens: z.number().int().min(200).max(8000).nullable().optional(),
  skill_prune_inactive_after_days: z.number().int().min(7).max(365).nullable().optional(),
  skill_inject_top_k: z.number().int().min(1).max(10).nullable().optional(),
 // P1-1 (Parität): Curator-Tick/Archiv (NULL = Backend-Default, Regel 12)
  curator_interval_hours: z.number().int().min(1).max(720).nullable().optional(),
  curator_archive_after_days: z.number().int().min(7).max(3650).nullable().optional(),
 // P1-3 (Parität): Subagent-Spawn-Depth (NULL = Backend-Default, Regel 12)
  subtask_max_depth: z.number().int().min(1).max(5).nullable().optional(),
 // P1: Audit-Log-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  audit_retention_days: z.number().int().min(1).max(3650).nullable().optional(),
 // P1: Session-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  session_retention_days: z.number().int().min(1).max(3650).nullable().optional(),
 // Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12)
  mcp_refresh_interval_s: z.number().int().min(30).max(3600).nullable().optional(),
  subtask_timeout_s: z.number().int().min(30).max(600).nullable().optional(),
  subtask_max_parallel: z.number().int().min(1).max(5).nullable().optional(),
});

export const TextGeneratorConfigSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  system_prompt: z.string().min(1),
  temperature: z.number().min(0).max(1).default(0.7),
  max_tokens: z.number().int().positive().default(2000),
  model_name: z.string().default('llama3'),
});

export const CustomWorkflowSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  workflow_name: z.string().min(1),
  workflow_description: z.string().min(1),
  tool_chain_sequence: z.array(z.object({
    tool: z.string(),
    instruction: z.string()
  })),
  trigger_type: z.enum(['MANUAL', 'CRM_EVENT', 'TIMER']).default('MANUAL'),
  trigger_config: z.record(z.string(), z.unknown()).nullable().optional(),
  is_active: z.boolean().default(true),
  direct_send_email: z.boolean().default(false).optional(),
  dag_structure: z.record(z.string(), z.unknown()).nullable().optional(),
  // S5: Skill-Metadaten — sonst strippt Zod .object() die Felder aus der tRPC-Antwort
  // Nullable-Pflicht: DB-Spalten ohne NOT-NULL-Default (z.B. skill_category) liefern NULL,
  // z.string.optional akzeptiert kein null -> ZodOutput-Fehler -> getWorkflows leert den Tab.
  skill_description: z.string().nullable().optional(),
  skill_tags: z.array(z.string()).nullable().optional().default([]),
  skill_category: z.string().nullable().optional(),
  skill_version: z.number().int().nullable().optional(),
  skill_pitfalls: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).nullable().optional(),
  created_at_utc: z.string().optional(),
  updated_at_utc: z.string().optional()
});

export const WorkflowInstanceSchema = z.object({
  id_uuid: z.string().optional(),
  tenant_id: z.string().default('1'),
  workflow_id: z.string().nullable().optional(),
  status: z.string().default('RUNNING'),
  initial_payload: z.unknown().nullable().optional(),
  current_step_index: z.number().int().nonnegative().default(0),
  execution_log: z.unknown().optional().nullable(),
  current_node_id: z.string().optional().nullable(),
  node_results: z.record(z.string(), z.unknown()).optional().nullable(),
  execute_at_utc: z.string().or(z.date()).nullable().optional(),
});

export const WorkflowInstanceFullSchema = WorkflowInstanceSchema.extend({
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional(),
});

export const ProposedDiffSchema = z.object({
  entity_type: z.enum([
    'companies', 
    'contacts', 
    'invoices', 
    'emails', 
    'offers',
    'kanban_board',
    'kanban_column',
    'kanban_card',
    'vault_skill',
    'note'
  ]),
  id_uuid: z.string().optional().nullable(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SEND', 'MOVE']),
  previous_state: z.record(z.string(), z.unknown()).optional().nullable(),
  proposed_state: z.record(z.string(), z.unknown()),
  explanation_rational: z.string()
});

export const KanbanApprovalSchema = z.object({
  id_uuid: z.string().optional(),
  tenant_id: z.string().default('1'),
  workflow_instance_id: z.string().optional().nullable(),
  entity_type: z.enum(['board', 'column', 'card']),
  action_type: z.enum(['CREATE', 'UPDATE', 'DELETE', 'MOVE']),
  target_id_uuid: z.string().optional().nullable(),
  proposed_payload: z.record(z.string(), z.unknown()),
  explanation_text: z.string().optional().nullable(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING')
});

export const KanbanApprovalFullSchema = KanbanApprovalSchema.extend({
  id_uuid: z.string(),
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const getPendingKanbanApprovalsInputSchema = z.object({}).optional();
export const getPendingKanbanApprovalsOutputSchema = z.array(KanbanApprovalFullSchema);

export const approveKanbanApprovalInputSchema = z.object({
  id_uuid: z.string()
});
export const approveKanbanApprovalOutputSchema = z.object({
  success: z.boolean(),
  applied_id: z.string().optional()
});

export const rejectKanbanApprovalInputSchema = z.object({
  id_uuid: z.string(),
  rejection_reason: z.string().optional()
});
export const rejectKanbanApprovalOutputSchema = z.object({
  success: z.boolean()
});

export const updateKanbanApprovalInputSchema = z.object({
  id_uuid: z.string(),
  proposed_payload: z.record(z.string(), z.unknown()),
  explanation_text: z.string().optional()
});
export const updateKanbanApprovalOutputSchema = z.object({
  success: z.boolean()
});

export const UserMemorySchema = z.object({
  response_preferences_text: z.string().max(2000),
  chat_notes: z.array(z.object({
    id_uuid: z.string().uuid(),
    content: z.string(),
    created_at_utc: z.string()
  })).optional()
});

export const SaveEntityNoteSchema = z.object({
  entity_type: z.enum(['user', 'company', 'contact']),
  entity_id: z.string().uuid().optional(), // Optional for 'user' (uses ctx.userId), mandatory for company/contact
  content: z.string().min(1).max(10000),
  is_rag_indexed: z.boolean().optional()
});

export const WebSearchSettingsSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  selected_engine: z.enum(['duckduckgo', 'searxng', 'google_grounding', 'google_custom_search']).default('duckduckgo'),
  duckduckgo_url: z.string().or(z.literal('')).nullable().optional(),
  searxng_url: z.string().or(z.literal('')).nullable().optional(),
  searxng_categories: z.string().nullable().optional(),
  google_api_key: z.string().or(z.literal('')).nullable().optional(),
  google_cx: z.string().or(z.literal('')).nullable().optional()
});

export const WebSearchSettingsFullSchema = WebSearchSettingsSchema.extend({
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional(),
});

export const TelegramSettingsSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  bot_token: z.string().min(1, "Bot-Token ist erforderlich"),
  allowed_user_ids: z.string().min(1, "Mindestens eine User-ID ist erforderlich"),
  is_active: z.boolean().default(true)
});

export const TelegramSettingsFullSchema = TelegramSettingsSchema.extend({
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional(),
});

export type TelegramSettingsInput = z.infer<typeof TelegramSettingsSchema>;

export const SpeechToTextSettingsSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  stt_provider: z.enum(['disabled', 'local-whisper', 'openai-whisper']).default('disabled'),
  stt_endpoint: z.string().default('http://localhost:8000/v1/audio/transcriptions'),
  stt_api_key: z.string().or(z.literal('')).nullable().optional(),
  stt_model: z.string().default('whisper-1'),
  stt_language: z.string().default('de'),
  stt_prompt: z.string().default('Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices'),
  stt_device: z.enum(['auto', 'cpu', 'cuda']).default('auto'),
  stt_quantization: z.enum(['none', 'float16', 'int8', 'int8_float16']).default('none'),
  stt_unload_llm_on_demand: z.boolean().default(false),
  stt_fallback_on_cpu: z.boolean().default(false),
});

export const SpeechToTextSettingsFullSchema = SpeechToTextSettingsSchema.extend({
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional(),
});

export type SpeechToTextSettingsInput = z.infer<typeof SpeechToTextSettingsSchema>;

export const OfferLineItemSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  position: z.number().int().nonnegative(),
  description: z.string().default(""),
  quantity: z.number().nonnegative(),
  unit_code: z.string().default("PCE"),
  unit_price: z.number().nonnegative(),
  vat_rate: z.number().nonnegative().default(19),
  total_net: z.number().nonnegative(),
  total_gross: z.number().nonnegative(),
  is_text_position: z.boolean().optional()
});

export const OfferStatusEnum = z.enum([
  'draft',
  'sent',
  'accepted',
  'rejected'
]);
export type OfferStatus = z.infer<typeof OfferStatusEnum>;

export const OfferStatusPreprocess = z.preprocess((val) => {
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s === 'not_sent' || s === 'angebot_erstellt' || s === 'entwurf' || s === 'draft') return 'draft';
    if (s === 'gesendet' || s === 'versendet' || s === 'sent') return 'sent';
    if (s === 'angenommen' || s === 'bestätigt' || s === 'bestaetigt' || s === 'accepted') return 'accepted';
    if (s === 'declined' || s === 'abgelehnt' || s === 'storniert' || s === 'rejected') return 'rejected';
  }
  return val;
}, OfferStatusEnum);

export const RawOfferInputSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  associated_company_id: z.string().uuid().optional().nullable(),
  associated_contact_id: z.string().uuid().optional().nullable(),
  title: z.string().min(1),
  introductory_text: z.string().default(""),
  closing_text: z.string().default(""),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payment_term: z.string().default(""),
  currency_code: z.string().default("EUR"),
  is_vat_inclusive: z.boolean().default(false),
  line_items: z.array(OfferLineItemSchema),
  offer_status: OfferStatusPreprocess.default("draft"),
  status: OfferStatusPreprocess.optional()
});

export const OfferInputSchema = RawOfferInputSchema.transform((data) => {
  if (data.status && !data.offer_status) {
    data.offer_status = data.status;
  }
  return data;
});

export const OfferUpdateInputSchema = RawOfferInputSchema.extend({
  id_uuid: z.string().uuid()
}).transform((data) => {
  if (data.status && !data.offer_status) {
    data.offer_status = data.status;
  }
  return data;
});

export const OfferTextTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  template_type_code: z.string().min(1),
  template_body_content: z.string(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const OfferTextTemplateFullSchema = OfferTextTemplateSchema.extend({
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional(),
});

export const OfferFullSchema = RawOfferInputSchema.extend({
  id_uuid: z.string(),
  tenant_id: z.string().default('1'),
  offer_number: z.string().default(''),
  total_net_amount: z.number().default(0),
  total_vat_amount: z.number().default(0),
  total_gross_amount: z.number().default(0),
  pdf_file_path: z.string().nullable().optional(),
  created_by_identity: z.string().default('system'),
  created_at_utc: z.string().or(z.date()).optional(),
  updated_at_utc: z.string().or(z.date()).optional()
});

export const SavedChatNoteSchema = z.object({
  id_uuid: z.string(),
  content: z.string(),
  created_at_utc: z.string().optional(),
  updated_at_utc: z.string().optional(),
  entity_type: z.string().optional(),
  entity_id: z.string().nullable().optional(),
  is_rag_indexed: z.boolean().optional()
});

export const LouisAiUserMemoryFullSchema = z.object({
  id_uuid: z.string(),
  tenant_id: z.string(),
  user_id: z.string(),
  response_preferences_text: z.string().default(""),
  frequently_used_tools_json: z.array(z.union([z.object({ tool: z.string(), count: z.number() }), z.string()])).default([]),
  chat_notes_json: z.array(SavedChatNoteSchema).default([])
});

export type OfferInput = z.infer<typeof OfferInputSchema>;

export const CANONICAL_COUNCIL_ROLES = [
  {
    id: 'contrarian',
    name: 'Der Kontrarian (The Contrarian)',
    systemPrompt: 'Analysiere die Anfrage und konzentriere dich ausschließlich darauf, was schiefgehen wird. Ignoriere positive Aspekte. Liste alle Risiken, Schwachstellen und das schlimmste anzunehmende Szenario (Worst-Case) auf.',
    temperature: 0.4
  },
  {
    id: 'first_principles',
    name: 'Der Grundsatzdenker (The First-Principles Thinker)',
    systemPrompt: 'Hinterfrage jede implizite Annahme in der Anfrage. Zerlege das Problem in seine fundamentalen Wahrheiten und frage dich, ob wir überhaupt versuchen, das richtige Problem zu lösen.',
    temperature: 0.5
  },
  {
    id: 'expansionist',
    name: 'Der Expansionist (The Expansionist)',
    systemPrompt: 'Suche nach ungenutzten Potenzialen, Skalierungsmöglichkeiten und Vorteilen, die der Nutzer komplett übersehen hat. Denke groß und über den aktuellen Tellerrand hinaus.',
    temperature: 0.7
  },
  {
    id: 'outsider',
    name: 'Der Außenseiter (The Outsider)',
    systemPrompt: 'Nimm an, du hättest keinerlei Branchenwissen oder Vorabkontext. Betrachte die Situation völlig naiv und stelle die offensichtlichen, simplen Fragen, die Experten oft übersehen.',
    temperature: 0.6
  },
  {
    id: 'executor',
    name: 'Der Umsetzer (The Executor)',
    systemPrompt: 'Konzentriere dich rein auf die Praxis. Ignoriere graue Theorie. Was sind die konkreten, pragmatischen Schritte, die der Nutzer direkt am nächsten Montagmorgen umsetzen muss?',
    temperature: 0.3
  }
];

export const PEER_REVIEW_SYSTEM_PROMPT = `Du bist ein anonymer Gutachter. Vor dir liegen 5 verschiedene Lösungsansätze für dieselbe Aufgabe. Analysiere diese unabhängig und unvoreingenommen.
1. Welche Antwort ist argumentativ am stärksten und warum?
2. Welche Antwort hat den größten blinden Fleck (Blind Spot)?
3. Welchen entscheidenden Punkt haben alle 5 Antworten bisher komplett übersehen?
4. Erstelle ein rationales Ranking der Antworten von Platz 1 bis 5.`;

export const CHAIRMAN_SYSTEM_PROMPT = `Du bist der Vorsitzende (Chairman) des Expertenrats. Deine Aufgabe ist es nicht, einfach eine Zusammenfassung zu schreiben, sondern eine finale Entscheidung zu treffen.
1. Analysiere die 5 Perspektiven sowie deren gegenseitige Kritik und Bewertungen.
2. Wo herrscht im Council Konsens, wo gibt es unvereinbare Konflikte?
3. Synthetisiere die besten Elemente zu einer finalen, unanfechtbaren Antwort.
4. Beende deine Antwort mit einer klaren, unmissverständlichen Handlungsempfehlung und den nächsten drei Schritten für den Nutzer.`;

export const CouncilMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  systemPrompt: z.string(),
  temperature: z.number().min(0).max(2).default(0.7),
  weight: z.number().min(0).max(10).default(1.0),
  isActive: z.boolean().default(true),
});
export type CouncilMemberInput = z.infer<typeof CouncilMemberSchema>;

export const CouncilProviderSchema = z.object({
  id_uuid: z.string().uuid(),
  name: z.string().min(1),
  provider_type: z.enum(['ollama', 'anthropic', 'openai', 'gemini', 'openrouter', 'custom']),
  api_key_secret: z.string().optional().nullable(),
  base_url: z.string().url().optional().nullable().or(z.literal('')),
  is_active: z.boolean().default(true)
});

export const CouncilSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  defaultMode: z.enum(['multi-role', 'multi-model']).default('multi-role'),
  defaultMaxRounds: z.number().min(1).max(5).default(2),
  providers: z.array(CouncilProviderSchema).max(5).default([]),
  roles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    systemPrompt: z.string(),
    temperature: z.number().min(0).max(2).default(0.7)
  })).default(CANONICAL_COUNCIL_ROLES),
  members: z.array(CouncilMemberSchema).default([]),
  peerReviewSystemPrompt: z.string().default(PEER_REVIEW_SYSTEM_PROMPT),
  peerReviewPrompt: z.string().default(PEER_REVIEW_SYSTEM_PROMPT),
  chairmanSystemPrompt: z.string().default(CHAIRMAN_SYSTEM_PROMPT),
  chairmanPrompt: z.string().default(CHAIRMAN_SYSTEM_PROMPT),
  fallbackProviderId: z.string().optional(),
  fallbackModelId: z.string().optional(),
  availableModels: z.array(z.object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    name: z.string(),
    defaultTemperature: z.number().min(0).max(2).default(0.7)
  })).default([])
});

export type CouncilProviderInput = z.infer<typeof CouncilProviderSchema>;
export type CouncilSettingsInput = z.infer<typeof CouncilSettingsSchema>;

export const CouncilFallbackTierSchema = z.enum(['PRIMARY', 'SECONDARY_LOUIS', 'DETERMINISTIC_FALLBACK']);

export const CouncilFallbackMetadataSchema = z.object({
  usedFallback: z.boolean().default(false),
  originalProviderId: z.string().optional(),
  originalModelId: z.string().optional(),
  actualProviderId: z.string().optional(),
  actualModelId: z.string().optional(),
  fallbackReason: z.string().optional(),
  isDegraded: z.boolean().optional(),
  requestedProvider: z.string().optional(),
  requestedModel: z.string().optional(),
  usedProvider: z.string().optional(),
  usedModel: z.string().optional(),
  fallbackTier: CouncilFallbackTierSchema.optional(),
  latencyMs: z.number().optional(),
  errorMessage: z.string().optional()
});

export const CouncilMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  participantId: z.string(),
  roundNumber: z.number(),
  content: z.string(),
  createdAt: z.string(),
  fallbackMetadata: CouncilFallbackMetadataSchema.optional()
});

export const CouncilSessionSchema = z.object({
  id: z.string(),
  topic: z.string(),
  mode: z.enum(['multi-role', 'multi-model']),
  status: z.enum(['draft', 'active', 'completed']),
  maxRounds: z.number(),
  currentRound: z.number(),
  createdAt: z.string(),
  participants: z.array(z.object({
    id: z.string(),
    name: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    systemPrompt: z.string(),
    temperature: z.number(),
    isDegraded: z.boolean().optional()
  })),
  finalConclusion: z.string().optional(),
  hasDegradedResponses: z.boolean().optional()
});

export const KanbanBoardSchema = z.object({
  id_uuid: z.string().optional(),
  tenant_id: z.string().default('1'),
  title: z.string().min(1, "title_required").max(255),
  description: z.string().optional().nullable(),
  color: z.string().default('#3b82f6'),
  is_default: z.boolean().default(false),
});

export const KanbanBoardFullSchema = KanbanBoardSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const KanbanColumnSchema = z.object({
  id_uuid: z.string().optional(),
  tenant_id: z.string().default('1'),
  board_id: z.string(),
  title: z.string().min(1, "title_required").max(255),
  position: z.number().int().nonnegative().default(0),
  color_accent: z.string().default('#64748b'),
});

export const KanbanColumnFullSchema = KanbanColumnSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const KanbanCardStatusEnum = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'done',
  'blocked',
  'archived'
]);
export type KanbanCardStatus = z.infer<typeof KanbanCardStatusEnum>;

export const KanbanCardStatusPreprocess = z.preprocess((val) => {
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s === 'backlog') return 'backlog';
    if (s === 'offen' || s === 'zu_erledigen' || s === 'open' || s === 'todo') return 'todo';
    if (s === 'in_bearbeitung' || s === 'bearbeitung' || s === 'working' || s === 'in_progress') return 'in_progress';
    if (s === 'erledigt' || s === 'abgeschlossen' || s === 'finished' || s === 'done') return 'done';
    if (s === 'blocked' || s === 'blockiert') return 'blocked';
    if (s === 'archived' || s === 'archiviert') return 'archived';
  }
  return val;
}, KanbanCardStatusEnum);

export const KanbanCardSchema = z.object({
  id_uuid: z.string().optional(),
  tenant_id: z.string().default('1'),
  board_id: z.string(),
  column_id: z.string(),
  title: z.string().min(1, "title_required").max(255),
  description: z.string().optional().nullable(),
  status: KanbanCardStatusPreprocess.default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  position: z.number().int().nonnegative().default(0),
  due_date: z.string().optional().nullable(),
  assigned_user: z.string().optional().nullable(),
  company_id_uuid: z.string().optional().nullable(),
  contact_id_uuid: z.string().optional().nullable(),
  labels: z.array(z.string()).default([]),
});

export const KanbanCardFullSchema = KanbanCardSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const MoveKanbanCardInputSchema = z.object({
  card_id_uuid: z.string(),
  target_column_id_uuid: z.string(),
  new_position: z.number().int().nonnegative(),
});

// tRPC Procedure Input & Output Schemas
export const getBoardDetailsInputSchema = z.object({ boardId: z.string() });
export const boardDetailsOutputSchema = KanbanBoardSchema.extend({
  columns: z.array(KanbanColumnSchema.extend({
    cards: z.array(KanbanCardSchema)
  }))
});

export const createBoardInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  is_default: z.boolean().optional(),
});

export const createColumnInputSchema = z.object({
  boardId: z.string(),
  title: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
  colorAccent: z.string().optional(),
});

export const createCardInputSchema = z.object({
  boardId: z.string(),
  columnId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  status: KanbanCardStatusEnum.optional().default('todo'),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().optional(),
  assignedUser: z.string().optional(),
  companyIdUuid: z.string().optional(),
  contactIdUuid: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

export const moveCardInputSchema = z.object({
  cardId: z.string(),
  targetColumnId: z.string(),
  newPosition: z.number().int().nonnegative(),
  status: KanbanCardStatusEnum.optional(),
});

export const updateCardInputSchema = z.object({
  cardId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  status: KanbanCardStatusEnum.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().nullable().optional(),
  assignedUser: z.string().nullable().optional(),
  companyIdUuid: z.string().nullable().optional(),
  contactIdUuid: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
});

export const deleteCardInputSchema = z.object({ cardId: z.string() });

// Workflow Event Payload Schemas
export const KanbanCardCreatedEventSchema = z.object({
  id_uuid: z.string(),
  card_id: z.string(),
  board_id: z.string(),
  column_id: z.string(),
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  company_id_uuid: z.string().optional().nullable(),
  contact_id_uuid: z.string().optional().nullable(),
});

export const KanbanCardMovedEventSchema = z.object({
  id_uuid: z.string(),
  card_id: z.string(),
  board_id: z.string(),
  from_column_id: z.string(),
  to_column_id: z.string(),
  from_column_title: z.string().optional(),
  to_column_title: z.string().optional(),
  new_position: z.number().int().nonnegative(),
  card_title: z.string(),
});

// MCP Tool Input/Output Schemas
export const AIListKanbanBoardsInputSchema = z.object({
  search_term: z.string().optional(),
});

export const AIGetKanbanBoardDetailsInputSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const board_id = (obj.board_id || obj.board_id_uuid || obj.id || obj.boardId) as string | undefined;
    return { ...obj, board_id, board_id_uuid: board_id };
  }
  return val;
}, z.object({
  board_id: z.string().optional(),
  board_id_uuid: z.string().optional(),
}));

export const AICreateKanbanCardInputSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const board_id = (obj.board_id || obj.board_id_uuid || obj.boardId) as string | undefined;
    const column_id = (obj.column_id || obj.column_id_uuid || obj.columnId) as string | undefined;
    const company_id = (obj.company_id || obj.company_id_uuid || obj.associated_company_id) as string | undefined;
    const contact_id = (obj.contact_id || obj.contact_id_uuid || obj.associated_contact_id) as string | undefined;
    return {
      ...obj,
      board_id,
      board_id_uuid: board_id,
      column_id,
      column_id_uuid: column_id,
      company_id,
      company_id_uuid: company_id,
      contact_id,
      contact_id_uuid: contact_id
    };
  }
  return val;
}, z.object({
  board_id: z.string().optional(),
  board_id_uuid: z.string().optional(),
  column_id: z.string().optional(),
  column_id_uuid: z.string().optional(),
  column_title: z.string().optional(),
  title: z.string().min(1, "Kartentitel ist erforderlich"),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  due_date: z.string().optional(),
  company_id: z.string().optional(),
  company_id_uuid: z.string().optional(),
  contact_id: z.string().optional(),
  contact_id_uuid: z.string().optional(),
  labels: z.array(z.string()).optional(),
}));

export const AIMoveKanbanCardInputSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const card_id = (obj.card_id || obj.card_id_uuid || obj.id || obj.cardId) as string | undefined;
    const target_column_id = (obj.target_column_id || obj.target_column_id_uuid || obj.column_id || obj.column_id_uuid || obj.columnId) as string | undefined;
    return {
      ...obj,
      card_id,
      card_id_uuid: card_id,
      target_column_id,
      target_column_id_uuid: target_column_id
    };
  }
  return val;
}, z.object({
  card_id: z.string().optional(),
  card_id_uuid: z.string().optional(),
  target_column_id: z.string().optional(),
  target_column_id_uuid: z.string().optional(),
  target_column_title: z.string().optional(),
  new_position: z.number().int().nonnegative().default(0),
}));

export const AIUpdateKanbanCardInputSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const card_id = (obj.card_id || obj.card_id_uuid || obj.id || obj.cardId) as string | undefined;
    return { ...obj, card_id, card_id_uuid: card_id };
  }
  return val;
}, z.object({
  card_id: z.string().optional(),
  card_id_uuid: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  due_date: z.string().optional(),
  labels: z.array(z.string()).optional(),
}));

export const AIDeleteKanbanCardInputSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const card_id = (obj.card_id || obj.card_id_uuid || obj.id || obj.cardId) as string | undefined;
    return { ...obj, card_id, card_id_uuid: card_id };
  }
  return val;
}, z.object({
  card_id: z.string().optional(),
  card_id_uuid: z.string().optional(),
}));

// MCP API Key Schemas
export const McpApiKeyScopeSchema = z.enum([
  "read",
  "write",
  "invoices",
  "contacts",
  "companies",
  "offers",
  "kanban",
  "vault",
  "council",
  "admin",
  "full_access"
]);

export const McpToolPermissionActionSchema = z.enum(["create", "update", "delete", "approve", "send", "run"]);

// Tool-Berechtigungen: Tool-Berechtigungen pro MCP-Key — { "<tool_name>": ["create","update","delete"] }
export const McpToolPermissionsSchema = z.record(z.string(), z.array(McpToolPermissionActionSchema));

export const McpApiKeySchema = z.object({
  id_uuid: z.string().uuid(),
  tenant_id: z.string(),
  key_name: z.string().min(1).max(255),
  key_hash: z.string(),
  key_prefix: z.string(),
  scopes: z.array(McpApiKeyScopeSchema),
  tool_permissions: McpToolPermissionsSchema.nullable().optional(),
  is_active: z.boolean(),
  last_used_at: z.string().or(z.date()).nullable().optional(),
  expires_at: z.string().or(z.date()).nullable().optional(),
  created_by_user_id: z.string().nullable().optional(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date())
});

export const CreateMcpApiKeyInputSchema = z.object({
  key_name: z.string().min(2).max(100),
  scopes: z.array(McpApiKeyScopeSchema).min(1),
  tool_permissions: McpToolPermissionsSchema.nullable().optional(),
  expires_in_days: z.number().int().positive().nullable().optional()
});

export const CreateMcpApiKeyOutputSchema = z.object({
  api_key: z.string(), // Nur einmalig beim Erstellen im Klartext sichtbar
  key_info: McpApiKeySchema
});

export const RevokeMcpApiKeyInputSchema = z.object({
  id_uuid: z.string().uuid()
});

export type McpApiKey = z.infer<typeof McpApiKeySchema>;
export type CreateMcpApiKeyInput = z.infer<typeof CreateMcpApiKeyInputSchema>;
export type CreateMcpApiKeyOutput = z.infer<typeof CreateMcpApiKeyOutputSchema>;

export const HybridKnowledgeSearchInputSchema = z.object({
  query: z.string().min(1, "Suchanfrage darf nicht leer sein."),
  company_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  scope: z.enum(["global", "company", "contact", "all"]).default("all"),
  document_type: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  vector_weight: z.number().min(0).max(1).default(0.7),
  fts_weight: z.number().min(0).max(1).default(0.3)
});

export type HybridKnowledgeSearchInput = z.infer<typeof HybridKnowledgeSearchInputSchema>;
export type HybridKnowledgeSearchRawInput = z.input<typeof HybridKnowledgeSearchInputSchema>;

/**
 * Attachment reference sent with a Louis AI chat message.
 * The server resolves the extracted text via the stored attachment
 * (uploads/chat-attachments/<storedFileName>.txt).
 */
export const ChatAttachmentInputSchema = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string().min(1),
  isIndexedInKnowledgeBase: z.boolean().optional().default(false),
});

export type ChatAttachmentInput = z.infer<typeof ChatAttachmentInputSchema>;

/** Response of POST /api/chat/upload */
export const ChatUploadResponseSchema = z.object({
  attachmentId: z.string().uuid(),
  fileName: z.string(),
  fileSizeBytes: z.number(),
  mimeType: z.string(),
  isIndexedInKnowledgeBase: z.boolean(),
  extractedCharCount: z.number(),
  extractedTextPreview: z.string().optional(),
});

export type ChatUploadResponse = z.infer<typeof ChatUploadResponseSchema>;

export const ModelUsageMetadataSchema = z.object({
  promptTokens: z.number().optional().default(0),
  completionTokens: z.number().optional().default(0),
  totalTokens: z.number().optional().default(0),
  cachedInputTokens: z.number().optional().default(0),
  cacheCreationInputTokens: z.number().optional().default(0),
  cacheReadInputTokens: z.number().optional().default(0),
  promptTokenCount: z.number().optional(),
  prompt_token_count: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  candidates_token_count: z.number().optional(),
});

export type ModelUsageMetadata = z.infer<typeof ModelUsageMetadataSchema>;

export const AiChatLogEntrySchema = z.object({
  id: z.string().optional(),
  tenantId: z.string(),
  sessionId: z.string(),
  promptTokens: z.number(),
  completionTokens: z.number(),
  cachedTokens: z.number().default(0),
  totalTokens: z.number(),
  createdAt: z.string(),
});

// MCP Client Engine Schemas
export const McpTransportTypeEnum = z.enum(['stdio', 'sse', 'http', 'streamable_http']);
export type McpTransportType = z.infer<typeof McpTransportTypeEnum>;

export const McpAuthTypeEnum = z.enum(['none', 'bearer', 'api_key', 'basic', 'oauth2', 'bearer_token', 'custom']);
export type McpAuthType = z.infer<typeof McpAuthTypeEnum>;

export const McpHealthStatusEnum = z.enum(['unknown', 'healthy', 'degraded', 'error', 'offline']);
export type McpHealthStatus = z.infer<typeof McpHealthStatusEnum>;

export const McpExternalServerSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  server_name: z.string().min(1, 'server_name_required').max(100),
  description: z.string().optional().nullable(),
  transport_type: McpTransportTypeEnum,
  endpoint_or_command: z.string().min(1, 'endpoint_or_command_required'),
  command_args: z.array(z.string()).default([]),
  env_vars: z.record(z.string(), z.string()).default({}),
  headers: z.record(z.string(), z.string()).default({}),
  auth_type: McpAuthTypeEnum.default('none'),
  auth_token_encrypted: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  health_status: McpHealthStatusEnum.default('unknown'),
  last_ping_at: z.string().or(z.date()).optional().nullable(),
  last_error_message: z.string().optional().nullable(),
  created_at: z.string().or(z.date()).optional(),
  updated_at: z.string().or(z.date()).optional(),
  // C.3 (Plan 2026-08-19): Konfigurationsfelder (additiv, optional — Defaults = bisheriges Verhalten)
  protocol: z.enum(['auto', 'stateless', 'legacy']).optional().nullable(),
  keepalive_interval_s: z.number().int().positive().optional().nullable(),
  connect_timeout_s: z.number().int().positive().optional().nullable(),
  ssl_verify: z.boolean().optional().nullable(),
  client_cert: z.string().optional().nullable(),
  client_key: z.string().optional().nullable(),
  custom_headers: z.string().optional().nullable(),
  supports_parallel_tool_calls: z.boolean().optional().nullable(),
  trust: z.enum(['full', 'untrusted']).optional().nullable(),
  tools_include_json: z.array(z.string()).optional().nullable(),
  tools_exclude_json: z.array(z.string()).optional().nullable(),
  idle_timeout_s: z.number().int().positive().optional().nullable(),
  max_lifetime_s: z.number().int().positive().optional().nullable()
});

export const McpExternalServerInputSchema = McpExternalServerSchema.omit({
  id_uuid: true,
  created_at: true,
  updated_at: true,
  last_ping_at: true,
  health_status: true,
  last_error_message: true
});

// C.4 (Plan 2026-08-19): Genehmigungs-Queue (Trust-Gate)
export const McpApprovalRequestSchema = z.object({
  id_uuid: z.string().uuid(),
  tenant_id: z.string(),
  server_id_uuid: z.string().uuid(),
  server_name: z.string(),
  tool_id_uuid: z.string().uuid(),
  normalized_tool_name: z.string(),
  original_tool_name: z.string(),
  tool_arguments_json: z.unknown(),
  requested_by: z.string(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  created_at: z.string().or(z.date()),
  decided_by: z.string().nullable().optional(),
  decided_at: z.string().or(z.date()).nullable().optional(),
  decision_comment: z.string().nullable().optional()
});

export type McpApprovalRequestRecord = z.infer<typeof McpApprovalRequestSchema>;

// C.7 (Plan 2026-08-19): Chatprofile
export const McpChatProfileSchema = z.object({
  id_uuid: z.string().uuid(),
  tenant_id: z.string(),
  profile_name: z.string().min(1).max(60),
  description: z.string().nullable().optional(),
  tools_json: z.array(z.string()).nullable().optional(),
  is_system: z.boolean(),
  is_default: z.boolean(),
  created_by_user_id: z.string().nullable().optional(),
  created_at: z.string().or(z.date()).optional(),
  updated_at: z.string().or(z.date()).optional()
});

export type McpChatProfileRecord = z.infer<typeof McpChatProfileSchema>;

export const McpExternalServerFullSchema = McpExternalServerSchema.extend({
  id_uuid: z.string().uuid(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()),
});

export const McpDiscoveredToolSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  server_id_uuid: z.string().uuid(),
  original_tool_name: z.string().min(1),
  normalized_tool_name: z.string().min(1),
  description: z.string().optional().nullable(),
  input_schema: z.record(z.string(), z.unknown()).default({}),
  is_enabled_for_louis: z.boolean().default(true),
  is_enabled_for_ui: z.boolean().default(true),
  category: z.string().default('custom'),
  last_discovered_at: z.string().or(z.date()).optional(),
  // C.4 (Plan 2026-08-19): readOnlyHint des Servers (nur exakt true = read-only; fehlend = write-capable)
  readonly_hint: z.boolean().optional().nullable()
});

export const McpDiscoveredToolFullSchema = McpDiscoveredToolSchema.extend({
  id_uuid: z.string().uuid(),
  last_discovered_at: z.string().or(z.date()),
});

export const McpToolMappingSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  target_domain: z.enum(['contacts', 'companies', 'invoices', 'offers', 'documents', 'tasks', 'calendar', 'external_api']),
  action_type: z.string().min(1),
  tool_id_uuid: z.string().uuid(),
  field_mappings: z.record(z.string(), z.string()).default({}),
  is_primary: z.boolean().default(false),
  created_at: z.string().or(z.date()).optional(),
});

export const McpToolExecutionInputSchema = z.object({
  tool_id_uuid: z.string().uuid().optional(),
  normalized_tool_name: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

export const McpToolExecutionResultSchema = z.object({
  success: z.boolean(),
  result: z.unknown(),
  error: z.string().optional().nullable(),
  execution_time_ms: z.number(),
  server_name: z.string(),
});

export const McpDomainQueryInputSchema = z.object({
  domain: z.enum(['contacts', 'companies', 'invoices', 'offers', 'documents', 'tasks', 'calendar', 'external_api']),
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export type McpExternalServerInput = z.infer<typeof McpExternalServerInputSchema>;
export type McpExternalServer = z.infer<typeof McpExternalServerFullSchema>;
export type McpDiscoveredTool = z.infer<typeof McpDiscoveredToolFullSchema>;
export type McpToolMapping = z.infer<typeof McpToolMappingSchema>;
export type McpToolExecutionInput = z.infer<typeof McpToolExecutionInputSchema>;
export type McpToolExecutionResult = z.infer<typeof McpToolExecutionResultSchema>;
export type McpDomainQueryInput = z.infer<typeof McpDomainQueryInputSchema>;

export const mcpPresetCategorySchema = z.enum([
  'google',
  'developer',
  'productivity',
  'database',
  'search',
  'communication',
  'knowledge'
]);

export const mcpAuthTypeSchema = z.enum(['none', 'api_key', 'oauth2', 'bearer_token']);

export const mcpPresetFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['string', 'password', 'select', 'boolean']),
  required: z.boolean(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  defaultValue: z.string().optional()
});

export const mcpPresetDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  category: mcpPresetCategorySchema,
  transportType: z.enum(['stdio', 'sse', 'streamable_http', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  authType: z.enum(['none', 'basic', 'bearer', 'api_key', 'oauth2']),
  oauthProvider: z.enum(['google', 'github', 'slack']).optional(),
  requiredScopes: z.array(z.string()).optional(),
  fields: z.array(mcpPresetFieldSchema),
  defaultToolMappings: z.array(z.object({
    mcpToolName: z.string(),
    louisToolName: z.string(),
    description: z.string(),
    enabled: z.boolean()
  })).optional()
});

export const installMcpPresetInputSchema = z.object({
  presetId: z.string(),
  displayName: z.string().min(1, 'Name ist erforderlich'),
  fieldValues: z.record(z.string(), z.string()),
  autoConnect: z.boolean().default(true)
});

export const initiateMcpOAuthInputSchema = z.object({
  serverId: z.string(),
  provider: z.enum(['google', 'github', 'slack']),
  redirectUri: z.string().url()
});

export const handleMcpOAuthCallbackInputSchema = z.object({
  code: z.string(),
  state: z.string(),
  redirectUri: z.string().url()
});

export type AiChatLogEntry = z.infer<typeof AiChatLogEntrySchema>;

export const McpToolAliasConfigSchema = z.object({
  paramAliases: z.record(z.string(), z.string()),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
});
export type McpToolAliasConfig = z.infer<typeof McpToolAliasConfigSchema>;

export const McpSanitizeOptionsSchema = z.object({
  maxListItems: z.number().int().positive().default(10),
  stripKeys: z.array(z.string()).default([
    'etag',
    'kind',
    'htmlLink',
    'iCalUID',
    'sequence',
    'reminders',
    'conferenceData',
    'extendedProperties',
    'creator',
    'organizer',
    'hangoutLink',
    'entryPoints'
  ]),
  maxStringLength: z.number().int().positive().default(500)
});
export type McpSanitizeOptions = z.infer<typeof McpSanitizeOptionsSchema>;

// --- S1: Session-Recall-Tool (recall_sessions) ---
// Phase 5 (#48): limit ohne festen Default — der Backend-Default kommt aus der
// Admin-Config recall_search_limit (Regel 12, NULL = 10). Explizite LLM-Limits gewinnen.
export const RecallSessionsInputSchema = z.object({
  query: z.string().min(1, "Suchbegriff erforderlich").max(200),
  limit: z.number().int().min(1).max(20).optional(),
  offset: z.number().int().min(0).max(1000).default(0)
});
export type RecallSessionsInput = z.infer<typeof RecallSessionsInputSchema>;

// --- S5: Skill-Frontmatter-Schema ---
export const SkillFrontmatterSchema = z.object({
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
  version: z.number().int().min(1).default(1),
  category: z.string().optional(),
  pitfalls: z.array(z.string()).optional()
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// --- S6: Skill-Improvement-Loop ---
export const SkillPitfallUpdateSchema = z.object({
  workflow_id_uuid: z.string().uuid(),
  pitfall: z.string().min(1).max(500)
});
export type SkillPitfallUpdate = z.infer<typeof SkillPitfallUpdateSchema>;

export const WorkflowLearnSuggestionSchema = z.object({
  workflow_name: z.string().min(1).max(100),
  workflow_description: z.string().min(1).max(300),
  skill_tags: z.array(z.string()).default([]),
  skill_category: z.string().optional(),
  tool_chain_sequence: z.array(z.object({ tool: z.string(), instruction: z.string() }))
});
export type WorkflowLearnSuggestion = z.infer<typeof WorkflowLearnSuggestionSchema>;

// --- Notizen (Notiz-Tool, 2026-08-14) ---
export const CreateNoteDraftArgsSchema = z.object({
  contact_id_uuid: z.string().uuid().optional(),
  company_id_uuid: z.string().uuid().optional(),
  note_text: z.string().min(1, "Notiztext ist erforderlich").max(2000),
  priority: z.enum(['niedrig', 'normal', 'hoch']).default('normal').optional(),
});
export type CreateNoteDraftArgs = z.infer<typeof CreateNoteDraftArgsSchema>;

export const AgentNoteSchema = z.object({
  id_uuid: z.string(),
  tenant_id: z.string().default('1'),
  entity_type: z.enum(['contact', 'company']),
  entity_id_uuid: z.string(),
  note_text: z.string(),
  priority: z.string().default('normal'),
  created_by_identity: z.string().default('ai_assistant'),
  created_at_utc: z.string().optional(),
});
export type AgentNote = z.infer<typeof AgentNoteSchema>;

export const CreateNoteDraftInputSchema = z.object({
  contact_id_uuid: z.string().uuid().optional(),
  company_id_uuid: z.string().uuid().optional(),
  note_text: z.string().min(1, "Notiztext ist erforderlich").max(2000),
  priority: z.enum(['niedrig', 'normal', 'hoch']).optional(),
});
export const AgentJobCreateSchemaBase = z.object({
  job_name: z.string().min(1).max(100),
  job_prompt: z.string().min(1).max(2000),
  schedule_type: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  schedule_time: z.string().optional(),
  schedule_weekday: z.number().int().min(1).max(7).optional(),
  deliver_to: z.enum(['telegram', 'mail_draft', 'session']).default('session'),
  deliver_target: z.string().optional(),
  is_active: z.boolean().default(true),
  // S11 Teil B: Watchdog-Cron (script/monitor brauchen script_path)
  job_type: z.enum(['agent', 'script', 'monitor']).default('agent'),
  script_path: z.string().optional(),
 // P1-3: Optionale Tool-Domänen-Einschränkung pro Job (NULL/[] = alle Domänen, Regel 12/Abwärtskompatibilität)
  allowed_domains: z.array(z.enum(['CORE', 'CRM_READ', 'CRM_WRITE', 'KNOWLEDGE', 'KANBAN', 'TEMPLATES', 'WORKFLOWS'])).optional()
});
// superRefine NUR auf dem Create-Schema — Zod v4 verbietet .partial() auf Schemas mit Refinements
export const AgentJobCreateSchema = AgentJobCreateSchemaBase.superRefine((val, ctx) => {
  if (val.job_type !== 'agent' && !val.script_path) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['script_path'], message: 'script_path ist für job_type script/monitor erforderlich.' });
  }
});
export type AgentJobCreate = z.infer<typeof AgentJobCreateSchema>;
export const AgentJobUpdateSchema = AgentJobCreateSchemaBase.partial();
export type AgentJobUpdate = z.infer<typeof AgentJobUpdateSchema>;
export const AgentJobFullSchema = z.object({
  id_uuid: z.string(),
  tenant_id: z.string(),
  job_name: z.string(),
  job_prompt: z.string(),
  schedule_type: z.enum(['hourly', 'daily', 'weekly']),
  schedule_time: z.string().nullable().optional(),
  schedule_weekday: z.number().nullable().optional(),
  deliver_to: z.enum(['telegram', 'mail_draft', 'session']),
  deliver_target: z.string().nullable().optional(),
  is_active: z.boolean(),
  last_run_at_utc: z.string().nullable().optional(),
  created_at_utc: z.string(),
  updated_at_utc: z.string(),
  job_type: z.enum(['agent', 'script', 'monitor']).nullable().optional(),
  script_path: z.string().nullable().optional(),
 // P1-3: Tool-Domänen-Limit (NULL/[] = alle Domänen)
  allowed_domains: z.array(z.enum(['CORE', 'CRM_READ', 'CRM_WRITE', 'KNOWLEDGE', 'KANBAN', 'TEMPLATES', 'WORKFLOWS'])).nullable().optional(),
  monitor_hash: z.string().nullable().optional(),
  monitor_last_output: z.string().nullable().optional()
});
export type AgentJobFull = z.infer<typeof AgentJobFullSchema>;

// --- S8: Governance-Rules-Engine ---
export const GovernanceRuleCreateSchema = z.object({
  rule_name: z.string().min(1).max(100),
  entity_type: z.string().nullable().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SEND', 'MOVE', 'EXPORT', 'EXECUTE']),
  effect: z.enum(['BLOCK', 'ASK', 'REQUIRE_APPROVAL', 'ALLOW']),
  note: z.string().max(500).default(''),
  is_active: z.boolean().default(true)
});
export type GovernanceRuleCreate = z.infer<typeof GovernanceRuleCreateSchema>;
export const GovernanceRuleFullSchema = z.object({
  id_uuid: z.string(),
  tenant_id: z.string(),
  rule_name: z.string(),
  entity_type: z.string().nullable().optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SEND', 'MOVE', 'EXPORT', 'EXECUTE']),
  effect: z.enum(['BLOCK', 'ASK', 'REQUIRE_APPROVAL', 'ALLOW']),
  note: z.string(),
  is_active: z.boolean(),
  created_at_utc: z.string(),
  updated_at_utc: z.string()
});
export type GovernanceRuleFull = z.infer<typeof GovernanceRuleFullSchema>;

// --- S9: Sub-Agent-Delegation ---
export const SubTaskSpecSchema = z.object({
  tasks: z.array(z.object({
    subtask_id: z.string().min(1).max(100),
    task_prompt: z.string().min(1).max(2000),
    required_tools: z.array(z.string()).optional(),
    max_turns: z.number().int().min(1).max(5).default(3),
 // P1-2: optionales JSON-Schema — Subtask muss strukturiert antworten (1 Korrekturversuch)
    required_output_schema: z.record(z.string(), z.unknown()).optional()
  })).min(1).max(5)
});
export type SubTaskSpec = z.infer<typeof SubTaskSpecSchema>;
export const SubTaskResultSchema = z.object({
  subtask_id: z.string(),
  status: z.enum(['success', 'failed']),
  final_text: z.string(),
  tool_trace: z.array(z.object({ tool: z.string(), query: z.string() })),
  error: z.string().optional(),
 // P1-2: Kennzeichnung, ob ein Schema-Korrekturversuch nötig war (optional, abwärtskompatibel)
  retried: z.boolean().optional(),
  verification_status: z.string().optional()
});
export type SubTaskResult = z.infer<typeof SubTaskResultSchema>;

// --- S11 Teil A: Delegations-Verifikation ---
export const VerifySubtaskArgsSchema = z.object({
  subtask_id: z.string().min(1),
  evidence: z.string().min(1)
});
export type VerifySubtaskArgs = z.infer<typeof VerifySubtaskArgsSchema>;

// --- S11 Teil C: ASK-Governance ---
export const AskUserQuestionArgsSchema = z.object({
  question: z.string().min(3).max(500),
  choices: z.array(z.string().min(1).max(200)).max(4).optional(),
  context: z.string().max(500).optional()
});
export type AskUserQuestionArgs = z.infer<typeof AskUserQuestionArgsSchema>;
export const AnswerQuestionSchema = z.object({
  question_id: z.string().min(1),
  answer: z.string().min(1).max(500)
});
export type AnswerQuestion = z.infer<typeof AnswerQuestionSchema>;
export const AgentQuestionFullSchema = z.object({
  id_uuid: z.string(),
  tenant_id: z.string(),
  question: z.string(),
  choices_json: z.string(),
  context_text: z.string(),
  status: z.enum(['OPEN', 'ANSWERED']),
  answer: z.string(),
  created_by: z.string(),
  created_at_utc: z.string(),
  answered_at_utc: z.string().nullable().optional()
});
export type AgentQuestionFull = z.infer<typeof AgentQuestionFullSchema>;








