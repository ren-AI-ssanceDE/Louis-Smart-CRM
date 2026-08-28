import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent, cleanDbRow, cleanLigatureHacksFromValue } from "../../db.js";
import { 
  CreateInvoiceArgsZodSchema, 
  CreateCompanyArgsZodSchema, 
  CreateContactArgsZodSchema,
  UpdateCompanyArgsZodSchema,
  UpdateContactArgsZodSchema,
  UpdateInvoiceArgsZodSchema,
  UpdateOfferArgsZodSchema,
  CreateOfferArgsZodSchema,
  FinalizeOfferArgsZodSchema,
  CompanySummaryAiResponse,
  ContactSummaryAiResponse,
  InvoiceSummaryAiResponse,
  OfferSummaryAiResponse,
  DetailLevel,
  ToolResult,
  createToolSuccess,
  createToolError,
  ListCompaniesInputSchema,
  ListContactsInputSchema,
  ListInvoicesInputSchema,
  PaginatedToolResponse
} from "./types.js";
import {
  AIListKanbanBoardsInputSchema,
  AIGetKanbanBoardDetailsInputSchema,
  AICreateKanbanCardInputSchema,
  AIMoveKanbanCardInputSchema,
  AIUpdateKanbanCardInputSchema,
  AIDeleteKanbanCardInputSchema,
  CreateNoteDraftInputSchema
} from "../../../lib/schemas.js";
import { workflowEventBus } from "../workflowEventBus.js";
import { normalizeQueryValue } from "../vaultStore.js";
import { offersRouter } from "../../routers/offers.js";
import { Company, Contact, Invoice, Offer, OfferLineItem, Context } from "../../../types.js";

/**
 * Formatiert ein Firmen-Datenbankobjekt in einen schlanken KI-Kontext
 */
export function formatCompanyForAiContext(
  company: Company | Record<string, unknown>,
  detailLevel: DetailLevel = "summary"
): CompanySummaryAiResponse | Record<string, unknown> {
  const c = company as Record<string, unknown>;
  const name = String(c.full_legal_name || c.name || "Unbekannt");
  const email = (c.email_address || c.email) ? String(c.email_address || c.email) : null;
  const phone = (c.phone_number || c.phone) ? String(c.phone_number || c.phone) : null;
  const vatId = (c.tax_vat_id || c.vat_id) ? String(c.tax_vat_id || c.vat_id) : null;

  const summary: CompanySummaryAiResponse = {
    id: String(c.id_uuid || c.id || ""),
    full_legal_name: name,
    city: c.city ? String(c.city) : null,
    email_address: email,
    phone_number: phone,
    responsible_person: c.responsible_person ? String(c.responsible_person) : null,
    tax_vat_id: vatId,
  };

  if (detailLevel === "detailed") {
    return {
      ...summary,
      street: c.street ? String(c.street) : null,
      postal_code: c.postal_code ? String(c.postal_code) : null,
      iban: c.iban ? String(c.iban) : null,
      bic_swift: c.bic_swift ? String(c.bic_swift) : null,
      payment_term: c.payment_term ? String(c.payment_term) : null,
    };
  }

  return summary;
}

/**
 * Formatiert ein Kontakt-Datenbankobjekt in einen schlanken KI-Kontext
 */
export function formatContactForAiContext(
  contact: Contact | Record<string, unknown>,
  detailLevel: DetailLevel = "summary"
): ContactSummaryAiResponse | Record<string, unknown> {
  const c = contact as Record<string, unknown>;
  const email = (c.email_address || c.email) ? String(c.email_address || c.email) : null;
  const phone = (c.phone_number || c.phone) ? String(c.phone_number || c.phone) : null;
  const companyId = (c.associated_company_id || c.company_id) ? String(c.associated_company_id || c.company_id) : null;
  
  const summary = {
    id: String(c.id_uuid || c.id || ""),
    full_name: String(c.full_legal_name || `${c.first_name || ''} ${c.last_name || ''}`.trim() || "Unbekannt"),
    first_name: c.first_name ? String(c.first_name) : null,
    last_name: c.last_name ? String(c.last_name) : null,
    email_address: email,
    phone_number: phone,
    company_name: c.company_name ? String(c.company_name) : null,
    company_id: companyId,
    street: c.street ? String(c.street) : null,
    house_number: c.house_number ? String(c.house_number) : null,
    postal_code: c.postal_code ? String(c.postal_code) : null,
    city: c.city ? String(c.city) : null,
  };

  if (detailLevel === "detailed") {
    return {
      ...c,
      ...summary,
    };
  }

  return summary;
}

/**
 * Formatiert ein Rechnungs-Datenbankobjekt in einen schlanken KI-Kontext
 */
export function formatInvoiceForAiContext(
  invoice: Invoice | Record<string, unknown>,
  detailLevel: DetailLevel = "summary"
): InvoiceSummaryAiResponse | Record<string, unknown> {
  const i = invoice as Record<string, unknown>;
  const paymentStatus = String(i.payment_status || i.status || "issued");
  const amount = Number(i.total_gross_amount || i.gross_amount || 0);

  const companyId = (i.associated_company_id || i.company_id) ? String(i.associated_company_id || i.company_id) : null;
  const contactId = (i.associated_contact_id || i.contact_id) ? String(i.associated_contact_id || i.contact_id) : null;
  const companyName = (i.company_name || i.company_full_name) ? String(i.company_name || i.company_full_name) : null;
  const contactName = (i.contact_name || i.contact_full_name) ? String(i.contact_name || i.contact_full_name) : null;
  const contactEmail = (i.contact_email || i.email_address || i.email) ? String(i.contact_email || i.email_address || i.email) : null;

  const summary: InvoiceSummaryAiResponse = {
    id: String(i.id_uuid || i.id || ""),
    invoice_number: String(i.invoice_number || ""),
    total_gross_amount: amount,
    payment_status: paymentStatus,
    company_name: companyName,
    company_id: companyId,
    contact_id: contactId,
    contact_name: contactName,
    contact_email: contactEmail,
    issue_date: i.issue_date ? String(i.issue_date) : null,
    due_date: i.due_date ? String(i.due_date) : null,
  };

  if (detailLevel === "detailed") {
    return {
      ...summary,
      total_net_amount: i.total_net_amount !== undefined && i.total_net_amount !== null ? Number(i.total_net_amount) : null,
      total_vat_amount: i.total_vat_amount !== undefined && i.total_vat_amount !== null ? Number(i.total_vat_amount) : null,
      invoice_line_items: i.invoice_line_items || i.invoice_line_items_json || null
    };
  }

  return summary;
}

/**
 * Formatiert ein Angebots-Datenbankobjekt in einen schlanken KI-Kontext
 */
export function formatOfferForAiContext(
  offer: Offer | Record<string, unknown>,
  detailLevel: DetailLevel = "summary"
): OfferSummaryAiResponse {
  const o = offer as Record<string, unknown>;
  const offerStatus = String(o.offer_status || o.status || "draft");
  const amount = Number(o.total_gross_amount || o.gross_amount || 0);

  return {
    id: String(o.id_uuid || o.id || ""),
    offer_number: String(o.offer_number || ""),
    title: String(o.title || ""),
    total_gross_amount: amount,
    offer_status: offerStatus,
    company_name: o.company_name ? String(o.company_name) : null,
    issue_date: o.issue_date ? String(o.issue_date) : null,
  };
}



/**
 * Helper to determine if a query is a general/generic "list" or "all" command
 */
function isGenericQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  
  const commonSentences = [
    "list all companies", "list all contacts", "list all invoices",
    "all companies", "all contacts", "all invoices",
    "list companies", "list contacts", "list invoices",
    "show all companies", "show all contacts", "show all invoices",
    "get all companies", "get all contacts", "get all invoices",
    "welche unternehmen sind aktuell im crm hinterlegt?",
    "welche unternehmen sind hinterlegt",
    "welche unternehmen",
    "show list", "show lists", "list of", "overview of",
    "alle unternehmen", "alle kontakte", "alle rechnungen",
    "kontakte auflisten", "unternehmen auflisten", "rechnungen auflisten",
    "zeige alle", "list info", "detailed information"
  ];
  if (commonSentences.includes(q)) return true;

  const words = q.split(/\s+/);
  const singleWordGenerics = [
    "list", "all", "show", "get", "alle", "auflisten", "anzeigen", "welche",
    "companies", "contacts", "invoices", "unternehmen", "kontakte", "rechnungen",
    "overview", "uebersicht", "übersicht", "summary", "everything"
  ];
  if (words.length === 1 && singleWordGenerics.includes(words[0])) {
    return true;
  }
  
  const allWordsGeneric = words.every(word => singleWordGenerics.includes(word));
  if (allWordsGeneric) return true;

  return false;
}

function getSearchTerms(query: string): string[] {
  const q = query.toLowerCase().replace(/[?.,!;:]/g, " ").trim();
  const words = q.split(/\s+/);
  const stopwords = new Set([
    // Global & Question terms
    "welche", "welcher", "welches", "sind", "ist", "in", "im", "registriert", "gemeldet",
    "hinterlegt", "hinterlegten", "wohnhaft", "aus", "mit", "details", "zeigen", "zeige",
    "mir", "eine", "einen", "ein", "der", "die", "das", "von", "alle", "aller", "aktuell",
    "aktuellen", "kontakte", "kontakt", "unternehmen", "firma", "firmen", "rechnung",
    "rechnungen", "gmbh", "co", "kg", "und", "gesucht", "suche", "finde", "hole", "get",
    "list", "show", "all", "companies", "contacts", "invoices", "who", "which", "are",
    "registered", "located", "in", "by", "for", "with", "status", "to", "at", "where",
    "anzahl", "wieviele", "wie", "viele", "viel", "gesamt", "gesamte", "gesamtzahl", "menge", 
    "summe", "sum", "total", "zahl", "zahlen", "zählen", "zaehlen", "gibt", "es", "existieren", 
    "haben", "hat", "wohnen", "kommen", "kommt", "stammen", "stammt", "hast", "du", "sie",
    "amount", "count", "number", "how", "many", "much", "quantity", "give", "me", "find", 
    "search", "lookup", "tell", "we", "i", "you", "exist", "have", "has", "do", "does",

    // German CRM fields, query helpers, and common filler verbs
    "lautet", "lauteten", "heißt", "heisst", "telefon", "telefonnummer", "telefonnummern", 
    "email", "e-mail", "mail", "adresse", "stadt", "ort", "plz", "postleitzahl", "straße", 
    "strasse", "hausnummer", "web", "website", "webseite", "iban", "bic", "swift", "steuer", 
    "steuern", "steuernummer", "ust", "id", "vat", "fax", "verantwortlicher", "inhaber", 
    "chef", "boss", "leiter", "person", "ansprechpartner", "verantwortliche", "daten", 
    "info", "informationen", "detail", "details", "nummer", "no", "nr", "nachname", 
    "vorname", "name", "namen", "ag", "gbr", "ug", "ohg", "e.k.", "e.v.", "gib", "gebe", 
    "nenne", "nennen", "schreibe", "schreiben", "suchen", "such", "finde", "findest", 
    "weißt", "weisst", "wissen", "kennst", "kennen", "wer", "was", "wo", "wann", "warum", 
    "dem", "den", "des", "einer", "einem", "eines", "vom", "zu", "zum", "zur", "bei", 
    "beim", "für", "fuer", "an", "am", "auf", "über", "ueber", "nach", "vor", "hinter", 
    "ihr", "wir", "er", "ihnen", "meine", "mein", "meinem", "meinen", "meiner", "meines", 
    "deine", "dein", "deinem", "deinen", "deiner", "deines", "ihre", "ihr", "ihrem", "ihren", 
    "ihrer", "ihres", "rechnungsnummer", "rechnungsbetrag", "betrag", "beträge", "offen", 
    "bezahlt", "fällig", "faellig", "handy", "handynummer", "mobil", "mobilnummer", "tel",

    // English CRM fields and query helpers
    "phone", "phonenumber", "telephone", "mobile", "cellphone", "address", "city", "street", 
    "zip", "zipcode", "postal", "postalcode", "responsible", "invoice", "first", "last", 
    "owner", "partner", "manager", "your", "his", "her", "their", "our", "its", "of", 
    "and", "under", "from", "on", "to"
  ]);
  return words.filter(w => w.length >= 2 && !stopwords.has(w));
}

/**
 * Tool 4: CRM Data Analyst Tool
 * Safe, aggregated CRM statistic and entity query pipeline
 */
export function levenshteinDistance(s1: string, s2: string): number {
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;

  // Early exit guard when length difference exceeds standard threshold
  if (Math.abs(len1 - len2) > 3) return Math.max(len1, len2);

  // Single-row matrix optimization (O(N) memory allocation instead of O(N*M))
  let prevRow = Array.from({ length: len2 + 1 }, (_, i) => i);
  let currRow = new Array<number>(len2 + 1);

  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    let minInRow = currRow[0];
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
      if (currRow[j] < minInRow) minInRow = currRow[j];
    }
    // Early termination if row minimum exceeds maximum allowed fuzzy threshold
    if (minInRow > 3) return minInRow;

    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }
  return prevRow[len2];
}

export function fuzzyMatch(text: string, term: string): boolean {
  if (!text || !term) return false;
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  if (lowerText.includes(lowerTerm)) return true;
  if (lowerTerm.length < 3) return false;

  const words = lowerText.split(/\s+/);
  const termLen = lowerTerm.length;
  const maxDist = termLen > 5 ? 2 : 1;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    if (word.includes(lowerTerm) || lowerTerm.includes(word)) return true;
    if (Math.abs(word.length - termLen) <= maxDist) {
      const dist = levenshteinDistance(word, lowerTerm);
      if (dist <= maxDist) return true;
    }
  }
  return false;
}

export async function executeCrmDataAnalyst(tenantId: string, query: string): Promise<ToolResult<Record<string, unknown>>> {
  const searchTerms = getSearchTerms(query);
  const isGeneric = searchTerms.length === 0;

  if (isUsingFallback) {
    const comps = fallbackStore.companies.filter(c => c.tenant_id === tenantId);
    const conts = fallbackStore.contacts.filter(c => c.tenant_id === tenantId);
    const invs = fallbackStore.invoices.filter(c => c.tenant_id === tenantId);
    const offs = (fallbackStore.offers || []).filter(o => o.tenant_id === tenantId);

    let matchCompanies = comps;
    let matchContacts = conts;
    let matchInvoices = invs;
    let matchOffers = offs;

    if (!isGeneric) {
      matchCompanies = comps
        .map(c => {
          let score = 0;
          for (const term of searchTerms) {
            const matches = fuzzyMatch(c.full_legal_name, term) ||
              (c.city && fuzzyMatch(c.city, term)) ||
              (c.street && fuzzyMatch(c.street, term)) ||
              (c.postal_code && fuzzyMatch(c.postal_code, term)) ||
              (c.responsible_person && fuzzyMatch(c.responsible_person, term));
            if (matches) score++;
          }
          return { company: c, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.company);

      matchContacts = conts
        .map(c => {
          const associatedCo = comps.find(co => co.id_uuid === c.associated_company_id);
          let score = 0;
          for (const term of searchTerms) {
            const matches = (c.full_legal_name && fuzzyMatch(c.full_legal_name, term)) ||
              (c.first_name && fuzzyMatch(c.first_name, term)) ||
              (c.last_name && fuzzyMatch(c.last_name, term)) ||
              (c.city && fuzzyMatch(c.city, term)) ||
              (c.street && fuzzyMatch(c.street, term)) ||
              (c.postal_code && fuzzyMatch(c.postal_code, term)) ||
              (associatedCo && (
                fuzzyMatch(associatedCo.full_legal_name, term) ||
                (associatedCo.city && fuzzyMatch(associatedCo.city, term)) ||
                (associatedCo.street && fuzzyMatch(associatedCo.street, term)) ||
                (associatedCo.postal_code && fuzzyMatch(associatedCo.postal_code, term))
              ));
            if (matches) score++;
          }
          return { contact: c, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.contact);

      matchInvoices = invs
        .map(i => {
          const associatedCo = comps.find(co => co.id_uuid === i.associated_company_id);
          const associatedCt = conts.find(ct => ct.id_uuid === i.associated_contact_id);
          let score = 0;
          for (const term of searchTerms) {
            const matches = fuzzyMatch(i.invoice_number, term) ||
              fuzzyMatch(i.payment_status, term) ||
              (associatedCo && (
                fuzzyMatch(associatedCo.full_legal_name, term) ||
                (associatedCo.city && fuzzyMatch(associatedCo.city, term)) ||
                (associatedCo.street && fuzzyMatch(associatedCo.street, term)) ||
                (associatedCo.postal_code && fuzzyMatch(associatedCo.postal_code, term))
              )) ||
              (associatedCt && (
                fuzzyMatch(associatedCt.full_legal_name, term) ||
                (associatedCt.city && fuzzyMatch(associatedCt.city, term)) ||
                (associatedCt.street && fuzzyMatch(associatedCt.street, term)) ||
                (associatedCt.postal_code && fuzzyMatch(associatedCt.postal_code, term))
              ));
            if (matches) score++;
          }
          return { invoice: i, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.invoice);

      matchOffers = offs
        .map(o => {
          const associatedCo = comps.find(co => co.id_uuid === o.associated_company_id);
          const associatedCt = conts.find(ct => ct.id_uuid === o.associated_contact_id);
          let score = 0;
          for (const term of searchTerms) {
            const matches = fuzzyMatch(o.offer_number, term) ||
              fuzzyMatch(o.title, term) ||
              fuzzyMatch(o.offer_status || "draft", term) ||
              (associatedCo && (
                fuzzyMatch(associatedCo.full_legal_name, term) ||
                (associatedCo.city && fuzzyMatch(associatedCo.city, term)) ||
                (associatedCo.street && fuzzyMatch(associatedCo.street, term)) ||
                (associatedCo.postal_code && fuzzyMatch(associatedCo.postal_code, term))
              )) ||
              (associatedCt && (
                fuzzyMatch(associatedCt.full_legal_name, term) ||
                (associatedCt.city && fuzzyMatch(associatedCt.city, term)) ||
                (associatedCt.street && fuzzyMatch(associatedCt.street, term)) ||
                (associatedCt.postal_code && fuzzyMatch(associatedCt.postal_code, term))
              ));
            if (matches) score++;
          }
          return { offer: o, score };
        })
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(item => item.offer);

      // Local Fallback Cascade: If strict scoring yields no results for contacts, invoices, or offers but we matched companies:
      if (matchContacts.length === 0 && matchCompanies.length > 0) {
        const companyIds = new Set(matchCompanies.map(c => c.id_uuid));
        matchContacts = conts.filter(c => companyIds.has(c.associated_company_id));
      }
      if (matchInvoices.length === 0 && matchCompanies.length > 0) {
        const companyIds = new Set(matchCompanies.map(c => c.id_uuid));
        matchInvoices = invs.filter(i => companyIds.has(i.associated_company_id));
      }
      if (matchOffers.length === 0 && matchCompanies.length > 0) {
        const companyIds = new Set(matchCompanies.map(c => c.id_uuid));
        matchOffers = offs.filter(o => o.associated_company_id && companyIds.has(o.associated_company_id));
      }
    }

    return createToolSuccess({
      stats: {
        total_companies_count: comps.length,
        total_contacts_count: conts.length,
        total_invoices_count: invs.length,
        total_offers_count: offs.length,
        open_invoices_gross_sum: invs.filter(i => i.payment_status === "issued" || (i.payment_status as string) === "pending").reduce((a, b) => a + b.total_gross_amount, 0),
        paid_invoices_gross_sum: invs.filter(i => i.payment_status === "paid").reduce((a, b) => a + b.total_gross_amount, 0),
        draft_offers_gross_sum: offs.filter(o => o.offer_status === "draft").reduce((a, b) => a + Number(b.total_gross_amount || 0), 0),
        sent_offers_gross_sum: offs.filter(o => o.offer_status === "sent").reduce((a, b) => a + Number(b.total_gross_amount || 0), 0),
        accepted_offers_gross_sum: offs.filter(o => o.offer_status === "accepted").reduce((a, b) => a + Number(b.total_gross_amount || 0), 0),
      },
      search_meta: {
        searched_for_terms: searchTerms,
        is_filtered_search: !isGeneric,
        matched_companies_count: matchCompanies.length,
        matched_contacts_count: matchContacts.length,
        matched_invoices_count: matchInvoices.length,
        matched_offers_count: matchOffers.length,
      },
      matched_entities: {
        companies: matchCompanies.slice(0, 10).map(c => formatCompanyForAiContext(c, "summary")),
        contacts: matchContacts.slice(0, 10).map(c => formatContactForAiContext(c, "summary")),
        invoices: matchInvoices.slice(0, 10).map(i => formatInvoiceForAiContext(i, "summary")),
        offers: matchOffers.slice(0, 10).map(o => formatOfferForAiContext(o, "summary")),
      }
    });
  }


  // Postgres Mode
  try {
    const compCount = await pool.query("SELECT COUNT(*) FROM core_registry_companies WHERE tenant_id = $1", [tenantId]);
    const contCount = await pool.query("SELECT COUNT(*) FROM core_registry_contacts WHERE tenant_id = $1", [tenantId]);
    const invCount = await pool.query("SELECT COUNT(*), SUM(total_gross_amount) FILTER (WHERE payment_status = 'pending') as pending_sum, SUM(total_gross_amount) FILTER (WHERE payment_status = 'paid') as paid_sum FROM fiscal_billing_invoices WHERE tenant_id = $1", [tenantId]);
    const offCount = await pool.query(
      `SELECT COUNT(*), 
              SUM(total_gross_amount) FILTER (WHERE offer_status = 'draft') as draft_sum,
              SUM(total_gross_amount) FILTER (WHERE offer_status = 'sent') as sent_sum,
              SUM(total_gross_amount) FILTER (WHERE offer_status = 'accepted') as accepted_sum
       FROM core_registry_offers WHERE tenant_id = $1`, 
      [tenantId]
    );

    let compMatchRows: { id_uuid: string; [key: string]: unknown }[] = [];
    let contMatchRows: { id_uuid: string; [key: string]: unknown }[] = [];
    let invMatchRows: { id_uuid: string; [key: string]: unknown }[] = [];
    let offMatchRows: { id_uuid: string; [key: string]: unknown }[] = [];

    if (!isGeneric) {
      // 1. Companies search conditions: Match each search term (hybrid OR with CASE WHEN scoring)
      const compConditions = searchTerms.map((term, i) => `(full_legal_name ILIKE $${i + 2} OR city ILIKE $${i + 2} OR street ILIKE $${i + 2} OR postal_code ILIKE $${i + 2} OR responsible_person ILIKE $${i + 2})`).join(" OR ");
      const compScoring = searchTerms.map((term, i) => `(CASE WHEN full_legal_name ILIKE $${i + 2} OR city ILIKE $${i + 2} OR street ILIKE $${i + 2} OR postal_code ILIKE $${i + 2} OR responsible_person ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
      const compParams = [tenantId, ...searchTerms.map(t => `%${t}%`)];
      const compQuerySql = `
        SELECT id_uuid, full_legal_name, tax_vat_id, tax_number, street, city, email_address, iban, bic_swift, created_at_utc,
               (${compScoring}) as match_score
        FROM core_registry_companies 
        WHERE tenant_id = $1 AND (${compConditions})
        ORDER BY match_score DESC, full_legal_name ASC
        LIMIT 20
      `;
      const compRes = await pool.query(compQuerySql, compParams);
      compMatchRows = compRes.rows;

      // 2. Contacts search conditions: Match search terms (hybrid OR with CASE WHEN scoring)
      const contConditions = searchTerms.map((term, i) => `(c.full_legal_name ILIKE $${i + 2} OR c.city ILIKE $${i + 2} OR c.street ILIKE $${i + 2} OR c.postal_code ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR co.city ILIKE $${i + 2} OR co.street ILIKE $${i + 2} OR co.postal_code ILIKE $${i + 2})`).join(" OR ");
      const contScoring = searchTerms.map((term, i) => `(CASE WHEN c.full_legal_name ILIKE $${i + 2} OR c.city ILIKE $${i + 2} OR c.street ILIKE $${i + 2} OR c.postal_code ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR co.city ILIKE $${i + 2} OR co.street ILIKE $${i + 2} OR co.postal_code ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
      const contParams = [tenantId, ...searchTerms.map(t => `%${t}%`)];
      const contQuerySql = `
        SELECT c.id_uuid, c.full_legal_name, c.email_address, c.phone_number, c.city, c.associated_company_id, co.full_legal_name as company_name,
               (${contScoring}) as match_score
        FROM core_registry_contacts c
        LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
        WHERE c.tenant_id = $1 AND (${contConditions}) 
        ORDER BY match_score DESC, c.full_legal_name ASC
        LIMIT 20
      `;
      const contRes = await pool.query(contQuerySql, contParams);
      contMatchRows = contRes.rows;

      // 3. Invoices search conditions: Match search terms (hybrid OR with CASE WHEN scoring)
      const invConditions = searchTerms.map((term, i) => `(i.invoice_number ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR co.city ILIKE $${i + 2} OR co.street ILIKE $${i + 2} OR co.postal_code ILIKE $${i + 2} OR ct.full_legal_name ILIKE $${i + 2} OR ct.city ILIKE $${i + 2} OR ct.street ILIKE $${i + 2} OR ct.postal_code ILIKE $${i + 2} OR i.payment_status ILIKE $${i + 2})`).join(" OR ");
      const invScoring = searchTerms.map((term, i) => `(CASE WHEN i.invoice_number ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR co.city ILIKE $${i + 2} OR co.street ILIKE $${i + 2} OR co.postal_code ILIKE $${i + 2} OR ct.full_legal_name ILIKE $${i + 2} OR ct.city ILIKE $${i + 2} OR ct.street ILIKE $${i + 2} OR ct.postal_code ILIKE $${i + 2} OR i.payment_status ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
      const invParams = [tenantId, ...searchTerms.map(t => `%${t}%`)];
      const invQuerySql = `
        SELECT i.id_uuid, i.invoice_number, i.total_gross_amount, i.total_net_amount, i.total_vat_amount, i.issue_date, i.payment_status, i.associated_company_id, i.associated_contact_id, co.full_legal_name as company_name,
               (${invScoring}) as match_score
        FROM fiscal_billing_invoices i
        LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
        LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
        WHERE i.tenant_id = $1 AND (${invConditions})
        ORDER BY match_score DESC, i.invoice_number DESC
        LIMIT 20
      `;
      const invRes = await pool.query(invQuerySql, invParams);
      invMatchRows = invRes.rows;

      // 4. Offers search conditions: Match search terms (hybrid OR with CASE WHEN scoring)
      const offConditions = searchTerms.map((term, i) => `(o.offer_number ILIKE $${i + 2} OR o.title ILIKE $${i + 2} OR o.offer_status ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR ct.full_legal_name ILIKE $${i + 2})`).join(" OR ");
      const offScoring = searchTerms.map((term, i) => `(CASE WHEN o.offer_number ILIKE $${i + 2} OR o.title ILIKE $${i + 2} OR o.offer_status ILIKE $${i + 2} OR co.full_legal_name ILIKE $${i + 2} OR ct.full_legal_name ILIKE $${i + 2} THEN 1 ELSE 0 END)`).join(" + ");
      const offParams = [tenantId, ...searchTerms.map(t => `%${t}%`)];
      const offQuerySql = `
        SELECT o.id_uuid, o.offer_number, o.title, o.total_gross_amount, o.total_net_amount, o.total_vat_amount, o.issue_date, o.offer_status, o.associated_company_id, o.associated_contact_id, co.full_legal_name as company_name, ct.full_legal_name as contact_name,
               (${offScoring}) as match_score
        FROM core_registry_offers o
        LEFT JOIN core_registry_companies co ON o.associated_company_id = co.id_uuid
        LEFT JOIN core_registry_contacts ct ON o.associated_contact_id = ct.id_uuid
        WHERE o.tenant_id = $1 AND (${offConditions})
        ORDER BY match_score DESC, o.offer_number DESC
        LIMIT 20
      `;
      const offRes = await pool.query(offQuerySql, offParams);
      offMatchRows = offRes.rows;

      // Cascading SQL-Fallback: If strict scoring yields 0 results for contacts, invoices, or offers, but we matched companies:
      if (compMatchRows.length > 0) {
        const matchedCompIds = compMatchRows.map(row => row.id_uuid);
        
        if (contMatchRows.length === 0) {
          const fallbackContQuerySql = `
            SELECT c.id_uuid, c.full_legal_name, c.email_address, c.phone_number, c.city, c.associated_company_id, co.full_legal_name as company_name 
            FROM core_registry_contacts c
            LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
            WHERE c.tenant_id = $1 AND c.associated_company_id = ANY($2)
            LIMIT 20
          `;
          const fallbackContRes = await pool.query(fallbackContQuerySql, [tenantId, matchedCompIds]);
          contMatchRows = fallbackContRes.rows;
        }

        if (invMatchRows.length === 0) {
          const fallbackInvQuerySql = `
            SELECT i.id_uuid, i.invoice_number, i.total_gross_amount, i.total_net_amount, i.total_vat_amount, i.issue_date, i.payment_status, i.associated_company_id, i.associated_contact_id, co.full_legal_name as company_name
            FROM fiscal_billing_invoices i
            LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
            WHERE i.tenant_id = $1 AND i.associated_company_id = ANY($2)
            ORDER BY i.issue_date DESC
            LIMIT 20
          `;
          const fallbackInvRes = await pool.query(fallbackInvQuerySql, [tenantId, matchedCompIds]);
          invMatchRows = fallbackInvRes.rows;
        }

        if (offMatchRows.length === 0) {
          const fallbackOffQuerySql = `
            SELECT o.id_uuid, o.offer_number, o.title, o.total_gross_amount, o.total_net_amount, o.total_vat_amount, o.issue_date, o.offer_status, o.associated_company_id, o.associated_contact_id, co.full_legal_name as company_name
            FROM core_registry_offers o
            LEFT JOIN core_registry_companies co ON o.associated_company_id = co.id_uuid
            WHERE o.tenant_id = $1 AND o.associated_company_id = ANY($2)
            ORDER BY o.issue_date DESC
            LIMIT 20
          `;
          const fallbackOffRes = await pool.query(fallbackOffQuerySql, [tenantId, matchedCompIds]);
          offMatchRows = fallbackOffRes.rows;
        }
      }
    } else {
      // Generic (return top 10 list)
      const compRes = await pool.query(
        "SELECT id_uuid, full_legal_name, tax_vat_id, tax_number, street, city, email_address, iban, bic_swift, created_at_utc FROM core_registry_companies WHERE tenant_id = $1 ORDER BY full_legal_name ASC LIMIT 10",
        [tenantId]
      );
      compMatchRows = compRes.rows;

      const contRes = await pool.query(
        "SELECT c.id_uuid, c.full_legal_name, c.email_address, c.phone_number, c.city, c.associated_company_id, co.full_legal_name as company_name FROM core_registry_contacts c LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid WHERE c.tenant_id = $1 ORDER BY c.full_legal_name ASC LIMIT 10",
        [tenantId]
      );
      contMatchRows = contRes.rows;

      const invRes = await pool.query(
        "SELECT i.id_uuid, i.invoice_number, i.total_gross_amount, i.total_net_amount, i.total_vat_amount, i.issue_date, i.payment_status, i.associated_company_id, i.associated_contact_id, co.full_legal_name as company_name FROM fiscal_billing_invoices i LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid WHERE i.tenant_id = $1 ORDER BY i.invoice_number DESC LIMIT 10",
        [tenantId]
      );
      invMatchRows = invRes.rows;

      const offRes = await pool.query(
        "SELECT o.id_uuid, o.offer_number, o.title, o.total_gross_amount, o.total_net_amount, o.total_vat_amount, o.issue_date, o.offer_status, o.associated_company_id, o.associated_contact_id, co.full_legal_name as company_name, ct.full_legal_name as contact_name FROM core_registry_offers o LEFT JOIN core_registry_companies co ON o.associated_company_id = co.id_uuid LEFT JOIN core_registry_contacts ct ON o.associated_contact_id = ct.id_uuid WHERE o.tenant_id = $1 ORDER BY o.offer_number DESC LIMIT 10",
        [tenantId]
      );
      offMatchRows = offRes.rows;
    }

    return createToolSuccess({
      stats: {
        total_companies_count: parseInt(compCount.rows[0]?.count || "0"),
        total_contacts_count: parseInt(contCount.rows[0]?.count || "0"),
        total_invoices_count: parseInt(invCount.rows[0]?.count || "0"),
        total_offers_count: parseInt(offCount.rows[0]?.count || "0"),
        open_invoices_gross_sum: parseFloat(invCount.rows[0]?.pending_sum || "0"),
        paid_invoices_gross_sum: parseFloat(invCount.rows[0]?.paid_sum || "0"),
        draft_offers_gross_sum: parseFloat(offCount.rows[0]?.draft_sum || "0"),
        sent_offers_gross_sum: parseFloat(offCount.rows[0]?.sent_sum || "0"),
        accepted_offers_gross_sum: parseFloat(offCount.rows[0]?.accepted_sum || "0"),
      },
      search_meta: {
        searched_for_terms: searchTerms,
        is_filtered_search: !isGeneric,
        matched_companies_count: compMatchRows.length,
        matched_contacts_count: contMatchRows.length,
        matched_invoices_count: invMatchRows.length,
        matched_offers_count: offMatchRows.length,
      },
      matched_entities: {
        companies: compMatchRows.map(c => formatCompanyForAiContext(c, "summary")),
        contacts: contMatchRows.map(c => formatContactForAiContext(c, "summary")),
        invoices: invMatchRows.map(i => formatInvoiceForAiContext(i, "summary")),
        offers: offMatchRows.map(o => formatOfferForAiContext(o, "summary")),
      }
    });
  } catch (err) {
    return createToolError(`Database CRM Analyst scan failed: ${(err as Error).message}`);
  }
}

/**
 * Paginierte Unternehmens-Liste mit Fuzzy-Suche
 */
export async function executeListCompanies(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<PaginatedToolResponse<Record<string, unknown>>>> {
  try {
    let rawArgs: unknown = {};
    if (argsStr) {
      try {
        rawArgs = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
      } catch {
        rawArgs = { search: argsStr };
      }
    }

    const parsed = ListCompaniesInputSchema.safeParse(rawArgs);
    const input = parsed.success ? parsed.data : ListCompaniesInputSchema.parse({});
    const { search, limit, offset, detail_level } = input;
    const normSearch = normalizeQueryValue(search);

    if (isUsingFallback) {
      let list = (fallbackStore.companies || []).filter(
        (c) => c.tenant_id === tenantId || c.tenant_id === '1'
      );

      let isFuzzy = false;
      if (search) {
        const matched = list.filter(
          (c) =>
            fuzzyMatch(c.full_legal_name || '', normSearch) ||
            fuzzyMatch(c.city || '', normSearch) ||
            fuzzyMatch(c.tax_vat_id || '', normSearch)
        );
        if (matched.length > 0) {
          list = matched;
          isFuzzy = true;
        } else {
          const s = normSearch.toLowerCase();
          list = list.filter(
            (c) =>
              (c.full_legal_name && c.full_legal_name.toLowerCase().includes(s)) ||
              (c.city && c.city.toLowerCase().includes(s)) ||
              (c.tax_vat_id && c.tax_vat_id.toLowerCase().includes(s))
          );
        }
      }

      const totalCount = list.length;
      const paginated = list.slice(offset, offset + limit);
      const formattedItems = paginated.map((c) => formatCompanyForAiContext(c, detail_level));

      return createToolSuccess({
        items: formattedItems,
        pagination: {
          total_count: totalCount,
          limit,
          offset,
          has_more: offset + limit < totalCount
        },
        search_meta: {
          searched_term: search,
          fuzzy_matched: isFuzzy
        }
      });
    }

    // Postgres Branch
    const whereConditions = ["(tenant_id = $1 OR tenant_id = '1')"];
    const queryParams: unknown[] = [tenantId];

    let isFuzzy = false;
    if (search) {
      queryParams.push(`%${search}%`);
      const searchParamIdx = queryParams.length;
      queryParams.push(search);
      const exactSearchIdx = queryParams.length;

      whereConditions.push(
        `(full_legal_name ILIKE $${searchParamIdx} OR city ILIKE $${searchParamIdx} OR tax_vat_id ILIKE $${searchParamIdx} OR similarity(full_legal_name, $${exactSearchIdx}) > 0.2)`
      );
      isFuzzy = true;
    }

    const whereClause = whereConditions.join(" AND ");

    // Count Query
    const countSql = `SELECT COUNT(*) AS total FROM core_registry_companies WHERE ${whereClause}`;
    const countRes = await pool.query(countSql, queryParams);
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    // Data Query
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    let orderClause = "ORDER BY full_legal_name ASC";
    if (search) {
      orderClause = `ORDER BY similarity(full_legal_name, $${queryParams.length - 3}) DESC, full_legal_name ASC`;
    }

    const dataSql = `SELECT * FROM core_registry_companies WHERE ${whereClause} ${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
    const dataRes = await pool.query(dataSql, queryParams);

    const cleanedRows = dataRes.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r)));
    const formattedItems = cleanedRows.map((r) => formatCompanyForAiContext(r, detail_level));

    return createToolSuccess({
      items: formattedItems,
      pagination: {
        total_count: totalCount,
        limit,
        offset,
        has_more: offset + limit < totalCount
      },
      search_meta: {
        searched_term: search,
        fuzzy_matched: isFuzzy
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in executeListCompanies: ${errMsg}`);
  }
}

/**
 * Paginierte Kontakt-Liste mit Fuzzy-Suche
 */
export async function executeListContacts(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<PaginatedToolResponse<Record<string, unknown>>>> {
  try {
    let rawArgs: unknown = {};
    if (argsStr) {
      try {
        rawArgs = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
      } catch {
        rawArgs = { search: argsStr };
      }
    }

    const parsed = ListContactsInputSchema.safeParse(rawArgs);
    const input = parsed.success ? parsed.data : ListContactsInputSchema.parse({});
    const { search, company_id, limit, offset, detail_level } = input;
    const normSearch = normalizeQueryValue(search);

    if (isUsingFallback) {
      let list = (fallbackStore.contacts || []).filter(
        (c) => c.tenant_id === tenantId || c.tenant_id === '1'
      );

      if (company_id) {
        list = list.filter((c) => c.associated_company_id === company_id || (c as { company_id?: string }).company_id === company_id);
      }

      let isFuzzy = false;
      if (search) {
        const matched = list.filter((c) => {
          const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim();
          return (
            fuzzyMatch(fullName, normSearch) ||
            fuzzyMatch(c.email_address || '', normSearch) ||
            fuzzyMatch(c.phone_number || '', normSearch)
          );
        });
        if (matched.length > 0) {
          list = matched;
          isFuzzy = true;
        } else {
          const s = normSearch.toLowerCase();
          list = list.filter((c) => {
            const fullName = `${c.first_name || ''} ${c.last_name || ''}`.trim().toLowerCase();
            return (
              fullName.includes(s) ||
              (c.email_address && c.email_address.toLowerCase().includes(s)) ||
              (c.phone_number && c.phone_number.toLowerCase().includes(s))
            );
          });
        }
      }

      const totalCount = list.length;
      const paginated = list.slice(offset, offset + limit);
      const formattedItems = paginated.map((c) => formatContactForAiContext(c, detail_level));

      return createToolSuccess({
        items: formattedItems,
        pagination: {
          total_count: totalCount,
          limit,
          offset,
          has_more: offset + limit < totalCount
        },
        search_meta: {
          searched_term: search,
          fuzzy_matched: isFuzzy
        }
      });
    }

    // Postgres Branch
    const whereConditions = ["(c.tenant_id = $1 OR c.tenant_id = '1')"];
    const queryParams: unknown[] = [tenantId];

    if (company_id) {
      queryParams.push(company_id);
      whereConditions.push(`c.associated_company_id = $${queryParams.length}`);
    }

    let isFuzzy = false;
    if (search) {
      queryParams.push(`%${search}%`);
      const searchParamIdx = queryParams.length;
      queryParams.push(search);
      const exactSearchIdx = queryParams.length;

      whereConditions.push(
        `(c.full_legal_name ILIKE $${searchParamIdx} OR c.email_address ILIKE $${searchParamIdx} OR similarity(c.full_legal_name, $${exactSearchIdx}) > 0.2)`
      );
      isFuzzy = true;
    }

    const whereClause = whereConditions.join(" AND ");

    // Count Query
    const countSql = `SELECT COUNT(*) AS total FROM core_registry_contacts c WHERE ${whereClause}`;
    const countRes = await pool.query(countSql, queryParams);
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    // Data Query
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    let orderClause = "ORDER BY c.full_legal_name ASC";
    if (search) {
      orderClause = `ORDER BY similarity(c.full_legal_name, $${queryParams.length - 3}) DESC, c.full_legal_name ASC`;
    }

    const dataSql = `
      SELECT c.*, co.full_legal_name AS company_name 
      FROM core_registry_contacts c
      LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
      WHERE ${whereClause} ${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const dataRes = await pool.query(dataSql, queryParams);

    const cleanedRows = dataRes.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r)));
    const formattedItems = cleanedRows.map((r) => formatContactForAiContext(r, detail_level));

    return createToolSuccess({
      items: formattedItems,
      pagination: {
        total_count: totalCount,
        limit,
        offset,
        has_more: offset + limit < totalCount
      },
      search_meta: {
        searched_term: search,
        fuzzy_matched: isFuzzy
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in executeListContacts: ${errMsg}`);
  }
}

/**
 * Paginierte Rechnungs-Liste mit Fuzzy-Suche
 */
export async function executeListInvoices(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<PaginatedToolResponse<Record<string, unknown>>>> {
  try {
    let rawArgs: unknown = {};
    if (argsStr) {
      try {
        rawArgs = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
      } catch {
        rawArgs = { search: argsStr };
      }
    }

    const parsed = ListInvoicesInputSchema.safeParse(rawArgs);
    const input = parsed.success ? parsed.data : ListInvoicesInputSchema.parse({});
    const { search, payment_status, company_id, limit, offset, detail_level, sort_by, sort_order } = input;
    const normSearch = normalizeQueryValue(search);

    if (isUsingFallback) {
      let list = (fallbackStore.invoices || []).filter(
        (i) => i.tenant_id === tenantId || i.tenant_id === '1'
      );

      if (payment_status) {
        if (payment_status === "overdue") {
          const nowStr = new Date().toISOString().split('T')[0];
          list = list.filter((i) => {
            const status = i.payment_status || i.status;
            if (status === 'overdue') return true;
            if (status === 'issued' || (status as string) === 'pending') {
              let computedDue = i.due_date;
              if (!computedDue && i.issue_date) {
                const days = parseInt(i.payment_term || "14", 10);
                if (!isNaN(days)) {
                  const d = new Date(i.issue_date);
                  d.setDate(d.getDate() + days);
                  computedDue = d.toISOString().split('T')[0];
                }
              }
              if (computedDue && computedDue < nowStr) return true;
            }
            return false;
          });
        } else {
          list = list.filter((i) => (i.payment_status || i.status) === payment_status);
        }
      }

      if (company_id) {
        list = list.filter((i) => i.associated_company_id === company_id || (i as { company_id?: string }).company_id === company_id);
      }

      let isFuzzy = false;
      if (search) {
        const matched = list.filter((i) => fuzzyMatch(i.invoice_number || '', normSearch));
        if (matched.length > 0) {
          list = matched;
          isFuzzy = true;
        } else {
          const s = normSearch.toLowerCase();
          list = list.filter((i) => i.invoice_number && i.invoice_number.toLowerCase().includes(s));
        }
      }

      // Sort
      const isAsc = sort_order === 'asc';
      list.sort((a, b) => {
        const valA = String((a as Record<string, unknown>)[sort_by || 'issue_date'] || '');
        const valB = String((b as Record<string, unknown>)[sort_by || 'issue_date'] || '');
        if (sort_by === 'total_gross_amount') {
          return isAsc ? Number(a.total_gross_amount || 0) - Number(b.total_gross_amount || 0) : Number(b.total_gross_amount || 0) - Number(a.total_gross_amount || 0);
        }
        return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      });

      const totalCount = list.length;
      const paginated = list.slice(offset, offset + limit);

      const enrichedItems = paginated.map((inv) => {
        const company = fallbackStore.companies?.find((c) => c.id_uuid === inv.associated_company_id);
        const contact = fallbackStore.contacts?.find((c) => c.id_uuid === inv.associated_contact_id) ||
                        fallbackStore.contacts?.find((c) => c.associated_company_id === inv.associated_company_id);

        let computedDueDate = inv.due_date;
        if (!computedDueDate && inv.issue_date) {
          const days = parseInt(inv.payment_term || "14", 10);
          if (!isNaN(days)) {
            const d = new Date(inv.issue_date);
            d.setDate(d.getDate() + days);
            computedDueDate = d.toISOString().split('T')[0];
          }
        }

        return {
          ...inv,
          company_name: company ? company.full_legal_name : (inv.company_name || ''),
          contact_name: contact ? (contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()) : (inv.contact_full_name || ''),
          contact_email: contact ? (contact.email_address || contact.email_2 || '') : (company ? (company.email_address || company.email_2 || '') : ''),
          due_date: computedDueDate || null
        };
      });

      const formattedItems = enrichedItems.map((i) => formatInvoiceForAiContext(i, detail_level));

      return createToolSuccess({
        items: formattedItems,
        pagination: {
          total_count: totalCount,
          limit,
          offset,
          has_more: offset + limit < totalCount
        },
        search_meta: {
          searched_term: search,
          fuzzy_matched: isFuzzy
        }
      });
    }

    // Postgres Branch
    const whereConditions = ["(i.tenant_id = $1 OR i.tenant_id = '1')"];
    const queryParams: unknown[] = [tenantId];

    if (payment_status) {
      if (payment_status === "overdue") {
        whereConditions.push(`(
          i.payment_status = 'overdue' OR (
            i.payment_status IN ('issued', 'pending') AND (
              i.due_date < CURRENT_DATE OR 
              (i.due_date IS NULL AND i.issue_date + (COALESCE(NULLIF(i.payment_term, ''), '14')::integer * INTERVAL '1 day') < CURRENT_DATE)
            )
          )
        )`);
      } else {
        queryParams.push(payment_status);
        whereConditions.push(`i.payment_status = $${queryParams.length}`);
      }
    }

    if (company_id) {
      queryParams.push(company_id);
      whereConditions.push(`i.associated_company_id = $${queryParams.length}`);
    }

    let isFuzzy = false;
    if (search) {
      queryParams.push(`%${search}%`);
      const searchParamIdx = queryParams.length;
      queryParams.push(search);
      const exactSearchIdx = queryParams.length;

      whereConditions.push(
        `(i.invoice_number ILIKE $${searchParamIdx} OR co.full_legal_name ILIKE $${searchParamIdx} OR similarity(i.invoice_number, $${exactSearchIdx}) > 0.2)`
      );
      isFuzzy = true;
    }

    const whereClause = whereConditions.join(" AND ");

    // Count Query
    const countSql = `
      SELECT COUNT(*) AS total 
      FROM fiscal_billing_invoices i
      LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
      WHERE ${whereClause}
    `;
    const countRes = await pool.query(countSql, queryParams);
    const totalCount = parseInt(countRes.rows[0]?.total || "0", 10);

    // Data Query
    queryParams.push(limit);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;

    const validSortCol = sort_by === 'due_date' ? 'i.due_date' : sort_by === 'invoice_number' ? 'i.invoice_number' : sort_by === 'total_gross_amount' ? 'i.total_gross_amount' : 'i.issue_date';
    const validSortOrder = sort_order === 'asc' ? 'ASC' : 'DESC';
    const orderClause = `ORDER BY ${validSortCol} ${validSortOrder}, i.id_uuid DESC`;

    const dataSql = `
      SELECT 
        i.*, 
        co.full_legal_name AS company_name,
        COALESCE(ct.full_legal_name, CONCAT(ct.first_name, ' ', ct.last_name), ct_fallback.full_legal_name, CONCAT(ct_fallback.first_name, ' ', ct_fallback.last_name)) AS contact_name,
        COALESCE(ct.email_address, ct.email_2, ct_fallback.email_address, ct_fallback.email_2, co.email_address, co.email_2) AS contact_email
      FROM fiscal_billing_invoices i
      LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
      LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
      LEFT JOIN LATERAL (
        SELECT full_legal_name, first_name, last_name, email_address, email_2
        FROM core_registry_contacts
        WHERE associated_company_id = i.associated_company_id
        LIMIT 1
      ) ct_fallback ON i.associated_contact_id IS NULL AND i.associated_company_id IS NOT NULL
      WHERE ${whereClause} ${orderClause} LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const dataRes = await pool.query(dataSql, queryParams);

    const cleanedRows = dataRes.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r)));
    const formattedItems = cleanedRows.map((r) => formatInvoiceForAiContext(r, detail_level));

    return createToolSuccess({
      items: formattedItems,
      pagination: {
        total_count: totalCount,
        limit,
        offset,
        has_more: offset + limit < totalCount
      },
      search_meta: {
        searched_term: search,
        fuzzy_matched: isFuzzy
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in executeListInvoices: ${errMsg}`);
  }
}

/**
 * Tool 9: Create Draft Invoice Tool
 * Allows LOUIS AI to directly insert an invoice draft into the database or fallback store.
 */
export async function executeCreateDraftInvoice(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"company_id\": \"uuid\", \"contact_id\": \"uuid\", \"is_vat_inclusive\": true/false, \"items_list\": [{\"description\": \"Text\", \"quantity\": 1, \"unit_price\": 10, \"vat_rate\": 19}], \"introductory_text\": \"Hi\", \"closing_text\": \"Tschüss\", \"payment_term\": \"14\"}");
    }

    const parseResult = CreateInvoiceArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_invoice_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;
    const companyIdInput = args.company_id || args.associated_company_id;
    const contactIdInput = args.contact_id || args.associated_contact_id;

    let resolvedCompanyId: string | null = null;
    if (companyIdInput) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companyIdInput);
      if (isUuid) {
        resolvedCompanyId = companyIdInput;
      } else {
        if (isUsingFallback) {
          const matched = fallbackStore.companies.find(c => 
            c.tenant_id === tenantId && 
            c.full_legal_name?.toLowerCase().includes(companyIdInput.toLowerCase())
          );
          if (matched) resolvedCompanyId = matched.id_uuid;
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM core_registry_companies WHERE tenant_id = $1 AND LOWER(full_legal_name) LIKE LOWER($2) LIMIT 1",
            [tenantId, `%${companyIdInput}%`]
          );
          if (res.rows.length > 0) resolvedCompanyId = res.rows[0].id_uuid;
        }
      }
    }

    let resolvedContactId: string | null = null;
    if (contactIdInput) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contactIdInput);
      if (isUuid) {
        resolvedContactId = contactIdInput;
      } else {
        if (isUsingFallback) {
          const matched = fallbackStore.contacts.find(c => 
            c.tenant_id === tenantId && 
            (c.full_legal_name?.toLowerCase().includes(contactIdInput.toLowerCase()) ||
             `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(contactIdInput.toLowerCase()))
          );
          if (matched) resolvedContactId = matched.id_uuid;
        } else {
          const res = await pool.query(
            "SELECT id_uuid FROM core_registry_contacts WHERE tenant_id = $1 AND (LOWER(full_legal_name) LIKE LOWER($2) OR LOWER(CONCAT(first_name, ' ', last_name)) LIKE LOWER($2)) LIMIT 1",
            [tenantId, `%${contactIdInput}%`]
          );
          if (res.rows.length > 0) resolvedContactId = res.rows[0].id_uuid;
        }
      }
    }

    const id = uuidv4();
    const computedInvoiceNumber = `ENTWURF-${id}`;
    
    const items = args.items_list;

    let totalNet = 0;
    let totalVat = 0;
    for (const item of items) {
      const q = item.quantity;
      const up = item.unit_price;
      const vr = item.vat_rate ?? 19;
      const itemNet = q * up;
      const itemVat = itemNet * (vr / 100);
      item.total_net = itemNet;
      totalNet += itemNet;
      totalVat += itemVat;
    }
    const totalGross = totalNet + totalVat;

    const issueDate = new Date().toISOString().split('T')[0];
    const paymentTerm = args.payment_term || "14";
    let dueDate = args.due_date || null;
    if (!dueDate) {
      const days = parseInt(paymentTerm, 10);
      if (!isNaN(days)) {
        const d = new Date(issueDate);
        d.setDate(d.getDate() + days);
        dueDate = d.toISOString().split('T')[0];
      }
    }

    const sanitizedItems = items.map(item => ({
      description: item.description || "",
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate ?? 19,
      total_net: item.total_net ?? (item.quantity * item.unit_price),
      unit_code: item.unit_code || "PCE"
    }));

 // B3 : einheitlicher Draft-Flow — Chat-Pfad KEIN direkter
    // Write; vollständiges Invoice-Objekt zurückgeben (inkl. Pflichtfelder
    // issue_date/total_net, damit die Compliance-Validierung besteht).
    if (!bypassApproval) {
      const draftInvoice = {
        id_uuid: id,
        tenant_id: tenantId,
        invoice_number: computedInvoiceNumber,
        associated_company_id: resolvedCompanyId,
        associated_contact_id: resolvedContactId,
        bank_account: null,
        issue_date: issueDate,
        service_date: issueDate,
        due_date: dueDate,
        payment_term: paymentTerm,
        is_vat_inclusive: !!args.is_vat_inclusive,
        total_net_amount: totalNet,
        total_vat_amount: totalVat,
        total_gross_amount: totalGross,
        vat_rate: sanitizedItems[0]?.vat_rate !== undefined && sanitizedItems[0]?.vat_rate !== null ? sanitizedItems[0].vat_rate : 19,
        currency_code: args.currency_code || "EUR",
        leitweg_id: args.leitweg_id || null,
        invoice_line_items_json: JSON.stringify(sanitizedItems),
        invoice_line_items: sanitizedItems,
        payment_status: "draft",
        created_by_identity: "ai_assistant",
        ai_confidence_score: 0.95,
        is_verified_by_human: false,
        introductory_text: args.introductory_text || "",
        closing_text: args.closing_text || "",
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      };
      return createToolSuccess({
        message: `Rechnungsentwurf erstellt (Freigabe erforderlich). Rechnungsnummer: ${computedInvoiceNumber}, Datenbank-ID: ${id}, Gesamtbetrag: ${totalGross.toFixed(2)} EUR.`,
        invoice_number: computedInvoiceNumber,
        id_uuid: id,
        total_gross_amount: totalGross,
        invoice: draftInvoice,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      const newInvoice = {
        id_uuid: id,
        tenant_id: tenantId,
        invoice_number: computedInvoiceNumber,
        associated_company_id: resolvedCompanyId,
        associated_contact_id: resolvedContactId,
        bank_account: null,
        issue_date: issueDate,
        service_date: issueDate,
        due_date: dueDate,
        payment_term: paymentTerm,
        is_vat_inclusive: !!args.is_vat_inclusive,
        total_net_amount: totalNet,
        total_vat_amount: totalVat,
        total_gross_amount: totalGross,
        vat_rate: items[0]?.vat_rate !== undefined && items[0]?.vat_rate !== null ? Number(items[0]?.vat_rate) : 19,
        currency_code: args.currency_code || "EUR",
        leitweg_id: args.leitweg_id || null,
        invoice_line_items_json: JSON.stringify(sanitizedItems),
        invoice_line_items: sanitizedItems,
        raw_source_data: "AI Assisted Draft Tool execution",
        payment_status: "draft" as const,
        created_by_identity: "ai_assistant" as const,
        ai_confidence_score: 0.95,
        is_verified_by_human: false,
        introductory_text: args.introductory_text || "",
        closing_text: args.closing_text || "",
        metadata: { is_ai_draft: true },
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      };
      
      fallbackStore.invoices.unshift(newInvoice);
      saveFallbackStore();
    } else {
      await pool.query(`
        INSERT INTO fiscal_billing_invoices (
          id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id, 
          issue_date, service_date, due_date, payment_term, is_vat_inclusive,
          total_net_amount, total_vat_amount, total_gross_amount, vat_rate, 
          currency_code, leitweg_id, invoice_line_items_json, raw_source_data,
          payment_status, created_by_identity, ai_confidence_score, is_verified_by_human,
          introductory_text, closing_text, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
      `, [
        id, tenantId, computedInvoiceNumber, resolvedCompanyId, resolvedContactId,
        issueDate, issueDate, dueDate, paymentTerm, !!args.is_vat_inclusive,
        totalNet, totalVat, totalGross, (sanitizedItems[0]?.vat_rate !== undefined && sanitizedItems[0]?.vat_rate !== null) ? sanitizedItems[0].vat_rate : 19,
        args.currency_code || "EUR", args.leitweg_id || null, JSON.stringify(sanitizedItems), "AI Assisted Draft Tool execution",
        "draft", "ai_assistant", 0.95, false,
        args.introductory_text || "", args.closing_text || "", JSON.stringify({ is_ai_draft: true })
      ]);
    }

    try {
      if (isUsingFallback) {
        if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
        fallbackStore.auditLogs.unshift({
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          event_type: 'CREATE_DRAFT',
          entity_type: 'INVOICE',
          entity_id: id,
          event_details: `AI created invoice draft: ${computedInvoiceNumber}`,
          actor_identity: actor,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_audit_event_logs (id_uuid, tenant_id, event_type, entity_type, entity_id, event_details, actor_identity)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [uuidv4(), tenantId, 'CREATE_DRAFT', 'INVOICE', id, `AI created invoice draft: ${computedInvoiceNumber}`, actor]);
      }
    } catch (e) {
      console.warn("Failed to log CREATE_DRAFT event in audit logs:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'invoice.created', { id_uuid: id, invoice_number: computedInvoiceNumber, ...args });

    return createToolSuccess({
      message: `Erfolg! Rechnungsentwurf wurde erfolgreich angelegt. Rechnungsnummer: ${computedInvoiceNumber}, Datenbank-ID: ${id}, Gesamtbetrag: ${totalGross.toFixed(2)} EUR.`,
      invoice_number: computedInvoiceNumber,
      id_uuid: id,
      total_gross_amount: totalGross
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'create_invoice_draft': ${errMsg}`);
  }
}

/**
 * Tool 10: Create Draft Company Tool
 * Allows LOUIS AI to directly insert a company draft into the database or fallback store.
 */
export async function executeCreateDraftCompany(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"full_legal_name\": \"Muster GmbH\", \"street\": \"Musterstr.\", \"house_number\": \"12\", \"postal_code\": \"12345\", \"city\": \"Musterstadt\", \"email_address\": \"info@muster.de\", \"phone_number\": \"0123-456789\", \"tax_vat_id\": \"DE123456789\", \"tax_number\": \"12/345/67890\"}");
    }

    const parseResult = CreateCompanyArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_company_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;

    if (!args.full_legal_name) {
      throw new Error("full_legal_name ist erforderlich.");
    }

    const id = uuidv4();
    const companyName = args.full_legal_name;

    const newComp = {
      id_uuid: id,
      tenant_id: tenantId,
      full_legal_name: companyName,
      tax_vat_id: args.tax_vat_id || null,
      tax_number: args.tax_number || null,
      responsible_person: args.responsible_person || null,
      street: args.street || null,
      house_number: args.house_number || null,
      city: args.city || null,
      postal_code: args.postal_code || null,
      country_code: args.country_code || "DE",
      email_address: args.email_address || null,
      email_2: args.email_2 || null,
      website: args.website || null,
      phone_number: args.phone_number || null,
      mobile_number: args.mobile_number || null,
      fax_number: args.fax_number || null,
      iban: args.iban || null,
      bic_swift: args.bic_swift || null,
      leitweg_id: args.leitweg_id || null,
      payment_term: args.payment_term || "14",
      price_list: args.price_list || null,
      custom_documents: args.custom_documents || null,
      vat_rate: args.vat_rate !== undefined && args.vat_rate !== null ? args.vat_rate : 19,
      currency_code: args.currency_code || "EUR",
      language: args.language || "de",
      labels: [],
      labels_json: "[]",
      opt_in_marketing: false,
      opt_in_social_media: false,
      opt_in_direct_message: false,
      opt_in_sms: false,
      opt_in_phone: false,
      created_by_identity: "ai_assistant" as const,
      ai_confidence_score: 0.95,
      is_verified_by_human: false,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    };

 // B3 : einheitlicher Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Unternehmen-Entwurf erstellt (Freigabe erforderlich). Name: ${companyName}, Datenbank-ID: ${id}.`,
        full_legal_name: companyName,
        id_uuid: id,
        company: newComp,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      if (!fallbackStore.companies) fallbackStore.companies = [];
      fallbackStore.companies.unshift(newComp);
      saveFallbackStore();
    } else {
      await pool.query(`
        INSERT INTO core_registry_companies (
          id_uuid, tenant_id, full_legal_name, tax_vat_id, tax_number, responsible_person, street, house_number,
          city, postal_code, country_code, email_address, website, phone_number,
          iban, bic_swift, leitweg_id, payment_term, language,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      `, [
        id, tenantId, companyName, args.tax_vat_id || null, args.tax_number || null, args.responsible_person || null,
        args.street || null, args.house_number || null, args.city || null, args.postal_code || null, args.country_code || "DE",
        args.email_address || null, args.website || null, args.phone_number || null,
        args.iban || null, args.bic_swift || null, args.leitweg_id || null, args.payment_term || "14", args.language || "de",
        "ai_assistant", 0.95, false
      ]);
    }

    try {
      if (isUsingFallback) {
        if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
        fallbackStore.auditLogs.unshift({
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          event_type: 'CREATE_DRAFT',
          entity_type: 'COMPANY',
          entity_id: id,
          event_details: `AI created company draft: ${companyName}`,
          actor_identity: actor,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_audit_event_logs (id_uuid, tenant_id, event_type, entity_type, entity_id, event_details, actor_identity)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [uuidv4(), tenantId, 'CREATE_DRAFT', 'COMPANY', id, `AI created company draft: ${companyName}`, actor]);
      }
    } catch (e) {
      console.warn("Failed to log CREATE_DRAFT event in audit logs:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'company.created', { id_uuid: id, ...args });

    return createToolSuccess({
      message: `Erfolg! Unternehmen-Entwurf wurde erfolgreich angelegt. Name: ${companyName}, Datenbank-ID: ${id}.`,
      full_legal_name: companyName,
      id_uuid: id,
      company: newComp
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'create_company_draft': ${errMsg}`);
  }
}

/**
 * Tool 9b (G2 ): Update Draft Company Tool
 * Partial-Update einer bestehenden Firma — nur bereitgestellte Felder werden geändert.
 * Draft-Charakter: is_verified_by_human = false (AI-Änderung), Audit-Log UPDATE_DRAFT.
 */
export async function executeUpdateDraftCompany(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = UpdateCompanyArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'update_company_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data as { id_uuid?: string; id?: string } & Record<string, unknown>;

    const companyId = args.id_uuid || args.id;
    if (!companyId) {
      throw new Error("id_uuid des Unternehmens ist erforderlich.");
    }

    // Zu ändernde Felder (nur bereitgestellte — Partial-Update)
    const updates: Record<string, unknown> = {};
    const fieldMap: Array<[string, string]> = [
      ["full_legal_name", "full_legal_name"],
      ["short_code", "short_code"],
      ["street", "street"],
      ["house_number", "house_number"],
      ["postal_code", "postal_code"],
      ["city", "city"],
      ["email_address", "email_address"],
      ["phone_number", "phone_number"],
      ["tax_vat_id", "tax_vat_id"],
      ["tax_number", "tax_number"],
      ["responsible_person", "responsible_person"],
      ["country_code", "country_code"],
      ["email_2", "email_2"],
      ["website", "website"],
      ["mobile_number", "mobile_number"],
      ["fax_number", "fax_number"],
      ["iban", "iban"],
      ["bic_swift", "bic_swift"],
      ["leitweg_id", "leitweg_id"],
      ["payment_term", "payment_term"],
      ["price_list", "price_list"],
      ["custom_documents", "custom_documents"],
      ["vat_rate", "vat_rate"],
      ["currency_code", "currency_code"],
      ["language", "language"]
    ];
    for (const [dbCol, argKey] of fieldMap) {
      if (args[argKey] !== undefined && args[argKey] !== null) {
        updates[dbCol] = args[argKey];
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("Keine änderbaren Felder angegeben.");
    }

 // B3 : einheitlicher Draft-Flow — Chat-Pfad nur Vorschlag,
    // Write erst nach Freigabe via approveProposal (action UPDATE)
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Unternehmen-Update-Entwurf erstellt (Freigabe erforderlich, ID: ${companyId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
        id_uuid: companyId,
        updated_fields: Object.keys(updates),
        proposed_state: updates,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      const idx = (fallbackStore.companies || []).findIndex(c => c.id_uuid === companyId);
      if (idx === -1) throw new Error(`Unternehmen ${companyId} nicht gefunden.`);
      fallbackStore.companies[idx] = {
        ...fallbackStore.companies[idx],
        ...updates,
        updated_at_utc: new Date().toISOString(),
        is_verified_by_human: false
      };
      saveFallbackStore();
    } else {
      const setClause = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`).join(", ");
      const values = [...Object.values(updates), companyId, tenantId];
      const res = await pool.query(
        `UPDATE core_registry_companies SET ${setClause}, updated_at_utc = CURRENT_TIMESTAMP, is_verified_by_human = false
         WHERE id_uuid = $${values.length - 1} AND (tenant_id = $${values.length} OR tenant_id = '1')`,
        values
      );
      if (res.rowCount === 0) throw new Error(`Unternehmen ${companyId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "UPDATE_DRAFT", entityType: "COMPANY", entityId: companyId, eventDetails: `AI update company draft: ${Object.keys(updates).join(", ")}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log UPDATE_DRAFT event:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'company.updated', { id_uuid: companyId, ...updates });

    return createToolSuccess({
      message: `Erfolg! Unternehmen-Entwurf aktualisiert (ID: ${companyId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
      id_uuid: companyId,
      updated_fields: Object.keys(updates)
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'update_company_draft': ${errMsg}`);
  }
}

/**
 * Tool 11b (G2 ): Update Draft Contact Tool
 * Partial-Update eines bestehenden Kontakts — inkl. Opt-in-Feldern (G1-Muster).
 * Draft-Charakter: is_verified_by_human = false (AI-Änderung), Audit-Log UPDATE_DRAFT.
 */
export async function executeUpdateDraftContact(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = UpdateContactArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'update_contact_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data as { id_uuid?: string; id?: string } & Record<string, unknown>;

    const contactId = args.id_uuid || args.id;
    if (!contactId) {
      throw new Error("id_uuid des Kontakts ist erforderlich.");
    }

    // Zu ändernde Felder (nur bereitgestellte — Partial-Update)
    const updates: Record<string, unknown> = {};
    const fieldMap: Array<[string, string]> = [
      ["first_name", "first_name"],
      ["last_name", "last_name"],
      ["salutation", "salutation"],
      ["email_address", "email_address"],
      ["phone_number", "phone_number"],
      ["street", "street"],
      ["house_number", "house_number"],
      ["postal_code", "postal_code"],
      ["city", "city"],
      ["gender_identity", "gender_identity"],
      ["date_of_birth", "date_of_birth"],
      ["region", "region"],
      ["email_2", "email_2"],
      ["website", "website"],
      ["fax_number", "fax_number"],
      ["mobile_number", "mobile_number"],
      ["language", "language"],
      ["tax_vat_id", "tax_vat_id"],
      ["iban", "iban"],
      ["bic_swift", "bic_swift"],
      ["payment_term", "payment_term"],
      ["price_list", "price_list"],
      ["custom_documents", "custom_documents"],
      ["responsible_person", "responsible_person"],
      // company_id ist nach dem Preprocess normalisiert (deckt
      // associated_company_id UND company_id ab — Alias-Parität create↔update).
      ["associated_company_id", "company_id"]
    ];
    for (const [dbCol, argKey] of fieldMap) {
      if (args[argKey] !== undefined && args[argKey] !== null) {
        updates[dbCol] = args[argKey];
      }
    }
    // labels → labels_json (DB-Spalte), Fallback hält labels (Array) + labels_json konsistent
    if (args.labels !== undefined) {
      updates.labels = args.labels;
    }
    // G1: Opt-in-Felder (boolean — false darf explizit gesetzt werden)
    const optInMap: Array<[string, string]> = [
      ["opt_in_marketing", "opt_in_marketing"],
      ["opt_in_social_media", "opt_in_social_media"],
      ["opt_in_direct_message", "opt_in_direct_message"],
      ["opt_in_sms", "opt_in_sms"],
      ["opt_in_phone", "opt_in_phone"]
    ];
    for (const [dbCol, argKey] of optInMap) {
      if (args[argKey] !== undefined) {
        updates[dbCol] = Boolean(args[argKey]);
      }
    }

    // full_legal_name bei Namensänderung neu berechnen (Muster contacts.ts fullLegalName)
    if (updates.first_name !== undefined || updates.last_name !== undefined) {
      let curFirst: unknown = undefined;
      let curLast: unknown = undefined;
      if (isUsingFallback) {
        const cur = ((fallbackStore.contacts || []).find((c) => c.id_uuid === contactId) || {}) as {
          first_name?: unknown;
          last_name?: unknown;
        };
        curFirst = cur.first_name;
        curLast = cur.last_name;
      } else {
        const row = await pool.query(
          "SELECT first_name, last_name FROM core_registry_contacts WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [contactId, tenantId]
        );
        const cur = (row.rows[0] || {}) as { first_name?: unknown; last_name?: unknown };
        curFirst = cur.first_name;
        curLast = cur.last_name;
      }
      updates.full_legal_name =
        [updates.first_name ?? curFirst ?? "", updates.last_name ?? curLast ?? ""].filter(Boolean).join(" ").trim();
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("Keine änderbaren Felder angegeben.");
    }

 // B3 : einheitlicher Draft-Flow — Chat-Pfad nur Vorschlag
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kontakt-Update-Entwurf erstellt (Freigabe erforderlich, ID: ${contactId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
        id_uuid: contactId,
        updated_fields: Object.keys(updates),
        proposed_state: updates,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      const idx = (fallbackStore.contacts || []).findIndex(c => c.id_uuid === contactId);
      if (idx === -1) throw new Error(`Kontakt ${contactId} nicht gefunden.`);
      const merged: Record<string, unknown> = {
        ...fallbackStore.contacts[idx],
        ...updates,
        updated_at_utc: new Date().toISOString(),
        is_verified_by_human: false
      };
      // labels_json konsistent zum labels-Array halten (Fallback-Format)
      if (updates.labels !== undefined) merged.labels_json = JSON.stringify(updates.labels);
      fallbackStore.contacts[idx] = merged as typeof fallbackStore.contacts[number];
      saveFallbackStore();
    } else {
      // labels → labels_json (DB-Spalte existiert, labels nicht)
      const dbUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        dbUpdates[k === "labels" ? "labels_json" : k] = k === "labels" ? JSON.stringify(v) : v;
      }
      const setClause = Object.keys(dbUpdates).map((col, i) => `${col} = $${i + 1}`).join(", ");
      const values = [...Object.values(dbUpdates), contactId, tenantId];
      const res = await pool.query(
        `UPDATE core_registry_contacts SET ${setClause}, updated_at_utc = CURRENT_TIMESTAMP, is_verified_by_human = false
         WHERE id_uuid = $${values.length - 1} AND (tenant_id = $${values.length} OR tenant_id = '1')`,
        values
      );
      if (res.rowCount === 0) throw new Error(`Kontakt ${contactId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "UPDATE_DRAFT", entityType: "CONTACT", entityId: contactId, eventDetails: `AI update contact draft: ${Object.keys(updates).join(", ")}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log UPDATE_DRAFT event:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'contact.updated', { id_uuid: contactId, ...updates });

    return createToolSuccess({
      message: `Erfolg! Kontakt-Entwurf aktualisiert (ID: ${contactId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
      id_uuid: contactId,
      updated_fields: Object.keys(updates)
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'update_contact_draft': ${errMsg}`);
  }
}

/**
 * Tool 11: Create Draft Contact Tool
 * Allows LOUIS AI to directly insert a contact draft into the database or fallback store.
 */
export async function executeCreateDraftContact(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"first_name\": \"Max\", \"last_name\": \"Mustermann\", \"salutation\": \"Herr\", \"email_address\": \"max@muster.de\", \"phone_number\": \"0123-456789\", \"associated_company_id\": \"co-uuid\", \"street\": \"Musterstr.\", \"house_number\": \"12\", \"postal_code\": \"12345\", \"city\": \"Musterstadt\"}");
    }

    const parseResult = CreateContactArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_contact_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;

    if (!args.last_name) {
      throw new Error("last_name ist erforderlich.");
    }

    const id = uuidv4();
    const fullName = `${args.first_name || ''} ${args.last_name}`.trim();
    const resolvedCompanyId = args.company_id || args.associated_company_id || null;

    const newContact = {
      id_uuid: id,
      tenant_id: tenantId,
      first_name: args.first_name || null,
      last_name: args.last_name,
      full_legal_name: fullName,
      salutation: args.salutation || null,
      responsible_person: args.responsible_person || null,
      gender_identity: args.gender_identity || null,
      date_of_birth: args.date_of_birth || null,
      region: args.region || null,
      street: args.street || null,
      house_number: args.house_number || null,
      city: args.city || null,
      postal_code: args.postal_code || null,
      email_address: args.email_address || null,
      email_2: args.email_2 || null,
      website: args.website || null,
      phone_number: args.phone_number || null,
      fax_number: args.fax_number || null,
      mobile_number: args.mobile_number || null,
      language: args.language || "de",
      // labels aus Args (Agent kann Labels setzen, konsistent mit MCP/UI)
      labels: args.labels ?? [],
      labels_json: JSON.stringify(args.labels ?? []),
 // G1 : Opt-ins aus Args (Default false), nicht mehr hart false
      opt_in_marketing: args.opt_in_marketing ?? false,
      opt_in_social_media: args.opt_in_social_media ?? false,
      opt_in_direct_message: args.opt_in_direct_message ?? false,
      opt_in_sms: args.opt_in_sms ?? false,
      opt_in_phone: args.opt_in_phone ?? false,
      tax_vat_id: args.tax_vat_id || null,
      iban: args.iban || null,
      bic_swift: args.bic_swift || null,
      payment_term: args.payment_term || "14",
      price_list: args.price_list || null,
      custom_documents: args.custom_documents || null,
      associated_company_id: resolvedCompanyId,
      created_by_identity: "ai_assistant" as const,
      ai_confidence_score: 0.95,
      is_verified_by_human: false,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    };

 // B3 : einheitlicher Draft-Flow — im Chat-Pfad KEIN direkter
    // Write; der Datensatz wird nur als Vorschlag (proposedChanges) erzeugt
    // und erst nach menschlicher Freigabe via approveProposal persistiert.
    // Workflow-Pfad (bypassApproval=true) schreibt direkt (kein Freigabe-Button).
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kontakt-Entwurf erstellt (Freigabe erforderlich). Name: ${fullName}, Datenbank-ID: ${id}.`,
        full_legal_name: fullName,
        id_uuid: id,
        contact: newContact,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      if (!fallbackStore.contacts) fallbackStore.contacts = [];
      fallbackStore.contacts.unshift(newContact);
      saveFallbackStore();
    } else {
      await pool.query(`
        INSERT INTO core_registry_contacts (
          id_uuid, tenant_id, first_name, last_name, full_legal_name, salutation,
          responsible_person, gender_identity, date_of_birth, region, street, house_number, city, postal_code,
          email_address, email_2, website, phone_number, fax_number, mobile_number,
          associated_company_id, language, labels_json,
          opt_in_marketing, opt_in_social_media, opt_in_direct_message, opt_in_sms, opt_in_phone,
          tax_vat_id, iban, bic_swift, payment_term, price_list, custom_documents,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
      `, [
        id, tenantId, args.first_name || null, args.last_name, fullName, args.salutation || null,
        args.responsible_person || null, args.gender_identity || null, args.date_of_birth || null, args.region || null,
        args.street || null, args.house_number || null, args.city || null, args.postal_code || null,
        args.email_address || null, args.email_2 || null, args.website || null,
        args.phone_number || null, args.fax_number || null, args.mobile_number || null,
        resolvedCompanyId, args.language || "de", JSON.stringify(args.labels ?? []),
        args.opt_in_marketing ?? false, args.opt_in_social_media ?? false, args.opt_in_direct_message ?? false, args.opt_in_sms ?? false, args.opt_in_phone ?? false,
        args.tax_vat_id || null, args.iban || null, args.bic_swift || null,
        args.payment_term || "14", args.price_list || null, args.custom_documents || null,
        "ai_assistant", 0.95, false
      ]);
    }

    try {
      if (isUsingFallback) {
        if (!fallbackStore.auditLogs) fallbackStore.auditLogs = [];
        fallbackStore.auditLogs.unshift({
          id_uuid: uuidv4(),
          tenant_id: tenantId,
          event_type: 'CREATE_DRAFT',
          entity_type: 'CONTACT',
          entity_id: id,
          event_details: `AI created contact draft: ${fullName}`,
          actor_identity: actor,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(`
          INSERT INTO sys_audit_event_logs (id_uuid, tenant_id, event_type, entity_type, entity_id, event_details, actor_identity)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [uuidv4(), tenantId, 'CREATE_DRAFT', 'CONTACT', id, `AI created contact draft: ${fullName}`, actor]);
      }
    } catch (e) {
      console.warn("Failed to log CREATE_DRAFT event in audit logs:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'contact.created', { id_uuid: id, ...args });

    const detailsList: string[] = [];
    if (args.street || args.house_number || args.postal_code || args.city) {
      const addr = [args.street, args.house_number, [args.postal_code, args.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      detailsList.push(`Adresse: ${addr}`);
    }
    if (args.phone_number) detailsList.push(`Tel: ${args.phone_number}`);
    if (args.email_address) detailsList.push(`E-Mail: ${args.email_address}`);
    const detailsStr = detailsList.length > 0 ? ` (${detailsList.join(' | ')})` : '';

    return createToolSuccess({
      message: `Erfolg! Kontakt-Entwurf wurde erfolgreich angelegt. Name: ${fullName}${detailsStr}, Datenbank-ID: ${id}.`,
      full_legal_name: fullName,
      id_uuid: id,
      contact: newContact
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'create_contact_draft': ${errMsg}`);
  }
}

/**
 * Tool 11: Create Draft Offer Tool
 * Allows LOUIS AI to directly insert an offer draft into the database or fallback store.
 */
/**
 * Notiz-Entwurf ( #1, 2026-08-14): Zero-Direct-Write — erzeugt nur den
 * proposedChanges-Entwurf; die Freigabe (approveProposal) schreibt in sys_louis_ai_notes.
 */
export async function executeCreateNoteDraft(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Erwartet: { contact_id_uuid?, company_id_uuid?, note_text, priority? }");
    }
    const parseResult = CreateNoteDraftInputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validierungsfehler: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
    }
    const input = parseResult.data;
    if (!input.contact_id_uuid && !input.company_id_uuid) {
      throw new Error("Bitte ein Ziel angeben: contact_id_uuid (Kontakt) ODER company_id_uuid (Firma).");
    }
    if (input.contact_id_uuid && input.company_id_uuid) {
      throw new Error("Bitte nur EIN Ziel angeben: entweder Kontakt ODER Firma, nicht beide.");
    }

    if (bypassApproval) {
      // (V2-2): MCP-/Workflow-Pfad persistiert die Notiz WIRKLICH
      // (Muster approveProposal, louisAi.ts) — statt nur einen Draft zu melden.
      const noteId = uuidv4();
      const entityTypeVal = input.contact_id_uuid ? "contact" : "company";
      const entityIdVal = input.contact_id_uuid || input.company_id_uuid || null;
      const noteText = String(input.note_text);
      if (isUsingFallback) {
        fallbackStore.aiNotes = fallbackStore.aiNotes || [];
        fallbackStore.aiNotes.push({
          id_uuid: noteId,
          tenant_id: tenantId,
          entity_type: entityTypeVal,
          entity_id_uuid: entityIdVal,
          note_text: noteText,
          priority: input.priority || "normal",
          created_by_identity: actor,
          created_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_louis_ai_notes (id_uuid, tenant_id, entity_type, entity_id_uuid, note_text, priority, created_by_identity, created_at_utc)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [noteId, tenantId, entityTypeVal, entityIdVal, noteText, input.priority || "normal", actor, new Date().toISOString()]
        );
      }
      try {
        await logAuditEvent({ tenantId, eventType: "CREATE_NOTE", entityType: "NOTE", entityId: noteId, eventDetails: `AI create note: ${noteText.slice(0, 80)}`, actorIdentity: actor });
      } catch (e) {
        console.warn("Failed to log CREATE_NOTE event:", e);
      }
      workflowEventBus.emitEvent(tenantId, "note.created", { entity_type: entityTypeVal, entity_id_uuid: entityIdVal, note_text: noteText });
      return createToolSuccess({
        message: `Erfolg! Notiz gespeichert (ID: ${noteId}).`,
        id_uuid: noteId,
        note_text: noteText,
        contact_id_uuid: input.contact_id_uuid || null,
        company_id_uuid: input.company_id_uuid || null,
        priority: input.priority || "normal"
      });
    }

    return createToolSuccess({
      message: "Notiz-Entwurf erstellt (Freigabe erforderlich).",
      note_text: input.note_text,
      contact_id_uuid: input.contact_id_uuid || null,
      company_id_uuid: input.company_id_uuid || null,
      priority: input.priority || "normal"
    });
  } catch (err) {
    return createToolError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * G4 : List Notes Tool — liest Notizen aus sys_louis_ai_notes.
 * Query JSON: { entity_type?: "contact"|"company"|"user", entity_id_uuid?: string, search?: string, limit?: number }
 * Ohne Filter: letzte 50 Notizen des Mandanten.
 */
export async function executeListNotes(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      // Freitext als Suchbegriff interpretieren
      raw = { search: argsStr };
    }

    const entityType = raw.entity_type ? String(raw.entity_type).toLowerCase() : undefined;
    const entityId = raw.entity_id_uuid || raw.entity_id || raw.contact_id_uuid || raw.company_id_uuid || undefined;
    const search = raw.search ? String(raw.search) : undefined;
    // 050 (048-B2): Query normalisieren — Modell kann JSON-String statt Freitext liefern
    const normSearch = search !== undefined ? normalizeQueryValue(search) : undefined;
    const limit = Math.min(Math.max(Number(raw.limit) || 50, 1), 200);

    let rows: Array<Record<string, unknown>> = [];
    if (isUsingFallback) {
      let notes = (fallbackStore.aiNotes || []).filter((n) => n.tenant_id === tenantId || n.tenant_id === "1");
      if (entityType) notes = notes.filter((n) => String(n.entity_type || "").toLowerCase() === entityType);
      if (entityId) notes = notes.filter((n) => n.entity_id_uuid === entityId);
      if (normSearch) notes = notes.filter((n) => String(n.note_text || "").toLowerCase().includes(normSearch.toLowerCase()));
      rows = notes.slice(0, limit);
    } else {
      const params: unknown[] = [tenantId];
      let where = `(tenant_id = $1 OR tenant_id = '1')`;
      if (entityType) {
        params.push(entityType === "contact" ? "contact" : entityType === "company" ? "company" : entityType);
        where += ` AND LOWER(entity_type) = $${params.length}`;
      }
      if (entityId) {
        params.push(entityId);
        where += ` AND entity_id_uuid = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND note_text ILIKE $${params.length}`;
      }
      params.push(limit);
      const res = await pool.query(
        `SELECT id_uuid, entity_type, entity_id_uuid, note_text, priority, created_by_identity, created_at_utc
         FROM sys_louis_ai_notes WHERE ${where} ORDER BY created_at_utc DESC LIMIT $${params.length}`,
        params
      );
      rows = res.rows;
    }

    return createToolSuccess({
      count: rows.length,
      notes: rows.map((r) => ({
        id_uuid: String(r.id_uuid || ""),
        entity_type: r.entity_type || null,
        entity_id_uuid: r.entity_id_uuid || null,
        note_text: r.note_text || "",
        priority: r.priority || "normal",
        created_at_utc: r.created_at_utc instanceof Date ? (r.created_at_utc as Date).toISOString() : String(r.created_at_utc)
      }))
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'list_notes': ${errMsg}`);
  }
}

/**
 * G4 : Update Note Tool — ändert note_text/priority einer Notiz.
 * Query JSON: { id_uuid (oder note_id), note_text?, priority? } — mindestens ein Feld.
 * Draft-Charakter wie G2: Audit-Log UPDATE_NOTE, kein is_verified-Flag (Notes haben keins).
 */
export async function executeUpdateNote(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Ungültiges JSON-Format.");
    }
    const raw = rawArgs as Record<string, unknown>;
    const noteId = String(raw.id_uuid || raw.note_id || raw.id || "").trim();
    if (!noteId) throw new Error("id_uuid der Notiz ist erforderlich.");

    const updates: Record<string, unknown> = {};
    if (raw.note_text !== undefined && raw.note_text !== null && String(raw.note_text).trim()) {
      updates.note_text = String(raw.note_text);
    }
    if (raw.priority !== undefined && raw.priority !== null) {
      const p = String(raw.priority).toLowerCase();
      if (!["low", "normal", "high", "urgent"].includes(p)) throw new Error(`Ungültige priority '${p}' (erlaubt: low, normal, high, urgent).`);
      updates.priority = p;
    }
    if (Object.keys(updates).length === 0) throw new Error("Keine änderbaren Felder angegeben (note_text oder priority).");

    if (isUsingFallback) {
      const idx = (fallbackStore.aiNotes || []).findIndex((n) => n.id_uuid === noteId && (n.tenant_id === tenantId || n.tenant_id === "1"));
      if (idx === -1) throw new Error(`Notiz ${noteId} nicht gefunden.`);
      fallbackStore.aiNotes[idx] = { ...fallbackStore.aiNotes[idx], ...updates };
      saveFallbackStore();
    } else {
      const setClause = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`).join(", ");
      const values = [...Object.values(updates), noteId, tenantId];
      const res = await pool.query(
        `UPDATE sys_louis_ai_notes SET ${setClause} WHERE id_uuid = $${values.length - 1} AND (tenant_id = $${values.length} OR tenant_id = '1')`,
        values
      );
      if (res.rowCount === 0) throw new Error(`Notiz ${noteId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "UPDATE_NOTE", entityType: "NOTE", entityId: noteId, eventDetails: `AI update note: ${Object.keys(updates).join(", ")}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log UPDATE_NOTE event:", e);
    }

    return createToolSuccess({
      message: `Erfolg! Notiz aktualisiert (ID: ${noteId}).`,
      id_uuid: noteId,
      updated_fields: Object.keys(updates)
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'update_note': ${errMsg}`);
  }
}

/**
 * G4 : Delete Note Tool — löscht eine Notiz.
 * Query JSON: { id_uuid (oder note_id) } — Audit-Log DELETE_NOTE.
 */
export async function executeDeleteNote(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Ungültiges JSON-Format.");
    }
    const raw = rawArgs as Record<string, unknown>;
    const noteId = String(raw.id_uuid || raw.note_id || raw.id || "").trim();
    if (!noteId) throw new Error("id_uuid der Notiz ist erforderlich.");

    if (isUsingFallback) {
      const before = (fallbackStore.aiNotes || []).length;
      fallbackStore.aiNotes = (fallbackStore.aiNotes || []).filter((n) => !(n.id_uuid === noteId && (n.tenant_id === tenantId || n.tenant_id === "1")));
      if (fallbackStore.aiNotes.length === before) throw new Error(`Notiz ${noteId} nicht gefunden.`);
      saveFallbackStore();
    } else {
      const res = await pool.query(
        `DELETE FROM sys_louis_ai_notes WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [noteId, tenantId]
      );
      if (res.rowCount === 0) throw new Error(`Notiz ${noteId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "DELETE_NOTE", entityType: "NOTE", entityId: noteId, eventDetails: "AI delete note", actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log DELETE_NOTE event:", e);
    }

    return createToolSuccess({ message: `Erfolg! Notiz ${noteId} gelöscht.`, id_uuid: noteId });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'delete_note': ${errMsg}`);
  }
}

export async function executeCreateDraftOffer(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: { \"title\": \"Angebot für...\", \"line_items\": [...] }");
    }

    const parseResult = CreateOfferArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map(err => `${err.path.join('.') || 'root'}: ${err.message}`)
        .join(", ");
      throw new Error(`Ungültige Argumente für 'create_offer_draft'. Details: ${errorDetails}`);
    }

    const args = parseResult.data;
    const id = uuidv4();

 // Angebotsnummer: gewünschte Nummer (B4) bevorzugen, sonst System-Nummer AG-YYYY-XXXX
    const requestedOfferNumber = args.offer_number ? String(args.offer_number).trim() : "";
    let offerNumber = requestedOfferNumber;

    if (!offerNumber) {
      // Determine next offer number
      const currentYear = new Date().getFullYear();
      const prefix = `AG-${currentYear}-`;
      let nextSeq = 1;

      if (isUsingFallback) {
        const yearOffers = (fallbackStore.offers || []).filter(
          o => o.tenant_id === tenantId && o.offer_number.startsWith(prefix)
        );
        let maxSeq = 0;
        for (const o of yearOffers) {
          const seq = parseInt(o.offer_number.replace(prefix, ""), 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
        nextSeq = maxSeq + 1;
      } else {
        const res = await pool.query(
          "SELECT offer_number FROM core_registry_offers WHERE tenant_id = $1 AND offer_number LIKE $2",
          [tenantId, `${prefix}%`]
        );
        let maxSeq = 0;
        for (const row of res.rows) {
          const seq = parseInt((row.offer_number as string).replace(prefix, ""), 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
        nextSeq = maxSeq + 1;
      }

      offerNumber = `${prefix}${String(nextSeq).padStart(4, "0")}`;
    }
    const issueDate = args.issue_date || new Date().toISOString().split("T")[0];

    // standard valid_until: +30 days
    let validUntil = args.valid_until || "";
    if (!validUntil) {
      const d = new Date(issueDate);
      d.setDate(d.getDate() + 30);
      validUntil = d.toISOString().split("T")[0];
    }

    let totalNet = 0;
    let totalVat = 0;
    const processedItems: OfferLineItem[] = args.line_items.map(item => {
      const net = Number((item.quantity * item.unit_price).toFixed(2));
      const vat = Number((net * ((item.vat_rate ?? 19) / 100)).toFixed(2));
      const gross = Number((net + vat).toFixed(2));

      totalNet += net;
      totalVat += vat;

      return {
        id_uuid: uuidv4(),
        position: item.position,
        description: item.description ?? "",
        quantity: item.quantity,
        unit_code: item.unit_code ?? "PCE",
        unit_price: item.unit_price,
        vat_rate: item.vat_rate ?? 19,
        total_net: net,
        total_gross: gross,
        is_text_position: !!item.is_text_position
      };
    });

    const totalGross = Number((totalNet + totalVat).toFixed(2));
    const resolvedCompanyId = args.company_id || args.associated_company_id || null;
    const resolvedContactId = args.contact_id || args.associated_contact_id || null;

    const newOffer: Offer = {
      id_uuid: id,
      tenant_id: tenantId,
      offer_number: offerNumber,
      associated_company_id: resolvedCompanyId,
      associated_contact_id: resolvedContactId,
      title: args.title,
      introductory_text: args.introductory_text || "",
      closing_text: args.closing_text || "",
      issue_date: issueDate,
      valid_until: validUntil,
      payment_term: args.payment_term || "14 Tage netto",
      currency_code: args.currency_code || "EUR",
      is_vat_inclusive: !!args.is_vat_inclusive,
      line_items: processedItems,
      total_net_amount: Number(totalNet.toFixed(2)),
      total_vat_amount: Number(totalVat.toFixed(2)),
      total_gross_amount: totalGross,
      offer_status: "draft",
      pdf_file_path: null,
      created_by_identity: "ai_assistant",
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    };

 // B3 : einheitlicher Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Angebotsentwurf erstellt (Freigabe erforderlich). Angebotsnummer: ${offerNumber}, Datenbank-ID: ${id}, Gesamtbetrag: ${totalGross.toFixed(2)} EUR.`,
        offer_number: offerNumber,
        id_uuid: id,
        total_gross_amount: totalGross,
        offer: newOffer,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      if (!fallbackStore.offers) fallbackStore.offers = [];
      fallbackStore.offers.unshift(newOffer);
      saveFallbackStore();
    } else {
      await pool.query(`
        INSERT INTO core_registry_offers (
          id_uuid, tenant_id, offer_number, associated_company_id, associated_contact_id,
          title, introductory_text, closing_text, issue_date, valid_until, payment_term,
          currency_code, is_vat_inclusive, line_items_json, total_net_amount, total_vat_amount,
          total_gross_amount, offer_status, pdf_file_path, created_by_identity, created_at_utc, updated_at_utc
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [
        newOffer.id_uuid, newOffer.tenant_id, newOffer.offer_number, newOffer.associated_company_id, newOffer.associated_contact_id,
        newOffer.title, newOffer.introductory_text, newOffer.closing_text, newOffer.issue_date, newOffer.valid_until, newOffer.payment_term,
        newOffer.currency_code, newOffer.is_vat_inclusive, JSON.stringify(newOffer.line_items), newOffer.total_net_amount, newOffer.total_vat_amount,
        newOffer.total_gross_amount, "draft", null, "ai_assistant"
      ]);
    }

    await logAuditEvent({
      tenantId,
      eventType: "CREATE_DRAFT",
      entityType: "OFFER",
      entityId: id,
      eventDetails: `AI-Agent hat Angebotsentwurf erstellt: ${offerNumber} (${args.title})`,
      actorIdentity: actor
    });

    workflowEventBus.emitEvent(tenantId, 'offer.created', { id_uuid: id, offer_number: offerNumber, ...args });

    return createToolSuccess({
      message: `Erfolg! Angebotsentwurf wurde erfolgreich angelegt. Angebotsnummer: ${offerNumber}, Datenbank-ID: ${id}, Gesamtbetrag: ${totalGross.toFixed(2)} EUR.`,
      offer_number: offerNumber,
      id_uuid: id,
      total_gross_amount: totalGross,
      offer: newOffer
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'create_offer_draft': ${errMsg}`);
  }
}

/**
 * G5 : Update Draft Invoice Tool
 * Partial-Update einer bestehenden Rechnung (Betrag/Status/Text). Nur bereitgestellte Felder.
 * Draft-Charakter: Audit-Log UPDATE_DRAFT; is_verified_by_human = false.
 */
export async function executeUpdateDraftInvoice(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Ungültiges JSON-Format.");
    }

    const parseResult = UpdateInvoiceArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'update_invoice_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data as { id_uuid?: string; id?: string } & Record<string, unknown>;
    const invoiceId = args.id_uuid || args.id;
    if (!invoiceId) throw new Error("id_uuid der Rechnung ist erforderlich.");

    const updates: Record<string, unknown> = {};
    const fieldMap: Array<[string, string]> = [
      ["invoice_number", "invoice_number"],
      ["issue_date", "issue_date"],
      ["service_date", "service_date"],
      ["due_date", "due_date"],
      ["payment_status", "payment_status"],
      ["payment_term", "payment_term"],
      ["currency_code", "currency_code"],
      ["introductory_text", "introductory_text"],
      ["closing_text", "closing_text"],
      ["leitweg_id", "leitweg_id"]
    ];
    for (const [dbCol, argKey] of fieldMap) {
      if (args[argKey] !== undefined && args[argKey] !== null) {
        updates[dbCol] = args[argKey];
      }
    }
    if (args.is_vat_inclusive !== undefined) updates.is_vat_inclusive = Boolean(args.is_vat_inclusive);
    if (args.total_gross_amount !== undefined && args.total_gross_amount !== null) updates.total_gross_amount = Number(args.total_gross_amount);

    if (Object.keys(updates).length === 0) throw new Error("Keine änderbaren Felder angegeben.");

 // B3 : einheitlicher Draft-Flow — Chat-Pfad nur Vorschlag
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Rechnung-Update-Entwurf erstellt (Freigabe erforderlich, ID: ${invoiceId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
        id_uuid: invoiceId,
        updated_fields: Object.keys(updates),
        proposed_state: updates,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      const idx = (fallbackStore.invoices || []).findIndex(i => i.id_uuid === invoiceId && (i.tenant_id === tenantId || i.tenant_id === "1"));
      if (idx === -1) throw new Error(`Rechnung ${invoiceId} nicht gefunden.`);
      fallbackStore.invoices[idx] = { ...fallbackStore.invoices[idx], ...updates, updated_at_utc: new Date().toISOString() };
      saveFallbackStore();
    } else {
      const setClause = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`).join(", ");
      const values = [...Object.values(updates), invoiceId, tenantId];
      const res = await pool.query(
        `UPDATE fiscal_billing_invoices SET ${setClause}, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $${values.length - 1} AND (tenant_id = $${values.length} OR tenant_id = '1')`,
        values
      );
      if (res.rowCount === 0) throw new Error(`Rechnung ${invoiceId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "UPDATE_DRAFT", entityType: "INVOICE", entityId: invoiceId, eventDetails: `AI update invoice draft: ${Object.keys(updates).join(", ")}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log UPDATE_DRAFT event:", e);
    }

    workflowEventBus.emitEvent(tenantId, 'invoice.updated', { id_uuid: invoiceId, ...updates });

    return createToolSuccess({
      message: `Erfolg! Rechnung-Entwurf aktualisiert (ID: ${invoiceId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
      id_uuid: invoiceId,
      updated_fields: Object.keys(updates)
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'update_invoice_draft': ${errMsg}`);
  }
}

/**
 * G6 : Update Draft Offer Tool
 * Partial-Update eines bestehenden Angebots. Nur bereitgestellte Felder.
 * Draft-Charakter: Audit-Log UPDATE_DRAFT; is_verified_by_human = false.
 */
export async function executeUpdateDraftOffer(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Ungültiges JSON-Format.");
    }

    const parseResult = UpdateOfferArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'update_offer_draft'. Details: ${errorDetails}`);
    }
    const args = parseResult.data as { id_uuid?: string; id?: string } & Record<string, unknown>;
    const offerId = args.id_uuid || args.id;
    if (!offerId) throw new Error("id_uuid des Angebots ist erforderlich.");

    const updates: Record<string, unknown> = {};
    const fieldMap: Array<[string, string]> = [
      ["title", "title"],
      ["introductory_text", "introductory_text"],
      ["closing_text", "closing_text"],
      ["issue_date", "issue_date"],
      ["valid_until", "valid_until"],
      ["payment_term", "payment_term"],
      ["currency_code", "currency_code"]
    ];
    for (const [dbCol, argKey] of fieldMap) {
      if (args[argKey] !== undefined && args[argKey] !== null) {
        updates[dbCol] = args[argKey];
      }
    }
    if (args.is_vat_inclusive !== undefined) updates.is_vat_inclusive = Boolean(args.is_vat_inclusive);
    if (args.total_gross_amount !== undefined && args.total_gross_amount !== null) updates.total_gross_amount = Number(args.total_gross_amount);

    if (Object.keys(updates).length === 0) throw new Error("Keine änderbaren Felder angegeben.");

 // B3 : einheitlicher Draft-Flow — Chat-Pfad nur Vorschlag
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Angebot-Update-Entwurf erstellt (Freigabe erforderlich, ID: ${offerId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
        id_uuid: offerId,
        updated_fields: Object.keys(updates),
        proposed_state: updates,
        draft: true,
        approval_required: true
      });
    }

    if (isUsingFallback) {
      const idx = (fallbackStore.offers || []).findIndex(o => o.id_uuid === offerId && (o.tenant_id === tenantId || o.tenant_id === "1"));
      if (idx === -1) throw new Error(`Angebot ${offerId} nicht gefunden.`);
      fallbackStore.offers[idx] = { ...fallbackStore.offers[idx], ...updates, updated_at_utc: new Date().toISOString() };
      saveFallbackStore();
    } else {
      const setClause = Object.keys(updates).map((col, i) => `${col} = $${i + 1}`).join(", ");
      const values = [...Object.values(updates), offerId, tenantId];
      const res = await pool.query(
        `UPDATE core_registry_offers SET ${setClause}, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $${values.length - 1} AND (tenant_id = $${values.length} OR tenant_id = '1')`,
        values
      );
      if (res.rowCount === 0) throw new Error(`Angebot ${offerId} nicht gefunden oder keine Berechtigung.`);
    }

    try {
      await logAuditEvent({ tenantId, eventType: "UPDATE_DRAFT", entityType: "OFFER", entityId: offerId, eventDetails: `AI update offer draft: ${Object.keys(updates).join(", ")}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log UPDATE_DRAFT event:", e);
    }

    return createToolSuccess({
      message: `Erfolg! Angebot-Entwurf aktualisiert (ID: ${offerId}). Geänderte Felder: ${Object.keys(updates).join(", ")}.`,
      id_uuid: offerId,
      updated_fields: Object.keys(updates)
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'update_offer_draft': ${errMsg}`);
  }
}

/**
 * Tool 12: Finalize and Send Offer Tool
 * Allows LOUIS AI to finalize an offer draft, trigger PDF rendering, register PDF in RAG, and update status.
 */
export async function executeFinalizeAndSendOffer(
  tenantId: string,
  argsStr: string,
  actor: string = "system"
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: { \"offer_id_uuid\": \"uuid\" }");
    }

    const parseResult = FinalizeOfferArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues
        .map(err => `${err.path.join('.') || 'root'}: ${err.message}`)
        .join(", ");
      throw new Error(`Ungültige Argumente für 'finalize_and_send_offer'. Details: ${errorDetails}`);
    }

    const parsed = parseResult.data;
    const targetOfferId = parsed.id || parsed.offer_id_uuid || parsed.id_uuid;
    if (!targetOfferId) {
      throw new Error("Fehler: Keine gültige Angebots-ID angegeben.");
    }
    const direct_send = parsed.direct_send;

    const callerCtx: Context = {
      tenantId,
      session: {
        user: {
          id: actor,
          name: "AI Assistant",
          email: "louis-agent@system",
          role: "system" as const,
          tenant_id: tenantId
        },
        expires: new Date(Date.now() + 3600 * 1000).toISOString()
      }
    };
    const caller = offersRouter.createCaller(callerCtx);
    
    // Generate PDF (this calls generateOfferPdf inside offers router, which updates the db/store, builds the PDF, and indexes it to RAG)
    const pdfRes = await caller.generateOfferPdf({ id_uuid: targetOfferId });
    if (!pdfRes.success) {
      throw new Error("Fehler bei der PDF-Generierung des Angebots.");
    }

    const offer = await caller.getOfferById({ id_uuid: targetOfferId });
    if (!offer) {
      throw new Error("Angebot nach der Generierung nicht gefunden.");
    }

    await logAuditEvent({
      tenantId,
      eventType: "FINALIZE",
      entityType: "OFFER",
      entityId: targetOfferId,
      eventDetails: `AI-Agent hat das Angebot finalisiert: ${offer.offer_number}`,
      actorIdentity: actor
    });

    workflowEventBus.emitEvent(tenantId, 'offer.finalized', { id_uuid: targetOfferId, offer_number: offer.offer_number });
    if (direct_send) {
      workflowEventBus.emitEvent(tenantId, 'offer.sent', { id_uuid: targetOfferId, offer_number: offer.offer_number });
    }

    return createToolSuccess({
      message: `Erfolg! Das Angebot ${offer.offer_number} wurde finalisiert, das PDF generiert (${pdfRes.filePath || 'Erfolgreich gespeichert'}), in der RAG-Wissensdatenbank registriert und der Status auf 'sent' aktualisiert.`,
      offer_number: offer.offer_number,
      id_uuid: targetOfferId,
      file_path: pdfRes.filePath
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'finalize_and_send_offer': ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 1: List Kanban Boards
 */
export async function executeListKanbanBoards(
  tenantId: string,
  argsStr?: string
): Promise<ToolResult<{ count: number; boards: unknown[] }>> {
  try {
    let searchTerm: string | undefined;
    if (argsStr) {
      try {
        const parsed = JSON.parse(argsStr);
        searchTerm = parsed.search_term || parsed.query;
      } catch {
        searchTerm = argsStr;
      }
    }

    if (isUsingFallback) {
      const boards = (fallbackStore.kanbanBoards || []).filter(b => b.tenant_id === tenantId || b.tenant_id === '1');
      const columns = fallbackStore.kanbanColumns || [];
      const cards = fallbackStore.kanbanCards || [];

      let filtered = boards;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = boards.filter(b => b.title.toLowerCase().includes(term) || (b.description && b.description.toLowerCase().includes(term)));
      }

      const result = filtered.map(board => {
        const boardCols = columns.filter(c => c.board_id === board.id_uuid);
        return {
          id_uuid: board.id_uuid,
          title: board.title,
          description: board.description,
          is_default: board.is_default,
          columns_count: boardCols.length,
          total_cards_count: cards.filter(c => c.board_id === board.id_uuid).length,
          columns: boardCols.map(c => ({
            id_uuid: c.id_uuid,
            title: c.title,
            cards_count: cards.filter(card => card.column_id === c.id_uuid).length
          }))
        };
      });

      return createToolSuccess({ count: result.length, boards: result });
    }

    let sql = `
      SELECT b.id_uuid, b.title, b.description, b.is_default, b.color,
             COUNT(DISTINCT col.id_uuid) as columns_count,
             COUNT(DISTINCT card.id_uuid) as total_cards_count
      FROM kanban_boards b
      LEFT JOIN kanban_columns col ON col.board_id = b.id_uuid AND (col.tenant_id = $1 OR col.tenant_id = '1')
      LEFT JOIN kanban_cards card ON card.board_id = b.id_uuid AND (card.tenant_id = $1 OR card.tenant_id = '1')
      WHERE (b.tenant_id = $1 OR b.tenant_id = '1')
    `;
    const params: unknown[] = [tenantId];

    if (searchTerm) {
      sql += ` AND (LOWER(b.title) LIKE LOWER($2) OR LOWER(b.description) LIKE LOWER($2))`;
      params.push(`%${searchTerm}%`);
    }

    sql += ` GROUP BY b.id_uuid, b.title, b.description, b.is_default, b.color ORDER BY b.is_default DESC, b.title ASC`;

    const res = await pool.query(sql, params);
    return createToolSuccess({ count: res.rows.length, boards: res.rows });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in list_kanban_boards: ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 2: Get Kanban Board Details
 */
export async function executeGetKanbanBoardDetails(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let boardIdUuid: string | undefined;
    try {
      const parsed = JSON.parse(argsStr);
      boardIdUuid = parsed.board_id || parsed.board_id_uuid || parsed.boardId || parsed.id;
    } catch {
      boardIdUuid = argsStr;
    }

 // B2 : ohne gültige ID keinen stillen Default-Fallback —
    // expliziter Fehler, sonst glaubt der Agent, es gäbe nur das Standard-Board
    if (!boardIdUuid || boardIdUuid === 'default') {
      return createToolError('Board-ID erforderlich (get_kanban_board_details): Bitte { board_id_uuid } angeben.');
    }

    if (isUsingFallback) {
      let board = (fallbackStore.kanbanBoards || []).find(b => 
        (boardIdUuid ? b.id_uuid === boardIdUuid : b.is_default) && (b.tenant_id === tenantId || b.tenant_id === '1')
      );
      if (!board && (fallbackStore.kanbanBoards || []).length > 0) {
        board = fallbackStore.kanbanBoards![0];
      }
      if (!board) {
        return createToolError('Kein Kanban-Board gefunden.');
      }

      const columns = (fallbackStore.kanbanColumns || [])
        .filter(c => c.board_id === board!.id_uuid && (c.tenant_id === tenantId || c.tenant_id === '1'))
        .sort((a, b) => a.position - b.position);

      const cards = (fallbackStore.kanbanCards || [])
        .filter(c => c.board_id === board!.id_uuid && (c.tenant_id === tenantId || c.tenant_id === '1'))
        .sort((a, b) => a.position - b.position);

      const fullColumns = columns.map(col => ({
        ...col,
        cards: cards.filter(card => card.column_id === col.id_uuid)
      }));

      return createToolSuccess({
        board: {
          ...board,
          columns: fullColumns
        }
      });
    }

    let boardRes;
    if (boardIdUuid && boardIdUuid !== 'default') {
      boardRes = await pool.query(
        `SELECT * FROM kanban_boards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [boardIdUuid, tenantId]
      );
    } else {
      boardRes = await pool.query(
        `SELECT * FROM kanban_boards WHERE (tenant_id = $1 OR tenant_id = '1') ORDER BY is_default DESC LIMIT 1`,
        [tenantId]
      );
    }

    if (boardRes.rows.length === 0) {
      return createToolError('Kein Kanban-Board gefunden.');
    }

    const board = boardRes.rows[0];
    const columnsRes = await pool.query(
      `SELECT * FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC`,
      [board.id_uuid, tenantId]
    );

    const cardsRes = await pool.query(
      `SELECT * FROM kanban_cards WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC`,
      [board.id_uuid, tenantId]
    );

 // B2 : kompakte Ausgabe — nur relevante Felder, damit das
    // Ergebnis nicht durch tool_result_truncate_chars (Default 2000) gekürzt
    // wird und der Agent Spalten/Karten tatsächlich sieht.
    const columns = columnsRes.rows.map(col => ({
      id_uuid: col.id_uuid,
      title: col.title,
      position: col.position,
      cards: cardsRes.rows
        .filter(card => card.column_id === col.id_uuid)
        .map(card => ({
          id_uuid: card.id_uuid,
          title: card.title,
          description: card.description || "",
          priority: card.priority || null,
          due_date: card.due_date ? String(card.due_date) : null,
          status: card.status || null
        }))
    }));

    return createToolSuccess({
      board: {
        id_uuid: board.id_uuid,
        title: board.title,
        description: board.description || "",
        is_default: board.is_default,
        color: board.color || "#3b82f6",
        columns_count: columns.length,
        total_cards_count: cardsRes.rows.length,
        columns
      }
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in get_kanban_board_details: ${errMsg}`);
  }
}

/**
 * G3 : Create Kanban Board Tool
 * Legt ein neues Kanban-Board an (Name + optionale Spalten + optionale Beispielkarten).
 * Draft-Flow via propose_crm_changes? Nein — Boards werden direkt angelegt (wie
 * create_kanban_card), aber mit Audit-Log CREATE_BOARD.
 */
export async function executeCreateKanbanBoard(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    // Schema: { title, description?, color?, columns?: string[], sample_cards?: string[] }
    const raw = rawArgs as Record<string, unknown>;
    const title = String(raw.title || raw.board_title || raw.name || "").trim();
    if (!title) throw new Error("title des Boards ist erforderlich.");
    const description = raw.description ? String(raw.description) : null;
    const color = raw.color ? String(raw.color) : "#3b82f6";

    // Spalten: entweder columns[] (Namen) oder column_titles[] — Default: Offen/In Bearbeitung/Erledigt
    let columnTitles: string[] = [];
    if (Array.isArray(raw.columns)) columnTitles = raw.columns.map((c) => String(c));
    else if (Array.isArray(raw.column_titles)) columnTitles = raw.column_titles.map((c) => String(c));
    if (columnTitles.length === 0) columnTitles = ["Offen", "In Bearbeitung", "Erledigt"];

    // Beispielkarten: sample_cards[] oder cards[] — optional
    const sampleCards = Array.isArray(raw.sample_cards)
      ? raw.sample_cards.map((c) => String(c))
      : Array.isArray(raw.cards)
        ? raw.cards.map((c) => String(c))
        : [];

    const boardId = uuidv4();

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write (Muster executeCreateDraftOffer Z. 1174)
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kanban-Board-Entwurf erstellt (Freigabe erforderlich). Titel: ${title}, Datenbank-ID: ${boardId}.`,
        board_id: boardId,
        board_id_uuid: boardId,
        title,
        description: description as string | null,
        color,
        columns: columnTitles,
        sample_cards: sampleCards,
        draft: true,
        approval_required: true,
        kanban_board: {
          id_uuid: boardId,
          title,
          description: description as string | null,
          color,
          columns: columnTitles,
          sample_cards: sampleCards
        }
      });
    }

    if (isUsingFallback) {
      if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
      fallbackStore.kanbanBoards.push({
        id_uuid: boardId,
        tenant_id: tenantId,
        title,
        description: description as string | null,
        color,
        is_default: false,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      });
      if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
      const colIds: string[] = [];
      columnTitles.forEach((name, idx) => {
        const colId = uuidv4();
        colIds.push(colId);
        fallbackStore.kanbanColumns!.push({
          id_uuid: colId,
          tenant_id: tenantId,
          board_id: boardId,
          title: name,
          position: idx,
          color_accent: idx === columnTitles.length - 1 ? '#22c55e' : '#64748b',
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
      });
      if (sampleCards.length > 0) {
        if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
        sampleCards.forEach((cardTitle, idx) => {
          fallbackStore.kanbanCards!.push({
            id_uuid: uuidv4(),
            tenant_id: tenantId,
            board_id: boardId,
            column_id: colIds[Math.min(idx, colIds.length - 1)],
            title: cardTitle,
            description: null,
            status: "todo",
            priority: "medium",
            position: idx,
            due_date: null,
            assigned_user: null,
            company_id_uuid: null,
            contact_id_uuid: null,
            labels: [],
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          });
        });
      }
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO kanban_boards (id_uuid, tenant_id, title, description, color, is_default)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [boardId, tenantId, title, description, color]
      );
      const colIds: string[] = [];
      for (let idx = 0; idx < columnTitles.length; idx++) {
        const colId = uuidv4();
        colIds.push(colId);
        await pool.query(
          `INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [colId, tenantId, boardId, columnTitles[idx], idx, idx === columnTitles.length - 1 ? '#22c55e' : '#64748b']
        );
      }
      for (let idx = 0; idx < sampleCards.length; idx++) {
        await pool.query(
          `INSERT INTO kanban_cards (id_uuid, tenant_id, board_id, column_id, title, status, priority, position)
           VALUES ($1, $2, $3, $4, $5, 'todo', 'medium', $6)`,
          [uuidv4(), tenantId, boardId, colIds[Math.min(idx, colIds.length - 1)], sampleCards[idx], idx]
        );
      }
    }

    try {
      await logAuditEvent({ tenantId, eventType: "CREATE_BOARD", entityType: "KANBAN_BOARD", entityId: boardId, eventDetails: `AI created kanban board: ${title}`, actorIdentity: actor });
    } catch (e) {
      console.warn("Failed to log CREATE_BOARD event:", e);
    }

    return createToolSuccess({
      message: `Erfolg! Kanban-Board '${title}' angelegt (ID: ${boardId}).`,
      board_id: boardId,
      board_id_uuid: boardId,
      title,
      columns: columnTitles
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'create_kanban_board': ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 3: Create Kanban Card
 */
export async function executeCreateKanbanCard(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = AICreateKanbanCardInputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validierungsfehler: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
    }
    const input = parseResult.data;

    let targetBoardId = input.board_id || input.board_id_uuid;
    let targetColumnId = input.column_id || input.column_id_uuid;
    const companyIdUuid = input.company_id || input.company_id_uuid || null;
    const contactIdUuid = input.contact_id || input.contact_id_uuid || null;

    if (isUsingFallback) {
      if (!targetBoardId) {
        const defaultBoard = (fallbackStore.kanbanBoards || []).find(b => b.is_default && (b.tenant_id === tenantId || b.tenant_id === '1'))
          || (fallbackStore.kanbanBoards || [])[0];
        if (defaultBoard) {
          targetBoardId = defaultBoard.id_uuid;
        } else {
          targetBoardId = uuidv4();
          const newBoard = {
            id_uuid: targetBoardId,
            tenant_id: tenantId,
            title: 'Standard Board',
            color: '#3b82f6',
            is_default: true,
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          };
          if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
          fallbackStore.kanbanBoards.push(newBoard);

          const colNames = ['Offen', 'In Bearbeitung', 'Erledigt'];
          if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
          colNames.forEach((name, idx) => {
            fallbackStore.kanbanColumns!.push({
              id_uuid: uuidv4(),
              tenant_id: tenantId,
              board_id: targetBoardId!,
              title: name,
              position: idx,
              color_accent: idx === 2 ? '#22c55e' : '#64748b',
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            });
          });
          saveFallbackStore();
        }
      }

      if (!targetColumnId) {
        const boardCols = (fallbackStore.kanbanColumns || []).filter(c => c.board_id === targetBoardId);
        if (input.column_title && boardCols.length > 0) {
          const matchedCol = boardCols.find(c => c.title.toLowerCase().includes(input.column_title!.toLowerCase()));
          if (matchedCol) targetColumnId = matchedCol.id_uuid;
        }
        if (!targetColumnId && boardCols.length > 0) {
          targetColumnId = boardCols[0].id_uuid;
        }
      }

      if (!targetColumnId) {
        throw new Error('Keine passende Spalte für die Karte gefunden.');
      }

      const existingCards = (fallbackStore.kanbanCards || []).filter(c => c.column_id === targetColumnId);
      const newPos = existingCards.length;
      const cardId = uuidv4();
      const now = new Date().toISOString();

      const newCard = {
        id_uuid: cardId,
        tenant_id: tenantId,
        board_id: targetBoardId!,
        column_id: targetColumnId,
        title: input.title,
        description: input.description || null,
        status: ((input as Record<string, unknown>).status as "backlog" | "todo" | "in_progress" | "done" | "blocked" | "archived") || 'todo',
        priority: input.priority || 'medium',
        position: newPos,
        due_date: input.due_date || null,
        assigned_user: null,
        company_id_uuid: companyIdUuid,
        contact_id_uuid: contactIdUuid,
        labels: input.labels || [],
        created_at_utc: now,
        updated_at_utc: now
      };

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
      if (!bypassApproval) {
        return createToolSuccess({
          message: `Kanban-Karten-Entwurf erstellt (Freigabe erforderlich). Titel: ${input.title}, Datenbank-ID: ${cardId}.`,
          card_id: cardId,
          title: input.title,
          draft: true,
          approval_required: true,
          kanban_card: newCard
        });
      }

      if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
      fallbackStore.kanbanCards.push(newCard);
      saveFallbackStore();

      workflowEventBus.emitEvent(tenantId, 'kanban.card_created', {
        id_uuid: cardId,
        card_id: cardId,
        board_id: targetBoardId,
        column_id: targetColumnId,
        title: input.title,
        priority: input.priority,
        company_id_uuid: companyIdUuid,
        contact_id_uuid: contactIdUuid
      });

      return createToolSuccess({
        message: `Erfolg! Kanban-Karte "${input.title}" wurde erfolgreich erstellt (ID: ${cardId}).`,
        card_id: cardId,
        title: input.title
      });
    }

    // Postgres Mode
    if (!targetBoardId) {
      const boardRes = await pool.query(
        `SELECT id_uuid FROM kanban_boards WHERE (tenant_id = $1 OR tenant_id = '1') ORDER BY is_default DESC LIMIT 1`,
        [tenantId]
      );
      if (boardRes.rows.length > 0) {
        targetBoardId = boardRes.rows[0].id_uuid;
      } else {
        targetBoardId = uuidv4();
        await pool.query(
          `INSERT INTO kanban_boards (id_uuid, tenant_id, title, color, is_default) VALUES ($1, $2, 'Standard Board', '#3b82f6', true)`,
          [targetBoardId, tenantId]
        );
        const colNames = ['Offen', 'In Bearbeitung', 'Erledigt'];
        for (let i = 0; i < colNames.length; i++) {
          await pool.query(
            `INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position) VALUES ($1, $2, $3, $4, $5)`,
            [uuidv4(), tenantId, targetBoardId, colNames[i], i]
          );
        }
      }
    }

    if (!targetColumnId) {
      const colsRes = await pool.query(
        `SELECT id_uuid, title FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC`,
        [targetBoardId, tenantId]
      );
      if (input.column_title && colsRes.rows.length > 0) {
        const matched = colsRes.rows.find(c => c.title.toLowerCase().includes(input.column_title!.toLowerCase()));
        if (matched) targetColumnId = matched.id_uuid;
      }
      if (!targetColumnId && colsRes.rows.length > 0) {
        targetColumnId = colsRes.rows[0].id_uuid;
      }
    }

    if (!targetColumnId) {
      throw new Error('Keine passende Spalte für die Karte gefunden.');
    }

    const posRes = await pool.query(
      `SELECT COUNT(*) as count FROM kanban_cards WHERE column_id = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [targetColumnId, tenantId]
    );
    const newPos = parseInt(posRes.rows[0]?.count || '0', 10);
    const cardId = uuidv4();

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kanban-Karten-Entwurf erstellt (Freigabe erforderlich). Titel: ${input.title}, Datenbank-ID: ${cardId}.`,
        card_id: cardId,
        title: input.title,
        draft: true,
        approval_required: true,
        kanban_card: {
          id_uuid: cardId,
          tenant_id: tenantId,
          board_id: targetBoardId,
          column_id: targetColumnId,
          title: input.title,
          description: input.description || null,
          priority: input.priority || 'medium',
          position: newPos,
          due_date: input.due_date || null,
          company_id_uuid: companyIdUuid,
          contact_id_uuid: contactIdUuid,
          labels: input.labels || []
        }
      });
    }

    await pool.query(
      `INSERT INTO kanban_cards (
        id_uuid, tenant_id, board_id, column_id, title, description, 
        priority, position, due_date, company_id_uuid, contact_id_uuid, labels
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        cardId,
        tenantId,
        targetBoardId,
        targetColumnId,
        input.title,
        input.description || null,
        input.priority || 'medium',
        newPos,
        input.due_date || null,
        companyIdUuid,
        contactIdUuid,
        input.labels || []
      ]
    );

    workflowEventBus.emitEvent(tenantId, 'kanban.card_created', {
      id_uuid: cardId,
      card_id: cardId,
      board_id: targetBoardId,
      column_id: targetColumnId,
      title: input.title,
      priority: input.priority,
      company_id_uuid: companyIdUuid,
      contact_id_uuid: contactIdUuid
    });

    return createToolSuccess({
      message: `Erfolg! Kanban-Karte "${input.title}" wurde erfolgreich erstellt (ID: ${cardId}).`,
      card_id: cardId,
      title: input.title
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in create_kanban_card: ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 4: Move Kanban Card
 */
export async function executeMoveKanbanCard(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = AIMoveKanbanCardInputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validierungsfehler: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
    }
    const input = parseResult.data;
    const cardId = input.card_id || input.card_id_uuid;
    if (!cardId) throw new Error("Fehler: Keine gültige card_id angegeben.");

    if (isUsingFallback) {
      const card = (fallbackStore.kanbanCards || []).find(c => c.id_uuid === cardId);
      if (!card) throw new Error(`Karte mit ID ${cardId} nicht gefunden.`);

      let targetColumnId = input.target_column_id || input.target_column_id_uuid;
      if (!targetColumnId && input.target_column_title) {
        const cols = (fallbackStore.kanbanColumns || []).filter(c => c.board_id === card.board_id);
        const matched = cols.find(c => c.title.toLowerCase().includes(input.target_column_title!.toLowerCase()));
        if (matched) targetColumnId = matched.id_uuid;
      }

      if (!targetColumnId) {
        throw new Error('Ziel-Spalte konnte nicht ermittelt werden.');
      }

      const fromColId = card.column_id;
      const fromCol = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === fromColId);
      const toCol = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === targetColumnId);

      card.column_id = targetColumnId;
      card.position = input.new_position;
      card.updated_at_utc = new Date().toISOString();

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
      if (!bypassApproval) {
        return createToolSuccess({
          message: `Kanban-Karten-Verschiebung als Entwurf erstellt (Freigabe erforderlich). Karte: ${card.title}, Datenbank-ID: ${card.id_uuid}.`,
          card_id: card.id_uuid,
          title: card.title,
          draft: true,
          approval_required: true,
          kanban_card: {
            id_uuid: card.id_uuid,
            board_id: card.board_id,
            column_id: targetColumnId,
            position: input.new_position ?? card.position,
            from_column_id: fromColId
          }
        });
      }

      saveFallbackStore();

      workflowEventBus.emitEvent(tenantId, 'kanban.card_moved', {
        id_uuid: card.id_uuid,
        card_id: card.id_uuid,
        board_id: card.board_id,
        from_column_id: fromColId,
        to_column_id: targetColumnId,
        from_column_title: fromCol?.title || '',
        to_column_title: toCol?.title || '',
        new_position: input.new_position,
        card_title: card.title
      });

      return createToolSuccess({
        message: `Erfolg! Karte "${card.title}" wurde in Spalte "${toCol?.title || targetColumnId}" verschoben.`,
        card_id: card.id_uuid,
        target_column_id: targetColumnId
      });
    }

    // Postgres Mode
    const cardRes = await pool.query(
      `SELECT * FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [cardId, tenantId]
    );
    if (cardRes.rows.length === 0) throw new Error(`Karte mit ID ${cardId} nicht gefunden.`);
    const card = cardRes.rows[0];
    const fromColId = card.column_id;

    let targetColumnId = input.target_column_id || input.target_column_id_uuid;
    if (!targetColumnId && input.target_column_title) {
      const colsRes = await pool.query(
        `SELECT id_uuid, title FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
        [card.board_id, tenantId]
      );
      const matched = colsRes.rows.find(c => c.title.toLowerCase().includes(input.target_column_title!.toLowerCase()));
      if (matched) targetColumnId = matched.id_uuid;
    }

    if (!targetColumnId) {
      throw new Error('Ziel-Spalte konnte nicht ermittelt werden.');
    }

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kanban-Karten-Verschiebung als Entwurf erstellt (Freigabe erforderlich). Karte: ${card.title}, Datenbank-ID: ${cardId}.`,
        card_id: cardId,
        title: card.title,
        draft: true,
        approval_required: true,
        kanban_card: {
          id_uuid: cardId,
          board_id: card.board_id,
          column_id: targetColumnId,
          position: input.new_position ?? card.position,
          from_column_id: fromColId
        }
      });
    }

    await pool.query(
      `UPDATE kanban_cards SET column_id = $1, position = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND (tenant_id = $4 OR tenant_id = '1')`,
      [targetColumnId, input.new_position, cardId, tenantId]
    );

    const colsRes = await pool.query(
      `SELECT id_uuid, title FROM kanban_columns WHERE id_uuid = ANY($1) AND (tenant_id = $2 OR tenant_id = '1')`,
      [[fromColId, targetColumnId], tenantId]
    );
    const fromColTitle = colsRes.rows.find(r => r.id_uuid === fromColId)?.title || '';
    const toColTitle = colsRes.rows.find(r => r.id_uuid === targetColumnId)?.title || '';

    workflowEventBus.emitEvent(tenantId, 'kanban.card_moved', {
      id_uuid: card.id_uuid,
      card_id: card.id_uuid,
      board_id: card.board_id,
      from_column_id: fromColId,
      to_column_id: targetColumnId,
      from_column_title: fromColTitle,
      to_column_title: toColTitle,
      new_position: input.new_position,
      card_title: card.title
    });

    return createToolSuccess({
      message: `Erfolg! Karte "${card.title}" wurde in Spalte "${toColTitle || targetColumnId}" verschoben.`,
      card_id: card.id_uuid,
      target_column_id: targetColumnId
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in move_kanban_card: ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 5: Update Kanban Card
 */
export async function executeUpdateKanbanCard(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = AIUpdateKanbanCardInputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validierungsfehler: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
    }
    const input = parseResult.data;
    const cardId = input.card_id || input.card_id_uuid;
    if (!cardId) throw new Error("Fehler: Keine gültige card_id angegeben.");

    if (isUsingFallback) {
      const idx = (fallbackStore.kanbanCards || []).findIndex(c => c.id_uuid === cardId);
      if (idx === -1) throw new Error(`Karte mit ID ${cardId} nicht gefunden.`);

      const card = fallbackStore.kanbanCards![idx];
      if (input.title !== undefined) card.title = input.title;
      if (input.description !== undefined) card.description = input.description;
      if (input.priority !== undefined) card.priority = input.priority;
      if (input.due_date !== undefined) card.due_date = input.due_date;
      if (input.labels !== undefined) card.labels = input.labels;
      card.updated_at_utc = new Date().toISOString();

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
      if (!bypassApproval) {
        return createToolSuccess({
          message: `Kanban-Karten-Update als Entwurf erstellt (Freigabe erforderlich). Titel: ${card.title}, Datenbank-ID: ${card.id_uuid}.`,
          card_id: card.id_uuid,
          title: card.title,
          draft: true,
          approval_required: true,
          kanban_card: { ...card }
        });
      }

      saveFallbackStore();

      workflowEventBus.emitEvent(tenantId, 'kanban.card_updated', {
        id_uuid: card.id_uuid,
        card_id: card.id_uuid,
        board_id: card.board_id,
        column_id: card.column_id,
        title: card.title,
        priority: card.priority
      });

      return createToolSuccess({
        message: `Erfolg! Karte "${card.title}" (ID: ${card.id_uuid}) wurde aktualisiert.`,
        card_id: card.id_uuid,
        title: card.title
      });
    }

    // Postgres Mode
    const cardRes = await pool.query(
      `SELECT * FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [cardId, tenantId]
    );
    if (cardRes.rows.length === 0) throw new Error(`Karte mit ID ${cardId} nicht gefunden.`);
    const card = cardRes.rows[0];

    const newTitle = input.title ?? card.title;
    const newDesc = input.description !== undefined ? input.description : card.description;
    const newPriority = input.priority ?? card.priority;
    const newDueDate = input.due_date !== undefined ? input.due_date : card.due_date;
    const newLabels = input.labels ?? card.labels;

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kanban-Karten-Update als Entwurf erstellt (Freigabe erforderlich). Titel: ${newTitle}, Datenbank-ID: ${cardId}.`,
        card_id: cardId,
        title: newTitle,
        draft: true,
        approval_required: true,
        kanban_card: {
          id_uuid: cardId,
          tenant_id: tenantId,
          board_id: card.board_id,
          column_id: card.column_id,
          title: newTitle,
          description: newDesc,
          priority: newPriority,
          due_date: newDueDate,
          labels: newLabels
        }
      });
    }

    await pool.query(
      `UPDATE kanban_cards SET title = $1, description = $2, priority = $3, due_date = $4, labels = $5, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $6 AND (tenant_id = $7 OR tenant_id = '1')`,
      [newTitle, newDesc, newPriority, newDueDate, newLabels, cardId, tenantId]
    );

    workflowEventBus.emitEvent(tenantId, 'kanban.card_updated', {
      id_uuid: card.id_uuid,
      card_id: card.id_uuid,
      board_id: card.board_id,
      column_id: card.column_id,
      title: newTitle,
      priority: newPriority
    });

    return createToolSuccess({
      message: `Erfolg! Karte "${newTitle}" (ID: ${cardId}) wurde aktualisiert.`,
      card_id: cardId,
      title: newTitle
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in update_kanban_card: ${errMsg}`);
  }
}

/**
 * Kanban MCP Tool 6: Delete Kanban Card
 */
export async function executeDeleteKanbanCard(
  tenantId: string,
  argsStr: string,
  actor: string = "system",
  bypassApproval: boolean = false
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error('Ungültiges JSON-Format.');
    }

    const parseResult = AIDeleteKanbanCardInputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new Error(`Validierungsfehler: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
    }
    const input = parseResult.data;
    const cardId = input.card_id || input.card_id_uuid;
    if (!cardId) throw new Error("Fehler: Keine gültige card_id angegeben.");

 // P0: Draft-Flow — Chat-Pfad KEIN direkter Write
    if (!bypassApproval) {
      return createToolSuccess({
        message: `Kanban-Karten-Löschung als Entwurf erstellt (Freigabe erforderlich). Karten-ID: ${cardId}.`,
        card_id: cardId,
        draft: true,
        approval_required: true,
        kanban_card: {
          id_uuid: cardId,
          action: "DELETE"
        }
      });
    }

    if (isUsingFallback) {
      fallbackStore.kanbanCards = (fallbackStore.kanbanCards || []).filter(c => c.id_uuid !== cardId);
      saveFallbackStore();

      workflowEventBus.emitEvent(tenantId, 'kanban.card_deleted', {
        id_uuid: cardId,
        card_id: cardId
      });

      return createToolSuccess({
        message: `Erfolg! Karte ${cardId} wurde gelöscht.`,
        card_id: cardId
      });
    }

    await pool.query(
      `DELETE FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')`,
      [cardId, tenantId]
    );

    workflowEventBus.emitEvent(tenantId, 'kanban.card_deleted', {
      id_uuid: cardId,
      card_id: cardId
    });

    return createToolSuccess({
      message: `Erfolg! Karte ${cardId} wurde gelöscht.`,
      card_id: cardId
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler in delete_kanban_card: ${errMsg}`);
  }
}

