import React from 'react';
import { motion } from 'motion/react';
import { FileText, ArrowRight, Calendar, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { Invoice } from '../../types';
import { useTranslation } from 'react-i18next';

interface OpenInvoicesCardProps {
  onNavigate?: (tab: string) => void;
}

export const OpenInvoicesCard: React.FC<OpenInvoicesCardProps> = ({ onNavigate }) => {
  const { t } = useTranslation(['common', 'dashboard']);
  const { data: invoices = [], isLoading } = trpc.getInvoices.useQuery();

  // Filter open (pending or overdue) invoices
  const openInvoices = invoices.filter(
    (inv) => inv.payment_status === 'pending' || inv.payment_status === 'overdue'
  );

  // Helper to determine if an invoice is expired/overdue by date
  const isOverdueByDate = (inv: any) => {
    if (inv.payment_status === 'overdue') return true;
    if (inv.payment_status === 'pending' && inv.due_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(inv.due_date) < today;
    }
    return false;
  };

  // Sort by due_date ascending (nearest deadline first)
  const sortedOpenInvoices = [...openInvoices]
    .sort((a, b) => {
      const dateA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const dateB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return dateA - dateB;
    })
    .slice(0, 5);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      const d = new Date(dateString);
      if (isNaN(d.getTime())) return dateString;
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return dateString;
    }
  };

  const formatAmount = (amount: number, currencyCode = 'EUR') => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currencyCode || 'EUR',
    }).format(amount);
  };

  return (
    <div id="open-invoices-card" className="bg-primary-light border border-white/5 rounded-xl p-8 hover:border-white/10 transition-all relative overflow-hidden flex flex-col justify-between h-full">
      <div>
        {/* Title Block */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent-orange/10 rounded-lg text-accent-orange">
              <FileText size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white uppercase italic tracking-wider font-display">
                {t('open_invoices_card.title', { defaultValue: 'Ausstehende Rechnungen' })}
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">
                {t('open_invoices_card.subtitle', { defaultValue: 'Kritische Fälligkeiten (Max. 5)' })}
              </p>
            </div>
          </div>
          {isLoading && (
            <Loader2 size={16} className="text-slate-500 animate-spin" />
          )}
        </div>

        {/* Invoices List */}
        {isLoading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3].map((val) => (
              <div key={val} className="h-14 bg-white/5 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : sortedOpenInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center bg-white/[0.02] rounded-xl border border-white/5 p-6 my-4">
            <CheckCircle2 size={32} className="text-emerald-500 mb-2 opacity-80" />
            <span className="text-sm font-bold text-slate-300">{t('open_invoices_card.all_done', { defaultValue: 'Alles erledigt!' })}</span>
            <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
              {t('open_invoices_card.no_invoices', { defaultValue: 'Es liegen keine unbezahlten oder überfälligen Rechnungen vor.' })}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {sortedOpenInvoices.map((inv) => {
              const overdue = isOverdueByDate(inv);
              const recipientName = inv.company_name || inv.contact_full_name || 'Unbekannter Empfänger';

              return (
                <div
                  key={inv.id_uuid}
                  onClick={() => {
                    if (onNavigate) {
                      localStorage.setItem('open_invoice_id', inv.id_uuid);
                      onNavigate('invoices');
                    }
                  }}
                  className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] rounded-lg transition-all cursor-pointer group"
                >
                  <div className="flex flex-col min-w-0 pr-4">
                    <span className="text-slate-400 font-mono text-xs font-bold">
                      {inv.invoice_number}
                    </span>
                    <span className="text-white text-sm font-semibold truncate mt-0.5" title={recipientName}>
                      {recipientName}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 text-right shrink-0">
                    <div className="flex flex-col">
                      <span className="text-slate-500 font-bold text-[10px] uppercase tracking-widest">
                        {t('open_invoices_card.due_date', { defaultValue: 'Fälligkeit' })}
                      </span>
                      <span className={`text-xs font-semibold mt-0.5 ${overdue ? 'text-red-400' : 'text-slate-300'}`}>
                        {formatDate(inv.due_date)}
                      </span>
                    </div>

                    <div className="flex flex-col items-end">
                      <span className="text-white text-sm font-bold">
                        {formatAmount(inv.total_gross_amount, inv.currency_code)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-extrabold ${
                          overdue
                            ? 'bg-red-500/10 text-red-400 border border-red-500/10'
                            : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                        }`}
                      >
                        {overdue ? t('open_invoices_card.overdue', { defaultValue: 'Überfällig' }) : t('open_invoices_card.pending', { defaultValue: 'Ausstehend' })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
