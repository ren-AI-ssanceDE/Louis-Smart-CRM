import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../../db.js";
import { 
  CreateInvoiceArgsZodSchema, 
  CreateCompanyArgsZodSchema, 
  CreateContactArgsZodSchema 
} from "./types.js";

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
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return matrix[len1][len2];
}

export function fuzzyMatch(text: string, term: string): boolean {
  if (!text) return false;
  text = text.toLowerCase();
  term = term.toLowerCase();
  if (text.includes(term)) return true;
  if (term.length < 3) return false;

  const words = text.split(/\s+/);
  for (const word of words) {
    if (word.includes(term) || term.includes(word)) return true;
    const maxDist = term.length > 5 ? 2 : 1;
    if (Math.abs(word.length - term.length) <= maxDist) {
      const dist = levenshteinDistance(word, term);
      if (dist <= maxDist) return true;
    }
  }
  return false;
}

export async function executeCrmDataAnalyst(tenantId: string, query: string): Promise<any> {
  const searchTerms = getSearchTerms(query);
  const isGeneric = searchTerms.length === 0;

  if (isUsingFallback) {
    const comps = fallbackStore.companies.filter(c => c.tenant_id === tenantId);
    const conts = fallbackStore.contacts.filter(c => c.tenant_id === tenantId);
    const invs = fallbackStore.invoices.filter(c => c.tenant_id === tenantId);

    let matchCompanies = comps;
    let matchContacts = conts;
    let matchInvoices = invs;

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

      // Local Fallback Cascade: If strict scoring yields no results for contacts or invoices, but we matched companies:
      if (matchContacts.length === 0 && matchCompanies.length > 0) {
        const companyIds = new Set(matchCompanies.map(c => c.id_uuid));
        matchContacts = conts.filter(c => companyIds.has(c.associated_company_id));
      }
      if (matchInvoices.length === 0 && matchCompanies.length > 0) {
        const companyIds = new Set(matchCompanies.map(c => c.id_uuid));
        matchInvoices = invs.filter(i => companyIds.has(i.associated_company_id));
      }
    }

    return {
      stats: {
        total_companies_count: comps.length,
        total_contacts_count: conts.length,
        total_invoices_count: invs.length,
        open_invoices_gross_sum: invs.filter(i => i.payment_status === "pending").reduce((a, b) => a + b.total_gross_amount, 0),
        paid_invoices_gross_sum: invs.filter(i => i.payment_status === "paid").reduce((a, b) => a + b.total_gross_amount, 0),
      },
      search_meta: {
        searched_for_terms: searchTerms,
        is_filtered_search: !isGeneric,
        matched_companies_count: matchCompanies.length,
        matched_contacts_count: matchContacts.length,
        matched_invoices_count: matchInvoices.length
      },
      matched_entities: {
        companies: matchCompanies.slice(0, 10),
        contacts: matchContacts.slice(0, 10),
        invoices: matchInvoices.slice(0, 10),
      }
    };
  }

  // Postgres Mode
  try {
    const compCount = await pool.query("SELECT COUNT(*) FROM core_registry_companies WHERE tenant_id = $1", [tenantId]);
    const contCount = await pool.query("SELECT COUNT(*) FROM core_registry_contacts WHERE tenant_id = $1", [tenantId]);
    const invCount = await pool.query("SELECT COUNT(*), SUM(total_gross_amount) FILTER (WHERE payment_status = 'pending') as pending_sum, SUM(total_gross_amount) FILTER (WHERE payment_status = 'paid') as paid_sum FROM fiscal_billing_invoices WHERE tenant_id = $1", [tenantId]);

    let compMatchRows: any[] = [];
    let contMatchRows: any[] = [];
    let invMatchRows: any[] = [];

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

      // Cascading SQL-Fallback: If strict scoring yields 0 results for contacts or invoices, but we matched companies:
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
    }

    return {
      stats: {
        total_companies_count: parseInt(compCount.rows[0]?.count || "0"),
        total_contacts_count: parseInt(contCount.rows[0]?.count || "0"),
        total_invoices_count: parseInt(invCount.rows[0]?.count || "0"),
        open_invoices_gross_sum: parseFloat(invCount.rows[0]?.pending_sum || "0"),
        paid_invoices_gross_sum: parseFloat(invCount.rows[0]?.paid_sum || "0"),
      },
      search_meta: {
        searched_for_terms: searchTerms,
        is_filtered_search: !isGeneric,
        matched_companies_count: compMatchRows.length,
        matched_contacts_count: contMatchRows.length,
        matched_invoices_count: invMatchRows.length
      },
      matched_entities: {
        companies: compMatchRows,
        contacts: contMatchRows,
        invoices: invMatchRows,
      }
    };
  } catch (err) {
    return { error: `Database CRM Analyst scan failed: ${(err as Error).message}` };
  }
}

/**
 * Tool 9: Create Draft Invoice Tool
 * Allows LOUIS AI to directly insert an invoice draft into the database or fallback store.
 */
export async function executeCreateDraftInvoice(tenantId: string, argsStr: string, actor: string = "system"): Promise<string> {
  try {
    let rawArgs: any;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"company_id\": \"uuid\", \"contact_id\": \"uuid\", \"is_vat_inclusive\": true/false, \"items_list\": [{\"description\": \"Text\", \"quantity\": 1, \"unit_price\": 10, \"vat_rate\": 19}], \"introductory_text\": \"Hi\", \"closing_text\": \"Tschüss\", \"payment_term\": \"14\"}");
    }

    const parseResult = CreateInvoiceArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_draft_invoice'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;

    const id = uuidv4();
    const computedInvoiceNumber = `ENTWURF-${id}`;
    
    const items = args.items_list;

    let totalNet = 0;
    let totalVat = 0;
    for (const item of items) {
      const q = parseFloat(String(item.quantity || "0")) || 0;
      const up = parseFloat(String(item.unit_price || "0")) || 0;
      const vr = parseFloat(String(item.vat_rate || "19")) || 19;
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

    if (isUsingFallback) {
      const newInvoice = {
        id_uuid: id,
        tenant_id: tenantId,
        invoice_number: computedInvoiceNumber,
        associated_company_id: args.company_id || null,
        associated_contact_id: args.contact_id || null,
        bank_account: null,
        issue_date: issueDate,
        service_date: issueDate,
        due_date: dueDate,
        payment_term: paymentTerm,
        is_vat_inclusive: !!args.is_vat_inclusive,
        total_net_amount: totalNet,
        total_vat_amount: totalVat,
        total_gross_amount: totalGross,
        vat_rate: Number(items[0]?.vat_rate) || 19,
        currency_code: args.currency_code || "EUR",
        leitweg_id: args.leitweg_id || null,
        invoice_line_items_json: JSON.stringify(items.map(item => ({
          description: item.description || "",
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          vat_rate: Number(item.vat_rate) || 19,
          total_net: Number(item.total_net) || 0,
          unit_code: String(item.unit_code || "HUR")
        }))),
        invoice_line_items: items.map(item => ({
          description: item.description || "",
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.unit_price) || 0,
          vat_rate: Number(item.vat_rate) || 19,
          total_net: Number(item.total_net) || 0,
          unit_code: String(item.unit_code || "HUR")
        })),
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
        id, tenantId, computedInvoiceNumber, args.company_id || null, args.contact_id || null,
        issueDate, issueDate, dueDate, paymentTerm, !!args.is_vat_inclusive,
        totalNet, totalVat, totalGross, items[0]?.vat_rate || 19,
        args.currency_code || "EUR", args.leitweg_id || null, JSON.stringify(items), "AI Assisted Draft Tool execution",
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

    return `Erfolg! Rechnungsentwurf wurde erfolgreich angelegt. Rechnungsnummer: ${computedInvoiceNumber}, Datenbank-ID: ${id}, Gesamtbetrag: ${totalGross.toFixed(2)} EUR.`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Fehler im Tool 'create_draft_invoice': ${errMsg}`;
  }
}

/**
 * Tool 10: Create Draft Company Tool
 * Allows LOUIS AI to directly insert a company draft into the database or fallback store.
 */
export async function executeCreateDraftCompany(tenantId: string, argsStr: string, actor: string = "system"): Promise<string> {
  try {
    let rawArgs: any;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"full_legal_name\": \"Muster GmbH\", \"street\": \"Musterstr.\", \"house_number\": \"12\", \"postal_code\": \"12345\", \"city\": \"Musterstadt\", \"email_address\": \"info@muster.de\", \"phone_number\": \"0123-456789\", \"tax_vat_id\": \"DE123456789\", \"tax_number\": \"12/345/67890\"}");
    }

    const parseResult = CreateCompanyArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_draft_company'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;

    if (!args.full_legal_name) {
      throw new Error("full_legal_name ist erforderlich.");
    }

    const id = uuidv4();
    const companyName = args.full_legal_name;

    if (isUsingFallback) {
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
        vat_rate: args.vat_rate || 19,
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

    return `Erfolg! Unternehmen-Entwurf wurde erfolgreich angelegt. Name: ${companyName}, Datenbank-ID: ${id}.`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Fehler im Tool 'create_draft_company': ${errMsg}`;
  }
}

/**
 * Tool 11: Create Draft Contact Tool
 * Allows LOUIS AI to directly insert a contact draft into the database or fallback store.
 */
export async function executeCreateDraftContact(tenantId: string, argsStr: string, actor: string = "system"): Promise<string> {
  try {
    let rawArgs: any;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch {
      throw new Error("Fehler: Argumente sind kein gültiges JSON-Objekt. Es wird folgendes Schema erwartet: {\"first_name\": \"Max\", \"last_name\": \"Mustermann\", \"salutation\": \"Herr\", \"email_address\": \"max@muster.de\", \"phone_number\": \"0123-456789\", \"associated_company_id\": \"co-uuid\", \"street\": \"Musterstr.\", \"house_number\": \"12\", \"postal_code\": \"12345\", \"city\": \"Musterstadt\"}");
    }

    const parseResult = CreateContactArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'create_draft_contact'. Details: ${errorDetails}`);
    }
    const args = parseResult.data;

    if (!args.last_name) {
      throw new Error("last_name ist erforderlich.");
    }

    const id = uuidv4();
    const fullName = `${args.first_name || ''} ${args.last_name}`.trim();

    if (isUsingFallback) {
      const newContact = {
        id_uuid: id,
        tenant_id: tenantId,
        first_name: args.first_name || null,
        last_name: args.last_name,
        full_legal_name: fullName,
        salutation: args.salutation || null,
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
        labels: [],
        labels_json: "[]",
        opt_in_marketing: false,
        opt_in_social_media: false,
        opt_in_direct_message: false,
        opt_in_sms: false,
        opt_in_phone: false,
        tax_vat_id: args.tax_vat_id || null,
        iban: args.iban || null,
        bic_swift: args.bic_swift || null,
        payment_term: args.payment_term || "14",
        price_list: args.price_list || null,
        custom_documents: args.custom_documents || null,
        associated_company_id: args.associated_company_id || null,
        created_by_identity: "ai_assistant" as const,
        ai_confidence_score: 0.95,
        is_verified_by_human: false,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      };
      if (!fallbackStore.contacts) fallbackStore.contacts = [];
      fallbackStore.contacts.unshift(newContact);
      saveFallbackStore();
    } else {
      await pool.query(`
        INSERT INTO core_registry_contacts (
          id_uuid, tenant_id, first_name, last_name, full_legal_name, salutation,
          street, house_number, city, postal_code, email_address, phone_number,
          associated_company_id, language,
          created_by_identity, ai_confidence_score, is_verified_by_human
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        id, tenantId, args.first_name || null, args.last_name, fullName, args.salutation || null,
        args.street || null, args.house_number || null, args.city || null, args.postal_code || null, args.email_address || null, args.phone_number || null,
        args.associated_company_id || null, args.language || "de",
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

    return `Erfolg! Kontakt-Entwurf wurde erfolgreich angelegt. Name: ${fullName}, Datenbank-ID: ${id}.`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Fehler im Tool 'create_draft_contact': ${errMsg}`;
  }
}
