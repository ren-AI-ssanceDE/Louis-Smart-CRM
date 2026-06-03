import { GoogleGenAI, GenerateContentResponse, GenerateContentConfig, Content } from "@google/genai";
import { ModelUsageMetadata } from "../../types.js";

/**
 * Robust Google GenAI wrapper to dynamically retry with stable production models
 * in case a requested model (such as experimental/preview aliases) fails with a NOT_FOUND/404 error.
 */
export async function generateContentSafe(
  aiClient: GoogleGenAI,
  params: { model: string; contents: string | string[] | Content | Content[] | unknown; config?: GenerateContentConfig }
): Promise<GenerateContentResponse> {
  const modelsToTry = [
    params.model,
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-1.5-flash"
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
      
      // If the error indicates a model is missing/unsupported/not-found, fall back gracefully
      if (
        errMsg.includes("404") ||
        errMsg.includes("not found") ||
        errMsg.includes("not_found") ||
        errMsg.includes("unrecognized") ||
        errMsg.includes("not recognized") ||
        errMsg.includes("not supported") ||
        errMsg.includes("sentinel")
      ) {
        console.warn(`[GeminiHelper] Model ${model} returned routing/404 error, trying fallback...`);
        continue;
      }
      
      // For any other error (such as actual invalid key or billing block), propagate immediately
      throw err;
    }
  }
  throw lastError;
}

/**
 * Converts generic contents payloads (string, Gemini nested objects, or flat chat lists)
 * into a standard flat message array suitable for universal LLM providers.
 */
function convertContentsToMessages(contents: unknown): Array<{ role: string; content: string }> {
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
        } else if (cObj.content) {
          content = typeof cObj.content === 'string' ? cObj.content : JSON.stringify(cObj.content);
        } else {
          content = JSON.stringify(cObj);
        }
      } else {
        content = String(c);
      }
      
      const cObj = (c && typeof c === 'object') ? (c as Record<string, unknown>) : null;
      let role = (cObj && typeof cObj.role === 'string') ? cObj.role : 'user';
      if (role === 'model') role = 'assistant';
      return { role, content };
    });
  }
  return [{ role: 'user', content: String(contents) }];
}

/**
 * REST fetch to local or remote Ollama API
 */
async function callOllama(
  baseUrl: string,
  model: string,
  systemInstruction: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  jsonFormat: boolean
): Promise<{ text: string; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } }> {
  const url = `${baseUrl}/api/chat`;
  
  const formattedMessages: Array<{ role: string; content: string }> = [];
  if (systemInstruction) {
    formattedMessages.push({ role: 'system', content: systemInstruction });
  }
  formattedMessages.push(...messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.content
  })));

  const payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    stream: boolean;
    options: {
      temperature: number;
    };
    format?: 'json';
  } = {
    model: model,
    messages: formattedMessages,
    stream: false,
    options: {
      temperature: temperature
    }
  };

  if (jsonFormat) {
    payload.format = 'json';
  }

  console.log(`[UniversalHelper] Forwarding request to Ollama [Model: ${model}] via: ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`Ollama Server returned HTTP ${res.status}`);
  }

  const data = await res.json() as {
    prompt_eval_count?: number;
    eval_count?: number;
    message?: {
      content?: string;
    };
  };
  const promptTokenCount = data?.prompt_eval_count || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.eval_count || Math.ceil((data?.message?.content || '').length / 4);

  return {
    text: data?.message?.content || '',
    usageMetadata: {
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
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  jsonFormat: boolean
): Promise<{ text: string; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } }> {
  const url = `${baseUrl}/v1/chat/completions`;
  
  const formattedMessages: Array<{ role: string; content: string }> = [];
  if (systemInstruction) {
    formattedMessages.push({ role: 'system', content: systemInstruction });
  }
  formattedMessages.push(...messages.map(m => ({
    role: m.role === 'model' ? 'assistant' : m.role,
    content: m.content
  })));

  const payload: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    response_format?: { type: 'json_object' };
  } = {
    model: model,
    messages: formattedMessages,
    temperature: temperature
  };

  if (jsonFormat) {
    payload.response_format = { type: 'json_object' };
  }

  console.log(`[UniversalHelper] Forwarding request to OpenAI [Model: ${model}] via: ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API returned HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json() as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const promptTokenCount = data?.usage?.prompt_tokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.usage?.completion_tokens || Math.ceil((data?.choices?.[0]?.message?.content || '').length / 4);

  return {
    text: data?.choices?.[0]?.message?.content || '',
    usageMetadata: {
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
  temperature: number
): Promise<{ text: string; usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number } }> {
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
    system?: string;
  } = {
    model: model,
    messages: formattedMessages,
    max_tokens: 4000,
    temperature: temperature
  };

  if (systemInstruction) {
    payload.system = systemInstruction;
  }

  console.log(`[UniversalHelper] Forwarding request to Anthropic [Model: ${model}] via: ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
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
    };
    content?: Array<{
      text?: string;
    }>;
  };
  const promptTokenCount = data?.usage?.input_tokens || Math.ceil(JSON.stringify(formattedMessages).length / 4);
  const candidatesTokenCount = data?.usage?.output_tokens || Math.ceil((data?.content?.[0]?.text || '').length / 4);

  return {
    text: data?.content?.[0]?.text || '',
    usageMetadata: {
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
}): Promise<{ text: string; usageMetadata?: ModelUsageMetadata }> {
  
  // Clean potential browser-autofill garbage in credentials
  let cleanedBaseUrl = base_url?.trim() || '';
  if (cleanedBaseUrl.includes('@')) {
    cleanedBaseUrl = '';
  }

  let cleanedApiKey = api_key_secret?.trim() || '';
  if (cleanedApiKey.includes('@') || cleanedApiKey === '******') {
    cleanedApiKey = '';
  }

  // Support Gemini
  if (provider_type === 'gemini') {
    const apiKey = cleanedApiKey;
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

    const res = await generateContentSafe(ai, {
      model: model_name || "gemini-3.5-flash",
      contents: contents,
      config: genConfig
    });

    return {
      text: res.text || '',
      usageMetadata: res.usageMetadata as ModelUsageMetadata
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
      systemInstruction || '',
      messages,
      temperature,
      jsonFormat || !!responseSchema
    );
  }

  // Support OpenAI
  if (provider_type === 'openai') {
    let u = cleanedBaseUrl || 'https://api.openai.com';
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    const apiKey = cleanedApiKey;
    if (!apiKey) {
      throw new Error("Kein OpenAI API-Schlüssel konfiguriert.");
    }
    const m = model_name || 'gpt-4o-mini';
    const messages = convertContentsToMessages(contents);

    return await callOpenAI(
      u,
      m,
      apiKey,
      systemInstruction || '',
      messages,
      temperature,
      jsonFormat || !!responseSchema
    );
  }

  // Support Anthropic
  if (provider_type === 'anthropic') {
    let u = cleanedBaseUrl || 'https://api.anthropic.com';
    if (!u.startsWith('http://') && !u.startsWith('https://')) {
      u = `https://${u}`;
    }
    const apiKey = cleanedApiKey;
    if (!apiKey) {
      throw new Error("Kein Anthropic API-Schlüssel konfiguriert.");
    }
    const m = model_name || 'claude-3-5-sonnet-latest';
    const messages = convertContentsToMessages(contents);

    return await callAnthropic(
      u,
      m,
      apiKey,
      systemInstruction || '',
      messages,
      temperature
    );
  }

  throw new Error(`Unbekannter KI Provider: ${provider_type}`);
}
