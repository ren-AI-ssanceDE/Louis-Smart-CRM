import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Plus, Download, Trash2, Eye, FileSpreadsheet, FileText, ChevronDown, Edit2, 
  Search, RefreshCw, X, FileCheck, CheckCircle2, AlertCircle, HelpCircle, FilePlus, Lock,
  Mail, MoreVertical, Calendar, Tag, ChevronLeft, ChevronRight, ArrowUpRight, Building2,
  Bold, Italic, Underline, List, Columns, Sparkles
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Offer, OfferLineItem, OfferTextTemplate, Company, Contact } from "../types";
import { trpc } from "../lib/trpc";
import { cn } from "../lib/utils";
import { formatCurrency } from "../lib/math";
import { Dialog } from "../components/ui/Dialog";
import { ContactFormDialog } from "../components/ContactFormDialog";
import { CompanyFormDialog } from "../components/CompanyFormDialog";
import { MailDialog } from "../components/MailDialog";
import { BatchExportOffersDialog } from "../components/BatchExportOffersDialog";
import { AiTextGeneratorDialog } from "../components/AiTextGeneratorDialog";

export const Offers = () => {
  const { t, i18n } = useTranslation(["offers", "common", "invoices"]);
  const utils = trpc.useContext();

  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | "draft" | "not_sent" | "sent" | "accepted" | "declined">("all");
  const [limit, setLimit] = React.useState(10);
  const [page, setPage] = React.useState(1);

  // Preview State
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [selectedOffer, setSelectedOffer] = React.useState<Offer | null>(null);

  const selectedOfferVatGroups = React.useMemo(() => {
    if (!selectedOffer) return [];
    try {
      const items = selectedOffer.line_items || [];
      const groups: Record<number, { vatRate: number; netAmount: number; vatAmount: number }> = {};
      items.forEach((item: OfferLineItem) => {
        const isTextPos = !!item.is_text_position;
        if (isTextPos) return;
        const rate = typeof item.vat_rate === 'number' ? item.vat_rate : 19;
        const net = typeof item.total_net === 'number' ? item.total_net : (item.quantity * item.unit_price);
        const vat = net * (rate / 100);
        
        if (!groups[rate]) {
          groups[rate] = { vatRate: rate, netAmount: 0, vatAmount: 0 };
        }
        groups[rate].netAmount += net;
        groups[rate].vatAmount += vat;
      });
      return Object.values(groups).map(g => ({
        ...g,
        netAmount: Math.round((g.netAmount + Number.EPSILON) * 100) / 100,
        vatAmount: Math.round((g.vatAmount + Number.EPSILON) * 100) / 100,
      })).sort((a, b) => b.vatRate - a.vatRate);
    } catch (_) {
      return [];
    }
  }, [selectedOffer]);

  // Submenu state
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const menuContainerRef = React.useRef<HTMLDivElement>(null);

  // Click outside handler for offer actions submenu
  React.useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (activeMenuId && menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activeMenuId]);

  // Offer Editor Dialog State
  const [isOfferDialogOpen, setIsOfferDialogOpen] = React.useState(false);
  const [editingOffer, setEditingOffer] = React.useState<Offer | null>(null);

  // Delete Confirm Dialog State
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [offerToDelete, setOfferToDelete] = React.useState<Offer | null>(null);

  // Batch Export State
  const [isBatchExportOpen, setIsBatchExportOpen] = React.useState(false);

  // Mail Dialog State
  const [mailTarget, setMailTarget] = React.useState<{ id_uuid?: string; email: string; name: string; offer: Offer } | null>(null);

  const isReadOnly = React.useMemo(() => {
    return editingOffer?.offer_status === "accepted" || editingOffer?.offer_status === "declined";
  }, [editingOffer]);

  // KI-Generator States
  const [aiFieldId, setAiFieldId] = React.useState<string | null>(null);
  const [aiValue, setAiValue] = React.useState<string>('');
  const [aiContext, setAiContext] = React.useState<string>('');

  // Form State for Offer
  const [offerTitle, setOfferTitle] = React.useState("");
  const [selectedCompanyId, setSelectedCompanyId] = React.useState("");
  const [selectedContactId, setSelectedContactId] = React.useState("");
  const [issueDate, setIssueDate] = React.useState(() => new Date().toISOString().split("T")[0]);
  const [validUntil, setValidUntil] = React.useState("");
  const [paymentTerm, setPaymentTerm] = React.useState("14");
  const [currencyCode, setCurrencyCode] = React.useState("EUR");
  const [isVatInclusive, setIsVatInclusive] = React.useState(false);
  const [introText, setIntroText] = React.useState("");
  const [closingText, setClosingText] = React.useState("");
  const [offerStatus, setOfferStatus] = React.useState<"draft" | "not_sent" | "sent" | "accepted" | "declined">("not_sent");
  const [offerLineItems, setOfferLineItems] = React.useState<OfferLineItem[]>([
    { position: 1, description: "", quantity: 1, unit_code: "PCE", unit_price: 0, vat_rate: 19, total_net: 0, total_gross: 0 }
  ]);
  const [isSubmitAttempted, setIsSubmitAttempted] = React.useState(false);

  // Textarea Refs for Placeholders
  const introTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const closingTextareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Rich Description Designer State Hooks
  const [activeItemDescEditIdx, setActiveItemDescEditIdx] = React.useState<number | null>(null);
  
  const [initialSingleHtml, setInitialSingleHtml] = React.useState('');

  const singleEditorRef = React.useRef<HTMLDivElement>(null);

  const introEditorRef = React.useRef<HTMLDivElement>(null);
  const closingEditorRef = React.useRef<HTMLDivElement>(null);

  const updateIntroText = (newVal: string) => {
    setIntroText(newVal);
    if (introEditorRef.current && introEditorRef.current.innerHTML !== newVal) {
      introEditorRef.current.innerHTML = newVal;
    }
  };

  const updateClosingText = (newVal: string) => {
    setClosingText(newVal);
    if (closingEditorRef.current && closingEditorRef.current.innerHTML !== newVal) {
      closingEditorRef.current.innerHTML = newVal;
    }
  };

  const insertContentEditablePlaceholder = (
    ref: React.RefObject<HTMLDivElement | null>,
    tag: string,
    setter: (newVal: string) => void
  ) => {
    const editor = ref.current;
    if (!editor) return;
    
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        const textNode = document.createTextNode(tag);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
        setter(editor.innerHTML);
        return;
      }
    }
    const currentHtml = editor.innerHTML || "";
    const newVal = currentHtml + tag;
    editor.innerHTML = newVal;
    setter(newVal);
  };

  const insertTextareaPlaceholder = (
    ref: React.RefObject<HTMLTextAreaElement | null>,
    tag: string,
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const textarea = ref.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      const before = text.substring(0, start);
      const after  = text.substring(end, text.length);
      const newValue = before + tag + after;
      setter(newValue);
      
      // Reset cursor position after state updates
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + tag.length, start + tag.length);
      }, 0);
    } else {
      setter(prev => prev + tag);
    }
  };

  const offerVariables = [
    { tag: '{{offer_number}}', label: t('offers:dialog.var_offer_number', { defaultValue: 'Angebotsnummer' }) },
    { tag: '{{valid_until}}', label: t('offers:dialog.var_valid_until', { defaultValue: 'Gültig bis' }) },
    { tag: '{{my_contact_person}}', label: t('offers:dialog.var_my_contact_person', { defaultValue: 'Eigener Ansprechpartner' }) },
    { tag: '{{total_gross}}', label: t('offers:dialog.var_total_gross', { defaultValue: 'Bruttobetrag' }) },
    { tag: '{{recipient_name}}', label: t('offers:dialog.var_recipient_name', { defaultValue: 'Kundenname' }) },
    { tag: '{{my_company_name}}', label: t('offers:dialog.var_my_company', { defaultValue: 'Eigene Firma' }) },
    { tag: '{{currency}}', label: t('offers:dialog.var_currency', { defaultValue: 'Währung' }) },
  ];

  const replaceOfferPlaceholders = (text: string) => {
    if (!text) return '';
    let replaced = text;

    let rName = '';
    let rFirstName = '';
    let rLastName = '';
    let rSalutation = '';
    let rStreet = '';
    let rHouseNumber = '';
    let rPostalCode = '';
    let rCity = '';
    let rCountry = '';
    let rEmail = '';
    let rPhone = '';
    let rCompany = '';
    let rAddress = '';

    const activeLocale = i18n.language || 'de';

    // 1. Resolve Issuer (My Company) info
    const myCompanyName = myCompany?.full_legal_name || '';
    const myContactPerson = myCompany?.responsible_person || '';

    // 2. Resolve Recipient (Customer) info
    if (selectedContactId) {
      const ct = contacts.find(c => c.id_uuid === selectedContactId);
      if (ct) {
        rName = ct.full_legal_name || `${ct.first_name || ''} ${ct.last_name || ''}`.trim();
        rFirstName = ct.first_name || '';
        rLastName = ct.last_name || '';
        rStreet = ct.street || '';
        rHouseNumber = ct.house_number || '';
        rPostalCode = ct.postal_code || '';
        rCity = ct.city || '';
        rEmail = ct.email_address || '';
        rPhone = ct.phone_number || ct.mobile_number || '';
        
        if (ct.company_name) {
          rCompany = ct.company_name;
        } else if (ct.associated_company_id) {
          const assocCo = companies.find((co: { id_uuid?: string; full_legal_name?: string | null }) => co.id_uuid === ct.associated_company_id);
          if (assocCo) {
            rCompany = assocCo.full_legal_name || '';
          }
        }
        
        const rawSalutation = ct.salutation || '';
        if (rawSalutation.toLowerCase().includes('herr') || rawSalutation.toLowerCase() === 'mr') {
          rSalutation = `Sehr geehrter Herr ${rLastName}`;
        } else if (rawSalutation.toLowerCase().includes('frau') || rawSalutation.toLowerCase() === 'ms' || rawSalutation.toLowerCase() === 'mrs') {
          rSalutation = `Sehr geehrte Frau ${rLastName}`;
        } else {
          rSalutation = rFirstName ? `Hallo ${rFirstName}` : `Sehr geehrte Damen und Herren`;
        }

        const streetFull = `${rStreet} ${rHouseNumber}`.trim();
        const cityFull = `${rPostalCode} ${rCity}`.trim();
        rAddress = [rName, rCompany, streetFull, cityFull].filter(Boolean).join('\n');
      }
    } else if (selectedCompanyId) {
      const co = companies.find(c => c.id_uuid === selectedCompanyId);
      if (co) {
        rName = co.full_legal_name || '';
        rStreet = co.street || '';
        rHouseNumber = co.house_number || '';
        rPostalCode = co.postal_code || '';
        rCity = co.city || '';
        rCountry = co.country_code || '';
        rEmail = co.email_address || '';
        rPhone = co.phone_number || co.mobile_number || '';
        rCompany = co.full_legal_name || '';
        
        const streetFull = `${rStreet} ${rHouseNumber}`.trim();
        const cityFull = `${rPostalCode} ${rCity}`.trim();
        rAddress = [rCompany, streetFull, cityFull, rCountry].filter(Boolean).join('\n');
        rSalutation = `Sehr geehrte Damen und Herren`;
      }
    }

    if (!rSalutation) {
      rSalutation = `Sehr geehrte Damen und Herren`;
    }

    // 3. Resolve Offer totals and dates
    const grossVal = typeof formTotals.gross === 'number'
      ? formTotals.gross.toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : (0).toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let validUntilStr = '';
    if (validUntil) {
      validUntilStr = new Date(validUntil).toLocaleDateString(activeLocale);
    }

    // Resolve active offer number securely, predicting next sequence if in creation mode
    let nextOfferNumber = '';
    if (editingOffer) {
      nextOfferNumber = editingOffer.offer_number;
    } else if (myCompany) {
      const prefix = myCompany.offer_number_prefix ?? "AN-";
      const yearFixed = myCompany.offer_number_year_fixed ?? true;
      const nextSeq = myCompany.offer_number_next_seq ?? 1;
      const minDigits = myCompany.offer_number_min_digits ?? 4;
      const issueDateYear = issueDate ? new Date(issueDate).getFullYear() : new Date().getFullYear();
      const paddedSeq = String(nextSeq).padStart(minDigits, "0");

      if (yearFixed) {
        if (prefix.includes("YYYY")) {
          nextOfferNumber = prefix.replace("YYYY", String(issueDateYear)) + paddedSeq;
        } else if (prefix.includes("{year}")) {
          nextOfferNumber = prefix.replace("{year}", String(issueDateYear)) + paddedSeq;
        } else {
          nextOfferNumber = `${prefix}${issueDateYear}-${paddedSeq}`;
        }
      } else {
        nextOfferNumber = `${prefix}${paddedSeq}`;
      }
    }

    replaced = replaced
      .replace(/\{\{my_company_name\}\}/g, myCompanyName)
      .replace(/\{\{my_contact_person\}\}/g, myContactPerson)
      .replace(/\{\{recipient_name\}\}/g, rName)
      .replace(/\{\{recipient_first_name\}\}/g, rFirstName)
      .replace(/\{\{recipient_last_name\}\}/g, rLastName)
      .replace(/\{\{recipient_salutation\}\}/g, rSalutation)
      .replace(/\{\{recipient_anrede\}\}/g, rSalutation)
      .replace(/\{\{recipient_company\}\}/g, rCompany)
      .replace(/\{\{recipient_street\}\}/g, `${rStreet} ${rHouseNumber}`.trim())
      .replace(/\{\{recipient_city\}\}/g, rCity)
      .replace(/\{\{recipient_postal_code\}\}/g, rPostalCode)
      .replace(/\{\{recipient_plz\}\}/g, rPostalCode)
      .replace(/\{\{recipient_address\}\}/g, rAddress)
      .replace(/\{\{recipient_adresse\}\}/g, rAddress)
      .replace(/\{\{recipient_email\}\}/g, rEmail)
      .replace(/\{\{recipient_phone\}\}/g, rPhone)
      .replace(/\{\{offer_number\}\}/g, nextOfferNumber)
      .replace(/\{\{valid_until\}\}/g, validUntilStr)
      .replace(/\{\{total_gross\}\}/g, grossVal)
      .replace(/\{\{currency\}\}/g, currencyCode || 'EUR');

    return replaced;
  };

  const previewDescription = (desc: string) => {
    if (!desc) return '';
    const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
    const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
    if (leftMatch || rightMatch) {
      const leftText = (leftMatch ? leftMatch[1] : "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
      const rightText = (rightMatch ? rightMatch[1] : "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
      return `${leftText || '—'} | ${rightText || '—'}`;
    }
    const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
    const raw = singleMatch ? singleMatch[1] : desc;
    return raw.replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
  };

  const handleOpenDescEditor = (idx: number) => {
    const desc = offerLineItems[idx]?.description || '';
    const isDouble = desc.includes('<!-- MULTI_COL_START -->') || desc.includes('COL_LEFT_START');
    
    if (isDouble) {
      const left = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/)?.[1] || '';
      const right = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/)?.[1] || '';
      const merged = left + (left && right ? '<br/>' : '') + right;
      setInitialSingleHtml(merged);
    } else {
      const single = desc.includes('<!-- SINGLE_COL_START -->')
        ? (desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/)?.[1] || '')
        : desc;
      setInitialSingleHtml(single);
    }
    setActiveItemDescEditIdx(idx);
  };

  const handleSaveDescEditor = () => {
    if (activeItemDescEditIdx === null) return;
    const singleHtml = singleEditorRef.current?.innerHTML || '';
    const compiledDesc = `<!-- SINGLE_COL_START -->\n${singleHtml}\n<!-- SINGLE_COL_END -->`;
    handleUpdateLineItem(activeItemDescEditIdx, { description: compiledDesc });
    setActiveItemDescEditIdx(null);
  };

  const handleExecCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
  };

  const renderDescriptionInPreview = (desc: string) => {
    if (!desc) return null;
    
    const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
    const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
    
    if (leftMatch || rightMatch) {
      let leftHtml = leftMatch ? leftMatch[1] : '';
      let rightHtml = rightMatch ? rightMatch[1] : '';
      if (leftHtml) {
        leftHtml = leftHtml.replace(/^[\s\r\n\u200b\u00a0]+|[\s\r\n\u200b\u00a0]+$/g, "");
      }
      if (rightHtml) {
        rightHtml = rightHtml.replace(/^[\s\r\n\u200b\u00a0]+|[\s\r\n\u200b\u00a0]+$/g, "");
      }
      return (
        <div className="text-slate-500 font-normal mt-0.5 text-[8.5pt] text-left whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: leftHtml + (leftHtml && rightHtml ? '<br/>' : '') + rightHtml }} />
      );
    }
    
    const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
    let htmlToRender = singleMatch ? singleMatch[1] : desc;
    if (htmlToRender) {
      htmlToRender = htmlToRender.replace(/^[\s\r\n\u200b\u00a0]+|[\s\r\n\u200b\u00a0]+$/g, "");
    }
    return <div className="text-slate-500 font-normal mt-0.5 text-[8.5pt] text-left whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: htmlToRender }} />;
  };

  // Queries
  const { data: offers = [], isLoading: isOffersLoading, refetch: refetchOffers } = trpc.getOffers.useQuery();
  const { data: templates = [], isLoading: isTemplatesLoading } = trpc.getTemplates.useQuery();
  const { data: itemTemplatesRaw = [] } = trpc.getInvoiceItemTemplates.useQuery();
  const offerItemTemplates = React.useMemo(() => 
    itemTemplatesRaw.filter(t => !t.usage_scope || t.usage_scope === 'offer' || t.usage_scope === 'both'),
    [itemTemplatesRaw]
  );
  const { data: companies = [] } = trpc.getCompanies.useQuery();
  const { data: contacts = [] } = trpc.getContacts.useQuery();
  const { data: myCompany } = trpc.getMyCompany.useQuery();

  // Mutations
  const createOfferMutation = trpc.createOffer.useMutation({
    onSuccess: () => {
      toast.success(t("offers:toast_create_success"));
      refetchOffers();
      setIsOfferDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err.message || t("common:error"));
    }
  });

  const updateOfferMutation = trpc.updateOffer.useMutation({
    onSuccess: () => {
      toast.success(t("offers:toast_update_success"));
      refetchOffers();
      setIsOfferDialogOpen(false);
    },
    onError: (err) => {
      toast.error(err.message || t("common:error"));
    }
  });

  const deleteOfferMutation = trpc.deleteOffer.useMutation({
    onSuccess: () => {
      toast.success(t("offers:toast_delete_success"));
      refetchOffers();
      setIsDeleteConfirmOpen(false);
      setOfferToDelete(null);
    },
    onError: (err) => {
      toast.error(err.message || t("common:error"));
    }
  });

  // Dropdown search states
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false);
  const [companySearchQuery, setCompanySearchQuery] = React.useState("");

  const [isContactDropdownOpen, setIsContactDropdownOpen] = React.useState(false);
  const [contactSearchQuery, setContactSearchQuery] = React.useState("");

  // Template dropdown search states
  const [isIntroTemplateDropdownOpen, setIsIntroTemplateDropdownOpen] = React.useState(false);
  const [introTemplateSearchQuery, setIntroTemplateSearchQuery] = React.useState("");
  const [isClosingTemplateDropdownOpen, setIsClosingTemplateDropdownOpen] = React.useState(false);
  const [closingTemplateSearchQuery, setClosingTemplateSearchQuery] = React.useState("");

  // Position templates dropdown search states
  const [isItemTemplateDropdownOpen, setIsItemTemplateDropdownOpen] = React.useState(false);
  const [itemTemplateSearchQuery, setItemTemplateSearchQuery] = React.useState("");

  // Dialog state for new contact and new company creation from within Offers dialog
  const [isNewContactDialogOpen, setIsNewContactDialogOpen] = React.useState(false);
  const [isNewCompanyDialogOpen, setIsNewCompanyDialogOpen] = React.useState(false);

  // Search-enabled selects
  const filteredCompaniesForSelect = React.useMemo(() => {
    return companies.filter((c: typeof companies[number]) => 
      (c.full_legal_name || "").toLowerCase().includes(companySearchQuery.toLowerCase())
    );
  }, [companies, companySearchQuery]);

  const filteredContactsForSelect = React.useMemo(() => {
    return contacts.filter((c: typeof contacts[number]) => {
      const fullName = `${c.first_name || ""} ${c.last_name || ""}`.trim().toLowerCase();
      return fullName.includes(contactSearchQuery.toLowerCase());
    });
  }, [contacts, contactSearchQuery]);

  const introductoryTemplates = React.useMemo(() => {
    return templates.filter(t => t.template_type_code === 'introductory');
  }, [templates]);

  const closingTemplates = React.useMemo(() => {
    return templates.filter(t => t.template_type_code === 'closing');
  }, [templates]);

  const filteredIntroTemplatesForSelect = React.useMemo(() => {
    return introductoryTemplates.filter(t => 
      (t.template_name_text || "").toLowerCase().includes(introTemplateSearchQuery.toLowerCase())
    );
  }, [introductoryTemplates, introTemplateSearchQuery]);

  const filteredClosingTemplatesForSelect = React.useMemo(() => {
    return closingTemplates.filter(t => 
      (t.template_name_text || "").toLowerCase().includes(closingTemplateSearchQuery.toLowerCase())
    );
  }, [closingTemplates, closingTemplateSearchQuery]);

  const filteredOfferItemTemplatesForSelect = React.useMemo(() => {
    return offerItemTemplates.filter(t => 
      (t.template_name_text || "").toLowerCase().includes(itemTemplateSearchQuery.toLowerCase())
    );
  }, [offerItemTemplates, itemTemplateSearchQuery]);

  const selectedCompany = companies.find((c: typeof companies[number]) => c.id_uuid === selectedCompanyId);
  const companyButtonLabel = selectedCompany ? (selectedCompany.full_legal_name || "") : t("offers:select_company");

  const selectedContact = contacts.find((c: typeof contacts[number]) => c.id_uuid === selectedContactId);
  const contactButtonLabel = selectedContact ? `${selectedContact.first_name || ""} ${selectedContact.last_name || ""}`.trim() : t("offers:select_contact");

  const generatePdfMutation = trpc.generateOfferPdf.useMutation({
    onSuccess: (data) => {
      toast.success(t("offers:toast_pdf_success"));
      refetchOffers();
      // Auto trigger download
      window.open(`/api/files/download?path=${encodeURIComponent(data.filePath)}`, "_blank");
    },
    onError: (err) => {
      toast.error(err.message || t("common:error"));
    }
  });

  const createInvoiceMutation = trpc.createInvoice.useMutation({
    onSuccess: (data) => {
      toast.success(t("offers:convert_to_invoice_success", { invoice_number: data.id_uuid.substring(0, 8).toUpperCase() }));
      // Invalidate invoices context so lists update
      utils.getInvoices.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t("common:error"));
    }
  });

  // Calculate paymentTerm based on validUntil and issueDate
  React.useEffect(() => {
    if (issueDate && validUntil) {
      const start = new Date(issueDate);
      const end = new Date(validUntil);
      const diffTime = end.getTime() - start.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (!isNaN(diffDays)) {
        setPaymentTerm(Math.max(0, diffDays).toString());
      }
    }
  }, [issueDate, validUntil]);

  React.useEffect(() => {
    if (offers.length > 0) {
      const openOfferId = localStorage.getItem("open_offer_id");
      if (openOfferId) {
        const found = offers.find(o => o.id_uuid === openOfferId);
        if (found) {
          localStorage.removeItem("open_offer_id");
          handleOpenEditOffer(found as Offer);
        }
      }
    }
  }, [offers]);

  React.useEffect(() => {
    const createForCompanyId = localStorage.getItem("open_create_offer_for_company_id");
    if (createForCompanyId) {
      localStorage.removeItem("open_create_offer_for_company_id");
      handleOpenCreateOffer();
      setSelectedCompanyId(createForCompanyId);
    }
  }, [offers]);

  // Action Handlers
  const handleOpenCreateOffer = () => {
    setEditingOffer(null);
    setOfferTitle("");
    setSelectedCompanyId("");
    setSelectedContactId("");
    const today = new Date().toISOString().split("T")[0];
    setIssueDate(today);
    setIsSubmitAttempted(false);
    
    // Default valid until to 30 days from today
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const thirtyDaysLater = d.toISOString().split("T")[0];
    setValidUntil(thirtyDaysLater);
    
    setPaymentTerm("30");
    setCurrencyCode("EUR");
    setIsVatInclusive(false);
    updateIntroText("");
    updateClosingText("");
    setOfferStatus("not_sent");
    setOfferLineItems([
      { position: 1, description: "", quantity: 1, unit_code: "PCE", unit_price: 0, vat_rate: 19, total_net: 0, total_gross: 0, is_text_position: false }
    ]);
    setIsOfferDialogOpen(true);
  };

  const handleOpenEditOffer = (offer: Offer) => {
    setEditingOffer(offer);
    setOfferTitle(offer.title);
    setSelectedCompanyId(offer.associated_company_id || "");
    setSelectedContactId(offer.associated_contact_id || "");
    setIssueDate(new Date(offer.issue_date).toISOString().split("T")[0]);
    setValidUntil(new Date(offer.valid_until).toISOString().split("T")[0]);
    setPaymentTerm(offer.payment_term || "14");
    setCurrencyCode(offer.currency_code);
    setIsVatInclusive(offer.is_vat_inclusive);
    updateIntroText(offer.introductory_text || "");
    updateClosingText(offer.closing_text || "");
    setOfferStatus(offer.offer_status);
    setOfferLineItems(offer.line_items || []);
    setIsSubmitAttempted(false);
    setIsOfferDialogOpen(true);
  };

  const handleSaveOffer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerTitle.trim()) {
      setIsSubmitAttempted(true);
      toast.error(t("offers:validation_title_required", { defaultValue: "Titel ist erforderlich." }));
      return;
    }

    if (!selectedCompanyId && !selectedContactId) {
      setIsSubmitAttempted(true);
      toast.error(t("offers:validation_entity_required"));
      return;
    }

    if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      setIsSubmitAttempted(true);
      toast.error(t("offers:validation_issue_date_invalid", { defaultValue: "Ungültiges Ausstellungsdatum." }));
      return;
    }

    if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) {
      setIsSubmitAttempted(true);
      toast.error(t("offers:validation_valid_until_invalid", { defaultValue: "Ungültiges Gültigkeitsdatum." }));
      return;
    }

    // Validate line items to prevent empty/negative/NaN inputs
    for (let i = 0; i < offerLineItems.length; i++) {
      const item = offerLineItems[i];
      if (!item.description || !item.description.trim()) {
        setIsSubmitAttempted(true);
        toast.error(t("invoices:please_enter_desc", { index: i + 1, defaultValue: `Bitte eine Beschreibung für Position ${i + 1} eingeben.` }));
        return;
      }
      if (!item.is_text_position) {
        if (isNaN(item.quantity) || item.quantity <= 0) {
          setIsSubmitAttempted(true);
          toast.error(t("offers:validation_quantity_positive", { defaultValue: "Menge muss größer als 0 sein." }));
          return;
        }
        if (isNaN(item.unit_price) || item.unit_price < 0) {
          setIsSubmitAttempted(true);
          toast.error(t("offers:validation_unit_price_nonnegative", { defaultValue: "Einzelpreis darf nicht negativ sein." }));
          return;
        }
      }
    }

    setIsSubmitAttempted(false);

    const payload = {
      associated_company_id: selectedCompanyId || null,
      associated_contact_id: selectedContactId || null,
      title: offerTitle,
      introductory_text: introText,
      closing_text: closingText,
      issue_date: issueDate,
      valid_until: validUntil,
      payment_term: paymentTerm,
      currency_code: currencyCode,
      is_vat_inclusive: isVatInclusive,
      line_items: offerLineItems,
      offer_status: editingOffer ? offerStatus : "not_sent"
    };

    if (editingOffer) {
      updateOfferMutation.mutate({
        id_uuid: editingOffer.id_uuid,
        ...payload
      });
    } else {
      createOfferMutation.mutate(payload);
    }
  };

  const handleDeleteOffer = (id: string) => {
    const offer = offers.find(o => o.id_uuid === id);
    if (offer) {
      setOfferToDelete(offer);
      setIsDeleteConfirmOpen(true);
    }
  };

  const handleConvertToInvoice = (offer: Offer) => {
    // Generate line items matching Invoice schema
    const invoiceLineItems = offer.line_items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unit_price: item.unit_price,
      vat_rate: item.vat_rate,
      total_net: item.total_net,
      unit_code: item.unit_code || "HUR"
    }));

    const computedInvoiceNumber = `RE-TEMP-${Date.now().toString().substring(8)}`;

    createInvoiceMutation.mutate({
      invoice_number: computedInvoiceNumber,
      associated_company_id: offer.associated_company_id,
      associated_contact_id: offer.associated_contact_id,
      issue_date: new Date().toISOString().split("T")[0],
      payment_term: offer.payment_term || "14",
      is_vat_inclusive: offer.is_vat_inclusive,
      total_net_amount: offer.total_net_amount,
      total_vat_amount: offer.total_vat_amount,
      total_gross_amount: offer.total_gross_amount,
      currency_code: offer.currency_code,
      invoice_line_items: invoiceLineItems,
      introductory_text: offer.introductory_text,
      closing_text: offer.closing_text,
      payment_status: "draft",
      created_by_identity: "human",
      ai_confidence_score: 1.0,
      is_verified_by_human: true
    });
  };

  // Line Item actions
  const handleAddLineItem = () => {
    setOfferLineItems(prev => [
      ...prev,
      {
        position: prev.length + 1,
        description: "",
        quantity: 1,
        unit_code: "PCE",
        unit_price: 0,
        vat_rate: 19,
        total_net: 0,
        total_gross: 0,
        is_text_position: false
      }
    ]);
  };

  const handleAddTextLineItem = () => {
    setOfferLineItems(prev => [
      ...prev,
      {
        position: prev.length + 1,
        description: "",
        quantity: 1,
        unit_code: "PCE",
        unit_price: 0,
        vat_rate: 19,
        total_net: 0,
        total_gross: 0,
        is_text_position: true
      }
    ]);
  };

  const handleAddLineItemFromTemplate = (template: {
    template_name_text?: string | null;
    description?: string | null;
    quantity?: number | null;
    unit_code?: string | null;
    unit_price?: number | null;
    vat_rate?: number | null;
  }) => {
    setOfferLineItems(prev => {
      const isFirstItemEmpty = prev.length === 1 && prev[0].unit_price === 0 && prev[0].description === "";
      const newItem = {
        position: isFirstItemEmpty ? 1 : prev.length + 1,
        description: template.description || template.template_name_text || "",
        quantity: template.quantity || 1,
        unit_code: template.unit_code || "PCE",
        unit_price: template.unit_price || 0,
        vat_rate: template.vat_rate !== undefined && template.vat_rate !== null ? template.vat_rate : 19,
        total_net: (template.quantity || 1) * (template.unit_price || 0),
        total_gross: (template.quantity || 1) * (template.unit_price || 0) * (1 + (template.vat_rate !== undefined && template.vat_rate !== null ? template.vat_rate : 19) / 100),
        is_text_position: false
      };
      if (isFirstItemEmpty) {
        return [newItem];
      }
      return [...prev, newItem];
    });
  };

  const handleRemoveLineItem = (idx: number) => {
    setOfferLineItems(prev => prev.filter((_, i) => i !== idx).map((item, i) => ({ ...item, position: i + 1 })));
  };

  const handleUpdateLineItem = (idx: number, fields: Partial<OfferLineItem>) => {
    setOfferLineItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const updated = { ...item, ...fields };
      if (updated.quantity !== undefined) updated.quantity = Math.max(0, updated.quantity);
      if (updated.unit_price !== undefined) updated.unit_price = Math.max(0, updated.unit_price);
      if (updated.vat_rate !== undefined) updated.vat_rate = Math.max(0, updated.vat_rate);
      if (updated.is_text_position) {
        updated.quantity = 1;
        updated.unit_price = 0;
        updated.total_net = 0;
        updated.total_gross = 0;
      } else {
        const net = Number((updated.quantity * updated.unit_price).toFixed(2));
        const vat = Number((net * (updated.vat_rate / 100)).toFixed(2));
        updated.total_net = net;
        updated.total_gross = Number((net + vat).toFixed(2));
      }
      return updated;
    }));
  };

  // Calculate form totals dynamically
  const formTotals = React.useMemo(() => {
    let net = 0;
    const vatByRate: Record<number, number> = {};
    offerLineItems.forEach(item => {
      const isTextPos = !!item.is_text_position;
      const itemNet = isTextPos ? 0 : Number((item.quantity * item.unit_price).toFixed(2));
      const rate = item.vat_rate !== undefined ? item.vat_rate : 19;
      const itemVat = isTextPos ? 0 : Number((itemNet * (rate / 100)).toFixed(2));
      net += itemNet;
      if (!isTextPos) {
        vatByRate[rate] = (vatByRate[rate] || 0) + itemVat;
      }
    });

    const totalVat = Object.values(vatByRate).reduce((sum, v) => sum + v, 0);

    return {
      net: Number(net.toFixed(2)),
      vatByRate: Object.entries(vatByRate).map(([rate, amount]) => ({
        rate: parseFloat(rate),
        amount: Number(amount.toFixed(2))
      })),
      vat: Number(totalVat.toFixed(2)),
      gross: Number((net + totalVat).toFixed(2))
    };
  }, [offerLineItems]);

  // Filters mapping
  const filteredOffers = React.useMemo(() => {
    return offers.filter(o => {
      if (statusFilter !== "all") {
        if (o.offer_status !== statusFilter) return false;
      }
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const compName = companies.find(c => c.id_uuid === o.associated_company_id)?.full_legal_name || "";
      const contactName = (() => {
        const ct = contacts.find(c => c.id_uuid === o.associated_contact_id);
        return ct ? `${ct.first_name || ""} ${ct.last_name || ""}`.trim() : "";
      })();
      return (
        o.offer_number.toLowerCase().includes(q) ||
        o.title.toLowerCase().includes(q) ||
        compName.toLowerCase().includes(q) ||
        contactName.toLowerCase().includes(q) ||
        (o.issue_date || '').toLowerCase().includes(q) ||
        String(o.total_gross_amount).toLowerCase().includes(q) ||
        String(o.total_net_amount).toLowerCase().includes(q)
      );
    });
  }, [offers, searchQuery, companies, contacts, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOffers.length / limit));

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [filteredOffers.length, limit, totalPages, page]);

  const paginatedOffers = React.useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredOffers.slice(startIndex, startIndex + limit);
  }, [filteredOffers, page, limit]);

  return (
    <div className="space-y-8 pb-12">
      {/* Upper header action bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-white/5">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-display uppercase italic tracking-[0.05em]">
            {t("offers:title")}
          </h2>
          <p className="text-slate-500 text-xs sm:text-sm mt-1 uppercase tracking-widest font-semibold opacity-60 italic">
            {t("offers:offers")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-auto sm:min-w-[220px] flex-1">
            <input
              type="text"
              placeholder={t("common:searching", { defaultValue: "SUCHEN..." }).replace('...', '').toUpperCase()}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full h-11 bg-primary-light border border-white/10 rounded-xl px-4 text-white text-xs font-bold focus:outline-none focus:border-accent-orange pl-10 placeholder:text-slate-500 placeholder:uppercase"
            />
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-2 bg-primary-light border border-white/10 px-4 h-11 rounded-xl text-xs text-white shrink-0">
            <span className="text-slate-500 uppercase tracking-widest font-black text-[10px]">
              {t('common:show', { defaultValue: 'Anzeigen' })}
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
            onClick={() => setIsBatchExportOpen(true)}
            className="flex items-center justify-center gap-2 bg-primary-light border border-white/5 text-slate-300 px-5 sm:px-6 h-11 rounded-xl font-bold hover:bg-white/5 transition-all hover:text-white group font-display text-xs uppercase tracking-widest leading-none shrink-0"
          >
            <Download size={18} className="group-hover:translate-y-0.5 transition-transform text-accent-blue" />
            {t('common:batch_export')}
          </button>

          <button
            onClick={handleOpenCreateOffer}
            className="flex items-center justify-center gap-2 bg-accent-orange text-white px-5 sm:px-6 h-11 rounded-xl font-bold hover:bg-accent-orange/90 transition-all shadow-xl shadow-accent-orange/20 active:scale-95 font-display text-xs uppercase tracking-widest leading-none shrink-0"
          >
            <Plus size={18} />
            {t("offers:create_offer")}
          </button>
        </div>
      </div>

      {/* Status FILTER TABS */}
      <div className="flex border-b border-white/5 pb-2 ml-1 gap-4 sm:gap-6 overflow-x-auto no-scrollbar max-w-full">
        {([
          { value: 'all', label: t('offers:all', { defaultValue: 'Alle' }), count: undefined },
          { value: 'draft', label: t('offers:draft', { defaultValue: 'Entwurf' }), count: offers.filter(o => o.offer_status === 'draft').length },
          { value: 'not_sent', label: t('offers:not_sent', { defaultValue: 'Nicht gesendet' }), count: offers.filter(o => o.offer_status === 'draft' || (o.offer_status as string) === 'not_sent').length },
          { value: 'sent', label: t('offers:sent', { defaultValue: 'Gesendet' }), count: offers.filter(o => o.offer_status === 'sent').length },
          { value: 'accepted', label: t('offers:accepted', { defaultValue: 'Angenommen' }), count: offers.filter(o => o.offer_status === 'accepted').length },
          { value: 'declined', label: t('offers:declined', { defaultValue: 'Abgelehnt' }), count: offers.filter(o => o.offer_status === 'rejected' || (o.offer_status as string) === 'declined').length }
        ] as const).map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatusFilter(tab.value);
              setPage(1);
            }}
            className={cn(
              "pb-2 text-xs font-black uppercase tracking-widest relative transition-all duration-300 flex items-center gap-1.5 focus:outline-none cursor-pointer",
              statusFilter === tab.value 
                ? "text-accent-orange font-bold" 
                : "text-slate-500 hover:text-white"
            )}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className={cn(
                "px-1.5 py-0.5 text-[9px] rounded-md font-mono",
                statusFilter === tab.value 
                  ? "bg-accent-orange/20 text-accent-orange" 
                  : "bg-white/5 text-slate-500"
              )}>
                {tab.count}
              </span>
            )}
            {statusFilter === tab.value && (
              <motion.div 
                layoutId="activeOfferTabMarker"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-orange"
              />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isOffersLoading ? (
          <div className="p-20 text-center">
            <div className="w-10 h-10 border-4 border-accent-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">{t('common:scanning', { defaultValue: 'Scanne...' })}</p>
          </div>
        ) : (
          <>
            {paginatedOffers.map((o, idx) => {
              const company = companies.find(c => c.id_uuid === o.associated_company_id);
              const contact = contacts.find(c => c.id_uuid === o.associated_contact_id);
              const recipientName = company?.full_legal_name || 
                                    (contact ? `${contact.first_name || ""} ${contact.last_name}` : "") || 
                                    t("offers:free_offer");

              return (
                <motion.div
                  key={o.id_uuid}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-primary-light/30 border border-white/5 p-4 sm:p-5 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-6 hover:border-accent-orange/40 hover:bg-primary-light transition-all"
                >
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                    <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-primary-dark border border-white/5 flex items-center justify-center text-accent-orange group-hover:bg-accent-orange/10 transition-all shrink-0">
                      <FileSpreadsheet size={24} className="sm:hidden" />
                      <FileSpreadsheet size={28} className="hidden sm:block" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1 font-mono flex items-center gap-2 flex-wrap">
                        <span>#{o.offer_number} • {new Date(o.issue_date).toLocaleDateString(i18n.language)}</span>
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                          o.offer_status === "draft" && "bg-slate-500/20 text-slate-400 border border-slate-500/35",
                          o.offer_status === "not_sent" && "bg-amber-500/20 text-amber-400 border border-amber-500/35",
                          o.offer_status === "sent" && "bg-accent-blue/20 text-accent-blue border border-accent-blue/35",
                          o.offer_status === "accepted" && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/35",
                          o.offer_status === "declined" && "bg-red-500/20 text-red-400 border border-red-500/35"
                        )}>
                          {t(`offers:${o.offer_status}`)}
                        </span>
                      </div>
                      <h3 className="text-base sm:text-lg font-black text-white truncate font-display italic tracking-tight">
                        {company ? (
                          <button
                            onClick={() => {
                              localStorage.setItem('open_company_id', company.id_uuid);
                              window.dispatchEvent(new CustomEvent('navigate-to-tab', { detail: 'companies' }));
                            }}
                            className="text-neutral-white hover:text-accent-blue font-bold text-left underline decoration-white/10 decoration-dashed underline-offset-4 cursor-pointer transition-colors"
                            title={t("offers:go_to_company", { defaultValue: "Zum Unternehmensprofil" })}
                          >
                            {recipientName}
                          </button>
                        ) : (
                          <span className="text-slate-500 italic">
                            {recipientName}
                          </span>
                        )}
                      </h3>
                      <div className="flex items-center gap-3 sm:gap-4 text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1 flex-wrap">
                        <span className="flex items-center gap-1.5"><FileText size={12} className="text-accent-blue" /> {o.title}</span>
                        <span className="flex items-center gap-1.5"><Tag size={12} className="text-accent-orange" /> {o.line_items?.length || 0} {t('offers:line_items')}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between lg:justify-end gap-3 sm:gap-6 w-full lg:w-auto pt-3 lg:pt-0 border-t lg:border-t-0 border-white/5 shrink-0">
                    <div className="shrink-0 text-left min-w-[100px] sm:min-w-[125px] lg:border-l lg:border-white/5 lg:pl-6">
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 font-mono">
                        {t('offers:valid_until')}
                      </div>
                      <span className="text-xs font-bold text-white font-mono bg-white/5 border border-white/10 px-2.5 py-1 rounded-md">
                        {new Date(o.valid_until).toLocaleDateString(i18n.language)}
                      </span>
                    </div>
                    
                    <div className="text-right shrink-0">
                      <div className="text-[11px] sm:text-xs font-bold text-slate-500 mb-0.5">{formatCurrency(o.total_net_amount, o.currency_code)} {t('offers:total_net')}</div>
                      <div className="text-lg sm:text-xl font-bold text-white tracking-tight">{formatCurrency(o.total_gross_amount, o.currency_code)}</div>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button 
                      onClick={() => {
                        setSelectedOffer(o as Offer);
                        setIsPreviewOpen(true);
                      }}
                      className="p-3 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
                    >
                      <Eye size={18} />
                    </button>
                    
                    <div className="relative" ref={activeMenuId === o.id_uuid ? menuContainerRef : null}>
                      <button 
                        onClick={() => setActiveMenuId(activeMenuId === o.id_uuid ? null : o.id_uuid)}
                        className={cn(
                          "p-3 rounded-xl transition-all",
                          activeMenuId === o.id_uuid ? "text-white bg-slate-800" : "text-slate-500 hover:text-white hover:bg-slate-800"
                        )}
                      >
                        <MoreVertical size={18} />
                      </button>
                      
                      <AnimatePresence>
                        {activeMenuId === o.id_uuid && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -5 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -5 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-primary-dark border border-white/10 shadow-2xl z-50 overflow-hidden py-1"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                handleOpenEditOffer(o as Offer);
                              }}
                              className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left font-display uppercase tracking-wider"
                            >
                              <Edit2 size={14} className="text-accent-blue" />
                              {t('common:edit', { defaultValue: 'Bearbeiten' })}
                            </button>
                            
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMenuId(null);
                                generatePdfMutation.mutate({ id_uuid: o.id_uuid });
                              }}
                              className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                            >
                              <Download size={14} className="text-emerald-400" />
                              {t('offers:generate_pdf')}
                            </button>

                            {company && company.email_address && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setMailTarget({
                                    id_uuid: company.id_uuid,
                                    email: company.email_address!,
                                    name: company.full_legal_name,
                                    offer: o as Offer
                                  });
                                }}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                              >
                                <Mail size={14} className="text-accent-orange" />
                                {t('offers:send_by_email', { defaultValue: "Per E-Mail versenden" })}
                              </button>
                            )}

                            {o.offer_status === "accepted" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  handleConvertToInvoice(o as Offer);
                                }}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-emerald-400 hover:text-emerald-300 hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                              >
                                <FileCheck size={14} className="text-emerald-400" />
                                {t('offers:convert_to_invoice')}
                              </button>
                            )}

                            {o.offer_status !== "accepted" && o.offer_status !== "declined" && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  handleDeleteOffer(o.id_uuid);
                                }}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-red-500 hover:text-red-400 hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                              >
                                <Trash2 size={14} className="text-red-500" />
                                {t('common:delete', { defaultValue: 'Löschen' })}
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              </motion.div>
              );
            })}

            {filteredOffers.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-4 bg-primary-dark/40 border border-white/5 rounded-xl">
                <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  {t('common:pagination_entries', { from: Math.min(filteredOffers.length, (page - 1) * limit + 1), to: Math.min(filteredOffers.length, page * limit), count: filteredOffers.length })}
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
          </>
        )}
        {!isOffersLoading && filteredOffers.length === 0 && (
          <div className="p-24 text-center bg-primary-light/20 rounded-xl border-2 border-dashed border-white/5">
            <div className="w-20 h-20 bg-primary-dark border border-white/5 text-accent-orange rounded-xl flex items-center justify-center mx-auto mb-6 transform -rotate-6 shadow-2xl">
              <FileSpreadsheet size={40} />
            </div>
            <p className="text-slate-400 font-black uppercase tracking-widest text-xs mb-2">{t("offers:no_offers")}</p>
          </div>
        )}
      </div>

      {/* Editor Dialog Offer */}
      <Dialog
        isOpen={isOfferDialogOpen}
        onClose={() => setIsOfferDialogOpen(false)}
        title={editingOffer ? t("offers:edit_offer") : t("offers:create_offer")}
        size="full"
        noPadding
      >
        <form onSubmit={handleSaveOffer} className="space-y-10 bg-primary-dark p-12">
          <fieldset disabled={isReadOnly} className="space-y-10 disabled:opacity-80">
            <div className="grid grid-cols-3 gap-x-12 gap-y-8">
              <div className="col-span-3 flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("offers:subject")} *</label>
                <input
                  type="text"
                  required
                  value={offerTitle}
                  onChange={(e) => setOfferTitle(e.target.value)}
                  className={cn(
                    "w-full bg-primary-light border-2 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all",
                    isSubmitAttempted && !offerTitle.trim()
                      ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                      : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-x-12 gap-y-8 pt-10 border-t border-white/5">
              {/* Searchable Company Dropdown */}
              <div className="relative flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('offers:fields.associated_company', { defaultValue: 'Zugeordnetes Unternehmen' })}</label>
                
                {isCompanyDropdownOpen && (
                  <div 
                    className="fixed inset-0 z-40 cursor-default" 
                    onClick={() => setIsCompanyDropdownOpen(false)} 
                  />
                )}
                
                <div className="relative z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setIsCompanyDropdownOpen(!isCompanyDropdownOpen);
                      setIsContactDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full bg-primary-light border-2 rounded-xl px-5 py-4 text-left text-white text-sm font-bold flex justify-between items-center focus:outline-none focus:ring-4 transition-all h-[58px]",
                      isSubmitAttempted && !selectedCompanyId && !selectedContactId
                        ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                        : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                    )}
                  >
                    <span className="truncate">{companyButtonLabel}</span>
                    <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                  </button>
                  
                  {isCompanyDropdownOpen && (
                    <div className="absolute left-0 right-0 mt-2 bg-primary-light border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-60 flex flex-col z-[60]">
                      <div className="p-2 border-b border-white/5 bg-primary-dark">
                        <input
                          type="text"
                          placeholder={t("offers:search_company_placeholder")}
                          value={companySearchQuery}
                          onChange={(e) => setCompanySearchQuery(e.target.value)}
                          className="w-full bg-primary-light border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto flex-1 py-1 divide-y divide-white/5 max-h-44">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCompanyId("");
                            setIsCompanyDropdownOpen(false);
                            setCompanySearchQuery("");
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-slate-400 hover:bg-primary-dark hover:text-white transition-colors"
                        >
                          {t("offers:select_company")}
                        </button>
                        {filteredCompaniesForSelect.map((c: typeof companies[number]) => (
                          <button
                            key={c.id_uuid}
                            type="button"
                            onClick={() => {
                              setSelectedCompanyId(c.id_uuid);
                              setIsCompanyDropdownOpen(false);
                              setCompanySearchQuery("");
                            }}
                            className={cn(
                              "w-full text-left px-4 py-2.5 text-xs transition-colors",
                              selectedCompanyId === c.id_uuid
                                ? "bg-accent-blue/10 text-accent-blue font-bold"
                                : "text-slate-300 hover:bg-primary-dark hover:text-white"
                            )}
                          >
                            {c.full_legal_name}
                          </button>
                        ))}
                        {filteredCompaniesForSelect.length === 0 && (
                          <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                            {t("offers:no_companies_found")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-right relative z-40">
                  <button
                    type="button"
                    onClick={() => setIsNewCompanyDialogOpen(true)}
                    className="text-[10px] text-accent-orange hover:underline font-bold uppercase tracking-wider transition-all"
                  >
                    + {t("offers:create_new_company_link")}
                  </button>
                </div>
              </div>

              {/* Searchable Contact Dropdown */}
              <div className="relative flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('offers:fields.associated_contact', { defaultValue: 'Zugeordneter Kontakt' })}</label>
                
                {isContactDropdownOpen && (
                  <div 
                    className="fixed inset-0 z-40 cursor-default" 
                    onClick={() => setIsContactDropdownOpen(false)} 
                  />
                )}
                
                <div className="relative z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setIsContactDropdownOpen(!isContactDropdownOpen);
                      setIsCompanyDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full bg-primary-light border-2 rounded-xl px-5 py-4 text-left text-white text-sm font-bold flex justify-between items-center focus:outline-none focus:ring-4 transition-all h-[58px]",
                      isSubmitAttempted && !selectedCompanyId && !selectedContactId
                        ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                        : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                    )}
                  >
                    <span className="truncate">{contactButtonLabel}</span>
                    <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                  </button>
                  
                  {isContactDropdownOpen && (
                    <div className="absolute left-0 right-0 mt-2 bg-primary-light border border-white/10 rounded-xl shadow-2xl overflow-hidden max-h-60 flex flex-col z-[60]">
                      <div className="p-2 border-b border-white/5 bg-primary-dark">
                        <input
                          type="text"
                          placeholder={t("offers:search_contact_placeholder")}
                          value={contactSearchQuery}
                          onChange={(e) => setContactSearchQuery(e.target.value)}
                          className="w-full bg-primary-light border border-white/5 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange"
                          autoFocus
                        />
                      </div>
                      <div className="overflow-y-auto flex-1 py-1 divide-y divide-white/5 max-h-44">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedContactId("");
                            setIsContactDropdownOpen(false);
                            setContactSearchQuery("");
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-slate-400 hover:bg-primary-dark hover:text-white transition-colors"
                        >
                          {t("offers:select_contact")}
                        </button>
                        {filteredContactsForSelect.map((c: typeof contacts[number]) => {
                          const name = `${c.first_name || ""} ${c.last_name || ""}`.trim();
                          return (
                            <button
                              key={c.id_uuid}
                              type="button"
                              onClick={() => {
                                setSelectedContactId(c.id_uuid);
                                setIsContactDropdownOpen(false);
                                setContactSearchQuery("");
                              }}
                              className={cn(
                                "w-full text-left px-4 py-2.5 text-xs transition-colors",
                                selectedContactId === c.id_uuid
                                  ? "bg-accent-blue/10 text-accent-blue font-bold"
                                  : "text-slate-300 hover:bg-primary-dark hover:text-white"
                              )}
                            >
                              {name}
                            </button>
                          );
                        })}
                        {filteredContactsForSelect.length === 0 && (
                          <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                            {t("offers:no_contacts_found")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-right relative z-40">
                  <button
                    type="button"
                    onClick={() => setIsNewContactDialogOpen(true)}
                    className="text-[10px] text-accent-orange hover:underline font-bold uppercase tracking-wider transition-all"
                  >
                    + {t("offers:create_new_contact_link")}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("offers:status")}</label>
                <div className="relative">
                  <select
                    value={offerStatus}
                    onChange={(e) => setOfferStatus(e.target.value as 'draft' | 'not_sent' | 'sent' | 'accepted' | 'declined')}
                    disabled={!editingOffer}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all disabled:opacity-50 disabled:cursor-not-allowed appearance-none h-[58px]"
                  >
                    <option value="draft" className="bg-primary-dark text-white">{t("offers:draft")}</option>
                    <option value="not_sent" className="bg-primary-dark text-white">{t("offers:not_sent")}</option>
                    <option value="sent" className="bg-primary-dark text-white">{t("offers:sent")}</option>
                    <option value="accepted" className="bg-primary-dark text-white">{t("offers:accepted")}</option>
                    <option value="declined" className="bg-primary-dark text-white">{t("offers:declined")}</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-x-12 gap-y-8 pt-10 border-t border-white/5">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("offers:issue_date")}</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    className={cn(
                      "w-full bg-primary-light border-2 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all h-[58px]",
                      isSubmitAttempted && (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate))
                        ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                        : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                    )}
                  />
                  <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t("offers:valid_until")}</label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                    className={cn(
                      "w-full bg-primary-light border-2 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 transition-all h-[58px]",
                      isSubmitAttempted && (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil))
                        ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                        : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                    )}
                  />
                  <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('offers:fields.currency', { defaultValue: 'Währung' })}</label>
                <div className="relative">
                  <select
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none h-[58px]"
                  >
                    <option value="EUR" className="bg-primary-dark text-white">EUR (€)</option>
                    <option value="USD" className="bg-primary-dark text-white">USD ($)</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                </div>
              </div>
            </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 pt-10 border-t border-white/5">
            {/* Introductory Text Section */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center h-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t("offers:introductory_text")}
                </label>
                {(introText.includes('{{') || introText.includes('}}')) && (
                  <button
                    type="button"
                    onClick={() => {
                      updateIntroText(replaceOfferPlaceholders(introText));
                      toast.success(t('offers:placeholder_replaced_intro', { defaultValue: 'Platzhalter im Einleitungstext ersetzt!' }));
                    }}
                    className="text-[9px] bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue border border-accent-blue/20 rounded px-2 py-0.5 font-bold transition-all uppercase tracking-wider"
                  >
                    Platzhalter ersetzen
                  </button>
                )}
              </div>

              {/* Mini Rich Text Toolbar */}
              <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-1.5 border border-white/5 rounded-t-xl mb-[-1px] z-10 relative">
                <button
                  type="button"
                  onClick={() => {
                    introEditorRef.current?.focus();
                    document.execCommand('bold', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_bold', { defaultValue: 'Fett' })}
                >
                  <Bold size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    introEditorRef.current?.focus();
                    document.execCommand('italic', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_italic', { defaultValue: 'Kursiv' })}
                >
                  <Italic size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    introEditorRef.current?.focus();
                    document.execCommand('underline', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_underline', { defaultValue: 'Unterstreichen' })}
                >
                  <Underline size={12} />
                </button>
                <div className="w-px h-3.5 bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => {
                    introEditorRef.current?.focus();
                    document.execCommand('insertUnorderedList', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_list', { defaultValue: 'Aufzählung' })}
                >
                  <List size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentText = introEditorRef.current ? introEditorRef.current.innerHTML : introText;
                    setAiFieldId('introductory_text');
                    setAiContext('Angebot Einleitungstext');
                    setAiValue(currentText || '');
                  }}
                  className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                  title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
                >
                  <Sparkles size={11} className="animate-pulse" />
                  {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
                </button>
              </div>

              <div
                ref={introEditorRef}
                contentEditable
                onBlur={() => {
                  setIntroText(introEditorRef.current?.innerHTML || "");
                }}
                className="w-full bg-primary-light border-2 border-white/5 rounded-b-xl px-5 py-4 text-white text-sm focus:outline-none focus:border-accent-blue transition-all min-h-[140px] max-h-[250px] overflow-y-auto font-sans"
                style={{ outline: 'none' }}
                dangerouslySetInnerHTML={{ __html: introText }}
              />

              {/* Dynamic Variable Helper Chips */}
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider self-center mr-1">
                  {t('dialog.variables_label', { defaultValue: 'Variablen:' })}
                </span>
                {offerVariables.map((v) => (
                  <button
                    key={v.tag}
                    type="button"
                    onClick={() => insertContentEditablePlaceholder(introEditorRef, v.tag, updateIntroText)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-accent-blue/10 text-slate-400 hover:text-accent-blue border border-white/5 hover:border-accent-blue/25 rounded-lg text-[9px] font-mono font-bold transition-all shadow-sm"
                    title={v.tag}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {introductoryTemplates.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-2">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">
                    {t('dialog.select_template_label', { defaultValue: 'Einleitungstext einfügen:' })}
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsIntroTemplateDropdownOpen(!isIntroTemplateDropdownOpen);
                        setIsClosingTemplateDropdownOpen(false);
                      }}
                      className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-3 text-left text-white text-xs font-bold flex justify-between items-center focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all"
                    >
                      <span className="truncate">{t('dialog.choose_template', { defaultValue: 'Vorlage wählen' })}</span>
                      <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                    </button>

                    <AnimatePresence>
                      {isIntroTemplateDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-50 left-0 right-0 top-full mt-2 bg-primary-light border border-white/10 shadow-2xl rounded-xl overflow-hidden max-h-60 flex flex-col"
                        >
                          <div className="p-2 border-b border-white/5 bg-primary-dark">
                            <input
                              type="text"
                              placeholder={t("offers:search_template_placeholder", { defaultValue: "Vorlage suchen..." })}
                              value={introTemplateSearchQuery}
                              onChange={(e) => setIntroTemplateSearchQuery(e.target.value)}
                              className="w-full bg-primary-light border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange"
                              autoFocus
                            />
                          </div>
                          <div className="overflow-y-auto flex-1 py-1 divide-y divide-white/5 max-h-44">
                            {filteredIntroTemplatesForSelect.map((tmpl) => (
                              <button
                                key={tmpl.id_uuid}
                                type="button"
                                onClick={() => {
                                  updateIntroText(tmpl.template_body_content);
                                  setIntroTemplateSearchQuery("");
                                  setIsIntroTemplateDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-primary-dark hover:text-white transition-colors"
                              >
                                {tmpl.template_name_text}
                              </button>
                            ))}
                            {filteredIntroTemplatesForSelect.length === 0 && (
                              <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                                Keine Vorlagen gefunden
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            {/* Closing Text Section */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center h-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t("offers:closing_text")}
                </label>
                {(closingText.includes('{{') || closingText.includes('}}')) && (
                  <button
                    type="button"
                    onClick={() => {
                      updateClosingText(replaceOfferPlaceholders(closingText));
                      toast.success(t('offers:placeholder_replaced_closing', { defaultValue: 'Platzhalter im Schlusssatz ersetzt!' }));
                    }}
                    className="text-[9px] bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue border border-accent-blue/20 rounded px-2 py-0.5 font-bold transition-all uppercase tracking-wider"
                  >
                    Platzhalter ersetzen
                  </button>
                )}
              </div>

              {/* Mini Rich Text Toolbar */}
              <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-1.5 border border-white/5 rounded-t-xl mb-[-1px] z-10 relative">
                <button
                  type="button"
                  onClick={() => {
                    closingEditorRef.current?.focus();
                    document.execCommand('bold', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_bold', { defaultValue: 'Fett' })}
                >
                  <Bold size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closingEditorRef.current?.focus();
                    document.execCommand('italic', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_italic', { defaultValue: 'Kursiv' })}
                >
                  <Italic size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closingEditorRef.current?.focus();
                    document.execCommand('underline', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_underline', { defaultValue: 'Unterstreichen' })}
                >
                  <Underline size={12} />
                </button>
                <div className="w-px h-3.5 bg-white/10 mx-1" />
                <button
                  type="button"
                  onClick={() => {
                    closingEditorRef.current?.focus();
                    document.execCommand('insertUnorderedList', false);
                  }}
                  className="p-1 text-slate-400 hover:bg-white/5 hover:text-white rounded transition-colors"
                  title={t('offers:editor_list', { defaultValue: 'Aufzählung' })}
                >
                  <List size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const currentText = closingEditorRef.current ? closingEditorRef.current.innerHTML : closingText;
                    setAiFieldId('closing_text');
                    setAiContext('Angebot Abschlusssatz');
                    setAiValue(currentText || '');
                  }}
                  className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                  title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
                >
                  <Sparkles size={11} className="animate-pulse" />
                  {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
                </button>
              </div>

              <div
                ref={closingEditorRef}
                contentEditable
                onBlur={() => {
                  setClosingText(closingEditorRef.current?.innerHTML || "");
                }}
                className="w-full bg-primary-light border-2 border-white/5 rounded-b-xl px-5 py-4 text-white text-sm focus:outline-none focus:border-accent-blue transition-all min-h-[140px] max-h-[250px] overflow-y-auto font-sans"
                style={{ outline: 'none' }}
                dangerouslySetInnerHTML={{ __html: closingText }}
              />

              {/* Dynamic Variable Helper Chips */}
              <div className="flex flex-wrap gap-1.5 mt-1">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider self-center mr-1">
                  {t('dialog.variables_label', { defaultValue: 'Variablen:' })}
                </span>
                {offerVariables.map((v) => (
                  <button
                    key={v.tag}
                    type="button"
                    onClick={() => insertContentEditablePlaceholder(closingEditorRef, v.tag, updateClosingText)}
                    className="px-2.5 py-1 bg-white/5 hover:bg-accent-blue/10 text-slate-400 hover:text-accent-blue border border-white/5 hover:border-accent-blue/25 rounded-lg text-[9px] font-mono font-bold transition-all shadow-sm"
                    title={v.tag}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              {closingTemplates.length > 0 && (
                <div className="flex flex-col gap-1.5 mt-2">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">
                    {t('dialog.select_template_label', { defaultValue: 'Abschlusssatz einfügen:' })}
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsClosingTemplateDropdownOpen(!isClosingTemplateDropdownOpen);
                        setIsIntroTemplateDropdownOpen(false);
                      }}
                      className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-3 text-left text-white text-xs font-bold flex justify-between items-center focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all"
                    >
                      <span className="truncate">{t('dialog.choose_template', { defaultValue: 'Vorlage wählen' })}</span>
                      <ChevronDown size={14} className="text-slate-400 shrink-0 ml-2" />
                    </button>

                    <AnimatePresence>
                      {isClosingTemplateDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-50 left-0 right-0 top-full mt-2 bg-primary-light border border-white/10 shadow-2xl rounded-xl overflow-hidden max-h-60 flex flex-col"
                        >
                          <div className="p-2 border-b border-white/5 bg-primary-dark">
                            <input
                              type="text"
                              placeholder={t("offers:search_template_placeholder", { defaultValue: "Vorlage suchen..." })}
                              value={closingTemplateSearchQuery}
                              onChange={(e) => setClosingTemplateSearchQuery(e.target.value)}
                              className="w-full bg-primary-light border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange"
                              autoFocus
                            />
                          </div>
                          <div className="overflow-y-auto flex-1 py-1 divide-y divide-white/5 max-h-44">
                            {filteredClosingTemplatesForSelect.map((tmpl) => (
                              <button
                                key={tmpl.id_uuid}
                                type="button"
                                onClick={() => {
                                  updateClosingText(tmpl.template_body_content);
                                  setClosingTemplateSearchQuery("");
                                  setIsClosingTemplateDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-primary-dark hover:text-white transition-colors"
                              >
                                {tmpl.template_name_text}
                              </button>
                            ))}
                            {filteredClosingTemplatesForSelect.length === 0 && (
                              <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                                Keine Vorlagen gefunden
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-8 pt-10 border-t border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] font-display">{t('offers:headers.items', { defaultValue: 'Positionen' })}</h3>
              <div className="flex items-center gap-10">
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div 
                    onClick={() => setIsVatInclusive(true)}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                      isVatInclusive ? "border-accent-blue bg-accent-blue shadow-xl shadow-accent-blue/20" : "border-white/10 group-hover:border-white/20 bg-primary-light"
                    )}
                  >
                    {isVatInclusive && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in duration-300" />}
                  </div>
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('dialog.vat_inclusive', { defaultValue: 'Brutto' })}</span>
                </label>
                <label className="flex items-center gap-4 cursor-pointer group">
                  <div 
                    onClick={() => setIsVatInclusive(false)}
                    className={cn(
                      "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                      !isVatInclusive ? "border-accent-blue bg-accent-blue shadow-xl shadow-accent-blue/20" : "border-white/10 group-hover:border-white/20 bg-primary-light"
                    )}
                  >
                    {!isVatInclusive && <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in duration-300" />}
                  </div>
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('dialog.vat_exclusive', { defaultValue: 'Netto' })}</span>
                </label>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent rounded-xl border border-white/5 bg-primary-light/30 shadow-sm">
              <table className="w-full min-w-[700px] text-left border-collapse">
                <thead>
                  <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-white/5 bg-primary-light/50">
                    <th className="py-4 px-6 w-12 text-center">{t('preview.hash', { defaultValue: '#' })}</th>
                    <th className="py-4 px-4">{t('offers:headers.item_name', { defaultValue: 'Bezeichnung & Beschreibung' })}</th>
                    <th className="py-4 px-4 text-center">{t('unit_price', { defaultValue: 'Einzelpreis' })}</th>
                    <th className="py-4 px-4 text-center">{t('quantity', { defaultValue: 'Menge' })}</th>
                    <th className="py-4 px-4 text-right">{t('total', { defaultValue: 'Gesamt Netto' })}</th>
                    <th className="py-4 px-8 text-center">{t('vat_rate', { defaultValue: 'MwSt.' })}</th>
                    <th className="py-4 px-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {offerLineItems.map((item, idx) => {
                    const isTextPos = !!item.is_text_position;
                    return (
                      <tr key={idx} className="group hover:bg-primary-light transition-all">
                        {/* Col 1: Hash/Index */}
                        <td className="py-6 px-6 text-xs font-black text-slate-600 text-center">{idx + 1}</td>{isTextPos ? (
                          <>
                            {/* Col 2: Text position input spanning multiple columns */}
                            <td className="py-6 px-4" colSpan={4}>
                              <div className="flex flex-col gap-2 w-full">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[10px] bg-accent-orange/10 text-accent-orange px-2 py-0.5 rounded font-black uppercase tracking-wider">
                                    {t("offers:text_position", { defaultValue: 'Freitext' })}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateLineItem(idx, { is_text_position: false })}
                                    className="text-[9px] hover:underline text-slate-400 hover:text-white font-bold uppercase tracking-wider transition-colors"
                                  >
                                    {t("offers:switch_to_standard", { defaultValue: 'Standard-Pos.' })}
                                  </button>
                                </div>
                                <div 
                                  onClick={() => handleOpenDescEditor(idx)}
                                  className={cn(
                                    "w-full max-w-[280px] sm:max-w-[450px] md:max-w-[550px] lg:max-w-[700px] xl:max-w-[850px] bg-primary-dark border-2 rounded-xl px-5 py-3 text-xs font-bold cursor-pointer transition-all text-white flex items-center justify-between gap-3 group/desc h-[46px] select-none min-w-0",
                                    isSubmitAttempted && (!item.description || !item.description.trim())
                                      ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                                      : "border-white/5 hover:border-accent-blue/40 focus:ring-accent-blue/10 focus:border-accent-blue"
                                  )}
                                >
                                  <span className="truncate text-slate-400 font-medium block min-w-0 flex-1">
                                    {item.description ? previewDescription(item.description) : t("offers:text_editor_placeholder", { defaultValue: "Textposition gestalten (WYSIWYG/Spalten)..." })}
                                  </span>
                                  <Edit2 size={12} className="text-slate-400 group-hover/desc:text-accent-blue transition-colors shrink-0" />
                                </div>
                              </div>
                            </td><td className="py-6 px-4"></td> {/* Empty MwSt column */}
                          </>
                        ) : (
                          <>
                            {/* Col 2: Standard position name & desc editor */}
                            <td className="py-6 px-4 min-w-[350px]">
                              <div className="flex flex-col gap-2 w-full">
                                <div 
                                  onClick={() => handleOpenDescEditor(idx)}
                                  className={cn(
                                    "w-full max-w-[250px] sm:max-w-[350px] md:max-w-[400px] lg:max-w-[500px] bg-primary-dark border-2 rounded-xl px-5 py-3 text-xs font-bold cursor-pointer transition-all text-white flex items-center justify-between gap-3 group/desc h-[46px] select-none min-w-0",
                                    isSubmitAttempted && (!item.description || !item.description.trim())
                                      ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                                      : "border-white/5 hover:border-accent-blue/40 focus:ring-accent-blue/10 focus:border-accent-blue"
                                  )}
                                >
                                  <span className="truncate text-slate-400 font-medium block min-w-0 flex-1">
                                    {item.description ? previewDescription(item.description) : t("offers:desc_editor_placeholder", { defaultValue: "Beschreibung gestalten (WYSIWYG/Spalten)..." })}
                                  </span>
                                  <Edit2 size={12} className="text-slate-400 group-hover/desc:text-accent-blue transition-colors shrink-0" />
                                </div>
                              </div>
                            </td>
                            
                            {/* Col 3: Price */}
                            <td className="py-6 px-4">
                              <div className="flex justify-center">
                                <input 
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={isNaN(item.unit_price) ? '' : item.unit_price}
                                  onChange={(e) => handleUpdateLineItem(idx, { unit_price: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className={cn(
                                    "w-36 bg-primary-dark border-2 rounded-xl px-5 py-3 text-sm text-right focus:outline-none focus:ring-4 transition-all font-mono font-bold text-white",
                                    isSubmitAttempted && (isNaN(item.unit_price) || item.unit_price < 0)
                                      ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                                      : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                                  )}
                                />
                              </div>
                            </td>
                            
                            {/* Col 4: Quantity & Unit */}
                            <td className="py-6 px-4">
                              <div className="flex items-center justify-center gap-2">
                                <input 
                                  type="number"
                                  min="0"
                                  value={isNaN(item.quantity) ? '' : item.quantity}
                                  onChange={(e) => handleUpdateLineItem(idx, { quantity: Math.max(0, parseFloat(e.target.value) || 0) })}
                                  className={cn(
                                    "w-16 bg-primary-dark border-2 rounded-xl px-2 py-3 text-sm text-center focus:outline-none focus:ring-4 transition-all font-mono font-bold text-white",
                                    isSubmitAttempted && (isNaN(item.quantity) || item.quantity <= 0)
                                      ? "border-red-500/50 focus:ring-red-500/10 focus:border-red-500"
                                      : "border-white/5 focus:ring-accent-blue/10 focus:border-accent-blue"
                                  )}
                                />
                                <select
                                  value={item.unit_code || 'PCE'}
                                  onChange={(e) => handleUpdateLineItem(idx, { unit_code: e.target.value })}
                                  className="bg-primary-dark border border-white/5 rounded-xl px-2 py-3 text-xs font-black text-slate-400 focus:outline-none tracking-wider min-w-[75px]"
                                >
                                  <option value="PCE">{t("invoices:units.H87") || "Stk."}</option>
                                  <option value="HUR">{t("invoices:units.HUR") || "Std."}</option>
                                  <option value="MON">{t("invoices:units.MON") || "Monate"}</option>
                                  <option value="DAY">{t("invoices:units.DAY") || "Tage"}</option>
                                  <option value="C62">{t("invoices:units.C62") || "Stück"}</option>
                                  <option value="SET">{t("invoices:units.SET") || "Set"}</option>
                                  <option value="LS">{t("invoices:units.LS") || "Pausch."}</option>
                                </select>
                              </div>
                            </td>
                            
                            {/* Col 5: Total Net */}
                            <td className="py-6 px-4 text-right">
                              <div className="text-sm font-black text-neutral-white font-mono tracking-tighter">
                                {new Intl.NumberFormat("de-DE", { style: "currency", currency: currencyCode }).format(item.total_net)}
                              </div>
                            </td>
                            
                            {/* Col 6: VAT Rate */}
                            <td className="py-6 px-4">
                              <div className="flex justify-center">
                                <select 
                                  value={item.vat_rate !== undefined ? item.vat_rate : 19}
                                  onChange={(e) => handleUpdateLineItem(idx, { vat_rate: parseInt(e.target.value) || 0 })}
                                  className="bg-primary-dark border border-white/5 rounded-xl px-4 py-2 text-[10px] font-black text-slate-400 focus:outline-none tracking-widest appearance-none text-center min-w-[80px]"
                                >
                                  <option value="19">19%</option>
                                  <option value="7">7%</option>
                                  <option value="0">0%</option>
                                </select>
                              </div>
                            </td>
                          </>
                        )}<td className="py-6 px-2">
                          <div className="flex items-center gap-2">
                            {!isTextPos && (
                              <button
                                type="button"
                                onClick={() => handleUpdateLineItem(idx, { is_text_position: true })}
                                className="px-2 py-1 hover:bg-white/5 text-[9px] font-bold text-slate-400 hover:text-white rounded border border-white/5 uppercase transition-all opacity-0 group-hover:opacity-100 whitespace-nowrap"
                              >
                                {t("offers:switch_to_text")}
                              </button>
                            )}
                            <button 
                              type="button" 
                              disabled={offerLineItems.length <= 1}
                              onClick={() => handleRemoveLineItem(idx)}
                              className="p-3 text-slate-600 hover:text-accent-orange hover:bg-white/5 rounded-xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-0"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Add Position Controls below table */}
            <div className="flex flex-wrap items-center justify-center gap-4 mx-auto w-fit">
              <button
                type="button"
                onClick={handleAddLineItem}
                className="px-8 py-3 rounded-xl border-2 border-dashed border-white/5 text-[10px] font-black text-slate-500 hover:border-accent-orange hover:text-accent-orange transition-all flex items-center justify-center gap-3 group"
              >
                <Plus size={16} className="group-hover:rotate-90 transition-transform text-accent-orange" />
                {t("offers:add_standard_item", { defaultValue: 'Standard-Pos. hinzufügen' })}
              </button>
              <button
                type="button"
                onClick={handleAddTextLineItem}
                className="px-8 py-3 rounded-xl border-2 border-dashed border-white/5 text-[10px] font-black text-slate-500 hover:border-accent-orange hover:text-accent-orange transition-all flex items-center justify-center gap-3 group"
              >
                <Plus size={16} className="group-hover:rotate-90 transition-transform text-accent-orange" />
                {t("offers:add_text_item", { defaultValue: 'Text-Pos. hinzufügen' })}
              </button>
              {offerItemTemplates.length > 0 && (
                <div className="relative">
                  {isItemTemplateDropdownOpen && (
                    <div 
                      className="fixed inset-0 z-40 cursor-default" 
                      onClick={() => setIsItemTemplateDropdownOpen(false)} 
                    />
                  )}
                  <div className="relative z-50">
                    <button
                      type="button"
                      onClick={() => {
                        setIsItemTemplateDropdownOpen(!isItemTemplateDropdownOpen);
                      }}
                      className="appearance-none bg-primary-dark border border-white/10 rounded-xl px-6 py-3 text-[10px] font-black text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue transition-all uppercase tracking-wider cursor-pointer flex items-center gap-2"
                    >
                      <span>{t('dialog.select_from_template', { defaultValue: 'Vorlage einfügen' })}</span>
                      <ChevronDown size={14} className="text-slate-400 shrink-0" />
                    </button>

                    <AnimatePresence>
                      {isItemTemplateDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 10 }}
                          className="absolute z-50 bottom-full mb-2 right-0 w-80 bg-primary-light border border-white/10 shadow-2xl rounded-xl overflow-hidden max-h-60 flex flex-col"
                        >
                          <div className="p-2 border-b border-white/5 bg-primary-dark">
                            <input
                              type="text"
                              placeholder={t("offers:search_template_placeholder", { defaultValue: "Vorlage suchen..." })}
                              value={itemTemplateSearchQuery}
                              onChange={(e) => setItemTemplateSearchQuery(e.target.value)}
                              className="w-full bg-primary-light border border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange"
                              autoFocus
                            />
                          </div>
                          <div className="overflow-y-auto flex-1 py-1 divide-y divide-white/5 max-h-44">
                            {filteredOfferItemTemplatesForSelect.map((tmpl) => (
                              <button
                                key={tmpl.id_uuid}
                                type="button"
                                onClick={() => {
                                  handleAddLineItemFromTemplate(tmpl);
                                  setItemTemplateSearchQuery("");
                                  setIsItemTemplateDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs text-slate-300 hover:bg-primary-dark hover:text-white transition-colors flex flex-col gap-0.5"
                              >
                                <span className="font-bold text-white text-left">{tmpl.template_name_text}</span>
                                <span className="text-[10px] text-slate-500 font-mono text-left">
                                  {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(tmpl.unit_price)}
                                </span>
                              </button>
                            ))}
                            {filteredOfferItemTemplatesForSelect.length === 0 && (
                              <div className="px-4 py-3 text-xs text-slate-500 italic text-center">
                                {t("offers:no_templates_found", { defaultValue: "Keine Vorlagen gefunden" })}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Form Totals Column */}
          <div className="flex flex-col items-end pt-10 mt-10 border-t border-white/5 space-y-2">
             <div className="flex items-center gap-10">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] font-display">
                  {isVatInclusive ? t("offers:total_amount_label") : t("offers:sum_net")}
                </span>
                <span className="font-black text-neutral-white text-5xl tracking-tighter">
                  {new Intl.NumberFormat("de-DE", { style: "currency", currency: currencyCode }).format(isVatInclusive ? formTotals.gross : formTotals.net)}
                </span>
             </div>
          </div>
          </fieldset>

          {/* Submit Actions */}
          <div className="flex justify-end gap-5 pt-12 mt-12 flex-wrap">
            <button
              type="button"
              onClick={() => setIsOfferDialogOpen(false)}
              className="bg-primary-dark border-2 border-slate-600 text-slate-300 px-8 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-white/5 transition-all active:scale-95"
            >
              {isReadOnly ? t("common:close", { defaultValue: "Schließen" }) : t("common:cancel")}
            </button>
            {!isReadOnly && (
              <button
                type="submit"
                disabled={createOfferMutation.isPending || updateOfferMutation.isPending}
                className="bg-accent-orange text-white px-10 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-2xl shadow-accent-orange/30 disabled:opacity-50 active:scale-95 flex items-center gap-2"
              >
                {(createOfferMutation.isPending || updateOfferMutation.isPending) && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {t("common:save")}
              </button>
            )}
            {isReadOnly && (
              <div className={cn(
                "px-4 py-2 border rounded-xl text-xs font-bold uppercase tracking-wider flex items-center gap-1.5",
                editingOffer?.offer_status === "accepted"
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              )}>
                <Lock size={12} />
                {editingOffer?.offer_status === "accepted"
                  ? t("offers:immutable_accepted", { defaultValue: "SCHREIBGESCHÜTZT (ANGENOMMEN)" })
                  : t("offers:immutable_declined", { defaultValue: "SCHREIBGESCHÜTZT (ABGELEHNT)" })
                }
              </div>
            )}
          </div>
        </form>
      </Dialog>
 
      {/* Shared Full Contact Form Dialog */}
      <ContactFormDialog
        isOpen={isNewContactDialogOpen}
        onClose={() => setIsNewContactDialogOpen(false)}
        onSuccess={(id_uuid) => {
          setSelectedContactId(id_uuid);
        }}
      />

      {/* Shared Full Company Form Dialog */}
      <CompanyFormDialog
        isOpen={isNewCompanyDialogOpen}
        onClose={() => setIsNewCompanyDialogOpen(false)}
        onSuccess={(id_uuid) => {
          setSelectedCompanyId(id_uuid);
        }}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setOfferToDelete(null);
        }}
        title={t('offers:delete_modal_title', { defaultValue: 'Angebot löschen' })}
        size="md"
      >
        <div className="space-y-6 pt-4 text-left">
          <div className="flex items-start gap-4 bg-red-500/10 p-5 rounded-xl border border-red-500/20">
            <div className="text-red-500 mt-0.5 shrink-0">
              <AlertCircle size={24} />
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-black text-red-500 uppercase tracking-wider">
                {t('offers:delete_modal_warning_title', { defaultValue: 'Achtung: Unwiderruflicher Schritt' })}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed font-medium font-sans">
                {t('offers:confirm_delete_offer', { defaultValue: 'Möchten Sie dieses Angebot wirklich löschen?' })}
                {offerToDelete?.title && (
                  <>
                    {" "}<span className="font-mono text-accent-orange font-bold font-black">{offerToDelete.title}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-medium font-sans">
                {t('offers:delete_modal_warning_desc', { defaultValue: 'Dadurch wird der Datensatz dauerhaft aus der Datenbank gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.' })}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => {
                setIsDeleteConfirmOpen(false);
                setOfferToDelete(null);
              }}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-905 border border-slate-800"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
            <button
              type="button"
              disabled={deleteOfferMutation.isPending}
              onClick={() => {
                if (offerToDelete) {
                  deleteOfferMutation.mutate({ id_uuid: offerToDelete.id_uuid });
                }
              }}
              className="bg-red-600 text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-red-700 transition-all shadow-xl shadow-red-600/10 active:scale-95 flex items-center gap-2"
            >
              {deleteOfferMutation.isPending && (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {t('offers:delete_modal_confirm_btn', { defaultValue: 'Unwiderruflich Löschen' })}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Mail Dialog */}
      {mailTarget && (
        <MailDialog
          isOpen={!!mailTarget}
          onClose={() => setMailTarget(null)}
          recipientEmail={mailTarget.email}
          recipientName={mailTarget.name}
          offer={mailTarget.offer}
          associatedType="companies"
          associatedId={mailTarget.id_uuid}
          associatedName={mailTarget.name}
        />
      )}

      {/* PROFESSIONAL PREVIEW DIALOG */}
      <Dialog
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={t('offers:preview_mode', { defaultValue: 'Angebot Vorschau' })}
        size="full"
      >
        {selectedOffer && (() => {
          const rawItems = selectedOffer.line_items || [];
          
          // Helper to estimate height of a line item for dynamic pagination
          const estimateItemHeight = (item: OfferLineItem) => {
            const desc = item.description || "";
            
            const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
            const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
            
            const cleanText = (html: string) => {
              return html
                .replace(/<\/?[^>]+(>|$)/g, "") // strip html
                .replace(/&nbsp;/gi, " ")
                .trim();
            };

            let maxLines = 1;
            if (leftMatch || rightMatch) {
              const leftClean = cleanText(leftMatch ? leftMatch[1] : "");
              const rightClean = cleanText(rightMatch ? rightMatch[1] : "");
              
              const leftLines = leftClean.split("\n").reduce((acc: number, line: string) => acc + Math.max(1, Math.ceil(line.length / 35)), 0);
              const rightLines = rightClean.split("\n").reduce((acc: number, line: string) => acc + Math.max(1, Math.ceil(line.length / 35)), 0);
              maxLines = Math.max(leftLines, rightLines, 1);
            } else {
              const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
              const singleClean = cleanText(singleMatch ? singleMatch[1] : desc);
              
              maxLines = singleClean.split("\n").reduce((acc: number, line: string) => acc + Math.max(1, Math.ceil(line.length / 45)), 0);
            }
            
            return 12 + (maxLines - 1) * 4.5;
          };

          // Pagination helper: matches PDF page splitting
          const getOfferPages = (items: OfferLineItem[]) => {
            if (items.length === 0) return [[]];

            const cleanIntro = (selectedOffer.introductory_text || "").replace(/<\/?[^>]+(>|$)/g, "").trim();
            const introLines = cleanIntro.split("\n").reduce((acc: number, line: string) => acc + Math.max(1, Math.ceil(line.length / 80)), 0);
            const introHeight = introLines * 5; // mm

            const cleanClosing = (selectedOffer.closing_text || "").replace(/<\/?[^>]+(>|$)/g, "").trim();
            const closingLines = cleanClosing.split("\n").reduce((acc: number, line: string) => acc + Math.max(1, Math.ceil(line.length / 80)), 0);
            const closingHeight = closingLines * 5; // mm

            // Define vertical budgets (in mm)
            const firstPageBaseBudget = 115 - introHeight;
            const otherPageBaseBudget = 190;
            const totalsAndClosingHeight = 35 + closingHeight;

            const pagesList: OfferLineItem[][] = [];
            let currentPageItems: OfferLineItem[] = [];
            let currentHeight = 0;
            let isFirstPage = true;

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const itemHeight = estimateItemHeight(item);

              const isLastItem = i === items.length - 1;
              let currentBudget = isFirstPage ? firstPageBaseBudget : otherPageBaseBudget;
              
              if (isLastItem) {
                currentBudget -= totalsAndClosingHeight;
              }

              currentBudget = Math.max(30, currentBudget);

              if (currentHeight + itemHeight > currentBudget && currentPageItems.length > 0) {
                pagesList.push(currentPageItems);
                currentPageItems = [item];
                currentHeight = itemHeight;
                isFirstPage = false;
              } else {
                currentPageItems.push(item);
                currentHeight += itemHeight;
              }
            }

            if (currentPageItems.length > 0) {
              pagesList.push(currentPageItems);
            }

            return pagesList;
          };

          const offerPages = getOfferPages(rawItems);
          const totalPages = offerPages.length;

          return (
            <div className="space-y-6 flex flex-col items-center p-6 bg-slate-100 border border-slate-200 rounded-2xl overflow-auto w-full max-h-[85vh]">
              <div className="space-y-6 flex flex-col items-center w-full">
                {offerPages.map((pageItems, pageIdx) => {
                  const isFirstPage = pageIdx === 0;
                  const isLastPage = pageIdx === totalPages - 1;

                  return (
                    <div key={pageIdx} className="bg-white text-slate-950 p-[17.6mm] relative offer-preview font-sans w-[210mm] min-h-[297mm] h-auto border border-slate-200 flex flex-col box-border shadow-md select-none flex-shrink-0">
                      {/* Watermark Draft */}
                      {(() => {
                        const isDraftStatus = selectedOffer.offer_status === 'draft' || selectedOffer.offer_status === 'not_sent';
                        if (!isDraftStatus) return null;
                        return (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10 overflow-hidden opacity-[0.06] rotate-[-45deg]">
                            <span className="text-[120px] font-black tracking-[0.1em] text-slate-800 uppercase">
                              {t('offers:draft', { defaultValue: 'ENTWURF' })}
                            </span>
                          </div>
                        );
                      })()}

                      {/* Running Header on Page 2+ */}
                      {!isFirstPage && (
                        <div className="flex justify-between items-center text-[8pt] font-bold text-slate-500 uppercase tracking-wider mb-[4mm] border-b border-slate-200 pb-[1.5mm]">
                          <span>{t('offers:offer_single', { defaultValue: 'ANGEBOT' })} {selectedOffer.offer_number || ""}</span>
                          <span>{t('invoices:preview.page', { defaultValue: 'Seite' })} {pageIdx + 1}</span>
                        </div>
                      )}

                      {/* Professional Offer Content Header (Only on Page 1) */}
                      {isFirstPage && (
                        <div className="flex justify-between items-start mb-[10mm]">
                          <div>
                            {myCompany?.logo_url && (
                              <img 
                                src={myCompany.logo_url} 
                                alt="Issuer Logo" 
                                className="max-w-[70.5mm] max-h-[35.3mm] object-contain flex-shrink-0 select-none"
                                referrerPolicy="no-referrer"
                              />
                            )}
                          </div>
                          <div className="flex flex-col justify-start text-right items-end">
                            <div className="text-[11pt] font-bold text-slate-900 leading-tight">
                              {myCompany?.full_legal_name || t('common:organization_name_default', { defaultValue: 'LOUIS Systems GmbH' })}
                            </div>
                            <div className="mt-[2mm] text-[10pt] text-slate-500 font-normal space-y-[0.5mm] leading-snug">
                              <div>
                                {myCompany?.street || 'Friedrichstr.'}{' '}
                                {myCompany?.house_number || '100'}
                              </div>
                              <div>
                                {myCompany?.postal_code || '10117'}{' '}
                                {myCompany?.city || 'Berlin'}
                              </div>
                              <div>{myCompany?.country_code === 'DE' ? 'Deutschland' : (myCompany?.country_code || 'DE')}</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Recipient & Info Bar (Only on Page 1) */}
                      {isFirstPage && (
                        <div className="grid grid-cols-2 gap-[15mm] mb-[10mm] items-start font-sans text-left">
                          <div>
                            {/* Small sender address line above recipient name */}
                            <div className="text-[7pt] text-slate-400 font-normal tracking-tight mb-[2mm] uppercase select-none border-b border-slate-100 pb-[1mm]">
                              {(myCompany?.full_legal_name || 'LOUIS Systems GmbH')} • {(myCompany?.street || 'Friedrichstr.')} {(myCompany?.house_number || '100')} • {(myCompany?.postal_code || '10117')} {(myCompany?.city || 'Berlin')}
                            </div>
                            
                            {/* Firmenname / Recipient */}
                            <div className="text-[11pt] font-bold text-slate-900 leading-tight">
                              {(() => {
                                const comp = companies.find(c => c.id_uuid === selectedOffer.associated_company_id);
                                const cont = contacts.find(c => c.id_uuid === selectedOffer.associated_contact_id);
                                return comp?.full_legal_name || 
                                       (cont ? `${cont.first_name || ""} ${cont.last_name || ""}`.trim() : "") || 
                                       t("offers:free_offer", { defaultValue: 'Freies Angebot' });
                              })()}
                            </div>
                            
                            {/* Ansprechpartner */}
                            {(() => {
                              const cont = contacts.find(c => c.id_uuid === selectedOffer.associated_contact_id);
                              if (!cont) return null;
                              return (
                                <div className="text-[10pt] text-slate-500 font-bold mt-[1mm]">
                                  {t('invoices:preview.attn', { defaultValue: 'z.Hd.:' })} {cont.first_name || ""} {cont.last_name || ""}
                                </div>
                              );
                            })()}

                            {/* Adresse */}
                            {(() => {
                              const comp = companies.find(c => c.id_uuid === selectedOffer.associated_company_id);
                              const cont = contacts.find(c => c.id_uuid === selectedOffer.associated_contact_id);
                              const street = comp?.street || cont?.street;
                              const house_number = comp?.house_number || cont?.house_number;
                              const postal_code = comp?.postal_code || cont?.postal_code;
                              const city = comp?.city || cont?.city;
                              const country_code = comp?.country_code || 'DE';

                              if (street || city) {
                                return (
                                  <div className="text-[10pt] text-slate-500 mt-[2mm] space-y-[0.5mm] font-normal leading-relaxed">
                                    <div>{street} {house_number || ''}</div>
                                    <div>{postal_code} {city}</div>
                                    <div>{country_code === 'DE' ? t('common:countries.de', { defaultValue: 'Deutschland' }) : country_code}</div>
                                  </div>
                                );
                              }
                              return (
                                <div className="text-[10pt] text-slate-500 mt-[2mm] space-y-[0.5mm] font-normal leading-relaxed">
                                  <div>{t('invoices:preview.fallback_recipient_street', { defaultValue: 'Beispielstraße 42' })}</div>
                                  <div>{t('invoices:preview.fallback_recipient_city', { defaultValue: '12345 Musterstadt' })}</div>
                                  <div>{t('invoices:preview.fallback_recipient_country', { defaultValue: 'Deutschland' })}</div>
                                </div>
                              );
                            })()}
                          </div>

                          <div>
                            <h1 className="text-[12pt] font-bold uppercase tracking-wider text-slate-900 mb-[2mm] text-right">
                              {t('offers:offer_single', { defaultValue: 'ANGEBOT' })}
                            </h1>
                            <div className="bg-slate-50 py-[1.5mm] px-[4mm] rounded-none border border-slate-200 flex flex-col justify-between font-sans w-[215pt] h-auto min-h-[85pt] box-border ml-auto">
                              <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                                <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('offers:offer_number')}:</span>
                                <span className="text-[8pt] font-bold text-slate-900">{selectedOffer.offer_number}</span>
                              </div>
                              <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                                <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('offers:issue_date')}:</span>
                                <span className="text-[8pt] font-bold text-slate-900">{new Date(selectedOffer.issue_date).toLocaleDateString(i18n.language)}</span>
                              </div>
                              <div className="flex justify-between items-center py-[1mm]">
                                <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('offers:valid_until')}:</span>
                                <span className="text-[8pt] font-bold text-slate-900">{new Date(selectedOffer.valid_until).toLocaleDateString(i18n.language)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Offer Title (Only on Page 1) */}
                      {isFirstPage && (
                        <div className="mb-[4mm] text-[11pt] font-bold text-slate-900 text-left">
                          {selectedOffer.title}
                        </div>
                      )}

                      {/* Introductory Text (Only on Page 1) */}
                      {isFirstPage && selectedOffer.introductory_text && (
                        <div 
                          className="mb-[5mm] text-[9pt] font-normal text-slate-900 leading-normal w-full text-left whitespace-pre-line"
                          dangerouslySetInnerHTML={{
                            __html: (() => {
                              const comp = companies.find(c => c.id_uuid === selectedOffer.associated_company_id);
                              const cont = contacts.find(c => c.id_uuid === selectedOffer.associated_contact_id);
                              const companyName = comp?.full_legal_name || "Neukunde";
                              const responsiblePerson = cont 
                                ? `${cont.first_name ? cont.first_name + ' ' : ''}${cont.last_name}`
                                : (comp?.responsible_person || "");
                              
                              const formatDate = (dateStr: string) => {
                                if (!dateStr) return "";
                                try {
                                  const d = new Date(dateStr);
                                  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
                                } catch {
                                  return dateStr;
                                }
                              };

                              const formatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: selectedOffer.currency_code || "EUR" });

                              return selectedOffer.introductory_text
                                .replace(/\{\{company_name\}\}/g, companyName)
                                .replace(/\{\{responsible_person\}\}/g, responsiblePerson)
                                .replace(/\{\{offer_number\}\}/g, selectedOffer.offer_number)
                                .replace(/\{\{valid_until\}\}/g, formatDate(selectedOffer.valid_until))
                                .replace(/\{\{total_net\}\}/g, formatter.format(selectedOffer.total_net_amount))
                                .replace(/\{\{total_gross\}\}/g, formatter.format(selectedOffer.total_gross_amount))
                                .replace(/\{\{my_company_name\}\}/g, myCompany?.full_legal_name || "LOUIS Systems GmbH");
                            })()
                          }}
                        />
                      )}

                      {/* Table for this Page's items */}
                      {pageItems.length > 0 && (
                        <div className="mb-[5mm]">
                          <table className="w-full text-left table-fixed">
                            <thead>
                              <tr className="bg-slate-50 border border-slate-200">
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-left w-[6%]">{t('offers:pos')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-left w-[36%]">{t('offers:item_name')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[7%]">{t('offers:quantity')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[8%]">{t('offers:unit')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[15%]">{t('offers:unit_price')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-center w-[10%] whitespace-nowrap">{t('offers:vat_rate')}</th>
                                <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[18%]">{t('offers:total_net')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pageItems.map((item: OfferLineItem, i: number) => {
                                const isTextPos = !!item.is_text_position;
                                // Calculate overall index
                                const overallIndex = isFirstPage ? i : 6 + (pageIdx - 1) * 10 + i;
                                return (
                                  <tr key={overallIndex} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors break-inside-avoid">
                                    <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-500 text-left w-[6%] align-top">{item.position || (overallIndex + 1)}</td>
                                    <td 
                                      className="py-2.5 px-3 text-[9pt] text-slate-900 text-left align-top whitespace-pre-line"
                                      colSpan={isTextPos ? 6 : 1}
                                    >
                                      {item.description ? (
                                        renderDescriptionInPreview(item.description)
                                      ) : (
                                        <div className="font-bold text-slate-900">Angebotsposition</div>
                                      )}
                                    </td>{!isTextPos && (
                                      <>
                                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[7%] align-top">
                                          {item.quantity}
                                        </td>
                                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[8%] align-top">
                                          {item.unit_code === "HUR" ? t("invoices:units.HUR", { defaultValue: "Std." }) : (item.unit_code === "PCE" ? t("invoices:units.PCE", { defaultValue: "Stk." }) : item.unit_code)}
                                        </td>
                                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[15%] align-top">
                                          {formatCurrency(item.unit_price, selectedOffer.currency_code)}
                                        </td>
                                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-500 text-center w-[10%] align-top">
                                          {`${item.vat_rate}%`}
                                        </td>
                                        <td className="py-2.5 px-3 text-[9pt] font-bold text-slate-900 text-right w-[18%] align-top">
                                          {formatCurrency(item.total_net, selectedOffer.currency_code)}
                                        </td>
                                      </>
                                    )}</tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Totals & Closing (Only on Last Page) */}
                      {isLastPage && (
                        <>
                          {/* Totals */}
                          <div className="flex justify-end mb-[8mm]">
                            <div className="w-[80mm] space-y-[2mm]">
                              <div className="flex justify-between text-[8pt] font-bold text-slate-500 uppercase tracking-wider px-2">
                                <span>{t('offers:sum_net')}:</span>
                                <span className="text-[9pt] font-normal text-slate-900">{formatCurrency(selectedOffer.total_net_amount, selectedOffer.currency_code)}</span>
                              </div>
                              {selectedOfferVatGroups.length > 0 ? (
                                selectedOfferVatGroups.map((g) => (
                                  <div key={g.vatRate} className="flex justify-between text-[8pt] font-bold text-slate-500 uppercase tracking-wider px-2">
                                    <span>{t('offers:plus_vat')} ({g.vatRate.toFixed(2)}%):</span>
                                    <span className="text-[9pt] font-normal text-slate-900">{formatCurrency(g.vatAmount, selectedOffer.currency_code)}</span>
                                  </div>
                                ))
                              ) : (
                                <div className="flex justify-between text-[8pt] font-bold text-slate-500 uppercase tracking-wider px-2">
                                  <span>{t('offers:plus_vat')}:</span>
                                  <span className="text-[9pt] font-normal text-slate-900">{formatCurrency(selectedOffer.total_vat_amount, selectedOffer.currency_code)}</span>
                                </div>
                              )}
                              <div className="bg-slate-50 border border-slate-200 px-2 py-[2mm] rounded-none flex justify-between items-center h-[22pt] box-border">
                                <span className="text-[9pt] font-bold text-slate-900 uppercase tracking-wider">{t('offers:total_amount_label')}:</span>
                                <span className="text-[9pt] font-bold text-slate-900 uppercase tracking-wider">{formatCurrency(selectedOffer.total_gross_amount, selectedOffer.currency_code)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Closing Text */}
                          {selectedOffer.closing_text && (
                            <div 
                              className="mb-[5mm] text-[9pt] font-normal text-slate-900 leading-normal w-full text-left whitespace-pre-line"
                              dangerouslySetInnerHTML={{
                                __html: (() => {
                                  const comp = companies.find(c => c.id_uuid === selectedOffer.associated_company_id);
                                  const cont = contacts.find(c => c.id_uuid === selectedOffer.associated_contact_id);
                                  const companyName = comp?.full_legal_name || "Neukunde";
                                  const responsiblePerson = cont 
                                    ? `${cont.first_name ? cont.first_name + ' ' : ''}${cont.last_name}`
                                    : (comp?.responsible_person || "");
                                  
                                  const formatDate = (dateStr: string) => {
                                    if (!dateStr) return "";
                                    try {
                                      const d = new Date(dateStr);
                                      return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
                                    } catch {
                                      return dateStr;
                                    }
                                  };

                                  const formatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: selectedOffer.currency_code || "EUR" });

                                  return selectedOffer.closing_text
                                    .replace(/\{\{company_name\}\}/g, companyName)
                                    .replace(/\{\{responsible_person\}\}/g, responsiblePerson)
                                    .replace(/\{\{offer_number\}\}/g, selectedOffer.offer_number)
                                    .replace(/\{\{valid_until\}\}/g, formatDate(selectedOffer.valid_until))
                                    .replace(/\{\{total_net\}\}/g, formatter.format(selectedOffer.total_net_amount))
                                    .replace(/\{\{total_gross\}\}/g, formatter.format(selectedOffer.total_gross_amount))
                                    .replace(/\{\{my_company_name\}\}/g, myCompany?.full_legal_name || "LOUIS Systems GmbH");
                                })()
                              }}
                            />
                          )}
                        </>
                      )}

                      {/* Payment Footer (At bottom of every page) */}
                      <div className="mt-auto border-t border-slate-200 pt-4 pb-2 text-[7pt] text-slate-500 font-sans tracking-tight leading-relaxed flex justify-between items-start text-left">
                        {/* Column 1 */}
                        <div className="w-[180pt]">
                          <div className="font-bold text-slate-600 uppercase mb-1">
                            {t('invoices:preview.tax_info_label', { defaultValue: 'STEUERNUMMER & UST-IDNR.' })}
                          </div>
                          <div>
                            {myCompany?.tax_vat_id && (
                              <div>{t('invoices:preview.vat_id_prefix', { defaultValue: 'USt-IdNr.:' })} {myCompany.tax_vat_id}</div>
                            )}
                            {myCompany?.tax_number && (
                              <div>{t('invoices:preview.tax_number_prefix', { defaultValue: 'Steuernummer:' })} {myCompany.tax_number}</div>
                            )}
                            {!myCompany?.tax_vat_id && !myCompany?.tax_number && (
                              <div>{t('invoices:preview.vat_id_prefix', { defaultValue: 'USt-IdNr.:' })} DE999999999</div>
                            )}
                          </div>
                        </div>
                        
                        {/* Column 2 */}
                        <div className="w-[180pt]">
                          <div className="font-bold text-slate-600 uppercase mb-1">{t('invoices:preview.bank_details', { defaultValue: 'BANKVERBINDUNG' })}</div>
                          <div>
                            <div>IBAN: {myCompany?.iban || 'DE89 1005 0000 0123 4567 89'}</div>
                            <div>BIC: {myCompany?.bic_swift || 'WELADED1100'} • Bank: {myCompany?.bank_name || 'Standard Bank'}</div>
                          </div>
                        </div>

                        {/* Column 3 */}
                        <div className="text-right flex flex-col items-end justify-between h-full">
                          <div>
                            <div className="font-bold text-slate-600 uppercase mb-1">{t('invoices:preview.support', { defaultValue: 'SUPPORT' })}</div>
                            <div>
                              <div>{myCompany?.email_address || 'billing@musterfirma.test'}</div>
                              <div>{myCompany?.phone_number || '+49 30 123 456 78'}</div>
                              <div>{myCompany?.website || 'www.louis-crm.de'}</div>
                            </div>
                          </div>
                          <div className="text-[7pt] text-slate-400 mt-2">
                            {pageIdx + 1} / {totalPages}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex justify-center gap-3 pt-6 border-t border-slate-800 w-full max-w-[210mm]">
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="px-8 py-3 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
                >
                  {t('common:close', { defaultValue: 'Schließen' })}
                </button>
                <button 
                  onClick={() => {
                    if (selectedOffer) {
                      generatePdfMutation.mutate({ id_uuid: selectedOffer.id_uuid });
                    }
                  }}
                  disabled={generatePdfMutation.isPending}
                  className="flex items-center gap-2 bg-teal-600 text-white px-10 py-3 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-teal-500 transition-all shadow-xl shadow-teal-600/20 active:scale-95 disabled:opacity-50"
                >
                  {generatePdfMutation.isPending ? (
                     <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                     <Download size={14} />
                  )}
                  {t('offers:generate_pdf', { defaultValue: 'PDF GENERIEREN' })}
                </button>
              </div>
            </div>
          );
        })()}
      </Dialog>

      <BatchExportOffersDialog
        isOpen={isBatchExportOpen}
        onClose={() => setIsBatchExportOpen(false)}
        offers={offers}
        companies={companies}
        contacts={contacts}
      />

      <Dialog
        isOpen={activeItemDescEditIdx !== null}
        onClose={() => setActiveItemDescEditIdx(null)}
        title={t('offers:item_desc_editor_title', { defaultValue: 'Position-Beschreibung gestalten' })}
      >
        <div className="space-y-6 pt-4 text-left">
          {/* Formatting Toolbar */}
          <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 rounded-t-xl">
            <button
              type="button"
              onClick={() => handleExecCmd('bold')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('offers:editor_bold', { defaultValue: 'Fett' })}
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleExecCmd('italic')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('offers:editor_italic', { defaultValue: 'Kursiv' })}
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleExecCmd('underline')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('offers:editor_underline', { defaultValue: 'Unterstrichen' })}
            >
              <Underline size={13} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => handleExecCmd('insertUnorderedList')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('offers:editor_list', { defaultValue: 'Liste' })}
            >
              <List size={13} />
            </button>
            
            <button
              type="button"
              onClick={() => {
                const currentText = singleEditorRef.current ? singleEditorRef.current.innerHTML : '';
                setAiFieldId('item_desc_single');
                setAiContext('Positionsbeschreibung Angebot');
                setAiValue(currentText);
              }}
              className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
              title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
            >
              <Sparkles size={11} className="animate-pulse" />
              {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || 'Mit KI Generieren'}
            </button>
          </div>

          <div className="space-y-2 pb-4">
            <div className="flex justify-between items-center ml-2 h-6">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] font-display">{t('offers:editor_desc_text', { defaultValue: 'Beschreibungstext' })}</span>
            </div>
            <div 
              key={activeItemDescEditIdx + "-single"}
              ref={singleEditorRef}
              contentEditable
              className="w-full bg-primary-dark/60 border border-white/10 rounded-b-xl px-5 py-5 text-white min-h-[160px] max-h-[250px] overflow-y-auto focus:outline-none focus:border-accent-orange transition-all"
              style={{ outline: 'none' }}
              dangerouslySetInnerHTML={{ __html: initialSingleHtml }}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setActiveItemDescEditIdx(null)}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
            >
              {t('common:cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveDescEditor}
              className="bg-accent-orange text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-xl shadow-accent-orange/10 active:scale-95"
            >
              {t('common:apply')}
            </button>
          </div>
        </div>
      </Dialog>

      <AiTextGeneratorDialog
        isOpen={aiFieldId !== null}
        onClose={() => setAiFieldId(null)}
        fieldId={aiFieldId || ''}
        fieldValue={aiValue}
        context={aiContext}
        onAccept={(newValue) => {
          if (aiFieldId === 'introductory_text') {
            updateIntroText(newValue);
          } else if (aiFieldId === 'closing_text') {
            updateClosingText(newValue);
          } else if (aiFieldId === 'item_desc_single') {
            if (singleEditorRef.current) singleEditorRef.current.innerHTML = newValue;
          }
          setAiFieldId(null);
        }}
      />
    </div>
  );
};
