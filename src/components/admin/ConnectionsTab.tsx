import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, CheckCircle2, AlertCircle, RefreshCw, Activity, Shield } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { SmtpSettingsForm } from './SmtpSettingsForm';
import { WebSearchSettingsForm } from './WebSearchSettingsForm';
import { TelegramSettingsForm } from './TelegramSettingsForm';

export const ConnectionsTab = () => {
  const { t } = useTranslation(['admin', 'common']);

  // Fetch system status
  const { data: status, refetch: refetchStatus, isLoading: isStatusLoading } = trpc.getSystemStatus.useQuery();

  // Mutation for testing database connection
  const testConn = trpc.testDatabaseConnection.useMutation();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleTestConnection = async () => {
    setTestResult(null);
    try {
      const res = await testConn.mutateAsync();
      setTestResult(res);
      refetchStatus();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : t('admin:connections_tab.test_error_fallback');
      setTestResult({
        success: false,
        message: errorMsg
      });
    }
  };

  return (
    <div className="space-y-12">
      <div>
        <h3 className="text-3xl font-black text-white mb-2 font-display uppercase italic tracking-tighter">
          {t('tabs.connections')}
        </h3>
        <p className="text-slate-500 text-sm font-bold italic">
          {t('connections_desc')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-12">
        {/* System Status Section */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">
            {t('admin:connections_tab.system_status')}
          </h4>
          <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl ${status?.isUsingFallback ? 'bg-accent-orange/10' : 'bg-green-500/10'}`}>
                  <Database className={status?.isUsingFallback ? 'text-accent-orange' : 'text-green-500'} size={24} />
                </div>
                <div>
                  <p className="text-sm font-black text-white uppercase tracking-widest font-display">
                    {t('admin:connections_tab.active_data_mode')}
                  </p>
                  <p className="text-[10px] text-slate-500 font-bold uppercase italic">
                    {status?.isUsingFallback 
                      ? t('admin:connections_tab.db_fallback_desc')
                      : t('admin:connections_tab.db_connected_desc')}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest font-display ${
                  status?.isUsingFallback
                    ? 'bg-accent-orange/10 text-accent-orange border border-accent-orange/20 animate-pulse'
                    : 'bg-green-500/10 text-green-500 border border-green-500/20'
                }`}>
                  {status?.isUsingFallback ? t('admin:connections_tab.fallback_mode') : t('admin:connections_tab.db_active')}
                </span>
                <button
                  type="button"
                  onClick={() => refetchStatus()}
                  disabled={isStatusLoading}
                  className="p-2 rounded-lg bg-primary-dark/80 border border-white/5 hover:border-white/10 text-slate-400 hover:text-white transition-all flex items-center justify-center"
                  title={t('admin:connections_tab.refresh_tooltip')}
                >
                  <RefreshCw size={14} className={isStatusLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Connection Status Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-white/5">
              <div className="p-4 bg-primary-dark/60 rounded-lg border border-white/5 flex items-start gap-3">
                {status?.dbConnected ? (
                  <CheckCircle2 size={16} className="text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <AlertCircle size={16} className="text-accent-orange mt-0.5 shrink-0" />
                )}
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-display">{t('admin:connections_tab.db_lbl')}</p>
                  <p className="text-xs text-white mt-1 font-mono">
                    {status?.dbConnected ? t('admin:connections_tab.db_online') : t('admin:connections_tab.db_offline')}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-primary-dark/60 rounded-lg border border-white/5 flex items-start gap-3">
                <CheckCircle2 size={16} className={status?.databaseUrlConfigured ? 'text-green-500 mt-0.5 shrink-0' : 'text-slate-600 mt-0.5 shrink-0'} />
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-display">{t('admin:connections_tab.config_lbl')}</p>
                  <p className="text-xs text-white mt-1 font-mono">
                    {status?.databaseUrlConfigured ? t('admin:connections_tab.config_present') : t('admin:connections_tab.config_missing')}
                  </p>
                </div>
              </div>
            </div>

            {/* Validation Button and Result Alert */}
            <div className="pt-2 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testConn.isPending}
                  className="px-6 py-3 rounded-xl bg-primary-dark border border-white/10 text-white hover:border-accent-orange hover:text-accent-orange font-bold text-[10px] uppercase tracking-widest transition-all font-display duration-150 flex items-center gap-2"
                >
                  {testConn.isPending ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      {t('admin:connections_tab.testing_btn')}
                    </>
                  ) : (
                    <>
                      <Database size={14} />
                      {t('admin:connections_tab.test_btn')}
                    </>
                  )}
                </button>
                <p className="text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                  {t('admin:connections_tab.test_desc')}
                </p>
              </div>

              {testResult && (
                <div className={`p-4 rounded-xl border text-xs leading-relaxed transition-all duration-300 ${
                  testResult.success 
                    ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                    : 'bg-red-500/10 border-red-500/20 text-red-500'
                }`}>
                  <div className="flex items-start gap-2.5">
                    {testResult.success ? (
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-green-400" />
                    ) : (
                      <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
                    )}
                    <div>
                      <span className="font-black uppercase tracking-wider text-[10px] block mb-1">
                        {testResult.success ? t('admin:connections_tab.test_success_lbl') : t('admin:connections_tab.test_fail_lbl')}
                      </span>
                      {testResult.message}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Connection Details / SMTP */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">
            {t('admin:connections_tab.smtp_lbl')}
          </h4>
          <SmtpSettingsForm />
        </div>

        {/* Web Search Engine Configuration */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2 font-sans">
            {t('admin:connections_tab.websearch_parameters_header', { defaultValue: 'WEBSUCHE PARAMETER' })}
          </h4>
          <WebSearchSettingsForm />
        </div>

        {/* Telegram Bot Gateway Configuration */}
        <div className="space-y-6">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2 font-sans">
            {t('admin:connections_tab.telegram_parameters_header', { defaultValue: 'TELEGRAM GATEWAY' })}
          </h4>
          <TelegramSettingsForm />
        </div>

        {/* AI & Intelligence Nodes */}
        <div className="space-y-4">
          <h4 className="text-[10px] font-black text-accent-orange uppercase tracking-[0.2em] font-display border-b border-white/5 pb-2">
            {t('common:ai_intelligence_nodes')}
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-accent-orange/10 rounded-lg shrink-0">
                  <Activity className="text-accent-orange" size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-white uppercase tracking-wider font-display">
                    {t('common:semantic_enrichment')}
                  </p>
                  <p className="text-[9px] text-slate-500 font-extrabold uppercase italic leading-tight mt-0.5">
                    {t('common:semantic_enrichment_desc')}
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest font-display bg-accent-orange/10 text-accent-orange border border-accent-orange/20 shrink-0">
                {t('common:active')}
              </span>
            </div>

            <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-accent-blue/10 rounded-lg shrink-0">
                  <Shield className="text-accent-blue" size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-white uppercase tracking-wider font-display">
                    {t('common:audit_trails')}
                  </p>
                  <p className="text-[9px] text-slate-500 font-extrabold uppercase italic leading-tight mt-0.5">
                    {t('common:audit_trails_desc')}
                  </p>
                </div>
              </div>
              <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest font-display bg-accent-blue/10 text-accent-blue border border-accent-blue/20 shrink-0">
                {t('common:active')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
