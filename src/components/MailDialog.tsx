import React, { useState, useEffect, useRef } from 'react';
import { Invoice, Company, Contact } from '../types';
import { Dialog } from './ui/Dialog';
import { useTranslation } from 'react-i18next';
import { AiTextGeneratorDialog } from './AiTextGeneratorDialog';
import { 
  Mail, 
  Send, 
  Loader2, 
  FileText, 
  Signature, 
  Bold, 
  Italic, 
  Underline, 
  List, 
  Link,
  Sparkles,
  Paperclip,
  Trash2,
  Upload,
  CheckCircle2
} from 'lucide-react';
import { trpc } from '../lib/trpc';
import { toast } from 'sonner';

interface MailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recipientEmail: string;
  recipientName: string;
  invoice?: Invoice;
  associatedType?: 'companies' | 'contacts';
  associatedId?: string;
  associatedName?: string;
}

interface CustomAttachmentState {
  filename: string;
  content: string; // base64
  size: number;
  contentType: string;
  saveToProfile: boolean;
  alreadyInProfile: boolean;
}

export const MailDialog = ({ 
  isOpen, 
  onClose, 
  recipientEmail, 
  recipientName, 
  invoice,
  associatedType,
  associatedId,
  associatedName
}: MailDialogProps) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  // AI copywriting state
  const [aiFieldId, setAiFieldId] = useState<string | null>(null);
  const [aiContext, setAiContext] = useState('');
  const [aiValue, setAiValue] = useState('');

  // Dropdown states
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedSignatureId, setSelectedSignatureId] = useState('');
  const [customAttachments, setCustomAttachments] = useState<CustomAttachmentState[]>([]);

  const editorRef = useRef<HTMLDivElement>(null);
  const fileAttachInputRef = useRef<HTMLInputElement>(null);

  // Profile Context Inference
  const profileType = associatedType || (invoice?.associated_contact_id ? 'contacts' : invoice?.associated_company_id ? 'companies' : undefined);
  const profileId = associatedId || invoice?.associated_contact_id || invoice?.associated_company_id;
  const profileName = associatedName || recipientName;

  // tRPC endpoints
  const utils = trpc.useUtils();
  const { data: templates = [] } = trpc.getEmailTemplates.useQuery(undefined, { enabled: isOpen });
  const { data: signatures = [] } = trpc.getSignatures.useQuery(undefined, { enabled: isOpen });
  const { data: myCompany } = trpc.getMyCompany.useQuery(undefined, { enabled: isOpen });
  const { data: companies = [] } = trpc.getCompanies.useQuery(undefined, { enabled: isOpen });
  const { data: contacts = [] } = trpc.getContacts.useQuery(undefined, { enabled: isOpen });
  const { data: profileFiles = [] } = trpc.getFiles.useQuery(
    { type: profileType!, id_uuid: profileId!, name: profileName! },
    { enabled: isOpen && !!profileId && !!profileType }
  );

  const saveFileMutation = trpc.saveFile.useMutation();
  const getFileContentMutation = trpc.getFileContent.useMutation();

  const [loadingFile, setLoadingFile] = useState<string | null>(null);

  const sendMailMutation = trpc.sendMail.useMutation({
    onSuccess: () => {
      toast.success(t('admin:mail.success'));
      onClose();
      handleReset();
    },
    onError: (err) => {
      toast.error(t('admin:mail.error') + ': ' + err.message);
    }
  });

  const replacePlaceholders = (text: string, companyName: string, contactPerson: string) => {
    if (!text) return '';
    let replaced = text;

    let rName = recipientName;
    let rFirstName = '';
    let rLastName = '';
    let rSalutation = '';
    let rStreet = '';
    let rHouseNumber = '';
    let rPostalCode = '';
    let rCity = '';
    let rCountry = '';
    let rEmail = recipientEmail;
    let rPhone = '';
    let rCompany = '';
    let rAddress = '';

    // Let's find if the recipient belongs to a contact or company
    if (profileType === 'companies' && profileId) {
      const co = (companies as Company[]).find((c) => c.id_uuid === profileId);
      if (co) {
        rName = co.full_legal_name || rName;
        rStreet = co.street || '';
        rHouseNumber = co.house_number || '';
        rPostalCode = co.postal_code || '';
        rCity = co.city || '';
        rCountry = co.country_code || '';
        rEmail = co.email_address || rEmail;
        rPhone = co.phone_number || co.mobile_number || '';
        rCompany = co.full_legal_name || '';
        
        // Build formatted address
        const streetFull = `${rStreet} ${rHouseNumber}`.trim();
        const cityFull = `${rPostalCode} ${rCity}`.trim();
        rAddress = [rCompany, streetFull, cityFull, rCountry].filter(Boolean).join('\n');
        
        rSalutation = 'Sehr geehrte Damen und Herren';
      }
    } else if (profileType === 'contacts' && profileId) {
      const ct = (contacts as Contact[]).find((c) => c.id_uuid === profileId);
      if (ct) {
        rName = ct.full_legal_name || `${ct.first_name || ''} ${ct.last_name || ''}`.trim() || rName;
        rFirstName = ct.first_name || '';
        rLastName = ct.last_name || '';
        rStreet = ct.street || '';
        rHouseNumber = ct.house_number || '';
        rPostalCode = ct.postal_code || '';
        rCity = ct.city || '';
        rEmail = ct.email_address || rEmail;
        rPhone = ct.phone_number || ct.mobile_number || '';
        
        if (ct.company_name) {
          rCompany = ct.company_name;
        } else if (ct.associated_company_id) {
          const assocCo = (companies as Company[]).find((co) => co.id_uuid === ct.associated_company_id);
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
    }

    // Try fallback lookup by email address or name if street details are not yet resolved
    if (!rStreet && !rCity) {
      const foundCt = (contacts as Contact[]).find((c) => (c.email_address && c.email_address.toLowerCase() === recipientEmail.toLowerCase()) || c.full_legal_name === recipientName);
      if (foundCt) {
        rName = foundCt.full_legal_name || `${foundCt.first_name || ''} ${foundCt.last_name || ''}`.trim() || rName;
        rFirstName = foundCt.first_name || '';
        rLastName = foundCt.last_name || '';
        rStreet = foundCt.street || '';
        rHouseNumber = foundCt.house_number || '';
        rPostalCode = foundCt.postal_code || '';
        rCity = foundCt.city || '';
        rEmail = foundCt.email_address || rEmail;
        rPhone = foundCt.phone_number || foundCt.mobile_number || '';
        
        if (foundCt.company_name) {
          rCompany = foundCt.company_name;
        } else if (foundCt.associated_company_id) {
          const assocCo = (companies as Company[]).find((co) => co.id_uuid === foundCt.associated_company_id);
          if (assocCo) {
            rCompany = assocCo.full_legal_name || '';
          }
        }

        const rawSalutation = foundCt.salutation || '';
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
      } else {
        const foundCo = (companies as Company[]).find((c) => (c.email_address && c.email_address.toLowerCase() === recipientEmail.toLowerCase()) || c.full_legal_name === recipientName);
        if (foundCo) {
          rName = foundCo.full_legal_name || rName;
          rStreet = foundCo.street || '';
          rHouseNumber = foundCo.house_number || '';
          rPostalCode = foundCo.postal_code || '';
          rCity = foundCo.city || '';
          rCountry = foundCo.country_code || '';
          rEmail = foundCo.email_address || rEmail;
          rPhone = foundCo.phone_number || foundCo.mobile_number || '';
          rCompany = foundCo.full_legal_name || '';
          
          const streetFull = `${rStreet} ${rHouseNumber}`.trim();
          const cityFull = `${rPostalCode} ${rCity}`.trim();
          rAddress = [rCompany, streetFull, cityFull, rCountry].filter(Boolean).join('\n');
          rSalutation = `Sehr geehrte Damen und Herren`;
        }
      }
    }

    if (!rSalutation) {
      rSalutation = `Sehr geehrte Damen und Herren`;
    }

    replaced = replaced
      .replace(/\{\{my_company_name\}\}/g, companyName)
      .replace(/\{\{my_contact_person\}\}/g, contactPerson)
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
      .replace(/\{\{recipient_phone\}\}/g, rPhone);

    if (invoice) {
      const issueDateObj = new Date(invoice.issue_date);
      const days = parseInt(invoice.payment_term) || 14;
      issueDateObj.setDate(issueDateObj.getDate() + days);
      const activeLocale = i18n.language || 'de';
      const dueDateStr = issueDateObj.toLocaleDateString(activeLocale);
      const grossVal = typeof invoice.total_gross_amount === 'number' 
        ? invoice.total_gross_amount.toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : (0).toLocaleString(activeLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      replaced = replaced
        .replace(/\{\{invoice_number\}\}/g, invoice.invoice_number)
        .replace(/\{\{due_date\}\}/g, dueDateStr)
        .replace(/\{\{total_gross\}\}/g, grossVal)
        .replace(/\{\{currency\}\}/g, invoice.currency_code || 'EUR');
    } else {
      replaced = replaced
        .replace(/\{\{invoice_number\}\}/g, 'RE-2024-001')
        .replace(/\{\{due_date\}\}/g, '31.05.2026')
        .replace(/\{\{total_gross\}\}/g, '1.190,00')
        .replace(/\{\{currency\}\}/g, 'EUR');
    }
    return replaced;
  };

  // Prepopulate default signature on open
  useEffect(() => {
    if (isOpen && signatures.length > 0 && !body) {
      const defaultSig = signatures.find(s => s.is_default_signature);
      if (defaultSig) {
        const companyName = myCompany?.full_legal_name || 'Louis Smart CRM Node';
        const contactPerson = myCompany?.responsible_person || '';
        let sigText = defaultSig.signature_body_content;
        sigText = replacePlaceholders(sigText, companyName, contactPerson);
        
        const initialBody = `<p><br></p>${sigText}`;
        setBody(initialBody);
        setSelectedSignatureId(defaultSig.id_uuid || '');
        if (editorRef.current) {
          editorRef.current.innerHTML = initialBody;
        }
      }
    }
  }, [isOpen, signatures, myCompany]);

  // Reset states
  const handleReset = () => {
    setSubject('');
    setBody('');
    setSelectedTemplateId('');
    setSelectedSignatureId('');
    setCustomAttachments([]);
    if (editorRef.current) {
      editorRef.current.innerHTML = '';
    }
  };

  const getContentType = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimes: Record<string, string> = {
      pdf: 'application/pdf',
      txt: 'text/plain',
      md: 'text/markdown',
      rst: 'text/x-rst',
      json: 'application/json',
      jsonl: 'application/x-ndjson',
      csv: 'text/csv',
      html: 'text/html',
      xml: 'application/xml',
      xls: 'application/vnd.ms-excel',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      py: 'text/x-python',
      js: 'application/javascript',
      java: 'text/x-java-source'
    };
    return mimes[ext] || 'application/octet-stream';
  };

  const handleAttachProfileFile = async (filename: string, size: number) => {
    if (!profileId || !profileType) return;
    
    const isAlreadyAttached = customAttachments.some(att => att.filename === filename);
    if (isAlreadyAttached) {
      toast.error(t('admin:mail.file_already_attached', { filename }));
      return;
    }

    try {
      setLoadingFile(filename);
      const res = await getFileContentMutation.mutateAsync({
        type: profileType,
        id_uuid: profileId,
        name: profileName,
        filename
      });

      if (res.success) {
        setCustomAttachments(prev => [...prev, {
          filename,
          content: res.content,
          size,
          contentType: getContentType(filename),
          saveToProfile: false,
          alreadyInProfile: true
        }]);
        toast.success(t('admin:mail.file_attached_success', { filename }));
      }
    } catch (err: unknown) {
      console.error("Error fetching file content:", err);
      const errMsg = err instanceof Error ? err.message : '';
      toast.error(t('admin:mail.file_load_error', { filename, error: errMsg }));
    } finally {
      setLoadingFile(null);
    }
  };

  const allowedExtensions = ['md', 'txt', 'rst', 'json', 'jsonl', 'csv', 'html', 'xml', 'xls', 'pdf', 'docx', 'pptx', 'py', 'js', 'java'];
  
  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    (Array.from(files) as File[]).forEach((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !allowedExtensions.includes(ext)) {
        toast.error(t('admin:mail.file_type_not_allowed', { ext, allowed: allowedExtensions.map(extName => '.' + extName).join(', ') }));
        return;
      }
      
      const isAlreadyAttached = customAttachments.some(att => att.filename === file.name);
      if (isAlreadyAttached) {
        toast.error(t('admin:mail.file_already_attached', { filename: file.name }));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const base64Content = (reader.result as string).split(',')[1];
        const isStored = profileFiles.some((f: { name: string }) => f.name === file.name);
        
        setCustomAttachments(prev => [...prev, {
          filename: file.name,
          content: base64Content,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          saveToProfile: !isStored,
          alreadyInProfile: isStored
        }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  // Safe WYSIWYG Commands
  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setBody(editorRef.current.innerHTML);
    }
  };

  const addLink = () => {
    const url = prompt(t('admin:templates.prompt_link_url'));
    if (url) {
      execCmd('createLink', url);
    }
  };

  // Handle template selection
  const handleTemplateChange = (tmplId: string) => {
    setSelectedTemplateId(tmplId);
    const tmpl = templates.find(t => t.id_uuid === tmplId);
    if (tmpl) {
      const companyName = myCompany?.full_legal_name || 'Louis Smart CRM Node';
      const contactPerson = myCompany?.responsible_person || '';
      
      let sub = tmpl.email_subject_text;
      let bodyText = tmpl.email_body_content;

      sub = replacePlaceholders(sub, companyName, contactPerson);
      bodyText = replacePlaceholders(bodyText, companyName, contactPerson);

      setSubject(sub);
      
      // If signature is selected, append signature
      const activeSig = signatures.find(s => s.id_uuid === selectedSignatureId);
      if (activeSig) {
        let sigText = activeSig.signature_body_content;
        sigText = replacePlaceholders(sigText, companyName, contactPerson);
        bodyText = `${bodyText}<p><br></p>${sigText}`;
      }

      setBody(bodyText);
      if (editorRef.current) {
        editorRef.current.innerHTML = bodyText;
      }
    }
  };

  // Handle signature selection
  const handleSignatureChange = (sigId: string) => {
    setSelectedSignatureId(sigId);
    const sig = signatures.find(s => s.id_uuid === sigId);
    if (sig) {
      const companyName = myCompany?.full_legal_name || 'Louis Smart CRM Node';
      const contactPerson = myCompany?.responsible_person || '';
      
      let sigText = sig.signature_body_content;
      sigText = replacePlaceholders(sigText, companyName, contactPerson);

      // We append signature text at the end of current editor text
      let currentBody = editorRef.current ? editorRef.current.innerHTML : body;
      
      // Filter out any previous signature markup or append cleanly
      currentBody = `${currentBody}<p><br></p>${sigText}`;
      
      setBody(currentBody);
      if (editorRef.current) {
        editorRef.current.innerHTML = currentBody;
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mailBody = editorRef.current ? editorRef.current.innerHTML : body;

    // Save marked custom attachments to profile first
    if (profileId && profileType) {
      const toSave = customAttachments.filter(att => att.saveToProfile && !att.alreadyInProfile);
      for (const att of toSave) {
        try {
          await saveFileMutation.mutateAsync({
            type: profileType,
            id_uuid: profileId,
            name: profileName,
            filename: att.filename,
            content: att.content
          });
        } catch (saveErr) {
          console.error("Failed to save file to profile before mail send:", saveErr);
          toast.error(t('admin:mail.file_save_profile_error', { filename: att.filename }));
        }
      }
      if (toSave.length > 0) {
        utils.getFiles.invalidate({ type: profileType, id_uuid: profileId, name: profileName });
      }
    }

    sendMailMutation.mutate({
      recipient_email_address: recipientEmail,
      email_subject_text: subject,
      email_body_content: mailBody,
      invoiceId: invoice?.id_uuid,
      customAttachments: customAttachments.map(att => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType
      }))
    });
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={() => { onClose(); handleReset(); }} 
      title={t('mail.send')}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Recipient card */}
        <div className="flex items-center gap-4 p-4 bg-primary-light/50 rounded-xl border border-white/5">
          <div className="p-3 bg-accent-blue/10 rounded-xl">
            <Mail className="text-accent-blue" size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('common:recipient')}</p>
            <p className="text-sm font-bold text-white truncate">{recipientName} <span className="text-slate-500 font-medium">({recipientEmail})</span></p>
          </div>
        </div>

        {invoice && (
          <div className="flex items-center gap-4 p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <div className="p-3 bg-emerald-500/20 rounded-xl">
              <FileText className="text-emerald-400" size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('admin:mail.attachment_auto')}</p>
              <p className="text-xs font-bold text-emerald-400 truncate">
                {`${t('common:invoice_single')} - ${recipientName.replace(/[/\\?%*:|"<>\.]/g, '')} - ${invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`}
              </p>
            </div>
          </div>
        )}

        {/* Templates and Signatures selection area */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Template Select */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2 flex items-center gap-1.5">
              <FileText size={12} className="text-accent-blue" />
              {t('admin:mail.load_template')}
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs focus:outline-none focus:border-accent-blue transition-colors appearance-none cursor-pointer"
            >
              <option value="">{t('admin:mail.no_template')}</option>
              {templates.map((tmpl) => (
                <option key={tmpl.id_uuid} value={tmpl.id_uuid}>
                  {tmpl.template_name_text}
                </option>
              ))}
            </select>
          </div>

          {/* Signature Select */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2 flex items-center gap-1.5">
              <Signature size={12} className="text-accent-blue" />
              {t('admin:mail.attach_signature')}
            </label>
            <select
              value={selectedSignatureId}
              onChange={(e) => handleSignatureChange(e.target.value)}
              className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-4 py-3 text-white font-bold text-xs focus:outline-none focus:border-accent-blue transition-colors appearance-none cursor-pointer"
            >
              <option value="">{t('admin:mail.no_signature')}</option>
              {signatures.map((sig) => (
                <option key={sig.id_uuid} value={sig.id_uuid}>
                  {sig.signature_name_text} {sig.is_default_signature ? t('admin:mail.default_suffix') : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mail Subject line */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2">{t('mail.subject')}</label>
          <input 
            type="text" 
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-xl px-6 py-4 text-white font-bold focus:outline-none focus:border-accent-blue transition-colors"
            placeholder={t('admin:mail.subject_placeholder')}
            required
          />
        </div>

        {/* WYSIWYG Editor section */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest font-display ml-2 flex items-center gap-1.5">
            <Sparkles size={12} className="text-accent-blue" />
            {t('admin:mail.content_editable')}
          </label>
          
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1 bg-primary-dark/80 p-2 border border-white/10 border-b-0 rounded-t-xl">
            <button
              type="button"
              onClick={() => execCmd('bold')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('admin:mail.btn_bold')}
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              onClick={() => execCmd('italic')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('admin:mail.btn_italic')}
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              onClick={() => execCmd('underline')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('admin:mail.btn_underline')}
            >
              <Underline size={13} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => execCmd('insertUnorderedList')}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('admin:mail.btn_list')}
            >
              <List size={13} />
            </button>
            <button
              type="button"
              onClick={addLink}
              className="p-2 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
              title={t('admin:mail.btn_link')}
            >
              <Link size={13} />
            </button>
            <div className="w-px h-6 bg-white/10 mx-1" />
            <button
              type="button"
              onClick={() => {
                const currentText = editorRef.current ? editorRef.current.innerHTML : body;
                setAiFieldId('email_body');
                setAiContext('E-Mail Haupttext');
                setAiValue(currentText || '');
              }}
              className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors flex items-center gap-1.5 ml-auto text-[10px] font-black uppercase tracking-widest font-display"
              title={t('admin:mail.generate_ai_btn')}
            >
              <Sparkles size={12} className="animate-pulse text-emerald-400" />
              {t('admin:mail.generate_ai_btn')}
            </button>
          </div>

          <div 
            ref={editorRef}
            contentEditable
            onInput={() => { if (editorRef.current) setBody(editorRef.current.innerHTML); }}
            className="w-full bg-primary-dark/60 border border-white/10 rounded-b-xl px-6 py-6 text-white min-h-[250px] max-h-[350px] overflow-y-auto focus:outline-none focus:border-accent-blue transition-colors custom-scrollbar"
            style={{ outline: 'none' }}
            placeholder={t('admin:mail.editor_placeholder')}
          />
        </div>

        {/* Custom Attachments Section */}
        <div className="space-y-3 bg-primary-light/30 p-4 rounded-xl border border-white/5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display flex items-center gap-1.5">
              <Paperclip size={12} className="text-accent-orange" />
              {t('admin:mail.attachments_title')}
            </label>
            <button
              type="button"
              onClick={() => fileAttachInputRef.current?.click()}
              className="px-3 py-1.5 bg-primary-dark border border-white/10 text-slate-300 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer"
            >
              <Upload size={10} />
              {t('admin:mail.add_file')}
            </button>
            <input
              type="file"
              ref={fileAttachInputRef}
              className="hidden"
              multiple
              onChange={handleFileSelection}
              accept={allowedExtensions.map(ext => `.${ext}`).join(',')}
            />
          </div>

          {customAttachments.length === 0 ? (
            <p className="text-slate-500 text-[10px] uppercase font-black tracking-widest text-center py-4 bg-primary-dark/30 rounded-lg border-2 border-dashed border-white/5">
              {t('admin:mail.no_files_attached')}
            </p>
          ) : (
            <div className="space-y-2 font-display">
              {customAttachments.map((att, index) => (
                <div 
                  key={index} 
                  className="flex items-center justify-between p-3 bg-primary-dark/60 rounded-xl border border-white/5 hover:border-white/10 transition-all animate-fade-in"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileText size={16} className="text-slate-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate" title={att.filename}>
                        {att.filename}
                      </p>
                      <p className="text-[9px] font-mono text-slate-500 font-black uppercase tracking-wider mt-0.5">
                        {(att.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {profileId && profileType ? (
                      att.alreadyInProfile ? (
                        <span className="flex items-center gap-1 text-[9px] font-black text-emerald-400 uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg">
                          <CheckCircle2 size={10} />
                          {t('admin:mail.already_in_profile')}
                        </span>
                      ) : (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                           <input
                            type="checkbox"
                            checked={att.saveToProfile}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setCustomAttachments(prev => prev.map((item, idx) => idx === index ? { ...item, saveToProfile: checked } : item));
                            }}
                            className="w-3.5 h-3.5 border-white/10 rounded cursor-pointer text-accent-orange bg-primary-dark focus:ring-0"
                          />
                          <span className="text-[9px] font-black text-slate-400 hover:text-white uppercase tracking-wider">
                            {t('admin:mail.save_in_profile')}
                          </span>
                        </label>
                      )
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        setCustomAttachments(prev => prev.filter((_, idx) => idx !== index));
                      }}
                      className="p-1.5 text-slate-500 hover:text-red-500 transition-colors cursor-pointer"
                      title={t('admin:mail.remove_attachment')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Existierende Profildateien */}
          {profileId && profileType && profileFiles.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display flex items-center gap-1.5">
                <Paperclip size={12} className="text-accent-blue" />
                {t('admin:mail.add_from_profile_manager')}
              </p>
              <div className="flex flex-wrap gap-2">
                {profileFiles.map((file: { name: string; size: number }) => {
                  const isAttached = customAttachments.some(att => att.filename === file.name);
                  const isLoading = loadingFile === file.name;
                  return (
                    <button
                      key={file.name}
                      type="button"
                      disabled={isAttached || isLoading}
                      onClick={() => handleAttachProfileFile(file.name, file.size)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-2 ${
                        isAttached 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 cursor-not-allowed"
                          : isLoading
                            ? "bg-primary-dark/50 border-white/5 text-slate-500 cursor-wait animate-pulse"
                            : "bg-primary-dark/40 border-white/5 text-slate-300 hover:text-white hover:border-white/10 hover:bg-primary-dark cursor-pointer"
                      }`}
                    >
                      <Paperclip size={12} className={isAttached ? "text-emerald-400" : "text-slate-500"} />
                      <span className="truncate max-w-[180px]" title={file.name}>{file.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 font-medium">({(file.size / 1024).toFixed(1)} KB)</span>
                      {isAttached && (
                        <span className="text-[9px] uppercase font-black text-emerald-400 ml-1">{t('admin:mail.attached_badge')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-4 pt-4">
          <button 
            type="button"
            onClick={() => { onClose(); handleReset(); }}
            className="px-8 py-4 rounded-xl bg-primary-dark border border-white/10 text-slate-400 font-bold text-[10px] uppercase tracking-widest hover:text-white transition-colors font-display"
          >
            {t('common:cancel')}
          </button>
          <button 
            type="submit"
            disabled={sendMailMutation.isPending}
            className="px-8 py-4 bg-accent-blue text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-accent-blue/20 disabled:opacity-50 disabled:grayscale disabled:scale-100"
          >
            {sendMailMutation.isPending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('mail.sending')}
              </>
            ) : (
              <>
                <Send size={16} />
                {t('mail.send')}
              </>
            )}
          </button>
        </div>
      </form>
      <AiTextGeneratorDialog
        isOpen={aiFieldId !== null}
        onClose={() => setAiFieldId(null)}
        fieldId={aiFieldId || ''}
        fieldValue={aiValue}
        context={aiContext}
        onAccept={(newValue) => {
          if (aiFieldId === 'email_body') {
            setBody(newValue);
            if (editorRef.current) {
              editorRef.current.innerHTML = newValue;
            }
          }
        }}
      />
    </Dialog>
  );
};
