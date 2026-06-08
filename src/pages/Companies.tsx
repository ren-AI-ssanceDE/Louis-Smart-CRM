import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { 
  Building2, Plus, Mail, MapPin, X, Phone, Globe, CreditCard, 
  Link as LinkIcon, Info, Smartphone, Search, ChevronLeft, 
  ChevronRight, Trash2, Download, FileText, Code, ExternalLink, CheckCircle2, Lock
} from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency } from '../lib/math';
import { Company, Invoice } from '../types';
import { trpc } from '../lib/trpc';
import { cn, getDueDateStatus, PAYMENT_METHODS } from '../lib/utils';
import { Dialog } from '../components/ui/Dialog';
import { MailDialog } from '../components/MailDialog';
import { CompanyProfile } from '../components/CompanyProfile';
import { FileBrowser } from '../components/FileBrowser';
import { CompanySchema } from '../lib/schemas';
import { z } from 'zod';

export const Companies = () => {
  const { t, i18n } = useTranslation(['companies', 'common', 'dashboard']);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [selectedCompany, setSelectedCompany] = React.useState<Company | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [mailTarget, setMailTarget] = React.useState<{ id_uuid?: string; email: string; name: string } | null>(null);
  const [emailValue, setEmailValue] = React.useState('');
  const [websiteValue, setWebsiteValue] = React.useState('');
  const [phoneValue, setPhoneValue] = React.useState('');
  const [mobileValue, setMobileValue] = React.useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = React.useState('');

  // Finalize (Zahlung erhalten) States
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = React.useState(false);
  const [finalizeInvoice, setFinalizeInvoice] = React.useState<any | null>(null);
  const [finalizeDate, setFinalizeDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [finalizeMethod, setFinalizeMethod] = React.useState('transfer');
  const [finalizeAmount, setFinalizeAmount] = React.useState(0);

  const finalizeInvoiceMutation = trpc.finalizeInvoice.useMutation({
    onSuccess: () => {
      toast.success(t('invoices:finalize_success', { defaultValue: 'Rechnung erfolgreich und unwiderruflich abgeschlossen.' }));
      setIsFinalizeDialogOpen(false);
      setFinalizeInvoice(null);
      utils.getInvoices.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t('invoices:finalize_error', { defaultValue: 'Fehler beim Abschließen der Rechnung.' }));
    }
  });

  const handleEmitPaymentClick = (invoice: Invoice) => {
    setFinalizeInvoice(invoice);
    setFinalizeDate(new Date().toISOString().split('T')[0]);
    setFinalizeMethod('transfer');
    setFinalizeAmount(invoice.total_gross_amount);
    setIsFinalizeDialogOpen(true);
  };

  // Search & Pagination constraints
  const [searchQuery, setSearchQuery] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [page, setPage] = React.useState(1);

  const utils = trpc.useUtils();
  const { data: companies = [], isLoading, error } = trpc.getCompanies.useQuery();
  const { data: myCompany } = trpc.getMyCompany.useQuery();
  const { data: invoices = [] } = trpc.getInvoices.useQuery();

  const companyInvoices = React.useMemo(() => {
    if (!selectedCompany) return [];
    return invoices
      .filter(inv => inv.associated_company_id === selectedCompany.id_uuid)
      .sort((a, b) => (a.invoice_number || '').localeCompare(b.invoice_number || ''));
  }, [invoices, selectedCompany]);

  const handleDownloadPdf = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/download-pdf?lang=${i18n.language}`);
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }
      const invoice = invoices.find(i => i.id_uuid === invoiceId);
      const recipientName = selectedCompany?.full_legal_name || 'Empfaenger';
      const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
      const cleanNum = (invoice?.invoice_number || invoiceId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${t('common:invoice_single', { defaultValue: 'Rechnung' })} - ${cleanRecipient} - ${cleanNum}.pdf`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("PDF download error:", e);
      toast.error(t('common:error_download_pdf', { defaultValue: 'Fehler beim Herunterladen der PDF' }));
    }
  };

  const handleDownloadXml = async (invoiceId: string) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/download-xml?lang=${i18n.language}`);
      if (!response.ok) {
        throw new Error(`Server status: ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `zugferd_${invoiceId}.xml`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error("XML download error:", e);
      toast.error(t('common:error_download_xml', { defaultValue: 'Fehler beim Herunterladen der XML' }));
    }
  };

  const displayColumns = React.useMemo(() => {
    if (myCompany?.companies_display_columns_json) {
      try {
        return JSON.parse(myCompany.companies_display_columns_json) as string[];
      } catch (_) {}
    }
    return ['responsible', 'comms', 'address', 'invoice'];
  }, [myCompany]);

  const getColHeaderLabel = (colKey: string) => {
    switch (colKey) {
      case 'responsible':
        return t('admin:columns_config.labels.responsible');
      case 'comms':
        return t('common:comms_short');
      case 'company':
        return t('admin:columns_config.labels.company');
      case 'address':
        return t('admin:columns_config.labels.address');
      case 'invoice':
        return t('companies:write_invoice');
      default:
        return 'Column';
    }
  };

  const renderCell = (colKey: string, company: Company) => {
    switch (colKey) {
      case 'responsible':
        return (
          <div 
            onClick={async (e) => {
              if (company.responsible_person) {
                e.stopPropagation();
                localStorage.setItem('search_query', company.responsible_person);
                try {
                  const contactsList = await utils.client.getContacts.query();
                  const match = contactsList.find(c => c.full_legal_name?.toLowerCase() === company.responsible_person?.toLowerCase());
                  if (match) {
                    localStorage.setItem('open_contact_id', match.id_uuid);
                  }
                } catch (_) {}
                window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'contacts' }));
              }
            }}
            className={cn(
              "text-xs font-bold text-slate-300 transition-colors",
              company.responsible_person ? "hover:text-accent-blue cursor-pointer underline decoration-white/10 decoration-dashed underline-offset-4" : "opacity-35"
            )}
          >
            {company.responsible_person || t('common:na')}
          </div>
        );
      case 'comms':
        return (
          <div className="flex flex-col gap-1">
            {company.email_address ? (
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  setMailTarget({ id_uuid: company.id_uuid, email: company.email_address!, name: company.full_legal_name });
                }}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Mail size={11} className="text-accent-blue" /> 
                {company.email_address}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 opacity-30">
                <Mail size={11} className="text-slate-700" /> {t('common:na')}
              </div>
            )}
            {company.website && (
              <a 
                href={company.website.toLowerCase().startsWith('http') ? company.website : `https://${company.website}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Globe size={11} className="text-accent-blue" /> 
                {company.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {company.phone_number && (
              <a 
                href={`tel:${company.phone_number}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Phone size={11} className="text-accent-blue" /> 
                {company.phone_number}
              </a>
            )}
          </div>
        );
      case 'company':
        return (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              handleOpenProfile(company);
            }}
            className="text-xs font-bold text-slate-400 hover:text-accent-orange cursor-pointer transition-colors"
          >
            {company.full_legal_name}
          </div>
        );
      case 'address':
        const addrParts = [
          company.street ? `${company.street} ${company.house_number || ''}`.trim() : null,
          company.postal_code || company.city ? `${company.postal_code || ''} ${company.city || ''}`.trim() : null
        ].filter(Boolean);
        return (
          <div className="flex flex-col gap-0.5 text-xs text-slate-400">
            {addrParts.length > 0 ? (
              addrParts.map((part, i) => <span key={i} className="font-semibold">{part}</span>)
            ) : (
              <span className="opacity-30">{t('common:na')}</span>
            )}
          </div>
        );
      case 'invoice':
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              localStorage.setItem('open_create_invoice_for_company_id', company.id_uuid);
              window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'invoices' }));
            }}
            className="px-3 py-1.5 rounded bg-accent-orange/10 hover:bg-accent-orange text-accent-orange hover:text-white border border-accent-orange/25 font-bold text-[9px] uppercase tracking-wider transition-all duration-200 cursor-pointer active:scale-95 flex items-center gap-1.5"
          >
            <Plus size={10} />
            {t('companies:write_invoice')}
          </button>
        );
      default:
        return <span className="text-slate-500 text-xs">-</span>;
    }
  };

  React.useEffect(() => {
    const queryId = localStorage.getItem('open_company_id');
    if (queryId && companies.length > 0) {
      localStorage.removeItem('open_company_id');
      const found = (companies as Company[]).find(c => c.id_uuid === queryId);
      if (found) {
        handleOpenProfile(found);
      }
    }
  }, [companies]);

  React.useEffect(() => {
    const q = localStorage.getItem('search_query');
    if (q) {
      localStorage.removeItem('search_query');
      setSearchQuery(q);
      setPage(1);
    }
  }, []);

  const filteredCompanies = React.useMemo(() => {
    return (companies as Company[]).filter(company => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        company.full_legal_name.replace(/\u0430/g, 'a').replace(/\u0455/g, 's').replace(/\u200B/g, '').toLowerCase().includes(q) ||
        (company.tax_vat_id || '').toLowerCase().includes(q) ||
        (company.tax_number || '').toLowerCase().includes(q) ||
        (company.city || '').toLowerCase().includes(q) ||
        (company.email_address || '').toLowerCase().includes(q) ||
        (company.website || '').toLowerCase().includes(q) ||
        (company.responsible_person || '').replace(/\u0430/g, 'a').replace(/\u0455/g, 's').replace(/\u200B/g, '').toLowerCase().includes(q)
      );
    });
  }, [companies, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / limit));

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [filteredCompanies.length, limit, totalPages, page]);

  const paginatedCompanies = React.useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredCompanies.slice(startIndex, startIndex + limit);
  }, [filteredCompanies, page, limit]);

  React.useEffect(() => {
    setEmailValue(selectedCompany?.email_address || '');
    setWebsiteValue(selectedCompany?.website || '');
    setPhoneValue(selectedCompany?.phone_number || '');
    setMobileValue(selectedCompany?.mobile_number || '');
  }, [selectedCompany]);

  React.useEffect(() => {
    if (selectedCompany) {
      const updated = (companies as Company[]).find(c => c.id_uuid === selectedCompany.id_uuid);
      if (updated && (
        JSON.stringify(updated.metadata) !== JSON.stringify(selectedCompany.metadata) ||
        updated.custom_documents !== selectedCompany.custom_documents ||
        updated.is_verified_by_human !== selectedCompany.is_verified_by_human
      )) {
        setSelectedCompany(updated);
      }
    }
  }, [companies, selectedCompany]);
  const createCompanyMutation = trpc.createCompany.useMutation({
    onSuccess: () => {
      setIsDialogOpen(false);
      utils.getCompanies.invalidate();
    }
  });

  const updateCompanyMutation = trpc.updateCompany.useMutation({
    onSuccess: (data, variables) => {
      if (selectedCompany) {
        setSelectedCompany(prev => prev ? { ...prev, ...variables } : null);
      }
      setIsDialogOpen(false);
      setSelectedCompany(null);
      utils.getCompanies.invalidate();
      toast.success(t('companies:save_success', { defaultValue: "Firma erfolgreich aktualisiert!" }));
    },
    onError: (err) => {
      toast.error(t('companies:save_error', { defaultValue: "Fehler beim Sichern der Firma: " }) + err.message);
    }
  });

  const deleteCompanyMutation = trpc.deleteCompany.useMutation({
    onSuccess: () => {
      setIsDeleteConfirmOpen(false);
      setIsDialogOpen(false);
      setSelectedCompany(null);
      utils.getCompanies.invalidate();
    }
  });

  const verifyCompanyMutation = trpc.verifyCompany.useMutation({
    onSuccess: () => {
      utils.getCompanies.invalidate();
      if (selectedCompany) {
        setSelectedCompany(prev => prev ? { ...prev, is_verified_by_human: true } : null);
      }
      toast.success(t('companies:verify_success', { defaultValue: "Firmenentwurf erfolgreich bestätigt und verifiziert!" }));
    },
    onError: (err) => {
      toast.error(t('companies:verify_error', { defaultValue: "Fehler beim Freigeben des Entwurfs: " }) + err.message);
    }
  });

  const exportCompanyToCSV = (comp: Company) => {
    const headers = i18n.language === 'en' ? [
      "ID", "Company Name", "VAT ID", "Tax Number", "Responsible Person",
      "Street", "House Number", "City", "Postal Code", "Country",
      "Email", "Email 2", "Website", "Phone", "Mobile Phone", "Fax",
      "IBAN", "BIC", "Leitweg-ID", "Payment Term", "Price List",
      "Documents_Notes", "Language", "Created By", "AI Confidence"
    ] : [
      "ID", "Firmenname", "USt-IdNr.", "Steuernummer", "Ansprechpartner",
      "Strasse", "Hausnummer", "Ort", "PLZ", "Land",
      "E-Mail", "E-Mail 2", "Webseite", "Telefon", "Mobiltelefon", "Fax",
      "IBAN", "BIC", "Leitweg-ID", "Zahlungsziel", "Preisliste",
      "Dokumente_Notizen", "Sprache", "Erstellt von", "AI Confidence"
    ];
    
    const values = [
      comp.id_uuid || "",
      comp.full_legal_name,
      comp.tax_vat_id || "",
      comp.tax_number || "",
      comp.responsible_person || "",
      comp.street || "",
      comp.house_number || "",
      comp.city || "",
      comp.postal_code || "",
      comp.country_code || "",
      comp.email_address || "",
      comp.email_2 || "",
      comp.website || "",
      comp.phone_number || "",
      comp.mobile_number || "",
      comp.fax_number || "",
      comp.iban || "",
      comp.bic_swift || "",
      comp.leitweg_id || "",
      comp.payment_term || "",
      comp.price_list || "",
      comp.custom_documents || "",
      comp.language || "",
      comp.created_by_identity || "",
      comp.ai_confidence_score?.toString() || ""
    ];

    const escapedValues = values.map(val => {
      const stringVal = typeof val === 'string' ? val : JSON.stringify(val);
      const cleanVal = stringVal.replace(/"/g, '""');
      return `"${cleanVal}"`;
    });

    const csvContent = "\uFEFF" + [headers.join(","), escapedValues.join(",")].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `backup_firma_${comp.full_legal_name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenProfile = (company: Company) => {
    setSelectedCompany(company);
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedCompany(null);
    setIsEditing(true);
    setErrors({});
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    const formData = new FormData(e.currentTarget);
    
    const sanitizeLigatures = (name: string): string => {
      if (!name) return name;
      return name
        .replace(/\u200B/g, '')
        .replace(/\u0430/g, 'a')
        .replace(/\u0455/g, 's')
        .replace(/\u0323/g, '')
        .replace(/\u00ad/g, '')
        .replace(/\xad/g, '');
    };

    const rawData = {
      full_legal_name: sanitizeLigatures(formData.get('name') as string),
      tax_vat_id: (formData.get('vat_id') as string) || null,
      tax_number: (formData.get('tax_number') as string) || null,
      responsible_person: (formData.get('responsible_person') as string) || null,
      street: (formData.get('street') as string) || null,
      house_number: (formData.get('house_number') as string) || null,
      city: (formData.get('city') as string) || null,
      postal_code: (formData.get('postal_code') as string) || null,
      country_code: (formData.get('country') as string || 'DE').toUpperCase(),
      email_address: (formData.get('email') as string) || null,
      email_2: (formData.get('email_2') as string) || null,
      website: (formData.get('website') as string) || null,
      phone_number: (formData.get('phone') as string) || null,
      mobile_number: (formData.get('mobile_number') as string) || null,
      fax_number: (formData.get('fax') as string) || null,
      iban: (formData.get('iban') as string) || null,
      bic_swift: (formData.get('bic_swift') as string) || null,
      leitweg_id: (formData.get('leitweg_id') as string) || null,
      short_code: (formData.get('short_code') as string) || null,
      payment_term: (formData.get('payment_term') as string) || null,
      price_list: (formData.get('price_list') as string) || null,
      language: (formData.get('language') as string) || 'de',
      opt_in_marketing: formData.get('opt_in') === 'on',
      opt_in_social_media: formData.get('opt_in_social') === 'on',
      opt_in_direct_message: formData.get('opt_in_dm') === 'on',
      opt_in_sms: formData.get('opt_in_sms') === 'on',
      opt_in_phone: formData.get('opt_in_phone') === 'on',
      custom_documents: (formData.get('custom_docs') as string) || null,
      ai_confidence_score: 1.0,
      is_verified_by_human: true,
      created_by_identity: 'human' as const
    };

    try {
      const validatedData = CompanySchema.parse(rawData);
      if (selectedCompany) {
        updateCompanyMutation.mutate({ ...validatedData, id_uuid: selectedCompany.id_uuid });
      } else {
        createCompanyMutation.mutate(validatedData);
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errorMap: Record<string, string> = {};
        err.issues.forEach(e => {
          if (e.path[0]) {
            errorMap[e.path[0].toString()] = e.message;
          }
        });
        setErrors(errorMap);
      }
    }
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-white font-display uppercase italic tracking-[0.05em]">{t('title')}</h2>
          <p className="text-slate-500 text-sm mt-1 uppercase tracking-widest font-semibold opacity-60 italic">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder={t('common:searching').replace('...', '').toUpperCase()}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full h-11 bg-primary-light border border-white/10 rounded-xl px-4 text-white text-xs font-bold focus:outline-none focus:border-accent-orange pl-10 placeholder:text-slate-500 placeholder:uppercase"
            />
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          </div>

          <div className="flex items-center gap-2 bg-primary-light border border-white/10 px-4 h-11 rounded-xl text-xs text-white">
            <span className="text-slate-500 uppercase tracking-widest font-black text-[10px]">
              {t('common:show')}
            </span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="bg-transparent text-white font-black uppercase text-xs focus:outline-none cursor-pointer border-none p-0 outline-none"
            >
              <option value={5} className="bg-primary-dark">5</option>
              <option value={10} className="bg-primary-dark">10</option>
              <option value={25} className="bg-primary-dark">25</option>
              <option value={50} className="bg-primary-dark">50</option>
            </select>
          </div>

          <button 
            onClick={handleAddNew}
            className="flex items-center gap-2 bg-accent-orange text-white px-6 h-11 rounded-xl font-bold hover:bg-accent-orange/90 transition-all shadow-xl shadow-accent-orange/20 active:scale-95 group font-display text-[11px] uppercase tracking-widest leading-none"
          >
            <Plus size={16} className="group-hover:rotate-90 transition-transform duration-300" />
            {t('add_new')}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-20 text-center">
            <div className="w-10 h-10 border-4 border-accent-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">{t('common:scanning')}</p>
        </div>
      ) : error ? (
        <div className="p-20 text-center bg-red-500/5 border border-red-500/20 rounded-xl">
           <X className="text-red-500 mx-auto mb-4" size={40} />
           <h3 className="text-white font-bold uppercase tracking-[0.2em] mb-2">{t('common:error')}</h3>
           <p className="text-slate-500 text-xs font-mono">{error.message}</p>
           <button 
             onClick={() => utils.getCompanies.invalidate()}
             className="mt-6 px-6 py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
           >
             {t('common:retry')}
           </button>
        </div>
      ) : (
        <div className="bg-primary-light/30 border border-white/5 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm no-scrollbar">
          <div className="overflow-x-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-primary-light/50 border-b border-white/5">
                  <th className="px-8 py-6 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('table.identity')}</th>
                  {displayColumns.map((colKey, colIdx) => (
                    <th key={`th-${colKey}-${colIdx}`} className="px-8 py-6 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                      {getColHeaderLabel(colKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {paginatedCompanies.map((company, idx) => (
                  <motion.tr
                    key={company.id_uuid}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => handleOpenProfile(company)}
                    className="hover:bg-primary-light transition-all cursor-pointer group"
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-accent-orange/10 border border-accent-blue/20 flex items-center justify-center text-accent-orange font-bold text-lg group-hover:bg-accent-orange group-hover:text-white transition-all duration-500 shadow-inner">
                          {company.full_legal_name.charAt(0)}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <span className="font-bold text-neutral-white group-hover:text-white transition-colors">{company.full_legal_name}</span>
                          {company.is_verified_by_human === false && (
                            <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border border-amber-500/20 tracking-wider w-fit">
                              Entwurf
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {displayColumns.map((colKey, colIdx) => (
                      <td key={`td-${company.id_uuid}-${colKey}-${colIdx}`} className="px-8 py-6">
                        {renderCell(colKey, company)}
                      </td>
                    ))}
                  </motion.tr>
                ))}
                 {filteredCompanies.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center">
                       <div className="flex flex-col items-center justify-center text-center opacity-50 italic">
                        <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600 mb-4">
                          <Building2 size={24} />
                        </div>
                        <h4 className="text-slate-500 font-bold uppercase tracking-widest text-xs">{t('empty')}</h4>
                        <p className="text-slate-705 text-[10px] mt-2 max-w-xs">
                          {searchQuery ? t('no_search_results') : t('empty_desc')}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredCompanies.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-4 bg-primary-dark/40 border-t border-white/5">
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                {t('common:pagination_entries', { from: Math.min(filteredCompanies.length, (page - 1) * limit + 1), to: Math.min(filteredCompanies.length, page * limit), count: filteredCompanies.length })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-slate-300 font-mono font-bold bg-primary-dark/80 px-3 py-1.5 rounded-lg border border-white/5 min-w-[50px] text-center">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog 
        isOpen={isDialogOpen} 
        onClose={() => {
          setIsDialogOpen(false);
          setSelectedCompany(null);
          setErrors({});
        }} 
        title={selectedCompany ? t('edit_title') : t('add_new')}
        size="full"
        noPadding
      >
        <div className="flex flex-col h-full bg-primary-dark max-h-[90vh]">
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-0 min-h-full">
                <div className="lg:col-span-2 p-12 space-y-12 overflow-y-auto">
                  {selectedCompany && selectedCompany.is_verified_by_human === false && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }} 
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-gradient-to-r from-amber-500/15 to-transparent border border-amber-500/20 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-amber-400">
                          <svg className="w-5 h-5 animate-pulse shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.1" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                          </svg>
                          <h4 className="text-xs font-black uppercase tracking-widest font-display">{t('dashboard:pending_approvals_banner.title')}</h4>
                        </div>
                        <p className="text-xs text-slate-400 font-sans leading-relaxed">
                          {t('dashboard:pending_approvals_banner.desc')}
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={updateCompanyMutation.isPending || createCompanyMutation.isPending}
                        className="w-full sm:w-auto shrink-0 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-600/50 text-neutral-black text-[10px] font-black uppercase tracking-widest px-5 py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] cursor-pointer"
                      >
                        {updateCompanyMutation.isPending ? t('dashboard:pending_approvals_banner.saving') : t('dashboard:pending_approvals_banner.approve_action')}
                      </button>
                    </motion.div>
                  )}
                  {/* Section 1: Company Information */}
                  <div className="space-y-12">
                    <div className="flex items-center gap-3 pb-4 border-b-2 border-white/5">
                      <div className="w-2 h-2 rounded-full bg-accent-orange shadow-[0_0_8px_rgba(255,103,22,0.6)]" />
                      <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('common:details')}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                      {/* Row 1 */}
                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('name')} <span className="text-accent-orange">*</span></label>
                        <input 
                          name="name" 
                          required 
                          maxLength={255}
                          defaultValue={selectedCompany?.full_legal_name?.replace(/\u0430/g, 'a')?.replace(/\u0455/g, 's')?.replace(/\u200B/g, '')}
                          className={cn(
                            "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                            errors.full_legal_name ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                          )}
                          placeholder={t('placeholders.name')}
                        />
                        {errors.full_legal_name && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.full_legal_name}</p>}
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.email')}</label>
                        <div className="relative">
                          <input 
                            type="email" 
                            name="email" 
                            maxLength={255} 
                            value={emailValue}
                            onChange={(e) => setEmailValue(e.target.value)}
                            className={cn(
                              "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                              errors.email_address ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                            )}
                          />
                          <button
                            type="button"
                            disabled={!emailValue}
                            onClick={() => setMailTarget({ id_uuid: selectedCompany?.id_uuid, email: emailValue, name: (document.getElementsByName('name')[0] as HTMLInputElement)?.value || '' })}
                            className={cn(
                              "absolute right-5 top-1/2 -translate-y-1/2 transition-colors duration-300",
                              emailValue ? "text-accent-orange hover:text-accent-orange/80 cursor-pointer" : "text-slate-600 cursor-default"
                            )}
                          >
                            <Mail size={18} />
                          </button>
                        </div>
                        {errors.email_address && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.email_address}</p>}
                      </div>

                      {/* Row 2 */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2 space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.street')}</label>
                          <input name="street" maxLength={200} defaultValue={selectedCompany?.street || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.house_number')}</label>
                          <input name="house_number" maxLength={20} defaultValue={selectedCompany?.house_number || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all text-center placeholder:text-slate-700" />
                        </div>
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.website')}</label>
                        <div className="relative">
                          <input 
                            type="url" 
                            name="website" 
                            maxLength={255} 
                            value={websiteValue}
                            onChange={(e) => setWebsiteValue(e.target.value)}
                            className={cn(
                              "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                              errors.website ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                            )}
                            placeholder="https://" 
                          />
                          {websiteValue ? (
                            <a
                              href={websiteValue.startsWith('http') ? websiteValue : `https://${websiteValue}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute right-5 top-1/2 -translate-y-1/2 text-accent-orange hover:text-accent-orange/80 transition-colors duration-300"
                            >
                              <Globe size={18} />
                            </a>
                          ) : (
                            <Globe className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                          )}
                        </div>
                        {errors.website && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.website}</p>}
                      </div>

                      {/* Row 3 */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.zip')}</label>
                          <input name="postal_code" maxLength={10} defaultValue={selectedCompany?.postal_code || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" />
                        </div>
                        <div className="col-span-2 space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('city')}</label>
                          <input name="city" maxLength={100} defaultValue={selectedCompany?.city || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                        </div>
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.phone')}</label>
                        <div className="relative">
                          <input 
                            type="tel" 
                            name="phone" 
                            maxLength={50} 
                            value={phoneValue}
                            onChange={(e) => setPhoneValue(e.target.value)}
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                            placeholder="+49 123 456789"
                          />
                          {phoneValue ? (
                            <a
                              href={`tel:${phoneValue.replace(/\s+/g, '')}`}
                              className="absolute right-5 top-1/2 -translate-y-1/2 text-accent-orange hover:text-accent-orange/80 transition-colors duration-300"
                            >
                              <Phone size={16} />
                            </a>
                          ) : (
                            <Phone className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={16} />
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.responsible')}</label>
                        <input 
                          name="responsible_person" 
                          maxLength={100} 
                          defaultValue={selectedCompany?.responsible_person || ''} 
                          className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" 
                          placeholder={t('placeholders.responsible')}
                        />
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.mobile')}</label>
                        <div className="relative">
                          <input 
                            type="tel" 
                            name="mobile_number" 
                            maxLength={50} 
                            value={mobileValue}
                            onChange={(e) => setMobileValue(e.target.value)}
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                            placeholder="+49 123 456789"
                          />
                          {mobileValue ? (
                            <a
                              href={`https://wa.me/${mobileValue.replace(/[\s\+]+/g, '')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="absolute right-5 top-1/2 -translate-y-1/2 text-accent-orange hover:text-accent-orange/80 transition-colors duration-300"
                            >
                              <Smartphone size={16} />
                            </a>
                          ) : (
                            <Smartphone className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={16} />
                          )}
                        </div>
                      </div>

                      <div className="col-span-full space-y-6 pt-10 border-t border-white/5">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in" 
                                defaultChecked={selectedCompany?.opt_in_marketing} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in_email')}</span>
                          </label>

                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in_phone" 
                                defaultChecked={selectedCompany?.opt_in_phone} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in_phone')}</span>
                          </label>

                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in_sms" 
                                defaultChecked={selectedCompany?.opt_in_sms} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in_sms')}</span>
                          </label>

                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in_dm" 
                                defaultChecked={selectedCompany?.opt_in_direct_message} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in_dm')}</span>
                          </label>

                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in_social" 
                                defaultChecked={selectedCompany?.opt_in_social_media} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in_social')}</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Financial Data */}
                  <div className="space-y-8">
                    <div className="flex items-center gap-3 pb-4 border-b-2 border-white/5">
                      <div className="w-2 h-2 rounded-full bg-accent-blue shadow-[0_0_8px_rgba(0,123,255,0.6)]" />
                      <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('sections.finance_ident')}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.iban')}</label>
                          <input 
                            name="iban" 
                            maxLength={34} 
                            defaultValue={selectedCompany?.iban || ''} 
                            className={cn(
                              "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                              errors.iban ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                            )}
                            placeholder="DE00 0000 0000 ..." 
                          />
                          {errors.iban && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.iban}</p>}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.short_code', { defaultValue: 'Kürzel' })}</label>
                            <input 
                              name="short_code" 
                              maxLength={50} 
                              defaultValue={selectedCompany?.short_code || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                            />
                          </div>
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.bic_swift')}</label>
                            <input 
                              name="bic_swift" 
                              maxLength={11} 
                              defaultValue={selectedCompany?.bic_swift || ''} 
                              className={cn(
                                "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                                errors.bic_swift ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-orange/10 focus:border-accent-orange"
                              )}
                            />
                            {errors.bic_swift && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.bic_swift}</p>}
                          </div>
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.vat_id')}</label>
                            <input 
                              name="vat_id" 
                              maxLength={20} 
                              defaultValue={selectedCompany?.tax_vat_id || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                            />
                          </div>
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.tax_number', { defaultValue: 'Steuernummer' })}</label>
                            <input 
                              name="tax_number" 
                              maxLength={20} 
                              defaultValue={selectedCompany?.tax_number || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" 
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.payment_term')}</label>
                            <div className="relative">
                              <select name="payment_term" defaultValue={selectedCompany?.payment_term || '14'} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all appearance-none">
                                <option value="14">{t('payment_terms.net_14')}</option>
                                <option value="30">{t('payment_terms.net_30')}</option>
                                <option value="60">{t('payment_terms.net_60')}</option>
                              </select>
                            </div>
                          </div>
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.price_list')}</label>
                            <input name="price_list" defaultValue={selectedCompany?.price_list || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all placeholder:text-slate-700" />
                          </div>
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.leitweg_id')}</label>
                          <input name="leitweg_id" defaultValue={selectedCompany?.leitweg_id || ''} className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all font-mono placeholder:text-slate-700" />
                        </div>
                      </div>
                    </div>

                    {selectedCompany && (
                      <div className="pt-8 border-t border-white/5 space-y-6">
                        <div className="flex items-center justify-between">
                          <h5 className="text-xs font-black text-white uppercase tracking-[0.2em] font-display flex items-center gap-2.5">
                            <CreditCard size={14} className="text-accent-blue" />
                            Rechnungsverlauf ({companyInvoices.length})
                          </h5>
                          <button
                            type="button"
                            onClick={() => {
                              localStorage.setItem('open_create_invoice_for_company_id', selectedCompany.id_uuid);
                              window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'invoices' }));
                              setIsDialogOpen(false);
                            }}
                            className="px-3 py-2 bg-accent-orange/10 hover:bg-accent-orange text-accent-orange hover:text-black border border-accent-orange/20 rounded-xl font-bold text-[10px] uppercase tracking-wider transition-all cursor-pointer flex items-center gap-2 active:scale-95 text-center"
                          >
                            <Plus size={12} />
                            {t('companies:write_invoice')}
                          </button>
                        </div>

                        {companyInvoices.length === 0 ? (
                          <div className="bg-primary-dark/30 border border-white/5 rounded-xl p-8 text-center text-xs text-slate-500 italic">
                            Keine Rechnungen für dieses Unternehmen gefunden.
                          </div>
                        ) : (
                          <div className="bg-primary-dark/40 border border-white/5 rounded-xl overflow-hidden divide-y divide-white/5 max-h-[300px] overflow-y-auto no-scrollbar">
                            {companyInvoices.map((inv) => {
                              const { formatted, badgeClasses } = getDueDateStatus(inv, i18n.language, 'compact');
                              const isPaidFinalized = (() => {
                                if (inv.payment_status === 'paid') return true;
                                try {
                                  const meta = typeof inv.metadata === 'string' ? JSON.parse(inv.metadata) : (inv.metadata || {});
                                  return !!meta.is_finalized;
                                } catch (_) {
                                  return false;
                                }
                              })();
                              return (
                                <div key={inv.id_uuid} className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-white/[0.01] transition-colors">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-lg bg-primary-light border border-white/5 flex items-center justify-center text-slate-400">
                                      <FileText size={18} />
                                    </div>
                                    <div>
                                      <div className="text-white text-xs font-bold font-mono flex items-center gap-1.5">
                                        <span>{inv.invoice_number}</span>
                                        {isPaidFinalized && (
                                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/35 px-1 py-0.2 rounded text-[8px] font-black uppercase font-sans">
                                            GEBUCHT
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mt-0.5">
                                        {new Date(inv.issue_date).toLocaleDateString(i18n.language)}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-6">
                                    <div className="flex flex-col items-start sm:items-end">
                                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">{t('invoices:due_date', { defaultValue: 'Fälligkeit' })}</span>
                                      <span className={badgeClasses}>{formatted}</span>
                                    </div>

                                    <div className="flex flex-col items-start sm:items-end">
                                      <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">{t('invoices:gross_amount', { defaultValue: 'Bruttobetrag' })}</span>
                                      <span className="text-xs font-bold text-white font-mono">{formatCurrency(inv.total_gross_amount || 0, inv.currency_code || 'EUR')}</span>
                                    </div>

                                    <div className="flex items-center gap-1">
                                      {!isPaidFinalized && (
                                        <button
                                          type="button"
                                          onClick={() => handleEmitPaymentClick(inv)}
                                          className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600 transition-all cursor-pointer active:scale-95"
                                          title={t('invoices:book_payment_action', { defaultValue: 'Zahlung erhalten / Buchen' })}
                                        >
                                          <CheckCircle2 size={14} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadPdf(inv.id_uuid)}
                                        className="p-2 bg-primary-light border border-white/5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer active:scale-95"
                                        title={t('invoices:download_pdf_action', { defaultValue: 'PDF herunterladen' })}
                                      >
                                        <Download size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadXml(inv.id_uuid)}
                                        className="p-2 bg-primary-light border border-white/5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer active:scale-95"
                                        title={t('invoices:download_xml_action', { defaultValue: 'ZUGFeRD XML herunterladen' })}
                                      >
                                        <Code size={14} />
                                      </button>
                                      {isPaidFinalized ? (
                                        <div
                                          className="p-2 bg-primary-light/50 border border-white/5 rounded-lg text-slate-500 cursor-not-allowed opacity-60"
                                          title={t('invoices:invoice_locked_action', { defaultValue: 'Rechnung abgeschlossen (Öffnen gesperrt)' })}
                                        >
                                          <Lock size={14} />
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            localStorage.setItem('open_invoice_id', inv.id_uuid);
                                            window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'invoices' }));
                                            setIsDialogOpen(false);
                                          }}
                                          className="p-2 bg-primary-light border border-white/5 rounded-lg text-accent-blue hover:bg-accent-blue hover:text-white transition-all cursor-pointer active:scale-95"
                                          title={t('invoices:open_in_overview_action', { defaultValue: 'In Rechnungsübersicht öffnen' })}
                                        >
                                          <ExternalLink size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Sidebar: Side Actions & Notes */}
                <div className="bg-primary-light p-12 space-y-12 border-l border-white/5">
                   <div className="space-y-8">
                      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                        <div className="w-2 h-2 rounded-full bg-accent-orange" />
                        <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('sections.docs_compliance')}</h4>
                      </div>

                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.notes')}</label>
                        <textarea 
                          name="custom_docs" 
                          rows={10}
                          defaultValue={selectedCompany?.custom_documents || ''}
                          className="w-full bg-primary-dark border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-orange/10 focus:border-accent-orange transition-all resize-none shadow-inner placeholder:text-slate-700"
                          placeholder={t('placeholders.notes')}
                        />
                      </div>

                      {selectedCompany && (
                        <div className="space-y-4 pt-4 border-t border-white/5">
                          <div className="bg-primary-dark border-2 border-white/5 p-6 rounded-xl">
                            <FileBrowser 
                              type="companies" 
                              id={selectedCompany.id_uuid} 
                              name={selectedCompany.full_legal_name} 
                            />
                          </div>
                        </div>
                      )}

                      {selectedCompany && (
                        <div className="space-y-4 pt-6 border-t border-red-500/10 bg-red-500/5 p-6 rounded-xl border border-red-500/10">
                          <h5 className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2 font-display">
                            <Trash2 size={12} />
                            {t('companies:danger_zone.title', { defaultValue: 'Gefahrenbereich (Löschen)' })}
                          </h5>
                          <p className="text-slate-400 text-[10px] leading-relaxed font-semibold">
                            {t('companies:danger_zone.desc', { defaultValue: 'Dieses Firmenprofil unwiderruflich von unserem System und allen angeschlossenen Datenbanken löschen.' })}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteConfirmationInput('');
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="w-full bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/25 py-3 rounded-xl font-bold uppercase text-[10px] tracking-wider transition-all duration-200 cursor-pointer text-center"
                          >
                            {t('companies:danger_zone.btn', { defaultValue: 'Firmenprofil endgültig löschen' })}
                          </button>
                        </div>
                      )}


                   </div>

                   <div className="space-y-4 pt-12 mt-12 border-t border-white/10">
                      <button 
                        type="submit"
                        disabled={createCompanyMutation.isPending || updateCompanyMutation.isPending}
                        className="w-full bg-accent-orange text-white py-5 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-2xl shadow-accent-orange/30 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                      >
                        {(createCompanyMutation.isPending || updateCompanyMutation.isPending) && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        {(createCompanyMutation.isPending || updateCompanyMutation.isPending) ? t('common:loading') : t('common:save')}
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setSelectedCompany(null);
                          setErrors({});
                        }}
                        className="w-full bg-primary-light border-2 border-white/5 text-slate-500 py-5 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-white/5 transition-all active:scale-95"
                      >
                        {t('common:cancel')}
                      </button>
                   </div>
                </div>
              </form>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setDeleteConfirmationInput('');
        }}
        title={t('companies:delete_modal.title', { defaultValue: '⚠️ Profil endgültig löschen?' })}
        size="md"
      >
        <div className="space-y-6 text-slate-305">
          <p className="text-sm text-slate-300">
            {t('companies:delete_modal.confirm_desc1', { defaultValue: 'Sie sind im Begriff, das Firmenprofil von ' })}<strong className="text-white font-black">{selectedCompany?.full_legal_name}</strong>{t('companies:delete_modal.confirm_desc2', { defaultValue: ' dauerhaft und unwiderruflich aus allen Registern zu löschen.' })}
          </p>

          <div className="bg-primary-dark/80 border-2 border-red-500/10 p-5 rounded-xl space-y-3">
            <span className="text-[10px] font-black text-accent-orange uppercase tracking-widest block">{t('companies:delete_modal.backup_title', { defaultValue: 'Sicherheitskopie empfohlen:' })}</span>
            <p className="text-xs text-slate-400 font-semibold leading-relaxed">
              {t('companies:delete_modal.backup_desc', { defaultValue: 'Bitte sichern Sie die Profildaten dieses Datensatzes als .csv-Datei, bevor Sie fortfahren.' })}
            </p>
            <button
              type="button"
              onClick={() => selectedCompany && exportCompanyToCSV(selectedCompany)}
              className="flex items-center gap-2 bg-primary-light hover:bg-white/5 text-white px-4 py-3 rounded-xl text-xs font-black border border-white/5 transition-all w-full justify-center cursor-pointer active:scale-95"
            >
              <Download size={14} className="text-accent-blue font-bold animate-bounce" />
              {t('companies:delete_modal.export_btn', { defaultValue: 'Daten als .csv exportieren' })}
            </button>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.1em] block">
              {t('companies:delete_modal.confirm_type_label_1', { defaultValue: 'Bitte geben Sie zur Bestätigung ' })}<span className="text-red-500 font-black">{t('companies:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' })}</span>{t('companies:delete_modal.confirm_type_label_2', { defaultValue: ' ein:' })}
            </label>
            <input
              type="text"
              value={deleteConfirmationInput}
              onChange={(e) => setDeleteConfirmationInput(e.target.value)}
              placeholder={t('companies:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' })}
              className="w-full bg-primary-dark border-2 border-white/5 rounded-xl px-4 py-3 text-white text-sm font-bold text-center focus:outline-none focus:border-red-550 focus:ring-4 focus:ring-red-600/5 transition-all"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-white/5">
            <button
              type="button"
              disabled={deleteConfirmationInput !== t('companies:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' }) || deleteCompanyMutation.isPending}
              onClick={() => {
                if (selectedCompany?.id_uuid) {
                  deleteCompanyMutation.mutate({ id_uuid: selectedCompany.id_uuid });
                }
              }}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-20 disabled:hover:bg-red-600 text-white py-3.5 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:cursor-not-allowed"
            >
              {deleteCompanyMutation.isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t('companies:delete_modal.delete_btn', { defaultValue: 'Dauerhaft löschen' })}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsDeleteConfirmOpen(false);
                setDeleteConfirmationInput('');
              }}
              className="flex-1 bg-primary-light border border-white/5 hover:bg-white/5 text-slate-400 py-3.5 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all cursor-pointer text-center"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
          </div>
        </div>
      </Dialog>

      {mailTarget && (
        <MailDialog
          isOpen={!!mailTarget}
          onClose={() => setMailTarget(null)}
          recipientEmail={mailTarget.email}
          recipientName={mailTarget.name}
          associatedType="companies"
          associatedId={mailTarget.id_uuid}
          associatedName={mailTarget.name}
        />
      )}

      <Dialog
        isOpen={isFinalizeDialogOpen}
        onClose={() => {
          setIsFinalizeDialogOpen(false);
          setFinalizeInvoice(null);
        }}
        title={t('invoices:finalize.dialog_title', { defaultValue: "Zahlung erhalten & Rechnung abschließen" })}
        size="md"
      >
        <div className="space-y-5 pt-4 text-left">
          <div className="flex items-start gap-3 bg-emerald-500/10 p-5 rounded-xl border border-emerald-500/20">
            <div className="text-emerald-500 mt-0.5 shrink-0">
              <CheckCircle2 size={24} />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-emerald-400 uppercase tracking-wider">
                {t('invoices:finalize.gobd_header', { defaultValue: "Unwiderruflicher Rechnungsabschluss" })}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                {(() => {
                  const fullText = t('invoices:finalize.gobd_desc_1', { number: '###', defaultValue: 'Sie schließen die Rechnung ### final ab.' });
                  const parts = fullText.split('###');
                  return (
                    <>
                      {parts[0]}
                      <span className="font-mono text-emerald-400 font-bold">{finalizeInvoice?.invoice_number}</span>
                      {parts[1]}
                    </>
                  );
                })()}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-sans font-medium">
                {t('invoices:finalize.gobd_desc_2_part1', { defaultValue: 'Nach dem Speichern wird der Rechnungsstatus fest auf ' })}
                <span className="text-emerald-400 font-bold font-mono">
                  {t('invoices:finalize.gobd_desc_2_paid', { defaultValue: '"Bezahlt"' })}
                </span>
                {t('invoices:finalize.gobd_desc_2_part2', { defaultValue: ' gesetzt. Die Rechnung und alle zugehörigen Dokumente (PDF, XML) sind danach ' })}
                <span className="text-rose-400 font-bold underline">
                  {t('invoices:finalize.gobd_desc_2_locked', { defaultValue: 'nicht mehr bearbeitbar und nicht mehr löschbar' })}
                </span>
                {t('invoices:finalize.gobd_desc_2_part3', { defaultValue: '!' })}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 font-mono">
                {t('invoices:finalize.payment_date', { defaultValue: "Zahlungsdatum" })}
              </label>
              <input
                type="date"
                required
                value={finalizeDate}
                onChange={(e) => setFinalizeDate(e.target.value)}
                className="w-full h-11 bg-slate-900 border border-white/5 rounded-xl px-4 text-xs font-bold font-sans text-white focus:outline-none focus:border-accent-orange transition-all"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 font-mono">
                {t('invoices:finalize.payment_method', { defaultValue: "Zahlart" })}
              </label>
              <select
                value={finalizeMethod}
                onChange={(e) => setFinalizeMethod(e.target.value)}
                className="w-full h-11 bg-slate-900 border border-white/5 rounded-xl px-4 text-xs font-bold font-sans text-white focus:outline-none focus:border-accent-orange transition-all"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {t(method.labelKey, { defaultValue: method.fallback })}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 font-mono">
                {t('invoices:finalize.payment_amount', { defaultValue: "Zahlungsbetrag (EUR)" })}
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={finalizeAmount}
                onChange={(e) => setFinalizeAmount(parseFloat(e.target.value) || 0)}
                className="w-full h-11 bg-slate-900 border border-white/5 rounded-xl px-4 text-xs font-bold font-mono text-white focus:outline-none focus:border-accent-orange transition-all"
              />
              <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase tracking-wider">
                {t('invoices:finalize.gross_amount_hint', { 
                  amount: finalizeInvoice ? formatCurrency(finalizeInvoice.total_gross_amount, finalizeInvoice.currency_code) : '—',
                  defaultValue: `Rechnungsbetrag brutto: ${finalizeInvoice ? formatCurrency(finalizeInvoice.total_gross_amount, finalizeInvoice.currency_code) : '—'}`
                })}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => {
                setIsFinalizeDialogOpen(false);
                setFinalizeInvoice(null);
              }}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
            <button
              type="button"
              disabled={finalizeInvoiceMutation.isPending}
              onClick={() => {
                if (finalizeInvoice) {
                  finalizeInvoiceMutation.mutate({
                    id_uuid: finalizeInvoice.id_uuid,
                    payment_date: finalizeDate,
                    payment_method: finalizeMethod,
                    payment_amount: finalizeAmount
                  });
                }
              }}
              className="bg-emerald-600 text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-600/10 active:scale-95 flex items-center gap-2"
            >
              {finalizeInvoiceMutation.isPending && (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {t('common:finalize_and_book', { defaultValue: 'Abschließen & Buchen' })}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
