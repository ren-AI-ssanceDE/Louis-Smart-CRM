import React from 'react';
import { motion } from 'motion/react';
import { 
  Building2, 
  Users, 
  FileText, 
  Check, 
  ExternalLink, 
  Loader2,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface PendingApprovalsCardProps {
  onNavigate?: (tab: string) => void;
}

export const PendingApprovalsCard: React.FC<PendingApprovalsCardProps> = ({ onNavigate }) => {
  const { t } = useTranslation(['common', 'dashboard']);
  const utils = trpc.useUtils();
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  // Queries
  const { data: companies = [], isLoading: loadingCompanies } = trpc.getCompanies.useQuery();
  const { data: contacts = [], isLoading: loadingContacts } = trpc.getContacts.useQuery();
  const { data: invoices = [], isLoading: loadingInvoices } = trpc.getInvoices.useQuery();

  // Mutations
  const verifyCompanyMutation = trpc.verifyCompany.useMutation({
    onSuccess: () => {
      utils.getCompanies.invalidate();
      toast.success(t('dashboard:company_verified_toast'));
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Freigeben des Unternehmens.');
    }
  });

  const deleteCompanyMutation = trpc.deleteCompany.useMutation({
    onSuccess: () => {
      utils.getCompanies.invalidate();
      toast.success(t('dashboard:company_rejected_toast'));
      setConfirmDeleteId(null);
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Löschen des Unternehmens.');
    }
  });

  const verifyContactMutation = trpc.verifyContact.useMutation({
    onSuccess: () => {
      utils.getContacts.invalidate();
      toast.success(t('dashboard:contact_verified_toast'));
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Freigeben des Kontakts.');
    }
  });

  const deleteContactMutation = trpc.deleteContact.useMutation({
    onSuccess: () => {
      utils.getContacts.invalidate();
      toast.success(t('dashboard:contact_rejected_toast'));
      setConfirmDeleteId(null);
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Löschen des Kontakts.');
    }
  });

  const finalizeDraftMutation = trpc.finalizeDraft.useMutation({
    onSuccess: (data) => {
      utils.getInvoices.invalidate();
      toast.success(t('dashboard:invoice_finalized_toast', { invoice_number: data.invoice_number }));
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Buchen des Rechnungsentwurfs.');
    }
  });

  const deleteInvoiceMutation = trpc.deleteInvoice.useMutation({
    onSuccess: () => {
      utils.getInvoices.invalidate();
      toast.success(t('dashboard:invoice_rejected_toast'));
      setConfirmDeleteId(null);
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Löschen der Rechnung.');
    }
  });

  const isLoading = loadingCompanies || loadingContacts || loadingInvoices;

  // Format pending lists
  const pendingCompanies = companies
    .filter((c: any) => c.is_verified_by_human === false)
    .map((c: any) => ({
      id: c.id_uuid!,
      type: 'company' as const,
      title: c.full_legal_name,
      subtitle: c.city ? `${c.postal_code || ''} ${c.city}`.trim() : 'Unverifiziertes Unternehmen (KI)',
      date: c.created_at_utc,
    }));

  const pendingContacts = contacts
    .filter((c: any) => c.is_verified_by_human === false)
    .map((c: any) => ({
      id: c.id_uuid!,
      type: 'contact' as const,
      title: c.full_legal_name || `${c.first_name || ''} ${c.last_name}`.trim() || 'Unbenannter Kontakt',
      subtitle: c.company_name ? `Bei: ${c.company_name}` : 'Unverifizierter Kontakt (KI)',
      date: c.created_at_utc,
    }));

  const pendingInvoices = invoices
    .filter((c: any) => c.payment_status === 'draft' || c.is_verified_by_human === false)
    .map((c: any) => ({
      id: c.id_uuid!,
      type: 'invoice' as const,
      title: c.invoice_number ? `Rechnung #${c.invoice_number}` : 'Rechnungsentwurf',
      subtitle: c.company_name || c.contact_full_name || 'Entwurf',
      amount: c.total_gross_amount,
      currency: c.currency_code,
      date: c.issue_date || c.created_at_utc,
    }));

  // Combine and sort by date descending
  const allPendingItems = [...pendingCompanies, ...pendingContacts, ...pendingInvoices]
    .sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
      return dateB - dateA;
    });

  const handleItemClick = (type: 'company' | 'contact' | 'invoice', id: string) => {
    if (!onNavigate) return;
    if (type === 'company') {
      localStorage.setItem('open_company_id', id);
      onNavigate('companies');
    } else if (type === 'contact') {
      localStorage.setItem('open_contact_id', id);
      onNavigate('contacts');
    } else if (type === 'invoice') {
      localStorage.setItem('open_invoice_id', id);
      onNavigate('invoices');
    }
  };

  const handleApprove = async (e: React.MouseEvent, type: 'company' | 'contact' | 'invoice', id: string) => {
    e.stopPropagation();
    if (type === 'company') {
      verifyCompanyMutation.mutate({ id_uuid: id });
    } else if (type === 'contact') {
      verifyContactMutation.mutate({ id_uuid: id });
    } else if (type === 'invoice') {
      finalizeDraftMutation.mutate({ id_uuid: id });
    }
  };

  const handleRejectConfirm = async (e: React.MouseEvent, type: 'company' | 'contact' | 'invoice', id: string) => {
    e.stopPropagation();
    if (type === 'company') {
      deleteCompanyMutation.mutate({ id_uuid: id });
    } else if (type === 'contact') {
      deleteContactMutation.mutate({ id_uuid: id });
    } else if (type === 'invoice') {
      deleteInvoiceMutation.mutate({ id_uuid: id });
    }
  };

  const formatAmount = (amount: number, currencyCode = 'EUR') => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currencyCode || 'EUR',
    }).format(amount);
  };

  const isMutatingAny = 
    verifyCompanyMutation.isPending || 
    verifyContactMutation.isPending || 
    finalizeDraftMutation.isPending ||
    deleteCompanyMutation.isPending ||
    deleteContactMutation.isPending ||
    deleteInvoiceMutation.isPending;

  return (
    <div id="pending-approvals-card" className="bg-primary-light border border-white/5 rounded-xl p-8 hover:border-white/10 transition-all relative overflow-hidden flex flex-col justify-between h-full">
      <div>
        {/* Title Block */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 rounded-lg text-amber-500">
              <AlertCircle size={22} />
            </div>
            <div>
              <h3 className="text-lg font-black text-white uppercase italic tracking-wider font-display">
                {t('dashboard:pending_approvals_title')}
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">
                {t('dashboard:pending_approvals_subtitle')}
              </p>
            </div>
          </div>
          {(isLoading || isMutatingAny) && (
            <Loader2 size={16} className="text-amber-500 animate-spin" />
          )}
        </div>

        {/* Content List */}
        {isLoading ? (
          <div className="space-y-4 py-4">
            {[1, 2, 3].map((val) => (
              <div key={val} className="h-14 bg-white/5 animate-pulse rounded-lg" />
            ))}
          </div>
        ) : allPendingItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center bg-white/[0.02] rounded-xl border border-white/5 p-6 my-4">
            <Check size={32} className="text-emerald-500 mb-2 opacity-80" />
            <span className="text-sm font-bold text-slate-300">
              {t('dashboard:no_pending_approvals')}
            </span>
            <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
              {t('dashboard:no_pending_desc')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mb-6 max-h-[360px] overflow-y-auto pr-1">
            {allPendingItems.map((item) => {
              const Icon = item.type === 'company' ? Building2 : item.type === 'contact' ? Users : FileText;
              const isMutatingThis = 
                (item.type === 'company' && verifyCompanyMutation.isPending && (verifyCompanyMutation.variables as any)?.id_uuid === item.id) ||
                (item.type === 'contact' && verifyContactMutation.isPending && (verifyContactMutation.variables as any)?.id_uuid === item.id) ||
                (item.type === 'invoice' && finalizeDraftMutation.isPending && (finalizeDraftMutation.variables as any)?.id_uuid === item.id);

              const isDeletingThis = 
                (item.type === 'company' && deleteCompanyMutation.isPending && (deleteCompanyMutation.variables as any)?.id_uuid === item.id) ||
                (item.type === 'contact' && deleteContactMutation.isPending && (deleteContactMutation.variables as any)?.id_uuid === item.id) ||
                (item.type === 'invoice' && deleteInvoiceMutation.isPending && (deleteInvoiceMutation.variables as any)?.id_uuid === item.id);

              return (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item.type, item.id)}
                  className="flex items-center justify-between p-4 bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] rounded-lg transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-4">
                    <div className="p-2.5 bg-white/5 rounded-lg text-slate-400 group-hover:text-white transition-colors shrink-0">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span className="text-white text-sm font-bold truncate">
                        {item.title}
                      </span>
                      <span className="text-slate-500 text-xs truncate mt-0.5" title={item.subtitle}>
                        {item.subtitle}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {item.type === 'invoice' && item.amount !== undefined && (
                      <span className="text-white font-mono text-xs font-bold bg-white/5 px-2.5 py-1 rounded">
                        {formatAmount(item.amount, item.currency)}
                      </span>
                    )}
                    
                    <div className="flex items-center gap-2">
                      {confirmDeleteId === item.id ? (
                        <div className="flex items-center gap-1.5 bg-red-950/20 border border-red-500/20 rounded-lg p-1" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[9px] text-red-400 font-extrabold uppercase tracking-widest px-1">{t('common:confirm_delete_question', { defaultValue: 'Löschen?' })}</span>
                          <button
                            type="button"
                            onClick={(e) => handleRejectConfirm(e, item.type, item.id)}
                            disabled={isMutatingAny}
                            className="bg-red-500 hover:bg-red-400 disabled:bg-red-600/50 text-neutral-black text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-md transition-all duration-300 flex items-center justify-center cursor-pointer"
                          >
                            {isDeletingThis ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              t('common:yes', { defaultValue: 'Ja' })
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                            className="bg-white/10 hover:bg-white/20 text-white text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-md transition-all duration-300 cursor-pointer"
                          >
                            {t('common:no', { defaultValue: 'Nein' })}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => handleApprove(e, item.type, item.id)}
                            disabled={isMutatingAny}
                            className="bg-amber-500 hover:bg-amber-400 disabled:bg-amber-600/50 text-neutral-black text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all duration-300 flex items-center gap-1.5 hover:shadow-[0_0_10px_rgba(245,158,11,0.3)] cursor-pointer"
                            title={t('dashboard:approve_tooltip')}
                          >
                            {isMutatingThis ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <Check size={11} />
                            )}
                            <span>{t('dashboard:approve_action')}</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(item.id);
                            }}
                            disabled={isMutatingAny}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/15 hover:border-red-500/30 rounded-lg transition-all transition-colors cursor-pointer"
                            title={t('dashboard:reject_tooltip')}
                          >
                            <Trash2 size={12} />
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleItemClick(item.type, item.id);
                            }}
                            className="p-2 border border-white/5 hover:border-white/10 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all transition-colors"
                            title={t('dashboard:view_tooltip')}
                          >
                            <ExternalLink size={12} />
                          </button>
                        </div>
                      )}
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
