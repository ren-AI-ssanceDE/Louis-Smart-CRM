import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  Info
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { EmailTemplate, Signature as SignatureType, InvoiceTextTemplate, InvoiceItemTemplate } from '../../types';
import { AiTextGeneratorDialog } from '../AiTextGeneratorDialog';

export const TemplatesTab = () => {
  const { t } = useTranslation(['admin', 'common', 'invoices', 'companies']);
  const utils = trpc.useContext();
  
  // Tab control: 'templates' | 'signatures' | 'invoice_texts' | 'invoice_items'
  const [activeSubSection, setActiveSubSection] = useState<'templates' | 'signatures' | 'invoice_texts' | 'invoice_items'>('templates');
  
  // Selected fields for adding tags
  const [lastFocusedField, setLastFocusedField] = useState<'subject' | 'body'>('body');

  // AI copywriting states
  const [aiFieldId, setAiFieldId] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [aiValue, setAiValue] = useState('');

  // Queries
  const { data: templates = [], isLoading: loadingTemplates } = trpc.getEmailTemplates.useQuery();
  const { data: signatures = [], isLoading: loadingSignatures } = trpc.getSignatures.useQuery();
  const { data: invoiceTexts = [], isLoading: loadingInvoiceTexts } = trpc.getInvoiceTextTemplates.useQuery();
  const { data: invoiceItems = [], isLoading: loadingInvoiceItems } = trpc.getInvoiceItemTemplates.useQuery();

  // Mutations Invoice Item Templates
  const createInvoiceItemMutation = trpc.createInvoiceItemTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_create_invoice_item', { defaultValue: 'Rechnungsposten-Vorlage erfolgreich erstellt' }));
      utils.getInvoiceItemTemplates.invalidate();
      resetForm();
    },
    onError: (err) => {
      toast.error(t('templates.toast_error_create_invoice_item', { defaultValue: 'Fehler beim Erstellen' }) + ': ' + err.message);
    }
  });

  const updateInvoiceItemMutation = trpc.updateInvoiceItemTemplate.useMutation({
    onSuccess: () => {
      toast.success(t('templates.toast_success_update_invoice_item', { defaultValue: 'Rechnungsposten-Vorlage erfolgreich aktualisiert' }));
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

  // Editing structures
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

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

  const editorRef = useRef<HTMLDivElement>(null);

  // Synchronizes contentEditable innerHTML with state if editor changes externally
  useEffect(() => {
    if (editorRef.current) {
      const activeContent = activeSubSection === 'templates' ? templateBody : signatureBody;
      if (editorRef.current.innerHTML !== activeContent) {
        editorRef.current.innerHTML = activeContent;
      }
    }
  }, [activeSubSection, isEditing]);

  const handleEditorInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      if (activeSubSection === 'templates') {
        setTemplateBody(html);
      } else {
        setSignatureBody(html);
      }
    }
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditId(null);
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
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
  };

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
    { tag: '{{recipient_name}}', description: 'Empfänger-Name (Vollständig)' },
    { tag: '{{recipient_first_name}}', description: 'Empfänger-Vorname' },
    { tag: '{{recipient_last_name}}', description: 'Empfänger-Nachname' },
    { tag: '{{recipient_salutation}}', description: 'Empfänger-Anrede (Sehr geehrte(r) Frau/Herr...)' },
    { tag: '{{recipient_company}}', description: 'Empfänger-Firmenname' },
    { tag: '{{recipient_street}}', description: 'Empfänger-Straße & Hausnummer' },
    { tag: '{{recipient_city}}', description: 'Empfänger-Ort' },
    { tag: '{{recipient_postal_code}}', description: 'Empfänger-Postleitzahl' },
    { tag: '{{recipient_address}}', description: 'Empfänger-Anschrift (Mehrzeilig)' },
    { tag: '{{recipient_email}}', description: 'Empfänger-E-Mail-Adresse' },
    { tag: '{{recipient_phone}}', description: 'Empfänger-Telefonnummer' },
  ];

  const signaturePlaceholders = [
    { tag: '{{my_company_name}}', description: t('companies:name') },
    { tag: '{{my_contact_person}}', description: t('companies:fields.responsible') },
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
              : t('templates.title_invoice_items', { defaultValue: 'Rechnungspositionen' })}
          </h3>
          <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
            {activeSubSection === 'templates' 
              ? t('templates.desc_templates') 
              : activeSubSection === 'signatures'
              ? t('templates.desc_signatures')
              : activeSubSection === 'invoice_texts'
              ? t('templates.desc_invoice_texts', { defaultValue: 'Vorlagen für Einleitungstext & Abschlusssatz verwalten' })
              : t('templates.desc_invoice_items', { defaultValue: 'Vorlagen für häufig genutzte Rechnungsposten verwalten' })}
          </p>
        </div>

        {/* Section Toggles */}
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
        </div>
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
                : t('templates.saved_invoice_items', { defaultValue: 'Gespeicherte Posten-Vorlagen' })}
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
                  } else {
                    setItemTemplateName('');
                    setItemDescription('');
                    setItemQuantity(1);
                    setItemUnitPrice(0);
                    setItemVatRate(19);
                    setItemUnitCode('HUR');
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
                            toast(t('templates.delete_confirm_template') || 'Möchten Sie diese Vorlage wirklich löschen?', {
                              action: {
                                label: t('common:delete', { defaultValue: 'Löschen' }),
                                onClick: () => {
                                  deleteTemplateMutation.mutate({ id_uuid: tmpl.id_uuid! });
                                }
                              },
                              cancel: {
                                label: t('common:cancel', { defaultValue: 'Abbrechen' })
                              }
                            });
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
                            toast(t('templates.delete_confirm_signature') || 'Möchten Sie diese Signatur wirklich löschen?', {
                              action: {
                                label: t('common:delete', { defaultValue: 'Löschen' }),
                                onClick: () => {
                                  deleteSignatureMutation.mutate({ id_uuid: sig.id_uuid! });
                                }
                              },
                              cancel: {
                                label: t('common:cancel', { defaultValue: 'Abbrechen' })
                              }
                            });
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
                        <p className="text-[10px] text-slate-500 mt-2 line-clamp-2 italic whitespace-pre-line">{it.template_body_content}</p>
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
                            toast(t('templates.delete_confirm_invoice_text', { defaultValue: 'Möchten Sie diese Rechnungstext-Vorlage wirklich löschen?' }), {
                              action: {
                                label: t('common:delete', { defaultValue: 'Löschen' }),
                                onClick: () => {
                                  deleteInvoiceTextMutation.mutate({ id_uuid: it.id_uuid! });
                                }
                              },
                              cancel: {
                                label: t('common:cancel', { defaultValue: 'Abbrechen' })
                              }
                            });
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
            ) : (
              invoiceItems.length === 0 ? (
                <div className="border border-dashed border-white/5 bg-primary-light/5 py-12 text-center rounded-xl">
                  <p className="text-slate-500 italic text-xs font-bold font-display uppercase tracking-widest">{t('templates.none_invoice_items', { defaultValue: 'Keine Rechnungsposten-Vorlagen gefunden' })}</p>
                  <p className="text-slate-600 text-[10px] mt-1">{t('templates.none_invoice_items_desc', { defaultValue: 'Erstellen Sie Vorlagen für häufig genutzte Rechnungsposten (z.B. Beratung, Entwicklung).' })}</p>
                </div>
              ) : (
                invoiceItems.map((item) => (
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
                          <span className="bg-primary-light border border-white/5 text-slate-400 text-[8px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full">
                            {item.quantity} {t(`invoices:units.${item.unit_code || 'HUR'}`, { defaultValue: item.unit_code })}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-[10px] text-slate-500 mt-2 line-clamp-2 italic">{item.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400 font-mono">
                          <span>{t('invoices:unit_price', { defaultValue: 'Einzelpreis' })}: {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(item.unit_price)}</span>
                          <span>{t('invoices:vat_rate', { defaultValue: 'MwSt.' })}: {item.vat_rate}%</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleEditInvoiceItem(item as InvoiceItemTemplate)}
                          className="p-1.5 hover:bg-white/5 text-slate-400 hover:text-white rounded-lg transition-colors"
                          title={t('common:edit') || 'Edit'}
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => {
                            toast(t('templates.delete_confirm_invoice_item', { defaultValue: 'Möchten Sie diese Rechnungsposten-Vorlage wirklich löschen?' }), {
                              action: {
                                label: t('common:delete', { defaultValue: 'Löschen' }),
                                onClick: () => {
                                  deleteInvoiceItemMutation.mutate({ id_uuid: item.id_uuid! });
                                }
                              },
                              cancel: {
                                label: t('common:cancel', { defaultValue: 'Abbrechen' })
                              }
                            });
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
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_body')}
                    </label>
                    
                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl">
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
                        onClick={() => execCmd('formatBlock', '<h1>')}
                        className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('templates.editor.h1', { defaultValue: 'H1' }) || ''}
                      >
                        <Heading1 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => execCmd('formatBlock', '<h2>')}
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
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                      {t('templates.input_sig_body')}
                    </label>

                    {/* Toolbar */}
                    <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl">
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
                      {t('templates.input_invoice_text_name', { defaultValue: 'Name der Vorlage' })}
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
                      {t('templates.input_invoice_text_type', { defaultValue: 'Vorlagen-Typ' })}
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
                    <div className="flex justify-between items-center mr-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('templates.input_invoice_text_body', { defaultValue: 'Inhalt' })}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setAiFieldId('invoice_text_body');
                          setAiContext('Rechnungstext Vorlage');
                          setAiValue(invoiceTextBody || '');
                        }}
                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                        title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                      >
                        <Sparkles size={11} className="animate-pulse" />
                        {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                      </button>
                    </div>
                    <textarea 
                      value={invoiceTextBody}
                      onChange={(e) => setInvoiceTextBody(e.target.value)}
                      rows={6}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm custom-scrollbar"
                      placeholder={t('templates.placeholder_desc_invoice_text', { defaultValue: 'Schreiben Sie hier den Text, der eingefügt werden soll...' }) || ''}
                      required
                    />
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
              ) : (
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

                  {/* Description */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center mr-1">
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">
                        {t('invoices:fields.description', { defaultValue: 'Beschreibung / Details' })}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setAiFieldId('item_description');
                          setAiContext('Posten-Verwendungszweck Details');
                          setAiValue(itemDescription || '');
                        }}
                        className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest font-display cursor-pointer"
                        title={t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' }) || ''}
                      >
                        <Sparkles size={11} className="animate-pulse" />
                        {t('templates.editor.generate_ai', { defaultValue: 'Mit KI Generieren' })}
                      </button>
                    </div>
                    <textarea 
                      value={itemDescription}
                      onChange={(e) => setItemDescription(e.target.value)}
                      rows={3}
                      className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors text-sm custom-scrollbar"
                      placeholder={t('templates.placeholder_desc_invoice_item', { defaultValue: 'Optionale Detailbeschreibung, die auf der Rechnung erscheint' })}
                    />
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
                        value={itemQuantity}
                        onChange={(e) => setItemQuantity(parseFloat(e.target.value) || 0)}
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
                        value={itemUnitPrice}
                        onChange={(e) => setItemUnitPrice(parseFloat(e.target.value) || 0)}
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
              )}
            </div>
          ) : (
            <div className="border-2 border-dashed border-white/5 rounded-xl py-32 flex flex-col items-center justify-center text-center px-12 bg-primary-light/5">
              <div className="w-16 h-16 rounded-xl bg-primary-dark border border-white/10 flex items-center justify-center text-accent-blue mb-6">
                {activeSubSection === 'templates' ? <FileText size={28} /> : activeSubSection === 'signatures' ? <Signature size={28} /> : activeSubSection === 'invoice_texts' ? <FileText size={28} /> : <List size={28} />}
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
                  } else {
                    setItemTemplateName('');
                    setItemDescription('');
                    setItemQuantity(1);
                    setItemUnitPrice(0);
                    setItemVatRate(19);
                    setItemUnitCode('HUR');
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
            setInvoiceTextBody(newValue);
          } else if (aiFieldId === 'item_description') {
            setItemDescription(newValue);
          }
        }}
      />
    </div>
  );
};
