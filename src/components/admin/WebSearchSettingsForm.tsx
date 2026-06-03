import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, CheckCircle2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

export const WebSearchSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const [selectedEngine, setSelectedEngine] = useState<'duckduckgo' | 'searxng' | 'google_grounding' | 'google_custom_search'>('duckduckgo');
  const [duckduckgoUrl, setDuckduckgoUrl] = useState('https://html.duckduckgo.com/html/');
  const [searxngUrl, setSearxngUrl] = useState('https://searxng.org/search');
  const [searxngCategories, setSearxngCategories] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [googleCx, setGoogleCx] = useState('');

  const { data: searchData, isLoading } = trpc.getWebSearchSettings.useQuery();
  const utils = trpc.useContext();

  const saveSearchMutation = trpc.saveWebSearchSettings.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_web_search', { defaultValue: 'Websuche-Parameter erfolgreich gespeichert!' }));
      utils.getWebSearchSettings.invalidate();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_web_search', { defaultValue: 'Fehler beim Speichern der Websuche-Parameter: ' }) + err.message);
    }
  });

  useEffect(() => {
    if (searchData) {
      setSelectedEngine(searchData.selected_engine as any);
      setDuckduckgoUrl(searchData.duckduckgo_url || 'https://html.duckduckgo.com/html/');
      setSearxngUrl(searchData.searxng_url || 'https://searxng.org/search');
      setSearxngCategories(searchData.searxng_categories || '');
      setGoogleApiKey(searchData.google_api_key || '');
      setGoogleCx(searchData.google_cx || '');
    }
  }, [searchData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSearchMutation.mutate({
      selected_engine: selectedEngine,
      duckduckgo_url: duckduckgoUrl,
      searxng_url: searxngUrl,
      searxng_categories: searxngCategories,
      google_api_key: googleApiKey,
      google_cx: googleCx,
      id_uuid: searchData?.id_uuid || undefined
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 justify-center py-12">
        <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">{t('admin:search_settings.loading_settings')}</span>
      </div>
    );
  }

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-10 space-y-8">
      <div className="flex items-center gap-4 mb-4">
        <div className="p-4 bg-accent-blue/10 rounded-xl">
          <Search className="text-accent-blue" size={32} />
        </div>
        <div>
          <h4 className="text-xl font-black text-white uppercase italic tracking-wider font-display">{t('admin:search_settings.title')}</h4>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
            {t('admin:search_settings.desc')}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2 col-span-2 md:col-span-1">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.provider_label')}</label>
            <select
              value={selectedEngine}
              onChange={(e) => setSelectedEngine(e.target.value as any)}
              className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-sans"
            >
              <option value="searxng">{t('admin:search_settings.searxng_desc')}</option>
              <option value="duckduckgo">{t('admin:search_settings.duckduckgo_desc')}</option>
              <option value="google_grounding">{t('admin:search_settings.google_grounding_desc')}</option>
              <option value="google_custom_search">{t('admin:search_settings.google_custom_desc')}</option>
            </select>
          </div>

          <div className="space-y-2 col-span-2 md:col-span-1">
            {selectedEngine === 'duckduckgo' && (
              <>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.ddg_url_label')}</label>
                <input
                  type="text"
                  value={duckduckgoUrl}
                  onChange={(e) => setDuckduckgoUrl(e.target.value)}
                  placeholder="https://html.duckduckgo.com/html/"
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-mono"
                  required
                />
              </>
            )}

            {selectedEngine === 'searxng' && (
              <>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.searxng_url_label')}</label>
                <input
                  type="text"
                  value={searxngUrl}
                  onChange={(e) => setSearxngUrl(e.target.value)}
                  placeholder="https://searxng.org/search"
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-mono"
                  required
                />
              </>
            )}
          </div>

          {selectedEngine === 'google_grounding' && (
            <div className="col-span-2 bg-red-950/20 border border-red-500/20 rounded-xl p-6 text-sm text-slate-300">
              <span className="font-bold text-red-400 uppercase text-xs tracking-wider block mb-2">{t('admin:search_settings.google_grounding_privacy_warn_title')}</span>
              {t('admin:search_settings.google_grounding_privacy_warn_desc')}
            </div>
          )}

          {selectedEngine === 'google_custom_search' && (
            <>
              <div className="col-span-2 bg-red-950/20 border border-red-500/20 rounded-xl p-6 text-sm text-slate-300">
                <span className="font-bold text-red-400 uppercase text-xs tracking-wider block mb-2">{t('admin:search_settings.google_custom_privacy_warn_title')}</span>
                {t('admin:search_settings.google_custom_privacy_warn_desc')}
              </div>

              <div className="space-y-2 col-span-2 md:col-span-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.google_api_key_label')}</label>
                <input
                  type="password"
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  placeholder={t('admin:search_settings.google_api_key_placeholder', { defaultValue: 'AIzaSy...' })}
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-mono"
                  required
                />
              </div>

              <div className="space-y-2 col-span-2 md:col-span-1">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.google_cx_label')}</label>
                <input
                  type="text"
                  value={googleCx}
                  onChange={(e) => setGoogleCx(e.target.value)}
                  placeholder={t('admin:search_settings.google_cx_placeholder', { defaultValue: '0123456789abcdefg...' })}
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-mono"
                  required
                />
              </div>
            </>
          )}

          {selectedEngine === 'searxng' && (
            <div className="space-y-2 md:col-span-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('admin:search_settings.searxng_categories_label')}</label>
              <input
                type="text"
                value={searxngCategories}
                onChange={(e) => setSearxngCategories(e.target.value)}
                placeholder={t('admin:search_settings.searxng_categories_placeholder', { defaultValue: 'general,news,science (Optional)' })}
                className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors font-mono"
              />
              <p className="text-[10px] text-slate-500 font-semibold italic mt-1 uppercase tracking-wider">
                {t('admin:search_settings.searxng_categories_desc')}
              </p>
            </div>
          )}
        </div>

        <div className="pt-8 border-t border-white/5 flex justify-end">
          <button 
            type="submit"
            disabled={saveSearchMutation.isPending}
            className="px-10 py-5 rounded-xl bg-accent-blue shadow-2xl shadow-accent-blue/20 text-white font-black text-[12px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all font-display flex items-center gap-3 disabled:opacity-50 disabled:grayscale disabled:scale-100 cursor-pointer"
          >
            {saveSearchMutation.isPending ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {t('common:processing')}
              </>
            ) : (
              <>
                <CheckCircle2 size={20} />
                {t('common:save', { defaultValue: 'Speichern' })}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
