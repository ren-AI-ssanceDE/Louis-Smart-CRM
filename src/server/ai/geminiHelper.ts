import { GoogleGenAI, GenerateContentResponse, GenerateContentConfig, Content } from "@google/genai";
import { ModelUsageMetadata } from "../../types.js";
import { pool, isUsingFallback, fallbackStore } from "../db.js";

export interface UniversalToolCall {
  id?: string;
  type?: string;
  function?: {
    name: string;
    arguments: string;
  };
  function_call?: {
    name: string;
    args: Record<string, unknown>;
  };
}

/**
 * Deterministically sorts tools by name to maximize prompt cache hits.
 */
export function getDeterministicTools<T extends { name: string }>(tools: T[]): T[] {
  return [...tools].sort((a, b) => a.name.localeCompare(b.name));
}

// Auftrag 007 T4: Gemini functionCall-Parts → UniversalToolCall (reine Funktion, testbar)
export function mapGeminiFunctionCalls(
  candidates: Array<{
    content?: { parts?: Array<{ functionCall?: { name?: string; args?: Record<string, unknown> } }> };
  }>
): UniversalToolCall[] {
  const toolCalls: UniversalToolCall[] = [];
  for (const cand of candidates) {
    for (const part of cand.content?.parts || []) {
      if (part.functionCall && part.functionCall.name) {
        toolCalls.push({
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {})
          }
        });
      }
    }
  }
  return toolCalls;
}

/**
 * Robust Google GenAI wrapper to dynamically retry with stable production models
 * in case a requested model (such as experimental/preview aliases) fails with a NOT_FOUND/404 error.
 */
export async function generateContentSafe(
  aiClient: GoogleGenAI,
  params: { model: string; contents: string | string[] | Content | Content[] | unknown; config?: GenerateContentConfig }
): Promise<GenerateContentResponse> {
  const cleanModel = (params.model || '').replace(/^models\//, '').trim();
  const primaryModel = cleanModel || 'gemini-3.6-flash';

  const modelsToTry = [
    primaryModel,
    "gemini-3.6-flash",
    "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite"
  ];

  // De-duplicate maintaining initial order
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

  let lastError: unknown = null;
  for (const model of uniqueModels) {
    try {
      console.log(`[GeminiHelper] Calling generateContent with model: ${model}`);
      // Cast config and contents to the expected types for safety
      const response = await aiClient.models.generateContent({
        contents: params.contents as string | string[] | Content | Content[],
        config: params.config,
        model
      });
      return response;
    } catch (err: unknown) {
      lastError = err;
      const errMsg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      console.warn(`[GeminiHelper] Model ${model} returned error: ${errMsg}, trying next fallback...`);
    }
  }
  throw lastError;
}

/**
 * Converts generic contents payloads (string, Gemini nested objects, or flat chat lists)
 * into a standard flat message array suitable for universal LLM providers.
 */
function convertContentsToMessages(contents: unknown): Array<{ role: string; content: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string }> {
  if (!contents) return [];
  if (typeof contents === 'string') {
    return [{ role: 'user', content: contents }];
  }
  if (Array.isArray(contents)) {
    return contents.map(c => {
      let content = '';
      if (typeof c === 'string') {
        content = c;
      } else if (c && typeof c === 'object') {
        const cObj = c as Record<string, unknown>;
        if (cObj.parts) {
          content = Array.isArray(cObj.parts) 
            ? cObj.parts.map((p: unknown) => {
                if (typeof p === 'string') return p;
                if (p && typeof p === 'object') {
                  const pObj = p as Record<string, unknown>;
                  return (pObj.text as string) || '';
                }
                return '';
              }).join('\n')
            : String(cObj.parts);
        } else if (cObj.content !== undefined) {
          content = typeof cObj.content === 'string' ? cObj.content : JSON.stringify(cObj.content);
        } else if (!cObj.tool_calls) {
          content = JSON.stringify(cObj);
        }
      } else {
        content = String(c);
      }
      
      const cObj = (c && typeof c === 'object') ? (c as Record<string, unknown>) : null;
      let role = (cObj && typeof cObj.role === 'string') ? cObj.role : 'user';
      if (role === 'model') role = 'assistant';
      return { 
        role, 
        content,
        reasoning_content: cObj?.reasoning_content as string | undefined,
        tool_calls: cObj?.tool_calls as UniversalToolCall[] | undefined,
        tool_call_id: cObj?.tool_call_id as string | undefined,
        name: cObj?.name as string | undefined
      };
    });
  }
  return [{ role: 'user', content: String(contents) }];
}

/**
 * Converts Google Schema declarations into standard JSON Schema format for OpenAI/Ollama Structured Outputs.
 */
function convertGoogleSchemaToJsonSchema(googleSchema: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!googleSchema) return null;
  
  const jsonSchema: Record<string, unknown> = {};
  
  if (googleSchema.type) {
    const typeStr = String(googleSchema.type).toLowerCase();
    jsonSchema.type = typeStr;
  }
  
  if (googleSchema.description) {
    jsonSchema.description = googleSchema.description;
  }
  
  if (googleSchema.enum) {
    jsonSchema.enum = googleSchema.enum;
  }
  
  if (googleSchema.properties) {
    jsonSchema.properties = {};
    const props = googleSchema.properties as Record<string, Record<string, unknown>>;
    const targetProperties = jsonSchema.properties as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      targetProperties[key] = convertGoogleSchemaToJsonSchema(props[key]);
    }
  }
  
  if (googleSchema.items) {
    jsonSchema.items = convertGoogleSchemaToJsonSchema(googleSchema.items as Record<string, unknown>);
  }
  
  if (googleSchema.required) {
    jsonSchema.required = googleSchema.required;
  }

  if (googleSchema.nullable && jsonSchema.type) {
    if (Array.isArray(jsonSchema.type)) {
      if (!jsonSchema.type.includes("null")) {
        (jsonSchema.type as string[]).push("null");
      }
    } else {
      jsonSchema.type = [jsonSchema.type as string, "null"];
    }
  }
  
  return jsonSchema;
}

/**
 * REST fetch to local or remote Ollama API
 */
async function callOllama(
  baseUrl: string,
  model: string,
  systemInstruction: string,
  messages: Array<{ role: string; content: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string }>,
  temperature: number,
  jsonFormat: boolean,
  responseSchema?: unknown,
  tools?: unknown[],
  apiKey?: string
): Promise<{ text: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; usageMetadata?: ModelUsageMetadata }> {
  const url = `${baseUrl}/api/chat`;
  
  const formattedMessages: Array<{ role: string; content?: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string }> = [];
  if (systemInstruction) {
    formattedMessages.push({ role: 'system', content: systemInstruction });
  }
  formattedMessages.push(...messages.map(m => {
    const role = m.role === 'model' ? 'assistant' : m.role;
    const formatted: { role: string; content?: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string } = {
      role
    };
    if (m.content) formatted.content = m.content;
    if (role === 'assistant' && m.reasoning_content !== undefined) {
      formatted.reasoning_content = m.reasoning_content;
    }
    if (m.tool_calls) formatted.tool_calls = m.tool_calls;
    if (m.tool_call_id) formatted.tool_call_id = m.tool_call_id;
    if (m.name) formatted.name = m.name;
    return formatted;
  }));

  const payload: Record<string, unknown> = {
    model: model,
    messages: formattedMessages,
    stream: false,
    options: {
      temperature: temperature
    }
  };

  if (tools && tools.length > 0) {
    // Map tool schema to JSON schema
    payload.tools = tools; // we'll pass already-formatted tools
  }

  if (jsonFormat && !tools) {
    if (responseSchema) {
      const convertedSchema = convertGoogleSchemaToJsonSchema(responseSchema as Record<string, unknown> | null | undefined);
      if (convertedSchema) {
        payload.format = convertedSchema;
      } else {
        payload.format = 'json';
      }
    } else {
      payload.format = 'json';
    }
  }

  console.log(`[UniversalHelper] Forwarding request to Ollama [Model: ${model}] via: ${url}`);
  const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    reqHeaders['Authorization'] = `Bearer ${apiKey}`;
    reqHeaders['x-api-key'] = apiKey;
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(payload)
    });

    if (!res.ok && payload.format && typeof payload.format === 'object') {
      const fallbackPayload = { ...payload, format: 'json' };
      console.warn("[UniversalHelper] Ollama JSON schema failed, falling back to simple format: 'json'...");
      res = await fetch(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(fallbackPayload)
      });
    }
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    throw new Error(`Ollama Server returned HTTP ${res.status}`);
  }

  const data = await res.json() as {
    prompt_eval_count?: number;
    eval_count?: number;
    message?: {
      content?: string;
      reasoning_content?: string;
      thinking?: string;
      tool_calls?: UniversalToolCall[];
    };
  };
  const reasoningContent = data?.message?.reasoning_content ?? data?.message?.thinking ?? '';
  const promptTokenCount = data?.prompt_eval_count || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.eval_count || Math.ceil(((data?.message?.content || '') + reasoningContent).length / 4);
  const totalTokens = promptTokenCount + candidatesTokenCount;

  return {
    text: data?.message?.content || '',
    reasoning_content: reasoningContent,
    tool_calls: data?.message?.tool_calls,
    usageMetadata: {
      promptTokens: promptTokenCount,
      completionTokens: candidatesTokenCount,
      totalTokens,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      promptTokenCount,
      candidatesTokenCount
    }
  };
}

/**
 * REST fetch to OpenAI compatible Chat Completion API
 */
async function callOpenAI(
  baseUrl: string,
  model: string,
  apiKey: string,
  systemInstruction: string,
  messages: Array<{ role: string; content: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string }>,
  temperature: number,
  jsonFormat: boolean,
  responseSchema?: unknown,
  tools?: unknown[]
): Promise<{ text: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; usageMetadata?: ModelUsageMetadata }> {
  const url = `${baseUrl}/v1/chat/completions`;
  
  const formattedMessages: Array<{ role: string; content?: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string }> = [];
  if (systemInstruction) {
    formattedMessages.push({ role: 'system', content: systemInstruction });
  }
  formattedMessages.push(...messages.map(m => {
    const role = m.role === 'model' ? 'assistant' : m.role;
    const formatted: { role: string; content?: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; tool_call_id?: string; name?: string } = {
      role
    };
    if (m.content !== undefined) formatted.content = m.content;
    if (role === 'assistant') {
      formatted.reasoning_content = m.reasoning_content !== undefined ? m.reasoning_content : '';
    }
    if (m.tool_calls) formatted.tool_calls = m.tool_calls;
    if (m.tool_call_id) formatted.tool_call_id = m.tool_call_id;
    if (m.name) formatted.name = m.name;
    return formatted;
  }));

  const payload: Record<string, unknown> = {
    model: model,
    messages: formattedMessages,
    temperature: temperature
  };

  if (tools && tools.length > 0) {
    payload.tools = tools;
  }

  if (jsonFormat && !tools) {
    if (responseSchema) {
      const convertedSchema = convertGoogleSchemaToJsonSchema(responseSchema as Record<string, unknown> | null | undefined);
      if (convertedSchema) {
        payload.response_format = {
          type: "json_schema",
          json_schema: {
            name: "react_decision",
            strict: true,
            schema: convertedSchema
          }
        };
      } else {
        payload.response_format = { type: 'json_object' };
      }
    } else {
      payload.response_format = { type: 'json_object' };
    }
  }

  console.log(`[UniversalHelper] Forwarding request to OpenAI [Model: ${model}] via: ${url}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const formatObj = payload.response_format as Record<string, unknown> | undefined;
    if (!res.ok && formatObj?.type === "json_schema") {
      const clonePayload = { ...payload };
      clonePayload.response_format = { type: 'json_object' };
      console.warn("[UniversalHelper] OpenAI strict json_schema failed, falling back to simple json_object...");
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(clonePayload)
      });
    }
  } catch (err) {
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API returned HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: {
        cached_tokens?: number;
      };
    };
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
        thinking?: string;
        tool_calls?: UniversalToolCall[];
      };
    }>;
  };
  const choiceMsg = data?.choices?.[0]?.message;
  const reasoningContent = choiceMsg?.reasoning_content ?? (choiceMsg as Record<string, unknown> | undefined)?.thinking as string | undefined ?? '';
  const promptTokenCount = data?.usage?.prompt_tokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.usage?.completion_tokens || Math.ceil(((choiceMsg?.content || '') + reasoningContent).length / 4);
  const cachedTokens = data?.usage?.prompt_tokens_details?.cached_tokens || 0;
  const totalTokens = data?.usage?.total_tokens || (promptTokenCount + candidatesTokenCount);

  return {
    text: choiceMsg?.content || '',
    reasoning_content: reasoningContent,
    tool_calls: choiceMsg?.tool_calls,
    usageMetadata: {
      promptTokens: promptTokenCount,
      completionTokens: candidatesTokenCount,
      totalTokens,
      cachedInputTokens: cachedTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: cachedTokens,
      promptTokenCount,
      candidatesTokenCount
    }
  };
}

/**
 * REST fetch to Anthropic Claude messages API
 */
async function callAnthropic(
  baseUrl: string,
  model: string,
  apiKey: string,
  systemInstruction: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  tools?: Array<{ type?: string; function: { name: unknown; description: unknown; parameters: unknown } }>
): Promise<{ text: string; tool_calls?: UniversalToolCall[]; usageMetadata?: ModelUsageMetadata }> {
  const url = `${baseUrl}/v1/messages`;
  
  const formattedMessages = messages.map(m => ({
    role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content
  }));

  const payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens: number;
    temperature: number;
    system?: Array<{ type: string; text: string; cache_control?: { type: string } }>;
    tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  } = {
    model: model,
    messages: formattedMessages,
    max_tokens: 4000,
    temperature: temperature
  };

  // Anthropic-Format: tools → [{ name, description, input_schema }]
  if (tools && tools.length > 0) {
    payload.tools = tools.map((t) => ({
      name: String(t.function.name),
      description: String(t.function.description ?? ""),
      input_schema: (t.function.parameters as Record<string, unknown>) || { type: "object" }
    }));
  }

  if (systemInstruction) {
    payload.system = [
      {
        type: "text",
        text: systemInstruction,
        cache_control: { type: "ephemeral" }
      }
    ];
  }

  console.log(`[UniversalHelper] Forwarding request to Anthropic [Model: ${model}] via: ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API returned HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
  };
  const promptTokenCount = data?.usage?.input_tokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.usage?.output_tokens || Math.ceil((data?.content?.[0]?.text || '').length / 4);
  const cacheCreationTokens = data?.usage?.cache_creation_input_tokens || 0;
  const cacheReadTokens = data?.usage?.cache_read_input_tokens || 0;
  const totalTokens = promptTokenCount + candidatesTokenCount;

  // Anthropic liefert Tool-Calls als content-Blöcke vom Typ 'tool_use' → UniversalToolCall mappen
  const toolCalls: UniversalToolCall[] = (data?.content || [])
    .filter((c) => c.type === "tool_use" && c.name)
    .map((c) => ({
      id: c.id,
      type: "function",
      function: {
        name: c.name as string,
        arguments: typeof c.input === "string" ? c.input : JSON.stringify(c.input ?? {})
      }
    }));

  const text = (data?.content || [])
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text as string)
    .join("\n");

  return {
    text,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usageMetadata: {
      promptTokens: promptTokenCount,
      completionTokens: candidatesTokenCount,
      totalTokens,
      cachedInputTokens: cacheReadTokens,
      cacheCreationInputTokens: cacheCreationTokens,
      cacheReadInputTokens: cacheReadTokens,
      promptTokenCount,
      candidatesTokenCount
    }
  };
}

/**
 * Unified Multi-Provider Generation Interface.
 * Transparently orchestrates requests between Gemini, Ollama, OpenAI and Anthropic,
 * applying clean defaults and stripping browser autofill corruptions like emails.
 */
export async function generateContentUniversal({
  provider_type,
  model_name,
  api_key_secret,
  base_url,
  temperature = 0.2,
  contents,
  systemInstruction,
  responseSchema,
  jsonFormat = false,
  tools
}: {
  provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic';
  model_name: string;
  api_key_secret?: string | null;
  base_url?: string | null;
  temperature?: number;
  contents: unknown;
  systemInstruction?: string;
  responseSchema?: unknown;
  jsonFormat?: boolean;
  tools?: unknown[];
}): Promise<{ text: string; reasoning_content?: string; tool_calls?: UniversalToolCall[]; usageMetadata?: ModelUsageMetadata; usage?: ModelUsageMetadata }> {
  
  // Clean potential browser-autofill garbage in credentials
  let cleanedBaseUrl = base_url?.trim() || '';
  if (cleanedBaseUrl.includes('@')) {
    cleanedBaseUrl = '';
  }

  let cleanedApiKey = api_key_secret?.trim() || '';
  if (cleanedApiKey.includes('@') || cleanedApiKey === '******' || cleanedApiKey.startsWith('••••') || cleanedApiKey === 'undefined') {
    cleanedApiKey = '';
  }

  // Fallback for non-Gemini tools injection to systemInstruction
  let adjustedSystemInstruction = systemInstruction || '';
  
  let nativeTools: Array<{ type: string; function: { name: unknown; description: unknown; parameters: unknown } }> | undefined = undefined;
  
  if (provider_type !== 'gemini' && tools && Array.isArray(tools)) {
    nativeTools = [];
    for (const toolGroup of tools) {
      const tg = toolGroup as Record<string, unknown>;
      if (tg && Array.isArray(tg.functionDeclarations)) {
        for (const decl of tg.functionDeclarations) {
          const d = decl as Record<string, unknown>;
          let rawParams = d.parameters;
          let convertedParams: Record<string, unknown> | null = null;

          if (rawParams && typeof rawParams === 'object') {
            const paramsObj = rawParams as Record<string, unknown>;
            if (paramsObj.type === "OBJECT" || paramsObj.type === "STRING" || typeof paramsObj.type === "number") {
              convertedParams = convertGoogleSchemaToJsonSchema(paramsObj);
            } else {
              const { $schema, ...clean } = paramsObj;
              convertedParams = clean;
            }
          }

          if (!convertedParams || typeof convertedParams !== 'object') {
            convertedParams = { type: "object", properties: {} };
          }
          if (!convertedParams.type) {
            convertedParams.type = "object";
          }

          nativeTools.push({
            type: "function",
            function: {
              name: d.name,
              description: d.description,
              parameters: convertedParams
            }
          });
        }
      }
    }
  }

  // Support Gemini
  if (provider_type === 'gemini') {
    let apiKey = cleanedApiKey || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      try {
        if (isUsingFallback) {
          const list = fallbackStore.louisAiConfig || [];
          const cfg = list.find(c => c.api_key_secret) || null;
          if (cfg?.api_key_secret) {
            const candidate = cfg.api_key_secret.trim();
            if (!candidate.startsWith('••••') && candidate !== '******' && !candidate.includes('@')) {
              apiKey = candidate;
            }
          }
        } else {
          const res = await pool.query(
            "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE api_key_secret IS NOT NULL AND api_key_secret != '' LIMIT 1"
          );
          if (res.rows.length > 0 && res.rows[0].api_key_secret) {
            const candidate = String(res.rows[0].api_key_secret).trim();
            if (!candidate.startsWith('••••') && candidate !== '******' && !candidate.includes('@')) {
              apiKey = candidate;
            }
          }
        }
      } catch {
        // ignore DB lookup error
      }
    }

    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY for Gemini provider.");
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    
    const genConfig: GenerateContentConfig = {};
    if (systemInstruction) genConfig.systemInstruction = systemInstruction;
    if (temperature !== undefined) genConfig.temperature = temperature;
    if (jsonFormat || responseSchema) {
      genConfig.responseMimeType = "application/json";
      if (responseSchema) {
        // Cast since actual schema matches expected Shape
        genConfig.responseSchema = responseSchema as GenerateContentConfig['responseSchema'];
      }
    }
    if (tools) {
      genConfig.tools = tools as GenerateContentConfig['tools'];
    }

    let modelToUse = model_name;
    if (!modelToUse) {
      modelToUse = 'gemini-3.6-flash';
    }

    const res = await generateContentSafe(ai, {
      model: modelToUse,
      contents: contents,
      config: genConfig
    });

    const promptTokens = res.usageMetadata?.promptTokenCount || 0;
    const completionTokens = res.usageMetadata?.candidatesTokenCount || 0;
    const cachedTokens = (res.usageMetadata as { cachedContentTokenCount?: number } | undefined)?.cachedContentTokenCount || 0;
    const totalTokens = res.usageMetadata?.totalTokenCount || (promptTokens + completionTokens);

    const usage: ModelUsageMetadata = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedInputTokens: cachedTokens,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: cachedTokens,
      promptTokenCount: promptTokens,
      candidatesTokenCount: completionTokens
    };

    // Auftrag 007 T4: Gemini functionCall-Parts → UniversalToolCall mappen
    // (Gemini liefert Tool-Aufrufe nicht als Text, sondern als functionCall-Blöcke)
    const toolCalls = mapGeminiFunctionCalls(
      (res.candidates || []) as Array<{
        content?: { parts?: Array<{ functionCall?: { name?: string; args?: Record<string, unknown> } }> };
      }>
    );

    return {
      text: res.text || '',
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usageMetadata: usage,
      usage: usage
    };
  }

  // Support Ollama
  if (provider_type === 'ollama') {
    let u = cleanedBaseUrl || 'http://localhost:11434';
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `http://${u}`;
    }
    const m = model_name || 'llama3';
    const messages = convertContentsToMessages(contents);

    return await callOllama(
      u,
      m,
      adjustedSystemInstruction,
      messages,
      temperature,
      jsonFormat || !!responseSchema,
      responseSchema,
      nativeTools,
      cleanedApiKey
    );
  }

  // Support OpenAI
  if (provider_type === 'openai') {
    let u = cleanedBaseUrl || 'https://api.openai.com';
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    const apiKey = cleanedApiKey || process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      throw new Error("Kein OpenAI API-Schlüssel konfiguriert.");
    }
    const m = model_name || 'gpt-4o-mini';
    const messages = convertContentsToMessages(contents);

    return await callOpenAI(
      u,
      m,
      apiKey,
      adjustedSystemInstruction,
      messages,
      temperature,
      jsonFormat || !!responseSchema,
      responseSchema,
      nativeTools
    );
  }

  // Support Anthropic
  if (provider_type === 'anthropic') {
    let u = cleanedBaseUrl || 'https://api.anthropic.com';
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    const apiKey = cleanedApiKey || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      throw new Error("Kein Anthropic API-Schlüssel konfiguriert.");
    }
    const m = model_name || 'claude-3-5-sonnet-latest';
    const messages = convertContentsToMessages(contents);

    return await callAnthropic(
      u,
      m,
      apiKey,
      adjustedSystemInstruction,
      messages,
      temperature,
      nativeTools
    );
  }

  throw new Error(`Unbekannter KI Provider: ${provider_type}`);
}
