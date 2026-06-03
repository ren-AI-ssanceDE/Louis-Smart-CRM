import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Server, Globe, Loader2, Key, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';

export const SmtpSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const [showPassword, setShowPassword] = useState(false);
  const [smtpForm, setSmtpForm] = useState({
    smtp_host_name: '',
    smtp_port_number: 587,
    smtp_user_name: '',
    smtp_password_secret: '',
    is_secure_connection: true,
    sender_email_address: '',
    sender_display_name: ''
  });

  const { data: smtpData } = trpc.getSmtpSettings.useQuery();
  const utils = trpc.useContext();
  
  const saveSmtpMutation = trpc.saveSmtpSettings.useMutation({
    onSuccess: () => {
      toast.success(t('smtp.success'));
      utils.getSmtpSettings.invalidate();
    },
    onError: (err) => {
      toast.error(t('smtp.error') + ': ' + err.message);
    }
  });

  const testSmtpMutation = trpc.testSmtp.useMutation({
    onSuccess: () => {
      toast.success(t('smtp.test_success'));
    },
    onError: (err) => {
      toast.error(t('smtp.test_error') + ': ' + err.message);
    }
  });

  useEffect(() => {
    if (smtpData) {
      setSmtpForm({
        smtp_host_name: smtpData.smtp_host_name,
        smtp_port_number: smtpData.smtp_port_number,
        smtp_user_name: smtpData.smtp_user_name,
        smtp_password_secret: smtpData.smtp_password_secret,
        is_secure_connection: smtpData.is_secure_connection,
        sender_email_address: smtpData.sender_email_address,
        sender_display_name: smtpData.sender_display_name || ''
      });
    }
  }, [smtpData]);

  const handleSmtpSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveSmtpMutation.mutate({
      ...smtpForm,
      id_uuid: smtpData?.id_uuid || undefined
    });
  };

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-10 space-y-8">
      <div className="flex items-center gap-4 mb-4">
        <div className="p-4 bg-accent-blue/10 rounded-xl">
          <Server className="text-accent-blue" size={32} />
        </div>
        <div>
          <h4 className="text-xl font-black text-white uppercase italic tracking-wider font-display">{t('smtp.title')}</h4>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{t('smtp.description')}</p>
        </div>
      </div>

      <form onSubmit={handleSmtpSave} className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.host')}</label>
          <input 
            type="text" 
            value={smtpForm.smtp_host_name}
            onChange={(e) => setSmtpForm({...smtpForm, smtp_host_name: e.target.value})}
            placeholder={t('smtp.host_placeholder', { defaultValue: 'smtp.example.com' })}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.port')}</label>
          <input 
            type="number" 
            value={smtpForm.smtp_port_number}
            onChange={(e) => setSmtpForm({...smtpForm, smtp_port_number: parseInt(e.target.value)})}
            placeholder="587"
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.user')}</label>
          <input 
            type="text" 
            value={smtpForm.smtp_user_name}
            onChange={(e) => setSmtpForm({...smtpForm, smtp_user_name: e.target.value})}
            placeholder={t('smtp.user_placeholder', { defaultValue: 'user@example.com' })}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.password')}</label>
          <div className="relative">
            <input 
              type={showPassword ? "text" : "password"}
              value={smtpForm.smtp_password_secret}
              onChange={(e) => setSmtpForm({...smtpForm, smtp_password_secret: e.target.value})}
              className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors pr-12"
              required
            />
            <button 
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.sender_email')}</label>
          <input 
            type="email" 
            value={smtpForm.sender_email_address}
            onChange={(e) => setSmtpForm({...smtpForm, sender_email_address: e.target.value})}
            placeholder={t('smtp.sender_email_placeholder', { defaultValue: 'noreply@example.com' })}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('smtp.sender_name')}</label>
          <input 
            type="text" 
            value={smtpForm.sender_display_name}
            onChange={(e) => setSmtpForm({...smtpForm, sender_display_name: e.target.value})}
            placeholder={t('smtp.sender_name_placeholder', { defaultValue: 'Louis CRM' })}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
          />
        </div>

        <div className="md:col-span-2 flex items-center gap-4 py-4">
          <button 
            type="button"
            onClick={() => setSmtpForm({...smtpForm, is_secure_connection: !smtpForm.is_secure_connection})}
            className={cn(
              "w-12 h-6 rounded-full transition-colors relative",
              smtpForm.is_secure_connection ? "bg-accent-blue" : "bg-slate-800"
            )}
          >
            <div className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
              smtpForm.is_secure_connection ? "right-1" : "left-1"
            )} />
          </button>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter italic">{t('smtp.secure')}</span>
        </div>

        <div className="md:col-span-2 pt-8 border-t border-white/5 flex justify-end gap-4 font-sans">
          <button 
            type="button"
            onClick={() => {
              if (smtpForm.sender_email_address) {
                testSmtpMutation.mutate({ 
                  recipient_email_address: smtpForm.sender_email_address,
                  temp_smtp_settings: {
                    ...smtpForm,
                    id_uuid: smtpData?.id_uuid
                  }
                });
              } else {
                toast.error(t('smtp.toast_enter_sender_email', { defaultValue: 'Geben Sie bitte zuerst eine Absender-E-Mail-Adresse an, um den Test durchzuführen!' }));
              }
            }}
            disabled={testSmtpMutation.isPending}
            className="px-8 py-5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[12px] uppercase tracking-widest hover:text-white transition-all font-display flex items-center gap-2 disabled:opacity-50"
          >
            {testSmtpMutation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Globe size={18} />
            )}
            {t('smtp.test')}
          </button>
          <button 
            type="submit"
            disabled={saveSmtpMutation.isPending}
            className="px-10 py-5 rounded-xl bg-accent-blue shadow-2xl shadow-accent-blue/20 text-white font-black text-[12px] uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all font-display flex items-center gap-3 disabled:opacity-50 disabled:grayscale disabled:scale-100"
          >
            {saveSmtpMutation.isPending ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                {t('common:processing')}
              </>
            ) : (
              <>
                <CheckCircle2 size={20} />
                {t('smtp.save')}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
