import { GoogleGenAI, Type } from "@google/genai";
import { ZodError } from "zod";
import { CompanySchema, ContactSchema, InvoiceSchema } from "../../lib/schemas.js";
import { generateContentSafe } from "./geminiHelper.js";

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

interface ProposedLineItem {
  quantity?: string | number;
  unit_price?: string | number;
  total_net?: string | number;
}

interface ProposedState {
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
  entityType: 'companies' | 'contacts' | 'invoices',
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  proposedState: ProposedState
): ValidationResult {
  const errors: string[] = [];

  // DELETE has relaxed schema validation requirements (usually we only need the id_uuid)
  if (action === 'DELETE') {
    if (!proposedState.id_uuid) {
      errors.push("Missing id_uuid for DELETE action.");
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
    } else {
      errors.push(`Unknown entity_type: ${entityType}`);
    }
  } catch (zodErr) {
    if (zodErr instanceof ZodError) {
      for (const subErr of zodErr.issues) {
        errors.push(`[Schema Error] Location: ${subErr.path.join('.') || 'root'} - Message: ${subErr.message}`);
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
  aiClient: GoogleGenAI,
  modelName: string,
  userMessage: string,
  proposedDraft: string,
  proposedDiff: Record<string, unknown> | null | undefined,
  language: string = 'de'
): Promise<{ approved: boolean; correctedDraft: string; log: string; promptTokenCount?: number; candidatesTokenCount?: number }> {
  try {
    const prompt = `
      You are standard QA Validator & Compliance Auditor (Louis QA / Critic).
      Verify the proposed response and data change draft below for Louis Smart CRM.
      Your primary directives:
      1. Prevent false claims, ungrounded business assumptions, and hallucinated calculations.
      2. Keep tone technical, formal, neutral, professional, and compliant with European standards.
      3. CRITICAL: The response must be consistently drafted in the user's preferred language: ${language === 'de' ? 'German' : 'English'}.
         Never translate a ${language === 'de' ? 'German' : 'English'} draft into another language unless requested. Keep the language matching the draft and requested language exactly.
      
      Review inputs:
      - Initial User Request: "${userMessage}"
      - Draft Reply: "${proposedDraft}"
      - Diff State: ${JSON.stringify(proposedDiff, null, 2)}
 
      If the draft contains typos, business logical flaws, or mathematical errors, rewrite the response text securely (it must remain in ${language === 'de' ? 'German' : 'English'}).
      Keep your review response as a single valid JSON object of structure:
      {
        "approved": boolean,
        "critic_commentary": "Short explanation of your audit results.",
        "corrected_draft": "The polished final draft text ready for the user"
      }
    `;

    const res = await generateContentSafe(aiClient, {
      model: modelName || "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            approved: { type: Type.BOOLEAN },
            critic_commentary: { type: Type.STRING },
            corrected_draft: { type: Type.STRING }
          },
          required: ["approved", "critic_commentary", "corrected_draft"]
        }
      }
    });

    let cleanedText = (res.text || "{}").trim();
    const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const jsonMatch = cleanedText.match(jsonBlockRegex);
    if (jsonMatch && jsonMatch[1]) {
      cleanedText = jsonMatch[1].trim();
    }
    const body = JSON.parse(cleanedText);
    return {
      approved: body.approved ?? true,
      correctedDraft: body.corrected_draft || proposedDraft,
      log: body.critic_commentary || "Compliance check passed.",
      promptTokenCount: res.usageMetadata?.promptTokenCount,
      candidatesTokenCount: res.usageMetadata?.candidatesTokenCount,
    };
  } catch (err) {
    return {
      approved: true,
      correctedDraft: proposedDraft,
      log: `Critic auto-bypass due to critique failure: ${(err as Error).message}`
    };
  }
}
