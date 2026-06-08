import React, { useEffect, useState, useRef } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { Brain, Save, Shield, Settings, Info, Trash2, Edit2, Plus, Check, X, FileText, UploadCloud, ChevronDown, ChevronUp, Sparkles, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KnowledgeFile, ChatNote, Company, Contact } from '../../types';

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
  const [modelName, setModelName] = useState('gemini-3.5-flash');

  useEffect(() => {
    if (textGenConfig) {
      setSystemPrompt(textGenConfig.system_prompt || '');
      setTemperature(textGenConfig.temperature ?? 0.7);
      setMaxTokens(textGenConfig.max_tokens ?? 2000);
      setModelName(textGenConfig.model_name || 'gemini-3.5-flash');
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
          <p className="text-[10px] text-slate-500 font-sans mt-0.5">{t('admin:ai_settings.text_gen_desc')}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.system_instructions_label')}</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500/40 transition-all font-sans leading-relaxed"
            placeholder={t('admin:ai_settings.system_instructions_placeholder')}
          />
          <p className="text-[9px] text-slate-500 font-mono italic">{t('admin:ai_settings.system_instructions_desc')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Temperature Slider */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center bg-transparent">
              <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.creativity_label')}</label>
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
            <p className="text-[9px] text-slate-500 font-mono">{t('admin:ai_settings.creativity_desc')}</p>
          </div>

          {/* Max Tokens */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-slate-300 uppercase tracking-widest font-display">{t('admin:ai_settings.max_tokens_label')}</label>
            <input
              type="number"
              min="100"
              max="16000"
              value={maxTokens}
              onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2000)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/40 transition-all font-sans"
            />
            <p className="text-[9px] text-slate-500 font-mono">{t('admin:ai_settings.max_tokens_desc')}</p>
          </div>
        </div>

        <div className="border-t border-white/5 pt-4 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveTextGeneratorMutation.isPending}
            className="bg-gradient-to-tr from-emerald-500 to-emerald-600 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[10px] tracking-widest px-5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg cursor-pointer"
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

export const LouisAiSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [providerType, setProviderType] = useState<'gemini' | 'ollama' | 'openai' | 'anthropic'>('gemini');
  const [modelName, setModelName] = useState('gemini-3.5-flash');
  const [apiKeySecret, setApiKeySecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [temperature, setTemperature] = useState(0.2);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(40);
  const [numCtx, setNumCtx] = useState(8192);

  // RAG Configuration States
  const [embeddingProvider, setEmbeddingProvider] = useState<'gemini' | 'ollama' | 'openai'>('gemini');
  const [embeddingApiKeySecret, setEmbeddingApiKeySecret] = useState('');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
  const [embeddingModelName, setEmbeddingModelName] = useState('text-embedding-004');
  const [vectorDimensions, setVectorDimensions] = useState(1536);
  const [keepAliveMinutes, setKeepAliveMinutes] = useState(5);
  const [parallelSlots, setParallelSlots] = useState(1);
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [ragExpanded, setRagExpanded] = useState(false);

  const [shouldFetchModels, setShouldFetchModels] = useState(false);
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
  const [preferencesText, setPreferencesText] = useState('');

  // Memory load
  const { data: memory, refetch: refetchMemory } = trpc.getUserMemory.useQuery();

  // Additional Queries for mapping human names & managing files
  const { data: contacts = [] } = trpc.getContacts.useQuery();
  const { data: companies = [] } = trpc.getCompanies.useQuery();
  const { data: kFiles = [], refetch: refetchKFiles } = trpc.getKnowledgeFiles.useQuery();

  // New states for the active tabs, edits, manual additions
  const [activeMemoryTab, setActiveMemoryTab] = useState<'user' | 'files'>('user');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteType, setNewNoteType] = useState<'user' | 'contact' | 'company'>('user');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTargetId, setNewNoteTargetId] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState<string[]>([]);

  const [newNoteIsRagIndexed, setNewNoteIsRagIndexed] = useState(true);
  const [togglingNoteRagId, setTogglingNoteRagId] = useState<string | null>(null);

  // Mutations
  const editNoteMutation = trpc.editEntityNote.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_updated_success', { defaultValue: 'Notiz erfolgreich aktualisiert!' }));
      refetchMemory();
      // Invalidate queries so that updated listings reflect instantly in local views
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setEditingNoteId(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_updated_error', { defaultValue: 'Fehler beim Aktualisieren: ' }) + err.message);
    }
  });

  const deleteNoteMutation = trpc.deleteEntityNote.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_deleted_success', { defaultValue: 'Notiz erfolgreich gelöscht!' }));
      refetchMemory();
      // Invalidate queries so that updated listings reflect instantly in local views
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setDeletingNoteId(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_deleted_error', { defaultValue: 'Fehler beim Löschen: ' }) + err.message);
      setDeletingNoteId(null);
    }
  });

  const addNoteMutation = trpc.saveNoteToEntity.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_added_success', { defaultValue: 'Wissensnotiz manuell hinzugefügt!' }));
      refetchMemory();
      refetchKFiles();
      // Invalidate queries so that updated listings reflect instantly in local views
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setIsAddingNote(false);
      setNewNoteContent('');
      setNewNoteTargetId('');
      setNewNoteIsRagIndexed(true);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_added_error', { defaultValue: 'Fehler beim Hinzufügen der Notiz: ' }) + err.message);
    }
  });

  const toggleRagMutation = trpc.toggleNoteRagIndex.useMutation({
    onSuccess: (_, variables: void | { id_uuid: string; is_rag_indexed: boolean }) => {
      const isIndexed = (variables && variables.is_rag_indexed) ? true : false;
      toast.success(isIndexed 
        ? t('admin:toast_rag_toggle_success_index', { defaultValue: 'Wissensnotiz erfolgreich indiziert!' })
        : t('admin:toast_rag_toggle_success_remove', { defaultValue: 'Wissensnotiz erfolgreich aus RAG entfernt!' })
      );
      setTogglingNoteRagId(null);
      refetchMemory();
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_rag_toggle_error', { defaultValue: 'RAG-Umschaltung fehlgeschlagen: ' }) + err.message);
      setTogglingNoteRagId(null);
    }
  });

  const handleToggleNoteRag = (id_uuid: string, is_rag_indexed: boolean) => {
    setTogglingNoteRagId(id_uuid);
    toggleRagMutation.mutate({ id_uuid, is_rag_indexed });
  };

  const saveKFileMutation = trpc.saveKnowledgeFile.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_file_uploaded_success', { defaultValue: 'Wissensdokument hochgeladen!' }));
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_uploaded_error', { defaultValue: 'Fehler beim Hochladen der Datei: ' }) + err.message);
    }
  });

  const deleteKFileMutation = trpc.deleteKnowledgeFile.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_file_deleted_success', { defaultValue: 'Wissensdokument gelöscht!' }));
      refetchKFiles();
      setDeletingFileName(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_deleted_error', { defaultValue: 'Fehler beim Löschen der Datei: ' }) + err.message);
      setDeletingFileName(null);
    }
  });

  const [ingestingKFile, setIngestingKFile] = useState<string | null>(null);

  const ingestKFileMutation = trpc.forceIngestKnowledgeToRag.useMutation({
    onSuccess: (data) => {
      toast.success(t('admin:toast_file_rag_success', { name: ingestingKFile || '', count: data.chunkCount, defaultValue: `Datei "${ingestingKFile || ''}" erfolgreich im CRM RAG indiziert! (${data.chunkCount} Textblöcke generiert)` }));
      setIngestingKFile(null);
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_rag_error', { defaultValue: 'RAG Ingest fehlgeschlagen: ' }) + err.message);
      setIngestingKFile(null);
    }
  });

  const handleManualIngestKFile = (filename: string) => {
    setIngestingKFile(filename);
    ingestKFileMutation.mutate({ filename });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Content = result.split(',')[1];
      saveKFileMutation.mutate({
        filename: file.name,
        content: base64Content
      });
    };
    reader.readAsDataURL(file);
  };

  const updateMemoryMutation = trpc.updateUserMemory.useMutation({
    onSuccess: () => {
      refetchMemory();
    },
    onError: (err) => {
      toast.error(t('user_memory_save_failed', { defaultValue: "Fehler beim Sichern des Langzeitgedächtnisses: " }) + err.message);
    }
  });

  const saveMutation = trpc.saveConfig.useMutation({
    onSuccess: () => {
      toast.success(t('ai_settings_saved_success', { defaultValue: "LOUIS AI Einstellungen und Langzeitgedächtnis erfolgreich gespeichert!" }));
      refetch();
    },
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
      setEmbeddingProvider(config.embedding_provider || 'gemini');
      setEmbeddingApiKeySecret(config.embedding_api_key_secret || '');
      setEmbeddingBaseUrl(config.embedding_base_url || '');
      setEmbeddingModelName(config.embedding_model_name || 'text-embedding-004');
      setVectorDimensions(config.vector_dimensions || 1536);
      setKeepAliveMinutes(config.keep_alive_minutes ?? 5);
      setParallelSlots(config.parallel_slots ?? 1);
      setChunkSize(config.chunk_size ?? 500);
      setChunkOverlap(config.chunk_overlap ?? 50);
    }
  }, [config]);

  useEffect(() => {
    if (memory) {
      setPreferencesText(memory.response_preferences_text || '');
    }
  }, [memory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      provider_type: providerType,
      model_name: modelName,
      api_key_secret: apiKeySecret || null,
      base_url: baseUrl || null,
      temperature,
      top_p: topP,
      top_k: topK,
      num_ctx: numCtx,

      // RAG Config Save
      embedding_provider: embeddingProvider,
      embedding_api_key_secret: embeddingApiKeySecret || null,
      embedding_base_url: embeddingBaseUrl || null,
      embedding_model_name: embeddingModelName,
      vector_dimensions: Number(vectorDimensions),
      keep_alive_minutes: Number(keepAliveMinutes),
      parallel_slots: Number(parallelSlots),
      chunk_size: Number(chunkSize),
      chunk_overlap: Number(chunkOverlap)
    });
    updateMemoryMutation.mutate({
      response_preferences_text: preferencesText
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
    <form onSubmit={handleSubmit} className="space-y-8">
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Provider Select */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:ai_settings.provider_label')}
          </label>
          <select
            value={providerType}
            onChange={(e) => {
              const val = e.target.value as 'gemini' | 'ollama' | 'openai' | 'anthropic';
              setProviderType(val);
              if (val === 'gemini') setModelName('gemini-3.5-flash');
              else if (val === 'openai') setModelName('gpt-4o');
              else if (val === 'anthropic') setModelName('claude-3-5-sonnet');
              else setModelName('llama3');
            }}
            className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans"
          >
            <option value="gemini">Google Gemini AI (Standard / Recommended)</option>
            <option value="ollama">Ollama Local Agent (Offline / Custom Server)</option>
            <option value="openai">OpenAI GPT Engines</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>

        {/* Model Name */}
        <div className="space-y-2 col-span-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:ai_settings.model_name_label')}
          </label>
          <input
            type="text"
            required
            id="ai-model-name-input"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
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
            className="mt-2 text-[10px] font-black uppercase tracking-wider text-accent-orange hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:ai_settings.base_url_label')}
          </label>
          <input
            type="text"
            id="ai-base-url-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
            placeholder="http://localhost:11434"
            autoComplete="off"
          />
        </div>

        {/* Secret Key Input */}
        <div className="space-y-2 col-span-1">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
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
                <span className="text-[10px] text-accent-orange font-bold font-mono">
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
                      <span className="text-[10px] text-slate-400 font-medium mt-1">
                        {m.name}
                      </span>
                    )}
                    {m.description && (
                      <span className="text-[9px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
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
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400 font-display">
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
            <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400 font-display">
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
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.top_k_label', { defaultValue: 'Token-Einstufung (Top K)' })}
            </label>
            <input
              type="number"
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value) || 40)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
            />
          </div>

          {/* Context Token Limit */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:ai_settings.num_ctx_label', { defaultValue: 'Kontext-Sitzungsfenster (Max Tokens)' })}
            </label>
            <input
              type="number"
              value={numCtx}
              onChange={(e) => setNumCtx(parseInt(e.target.value) || 8192)}
              className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-mono"
            />
          </div>
        </div>
      </div>

      {/* 🔮 Collapsible RAG & Vector Embedding Engine Configuration Accordion */}
      <div className="border-t border-white/5 pt-6 space-y-4">
        <div 
          onClick={() => setRagExpanded(!ragExpanded)}
          className="flex justify-between items-center cursor-pointer bg-primary-light/10 hover:bg-white/5 p-4 rounded-xl border border-white/5 transition-all select-none"
        >
          <div className="flex items-center gap-3">
            <Settings className="text-accent-blue" size={18} />
            <div>
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-300 font-display">
                {t('admin:ai_settings.rag_accordion_title', { defaultValue: '🔮 RAG Wissens-Engine & Vektor-Embeddings' })}
              </h4>
              <p className="text-[10px] text-slate-500 font-medium">
                {t('admin:ai_settings.rag_accordion_desc', { defaultValue: 'Schnittstellen für Dokumentensplitting, Vektorenabmessungen und Inhalts-Chunking (Ollama, Gemini, OpenAI).' })}
              </p>
            </div>
          </div>
          <button type="button" className="text-slate-400 focus:outline-none">
            {ragExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>

        {ragExpanded && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-primary-dark/30 border border-white/5 p-6 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent-blue/5 blur-2xl rounded-full" />
            
            {/* Embedding Provider Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
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
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.rag_model_name_label', { defaultValue: 'Vektor-Modellname' })}
              </label>
              <input
                type="text"
                required
                value={embeddingModelName}
                onChange={(e) => setEmbeddingModelName(e.target.value)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                placeholder="text-embedding-004"
                autoComplete="off"
              />
            </div>

            {/* Connection endpoint */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.rag_base_url_label', { defaultValue: 'Embedding Server Basis-URL (Optional)' })}
              </label>
              <input
                type="text"
                value={embeddingBaseUrl}
                onChange={(e) => setEmbeddingBaseUrl(e.target.value)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-blue/40 transition-all font-mono"
                placeholder="z.B. http://localhost:11434 oder https://api.openai.com/v1"
                autoComplete="off"
              />
            </div>

            {/* Embedding secret key */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
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
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400 font-display">
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
              <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-slate-400 font-display">
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
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
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
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
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
        )}
      </div>

      {/* Text-Generator Settings Panel placed between RAG and Memory */}
      <TextGeneratorSettingsPanel />

      <div className="border-t border-white/5 pt-6 space-y-6">
        <div>
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display mb-2">
            {t('admin:ai_settings.memory_title', { defaultValue: '🧠 AI Langzeitgedächtnis & Antwortpräferenzen (User Memory)' })}
          </h4>
          <p className="text-slate-500 text-[11px] leading-relaxed max-w-2xl font-medium">
            {t('admin:ai_settings.memory_desc', { defaultValue: 'Personalisiere das Langzeitgedächtnis deines LOUIS ReAct Agenten. Hinterlege globale Abmachungen, Antwortstile oder systemweite Persona-Richtlinien. Zudem sichte hier die im Kurzzeitgedächtnis automatisch aggregierten CRM-Notizen.' })}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:ai_settings.memory_preferences_label', { defaultValue: 'Globale Antwort-Präferenzen & Verhaltensanweisungen' })}
          </label>
          <textarea
            value={preferencesText}
            onChange={(e) => setPreferencesText(e.target.value)}
            rows={4}
            className="w-full bg-primary-dark border border-white/5 rounded-xl p-4 text-xs leading-relaxed text-white font-medium focus:outline-none focus:border-accent-orange/40 focus:ring-1 focus:ring-accent-orange/25"
            placeholder={t('admin:ai_settings.memory_preferences_placeholder', { defaultValue: 'z.B. Du bist ein professioneller, steuerrechtlich sensibilisierter Finanzassistent. Antworte immer auf Deutsch, halte Angebote tabellarisch und formuliere kurz gefasst.' })}
          />
        </div>

        {/* Langzeitgedächtnis & Interne Wissensdatenbank */}
        <div className="space-y-4 border-t border-white/5 pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.memory_db_label', { defaultValue: '🧠 Langzeitgedächtnis & Wissensdatenbank' })}
              </label>
              <p className="text-[10px] text-slate-500 font-medium">
                {t('admin:ai_settings.memory_db_desc', { defaultValue: 'Pflegetools für dauerhafte AI-Kontexte, Kundenprofile und begleitendes RAG-Hintergrundwissen.' })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsAddingNote(true);
                setNewNoteType('user');
                setNewNoteContent('');
                setNewNoteTargetId('');
              }}
              className="bg-accent-orange/10 border border-accent-orange/20 text-accent-orange hover:bg-accent-orange/20 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all self-start sm:self-center"
            >
              <Plus size={12} />
              {t('admin:ai_settings.memory_add_note_btn', { defaultValue: 'Notiz hinzufügen' })}
            </button>
          </div>

          {/* Sub-tabs selection */}
          <div className="flex flex-wrap gap-1 border-b border-white/5 pb-1">
            <button
              type="button"
              onClick={() => { setActiveMemoryTab('user'); setIsAddingNote(false); }}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                activeMemoryTab === 'user'
                  ? 'bg-accent-orange text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('admin:ai_settings.memory_tab_user', { defaultValue: 'Eigene Notizen / Wissen' })}
            </button>
            <button
              type="button"
              onClick={() => { setActiveMemoryTab('files'); setIsAddingNote(false); }}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                activeMemoryTab === 'files'
                  ? 'bg-accent-orange text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('admin:ai_settings.memory_tab_files', { count: kFiles.length, defaultValue: `Wissensdokumente (${kFiles.length})` })}
            </button>
          </div>

          {/* Manual note form */}
          {isAddingNote && (
            <div className="bg-primary-dark border border-accent-orange/30 p-5 rounded-2xl space-y-4 mb-4">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h5 className="text-[11px] font-black text-white uppercase tracking-widest font-display">
                  {t('admin:ai_settings.memory_add_form_title', { defaultValue: 'Wissensnotiz manuell hinzufügen' })}
                </h5>
                <button 
                  type="button" 
                  onClick={() => setIsAddingNote(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    {t('admin:ai_settings.memory_content_label', { defaultValue: 'Inhalt (Markdown)' })}
                  </label>
                  <textarea
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    required
                    rows={5}
                    placeholder={t('admin:ai_settings.memory_content_placeholder', { defaultValue: 'Trage hier dein Wissen, eine Gesprächszusammenfassung oder Systemrichtlinien ein...' })}
                    className="w-full bg-[#0d1527] border border-white/5 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="newNoteIsRagIndexed"
                    checked={newNoteIsRagIndexed}
                    onChange={(e) => setNewNoteIsRagIndexed(e.target.checked)}
                    className="rounded border-white/5 bg-[#0d1527] text-accent-orange focus:ring-accent-orange/40 focus:ring-1 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
                  />
                  <label htmlFor="newNoteIsRagIndexed" className="text-[10px] font-bold text-slate-300 select-none cursor-pointer flex items-center gap-1.5 hover:text-white transition-colors">
                    <Sparkles size={11} className="text-amber-400" />
                    {t('admin:ai_settings.memory_rag_checkbox_label', { defaultValue: 'Direkt in die RAG-Wissensdatenbank (Vektor-Kurzzeitgedächtnis) aufnehmen' })}
                  </label>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!newNoteContent.trim()) {
                      toast.error(t('admin:toast_content_empty_error', { defaultValue: 'Inhalt darf nicht leer sein.' }));
                      return;
                    }
                    addNoteMutation.mutate({
                      entity_type: newNoteType,
                      entity_id: undefined,
                      content: newNoteContent,
                      is_rag_indexed: newNoteIsRagIndexed
                    });
                  }}
                  disabled={addNoteMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-accent-orange text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 hover:scale-105 active:scale-95 transition-transform duration-200 cursor-pointer"
                >
                  {addNoteMutation.isPending ? "..." : <Check size={12} />}
                  {t('admin:ai_settings.note_action_save', { defaultValue: 'Speichern' })}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingNote(false)}
                  className="px-4 py-2 rounded-xl border border-white/5 text-slate-400 text-[10px] font-black uppercase tracking-wider hover:text-white animate-pulse"
                >
                  {t('admin:ai_settings.note_action_cancel', { defaultValue: 'Abbrechen' })}
                </button>
              </div>
            </div>
          )}

          {/* Tab contents */}
          {activeMemoryTab === 'files' ? (
            <div className="space-y-4">
              {/* File upload zone */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-white/5 hover:border-accent-orange/30 p-8 rounded-2xl bg-primary-dark/30 hover:bg-primary-dark/50 transition-all text-center cursor-pointer group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept=".pdf,.txt,.doc,.docx,.md"
                />
                <UploadCloud className="mx-auto text-slate-500 group-hover:text-accent-orange mb-2 transition-colors" size={28} />
                <span className="block text-xs text-white font-semibold">
                  {t('admin:ai_settings.files_upload_title', { defaultValue: 'Dateien hier hochladen (.pdf, .txt, .md, .docx)' })}
                </span>
                <span className="block text-[9px] text-slate-500 font-mono mt-1">
                  {t('admin:ai_settings.files_upload_desc', { defaultValue: 'Werden im Louis System-Tresor zur RAG-Dokumentenverarbeitung bereitgestellt' })}
                </span>
              </div>

              {/* Files Table / List */}
              {kFiles.length === 0 ? (
                <div className="p-6 text-center bg-primary-dark/30 border border-white/5 rounded-2xl">
                  <p className="text-xs text-slate-500 font-mono italic font-medium">
                    {t('admin:ai_settings.files_empty', { defaultValue: 'Keine Systemdokumente hochgeladen.' })}
                  </p>
                </div>
              ) : (
                <div className="bg-primary-dark/50 border border-white/5 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs text-slate-300 font-medium">
                    <thead className="bg-[#050B14] text-[9px] text-slate-400 uppercase tracking-widest font-black">
                      <tr>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_name', { defaultValue: 'Dateiname' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_size', { defaultValue: 'Größe' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_mtime', { defaultValue: 'Aktualisiert' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_status', { defaultValue: 'RAG-Status' })}</th>
                        <th className="px-4 py-3 text-right">{t('admin:ai_settings.files_col_action', { defaultValue: 'Aktion' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(kFiles as KnowledgeFile[]).map((f: KnowledgeFile) => (
                        <tr key={f.name} className="hover:bg-white/[0.01] transition-colors">
                          <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                            <FileText size={14} className="text-accent-blue scale-110" />
                            {f.name}
                          </td>
                          <td className="px-4 py-3 text-slate-400 font-mono">
                            {(f.size / 1024).toFixed(1)} KB
                          </td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-[10px]">
                            {new Date(f.mtime).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            {f.isIndexed ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={`${f.chunkCount} RAG Chunks successfully indexed in database`}>
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                <span>{t('admin:ai_settings.files_status_ready', { count: f.chunkCount, defaultValue: `RAG READY (${f.chunkCount} chunks)` })}</span>
                              </span>
                            ) : (() => {
                              const ext = f.name.split('.').pop()?.toLowerCase() || '';
                              const isRAGCompatible = ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
                              
                              if (ingestingKFile === f.name) {
                                return (
                                  <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full animate-pulse">
                                    <Loader2 size={8} className="animate-spin text-amber-400" />
                                    <span>{t('admin:ai_settings.files_status_progress', { defaultValue: 'IN PROGRESS...' })}</span>
                                  </span>
                                );
                              }
                              
                              if (isRAGCompatible) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleManualIngestKFile(f.name)}
                                    className="inline-flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50 text-amber-300 text-[8px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full cursor-pointer transition-all active:scale-95 text-shadow-sm hover:shadow-amber-500/20 shadow-sm"
                                    title={t('admin:ai_settings.files_status_action_ingest_tooltip', { defaultValue: 'Dieses Dokument parsen und für die Louis KI im RAG-Vektorspeicher bereitstellen' })}
                                  >
                                    <Sparkles size={8} className="text-amber-400 animate-pulse" />
                                    <span>{t('admin:ai_settings.files_status_action_ingest', { defaultValue: 'IN RAG AUFNEHMEN' })}</span>
                                  </button>
                                );
                              } else {
                                return (
                                  <span className="inline-flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                                    <span>{t('admin:ai_settings.files_status_archive', { defaultValue: 'ABLAGE' })}</span>
                                  </span>
                                );
                              }
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {deletingFileName === f.name ? (
                              <div className="flex items-center justify-end gap-1.5 animate-fadeIn">
                                <span className="text-[9px] text-slate-400 font-bold uppercase mr-1">{t('admin:ai_settings.confirm_delete_prompt', { defaultValue: 'Löschen?' })}</span>
                                <button
                                  type="button"
                                  onClick={() => deleteKFileMutation.mutate({ filename: f.name })}
                                  disabled={deleteKFileMutation.isPending}
                                  className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[9px] font-bold transition-all cursor-pointer"
                                >
                                  {t('admin:ai_settings.confirm_yes', { defaultValue: 'Ja' })}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingFileName(null)}
                                  className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[9px] font-bold transition-all cursor-pointer"
                                >
                                  {t('admin:ai_settings.confirm_no', { defaultValue: 'Nein' })}
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setDeletingFileName(f.name)}
                                className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition-colors cursor-pointer"
                                title={t('admin:ai_settings.files_delete_tooltip', { defaultValue: 'Datei löschen' })}
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Filter and display memory notes based on tab */}
              {(() => {
                const filteredNotes = ((memory?.chat_notes_json || []) as ChatNote[]).filter(
                  (note: ChatNote) => note.entity_type === activeMemoryTab
                );

                if (filteredNotes.length === 0) {
                  return (
                    <div className="p-6 text-center bg-primary-dark/30 border border-white/5 rounded-2xl">
                      <p className="text-xs text-slate-500 font-mono italic">
                        {activeMemoryTab === 'user' 
                          ? t('admin:ai_settings.notes_empty_user', { defaultValue: 'Bislang wurden keine internen Wissensnotizen angelegt.' })
                          : activeMemoryTab === 'contact' 
                          ? t('admin:ai_settings.notes_empty_contact', { defaultValue: 'Keine importierten Kontaktnotizen vorhanden.' })
                          : t('admin:ai_settings.notes_empty_company', { defaultValue: 'Keine importierten Firmennotizen vorhanden.' })}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredNotes.map((note: ChatNote) => {
                      const isEditing = editingNoteId === note.id_uuid;
                      const isExpanded = expandedNoteIds.includes(note.id_uuid);

                      // Map entity target humans for clarity
                      let targetLabel = t('admin:ai_settings.note_target_user_admin', { defaultValue: 'Eigene Wissensdatenbank (Admin)' });
                      if (note.entity_type === 'contact' && note.entity_id) {
                        const contactObj = (contacts as Contact[]).find((c: Contact) => c.id_uuid === note.entity_id);
                        targetLabel = contactObj 
                          ? `${contactObj.first_name || ''} ${contactObj.last_name || ''}`.trim() || contactObj.email_address || ''
                          : t('admin:ai_settings.note_target_contact_id', { id: note.entity_id.slice(0, 8), defaultValue: `Kontakt (ID: ${note.entity_id.slice(0, 8)})` });
                      } else if (note.entity_type === 'company' && note.entity_id) {
                        const companyObj = (companies as Company[]).find((c: Company) => c.id_uuid === note.entity_id);
                        targetLabel = companyObj 
                          ? companyObj.full_legal_name 
                          : t('admin:ai_settings.note_target_company_id', { id: note.entity_id.slice(0, 8), defaultValue: `Unternehmen (ID: ${note.entity_id.slice(0, 8)})` });
                      }

                      return (
                        <div 
                          key={note.id_uuid} 
                          className="bg-primary-dark/80 border border-white/5 p-4 rounded-2xl relative overflow-hidden group hover:border-accent-orange/20 transition-all font-sans flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2 mb-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[9px] font-mono uppercase bg-accent-orange/10 border border-accent-orange/20 text-accent-orange px-2 py-0.5 rounded-full font-bold w-fit">
                                  {targetLabel}
                                </span>
                                {note.is_rag_indexed ? (
                                  <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('admin:ai_settings.note_badge_rag_active_tooltip', { defaultValue: 'In RAG-Wissensdatenbank integriert' })}>
                                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                    <span>{t('admin:ai_settings.note_badge_rag_active', { defaultValue: 'RAG AKTIV' })}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('admin:ai_settings.note_badge_no_rag_tooltip', { defaultValue: 'Nicht im RAG-Vektorspeicher' })}>
                                    <span>{t('admin:ai_settings.note_badge_no_rag', { defaultValue: 'KEIN RAG' })}</span>
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-slate-500 font-mono">
                                {new Date(note.created_at_utc).toLocaleDateString()}
                              </span>
                            </div>

                            {isEditing ? (
                              <textarea
                                value={editingNoteContent}
                                onChange={(e) => setEditingNoteContent(e.target.value)}
                                rows={4}
                                className="w-full bg-[#0d1527] border border-accent-orange/40 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange/25"
                              />
                            ) : (
                              <div
                                onClick={() => {
                                  if (note.content && note.content.length > 150) {
                                    setExpandedNoteIds(prev => 
                                      prev.includes(note.id_uuid) 
                                        ? prev.filter(id => id !== note.id_uuid) 
                                        : [...prev, note.id_uuid]
                                    );
                                  }
                                }}
                                className={note.content && note.content.length > 150 ? "cursor-pointer group/note select-none" : ""}
                              >
                                <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium whitespace-pre-wrap">
                                  {note.content && note.content.length > 150 && !isExpanded
                                    ? `${note.content.substring(0, 150)}...`
                                    : note.content
                                  }
                                </p>
                                {note.content && note.content.length > 150 && (
                                  <div className="mt-2.5 flex items-center gap-1 text-[10px] text-accent-orange font-bold uppercase tracking-wider group-hover/note:text-accent-orange/80 transition-colors">
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp size={10} /> {t('admin:ai_settings.note_show_less', { defaultValue: 'Weniger anzeigen' })}
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown size={10} /> {t('admin:ai_settings.note_show_more', { defaultValue: 'Mehr anzeigen' })}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-2.5 border-t border-white/5 flex items-center justify-between">
                            <span className="text-[9px] text-slate-500 font-mono">
                              id_uuid: {note.id_uuid.slice(0, 8)}...
                            </span>
                            
                            <div className="flex items-center gap-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!editingNoteContent.trim()) {
                                        toast.error(t('admin:toast_content_empty_error', { defaultValue: 'Inhalt darf nicht leer sein.' }));
                                        return;
                                      }
                                      editNoteMutation.mutate({
                                        id_uuid: note.id_uuid,
                                        content: editingNoteContent
                                      });
                                    }}
                                    disabled={editNoteMutation.isPending}
                                    className="p-1 px-2.5 bg-accent-blue/15 hover:bg-accent-blue/30 text-accent-blue border border-accent-blue/20 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check size={10} /> {t('admin:ai_settings.note_action_save', { defaultValue: 'Speichern' })}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingNoteId(null)}
                                    className="p-1 px-2 border border-white/5 text-slate-400 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider cursor-pointer"
                                  >
                                    {t('admin:ai_settings.note_action_cancel', { defaultValue: 'Abbrechen' })}
                                  </button>
                                </>
                              ) : (
                                <>
                                  {deletingNoteId === note.id_uuid ? (
                                    <div className="flex items-center gap-1.5 animate-fadeIn">
                                      <span className="text-[9px] text-slate-400 font-bold uppercase mr-1">{t('admin:ai_settings.confirm_delete_prompt', { defaultValue: 'Löschen?' })}</span>
                                      <button
                                        type="button"
                                        onClick={() => deleteNoteMutation.mutate({ id_uuid: note.id_uuid })}
                                        disabled={deleteNoteMutation.isPending}
                                        className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[9px] font-bold transition-all cursor-pointer"
                                      >
                                        {t('admin:ai_settings.confirm_yes', { defaultValue: 'Ja' })}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeletingNoteId(null)}
                                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[9px] font-bold transition-all cursor-pointer"
                                      >
                                        {t('admin:ai_settings.confirm_no', { defaultValue: 'Nein' })}
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      {togglingNoteRagId === note.id_uuid ? (
                                        <Loader2 size={12} className="text-amber-400 animate-spin" />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleNoteRag(note.id_uuid, !note.is_rag_indexed)}
                                          className={`p-1 rounded transition-colors cursor-pointer flex items-center justify-center ${
                                            note.is_rag_indexed 
                                              ? 'text-[#34d399] hover:bg-emerald-500/10' 
                                              : 'text-slate-400 hover:text-amber-400 hover:bg-amber-500/10'
                                          }`}
                                          title={note.is_rag_indexed 
                                            ? t('admin:ai_settings.note_action_remove_rag_tooltip', { defaultValue: 'Aus RAG Wissensdatenbank entfernen' }) 
                                            : t('admin:ai_settings.note_action_add_rag_tooltip', { defaultValue: 'In die RAG Wissensdatenbank aufnehmen' })
                                          }
                                        >
                                          <Sparkles size={12} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingNoteId(note.id_uuid);
                                          setEditingNoteContent(note.content);
                                        }}
                                        className="text-slate-400 hover:text-white p-1 hover:bg-white/5 rounded transition-colors cursor-pointer flex items-center justify-center"
                                        title={t('admin:ai_settings.note_action_edit_tooltip', { defaultValue: 'Notiz bearbeiten' })}
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeletingNoteId(note.id_uuid)}
                                        className="text-slate-400 hover:text-red-400 p-1 hover:bg-red-500/10 rounded transition-colors cursor-pointer flex items-center justify-center"
                                        title={t('admin:ai_settings.note_action_delete_tooltip', { defaultValue: 'Notiz löschen' })}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-primary-dark/55 border border-white/5 rounded-2xl p-4 flex gap-3 text-xs text-slate-400 leading-relaxed font-sans">
        <Info className="text-accent-blue shrink-0" size={18} />
        <p>
          <strong>{t('admin:ai_settings.safety_hint_title', { defaultValue: 'Sicherheitshinweis:' })}</strong> {t('admin:ai_settings.safety_hint_desc', { defaultValue: 'Deine API-Schlüssel werden für deinen Mandanten (Tenant) hochgradig isoliert im System hinterlegt. Louis CRM AI nutzt die ReAct-Orchestrierung um alle Datenbankaktivitäten in Echtzeit zu begleiten, verwehrt der künstlichen Intelligenz jedoch jede direkte Schreibberechtigung auf Live-CRM-Daten.' })}
        </p>
      </div>

      {/* Action Button */}
      <div className="flex justify-end pt-4 border-t border-white/5">
        <button
          type="submit"
          disabled={saveMutation.isPending || updateMemoryMutation.isPending}
          className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-6 py-3.5 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-accent-orange/20 cursor-pointer"
        >
          {saveMutation.isPending || updateMemoryMutation.isPending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {t('common:save', { defaultValue: 'Speichern' })}
        </button>
      </div>
    </form>
  );
};
