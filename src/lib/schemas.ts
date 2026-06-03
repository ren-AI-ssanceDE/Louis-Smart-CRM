import { z } from 'zod';

export const CompanySchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  full_legal_name: z.string().min(1).max(255),
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
  vat_rate: z.number().default(19),
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
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  customAttachments: z.array(z.object({
    filename: z.string(),
    content: z.string(), // base64 encoded
    contentType: z.string().optional()
  })).optional(),
});

export const InvoiceLineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unit_price: z.number(),
  vat_rate: z.number(),
  total_net: z.number(),
  unit_code: z.string().optional().default('HUR'),
});

export const InvoiceSchema = z.object({
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
  total_net_amount: z.number(),
  total_vat_amount: z.number(),
  total_gross_amount: z.number(),
  vat_rate: z.number().default(19),
  currency_code: z.string().default('EUR'),
  leitweg_id: z.string().optional().nullable(),
  invoice_line_items: z.array(InvoiceLineItemSchema).default([]),
  introductory_text: z.string().optional().nullable().default(''),
  closing_text: z.string().optional().nullable().default(''),
  payment_status: z.enum(['pending', 'paid', 'overdue', 'draft']).default('pending'),
  raw_source_data: z.string().optional().nullable(),
  zugferd_xml_metadata: z.string().optional().nullable(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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

export const InvoiceFullSchema = InvoiceSchema.extend({
  company_name: z.string().optional(),
  contact_full_name: z.string().optional(),
  invoice_line_items_json: z.string().optional(),
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const EmailTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  email_subject_text: z.string().min(1),
  email_body_content: z.string(),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const InvoiceTextTemplateFullSchema = InvoiceTextTemplateSchema.extend({
  created_at_utc: z.string().or(z.date()),
  updated_at_utc: z.string().or(z.date()),
});

export const InvoiceItemTemplateSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  template_name_text: z.string().min(1),
  description: z.string().default(''),
  quantity: z.number().default(1),
  unit_price: z.number().default(0),
  vat_rate: z.number().default(19),
  unit_code: z.string().default('HUR'),
  created_by_identity: z.enum(['human', 'ai_assistant', 'system']).default('human'),
  ai_confidence_score: z.number().min(0).max(1).default(1.0),
  is_verified_by_human: z.boolean().default(false),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
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
  embedding_provider: z.enum(['ollama', 'openai', 'gemini']).default('gemini'),
  embedding_api_key_secret: z.string().optional().nullable().default(''),
  embedding_base_url: z.string().url().optional().nullable().or(z.literal('')).default(''),
  embedding_model_name: z.string().default('text-embedding-004'),
  vector_dimensions: z.number().int().positive().default(1536),
  keep_alive_minutes: z.number().int().nonnegative().default(5),
  parallel_slots: z.number().int().positive().default(1),
  chunk_size: z.number().int().positive().default(500),
  chunk_overlap: z.number().int().nonnegative().default(50),
});

export const TextGeneratorConfigSchema = z.object({
  id_uuid: z.string().uuid().optional(),
  tenant_id: z.string().default('1'),
  system_prompt: z.string().min(1),
  temperature: z.number().min(0).max(1).default(0.7),
  max_tokens: z.number().int().positive().default(2000),
  model_name: z.string().default('gemini-3.5-flash'),
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
});

export const ProposedDiffSchema = z.object({
  entity_type: z.enum(['companies', 'contacts', 'invoices', 'emails']),
  id_uuid: z.string().uuid().optional().nullable(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'SEND']),
  previous_state: z.record(z.string(), z.any()).optional().nullable(),
  proposed_state: z.record(z.string(), z.any()),
  explanation_rational: z.string()
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
  entity_id: z.string().uuid().optional(), // Optional für 'user' (nutzt ctx.userId), Pflicht für company/contact
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
  created_at_utc: z.any().optional(),
  updated_at_utc: z.any().optional(),
});


