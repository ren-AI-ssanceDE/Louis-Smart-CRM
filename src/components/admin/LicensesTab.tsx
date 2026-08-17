import React from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, Copyright, ExternalLink, Scale, Code2, Heart, FileText } from 'lucide-react';

export const LicensesTab = () => {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="border-b border-white/5 pb-6">
        <div className="flex items-center gap-4 mb-3">
          <div className="p-3 bg-accent-blue/10 rounded-2xl border border-accent-blue/20 shadow-lg shadow-accent-blue/10">
            <Scale className="text-accent-blue" size={28} />
          </div>
          <div>
            <h3 className="text-3xl font-black text-white italic uppercase tracking-tighter font-display">
              {t('admin:licenses.title')}
            </h3>
            <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
              {t('admin:licenses.subtitle')}
            </p>
          </div>
        </div>
      </div>

      {/* Main License Card */}
      <div className="p-8 bg-primary-dark/50 border border-white/5 rounded-2xl space-y-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/5 pb-4">
          <div className="flex items-center gap-3">
            <Shield className="text-accent-orange shrink-0" size={22} />
            <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
              {t('admin:licenses.gpl_title')}
            </h4>
          </div>
          <span className="px-3 py-1 bg-accent-orange/10 border border-accent-orange/20 text-accent-orange text-[10px] font-black uppercase tracking-widest rounded-full font-mono">
            {t('admin:licenses.gpl_active')}
          </span>
        </div>

        <div className="space-y-4 text-xs leading-relaxed text-slate-300">
          <p dangerouslySetInnerHTML={{ __html: t('admin:licenses.gpl_desc') }} />

          {/* Copyright Section with Link */}
          <div className="bg-primary-dark/80 p-5 rounded-xl border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Copyright className="text-accent-blue shrink-0" size={18} />
              <div>
                <p className="font-bold text-white text-sm">
                  {t('admin:licenses.licensor')}
                </p>
                <p className="text-slate-400 text-xs font-mono">Musterfirma GmbH®</p>
              </div>
            </div>
            <a 
              href="https://www.musterfirma.de" 
              target="_blank" 
              rel="noopener noreferrer" 
              title={t('admin:licenses.licensor_tooltip', { defaultValue: 'Musterfirma GmbH Website' })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/20 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all duration-300"
            >
              www.musterfirma.de
              <ExternalLink size={12} />
            </a>
          </div>

          <p className="text-[11px] text-slate-400 italic">
            {t('admin:licenses.disclaimer')}
          </p>
        </div>
      </div>

      {/* Third Party / Licensors Credits */}
      <div className="space-y-6">
        <div className="flex items-center gap-2 border-b border-white/5 pb-2">
          <Code2 className="text-accent-blue" size={18} />
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] font-display">
            {t('admin:licenses.third_party_title')}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mustangproject Attribution */}
          <div className="p-6 bg-primary-dark/30 border border-white/5 rounded-xl space-y-4 hover:border-accent-orange/25 transition-all">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white font-display">Mustangproject Library</span>
              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-mono rounded">Apache-2.0</span>
            </div>
            <div className="text-xs text-slate-400 leading-relaxed space-y-2">
              <p>{t('admin:licenses.mustang_desc')}</p>
              <p className="text-slate-500 font-medium">{t('admin:licenses.mustang_copyright')}</p>
            </div>
            <div className="pt-2 flex justify-end">
              <a 
                href="https://www.mustangproject.org" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 text-[11px] text-accent-orange hover:underline font-bold"
              >
                mustangproject.org
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* pdf-lib Attribution */}
          <div className="p-6 bg-primary-dark/30 border border-white/5 rounded-xl space-y-4 hover:border-accent-blue/25 transition-all">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-white font-display">pdf-lib</span>
              <span className="px-2 py-0.5 bg-slate-800 text-slate-400 text-[9px] font-mono rounded">MIT License</span>
            </div>
            <div className="text-xs text-slate-400 leading-relaxed space-y-2">
              <p>{t('admin:licenses.pdflib_desc')}</p>
              <p className="text-slate-500 font-medium">{t('admin:licenses.pdflib_copyright')}</p>
            </div>
            <div className="pt-2 flex justify-end">
              <a 
                href="https://pdf-lib.js.org" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="inline-flex items-center gap-1.5 text-[11px] text-accent-blue hover:underline font-bold"
              >
                pdf-lib.js.org
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>

        {/* General Credits List */}
        <div className="p-6 bg-slate-900/20 border border-white/5 rounded-xl">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="text-emerald-500 fill-emerald-500/10" size={16} />
            <h5 className="text-[11px] font-black text-white uppercase tracking-wide font-display">
              {t('admin:licenses.thanks_title')}
            </h5>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            {t('admin:licenses.thanks_desc')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">{t('admin:licenses.framework')}</span>
              <strong>React 18</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">{t('admin:licenses.build_tool')}</span>
              <strong>Vite</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">{t('admin:licenses.css_platform')}</span>
              <strong>Tailwind CSS</strong>
            </div>
            <div className="bg-primary-dark/40 py-2.5 px-4 border border-white/5 rounded-lg text-slate-300">
              <span className="text-slate-500 text-[9px] block">{t('admin:licenses.comms_protocol')}</span>
              <strong>tRPC &amp; React-Query</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
