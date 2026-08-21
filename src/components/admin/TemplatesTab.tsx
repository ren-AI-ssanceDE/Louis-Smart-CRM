import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { 
  FileText, 
  Signature, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Bold, 
  Italic, 
  Underline, 
  Heading1, 
  Heading2, 
  List, 
  Link, 
  Sparkles,
  Info,
  FileSpreadsheet,
  FolderOpen
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { EmailTemplate, Signature as SignatureType, InvoiceTextTemplate, InvoiceItemTemplate, OfferTextTemplate, OfferLineItem, ItemCategory } from '../../types';
import { AiTextGeneratorDialog } from '../AiTextGeneratorDialog';
import { Dialog } from '../ui/Dialog';

export interface TemplatesTabProps {
  initialSection?: 'templates' | 'signatures' | 'invoice_texts' | 'invoice_items' | 'offer_texts';
}

export const TemplatesTab = ({ initialSection }: TemplatesTabProps = {}) => {
  const { t } = useTranslation(['admin', 'common', 'invoices', 'companies', 'offers']);
  const utils = trpc.useContext();
  
  // Tab control: 'templates' | 'signatures' | 'invoice_texts' | 'invoice_items' | 'offer_texts'
  const [activeSubSection, setActiveSubSection] = useState<'templates' | 'signatures' | 'invoice_texts' | 'invoice_items' | 'offer_texts'>(
    (initialSection as string) === 'offer_templates' ? 'offer_texts' : (initialSection || 'templates')
  );

  useEffect(() => {
    if (initialSection) {
      setActiveSubSection((initialSection as string) === 'offer_templates' ? 'offer_texts' : initialSection);
    }
  }, [initialSection]);
  
  // Selected fields for adding tags
  const [lastFocusedField, setLastFocusedField] = useState<'subject' | 'body'>('body');

  // AI copywriting states
  const [aiFieldId, setAiFieldId] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [aiValue, setAiValue] = useState('');

  // Delete confirmation dialog states
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteTargetType, setDeleteTargetType] = useState<'template' | 'signature' | 'invoice_text' | 'invoice_item' | 'offer_text' | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteTargetName, setDeleteTargetName] = useState<string>('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');

  // Queries
  const { data: templates = [], isLoading: loadingTemplates } = trpc.getEmailTemplates.useQuery();
  const { data: signatures = [], isLoading: loadingSignatures } = trpc.getSignatures.useQuery();
  const { data: invoiceTexts = [], isLoading: loadingInvoiceTexts } = trpc.getInvoiceTextTemplates.useQuery();
  const { data: invoiceItems = [], isLoading: loadingInvoiceItems } = trpc.getInvoiceItemTemplates.useQuery();
  const { data: offerTexts = [], isLoading: loadingOfferTexts } = trpc.getTemplates.useQuery();
  const { data: itemCategories = [], isLoading: loadingCategories } = trpc.getItemCategories.useQuery();

  const filteredInvoiceItems = React.useMemo(() => {
    return invoiceItems.filter((item) => {
      if (selectedCategoryFilter === 'all') return true;
      if (selectedCategoryFilter === 'none') return !item.category_id_uuid;
      return item.category_id_uuid === selectedCategoryFilter;
    });
  }, [invoiceItems, selectedCategoryFilter]);

  // Item Category Mutations
  const createCategoryMutation = trpc.createItemCategory.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_category', { defaultValue: 'Kategorie erfolgreich erstellt' }));
      utils.getItemCategories.invalidate();
      setCategoryInputName('');
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_category', { defaultValue: 'Fehler beim Erstellen' }) + ': ' + err.message);
    }
  });

  const updateCategoryMutation = trpc.updateItemCategory.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_category', { defaultValue: 'Kategorie erfolgreich aktualisiert' }));
      utils.getItemCategories.invalidate();
      setCategoryInputName('');
      setEditingCategoryId(null);
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_update_category', { defaultValue: 'Fehler beim Aktualisieren' }) + ': ' + err.message);
    }
  });

  const deleteCategoryMutation = trpc.deleteItemCategory.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_delete_category', { defaultValue: 'Kategorie erfolgreich gelöscht' }));
      utils.getItemCategories.invalidate();
      utils.getInvoiceItemTemplates.invalidate();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_delete_category', { defaultValue: 'Fehler beim Löschen' }) + ': ' + err.message);
    }
  });

  // Mutations Invoice Item Templates
  const createInvoiceItemMutation = trpc.createInvoiceItemTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_invoice_item', { defaultValue: 'Posten-Vorlage erfolgreich erstellt' }));
      utils.getInvoiceItemTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_invoice_item', { defaultValue: 'Fehler beim Erstellen' }) + ': ' + err.message);
    }
  });

  const updateInvoiceItemMutation = trpc.updateInvoiceItemTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_invoice_item', { defaultValue: 'Posten-Vorlage erfolgreich aktualisiert' }));
      utils.getInvoiceItemTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_update_invoice_item', { defaultValue: 'Fehler beim Aktualisieren' }) + ': ' + err.message);
    }
  });

  const deleteInvoiceItemMutation = trpc.deleteInvoiceItemTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_delete_invoice_item', { defaultValue: 'Rechnungsposten-Vorlage erfolgreich gelöscht' }));
      utils.getInvoiceItemTemplates.invalidate();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_delete_invoice_item', { defaultValue: 'Fehler beim Löschen' }) + ': ' + err.message);
    }
  });

  // Mutations Templates
  const createTemplateMutation = trpc.createEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_template'));
      utils.getEmailTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_template') + ': ' + err.message);
    }
  });

  const updateTemplateMutation = trpc.updateEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_template'));
      utils.getEmailTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_update_template') + ': ' + err.message);
    }
  });

  const deleteTemplateMutation = trpc.deleteEmailTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_delete_template'));
      utils.getEmailTemplates.invalidate();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_delete_template') + ': ' + err.message);
    }
  });

  // Mutations Signatures
  const createSignatureMutation = trpc.createSignature.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_signature'));
      utils.getSignatures.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_signature') + ': ' + err.message);
    }
  });

  const updateSignatureMutation = trpc.updateSignature.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_signature'));
      utils.getSignatures.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_update_signature') + ': ' + err.message);
    }
  });

  const deleteSignatureMutation = trpc.deleteSignature.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_delete_signature'));
      utils.getSignatures.invalidate();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_delete_signature') + ': ' + err.message);
    }
  });

  // Mutations Invoice Text Templates
  const createInvoiceTextMutation = trpc.createInvoiceTextTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_invoice_text', { defaultValue: 'Rechnungstext-Vorlage erfolgreich erstellt' }));
      utils.getInvoiceTextTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_invoice_text', { defaultValue: 'Fehler beim Erstellen' }) + ': ' + err.message);
    }
  });

  const updateInvoiceTextMutation = trpc.updateInvoiceTextTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_invoice_text', { defaultValue: 'Rechnungstext-Vorlage erfolgreich aktualisiert' }));
      utils.getInvoiceTextTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_update_invoice_text', { defaultValue: 'Fehler beim Aktualisieren' }) + ': ' + err.message);
    }
  });

  const deleteInvoiceTextMutation = trpc.deleteInvoiceTextTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_delete_invoice_text', { defaultValue: 'Rechnungstext-Vorlage erfolgreich gelöscht' }));
      utils.getInvoiceTextTemplates.invalidate();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_delete_invoice_text', { defaultValue: 'Fehler beim Löschen' }) + ': ' + err.message);
    }
  });

  // Mutations Offer Text Templates
  const createOfferTextMutation = trpc.createTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('offers:toast_template_create_success', { defaultValue: 'Angebotstext-Vorlage erfolgreich erstellt' }));
      utils.getTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('common:error') + ': ' + err.message);
    }
  });

  const updateOfferTextMutation = trpc.updateTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('offers:toast_template_update_success', { defaultValue: 'Angebotstext-Vorlage erfolgreich aktualisiert' }));
      utils.getTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('common:error') + ': ' + err.message);
    }
  });

  const deleteOfferTextMutation = trpc.deleteTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('offers:toast_template_delete_success', { defaultValue: 'Angebotstext-Vorlage erfolgreich gelöscht' }));
      utils.getTemplates.invalidate();
    },
    onError: (err) => {
      toast.error(t('common:error') + ': ' + err.message);
    }
  });

  // Editing structures
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');

  const replaceMockPlaceholders = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/\{\{invoice_number\}\}/g, 'RE-2026-0042')
      .replace(/\{\{my_company_name\}\}/g, 'ACME Holding GmbH')
      .replace(/\{\{my_contact_person\}\}/g, 'Louis AI Assistent')
      .replace(/\{\{due_date\}\}/g, '24.06.2026')
      .replace(/\{\{total_gross\}\}/g, '1.450,00')
      .replace(/\{\{currency\}\}/g, 'EUR')
      .replace(/\{\{recipient_name\}\}/g, 'Max Mustermann')
      .replace(/\{\{recipient_first_name\}\}/g, 'Max')
      .replace(/\{\{recipient_last_name\}\}/g, 'Mustermann')
      .replace(/\{\{recipient_salutation\}\}/g, 'Sehr geehrter Herr Mustermann')
      .replace(/\{\{recipient_anrede\}\}/g, 'Sehr geehrter Herr Mustermann')
      .replace(/\{\{recipient_company\}\}/g, 'Muster-Holding AG')
      .replace(/\{\{recipient_street\}\}/g, 'Musterstraße 12')
      .replace(/\{\{recipient_city\}\}/g, 'Musterstadt')
      .replace(/\{\{recipient_postal_code\}\}/g, '12345')
      .replace(/\{\{recipient_plz\}\}/g, '12345')
      .replace(/\{\{recipient_address\}\}/g, 'Muster-Holding AG\nMax Mustermann\nMusterstraße 12\n12345 Musterstadt')
      .replace(/\{\{recipient_adresse\}\}/g, 'Muster-Holding AG\nMax Mustermann\nMusterstraße 12\n12345 Musterstadt')
      .replace(/\{\{recipient_email\}\}/g, 'max@musterholding.de')
      .replace(/\{\{recipient_phone\}\}/g, '+49 123 456789');
  };

  // Template Form State
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  // Signature Form State
  const [signatureName, setSignatureName] = useState('');
  const [signatureBody, setSignatureBody] = useState('');
  const [isDefaultSig, setIsDefaultSig] = useState(false);

  // Invoice Text Form State
  const [invoiceTextName, setInvoiceTextName] = useState('');
  const [invoiceTextTypeCode, setInvoiceTextTypeCode] = useState<'introductory' | 'closing'>('introductory');
  const [invoiceTextBody, setInvoiceTextBody] = useState('');

  // Invoice Item Form State
  const [itemTemplateName, setItemTemplateName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemQuantity, setItemQuantity] = useState<number>(1);
  const [itemUnitPrice, setItemUnitPrice] = useState<number>(0);
  const [itemVatRate, setItemVatRate] = useState<number>(19);
  const [itemUnitCode, setItemUnitCode] = useState<string>('HUR');
  const [itemUsageScope, setItemUsageScope] = useState<'offer' | 'invoice' | 'both'>('both');
  const [itemCategoryIdUuid, setItemCategoryIdUuid] = useState<string | null>(null);

  // Category Management Form State
  const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
  const [categoryInputName, setCategoryInputName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [confirmCategoryDeleteId, setConfirmCategoryDeleteId] = useState<string | null>(null);

  // Offer Text Form State
  const [offerTextName, setOfferTextName] = useState('');
  const [offerTextTypeCode, setOfferTextTypeCode] = useState<'introductory' | 'closing'>('introductory');
  const [offerTextBody, setOfferTextBody] = useState('');

  const editorRef = useRef<HTMLDivElement>(null);
  const invoiceTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Synchronizes contentEditable innerHTML with state if editor changes externally or mode toggled
  useEffect(() => {
    if (editorRef.current && editorMode === 'edit') {
      const activeContent = 
        activeSubSection === 'templates' 
          ? templateBody 
          : activeSubSection === 'offer_texts'
          ? offerTextBody
          : activeSubSection === 'invoice_texts'
          ? invoiceTextBody
          : activeSubSection === 'invoice_items'
          ? itemDescription
          : signatureBody;
      if (editorRef.current.innerHTML !== activeContent) {
        editorRef.current.innerHTML = activeContent || '';
      }
    }
  }, [activeSubSection, isEditing, editorMode, templateBody, signatureBody, offerTextBody, invoiceTextBody, itemDescription]);

  const handleEditorInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      if (activeSubSection === 'templates') {
        setTemplateBody(html);
      } else if (activeSubSection === 'offer_texts') {
        setOfferTextBody(html);
      } else if (activeSubSection === 'invoice_texts') {
        setInvoiceTextBody(html);
      } else if (activeSubSection === 'invoice_items') {
        setItemDescription(html);
      } else {
        setSignatureBody(html);
      }
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditId(null);
    setEditorMode('edit');
    setTemplateName('');
    setTemplateSubject('');
    setTemplateBody('');
    setSignatureName('');
    setSignatureBody('');
    setIsDefaultSig(false);
    setInvoiceTextName('');
    setInvoiceTextTypeCode('introductory');
    setInvoiceTextBody('');
    setItemTemplateName('');
    setItemDescription('');
    setItemQuantity(1);
    setItemUnitPrice(0);
    setItemVatRate(19);
    setItemUnitCode('HUR');
    setItemUsageScope('both');
    setItemCategoryIdUuid(null);
    setOfferTextName('');
    setOfferTextTypeCode('introductory');
    setOfferTextBody('');
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
  };

  const handleConfirmDelete = () => {
    if (!deleteTargetId || !deleteTargetType) return;

    if (editId === deleteTargetId) {
      resetForm();
    }

    if (deleteTargetType === 'template') {
      deleteTemplateMutation.mutate({ id_uuid: deleteTargetId });
    } else if (deleteTargetType === 'signature') {
      deleteSignatureMutation.mutate({ id_uuid: deleteTargetId });
    } else if (deleteTargetType === 'invoice_text') {
      deleteInvoiceTextMutation.mutate({ id_uuid: deleteTargetId });
    } else if (deleteTargetType === 'invoice_item') {
      deleteInvoiceItemMutation.mutate({ id_uuid: deleteTargetId });
    } else if (deleteTargetType === 'offer_text') {
      deleteOfferTextMutation.mutate({ id_uuid: deleteTargetId });
    }

    setIsDeleteOpen(false);
    setDeleteTargetId(null);
    setDeleteTargetType(null);
    setDeleteTargetName('');
  };

  const isDeletingInProgress = 
    deleteTemplateMutation.isPending || 
    deleteSignatureMutation.isPending || 
    deleteInvoiceTextMutation.isPending || 
    deleteInvoiceItemMutation.isPending ||
    deleteOfferTextMutation.isPending;

  // WYSIWYG commands
  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    handleEditorInput();
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const addLink = () => {
    const url = prompt(t('templates.prompt_link_url'));
    if (url) {
      execCmd('createLink', url);
    }
  };

  // Safe Insertion of Placeholders inside contentEditable or subject
  const insertPlaceholder = (tag: string) => {
    if (activeSubSection === 'templates' && lastFocusedField === 'subject') {
      setTemplateSubject(prev => prev + tag);
    } else {
      if (editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          
          // Use textnode or wrap in span to avoid HTML parsing issues
          const node = document.createTextNode(tag);
          range.insertNode(node);
          
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          
          handleEditorInput();
        } else {
          // If no cursor selection, append to the end
          if (activeSubSection === 'templates') {
            setTemplateBody(prev => prev + tag);
          } else {
            setSignatureBody(prev => prev + tag);
          }
          editorRef.current.innerHTML = editorRef.current.innerHTML + tag;
        }
      }
    }
  };

  const insertInvoiceTextPlaceholder = (tag: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editorRef.current.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          const node = document.createTextNode(tag);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          handleEditorInput();
          return;
        }
      }
      const html = editorRef.current.innerHTML + tag;
      editorRef.current.innerHTML = html;
      setInvoiceTextBody(html);
    } else {
      setInvoiceTextBody(prev => prev + tag);
    }
  };

  const insertOfferTextPlaceholder = (tag: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (editorRef.current.contains(range.commonAncestorContainer)) {
          range.deleteContents();
          const node = document.createTextNode(tag);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          handleEditorInput();
          return;
        }
      }
      const html = editorRef.current.innerHTML + tag;
      editorRef.current.innerHTML = html;
      setOfferTextBody(html);
    } else {
      setOfferTextBody(prev => prev + tag);
    }
  };

  // Actions for email templates
  const handleEditTemplate = (tmpl: EmailTemplate) => {
    setIsEditing(true);
    setEditId(tmpl.id_uuid);
    setTemplateName(tmpl.template_name_text);
    setTemplateSubject(tmpl.email_subject_text);
    setTemplateBody(tmpl.email_body_content);
    if (editorRef.current) {
      editorRef.current.innerHTML = tmpl.email_body_content;
    }
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateName || !templateSubject) {
      toast.error(t('templates.toast_error_required_fields'));
      return;
    }

    if (editId) {
      updateTemplateMutation.mutate({
        id_uuid: editId,
        template_name_text: templateName,
        email_subject_text: templateSubject,
        email_body_content: templateBody,
        created_by_identity: 'human',
      });
    } else {
      createTemplateMutation.mutate({
        template_name_text: templateName,
        email_subject_text: templateSubject,
        email_body_content: templateBody,
        created_by_identity: 'human',
      });
    }
  };

  // Actions for signatures
  const handleEditSignature = (sig: SignatureType) => {
    setIsEditing(true);
    setEditId(sig.id_uuid);
    setSignatureName(sig.signature_name_text);
    setSignatureBody(sig.signature_body_content);
    setIsDefaultSig(sig.is_default_signature);
    if (editorRef.current) {
      editorRef.current.innerHTML = sig.signature_body_content;
    }
  };

  const handleSaveSignature = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signatureName) {
      toast.error(t('templates.toast_error_sig_name_required'));
      return;
    }

    if (editId) {
      updateSignatureMutation.mutate({
        id_uuid: editId,
        signature_name_text: signatureName,
        signature_body_content: signatureBody,
        is_default_signature: isDefaultSig,
        created_by_identity: 'human',
      });
    } else {
      createSignatureMutation.mutate({
        signature_name_text: signatureName,
        signature_body_content: signatureBody,
        is_default_signature: isDefaultSig,
        created_by_identity: 'human',
      });
    }
  };

  const handleToggleDefaultSignature = (sig: SignatureType) => {
    updateSignatureMutation.mutate({
      id_uuid: sig.id_uuid,
      signature_name_text: sig.signature_name_text,
      signature_body_content: sig.signature_body_content,
      is_default_signature: !sig.is_default_signature,
    });
  };

  // Actions for invoice text templates
  const handleEditInvoiceText = (invoiceText: InvoiceTextTemplate) => {
    setIsEditing(true);
    setEditId(invoiceText.id_uuid || null);
    setInvoiceTextName(invoiceText.template_name_text);
    setInvoiceTextTypeCode(invoiceText.template_type_code as 'introductory' | 'closing');
    setInvoiceTextBody(invoiceText.template_body_content);
    if (editorRef.current) {
      editorRef.current.innerHTML = invoiceText.template_body_content || '';
    }
  };

  const handleSaveInvoiceText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceTextName || !invoiceTextBody) {
      toast.error(t('templates.toast_error_required_fields', { defaultValue: 'Bitte füllen Sie alle Pflichtfelder aus.' }));
      return;
    }

    if (editId) {
      updateInvoiceTextMutation.mutate({
        id_uuid: editId,
        template_name_text: invoiceTextName,
        template_type_code: invoiceTextTypeCode,
        template_body_content: invoiceTextBody,
        created_by_identity: 'human',
      });
    } else {
      createInvoiceTextMutation.mutate({
        template_name_text: invoiceTextName,
        template_type_code: invoiceTextTypeCode,
        template_body_content: invoiceTextBody,
        created_by_identity: 'human',
      });
    }
  };

  // Actions for invoice item templates
  const handleEditInvoiceItem = (item: InvoiceItemTemplate) => {
    setIsEditing(true);
    setEditId(item.id_uuid || null);
    setItemTemplateName(item.template_name_text);
    setItemDescription(item.description);
    setItemQuantity(item.quantity);
    setItemUnitPrice(item.unit_price);
    setItemVatRate(item.vat_rate);
    setItemUnitCode(item.unit_code);
    setItemUsageScope(item.usage_scope || 'both');
    setItemCategoryIdUuid(item.category_id_uuid || null);
    if (editorRef.current) {
      editorRef.current.innerHTML = item.description || '';
    }
  };

  const handleSaveInvoiceItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemTemplateName) {
      toast.error(t('templates.toast_error_required_fields', { defaultValue: 'Bitte füllen Sie alle Pflichtfelder aus.' }));
      return;
    }

    if (editId) {
      updateInvoiceItemMutation.mutate({
        id_uuid: editId,
        template_name_text: itemTemplateName,
        description: itemDescription,
        quantity: itemQuantity,
        unit_price: itemUnitPrice,
        vat_rate: itemVatRate,
        unit_code: itemUnitCode,
        usage_scope: itemUsageScope,
        category_id_uuid: itemCategoryIdUuid || null,
        created_by_identity: 'human',
      });
    } else {
      createInvoiceItemMutation.mutate({
        template_name_text: itemTemplateName,
        description: itemDescription,
        quantity: itemQuantity,
        unit_price: itemUnitPrice,
        vat_rate: itemVatRate,
        unit_code: itemUnitCode,
        usage_scope: itemUsageScope,
        category_id_uuid: itemCategoryIdUuid || null,
        created_by_identity: 'human',
      });
    }
  };

  const handleEditOfferText = (offerText: OfferTextTemplate) => {
    setIsEditing(true);
    setEditId(offerText.id_uuid || null);
    setOfferTextName(offerText.template_name_text);
    setOfferTextTypeCode(offerText.template_type_code as 'introductory' | 'closing');
    setOfferTextBody(offerText.template_body_content);
    if (editorRef.current) {
      editorRef.current.innerHTML = offerText.template_body_content || '';
    }
  };

  const handleSaveOfferText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerTextName || !offerTextBody) {
      toast.error(t('templates.toast_error_required_fields', { defaultValue: 'Bitte füllen Sie alle Pflichtfelder aus.' }));
      return;
    }

    if (editId) {
      updateOfferTextMutation.mutate({
        id_uuid: editId,
        template_name_text: offerTextName,
        template_type_code: offerTextTypeCode,
        template_body_content: offerTextBody,
        created_by_identity: 'human',
      });
    } else {
      createOfferTextMutation.mutate({
        template_name_text: offerTextName,
        template_type_code: offerTextTypeCode,
        template_body_content: offerTextBody,
        created_by_identity: 'human',
      });
    }
  };

  const templatePlaceholders = [
    { tag: '{{invoice_number}}', description: t('invoices:preview.invoice_number') },
    { tag: '{{my_company_name}}', description: t('companies:name') },
    { tag: '{{my_contact_person}}', description: t('companies:fields.responsible') },
    { tag: '{{due_date}}', description: t('invoices:preview.payment_term') },
    { tag: '{{total_gross}}', description: t('invoices:gross_amount') },
    { tag: '{{currency}}', description: t('common:currency_code', { defaultValue: 'EUR' }) },
    { tag: '{{recipient_name}}', description: t('admin:template_tag_recipient_name', { defaultValue: 'Empfänger-Name (Vollständig)' }) },
    { tag: '{{recipient_first_name}}', description: t('admin:template_tag_recipient_firstname', { defaultValue: 'Empfänger-Vorname' }) },
    { tag: '{{recipient_last_name}}', description: t('admin:template_tag_recipient_lastname', { defaultValue: 'Empfänger-Nachname' }) },
    { tag: '{{recipient_salutation}}', description: t('admin:template_tag_recipient_salutation', { defaultValue: 'Empfänger-Anrede (Sehr geehrte(r) Frau/Herr...)' }) },
    { tag: '{{recipient_company}}', description: t('admin:template_tag_recipient_company', { defaultValue: 'Empfänger-Firmenname' }) },
    { tag: '{{recipient_street}}', description: t('admin:template_tag_recipient_street', { defaultValue: 'Empfänger-Straße & Hausnummer' }) },
    { tag: '{{recipient_city}}', description: t('admin:template_tag_recipient_city', { defaultValue: 'Empfänger-Ort' }) },
    { tag: '{{recipient_postal_code}}', description: t('admin:template_tag_recipient_postal_code', { defaultValue: 'Empfänger-Postleitzahl' }) },
    { tag: '{{recipient_address}}', description: t('admin:template_tag_recipient_address', { defaultValue: 'Empfänger-Anschrift (Mehrzeilig)' }) },
    { tag: '{{recipient_email}}', description: t('admin:template_tag_recipient_email', { defaultValue: 'Empfänger-E-Mail-Adresse' }) },
    { tag: '{{recipient_phone}}', description: t('admin:template_tag_recipient_phone', { defaultValue: 'Empfänger-Telefonnummer' }) },
  ];

  const signaturePlaceholders = [
    { tag: '{{my_company_name}}', description: t('companies:name') },
    { tag: '{{my_contact_person}}', description: t('companies:fields.responsible') },
  ];

  const offerTextPlaceholders = [
    { tag: '{{offer_number}}', description: t('admin:template_tag_offer_number', { defaultValue: 'Angebotsnummer' }) },
    { tag: '{{my_company_name}}', description: t('companies:name') },
    { tag: '{{my_contact_person}}', description: t('companies:fields.responsible') },
    { tag: '{{valid_until}}', description: t('admin:template_tag_valid_until', { defaultValue: 'Gültig-bis Datum' }) },
    { tag: '{{total_gross}}', description: t('invoices:gross_amount') },
    { tag: '{{currency}}', description: t('common:currency_code', { defaultValue: 'EUR' }) },
    { tag: '{{recipient_name}}', description: t('admin:template_tag_recipient_name', { defaultValue: 'Empfänger-Name (Vollständig)' }) },
    { tag: '{{recipient_first_name}}', description: t('admin:template_tag_recipient_firstname', { defaultValue: 'Empfänger-Vorname' }) },
    { tag: '{{recipient_last_name}}', description: t('admin:template_tag_recipient_lastname', { defaultValue: 'Empfänger-Nachname' }) },
    { tag: '{{recipient_salutation}}', description: t('admin:template_tag_recipient_salutation', { defaultValue: 'Empfänger-Anrede' }) },
    { tag: '{{recipient_company}}', description: t('admin:template_tag_recipient_company', { defaultValue: 'Empfänger-Firmenname' }) },
    { tag: '{{recipient_street}}', description: t('admin:template_tag_recipient_street', { defaultValue: 'Empfänger-Straße & Hausnummer' }) },
    { tag: '{{recipient_city}}', description: t('admin:template_tag_recipient_city', { defaultValue: 'Empfänger-Ort' }) },
    { tag: '{{recipient_postal_code}}', description: t('admin:template_tag_recipient_postal_code', { defaultValue: 'Empfänger-Postleitzahl' }) },
    { tag: '{{recipient_address}}', description: t('admin:template_tag_recipient_address', { defaultValue: 'Empfänger-Anschrift (Mehrzeilig)' }) },
    { tag: '{{recipient_email}}', description: t('admin:template_tag_recipient_email', { defaultValue: 'Empfänger-E-Mail-Adresse' }) },
    { tag: '{{recipient_phone}}', description: t('admin:template_tag_recipient_phone', { defaultValue: 'Empfänger-Telefonnummer' }) },
  ];

  return (
    <div className="space-y-8" id="templates-section">
      {/* Title / Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-white/5">
        <div>
          <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display mb-1">
            {activeSubSection === 'templates' 
              ? t('templates.title_templates') 
              : activeSubSection === 'signatures'
              ? t('templates.title_signatures')
              : activeSubSection === 'invoice_texts'
              ? t('templates.title_invoice_texts', { defaultValue: 'Rechnungstexte' })
              : activeSubSection === 'invoice_items'
              ? t('templates.title_invoice_items', { defaultValue: 'Rechnungspositionen' })
              : t('templates.title_offer_texts', { defaultValue: 'Angebotstexte' })}
          </h3>
          <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
            {activeSubSection === 'templates' 
              ? t('templates.desc_templates') 
              : activeSubSection === 'signatures'
              ? t('templates.desc_signatures')
              : activeSubSection === 'invoice_texts'
              ? t('templates.desc_invoice_texts', { defaultValue: 'Vorlagen für Einleitungstext & Abschlusssatz verwalten' })
              : activeSubSection === 'invoice_items'
              ? t('templates.desc_invoice_items', { defaultValue: 'Vorlagen für häufig genutzte Rechnungsposten verwalten' })
              : t('templates.desc_offer_texts', { defaultValue: 'Vorlagen für Einleitungstext & Abschlusssatz bei Angeboten verwalten' })}
          </p>
        </div>

        {/* Section Toggles */}
        {!initialSection && (
          <div className="flex bg-primary-dark/80 p-1 rounded-xl border border-white/5 flex-wrap gap-1">
            <button
              onClick={() => { setActiveSubSection('templates'); resetForm(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubSection === 'templates'
                  ? 'bg-accent-blue text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <FileText size={14} />
              {t('templates.tab_templates')}
            </button>
            <button
              onClick={() => { setActiveSubSection('signatures'); resetForm(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubSection === 'signatures'
                  ? 'bg-accent-blue text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Signature size={14} />
              {t('templates.tab_signatures')}
            </button>
            <button
              onClick={() => { setActiveSubSection('invoice_texts'); resetForm(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubSection === 'invoice_texts'
                  ? 'bg-accent-blue text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <FileText size={14} />
              {t('templates.tab_invoice_texts', { defaultValue: 'Rechnungstexte' })}
            </button>
            <button
              onClick={() => { setActiveSubSection('invoice_items'); resetForm(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubSection === 'invoice_items'
                  ? 'bg-accent-blue text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <List size={14} />
              {t('templates.tab_invoice_items', { defaultValue: 'Posten-Vorlagen' })}
            </button>
            <button
              onClick={() => { setActiveSubSection('offer_texts'); resetForm(); }}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                activeSubSection === 'offer_texts'
                  ? 'bg-accent-blue text-white shadow-lg'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <FileSpreadsheet size={14} />
              {t('templates.tab_offer_texts', { defaultValue: 'Angebotstexte' })}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
        {/* Left Side: List of Items */}
        <div className="xl:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
              {activeSubSection === 'templates' 
                ? t('templates.saved_templates') 
                : activeSubSection === 'signatures'
                ? t('templates.saved_signatures')
                : activeSubSection === 'invoice_texts'
                ? t('templates.saved_invoice_texts', { defaultValue: 'Gespeicherte Rechnungstexte' })
                : activeSubSection === 'invoice_items'
                ? t('templates.saved_invoice_items', { defaultValue: 'Gespeicherte Posten-Vorlagen' })
                : t('templates.saved_offer_texts', { defaultValue: 'Gespeicherte Angebotstexte' })}
            </h4>
            {!isEditing && (
              <button
                onClick={() => {
                  setIsEditing(true);
                  setEditId(null);
                  if (activeSubSection === 'templates') {
                    setTemplateName('');
                    setTemplateSubject('');
                    setTemplateBody('');
                  } else if (activeSubSection === 'signatures') {
                    setSignatureName('');
                    setSignatureBody('');
                    setIsDefaultSig(false);
                  } else if (activeSubSection === 'invoice_texts') {
                    setInvoiceTextName('');
                    setInvoiceTextTypeCode('introductory');
                    setInvoiceTextBody('');
                  } else if (activeSubSection === 'invoice_items') {
                    setItemTemplateName('');
                    setItemDescription('');
                    setItemQuantity(1);
                    setItemUnitPrice(0);
                    setItemVatRate(19);
                    setItemUnitCode('HUR');
                  } else {
                    setOfferTextName('');
                    setOfferTextTypeCode('introductory');
                    setOfferTextBody('');
                  }
                  if (editorRef.current) editorRef.current.innerHTML = '';
                }}
                className="p-2 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue rounded-lg border border-accent-blue/20 transition-all flex items-center gap-1.5 text-[10px] uppercase font-black tracking-wider"
              >
                <Plus size={14} />
                {t('templates.new_record')}
              </button>
            )}
          </div>

          {activeSubSection === 'invoice_items' && (
            <div className="flex gap-2 items-center pb-2">
              <select
                value={selectedCategoryFilter}
                onChange={(e) => setSelectedCategoryFilter(e.target.value)}
                className="flex-1 bg-primary-dark/60 border border-white/10 rounded-xl px-4 py-2.5 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-xs custom-scrollbar"
              >
                <option value="all">{t('templates.category_filter_all', { defaultValue: 'Alle Kategorien' })}</option>
                <option value="none">{t('templates.item_category_none', { defaultValue: 'Keine Kategorie' })}</option>
                {itemCategories.map((cat) => (
                  <option key={cat.id_uuid} value={cat.id_uuid}>
                    {cat.category_name_text}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setIsManageCategoriesOpen(true)}
                className="p-2.5 bg-primary-dark border border-white/10 text-slate-400 hover:text-white rounded-xl transition-all text-xs flex items-center gap-1.5 font-bold font-display"
                title={t('templates.manage_categories_btn', { defaultValue: 'Kategorien verwalten' }) || ''}
              >
                <FolderOpen size={14} />
                <span className="hidden sm:inline">{t('templates.manage_categories_btn', { defaultValue: 'Kategorien' })}</span>
              </button>
            </div>
          )}

          <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
            {activeSubSection === 'templates' ? (
              templates.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_templates')}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_templates_desc')}</p>
                </div>
              ) : (
                templates.map((tmpl) => (
                  <div
                    key={tmpl.id_uuid}
                    className={`p-5 rounded-xl border transition-all ${
                      editId === tmpl.id_uuid
                        ? 'bg-accent-blue/10 border-accent-blue'
                        : 'bg-primary-light/30 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white text-sm truncate">{tmpl.template_name_text}</p>
                        <p className="text-[10px] font-mono text-slate-500 mt-1 truncate">{t('admin:mail.subject')}: {tmpl.email_subject_text}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleEditTemplate(tmpl as EmailTemplate)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                          title={t('common:edit') || 'Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTargetType('template');
                            setDeleteTargetId(tmpl.id_uuid!);
                            setDeleteTargetName(tmpl.template_name_text);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange rounded-lg transition-colors"
                          title={t('common:discard') || 'Delete'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : activeSubSection === 'signatures' ? (
              signatures.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_signatures')}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_signatures_desc')}</p>
                </div>
              ) : (
                signatures.map((sig) => (
                  <div
                    key={sig.id_uuid}
                    className={`p-5 rounded-xl border transition-all ${
                      editId === sig.id_uuid
                        ? 'bg-accent-blue/10 border-accent-blue'
                        : 'bg-primary-light/30 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-white text-sm truncate">{sig.signature_name_text}</p>
                          {sig.is_default_signature && (
                            <span className="bg-accent-blue/10 text-accent-blue border border-accent-blue/20 text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">{t('templates.standard_badge')}</span>
                          )}
                        </div>
                        <div 
                           className="text-[10px] text-slate-500 mt-1.5 line-clamp-2 max-w-full italic"
                          dangerouslySetInnerHTML={{ __html: sig.signature_body_content || '' }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!sig.is_default_signature && (
                          <button
                            onClick={() => handleToggleDefaultSignature(sig as SignatureType)}
                            className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-accent-blue rounded-lg transition-colors text-[10px] font-black uppercase tracking-wider"
                            title={t('templates.set_default') || 'Set Default'}
                          >
                            <Check size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditSignature(sig as SignatureType)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                          title={t('common:edit') || 'Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTargetType('signature');
                            setDeleteTargetId(sig.id_uuid!);
                            setDeleteTargetName(sig.signature_name_text);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange rounded-lg transition-colors"
                          title={t('common:discard') || 'Delete'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : activeSubSection === 'invoice_texts' ? (
              invoiceTexts.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_invoice_texts', { defaultValue: 'Keine Rechnungstexte gefunden' })}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_invoice_texts_desc', { defaultValue: 'Erstellen Sie Ihre erste Vorlage für Rechnungseinleitung oder -schlusssatz.' })}</p>
                </div>
              ) : (
                invoiceTexts.map((it) => (
                  <div
                    key={it.id_uuid}
                    className={`p-5 rounded-xl border transition-all ${
                      editId === it.id_uuid
                        ? 'bg-accent-blue/10 border-accent-blue'
                        : 'bg-primary-light/30 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-white text-sm truncate">{it.template_name_text}</p>
                          <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            it.template_type_code === 'introductory'
                              ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20'
                              : 'bg-accent-orange/10 text-accent-orange border-accent-orange/20'
                          }`}>
                            {it.template_type_code === 'introductory' ? t('templates.type_introductory', { defaultValue: 'Einleitung' }) : t('templates.type_closing', { defaultValue: 'Abschluss' })}
                          </span>
                        </div>
                        <div 
                          className="text-[10px] text-slate-500 mt-2 line-clamp-2 italic"
                          dangerouslySetInnerHTML={{ __html: it.template_body_content || '' }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleEditInvoiceText(it as InvoiceTextTemplate)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                          title={t('common:edit') || 'Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTargetType('invoice_text');
                            setDeleteTargetId(it.id_uuid!);
                            setDeleteTargetName(it.template_name_text);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange rounded-lg transition-colors"
                          title={t('common:discard') || 'Delete'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            ) : activeSubSection === 'invoice_items' ? (
              filteredInvoiceItems.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_invoice_items', { defaultValue: 'Keine Posten-Vorlagen gefunden' })}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_invoice_items_desc', { defaultValue: 'Erstellen Sie Vorlagen für häufig genutzte Posten (z.B. Beratung, Entwicklung).' })}</p>
                </div>
              ) : (
                filteredInvoiceItems.map((item) => {
                  const category = itemCategories.find(c => c.id_uuid === item.category_id_uuid);
                  return (
                    <div
                      key={item.id_uuid}
                      className={`p-5 rounded-xl border transition-all ${
                        editId === item.id_uuid
                          ? 'bg-accent-blue/10 border-accent-blue'
                          : 'bg-primary-light/30 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1 col-span-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-bold text-white text-sm truncate">{item.template_name_text}</p>
                            <span className="bg-primary-light border border-white/5 text-slate-400 text-[8px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0">
                              {item.quantity} {t(`invoices:units.${item.unit_code || 'HUR'}`, { defaultValue: item.unit_code })}
                            </span>
                          </div>
                          {item.description && (
                            <p className="text-[10px] text-slate-500 mt-2 line-clamp-2 italic">{item.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                            <span className="text-[10px] text-slate-400 font-mono">
                              {t('invoices:unit_price', { defaultValue: 'Einzelpreis' })}: {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(item.unit_price)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">•</span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {t('invoices:vat_rate', { defaultValue: 'MwSt.' })}: {item.vat_rate}%
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-3">
                            <span className={`text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                              item.usage_scope === 'offer'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                                : item.usage_scope === 'invoice'
                                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25'
                                : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            }`}>
                              {item.usage_scope === 'offer'
                                ? t('templates.item_usage_scope_offer', { defaultValue: 'Nur Angebote' })
                                : item.usage_scope === 'invoice'
                                ? t('templates.item_usage_scope_invoice', { defaultValue: 'Nur Rechnungen' })
                                : t('templates.item_usage_scope_both', { defaultValue: 'Angebote & Rechnungen' })}
                            </span>
                            {category && (
                              <span className="bg-slate-500/10 text-slate-300 border border-slate-500/25 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md">
                                {category.category_name_text}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleEditInvoiceItem(item as InvoiceItemTemplate)}
                            className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('common:edit') || 'Edit'}
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            onClick={() => {
                              setDeleteTargetType('invoice_item');
                              setDeleteTargetId(item.id_uuid!);
                              setDeleteTargetName(item.template_name_text);
                              setIsDeleteOpen(true);
                            }}
                            className="p-1.5 hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange rounded-lg transition-colors"
                            title={t('common:discard') || 'Delete'}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              // offer_texts
              offerTexts.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_offer_texts', { defaultValue: 'Keine Angebotstexte gefunden' })}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_offer_texts_desc', { defaultValue: 'Erstellen Sie Ihre erste Vorlage für Angebotseinleitung oder -schlusssatz.' })}</p>
                </div>
              ) : (
                offerTexts.map((it) => (
                  <div
                    key={it.id_uuid}
                    className={`p-5 rounded-xl border transition-all ${
                      editId === it.id_uuid
                        ? 'bg-accent-blue/10 border-accent-blue'
                        : 'bg-primary-light/30 border-white/5 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-white text-sm truncate">{it.template_name_text}</p>
                          <span className={`border text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            it.template_type_code === 'introductory'
                              ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/20'
                              : 'bg-accent-orange/10 text-accent-orange border-accent-orange/20'
                          }`}>
                            {it.template_type_code === 'introductory' ? t('templates.type_introductory', { defaultValue: 'Einleitung' }) : t('templates.type_closing', { defaultValue: 'Abschluss' })}
                          </span>
                        </div>
                        <div 
                          className="text-[10px] text-slate-500 mt-2 line-clamp-2 italic"
                          dangerouslySetInnerHTML={{ __html: it.template_body_content || '' }}
                        />
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleEditOfferText(it as OfferTextTemplate)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                          title={t('common:edit') || 'Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTargetType('offer_text');
                            setDeleteTargetId(it.id_uuid!);
                            setDeleteTargetName(it.template_name_text);
                            setIsDeleteOpen(true);
                          }}
                          className="p-1.5 hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange rounded-lg transition-colors"
                          title={t('common:discard') || 'Delete'}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>

        {/* Right Side: Create/Edit Area */}
        <div className="xl:col-span-7">
          {isEditing ? (
            <div className="bg-primary-light/20 border border-white/5 rounded-xl p-8 space-y-6 shadow-inner">
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <div className="flex items-center gap-1.5 text-accent-blue">
                  <Sparkles size={16} />
                  <span className="text-[10px] font-black uppercase tracking-widest font-display">
                    {editId ? t('templates.edit_entry') : t('templates.create_entry')}
                  </span>
                </div>
                <button
                  onClick={resetForm}
                  className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-all text-[9px] uppercase tracking-widest font-black"
                >
                  <X size={12} />
                  {t('templates.close')}
                </button>
              </div>

              {activeSubSection === 'templates' ? (
                <form onSubmit={handleSaveTemplate} className="space-y-6">
                  {/* Internal Template Name */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_template_name')}
                    </label>
                    <input 
                      type="text" 
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_template_name_placeholder') || ''}
                      required
                    />
                  </div>

                  {/* Subject Line */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_subject')}
                    </label>
                    <input 
                      type="text" 
                      value={templateSubject}
                      onChange={(e) => setTemplateSubject(e.target.value)}
                      onFocus={() => setLastFocusedField('subject')}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_subject_placeholder') || ''}
                      required
                    />
                  </div>

                  {/* Placeholders helper widget */}
                  <div className="space-y-3 p-4 bg-primary-dark/40 border border-white/5 rounded-xl">
                    <div className="flex items-center gap-2 text-accent-blue">
                      <Info size={14} />
                      <span className="text-[9px] font-mono tracking-wider font-extrabold uppercase">{t('templates.placeholders_helper_title')}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">
                      {t('templates.placeholders_helper_desc')}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {templatePlaceholders.map((ph) => (
                        <button
                          key={ph.tag}
                          type="button"
                          onClick={() => insertPlaceholder(ph.tag)}
                          className="px-2.5 py-1.5 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/10 hover:border-accent-blue/30 rounded-lg text-[9px] font-mono font-black tracking-tighter transition-all flex items-center gap-1.5"
                          title={ph.description || ''}
                        >
                          {ph.tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* WYSIWYG Content Editor */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                        {t('templates.input_body')}
                      </label>
                      <div className="flex bg-primary-dark/85 p-0.5 rounded-lg border border-white/5 gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditorMode('edit')}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            editorMode === 'edit'
                              ? 'bg-accent-blue text-white shadow'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {t('templates.editor_mode_edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorMode('preview')}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            editorMode === 'preview'
                              ? 'bg-accent-blue text-white shadow'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {t('templates.editor_mode_preview')}
                        </button>
                      </div>
                    </div>
                    
                    {editorMode === 'edit' ? (
                      <>
                        {/* Toolbar */}
                        <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl animate-fade-in">
                          <button
                            type="button"
                            onClick={() => execCmd('bold')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.bold', { defaultValue: 'Bold' }) || ''}
                          >
                            <Bold size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('italic')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.italic', { defaultValue: 'Italic' }) || ''}
                          >
                            <Italic size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('underline')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.underline', { defaultValue: 'Underline' }) || ''}
                          >
                            <Underline size={14} />
                          </button>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <button
                            type="button"
                            onClick={() => execCmd('formatBlock', '\x3ch1\x3e')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.h1', { defaultValue: 'H1' }) || ''}
                          >
                            <Heading1 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('formatBlock', '\x3ch2\x3e')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.h2', { defaultValue: 'H2' }) || ''}
                          >
                            <Heading2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('insertUnorderedList')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.list', { defaultValue: 'List' }) || ''}
                          >
                            <List size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={addLink}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.link', { defaultValue: 'Link' }) || ''}
                          >
                            <Link size={14} />
                          </button>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <button
                            type="button"
                            onClick={() => {
                              const currentText = editorRef.current ? editorRef.current.innerHTML : templateBody;
                              setAiFieldId('template_body');
                              setAiContext('E-Mail Vorlage Haupttext');
                              setAiValue(currentText || '');
                            }}
                            className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                            title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                          >
                            <Sparkles size={11} className="animate-pulse" />
                            {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                          </button>
                        </div>

                        {/* Edit Area */}
                        <div 
                          id="wysiwyg-editor"
                          ref={editorRef}
                          contentEditable
                          onInput={handleEditorInput}
                          onFocus={() => { setLastFocusedField('body'); }}
                          className="w-full min-h-[250px] max-h-[400px] overflow-y-auto bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white text-sm focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
                          style={{ outline: 'none' }}
                          placeholder={t('templates.placeholder_desc_editor') || ''}
                        />
                      </>
                    ) : (
                      <div className="w-full bg-slate-100 border border-slate-300 rounded-xl overflow-hidden p-6 text-slate-900 font-sans shadow-inner animate-fade-in">
                        <div className="pb-4 mb-4 border-b border-slate-300 text-xs text-slate-500 space-y-1">
                          <div className="flex justify-between items-center">
                            <span><strong className="text-slate-700">{t('templates.live_preview_sender')}:</strong> Louis Smart CRM &lt;no-reply@louis-crm.de&gt;</span>
                            <span className="text-[9px] bg-accent-blue text-white font-sans font-black tracking-widest px-2.5 py-1 rounded-full uppercase">{t('templates.live_preview_label')}</span>
                          </div>
                          <div><strong className="text-slate-700">{t('templates.live_preview_recipient')}:</strong> Max Mustermann &lt;max@musterholding.de&gt;</div>
                          <div><strong className="text-slate-700">{t('templates.live_preview_subject')}:</strong> {replaceMockPlaceholders(templateSubject) || <span className="italic text-slate-400">({t('templates.input_subject_placeholder')})</span>}</div>
                        </div>
                        <div className="p-6 bg-white rounded-xl border border-slate-200 h-[250px] overflow-y-auto custom-scrollbar shadow-sm">
                          {templateBody ? (
                            <div 
                              className="email-preview-content text-slate-800 text-sm leading-relaxed [&_p]:m-0"
                              dangerouslySetInnerHTML={{ __html: replaceMockPlaceholders(templateBody) }}
                            />
                          ) : (
                            <p className="text-slate-400 italic text-xs">{t('templates.live_preview_empty')}</p>
                          )}
                        </div>
                        <div className="mt-4 flex items-start gap-2 text-[10px] text-slate-600 bg-slate-200/50 p-4 rounded-lg border border-slate-300/40 leading-normal">
                          <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
                          <span>{t('templates.live_preview_info')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3.5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-all font-display"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createTemplateMutation.isPending || updateTemplateMutation.isPending}
                      className="px-6 py-3.5 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20"
                    >
                      <Check size={14} />
                      {t('templates.save_template')}
                    </button>
                  </div>
                </form>
              ) : activeSubSection === 'signatures' ? (
                <form onSubmit={handleSaveSignature} className="space-y-6">
                  {/* Signature Name */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_signature_name')}
                    </label>
                    <input 
                      type="text" 
                      value={signatureName}
                      onChange={(e) => setSignatureName(e.target.value)}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_signature_name_placeholder') || ''}
                      required
                    />
                  </div>

                  {/* Is Default Checkbox */}
                  <div className="flex items-center gap-3 px-2 py-1">
                    <input
                      type="checkbox"
                      id="default-signature-checkbox"
                      checked={isDefaultSig}
                      onChange={(e) => setIsDefaultSig(e.target.checked)}
                      className="w-4 h-4 bg-primary-dark border-white/10 rounded border text-accent-blue focus:ring-accent-blue"
                    />
                    <label htmlFor="default-signature-checkbox" className="text-xs text-white font-semibold cursor-pointer select-none">
                      {t('templates.is_default_sig')}
                    </label>
                  </div>

                  {/* Placeholders helper widget for signatures */}
                  <div className="space-y-3 p-4 bg-primary-dark/40 border border-white/5 rounded-xl">
                    <div className="flex items-center gap-2 text-accent-blue">
                      <Info size={14} />
                      <span className="text-[9px] font-mono tracking-wider font-extrabold uppercase">{t('templates.placeholders_sig_helper_title')}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {signaturePlaceholders.map((ph) => (
                        <button
                          key={ph.tag}
                          type="button"
                          onClick={() => insertPlaceholder(ph.tag)}
                          className="px-2.5 py-1.5 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/10 hover:border-accent-blue/30 rounded-lg text-[9px] font-mono font-black tracking-tighter transition-all flex items-center gap-1.5"
                          title={ph.description || ''}
                        >
                          {ph.tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* WYSIWYG Editor for signature */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                        {t('templates.input_sig_body')}
                      </label>
                      <div className="flex bg-primary-dark/85 p-0.5 rounded-lg border border-white/5 gap-0.5">
                        <button
                          type="button"
                          onClick={() => setEditorMode('edit')}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            editorMode === 'edit'
                              ? 'bg-accent-blue text-white shadow'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {t('templates.editor_mode_edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditorMode('preview')}
                          className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                            editorMode === 'preview'
                              ? 'bg-accent-blue text-white shadow'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {t('templates.editor_mode_preview')}
                        </button>
                      </div>
                    </div>

                    {editorMode === 'edit' ? (
                      <>
                        {/* Toolbar */}
                        <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl animate-fade-in">
                          <button
                            type="button"
                            onClick={() => execCmd('bold')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.bold', { defaultValue: 'Bold' }) || ''}
                          >
                            <Bold size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('italic')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.italic', { defaultValue: 'Italic' }) || ''}
                          >
                            <Italic size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => execCmd('underline')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.underline', { defaultValue: 'Underline' }) || ''}
                          >
                            <Underline size={14} />
                          </button>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <button
                            type="button"
                            onClick={() => execCmd('insertUnorderedList')}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.list', { defaultValue: 'List' }) || ''}
                          >
                            <List size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={addLink}
                            className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                            title={t('templates.editor.link', { defaultValue: 'Link' }) || ''}
                          >
                            <Link size={14} />
                          </button>
                          <div className="w-px h-6 bg-white/10 mx-1" />
                          <button
                            type="button"
                            onClick={() => {
                              const currentText = editorRef.current ? editorRef.current.innerHTML : signatureBody;
                              setAiFieldId('signature_body');
                              setAiContext('E-Mail Signatur');
                              setAiValue(currentText || '');
                            }}
                            className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                            title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                          >
                            <Sparkles size={11} className="animate-pulse" />
                            {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                          </button>
                        </div>

                        <div 
                          id="wysiwyg-editor"
                          ref={editorRef}
                          contentEditable
                          onInput={handleEditorInput}
                          className="w-full min-h-[200px] max-h-[350px] overflow-y-auto bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white text-sm focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
                          style={{ outline: 'none' }}
                          placeholder={t('templates.placeholder_desc_signature') || ''}
                        />
                      </>
                    ) : (
                      <div className="w-full bg-slate-100 border border-slate-300 rounded-xl overflow-hidden p-6 text-slate-900 font-sans shadow-inner animate-fade-in">
                        <div className="pb-3 mb-3 border-b border-slate-300 text-xs text-slate-500 flex justify-between items-center bg-transparent">
                          <span className="font-bold text-slate-700">{t('templates.input_signature_name')}: {signatureName || <span className="italic text-slate-400">---</span>}</span>
                          <span className="text-[9px] bg-accent-blue text-white font-sans font-black tracking-widest px-2.5 py-1 rounded-full uppercase">{t('templates.live_preview_label')}</span>
                        </div>
                        <div className="p-6 bg-white rounded-xl border border-slate-200 h-[200px] overflow-y-auto custom-scrollbar shadow-sm">
                          {signatureBody ? (
                            <div 
                              className="email-preview-content text-slate-800 text-sm leading-relaxed [&_p]:m-0"
                              dangerouslySetInnerHTML={{ __html: replaceMockPlaceholders(signatureBody) }}
                            />
                          ) : (
                            <p className="text-slate-400 italic text-xs">{t('templates.live_preview_empty')}</p>
                          )}
                        </div>
                        <div className="mt-4 flex items-start gap-2 text-[10px] text-slate-600 bg-slate-200/50 p-4 rounded-lg border border-slate-300/40 leading-normal">
                          <Info size={14} className="text-slate-500 shrink-0 mt-0.5" />
                          <span>{t('templates.live_preview_info')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3.5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-all font-display"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createSignatureMutation.isPending || updateSignatureMutation.isPending}
                      className="px-6 py-3.5 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20"
                    >
                      <Check size={14} />
                      {t('templates.save_signature')}
                    </button>
                  </div>
                </form>
              ) : activeSubSection === 'invoice_texts' ? (
                <form onSubmit={handleSaveInvoiceText} className="space-y-6">
                  {/* Template Name */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_invoice_text_name', { defaultValue: 'Name der Vorlage' })} <span className="text-accent-orange">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={invoiceTextName}
                      onChange={(e) => setInvoiceTextName(e.target.value)}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_invoice_text_name_placeholder', { defaultValue: 'z.B. Standard Einleitung' }) || ''}
                      required
                    />
                  </div>

                  {/* Type Selection */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_invoice_text_type', { defaultValue: 'Vorlagen-Typ' })} <span className="text-accent-orange">*</span>
                    </label>
                    <select
                      value={invoiceTextTypeCode}
                      onChange={(e) => setInvoiceTextTypeCode(e.target.value as 'introductory' | 'closing')}
                      className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                    >
                      <option value="introductory" className="bg-primary-dark text-white">{t('templates.type_introductory', { defaultValue: 'Einleitungstext' })}</option>
                      <option value="closing" className="bg-primary-dark text-white">{t('templates.type_closing', { defaultValue: 'Abschlusssatz' })}</option>
                    </select>
                  </div>

                  {/* Content Body */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center ml-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                        {t('templates.input_invoice_text_body', { defaultValue: 'Inhalt' })} <span className="text-accent-orange">*</span>
                      </label>
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl animate-fade-in">
                      <button
                        type="button"
                        onClick={() => execCmd('bold')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.bold', { defaultValue: 'Bold' }) || ''}
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('italic')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.italic', { defaultValue: 'Italic' }) || ''}
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('underline')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.underline', { defaultValue: 'Underline' }) || ''}
                      >
                        <Underline size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => execCmd('insertUnorderedList')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.list', { defaultValue: 'List' }) || ''}
                      >
                        <List size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={addLink}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.link', { defaultValue: 'Link' }) || ''}
                      >
                        <Link size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => {
                          const currentText = editorRef.current ? editorRef.current.innerHTML : invoiceTextBody;
                          setAiFieldId('invoice_text_body');
                          setAiContext('Schreibe einen professionellen Text für eine Rechnung. Typ: ' + (invoiceTextTypeCode === 'introductory' ? 'Einleitung' : 'Abschluss'));
                          setAiValue(currentText || '');
                        }}
                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                        title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                      >
                        <Sparkles size={11} className="animate-pulse" />
                        {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                      </button>
                    </div>

                    {/* Edit Area */}
                    <div 
                      id="wysiwyg-editor"
                      ref={editorRef}
                      contentEditable
                      onInput={handleEditorInput}
                      className="w-full min-h-[250px] max-h-[400px] overflow-y-auto bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white text-sm focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
                      style={{ outline: 'none' }}
                      placeholder={invoiceTextTypeCode === 'introductory' 
                        ? t('templates.placeholder_desc_invoice_text_intro', { defaultValue: 'Sehr geehrte Damen und Herren, anbei erhalten Sie unsere Rechnung...' })
                        : t('templates.placeholder_desc_invoice_text_closing', { defaultValue: 'Wir bedanken uns für das Vertrauen und Ihren Auftrag.' })
                      }
                    />
                  </div>

                  {/* Placeholders helper widget */}
                  <div className="space-y-3 p-4 bg-primary-dark/40 border border-white/5 rounded-xl">
                    <div className="flex items-center gap-2 text-accent-blue">
                      <Info size={14} />
                      <span className="text-[9px] font-mono tracking-wider font-extrabold uppercase">{t('templates.placeholders_invoice_helper_title', { defaultValue: 'Verfügbare Variablen' })}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">
                      {t('templates.placeholders_invoice_helper_desc', { defaultValue: 'Klicken Sie auf eine Variable, um sie an der aktuellen Cursorposition in Ihre Vorlage einzufügen.' })}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {templatePlaceholders.map((ph) => (
                        <button
                          key={ph.tag}
                          type="button"
                          onClick={() => insertInvoiceTextPlaceholder(ph.tag)}
                          className="px-2.5 py-1.5 bg-primary-dark/80 hover:bg-primary-light border border-white/5 rounded-lg text-[9px] font-mono text-slate-400 hover:text-white transition-all flex items-center gap-1.5"
                          title={ph.description || ''}
                        >
                          <Plus size={10} />
                          {ph.tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3.5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-all font-display"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createInvoiceTextMutation.isPending || updateInvoiceTextMutation.isPending}
                      className="px-6 py-3.5 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20"
                    >
                      <Check size={14} />
                      {t('templates.save_invoice_text', { defaultValue: 'Text speichern' })}
                    </button>
                  </div>
                </form>
              ) : activeSubSection === 'invoice_items' ? (
                <form onSubmit={handleSaveInvoiceItem} className="space-y-6">
                  {/* Template Name */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_invoice_item_name', { defaultValue: 'Rechnungsposten-Verwendungszweck / Name' })} <span className="text-accent-orange">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={itemTemplateName}
                      onChange={(e) => setItemTemplateName(e.target.value)}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_invoice_item_name_placeholder', { defaultValue: 'z.B. Softwareentwicklung Dienstleistungen' })}
                      required
                    />
                  </div>

                  {/* Description (WYSIWYG Editor) */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center mr-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.description', { defaultValue: 'Beschreibung / Details' })}
                      </label>
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl animate-fade-in">
                      <button
                        type="button"
                        onClick={() => execCmd('bold')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.bold', { defaultValue: 'Bold' }) || ''}
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('italic')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.italic', { defaultValue: 'Italic' }) || ''}
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('underline')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.underline', { defaultValue: 'Underline' }) || ''}
                      >
                        <Underline size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => execCmd('insertUnorderedList')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.list', { defaultValue: 'List' }) || ''}
                      >
                        <List size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={addLink}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.link', { defaultValue: 'Link' }) || ''}
                      >
                        <Link size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => {
                          const currentText = editorRef.current ? editorRef.current.innerHTML : itemDescription;
                          setAiFieldId('item_description');
                          setAiContext('Posten-Verwendungszweck Details');
                          setAiValue(currentText || '');
                        }}
                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                        title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                      >
                        <Sparkles size={11} className="animate-pulse" />
                        {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                      </button>
                    </div>

                    {/* Edit Area */}
                    <div 
                      id="wysiwyg-editor"
                      ref={editorRef}
                      contentEditable
                      onInput={handleEditorInput}
                      className="w-full min-h-[150px] max-h-[300px] overflow-y-auto bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white text-sm focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
                      style={{ outline: 'none' }}
                      placeholder={t('templates.placeholder_desc_invoice_item', { defaultValue: 'Optionale Detailbeschreibung, die auf der Rechnung erscheint' })}
                    />
                  </div>

                  {/* Usage Scope selection */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.item_usage_scope', { defaultValue: 'Verwendungsbereich' })} <span className="text-accent-orange">*</span>
                    </label>
                    <select
                      value={itemUsageScope}
                      onChange={(e) => setItemUsageScope(e.target.value as 'offer' | 'invoice' | 'both')}
                      className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                    >
                      <option value="both" className="bg-primary-dark text-white">{t('templates.item_usage_scope_both', { defaultValue: 'Angebote & Rechnungen' })}</option>
                      <option value="offer" className="bg-primary-dark text-white">{t('templates.item_usage_scope_offer', { defaultValue: 'Nur Angebote' })}</option>
                      <option value="invoice" className="bg-primary-dark text-white">{t('templates.item_usage_scope_invoice', { defaultValue: 'Nur Rechnungen' })}</option>
                    </select>
                  </div>

                  {/* Category selection */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.item_category_label', { defaultValue: 'Kategorie' })}
                    </label>
                    <select
                      value={itemCategoryIdUuid || ''}
                      onChange={(e) => setItemCategoryIdUuid(e.target.value || null)}
                      className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                    >
                      <option value="" className="bg-primary-dark text-white">{t('templates.item_category_none', { defaultValue: 'Keine Kategorie' })}</option>
                      {itemCategories.map((cat) => (
                        <option key={cat.id_uuid} value={cat.id_uuid} className="bg-primary-dark text-white">
                          {cat.category_name_text}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Quantity and Unit, Unit Price, Vat Rate */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.quantity', { defaultValue: 'Menge' })}
                      </label>
                      <input 
                        type="number" 
                        step="any"
                        min="0"
                        value={itemQuantity}
                        onChange={(e) => setItemQuantity(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.unit', { defaultValue: 'Einheit' })}
                      </label>
                      <select
                        value={itemUnitCode}
                        onChange={(e) => setItemUnitCode(e.target.value)}
                        className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      >
                        <option value="HUR">{t('invoices:units.HUR', { defaultValue: 'Stunden' })}</option>
                        <option value="MON">{t('invoices:units.MON', { defaultValue: 'Monate' })}</option>
                        <option value="DAY">{t('invoices:units.DAY', { defaultValue: 'Tage' })}</option>
                        <option value="C62">{t('invoices:units.C62', { defaultValue: 'Stück' })}</option>
                        <option value="SET">{t('invoices:units.SET', { defaultValue: 'Set' })}</option>
                        <option value="H87">{t('invoices:units.H87', { defaultValue: 'Stück' })}</option>
                        <option value="LS">{t('invoices:units.LS', { defaultValue: 'Pauschale' })}</option>
                        <option value="MIN">{t('invoices:units.MIN', { defaultValue: 'Minuten' })}</option>
                        <option value="MTR">{t('invoices:units.MTR', { defaultValue: 'Meter' })}</option>
                        <option value="MTK">{t('invoices:units.MTK', { defaultValue: 'm²' })}</option>
                        <option value="KGM">{t('invoices:units.KGM', { defaultValue: 'kg' })}</option>
                        <option value="LTR">{t('invoices:units.LTR', { defaultValue: 'Liter' })}</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.unit_price', { defaultValue: 'Einzelpreis (Netto)' })}
                      </label>
                      <input 
                        type="number" 
                        step="0.01"
                        min="0"
                        value={itemUnitPrice}
                        onChange={(e) => setItemUnitPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.vat_rate', { defaultValue: 'MwSt. Satz (%)' })}
                      </label>
                      <select
                        value={itemVatRate}
                        onChange={(e) => setItemVatRate(parseFloat(e.target.value) || 0)}
                        className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      >
                        <option value="19">19% ({t('invoices:vat.standard', { defaultValue: 'Regelsatz' })})</option>
                        <option value="7">7% ({t('invoices:vat.reduced', { defaultValue: 'Ermäßigt' })})</option>
                        <option value="0">0% ({t('invoices:vat.exempt', { defaultValue: 'Steuerfrei' })})</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3.5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-all font-display"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createInvoiceItemMutation.isPending || updateInvoiceItemMutation.isPending}
                      className="px-6 py-3.5 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20"
                    >
                      <Check size={14} />
                      {t('templates.save_invoice_item', { defaultValue: 'Posten speichern' })}
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleSaveOfferText} className="space-y-6">
                  {/* Internal Name */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_offer_text_name', { defaultValue: 'Name der Vorlage (Intern)' })} <span className="text-accent-orange">*</span>
                    </label>
                    <input 
                      type="text" 
                      value={offerTextName}
                      onChange={(e) => setOfferTextName(e.target.value)}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                      placeholder={t('templates.input_offer_text_name_placeholder', { defaultValue: 'z.B. Standard Einleitung' }) || ''}
                      required
                    />
                  </div>

                  {/* Text-Typ */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_offer_text_type', { defaultValue: 'Verwendungsart' })} <span className="text-accent-orange">*</span>
                    </label>
                    <select
                      value={offerTextTypeCode}
                      onChange={(e) => setOfferTextTypeCode(e.target.value as 'introductory' | 'closing')}
                      className="w-full bg-primary-dark/65 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm"
                    >
                      <option value="introductory" className="bg-primary-dark text-white">{t('templates.type_introductory', { defaultValue: 'Einleitungstext (vor den Posten)' })}</option>
                      <option value="closing" className="bg-primary-dark text-white">{t('templates.type_closing', { defaultValue: 'Abschlusssatz (nach den Posten)' })}</option>
                    </select>
                  </div>

                  {/* Body Text */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center ml-2">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">
                        {t('templates.input_offer_text_body', { defaultValue: 'Textinhalt' })} <span className="text-accent-orange">*</span>
                      </label>
                    </div>

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl animate-fade-in">
                      <button
                        type="button"
                        onClick={() => execCmd('bold')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.bold', { defaultValue: 'Bold' }) || ''}
                      >
                        <Bold size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('italic')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.italic', { defaultValue: 'Italic' }) || ''}
                      >
                        <Italic size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('underline')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.underline', { defaultValue: 'Underline' }) || ''}
                      >
                        <Underline size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => execCmd('insertUnorderedList')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.list', { defaultValue: 'List' }) || ''}
                      >
                        <List size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={addLink}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.link', { defaultValue: 'Link' }) || ''}
                      >
                        <Link size={14} />
                      </button>
                      <div className="w-px h-6 bg-white/10 mx-1" />
                      <button
                        type="button"
                        onClick={() => {
                          const currentText = editorRef.current ? editorRef.current.innerHTML : offerTextBody;
                          setAiFieldId('offer_text_body');
                          setAiContext('Schreibe einen professionellen Text für ein Angebot. Typ: ' + (offerTextTypeCode === 'introductory' ? 'Einleitung' : 'Abschluss'));
                          setAiValue(currentText || '');
                        }}
                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                        title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                      >
                        <Sparkles size={11} className="animate-pulse" />
                        {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                      </button>
                    </div>

                    {/* Edit Area */}
                    <div 
                      id="wysiwyg-editor"
                      ref={editorRef}
                      contentEditable
                      onInput={handleEditorInput}
                      className="w-full min-h-[250px] max-h-[400px] overflow-y-auto bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white text-sm focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
                      style={{ outline: 'none' }}
                      placeholder={offerTextTypeCode === 'introductory' 
                        ? t('templates.input_offer_text_body_intro_placeholder', { defaultValue: 'Sehr geehrte Damen und Herren, anbei erhalten Sie unser Angebot...' })
                        : t('templates.input_offer_text_body_closing_placeholder', { defaultValue: 'Dieses Angebot ist freibleibend. Wir freuen uns auf Ihren Auftrag.' })
                      }
                    />
                  </div>

                  {/* Placeholders helper widget */}
                  <div className="space-y-3 p-4 bg-primary-dark/40 border border-white/5 rounded-xl">
                    <div className="flex items-center gap-2 text-accent-blue">
                      <Info size={14} />
                      <span className="text-[9px] font-mono tracking-wider font-extrabold uppercase">{t('templates.placeholders_helper_title')}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">
                      {t('templates.placeholders_helper_desc')}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {offerTextPlaceholders.map((ph) => (
                        <button
                          key={ph.tag}
                          type="button"
                          onClick={() => insertOfferTextPlaceholder(ph.tag)}
                          className="px-2.5 py-1.5 bg-primary-dark/80 hover:bg-primary-light border border-white/5 rounded-lg text-[9px] font-mono text-slate-400 hover:text-white transition-all flex items-center gap-1.5"
                          title={ph.description || ''}
                        >
                          <Plus size={10} />
                          {ph.tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                    <button
                      type="button"
                      onClick={resetForm}
                      className="px-6 py-3.5 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-all font-display"
                    >
                      {t('common:cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={createOfferTextMutation.isPending || updateOfferTextMutation.isPending}
                      className="px-6 py-3.5 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20"
                    >
                      <Check size={14} />
                      {t('templates.save_offer_text', { defaultValue: 'Angebotstext speichern' })}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-white/5 rounded-xl py-32 flex flex-col items-center justify-center text-center px-12 bg-primary-light/5">
              <div className="w-16 h-16 rounded-xl bg-primary-dark border border-white/10 flex items-center justify-center text-accent-blue mb-6">
                {activeSubSection === 'templates' ? (
                  <FileText size={28} />
                ) : activeSubSection === 'signatures' ? (
                  <Signature size={28} />
                ) : activeSubSection === 'invoice_texts' ? (
                  <FileText size={28} />
                ) : activeSubSection === 'invoice_items' ? (
                  <List size={28} />
                ) : (
                  <FileSpreadsheet size={28} />
                )}
              </div>
              <h3 className="text-white font-black text-xl mb-1 font-display uppercase italic">{t('templates.no_entry_selected')}</h3>
              <p className="text-slate-500 text-xs max-w-sm mb-6 italic">{t('templates.no_entry_selected_desc')}</p>
              <button
                onClick={() => {
                  setIsEditing(true);
                  setEditId(null);
                  if (activeSubSection === 'templates') {
                    setTemplateName('');
                    setTemplateSubject('');
                    setTemplateBody('');
                  } else if (activeSubSection === 'signatures') {
                    setSignatureName('');
                    setSignatureBody('');
                    setIsDefaultSig(false);
                  } else if (activeSubSection === 'invoice_texts') {
                    setInvoiceTextName('');
                    setInvoiceTextTypeCode('introductory');
                    setInvoiceTextBody('');
                  } else if (activeSubSection === 'invoice_items') {
                    setItemTemplateName('');
                    setItemDescription('');
                    setItemQuantity(1);
                    setItemUnitPrice(0);
                    setItemVatRate(19);
                    setItemUnitCode('HUR');
                  } else {
                    setOfferTextName('');
                    setOfferTextTypeCode('introductory');
                    setOfferTextBody('');
                  }
                  if (editorRef.current) editorRef.current.innerHTML = '';
                }}
                className="px-6 py-3 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-md shadow-accent-blue/20 flex items-center gap-1.5"
              >
                <Plus size={14} />
                {t('templates.add_btn')}
              </button>
            </div>
          )}
        </div>
      </div>
      <AiTextGeneratorDialog
        isOpen={aiFieldId !== null}
        onClose={() => setAiFieldId(null)}
        fieldId={aiFieldId || ''}
        fieldValue={aiValue}
        context={aiContext}
        onAccept={(newValue) => {
          if (aiFieldId === 'template_body') {
            setTemplateBody(newValue);
            if (editorRef.current) {
              editorRef.current.innerHTML = newValue;
            }
          } else if (aiFieldId === 'signature_body') {
            setSignatureBody(newValue);
            if (editorRef.current) {
              editorRef.current.innerHTML = newValue;
            }
          } else if (aiFieldId === 'invoice_text_body') {
 // : State UND DOM setzen (contentEditable braucht beides, sonst
            // überschreibt dangerouslySetInnerHTML die Übernahme beim Re-Render)
            setInvoiceTextBody(newValue);
            if (editorRef.current) editorRef.current.innerHTML = newValue;
          } else if (aiFieldId === 'offer_text_body') {
            setOfferTextBody(newValue);
            if (editorRef.current) editorRef.current.innerHTML = newValue;
          } else if (aiFieldId === 'item_description') {
            setItemDescription(newValue);
            if (editorRef.current) {
              editorRef.current.innerHTML = newValue;
            }
          }
        }}
      />
      <Dialog
        isOpen={isDeleteOpen}
        onClose={() => {
          setIsDeleteOpen(false);
          setDeleteTargetId(null);
          setDeleteTargetType(null);
          setDeleteTargetName('');
        }}
        title={
          deleteTargetType === 'template'
            ? t('templates.delete_title_template', { defaultValue: 'E-Mail-Vorlage löschen' })
            : deleteTargetType === 'signature'
            ? t('templates.delete_title_signature', { defaultValue: 'Signatur löschen' })
            : deleteTargetType === 'invoice_text'
            ? t('templates.delete_title_invoice_text', { defaultValue: 'Rechnungstext-Vorlage löschen' })
            : deleteTargetType === 'offer_text'
            ? t('templates.delete_title_offer_text', { defaultValue: 'Angebotstext-Vorlage löschen' })
            : t('templates.delete_title_invoice_item', { defaultValue: 'Rechnungsposten-Vorlage löschen' })
        }
        size="md"
      >
        <div className="space-y-5 pt-4 text-left">
          <div className="flex items-start gap-4 bg-orange-500/10 p-5 rounded-xl border border-orange-500/20">
            <div className="text-orange-500 mt-0.5 shrink-0">
              <Info size={24} />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h4 className="text-sm font-black text-orange-500 uppercase tracking-wider">
                {t('templates.delete_modal_warning_title', { defaultValue: 'Achtung: Unwiderruflicher Schritt' })}
              </h4>
              <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium">
                {deleteTargetType === 'template'
                  ? t('templates.delete_confirm_template')
                  : deleteTargetType === 'signature'
                  ? t('templates.delete_confirm_signature')
                  : deleteTargetType === 'invoice_text'
                  ? t('templates.delete_confirm_invoice_text')
                  : deleteTargetType === 'offer_text'
                  ? t('templates.delete_confirm_offer_text', { defaultValue: 'Sind Sie sicher, dass Sie diese Angebotstext-Vorlage unwiderruflich löschen möchten?' })
                  : t('templates.delete_confirm_invoice_item')}
                {deleteTargetName && (
                  <span className="block mt-2 font-mono text-accent-orange font-black text-sm truncate bg-primary-dark/40 px-3 py-1.5 rounded-lg border border-white/5">
                    {deleteTargetName}
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-400 leading-relaxed font-sans font-medium">
                {t('templates.delete_modal_warning_desc', { defaultValue: 'Diese Aktion kann nicht rückgängig gemacht werden.' })}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => {
                setIsDeleteOpen(false);
                setDeleteTargetId(null);
                setDeleteTargetType(null);
                setDeleteTargetName('');
              }}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-905 border border-slate-800"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
            <button
              type="button"
              disabled={isDeletingInProgress}
              onClick={handleConfirmDelete}
              className="bg-red-600 text-white px-8 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-red-700 transition-all shadow-xl shadow-red-600/10 active:scale-95 flex items-center gap-2"
            >
              {isDeletingInProgress && (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {t('common:delete', { defaultValue: 'Unwiderruflich Löschen' })}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        isOpen={isManageCategoriesOpen}
        onClose={() => {
          setIsManageCategoriesOpen(false);
          setCategoryInputName('');
          setEditingCategoryId(null);
        }}
        title={t('templates.manage_categories_title', { defaultValue: 'Kategorien verwalten' })}
        size="md"
      >
        <div className="space-y-6 pt-4 text-left">
          {/* Create / Edit Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!categoryInputName.trim()) return;
              if (editingCategoryId) {
                updateCategoryMutation.mutate({
                  id_uuid: editingCategoryId,
                  category_name_text: categoryInputName,
                });
              } else {
                createCategoryMutation.mutate({
                  category_name_text: categoryInputName,
                });
              }
            }}
            className="flex gap-2 items-end"
          >
            <div className="flex-1 space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                {t('templates.category_name_input', { defaultValue: 'Kategoriename' })}
              </label>
              <input
                type="text"
                value={categoryInputName}
                onChange={(e) => setCategoryInputName(e.target.value)}
                className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-4 py-3.5 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-xs"
                placeholder={t('templates.category_name_input', { defaultValue: 'Kategoriename' }) || ''}
                required
              />
            </div>
            <button
              type="submit"
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
              className="px-6 py-4 bg-accent-blue hover:bg-accent-blue/85 disabled:opacity-50 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-1.5 transition-all shadow-lg shadow-accent-blue/20"
            >
              {editingCategoryId ? <Check size={14} /> : <Plus size={14} />}
              {editingCategoryId
                ? t('templates.category_save_btn', { defaultValue: 'Speichern' })
                : t('templates.category_add_btn', { defaultValue: 'Erstellen' })}
            </button>
            {editingCategoryId && (
              <button
                type="button"
                onClick={() => {
                  setEditingCategoryId(null);
                  setCategoryInputName('');
                }}
                className="p-4 bg-primary-dark border border-white/10 text-slate-400 hover:text-white rounded-xl transition-all"
              >
                <X size={14} />
              </button>
            )}
          </form>

          {/* List of existing Categories */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
              {t('templates.saved_categories', { defaultValue: 'Existierende Kategorien' })}
            </label>
            <div className="space-y-2 max-h-[250px] overflow-y-auto custom-scrollbar pr-1">
              {itemCategories.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic p-4 text-center border border-dashed border-white/5 bg-primary-light/5 rounded-xl">
                  {t('templates.category_list_empty', { defaultValue: 'Keine Kategorien vorhanden. Erstellen Sie eine neue Kategorie über das obige Feld.' })}
                </p>
              ) : (
                itemCategories.map((cat) => (
                  <div
                    key={cat.id_uuid}
                    className="flex items-center justify-between p-3.5 bg-primary-light/10 border border-white/5 rounded-xl"
                  >
                    <span className="text-xs text-white font-bold">{cat.category_name_text}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCategoryId(cat.id_uuid);
                          setCategoryInputName(cat.category_name_text);
                        }}
                        className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.category_edit_tooltip', { defaultValue: 'Kategorie bearbeiten' }) || ''}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmCategoryDeleteId === cat.id_uuid) {
                            setConfirmCategoryDeleteId(null);
                            deleteCategoryMutation.mutate({ id_uuid: cat.id_uuid });
                          } else {
                            setConfirmCategoryDeleteId(cat.id_uuid);
                          }
                        }}
                        data-testid="category-delete-btn"
                        className={`p-1.5 rounded-lg transition-colors ${confirmCategoryDeleteId === cat.id_uuid ? "bg-accent-orange/20 text-accent-orange" : "hover:bg-accent-orange/10 text-slate-400 hover:text-accent-orange"}`}
                        title={confirmCategoryDeleteId === cat.id_uuid ? t('templates.category_delete_confirm_tooltip', { defaultValue: 'Wirklich löschen? Nochmal klicken' }) || '' : t('templates.category_delete_tooltip', { defaultValue: 'Kategorie löschen' }) || ''}
                      >
                        {confirmCategoryDeleteId === cat.id_uuid ? <span className="text-[10px] font-black uppercase">{t('templates.category_delete_confirm_short', { defaultValue: 'Wirklich?' })}</span> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={() => {
                setIsManageCategoriesOpen(false);
                setCategoryInputName('');
                setEditingCategoryId(null);
              }}
              className="px-6 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-[0.2em] text-slate-400 hover:text-white transition-all bg-slate-905 border border-slate-800"
            >
              {t('common:close', { defaultValue: 'Schließen' })}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
