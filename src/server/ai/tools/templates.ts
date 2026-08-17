import { pool, isUsingFallback, fallbackStore, cleanDbRow } from "../../db.js";
import { ToolResult, createToolSuccess, createToolError } from "./types.js";

export interface TemplateSearchResult extends Record<string, unknown> {
  type: 'email' | 'signature' | 'text' | 'item';
  id: string;
  name: string;
  details: Record<string, unknown>;
}

/**
 * Tool: Get / Search Templates
 * Retrieves all templates or searches across email templates, signatures, invoice/offer text templates, and item templates.
 */
export async function executeGetTemplates(
  tenantId: string,
  query: string = "",
  categoryFilter: 'email' | 'signature' | 'text' | 'item' | 'all' = 'all'
): Promise<ToolResult<{ totalCount: number; templates: TemplateSearchResult[] }>> {
  let searchTerm = "";
  let filter = categoryFilter;

  const rawQuery = (query || "").trim();

  // Parse JSON input strings (e.g. '{"search": "Standard-Rechnungsvorlage", "limit": 10, "offset": 0}')
  if (rawQuery.startsWith("{") && rawQuery.endsWith("}")) {
    try {
      const parsed = JSON.parse(rawQuery) as Record<string, unknown>;
      searchTerm = String(
        parsed.search || 
        parsed.query || 
        parsed.template_name || 
        parsed.name || 
        parsed.id || 
        parsed.id_uuid || 
        ""
      ).trim();
      if (parsed.category || parsed.categoryFilter || parsed.type) {
        filter = String(parsed.category || parsed.categoryFilter || parsed.type) as typeof categoryFilter;
      }
    } catch {
      searchTerm = rawQuery;
    }
  } else {
    searchTerm = rawQuery;
  }

  const cleanSearchTerm = searchTerm.toLowerCase().trim();
  const results: TemplateSearchResult[] = [];

  const matchesSearch = (name: string, extra1: string = "", extra2: string = ""): boolean => {
    if (!cleanSearchTerm || cleanSearchTerm === "*" || cleanSearchTerm === "all") return true;

    const lowerName = name.toLowerCase();
    const lowerE1 = extra1.toLowerCase();
    const lowerE2 = extra2.toLowerCase();

    // 1. Direct substring match
    if (
      lowerName.includes(cleanSearchTerm) || 
      lowerE1.includes(cleanSearchTerm) || 
      lowerE2.includes(cleanSearchTerm)
    ) {
      return true;
    }

    // 2. Normalized spaces & hyphens (e.g., "standard rechnungsvorlage" vs "standard-rechnungsvorlage")
    const normSearch = cleanSearchTerm.replace(/[-_\/\s]+/g, ' ').trim();
    const normName = lowerName.replace(/[-_\/\s]+/g, ' ').trim();
    const normE1 = lowerE1.replace(/[-_\/\s]+/g, ' ').trim();
    const normE2 = lowerE2.replace(/[-_\/\s]+/g, ' ').trim();

    if (
      normName.includes(normSearch) || 
      normE1.includes(normSearch) || 
      normE2.includes(normSearch)
    ) {
      return true;
    }

    // 3. Word token check (all significant words in search term match target)
    const searchWords = normSearch.split(' ').filter(w => w.length >= 2);
    if (searchWords.length > 0) {
      const fullText = `${normName} ${normE1} ${normE2}`;
      if (searchWords.every(w => fullText.includes(w))) {
        return true;
      }
    }

    return false;
  };

  try {
    // 1. Email Templates
    if (filter === 'all' || filter === 'email') {
      let emailTemplates: Array<Record<string, unknown>> = [];
      if (isUsingFallback) {
        emailTemplates = (fallbackStore.emailTemplates || []).map(r => ({ ...r }));
      } else {
        const res = await pool.query(
          "SELECT * FROM sys_comms_email_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC",
          [tenantId]
        );
        emailTemplates = res.rows.map(r => cleanDbRow(r));
      }

      for (const t of emailTemplates) {
        const name = String(t.template_name_text || "");
        const subject = String(t.email_subject_text || "");
        const body = String(t.email_body_content || "");
        if (matchesSearch(name, subject, body)) {
          results.push({
            type: 'email',
            id: String(t.id_uuid),
            name: name,
            details: {
              subject,
              body,
              created_by: t.created_by_identity || 'human'
            }
          });
        }
      }
    }

    // 2. Signatures
    if (filter === 'all' || filter === 'signature') {
      let signatures: Array<Record<string, unknown>> = [];
      if (isUsingFallback) {
        signatures = (fallbackStore.signatures || []).map(r => ({ ...r }));
      } else {
        const res = await pool.query(
          "SELECT * FROM sys_comms_signatures WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC",
          [tenantId]
        );
        signatures = res.rows.map(r => cleanDbRow(r));
      }

      for (const s of signatures) {
        const name = String(s.signature_name_text || "");
        const body = String(s.signature_body_content || "");
        const isDefault = Boolean(s.is_default_signature);
        if (matchesSearch(name, body)) {
          results.push({
            type: 'signature',
            id: String(s.id_uuid),
            name: name,
            details: {
              body,
              is_default: isDefault
            }
          });
        }
      }
    }

    // 3. Invoice & Offer Text Templates (Einleitung/Schluss)
    if (filter === 'all' || filter === 'text') {
      let textTemplates: Array<Record<string, unknown>> = [];
      if (isUsingFallback) {
        textTemplates = (fallbackStore.invoiceTextTemplates || []).map(r => ({ ...r }));
      } else {
        const res = await pool.query(
          "SELECT * FROM sys_comms_invoice_text_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC",
          [tenantId]
        );
        textTemplates = res.rows.map(r => cleanDbRow(r));
      }

      for (const txt of textTemplates) {
        const name = String(txt.template_name_text || "");
        const typeCode = String(txt.template_type_code || "");
        const body = String(txt.template_body_content || "");
        if (matchesSearch(name, typeCode, body)) {
          results.push({
            type: 'text',
            id: String(txt.id_uuid),
            name: name,
            details: {
              type_code: typeCode, // e.g. introductory, closing
              body
            }
          });
        }
      }
    }

    // 4. Invoice & Offer Item Templates (Positionen / Artikelvorlagen)
    if (filter === 'all' || filter === 'item') {
      let itemTemplates: Array<Record<string, unknown>> = [];
      if (isUsingFallback) {
        itemTemplates = (fallbackStore.invoiceItemTemplates || []).map(r => ({ ...r }));
      } else {
        const res = await pool.query(
          "SELECT * FROM sys_comms_invoice_item_templates WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY created_at_utc DESC",
          [tenantId]
        );
        itemTemplates = res.rows.map(r => cleanDbRow(r));
      }

      for (const item of itemTemplates) {
        const name = String(item.template_name_text || "");
        const desc = String(item.description || "");
        const unitPrice = typeof item.unit_price === 'string' ? parseFloat(item.unit_price) : Number(item.unit_price || 0);
        const vatRate = typeof item.vat_rate === 'string' ? parseFloat(item.vat_rate) : Number(item.vat_rate || 19);
        const quantity = typeof item.quantity === 'string' ? parseFloat(item.quantity) : Number(item.quantity || 1);
        const unitCode = String(item.unit_code || "HUR");
        const usageScope = String(item.usage_scope || "both");

        if (matchesSearch(name, desc)) {
          results.push({
            type: 'item',
            id: String(item.id_uuid),
            name: name,
            details: {
              description: desc,
              quantity,
              unit_price: unitPrice,
              vat_rate: vatRate,
              unit_code: unitCode,
              usage_scope: usageScope
            }
          });
        }
      }
    }

    if (results.length === 0) {
      return createToolError(`Keine Vorlagen ${searchTerm ? `für Suchbegriff "${searchTerm}"` : ""} gefunden. System hat 0 Treffer geliefert.`, { count: 0 });
    }

    return createToolSuccess({
      totalCount: results.length,
      templates: results
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Abrufen der Vorlagen: ${msg}`);
  }
}

/**
 * Tool: Get Template Details
 * Fetches complete details of a specific template by ID or exact/fuzzy name.
 */
export async function executeGetTemplateDetails(
  tenantId: string,
  query: string
): Promise<ToolResult<TemplateSearchResult>> {
  let cleanQuery = (query || "").trim();

  if (cleanQuery.startsWith("{") && cleanQuery.endsWith("}")) {
    try {
      const parsed = JSON.parse(cleanQuery) as Record<string, unknown>;
      cleanQuery = String(
        parsed.template_name || 
        parsed.name || 
        parsed.search || 
        parsed.query || 
        parsed.id || 
        parsed.id_uuid || 
        ""
      ).trim();
    } catch {
      // keep cleanQuery
    }
  }

  if (!cleanQuery) {
    return createToolError("Bitte geben Sie einen Vorlagennamen oder eine UUID an.");
  }

  try {
    const getRes = await executeGetTemplates(tenantId, cleanQuery, 'all');
    if (!getRes.success || !getRes.data || getRes.data.templates.length === 0) {
      return createToolError(`Vorlage mit ID oder Name '${cleanQuery}' wurde nicht gefunden.`);
    }

    const lowerQuery = cleanQuery.toLowerCase();
    const exact = getRes.data.templates.find((t: TemplateSearchResult) => 
      t.id.toLowerCase() === lowerQuery || 
      t.name.toLowerCase() === lowerQuery ||
      t.name.toLowerCase().replace(/[-_\/\s]+/g, ' ') === lowerQuery.replace(/[-_\/\s]+/g, ' ')
    ) || getRes.data.templates[0];

    return createToolSuccess(exact);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Laden der Vorlagendetails: ${msg}`);
  }
}

/**
 * Tool: Apply / Render Template
 * Substitutes variables in email templates, text templates, signatures, or formats offer/invoice item templates.
 */
export async function executeApplyTemplate(
  tenantId: string,
  inputPayload: string
): Promise<ToolResult<Record<string, unknown>>> {
  let templateIdOrName = "";
  let contextData: Record<string, unknown> = {};

  try {
    try {
      const parsed = JSON.parse(inputPayload) as Record<string, unknown>;
      templateIdOrName = String(
        parsed.template_id || 
        parsed.template_name || 
        parsed.name || 
        parsed.search || 
        parsed.query || 
        ""
      ).trim();
      contextData = (parsed.context || parsed.variables || parsed.data || {}) as Record<string, unknown>;
    } catch {
      templateIdOrName = inputPayload.trim();
    }

    if (!templateIdOrName) {
      return createToolError("Keine Vorlage angegeben (template_id oder template_name erforderlich).");
    }

    // Fetch details of template
    const templateRes = await executeGetTemplateDetails(tenantId, templateIdOrName);
    if (!templateRes.success || !templateRes.data) {
      return createToolError(`Vorlage "${templateIdOrName}" konnte nicht verarbeitet werden: ${templateRes.error}`);
    }

    const templateObj = templateRes.data;

    // Expand contextData with aliases for common keys
    const expandedData: Record<string, unknown> = { ...contextData };
    if (contextData.invoice_number && !expandedData.invoiceNumber) expandedData.invoiceNumber = contextData.invoice_number;
    if (contextData.invoiceNumber && !expandedData.invoice_number) expandedData.invoice_number = contextData.invoiceNumber;
    if (contextData.total_gross && !expandedData.totalGross) expandedData.totalGross = contextData.total_gross;
    if (contextData.total_gross && !expandedData.amount) expandedData.amount = contextData.total_gross;
    if (contextData.due_date && !expandedData.dueDate) expandedData.dueDate = contextData.due_date;
    if (contextData.due_date_utc && !expandedData.due_date) expandedData.due_date = contextData.due_date_utc;
    if (contextData.currency_code && !expandedData.currency) expandedData.currency = contextData.currency_code;
    if (!expandedData.currency) expandedData.currency = 'EUR';

    // Perform placeholder replacements for text/email/signature
    const replacePlaceholders = (text: string, data: Record<string, unknown>): string => {
      let result = text;
      // Replace {{key}} or {key}
      for (const [key, val] of Object.entries(data)) {
        if (val !== undefined && val !== null) {
          const strVal = String(val);
          const re1 = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
          const re2 = new RegExp(`\\{\\s*${key}\\s*\\}`, 'gi');
          result = result.replace(re1, strVal).replace(re2, strVal);
        }
      }
      return result;
    };

    if (templateObj.type === 'email') {
      const subject = replacePlaceholders(String(templateObj.details.subject || ""), expandedData);
      const body = replacePlaceholders(String(templateObj.details.body || ""), expandedData);
      return createToolSuccess({
        templateType: 'email',
        templateName: templateObj.name,
        renderedSubject: subject,
        renderedBody: body,
        recipient_email_address: String(expandedData.recipient_email_address || expandedData.recipient || expandedData.email || ""),
        email_subject_text: subject,
        email_body_content: body
      });
    } else if (templateObj.type === 'signature') {
      const body = replacePlaceholders(String(templateObj.details.body || ""), expandedData);
      return createToolSuccess({
        templateType: 'signature',
        templateName: templateObj.name,
        renderedBody: body
      });
    } else if (templateObj.type === 'text') {
      const body = replacePlaceholders(String(templateObj.details.body || ""), expandedData);
      return createToolSuccess({
        templateType: 'text',
        templateName: templateObj.name,
        typeCode: templateObj.details.type_code,
        renderedBody: body
      });
    } else if (templateObj.type === 'item') {
      return createToolSuccess({
        templateType: 'item',
        templateName: templateObj.name,
        item: {
          description: templateObj.details.description,
          quantity: templateObj.details.quantity,
          unit_price: templateObj.details.unit_price,
          vat_rate: templateObj.details.vat_rate,
          unit_code: templateObj.details.unit_code,
          usage_scope: templateObj.details.usage_scope
        }
      });
    }

    return createToolSuccess(templateObj);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Anwenden der Vorlage: ${msg}`);
  }
}
