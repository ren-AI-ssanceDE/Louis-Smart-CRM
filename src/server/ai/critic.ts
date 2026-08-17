import { Type } from "@google/genai";
import { ZodError } from "zod";
import { CompanySchema, ContactSchema, InvoiceSchema } from "../../lib/schemas.js";
import { generateContentUniversal } from "./geminiHelper.js";
import { CriticValidationResult, CritiqueLoopResult, AgentLanguage } from "./agentTypes.js";

/**
 * Übersetzt einen Zod-Validierungsfehler in eine verständliche, handlungsorientierte
 * Meldung für den Endnutzer (statt roher technischer Fehlercodes).
 * Fix 2026-08-14 (QA-Befund 1/2): "[Schema Error] Location: last_name - Message: Invalid input…"
 * leakte in Chat-Antworten.
 */
function formatZodIssueForUser(issue: { path: PropertyKey[]; code: string; message: string; expected?: string; received?: unknown }): string {
  const field = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : "Daten";
  const fieldLabel = field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === undefined) {
        return `Das Feld „${fieldLabel}" ist erforderlich (Pflichtfeld) und fehlt im Entwurf.`;
      }
      return `Das Feld „${fieldLabel}" hat einen ungültigen Wert (erwartet: ${String(issue.expected ?? "Text")}, erhalten: ${String(issue.received)}).`;
    case "too_small":
      return `Das Feld „${fieldLabel}" ist zu kurz oder leer — bitte einen Wert angeben.`;
    case "too_big":
      return `Das Feld „${fieldLabel}" überschreitet die zulässige Länge.`;
    case "invalid_email":
      return `Das Feld „${fieldLabel}" enthält keine gültige E-Mail-Adresse.`;
    case "invalid_date":
    case "invalid_string":
      return `Das Feld „${fieldLabel}" hat ein ungültiges Format.`;
    case "invalid_enum_value":
      return `Das Feld „${fieldLabel}" hat einen nicht zulässigen Wert.`;
    default:
      return `Das Feld „${fieldLabel}" ist ungültig (${issue.message}).`;
  }
}

export interface ProposedLineItem {
  quantity?: string | number;
  unit_price?: string | number;
  total_net?: string | number;
}

export interface ProposedState {
  id?: string;
  id_uuid?: string;
  total_net_amount?: string | number;
  total_vat_amount?: string | number;
  total_gross_amount?: string | number;
  invoice_line_items?: ProposedLineItem[];
  [key: string]: unknown;
}

/**
 * The Critic (Louis QA / Critic)
 * Inspects mathematical sum consistency and validates against raw Zod schemas on the program side.
 * Additionally triggers an optional LLM critique of the overall feedback text to assert zero hallucinations.
 */
export function validateProposalMathAndSchema(
  entityType: 'companies' | 'contacts' | 'invoices' | 'kanban_board' | 'kanban_column' | 'kanban_card' | string,
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'MOVE' | string,
  proposedState: ProposedState
): CriticValidationResult {
  const errors: string[] = [];

  // DELETE has relaxed schema validation requirements (usually we only need the id / id_uuid)
  if (action === 'DELETE') {
    if (!proposedState.id && !proposedState.id_uuid) {
      errors.push("Missing id for DELETE action.");
    }
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // B3 (Auftrag 011): UPDATE-Vorschläge sind Partial-Updates — nur die ID ist
  // Pflicht, KEINE Create-Pflichtfelder (last_name, note_text, etc.).
  if (action === 'UPDATE') {
    if (!proposedState.id && !proposedState.id_uuid) {
      errors.push("id_uuid ist für UPDATE erforderlich.");
    }
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // 1. Zod Schema Verification
  try {
    if (entityType === 'companies') {
      CompanySchema.parse(proposedState);
    } else if (entityType === 'contacts') {
      ContactSchema.parse(proposedState);
    } else if (entityType === 'invoices') {
      InvoiceSchema.parse(proposedState);
    } else if (entityType === 'kanban_board' || entityType === 'kanban_column' || entityType === 'kanban_card') {
      if (action === 'CREATE' && !proposedState.title && !proposedState.card_id) {
        errors.push("Titel ist für die Erstellung der Kanban-Entität erforderlich.");
      }
    } else if (entityType === 'vault_skill') {
      // S10: Pflichtfeld-Check für Wissens-Skills (kein Mathe-Check)
      if (!proposedState.name || !proposedState.content) {
        errors.push("name und content sind für vault_skill erforderlich.");
      }
    } else if (entityType === 'note') {
      // QA-Befund #1: Notiz-Drafts — Pflichtfelder: Notiztext + genau EIN Ziel (Kontakt ODER Firma)
      if (!proposedState.note_text) {
        errors.push("note_text ist für eine Notiz erforderlich.");
      }
      if (!proposedState.contact_id_uuid && !proposedState.company_id_uuid) {
        errors.push("Bitte ein Ziel angeben: contact_id_uuid (Kontakt) ODER company_id_uuid (Firma).");
      }
      if (proposedState.contact_id_uuid && proposedState.company_id_uuid) {
        errors.push("Bitte nur EIN Ziel angeben: entweder Kontakt ODER Firma, nicht beide.");
      }
    } else {
      errors.push(`Unknown entity_type: ${entityType}`);
    }
  } catch (zodErr) {
    if (zodErr instanceof ZodError) {
      for (const subErr of zodErr.issues) {
        errors.push(formatZodIssueForUser(subErr));
      }
    } else {
      const err = zodErr as Error;
      errors.push(`Schema Error: ${err.message || String(zodErr)}`);
    }
  }

  // 2. Strict Mathematical Checks for Fiscal Invoices
  if (entityType === 'invoices') {
    const net = Number(proposedState.total_net_amount);
    const vat = Number(proposedState.total_vat_amount);
    const gross = Number(proposedState.total_gross_amount);

    if (isNaN(net) || isNaN(vat) || isNaN(gross)) {
      errors.push("Mathematical amounts (net, vat, gross) must be valid float numerical values.");
    } else {
      // Net + Vat should equal Gross within tolerance limits (allow minor float-rounding inaccuracy up to 1 Cent)
      const diffStr = Math.abs((net + vat) - gross).toFixed(4);
      const diffNumeric = Number(diffStr);
      if (diffNumeric > 0.015) {
        errors.push(`Mathematical Inconsistency: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) = ${(net + vat).toFixed(2)}, which does not match Gross (${gross.toFixed(2)})! Out of balance by ${diffStr} Cent.`);
      }
    }

    // Line items mathematical check
    const items = proposedState.invoice_line_items;
    if (items && Array.isArray(items)) {
      let computedNet = 0;
      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const qty = Number(item.quantity) || 0;
        const uPrice = Number(item.unit_price) || 0;
        const totalNet = Number(item.total_net) || 0;
        const expectedTotalNet = qty * uPrice;

        if (Math.abs(totalNet - expectedTotalNet) > 0.015) {
          errors.push(`Line Item [${idx + 1}] Math Variance: Qty (${qty}) * UnitPrice (${uPrice.toFixed(2)}) = ${expectedTotalNet.toFixed(2)}, which yields total_net ${totalNet.toFixed(2)}. Out of balance!`);
        }
        computedNet += totalNet;
      }

      if (Math.abs(computedNet - net) > 0.015) {
        errors.push(`Sum of invoice_line_items total_net (${computedNet.toFixed(2)}) doesn't match invoice total_net_amount (${net.toFixed(2)}).`);
      }
    } else {
      errors.push("Missing array list invoice_line_items for invoice record creation.");
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Optional Expert LLM Critique of the Final Draft to ensure absolute safety, correct German/English phrasing,
 * and elimination of potential hallucination patterns.
 */
export async function executeCritiqueLoop(
  providerType: 'gemini' | 'ollama' | 'openai' | 'anthropic',
  modelName: string,
  apiKeySecret: string | null,
  baseUrl: string | null,
  userMessage: string,
  proposedDraft: string,
  proposedDiff: Record<string, unknown> | null | undefined,
  language: AgentLanguage = 'de'
): Promise<CritiqueLoopResult> {
  try {
    const systemInstruction = `
      You are standard QA Validator & Compliance Auditor (Louis QA / Critic).
      Verify the proposed response and data change draft below for Louis Smart CRM.
      Your primary directives:
      1. Prevent false claims, ungrounded business assumptions, and hallucinated calculations.
      2. Keep tone technical, formal, neutral, professional, and compliant with European standards.
      3. CRITICAL: Concise, structured, and compact answers for read/query requests (e.g. lists, company lookups, count summaries) MUST be evaluated with high approval scores (approval_score >= 80) and approved=true. Do NOT require unnecessary long explanations.
      4. CRITICAL: The response must be consistently drafted in the user's preferred language: ${language === 'de' ? 'German' : 'English'}.
         Never translate a ${language === 'de' ? 'German' : 'English'} draft into another language unless requested.
      5. EMAIL ADDRESS MATCHING RULE: Do NOT compare or cross-check recipient email address string against recipient's personal name. In real-world CRM data, email addresses belong to representatives or generic mailboxes.
      6. PLACEHOLDER / DRAFT RULE: If an email body contains placeholders like "[Datum einfügen]" or "[Datum]", replace them in "corrected_draft" with actual relative timeframes like "binnen 7 Tagen". Always set "approved": true and approval_score >= 80 for proposed email drafts unless there is a severe mathematical error.
      7. FREIGABE-DRAFT-FLOW RULE (B3, Auftrag 011): Ein Draft-Vorschlag (proposedChanges mit action CREATE/UPDATE) ist ein ERFOLG, wenn alle vom Nutzer gewünschten Daten des ENTWURFS vollständig sind — auch wenn Folge-Entitäten (z.B. eine Notiz) im selben Prompt gewünscht, aber erst NACH Freigabe anlegbar sind. Ein fehlender Folge-Entwurf ist KEIN Fehler des aktuellen Entwurfs: Der Nutzer gibt zuerst frei, dann folgt der nächste Schritt. Setze approved=true und approval_score >= 80, wenn der Entwurf selbst konsistent ist (Pflichtfelder, Adresse, Opt-ins vorhanden). Kritisiere NICHT fehlende Folge-Entitäten oder "noch nicht in der Datenbank sichtbare" Drafts.

      Respond with a single valid JSON object of structure:
      {
        "approved": boolean,
        "approval_score": number (0-100, where >= 70 is accepted),
        "critic_commentary": "Short explanation of your audit results.",
        "corrected_draft": "The polished final draft text ready for the user"
      }
    `;

    const dynamicPayload = `
      Review inputs:
      - Initial User Request: "${userMessage}"
      - Draft Reply: "${proposedDraft}"
      - Diff State: ${JSON.stringify(proposedDiff, null, 2)}
    `;

    const res = await generateContentUniversal({
      provider_type: providerType,
      model_name: modelName,
      api_key_secret: apiKeySecret,
      base_url: baseUrl,
      temperature: 0.1,
      systemInstruction,
      contents: dynamicPayload,
      jsonFormat: true,
      responseSchema: providerType === 'gemini' ? {
        type: Type.OBJECT,
        properties: {
          approved: { type: Type.BOOLEAN },
          approval_score: { type: Type.NUMBER },
          critic_commentary: { type: Type.STRING },
          corrected_draft: { type: Type.STRING }
        },
        required: ["approved", "approval_score", "critic_commentary", "corrected_draft"]
      } : undefined
    });

    let cleanedText = (res.text || "{}").trim();
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const jsonMatch = cleanedText.match(jsonBlockRegex);
    if (jsonMatch && jsonMatch[1]) {
      cleanedText = jsonMatch[1].trim();
    }
    const body = JSON.parse(cleanedText) as {
      approved?: boolean;
      approval_score?: number;
      critic_commentary?: string;
      corrected_draft?: string;
    };
    const score = typeof body.approval_score === 'number' ? body.approval_score : (body.approved ? 90 : 30);
    const approved = score >= 70 || body.approved === true;

    return {
      approved,
      approvalScore: score,
      correctedDraft: body.corrected_draft || proposedDraft,
      log: body.critic_commentary || "Compliance check passed.",
      promptTokenCount: res.usageMetadata?.promptTokenCount,
      candidatesTokenCount: res.usageMetadata?.candidatesTokenCount,
    };
  } catch (err) {
    return {
      approved: false,
      correctedDraft: proposedDraft,
      log: `Critique check failed (No auto-bypass): ${(err as Error).message}`
    };
  }
}
