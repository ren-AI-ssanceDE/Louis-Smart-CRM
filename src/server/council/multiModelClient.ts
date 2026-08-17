import { generateContentUniversal } from "../ai/geminiHelper.js";
import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { CouncilProvider, LouisAiConfig, CouncilFallbackMetadata, ModelUsageMetadata } from "../../types.js";

interface ProviderHealthStatus {
  isHealthy: boolean;
  lastFailureTime: number;
  failureCount: number;
  lastError?: string;
}

class ProviderHealthTracker {
  private static statusMap = new Map<string, ProviderHealthStatus>();
  private static COOLDOWN_MS = 15000; // 15 Sek Cooldown nach Fehlversuchen

  static isAvailable(providerId: string): boolean {
    const status = this.statusMap.get(providerId);
    if (!status) return true;
    if (status.isHealthy) return true;

    // Prüfe Cooldown-Ablauf
    if (Date.now() - status.lastFailureTime > this.COOLDOWN_MS) {
      status.isHealthy = true;
      status.failureCount = 0;
      return true;
    }
    return false;
  }

  static recordSuccess(providerId: string): void {
    this.statusMap.set(providerId, { isHealthy: true, lastFailureTime: 0, failureCount: 0 });
  }

  static recordFailure(providerId: string, errorMsg: string): void {
    const current = this.statusMap.get(providerId) || { isHealthy: true, lastFailureTime: 0, failureCount: 0 };
    const failureCount = current.failureCount + 1;
    // Erhöhe Schwelle auf 5, damit parallele Anfragen nicht sofort gesperrt werden
    const isHealthy = failureCount < 5;

    this.statusMap.set(providerId, {
      isHealthy,
      lastFailureTime: Date.now(),
      failureCount,
      lastError: errorMsg
    });
  }
}

export interface CallCouncilModelResult {
  text: string;
  metadata: CouncilFallbackMetadata;
  usage?: ModelUsageMetadata;
}

function sanitizeApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed || trimmed === '******' || trimmed.startsWith('••••') || trimmed.includes('@') || trimmed === 'undefined') {
    return null;
  }
  return trimmed;
}

export async function callCouncilModelResilient(params: {
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  tenantId: string;
  participantName?: string;
}): Promise<CallCouncilModelResult> {
  const originalProviderId = params.providerId;
  const originalModelId = params.modelId;

  const isSpecificCouncilProvider = !!originalProviderId && originalProviderId !== 'louis-chat';

  // Stufe 1: Primärversuch mit dem spezifischen Council-Provider (falls konfiguriert)
  if (isSpecificCouncilProvider && ProviderHealthTracker.isAvailable(originalProviderId)) {
    try {
      const internalRes = await executeWithTimeout(
        () => callCouncilModelInternal({ ...params }),
        45000 // 45 Sek Timeout für Council Provider
      );
      ProviderHealthTracker.recordSuccess(originalProviderId);
      return {
        text: internalRes.text,
        usage: internalRes.usage,
        metadata: {
          usedFallback: false,
          originalProviderId,
          originalModelId,
          actualProviderId: originalProviderId,
          actualModelId: originalModelId,
          isDegraded: false
        }
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Council Resilience] Primärer Provider '${originalProviderId}' fehlgeschlagen: ${errorMsg}. Nutze Louis AI Fallback...`);
      ProviderHealthTracker.recordFailure(originalProviderId, errorMsg);
    }
  }

  // Stufe 2: Fallback auf Louis AI Konfiguration (oder direkter Aufruf, falls kein Council-Provider eingestellt)
  console.info(`[Council Resilience] Führe Aufruf über die Louis AI Konfiguration aus...`);
  try {
    const internalRes = await executeWithTimeout(
      () => callCouncilModelInternal({
        ...params,
        providerId: 'louis-chat',
        modelId: ''
      }),
      45000 // 45 Sek Timeout
    );

    return {
      text: internalRes.text,
      usage: internalRes.usage,
      metadata: {
        usedFallback: isSpecificCouncilProvider,
        originalProviderId,
        originalModelId,
        actualProviderId: 'louis-chat',
        actualModelId: 'louis-ai-configured',
        fallbackReason: isSpecificCouncilProvider
          ? `Primärer Council-Provider (${originalProviderId}) fehlgeschlagen. Fallback auf Louis AI Konfiguration.`
          : undefined,
        isDegraded: isSpecificCouncilProvider
      }
    };
  } catch (fallbackErr) {
    const errorMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    console.error(`[Council Resilience] Aufruf über Louis AI Konfiguration fehlgeschlagen: ${errorMsg}`);
    return {
      text: `[Hinweis: Der konfigurierte LLM-Provider konnte nicht rechtzeitig antworten (${errorMsg}). Bitte überprüfen Sie die Provider-Einstellungen.]`,
      metadata: {
        usedFallback: true,
        originalProviderId,
        originalModelId,
        actualProviderId: 'error-timeout',
        actualModelId: 'timeout-fallback',
        fallbackReason: `Aufruf fehlgeschlagen: ${errorMsg}`,
        isDegraded: true
      }
    };
  }
}

async function executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout nach ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

async function callCouncilModelInternal(params: {
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  tenantId: string;
}): Promise<{ text: string; usage?: ModelUsageMetadata }> {
  let providerType: 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'custom' = 'gemini';
  let apiKey: string | null = null;
  let baseUrl: string | null = null;
  let modelName = params.modelId;

  if (params.providerId === 'louis-chat') {
    let config: LouisAiConfig | null = null;
    if (isUsingFallback) {
      const list = fallbackStore.louisAiConfig || [];
      config = list.find(c => c.tenant_id === params.tenantId) || list.find(c => c.tenant_id === '1') || null;
    } else {
      const res = await pool.query(
        "SELECT provider_type, api_key_secret, base_url, model_name FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [params.tenantId]
      );
      if (res.rows.length > 0) {
        config = {
          provider_type: res.rows[0].provider_type,
          api_key_secret: res.rows[0].api_key_secret,
          base_url: res.rows[0].base_url,
          model_name: res.rows[0].model_name,
        } as LouisAiConfig;
      }
    }

    if (!config) {
      providerType = 'gemini';
      apiKey = process.env.GEMINI_API_KEY || null;
      baseUrl = null;
      modelName = params.modelId || '';
    } else {
      providerType = (config.provider_type as 'gemini' | 'ollama' | 'openai' | 'anthropic') || 'gemini';
      apiKey = sanitizeApiKey(config.api_key_secret);
      baseUrl = config.base_url || null;
      if (!modelName) {
        modelName = config.model_name;
      }
    }
  } else {
    let providers: CouncilProvider[] = [];
    if (isUsingFallback) {
      providers = fallbackStore.councilSettings?.providers || [];
    } else {
      const res = await pool.query(
        "SELECT settings_json FROM council_settings WHERE tenant_id = $1 LIMIT 1",
        [params.tenantId]
      );
      if (res.rows.length > 0) {
        providers = res.rows[0].settings_json?.providers || [];
      }
    }

    const p = providers.find(prov => prov.id_uuid === params.providerId);
    if (!p) {
      console.warn(`[Council Client] Provider ${params.providerId} nicht in Council-Settings gefunden. Verwende Louis AI Provider.`);
      return callCouncilModelInternal({ ...params, providerId: 'louis-chat' });
    }

    providerType = p.provider_type;
    apiKey = sanitizeApiKey(p.api_key_secret);
    baseUrl = p.base_url || null;
  }

  let mappedProvider = providerType;
  if (providerType === 'openrouter' || providerType === 'custom') {
    mappedProvider = 'openai';
    if (providerType === 'openrouter' && !baseUrl) {
      baseUrl = 'https://openrouter.ai/api/v1';
    }
  }

  if (!apiKey) {
    if (mappedProvider === 'gemini') apiKey = process.env.GEMINI_API_KEY || null;
    else if (mappedProvider === 'openai') apiKey = process.env.OPENAI_API_KEY || null;
    else if (mappedProvider === 'anthropic') apiKey = process.env.ANTHROPIC_API_KEY || null;
  }

  // Model Name Normalisierung (ohne hardgecodete Umschreibungen)
  if (mappedProvider === 'gemini' && modelName) {
    modelName = modelName.replace(/^models\//, '').trim();
  }

  try {
    const res = await generateContentUniversal({
      provider_type: mappedProvider as 'gemini' | 'ollama' | 'openai' | 'anthropic',
      api_key_secret: apiKey,
      base_url: baseUrl,
      model_name: modelName,
      temperature: params.temperature,
      contents: params.userPrompt,
      systemInstruction: params.systemPrompt
    });
    return {
      text: res.text,
      usage: res.usageMetadata || res.usage
    };
  } catch (primaryErr) {
    const errStr = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    console.warn(`[Council Model Internal] Aufruf für Provider '${mappedProvider}' (Modell: ${modelName}) fehlgeschlagen: ${errStr}`);
    throw primaryErr;
  }
}

export async function callCouncilModel(params: {
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  tenantId: string;
}): Promise<string> {
  const result = await callCouncilModelResilient(params);
  return result.text;
}
