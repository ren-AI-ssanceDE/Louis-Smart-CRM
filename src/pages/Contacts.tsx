import React from 'react';
import { motion } from 'motion/react';
import { Contact as ContactIcon, Plus, Phone, Mail, Link as LinkIcon, Building2, X, Calendar, Info, ChevronDown, Smartphone, Globe, Search, ChevronLeft, ChevronRight, Trash2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { Contact, Company } from '../types';
import { trpc } from '../lib/trpc';
import { Dialog } from '../components/ui/Dialog';
import { MailDialog } from '../components/MailDialog';

import { ContactProfile } from '../components/ContactProfile';
import { FileBrowser } from '../components/FileBrowser';
import { ContactSchema } from '../lib/schemas';
import { z } from 'zod';

export const Contacts = () => {
  const { t, i18n } = useTranslation(['contacts', 'common', 'companies', 'dashboard']);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [selectedContact, setSelectedContact] = React.useState<Contact | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [mailTarget, setMailTarget] = React.useState<{ id_uuid?: string; email: string; name: string } | null>(null);
  const [emailValue, setEmailValue] = React.useState('');
  const [websiteValue, setWebsiteValue] = React.useState('');
  const [phoneValue, setPhoneValue] = React.useState('');
  const [mobileValue, setMobileValue] = React.useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = React.useState('');

  // Search & Pagination constraints
  const [searchQuery, setSearchQuery] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [page, setPage] = React.useState(1);

  const utils = trpc.useUtils();
  const { data: contacts = [], isLoading: loadingContacts } = trpc.getContacts.useQuery();
  const { data: companies = [], isLoading: loadingCompanies } = trpc.getCompanies.useQuery();
  const { data: myCompany } = trpc.getMyCompany.useQuery();

  const loading = loadingContacts || loadingCompanies;

  const displayColumns = React.useMemo(() => {
    if (myCompany?.contacts_display_columns_json) {
      try {
        return JSON.parse(myCompany.contacts_display_columns_json) as string[];
      } catch (_) {}
    }
    return ['responsible', 'comms', 'company', 'address'];
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
      case 'birthdate':
        return t('admin:columns_config.labels.birthdate');
      default:
        return 'Column';
    }
  };

  const renderCell = (colKey: string, contact: Contact) => {
    switch (colKey) {
      case 'responsible':
        return (
          <div 
            onClick={(e) => {
              if (contact.responsible_person) {
                e.stopPropagation();
                setSearchQuery(contact.responsible_person);
                setPage(1);
              }
            }}
            className={cn(
              "text-xs font-bold text-slate-300 transition-colors",
              contact.responsible_person ? "hover:text-accent-blue cursor-pointer underline decoration-white/10 decoration-dashed underline-offset-4" : "opacity-35"
            )}
          >
            {contact.responsible_person || t('common:na')}
          </div>
        );
      case 'comms':
        return (
          <div className="flex flex-col gap-1">
            {contact.email_address ? (
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  setMailTarget({ id_uuid: contact.id_uuid, email: contact.email_address!, name: contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name}`.trim() });
                }}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Mail size={11} className="text-accent-blue" /> 
                {contact.email_address}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 opacity-30">
                <Mail size={11} className="text-slate-700" /> {t('common:na')}
              </div>
            )}
            {contact.website && (
              <a 
                href={contact.website.toLowerCase().startsWith('http') ? contact.website : `https://${contact.website}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Globe size={11} className="text-accent-blue" /> 
                {contact.website.replace(/^https?:\/\//, '')}
              </a>
            )}
            {contact.phone_number && (
              <a 
                href={`tel:${contact.phone_number}`}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 text-[11px] font-mono text-slate-500 hover:text-accent-blue cursor-pointer transition-colors"
              >
                <Phone size={11} className="text-accent-blue" /> 
                {contact.phone_number}
              </a>
            )}
          </div>
        );
      case 'company':
        return (
          <div 
            onClick={async (e) => {
              if (contact.company_name) {
                e.stopPropagation();
                localStorage.setItem('search_query', contact.company_name);
                if (contact.associated_company_id) {
                  localStorage.setItem('open_company_id', contact.associated_company_id);
                } else {
                  try {
                    const companiesList = await utils.client.getCompanies.query();
                    const match = companiesList.find(c => c.full_legal_name?.toLowerCase() === contact.company_name?.toLowerCase());
                    if (match) {
                      localStorage.setItem('open_company_id', match.id_uuid);
                    }
                  } catch (_) {}
                }
                window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'companies' }));
              }
            }}
            className={cn(
              "text-xs font-bold text-slate-300 transition-colors",
              contact.company_name ? "hover:text-accent-orange cursor-pointer underline decoration-white/10 decoration-dashed underline-offset-4" : "opacity-35"
            )}
          >
            {contact.company_name || t('common:na')}
          </div>
        );
      case 'address':
        const addrParts = [
          contact.street ? `${contact.street} ${contact.house_number || ''}`.trim() : null,
          contact.postal_code || contact.city ? `${contact.postal_code || ''} ${contact.city || ''}`.trim() : null
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
      case 'birthdate':
        return (
          <span className="text-xs font-mono text-slate-400 font-bold">
            {contact.date_of_birth ? new Date(contact.date_of_birth).toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' }) : t('common:na')}
          </span>
        );
      default:
        return <span className="text-slate-500 text-xs">-</span>;
    }
  };

  React.useEffect(() => {
    const queryId = localStorage.getItem('open_contact_id');
    if (queryId && contacts.length > 0) {
      localStorage.removeItem('open_contact_id');
      const found = (contacts as Contact[]).find(c => c.id_uuid === queryId);
      if (found) {
        handleOpenProfile(found);
      }
    }
  }, [contacts]);

  React.useEffect(() => {
    const q = localStorage.getItem('search_query');
    if (q) {
      localStorage.removeItem('search_query');
      setSearchQuery(q);
      setPage(1);
    }
  }, []);

  React.useEffect(() => {
    setEmailValue(selectedContact?.email_address || '');
    setWebsiteValue(selectedContact?.website || '');
    setPhoneValue(selectedContact?.phone_number || '');
    setMobileValue(selectedContact?.mobile_number || '');
  }, [selectedContact]);

  React.useEffect(() => {
    if (selectedContact) {
      const updated = (contacts as Contact[]).find(c => c.id_uuid === selectedContact.id_uuid);
      if (updated && (
        JSON.stringify(updated.metadata) !== JSON.stringify(selectedContact.metadata) ||
        updated.custom_documents !== selectedContact.custom_documents ||
        updated.is_verified_by_human !== selectedContact.is_verified_by_human ||
        updated.associated_company_id !== selectedContact.associated_company_id ||
        updated.company_name !== selectedContact.company_name
      )) {
        setSelectedContact(updated);
      }
    }
  }, [contacts, selectedContact]);

  const filteredContacts = React.useMemo(() => {
    return (contacts as Contact[]).filter(contact => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        (contact.first_name || '').replace(/\u200B/g, '').toLowerCase().includes(q) ||
        contact.last_name.replace(/\u200B/g, '').toLowerCase().includes(q) ||
        (contact.company_name || '').replace(/\u0430/g, 'a').replace(/\u0455/g, 's').replace(/\u200B/g, '').toLowerCase().includes(q) ||
        (contact.city || '').toLowerCase().includes(q) ||
        (contact.email_address || '').toLowerCase().includes(q) ||
        (contact.phone_number || '').toLowerCase().includes(q)
      );
    });
  }, [contacts, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / limit));

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [filteredContacts.length, limit, totalPages, page]);

  const paginatedContacts = React.useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredContacts.slice(startIndex, startIndex + limit);
  }, [filteredContacts, page, limit]);

  const createContactMutation = trpc.createContact.useMutation({
    onSuccess: () => {
      setIsDialogOpen(false);
      utils.getContacts.invalidate();
    }
  });

  const updateContactMutation = trpc.updateContact.useMutation({
    onSuccess: (data, variables) => {
      if (selectedContact) {
        const vars = (variables as any) || {};
        const matchingCompany = companies.find(c => c.id_uuid === vars.associated_company_id);
        setSelectedContact(prev => prev ? { 
          ...prev, 
          ...vars, 
          company_name: matchingCompany ? matchingCompany.full_legal_name : undefined 
        } : null);
      }
      utils.getContacts.invalidate();
      toast.success(t('contacts:save_success', { defaultValue: "Kontakt erfolgreich aktualisiert!" }));
    },
    onError: (err) => {
      toast.error(t('contacts:save_error', { defaultValue: "Fehler beim Sichern des Kontakts: " }) + err.message);
    }
  });

  const deleteContactMutation = trpc.deleteContact.useMutation({
    onSuccess: () => {
      setIsDeleteConfirmOpen(false);
      setIsDialogOpen(false);
      setSelectedContact(null);
      utils.getContacts.invalidate();
    }
  });

  const verifyContactMutation = trpc.verifyContact.useMutation({
    onSuccess: () => {
      utils.getContacts.invalidate();
      if (selectedContact) {
        setSelectedContact(prev => prev ? { ...prev, is_verified_by_human: true } : null);
      }
      toast.success(t('contacts:verify_success', { defaultValue: "Kontaktentwurf erfolgreich bestätigt und verifiziert!" }));
    },
    onError: (err) => {
      toast.error(t('contacts:verify_error', { defaultValue: "Fehler beim Freigeben des Entwurfs: " }) + err.message);
    }
  });

  const exportContactToCSV = (cont: Contact) => {
    const headers = i18n.language === 'en' ? [
      "ID", "First Name", "Last Name", "Full Legal Name", "Responsible Person", "Salutation", "Gender",
      "Date of Birth", "Region", "Street", "House Number", "Postal Code", "City",
      "Email", "Email 2", "Website", "Phone", "Fax", "Mobile Phone",
      "Language", "IBAN", "BIC", "Equipment_Payment", "Price List", "Remarks",
      "Associated Company ID", "Created By", "AI Confidence"
    ] : [
      "ID", "Vorname", "Nachname", "Vollstaendiger Name", "Ansprechpartner", "Anrede", "Geschlecht",
      "Geburtsdatum", "Region", "Strasse", "Hausnummer", "PLZ", "Ort",
      "E-Mail", "E-Mail 2", "Webseite", "Telefon", "Fax", "Mobiltelefon",
      "Sprache", "IBAN", "BIC", "Ausrüstung_Zahlung", "Preisliste", "Bemerkungen",
      "Zugeordnete Firma ID", "Erstellt von", "AI Confidence"
    ];

    const values = [
      cont.id_uuid || "",
      cont.first_name || "",
      cont.last_name,
      cont.full_legal_name || "",
      cont.responsible_person || "",
      cont.salutation || "",
      cont.gender_identity || "",
      cont.date_of_birth || "",
      cont.region || "",
      cont.street || "",
      cont.house_number || "",
      cont.postal_code || "",
      cont.city || "",
      cont.email_address || "",
      cont.email_2 || "",
      cont.website || "",
      cont.phone_number || "",
      cont.fax_number || "",
      cont.mobile_number || "",
      cont.language || "",
      cont.iban || "",
      cont.bic_swift || "",
      cont.payment_term || "",
      cont.price_list || "",
      cont.custom_documents || "",
      cont.associated_company_id || "",
      cont.created_by_identity || "",
      cont.ai_confidence_score?.toString() || ""
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
    link.setAttribute("download", `backup_kontakt_${(cont.full_legal_name || cont.last_name || cont.first_name || 'unbekannt').toLowerCase().replace(/[^a-z0-9]+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenProfile = (contact: Contact) => {
    setSelectedContact(contact);
    setIsEditing(true);
    setIsDialogOpen(true);
  };

  const handleAddNew = () => {
    setSelectedContact(null);
    setIsEditing(true);
    setErrors({});
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrors({});
    const formData = new FormData(e.currentTarget);
    
    const labelsStr = formData.get('labels') as string;
    const labels = labelsStr ? labelsStr.split(',').map(l => l.trim()) : (selectedContact?.labels || []);

    const rawData = {
      first_name: (formData.get('first_name') as string) || null,
      last_name: formData.get('last_name') as string,
      responsible_person: (formData.get('responsible_person') as string) || null,
      salutation: (formData.get('salutation') as string) || null,
      gender_identity: (formData.get('gender') as string) || null,
      date_of_birth: (formData.get('dob') as string) || null,
      region: (formData.get('region') as string) || null,
      street: (formData.get('street') as string) || null,
      house_number: (formData.get('house_number') as string) || null,
      postal_code: (formData.get('zip') as string) || null,
      city: (formData.get('city') as string) || null,
      email_address: (formData.get('email') as string) || null,
      email_2: (formData.get('email_2') as string) || null,
      website: (formData.get('website') as string) || null,
      phone_number: (formData.get('phone') as string) || null,
      fax_number: (formData.get('fax') as string) || null,
      mobile_number: (formData.get('mobile') as string) || null,
      language: (formData.get('language') as string) || 'de',
      labels: labels,
      opt_in_marketing: formData.get('opt_in') === 'on',
      opt_in_social_media: formData.get('opt_in_social') === 'on',
      opt_in_direct_message: formData.get('opt_in_dm') === 'on',
      opt_in_sms: formData.get('opt_in_sms') === 'on',
      opt_in_phone: formData.get('opt_in_phone') === 'on',
      tax_vat_id: (formData.get('vat_id') as string) || null,
      iban: (formData.get('iban') as string) || null,
      bic_swift: (formData.get('bic_swift') as string) || null,
      payment_term: (formData.get('payment_term') as string) || null,
      price_list: (formData.get('price_list') as string) || null,
      custom_documents: (formData.get('custom_docs') as string) || null,
      associated_company_id: (formData.get('company_id') as string) || undefined,
      is_verified_by_human: true,
      created_by_identity: 'human' as const,
      ai_confidence_score: 1.0,
    };

    try {
      const validatedData = ContactSchema.parse(rawData);
      if (selectedContact) {
        updateContactMutation.mutate({ ...validatedData, id_uuid: selectedContact.id_uuid });
      } else {
        createContactMutation.mutate(validatedData);
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
            {t('establish')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="p-20 text-center">
          <div className="w-10 h-10 border-4 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">{t('mapping')}</p>
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
                {paginatedContacts.map((contact, idx) => (
                  <motion.tr
                    key={contact.id_uuid}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => handleOpenProfile(contact as Contact)}
                    className="hover:bg-primary-light transition-all cursor-pointer group"
                  >
                    <td className="px-8 py-6">
                      <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-xl bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center text-accent-blue font-bold text-lg group-hover:bg-accent-blue group-hover:text-white transition-all duration-500 shadow-inner">
                          {(contact.full_legal_name || contact.last_name || contact.first_name || "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <span className="font-bold text-neutral-white group-hover:text-white transition-colors">
                            {contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Unbekannter Kontakt'}
                          </span>
                          {contact.is_verified_by_human === false && (
                            <span className="inline-flex items-center gap-1 bg-amber-500/10 text-amber-400 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border border-amber-500/20 tracking-wider w-fit">
                              Entwurf
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    {displayColumns.map((colKey, colIdx) => (
                      <td key={`td-${contact.id_uuid}-${colKey}-${colIdx}`} className="px-8 py-6">
                        {renderCell(colKey, contact as Contact)}
                      </td>
                    ))}
                  </motion.tr>
                ))}
                {filteredContacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-8 py-20 text-center text-slate-500 font-bold uppercase tracking-widest text-xs opacity-50 italic">
                      {searchQuery ? t('no_search_results') : t('empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {filteredContacts.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-4 bg-primary-dark/40 border-t border-white/5">
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                {t('common:pagination_entries', { from: Math.min(filteredContacts.length, (page - 1) * limit + 1), to: Math.min(filteredContacts.length, page * limit), count: filteredContacts.length })}
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
          setSelectedContact(null);
          setErrors({});
        }}
        title={selectedContact ? t('edit_title') : t('establish')}
        size="full"
        noPadding
      >
        <div className="flex flex-col h-full bg-primary-dark max-h-[90vh]">
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-0 min-h-full">
                <div className="lg:col-span-2 p-12 space-y-12 overflow-y-auto">
                  {selectedContact && selectedContact.is_verified_by_human === false && (
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
                        disabled={updateContactMutation.isPending || createContactMutation.isPending}
                        className="w-full sm:w-auto shrink-0 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-600/50 text-neutral-black text-[10px] font-black uppercase tracking-widest px-5 py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 hover:shadow-[0_0_15px_rgba(245,158,11,0.4)] cursor-pointer"
                      >
                        {updateContactMutation.isPending ? t('dashboard:pending_approvals_banner.saving') : t('dashboard:pending_approvals_banner.approve_action')}
                      </button>
                    </motion.div>
                  )}
                  {/* Section 1: Contact Information */}
                  <div className="space-y-12">
                    <div className="flex items-center gap-3 pb-4 border-b-2 border-white/5">
                      <div className="w-2 h-2 rounded-full bg-accent-blue" />
                      <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('sections.info')}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8">
                      {/* Row 1 */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.first_name')}</label>
                          <input 
                            name="first_name" 
                            maxLength={100} 
                            defaultValue={selectedContact?.first_name || ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all placeholder:text-slate-700" 
                          />
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.last_name')} <span className="text-accent-blue">*</span></label>
                          <input 
                            name="last_name" 
                            required 
                            maxLength={100} 
                            defaultValue={selectedContact?.last_name} 
                            className={cn(
                              "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all placeholder:text-slate-700",
                              errors.last_name ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-blue/10 focus:border-accent-blue"
                            )}
                          />
                          {errors.last_name && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.last_name}</p>}
                        </div>
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
                              errors.email_address ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-blue/10 focus:border-accent-blue"
                            )}
                          />
                          <button
                            type="button"
                            disabled={!emailValue}
                            onClick={() => setMailTarget({ id_uuid: selectedContact?.id_uuid, email: emailValue, name: `${(document.getElementsByName('first_name')[0] as HTMLInputElement)?.value || ''} ${(document.getElementsByName('last_name')[0] as HTMLInputElement)?.value || ''}`.trim() })}
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
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.salutation')}</label>
                          <div className="relative">
                            <select 
                              name="salutation" 
                              defaultValue={selectedContact?.salutation || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                            >
                              <option value="">-</option>
                              <option value="herr">{t('fields.mr')}</option>
                              <option value="frau">{t('fields.mrs')}</option>
                              <option value="divers">{t('fields.other')}</option>
                            </select>
                            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={18} />
                          </div>
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.gender')}</label>
                          <div className="relative">
                            <select 
                              name="gender" 
                              defaultValue={selectedContact?.gender_identity || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                            >
                              <option value="">-</option>
                              <option value="m">{t('fields.male')}</option>
                              <option value="f">{t('fields.female')}</option>
                              <option value="d">{t('fields.diverse')}</option>
                            </select>
                            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={18} />
                          </div>
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
                              errors.website ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-blue/10 focus:border-accent-blue"
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
                            <Globe className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={18} />
                          )}
                        </div>
                        {errors.website && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.website}</p>}
                      </div>

                      {/* Row 3 */}
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-2 space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.street')}</label>
                          <input 
                            name="street" 
                            maxLength={200} 
                            defaultValue={selectedContact?.street || ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all placeholder:text-slate-700" 
                          />
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.house_number')}</label>
                          <input 
                            name="house_number" 
                            maxLength={20} 
                            defaultValue={selectedContact?.house_number || ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all text-center placeholder:text-slate-700" 
                          />
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
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono placeholder:text-slate-700" 
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
                            <Phone className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={16} />
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.zip')}</label>
                          <input 
                            name="zip" 
                            maxLength={10} 
                            defaultValue={selectedContact?.postal_code || ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono placeholder:text-slate-700" 
                          />
                        </div>
                        <div className="col-span-2 space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.city')}</label>
                          <input 
                            name="city" 
                            maxLength={100} 
                            defaultValue={selectedContact?.city || ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all placeholder:text-slate-700" 
                          />
                        </div>
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.mobile')}</label>
                        <div className="relative">
                          <input 
                            type="tel" 
                            name="mobile" 
                            maxLength={50} 
                            value={mobileValue}
                            onChange={(e) => setMobileValue(e.target.value)}
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono placeholder:text-slate-700" 
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
                            <Smartphone className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={16} />
                          )}
                        </div>
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.responsible')}</label>
                        <input 
                          name="responsible_person" 
                          maxLength={100} 
                          defaultValue={selectedContact?.responsible_person || ''} 
                          className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all placeholder:text-slate-700" 
                          placeholder={t('placeholders.responsible')}
                        />
                      </div>

                      <div className="space-y-2 flex flex-col gap-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.dob')}</label>
                        <div className="relative">
                          <input 
                            type="date"
                            name="dob" 
                            defaultValue={selectedContact?.date_of_birth ? selectedContact.date_of_birth.substring(0, 10) : ''} 
                            className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all text-left h-[58px]" 
                          />
                          <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                        </div>
                      </div>

                      <div className="col-span-full space-y-6 pt-10 border-t border-white/5">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in" 
                                defaultChecked={selectedContact?.opt_in_marketing} 
                                className="sr-only peer" 
                              />
                              <div className="w-12 h-6 bg-primary-light border border-white/5 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[24px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-slate-700 after:border-white/5 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent-orange peer-checked:after:bg-white"></div>
                            </div>
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.opt_in')}</span>
                          </label>

                          <label className="flex items-center gap-4 cursor-pointer group">
                            <div className="relative inline-flex items-center cursor-pointer">
                              <input 
                                type="checkbox" 
                                name="opt_in_phone" 
                                defaultChecked={selectedContact?.opt_in_phone} 
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
                                defaultChecked={selectedContact?.opt_in_sms} 
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
                                defaultChecked={selectedContact?.opt_in_direct_message} 
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
                                defaultChecked={selectedContact?.opt_in_social_media} 
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
                      <div className="w-2 h-2 rounded-full bg-accent-orange shadow-[0_0_8px_rgba(255,103,22,0.6)]" />
                      <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('sections.financial')}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.iban')}</label>
                          <input 
                            name="iban" 
                            maxLength={34} 
                            defaultValue={selectedContact?.iban || ''} 
                            className={cn(
                              "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                              errors.iban ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-blue/10 focus:border-accent-blue"
                            )}
                            placeholder="DE00 0000 0000 ..." 
                          />
                          {errors.iban && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.iban}</p>}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.bic_swift')}</label>
                            <input 
                              name="bic_swift" 
                              maxLength={11} 
                              defaultValue={selectedContact?.bic_swift || ''} 
                              className={cn(
                                "w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all font-mono placeholder:text-slate-700",
                                errors.bic_swift ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500" : "focus:ring-accent-blue/10 focus:border-accent-blue"
                              )}
                            />
                            {errors.bic_swift && <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide">{errors.bic_swift}</p>}
                          </div>
                          <div className="space-y-2 flex flex-col gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.vat_id')}</label>
                            <input 
                              name="vat_id" 
                              maxLength={20} 
                              defaultValue={selectedContact?.tax_vat_id || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono placeholder:text-slate-700" 
                            />
                          </div>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.payment_term')}</label>
                          <div className="relative">
                            <select 
                              name="payment_term" 
                              defaultValue={selectedContact?.payment_term || '14'} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                            >
                              <option value="14">{t('companies:payment_terms.net_14')}</option>
                              <option value="30">{t('companies:payment_terms.net_30')}</option>
                              <option value="60">{t('companies:payment_terms.net_60')}</option>
                              <option value="immed">{t('companies:payment_terms.immediate')}</option>
                            </select>
                            <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={18} />
                          </div>
                        </div>
                        <div className="space-y-2 flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.entity_link')}</label>
                          <div className="relative">
                            <select 
                              name="company_id" 
                              defaultValue={selectedContact?.associated_company_id || ''} 
                              className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                            >
                              <option value="">{t('common:none')}</option>
                              {companies.map(co => (
                                <option key={co.id_uuid} value={co.id_uuid}>{co.full_legal_name}</option>
                              ))}
                            </select>
                            <Building2 className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-none" size={18} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Sidebar: Side Actions & Notes */}
                <div className="bg-primary-light p-12 space-y-12 border-l border-white/5">
                   <div className="space-y-8">
                      <div className="flex items-center gap-3 pb-4 border-b border-white/10">
                        <div className="w-2 h-2 rounded-full bg-accent-orange" />
                        <h4 className="text-sm font-black text-white uppercase tracking-[0.3em] font-display">{t('sections.custom')}</h4>
                      </div>

                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('fields.custom_docs')}</label>
                        <textarea 
                          name="custom_docs" 
                          rows={10}
                          defaultValue={selectedContact?.custom_documents || ''}
                          className="w-full bg-primary-dark border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all resize-none shadow-inner placeholder:text-slate-700"
                          placeholder={t('companies:placeholders.notes')}
                        />
                      </div>

                      {selectedContact && (
                        <div className="space-y-4 pt-4 border-t border-white/5">
                          <div className="bg-primary-dark border-2 border-white/5 p-6 rounded-xl">
                            <FileBrowser 
                              type="contacts" 
                              id={selectedContact.id_uuid} 
                              name={selectedContact.full_legal_name || `${selectedContact.first_name || ''} ${selectedContact.last_name || ''}`.trim() || 'Unbekannter Kontakt'} 
                            />
                          </div>
                        </div>
                      )}

                      {selectedContact && (
                        <div className="space-y-4 pt-6 border-t border-red-500/10 bg-red-500/5 p-6 rounded-xl border border-red-500/10">
                          <h5 className="text-[10px] font-black text-red-500 uppercase tracking-widest flex items-center gap-2 font-display">
                            <Trash2 size={12} />
                            {t('contacts:danger_zone.title', { defaultValue: 'Gefahrenbereich (Löschen)' })}
                          </h5>
                          <p className="text-slate-400 text-[10px] leading-relaxed font-semibold">
                            {t('contacts:danger_zone.desc', { defaultValue: 'Diesen Kontakt endgültig und unwiderruflich aus unserem System und allen verknüpften Registern löschen.' })}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteConfirmationInput('');
                              setIsDeleteConfirmOpen(true);
                            }}
                            className="w-full bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-500/25 py-3 rounded-xl font-bold uppercase text-[10px] tracking-wider transition-all duration-200 cursor-pointer text-center"
                          >
                            {t('contacts:danger_zone.btn', { defaultValue: 'Kontakt endgültig löschen' })}
                          </button>
                        </div>
                      )}


                   </div>

                   <div className="space-y-4 pt-12 mt-12 border-t border-white/10">
                      <button 
                        type="submit"
                        disabled={createContactMutation.isPending || updateContactMutation.isPending}
                        className="w-full bg-accent-orange text-white py-5 rounded-xl font-black uppercase text-[11px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-2xl shadow-accent-orange/30 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3"
                      >
                        {(createContactMutation.isPending || updateContactMutation.isPending) && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        {(createContactMutation.isPending || updateContactMutation.isPending) ? t('common:loading') : t('common:save')}
                      </button>
                      <button 
                        type="button"
                        onClick={() => {
                          setIsDialogOpen(false);
                          setSelectedContact(null);
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
        title={t('contacts:delete_modal.title', { defaultValue: '⚠️ Kontakt endgültig löschen?' })}
        size="md"
      >
        <div className="space-y-6 text-slate-305">
          <p className="text-sm text-slate-305 text-slate-300 font-semibold">
            {t('contacts:delete_modal.confirm_desc1', { defaultValue: 'Sie sind im Begriff, den Kontakt von ' })}<strong className="text-white font-black">{selectedContact?.first_name || ''} {selectedContact?.last_name}</strong>{t('contacts:delete_modal.confirm_desc2', { defaultValue: ' dauerhaft und unwiderruflich zu löschen.' })}
          </p>

          <div className="bg-primary-dark/80 border-2 border-red-500/10 p-5 rounded-xl space-y-3">
            <span className="text-[10px] font-black text-accent-orange uppercase tracking-widest block">{t('contacts:delete_modal.backup_title', { defaultValue: 'Sicherheitskopie empfohlen:' })}</span>
            <p className="text-xs text-slate-400 font-semibold leading-relaxed font-body">
              {t('contacts:delete_modal.backup_desc', { defaultValue: 'Bitte sichern Sie die Daten dieses Kontakts als .csv-Datei, bevor Sie diesen endgültig löschen.' })}
            </p>
            <button
               type="button"
              onClick={() => selectedContact && exportContactToCSV(selectedContact)}
              className="flex items-center gap-2 bg-primary-light hover:bg-white/5 text-white px-4 py-3 rounded-xl text-xs font-black border border-white/5 transition-all w-full justify-center cursor-pointer active:scale-95"
            >
              <Download size={14} className="text-accent-blue font-bold animate-bounce" />
              {t('contacts:delete_modal.export_btn', { defaultValue: 'Kontaktdaten als .csv exportieren' })}
            </button>
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.1em] block">
              {t('contacts:delete_modal.confirm_type_label_1', { defaultValue: 'Bitte geben Sie zur Bestätigung ' })}<span className="text-red-500 font-black">{t('contacts:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' })}</span>{t('contacts:delete_modal.confirm_type_label_2', { defaultValue: ' ein:' })}
            </label>
            <input
              type="text"
              value={deleteConfirmationInput}
              onChange={(e) => setDeleteConfirmationInput(e.target.value)}
              placeholder={t('contacts:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' })}
              className="w-full bg-primary-dark border-2 border-white/5 rounded-xl px-4 py-3 text-white text-sm font-bold text-center focus:outline-none focus:border-red-550 focus:ring-4 focus:ring-red-600/5 transition-all animate-pulse"
            />
          </div>

          <div className="flex gap-4 pt-4 border-t border-white/5">
            <button
              type="button"
              disabled={deleteConfirmationInput !== t('contacts:delete_modal.confirm_word', { defaultValue: 'LÖSCHEN' }) || deleteContactMutation.isPending}
              onClick={() => {
                if (selectedContact?.id_uuid) {
                  deleteContactMutation.mutate({ id_uuid: selectedContact.id_uuid });
                }
              }}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-20 disabled:hover:bg-red-600 text-white py-3.5 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:cursor-not-allowed"
            >
              {deleteContactMutation.isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t('contacts:delete_modal.delete_btn', { defaultValue: 'Dauerhaft löschen' })}
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
          associatedType="contacts"
          associatedId={mailTarget.id_uuid}
          associatedName={mailTarget.name}
        />
      )}
    </div>
  );
};
