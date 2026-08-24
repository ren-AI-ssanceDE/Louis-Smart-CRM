import { z } from 'zod';
import { CompanyFullSchema, ContactFullSchema } from './lib/schemas';

export interface Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    role: IdentityRole;
    tenant_id: string;
  };
  expires: string;
}

export interface Context {
  session: Session | null;
  tenantId?: string;
}

export type IdentityRole = 'admin' | 'staff' | 'system';
export type EntitySource = 'human' | 'ai_assistant' | 'system';

export interface AIMetadata {
  tenant_id?: string;
  created_by_identity?: EntitySource;
  ai_confidence_score?: number;
  is_verified_by_human?: boolean;
  raw_source_data?: string;
  metadata?: { company_short_code?: string; [key: string]: unknown } | null;
}

export interface Company extends AIMetadata {
  id_uuid?: string;
  tenant_id?: string;
  full_legal_name?: string;
  short_code?: string;
  tax_vat_id?: string;
  tax_number?: string;
  responsible_person?: string;
  street?: string;
  house_number?: string;
  postal_code?: string;
  city?: string;
  country_code?: string;
  email_address?: string;
  email_2?: string;
  website?: string;
  phone_number?: string;
  mobile_number?: string;
  fax_number?: string;
  iban?: string;
  bic_swift?: string;
  bank_name?: string;
  leitweg_id?: string;
  payment_term?: string;
  price_list?: string;
  custom_documents?: string;
  labels?: string[];
  opt_in_marketing?: boolean;
  opt_in_social_media?: boolean;
  opt_in_direct_message?: boolean;
  opt_in_sms?: boolean;
  opt_in_phone?: boolean;
  language?: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface Contact extends AIMetadata {
  id_uuid?: string;
  tenant_id?: string;
  full_legal_name?: string;
  first_name?: string;
  last_name?: string;
  responsible_person?: string;
  salutation?: string;
  gender_identity?: string;
  date_of_birth?: string;
  region?: string;
  street?: string;
  house_number?: string;
  postal_code?: string;
  city?: string;
  email_address?: string;
  email_2?: string;
  website?: string;
  phone_number?: string;
  fax_number?: string;
  mobile_number?: string;
  language?: string;
  labels?: string[];
  opt_in_marketing?: boolean;
  opt_in_social_media?: boolean;
  opt_in_direct_message?: boolean;
  opt_in_sms?: boolean;
  opt_in_phone?: boolean;
  tax_vat_id?: string;
  iban?: string;
  bic_swift?: string;
  payment_term?: string;
  price_list?: string;
  custom_documents?: string;
  associated_company_id?: string;
  company_name?: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  total_net?: number;
  unit_code?: string;
}

export type InvoiceLineItem = LineItem;

export interface Invoice extends AIMetadata {
  id_uuid?: string;
  invoice_number: string;
  associated_company_id?: string;
  company_name?: string;
  associated_contact_id?: string;
  contact_full_name?: string;
  bank_account?: string;
  issue_date: string;
  service_date?: string;
  due_date?: string;
  payment_term?: string;
  is_vat_inclusive: boolean;
  total_net_amount: number;
  total_vat_amount: number;
  total_gross_amount: number;
  vat_rate: number;
  currency_code: string;
  leitweg_id?: string;
  invoice_line_items_json?: string;
  invoice_line_items?: LineItem[];
  introductory_text?: string;
  closing_text?: string;
  payment_status: 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue';
  status?: 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue';
  zugferd_xml_metadata?: string;
  raw_source_data?: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface InvoiceWithRecipient extends Invoice {
  co_name?: string | null;
  co_street?: string | null;
  co_house_number?: string | null;
  co_postal_code?: string | null;
  co_city?: string | null;
  co_country_code?: string | null;
  co_email_address?: string | null;
  ct_name?: string | null;
  ct_street?: string | null;
  ct_house_number?: string | null;
  ct_postal_code?: string | null;
  ct_city?: string | null;
  ct_country_code?: string | null;
  ct_email_address?: string | null;
}

export interface SeedLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  total_net?: number;
  unit_code?: string;
}

export interface SeedInvoice {
  invoice_number: string;
  company_name: string;
  issue_date_utc: string;
  due_date_utc?: string;
  total_net: number;
  total_vat: number;
  total_gross: number;
  currency_code: string;
  payment_status: 'draft' | 'issued' | 'paid' | 'cancelled' | 'overdue';
  payment_method?: string;
  line_items?: SeedLineItem[];
}

export interface AuditLogEvent {
  id_uuid: string;
  tenant_id: string;
  event_type: 'CREATE' | 'UPDATE' | 'DELETE' | string;
  entity_type: string;
  entity_id: string | null;
  event_details: string | null;
  actor_identity: string;
  created_at_utc: string;
}

export interface EmailTemplate extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  template_name_text: string;
  email_subject_text: string;
  email_body_content: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface Signature extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  signature_name_text: string;
  signature_body_content: string;
  is_default_signature: boolean;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface InvoiceTextTemplate extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  template_name_text: string;
  template_type_code: 'introductory' | 'closing' | string;
  template_body_content: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface MyCompany extends Company {
  first_name?: string;
  last_name?: string;
  salutation?: string;
  gender_identity?: string;
  date_of_birth?: string;
  region?: string;
  invoice_number_prefix?: string;
  invoice_number_year_fixed?: boolean;
  invoice_number_next_seq?: number;
  invoice_number_min_digits?: number;
  offer_number_prefix?: string;
  offer_number_year_fixed?: boolean;
  offer_number_next_seq?: number;
  offer_number_min_digits?: number;
  logo_url?: string;
  contacts_display_columns_json?: string;
  companies_display_columns_json?: string;
}

export interface SmtpSettings extends AIMetadata {
  id_uuid?: string;
  tenant_id?: string;
  smtp_host_name: string;
  smtp_port_number: number;
  smtp_user_name: string;
  smtp_password_secret: string;
  is_secure_connection?: boolean;
  sender_email_address: string;
  sender_display_name?: string;
}

export interface InvoiceItemTemplate extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  template_name_text: string;
  description: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  unit_code: string;
  usage_scope?: 'offer' | 'invoice' | 'both';
  category_id_uuid?: string | null;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface ItemCategory extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  category_name_text: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface LouisAiConfig {
  id_uuid?: string;
  tenant_id: string;
  provider_type: 'ollama' | 'anthropic' | 'openai' | 'gemini';
  api_key_secret?: string | null;
  base_url?: string | null;
  model_name: string;
  temperature: number;
  top_p: number;
  top_k: number;
  num_ctx: number;
  embedding_provider?: 'ollama' | 'openai' | 'gemini';
  embedding_api_key_secret?: string | null;
  embedding_base_url?: string | null;
  embedding_model_name?: string;
  vector_dimensions?: number;
  keep_alive_minutes?: number;
  parallel_slots?: number;
  chunk_size?: number;
  chunk_overlap?: number;
 // Task 0: ReAct-Laufzeitparameter (NULL = Backend-Default, Admin-einstellbar — Regel 12)
  max_iterations?: number | null;
  max_history_tokens?: number | null;
  tool_result_truncate_chars?: number | null;
  react_keep_last_results?: number | null;
  react_compaction_from_iteration?: number | null;
  early_exit_after_tools?: number | null;
 // B3: Prompt-Direktiven-Modus
  prompt_directives_mode?: 'always' | 'intent';
 // : Tool-Call-Modus ('auto' | 'json' | 'native')
  react_tool_call_mode?: 'auto' | 'json' | 'native';
  // 2026-08-18: Text-Fallback-Kanal (false = strikt/nativ, true = Text-Fallback erlaubt)
  text_fallback_enabled?: boolean | null;
 // P0-2: Memory-Budget (Tokens) für die User-Memory-Injektion (NULL = Backend-Default 800, Regel 12)
  memory_budget_tokens?: number | null;
 // Phase 1 (Parität): Cache-Tier-Architektur (NULL = Backend-Default, Regel 12)
  prompt_parallel_tool_guidance?: boolean | null;
  prompt_tool_guidance_trim?: boolean | null;
  memory_frozen_snapshot?: boolean | null;
 // Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12)
  compression_enabled?: boolean | null;
  compression_threshold_percent?: number | null;
  compression_tail_token_budget?: number | null;
  compression_aux_model?: string | null;
  compression_persist_summary?: boolean | null;
  compression_model_context_map?: string | null;
 // Phase 3 (Parität): Memory (NULL = Backend-Default, Regel 12)
  memory_prefetch_enabled?: boolean | null;
  memory_prefetch_timeout_s?: number | null;
  memory_recall_status_enabled?: boolean | null;
  memory_auto_scan_enabled?: boolean | null;
  memory_consolidation_budget?: number | null;
 // Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12)
  tool_call_retry_max?: number | null;
  empty_retry_budget?: number | null;
  empty_retry_cost_threshold_usd?: number | null;
  tool_guardrail_exact_block?: number | null;
  tool_guardrail_no_progress_block?: number | null;
  loop_deadline_s?: number | null;
  thinking_scrub_enabled?: boolean | null;
 // Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12)
  recall_fts_enabled?: boolean | null;
  recall_search_limit?: number | null;
 // Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12)
  skill_curator_enabled?: boolean | null;
  skill_inject_max_tokens?: number | null;
  skill_prune_inactive_after_days?: number | null;
  skill_inject_top_k?: number | null;
 // P1-1 (Parität): Curator-Tick/Archiv (NULL = Backend-Default, Regel 12)
  curator_interval_hours?: number | null;
  curator_archive_after_days?: number | null;
 // P1-3 (Parität): Subagent-Spawn-Depth (NULL = Backend-Default, Regel 12)
  subtask_max_depth?: number | null;
 // P1: Audit-Log-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  audit_retention_days?: number | null;
 // P1: Session-Retention in Tagen (NULL = kein Auto-Prune, Regel 12)
  session_retention_days?: number | null;
  // C.4 (Plan 2026-08-19): MCP-Genehmigungs-Timeout (s) + stdio-Session-Limit (Regel 12)
  mcp_approval_timeout_s?: number | null;
  mcp_stdio_max_sessions?: number | null;
 // Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12)
  mcp_refresh_interval_s?: number | null;
  subtask_timeout_s?: number | null;
  subtask_max_parallel?: number | null;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface CustomWorkflow {
  id_uuid?: string;
  tenant_id: string;
  workflow_name: string;
  workflow_description: string;
  tool_chain_sequence: {
    tool: string;
    instruction: string;
  }[];
  trigger_type?: 'MANUAL' | 'CRM_EVENT' | 'TIMER';
  trigger_config?: {
    event_name: string;
    delay_seconds?: number;
    logic?: 'AND' | 'OR';
    conditions?: {
      field: 'entity_type' | 'entity_id' | 'entity_name' | 'file_name' | 'company_id' | 'company_name' | 'invoice_status' | 'kanban_column_id';
      operator: 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with';
      value: string;
    }[];
  } | Record<string, unknown> | null;
  created_by_identity?: string | null;
  skill_description?: string | null;
  skill_tags?: string[] | null;
  skill_category?: string | null;
  skill_version?: number | null;
  skill_pitfalls?: string[] | null;
  is_active?: boolean;
  direct_send_email?: boolean;
  dag_structure?: Record<string, unknown> | null;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface MailDraftAttachment {
  filename: string;
  source: 'knowledge' | 'vault';
  entity_id?: string;
  entity_type?: 'companies' | 'contacts';
  filePath?: string;
}

export interface MailDraft {
  id_uuid: string;
  tenant_id: string;
  workflow_instance_id?: string | null;
  recipient: string;
  subject: string;
  body: string;
  attachments_json?: MailDraftAttachment[] | string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface KnowledgeFile {
  name: string;
  size: number;
  mtime: string;
  isIndexed: boolean;
  chunkCount: number;
}

export interface ChatNote {
  id_uuid: string;
  entity_type: 'user' | 'contact' | 'company';
  entity_id?: string | null;
  content: string;
  is_rag_indexed: boolean;
  created_at_utc: string;
}

export interface WorkflowExecutionLogEntry {
  timestamp: string;
  step?: string;
  details?: string;
  step_index?: number;
  tool?: string;
  instruction?: string;
  outputs?: { text: string } | Record<string, unknown>;
  mailing_status?: string;
  mailing_error?: string;
  label_error?: string;
  note_error?: string;
  note_success?: string;
 // 4A T1-Nachtrag (A1): Referenz auf persistierte Rückfrage
  question_id?: string;
  label_success?: string;
  [key: string]: unknown;
}

export interface WorkflowInstance {
  id_uuid?: string;
  tenant_id: string;
  workflow_id: string;
  status: 'PENDING_DELAY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'WAITING_FOR_DRAFT_APPROVAL' | 'PENDING_APPROVAL' | 'WAITING_FOR_KANBAN_APPROVAL' | 'PENDING_QUESTION';
  initial_payload: Record<string, unknown> | null;
  current_step_index: number;
  execution_log: WorkflowExecutionLogEntry[];
  execute_at_utc?: string | null;
  created_at_utc?: string;
  updated_at_utc?: string;
  current_node_id?: string;
  node_results?: Record<string, Record<string, unknown>>;
 // 4A T1-Nachtrag (A1): persistierte Rückfrage, auf deren Antwort der Workflow wartet
  pending_question_id?: string | null;
}

export interface LouisAiKnowledgeMetadata {
  id_uuid: string;
  tenant_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  document_hash: string;
  scope?: 'global' | 'company' | 'contact' | string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  created_by_identity?: string | null;
  is_verified_by_human?: boolean | null;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface LouisAiKnowledgeChunk {
  id_uuid: string;
  tenant_id: string;
  document_id: string;
  chunk_index?: number;
  chunk_text: string;
  embedding: number[] | string | null;
  scope?: 'global' | 'company' | 'contact' | string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  document_type?: string;
  needs_reembedding?: boolean;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface ReembeddingQueueItem {
  id_uuid: string;
  tenant_id: string;
  chunk_id: string;
  target_dimension: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  retry_count: number;
  error_message?: string | null;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface HybridSearchResult {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  file_name: string;
  scope: string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  vector_score: number;
  fts_score: number;
  rrf_score: number;
}

export interface TenantAiConfig extends Partial<LouisAiConfig> {
  system_prompt?: string;
  max_tokens?: number;
}

export interface TextGeneratorConfig {
  id_uuid?: string;
  tenant_id: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  model_name: string;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface WebSearchConfig {
  id_uuid?: string;
  tenant_id: string;
  selected_engine: 'duckduckgo' | 'searxng' | 'google_grounding' | 'google_custom_search';
  duckduckgo_url?: string | null;
  searxng_url?: string | null;
  searxng_categories?: string | null;
  google_api_key?: string | null;
  google_cx?: string | null;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface ProposedChangeAttachment {
  id?: string;
  name?: string;
  filename?: string;
  path?: string;
  url?: string;
  type?: string;
  content_type?: string;
  size?: number;
  data_base64?: string;
}

export interface ProposedChangeItem {
  position?: number;
  description?: string;
  title?: string;
  quantity?: number;
  unit_price?: number;
  unitPrice?: number;
  taxRate?: number;
  vat_rate?: number;
  vatRate?: number;
  total_net?: number;
  totalNet?: number;
  total?: number;
  unit_code?: string;
  unitCode?: string;
  total_gross?: number;
  totalGross?: number;
  is_text_position?: boolean;
}

export type ProposedEntityTypes = 
  | 'companies' 
  | 'contacts' 
  | 'invoices' 
  | 'emails' 
  | 'offers' 
  | 'kanban_board' 
  | 'kanban_column' 
  | 'kanban_card'
  | 'vault_skill'
  | 'note';

export type ProposedActionTypes = 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND' | 'MOVE';

export interface ProposedChanges {
  entity_type: ProposedEntityTypes;
  action: ProposedActionTypes;
  id_uuid?: string;
  proposed_state: Record<string, unknown>;
  explanation_rational: string;
}

export interface KanbanApprovalRecord {
  id_uuid: string;
  tenant_id: string;
  workflow_instance_id?: string | null;
  entity_type: 'board' | 'column' | 'card';
  action_type: 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE';
  target_id_uuid?: string | null;
  proposed_payload: Record<string, unknown>;
  explanation_text?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at_utc: string;
  updated_at_utc: string;
}

export interface LouisAiMetrics {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

import type { ModelUsageMetadata } from "./lib/schemas.js";
export type { ModelUsageMetadata };

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
  timestamp_utc?: string;
  metadata?: Record<string, unknown> | null;
  thought_log?: string | string[];
  proposed_changes?: ProposedChanges | null;
  metrics?: LouisAiMetrics | null;
}

export type ConversationMessage = ChatMessage;

/**
 * A file attached to a Louis AI chat message.
 * The binary lives on disk under uploads/chat-attachments/<storedFileName>,
 * the extracted plain text under uploads/chat-attachments/<storedFileName>.txt
 * (sidecar). Attachment descriptors are persisted as part of the session's
 * conversation_history_json so they survive restarts.
 */
export interface ChatAttachment {
  attachmentId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  storedFileName: string;
  textFilePath: string;
  isIndexedInKnowledgeBase: boolean;
  uploadedAtUtc: string;
  uploadedBy: string;
}


export interface InvoicePaidPayload {
  id_uuid: string;
  invoice_number: string;
  payment_date: string;
  payment_method: string;
  payment_amount: number;
  total_gross_amount: number;
  total_net_amount: number;
  tax_amount: number;
  currency: string;
  associated_company_id: string | null;
  associated_contact_id: string | null;
}

export interface InvoiceOverduePayload {
  id_uuid: string;
  invoice_number: string;
  due_date: string;
  days_overdue: number;
  total_gross_amount: number;
  payment_status: 'overdue';
  associated_company_id: string | null;
  associated_contact_id: string | null;
}

export interface ContactUpdatedPayload {
  id_uuid: string;
  full_legal_name: string;
  first_name: string | null;
  last_name: string;
  email_address: string;
  responsible_person: string | null;
  city: string | null;
  associated_company_id: string | null;
  labels: string[];
}

export interface CompanyUpdatedPayload {
  id_uuid: string;
  full_legal_name: string;
  short_code: string | null;
  tax_vat_id: string | null;
  city: string | null;
  email_address: string | null;
  responsible_person: string | null;
  labels: string[];
}

export interface SpeechToTextSettings {
  id_uuid?: string;
  tenant_id: string;
  stt_provider: 'disabled' | 'local-whisper' | 'openai-whisper';
  stt_endpoint: string;
  stt_api_key?: string | null;
  stt_model: string;
  stt_language: string;
  stt_prompt: string;
  stt_device: 'auto' | 'cpu' | 'cuda';
  stt_quantization: 'none' | 'float16' | 'int8' | 'int8_float16';
  stt_unload_llm_on_demand: boolean;
  stt_fallback_on_cpu: boolean;
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface AuthAccessIdentity {
  id_uuid: string;
  email_address: string;
  full_legal_name: string;
  account_role: string;
  password_hash?: string;
  raw_source_data?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface OfferLineItem {
  id_uuid?: string;
  position: number;
  description: string;
  quantity: number;
  unit_code: string;
  unit_price: number;
  vat_rate: number;
  total_net: number;
  total_gross: number;
  is_text_position?: boolean;
}

export interface Offer {
  id_uuid: string;
  tenant_id: string;
  offer_number: string;
  associated_company_id: string | null;
  associated_contact_id: string | null;
  title: string;
  introductory_text: string;
  closing_text: string;
  issue_date: string;
  valid_until: string;
  payment_term: string;
  currency_code: string;
  is_vat_inclusive: boolean;
  line_items: OfferLineItem[];
  total_net_amount: number;
  total_vat_amount: number;
  total_gross_amount: number;
  offer_status: 'draft' | 'sent' | 'accepted' | 'rejected';
  status?: 'draft' | 'sent' | 'accepted' | 'rejected';
  pdf_file_path: string | null;
  created_by_identity: string;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface OfferTextTemplate extends AIMetadata {
  id_uuid?: string;
  tenant_id: string;
  template_name_text: string;
  template_type_code: 'introductory' | 'closing' | string;
  template_body_content: string;
  created_at_utc?: string | Date;
  updated_at_utc?: string | Date;
}

export interface CouncilProvider {
  id_uuid: string;
  name: string;
  provider_type: 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom';
  api_key_secret?: string | null;
  base_url?: string | null;
  is_active: boolean;
}

export interface CouncilSettings {
  enabled: boolean;
  defaultMode: 'multi-role' | 'multi-model';
  defaultMaxRounds: number;
  providers: CouncilProvider[];
  roles: {
    id: string;
    name: string;
    systemPrompt: string;
    temperature: number;
  }[];
  peerReviewSystemPrompt?: string;
  chairmanSystemPrompt?: string;
  availableModels: {
    id: string;
    providerId: string;
    modelId: string;
    name: string;
    defaultTemperature: number;
  }[];
}

export type CouncilFallbackTier = 'PRIMARY' | 'SECONDARY_LOUIS' | 'DETERMINISTIC_FALLBACK';

export interface CouncilFallbackMetadata {
  usedFallback?: boolean;
  originalProviderId?: string;
  originalModelId?: string;
  actualProviderId?: string;
  actualModelId?: string;
  fallbackReason?: string;
  isDegraded?: boolean;
  requestedProvider?: string;
  requestedModel?: string;
  usedProvider?: string;
  usedModel?: string;
  fallbackTier?: CouncilFallbackTier;
  latencyMs?: number;
  errorMessage?: string;
}

export interface CouncilSession {
  id: string;
  topic: string;
  mode: 'multi-role' | 'multi-model';
  status: 'draft' | 'active' | 'completed';
  maxRounds: number;
  currentRound: number;
  createdAt: string;
  participants: CouncilParticipant[];
  finalConclusion?: string;
  hasDegradedResponses?: boolean;
}

export interface CouncilParticipant {
  id: string;
  name: string; 
  providerId: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  isDegraded?: boolean;
}

import { 
  KanbanBoardFullSchema, 
  KanbanColumnFullSchema, 
  KanbanCardFullSchema
} from './lib/schemas.js';

export type KanbanBoard = z.infer<typeof KanbanBoardFullSchema>;
export type KanbanColumn = z.infer<typeof KanbanColumnFullSchema>;
export type KanbanCard = z.infer<typeof KanbanCardFullSchema>;

export interface KanbanColumnWithCards extends KanbanColumn {
  cards: KanbanCard[];
}

export interface KanbanBoardData extends KanbanBoard {
  columns: KanbanColumnWithCards[];
}

export interface CouncilMessage {
  id: string;
  sessionId: string;
  participantId: string;
  roundNumber: number;
  content: string;
  createdAt: string;
  fallbackMetadata?: CouncilFallbackMetadata;
}

export type McpPresetCategory = 'google' | 'developer' | 'productivity' | 'database' | 'search' | 'communication' | 'knowledge';

export interface McpPresetField {
  key: string;
  label: string;
  type: 'string' | 'password' | 'select' | 'boolean';
  required: boolean;
  description?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

export interface McpPresetDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: McpPresetCategory;
  transportType: 'stdio' | 'sse' | 'streamable_http' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  authType: 'none' | 'basic' | 'bearer' | 'api_key' | 'oauth2';
  oauthProvider?: 'google' | 'github' | 'slack';
  requiredScopes?: string[];
  fields: McpPresetField[];
  defaultToolMappings?: Array<{
    mcpToolName: string;
    louisToolName: string;
    description: string;
    enabled: boolean;
  }>;
}

export interface McpOAuthTokenRecord {
  id: string;
  tenant_id: string;
  server_id: string;
  provider: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  scopes?: string[] | null;
  created_at?: string;
  updated_at?: string;
}

export interface McpExecutionResultPruned {
  isPruned: boolean;
  totalItemsCount?: number;
  returnedItemsCount?: number;
  data: unknown;
}

// C.7 (Plan 2026-08-19): Chatprofile — benannte Tool-Sets pro Chat
export interface ChatProfileRecord {
  id_uuid: string;
  tenant_id: string;
  profile_name: string; // FIX nach Erstellung
  description?: string | null;
  tools_json?: string[] | null; // NULL = alle Admin-freigegebenen (Main)
  is_system: boolean;
  is_default: boolean;
  created_by_user_id?: string | null; // NULL = team-weit, gesetzt = persönlich
  created_at?: string | Date;
  updated_at?: string | Date;
}

export type {
  McpTransportType,
  McpAuthType,
  McpHealthStatus,
  McpExternalServerInput,
  McpExternalServer,
  McpDiscoveredTool,
  McpToolMapping,
  McpToolExecutionInput,
  McpToolExecutionResult,
  // C.4 (Plan 2026-08-19): Genehmigungs-Queue (Trust-Gate)
  McpApprovalRequestRecord,
  McpDomainQueryInput,
  McpToolAliasConfig,
  McpSanitizeOptions
} from './lib/schemas';

// --- S1: Session-Recall-Hit (recall_sessions) ---
export interface SessionRecallHit {
  id_uuid: string;
  session_title: string;
  snippet: string;
  relevance: number;
  created_at_utc: string;
 // P0-3: Kontext-Fenster (±3 Nachrichten um den Treffer) + Lineage (1 Vorgänger) — optional, abwärtskompatibel
  context_window?: Array<{ role: string; content: string; timestamp_utc?: string }>;
  parent_session?: {
    id_uuid: string;
    session_title: string;
    snippet: string;
    created_at_utc: string;
  };
}

// --- S5: Skill-Frontmatter (Workflows als Skill-Module) ---
export interface SkillFrontmatter {
  description: string;
  tags: string[];
  version: number;
  category?: string;
  pitfalls?: string[];
}

// --- S7: Agentic Cron-Jobs ---
export interface AgentJob {
  id_uuid: string;
  tenant_id: string;
  job_name: string;
  job_prompt: string;
  schedule_type: 'hourly' | 'daily' | 'weekly';
  schedule_time?: string;
  schedule_weekday?: number;
  deliver_to: 'telegram' | 'mail_draft' | 'session';
  deliver_target?: string;
  is_active: boolean;
  last_run_at_utc?: string | null;
  job_type?: 'agent' | 'script' | 'monitor';
  script_path?: string | null;
 // P1-3: Tool-Domänen-Limit (NULL/[] = alle Domänen)
  allowed_domains?: ('CORE' | 'CRM_READ' | 'CRM_WRITE' | 'KNOWLEDGE' | 'KANBAN' | 'TEMPLATES' | 'WORKFLOWS')[] | null;
  monitor_hash?: string | null;
  monitor_last_output?: string | null;
  created_at_utc: string;
  updated_at_utc: string;
}

// --- S8: Governance-Rules-Engine ---
export type GovernanceAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND' | 'MOVE' | 'EXPORT' | 'EXECUTE';
export type GovernanceEffect = 'BLOCK' | 'ASK' | 'REQUIRE_APPROVAL' | 'ALLOW';
export interface GovernanceRule {
  id_uuid: string;
  tenant_id: string;
  rule_name: string;
  entity_type?: string | null;
  action: GovernanceAction;
  effect: GovernanceEffect;
  note: string;
  is_active: boolean;
  created_at_utc: string;
  updated_at_utc: string;
}

// --- S9: Sub-Agent-Delegation ---
export interface SubTaskSpec {
  subtask_id: string;
  task_prompt: string;
  required_tools?: string[];
  max_turns: number;
}
export interface SubTaskResult {
  subtask_id: string;
  status: 'success' | 'failed';
  final_text: string;
  tool_trace: Array<{ tool: string; query: string }>;
  error?: string;
  verification_status?: 'UNVERIFIED' | 'VERIFIED' | 'NOT_APPLICABLE';
}

// --- S11 Teil A: Delegations-Verifikation ---
export interface VerifySubtaskArgs {
  subtask_id: string;
  evidence: string;
}

// --- S11 Teil C: ASK-Governance ---
export interface AskUserQuestionArgs {
  question: string;
  choices?: string[];
  context?: string;
}
export interface AgentQuestion {
  id_uuid: string;
  tenant_id: string;
  question: string;
  choices_json: string;
  context_text: string;
  status: 'OPEN' | 'ANSWERED';
  answer: string;
  created_by: string;
  created_at_utc: string;
  answered_at_utc?: string;
}

