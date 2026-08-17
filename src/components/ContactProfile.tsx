import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Mail, Phone, Building2, Calendar, Link as LinkIcon, ShieldCheck, Globe } from 'lucide-react';
import { Contact } from '../types';
import { cn } from '../lib/utils';
import { MailDialog } from './MailDialog';

interface ContactProfileProps {
  contact: Contact;
}

export const ContactProfile = ({ contact }: ContactProfileProps) => {
  const { t, i18n } = useTranslation(['contacts', 'common']);
  const [isMailOpen, setIsMailOpen] = useState(false);

  return (
    <div className="space-y-8 bg-primary-dark p-2 no-scrollbar">
      <div className="flex items-start gap-8">
        <div className="w-24 h-24 rounded-full bg-primary-light border-2 border-white/5 p-1 shadow-inner flex items-center justify-center">
          <div className="w-full h-full rounded-full bg-accent-orange flex items-center justify-center shadow-lg shadow-accent-orange/40">
            <User size={48} className="text-white" />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
             <h3 className="text-4xl font-black text-white tracking-tight font-display italic uppercase">{contact.full_legal_name}</h3>
          </div>
          <div className="flex items-center gap-6 mt-3">
            <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
              <Building2 size={14} className="text-accent-blue" />
              {contact.company_name || t('common:individual_entity')}
            </div>
            {contact.responsible_person && (
              <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
                <User size={14} className="text-accent-orange" />
                {contact.responsible_person}
              </div>
            )}
            {contact.date_of_birth && (
              <div className="flex items-center gap-2 text-slate-500 text-xs font-black uppercase tracking-widest">
                <Calendar size={14} className="text-accent-orange" />
                {(() => {
                  try {
                    const d = new Date(contact.date_of_birth);
                    if (isNaN(d.getTime())) return contact.date_of_birth;
                    return d.toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' });
                  } catch (e) {
                    return contact.date_of_birth;
                  }
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button 
          onClick={() => contact.email_address && setIsMailOpen(true)}
          disabled={!contact.email_address}
          className="bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-blue/20 transition-all text-left disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed"
        >
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Mail size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.email')}</div>
            <div className="text-white font-black text-sm tracking-tight truncate max-w-[200px]">{contact.email_address || t('common:not_assigned')}</div>
          </div>
        </button>
        
        <a 
          href={contact.website || '#'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => !contact.website && e.preventDefault()}
          className={cn(
            "bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-blue/20 transition-all text-left",
            !contact.website && "opacity-50 grayscale cursor-not-allowed"
          )}
        >
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Globe size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.website')}</div>
            <div className="text-white font-black text-sm tracking-tight truncate max-w-[200px]">{contact.website || t('common:not_assigned')}</div>
          </div>
        </a>

        <div className="bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-orange/20 transition-all">
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Phone size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.phone')}</div>
            <div className="text-white font-black text-sm tracking-tight">{contact.phone_number || t('common:not_assigned')}</div>
          </div>
        </div>

        <div className={cn(
          "bg-primary-light border-2 border-white/5 p-6 rounded-xl flex items-center gap-5 group hover:border-accent-blue/20 transition-all text-left",
          !contact.company_name && "opacity-50 grayscale"
        )}>
          <div className="w-14 h-14 rounded-xl bg-primary-dark border-2 border-white/5 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-accent-blue group-hover:border-accent-blue/20 transition-all">
            <Building2 size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1 font-display">{t('fields.company_affiliation')}</div>
            <div className="text-white font-black text-sm tracking-tight truncate max-w-[200px]">{contact.company_name || t('common:individual_entity')}</div>
          </div>
        </div>
      </div>

      {(contact.street || contact.city || contact.iban) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-primary-light border-2 border-white/5 p-8 rounded-xl space-y-6 shadow-sm">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] border-b-2 border-white/5 pb-4 font-display">{t('sections.info')}</h4>
            <div className="space-y-3">
              <div className="text-sm text-slate-200 font-bold leading-relaxed">
                {contact.street} {contact.house_number}<br />
                {contact.postal_code} {contact.city}<br />
                {contact.region && <span className="text-accent-blue text-[10px] uppercase tracking-[0.2em] font-black mt-2 inline-block font-mono">{contact.region}</span>}
              </div>
              {contact.date_of_birth && (
                <div className="flex items-center gap-2 text-[10px] text-slate-500 font-black uppercase tracking-widest pt-2">
                  <Calendar size={12} className="text-accent-orange" /> {contact.date_of_birth}
                </div>
              )}
            </div>
          </div>

          <div className="bg-primary-light border-2 border-white/5 p-8 rounded-xl space-y-6 shadow-sm">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] border-b-2 border-white/5 pb-4 font-display">{t('sections.financial')}</h4>
            <div className="space-y-4">
              {contact.iban && (
                <div className="flex flex-col gap-1">
                   <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest font-display">IBAN</span>
                   <span className="text-xs font-mono font-black text-white break-all bg-primary-dark p-2 rounded-lg border border-white/5">{contact.iban}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                {contact.bic_swift && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest font-display">BIC</span>
                    <span className="text-xs font-mono font-black text-white">{contact.bic_swift}</span>
                  </div>
                )}
                {contact.tax_vat_id && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest font-display">VAT ID</span>
                    <span className="text-xs font-mono font-black text-white">{contact.tax_vat_id}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {contact.custom_documents && (
        <div className="bg-primary-light border-2 border-white/5 p-8 rounded-xl">
          <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-6 flex items-center gap-3 font-display">
            <LinkIcon size={14} className="text-accent-blue" />
            {t('fields.custom_docs')}
          </h4>
          <div className="bg-primary-dark border border-white/5 rounded-xl p-6 text-xs text-white whitespace-pre-wrap font-mono font-bold leading-relaxed shadow-inner">
            {contact.custom_documents}
          </div>
        </div>
      )}

      <div className="bg-primary-light p-8 rounded-xl shadow-2xl relative overflow-hidden group border border-white/5">
        <div className="relative z-10">
          <h4 className="text-[10px] font-black text-accent-blue uppercase tracking-[0.3em] mb-6 flex items-center gap-3 font-display">
            <LinkIcon size={14} />
            {t('sidebar:network_identity')}
          </h4>
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-1">
              <div className="text-slate-500 font-black uppercase tracking-widest text-[9px] font-display">{t('sidebar:registry_date')}</div>
              <div className="text-white font-mono font-black tracking-tighter">
                {new Date(contact.created_at_utc).toLocaleDateString()}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-slate-500 font-black uppercase tracking-widest text-[9px] font-display">{t('sidebar:ai_confidence')}</div>
              <div className="text-accent-blue font-black font-mono tracking-tighter text-2xl">
                {(contact.ai_confidence_score * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-accent-orange/5 blur-[80px] rounded-full group-hover:bg-accent-orange/10 transition-all" />
      </div>

      {contact.email_address && (
        <MailDialog 
          isOpen={isMailOpen} 
          onClose={() => setIsMailOpen(false)} 
          recipientEmail={contact.email_address}
          recipientName={contact.full_legal_name}
          associatedType="contacts"
          associatedId={contact.id_uuid}
          associatedName={contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name}`.trim()}
        />
      )}
    </div>
  );
};
