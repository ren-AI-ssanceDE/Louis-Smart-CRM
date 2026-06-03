import React from 'react';
import { motion } from 'motion/react';
import { Server, Mail, Activity, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useTranslation } from 'react-i18next';

export const SystemStatusCard = () => {
  const { t } = useTranslation(['common']);
  const { data: systemStatus, isLoading: loadingDb, error: dbError } = trpc.getSystemStatus.useQuery(undefined, {
    refetchInterval: 10000, // Auto-refresh status every 10 seconds
  });

  const { data: smtpSettings, isLoading: loadingSmtp } = trpc.getSmtpSettings.useQuery();

  const loading = loadingDb || loadingSmtp;

  return (
    <div id="system-status-card" className="bg-primary-light border border-white/5 rounded-xl p-8 hover:border-white/10 transition-all relative overflow-hidden flex flex-col justify-between h-full">
      {/* Title block */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-accent-blue/10 rounded-lg text-accent-blue">
            <Activity size={22} className="animate-pulse" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase italic tracking-wider font-display">
              {t('system_status_card.title', { defaultValue: 'System-Status' })}
            </h3>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">
              {t('system_status_card.subtitle', { defaultValue: 'Technische Diagnose' })}
            </p>
          </div>
        </div>
        {loading && (
          <Loader2 size={16} className="text-slate-500 animate-spin" />
        )}
      </div>

      <div className="space-y-6">
        {/* Database Status Item */}
        <div id="status-db-dbinfo" className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 mt-1">
            <Server size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('system_status_card.db_connection', { defaultValue: 'Datenbankanbindung' })}</span>
              {loadingDb ? (
                <span className="text-xs text-slate-500">{t('system_status_card.checking', { defaultValue: 'Prüfen...' })}</span>
              ) : systemStatus?.isUsingFallback ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  {t('system_status_card.json_fallback', { defaultValue: 'JSON Fallback' })}
                </span>
              ) : systemStatus?.dbConnected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t('system_status_card.postgresql', { defaultValue: 'PostgreSQL' })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-500/10 text-red-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  {t('system_status_card.offline', { defaultValue: 'Offline' })}
                </span>
              )}
            </div>
            
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {loadingDb ? (
                t('system_status_card.db_validating', { defaultValue: 'Verbindung wird validiert...' })
              ) : systemStatus?.isUsingFallback ? (
                t('system_status_card.db_fallback_desc', { defaultValue: 'Datenbank im Offline-Ausweichmodus geladen. Lokale Datei-Persistence aktiv.' })
              ) : systemStatus?.dbConnected ? (
                t('system_status_card.db_connected_desc', { defaultValue: 'PostgreSQL-Hauptinstanz erfolgreich über Pool verbunden und synkronisiert.' })
              ) : (
                `${t('system_status_card.db_failed', { defaultValue: 'Verbindung fehlgeschlagen: ' })}${systemStatus?.dbError || dbError?.message || "Unbekannter Fehler"}`
              )}
            </p>
          </div>
        </div>

        {/* Separator */}
        <div className="border-t border-white/5" />

        {/* E-Mail SMTP Status Item */}
        <div id="status-smtp-info" className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 mt-1">
            <Mail size={20} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('system_status_card.smtp_delivery', { defaultValue: 'E-Mail Versand (SMTP)' })}</span>
              {loadingSmtp ? (
                <span className="text-xs text-slate-500">{t('system_status_card.checking', { defaultValue: 'Prüfen...' })}</span>
              ) : smtpSettings ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {t('system_status_card.ready', { defaultValue: 'Bereit' })}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  {t('system_status_card.inactive', { defaultValue: 'Inaktiv' })}
                </span>
              )}
            </div>
            
            <div className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {loadingSmtp ? (
                t('system_status_card.smtp_loading', { defaultValue: 'Lade SMTP-Settings...' })
              ) : smtpSettings ? (
                <div className="space-y-1">
                  <p>{t('system_status_card.smtp_registered', { defaultValue: 'SMTP Client ist erfolgreich registriert.' })}</p>
                  <p className="text-[11px] font-mono text-slate-400">
                    Host: <span className="text-slate-300">{smtpSettings.smtp_host_name}:{smtpSettings.smtp_port_number}</span>
                  </p>
                  <p className="text-[11px] font-mono text-slate-400">
                    Sender: <span className="text-slate-300">{smtpSettings.sender_email_address}</span>
                  </p>
                </div>
              ) : (
                <p>
                  {t('system_status_card.smtp_missing_desc', { defaultValue: 'Keine SMTP-Konfiguration gefunden. Beleg- und Mail-Versand sind deaktiviert. Richten Sie SMTP unter' })}{' '}
                  <span className="font-bold text-slate-400">
                    {t('system_status_card.smtp_path', { defaultValue: 'Admin > Verbindungen' })}
                  </span>{' '}
                  {t('system_status_card.smtp_missing_suffix', { defaultValue: 'ein.' })}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Decorative pulse glow in margin */}
      <div className="absolute -left-12 -bottom-12 w-24 h-24 bg-accent-blue/5 rounded-full blur-2xl" />
    </div>
  );
};
