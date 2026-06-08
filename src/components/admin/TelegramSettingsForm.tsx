import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, CheckCircle2, AlertCircle, Send, ShieldAlert, Lock, Trash2, Plus } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

export const TelegramSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const [botToken, setBotToken] = useState('');
  const [allowedUserIds, setAllowedUserIds] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data: telegramData, isLoading } = trpc.getTelegramSettings.useQuery();
  const utils = trpc.useContext();

  const saveTelegramMutation = trpc.saveTelegramSettings.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_telegram', { defaultValue: 'Telegram-Konfiguration erfolgreich gespeichert!' }));
      utils.getTelegramSettings.invalidate();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_telegram', { defaultValue: 'Fehler beim Speichern der Telegram-Parameter: ' }) + err.message);
    }
  });

  const testTelegramMutation = trpc.testTelegramConnection.useMutation({
    onSuccess: (res) => {
      setTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    },
    onError: (err) => {
      setTestResult({
        success: false,
        message: err.message
      });
      toast.error(err.message);
    }
  });

  useEffect(() => {
    if (telegramData) {
      setBotToken(telegramData.bot_token || '');
      setAllowedUserIds(telegramData.allowed_user_ids || '');
      setIsActive(telegramData.is_active || false);
    }
  }, [telegramData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveTelegramMutation.mutate({
      bot_token: botToken,
      allowed_user_ids: allowedUserIds,
      is_active: isActive,
      id_uuid: telegramData?.id_uuid || undefined
    });
  };

  const handleTestConnection = () => {
    if (!botToken.trim()) {
      toast.error(t('admin:telegram_settings.token_missing_test_err', { defaultValue: 'Bitte geben Sie zuerst ein Bot-Token ein.' }));
      return;
    }
    if (!allowedUserIds.trim()) {
      toast.error(t('admin:telegram_settings.userIds_missing_test_err', { defaultValue: 'Bitte geben Sie mindestens eine Benutzer-ID zum Testen an.' }));
      return;
    }
    setTestResult(null);
    testTelegramMutation.mutate({
      bot_token: botToken,
      allowed_user_ids: allowedUserIds
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-3 justify-center py-12">
        <div className="w-6 h-6 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
          {t('admin:telegram_settings.loading_settings', { defaultValue: 'Sondiere Telegram Gateway-Konfiguration...' })}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-10 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-white/5">
        <div className="flex items-center gap-4">
          <div className="p-4 bg-accent-orange/10 rounded-xl">
            <Bot className="text-accent-orange" size={32} />
          </div>
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-wider font-display">
              {t('admin:telegram_settings.title', { defaultValue: 'Telegram Bot Gateway (Local-Only)' })}
            </h4>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
              {t('admin:telegram_settings.desc', { defaultValue: 'Verbinden Sie Ihren Louis-Knoten mit einem verschlüsselten Telegram Messenger-Dienst.' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:telegram_settings.status_lbl', { defaultValue: 'GATEWAY STATUS' })}:
          </span>
          <button
            type="button"
            onClick={() => setIsActive(!isActive)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest font-display transition-all border ${
              isActive 
                ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            {isActive 
              ? t('common:active', { defaultValue: 'Aktiv' }) 
              : t('common:inactive', { defaultValue: 'Inaktiv' })}
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2 col-span-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display ml-2">
              {t('admin:telegram_settings.bot_token_lbl', { defaultValue: 'TELEGRAM BOT TOKEN (HTTP API)' })}
            </label>
            <div className="relative">
              <input
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="0123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..."
                className="w-full bg-primary-dark/60 border border-white/10 rounded-xl pl-12 pr-6 py-4 text-white font-mono text-sm focus:outline-none focus:border-accent-orange transition-colors"
                required
              />
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                <Lock size={16} />
              </div>
            </div>
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide mt-1 ml-2 leading-relaxed">
              {t('admin:telegram_settings.token_desc', { defaultValue: 'Erhalten Sie dieses Token von @BotFather im Telegram Messenger. Louis speichert dieses Token lokal und übermittelt Daten nur direkt an die Telegram API.' })}
            </p>
          </div>

          <div className="space-y-2 col-span-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display ml-2">
              {t('admin:telegram_settings.allowed_ids_lbl', { defaultValue: 'Zugelassene telegram chat- / benutzer-ids' })}
            </label>
            <input
              type="text"
              value={allowedUserIds}
              onChange={(e) => setAllowedUserIds(e.target.value)}
              placeholder="123456789, 987654321"
              className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-mono text-sm focus:outline-none focus:border-accent-orange transition-colors"
              required
            />
            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wide mt-1 ml-2 leading-relaxed">
              {t('admin:telegram_settings.ids_desc', { defaultValue: 'Kommagetrennte Liste numerischer IDs, die berechtigt sind, mit diesem CRM-Knoten zu interagieren. Empfangen Sie Ihre ID z.B. über @userinfobot.' })}
            </p>
          </div>
        </div>

        {/* Security / local stack disclaimer disclaimer */}
        <div className="bg-primary-dark/20 border border-white/5 rounded-xl p-5 text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-start gap-3">
          <Bot size={16} className="text-slate-500 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            {t('admin:telegram_settings.security_disclaimer', { defaultValue: 'Lokaler Betrieb geschützt: Es findet keine Kommunikation mit externen Cloud-Verteilern statt. Der CRM-Webserver interagiert verschlüsselt und direkt auf Ihrer physischen Instanz.' })}
          </p>
        </div>

        {/* Action Button Strip */}
        <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testTelegramMutation.isPending}
            className="px-6 py-4 rounded-xl bg-primary-dark border border-white/10 text-white hover:border-accent-orange hover:text-accent-orange font-black text-[10px] uppercase tracking-widest transition-all font-display flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
          >
            {testTelegramMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('admin:telegram_settings.testing_btn', { defaultValue: 'Testnachricht wird gesendet...' })}
              </>
            ) : (
              <>
                <Send size={16} />
                {t('admin:telegram_settings.test_btn', { defaultValue: 'Verbindung Testen' })}
              </>
            )}
          </button>

          <button 
            type="submit"
            disabled={saveTelegramMutation.isPending}
            className="px-10 py-5 rounded-xl bg-accent-orange shadow-2xl shadow-accent-orange/20 text-white font-black text-[12px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all font-display flex items-center justify-center gap-3 disabled:opacity-50 disabled:grayscale disabled:scale-100 cursor-pointer"
          >
            {saveTelegramMutation.isPending ? (
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

      {testResult && (
        <div className={`p-5 rounded-xl border text-xs leading-relaxed transition-all duration-300 ${
          testResult.success 
            ? 'bg-green-500/10 border-green-500/20 text-green-400' 
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 size={18} className="text-green-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <div>
              <span className="font-black uppercase tracking-widest text-[10px] block mb-1">
                {testResult.success 
                  ? t('admin:telegram_settings.test_success', { defaultValue: 'Verbindung Erfolgreich' }) 
                  : t('admin:telegram_settings.test_fail', { defaultValue: 'Verbindung Fehlgeschlagen' })}
              </span>
              {testResult.message}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
