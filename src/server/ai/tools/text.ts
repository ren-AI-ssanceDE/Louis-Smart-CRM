import { GoogleGenAI } from "@google/genai";
import { generateContentUniversal } from "../geminiHelper.js";
import { pool, isUsingFallback, fallbackStore } from "../../db.js";

/**
 * Tool 8: Text Generator Tool
 * Fully configurable writing engine designed for content and template editing
 */
export async function executeTextGenerator(tenantId: string, instruction: string, aiClient?: GoogleGenAI): Promise<string> {
  let providerType: 'gemini' | 'ollama' | 'openai' | 'anthropic' = 'gemini';
  let modelToUse = "gemini-3.5-flash";
  let apiKeySecret = "";
  let baseUrl = "";

  // Load provider setup from Louis AI Configuration
  try {
    if (isUsingFallback) {
      const found = (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === tenantId) || (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === '1');
      if (found) {
        if (found.provider_type) providerType = found.provider_type;
        if (found.model_name) modelToUse = found.model_name;
        if (found.api_key_secret) apiKeySecret = found.api_key_secret.trim();
        if (found.base_url) baseUrl = found.base_url.trim();
      }
    } else {
      const res = await pool.query(
        "SELECT provider_type, model_name, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (row.provider_type) providerType = row.provider_type;
        if (row.model_name) modelToUse = row.model_name;
        if (row.api_key_secret) apiKeySecret = row.api_key_secret.trim();
        if (row.base_url) baseUrl = row.base_url.trim();
      }
    }
  } catch (err) {
    console.warn("Failed to load provider configuration in executeTextGenerator:", err);
  }
  // Load custom template writing configuration
  let systemPrompt = "Du bist eine hochentwickelte Text-Schreib-KI für das Louis Smart CRM-System. Schreibe den angeforderten Text elegant, präzise und fehlerfrei. Benutze professionelle Formulierungen und folge exakt den Anweisungen. Wenn Platzhalter (wie {{invoice_number}}, {{my_company_name}}, etc.) im Ausgangstext oder Kontext vorkommen, übernehme und erhalte sie exakt so, wie sie definiert sind.";
  let temp = 0.7;
  let maxTokens = 2000;

  try {
    if (isUsingFallback) {
      const list = fallbackStore.textGeneratorConfig || [];
      const found = list.find((c: any) => c.tenant_id === tenantId) || list.find((c: any) => c.tenant_id === '1');
      if (found) {
        if (found.system_prompt) systemPrompt = found.system_prompt;
        if (found.temperature !== undefined) temp = found.temperature;
        if (found.max_tokens !== undefined) maxTokens = found.max_tokens;
      }
    } else {
      const res = await pool.query(
        "SELECT system_prompt, temperature, max_tokens FROM sys_integrations_text_generator_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (row.system_prompt) systemPrompt = row.system_prompt;
        if (row.temperature !== undefined) temp = row.temperature;
        if (row.max_tokens !== undefined) maxTokens = row.max_tokens;
      }
    }
  } catch (err) {
    console.warn("Failed to load text generator config, using defaults:", err);
  }

  try {
    const res = await generateContentUniversal({
      provider_type: providerType,
      model_name: modelToUse,
      api_key_secret: apiKeySecret,
      base_url: baseUrl,
      temperature: temp,
      contents: instruction,
      systemInstruction: systemPrompt
    });

    return res.text || "Kein Text generiert.";
  } catch (err) {
    return `Text-Generierung fehlgeschlagen: ${(err as Error).message}`;
  }
}
