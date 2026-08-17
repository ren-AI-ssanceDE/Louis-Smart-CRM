import React from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Building2, User, Mail, DollarSign, Calendar, Tag, CheckCircle, Paperclip } from 'lucide-react';
import { ProposedChangeAttachment, ProposedChangeItem } from '../types';

interface ProposedChangeViewerProps {
  entityType: string;
  action: string;
  proposedState: Record<string, unknown>;
}

const FIELD_LABELS: Record<string, string> = {
  offer_number: "Angebotsnummer",
  invoice_number: "Rechnungsnummer",
  title: "Titel / Betreff",
  issue_date: "Ausstellungsdatum",
  valid_until: "Gültig bis",
  due_date: "Fällig am",
  payment_term: "Zahlungsziel",
  currency_code: "Währung",
  total_net_amount: "Nettobetrag",
  total_vat_amount: "MwSt.-Betrag",
  total_gross_amount: "Gesamtbetrag (Brutto)",
  company_name: "Firmenname",
  full_legal_name: "Firmenname / Voller Name",
  legal_form: "Rechtsform",
  vat_id: "USt-ID",
  tax_vat_id: "USt-ID",
  tax_number: "Steuernummer",
  email_address: "E-Mail",
  email: "E-Mail",
  phone_number: "Telefon",
  phone: "Telefon",
  mobile: "Mobiltelefon",
  street_address: "Straße",
  street: "Straße",
  postal_code: "PLZ",
  zip: "PLZ",
  plz: "PLZ",
  city: "Ort",
  ort: "Ort",
  country: "Land",
  land: "Land",
  first_name: "Vorname",
  last_name: "Nachname",
  position_title: "Position",
  position: "Position",
  job_title: "Position",
  department: "Abteilung",
  responsible_person: "Verantwortlicher",
  iban: "IBAN",
  bic_swift: "BIC",
  website: "Webseite",
  notes: "Notizen",
  description: "Beschreibung",
  introductory_text: "Einleitungstext",
  closing_text: "Schlusstext",
  offer_status: "Status",
  invoice_status: "Status",
  recipient_email_address: "Empfänger E-Mail",
  email_subject_text: "Betreff",
  email_body_content: "Inhalt"
};

const HIDDEN_KEYS = new Set([
  'id_uuid',
  'tenant_id',
  'created_at_utc',
  'updated_at_utc',
  'pdf_file_path',
  'created_by_identity',
  'associated_company_id',
  'associated_contact_id',
  'company_id',
  'contact_id',
  'is_vat_inclusive',
  'line_items',
  'items_list',
  'items',
  'positions',
  'attachments'
]);

function formatMoney(amount: number | string | null | undefined, currency = 'EUR'): string {
  const num = Number(amount);
  if (isNaN(num)) return String(amount || '0,00 €');
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(num);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('de-DE', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export const ProposedChangeViewer: React.FC<ProposedChangeViewerProps> = ({
  entityType,
  proposedState
}) => {
  const { t } = useTranslation();

  if (!proposedState || typeof proposedState !== 'object') {
    return <div className="text-slate-400 text-xs italic">{t('proposed_change.no_data', { defaultValue: 'Keine Daten verfügbar' })}</div>;
  }

  // --- 1. E-MAIL DRAFT ---
  if (entityType === 'emails') {
    const recipient = String(proposedState.recipient_email_address || proposedState.recipient || '-');
    const subject = String(proposedState.email_subject_text || proposedState.subject || '-');
    const body = String(proposedState.email_body_content || proposedState.body || '');
    const attachments = (Array.isArray(proposedState.attachments) ? proposedState.attachments : []) as ProposedChangeAttachment[];

    return (
      <div className="space-y-3 font-sans text-xs">
        <div className="flex items-center gap-2 text-[11px] font-black uppercase text-accent-orange tracking-wider">
          <Mail size={14} />
          <span>{t('proposed_change.gobd_email_draft', { defaultValue: 'GoBD E-Mail Entwurf' })}</span>
        </div>
        <div className="bg-primary-dark/60 border border-white/5 rounded-xl p-3 space-y-2">
          <div className="flex border-b border-white/5 pb-2">
            <span className="text-slate-400 w-24 shrink-0 font-bold">{t('proposed_change.recipient', { defaultValue: 'Empfänger:' })}</span>
            <span className="text-white font-mono break-all">{recipient}</span>
          </div>
          <div className="flex border-b border-white/5 pb-2">
            <span className="text-slate-400 w-24 shrink-0 font-bold">{t('proposed_change.subject', { defaultValue: 'Betreff:' })}</span>
            <span className="text-white font-bold">{subject}</span>
          </div>
          {proposedState.invoice_id && (
            <div className="flex border-b border-white/5 pb-2 text-accent-orange font-bold">
              <span className="text-slate-400 w-24 shrink-0 font-bold">{t('proposed_change.attachment', { defaultValue: 'Anhang:' })}</span>
              <span>{t('proposed_change.pdf_attachment', { uuid: String(proposedState.invoice_id).substring(0, 8), defaultValue: `Rechnungs-PDF (UUID: ${String(proposedState.invoice_id).substring(0, 8)}...)` })}</span>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="flex border-b border-white/5 pb-2 text-sky-400 font-bold">
              <span className="text-slate-400 w-24 shrink-0 font-bold">{t('proposed_change.attachments', { defaultValue: 'Anhänge:' })}</span>
              <div className="space-y-1">
                {attachments.map((att: ProposedChangeAttachment, idx: number) => (
                  <div key={idx} className="flex items-center gap-1 truncate">
                    <Paperclip size={12} />
                    <span>{att.filename || att.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="pt-2">
            <span className="text-slate-400 font-bold block mb-1">{t('proposed_change.content', { defaultValue: 'Inhalt:' })}</span>
            <div
              className="bg-primary-dark border border-white/5 rounded-xl p-3 text-slate-300 max-h-48 overflow-y-auto leading-relaxed text-xs break-words"
              dangerouslySetInnerHTML={{ __html: String(body).replace(/\n/g, '<br/>') }}
            />
          </div>
        </div>
      </div>
    );
  }

  // --- 2. OFFERS & INVOICES ---
  if (entityType === 'offers' || entityType === 'invoices') {
    const isOffer = entityType === 'offers';
    const docNumber = String(proposedState.offer_number || proposedState.invoice_number || (isOffer ? t('proposed_change.offer_draft', { defaultValue: 'Angebot Entwurf' }) : t('proposed_change.invoice_draft', { defaultValue: 'Rechnung Entwurf' })));
    const title = String(proposedState.title || proposedState.subject || t('proposed_change.no_title', { defaultValue: 'Ohne Titel' }));
    const rawItems = proposedState.line_items || proposedState.items_list || proposedState.items || proposedState.positions;
    const items = (Array.isArray(rawItems) ? rawItems : []) as ProposedChangeItem[];
    const currency = String(proposedState.currency_code || 'EUR');

    return (
      <div className="space-y-4 font-sans text-xs">
        {/* Header Summary Card */}
        <div className="flex items-start justify-between bg-primary-dark/80 border border-accent-blue/20 rounded-xl p-3">
          <div>
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-accent-blue" />
              <span className="font-mono text-sm font-bold text-white">{docNumber}</span>
              <span className="bg-accent-blue/10 text-accent-blue text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                {isOffer ? t('proposed_change.offer_draft', { defaultValue: 'Angebotsentwurf' }) : t('proposed_change.invoice_draft', { defaultValue: 'Rechnungsentwurf' })}
              </span>
            </div>
            <p className="text-slate-300 font-medium text-xs mt-1">{title}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase font-bold">{t('proposed_change.total_amount', { defaultValue: 'Gesamtbetrag' })}</div>
            <div className="text-sm font-black text-emerald-400 font-mono">
              {formatMoney(Number(proposedState.total_gross_amount || 0), currency)}
            </div>
          </div>
        </div>

        {/* Metadata Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-primary-dark/40 border border-white/5 p-3 rounded-xl">
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.issue_date', { defaultValue: 'Ausstellungsdatum' })}</span>
            <span className="text-slate-200 font-mono">{formatDate(proposedState.issue_date as string)}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">
              {isOffer ? t('proposed_change.valid_until', { defaultValue: 'Gültig bis' }) : t('proposed_change.due_date', { defaultValue: 'Fällig am' })}
            </span>
            <span className="text-slate-200 font-mono">
              {formatDate((proposedState.valid_until || proposedState.due_date) as string)}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.payment_term', { defaultValue: 'Zahlungsziel' })}</span>
            <span className="text-slate-200">{String(proposedState.payment_term || t('proposed_change.default_payment_term', { defaultValue: '14 Tage netto' }))}</span>
          </div>
        </div>

        {/* Line Items Table */}
        {items.length > 0 && (
          <div>
            <div className="text-[11px] font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <span>{t('proposed_change.positions', { defaultValue: 'Positionen' })} ({items.length})</span>
            </div>
            <div className="overflow-x-auto border border-white/5 rounded-xl bg-primary-dark/60">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-slate-400 text-[10px] uppercase font-bold bg-white/5">
                    <th className="p-2 w-8 text-center">{t('proposed_change.pos_num', { defaultValue: '#' })}</th>
                    <th className="p-2">{t('proposed_change.description', { defaultValue: 'Beschreibung' })}</th>
                    <th className="p-2 text-right">{t('proposed_change.quantity', { defaultValue: 'Menge' })}</th>
                    <th className="p-2 text-right">{t('proposed_change.unit_price', { defaultValue: 'Einzelpreis' })}</th>
                    <th className="p-2 text-right">{t('proposed_change.vat', { defaultValue: 'MwSt.' })}</th>
                    <th className="p-2 text-right">{t('proposed_change.total', { defaultValue: 'Gesamt' })}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {items.map((item: ProposedChangeItem, idx: number) => {
                    const pos = item.position !== undefined ? item.position + 1 : idx + 1;
                    const desc = item.description || item.title || '-';
                    const qty = item.quantity ?? 1;
                    const price = item.unit_price ?? 0;
                    const vat = item.vat_rate ?? 19;
                    const net = item.total_net ?? (qty * price);
                    return (
                      <tr key={idx} className="hover:bg-white/5 transition-colors">
                        <td className="p-2 text-center text-slate-500 font-mono">{pos}</td>
                        <td className="p-2 text-slate-200 font-medium">{desc}</td>
                        <td className="p-2 text-right font-mono text-slate-300">{qty} {item.unit_code || t('proposed_change.pcs', { defaultValue: 'Stk' })}</td>
                        <td className="p-2 text-right font-mono text-slate-300">{formatMoney(price, currency)}</td>
                        <td className="p-2 text-right font-mono text-slate-400">{vat}%</td>
                        <td className="p-2 text-right font-mono text-white font-bold">{formatMoney(net, currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Totals Summary */}
        <div className="bg-primary-dark/80 border border-white/5 p-3 rounded-xl flex flex-col items-end gap-1 text-xs">
          <div className="flex justify-between w-48 text-slate-400">
            <span>{t('proposed_change.net_sum', { defaultValue: 'Netto summe:' })}</span>
            <span className="font-mono text-slate-200">{formatMoney(Number(proposedState.total_net_amount || 0), currency)}</span>
          </div>
          <div className="flex justify-between w-48 text-slate-400">
            <span>{t('proposed_change.vat_total', { defaultValue: 'MwSt. gesamt:' })}</span>
            <span className="font-mono text-slate-200">{formatMoney(Number(proposedState.total_vat_amount || 0), currency)}</span>
          </div>
          <div className="flex justify-between w-48 text-white font-bold text-sm border-t border-white/10 pt-1 mt-1">
            <span>{t('proposed_change.gross_total', { defaultValue: 'Gesamt (Brutto):' })}</span>
            <span className="font-mono text-emerald-400">{formatMoney(Number(proposedState.total_gross_amount || 0), currency)}</span>
          </div>
        </div>
      </div>
    );
  }

  // --- 3. COMPANIES ---
  if (entityType === 'companies') {
    const name = String(
      proposedState.full_legal_name ||
      proposedState.company_name ||
      proposedState.name ||
      t('proposed_change.new_company', { defaultValue: 'Neues Unternehmen' })
    );

    const legalForm = proposedState.legal_form ? String(proposedState.legal_form) : null;
    const vatId = (proposedState.vat_id || proposedState.tax_vat_id) ? String(proposedState.vat_id || proposedState.tax_vat_id) : null;
    const taxNumber = proposedState.tax_number ? String(proposedState.tax_number) : null;
    const email = (proposedState.email_address || proposedState.email) ? String(proposedState.email_address || proposedState.email) : null;
    const phone = (proposedState.phone_number || proposedState.phone || proposedState.mobile) ? String(proposedState.phone_number || proposedState.phone || proposedState.mobile) : null;

    const street = proposedState.street_address || proposedState.street;
    const postalCode = proposedState.postal_code || proposedState.zip || proposedState.plz;
    const city = proposedState.city || proposedState.ort;
    const country = proposedState.country || proposedState.land;

    const addressParts = [street, postalCode, city, country].map(x => x ? String(x) : '').filter(Boolean);
    const addressStr = addressParts.length > 0 ? addressParts.join(', ') : null;

    const responsiblePerson = (proposedState.responsible_person || proposedState.contact_person) ? String(proposedState.responsible_person || proposedState.contact_person) : null;
    const iban = proposedState.iban ? String(proposedState.iban) : null;
    const bic = (proposedState.bic_swift || proposedState.bic) ? String(proposedState.bic_swift || proposedState.bic) : null;

    const usedKeys = new Set([
      'full_legal_name', 'company_name', 'name', 'legal_form',
      'vat_id', 'tax_vat_id', 'tax_number',
      'email_address', 'email',
      'phone_number', 'phone', 'mobile',
      'street_address', 'street', 'postal_code', 'zip', 'plz', 'city', 'ort', 'country', 'land',
      'responsible_person', 'contact_person', 'iban', 'bic_swift', 'bic'
    ]);

    const remainingEntries = Object.entries(proposedState).filter(([key, val]) => {
      if (HIDDEN_KEYS.has(key) || usedKeys.has(key)) return false;
      if (val === null || val === undefined || val === '') return false;
      return true;
    });

    const hasStructuredDetails = Boolean(vatId || taxNumber || email || phone || addressStr || responsiblePerson || iban || bic);

    return (
      <div className="space-y-3 font-sans text-xs">
        <div className="flex items-center gap-3 bg-primary-dark/80 border border-white/5 p-3.5 rounded-xl">
          <div className="p-2.5 bg-accent-orange/10 border border-accent-orange/20 rounded-lg text-accent-orange shrink-0">
            <Building2 size={18} />
          </div>
          <div>
            <div className="font-bold text-white text-sm">{name}</div>
            {legalForm && (
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mt-0.5">{legalForm}</span>
            )}
          </div>
        </div>

        {(hasStructuredDetails || remainingEntries.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-primary-dark/40 border border-white/5 p-3.5 rounded-xl">
            {vatId && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.vat_id', { defaultValue: 'USt-ID' })}</span>
                <span className="text-white font-mono">{vatId}</span>
              </div>
            )}
            {taxNumber && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.tax_number', { defaultValue: 'Steuernummer' })}</span>
                <span className="text-white font-mono">{taxNumber}</span>
              </div>
            )}
            {email && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.email', { defaultValue: 'E-Mail' })}</span>
                <span className="text-white font-medium break-all">{email}</span>
              </div>
            )}
            {phone && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.phone', { defaultValue: 'Telefon' })}</span>
                <span className="text-white font-medium">{phone}</span>
              </div>
            )}
            {addressStr && (
              <div className="flex flex-col col-span-1 sm:col-span-2 border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.address', { defaultValue: 'Adresse' })}</span>
                <span className="text-white font-medium">{addressStr}</span>
              </div>
            )}
            {responsiblePerson && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.responsible_person', { defaultValue: 'Verantwortlicher' })}</span>
                <span className="text-white font-medium">{responsiblePerson}</span>
              </div>
            )}
            {iban && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">IBAN</span>
                <span className="text-white font-mono">{iban}</span>
              </div>
            )}
            {bic && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">BIC</span>
                <span className="text-white font-mono">{bic}</span>
              </div>
            )}
            {remainingEntries.map(([key, val]) => {
              const label = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return (
                <div key={key} className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                  <span className="text-[10px] text-slate-400 block font-bold">{label}</span>
                  <span className="text-white font-medium break-words">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // --- 4. CONTACTS ---
  if (entityType === 'contacts') {
    const fullNameFromParts = [proposedState.first_name, proposedState.last_name].map(x => x ? String(x) : '').filter(Boolean).join(' ');
    const fullName = fullNameFromParts || String(
      proposedState.full_legal_name ||
      proposedState.full_name ||
      proposedState.name ||
      proposedState.contact_name ||
      t('proposed_change.new_contact', { defaultValue: 'Neuer Kontakt' })
    );

    const position = (proposedState.position_title || proposedState.position || proposedState.job_title || proposedState.role) ? String(proposedState.position_title || proposedState.position || proposedState.job_title || proposedState.role) : null;
    const department = proposedState.department ? String(proposedState.department) : null;
    const email = (proposedState.email_address || proposedState.email) ? String(proposedState.email_address || proposedState.email) : null;
    const phone = (proposedState.phone_number || proposedState.phone || proposedState.mobile) ? String(proposedState.phone_number || proposedState.phone || proposedState.mobile) : null;
    const companyName = (proposedState.company_name || proposedState.associated_company_name) ? String(proposedState.company_name || proposedState.associated_company_name) : null;

    const street = proposedState.street_address || proposedState.street;
    const postalCode = proposedState.postal_code || proposedState.zip || proposedState.plz;
    const city = proposedState.city || proposedState.ort;
    const country = proposedState.country || proposedState.land;

    const addressParts = [street, postalCode, city, country].map(x => x ? String(x) : '').filter(Boolean);
    const addressStr = addressParts.length > 0 ? addressParts.join(', ') : null;

    const usedKeys = new Set([
      'first_name', 'last_name', 'full_legal_name', 'full_name', 'name', 'contact_name',
      'position_title', 'position', 'job_title', 'role', 'department',
      'email_address', 'email', 'phone_number', 'phone', 'mobile',
      'company_name', 'associated_company_name',
      'street_address', 'street', 'postal_code', 'zip', 'plz', 'city', 'ort', 'country', 'land'
    ]);

    const remainingEntries = Object.entries(proposedState).filter(([key, val]) => {
      if (HIDDEN_KEYS.has(key) || usedKeys.has(key)) return false;
      if (val === null || val === undefined || val === '') return false;
      return true;
    });

    const hasStructuredDetails = Boolean(email || phone || companyName || department || position || addressStr);

    return (
      <div className="space-y-3 font-sans text-xs">
        <div className="flex items-center gap-3 bg-primary-dark/80 border border-white/5 p-3.5 rounded-xl">
          <div className="p-2.5 bg-accent-blue/10 border border-accent-blue/20 rounded-lg text-accent-blue shrink-0">
            <User size={18} />
          </div>
          <div>
            <div className="font-bold text-white text-sm">{fullName}</div>
            {(position || department || companyName) && (
              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                {[position, department, companyName ? `bei ${companyName}` : ''].filter(Boolean).join(' • ')}
              </span>
            )}
          </div>
        </div>

        {(hasStructuredDetails || remainingEntries.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-primary-dark/40 border border-white/5 p-3.5 rounded-xl">
            {companyName && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.company', { defaultValue: 'Unternehmen' })}</span>
                <span className="text-white font-medium">{companyName}</span>
              </div>
            )}
            {email && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.email', { defaultValue: 'E-Mail' })}</span>
                <span className="text-white font-medium break-all">{email}</span>
              </div>
            )}
            {phone && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.phone', { defaultValue: 'Telefon' })}</span>
                <span className="text-white font-medium">{phone}</span>
              </div>
            )}
            {department && (
              <div className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.department', { defaultValue: 'Abteilung' })}</span>
                <span className="text-white font-medium">{department}</span>
              </div>
            )}
            {addressStr && (
              <div className="flex flex-col col-span-1 sm:col-span-2 border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                <span className="text-[10px] text-slate-400 block font-bold">{t('proposed_change.address', { defaultValue: 'Adresse' })}</span>
                <span className="text-white font-medium">{addressStr}</span>
              </div>
            )}
            {remainingEntries.map(([key, val]) => {
              const label = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return (
                <div key={key} className="flex flex-col border-b border-white/5 pb-1 sm:border-0 sm:pb-0">
                  <span className="text-[10px] text-slate-400 block font-bold">{label}</span>
                  <span className="text-white font-medium break-words">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // --- 5. GENERIC FALLBACK FOR OTHER ENTITIES ---
  const entries = Object.entries(proposedState).filter(([key, val]) => {
    if (HIDDEN_KEYS.has(key)) return false;
    if (val === null || val === undefined || val === '') return false;
    return true;
  });

  return (
    <div className="space-y-2 font-sans text-xs">
      <div className="text-[10px] uppercase font-black text-slate-400 mb-2 tracking-wider">
        {t('proposed_change.draft_details', { defaultValue: 'Entwurf-Details' })} ({entityType}):
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-primary-dark/60 border border-white/5 p-3 rounded-xl">
        {entries.map(([key, val]) => {
          const label = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          let displayVal = String(val);

          if (key.endsWith('_amount') || key.endsWith('_price')) {
            displayVal = formatMoney(Number(val));
          } else if (key.endsWith('_date')) {
            displayVal = formatDate(String(val));
          } else if (typeof val === 'object') {
            displayVal = JSON.stringify(val);
          }

          return (
            <div key={key} className="flex flex-col border-b border-white/5 pb-1">
              <span className="text-[10px] text-slate-400 font-bold">{label}</span>
              <span className="text-white font-medium truncate">{displayVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
