import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Mail, Globe, Smartphone, Loader2, Calendar } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

interface ProfileTabProps {
  timezone: string;
  setTimezone: (tz: string) => void;
}

export const ProfileTab = ({ timezone, setTimezone }: ProfileTabProps) => {
  const { t } = useTranslation(['admin', 'common', 'contacts']);
  const utils = trpc.useContext();
  const { data: myCompanyData, isLoading: isLoadingMyCompany } = trpc.getMyCompany.useQuery();

  const saveMyCompanyMutation = trpc.saveMyCompany.useMutation({
    onSuccess: () => {
      toast.success(t('update_profile_success') || t('common:success'));
      utils.getMyCompany.invalidate();
    },
    onError: (err) => {
      toast.error(t('common:error') + ': ' + err.message);
    }
  });

  const { data: sessionData, refetch: refetchSession } = trpc.getSession.useQuery();
  const [loginEmail, setLoginEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const updateCredentialsMutation = trpc.updateCredentials.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || t('admin:toast_login_credentials_success', { defaultValue: 'Anmeldedaten erfolgreich aktualisiert!' }));
      setNewPassword('');
      setConfirmPassword('');
      refetchSession();
    },
    onError: (err) => {
      toast.error(t('admin:toast_login_credentials_error', { defaultValue: 'Fehler beim Aktualisieren der Anmeldedaten: ' }) + err.message);
    }
  });

  useEffect(() => {
    if (sessionData?.user?.email) {
      setLoginEmail(sessionData.user.email);
    }
  }, [sessionData]);

  const handleCredentialsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) {
      toast.error(t('admin:toast_email_required_error', { defaultValue: 'E-Mail-Adresse ist erforderlich' }));
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      toast.error(t('admin:toast_password_mismatch_error', { defaultValue: 'Die Passwörter stimmen nicht überein!' }));
      return;
    }
    updateCredentialsMutation.mutate({
      email_address: loginEmail,
      password: newPassword || undefined
    });
  };

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email_address: '',
    salutation: '',
    gender_identity: '',
    date_of_birth: '',
    region: '',
    phone_number: '',
    mobile_number: '',
  });

  useEffect(() => {
    if (myCompanyData) {
      setForm({
        first_name: myCompanyData.first_name || '',
        last_name: myCompanyData.last_name || '',
        email_address: myCompanyData.email_address || '',
        salutation: myCompanyData.salutation || '',
        gender_identity: myCompanyData.gender_identity || '',
        date_of_birth: myCompanyData.date_of_birth || '',
        region: myCompanyData.region || '',
        phone_number: myCompanyData.phone_number || '',
        mobile_number: myCompanyData.mobile_number || '',
      });
    }
  }, [myCompanyData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!myCompanyData) return;
    saveMyCompanyMutation.mutate({
      ...myCompanyData,
      ...form,
    });
  };

  if (isLoadingMyCompany) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="text-accent-orange animate-spin" size={40} />
      </div>
    );
  }

  return (
    <div className="space-y-12">
      <div className="flex items-center gap-8">
        <div className="w-40 h-40 rounded-3xl bg-gradient-to-tr from-accent-orange to-[#ff9b62] flex items-center justify-center font-bold text-white shadow-2xl shadow-accent-orange/30 relative overflow-hidden border-8 border-white/5 select-none">
          {myCompanyData?.logo_url ? (
            <div className="w-full h-full bg-white flex items-center justify-center p-4">
              <img 
                src={myCompanyData.logo_url} 
                alt="Company Logo" 
                className="max-w-full max-h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <span className="text-7xl italic font-black font-display">{(form.last_name && form.last_name !== 'User' ? form.last_name : form.first_name || t('common:agent_name')).charAt(0)}</span>
          )}
        </div>
        <div>
          <h3 className="text-5xl font-black text-white mb-3 font-display uppercase italic tracking-tighter">
            {(form.first_name === 'Admin' && (!form.last_name || form.last_name === 'User')) ? 'Admin' : `${form.first_name || ''} ${form.last_name || ''}`.trim() || t('common:agent_name')}
          </h3>
          <div className="flex items-center gap-4">
            <span className="bg-accent-blue/10 text-accent-blue border border-accent-blue/20 px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] font-display">{t('master_admin')}</span>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.salutation')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <select 
                value={form.salutation}
                onChange={(e) => setForm({...form, salutation: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight appearance-none"
              >
                <option value="" className="bg-primary-dark">{t('common:none')}</option>
                <option value="herr" className="bg-primary-dark">{t('contacts:fields.mr')}</option>
                <option value="frau" className="bg-primary-dark">{t('contacts:fields.mrs')}</option>
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.gender')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <select 
                value={form.gender_identity}
                onChange={(e) => setForm({...form, gender_identity: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight appearance-none"
              >
                <option value="" className="bg-primary-dark">{t('common:none')}</option>
                <option value="m" className="bg-primary-dark">{t('contacts:fields.male')}</option>
                <option value="f" className="bg-primary-dark">{t('contacts:fields.female')}</option>
                <option value="d" className="bg-primary-dark">{t('contacts:fields.diverse')}</option>
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.first_name')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <User size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={form.first_name}
                onChange={(e) => setForm({...form, first_name: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.last_name')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <User size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={form.last_name}
                onChange={(e) => setForm({...form, last_name: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('email')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Mail size={20} className="text-slate-700" />
              <input 
                type="email" 
                value={form.email_address}
                onChange={(e) => setForm({...form, email_address: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.25em] ml-2 font-display">{t('timezone')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Globe size={20} className="text-slate-700" />
              <select 
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full appearance-none text-lg tracking-tight custom-scrollbar"
              >
                {Intl.supportedValuesOf('timeZone').map((tz) => (
                  <option key={tz} value={tz} className="bg-primary-dark text-white">
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.dob')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner relative">
              <Calendar size={20} className="text-slate-700 pointer-events-none" />
              <input 
                type="date" 
                value={form.date_of_birth}
                onChange={(e) => setForm({...form, date_of_birth: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.region')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <input 
                type="text" 
                value={form.region}
                onChange={(e) => setForm({...form, region: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.phone')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Smartphone size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={form.phone_number}
                onChange={(e) => setForm({...form, phone_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">{t('contacts:fields.mobile')}</label>
            <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
              <Smartphone size={20} className="text-slate-700" />
              <input 
                type="text" 
                value={form.mobile_number}
                onChange={(e) => setForm({...form, mobile_number: e.target.value})}
                className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
              />
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-white/5 flex justify-end gap-4">
          <button 
            type="button"
            onClick={() => utils.getMyCompany.invalidate()}
            className="px-8 py-4 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-colors font-display"
          >
            {t('common:discard')}
          </button>
          <button 
            type="submit"
            disabled={saveMyCompanyMutation.isPending}
            className="px-12 py-4 rounded-xl bg-accent-orange shadow-xl shadow-accent-orange/20 text-white font-black text-[12px] uppercase tracking-widest hover:bg-accent-orange/90 transition-all font-display disabled:opacity-50 flex items-center gap-3"
          >
            {saveMyCompanyMutation.isPending && <Loader2 className="animate-spin" size={18} />}
            {t('update_profile')}
          </button>
        </div>
      </form>

      {/* Security & Credentials Section */}
      <div className="mt-12 bg-primary-dark/40 border border-white/5 rounded-3xl p-8 backdrop-blur-md">
        <h3 className="text-xl font-bold text-white mb-2 font-display tracking-tight">
          {t('admin:profile_security_title', { defaultValue: 'Sicherheit & Login-Zugangsdaten' })}
        </h3>
        <p className="text-sm text-slate-400 mb-8 max-w-2xl leading-relaxed">
          {t('admin:profile_security_desc', { defaultValue: 'Sichern Sie Louis Smart CRM vor unbefugtem Zugriff. Hier können Sie die E-Mail-Adresse und das Passwort für das Administrator-Konto ändern.' })}
        </p>

        <form onSubmit={handleCredentialsSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">
                {t('admin:profile_login_email', { defaultValue: 'Login E-Mail-Adresse' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <Mail size={20} className="text-slate-700" />
                <input 
                  type="email" 
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight" 
                  placeholder={t('admin:profile_email_placeholder', { defaultValue: 'admin@louis-crm.de' })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">
                {t('admin:profile_new_password', { defaultValue: 'Neues Passwort (Optional)' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <span className="text-slate-700 font-bold font-mono">***</span>
                <input 
                  type="password" 
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight"
                  placeholder={t('admin:profile_leave_unchanged', { defaultValue: 'Unverändert lassen' })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em] ml-2 font-display">
                {t('admin:profile_confirm_password', { defaultValue: 'Passwort bestätigen' })}
              </label>
              <div className="bg-primary-dark/60 border border-white/5 rounded-2xl p-6 flex items-center gap-4 focus-within:border-accent-blue transition-all shadow-inner">
                <span className="text-slate-700 font-bold font-mono">***</span>
                <input 
                  type="password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="bg-transparent border-none focus:outline-none text-white font-black w-full text-lg tracking-tight"
                  placeholder={t('admin:profile_leave_unchanged', { defaultValue: 'Unverändert lassen' })}
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button 
              type="submit"
              disabled={updateCredentialsMutation.isPending}
              className="px-12 py-4 rounded-xl bg-accent-blue shadow-xl shadow-accent-blue/20 text-white font-black text-[12px] uppercase tracking-widest hover:bg-accent-blue/90 transition-all font-display disabled:opacity-50 flex items-center gap-3"
            >
              {updateCredentialsMutation.isPending && <Loader2 className="animate-spin" size={18} />}
              {t('admin:profile_save_credentials_btn', { defaultValue: 'Zugangsdaten speichern' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
