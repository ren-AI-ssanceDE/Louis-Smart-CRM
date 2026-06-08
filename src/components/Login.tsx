import React from 'react';
import { motion } from 'motion/react';
import { Lock, Mail, Server, LogIn, Database } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface LoginProps {
  onLoginSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const [email, setEmail] = React.useState('admin@louis-crm.de');
  const [password, setPassword] = React.useState('admin');
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // 1. Fetch CSRF token
      const csrfRes = await fetch('/api/auth/csrf');
      if (!csrfRes.ok) {
        throw new Error(t('login:csrf_error'));
      }
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken;

      // 2. Perform callback login
      const loginRes = await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          csrfToken,
          email,
          password,
          redirect: 'false',
        }).toString(),
      });

      if (!loginRes.ok) {
        setErrorMsg(t('login:auth_failed'));
        toast.error(t('login:login_failed'));
        setIsLoading(false);
        return;
      }

      // Check if logged in successfully by reloading session
      const checkRes = await fetch('/api/auth/session');
      const checkSession = await checkRes.json();
      
      if (checkSession && checkSession.user) {
        toast.success(t('login:login_success'));
        onLoginSuccess();
      } else {
        setErrorMsg(t('login:wrong_credentials'));
        toast.error(t('login:wrong_password'));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setErrorMsg(errMsg || t('login:unexpected_error'));
      toast.error(t('login:login_error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoFill = () => {
    setEmail('admin@louis-crm.de');
    setPassword('admin');
    toast.info(t('login:demo_success'));
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-primary-dark font-sans text-neutral-white relative overflow-hidden">
      {/* Dynamic Background Accents */}
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent-orange/10 blur-[180px] rounded-full -mr-80 -mt-80" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-accent-blue/10 blur-[150px] rounded-full -ml-48 -mb-48" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="w-full max-w-md p-8 bg-primary-light/40 border border-white/5 rounded-2xl backdrop-blur-xl shadow-2xl relative z-10"
      >
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-tr from-accent-orange to-accent-blue rounded-2xl mx-auto mb-4 flex items-center justify-center font-bold text-white shadow-xl">
            <Database size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white uppercase italic font-display">
            {t('login:title_main')} <span className="text-accent-orange">{t('login:title_sub')}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-2 font-mono tracking-widest uppercase">
            {t('login:db_required')}
          </p>
        </div>

        {/* Error notification */}
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-xs font-medium"
          >
            {errorMsg}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Email input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black font-mono text-slate-400 uppercase tracking-wider block">
              {t('login:email_label')}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                <Mail size={16} />
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@louis-crm.de"
                className="w-full pl-10 pr-4 py-3 bg-primary-dark/80 border border-white/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all placeholder:text-slate-600 font-medium"
              />
            </div>
          </div>

          {/* Password input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-black font-mono text-slate-400 uppercase tracking-wider block">
              {t('login:password_label')}
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500">
                <Lock size={16} />
              </span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-3 bg-primary-dark/80 border border-white/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent-orange focus:border-transparent transition-all placeholder:text-slate-600 font-mono"
              />
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-gradient-to-r from-accent-orange to-accent-orange/90 hover:from-accent-orange/90 hover:to-accent-orange text-white rounded-xl font-bold text-sm tracking-wide transition-all shadow-lg hover:shadow-accent-orange/10 flex items-center justify-center gap-2 disable:opacity-50"
          >
            {isLoading ? (
              <>
                <Server size={16} className="animate-pulse" />
                <span>{t('login:connecting')}</span>
              </>
            ) : (
              <>
                <LogIn size={16} />
                <span>{t('login:connect_btn')}</span>
              </>
            )}
          </button>
        </form>

        {/* Demo instructions */}
        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <span className="text-[10px] font-mono text-slate-500 tracking-wider block uppercase mb-2">
            {t('login:demo_title')}
          </span>
          <button
            type="button"
            onClick={handleDemoFill}
            className="inline-flex flex-col items-center gap-1 p-3 bg-primary-dark/40 hover:bg-primary-dark/60 border border-white/5 rounded-xl transition-all w-full text-left"
          >
            <div className="flex items-center justify-between w-full text-xs text-slate-300 font-mono">
              <span className="text-slate-500">{t('login:demo_login')}</span>
              <span className="text-accent-blue font-bold">admin@louis-crm.de</span>
            </div>
            <div className="flex items-center justify-between w-full text-xs text-slate-300 font-mono">
              <span className="text-slate-500">{t('login:demo_password')}</span>
              <span className="text-accent-orange font-bold">admin</span>
            </div>
          </button>
        </div>
      </motion.div>
    </div>
  );
};
