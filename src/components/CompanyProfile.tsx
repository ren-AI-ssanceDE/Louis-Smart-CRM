import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, MapPin, Tag, Calendar, ShieldCheck, Mail, Phone, Globe, CreditCard, Link as LinkIcon, User } from 'lucide-react';
import { Company } from '../types';
import { cn } from '../lib/utils';
import { MailDialog } from './MailDialog';

interface CompanyProfileProps {
  company: Company;
}

export const CompanyProfile = ({ company }: CompanyProfileProps) => {
  const { t } = useTranslation(['companies', 'common']);
  const [isMailOpen, setIsMailOpen] = useState(false);

  return (
    <div className="space-y-8 bg-primary-dark p-2 no-scrollbar">
      <div className="flex items-start gap-8">
        <div className="w-24 h-24 rounded-xl bg-primary-light border-2 border-white/5 flex items-center justify-center text-accent-orange shadow-inner">
          <Building2 size={48} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
             <h3 className="text-4xl font-black text-white tracking-tight font-display italic uppercase">{company.full_legal_name}</h3>
          </div>
          <div className="flex items-center gap-6 mt-3">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
              <MapPin size={14} className="text-accent-blue" />
              {company.city || t('common:na')}, {company.country_code || 'DE'}
            </div>
            {company.responsible_person && (
              <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
                <User size={14} className="text-accent-orange" />
                {company.responsible_person}
              </div>
            )}
            <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
               <Calendar size={14} className="text-accent-orange" />
               {t('active_since')} {new Date(company.created_at_utc).getFullYear()}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button 
          onClick={() => company.email_address && setIsMailOpen(true)}
          disabled={!company.email_address}
          className="bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-blue/20 transition-all text-left disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed"
        >
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Mail size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.email')}</div>
            <div className="text-white font-black text-sm tracking-tight truncate max-w-[200px]">{company.email_address || t('common:na')}</div>
          </div>
        </button>
        
        <a 
          href={company.website ? (company.website.toLowerCase().startsWith('http') ? company.website : `https://${company.website}`) : '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => !company.website && e.preventDefault()}
          className={cn(
            "bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-blue/20 transition-all text-left",
            !company.website && "opacity-50 grayscale cursor-not-allowed"
          )}
        >
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Globe size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.website')}</div>
            <div className="text-white font-black text-sm tracking-tight truncate max-w-[200px]">{company.website || t('common:na')}</div>
          </div>
        </a>

        <div className="bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-orange/20 transition-all">
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Phone size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.phone')}</div>
            <div className="text-white font-black text-sm tracking-tight">{company.phone_number || t('common:na')}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-primary-light border-2 border-white/5 p-6 rounded-xl group hover:border-accent-orange/40 transition-all">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 font-display">{t('vat_id')}</div>
          <div className="text-white font-mono font-black text-sm tracking-tighter">{company.tax_vat_id || t('common:not_registered')}</div>
        </div>
        <div className="bg-primary-light border-2 border-white/5 p-6 rounded-xl group hover:border-accent-orange/40 transition-all">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 font-display">{t('fields.tax_number', { defaultValue: 'Steuernummer' })}</div>
          <div className="text-white font-mono font-black text-sm tracking-tighter">{company.tax_number || '—'}</div>
        </div>
        <div className="bg-primary-light border-2 border-white/5 p-6 rounded-xl group hover:border-accent-orange/40 transition-all">
          <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2 font-display">{t('fields.leitweg_id_label')}</div>
          <div className="text-white font-mono font-black text-sm tracking-tighter">{company.leitweg_id || '—'}</div>
        </div>
      </div>

      {company.iban && (
        <div className="bg-primary-light border-2 border-white/5 p-8 rounded-xl space-y-6 shadow-sm">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] border-b-2 border-white/5 pb-4 font-display">{t('sections.financial')}</h4>
          <div className="space-y-4">
            <div className="flex flex-col gap-1">
               <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest font-display">IBAN</span>
               <span className="text-xs font-mono font-black text-white break-all bg-primary-dark p-2 rounded-lg border border-white/5">{company.iban}</span>
            </div>
            {company.bic_swift && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest font-display">BIC</span>
                <span className="text-xs font-mono font-black text-white">{company.bic_swift}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {company.custom_documents && (
        <div className="bg-primary-light border-2 border-white/5 p-8 rounded-xl">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6 flex items-center gap-3 font-display">
            <LinkIcon size={14} className="text-accent-blue" />
            {t('fields.notes')}
          </h4>
          <div className="bg-primary-dark border border-white/5 rounded-xl p-6 text-xs text-white whitespace-pre-wrap font-mono font-bold leading-relaxed shadow-inner">
            {company.custom_documents}
          </div>
        </div>
      )}

      <div className="bg-primary-light p-8 rounded-xl shadow-2xl relative overflow-hidden group border border-white/5">
        <div className="relative z-10">
          <h4 className="text-[10px] font-black text-accent-blue uppercase tracking-[0.3em] mb-6 flex items-center gap-3 font-display">
            <Tag size={14} />
            {t('common:ai_audit')}
          </h4>
          <div className="space-y-4">
            <div className="flex justify-between items-end text-sm">
              <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px] font-display">{t('common:confidence_rating')}</span>
              <span className={cn("text-2xl font-black font-mono tracking-tighter", company.ai_confidence_score > 0.8 ? "text-accent-blue" : "text-accent-orange")}>
                {(company.ai_confidence_score * 100).toFixed(1)}%
              </span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div 
                className={cn("h-full transition-all duration-1000", company.ai_confidence_score > 0.8 ? "bg-accent-blue" : "bg-accent-orange")}
                style={{ width: `${company.ai_confidence_score * 100}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-6 pt-6 border-t border-white/5">
              <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest font-mono">
                {t('common:source')}: {company.created_by_identity}
              </div>
              <div className="text-[9px] text-slate-500 font-black uppercase tracking-widest font-mono">
                {t('registry_cluster_id', { defaultValue: 'Registry Cluster ID' })}: {company.id_uuid?.slice(0, 8)}
              </div>
            </div>
          </div>
        </div>
        {/* Decorative element */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-accent-orange/5 blur-[80px] rounded-full group-hover:bg-accent-orange/10 transition-all" />
      </div>

      {company.email_address && (
        <MailDialog 
          isOpen={isMailOpen} 
          onClose={() => setIsMailOpen(false)} 
          recipientEmail={company.email_address}
          recipientName={company.full_legal_name}
          associatedType="companies"
          associatedId={company.id_uuid}
          associatedName={company.full_legal_name}
        />
      )}
    </div>
  );
};
