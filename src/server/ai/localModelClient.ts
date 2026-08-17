// src/server/ai/localModelClient.ts

import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { GoogleGenAI } from "@google/genai";
import { generateContentUniversal } from "./geminiHelper.js";
import { executeLocalKnowledgeSearch } from "./tools/knowledge.js";
import { LouisAiConfig } from "../../types.js";
import { InferenzProviderType, InferenceMessage, InferenceResultPayload } from "../../types/inference.js";

interface IInferenceOptions {
  modelOverride?: string;
  jsonFormat?: boolean;
  systemInstruction?: string;
  queryForRag?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  messages?: InferenceMessage[];
}

export class LocalModelClient {
  /**
   * Loads the Louis AI integration config dynamically.
   */
  private async getLouisAiConfig(tenantId: string): Promise<LouisAiConfig> {
    const defaultConfig: LouisAiConfig = {
      tenant_id: tenantId,
      provider_type: 'gemini',
      model_name: '',
      temperature: 0.2,
      top_p: 0.9,
      top_k: 40,
      num_ctx: 8192
    };

    try {
      if (isUsingFallback) {
        const list = (fallbackStore.louisAiConfig as LouisAiConfig[] || []);
        const found = list.find((c) => c.tenant_id === tenantId) || 
                      list.find((c) => c.tenant_id === '1');
        if (found) {
          return found;
        }
      } else {
        const res = await pool.query(
          "SELECT provider_type, model_name, api_key_secret, base_url, temperature, top_p, top_k, num_ctx FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
          [tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            tenant_id: tenantId,
            provider_type: row.provider_type as 'gemini' | 'ollama' | 'openai' | 'anthropic',
            model_name: row.model_name,
            api_key_secret: row.api_key_secret,
            base_url: row.base_url,
            temperature: row.temperature || 0.2,
            top_p: row.top_p || 0.9,
            top_k: row.top_k || 40,
            num_ctx: row.num_ctx || 8192
          };
        }
      }
    } catch (err) {
      console.warn("[LocalModelClient] Failed to load provider configuration, using system defaults:", err);
    }
    return defaultConfig;
  }

  /**
   * Executes model-agnostic inference with dynamic routing, grammar/json enforcement, and RAG mitigation.
   */
  public async executeInference(
    tenantId: string,
    prompt: string,
    options: IInferenceOptions = {}
  ): Promise<InferenceResultPayload> {
    const config = await this.getLouisAiConfig(tenantId);
    
    // 1. Local RAG Fact Pulling (Section 1.3 of Architektur-Plan) - SOTA Structured XML
    let systemInstruction = options.systemInstruction || "Du bist LOUIS, ein präziser CRM-Assistent. Antworte exakt auf Basis der Instruktionen.";
    
    if (options.queryForRag) {
      try {
        console.log(`[LocalModelClient] Running Local RAG retrieval for: "${options.queryForRag}"`);
        const ragRes = await executeLocalKnowledgeSearch(tenantId, options.queryForRag);
        const ragText = (ragRes.data?.message as string) || (ragRes.error ? "" : JSON.stringify(ragRes.data || {}));
        if (ragRes.success && ragText && !ragText.includes("No matching local knowledge files")) {
          // Append RAG Context to System Instruction (KV-Cache Optimization)
          systemInstruction += `\n<context>\n${ragText}\n</context>\nInstruktion: Antworte ausschließlich auf Basis der bereitgestellten FAKTEN. Wenn die FAKTEN keine Antwort erlauben, deklariere dies mit MIS_FACTS.`;
        }
      } catch (ragErr) {
        console.warn("[LocalModelClient] RAG step failed or skipped:", ragErr);
      }
    }

    const provider: 'gemini' | 'ollama' | 'openai' | 'anthropic' = config.provider_type || 'ollama';
    const model = options.modelOverride || config.model_name || 'llama3';
    const temp = options.temperature ?? config.temperature ?? 0.2;
    const isJson = !!options.jsonFormat;

    console.log(`[LocalModelClient] Routing inference to [Provider: ${provider}] [Model: ${model}] [JSON: ${isJson}]`);

    if (isJson && !options.tools) {
      systemInstruction += "\nIMPORTANT: Your response must be valid JSON matching the requested schema. Do not output markdown backticks or conversational explanations outside the JSON.";
    }

    let resultPayload: InferenceResultPayload;

    try {
      const response = await generateContentUniversal({
        provider_type: provider,
        model_name: model,
        api_key_secret: config.api_key_secret,
        base_url: config.base_url,
        temperature: temp,
        contents: options.messages ? options.messages : prompt,
        systemInstruction,
        jsonFormat: isJson,
        tools: options.tools
      });

      resultPayload = response;
    } catch (apiErr) {
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
      console.error(`[LocalModelClient] Primary API routing failed: ${errMsg}`);
      throw apiErr;
    }

    // Return the full response object to support tool_calls checking in Orchestrator
    return resultPayload;
  }
}

export const localModelClient = new LocalModelClient();
