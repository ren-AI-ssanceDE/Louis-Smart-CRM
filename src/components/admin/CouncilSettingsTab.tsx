import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, CheckCircle2, AlertCircle, Trash2, Plus, Users, Cpu, Eye, EyeOff, Settings, ShieldAlert, RotateCcw } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { v4 as uuidv4 } from 'uuid';
import { CouncilProvider, CouncilSettings } from '../../types';
import { PEER_REVIEW_SYSTEM_PROMPT, CHAIRMAN_SYSTEM_PROMPT } from '../../lib/schemas';

export const CouncilSettingsTab = () => {
  const { t } = useTranslation(['admin', 'common']);
  const [enabled, setEnabled] = useState(true);
  const [defaultMode, setDefaultMode] = useState<'multi-role' | 'multi-model'>('multi-role');
  const [defaultMaxRounds, setDefaultMaxRounds] = useState(3);
  const [providers, setProviders] = useState<CouncilProvider[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string; systemPrompt: string; temperature: number }[]>([]);
  const [peerReviewSystemPrompt, setPeerReviewSystemPrompt] = useState<string>(PEER_REVIEW_SYSTEM_PROMPT);
  const [chairmanSystemPrompt, setChairmanSystemPrompt] = useState<string>(CHAIRMAN_SYSTEM_PROMPT);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});

  const { data: settingsData, isLoading } = trpc.getSettings.useQuery();
  const utils = trpc.useContext();

  const updateSettingsMutation = trpc.updateSettings.useMutation({
    onSuccess: () => {
      toast.success(t('admin:council_settings_tab.saved_success', { defaultValue: 'Council-Einstellungen erfolgreich gespeichert!' }));
      utils.getSettings.invalidate();
    },
    onError: (err) => {
      toast.error(t('admin:council_settings_tab.saved_error', { defaultValue: 'Fehler beim Speichern der Einstellungen.' }));
    }
  });

  useEffect(() => {
    if (settingsData) {
      setEnabled(settingsData.enabled ?? true);
      setDefaultMode(settingsData.defaultMode ?? 'multi-role');
      setDefaultMaxRounds(settingsData.defaultMaxRounds ?? 2);
      setProviders(settingsData.providers ?? []);
      setRoles(settingsData.roles ?? []);
      setPeerReviewSystemPrompt(settingsData.peerReviewSystemPrompt ?? PEER_REVIEW_SYSTEM_PROMPT);
      setChairmanSystemPrompt(settingsData.chairmanSystemPrompt ?? CHAIRMAN_SYSTEM_PROMPT);
    }
  }, [settingsData]);

  const handleAddProvider = () => {
    if (providers.length >= 5) {
      toast.error(t('admin:council_settings_tab.max_providers_error', { defaultValue: 'Maximale Anzahl von 5 Providern erreicht.' }));
      return;
    }
    const newProvider: CouncilProvider = {
      id_uuid: uuidv4(),
      name: t('admin:council_settings_tab.new_provider_default', { defaultValue: 'Neuer Provider {{num}}', num: providers.length + 1 }),
      provider_type: 'gemini',
      api_key_secret: '',
      base_url: '',
      is_active: true
    };
    setProviders([...providers, newProvider]);
  };

  const handleUpdateProvider = <K extends keyof CouncilProvider>(id: string, field: K, value: CouncilProvider[K]) => {
    setProviders(providers.map(p => p.id_uuid === id ? { ...p, [field]: value } : p));
  };

  const handleDeleteProvider = (id: string) => {
    setProviders(providers.filter(p => p.id_uuid !== id));
  };

  const handleAddRole = () => {
    const newRole = {
      id: uuidv4(),
      name: t('admin:council_settings_tab.new_role_default', { defaultValue: 'Neue Rolle' }),
      systemPrompt: t('admin:council_settings_tab.role_prompt_placeholder', { defaultValue: 'Du bist ein Experte für...' }),
      temperature: 0.7
    };
    setRoles([...roles, newRole]);
  };

  type RoleItem = { id: string; name: string; systemPrompt: string; temperature: number };
  const handleUpdateRole = <K extends keyof RoleItem>(id: string, field: K, value: RoleItem[K]) => {
    setRoles(roles.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleDeleteRole = (id: string) => {
    setRoles(roles.filter(r => r.id !== id));
  };

  const toggleShowApiKey = (id: string) => {
    setShowApiKeys(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate({
      enabled,
      defaultMode,
      defaultMaxRounds,
      providers,
      roles,
      peerReviewSystemPrompt,
      chairmanSystemPrompt,
      availableModels: settingsData?.availableModels ?? []
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 justify-center py-12">
        <Loader2 className="w-6 h-6 text-accent-orange animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
          {t('admin:council_settings_tab.loading_config', { defaultValue: 'Lade Council-Konfiguration...' })}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8 max-w-5xl mx-auto p-6 bg-slate-900/40 rounded-xl border border-white/5 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-accent-orange/10 rounded-lg text-accent-orange">
            <Users size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-white font-display">LLM Council Config</h2>
            <p className="text-xs text-slate-400 font-mono">{t('admin:council_settings_tab.subtitle', { defaultValue: 'Steuerung des Multi-LLM Runden-Diskussionsmodells (Parallel Refinement Loop)' })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-mono text-slate-400 uppercase tracking-wider">{t('admin:council_settings_tab.enabled_label', { defaultValue: 'Aktiviert' })}</label>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className={cn(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 focus:outline-none",
              enabled ? "bg-accent-orange" : "bg-slate-700"
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300",
                enabled ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
        </div>
      </div>

      {/* Global Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-900/60 p-5 rounded-lg border border-white/5">
        <div>
          <label className="block text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-2">{t('admin:council_settings_tab.default_mode_label', { defaultValue: 'Standard-Diskussionsmodus' })}</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDefaultMode('multi-role')}
              className={cn(
                "py-3 px-4 rounded-lg border text-sm font-medium transition-all duration-300",
                defaultMode === 'multi-role'
                  ? "bg-accent-orange/10 border-accent-orange text-white"
                  : "bg-slate-800/40 border-white/5 text-slate-400 hover:text-white"
              )}
            >
              {t('admin:council_settings_tab.mode_multi_role', { defaultValue: 'Multi-Role (Ein Modell)' })}
              <span className="block text-[10px] text-slate-500 mt-1 font-mono">{t('admin:council_settings_tab.mode_multi_role_sub', { defaultValue: 'Nutzt Louis AI Config' })}</span>
            </button>
            <button
              type="button"
              onClick={() => setDefaultMode('multi-model')}
              className={cn(
                "py-3 px-4 rounded-lg border text-sm font-medium transition-all duration-300",
                defaultMode === 'multi-model'
                  ? "bg-accent-orange/10 border-accent-orange text-white"
                  : "bg-slate-800/40 border-white/5 text-slate-400 hover:text-white"
              )}
            >
              {t('admin:council_settings_tab.mode_multi_model', { defaultValue: 'Multi-Model (Echte Debatte)' })}
              <span className="block text-[10px] text-slate-500 mt-1 font-mono">{t('admin:council_settings_tab.mode_multi_model_sub', { defaultValue: 'Mehrere LLMs parallel' })}</span>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-bold font-mono uppercase text-slate-400 tracking-wider mb-2">{t('admin:council_settings_tab.default_max_rounds', { defaultValue: 'Standard-Rundenanzahl (Max 5)' })}</label>
          <input
            type="number"
            min={1}
            max={5}
            value={defaultMaxRounds}
            onChange={(e) => setDefaultMaxRounds(Math.min(5, Math.max(1, parseInt(e.target.value) || 3)))}
            className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/50 transition-colors"
          />
          <p className="text-[11px] text-slate-500 mt-1 font-mono">{t('admin:council_settings_tab.karpathy_recommendation', { defaultValue: 'Karpathy empfiehlt 3 Runden für optimales Peer-Review.' })}</p>
        </div>
      </div>

      {/* LLM Providers */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu size={18} className="text-accent-orange" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">{t('admin:council_settings_tab.custom_llm_providers', { defaultValue: 'Custom LLM Provider (Max 5)' })}</h3>
          </div>
          <button
            type="button"
            onClick={handleAddProvider}
            disabled={providers.length >= 5}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-orange hover:text-accent-orange/80 transition-colors disabled:opacity-50"
          >
            <Plus size={16} /> {t('admin:council_settings_tab.add_provider', { defaultValue: 'Provider Hinzufügen' })}
          </button>
        </div>

        {providers.length === 0 ? (
          <div className="p-6 bg-slate-900/20 rounded-lg border border-dashed border-white/10 text-center">
            <p className="text-xs text-slate-500 font-mono">{t('admin:council_settings_tab.no_providers', { defaultValue: 'Keine Custom Provider registriert. Das System nutzt im Multi-Role Modus die primäre Louis-Konfiguration.' })}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((provider) => (
              <div key={provider.id_uuid} className="p-5 bg-slate-900/60 rounded-lg border border-white/5 space-y-4 relative group">
                <button
                  type="button"
                  onClick={() => handleDeleteProvider(provider.id_uuid)}
                  className="absolute top-4 right-4 text-slate-500 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.provider_name', { defaultValue: 'Provider-Name' })}</label>
                    <input
                      type="text"
                      value={provider.name}
                      onChange={(e) => handleUpdateProvider(provider.id_uuid, 'name', e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.provider_type', { defaultValue: 'Provider-Typ' })}</label>
                    <select
                      value={provider.provider_type}
                      onChange={(e) => handleUpdateProvider(provider.id_uuid, 'provider_type', e.target.value)}
                      className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI (GPT-4o, etc)</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="ollama">Ollama (Lokal)</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="custom">{t('admin:council_settings_tab.provider_custom', { defaultValue: 'Benutzerdefiniert (OpenAI API-kompatibel)' })}</option>
                    </select>
                  </div>

                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-mono text-slate-400 select-none">
                      <input
                        type="checkbox"
                        checked={provider.is_active}
                        onChange={(e) => handleUpdateProvider(provider.id_uuid, 'is_active', e.target.checked)}
                        className="rounded border-white/5 bg-slate-800 text-accent-orange focus:ring-0 focus:ring-offset-0"
                      />
                      {t('admin:council_settings_tab.active', { defaultValue: 'Aktiv' })}
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.base_url_optional', { defaultValue: 'Base URL (optional)' })}</label>
                    <input
                      type="text"
                      value={provider.base_url || ''}
                      onChange={(e) => handleUpdateProvider(provider.id_uuid, 'base_url', e.target.value)}
                      placeholder={t('admin:council_settings_tab.base_url_placeholder', { defaultValue: 'z.B. http://localhost:11434 oder https://api.openai.com/v1' })}
                      className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.api_key_optional', { defaultValue: 'API Key / Secret (optional)' })}</label>
                    <div className="relative">
                      <input
                        type={showApiKeys[provider.id_uuid] ? 'text' : 'password'}
                        value={provider.api_key_secret || ''}
                        onChange={(e) => handleUpdateProvider(provider.id_uuid, 'api_key_secret', e.target.value)}
                        placeholder="••••••••••••••••••••••••••••"
                        className="w-full bg-slate-800/50 border border-white/5 rounded-lg pl-3 pr-10 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowApiKey(provider.id_uuid)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                      >
                        {showApiKeys[provider.id_uuid] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Council Roles */}
      <div className="space-y-4 border-t border-white/5 pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-accent-orange" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">{t('admin:council_settings_tab.standard_roles', { defaultValue: 'Standard-Rollen (Debattanten)' })}</h3>
          </div>
          <button
            type="button"
            onClick={handleAddRole}
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-accent-orange hover:text-accent-orange/80 transition-colors"
          >
            <Plus size={16} /> {t('admin:council_settings_tab.add_role', { defaultValue: 'Rolle Hinzufügen' })}
          </button>
        </div>

        <div className="space-y-4">
          {roles.map((role) => (
            <div key={role.id} className="p-5 bg-slate-900/60 rounded-lg border border-white/5 space-y-3 relative">
              <button
                type="button"
                onClick={() => handleDeleteRole(role.id)}
                className="absolute top-4 right-4 text-slate-500 hover:text-red-500 transition-colors"
              >
                <Trash2 size={16} />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.role_name', { defaultValue: 'Rollen-Name (Persona)' })}</label>
                  <input
                    type="text"
                    value={role.name}
                    onChange={(e) => handleUpdateRole(role.id, 'name', e.target.value)}
                    className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.temperature', { defaultValue: 'Temperatur: {{val}}', val: role.temperature })}</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={role.temperature}
                    onChange={(e) => handleUpdateRole(role.id, 'temperature', parseFloat(e.target.value))}
                    className="w-full accent-accent-orange mt-2"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold font-mono text-slate-400 uppercase tracking-wider mb-1">{t('admin:council_settings_tab.system_prompt', { defaultValue: 'System-Prompt (Mission/Rolle)' })}</label>
                <textarea
                  value={role.systemPrompt}
                  onChange={(e) => handleUpdateRole(role.id, 'systemPrompt', e.target.value)}
                  rows={3}
                  className="w-full bg-slate-800/50 border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/50"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phase 2 & Phase 3 System Prompts (Peer Review & Chairman) */}
      <div className="space-y-6 border-t border-white/5 pt-6">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-accent-orange" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-white font-mono">
            {t('admin:council_settings_tab.synthesis_prompts_title', { defaultValue: 'System-Prompts für Phase 2 & Phase 3 (Peer-Review & Chairman)' })}
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Phase 2: Peer Review Prompt */}
          <div className="p-5 bg-slate-900/60 rounded-lg border border-white/5 space-y-3 relative">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold font-mono text-white uppercase tracking-wider">
                {t('admin:council_settings_tab.peer_review_label', { defaultValue: 'Phase 2: Peer-Review System-Prompt' })}
              </label>
              <button
                type="button"
                onClick={() => setPeerReviewSystemPrompt(PEER_REVIEW_SYSTEM_PROMPT)}
                className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-accent-orange transition-colors"
                title={t('admin:council_settings_tab.reset_default', { defaultValue: 'Auf Standard zurücksetzen' })}
              >
                <RotateCcw size={12} />
                <span>{t('admin:council_settings_tab.reset', { defaultValue: 'Reset' })}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
              {t('admin:council_settings_tab.peer_review_desc', { defaultValue: 'Dieser Prompt wird in Phase 2 für die anonyme Gutachter-Bewertung aller 5 Entwürfe verwendet.' })}
            </p>
            <textarea
              value={peerReviewSystemPrompt}
              onChange={(e) => setPeerReviewSystemPrompt(e.target.value)}
              rows={7}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-accent-orange/50 font-mono leading-relaxed"
            />
          </div>

          {/* Phase 3: Chairman Prompt */}
          <div className="p-5 bg-slate-900/60 rounded-lg border border-white/5 space-y-3 relative">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold font-mono text-white uppercase tracking-wider">
                {t('admin:council_settings_tab.chairman_label', { defaultValue: 'Phase 3: Chairman (Vorsitzender) System-Prompt' })}
              </label>
              <button
                type="button"
                onClick={() => setChairmanSystemPrompt(CHAIRMAN_SYSTEM_PROMPT)}
                className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 hover:text-accent-orange transition-colors"
                title={t('admin:council_settings_tab.reset_default', { defaultValue: 'Auf Standard zurücksetzen' })}
              >
                <RotateCcw size={12} />
                <span>{t('admin:council_settings_tab.reset', { defaultValue: 'Reset' })}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
              {t('admin:council_settings_tab.chairman_desc', { defaultValue: 'Dieser Prompt wird in Phase 3 für das finale Urteil, Konsensanalyse & Handlungsempfehlungen des Chairmans genutzt.' })}
            </p>
            <textarea
              value={chairmanSystemPrompt}
              onChange={(e) => setChairmanSystemPrompt(e.target.value)}
              rows={7}
              className="w-full bg-slate-800/50 border border-white/5 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-accent-orange/50 font-mono leading-relaxed"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end pt-4 border-t border-white/5">
        <button
          type="submit"
          disabled={updateSettingsMutation.isPending}
          className="flex items-center gap-2 px-6 py-3 bg-accent-orange hover:bg-accent-orange/80 text-white rounded-lg text-sm font-bold tracking-wider uppercase transition-colors shadow-lg shadow-accent-orange/10"
        >
          {updateSettingsMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {t('admin:council_settings_tab.saving', { defaultValue: 'Speichere...' })}
            </>
          ) : (
            t('admin:council_settings_tab.save_settings', { defaultValue: 'Einstellungen Speichern' })
          )}
        </button>
      </div>
    </form>
  );
};
