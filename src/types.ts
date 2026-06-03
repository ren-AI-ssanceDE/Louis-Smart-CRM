export interface Session {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
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
  metadata?: Record<string, any> | null;
}

export interface Company extends AIMetadata {
  id_uuid?: string;
  full_legal_name: string;
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
  full_legal_name?: string;
  first_name?: string;
  last_name: string;
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
  payment_status: 'pending' | 'paid' | 'overdue' | 'draft';
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
  status: 'pending' | 'paid' | 'overdue' | 'draft';
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
  created_at_utc?: string;
  updated_at_utc?: string;
}

export interface LouisAiKnowledgeMetadata {
  id_uuid: string;
  tenant_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  document_hash: string;
  created_at_utc: string;
  updated_at_utc: string;
}

export interface LouisAiKnowledgeChunk {
  id_uuid: string;
  tenant_id: string;
  document_id: string;
  chunk_text: string;
  embedding: number[] | string | null;
  created_at_utc: string;
  updated_at_utc: string;
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

export interface ProposedChanges {
  entity_type: 'companies' | 'contacts' | 'invoices' | 'emails';
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND';
  id_uuid?: string;
  proposed_state: Record<string, unknown>;
  explanation_rational: string;
}

export interface LouisAiMetrics {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelUsageMetadata {
  promptTokenCount?: number;
  prompt_token_count?: number;
  candidatesTokenCount?: number;
  candidates_token_count?: number;
}

export interface ChatMessage {
  role: 'user' | 'model' | 'assistant' | 'system';
  content: string;
  timestamp_utc?: string;
  metadata?: Record<string, unknown> | null;
  thought_log?: string | string[];
  proposed_changes?: ProposedChanges | null;
  metrics?: LouisAiMetrics | null;
}

