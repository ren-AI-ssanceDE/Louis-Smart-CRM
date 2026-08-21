import React, { useEffect, useState, useRef } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { Brain, Save, Shield, Settings, Info, Trash2, Edit2, Plus, Check, X, FileText, UploadCloud, ChevronDown, ChevronUp, Sparkles, Loader2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KnowledgeFile, ChatNote, Company, Contact } from '../../types';
import { cn } from '../../lib/utils';

const TextGeneratorSettingsPanel = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { data: textGenConfig, isLoading, refetch } = trpc.getTextGeneratorConfig.useQuery();
  const saveTextGeneratorMutation = trpc.saveTextGeneratorConfig.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_text_gen', { defaultValue: 'Text-Generator-Einstellungen erfolgreich aktualisiert!' }));
      refetch();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_text_gen', { defaultValue: 'Fehler beim Speichern der Text-Generator-Einstellungen: ' }) + err.message);
    }
  });

  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [modelName, setModelName] = useState('llama3');

  useEffect(() => {
    if (textGenConfig) {
      setSystemPrompt(textGenConfig.system_prompt || '');
      setTemperature(textGenConfig.temperature ?? 0.7);
      setMaxTokens(textGenConfig.max_tokens ?? 2000);
      setModelName(textGenConfig.model_name || 'llama3');
    }
  }, [textGenConfig]);

  const handleSave = () => {
    saveTextGeneratorMutation.mutate({
      system_prompt: systemPrompt,
      temperature,
      max_tokens: maxTokens,
      model_name: modelName
    });
  };

  if (isLoading) {
    return (
      <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 flex justify-center items-center py-12">
        <div className="w-6 h-6 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 mt-6 space-y-6">
      <div className="flex items-center gap-4 border-b border-white/5 pb-3">
        <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
          <Sparkles size={20} />
        </div>
        <div>
          <h4 className="text-sm font-black text-white uppercase tracking-wider font-display">{t('admin:ai_settings.text_gen_title')}</h4>
          <p className="text-[11px] text-slate-500 font-sans mt-0.5">{t('admin:ai_settings.text_gen_desc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.system_instructions_label')}</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500/40 transition-all font-sans leading-relaxed"
            placeholder={t('admin:ai_settings.system_instructions_placeholder')}
          />
          <p className="text-[11px] text-slate-400 font-mono italic">{t('admin:ai_settings.system_instructions_desc')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Temperature Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center bg-transparent">
              <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.creativity_label')}</label>
              <span className="text-xs font-bold font-mono text-emerald-400">{temperature}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full h-1 bg-primary-dark rounded-lg appearance-none cursor-pointer accent-emerald-500"
            />
            <p className="text-[11px] text-slate-400 font-mono">{t('admin:ai_settings.creativity_desc')}</p>
          </div>

          {/* Max Tokens */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.max_tokens_label')}</label>
            <input
              type="number"
              min="100"
              max="16000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2000)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/40 transition-all font-sans"
            />
            <p className="text-[11px] text-slate-400 font-mono">{t('admin:ai_settings.max_tokens_desc')}</p>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveTextGeneratorMutation.isPending}
            className="bg-gradient-to-tr from-emerald-500 to-emerald-600 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            {saveTextGeneratorMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check size={14} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

const STTSettingsPanel = () => {
  const { t } = useTranslation(['admin', 'common', 'validation_errors']);
  const { data: sttConfig, isLoading, refetch } = trpc.getSTTSettings.useQuery();
  const saveSTTMutation = trpc.saveSTTSettings.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_stt', { defaultValue: 'Speech-to-Text-Einstellungen erfolgreich aktualisiert!' }));
      refetch();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_stt', { defaultValue: 'Fehler beim Speichern der Speech-to-Text-Einstellungen: ' }) + err.message);
    }
  });

  const [sttProvider, setSttProvider] = useState<'disabled' | 'local-whisper' | 'openai-whisper'>('disabled');
  const [sttEndpoint, setSttEndpoint] = useState('http://localhost:8000/v1/audio/transcriptions');
  const [sttApiKey, setSttApiKey] = useState('');
  const [sttModel, setSttModel] = useState('whisper-1');
  const [sttLanguage, setSttLanguage] = useState('de');
  const [sttPrompt, setSttPrompt] = useState(t('admin:ai_settings.stt_prompt_placeholder', { defaultValue: 'Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices' }));
  const [sttDevice, setSttDevice] = useState<'auto' | 'cpu' | 'cuda'>('auto');
  const [sttQuantization, setSttQuantization] = useState<'none' | 'float16' | 'int8' | 'int8_float16'>('none');
  const [sttUnloadLlmOnDemand, setSttUnloadLlmOnDemand] = useState(false);
  const [sttFallbackOnCpu, setSttFallbackOnCpu] = useState(false);
  const [isSubmitAttempted, setIsSubmitAttempted] = useState(false);

  useEffect(() => {
    if (sttConfig) {
      setSttProvider(sttConfig.stt_provider);
      setSttEndpoint(sttConfig.stt_endpoint || 'http://localhost:8000/v1/audio/transcriptions');
      setSttApiKey(sttConfig.stt_api_key || '');
      setSttModel(sttConfig.stt_model || 'whisper-1');
      setSttLanguage(sttConfig.stt_language || 'de');
      setSttPrompt(sttConfig.stt_prompt || t('admin:ai_settings.stt_prompt_placeholder', { defaultValue: 'Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices' }));
      setSttDevice(sttConfig.stt_device || 'auto');
      setSttQuantization(sttConfig.stt_quantization || 'none');
      setSttUnloadLlmOnDemand(sttConfig.stt_unload_llm_on_demand ?? false);
      setSttFallbackOnCpu(sttConfig.stt_fallback_on_cpu ?? false);
      setIsSubmitAttempted(false);
    }
  }, [sttConfig]);

  const handleSave = () => {
    if (sttProvider !== 'disabled' && (!sttModel.trim() || !sttEndpoint.trim())) {
      setIsSubmitAttempted(true);
      toast.error(t('validation_errors:please_fill_required_fields', { defaultValue: 'Bitte füllen Sie alle Pflichtfelder aus.' }));
      return;
    }

    setIsSubmitAttempted(false);
    saveSTTMutation.mutate({
      stt_provider: sttProvider,
      stt_endpoint: sttEndpoint,
      stt_api_key: sttApiKey || null,
      stt_model: sttModel,
      stt_language: sttLanguage,
      stt_prompt: sttPrompt,
      stt_device: sttDevice,
      stt_quantization: sttQuantization,
      stt_unload_llm_on_demand: sttUnloadLlmOnDemand,
      stt_fallback_on_cpu: sttFallbackOnCpu
    });
  };

  if (isLoading) {
    return (
      <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 flex justify-center items-center py-12">
        <div className="w-6 h-6 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 mt-6 space-y-6 relative overflow-hidden">
      <div className="flex items-center gap-4 border-b border-white/5 pb-3">
        <div className="p-3 bg-violet-500/10 rounded-xl border border-violet-500/20 text-violet-400">
          <Brain size={20} />
        </div>
        <div>
          <h4 className="text-sm font-black text-white uppercase tracking-wider font-display">🎙️ {sttProvider !== 'disabled' ? t('admin:ai_settings.stt_active_label', { defaultValue: 'Speech-to-Text (STT) aktiv' }) : 'Speech-to-Text (STT)'}</h4>
          <p className="text-[11px] text-slate-500 font-sans mt-0.5">{t('admin:ai_settings.stt_desc', { defaultValue: 'Verwalten Sie die Einstellungen für lokale oder Cloud-basierte Spracherkennungsmodelle (Whisper).' })}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_provider_label', { defaultValue: 'STT Provider' })}</label>
            <select
              value={sttProvider}
              onChange={(e) => {
                const val = e.target.value as 'disabled' | 'local-whisper' | 'openai-whisper';
                setSttProvider(val);
                if (val === 'openai-whisper') {
                  setSttModel('whisper-1');
                  setSttEndpoint('https://api.openai.com/v1/audio/transcriptions');
                } else if (val === 'local-whisper') {
                  setSttModel('faster-whisper-large-v3');
                  setSttEndpoint('http://localhost:8000/v1/audio/transcriptions');
                }
              }}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-sans"
            >
              <option value="disabled">{t('admin:ai_settings.stt_disabled', { defaultValue: 'Deaktiviert' })}</option>
              <option value="local-whisper">{t('admin:ai_settings.stt_local_whisper', { defaultValue: 'Local Whisper (faster-whisper / local-only)' })}</option>
              <option value="openai-whisper">{t('admin:ai_settings.stt_openai_whisper', { defaultValue: 'OpenAI Whisper Cloud API' })}</option>
            </select>
          </div>

          {/* Model Name */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_model_label', { defaultValue: 'Modellname' })}</label>
            <input
              type="text"
              required
              disabled={sttProvider === 'disabled'}
              value={sttModel}
              onChange={(e) => setSttModel(e.target.value)}
              className={cn(
                "w-full bg-primary-dark border rounded-xl px-4 py-3 text-xs text-white focus:outline-none transition-all font-mono disabled:opacity-50",
                isSubmitAttempted && !sttModel.trim()
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/5 focus:border-violet-500/40"
              )}
              placeholder={t('admin:ai_settings.stt_model_placeholder', { defaultValue: 'e.g. faster-whisper-large-v3, whisper-1' })}
            />
          </div>

          {/* Connection Endpoint */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_endpoint_label', { defaultValue: 'Endpoint-URL' })}</label>
            <input
              type="text"
              required
              disabled={sttProvider === 'disabled'}
              value={sttEndpoint}
              onChange={(e) => setSttEndpoint(e.target.value)}
              className={cn(
                "w-full bg-primary-dark border rounded-xl px-4 py-3 text-xs text-white focus:outline-none transition-all font-mono disabled:opacity-50",
                isSubmitAttempted && !sttEndpoint.trim()
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/5 focus:border-violet-500/40"
              )}
              placeholder={t('admin:ai_settings.stt_endpoint_placeholder', { defaultValue: 'e.g. http://localhost:8000/v1/audio/transcriptions' })}
            />
          </div>

          {/* Secret Key */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_key_label', { defaultValue: 'API Key / Token (Optional)' })}</label>
            <input
              type="password"
              disabled={sttProvider === 'disabled'}
              value={sttApiKey}
              onChange={(e) => setSttApiKey(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-mono disabled:opacity-50"
              placeholder="••••••••••••••••••••••••••••••••"
              autoComplete="new-password"
            />
          </div>

          {/* Detection Language */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_language_label', { defaultValue: 'Erkennungssprache' })}</label>
            <input
              type="text"
              disabled={sttProvider === 'disabled'}
              value={sttLanguage}
              onChange={(e) => setSttLanguage(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-sans disabled:opacity-50"
              placeholder={t('admin:ai_settings.stt_language_placeholder', { defaultValue: 'de, en, etc.' })}
            />
          </div>

          {/* STT Prompts for CRM jargon */}
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_prompt_label', { defaultValue: 'Erkennungshilfen (Prompt / Keywords)' })}</label>
            <input
              type="text"
              disabled={sttProvider === 'disabled'}
              value={sttPrompt}
              onChange={(e) => setSttPrompt(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-sans disabled:opacity-50"
              placeholder={t('admin:ai_settings.stt_prompt_placeholder', { defaultValue: 'Louis, CRM, Kontakt, Unternehmen, Workflow, BWA, E-Rechnung, Invoices' })}
            />
            <p className="text-[11px] text-slate-400 font-sans leading-normal">{t('admin:ai_settings.stt_prompt_help', { defaultValue: 'Begriffe, die Whisper bevorzugt annehmen soll um Fachbegriffe besser zu verstehen.' })}</p>
          </div>
        </div>

        {/* Local-Whisper Hardware Settings */}
        {sttProvider === 'local-whisper' && (
          <div className="pt-4 border-t border-white/5 space-y-4">
            <h5 className="text-[11px] font-black text-violet-400 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_hardware_title', { defaultValue: 'Lokale Hardware & VRAM Optimierungen' })}</h5>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Device select */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_device_label', { defaultValue: 'Recheneinheit (Device)' })}</label>
                <select
                  value={sttDevice}
                  onChange={(e) => setSttDevice(e.target.value as 'auto' | 'cpu' | 'cuda')}
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-sans"
                >
                  <option value="auto">{t('admin:ai_settings.stt_device_auto')}</option>
                  <option value="cpu">{t('admin:ai_settings.stt_device_cpu')}</option>
                  <option value="cuda">{t('admin:ai_settings.stt_device_cuda')}</option>
                </select>
              </div>

              {/* Quantization select */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.stt_quantization_label', { defaultValue: 'Quantisierung' })}</label>
                <select
                  value={sttQuantization}
                  onChange={(e) => setSttQuantization(e.target.value as 'none' | 'float16' | 'int8' | 'int8_float16')}
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-violet-500/40 transition-all font-sans"
                >
                  <option value="none">{t('admin:ai_settings.stt_quant_none')}</option>
                  <option value="float16">{t('admin:ai_settings.stt_quant_float16')}</option>
                  <option value="int8">{t('admin:ai_settings.stt_quant_int8')}</option>
                  <option value="int8_float16">{t('admin:ai_settings.stt_quant_int8_float16')}</option>
                </select>
              </div>

              {/* Unload LLM Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-primary-dark rounded-xl border border-white/5">
                <div>
                  <span className="text-xs font-bold text-white block">{t('admin:ai_settings.stt_unload_llm', { defaultValue: 'Unload LLM on Demand' })}</span>
                  <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">{t('admin:ai_settings.stt_unload_llm_desc', { defaultValue: 'Entlastet die GPU vor dem Start des Transkriptionsprozesses vram-intelligent.' })}</span>
                </div>
                <input
                  type="checkbox"
                  checked={sttUnloadLlmOnDemand}
                  onChange={(e) => setSttUnloadLlmOnDemand(e.target.checked)}
                  className="w-4 h-4 cursor-pointer accent-violet-500"
                />
              </div>

              {/* Fallback on CPU Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-primary-dark rounded-xl border border-white/5">
                <div>
                  <span className="text-xs font-bold text-white block">{t('admin:ai_settings.stt_failsafe_cpu', { defaultValue: 'Failsafe CPU Fallback' })}</span>
                  <span className="text-[11px] text-slate-400 block leading-tight mt-0.5">{t('admin:ai_settings.stt_failsafe_cpu_desc', { defaultValue: 'Weicht bei OOM-Fehlern der GPU automatisch auf CPU-Berechnung aus.' })}</span>
                </div>
                <input
                  type="checkbox"
                  checked={sttFallbackOnCpu}
                  onChange={(e) => setSttFallbackOnCpu(e.target.checked)}
                  className="w-4 h-4 cursor-pointer accent-violet-500"
                />
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-white/5 pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveSTTMutation.isPending}
            className="bg-gradient-to-tr from-violet-500 to-violet-600 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer"
          >
            {saveSTTMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check size={14} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export const LouisAiSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common', 'validation_errors']);

  const [providerType, setProviderType] = useState<'gemini' | 'ollama' | 'openai' | 'anthropic'>('ollama');
  const [modelName, setModelName] = useState('llama3');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(40);
  const [numCtx, setNumCtx] = useState(8192);

  // RAG Configuration States
  const [embeddingProvider, setEmbeddingProvider] = useState<'gemini' | 'ollama' | 'openai'>('ollama');
  const [embeddingApiKeySecret, setEmbeddingApiKeySecret] = useState('');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
  const [embeddingModelName, setEmbeddingModelName] = useState('nomic-embed-text');
  const [vectorDimensions, setVectorDimensions] = useState(1536);
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(5);
  const [parallelSlots, setParallelSlots] = useState(1);
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(50);

  // Auftrag 006 Task 0: ReAct-Laufzeitparameter (Regel 12 — Admin-einstellbar, null = Backend-Default)
  const [maxIterations, setMaxIterations] = useState<string>("");
  const [maxHistoryTokens, setMaxHistoryTokens] = useState<string>("");
  const [toolResultTruncateChars, setToolResultTruncateChars] = useState<string>("");
  const [reactKeepLastResults, setReactKeepLastResults] = useState<string>("");
  const [reactCompactionFromIteration, setReactCompactionFromIteration] = useState<string>("");
  const [earlyExitAfterTools, setEarlyExitAfterTools] = useState<string>("");
  // Auftrag 006 B3: Prompt-Direktiven-Modus ('always' = bisheriges Verhalten, 'intent' = Tokensparen)
  const [promptDirectivesMode, setPromptDirectivesMode] = useState<'always' | 'intent'>('always');
  // Auftrag 007 T5: Tool-Call-Modus ('auto' = native mit JSON-Fallback, 'json' = JSON-Freitext, 'native' = erzwungen)
  const [reactToolCallMode, setReactToolCallMode] = useState<'auto' | 'json' | 'native'>('auto');
  // 2026-08-18: Text-Fallback-Kanal (false = strikt/nativ, true = Text-Fallback aktiv)
  const [textFallbackEnabled, setTextFallbackEnabled] = useState<boolean>(false);
  // Auftrag 012 P0-2: Memory-Budget (Tokens) für die User-Memory-Injektion (leer = Backend-Default 800, Regel 12)
  const [memoryBudgetTokens, setMemoryBudgetTokens] = useState<string>("");
  // Auftrag 025 Phase 1 (Parität): Cache-Tier-Toggles (leer/null = Backend-Default, Regel 12)
  const [promptParallelToolGuidance, setPromptParallelToolGuidance] = useState<boolean>(true);
  const [promptToolGuidanceTrim, setPromptToolGuidanceTrim] = useState<boolean>(true);
  const [memoryFrozenSnapshot, setMemoryFrozenSnapshot] = useState<boolean>(true);
  // Auftrag 025 Phase 2 (Parität): Kontext-Kompression (leer/null = Backend-Default, Regel 12)
  const [compressionEnabled, setCompressionEnabled] = useState<boolean>(true);
  const [compressionThresholdPercent, setCompressionThresholdPercent] = useState<string>("");
  const [compressionTailTokenBudget, setCompressionTailTokenBudget] = useState<string>("");
  const [compressionAuxModel, setCompressionAuxModel] = useState<string>("");
  const [compressionPersistSummary, setCompressionPersistSummary] = useState<boolean>(true);
  const [compressionModelContextMap, setCompressionModelContextMap] = useState<string>("");
  // Auftrag 025 Phase 3 (Parität): Memory (leer/null = Backend-Default, Regel 12)
  const [memoryPrefetchEnabled, setMemoryPrefetchEnabled] = useState<boolean>(true);
  const [memoryPrefetchTimeoutS, setMemoryPrefetchTimeoutS] = useState<string>("");
  const [memoryRecallStatusEnabled, setMemoryRecallStatusEnabled] = useState<boolean>(true);
  const [memoryAutoScanEnabled, setMemoryAutoScanEnabled] = useState<boolean>(true);
  const [memoryConsolidationBudget, setMemoryConsolidationBudget] = useState<string>("");
  // Auftrag 025 Phase 4 (Parität): Fehlerfestigkeit (leer/null = Backend-Default, Regel 12)
  const [toolCallRetryMax, setToolCallRetryMax] = useState<string>("");
  const [emptyRetryBudget, setEmptyRetryBudget] = useState<string>("");
  const [emptyRetryCostThresholdUsd, setEmptyRetryCostThresholdUsd] = useState<string>("");
  const [toolGuardrailExactBlock, setToolGuardrailExactBlock] = useState<string>("");
  const [toolGuardrailNoProgressBlock, setToolGuardrailNoProgressBlock] = useState<string>("");
  const [loopDeadlineS, setLoopDeadlineS] = useState<string>("");
  const [thinkingScrubEnabled, setThinkingScrubEnabled] = useState<boolean>(true);
  // Auftrag 025 Phase 5 (Parität): Sessions & Recall (leer/null = Backend-Default, Regel 12)
  const [recallFtsEnabled, setRecallFtsEnabled] = useState<boolean>(true);
  const [recallSearchLimit, setRecallSearchLimit] = useState<string>("");
  // Auftrag 025 Phase 6 (Parität): Curator & Skills (leer/null = Backend-Default, Regel 12)
  const [skillCuratorEnabled, setSkillCuratorEnabled] = useState<boolean>(true);
  const [skillInjectMaxTokens, setSkillInjectMaxTokens] = useState<string>("");
  const [skillPruneInactiveAfterDays, setSkillPruneInactiveAfterDays] = useState<string>("");
  const [skillInjectTopK, setSkillInjectTopK] = useState<string>("");
  // Auftrag 026 P1-1 (Parität): Curator-Tick/Archiv (leer/null = Backend-Default, Regel 12)
  const [curatorIntervalHours, setCuratorIntervalHours] = useState<string>("");
  const [curatorArchiveAfterDays, setCuratorArchiveAfterDays] = useState<string>("");
  // Auftrag 025 Phase 7 (Parität): MCP-Registry & Subagent (leer/null = Backend-Default, Regel 12)
  const [mcpRefreshIntervalS, setMcpRefreshIntervalS] = useState<string>("");
  const [subtaskTimeoutS, setSubtaskTimeoutS] = useState<string>("");
  const [subtaskMaxParallel, setSubtaskMaxParallel] = useState<string>("");
  // Auftrag 026 P1-3 (Parität): Subagent-Spawn-Depth (leer/null = Backend-Default, Regel 12)
  const [subtaskMaxDepth, setSubtaskMaxDepth] = useState<string>("");
  // Auftrag 037 P1: Audit-Log-Retention in Tagen (leer/null = kein Auto-Prune, Regel 12)
  const [auditRetentionDays, setAuditRetentionDays] = useState<string>("");
  // Auftrag 038 P1: Session-Retention in Tagen (leer/null = kein Auto-Prune, Regel 12)
  const [sessionRetentionDays, setSessionRetentionDays] = useState<string>("");

  const [shouldFetchModels, setShouldFetchModels] = useState(false);
  const [isSubmitAttempted, setIsSubmitAttempted] = useState(false);
  const { data: modelsData, isFetching: isFetchingModels, error: modelsError, refetch: fetchModels } = trpc.listAvailableModels.useQuery(
    {
      provider_type: providerType,
      api_key_secret: apiKeySecret || null,
      base_url: baseUrl || null
    },
    {
      enabled: shouldFetchModels,
      retry: false
    }
  );

  // tRPC load
  const { data: config, isLoading, refetch } = trpc.getConfig.useQuery();

  const saveMutation = trpc.saveConfig.useMutation({
    onError: (err) => {
      toast.error(t('ai_settings_save_failed', { defaultValue: "Fehler beim Speichern: " }) + err.message);
    }
  });

  useEffect(() => {
    if (config) {
      setProviderType(config.provider_type);
      setModelName(config.model_name);
      setApiKeySecret(config.api_key_secret || '');
      setBaseUrl(config.base_url || '');
      setTemperature(config.temperature);
      setTopP(config.top_p);
      setTopK(config.top_k);
      setNumCtx(config.num_ctx);

      // Sync RAG Config
      setEmbeddingProvider(config.embedding_provider || 'ollama');
      setEmbeddingApiKeySecret(config.embedding_api_key_secret || '');
      setEmbeddingBaseUrl(config.embedding_base_url || '');
      setEmbeddingModelName(config.embedding_model_name || 'nomic-embed-text');
      setVectorDimensions(config.vector_dimensions || 1536);
      setKeepAliveMinutes(config.keep_alive_minutes ?? 5);
      setParallelSlots(config.parallel_slots ?? 1);
      setChunkSize(config.chunk_size ?? 500);
      setChunkOverlap(config.chunk_overlap ?? 50);
      // Sync ReAct-Laufzeitparameter (leer = nicht gesetzt → Backend-Default)
      setMaxIterations(config.max_iterations != null ? String(config.max_iterations) : "");
      setMaxHistoryTokens(config.max_history_tokens != null ? String(config.max_history_tokens) : "");
      setToolResultTruncateChars(config.tool_result_truncate_chars != null ? String(config.tool_result_truncate_chars) : "");
      setReactKeepLastResults(config.react_keep_last_results != null ? String(config.react_keep_last_results) : "");
      setReactCompactionFromIteration(config.react_compaction_from_iteration != null ? String(config.react_compaction_from_iteration) : "");
      setEarlyExitAfterTools(config.early_exit_after_tools != null ? String(config.early_exit_after_tools) : "");
      setPromptDirectivesMode(config.prompt_directives_mode || 'always');
      setReactToolCallMode(config.react_tool_call_mode || 'auto');
      setTextFallbackEnabled(config.text_fallback_enabled ?? false);
      setMemoryBudgetTokens(config.memory_budget_tokens != null ? String(config.memory_budget_tokens) : "");
      // Auftrag 025 Phase 1: Cache-Tier-Toggles (null → Backend-Default true)
      setPromptParallelToolGuidance(config.prompt_parallel_tool_guidance ?? true);
      setPromptToolGuidanceTrim(config.prompt_tool_guidance_trim ?? true);
      setMemoryFrozenSnapshot(config.memory_frozen_snapshot ?? true);
      // Auftrag 025 Phase 2: Kontext-Kompression (leer = Backend-Default)
      setCompressionEnabled(config.compression_enabled ?? true);
      setCompressionThresholdPercent(config.compression_threshold_percent != null ? String(config.compression_threshold_percent) : "");
      setCompressionTailTokenBudget(config.compression_tail_token_budget != null ? String(config.compression_tail_token_budget) : "");
      setCompressionAuxModel(config.compression_aux_model || "");
      setCompressionPersistSummary(config.compression_persist_summary ?? true);
      setCompressionModelContextMap(config.compression_model_context_map || "");
      // Auftrag 025 Phase 3: Memory (leer = Backend-Default)
      setMemoryPrefetchEnabled(config.memory_prefetch_enabled ?? true);
      setMemoryPrefetchTimeoutS(config.memory_prefetch_timeout_s != null ? String(config.memory_prefetch_timeout_s) : "");
      setMemoryRecallStatusEnabled(config.memory_recall_status_enabled ?? true);
      setMemoryAutoScanEnabled(config.memory_auto_scan_enabled ?? true);
      setMemoryConsolidationBudget(config.memory_consolidation_budget != null ? String(config.memory_consolidation_budget) : "");
      // Auftrag 025 Phase 4: Fehlerfestigkeit (leer = Backend-Default)
      setToolCallRetryMax(config.tool_call_retry_max != null ? String(config.tool_call_retry_max) : "");
      setEmptyRetryBudget(config.empty_retry_budget != null ? String(config.empty_retry_budget) : "");
      setEmptyRetryCostThresholdUsd(config.empty_retry_cost_threshold_usd != null ? String(config.empty_retry_cost_threshold_usd) : "");
      setToolGuardrailExactBlock(config.tool_guardrail_exact_block != null ? String(config.tool_guardrail_exact_block) : "");
      setToolGuardrailNoProgressBlock(config.tool_guardrail_no_progress_block != null ? String(config.tool_guardrail_no_progress_block) : "");
      setLoopDeadlineS(config.loop_deadline_s != null ? String(config.loop_deadline_s) : "");
      setThinkingScrubEnabled(config.thinking_scrub_enabled ?? true);
      // Auftrag 025 Phase 5: Sessions & Recall (leer = Backend-Default)
      setRecallFtsEnabled(config.recall_fts_enabled ?? true);
      setRecallSearchLimit(config.recall_search_limit != null ? String(config.recall_search_limit) : "");
      // Auftrag 025 Phase 6: Curator & Skills (leer = Backend-Default)
      setSkillCuratorEnabled(config.skill_curator_enabled ?? true);
      setSkillInjectMaxTokens(config.skill_inject_max_tokens != null ? String(config.skill_inject_max_tokens) : "");
      setSkillPruneInactiveAfterDays(config.skill_prune_inactive_after_days != null ? String(config.skill_prune_inactive_after_days) : "");
      setSkillInjectTopK(config.skill_inject_top_k != null ? String(config.skill_inject_top_k) : "");
      setCuratorIntervalHours(config.curator_interval_hours != null ? String(config.curator_interval_hours) : "");
      setCuratorArchiveAfterDays(config.curator_archive_after_days != null ? String(config.curator_archive_after_days) : "");
      // Auftrag 025 Phase 7: MCP & Subagent (leer = Backend-Default)
      setMcpRefreshIntervalS(config.mcp_refresh_interval_s != null ? String(config.mcp_refresh_interval_s) : "");
      setSubtaskTimeoutS(config.subtask_timeout_s != null ? String(config.subtask_timeout_s) : "");
      setSubtaskMaxParallel(config.subtask_max_parallel != null ? String(config.subtask_max_parallel) : "");
      setSubtaskMaxDepth(config.subtask_max_depth != null ? String(config.subtask_max_depth) : "");
      // Auftrag 037 P1: Audit-Log-Retention (leer = kein Auto-Prune)
      setAuditRetentionDays(config.audit_retention_days != null ? String(config.audit_retention_days) : "");
      // Auftrag 038 P1: Session-Retention (leer = kein Auto-Prune)
      setSessionRetentionDays(config.session_retention_days != null ? String(config.session_retention_days) : "");
      setIsSubmitAttempted(false);
    }
  }, [config]);

  const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  const handleSaveProviderSettings = () => {
    if (!modelName.trim()) {
      setIsSubmitAttempted(true);
      toast.error(t("validation_errors:please_fill_required_fields", { defaultValue: "Bitte füllen Sie alle Pflichtfelder aus." }));
      return;
    }

    setIsSubmitAttempted(false);
    saveMutation.mutate({
      provider_type: providerType,
      model_name: modelName,
      api_key_secret: apiKeySecret || null,
      base_url: baseUrl || null,
      temperature,
      top_p: topP,
      top_k: topK,
      num_ctx: numCtx,

      // Preserve RAG Config
      embedding_provider: embeddingProvider,
      embedding_api_key_secret: embeddingApiKeySecret || null,
      embedding_base_url: embeddingBaseUrl || null,
      embedding_model_name: embeddingModelName,
      vector_dimensions: Number(vectorDimensions),
      keep_alive_minutes: Number(keepAliveMinutes),
      parallel_slots: Number(parallelSlots),
      chunk_size: Number(chunkSize),
      chunk_overlap: Number(chunkOverlap),
      // ReAct-Laufzeitparameter (Regel 12 — Admin-einstellbar)
      max_iterations: numOrNull(maxIterations),
      max_history_tokens: numOrNull(maxHistoryTokens),
      tool_result_truncate_chars: numOrNull(toolResultTruncateChars),
      react_keep_last_results: numOrNull(reactKeepLastResults),
      react_compaction_from_iteration: numOrNull(reactCompactionFromIteration),
      early_exit_after_tools: numOrNull(earlyExitAfterTools),
      prompt_directives_mode: promptDirectivesMode,
      react_tool_call_mode: reactToolCallMode,
      text_fallback_enabled: textFallbackEnabled,
      memory_budget_tokens: numOrNull(memoryBudgetTokens),
      // Auftrag 025 Phase 1: Cache-Tier-Toggles (null = Backend-Default)
      prompt_parallel_tool_guidance: promptParallelToolGuidance,
      prompt_tool_guidance_trim: promptToolGuidanceTrim,
      memory_frozen_snapshot: memoryFrozenSnapshot,
      // Auftrag 025 Phase 2: Kontext-Kompression (leer = Backend-Default)
      compression_enabled: compressionEnabled,
      compression_threshold_percent: numOrNull(compressionThresholdPercent),
      compression_tail_token_budget: numOrNull(compressionTailTokenBudget),
      compression_aux_model: compressionAuxModel.trim() === "" ? null : compressionAuxModel,
      compression_persist_summary: compressionPersistSummary,
      compression_model_context_map: compressionModelContextMap.trim() === "" ? null : compressionModelContextMap,
      // Auftrag 025 Phase 3: Memory (leer = Backend-Default)
      memory_prefetch_enabled: memoryPrefetchEnabled,
      memory_prefetch_timeout_s: numOrNull(memoryPrefetchTimeoutS),
      memory_recall_status_enabled: memoryRecallStatusEnabled,
      memory_auto_scan_enabled: memoryAutoScanEnabled,
      memory_consolidation_budget: numOrNull(memoryConsolidationBudget),
      // Auftrag 025 Phase 4: Fehlerfestigkeit (leer = Backend-Default)
      tool_call_retry_max: numOrNull(toolCallRetryMax),
      empty_retry_budget: numOrNull(emptyRetryBudget),
      empty_retry_cost_threshold_usd: emptyRetryCostThresholdUsd.trim() === "" ? null : Number(emptyRetryCostThresholdUsd),
      tool_guardrail_exact_block: numOrNull(toolGuardrailExactBlock),
      tool_guardrail_no_progress_block: numOrNull(toolGuardrailNoProgressBlock),
      loop_deadline_s: numOrNull(loopDeadlineS),
      thinking_scrub_enabled: thinkingScrubEnabled,
      // Auftrag 025 Phase 5: Sessions & Recall (leer = Backend-Default)
      recall_fts_enabled: recallFtsEnabled,
      recall_search_limit: numOrNull(recallSearchLimit),
      // Auftrag 025 Phase 6: Curator & Skills (leer = Backend-Default)
      skill_curator_enabled: skillCuratorEnabled,
      skill_inject_max_tokens: numOrNull(skillInjectMaxTokens),
      skill_prune_inactive_after_days: numOrNull(skillPruneInactiveAfterDays),
      skill_inject_top_k: numOrNull(skillInjectTopK),
      curator_interval_hours: numOrNull(curatorIntervalHours),
      curator_archive_after_days: numOrNull(curatorArchiveAfterDays),
      // Auftrag 025 Phase 7: MCP & Subagent (leer = Backend-Default)
      mcp_refresh_interval_s: numOrNull(mcpRefreshIntervalS),
      subtask_timeout_s: numOrNull(subtaskTimeoutS),
      subtask_max_parallel: numOrNull(subtaskMaxParallel),
      subtask_max_depth: numOrNull(subtaskMaxDepth),
      // Auftrag 037 P1: Audit-Log-Retention (leer = kein Auto-Prune)
      audit_retention_days: numOrNull(auditRetentionDays),
      // Auftrag 038 P1: Session-Retention (leer = kein Auto-Prune)
      session_retention_days: numOrNull(sessionRetentionDays)
    }, {
      onSuccess: () => {
        toast.success(t('admin:toast_success_provider_settings', { defaultValue: 'KI-Provider & Modell-Einstellungen erfolgreich gespeichert!' }));
        refetch();
      }
    });
  };

  const handleSaveRagSettings = () => {
    if (!embeddingModelName.trim()) {
      setIsSubmitAttempted(true);
      toast.error(t("validation_errors:please_fill_required_fields", { defaultValue: "Bitte füllen Sie alle Pflichtfelder aus." }));
      return;
    }

    setIsSubmitAttempted(false);
    saveMutation.mutate({
      // Preserve Provider Config
      provider_type: providerType,
      model_name: modelName,
      api_key_secret: apiKeySecret || null,
      base_url: baseUrl || null,
      temperature,
      top_p: topP,
      top_k: topK,
      num_ctx: numCtx,

      // RAG Config
      embedding_provider: embeddingProvider,
      embedding_api_key_secret: embeddingApiKeySecret || null,
      embedding_base_url: embeddingBaseUrl || null,
      embedding_model_name: embeddingModelName,
      vector_dimensions: Number(vectorDimensions),
      keep_alive_minutes: Number(keepAliveMinutes),
      parallel_slots: Number(parallelSlots),
      chunk_size: Number(chunkSize),
      chunk_overlap: Number(chunkOverlap),
      // ReAct-Laufzeitparameter (Regel 12 — Admin-einstellbar)
      max_iterations: numOrNull(maxIterations),
      max_history_tokens: numOrNull(maxHistoryTokens),
      tool_result_truncate_chars: numOrNull(toolResultTruncateChars),
      react_keep_last_results: numOrNull(reactKeepLastResults),
      react_compaction_from_iteration: numOrNull(reactCompactionFromIteration),
      early_exit_after_tools: numOrNull(earlyExitAfterTools),
      prompt_directives_mode: promptDirectivesMode,
      react_tool_call_mode: reactToolCallMode,
      text_fallback_enabled: textFallbackEnabled,
      memory_budget_tokens: numOrNull(memoryBudgetTokens),
      // Auftrag 025 Phase 1: Cache-Tier-Toggles (null = Backend-Default)
      prompt_parallel_tool_guidance: promptParallelToolGuidance,
      prompt_tool_guidance_trim: promptToolGuidanceTrim,
      memory_frozen_snapshot: memoryFrozenSnapshot,
      // Auftrag 025 Phase 2: Kontext-Kompression (leer = Backend-Default)
      compression_enabled: compressionEnabled,
      compression_threshold_percent: numOrNull(compressionThresholdPercent),
      compression_tail_token_budget: numOrNull(compressionTailTokenBudget),
      compression_aux_model: compressionAuxModel.trim() === "" ? null : compressionAuxModel,
      compression_persist_summary: compressionPersistSummary,
      compression_model_context_map: compressionModelContextMap.trim() === "" ? null : compressionModelContextMap,
      // Auftrag 025 Phase 3: Memory (leer = Backend-Default)
      memory_prefetch_enabled: memoryPrefetchEnabled,
      memory_prefetch_timeout_s: numOrNull(memoryPrefetchTimeoutS),
      memory_recall_status_enabled: memoryRecallStatusEnabled,
      memory_auto_scan_enabled: memoryAutoScanEnabled,
      memory_consolidation_budget: numOrNull(memoryConsolidationBudget),
      // Auftrag 025 Phase 4: Fehlerfestigkeit (leer = Backend-Default)
      tool_call_retry_max: numOrNull(toolCallRetryMax),
      empty_retry_budget: numOrNull(emptyRetryBudget),
      empty_retry_cost_threshold_usd: emptyRetryCostThresholdUsd.trim() === "" ? null : Number(emptyRetryCostThresholdUsd),
      tool_guardrail_exact_block: numOrNull(toolGuardrailExactBlock),
      tool_guardrail_no_progress_block: numOrNull(toolGuardrailNoProgressBlock),
      loop_deadline_s: numOrNull(loopDeadlineS),
      thinking_scrub_enabled: thinkingScrubEnabled,
      // Auftrag 025 Phase 5: Sessions & Recall (leer = Backend-Default)
      recall_fts_enabled: recallFtsEnabled,
      recall_search_limit: numOrNull(recallSearchLimit),
      // Auftrag 025 Phase 6: Curator & Skills (leer = Backend-Default)
      skill_curator_enabled: skillCuratorEnabled,
      skill_inject_max_tokens: numOrNull(skillInjectMaxTokens),
      skill_prune_inactive_after_days: numOrNull(skillPruneInactiveAfterDays),
      skill_inject_top_k: numOrNull(skillInjectTopK),
      curator_interval_hours: numOrNull(curatorIntervalHours),
      curator_archive_after_days: numOrNull(curatorArchiveAfterDays),
      // Auftrag 025 Phase 7: MCP & Subagent (leer = Backend-Default)
      mcp_refresh_interval_s: numOrNull(mcpRefreshIntervalS),
      subtask_timeout_s: numOrNull(subtaskTimeoutS),
      subtask_max_parallel: numOrNull(subtaskMaxParallel),
      subtask_max_depth: numOrNull(subtaskMaxDepth),
      // Auftrag 037 P1: Audit-Log-Retention (leer = kein Auto-Prune)
      audit_retention_days: numOrNull(auditRetentionDays),
      // Auftrag 038 P1: Session-Retention (leer = kein Auto-Prune)
      session_retention_days: numOrNull(sessionRetentionDays)
    }, {
      onSuccess: () => {
        toast.success(t('admin:toast_success_rag_settings', { defaultValue: 'RAG- & Embedding-Einstellungen erfolgreich gespeichert!' }));
        refetch();
      }
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 justify-center py-12">
        <div className="w-6 h-6 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">{t('admin:ai_settings.loading_ai_profiles')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-6 mb-8">
        <div className="p-5 bg-gradient-to-tr from-accent-orange/20 to-accent-blue/20 rounded-2xl border border-white/5 shadow-xl relative glow-orange">
          <Brain className="text-accent-orange" size={32} />
        </div>
        <div>
          <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display">{t('admin:ai_settings.title')}</h3>
          <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
            {t('admin:ai_settings.desc')}
          </p>
        </div>
      </div>

      {/* KI-Provider & Modell Einstellungen Card */}
      <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 mb-8 space-y-6">
        <div className="flex items-center gap-4 border-b border-white/5 pb-3">
          <div className="p-3 bg-accent-orange/10 rounded-xl border border-accent-orange/20 text-accent-orange">
            <Brain size={20} />
          </div>
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-wider font-display">
              {t('admin:ai_settings.provider_settings_title', { defaultValue: 'KI-PROVIDER & MODELL EINSTELLUNGEN' })}
            </h4>
            <p className="text-[11px] text-slate-500 font-sans mt-0.5">
              {t('admin:ai_settings.provider_settings_desc', { defaultValue: 'Verwalten Sie KI-Anbieter, Modellname, Endpunkte, API-Schlüssel und Agenten-Feineinstellungen.' })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Provider Select */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.provider_label')}
            </label>
            <select
              value={providerType}
              onChange={(e) => {
                const val = e.target.value as 'gemini' | 'ollama' | 'openai' | 'anthropic';
                setProviderType(val);
                if (val === 'gemini') setModelName('gemini-2.5-flash');
                else if (val === 'openai') setModelName('gpt-4o');
                else if (val === 'anthropic') setModelName('claude-3-5-sonnet');
                else setModelName('llama3');
              }}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans"
            >
              <option value="gemini">{t('admin:ai_settings.provider_option_gemini', { defaultValue: 'Google Gemini AI (Standard / Recommended)' })}</option>
              <option value="ollama">{t('admin:ai_settings.provider_option_ollama', { defaultValue: 'Ollama Local Agent (Offline / Custom Server)' })}</option>
              <option value="openai">{t('admin:ai_settings.provider_option_openai', { defaultValue: 'OpenAI GPT Engines' })}</option>
              <option value="anthropic">{t('admin:ai_settings.provider_option_anthropic', { defaultValue: 'Anthropic Claude' })}</option>
            </select>
          </div>

          {/* Model Name */}
          <div className="space-y-2 col-span-1">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.model_name_label')}
            </label>
            <input
              type="text"
              required
              id="ai-model-name-input"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              className={cn(
                "w-full bg-primary-dark border rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition-all font-mono",
                isSubmitAttempted && !modelName.trim()
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/5 focus:border-accent-orange/40"
              )}
              placeholder={t('admin:ai_settings.model_name_placeholder')}
              autoComplete="off"
            />
            <button
              type="button"
              id="ai-live-fetch-models-btn"
              onClick={() => {
                setShouldFetchModels(true);
                setTimeout(() => {
                  fetchModels();
                }, 50);
              }}
              disabled={isFetchingModels}
              className="mt-2 text-[11px] font-black uppercase tracking-wider text-accent-orange hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isFetchingModels ? (
                <span className="w-3 h-3 border border-accent-orange border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                "🔍"
              )}
              {t('admin:ai_settings.fetch_models_btn')}
            </button>
          </div>

          {/* Base URL (useful for ollama or server proxies) */}
          <div className="space-y-2 col-span-1">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.base_url_label')}
            </label>
            <input
              type="text"
              id="ai-base-url-input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
              placeholder={t('admin:ai_settings.base_url_placeholder', { defaultValue: 'http://localhost:11434' })}
              autoComplete="off"
            />
          </div>

          {/* Secret Key Input */}
          <div className="space-y-2 col-span-1">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.secret_key_label')}
            </label>
            <input
              type="password"
              id="ai-api-key-input"
              value={apiKeySecret}
              onChange={(e) => setApiKeySecret(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
              placeholder="••••••••••••••••••••••••••••••••"
              autoComplete="new-password"
            />
          </div>

          {/* Available Models Panel */}
          {shouldFetchModels && (modelsData || isFetchingModels) && (
            <div className="col-span-1 md:col-span-2 p-5 bg-primary-dark/80 border border-white/5 rounded-2xl space-y-3 relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-accent-orange/5 blur-2xl rounded-full" />
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-white/5 pb-2">
                <h5 className="text-[11px] font-black text-slate-300 uppercase tracking-widest font-display flex items-center gap-2">
                  <Brain size={14} className="text-accent-orange animate-pulse" />
                  {t('admin:ai_settings.live_recognition_title', { provider: providerType.toUpperCase() })}
                </h5>
                {modelsData?.error ? (
                  <span className="text-[11px] text-accent-orange font-bold font-mono">
                    ⚠️ {modelsData.error}
                  </span>
                ) : (
                  modelsData?.success && (
                    <span className="text-[9px] text-emerald-400 font-mono font-bold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                      {t('admin:ai_settings.interface_ready_badge')}
                    </span>
                  )
                )}
              </div>
              
              {isFetchingModels ? (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <div className="w-5 h-5 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-slate-400 font-mono uppercase tracking-widest">{t('common:loading')}</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-56 overflow-y-auto pr-2">
                  {modelsData?.models?.map((m: { id: string; name?: string; description?: string }) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setModelName(m.id);
                        toast.success(t('admin:toast_model_saved_success', { name: m.id, defaultValue: `Modell auf '${m.id}' festgelegt!` }));
                      }}
                      className={`p-3 rounded-xl text-left border transition-all flex flex-col justify-start items-start cursor-pointer group/item text-xs relative overflow-hidden ${
                        modelName === m.id
                          ? 'bg-accent-orange/15 border-accent-orange text-white'
                          : 'bg-primary-dark border-white/5 text-slate-300 hover:border-white/15 hover:bg-primary-dark-light'
                      }`}
                    >
                      <span className="font-bold font-mono text-white group-hover/item:text-accent-orange transition-colors">
                        {m.id}
                      </span>
                      {m.name && m.name !== m.id && (
                        <span className="text-[11px] text-slate-400 font-medium mt-1">
                          {m.name}
                        </span>
                      )}
                      {m.description && (
                        <span className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {m.description}
                        </span>
                      )}
                    </button>
                  ))}
                  {(!modelsData?.models || modelsData.models.length === 0) && (
                    <div className="col-span-1 sm:col-span-2 lg:col-span-3 text-center py-4 text-slate-500 italic text-xs">
                      {t('admin:ai_settings.no_models_found')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-white/5 pt-6">
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display mb-4">
            {t('admin:ai_settings.agent_fine_tuning')}
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-slate-400 font-display">
                <label>{t('admin:ai_settings.agent_temp_label')}</label>
                <span className="font-mono text-white">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-accent-orange"
              />
            </div>

            {/* Top P */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-slate-400 font-display">
                <label>{t('admin:ai_settings.top_p_label', { defaultValue: 'Kausalität (Top P)' })}</label>
                <span className="font-mono text-white">{topP.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={topP}
                onChange={(e) => setTopP(parseFloat(e.target.value))}
                className="w-full accent-accent-blue"
              />
            </div>

            {/* Top K */}
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.top_k_label', { defaultValue: 'Token-Einstufung (Top K)' })}
              </label>
              <input
                type="number"
                min="1"
                value={topK}
                onChange={(e) => setTopK(Math.max(1, parseInt(e.target.value) || 40))}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
              />
            </div>

            {/* Context Token Limit */}
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.num_ctx_label', { defaultValue: 'Kontext-Sitzungsfenster (Max Tokens)' })}
              </label>
              <input
                type="number"
                min="1"
                value={numCtx}
                onChange={(e) => setNumCtx(Math.max(1, parseInt(e.target.value) || 8192))}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
              />
            </div>
          </div>
        </div>

        {/* Sicherheitshinweis für API-Schlüssel */}
        <div className="bg-primary-dark/55 border border-white/5 rounded-2xl p-4 flex gap-3 text-xs text-slate-400 leading-relaxed font-sans mt-4">
          <Info className="text-accent-orange shrink-0 mt-0.5" size={18} />
          <p>
            <strong>{t('admin:ai_settings.safety_hint_title', { defaultValue: 'Sicherheitshinweis:' })}</strong> {t('admin:ai_settings.safety_hint_desc', { defaultValue: 'Deine API-Schlüssel werden für deinen Mandanten (Tenant) hochgradig isoliert im System hinterlegt. Louis CRM AI nutzt die ReAct-Orchestrierung um alle Datenbankaktivitäten in Echtzeit zu begleiten, verwehrt der künstlichen Intelligenz jedoch jede direkte Schreibberechtigung auf Live-CRM-Daten.' })}
          </p>
        </div>

        <div className="border-t border-white/5 pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveProviderSettings}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg hover:shadow-accent-orange/20 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check size={14} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 🔮 RAG Wissens-Engine & Vektor-Embeddings Card */}
      <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 mb-8 space-y-6">
        <div className="flex items-center gap-4 border-b border-white/5 pb-3">
          <div className="p-3 bg-accent-blue/10 rounded-xl border border-accent-blue/20 text-accent-blue">
            <Settings size={20} />
          </div>
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-wider font-display">
              {t('admin:ai_settings.rag_accordion_title', { defaultValue: '🔮 RAG WISSENS-ENGINE & VEKTOR-EMBEDDINGS' })}
            </h4>
            <p className="text-[11px] text-slate-500 font-sans mt-0.5">
              {t('admin:ai_settings.rag_accordion_desc', { defaultValue: 'Schnittstellen für Dokumentensplitting, Vektorenabmessungen und Inhalts-Chunking (Ollama, Gemini, OpenAI).' })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Embedding Provider Selection */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.rag_provider_label', { defaultValue: 'Vektor-Embedder Provider' })}
            </label>
            <select
              value={embeddingProvider}
              onChange={(e) => {
                const val = e.target.value as 'gemini' | 'ollama' | 'openai';
                setEmbeddingProvider(val);
                if (val === 'gemini') {
                  setEmbeddingModelName('text-embedding-004');
                  setVectorDimensions(1536);
                } else if (val === 'openai') {
                  setEmbeddingModelName('text-embedding-3-small');
                  setVectorDimensions(1536);
                } else {
                  setEmbeddingModelName('nomic-embed-text');
                  setVectorDimensions(1536);
                }
              }}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-sans"
            >
              <option value="gemini">{t('admin:ai_settings.rag_provider_gemini', { defaultValue: 'Google Gemini Embedding (Serverless / Standard)' })}</option>
              <option value="ollama">{t('admin:ai_settings.rag_provider_ollama', { defaultValue: 'Ollama Local Embedding (Offline / Custom Server)' })}</option>
              <option value="openai">{t('admin:ai_settings.rag_provider_openai', { defaultValue: 'OpenAI Embedding (text-embedding-3-small)' })}</option>
            </select>
          </div>

          {/* Embedding Model ID */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.rag_model_name_label', { defaultValue: 'Vektor-Modellname' })}
            </label>
            <input
              type="text"
              required
              value={embeddingModelName}
              onChange={(e) => setEmbeddingModelName(e.target.value)}
              className={cn(
                "w-full bg-primary-dark border rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition-all font-mono",
                isSubmitAttempted && !embeddingModelName.trim()
                  ? "border-red-500/50 focus:border-red-500"
                  : "border-white/5 focus:border-accent-blue/40"
              )}
              placeholder={t('admin:ai_settings.embedding_model_placeholder', { defaultValue: 'text-embedding-004' })}
              autoComplete="off"
            />
          </div>

          {/* Connection endpoint */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.rag_base_url_label', { defaultValue: 'Embedding Server Basis-URL (Optional)' })}
            </label>
            <input
              type="text"
              value={embeddingBaseUrl}
              onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
              placeholder={t('admin:ai_settings.embedding_endpoint_placeholder', { defaultValue: 'z.B. http://localhost:11434 oder https://api.openai.com/v1' })}
              autoComplete="off"
            />
          </div>

          {/* Embedding secret key */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.rag_api_key_label', { defaultValue: 'Embedding API Key / Token (Optional)' })}
            </label>
            <input
              type="password"
              value={embeddingApiKeySecret}
              onChange={(e) => setEmbeddingApiKeySecret(e.target.value)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
              placeholder={t('admin:ai_settings.rag_api_key_placeholder', { defaultValue: 'Unverändert lassen, falls leer oder lokal' })}
              autoComplete="new-password"
            />
          </div>

          {/* Chunk Size */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-slate-400 font-display">
              <label>{t('admin:ai_settings.rag_chunk_size_label', { defaultValue: 'Dokumenten-Chunkgröße (Wörter)' })}</label>
              <span className="font-mono text-white">{t('admin:ai_settings.rag_words', { count: chunkSize, defaultValue: `${chunkSize} Wörter` })}</span>
            </div>
            <input
              type="range"
              min="100"
              max="1500"
              step="50"
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="w-full h-1.5 bg-primary-dark rounded-lg appearance-none cursor-pointer accent-accent-blue"
            />
          </div>

          {/* Chunk Overlap */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-[11px] font-black uppercase tracking-widest text-slate-400 font-display">
              <label>{t('admin:ai_settings.rag_chunk_overlap_label', { defaultValue: 'Überlappungs-Menge (Wörter)' })}</label>
              <span className="font-mono text-white">{t('admin:ai_settings.rag_words', { count: chunkOverlap, defaultValue: `${chunkOverlap} Wörter` })}</span>
            </div>
            <input
              type="range"
              min="10"
              max="300"
              step="10"
              value={chunkOverlap}
              onChange={(e) => setChunkOverlap(Number(e.target.value))}
              className="w-full h-1.5 bg-primary-dark rounded-lg appearance-none cursor-pointer accent-accent-blue"
            />
          </div>

          {/* Ollama vram Keep-alive */}
          {embeddingProvider === 'ollama' && (
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.rag_keep_alive_label', { defaultValue: 'Ollama VRAM Keep-Alive (Minuten)' })}
              </label>
              <input
                type="number"
                min="0"
                max="60"
                value={keepAliveMinutes}
                onChange={(e) => setKeepAliveMinutes(Number(e.target.value) || 5)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
              />
            </div>
          )}

          {/* Parallel slots */}
          {embeddingProvider === 'ollama' && (
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.rag_parallel_slots_label', { defaultValue: 'Hardware-Parallelisierung slots' })}
              </label>
              <input
                type="number"
                min="1"
                max="16"
                value={parallelSlots}
                onChange={(e) => setParallelSlots(Number(e.target.value) || 1)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
              />
            </div>
          )}
        </div>

        <div className="border-t border-white/5 pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSaveRagSettings}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-tr from-accent-blue to-blue-600 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg hover:shadow-accent-blue/20 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check size={14} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Auftrag 006 Task 0: Agenten-Laufzeit (ReAct-Parameter, Regel 12 — Admin-einstellbar) */}
      <div data-testid="react-runtime-settings" className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 mb-8 space-y-6">
        <div className="flex items-center gap-4 border-b border-white/5 pb-3">
          <div className="p-3 bg-accent-blue/10 rounded-xl border border-accent-blue/20 text-accent-blue">
            <Zap size={20} />
          </div>
          <div>
            <h4 className="text-sm font-black text-white uppercase tracking-wider font-display">
              {t('admin:ai_settings.runtime_section_title', { defaultValue: 'AGENTEN-LAUFZEIT (ReAct-PARAMETER)' })}
            </h4>
            <p className="text-[11px] text-slate-500 font-sans mt-0.5">
              {t('admin:ai_settings.runtime_section_desc', { defaultValue: 'Steuert die Token-Effizienz des AI-Agenten. Leere Felder = Backend-Default.' })}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.max_iterations_label', { defaultValue: 'Max. ReAct-Iterationen' })}
            </label>
            <input
              type="number"
              min="1"
              max="15"
              data-testid="react-max-iterations"
              value={maxIterations}
              onChange={(e) => setMaxIterations(e.target.value)}
              placeholder={t('admin:ai_settings.runtime_placeholder_default', { defaultValue: 'Leer = automatisch (4–6)' })}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.max_iterations_desc', { defaultValue: 'Wie viele Tool-Ausführungsrunden der Agent maximal laufen darf, bevor er antwortet.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.max_history_tokens_label', { defaultValue: 'Chat-Verlauf Token-Budget' })}
            </label>
            <input
              type="number"
              min="200"
              max="8000"
              step="100"
              data-testid="react-max-history-tokens"
              value={maxHistoryTokens}
              onChange={(e) => setMaxHistoryTokens(e.target.value)}
              placeholder="2000"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.max_history_tokens_desc', { defaultValue: 'Wie viele Tokens des Chat-Verlaufs dem Agenten pro Anfrage zur Verfügung stehen (ältere Nachrichten werden komprimiert).' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.memory_budget_label', { defaultValue: 'Gedächtnis-Budget (Tokens)' })}
            </label>
            <input
              type="number"
              min="200"
              max="8000"
              step="100"
              data-testid="react-memory-budget-tokens"
              value={memoryBudgetTokens}
              onChange={(e) => setMemoryBudgetTokens(e.target.value)}
              placeholder="800"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.memory_budget_desc', { defaultValue: 'Maximale Token-Menge für das Langzeitgedächtnis (Präferenzen + Notizen) im Agenten-Prompt. Leer = 800 (Default). Ältere Notizen werden bei Überschreitung gekürzt.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.tool_result_truncate_label', { defaultValue: 'Tool-Ergebnis-Limit (Zeichen)' })}
            </label>
            <input
              type="number"
              min="200"
              max="20000"
              step="100"
              data-testid="react-tool-result-truncate"
              value={toolResultTruncateChars}
              onChange={(e) => setToolResultTruncateChars(e.target.value)}
              placeholder="2000"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.tool_result_truncate_desc', { defaultValue: 'Maximale Zeichenzahl, mit der Tool-Ergebnisse in den Agenten-Prompt eingebettet werden.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.prompt_directives_label', { defaultValue: 'Prompt-Direktiven-Modus' })}
            </label>
            <select
              value={promptDirectivesMode}
              onChange={(e) => setPromptDirectivesMode(e.target.value as 'always' | 'intent')}
              data-testid="prompt-directives-mode"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-sans"
            >
              <option value="always">{t('admin:ai_settings.prompt_directives_always', { defaultValue: 'Immer einfügen (bisheriges Verhalten)' })}</option>
              <option value="intent">{t('admin:ai_settings.prompt_directives_intent', { defaultValue: 'Nur bei E-Mail-Bezug (spart Tokens)' })}</option>
            </select>
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.prompt_directives_desc', { defaultValue: 'Steuert, ob die ausführlichen E-Mail-/Mahnungs-Direktiven (~600 Zeichen) immer oder nur bei E-Mail-Bezug in den Prompt eingebettet werden.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.tool_call_mode_label', { defaultValue: 'Tool-Call-Modus' })}
            </label>
            <select
              value={reactToolCallMode}
              onChange={(e) => setReactToolCallMode(e.target.value as 'auto' | 'json' | 'native')}
              data-testid="tool-call-mode"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-sans"
            >
              <option value="auto">{t('admin:ai_settings.tool_call_mode_auto', { defaultValue: 'Automatisch (native Tool-Calls, JSON-Fallback)' })}</option>
              <option value="native">{t('admin:ai_settings.tool_call_mode_native', { defaultValue: 'Nur native Tool-Calls (spart Tokens)' })}</option>
              <option value="json">{t('admin:ai_settings.tool_call_mode_json', { defaultValue: 'JSON-Freitext (bisheriges Verhalten)' })}</option>
            </select>
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.tool_call_mode_desc', { defaultValue: 'Native Tool-Calls sparen Output-Tokens (strukturierte Aufrufe statt JSON-Antwort). Auto = nutzt native, fällt bei Bedarf auf JSON zurück.' })}
            </p>
          </div>

          {/* 2026-08-18: Text-Fallback-Kanal (Entscheid — Default AUS/strikt, Aktivierung manuell + Auto-Erkennung) */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.text_fallback_label', { defaultValue: 'Text-Fallback-Kanal' })}
            </label>
            <div className="flex items-center justify-between gap-4 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium">
                  {textFallbackEnabled
                    ? t('admin:ai_settings.text_fallback_on_desc', { defaultValue: 'AN — XML-/JSON-Text-Fallback erlaubt (kompatibel, für Modelle ohne function calling)' })
                    : t('admin:ai_settings.text_fallback_off_desc', { defaultValue: 'AUS — nur strukturierte Tool-Calls (strikt — keine XML-Leaks)' })}
                </p>
                <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">
                  {t('admin:ai_settings.text_fallback_desc', { defaultValue: 'Bei AUS akzeptiert der Agent ausschließlich native Tool-Calls — kein XML-/JSON-Text-Fallback. Manche lokalen Modelle (z.B. kleine Ollama-Modelle) benötigen den Fallback: dann hier aktivieren. Wenn ein Modell bei AUS Text statt Tool-Calls liefert, erscheint ein Hinweis im Chat.' })}
                </p>
              </div>
              <input

                type="checkbox"

                checked={textFallbackEnabled}

                onChange={(e) => setTextFallbackEnabled(e.target.checked)}

                data-testid="text-fallback-toggle"

                className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

              />
            </div>
          </div>

          {/* Auftrag 025 Phase 1 (Parität): Cache-Tier-Toggles (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-2 md:col-span-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.cache_tier_section_label', { defaultValue: 'Cache-Tier-Architektur (Prompt-Stabilität)' })}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.parallel_tool_guidance_label', { defaultValue: 'Parallel-Tool-Guidance' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.parallel_tool_guidance_desc', { defaultValue: 'Anleitung zum Bündeln unabhängiger Lese-Tools im Prompt (AN = Guidance enthalten).' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={promptParallelToolGuidance}

                  onChange={(e) => setPromptParallelToolGuidance(e.target.checked)}

                  data-testid="parallel-tool-guidance-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.tool_guidance_trim_label', { defaultValue: 'Tool-Guidance-Trim' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.tool_guidance_trim_desc', { defaultValue: 'E-Mail-/Mahnungs-Direktiven nur bei aktiven E-Mail-Tools oder E-Mail-Bezug einfügen (spart Tokens, stabiler Prefix).' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={promptToolGuidanceTrim}

                  onChange={(e) => setPromptToolGuidanceTrim(e.target.checked)}

                  data-testid="tool-guidance-trim-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.memory_frozen_snapshot_label', { defaultValue: 'Frozen Memory-Snapshot' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.memory_frozen_snapshot_desc', { defaultValue: 'Gedächtnis 1x pro Anfrage einfrieren (Cache-Prefix stabil). AUS = Live-Refresh nach update_memory mitten im Turn.' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={memoryFrozenSnapshot}

                  onChange={(e) => setMemoryFrozenSnapshot(e.target.checked)}

                  data-testid="memory-frozen-snapshot-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 2 (Parität): Kontext-Kompression (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_section_label', { defaultValue: 'Kontext-Kompression (endlose Chats)' })}
                </label>
                <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">
                  {t('admin:ai_settings.compression_section_desc', { defaultValue: 'Threshold-basierte Komprimierung der Chat-Mitte mit Head/Tail-Schutz. Läuft im Hintergrund — nie auf dem Antwort-Pfad. Leere Felder = Backend-Default.' })}
                </p>
              </div>
              <input

                type="checkbox"

                checked={compressionEnabled}

                onChange={(e) => setCompressionEnabled(e.target.checked)}

                data-testid="compression-enabled-toggle"

                className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_threshold_label', { defaultValue: 'Kompressions-Schwelle (% des Fensters)' })}
                </label>
                <input
                  type="number"
                  min="10"
                  max="95"
                  value={compressionThresholdPercent}
                  onChange={(e) => setCompressionThresholdPercent(e.target.value)}
                  placeholder="75"
                  data-testid="compression-threshold"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.compression_threshold_desc', { defaultValue: 'Anteil des Kontextfensters, ab dem die Mitte komprimiert wird. Fenstergröße kommt aus der Modell-Map (unten) bzw. Default 128K.' })}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_tail_label', { defaultValue: 'Geschützter Schwanz (Tokens)' })}
                </label>
                <input
                  type="number"
                  min="2000"
                  max="100000"
                  step="1000"
                  value={compressionTailTokenBudget}
                  onChange={(e) => setCompressionTailTokenBudget(e.target.value)}
                  placeholder="20000"
                  data-testid="compression-tail-budget"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.compression_tail_desc', { defaultValue: 'Die letzten N Tokens der Konversation bleiben immer vollständig erhalten (Head/Tail-Schutz).' })}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_aux_label', { defaultValue: 'Aux-Modell für Zusammenfassungen' })}
                </label>
                {/* Auftrag 040: Dropdown aus der abgerufenen Modellliste (Hauptbereich) statt Freitext */}
                <select
                  value={compressionAuxModel}
                  onChange={(e) => setCompressionAuxModel(e.target.value)}
                  disabled={!modelsData?.models || modelsData.models.length === 0}
                  data-testid="compression-aux-model"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {t('admin:ai_settings.compression_aux_empty_option', { defaultValue: '— Leer = Hauptmodell —' })}
                  </option>
                  {/* Auftrag 040 P1: gespeicherte ID, die nicht (mehr) in der Liste steht, trotzdem anzeigen —
                      sonst würde das Select beim Speichern still auf „leer" zurückfallen */}
                  {compressionAuxModel && !modelsData?.models?.some((m: { id: string }) => m.id === compressionAuxModel) && (
                    <option value={compressionAuxModel}>
                      {compressionAuxModel} {t('admin:ai_settings.compression_aux_saved_suffix', { defaultValue: '(gespeichert)' })}
                    </option>
                  )}
                  {modelsData?.models?.map((m: { id: string; name?: string }) => (
                    <option key={m.id} value={m.id}>
                      {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {!modelsData?.models || modelsData.models.length === 0
                    ? t('admin:ai_settings.compression_aux_empty_hint', { defaultValue: 'Erst im Hauptbereich die Modellliste abrufen — das Aux-Modell wird aus derselben Liste gewählt.' })
                    : t('admin:ai_settings.compression_aux_desc', { defaultValue: 'Günstigeres Modell für Summary-Calls (Aux-Pfad, nicht im Haupt-Loop). Leer = Hauptmodell.' })}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_persist_label', { defaultValue: 'Summary persistieren' })}
                </label>
                <div className="flex items-center justify-between gap-4 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                  <p className="text-sm text-white font-medium">
                    {compressionPersistSummary
                      ? t('admin:ai_settings.compression_persist_on_desc', { defaultValue: 'AN — Summary + getrimmte History werden in der Session-DB gespeichert (Recall bleibt möglich)' })
                      : t('admin:ai_settings.compression_persist_off_desc', { defaultValue: 'AUS — nur im laufenden Prozess komprimieren, nichts persistieren' })}
                  </p>
                  <input

                    type="checkbox"

                    checked={compressionPersistSummary}

                    onChange={(e) => setCompressionPersistSummary(e.target.checked)}

                    data-testid="compression-persist-toggle"

                    className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                  />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.compression_map_label', { defaultValue: 'Modell → Kontextfenster-Map (JSON)' })}
                </label>
                <textarea
                  value={compressionModelContextMap}
                  onChange={(e) => setCompressionModelContextMap(e.target.value)}
                  rows={4}
                  placeholder={'{ "mein-modell": { "window_tokens": 128000, "threshold_percent": 75 } }'}
                  data-testid="compression-model-map"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white font-mono focus:outline-none focus:border-accent-blue/40 transition-all leading-relaxed"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.compression_map_desc', { defaultValue: 'JSON-Map: Regex-Muster → Kontextfenster (window_tokens) + optional Schwelle (threshold_percent). Leer = Backend-Default (bekannte Modell-Familien, Fallback 128K). Modelle mit Fenster ≥ 512K gelten als natives Context-Management und werden ohne eigene Kompression durchgereicht.' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 3 (Parität): Memory (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.memory_section_label', { defaultValue: 'Memory (Gedächtnis & Recall)' })}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.memory_prefetch_label', { defaultValue: 'Query-Prefetch' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.memory_prefetch_desc', { defaultValue: 'Relevante Gedächtnis-Einträge pro Anfrage zuerst laden (nicht nur Budget-Injektion).' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={memoryPrefetchEnabled}

                  onChange={(e) => setMemoryPrefetchEnabled(e.target.checked)}

                  data-testid="memory-prefetch-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.memory_recall_status_label', { defaultValue: 'Recall-Status im Chat' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.memory_recall_status_desc', { defaultValue: 'Zeigt „🧠 erinnert an N Einträge“ unter der Antwort, wenn Prefetch griff.' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={memoryRecallStatusEnabled}

                  onChange={(e) => setMemoryRecallStatusEnabled(e.target.checked)}

                  data-testid="memory-recall-status-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.memory_auto_scan_label', { defaultValue: 'Auto-Memory-Scan' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.memory_auto_scan_desc', { defaultValue: 'Blockt Credentials/PII/merkwürdige Zeichen beim Speichern (additiv — bei 0 Treffern gelten die bestehenden Regeln).' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={memoryAutoScanEnabled}

                  onChange={(e) => setMemoryAutoScanEnabled(e.target.checked)}

                  data-testid="memory-auto-scan-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.memory_prefetch_timeout_label', { defaultValue: 'Prefetch-Timeout (Sekunden)' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={memoryPrefetchTimeoutS}
                  onChange={(e) => setMemoryPrefetchTimeoutS(e.target.value)}
                  placeholder="8"
                  data-testid="memory-prefetch-timeout"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.memory_prefetch_timeout_desc', { defaultValue: 'Ein hängender Memory-Load blockiert den Turn nie (non-fatal).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.memory_consolidation_label', { defaultValue: 'Konsolidierungs-Budget (Tokens)' })}
                </label>
                <input
                  type="number"
                  min="200"
                  max="4000"
                  step="100"
                  value={memoryConsolidationBudget}
                  onChange={(e) => setMemoryConsolidationBudget(e.target.value)}
                  placeholder="800"
                  data-testid="memory-consolidation-budget"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.memory_consolidation_desc', { defaultValue: 'Bei Überlauf werden älteste Notizen per LLM zusammengefasst statt gelöscht (im Hintergrund).' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 4 (Parität): Fehlerfestigkeit (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.guards_section_label', { defaultValue: 'Fehlerfestigkeit (Guards)' })}
                </label>
                <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">
                  {t('admin:ai_settings.guards_section_desc', { defaultValue: 'Empty-/Repetition-Guards, Tool-Guardrails, harte Loop-Deadline, Thinking-Scrubber. Leere Felder = Backend-Default.' })}
                </p>
              </div>
              <div className="flex items-center gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-2">
                <p className="text-xs text-white font-medium">{t('admin:ai_settings.thinking_scrub_label', { defaultValue: 'Thinking-Scrubber' })}</p>
                <input

                  type="checkbox"

                  checked={thinkingScrubEnabled}

                  onChange={(e) => setThinkingScrubEnabled(e.target.checked)}

                  data-testid="thinking-scrub-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.tool_call_retry_max_label', { defaultValue: 'Tool-Call-Retry-Max' })}
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={toolCallRetryMax}
                  onChange={(e) => setToolCallRetryMax(e.target.value)}
                  placeholder="2"
                  data-testid="tool-call-retry-max"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.tool_call_retry_max_desc', { defaultValue: 'Korrektur-Runden bei kaputtem JSON/Tool-Call (war hardcoded 2 — jetzt Admin-Config).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.empty_retry_budget_label', { defaultValue: 'Empty-Response-Budget' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={emptyRetryBudget}
                  onChange={(e) => setEmptyRetryBudget(e.target.value)}
                  placeholder="3"
                  data-testid="empty-retry-budget"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.empty_retry_budget_desc', { defaultValue: 'Leere LLM-Antworten: Retries bis zu diesem Budget, dann Abbruch mit sauberer Antwort.' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.empty_retry_cost_label', { defaultValue: 'Empty-Streak-Kostenlimit (USD)' })}
                </label>
                <input
                  type="number"
                  min="0.001"
                  max="1"
                  step="0.005"
                  value={emptyRetryCostThresholdUsd}
                  onChange={(e) => setEmptyRetryCostThresholdUsd(e.target.value)}
                  placeholder="0.05"
                  data-testid="empty-retry-cost"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.empty_retry_cost_desc', { defaultValue: 'Teurer leerer Streak bricht früher ab (geschätzte Kosten pro Versuch).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.guardrail_exact_label', { defaultValue: 'Guardrail: identischer Fehl-Call' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={toolGuardrailExactBlock}
                  onChange={(e) => setToolGuardrailExactBlock(e.target.value)}
                  placeholder="3"
                  data-testid="guardrail-exact-block"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.guardrail_exact_desc', { defaultValue: 'Gleicher Tool-Call mit gleichen Args > N× fehlgeschlagen → Hinweis ans Modell (fail-open).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.guardrail_progress_label', { defaultValue: 'Guardrail: No-Progress' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={toolGuardrailNoProgressBlock}
                  onChange={(e) => setToolGuardrailNoProgressBlock(e.target.value)}
                  placeholder="3"
                  data-testid="guardrail-no-progress"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.guardrail_progress_desc', { defaultValue: 'N Fehlschläge in Folge ohne Erfolg → Strategie-Hinweis ans Modell.' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.loop_deadline_label', { defaultValue: 'Loop-Deadline (Sekunden)' })}
                </label>
                <input
                  type="number"
                  min="10"
                  max="600"
                  step="10"
                  value={loopDeadlineS}
                  onChange={(e) => setLoopDeadlineS(e.target.value)}
                  placeholder="120"
                  data-testid="loop-deadline"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.loop_deadline_desc', { defaultValue: 'Harte Pipeline-Deadline: hängende Läufe terminieren garantiert, Antwort aus vorhandenen Ergebnissen.' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 5 (Parität): Sessions & Recall (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.recall_section_label', { defaultValue: 'Sessions & Recall' })}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white font-medium">{t('admin:ai_settings.recall_fts_label', { defaultValue: 'FTS-Ranking (PG-tsvector)' })}</p>
                  <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">{t('admin:ai_settings.recall_fts_desc', { defaultValue: 'Gewichtetes Ranking (Titel > Summary > Inhalt) + Recency-Bonus. AUS = immer neueste Sessions.' })}</p>
                </div>
                <input

                  type="checkbox"

                  checked={recallFtsEnabled}

                  onChange={(e) => setRecallFtsEnabled(e.target.checked)}

                  data-testid="recall-fts-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.recall_limit_label', { defaultValue: 'Recall-Treffer-Limit' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={recallSearchLimit}
                  onChange={(e) => setRecallSearchLimit(e.target.value)}
                  placeholder="10"
                  data-testid="recall-search-limit"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.recall_limit_desc', { defaultValue: 'Default-Trefferzahl für recall_sessions, wenn der Agent kein Limit angibt (explizite Agent-Limits gewinnen).' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 6 (Parität): Curator & Skills (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.skills_section_label', { defaultValue: 'Skills & Curator' })}
                </label>
                <p className="text-[11px] text-slate-400 font-sans leading-tight mt-1">
                  {t('admin:ai_settings.skills_section_desc', { defaultValue: 'Kompakte Skill-Injektion (Budget), Curator-Pflege (inaktiv bis aktiviert — NIE löschen).' })}
                </p>
              </div>
              <div className="flex items-center gap-3 bg-primary-dark border border-white/5 rounded-xl px-4 py-2">
                <p className="text-xs text-white font-medium">{t('admin:ai_settings.skill_curator_label', { defaultValue: 'Skill-Curator' })}</p>
                <input

                  type="checkbox"

                  checked={skillCuratorEnabled}

                  onChange={(e) => setSkillCuratorEnabled(e.target.checked)}

                  data-testid="skill-curator-toggle"

                  className="w-4 h-4 cursor-pointer accent-emerald-500 shrink-0"

                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.skill_inject_tokens_label', { defaultValue: 'Skill-Injektions-Budget (Tokens)' })}
                </label>
                <input
                  type="number"
                  min="200"
                  max="8000"
                  step="100"
                  value={skillInjectMaxTokens}
                  onChange={(e) => setSkillInjectMaxTokens(e.target.value)}
                  placeholder="2000"
                  data-testid="skill-inject-max-tokens"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.skill_inject_tokens_desc', { defaultValue: 'Maximale Token-Menge für Skill-Details im Prompt (Index Name+Description immer; volle Inhalte via vault_read).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.skill_top_k_label', { defaultValue: 'Skill-Top-K' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={skillInjectTopK}
                  onChange={(e) => setSkillInjectTopK(e.target.value)}
                  placeholder="5"
                  data-testid="skill-inject-top-k"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.skill_top_k_desc', { defaultValue: 'Anzahl relevanter Skills, die pro Anfrage injiziert werden.' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.skill_prune_days_label', { defaultValue: 'Inaktiv nach Tagen' })}
                </label>
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={skillPruneInactiveAfterDays}
                  onChange={(e) => setSkillPruneInactiveAfterDays(e.target.value)}
                  placeholder="30"
                  data-testid="skill-prune-days"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.skill_prune_days_desc', { defaultValue: 'Ungenutzte Skills werden als inaktiv markiert (status: inactive) — NIEMALS gelöscht, Reaktivierung bei Nutzung.' })}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.curator_interval_label', { defaultValue: 'Curator-Intervall (Stunden)' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="720"
                  value={curatorIntervalHours}
                  onChange={(e) => setCuratorIntervalHours(e.target.value)}
                  placeholder="24"
                  data-testid="curator-interval-hours"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.curator_interval_desc', { defaultValue: 'Wie oft der Skill-Curator läuft (inaktiv markieren + archivieren). Leer = 24h.' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.curator_archive_label', { defaultValue: 'Archivieren nach Tagen' })}
                </label>
                <input
                  type="number"
                  min="7"
                  max="3650"
                  value={curatorArchiveAfterDays}
                  onChange={(e) => setCuratorArchiveAfterDays(e.target.value)}
                  placeholder="60"
                  data-testid="curator-archive-days"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.curator_archive_desc', { defaultValue: 'Inaktive Skills werden nach N Tagen nach _louis/skills/_archive/ verschoben — NIEMALS gelöscht.' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 025 Phase 7 (Parität): MCP-Registry & Subagent (NULL = Backend-Default, Regel 12) */}
          <div className="space-y-4 md:col-span-2 border-t border-white/5 pt-4">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.mcp_subagent_section_label', { defaultValue: 'MCP & Sub-Agenten' })}
            </label>
            <p className="text-[11px] text-slate-400 font-sans leading-tight -mt-2">
              {t('admin:ai_settings.mcp_subagent_section_desc', { defaultValue: 'MCP-Tool-Cache (Refresh-Intervall, Timeout pro Aufruf), Sub-Agent-Deadline und Parallelität.' })}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.mcp_refresh_label', { defaultValue: 'MCP-Refresh-Intervall (Sekunden)' })}
                </label>
                <input
                  type="number"
                  min="30"
                  max="3600"
                  step="30"
                  value={mcpRefreshIntervalS}
                  onChange={(e) => setMcpRefreshIntervalS(e.target.value)}
                  placeholder="300"
                  data-testid="mcp-refresh-interval"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.mcp_refresh_desc', { defaultValue: 'TTL-Cache für die MCP-Tool-Liste (DB-Read nicht bei jedem Request). Discovery-Lock verhindert Doppel-Refresh.' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.subtask_timeout_label', { defaultValue: 'Sub-Agent-Deadline (Sekunden)' })}
                </label>
                <input
                  type="number"
                  min="30"
                  max="600"
                  step="10"
                  value={subtaskTimeoutS}
                  onChange={(e) => setSubtaskTimeoutS(e.target.value)}
                  placeholder="120"
                  data-testid="subtask-timeout"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.subtask_timeout_desc', { defaultValue: 'Hängende Sub-Agenten terminieren garantiert (Checkpointing persistiert PENDING → SUCCESS/FAILED).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.subtask_parallel_label', { defaultValue: 'Sub-Agenten parallel (max.)' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={subtaskMaxParallel}
                  onChange={(e) => setSubtaskMaxParallel(e.target.value)}
                  placeholder="2"
                  data-testid="subtask-max-parallel"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.subtask_parallel_desc', { defaultValue: 'Maximal gleichzeitig laufende Sub-Agenten (war hardcoded 3 — jetzt Admin-Config, Regel 12).' })}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {t('admin:ai_settings.subtask_depth_label', { defaultValue: 'Sub-Agenten-Tiefe (max.)' })}
                </label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={subtaskMaxDepth}
                  onChange={(e) => setSubtaskMaxDepth(e.target.value)}
                  placeholder="3"
                  data-testid="subtask-max-depth"
                  className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                />
                <p className="text-[11px] text-slate-400 font-sans leading-tight">
                  {t('admin:ai_settings.subtask_depth_desc', { defaultValue: 'Maximale Delegations-Tiefe (Sub-Agent darf selbst delegieren bis zu dieser Ebene). Leer = 3.' })}
                </p>
              </div>
            </div>
          </div>

          {/* Auftrag 037 P1: Audit-Log-Retention (leer = kein Auto-Prune, Regel 12) */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.audit_retention_label', { defaultValue: 'Audit-Log Aufbewahrung (Tage)' })}
            </label>
            <input
              type="number"
              min="1"
              max="3650"
              value={auditRetentionDays}
              onChange={(e) => setAuditRetentionDays(e.target.value)}
              placeholder="Leer = kein Auto-Prune"
              data-testid="audit-retention-days"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.audit_retention_desc', { defaultValue: 'Tage, nach denen Audit-Einträge automatisch gelöscht werden (Scheduler-Prune). Leer = kein automatisches Löschen (empfohlen für Compliance-Historie).' })}
            </p>
          </div>

          {/* Auftrag 038 P1: Session-Retention (leer = kein Auto-Prune, Regel 12) */}
          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.session_retention_label', { defaultValue: 'Chat-Verlauf Aufbewahrung (Tage)' })}
            </label>
            <input
              type="number"
              min="1"
              max="3650"
              value={sessionRetentionDays}
              onChange={(e) => setSessionRetentionDays(e.target.value)}
              placeholder="Leer = kein Auto-Prune"
              data-testid="session-retention-days"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.session_retention_desc', { defaultValue: 'Tage, nach denen inaktive Chat-Sessions automatisch gelöscht werden (Scheduler-Prune; Kinder werden verwaist). Leer = kein automatisches Löschen.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.early_exit_after_tools_label', { defaultValue: 'Early-Exit nach N Tools' })}
            </label>
            <input
              type="number"
              min="1"
              max="20"
              value={earlyExitAfterTools}
              onChange={(e) => setEarlyExitAfterTools(e.target.value)}
              placeholder="4"
              data-testid="react-early-exit-tools"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.early_exit_after_tools_desc', { defaultValue: 'Nach dieser Anzahl ausgeführter Tools erzwingt der Agent die Antwort (verhindert Endlosschleifen).' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.react_keep_last_results_label', { defaultValue: 'Voll eingebettete letzte Ergebnisse' })}
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={reactKeepLastResults}
              onChange={(e) => setReactKeepLastResults(e.target.value)}
              placeholder="2"
              data-testid="react-keep-last-results"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.react_keep_last_results_desc', { defaultValue: 'Wie viele der neuesten Tool-Ergebnisse dem Agenten vollständig angezeigt werden; ältere werden zusammengefasst.' })}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.react_compaction_from_iteration_label', { defaultValue: 'Zusammenfassung ab Iteration' })}
            </label>
            <input
              type="number"
              min="2"
              max="20"
              value={reactCompactionFromIteration}
              onChange={(e) => setReactCompactionFromIteration(e.target.value)}
              placeholder="3"
              data-testid="react-compaction-from-iteration"
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
            />
            <p className="text-[11px] text-slate-400 font-sans leading-tight">
              {t('admin:ai_settings.react_compaction_from_iteration_desc', { defaultValue: 'Ab dieser Iteration werden ältere Tool-Ergebnisse kompakt zusammengefasst statt voll eingebettet.' })}
            </p>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              setMaxIterations("");
              setMaxHistoryTokens("");
              setToolResultTruncateChars("");
              setReactKeepLastResults("");
              setReactCompactionFromIteration("");
              setEarlyExitAfterTools("");
            }}
            className="px-4 py-2.5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-all rounded-xl font-bold uppercase text-[11px] tracking-widest cursor-pointer"
          >
            {t('admin:ai_settings.runtime_reset_defaults', { defaultValue: 'Auf Defaults zurücksetzen' })}
          </button>
          <button
            type="button"
            onClick={handleSaveProviderSettings}
            disabled={saveMutation.isPending}
            className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg hover:shadow-accent-orange/20 cursor-pointer"
          >
            {saveMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Check size={14} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Text-Generator Settings Panel placed after RAG */}
      <TextGeneratorSettingsPanel />

      {/* STT Settings Panel */}
      <STTSettingsPanel />
    </div>
  );
};
