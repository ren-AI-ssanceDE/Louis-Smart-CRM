import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Database, Loader2, LayoutGrid, CheckSquare, RefreshCw } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

export const SystemSettingsTab = () => {
  const { t, i18n } = useTranslation(['admin', 'common', 'companies', 'contacts']);
  const utils = trpc.useUtils();

  const { data: bankStatus, refetch: refetchBankStatus } = trpc.getBankDirectoryStatus.useQuery();
  const { data: myCompanyData, isLoading: isLoadingMyCompany } = trpc.getMyCompany.useQuery();

  const [contactsCols, setContactsCols] = useState<string[]>(['responsible', 'comms', 'company', 'address']);
  const [companiesCols, setCompaniesCols] = useState<string[]>(['responsible', 'comms', 'address', 'invoice']);

  useEffect(() => {
    if (myCompanyData) {
      if (myCompanyData.contacts_display_columns_json) {
        try {
          setContactsCols(JSON.parse(myCompanyData.contacts_display_columns_json));
        } catch (_) {}
      }
      if (myCompanyData.companies_display_columns_json) {
        try {
          setCompaniesCols(JSON.parse(myCompanyData.companies_display_columns_json));
        } catch (_) {}
      }
    }
  }, [myCompanyData]);

  const syncBankDirectoryMutation = trpc.syncBankDirectory.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchBankStatus();
    },
    onError: (err) => {
      toast.error(t('admin:bank_directory.sync_error') + ': ' + err.message);
    }
  });

  const saveConfigMutation = trpc.saveMyCompany.useMutation({
    onSuccess: () => {
      toast.success(t('admin:columns_config.toast_save_success'));
      utils.getMyCompany.invalidate();
    },
    onError: (err) => {
      toast.error(t('common:error') + ': ' + err.message);
    }
  });

  const handleSave = () => {
    if (!myCompanyData) return;
    saveConfigMutation.mutate({
      ...myCompanyData,
      full_legal_name: myCompanyData.full_legal_name || '',
      contacts_display_columns_json: JSON.stringify(contactsCols),
      companies_display_columns_json: JSON.stringify(companiesCols)
    });
  };

  const handleReset = () => {
    setContactsCols(['responsible', 'comms', 'company', 'address']);
    setCompaniesCols(['responsible', 'comms', 'address', 'invoice']);
    toast.info(t('admin:columns_config.toast_reset_success'));
  };

  const handleContactColChange = (index: number, val: string) => {
    const nextArr = [...contactsCols];
    nextArr[index] = val;
    setContactsCols(nextArr);
  };

  const handleCompanyColChange = (index: number, val: string) => {
    const nextArr = [...companiesCols];
    nextArr[index] = val;
    setCompaniesCols(nextArr);
  };

  // Option human-friendly labels
  const contactOptions = [
    { value: 'responsible', label: t('admin:columns_config.labels.responsible') },
    { value: 'comms', label: t('admin:columns_config.labels.comms') },
    { value: 'company', label: t('admin:columns_config.labels.company') },
    { value: 'address', label: t('admin:columns_config.labels.address') },
    { value: 'birthdate', label: t('admin:columns_config.labels.birthdate') }
  ];

  const companyOptions = [
    { value: 'responsible', label: t('admin:columns_config.labels.responsible') },
    { value: 'comms', label: t('admin:columns_config.labels.comms') },
    { value: 'company', label: t('admin:columns_config.labels.company') },
    { value: 'address', label: t('admin:columns_config.labels.address') },
    { value: 'invoice', label: t('admin:columns_config.labels.invoice') }
  ];

  if (isLoadingMyCompany) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-accent-orange" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div>
        <h3 className="text-3xl font-black text-white mb-2 font-display uppercase italic tracking-tighter">{t('common:system_settings')}</h3>
        <p className="text-slate-500 text-sm font-bold italic">{t('common:system_settings_desc')}</p>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* Global Identity */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">{t('common:global_identity')}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-4 font-display">{t('common:system_language')}</label>
              <div className="bg-primary-dark/80 border-2 border-white/5 rounded-xl p-5 flex items-center gap-4 focus-within:border-accent-blue transition-all">
                <Globe size={18} className="text-slate-600" />
                <select 
                  value={i18n.language}
                  onChange={(e) => i18n.changeLanguage(e.target.value)}
                  className="bg-transparent border-none focus:outline-none text-white font-bold w-full appearance-none outline-none"
                >
                  <option value="de" className="bg-primary-dark text-white">{t('common:languages.de', { defaultValue: 'Deutsch (DE)' })}</option>
                  <option value="en" className="bg-primary-dark text-white">{t('common:languages.en', { defaultValue: 'English (US)' })}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Column Configuration Layout (Spaltenkonfiguration) */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">
            {t('admin:columns_config.title')}
          </h4>

          <div className="bg-slate-900/30 border border-white/5 rounded-3xl p-8 space-y-8">
            <div className="flex items-start gap-4 pb-4 border-b border-white/5">
              <LayoutGrid size={24} className="text-accent-orange shrink-0 mt-0.5" />
              <div>
                <h5 className="text-[12px] font-black text-white uppercase tracking-wider font-display">
                  {t('admin:columns_config.manager_title')}
                </h5>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  {t('admin:columns_config.manager_desc')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              {/* Contacts Config Column */}
              <div className="space-y-6 bg-primary-dark/40 border border-white/5 p-6 rounded-2xl">
                <h6 className="text-[11px] font-black text-accent-blue uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2 font-display">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-blue inline-block"></span>
                  {t('admin:columns_config.contacts_columns')}
                </h6>

                <div className="space-y-4">
                  {[0, 1, 2, 3].map((idx) => (
                    <div key={`contact-col-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-primary-dark/20 p-4 border border-white/5 rounded-xl">
                      <span className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-wider">
                        {t('admin:columns_config.column_n', { n: idx + 2 })}
                      </span>

                      <select
                        value={contactsCols[idx] || 'address'}
                        onChange={(e) => handleContactColChange(idx, e.target.value)}
                        className="bg-primary-light border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-accent-blue cursor-pointer drop-shadow-xl w-full sm:max-w-xs"
                      >
                        {contactOptions.map(opt => (
                          <option key={opt.value} value={opt.value} className="bg-primary-dark text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Companies Config Column */}
              <div className="space-y-6 bg-primary-dark/40 border border-white/5 p-6 rounded-2xl">
                <h6 className="text-[11px] font-black text-accent-orange uppercase tracking-widest flex items-center gap-2 border-b border-white/5 pb-2 font-display">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-orange inline-block"></span>
                  {t('admin:columns_config.companies_columns')}
                </h6>

                <div className="space-y-4">
                  {[0, 1, 2, 3].map((idx) => (
                    <div key={`company-col-${idx}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-primary-dark/20 p-4 border border-white/5 rounded-xl">
                      <span className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-wider">
                        {t('admin:columns_config.column_n', { n: idx + 2 })}
                      </span>

                      <select
                        value={companiesCols[idx] || 'address'}
                        onChange={(e) => handleCompanyColChange(idx, e.target.value)}
                        className="bg-primary-light border border-white/10 rounded-lg px-4 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-accent-orange cursor-pointer drop-shadow-xl w-full sm:max-w-xs"
                      >
                        {companyOptions.map(opt => (
                          <option key={opt.value} value={opt.value} className="bg-primary-dark text-white">
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* D/A/CH Bank Directory Status & Sync Card */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">{t('admin:bank_directory.title')}</h4>
          
          <div className="bg-slate-900/40 border border-white/5 rounded-3xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                  <Database size={14} className="text-accent-blue" />
                  {t('admin:bank_directory.subtitle')}
                </h5>
                <p className="text-slate-400 text-xs mt-1">
                  {t('admin:bank_directory.desc')}
                </p>
              </div>
              <button
                type="button"
                disabled={syncBankDirectoryMutation.status === 'pending'}
                onClick={() => syncBankDirectoryMutation.mutate()}
                className="inline-flex items-center gap-2 bg-accent-blue hover:bg-accent-blue/80 text-white text-xs font-black uppercase tracking-wider px-5 py-3 rounded-xl transition duration-200 disabled:opacity-50 cursor-pointer shadow-md"
              >
                {syncBankDirectoryMutation.status === 'pending' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t('admin:bank_directory.updating')}
                  </>
                ) : (
                  <>
                    <Database size={14} />
                    {t('admin:bank_directory.update_btn')}
                  </>
                )}
              </button>
            </div>
            
            {bankStatus && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-white/5 text-slate-400 text-[11px] font-mono">
                <div>
                  <span className="text-slate-600 block uppercase font-sans font-bold text-[9px] tracking-wider mb-0.5">{t('admin:bank_directory.total_entries')}</span>
                  <span className="text-white font-bold text-sm bg-white/5 px-2 py-0.5 rounded">{bankStatus.totalCount.toLocaleString(i18n.language)}</span>
                </div>
                <div>
                  <span className="text-slate-600 block uppercase font-sans font-bold text-[9px] tracking-wider mb-0.5">{t('admin:bank_directory.germany')}</span>
                  <span className="text-accent-blue font-bold text-sm bg-accent-blue/10 px-2 py-0.5 rounded">{((bankStatus.countries as Record<string, number>).DE || 0).toLocaleString(i18n.language)}</span>
                </div>
                <div>
                  <span className="text-slate-600 block uppercase font-sans font-bold text-[9px] tracking-wider mb-0.5">{t('admin:bank_directory.austria')}</span>
                  <span className="text-accent-orange font-bold text-sm bg-accent-orange/10 px-2 py-0.5 rounded">{((bankStatus.countries as Record<string, number>).AT || 0).toLocaleString(i18n.language)}</span>
                </div>
                <div>
                  <span className="text-slate-600 block uppercase font-sans font-bold text-[9px] tracking-wider mb-0.5">{t('admin:bank_directory.switzerland')}</span>
                  <span className="text-emerald-500 font-bold text-sm bg-emerald-500/10 px-2 py-0.5 rounded">{((bankStatus.countries as Record<string, number>).CH || 0).toLocaleString(i18n.language)}</span>
                </div>
                {bankStatus.lastUpdated && (
                  <div className="col-span-2 sm:col-span-4 text-left text-slate-500 text-[10px] pt-1">
                    {t('admin:bank_directory.stand', { date: new Date(bankStatus.lastUpdated).toLocaleString(i18n.language) })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="pt-8 border-t border-white/5 flex justify-end gap-4">
        <button 
          type="button"
          onClick={handleReset}
          className="px-8 py-4 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-colors flex items-center gap-2 font-display"
        >
          <RefreshCw size={12} />
          {t('common:reset_defaults')}
        </button>
        <button 
          type="button"
          disabled={saveConfigMutation.isPending}
          onClick={handleSave}
          className="px-8 py-4 rounded-xl bg-accent-orange shadow-xl shadow-accent-orange/20 text-white font-bold text-[10px] uppercase tracking-widest hover:bg-accent-orange/90 transition-all flex items-center gap-2 font-display disabled:opacity-50 cursor-pointer"
        >
          {saveConfigMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <CheckSquare size={12} />}
          {t('common:save_config')}
        </button>
      </div>
    </div>
  );
};
