import { z } from "zod";

// --- Strictly defined TypeScript Interfaces representing LLM Tool Arguments ---

export interface CreateInvoiceItemArgs {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  vat_rate?: number | string;
  total_net?: number;
  unit_code?: string;
}

export interface CreateInvoiceArgs {
  company_id?: string | null;
  contact_id?: string | null;
  is_vat_inclusive?: boolean;
  items_list?: CreateInvoiceItemArgs[];
  introductory_text?: string | null;
  closing_text?: string | null;
  payment_term?: string | null;
  due_date?: string | null;
  currency_code?: string | null;
  leitweg_id?: string | null;
}

export interface CreateCompanyArgs {
  full_legal_name: string;
  street?: string | null;
  house_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  tax_vat_id?: string | null;
  tax_number?: string | null;
  responsible_person?: string | null;
  country_code?: string | null;
  email_2?: string | null;
  website?: string | null;
  mobile_number?: string | null;
  fax_number?: string | null;
  iban?: string | null;
  bic_swift?: string | null;
  leitweg_id?: string | null;
  payment_term?: string | null;
  price_list?: string | null;
  custom_documents?: string | null;
  vat_rate?: number | null;
  currency_code?: string | null;
  language?: string | null;
}

export interface CreateContactArgs {
  first_name?: string | null;
  last_name: string;
  salutation?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  associated_company_id?: string | null;
  street?: string | null;
  house_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  gender_identity?: string | null;
  date_of_birth?: string | null;
  region?: string | null;
  email_2?: string | null;
  website?: string | null;
  fax_number?: string | null;
  mobile_number?: string | null;
  language?: string | null;
  tax_vat_id?: string | null;
  iban?: string | null;
  bic_swift?: string | null;
  payment_term?: string | null;
  price_list?: string | null;
  custom_documents?: string | null;
}

// --- Strict Zod Schemas for Validation ---

export const CreateInvoiceItemZodSchema = z.object({
  description: z.string().min(1, "Beschreibung darf nicht leer sein."),
  quantity: z.union([z.number(), z.string()]).default(1),
  unit_price: z.union([z.number(), z.string()]).default(0),
  vat_rate: z.union([z.number(), z.string()]).optional(),
  total_net: z.number().optional(),
  unit_code: z.string().optional()
});

export const CreateInvoiceArgsZodSchema = z.object({
  company_id: z.string().uuid("company_id_must_be_uuid").optional().nullable(),
  contact_id: z.string().uuid("contact_id_must_be_uuid").optional().nullable(),
  is_vat_inclusive: z.boolean().optional(),
  items_list: z.array(CreateInvoiceItemZodSchema).min(1, "items_list_cannot_be_empty"),
  introductory_text: z.string().optional().nullable(),
  closing_text: z.string().optional().nullable(),
  payment_term: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  leitweg_id: z.string().optional().nullable()
});

export const CreateCompanyArgsZodSchema = z.object({
  full_legal_name: z.string().min(1, "Firmenname darf nicht leer sein."),
  street: z.string().optional().nullable(),
  house_number: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  email_address: z.string().trim().email("Ungültiges E-Mail-Format.").optional().nullable().or(z.literal('')),
  phone_number: z.string().optional().nullable(),
  tax_vat_id: z.string().optional().nullable(),
  tax_number: z.string().optional().nullable(),
  responsible_person: z.string().optional().nullable(),
  country_code: z.string().max(2).optional().nullable(),
  email_2: z.string().trim().email("Ungültiges E-Mail-Format für Zweitadresse.").optional().nullable().or(z.literal('')),
  website: z.string().optional().nullable().or(z.literal('')),
  mobile_number: z.string().optional().nullable(),
  fax_number: z.string().optional().nullable(),
  iban: z.string().optional().nullable().or(z.literal('')),
  bic_swift: z.string().optional().nullable().or(z.literal('')),
  leitweg_id: z.string().optional().nullable(),
  payment_term: z.string().optional().nullable(),
  price_list: z.string().optional().nullable(),
  custom_documents: z.string().optional().nullable(),
  vat_rate: z.number().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  language: z.string().optional().nullable()
});

export const CreateContactArgsZodSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().min(1, "Nachname darf nicht leer sein."),
  salutation: z.string().optional().nullable(),
  email_address: z.string().trim().email("Ungültiges E-Mail-Format.").optional().nullable().or(z.literal('')),
  phone_number: z.string().optional().nullable(),
  associated_company_id: z.string().uuid("associated_company_id muss eine gültige UUID sein.").optional().nullable().or(z.literal('')),
  street: z.string().optional().nullable(),
  house_number: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  gender_identity: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  email_2: z.string().trim().email("Ungültiges E-Mail-Format für Zweitadresse.").optional().nullable().or(z.literal('')),
  website: z.string().optional().nullable().or(z.literal('')),
  fax_number: z.string().optional().nullable(),
  mobile_number: z.string().optional().nullable(),
  language: z.string().optional().nullable(),
  tax_vat_id: z.string().optional().nullable(),
  iban: z.string().optional().nullable().or(z.literal('')),
  bic_swift: z.string().optional().nullable().or(z.literal('')),
  payment_term: z.string().optional().nullable(),
  price_list: z.string().optional().nullable(),
  custom_documents: z.string().optional().nullable()
});
