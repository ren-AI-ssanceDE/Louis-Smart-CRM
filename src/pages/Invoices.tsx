import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, Plus, Download, Tag, Calendar, MoreVertical, 
  Building2, ArrowUpRight, X, Trash2, CheckCircle2, 
  Eye, FileCheck, Info, ChevronDown, Edit2, Mail,
  Search, ChevronLeft, ChevronRight, Bold, Italic, Underline, List, Sparkles, Columns
} from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { TFunction } from 'i18next';
import { toast } from 'sonner';
import { Invoice, Company, Contact } from '../types';
import { trpc } from '../lib/trpc';
import { formatCurrency, calculateInvoiceTotals, calculateLineItemNet, calculateLineItemVat, LineItem } from '../lib/math';
import { cn, compareInvoiceNumbers, getDueDateStatus, PAYMENT_METHODS } from '../lib/utils';
import { Dialog } from '../components/ui/Dialog';
import { MailDialog } from '../components/MailDialog';
import { BatchExportDialog } from '../components/BatchExportDialog';

const getUnitDisplay = (code: string | undefined, t: TFunction) => {
  return t(`units.${code || 'HUR'}`, { defaultValue: code || 'HUR' });
};

export const Invoices = () => {
  const { t, i18n } = useTranslation(['invoices', 'common']);
  const [isDialogOpen, setIsDialogOpen] = React.useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);
  const [selectedInvoice, setSelectedInvoice] = React.useState<Invoice | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'draft' | 'pending' | 'paid'>('all');

  // Form State
  const [selectedCompanyId, setSelectedCompanyId] = React.useState('');
  const [companySearchQuery, setCompanySearchQuery] = React.useState('');
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = React.useState(false);
  const [isVatInclusive, setIsVatInclusive] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const [lineItems, setLineItems] = React.useState<LineItem[]>([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);

  // Rich Description Designer State Hooks
  const [activeItemDescEditIdx, setActiveItemDescEditIdx] = React.useState<number | null>(null);
  const [descEditLayout, setDescEditLayout] = React.useState<'single' | 'double'>('single');
  
  const [initialSingleHtml, setInitialSingleHtml] = React.useState('');
  const [initialLeftHtml, setInitialLeftHtml] = React.useState('');
  const [initialRightHtml, setInitialRightHtml] = React.useState('');

  const singleEditorRef = React.useRef<HTMLDivElement>(null);
  const leftEditorRef = React.useRef<HTMLDivElement>(null);
  const rightEditorRef = React.useRef<HTMLDivElement>(null);

  const previewDescription = (desc: string) => {
    if (!desc) return '';
    const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
    const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
    if (leftMatch || rightMatch) {
      const leftText = (leftMatch ? leftMatch[1] : "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
      const rightText = (rightMatch ? rightMatch[1] : "").replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
      return `[Spalten] ${leftText || '—'} | ${rightText || '—'}`;
    }
    const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
    const raw = singleMatch ? singleMatch[1] : desc;
    return raw.replace(/<\/?[^>]+(>|$)/g, " ").replace(/\s+/g, " ").trim();
  };

  const handleOpenDescEditor = (idx: number) => {
    const desc = lineItems[idx]?.description || '';
    const isDouble = desc.includes('<!-- MULTI_COL_START -->') || desc.includes('COL_LEFT_START');
    
    if (isDouble) {
      setDescEditLayout('double');
      const left = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/)?.[1] || '';
      const right = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/)?.[1] || '';
      
      setInitialLeftHtml(left);
      setInitialRightHtml(right);
      setInitialSingleHtml('');
    } else {
      setDescEditLayout('single');
      const single = desc.includes('<!-- SINGLE_COL_START -->')
        ? (desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/)?.[1] || '')
        : desc;
      
      setInitialSingleHtml(single);
      setInitialLeftHtml('');
      setInitialRightHtml('');
    }
    setActiveItemDescEditIdx(idx);
  };

  const handleSwitchLayout = (newLayout: 'single' | 'double') => {
    if (newLayout === descEditLayout) return;
    
    if (newLayout === 'double') {
      // Switching from single to double: take the single text and put it in left
      const currentSingle = singleEditorRef.current?.innerHTML || '';
      setInitialLeftHtml(currentSingle);
      setInitialRightHtml('');
    } else {
      // Switching from double to single: merge left and right
      const currentLeft = leftEditorRef.current?.innerHTML || '';
      const currentRight = rightEditorRef.current?.innerHTML || '';
      const merged = currentLeft + (currentLeft && currentRight ? '<br/>' : '') + currentRight;
      setInitialSingleHtml(merged);
    }
    setDescEditLayout(newLayout);
  };

  const handleSaveDescEditor = () => {
    if (activeItemDescEditIdx === null) return;
    let compiledDesc = '';
    if (descEditLayout === 'double') {
      const leftHtml = leftEditorRef.current?.innerHTML || '';
      const rightHtml = rightEditorRef.current?.innerHTML || '';
      compiledDesc = `<!-- MULTI_COL_START -->\n<div style="display: flex; gap: 16px; width: 100%;">\n  <div style="flex: 1;"><!-- COL_LEFT_START -->${leftHtml}<!-- COL_LEFT_END --></div>\n  <div style="flex: 1;"><!-- COL_RIGHT_START -->${rightHtml}<!-- COL_RIGHT_END --></div>\n</div>\n<!-- MULTI_COL_END -->`;
    } else {
      const singleHtml = singleEditorRef.current?.innerHTML || '';
      compiledDesc = `<!-- SINGLE_COL_START -->\n${singleHtml}\n<!-- SINGLE_COL_END -->`;
    }
    updateLineItem(activeItemDescEditIdx, 'description', compiledDesc);
    setActiveItemDescEditIdx(null);
  };

  const handleExecCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
  };

  const renderDescriptionInPreview = (desc: string) => {
    if (!desc) return "—";
    
    const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
    const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
    
    if (leftMatch || rightMatch) {
      const leftHtml = leftMatch ? leftMatch[1] : '';
      const rightHtml = rightMatch ? rightMatch[1] : '';
      return (
        <div className="flex gap-4 w-full">
          <div className="flex-1 text-slate-900 font-bold text-left" dangerouslySetInnerHTML={{ __html: leftHtml }} />
          <div className="flex-1 text-slate-500 font-normal text-left" dangerouslySetInnerHTML={{ __html: rightHtml }} />
        </div>
      );
    }
    
    const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
    const htmlToRender = singleMatch ? singleMatch[1] : desc;
    return <div className="text-slate-900 font-bold text-left" dangerouslySetInnerHTML={{ __html: htmlToRender }} />;
  };

  // Action Dropdown & Editing states
  const [activeMenuId, setActiveMenuId] = React.useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = React.useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = React.useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = React.useState<Invoice | null>(null);
  const menuContainerRef = React.useRef<HTMLDivElement>(null);

  // MailDialog States
  const [isMailDialogOpen, setIsMailDialogOpen] = React.useState(false);
  const [mailRecipientEmail, setMailRecipientEmail] = React.useState('');
  const [mailRecipientName, setMailRecipientName] = React.useState('');
  const [mailSelectedInvoice, setMailSelectedInvoice] = React.useState<Invoice | null>(null);

  // Finalize (Zahlung erhalten) States
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = React.useState(false);
  const [isBatchExportOpen, setIsBatchExportOpen] = React.useState(false);
  const [finalizeInvoice, setFinalizeInvoice] = React.useState<Invoice | null>(null);
  const [finalizeDate, setFinalizeDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [finalizeMethod, setFinalizeMethod] = React.useState('transfer');
  const [finalizeAmount, setFinalizeAmount] = React.useState(0);

  // Controlled Form Inputs
  const [bankAccount, setBankAccount] = React.useState('standard');
  const [issueDate, setIssueDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [serviceDate, setServiceDate] = React.useState('');
  const [paymentTerm, setPaymentTerm] = React.useState('14');
  const [leitwegId, setLeitwegId] = React.useState('');
  const [currencyCode, setCurrencyCode] = React.useState('EUR');
  const [associatedContactId, setAssociatedContactId] = React.useState('');
  const [introductoryText, setIntroductoryText] = React.useState('');
  const [closingText, setClosingText] = React.useState('');

  // Search & Pagination constraints
  const [searchQuery, setSearchQuery] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [page, setPage] = React.useState(1);

  const utils = trpc.useUtils();

  const handleDownloadPdf = async (invoiceId: string) => {
    setActiveMenuId(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/download-pdf?lang=${i18n.language}`);
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || `Server returned status ${response.status}`);
      }
      const invoice = invoices.find(i => i.id_uuid === invoiceId);
      const company = companies.find(c => c.id_uuid === invoice?.associated_company_id);
      const contact = contacts.find(c => c.id_uuid === invoice?.associated_contact_id);
      const recipientName = company?.full_legal_name || (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '') || invoice?.company_name || 'Empfaenger';
      const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
      const cleanNum = (invoice?.invoice_number || invoiceId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${t('common:invoice_single')} - ${cleanRecipient} - ${cleanNum}.pdf`;

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("PDF download error:", error);
      toast.error(`${t('error_download_pdf')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleDownloadXml = async (invoiceId: string) => {
    setActiveMenuId(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/download-xml?lang=${i18n.language}`);
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(errText || `Server returned status ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `zugferd_${invoiceId}.xml`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("XML download error:", error);
      toast.error(`${t('error_download_xml')}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // tRPC Queries & Mutations
  const { data: invoices = [], isLoading: loadingInvoices } = trpc.getInvoices.useQuery();
  const { data: companies = [], isLoading: loadingCompanies } = trpc.getCompanies.useQuery();
  const { data: contacts = [], isLoading: loadingContacts } = trpc.getContacts.useQuery();
  const { data: myCompany } = trpc.getMyCompany.useQuery();
  const { data: invoiceTextTemplates = [] } = trpc.getInvoiceTextTemplates.useQuery();
  const { data: invoiceItemTemplates = [] } = trpc.getInvoiceItemTemplates.useQuery();

  const replaceInvoicePlaceholders = (text: string) => {
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
    if (associatedContactId) {
      const ct = contacts.find(c => c.id_uuid === associatedContactId);
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
          const assocCo = companies.find((co: any) => co.id_uuid === ct.associated_company_id);
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

    // 3. Resolve Invoice totals and dates
    const currentTotals = calculateInvoiceTotals(lineItems, isVatInclusive);
    const grossVal = typeof currentTotals.gross === 'number'
      ? currentTotals.gross.toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : (0).toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let dueDateStr = '';
    if (issueDate) {
      const days = parseInt(paymentTerm || '14', 10);
      const date = new Date(issueDate);
      if (!isNaN(days)) {
        date.setDate(date.getDate() + days);
      }
      dueDateStr = date.toLocaleDateString(activeLocale);
    }

    const nextInvoiceNumber = selectedInvoice?.invoice_number || '';

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
      .replace(/\{\{invoice_number\}\}/g, nextInvoiceNumber)
      .replace(/\{\{due_date\}\}/g, dueDateStr)
      .replace(/\{\{total_gross\}\}/g, grossVal)
      .replace(/\{\{currency\}\}/g, currencyCode || 'EUR');

    return replaced;
  };

  const filteredInvoices = React.useMemo(() => {
    return invoices.filter(invoice => {
      if (statusFilter !== 'all') {
        if (invoice.payment_status !== statusFilter) return false;
      }
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const compName = companies.find(c => c.id_uuid === invoice.associated_company_id)?.full_legal_name || invoice.company_name || '';
      return (
        invoice.invoice_number.toLowerCase().includes(q) ||
        compName.toLowerCase().includes(q) ||
        (invoice.issue_date || '').toLowerCase().includes(q) ||
        String(invoice.total_gross_amount).toLowerCase().includes(q) ||
        String(invoice.total_net_amount).toLowerCase().includes(q)
      );
    });
  }, [invoices, searchQuery, companies, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / limit));

  React.useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [filteredInvoices.length, limit, totalPages, page]);

  const paginatedInvoices = React.useMemo(() => {
    const startIndex = (page - 1) * limit;
    return filteredInvoices.slice(startIndex, startIndex + limit);
  }, [filteredInvoices, page, limit]);

  const introductoryTemplates = invoiceTextTemplates.filter(t => t.template_type_code === 'introductory');
  const closingTemplates = invoiceTextTemplates.filter(t => t.template_type_code === 'closing');
  
  const createInvoiceMutation = trpc.createInvoice.useMutation({
    onSuccess: () => {
      setIsDialogOpen(false);
      setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
      setSelectedCompanyId('');
      setCompanySearchQuery('');
      setAssociatedContactId('');
      setBankAccount('standard');
      setIssueDate(new Date().toISOString().split('T')[0]);
      setServiceDate('');
      setPaymentTerm('14');
      setLeitwegId('');
      setCurrencyCode('EUR');
      setIsVatInclusive(false);
      setIntroductoryText('');
      setClosingText('');
      setStatusFilter('pending');
      setPage(1);
      utils.getInvoices.invalidate();
      toast.success(t('invoices:create_success', { defaultValue: 'Rechnung erfolgreich erstellt!' }));
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Erstellen der Rechnung.');
    }
  });

  const createDraftMutation = trpc.createDraft.useMutation({
    onSuccess: () => {
      setIsDialogOpen(false);
      setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
      setSelectedCompanyId('');
      setCompanySearchQuery('');
      setAssociatedContactId('');
      setBankAccount('standard');
      setIssueDate(new Date().toISOString().split('T')[0]);
      setServiceDate('');
      setPaymentTerm('14');
      setLeitwegId('');
      setCurrencyCode('EUR');
      setIsVatInclusive(false);
      setIntroductoryText('');
      setClosingText('');
      setStatusFilter('draft');
      setPage(1);
      utils.getInvoices.invalidate();
      toast.success(t('invoices:create_draft_success', { defaultValue: 'Entwurf erfolgreich gespeichert!' }));
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Speichern des Entwurfs.');
    }
  });

  const finalizeDraftMutation = trpc.finalizeDraft.useMutation({
    onSuccess: (data) => {
      toast.success(t('invoices:finalize_draft_success', { defaultValue: `Entwurf erfolgreich gebucht! Rechnungsnummer: ${data.invoice_number}` }));
      setStatusFilter('pending');
      setPage(1);
      utils.getInvoices.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || 'Fehler beim Finalisieren des Entwurfs.');
    }
  });

  const updateInvoiceMutation = trpc.updateInvoice.useMutation({
    onSuccess: (data, variables) => {
      setIsDialogOpen(false);
      setEditingInvoiceId(null);
      setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
      setSelectedCompanyId('');
      setCompanySearchQuery('');
      setAssociatedContactId('');
      setBankAccount('standard');
      setIssueDate(new Date().toISOString().split('T')[0]);
      setServiceDate('');
      setPaymentTerm('14');
      setLeitwegId('');
      setCurrencyCode('EUR');
      setIsVatInclusive(false);
      setIntroductoryText('');
      setClosingText('');
      if ((variables as any)?.payment_status === 'draft') {
        setStatusFilter('draft');
      } else {
        setStatusFilter('all');
      }
      setPage(1);
      utils.getInvoices.invalidate();
      toast.success(t('invoices:update_success', { defaultValue: 'Rechnung erfolgreich aktualisiert!' }));
    }
  });

  const generatePdfMutation = trpc.generateFiscalPdf.useMutation({
    onSuccess: (data, variables) => {
      if (data.success && (variables as any)?.invoiceId) {
        handleDownloadPdf((variables as any).invoiceId);
      } else {
        toast.error(`${t('preview.pdf_export_error')}: ${data.error}`);
      }
    }
  });

  const deleteInvoiceMutation = trpc.deleteInvoice.useMutation({
    onSuccess: () => {
      toast.success(t('invoices:delete_success', { defaultValue: 'Rechnung erfolgreich gelöscht' }));
      setIsDeleteConfirmOpen(false);
      setInvoiceToDelete(null);
      utils.getInvoices.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t('invoices:delete_error', { defaultValue: 'Fehler beim Löschen der Rechnung' }));
    }
  });

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
    setActiveMenuId(null);
    setFinalizeInvoice(invoice);
    setFinalizeDate(new Date().toISOString().split('T')[0]);
    setFinalizeMethod('transfer');
    setFinalizeAmount(invoice.total_gross_amount);
    setIsFinalizeDialogOpen(true);
  };

  const latestInvoice = React.useMemo(() => {
    if (!invoices || invoices.length === 0) return null;
    const nonDraftInvoices = invoices.filter(i => i.payment_status !== 'draft');
    if (nonDraftInvoices.length === 0) return null;
    return nonDraftInvoices.reduce<any>((max, current) => {
      if (!max) return current;
      return compareInvoiceNumbers(current.invoice_number || '', max.invoice_number || '') > 0 ? current : max;
    }, null) as Invoice | null;
  }, [invoices]);

  const filteredCompaniesSearch = React.useMemo(() => {
    if (!companySearchQuery || (selectedCompanyId && (companies as Company[]).find(c => c.id_uuid === selectedCompanyId)?.full_legal_name === companySearchQuery)) return [];
    return (companies as Company[])
      .filter(co => co.full_legal_name?.toLowerCase().includes(companySearchQuery.toLowerCase()))
      .slice(0, 3);
  }, [companySearchQuery, companies, selectedCompanyId]);

  // Click outside handler for company search dropdown
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCompanyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Click outside handler for invoice actions submenu
  React.useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (activeMenuId && menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [activeMenuId]);

  React.useEffect(() => {
    const targetCompId = localStorage.getItem('open_create_invoice_for_company_id');
    if (targetCompId && companies.length > 0) {
      localStorage.removeItem('open_create_invoice_for_company_id');
      const comp = (companies as Company[]).find(c => c.id_uuid === targetCompId);
      if (comp) {
        setEditingInvoiceId(null);
        setSelectedCompanyId(comp.id_uuid);
        setCompanySearchQuery(comp.full_legal_name);
        setAssociatedContactId('');
        setBankAccount('standard');
        setIssueDate(new Date().toISOString().split('T')[0]);
        setServiceDate('');
        setPaymentTerm(comp.payment_term || '14');
        setLeitwegId(comp.leitweg_id || '');
        setCurrencyCode('EUR');
        setIsVatInclusive(false);
        setIntroductoryText('');
        setClosingText('');
        setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
        setIsDialogOpen(true);
      }
    }
  }, [companies]);

  React.useEffect(() => {
    const queryId = localStorage.getItem('open_invoice_id');
    if (queryId && invoices.length > 0) {
      localStorage.removeItem('open_invoice_id');
      const found = (invoices as Array<any>).find(i => i.id_uuid === queryId);
      if (found) {
        const isPaidFinalized = (() => {
          if (found.payment_status === 'paid') return true;
          try {
            const meta = typeof found.metadata === 'string' ? JSON.parse(found.metadata) : (found.metadata || {});
            return !!meta.is_finalized;
          } catch (_) {
            return false;
          }
        })();

        if (isPaidFinalized) {
          toast.error(t('invoices:finalized_locked_toast', { defaultValue: 'Diese Rechnung ist gebucht/abgeschlossen und kann nicht bearbeitet werden.' }));
        } else {
          handleEditClick(found);
        }
      }
    }
  }, [invoices]);

  const handleCreateNewClick = () => {
    setEditingInvoiceId(null);
    setSelectedCompanyId('');
    setCompanySearchQuery('');
    setAssociatedContactId('');
    setBankAccount('standard');
    setIssueDate(new Date().toISOString().split('T')[0]);
    setServiceDate('');
    setPaymentTerm('14');
    setLeitwegId('');
    setCurrencyCode('EUR');
    setIsVatInclusive(false);
    setIntroductoryText('');
    setClosingText('');
    setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
    setIsDialogOpen(true);
  };

  const handleEditClick = (invoice: Invoice) => {
    const isPaidFinalized = (() => {
      if (invoice.payment_status === 'paid') return true;
      try {
        const meta = typeof invoice.metadata === 'string' ? JSON.parse(invoice.metadata) : (invoice.metadata || {});
        return !!meta.is_finalized;
      } catch (_) {
        return false;
      }
    })();

    if (isPaidFinalized) {
      toast.error(t('invoices:finalized_locked_toast', { defaultValue: 'Diese Rechnung ist gebucht/abgeschlossen und kann nicht bearbeitet werden.' }));
      return;
    }

    setEditingInvoiceId(invoice.id_uuid);
    setSelectedCompanyId(invoice.associated_company_id || '');
    setCompanySearchQuery(invoice.company_name || '');
    setAssociatedContactId(invoice.associated_contact_id || '');
    setBankAccount(invoice.bank_account || 'standard');
    setIssueDate(invoice.issue_date);
    setServiceDate(invoice.service_date || '');
    setPaymentTerm(invoice.payment_term || '14');
    setLeitwegId(invoice.leitweg_id || '');
    setCurrencyCode(invoice.currency_code || 'EUR');
    setIsVatInclusive(invoice.is_vat_inclusive);
    setIntroductoryText(invoice.introductory_text || '');
    setClosingText(invoice.closing_text || '');
    try {
      setLineItems(JSON.parse(invoice.invoice_line_items_json || '[]'));
    } catch (e) {
      setLineItems([{ description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
    }
    setIsDialogOpen(true);
    setActiveMenuId(null);
  };

  const handleSendMailClick = (invoice: Invoice) => {
    setActiveMenuId(null);
    let recipientEmail = '';
    let recipientName = '';

    if (invoice.associated_contact_id) {
      const contact = contacts.find(c => c.id_uuid === invoice.associated_contact_id);
      if (contact) {
        recipientEmail = contact.email_address || '';
        recipientName = contact.full_legal_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
      }
    }

    if (!recipientEmail && invoice.associated_company_id) {
      const company = companies.find(c => c.id_uuid === invoice.associated_company_id);
      if (company) {
        recipientEmail = company.email_address || '';
        recipientName = company.full_legal_name || '';
      }
    }

    if (!recipientName) {
      recipientName = invoice.company_name || '';
    }

    if (!recipientEmail) {
      recipientEmail = 'info@louis-crm.de';
    }

    setMailRecipientEmail(recipientEmail);
    setMailRecipientName(recipientName);
    setMailSelectedInvoice(invoice);
    setIsMailDialogOpen(true);
  };

  const addLineItem = () => setLineItems([...lineItems, { description: '', quantity: 1, unit_price: 0, vat_rate: 19, unit_code: 'HUR' }]);
  const addLineItemFromTemplate = (template: any) => {
    const rawDesc = template.description || template.template_name_text || '';
    const resolvedDesc = replaceInvoicePlaceholders(rawDesc);
    if (lineItems.length === 1 && lineItems[0].description === '' && lineItems[0].unit_price === 0) {
      setLineItems([{
        description: resolvedDesc,
        quantity: template.quantity || 1,
        unit_price: template.unit_price || 0,
        vat_rate: template.vat_rate || 19,
        unit_code: template.unit_code || 'HUR',
      }]);
    } else {
      setLineItems([
        ...lineItems,
        {
          description: resolvedDesc,
          quantity: template.quantity || 1,
          unit_price: template.unit_price || 0,
          vat_rate: template.vat_rate || 19,
          unit_code: template.unit_code || 'HUR',
        }
      ]);
    }
    toast.success(t('invoices:item_added', { name: template.template_name_text, defaultValue: `Position "${template.template_name_text}" hinzugefügt.` }));
  };
  const removeLineItem = (index: number) => setLineItems(lineItems.filter((_, i) => i !== index));
  const updateLineItem = <K extends keyof LineItem>(index: number, field: K, value: LineItem[K]) => {
    const newItems = [...lineItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setLineItems(newItems);
  };

  const totals = React.useMemo(() => calculateInvoiceTotals(lineItems, isVatInclusive), [lineItems, isVatInclusive]);

  const filteredContacts = React.useMemo(() => {
    if (!selectedCompanyId) return [];
    return (contacts as Contact[]).filter(c => c.associated_company_id === selectedCompanyId);
  }, [selectedCompanyId, contacts]);

  const selectedInvoiceCompany = React.useMemo(() => {
    if (!selectedInvoice) return null;
    if (selectedInvoice.company_name) return selectedInvoice.company_name;
    const co = companies.find(c => c.id_uuid === selectedInvoice.associated_company_id);
    return co ? co.full_legal_name : '';
  }, [selectedInvoice, companies]);

  const selectedInvoiceCompanyObj = React.useMemo(() => {
    if (!selectedInvoice || !selectedInvoice.associated_company_id) return null;
    return companies.find(c => c.id_uuid === selectedInvoice.associated_company_id) || null;
  }, [selectedInvoice, companies]);

  const selectedInvoiceContact = React.useMemo(() => {
    if (!selectedInvoice) return null;
    if (selectedInvoice.contact_full_name) return selectedInvoice.contact_full_name;
    const ct = contacts.find(c => c.id_uuid === selectedInvoice.associated_contact_id);
    return ct ? (ct.full_legal_name || `${ct.first_name || ''} ${ct.last_name || ''}`.trim()) : '';
  }, [selectedInvoice, contacts]);

  const selectedInvoiceContactObj = React.useMemo(() => {
    if (!selectedInvoice || !selectedInvoice.associated_contact_id) return null;
    return contacts.find(c => c.id_uuid === selectedInvoice.associated_contact_id) || null;
  }, [selectedInvoice, contacts]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement> | React.MouseEvent, isDraft: boolean = false) => {
    e.preventDefault();
    
    // Validate descriptions
    for (let i = 0; i < lineItems.length; i++) {
      if (!lineItems[i].description || !lineItems[i].description.trim()) {
        toast.error(t('invoices:please_enter_desc', { index: i + 1, defaultValue: `Bitte eine Beschreibung für Position ${i + 1} eingeben.` }));
        return;
      }
      if (isNaN(lineItems[i].quantity) || lineItems[i].quantity <= 0) {
        toast.error(t('invoices:please_enter_qty', { index: i + 1, defaultValue: `Bitte eine gültige Menge für Position ${i + 1} eingeben.` }));
        return;
      }
      if (isNaN(lineItems[i].unit_price) || lineItems[i].unit_price < 0) {
        toast.error(t('invoices:please_enter_price', { index: i + 1, defaultValue: `Bitte einen gültigen Preis für Position ${i + 1} eingeben.` }));
        return;
      }
    }
    
    const currentTotals = calculateInvoiceTotals(lineItems, isVatInclusive);
    
    const calcDueDate = () => {
      if (!issueDate) return null;
      const days = parseInt(paymentTerm || '14', 10);
      if (isNaN(days)) return issueDate;
      const date = new Date(issueDate);
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0];
    };

    const associatedCompany = companies.find(c => c.id_uuid === selectedCompanyId);
    const companyShortCode = associatedCompany?.short_code || null;

    const originalInvoice = editingInvoiceId ? invoices.find(i => i.id_uuid === editingInvoiceId) : null;
    const originalMeta = originalInvoice?.metadata 
      ? (typeof originalInvoice.metadata === 'string' ? JSON.parse(originalInvoice.metadata) : originalInvoice.metadata)
      : {};

    const invoiceData = {
      invoice_number: editingInvoiceId 
        ? (invoices.find(i => i.id_uuid === editingInvoiceId)?.invoice_number || '')
        : `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
      associated_company_id: selectedCompanyId || null,
      associated_contact_id: associatedContactId || null,
      bank_account: bankAccount || null,
      issue_date: issueDate,
      service_date: serviceDate || null,
      due_date: calcDueDate(),
      payment_term: paymentTerm || null,
      is_vat_inclusive: isVatInclusive,
      total_net_amount: currentTotals.net,
      total_vat_amount: currentTotals.vat,
      total_gross_amount: currentTotals.gross,
      vat_rate: 19,
      currency_code: currencyCode || 'EUR',
      leitweg_id: leitwegId || null,
      introductory_text: introductoryText || '',
      closing_text: closingText || '',
      payment_status: 'pending' as 'pending' | 'paid' | 'overdue' | 'draft',
      invoice_line_items: lineItems.map(item => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        total_net: calculateLineItemNet(item, isVatInclusive),
        unit_code: item.unit_code || 'HUR'
      })),
      metadata: {
        ...originalMeta,
        company_short_code: companyShortCode
      }
    };

    if (editingInvoiceId) {
      const originalInvoice = invoices.find(i => i.id_uuid === editingInvoiceId);
      updateInvoiceMutation.mutate({
        ...invoiceData,
        id_uuid: editingInvoiceId,
        payment_status: originalInvoice?.payment_status || 'pending'
      });
    } else if (isDraft) {
      createDraftMutation.mutate({
        ...invoiceData,
        payment_status: 'draft'
      });
    } else {
      createInvoiceMutation.mutate(invoiceData);
    }
  };

  const loading = loadingInvoices || loadingCompanies || loadingContacts;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-white/5">
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
            onClick={() => setIsBatchExportOpen(true)}
            className="flex items-center gap-2 bg-primary-light border border-white/5 text-slate-300 px-6 h-11 rounded-xl font-bold hover:bg-white/5 transition-all hover:text-white group font-display text-xs uppercase tracking-widest leading-none"
          >
            <Download size={18} className="group-hover:translate-y-0.5 transition-transform text-accent-blue" />
            {t('common:batch_export')}
          </button>
          <button 
            onClick={handleCreateNewClick}
            className="flex items-center gap-2 bg-accent-orange text-white px-6 h-11 rounded-xl font-bold hover:bg-accent-orange/90 transition-all shadow-xl shadow-accent-orange/20 active:scale-95 font-display text-xs uppercase tracking-widest leading-none"
          >
            <Plus size={18} />
            {t('generate_new')}
          </button>
        </div>
      </div>

      {/* Status FILTER TABS */}
      <div className="flex border-b border-white/5 pb-2 ml-1 gap-6 flex-wrap">
        {([
          { value: 'all', label: t('all', { defaultValue: 'Alles' }), count: undefined },
          { value: 'draft', label: t('drafts', { defaultValue: 'Entwürfe' }), count: invoices.filter(i => i.payment_status === 'draft').length },
          { value: 'pending', label: t('pending', { defaultValue: 'Offen' }), count: invoices.filter(i => i.payment_status === 'pending').length },
          { value: 'paid', label: t('paid', { defaultValue: 'Bezahlt' }), count: invoices.filter(i => i.payment_status === 'paid').length }
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
                layoutId="activeTabMarker"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent-orange"
              />
            )}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="p-20 text-center">
            <div className="w-10 h-10 border-4 border-accent-orange border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">{t('scanning')}</p>
          </div>
        ) : (
          <>
            {paginatedInvoices.map((invoice, idx) => {
              const isPaidFinalized = (() => {
                if (invoice.payment_status === 'paid') return true;
                try {
                  const meta = typeof invoice.metadata === 'string' ? JSON.parse(invoice.metadata) : (invoice.metadata || {});
                  return !!meta.is_finalized;
                } catch (_) {
                  return false;
                }
              })();
              return (
                <motion.div
                  key={invoice.id_uuid}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-primary-light/30 border border-white/5 p-5 rounded-xl flex items-center gap-6 hover:border-accent-orange/40 hover:bg-primary-light transition-all no-scrollbar"
                >
                  <div className="w-14 h-14 rounded-xl bg-primary-dark border border-white/5 flex items-center justify-center text-accent-blue group-hover:bg-accent-blue/10 transition-all shrink-0">
                    <FileCheck size={28} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-1 font-mono flex items-center gap-2 flex-wrap">
                      <span>#{invoice.invoice_number} • {new Date(invoice.issue_date).toLocaleDateString(i18n.language)}</span>
                      {invoice.payment_status === 'draft' ? (
                        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/35 px-1.5 py-0.5 rounded text-[9px] font-black flex items-center gap-1 font-sans">
                          <Eye size={10} className="text-amber-400" />
                          {t('invoices:payment_draft', { defaultValue: 'ENTWURF' })}
                        </span>
                      ) : isPaidFinalized ? (
                        <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/35 px-1.5 py-0.5 rounded text-[9px] font-black flex items-center gap-1 font-sans">
                          <CheckCircle2 size={10} className="text-emerald-400" />
                          {t('invoices:payment_finalized', { defaultValue: 'GEBUCHT' })}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="text-lg font-black text-white truncate font-display italic tracking-tight">
                      {companies.find(c => c.id_uuid === invoice.associated_company_id)?.full_legal_name || invoice.company_name || '—'}
                    </h3>
                    <div className="flex items-center gap-4 text-[10px] font-black text-slate-500 uppercase tracking-widest mt-1">
                      <span className="flex items-center gap-1.5"><Calendar size={12} className="text-accent-blue" /> Service: {invoice.service_date || invoice.issue_date}</span>
                      <span className="flex items-center gap-1.5"><Tag size={12} className="text-accent-orange" /> {invoice.vat_rate}% {t('preview.vat')}</span>
                    </div>
                  </div>

                  <div className="shrink-0 text-left min-w-[125px] hidden md:block border-l border-white/5 pl-6">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 font-mono">
                      {t('due_date')}
                    </div>
                    {(() => {
                      const status = getDueDateStatus(invoice, i18n.language);
                      return (
                        <span className={status.badgeClasses}>
                          {status.formatted}
                        </span>
                      );
                    })()}
                  </div>
                  
                  <div className="text-right shrink-0">
                    <div className="text-xs font-bold text-slate-500 mb-0.5">{formatCurrency(invoice.total_net_amount, invoice.currency_code)} {t('preview.net')}</div>
                    <div className="text-xl font-bold text-white tracking-tight">{formatCurrency(invoice.total_gross_amount, invoice.currency_code)}</div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => { setSelectedInvoice(invoice as Invoice); setIsPreviewOpen(true); }}
                      className="p-3 text-slate-500 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
                    >
                      <Eye size={18} />
                    </button>
                    
                    <div className="relative" ref={activeMenuId === invoice.id_uuid ? menuContainerRef : null}>
                      <button 
                        onClick={() => setActiveMenuId(activeMenuId === invoice.id_uuid ? null : invoice.id_uuid)}
                        className={cn(
                          "p-3 rounded-xl transition-all",
                          activeMenuId === invoice.id_uuid ? "text-white bg-slate-800" : "text-slate-500 hover:text-white hover:bg-slate-800"
                        )}
                      >
                        <MoreVertical size={18} />
                      </button>
                      
                      <AnimatePresence>
                        {activeMenuId === invoice.id_uuid && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -5 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -5 }}
                            transition={{ duration: 0.15 }}
                            className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-primary-dark border border-white/10 shadow-2xl z-50 overflow-hidden py-1"
                          >
                            {!isPaidFinalized && invoice.payment_status !== 'draft' && (
                              <button
                                type="button"
                                onClick={() => handleEmitPaymentClick(invoice as Invoice)}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-emerald-400 hover:text-emerald-300 hover:bg-white/5 transition-colors text-left font-display uppercase tracking-wider"
                              >
                                <CheckCircle2 size={14} className="text-emerald-400" />
                                {t('receive_payment_action', { defaultValue: 'Zahlung erhalten' })}
                              </button>
                            )}
                            {invoice.payment_status === 'draft' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  finalizeDraftMutation.mutate({ id_uuid: invoice.id_uuid });
                                }}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-amber-400 hover:text-amber-300 hover:bg-white/5 transition-colors text-left font-display uppercase tracking-wider"
                              >
                                <CheckCircle2 size={14} className="text-amber-400" />
                                {t('finalize_draft_action', { defaultValue: 'Buchen (Finalisieren)' })}
                              </button>
                            )}
                            {!isPaidFinalized ? (
                              <button
                                type="button"
                                onClick={() => handleEditClick(invoice as Invoice)}
                                className={cn(
                                  "w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left font-display uppercase tracking-wider",
                                  "border-t border-white/5"
                                )}
                              >
                                <Edit2 size={14} className="text-accent-blue" />
                                {t('edit_action')}
                              </button>
                            ) : (
                              <div className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-500 font-display uppercase tracking-wider cursor-not-allowed opacity-60">
                                <span>🔒 {t('finalized_locked', { defaultValue: 'Gesperrt' })}</span>
                              </div>
                            )}
                            {invoice.payment_status !== 'draft' && (
                              <button
                                type="button"
                                onClick={() => handleSendMailClick(invoice as Invoice)}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                              >
                                <Mail size={14} className="text-accent-orange" />
                                {t('send_mail_action')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                if (invoice.payment_status === 'draft') {
                                  toast.error(t('invoices:draft_download_blocked', { defaultValue: 'Entwurf kann erst nach Buchung heruntergeladen werden.' }));
                                } else {
                                  handleDownloadPdf(invoice.id_uuid);
                                }
                              }}
                              className={cn(
                                "w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider",
                                invoice.payment_status === 'draft' && "opacity-50 cursor-not-allowed text-slate-500 hover:text-slate-500 hover:bg-transparent"
                              )}
                            >
                              <Download size={14} className="text-emerald-400" />
                              {t('download_pdf_action')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (invoice.payment_status === 'draft') {
                                  toast.error(t('invoices:draft_download_blocked', { defaultValue: 'Entwurf kann erst nach Buchung heruntergeladen werden.' }));
                                } else {
                                  handleDownloadXml(invoice.id_uuid);
                                }
                              }}
                              className={cn(
                                "w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-slate-300 hover:text-white hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider",
                                invoice.payment_status === 'draft' && "opacity-50 cursor-not-allowed text-slate-500 hover:text-slate-500 hover:bg-transparent"
                              )}
                            >
                              <FileCheck size={14} className="text-amber-400" />
                              {t('download_xml_action')}
                            </button>
                            {!isPaidFinalized && (
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveMenuId(null);
                                  setInvoiceToDelete(invoice as Invoice);
                                  setIsDeleteConfirmOpen(true);
                                }}
                                className="w-full px-5 py-3 flex items-center gap-3 text-xs font-bold text-red-500 hover:text-red-400 hover:bg-white/5 transition-colors text-left border-t border-white/5 font-display uppercase tracking-wider"
                              >
                                <Trash2 size={14} className="text-red-500" />
                                {t('delete_action')}
                              </button>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          {filteredInvoices.length > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-4 bg-primary-dark/40 border border-white/5 rounded-xl">
              <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                {t('common:pagination_invoices', { from: Math.min(filteredInvoices.length, (page - 1) * limit + 1), to: Math.min(filteredInvoices.length, page * limit), count: filteredInvoices.length })}
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
        {!loading && filteredInvoices.length === 0 && (
          <div className="p-24 text-center bg-primary-light/20 rounded-xl border-2 border-dashed border-white/5 xl:col-span-1">
            <div className="w-20 h-20 bg-primary-dark border border-white/5 text-accent-orange rounded-xl flex items-center justify-center mx-auto mb-6 transform -rotate-6 shadow-2xl">
              <FileText size={40} />
            </div>
            <h4 className="text-white font-black text-2xl tracking-tight font-display uppercase italic">{t('empty')}</h4>
            <p className="text-slate-500 mt-3 max-w-sm mx-auto font-bold text-sm">
              {searchQuery ? t('no_search_results') : t('empty_desc')}
            </p>
          </div>
        )}
      </div>

      {/* CREATE INVOICE DIALOG */}
      <Dialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={editingInvoiceId ? t('edit_invoice_title') : t('dialog.add_title')}
        size="full"
        noPadding
      >
        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-10 bg-primary-dark p-12">
          <div className="grid grid-cols-3 gap-x-12 gap-y-8">
            {/* Left Column */}
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.customer')} <span className="text-accent-orange">*</span></label>
                <div className="relative" ref={dropdownRef}>
                  <input 
                    type="text"
                    placeholder={t('dialog.customer_placeholder')}
                    value={companySearchQuery}
                    onChange={(e) => {
                      setCompanySearchQuery(e.target.value);
                      setIsCompanyDropdownOpen(true);
                      setSelectedCompanyId('');
                      setAssociatedContactId(''); // Reset contact person when customer search is modified
                    }}
                    onFocus={() => setIsCompanyDropdownOpen(true)}
                    required={!selectedCompanyId}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all z-10 relative placeholder:text-slate-700"
                  />
                  <Eye className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-700 pointer-events-none z-20" size={18} />
                  
                  {/* Company Search Results Dropdown */}
                  <AnimatePresence>
                    {isCompanyDropdownOpen && filteredCompaniesSearch.length > 0 && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 left-0 right-0 top-full mt-2 bg-primary-light border border-white/10 shadow-2xl rounded-xl overflow-hidden"
                      >
                        {filteredCompaniesSearch.map((co) => (
                          <button
                            key={co.id_uuid}
                            type="button"
                            onClick={() => {
                              setSelectedCompanyId(co.id_uuid);
                              setCompanySearchQuery(co.full_legal_name || '');
                              setAssociatedContactId(''); // Reset contact person when a new customer/company is selected from search
                              setIsCompanyDropdownOpen(false);
                            }}
                            className="w-full px-5 py-4 text-left hover:bg-white/5 transition-colors flex items-center justify-between group"
                          >
                            <span className="text-sm font-bold text-slate-300 group-hover:text-accent-orange transition-colors">{co.full_legal_name}</span>
                            <Plus size={14} className="text-slate-600 group-hover:text-accent-orange" />
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.contact')}</label>
                <div className="relative">
                  <select 
                    name="associated_contact_id"
                    value={associatedContactId}
                    onChange={(e) => setAssociatedContactId(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                  >
                    <option value="">{t('dialog.no_contact')}</option>
                    {filteredContacts.map(ct => (
                      <option key={ct.id_uuid} value={ct.id_uuid}>{ct.full_legal_name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.currency')}</label>
                <div className="relative">
                  <select 
                    name="currency"
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                  >
                    <option value="EUR">{t('common:currency.eur')}</option>
                    <option value="USD">{t('common:currency.usd')}</option>
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                </div>
              </div>
            </div>

            {/* Middle Column */}
            <div className="space-y-6">
              <div className="flex flex-col gap-2 flex-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.bank_account')}</label>
                <div className="relative">
                  <select 
                    name="bank_account"
                    value={bankAccount}
                    onChange={(e) => setBankAccount(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                  >
                    <option value="standard">{t('dialog.standard')}</option>
                    <option value="sparkasse">{t('dialog.sparkasse')}</option>
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.issue_date')}</label>
                <div className="relative">
                  <input 
                    type="date" 
                    name="issue_date" 
                    value={issueDate}
                    onChange={(e) => setIssueDate(e.target.value)}
                    required
                    className="w-full bg-primary-light border-2 border-white/5  px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all h-[58px] rounded-xl"
                  />
                  <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.service_date')}</label>
                <div className="relative">
                  <input 
                    type="date" 
                    name="service_date" 
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5  px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all h-[58px] rounded-xl"
                  />
                  <Calendar className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={18} />
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('dialog.payment_term')}</label>
                <div className="relative">
                  <select 
                    name="payment_term"
                    value={paymentTerm}
                    onChange={(e) => setPaymentTerm(e.target.value)}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all appearance-none"
                  >
                    <option value="7">{t('dialog.days_7')}</option>
                    <option value="14">{t('dialog.days_14')}</option>
                    <option value="30">{t('dialog.days_30')}</option>
                    <option value="immediate">{t('dialog.immediate')}</option>
                  </select>
                  <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('companies:fields.leitweg_id')}</label>
                <div className="relative">
                  <input 
                    type="text" 
                    name="leitweg_id" 
                    value={leitwegId}
                    onChange={(e) => setLeitwegId(e.target.value)}
                    placeholder={t('placeholders.leitweg_id')}
                    className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all placeholder:text-slate-700"
                  />
                  <Info className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-600 pointer-events-none" size={18} />
                </div>
              </div>
            </div>
          </div>

          {/* Introductory and Closing Freitexte */}
          <div className="grid grid-cols-1 gap-y-6 pt-10 border-t border-white/5">
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center h-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t('dialog.introductory_text')}
                </label>
                {(introductoryText.includes('{{') || introductoryText.includes('}}')) && (
                  <button
                    type="button"
                    onClick={() => {
                      setIntroductoryText(replaceInvoicePlaceholders(introductoryText));
                      toast.success(t('invoices:placeholder_replaced_intro', { defaultValue: 'Platzhalter im Einleitungstext ersetzt!' }));
                    }}
                    className="text-[9px] bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue border border-accent-blue/20 rounded px-2 py-0.5 font-bold transition-all uppercase tracking-wider"
                  >
                    Platzhalter ersetzen
                  </button>
                )}
              </div>
              <textarea
                value={introductoryText}
                onChange={(e) => setIntroductoryText(e.target.value)}
                placeholder={t('dialog.introductory_text_placeholder')}
                rows={3}
                className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all resize-none placeholder:text-slate-700 font-sans"
              />
              {introductoryTemplates.length > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">
                    {t('dialog.select_template_label', { defaultValue: 'Vorlage einfügen:' })}
                  </span>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setIntroductoryText(replaceInvoicePlaceholders(e.target.value));
                        e.target.value = '';
                      }
                    }}
                    className="bg-primary-dark border border-white/5 rounded-xl px-3 py-2 text-xs font-black text-slate-400 focus:outline-none tracking-wider transition-all cursor-pointer"
                  >
                    <option value="">-- {t('dialog.choose_template', { defaultValue: 'Vorlage wählen' })} --</option>
                    {introductoryTemplates.map(tmpl => (
                      <option key={tmpl.id_uuid} value={tmpl.template_body_content}>
                        {tmpl.template_name_text}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center h-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  {t('dialog.closing_text')}
                </label>
                {(closingText.includes('{{') || closingText.includes('}}')) && (
                  <button
                    type="button"
                    onClick={() => {
                      setClosingText(replaceInvoicePlaceholders(closingText));
                      toast.success(t('invoices:placeholder_replaced_closing', { defaultValue: 'Platzhalter im Schlusssatz ersetzt!' }));
                    }}
                    className="text-[9px] bg-accent-blue/15 hover:bg-accent-blue/25 text-accent-blue border border-accent-blue/20 rounded px-2 py-0.5 font-bold transition-all uppercase tracking-wider"
                  >
                    Platzhalter ersetzen
                  </button>
                )}
              </div>
              <textarea
                value={closingText}
                onChange={(e) => setClosingText(e.target.value)}
                placeholder={t('dialog.closing_text_placeholder')}
                rows={3}
                className="w-full bg-primary-light border-2 border-white/5 rounded-xl px-5 py-4 text-white text-sm font-bold focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all resize-none placeholder:text-slate-700 font-sans"
              />
              {closingTemplates.length > 0 && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">
                    {t('dialog.select_template_label', { defaultValue: 'Vorlage einfügen:' })}
                  </span>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setClosingText(replaceInvoicePlaceholders(e.target.value));
                        e.target.value = '';
                      }
                    }}
                    className="bg-primary-dark border border-white/5 rounded-xl px-3 py-2 text-xs font-black text-slate-400 focus:outline-none tracking-wider transition-all cursor-pointer"
                  >
                    <option value="">-- {t('dialog.choose_template', { defaultValue: 'Vorlage wählen' })} --</option>
                    {closingTemplates.map(tmpl => (
                      <option key={tmpl.id_uuid} value={tmpl.template_body_content}>
                        {tmpl.template_name_text}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-8 pt-10 border-t border-white/5">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] font-display">{t('dialog.line_items_title')}</h3>
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
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('dialog.vat_inclusive')}</span>
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
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest">{t('dialog.vat_exclusive')}</span>
                </label>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-white/5 bg-primary-light/30 shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-white/5 bg-primary-light/50">
                    <th className="py-4 px-6 w-12 text-center">{t('preview.hash')}</th>
                    <th className="py-4 px-4">{t('description')}</th>
                    <th className="py-4 px-4 text-right pr-10">{t('unit_price')}</th>
                    <th className="py-4 px-4 text-center">{t('quantity')}</th>
                    <th className="py-4 px-4 text-right">{t('total')}</th>
                    <th className="py-4 px-8 text-center">{t('vat_rate')}</th>
                    <th className="py-4 px-2 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {lineItems.map((item, idx) => (
                    <tr key={idx} className="group hover:bg-primary-light transition-all">
                      <td className="py-6 px-6 text-xs font-black text-slate-600 text-center">{idx + 1}</td>
                      <td className="py-6 px-4 min-w-[300px]">
                        <div 
                          onClick={() => handleOpenDescEditor(idx)}
                          className="w-full bg-primary-dark border border-white/5 rounded-xl px-5 py-3 text-sm font-bold cursor-pointer hover:border-accent-blue/40 focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all text-white flex items-center justify-between gap-3 group"
                        >
                          <div className="truncate max-w-[280px]">
                            {item.description ? (
                              <span className="text-slate-200 text-xs font-bold">
                                {previewDescription(item.description)}
                              </span>
                            ) : (
                              <span className="text-slate-600 font-bold italic text-xs">
                                {t('description_placeholder', { defaultValue: 'Beschreibung gestalten (WYSIWYG/Spalten)...' })}
                              </span>
                            )}
                          </div>
                          <Edit2 size={13} className="text-slate-600 group-hover:text-accent-blue transition-colors shrink-0" />
                        </div>
                      </td>
                      <td className="py-6 px-4">
                        <input 
                          type="number"
                          step="0.01"
                          value={isNaN(item.unit_price) ? '' : item.unit_price}
                          onChange={(e) => updateLineItem(idx, 'unit_price', parseFloat(e.target.value))}
                          className="w-36 bg-primary-dark border border-white/5 rounded-xl px-5 py-3 text-sm text-right focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono font-bold text-white"
                        />
                      </td>
                      <td className="py-6 px-4">
                        <div className="flex items-center justify-center gap-2">
                          <input 
                            type="number"
                            value={isNaN(item.quantity) ? '' : item.quantity}
                            onChange={(e) => updateLineItem(idx, 'quantity', parseFloat(e.target.value))}
                            className="w-16 bg-primary-dark border border-white/5 rounded-xl px-2 py-3 text-sm text-center focus:outline-none focus:ring-4 focus:ring-accent-blue/10 focus:border-accent-blue transition-all font-mono font-bold text-white"
                          />
                          <select
                            value={item.unit_code || 'HUR'}
                            onChange={(e) => updateLineItem(idx, 'unit_code', e.target.value)}
                            className="bg-primary-dark border border-white/5 rounded-xl px-2 py-3 text-xs font-black text-slate-400 focus:outline-none tracking-wider min-w-[75px]"
                          >
                            <option value="HUR">{t('units.HUR')}</option>
                            <option value="MON">{t('units.MON')}</option>
                            <option value="DAY">{t('units.DAY')}</option>
                            <option value="C62">{t('units.C62')}</option>
                            <option value="SET">{t('units.SET')}</option>
                            <option value="H87">{t('units.H87')}</option>
                            <option value="LS">{t('units.LS')}</option>
                            <option value="MIN">{t('units.MIN')}</option>
                            <option value="MTR">{t('units.MTR')}</option>
                            <option value="MTK">{t('units.MTK')}</option>
                            <option value="KGM">{t('units.KGM')}</option>
                            <option value="LTR">{t('units.LTR')}</option>
                          </select>
                        </div>
                      </td>
                      <td className="py-6 px-4 text-right">
                        <div className="text-sm font-black text-neutral-white font-mono tracking-tighter">
                          {calculateLineItemNet(item, isVatInclusive).toFixed(2)}
                        </div>
                      </td>
                      <td className="py-6 px-4">
                        <div className="flex justify-center">
                          <select 
                            value={item.vat_rate}
                            onChange={(e) => updateLineItem(idx, 'vat_rate', parseInt(e.target.value))}
                            className="bg-primary-dark border border-white/5 rounded-xl px-4 py-2 text-[10px] font-black text-slate-400 focus:outline-none tracking-widest appearance-none text-center min-w-[80px]"
                          >
                            <option value="19">{t('preview.vat_19')}</option>
                            <option value="7">{t('preview.vat_7')}</option>
                            <option value="0">0%</option>
                          </select>
                        </div>
                      </td>
                      <td className="py-6 px-2">
                        <button 
                          type="button" 
                          onClick={() => removeLineItem(idx)}
                          className="p-3 text-slate-600 hover:text-accent-orange hover:bg-white/5 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4 mx-auto w-fit">
              <button 
                type="button"
                onClick={addLineItem}
                className="px-8 py-3 rounded-xl border-2 border-dashed border-white/5 text-[10px] font-black text-slate-500 hover:border-accent-orange hover:text-accent-orange transition-all flex items-center justify-center gap-3 group"
              >
                <Plus size={16} className="group-hover:rotate-90 transition-transform text-accent-orange" /> {t('dialog.add_position')}
              </button>

              {invoiceItemTemplates.length > 0 && (
                <div className="relative shadow-sm">
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        const tpl = invoiceItemTemplates.find(t => t.id_uuid === e.target.value);
                        if (tpl) addLineItemFromTemplate(tpl);
                        e.target.value = '';
                      }
                    }}
                    defaultValue=""
                    className="appearance-none bg-primary-dark border border-white/10 rounded-xl px-6 py-3 text-[10px] font-black text-slate-400 focus:outline-none focus:border-accent-blue transition-all uppercase tracking-wider cursor-pointer"
                  >
                    <option value="" disabled>{t('dialog.select_from_template', { defaultValue: 'Vorlage einfügen' })}</option>
                    {invoiceItemTemplates.map((tpl) => (
                      <option key={tpl.id_uuid} value={tpl.id_uuid} className="bg-primary-dark text-white normal-case font-bold">
                        {tpl.template_name_text} ({new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(tpl.unit_price)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end pt-10 mt-10 border-t border-white/5 space-y-2">
             <div className="flex items-center gap-10">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] font-display">{t('dialog.total_excl_vat')}</span>
                <span className="font-black text-neutral-white text-5xl tracking-tighter">{formatCurrency(totals.net, (invoices?.[0]?.currency_code || 'EUR'))}</span>
             </div>
          </div>

          {/* Footer Buttons */}
          <div className="flex justify-end gap-5 pt-12 mt-12 flex-wrap">
            <button 
              type="button"
              onClick={() => setIsDialogOpen(false)}
              className="bg-primary-dark border-2 border-slate-600 text-slate-300 px-8 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-white/5 transition-all active:scale-95"
            >
              {t('common:cancel') || 'Abbrechen'}
            </button>
            
            {!editingInvoiceId && (
              <button 
                type="button"
                disabled={createDraftMutation.isPending || createInvoiceMutation.isPending}
                onClick={(e) => handleSubmit(e, true)}
                className="bg-slate-800 border border-amber-500/30 text-amber-300 px-8 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-amber-500/10 transition-all active:scale-95 flex items-center gap-2"
              >
                {createDraftMutation.isPending && <div className="w-4 h-4 border-2 border-amber-300/30 border-t-amber-300 rounded-full animate-spin" />}
                {t('dialog.save_as_draft', { defaultValue: 'Entwurf speichern' })}
              </button>
            )}

            <button 
              type="submit"
              disabled={createInvoiceMutation.isPending || updateInvoiceMutation.isPending || createDraftMutation.isPending}
              className="bg-accent-orange text-white px-10 py-4 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-accent-orange/90 transition-all shadow-2xl shadow-accent-orange/30 disabled:opacity-50 active:scale-95 flex items-center gap-2"
            >
              {(createInvoiceMutation.isPending || updateInvoiceMutation.isPending) && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {editingInvoiceId 
                ? t('save_changes')
                : t('dialog.save_and_post')}
            </button>
          </div>
        </form>
      </Dialog>

      {/* PROFESSIONAL PREVIEW DIALOG */}
      <Dialog
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={t('preview.title')}
        size="full"
      >
        {selectedInvoice && (
          <div className="space-y-6 flex flex-col items-center justify-center p-6 bg-slate-100 border border-slate-200 rounded-2xl overflow-auto">
            <div className="bg-white text-slate-950 p-[17.6mm] relative overflow-hidden invoice-preview font-sans w-[210mm] min-h-[297mm] h-[297mm] border border-slate-200 flex flex-col box-border shadow-md select-none">
              {(() => {
                const isDraftStatus = selectedInvoice.payment_status === 'draft';
                if (!isDraftStatus) return null;
                return (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10 overflow-hidden opacity-[0.06] rotate-[-45deg]">
                    <span className="text-[120px] font-black tracking-[0.1em] text-slate-800 uppercase">
                      ENTWURF
                    </span>
                  </div>
                );
              })()}
              {/* Professional Invoice Content Header */}
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
                    {myCompany?.full_legal_name || t('preview.issuer_name_fallback', { defaultValue: 'LOUIS Systems GmbH' })}
                  </div>
                  <div className="mt-[2mm] text-[10pt] text-slate-500 font-normal space-y-[0.5mm] leading-snug">
                    <div>
                      {myCompany?.street || t('preview.issuer_street_fallback', { defaultValue: 'Friedrichstr.' })}{' '}
                      {myCompany?.house_number || t('preview.issuer_house_fallback', { defaultValue: '100' })}
                    </div>
                    <div>
                      {myCompany?.postal_code || t('preview.issuer_postal_fallback', { defaultValue: '10117' })}{' '}
                      {myCompany?.city || t('preview.issuer_city_fallback', { defaultValue: 'Berlin' })}
                    </div>
                    <div>{myCompany?.country_code === 'DE' ? 'Deutschland' : (myCompany?.country_code || t('preview.issuer_country_fallback', { defaultValue: 'DE' }))}</div>
                  </div>
                </div>
              </div>

              {/* Recipient & Info Bar */}
              <div className="grid grid-cols-2 gap-[15mm] mb-[10mm] items-start font-sans">
                <div>
                  {/* Small sender address line above recipient name */}
                  <div className="text-[7pt] text-slate-400 font-normal tracking-tight mb-[2mm] uppercase select-none border-b border-slate-100 pb-[1mm]">
                    {(myCompany?.full_legal_name || t('preview.issuer_name_fallback', { defaultValue: 'LOUIS Systems GmbH' }))} • {(myCompany?.street || t('preview.issuer_street_fallback', { defaultValue: 'Friedrichstr.' }))} {(myCompany?.house_number || t('preview.issuer_house_fallback', { defaultValue: '100' }))} • {(myCompany?.postal_code || t('preview.issuer_postal_fallback', { defaultValue: '10117' }))} {(myCompany?.city || t('preview.issuer_city_fallback', { defaultValue: 'Berlin' }))}
                  </div>
                  
                  {/* Firmenname / Recipient */}
                  <div className="text-[11pt] font-bold text-slate-900 leading-tight">
                    {selectedInvoiceCompany || selectedInvoice.company_name || '—'}
                  </div>
                  
                  {/* Ansprechpartner */}
                  {(selectedInvoiceContact || selectedInvoice.contact_full_name) && (
                    <div className="text-[10pt] text-slate-500 font-bold mt-[1mm]">
                      {t('preview.attn') || 'z.Hd.:'} {selectedInvoiceContact || selectedInvoice.contact_full_name}
                    </div>
                  )}

                  {/* Adresse */}
                  {selectedInvoiceCompanyObj ? (
                    <div className="text-[10pt] text-slate-500 mt-[2mm] space-y-[0.5mm] font-normal leading-relaxed">
                      <div>{selectedInvoiceCompanyObj.street} {selectedInvoiceCompanyObj.house_number || ''}</div>
                      <div>{selectedInvoiceCompanyObj.postal_code} {selectedInvoiceCompanyObj.city}</div>
                      {selectedInvoiceCompanyObj.country_code && <div>{selectedInvoiceCompanyObj.country_code === 'DE' ? 'Deutschland' : selectedInvoiceCompanyObj.country_code}</div>}
                    </div>
                  ) : (
                    <div className="text-[10pt] text-slate-500 mt-[2mm] space-y-[0.5mm] font-normal leading-relaxed">
                      <div>{t('preview.fallback_recipient_street', { defaultValue: 'Beispielstraße 42' })}</div>
                      <div>{t('preview.fallback_recipient_city', { defaultValue: '12345 Musterstadt' })}</div>
                      <div>{t('preview.fallback_recipient_country', { defaultValue: 'Deutschland' })}</div>
                    </div>
                  )}

                  {selectedInvoice.leitweg_id && (
                    <div className="text-[8pt] text-teal-600 font-bold mt-[3mm] uppercase tracking-wider">
                      {t('companies:fields.leitweg_id') || 'Leitweg-ID'}: {selectedInvoice.leitweg_id}
                    </div>
                  )}
                </div>

                <div>
                  <h1 className="text-[12pt] font-bold uppercase tracking-wider text-slate-900 mb-[2mm] text-right">
                    {t('preview.document_title')}
                  </h1>
                  <div className="bg-slate-50 p-[4mm] rounded-none border border-slate-200 flex flex-col justify-between font-sans w-[215pt] h-[128pt] box-border ml-auto">
                    <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.invoice_number')}:</span>
                      <span className="text-[8pt] font-bold text-slate-900">{selectedInvoice.invoice_number}</span>
                    </div>
                    <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.company_short_code', { defaultValue: 'Kürzel' })}:</span>
                      <span className="text-[8pt] font-bold text-slate-900">
                        {(() => {
                          try {
                            if (!selectedInvoice.metadata) return '--';
                            const meta = typeof selectedInvoice.metadata === 'string' 
                              ? JSON.parse(selectedInvoice.metadata) 
                              : (selectedInvoice.metadata as Record<string, any>);
                            return meta?.company_short_code || '--';
                          } catch (_) {
                            return '--';
                          }
                        })()}
                      </span>
                    </div>
                    <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.date')}:</span>
                      <span className="text-[8pt] font-bold text-slate-900">{new Date(selectedInvoice.issue_date).toLocaleDateString(i18n.language)}</span>
                    </div>
                    <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.service_date')}:</span>
                      <span className="text-[8pt] font-bold text-slate-900">{new Date(selectedInvoice.service_date || selectedInvoice.issue_date).toLocaleDateString(i18n.language)}</span>
                    </div>
                    <div className="flex justify-between items-center py-[1mm] border-b border-slate-200">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.payment_term')}:</span>
                      <span className="text-[8pt] font-bold text-slate-900">{selectedInvoice.payment_term || '14'} {t('dialog.days_14').split(' ')[1]}</span>
                    </div>
                    <div className="flex justify-between items-center py-[1mm]">
                      <span className="text-[8pt] font-bold text-slate-500 uppercase tracking-wider">{t('preview.bank_account')}:</span>
                      <span className="text-[8pt] font-bold text-slate-900 uppercase tracking-tighter">{selectedInvoice.bank_account || 'SPARKASSE'}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Introductory Text */}
              {selectedInvoice.introductory_text && (
                <div className="mb-[5mm] text-[9pt] font-normal text-slate-900 leading-normal max-w-2xl whitespace-pre-line">
                  {selectedInvoice.introductory_text}
                </div>
              )}

              {/* Table */}
              <div className="mb-[5mm]">
                <table className="w-full text-left table-fixed">
                  <thead>
                    <tr className="bg-slate-50 border border-slate-200">
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-left w-[6%]">{t('preview.pos')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-left w-[36%]">{t('description')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[7%]">{t('quantity')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[8%]">{t('preview.unit')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[15%]">{t('unit_price')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-center w-[10%]">{t('preview.mwst')}</th>
                      <th className="py-2 px-3 text-[8pt] font-bold uppercase tracking-wider text-slate-500 text-right w-[18%]">{t('preview.total')} {t('preview.net')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {JSON.parse(selectedInvoice.invoice_line_items_json || '[]').map((item: LineItem, i: number) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-500 text-left w-[6%]">{i + 1}</td>
                        <td className="py-2.5 px-3 text-[9pt] text-slate-900 text-left w-[36%]">
                          {renderDescriptionInPreview(item.description)}
                        </td>
                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[7%]">{item.quantity}</td>
                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[8%]">{getUnitDisplay(item.unit_code, t)}</td>
                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-900 text-right w-[15%]">{formatCurrency(item.unit_price)}</td>
                        <td className="py-2.5 px-3 text-[9pt] font-normal text-slate-500 text-center w-[10%]">{item.vat_rate || selectedInvoice.vat_rate}%</td>
                        <td className="py-2.5 px-3 text-[9pt] font-bold text-slate-900 text-right w-[18%]">{formatCurrency(item.total_net || (item.quantity * item.unit_price))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end mb-[8mm]">
                <div className="w-[80mm] space-y-[2mm]">
                  <div className="flex justify-between text-[8pt] font-bold text-slate-500 uppercase tracking-wider px-2">
                    <span>{t('dialog.total_excl_vat')}:</span>
                    <span className="text-[9pt] font-normal text-slate-900">{formatCurrency(selectedInvoice.total_net_amount)}</span>
                  </div>
                  <div className="flex justify-between text-[8pt] font-bold text-slate-500 uppercase tracking-wider px-2">
                    <span>{t('preview.total_vat_label')} ({selectedInvoice.vat_rate}%):</span>
                    <span className="text-[9pt] font-normal text-slate-900">{formatCurrency(selectedInvoice.total_vat_amount)}</span>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 px-2 py-[2mm] rounded-none flex justify-between items-center h-[22pt] box-border">
                    <span className="text-[9pt] font-bold text-slate-900 uppercase tracking-wider">{t('preview.total_gross')}:</span>
                    <span className="text-[9pt] font-bold text-slate-900 uppercase tracking-wider">{formatCurrency(selectedInvoice.total_gross_amount)}</span>
                  </div>
                </div>
              </div>

              {/* Closing Sentence */}
              {selectedInvoice.closing_text && (
                <div className="mb-[5mm] text-[9pt] font-normal text-slate-900 leading-normal max-w-2xl whitespace-pre-line">
                  {selectedInvoice.closing_text}
                </div>
              )}

              {/* Payment Footer */}
              <div className="mt-auto border-t border-slate-200 pt-4 pb-2 text-[7pt] text-slate-500 font-sans tracking-tight leading-relaxed flex justify-between items-start">
                {/* Column 1 */}
                <div className="w-[180pt]">
                  <div className="font-bold text-slate-600 uppercase mb-1">
                    {t('preview.tax_info_label', { defaultValue: 'STEUERNUMMER & UST-IDNR.' })}
                  </div>
                  <div>
                    {myCompany?.tax_vat_id && (
                      <div>{t('preview.vat_id_prefix', { defaultValue: 'USt-IdNr.:' })} {myCompany.tax_vat_id}</div>
                    )}
                    {myCompany?.tax_number && (
                      <div>{t('preview.tax_number_prefix', { defaultValue: 'Steuernummer:' })} {myCompany.tax_number}</div>
                    )}
                    {!myCompany?.tax_vat_id && !myCompany?.tax_number && (
                      <div>{t('preview.vat_id_prefix', { defaultValue: 'USt-IdNr.:' })} DE999999999</div>
                    )}
                  </div>
                </div>
                
                {/* Column 2 */}
                <div className="w-[180pt]">
                  <div className="font-bold text-slate-600 uppercase mb-1">{t('preview.bank_details')}</div>
                  <div>
                    <div>IBAN: {myCompany?.iban || t('preview.fallback_iban', { defaultValue: 'DE89 1005 0000 0123 4567 89' })}</div>
                    <div>BIC: {myCompany?.bic_swift || t('preview.fallback_bic', { defaultValue: 'WELADED1100' })} • Bank: {myCompany?.bank_name || t('preview.fallback_bank_name', { defaultValue: 'Sparkasse Berlin' })}</div>
                  </div>
                </div>

                {/* Column 3 */}
                <div className="text-right">
                  <div className="font-bold text-slate-600 uppercase mb-1">{t('preview.support')}</div>
                  <div>
                    <div>{myCompany?.email_address || 'billing@louis-systems.de'}</div>
                    <div>{myCompany?.phone_number || '+49 30 123 456 78'}</div>
                    <div>{myCompany?.website || 'www.louis-crm.de'}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-6 border-t border-slate-800">
               <button 
                 onClick={() => setIsPreviewOpen(false)}
                 className="px-8 py-3 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
               >
                 {t('preview.close')}
               </button>
               <button 
                onClick={() => {
                  if (selectedInvoice) {
                    generatePdfMutation.mutate({ invoiceId: selectedInvoice.id_uuid, locale: i18n.language });
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
                {t('preview.pdf_export')}
              </button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        isOpen={activeItemDescEditIdx !== null}
        onClose={() => setActiveItemDescEditIdx(null)}
        title={t('invoices:item_desc_editor_title', { defaultValue: 'Position-Beschreibung gestalten' })}
      >
        <div className="space-y-6 pt-4">
          <div className="flex items-center gap-4 bg-primary-light/50 p-4 rounded-xl border border-white/5 justify-between">
            <div className="flex flex-col">
              <span className="text-xs font-black text-white uppercase tracking-wider">{t('invoices:layout_structure', { defaultValue: 'Layout-Struktur' })}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">{t('invoices:columns_count_desc', { defaultValue: 'Spaltenanzahl für diese Position festlegen' })}</span>
            </div>
            <div className="flex items-center gap-2 bg-primary-dark/60 p-1.5 rounded-xl border border-white/10">
              <button
                type="button"
                onClick={() => handleSwitchLayout('single')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-2",
                  descEditLayout === 'single' ? "bg-accent-blue text-white" : "text-slate-400 hover:text-white"
                )}
              >
                {t('invoices:columns_single', { defaultValue: 'Eine Spalte' })}
              </button>
              <button
                type="button"
                onClick={() => handleSwitchLayout('double')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-2",
                  descEditLayout === 'double' ? "bg-accent-blue text-white" : "text-slate-400 hover:text-white"
                )}
              >
                <Columns size={12} />
                {t('invoices:columns_double', { defaultValue: 'Zwei Spalten' })}
              </button>
            </div>
          </div>

          {/* Formatting Toolbar */}
          <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 rounded-t-xl">
            <button
              type="button"
              onClick={() => handleExecCmd('bold')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('invoices:editor_bold', { defaultValue: 'Fett' })}
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleExecCmd('italic')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('invoices:editor_italic', { defaultValue: 'Kursiv' })}
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              onClick={() => handleExecCmd('underline')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('invoices:editor_underline', { defaultValue: 'Unterstrichen' })}
            >
              <Underline size={13} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => handleExecCmd('insertUnorderedList')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('invoices:editor_list', { defaultValue: 'Liste' })}
            >
              <List size={13} />
            </button>
          </div>

          {descEditLayout === 'double' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
              <div className="space-y-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] font-display ml-2">{t('invoices:editor_col1_title', { defaultValue: 'Spalte 1 (Links) - Fett / Highlight' })}</span>
                <div 
                  key={activeItemDescEditIdx + "-left-" + descEditLayout}
                  ref={leftEditorRef}
                  contentEditable
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-b-xl px-4 py-4 text-white min-h-[160px] max-h-[250px] overflow-y-auto focus:outline-none focus:border-accent-blue transition-all"
                  style={{ outline: 'none' }}
                  dangerouslySetInnerHTML={{ __html: initialLeftHtml }}
                />
              </div>
              <div className="space-y-2">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] font-display ml-2">{t('invoices:editor_col2_title', { defaultValue: 'Spalte 2 (Rechts) - Details / Normal' })}</span>
                <div 
                  key={activeItemDescEditIdx + "-right-" + descEditLayout}
                  ref={rightEditorRef}
                  contentEditable
                  className="w-full bg-primary-dark/60 border border-white/10 rounded-b-xl px-4 py-4 text-white min-h-[160px] max-h-[250px] overflow-y-auto focus:outline-none focus:border-accent-blue transition-all"
                  style={{ outline: 'none' }}
                  dangerouslySetInnerHTML={{ __html: initialRightHtml }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2 pb-4">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] font-display ml-2">{t('invoices:editor_desc_text', { defaultValue: 'Beschreibungstext' })}</span>
              <div 
                key={activeItemDescEditIdx + "-single-" + descEditLayout}
                ref={singleEditorRef}
                contentEditable
                className="w-full bg-primary-dark/60 border border-white/10 rounded-b-xl px-5 py-5 text-white min-h-[160px] max-h-[250px] overflow-y-auto focus:outline-none focus:border-accent-blue transition-all"
                style={{ outline: 'none' }}
                dangerouslySetInnerHTML={{ __html: initialSingleHtml }}
              />
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => setActiveItemDescEditIdx(null)}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
            >
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleSaveDescEditor}
              className="bg-accent-blue text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-accent-blue-hover transition-all shadow-xl shadow-accent-blue/10 active:scale-95"
            >
              Übernehmen
            </button>
          </div>
        </div>
      </Dialog>

      <MailDialog
        isOpen={isMailDialogOpen}
        onClose={() => {
          setIsMailDialogOpen(false);
          setMailSelectedInvoice(null);
        }}
        recipientEmail={mailRecipientEmail}
        recipientName={mailRecipientName}
        invoice={mailSelectedInvoice || undefined}
      />

      <Dialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => {
          setIsDeleteConfirmOpen(false);
          setInvoiceToDelete(null);
        }}
        title={t('invoices:delete_modal.title', { defaultValue: 'Rechnung löschen' })}
        size="md"
      >
        <div className="space-y-6 pt-4 text-left">
          {invoiceToDelete && latestInvoice && invoiceToDelete.payment_status !== 'draft' && invoiceToDelete.id_uuid !== latestInvoice.id_uuid ? (
            <>
              <div className="flex items-start gap-4 bg-red-500/10 p-5 rounded-xl border border-red-500/20">
                <div className="text-red-500 mt-0.5 shrink-0">
                  <Info size={24} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-black text-red-500 uppercase tracking-wider">{t('invoices:delete_modal.not_allowed_title', { defaultValue: 'Löschen nicht zulässig' })}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium font-sans">
                    {t('invoices:delete_modal.not_allowed_desc1', { defaultValue: 'Diese Rechnung ' })}
                    <span className="font-mono text-red-400 font-bold">{invoiceToDelete.invoice_number}</span>
                    {t('invoices:delete_modal.not_allowed_desc2', { defaultValue: ' kann nicht gelöscht werden, da sie nicht die letzte erstellte Rechnung im Nummernkreis ist.' })}
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium font-sans">
                    {t('invoices:delete_modal.not_allowed_gobd_desc', { defaultValue: 'Um Lücken im Nummernkreis zu vermeiden und die GoBD-Konformität zu wahren, darf immer nur die allerletzte Rechnung gelöscht werden.' })}
                  </p>
                  <div className="pt-2 flex items-center gap-1.5 text-xs text-slate-300 font-bold font-sans">
                    <span>{t('invoices:delete_modal.allowed_to_delete', { defaultValue: 'Erlaubt zu löschen:' })}</span>
                    <span className="font-mono bg-primary-dark/80 px-2 py-1 rounded text-accent-orange border border-white/5">{latestInvoice.invoice_number}</span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setInvoiceToDelete(null);
                  }}
                  className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-900 border border-slate-800"
                >
                  {t('common:close', { defaultValue: 'Schließen' })}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-4 bg-orange-500/10 p-5 rounded-xl border border-orange-500/20">
                <div className="text-orange-500 mt-0.5 shrink-0">
                  <Info size={24} />
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-black text-orange-500 uppercase tracking-wider">{t('invoices:delete_modal.warning_title', { defaultValue: 'Achtung: Unwiderruflicher Schritt' })}</h4>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium font-sans">
                    {t('invoices:delete_modal.confirm_prompt', { defaultValue: 'Möchten Sie die Rechnung' })} <span className="font-mono text-accent-orange font-bold font-black">{invoiceToDelete?.invoice_number}</span> {t('invoices:delete_modal.confirm_prompt_end', { defaultValue: 'wirklich löschen?' })}
                  </p>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium font-sans">
                    {t('invoices:delete_modal.warning_desc', { defaultValue: 'Dadurch wird der Datensatz dauerhaft aus der Datenbank gelöscht und alle im System sowie im Dokumenten-Vault hinterlegten PDF- und ZUGFeRD-Dokumente werden vernichtet.' })}
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setInvoiceToDelete(null);
                  }}
                  className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-905 border border-slate-800"
                >
                  {t('common:cancel', { defaultValue: 'Abbrechen' })}
                </button>
                <button
                  type="button"
                  disabled={deleteInvoiceMutation.isPending}
                  onClick={() => {
                    if (invoiceToDelete) {
                      deleteInvoiceMutation.mutate({ id_uuid: invoiceToDelete.id_uuid });
                    }
                  }}
                  className="bg-red-600 text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-red-700 transition-all shadow-xl shadow-red-600/10 active:scale-95 flex items-center gap-2"
                >
                  {deleteInvoiceMutation.isPending && (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  )}
                  {t('invoices:delete_modal.confirm_delete_btn', { defaultValue: 'Unwiderruflich Löschen' })}
                </button>
              </div>
            </>
          )}
        </div>
      </Dialog>

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

      <BatchExportDialog
        isOpen={isBatchExportOpen}
        onClose={() => setIsBatchExportOpen(false)}
        invoices={invoices}
        companies={companies}
        contacts={contacts}
      />
    </div>
  );
};
