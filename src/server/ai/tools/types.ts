import { z } from "zod";

// G1 (Auftrag 009): Boolesche Werte aus LLM-Antworten normalisieren
// (true/false, "ja"/"nein", 1/0, "yes"/"no", "aktiv"/"inaktiv")
export function coerceBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "ja", "y", "j", "aktiv", "ein", "on", "wahr"].includes(s)) return true;
    if (["false", "0", "no", "nein", "n", "inaktiv", "aus", "off", "falsch"].includes(s)) return false;
  }
  return undefined;
}

// --- Universal ToolResult Envelope Interface ---
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}

export const ToolResultZodSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function createToolSuccess<T>(data: T, metadata?: Record<string, unknown>): ToolResult<T> {
  return {
    success: true,
    data,
    ...(metadata ? { metadata } : {})
  };
}

export function createToolError<T = unknown>(error: string, metadata?: Record<string, unknown>): ToolResult<T> {
  return {
    success: false,
    error,
    ...(metadata ? { metadata } : {})
  };
}

// --- Reusable ID preprocessor for canonical 'id' parameter ---
export const canonicalIdSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return obj.id || obj.id_uuid || obj.offer_id_uuid || obj.card_id || obj.board_id;
  }
  return val;
}, z.string().uuid("Gültige UUID erforderlich."));

// --- Strictly defined TypeScript Interfaces representing LLM Tool Arguments ---

export interface CreateInvoiceItemArgs {
  description: string;
  quantity?: number | string;
  unit_price?: number | string;
  vat_rate?: number | string;
  total_net?: number | string;
  unit_code?: string;
}

export interface CreateInvoiceArgs {
  company_id?: string | null;
  contact_id?: string | null;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
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
  company_id?: string | null;
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
  // G1 (Auftrag 009): Opt-in-Felder — optional, Default false
  opt_in_marketing?: boolean | null;
  opt_in_social_media?: boolean | null;
  opt_in_direct_message?: boolean | null;
  opt_in_sms?: boolean | null;
  opt_in_phone?: boolean | null;
}

// --- Strict Zod Schemas for Validation ---

export const CreateInvoiceItemZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    let vat_rate = obj.vat_rate ?? obj.vat;
    if (typeof vat_rate === "string") {
      vat_rate = parseFloat(vat_rate.replace("%", "").trim());
    }
    if (typeof vat_rate === "number" && vat_rate > 0 && vat_rate <= 1) {
      vat_rate = vat_rate * 100;
    }
    const description = obj.description || obj.desc || obj.name || obj.title || "";
    const unit_price = obj.unit_price ?? obj.price ?? obj.rate ?? 0;
    const quantity = obj.quantity ?? obj.qty ?? obj.count ?? obj.amount ?? 1;
    return { ...obj, vat_rate, description, unit_price, quantity };
  }
  return val;
}, z.object({
  description: z.string().min(1, "Beschreibung darf nicht leer sein."),
  quantity: z.coerce.number().positive("Menge muss größer als 0 sein.").default(1),
  unit_price: z.coerce.number().nonnegative("Einzelpreis darf nicht negativ sein.").default(0),
  vat_rate: z.coerce.number().nonnegative("MwSt.-Satz darf nicht negativ sein.").optional().default(19),
  total_net: z.coerce.number().nonnegative().optional(),
  unit_code: z.string().optional().default("PCE")
}));

export const CreateInvoiceObjectSchema = z.object({
  invoice_number: z.string().optional().nullable(),
  company_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  associated_company_id: z.string().optional().nullable(),
  associated_contact_id: z.string().optional().nullable(),
  issue_date: z.string().optional().nullable(),
  service_date: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  payment_status: z.string().optional().nullable(),
  is_vat_inclusive: z.boolean().optional(),
  items_list: z.array(CreateInvoiceItemZodSchema).min(1, "items_list_cannot_be_empty"),
  introductory_text: z.string().optional().nullable(),
  closing_text: z.string().optional().nullable(),
  payment_term: z.string().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  leitweg_id: z.string().optional().nullable()
});

export const CreateInvoiceArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const company_id = obj.company_id || obj.associated_company_id || obj.company_id_uuid;
    const contact_id = obj.contact_id || obj.associated_contact_id || obj.contact_id_uuid;
    const total_gross_amount = obj.total_gross_amount || obj.gross_amount;
    // 021-C (V2-3): invoice_line_items = Katalog-Feldname des MCP-Tools crm_create_invoice
    const items_list = obj.items_list || obj.items || obj.line_items || obj.positions || obj.invoice_line_items;
    return { ...obj, company_id, contact_id, total_gross_amount, items_list };
  }
  return val;
}, CreateInvoiceObjectSchema);

export const CreateCompanyObjectSchema = z.object({
  full_legal_name: z.string().min(1, "Firmenname darf nicht leer sein."),
  short_code: z.string().optional().nullable(),
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

export const CreateCompanyArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      full_legal_name: obj.full_legal_name || obj.name || obj.company_name,
      email_address: obj.email_address || obj.email,
      phone_number: obj.phone_number || obj.phone,
      tax_vat_id: obj.tax_vat_id || obj.vat_id || obj.tax_id,
    };
  }
  return val;
}, CreateCompanyObjectSchema);

export const CreateContactObjectSchema = z.object({
  first_name: z.string().optional().nullable(),
  last_name: z.string().min(1, "Nachname darf nicht leer sein."),
  salutation: z.string().optional().nullable(),
  email_address: z.string().trim().email("Ungültiges E-Mail-Format.").optional().nullable().or(z.literal('')),
  phone_number: z.string().optional().nullable(),
  company_id: z.string().uuid("company_id muss eine gültige UUID sein.").optional().nullable().or(z.literal('')),
  associated_company_id: z.string().optional().nullable().or(z.literal('')),
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
  custom_documents: z.string().optional().nullable(),
  // G1 (Auftrag 009): Opt-in-Felder — boolean, optional (Default false)
  opt_in_marketing: z.boolean().optional().nullable(),
  opt_in_social_media: z.boolean().optional().nullable(),
  opt_in_direct_message: z.boolean().optional().nullable(),
  opt_in_sms: z.boolean().optional().nullable(),
  opt_in_phone: z.boolean().optional().nullable()
});

export const CreateContactArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const company_id = obj.company_id || obj.associated_company_id || obj.company_id_uuid;
    const email_address = obj.email_address || obj.email || obj.mail;
    const phone_number = obj.phone_number || obj.phone || obj.mobile || obj.mobile_number || obj.telefon;
    const street = obj.street || obj.street_address || obj.address || obj.adresse;
    const house_number = obj.house_number || obj.hausnummer;
    const postal_code = obj.postal_code || obj.zip || obj.plz || obj.postleitzahl;
    const city = obj.city || obj.ort || obj.stadt;

    let first_name = obj.first_name ? String(obj.first_name).trim() : undefined;
    let last_name = obj.last_name ? String(obj.last_name).trim() : undefined;

    const nameField = (obj.full_name || obj.name || obj.full_legal_name || obj.contact_name) as string | undefined;

    if (!last_name) {
      if (nameField && typeof nameField === 'string' && nameField.trim()) {
        const parts = nameField.trim().split(/\s+/);
        if (parts.length > 1) {
          first_name = first_name || parts.slice(0, -1).join(' ');
          last_name = parts[parts.length - 1];
        } else {
          last_name = parts[0];
        }
      } else if (first_name) {
        const parts = first_name.split(/\s+/);
        if (parts.length > 1) {
          first_name = parts.slice(0, -1).join(' ');
          last_name = parts[parts.length - 1];
        } else {
          last_name = first_name;
          first_name = undefined;
        }
      }
    }

    return {
      ...obj,
      company_id,
      email_address,
      phone_number,
      street,
      house_number,
      postal_code,
      city,
      first_name,
      last_name,
      // G1 (Auftrag 009): Opt-in-Aliase normalisieren (true/false, "ja"/"nein", 1/0, "yes"/"no")
      opt_in_marketing: coerceBool(obj.opt_in_marketing ?? obj.marketing_opt_in ?? obj.newsletter_opt_in),
      opt_in_social_media: coerceBool(obj.opt_in_social_media ?? obj.social_media_opt_in),
      opt_in_direct_message: coerceBool(obj.opt_in_direct_message ?? obj.direct_message_opt_in),
      opt_in_sms: coerceBool(obj.opt_in_sms ?? obj.sms_opt_in),
      opt_in_phone: coerceBool(obj.opt_in_phone ?? obj.phone_opt_in ?? obj.telefon_opt_in)
    };
  }
  return val;
}, CreateContactObjectSchema);

// G2 (Auftrag 009): Update-Schemas — preprocess (Aliase + coerceBool) + partial,
// damit nur bereitgestellte Felder geändert werden. id_uuid/id sind Pflicht fürs Update.
export const UpdateCompanyArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id_uuid = obj.id_uuid || obj.id || obj.company_id_uuid;
    return { ...obj, id_uuid };
  }
  return val;
}, CreateCompanyObjectSchema.partial().extend({
  id_uuid: z.string().uuid("id_uuid muss eine gültige UUID sein.").optional(),
  id: z.string().optional()
}));

export const UpdateContactArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id_uuid = obj.id_uuid || obj.id || obj.contact_id_uuid;
    return {
      ...obj,
      id_uuid,
      // Opt-in-Aliase normalisieren (identisch zu CreateContactArgsZodSchema)
      opt_in_marketing: coerceBool(obj.opt_in_marketing ?? obj.marketing_opt_in ?? obj.newsletter_opt_in),
      opt_in_social_media: coerceBool(obj.opt_in_social_media ?? obj.social_media_opt_in),
      opt_in_direct_message: coerceBool(obj.opt_in_direct_message ?? obj.direct_message_opt_in),
      opt_in_sms: coerceBool(obj.opt_in_sms ?? obj.sms_opt_in),
      opt_in_phone: coerceBool(obj.opt_in_phone ?? obj.phone_opt_in ?? obj.telefon_opt_in)
    };
  }
  return val;
}, CreateContactObjectSchema.partial().extend({
  id_uuid: z.string().uuid("id_uuid muss eine gültige UUID sein.").optional(),
  id: z.string().optional()
}));

// --- Offer Tools Interfaces & Zod Schemas ---

export interface CreateOfferItemArgs {
  position?: number | string;
  description?: string;
  quantity?: number | string;
  unit_code?: string;
  unit_price?: number | string;
  vat_rate?: number | string;
  is_text_position?: boolean;
}

export interface CreateOfferArgs {
  company_id?: string | null;
  contact_id?: string | null;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  offer_number?: string; // optional: gewünschte Angebotsnummer (sonst System-Nummer AG-YYYY-XXXX)
  title: string;
  introductory_text?: string;
  closing_text?: string;
  issue_date?: string; // Format: YYYY-MM-DD
  valid_until?: string; // Format: YYYY-MM-DD
  payment_term?: string;
  currency_code?: string; // Standard: "EUR"
  is_vat_inclusive?: boolean;
  line_items: CreateOfferItemArgs[];
}

export interface FinalizeOfferArgs {
  id?: string;
  offer_id_uuid?: string;
  direct_send?: boolean; // Falls true, direkter SMTP-Versand, sonst Mail-Entwurf
}

export const CreateOfferItemZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    let vat_rate = obj.vat_rate ?? obj.vat;
    if (typeof vat_rate === "string") {
      vat_rate = parseFloat(vat_rate.replace("%", "").trim());
    }
    if (typeof vat_rate === "number" && vat_rate > 0 && vat_rate <= 1) {
      vat_rate = vat_rate * 100;
    }
    const description = obj.description || obj.desc || obj.name || obj.title || "";
    const unit_price = obj.unit_price ?? obj.price ?? obj.rate ?? 0;
    const quantity = obj.quantity ?? obj.qty ?? obj.count ?? obj.amount ?? 1;
    return { ...obj, vat_rate, description, unit_price, quantity };
  }
  return val;
}, z.object({
  position: z.coerce.number().int().nonnegative().optional().default(0),
  description: z.string().optional().default(""),
  quantity: z.coerce.number().positive("Menge muss größer als 0 sein.").default(1),
  unit_code: z.string().optional().default("PCE"),
  unit_price: z.coerce.number().nonnegative("Einzelpreis darf nicht negativ sein.").default(0),
  vat_rate: z.coerce.number().nonnegative("MwSt.-Satz darf nicht negativ sein.").optional().default(19),
  is_text_position: z.boolean().optional().default(false)
}));

export const CreateOfferObjectSchema = z.object({
  company_id: z.string().uuid("Ungültige Company-UUID").optional().nullable(),
  contact_id: z.string().uuid("Ungültige Contact-UUID").optional().nullable(),
  associated_company_id: z.string().optional().nullable(),
  associated_contact_id: z.string().optional().nullable(),
  offer_number: z.string().optional().nullable(),
  title: z.string().min(1, "Angebotstitel darf nicht leer sein."),
  introductory_text: z.string().optional().default(""),
  closing_text: z.string().optional().default(""),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum-Format muss YYYY-MM-DD sein.").optional(),
  valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum-Format muss YYYY-MM-DD sein.").optional(),
  payment_term: z.string().optional().default(""),
  currency_code: z.string().optional().default("EUR"),
  is_vat_inclusive: z.boolean().optional().default(false),
  line_items: z.array(CreateOfferItemZodSchema).min(1, "Das Angebot muss mindestens eine Position enthalten.")
});

export const CreateOfferArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const company_id = obj.company_id || obj.associated_company_id || obj.company_id_uuid;
    const contact_id = obj.contact_id || obj.associated_contact_id || obj.contact_id_uuid;
    const total_gross_amount = obj.total_gross_amount || obj.gross_amount;
    const line_items = obj.line_items || obj.items || obj.items_list || obj.positions;
    const offer_number = obj.offer_number || obj.offerNumber || obj.number || obj.offer_no;
    return { ...obj, company_id, contact_id, total_gross_amount, line_items, offer_number };
  }
  return val;
}, CreateOfferObjectSchema);

export const FinalizeOfferArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id = obj.id || obj.offer_id_uuid || obj.id_uuid || obj.offer_id;
    return { ...obj, id };
  }
  return val;
}, z.object({
  id: z.string().uuid("Ungültige Angebots-UUID."),
  offer_id_uuid: z.string().optional(),
  id_uuid: z.string().optional(),
  direct_send: z.boolean().optional().default(false)
}));

export const SendEmailObjectSchema = z.object({
  recipient_email_address: z.string().optional().default(""),
  email_subject_text: z.string().optional().default("Mitteilung von Louis CRM"),
  email_body_content: z.string().optional().default("Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Mitteilung."),
  invoice_id: z.string().optional().nullable(),
  attachments: z.array(z.object({
    filename: z.string(),
    source: z.string()
  })).optional().nullable()
});

export const SendEmailArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const recipient_email_address = obj.recipient_email_address || obj.recipient || obj.to || obj.email_address || obj.email || "";
    const email_subject_text = obj.email_subject_text || obj.subject || obj.email_subject || obj.title || obj.subj || "Mitteilung von Louis CRM";
    const email_body_content = obj.email_body_content || obj.body || obj.content || obj.message || obj.text || "Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Mitteilung.";
    const invoice_id = obj.invoice_id || obj.invoice_id_uuid || obj.invoice || null;
    return { ...obj, recipient_email_address, email_subject_text, email_body_content, invoice_id };
  }
  return val;
}, SendEmailObjectSchema);

export const DeleteEntityObjectSchema = z.object({
  id: z.string().uuid("Gültige UUID erforderlich."),
  id_uuid: z.string().optional(),
  reason: z.string().optional()
});

export const DeleteEntityArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id = obj.id || obj.id_uuid;
    return { ...obj, id };
  }
  return val;
}, DeleteEntityObjectSchema);

export const UpdateEntityArgsZodSchema = z.union([
  CreateCompanyObjectSchema.partial(),
  CreateContactObjectSchema.partial(),
  CreateInvoiceObjectSchema.partial(),
  CreateOfferObjectSchema.partial()
]);

// G5/G6 (Auftrag 009): Update-Schemas für Rechnung + Angebot (partial, id-Pflicht)
// Bewusst NACH allen Create-Schemas — Referenzen müssen vorher existieren (TDZ).
export const UpdateInvoiceArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id_uuid = obj.id_uuid || obj.id || obj.invoice_id_uuid;
    const company_id = obj.company_id || obj.associated_company_id || obj.company_id_uuid;
    const contact_id = obj.contact_id || obj.associated_contact_id || obj.contact_id_uuid;
    const items_list = obj.items_list || obj.items || obj.line_items || obj.positions;
    return { ...obj, id_uuid, company_id, contact_id, items_list };
  }
  return val;
}, CreateInvoiceObjectSchema.partial().extend({
  id_uuid: z.string().uuid("id_uuid muss eine gültige UUID sein.").optional(),
  id: z.string().optional()
}));

export const UpdateOfferArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id_uuid = obj.id_uuid || obj.id || obj.offer_id_uuid;
    const company_id = obj.company_id || obj.associated_company_id || obj.company_id_uuid;
    const contact_id = obj.contact_id || obj.associated_contact_id || obj.contact_id_uuid;
    const line_items = obj.line_items || obj.items || obj.items_list || obj.positions;
    return { ...obj, id_uuid, company_id, contact_id, line_items };
  }
  return val;
}, CreateOfferObjectSchema.partial().extend({
  id_uuid: z.string().uuid("id_uuid muss eine gültige UUID sein.").optional(),
  id: z.string().optional()
}));

export const ProposeCrmChangesArgsZodSchema = z.preprocess((val) => {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    const id = obj.id || obj.id_uuid;
    return { ...obj, id };
  }
  return val;
}, z.object({
  entity_type: z.enum(["companies", "contacts", "invoices", "emails", "offers", "kanban_board", "kanban_column", "kanban_card"]),
  action: z.enum(["CREATE", "UPDATE", "DELETE", "SEND", "MOVE"]),
  id: z.string().optional().nullable(),
  id_uuid: z.string().optional().nullable(),
  proposed_state: z.record(z.string(), z.unknown()).describe("The fully structured fields matching the database schema properties"),
  explanation_rational: z.string().describe("Short 1-sentence motivation for the user why this CRM change is drafted")
}));

export type ProposeCrmChangesArgs = z.infer<typeof ProposeCrmChangesArgsZodSchema>;

// Adaptive Detailtiefe für Tool-Anfragen
export const DetailLevelZodSchema = z.enum(["summary", "detailed"]).default("summary");
export type DetailLevel = z.infer<typeof DetailLevelZodSchema>;

// Schlankes Firmen-Kontext-Schema für das LLM
export const CompanySummaryAiResponseSchema = z.object({
  id: z.string(),
  full_legal_name: z.string(),
  city: z.string().nullable().optional(),
  email_address: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  responsible_person: z.string().nullable().optional(),
  tax_vat_id: z.string().nullable().optional(),
});
export type CompanySummaryAiResponse = z.infer<typeof CompanySummaryAiResponseSchema>;

// Schlankes Kontakt-Kontext-Schema für das LLM
export const ContactSummaryAiResponseSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email_address: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  company_id: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  house_number: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});
export type ContactSummaryAiResponse = z.infer<typeof ContactSummaryAiResponseSchema>;

// Schlankes Rechnungs-Kontext-Schema
export const InvoiceSummaryAiResponseSchema = z.object({
  id: z.string(),
  invoice_number: z.string(),
  total_gross_amount: z.number(),
  payment_status: z.string(),
  company_name: z.string().nullable().optional(),
  company_id: z.string().nullable().optional(),
  contact_id: z.string().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  contact_email: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});
export type InvoiceSummaryAiResponse = z.infer<typeof InvoiceSummaryAiResponseSchema>;

// Schlankes Angebots-Kontext-Schema
export const OfferSummaryAiResponseSchema = z.object({
  id: z.string(),
  offer_number: z.string(),
  title: z.string(),
  total_gross_amount: z.number(),
  offer_status: z.string(),
  company_name: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
});
export type OfferSummaryAiResponse = z.infer<typeof OfferSummaryAiResponseSchema>;

// Schlankes RAG-Knowledge-Chunk-Schema
export const KnowledgeChunkSummaryAiResponseSchema = z.object({
  file_name: z.string(),
  chunk_index: z.number(),
  relevance_score: z.number().optional(),
  snippet: z.string(),
});
export type KnowledgeChunkSummaryAiResponse = z.infer<typeof KnowledgeChunkSummaryAiResponseSchema>;

// --- Paginierte Listen-Eingabeschemas ---

export const ListCompaniesInputSchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  detail_level: z.enum(["summary", "detailed"]).default("summary")
});

export const ListContactsInputSchema = z.object({
  search: z.string().optional(),
  company_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  detail_level: z.enum(["summary", "detailed"]).default("summary")
});

export const ListInvoicesInputSchema = z.object({
  search: z.string().optional(),
  payment_status: z.enum(["draft", "issued", "paid", "cancelled", "overdue", "pending"]).optional(),
  company_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  detail_level: z.enum(["summary", "detailed"]).default("summary"),
  sort_by: z.enum(["issue_date", "due_date", "invoice_number", "total_gross_amount"]).optional().default("issue_date"),
  sort_order: z.enum(["asc", "desc"]).optional().default("desc")
});

export const ListVaultFilesInputSchema = z.object({
  filter: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0)
});

// Inferierte TypeScript-Typen
export type ListCompaniesInput = z.infer<typeof ListCompaniesInputSchema>;
export type ListContactsInput = z.infer<typeof ListContactsInputSchema>;
export type ListInvoicesInput = z.infer<typeof ListInvoicesInputSchema>;
export type ListVaultFilesInput = z.infer<typeof ListVaultFilesInputSchema>;

// Standardisierte paginierte Antwort-Struktur
export interface PaginatedToolResponse<T> {
  items: T[];
  pagination: {
    total_count: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  search_meta?: {
    searched_term?: string;
    fuzzy_matched: boolean;
    fallback_used?: boolean;
    note?: string;
  };
}



