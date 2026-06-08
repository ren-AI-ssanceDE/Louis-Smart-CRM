import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { 
  Download, 
  UploadCloud, 
  CheckCircle, 
  AlertTriangle, 
  FileSpreadsheet,
  Info,
  ArrowRight,
  Trash2,
  ChevronRight,
  AlertCircle,
  Check,
  Building2,
  Users
} from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { 
  Company, 
  Contact, 
  EmailTemplate, 
  Signature, 
  InvoiceTextTemplate, 
  InvoiceItemTemplate 
} from '../../types';
import { CompanySchema, ContactSchema, EmailTemplateSchema, SignatureSchema, InvoiceTextTemplateSchema, InvoiceItemTemplateSchema } from '../../lib/schemas';

// Normalization Helpers for Robust Duplicate Tracking
const normalizeName = (s: string | null | undefined) => s ? String(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
const normalizePhone = (s: string | null | undefined) => s ? String(s).replace(/[^0-9]/g, '') : '';
const normalizeEmail = (s: string | null | undefined) => s ? String(s).toLowerCase().trim() : '';
const normalizeTax = (s: string | null | undefined) => s ? String(s).toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

const generateUUID = (): string => {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Validation & Sanitization Helpers to conform with Zod expectations during imports
const cleanUrl = (urlStr: string): string | undefined => {
  if (!urlStr) return undefined;
  const val = urlStr.trim();
  if (!val) return undefined;
  
  const lower = val.toLowerCase();
  if (lower === 'n/a' || lower === 'none' || lower === '-' || lower === 'no') {
    return undefined;
  }
  
  // If it starts with http:// or https://, check if it's generally a valid URL
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    try {
      new URL(val);
      return val;
    } catch {
      return undefined;
    }
  }
  
  // If it doesn't start with http/https but contains a dot and doesn't have spaces, try prepending https://
  if (val.includes('.') && !val.includes(' ')) {
    const prefixed = `https://${val}`;
    try {
      new URL(prefixed);
      return prefixed;
    } catch {
      return undefined;
    }
  }
  
  return undefined;
};

const cleanEmail = (emailStr: string): string | undefined => {
  if (!emailStr) return undefined;
  const val = emailStr.trim();
  if (!val) return undefined;
  
  const lower = val.toLowerCase();
  if (lower === 'n/a' || lower === 'none' || lower === '-' || lower === 'no') {
    return undefined;
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(val)) {
    return val;
  }
  
  return undefined;
};

interface CompanyConflict {
  id: string;
  incoming: Company;
  existing: Company;
  matchReasons: string[];
  decision: 'update' | 'create_new' | 'discard';
}

interface ContactConflict {
  id: string;
  incoming: Contact;
  existing: Contact;
  matchReasons: string[];
  decision: 'update' | 'create_new' | 'discard';
}

export const DataPortabilityTab = () => {
  const { t } = useTranslation(['admin', 'common', 'companies', 'contacts']);
  const [activePortabilityTab, setActivePortabilityTab] = useState<'stammdaten' | 'vorlagen' | 'rechnungsposten'>('stammdaten');

  const [dragActiveCompany, setDragActiveCompany] = useState(false);
  const [dragActiveContact, setDragActiveContact] = useState(false);
  const [dragActiveEmail, setDragActiveEmail] = useState(false);
  const [dragActiveSignature, setDragActiveSignature] = useState(false);
  const [dragActiveInvoiceText, setDragActiveInvoiceText] = useState(false);
  const [dragActiveInvoiceItem, setDragActiveInvoiceItem] = useState(false);
  
  const [companyStatus, setCompanyStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [contactStatus, setContactStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [emailStatus, setEmailStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [signatureStatus, setSignatureStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [invoiceTextStatus, setInvoiceTextStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });
  const [invoiceItemStatus, setInvoiceItemStatus] = useState<{ type: 'idle' | 'success' | 'error'; message: string }>({ type: 'idle', message: '' });

  // Flow States
  const [activeView, setActiveView] = useState<'upload' | 'resolve_companies' | 'resolve_contacts'>('upload');
  
  const [companyConflicts, setCompanyConflicts] = useState<CompanyConflict[]>([]);
  const [safeCompanies, setSafeCompanies] = useState<Company[]>([]);
  
  const [contactConflicts, setContactConflicts] = useState<ContactConflict[]>([]);
  const [safeContacts, setSafeContacts] = useState<Contact[]>([]);

  // Fetch all companies and contacts for export and real-time mapping
  const { data: rawCompanies = [], refetch: refetchCompanies } = trpc.getCompanies.useQuery();
  const { data: rawContacts = [], refetch: refetchContacts } = trpc.getContacts.useQuery();
  const companies = rawCompanies as Company[];
  const contacts = rawContacts as Contact[];
  
  const { data: emailTemplates = [], refetch: refetchEmailTemplates } = trpc.getEmailTemplates.useQuery();
  const { data: signatures = [], refetch: refetchSignatures } = trpc.getSignatures.useQuery();
  const { data: invoiceTextTemplates = [], refetch: refetchInvoiceTextTemplates } = trpc.getInvoiceTextTemplates.useQuery();
  const { data: invoiceItemTemplates = [], refetch: refetchInvoiceItemTemplates } = trpc.getInvoiceItemTemplates.useQuery();

  const companiesMutation = trpc.importCompanies.useMutation();
  const contactsMutation = trpc.importContacts.useMutation();
  const importEmailTemplatesMutation = trpc.importEmailTemplates.useMutation();
  const importSignaturesMutation = trpc.importSignatures.useMutation();
  const importInvoiceTextTemplatesMutation = trpc.importInvoiceTextTemplates.useMutation();
  const importInvoiceItemTemplatesMutation = trpc.importInvoiceItemTemplates.useMutation();

  // Helper to trigger file download
  const triggerDownload = (filename: string, content: string) => {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), content], { type: 'text/csv;charset=utf-8;' }); // UTF-8 BOM
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to turn array of objects into CSV string
  const generateCSV = (headers: string[], rows: (string | number | boolean | null | undefined)[][]) => {
    const csvContent = [
      headers.map(h => `"${h.replace(/"/g, '""')}"`).join(';'), // Semicolon delimiter by default for DACH Excel compatibility
      ...rows.map(row => 
        row.map(val => {
          if (val === null || val === undefined) return '';
          const str = String(val);
          return `"${str.replace(/"/g, '""')}"`;
        }).join(';')
      )
    ].join('\n');
    return csvContent;
  };

  // 1. COMPANIES CSV EXPORT
  const handleExportCompanies = () => {
    const headers = [
      'id_uuid', 'full_legal_name', 'tax_vat_id', 'tax_number', 'responsible_person', 
      'street', 'house_number', 'postal_code', 'city', 'country_code', 'email_address', 
      'email_2', 'website', 'phone_number', 'mobile_number', 'fax_number', 'iban', 
      'bic_swift', 'leitweg_id', 'payment_term', 'price_list', 'language', 'labels',
      'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'
    ];

    const rows = companies.map(c => [
      c.id_uuid || '',
      c.full_legal_name || '',
      c.tax_vat_id || '',
      c.tax_number || '',
      c.responsible_person || '',
      c.street || '',
      c.house_number || '',
      c.postal_code || '',
      c.city || '',
      c.country_code || 'DE',
      c.email_address || '',
      c.email_2 || '',
      c.website || '',
      c.phone_number || '',
      c.mobile_number || '',
      c.fax_number || '',
      c.iban || '',
      c.bic_swift || '',
      c.leitweg_id || '',
      c.payment_term || '',
      c.price_list || '',
      c.language || 'de',
      (c.labels || []).join('|'),
      c.opt_in_marketing ? 'true' : 'false',
      c.opt_in_social_media ? 'true' : 'false',
      c.opt_in_direct_message ? 'true' : 'false',
      c.opt_in_sms ? 'true' : 'false',
      c.opt_in_phone ? 'true' : 'false'
    ]);

    const csv = generateCSV(headers, rows);
    triggerDownload('companies_export.csv', csv);
  };

  // 2. CONTACTS CSV EXPORT
  const handleExportContacts = () => {
    const headers = [
      'id_uuid', 'first_name', 'last_name', 'responsible_person', 'salutation', 
      'gender_identity', 'date_of_birth', 'region', 'street', 'house_number', 
      'postal_code', 'city', 'email_address', 'email_2', 'website', 'phone_number', 
      'fax_number', 'mobile_number', 'language', 'labels', 'associated_company_id',
      'tax_vat_id', 'iban', 'bic_swift', 'payment_term', 'price_list',
      'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'
    ];

    const rows = contacts.map(c => [
      c.id_uuid || '',
      c.first_name || '',
      c.last_name || '',
      c.responsible_person || '',
      c.salutation || '',
      c.gender_identity || '',
      c.date_of_birth || '',
      c.region || '',
      c.street || '',
      c.house_number || '',
      c.postal_code || '',
      c.city || '',
      c.email_address || '',
      c.email_2 || '',
      c.website || '',
      c.phone_number || '',
      c.fax_number || '',
      c.mobile_number || '',
      c.language || 'de',
      (c.labels || []).join('|'),
      c.associated_company_id || '',
      c.tax_vat_id || '',
      c.iban || '',
      c.bic_swift || '',
      c.payment_term || '',
      c.price_list || '',
      c.opt_in_marketing ? 'true' : 'false',
      c.opt_in_social_media ? 'true' : 'false',
      c.opt_in_direct_message ? 'true' : 'false',
      c.opt_in_sms ? 'true' : 'false',
      c.opt_in_phone ? 'true' : 'false'
    ]);

    const csv = generateCSV(headers, rows);
    triggerDownload('contacts_export.csv', csv);
  };

  // Helper to download templates
  const handleDownloadTemplateCompanies = () => {
    const headers = [
      'id_uuid', 'full_legal_name', 'tax_vat_id', 'tax_number', 'responsible_person', 
      'street', 'house_number', 'postal_code', 'city', 'country_code', 'email_address', 
      'email_2', 'website', 'phone_number', 'mobile_number', 'fax_number', 'iban', 
      'bic_swift', 'leitweg_id', 'payment_term', 'price_list', 'language', 'labels',
      'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'
    ];
    const exampleRow = [
      '', 'Muster GmbH & Co. KG', 'DE123456789', '21/440/12345', 'John Doe',
      'Musterstraße', '12', '10117', 'Berlin', 'DE', 'info@mustergmbh.de',
      '', 'https://mustergmbh.de', '+49 30 1234567', '', '', 'DE89370400440532013000',
      'DBBDEBBXXX', '991-12345-67', 'net_14', 'default', 'de', 'Kunde|Partner',
      'false', 'false', 'false', 'false', 'false'
    ];
    const csv = generateCSV(headers, [exampleRow]);
    triggerDownload('companies_template.csv', csv);
  };

  const handleDownloadTemplateContacts = () => {
    const headers = [
      'id_uuid', 'first_name', 'last_name', 'responsible_person', 'salutation', 
      'gender_identity', 'date_of_birth', 'region', 'street', 'house_number', 
      'postal_code', 'city', 'email_address', 'email_2', 'website', 'phone_number', 
      'fax_number', 'mobile_number', 'language', 'labels', 'associated_company_id',
      'tax_vat_id', 'iban', 'bic_swift', 'payment_term', 'price_list',
      'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'
    ];
    const exampleRow = [
      '', 'Max', 'Mustermann', 'Jane Smith', 'Herr',
      'male', '1980-01-01', 'Berlin', 'Friedrichstr.', '100',
      '10117', 'Berlin', 'max@mustermann.de', '', '', '+49 170 1234567',
      '', '', 'de', 'Entscheider', '',
      '', '', '', 'net_30', 'vip',
      'true', 'false', 'false', 'false', 'false'
    ];
    const csv = generateCSV(headers, [exampleRow]);
    triggerDownload('contacts_template.csv', csv);
  };

  // EMAIL TEMPLATE CSV EXPORT
  const handleExportEmailTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'email_subject_text', 'email_body_content'];
    const rows = emailTemplates.map(t => [
      t.id_uuid || '',
      t.template_name_text || '',
      t.email_subject_text || '',
      t.email_body_content || ''
    ]);
    const csv = generateCSV(headers, rows);
    triggerDownload('email_templates_export.csv', csv);
  };

  const handleDownloadTemplateEmailTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'email_subject_text', 'email_body_content'];
    const example = ['', 'Standard Begrueßung', 'Willkommen bei Louis Smart CRM', 'Hallo {{name}},\nvielen Dank fuer Ihre Nachricht!'];
    const csv = generateCSV(headers, [example]);
    triggerDownload('email_templates_template.csv', csv);
  };

  // SIGNATURE CSV EXPORT
  const handleExportSignatures = () => {
    const headers = ['id_uuid', 'signature_name_text', 'signature_body_content', 'is_default_signature'];
    const rows = signatures.map(s => [
      s.id_uuid || '',
      s.signature_name_text || '',
      s.signature_body_content || '',
      s.is_default_signature ? 'true' : 'false'
    ]);
    const csv = generateCSV(headers, rows);
    triggerDownload('signatures_export.csv', csv);
  };

  const handleDownloadTemplateSignatures = () => {
    const headers = ['id_uuid', 'signature_name_text', 'signature_body_content', 'is_default_signature'];
    const example = ['', 'Standard Signatur', 'Mit freundlichen Grueßen\nLouis Smart CRM Team', 'true'];
    const csv = generateCSV(headers, [example]);
    triggerDownload('signatures_template.csv', csv);
  };

  // INVOICE TEXT TEMPLATE CSV EXPORT
  const handleExportInvoiceTextTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'template_type_code', 'template_body_content'];
    const rows = invoiceTextTemplates.map(t => [
      t.id_uuid || '',
      t.template_name_text || '',
      t.template_type_code || '',
      t.template_body_content || ''
    ]);
    const csv = generateCSV(headers, rows);
    triggerDownload('invoice_text_templates_export.csv', csv);
  };

  const handleDownloadTemplateInvoiceTextTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'template_type_code', 'template_body_content'];
    const example = ['', 'Standard Einleitung', 'introductory', 'vielen Dank fuer die gute Zusammenarbeit. Hier ist Ihre Rechnung:'];
    const csv = generateCSV(headers, [example]);
    triggerDownload('invoice_text_templates_template.csv', csv);
  };

  // INVOICE ITEM TEMPLATE (RECHNUNGSPOSTEN) CSV EXPORT
  const handleExportInvoiceItemTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'description', 'quantity', 'unit_price', 'vat_rate', 'unit_code'];
    const rows = invoiceItemTemplates.map(item => [
      item.id_uuid || '',
      item.template_name_text || '',
      item.description || '',
      String(item.quantity ?? 1),
      String(item.unit_price ?? 0),
      String(item.vat_rate ?? 19),
      item.unit_code || 'HUR'
    ]);
    const csv = generateCSV(headers, rows);
    triggerDownload('invoice_item_templates_export.csv', csv);
  };

  const handleDownloadTemplateInvoiceItemTemplates = () => {
    const headers = ['id_uuid', 'template_name_text', 'description', 'quantity', 'unit_price', 'vat_rate', 'unit_code'];
    const example = ['', 'Entwicklungsstunde', 'Softwareentwicklung und Beratung', '1', '120.00', '19', 'HUR'];
    const csv = generateCSV(headers, [example]);
    triggerDownload('invoice_item_templates_template.csv', csv);
  };

  // processors for CSV settings uploads
  const processEmailTemplateCSV = async (text: string) => {
    try {
      setEmailStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV Datei ist leer oder enthaelt keine Datenzeilen.' }));
      }
      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);
      
      const parsed = dataRows.map((row) => {
        const obj: Record<string, string | undefined> = {};
        headers.forEach((header, index) => {
          const val = String(row[index] || '').trim();
          obj[header] = val === '' ? undefined : val;
        });
        
        obj.email_body_content = obj.email_body_content || '';
        
        const parseResult = EmailTemplateSchema.partial({ tenant_id: true }).safeParse(obj);
        if (!parseResult.success) {
          throw new Error(`Ungültige Daten in Zeile für E-Mail-Vorlage: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        }
        return parseResult.data;
      });

      const res = await importEmailTemplatesMutation.mutateAsync(parsed);
      setEmailStatus({ 
        type: 'success', 
        message: t('admin:data_portability.import_success_email', { 
          defaultValue: '{{importedCount}} E-Mail-Vorlagen neu importiert, {{updatedCount}} Vorlagen aktualisiert.', 
          importedCount: res.importedCount, 
          updatedCount: res.updatedCount 
        })
      });
      refetchEmailTemplates();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : 'Fehler beim CSV-Import.';
      setEmailStatus({ type: 'error', message: errMsg });
    }
  };

  const processSignatureCSV = async (text: string) => {
    try {
      setSignatureStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV-Datei ist leer oder enthaelt keine Datenzeilen.' }));
      }
      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      const parsed = dataRows.map((row) => {
        const obj: Record<string, string | boolean | undefined> = {};
        headers.forEach((header, index) => {
          const val = String(row[index] || '').trim();
          if (header === 'is_default_signature') {
            obj[header] = val.toLowerCase() === 'true';
          } else {
            obj[header] = val === '' ? undefined : val;
          }
        });
        
        obj.signature_body_content = (obj.signature_body_content as string) || '';
        
        const parseResult = SignatureSchema.partial({ tenant_id: true }).safeParse(obj);
        if (!parseResult.success) {
          throw new Error(`Ungültige Daten in Zeile für Signatur: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        }
        return parseResult.data;
      });

      const res = await importSignaturesMutation.mutateAsync(parsed);
      setSignatureStatus({
        type: 'success',
        message: t('admin:data_portability.import_success_signatures', {
          defaultValue: '{{importedCount}} Signaturen neu importiert, {{updatedCount}} Signaturen aktualisiert.',
          importedCount: res.importedCount,
          updatedCount: res.updatedCount
        })
      });
      refetchSignatures();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : 'Fehler beim CSV-Import.';
      setSignatureStatus({ type: 'error', message: errMsg });
    }
  };

  const processInvoiceTextTemplateCSV = async (text: string) => {
    try {
      setInvoiceTextStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV-Datei ist leer oder enthaelt keine Datenzeilen.' }));
      }
      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      const parsed = dataRows.map((row) => {
        const obj: Record<string, string | undefined> = {};
        headers.forEach((header, index) => {
          const val = String(row[index] || '').trim();
          obj[header] = val === '' ? undefined : val;
        });
        
        obj.template_body_content = obj.template_body_content || '';
        
        const parseResult = InvoiceTextTemplateSchema.partial({ tenant_id: true }).safeParse(obj);
        if (!parseResult.success) {
          throw new Error(`Ungültige Daten in Zeile für Rechnungstext-Vorlage: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        }
        return parseResult.data;
      });

      const res = await importInvoiceTextTemplatesMutation.mutateAsync(parsed);
      setInvoiceTextStatus({
        type: 'success',
        message: t('admin:data_portability.import_success_texts', {
          defaultValue: '{{importedCount}} Rechnungstexte neu importiert, {{updatedCount}} Rechnungstexte aktualisiert.',
          importedCount: res.importedCount,
          updatedCount: res.updatedCount
        })
      });
      refetchInvoiceTextTemplates();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : 'Fehler beim CSV-Import.';
      setInvoiceTextStatus({ type: 'error', message: errMsg });
    }
  };

  const processInvoiceItemTemplateCSV = async (text: string) => {
    try {
      setInvoiceItemStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV-Datei ist leer oder enthaelt keine Datenzeilen.' }));
      }
      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);

      const parsed = dataRows.map((row) => {
        const obj: Record<string, string | number | undefined> = {};
        headers.forEach((header, index) => {
          const val = String(row[index] || '').trim();
          if (['quantity', 'unit_price', 'vat_rate'].includes(header)) {
            obj[header] = val ? parseFloat(val) : undefined;
          } else {
            obj[header] = val === '' ? undefined : val;
          }
        });
        
        obj.description = (obj.description as string) || '';
        obj.quantity = (obj.quantity as number) ?? 1;
        obj.unit_price = (obj.unit_price as number) ?? 0;
        obj.vat_rate = (obj.vat_rate as number) ?? 19;
        obj.unit_code = (obj.unit_code as string) || 'HUR';
        
        const parseResult = InvoiceItemTemplateSchema.partial({ tenant_id: true }).safeParse(obj);
        if (!parseResult.success) {
          throw new Error(`Ungültige Daten in Zeile für Rechnungsartikel-Vorlage: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        }
        return parseResult.data;
      });

      const res = await importInvoiceItemTemplatesMutation.mutateAsync(parsed);
      setInvoiceItemStatus({
        type: 'success',
        message: t('admin:data_portability.import_success_items', {
          defaultValue: '{{importedCount}} Rechnungsposten neu importiert, {{updatedCount}} Rechnungsposten aktualisiert.',
          importedCount: res.importedCount,
          updatedCount: res.updatedCount
        })
      });
      refetchInvoiceItemTemplates();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : 'Fehler beim CSV-Import.';
      setInvoiceItemStatus({ type: 'error', message: errMsg });
    }
  };

  // CSV Parser with Semicolon and Comma heuristic auto-detection
  const parseCSV = (text: string): string[][] => {
    const lines: string[][] = [];
    let row: string[] = [];
    let inQuotes = false;
    let currentVal = '';
    
    // Remove UTF-8 Byte Order Mark if present
    const cleanText = text.replace(/^\uFEFF/, '');
    const content = cleanText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const firstLine = content.split('\n')[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ';' : ',';
    
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const nextChar = content[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentVal += '"';
          i++; // skip next quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        row.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\n' && !inQuotes) {
        row.push(currentVal.trim());
        lines.push(row);
        row = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    if (currentVal || row.length > 0) {
      row.push(currentVal.trim());
      lines.push(row);
    }
    return lines.filter(r => r.length > 0 && r.some(v => v !== ''));
  };

  // Analysis of Companies to search for fuzzy/concrete duplicates
  const analyzeCompaniesImport = (parsedRows: Company[]) => {
    const conflicts: CompanyConflict[] = [];
    const safe: Company[] = [];

    for (const incoming of parsedRows) {
      let matchedExisting: Company | null = null;
      const reasons: string[] = [];

      // 1. Match by id_uuid (if provided)
      if (incoming.id_uuid) {
        matchedExisting = companies.find((c: Company) => c.id_uuid === incoming.id_uuid) || null;
        if (matchedExisting) {
          reasons.push('Eindeutiger UUID-Vektor');
        }
      }

      // 2. Match by tax_vat_id (USt-IdNr)
      if (!matchedExisting && incoming.tax_vat_id) {
        const normInc = normalizeTax(incoming.tax_vat_id);
        if (normInc) {
          matchedExisting = companies.find((c: Company) => normalizeTax(c.tax_vat_id) === normInc) || null;
          if (matchedExisting) {
            reasons.push(`Gleiche Steuernummer / USt-IdNr.: ${incoming.tax_vat_id}`);
          }
        }
      }

      // 3. Match by email_address
      if (!matchedExisting && incoming.email_address) {
        const normInc = normalizeEmail(incoming.email_address);
        if (normInc) {
          matchedExisting = companies.find((c: Company) => normalizeEmail(c.email_address) === normInc) || null;
          if (matchedExisting) {
            reasons.push(`Gleiche E-Mail-Adresse: ${incoming.email_address}`);
          }
        }
      }

      // 4. Match by phone_number / mobile_number
      if (!matchedExisting) {
        const normIncPhone = normalizePhone(incoming.phone_number);
        const normIncMobile = normalizePhone(incoming.mobile_number);
        
        matchedExisting = companies.find((c: Company) => {
          const cPhone = normalizePhone(c.phone_number);
          const cMobile = normalizePhone(c.mobile_number);

          if (normIncPhone && (normIncPhone === cPhone || normIncPhone === cMobile)) {
            reasons.push(`Gleiche Telefonnummer: ${incoming.phone_number}`);
            return true;
          }
          if (normIncMobile && (normIncMobile === cPhone || normIncMobile === cMobile)) {
            reasons.push(`Gleiche Mobilnummer: ${incoming.mobile_number}`);
            return true;
          }
          return false;
        }) || null;
      }

      // 5. Match by full_legal_name
      if (!matchedExisting && incoming.full_legal_name) {
        const normInc = normalizeName(incoming.full_legal_name);
        if (normInc) {
          matchedExisting = companies.find((c: Company) => normalizeName(c.full_legal_name) === normInc) || null;
          if (matchedExisting) {
            reasons.push(`Identischer Firmenname: ${incoming.full_legal_name}`);
          }
        }
      }

      if (matchedExisting) {
        conflicts.push({
          id: Math.random().toString(36).substring(7),
          incoming,
          existing: matchedExisting,
          matchReasons: reasons,
          decision: 'update' // Default to merge update
        });
      } else {
        safe.push(incoming);
      }
    }

    return { conflicts, safe };
  };

  // Analysis of Contacts to search for fuzzy/concrete duplicates
  const analyzeContactsImport = (parsedRows: Contact[]) => {
    const conflicts: ContactConflict[] = [];
    const safe: Contact[] = [];

    for (const incoming of parsedRows) {
      let matchedExisting: Contact | null = null;
      const reasons: string[] = [];

      // 1. Match by id_uuid (if provided)
      if (incoming.id_uuid) {
        matchedExisting = contacts.find((c: Contact) => c.id_uuid === incoming.id_uuid) || null;
        if (matchedExisting) {
          reasons.push('Eindeutiger UUID-Vektor');
        }
      }

      // 2. Match by email_address
      if (!matchedExisting && incoming.email_address) {
        const normInc = normalizeEmail(incoming.email_address);
        if (normInc) {
          matchedExisting = contacts.find((c: Contact) => normalizeEmail(c.email_address) === normInc) || null;
          if (matchedExisting) {
            reasons.push(`Gleiche E-Mail-Adresse: ${incoming.email_address}`);
          }
        }
      }

      // 3. Match by phone_number / mobile_number
      if (!matchedExisting) {
        const normIncPhone = normalizePhone(incoming.phone_number);
        const normIncMobile = normalizePhone(incoming.mobile_number);
        
        matchedExisting = contacts.find((c: Contact) => {
          const cPhone = normalizePhone(c.phone_number);
          const cMobile = normalizePhone(c.mobile_number);

          if (normIncPhone && (normIncPhone === cPhone || normIncPhone === cMobile)) {
            reasons.push(`Gleiche Telefonnummer: ${incoming.phone_number}`);
            return true;
          }
          if (normIncMobile && (normIncMobile === cPhone || normIncMobile === cMobile)) {
            reasons.push(`Gleiche Mobilnummer: ${incoming.mobile_number}`);
            return true;
          }
          return false;
        }) || null;
      }

      // 4. Match by first_name and last_name
      if (!matchedExisting && incoming.last_name) {
        const normIncFirst = normalizeName(incoming.first_name || '');
        const normIncLast = normalizeName(incoming.last_name);
        
        matchedExisting = contacts.find((c: Contact) => {
          const cFirst = normalizeName(c.first_name || '');
          const cLast = normalizeName(c.last_name || '');
          return normIncFirst === cFirst && normIncLast === cLast;
        }) || null;

        if (matchedExisting) {
          reasons.push(`Gleicher Personenname: ${incoming.first_name || ''} ${incoming.last_name}`);
        }
      }

      if (matchedExisting) {
        conflicts.push({
          id: Math.random().toString(36).substring(7),
          incoming,
          existing: matchedExisting,
          matchReasons: reasons,
          decision: 'update' // Default to merge/update
        });
      } else {
        safe.push(incoming);
      }
    }

    return { conflicts, safe };
  };

  // 3. COMPANIES UPLOAD PROCESSOR
  const processCompanyCSV = async (text: string) => {
    try {
      setCompanyStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV Datei ist leer oder enthält keine Datenzeilen.' }));
      }

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);
      
      const parsedCompanies = dataRows.map((row) => {
        const rawObj: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          let val = row[index];
          if (val === undefined) val = '';
          const trimmedVal = String(val).trim();
          
          if (['opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'].includes(header)) {
            rawObj[header] = trimmedVal.toLowerCase() === 'true';
          } 
          else if (header === 'vat_rate') {
            rawObj[header] = trimmedVal ? parseFloat(trimmedVal) : 19;
          }
          else if (header === 'labels') {
            rawObj[header] = trimmedVal ? trimmedVal.split('|').map((l: string) => l.trim()).filter(Boolean) : [];
          }
          else if (header === 'website') {
            rawObj[header] = cleanUrl(trimmedVal) || '';
          }
          else if (header === 'email_address' || header === 'email_2') {
            rawObj[header] = cleanEmail(trimmedVal) || '';
          }
          else if (header === 'id_uuid') {
            rawObj[header] = trimmedVal === '' ? undefined : trimmedVal;
          }
          else {
            const defaultNonNullableFields = [
              'country_code', 'currency_code', 'vat_rate', 'language', 
              'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone',
              'created_by_identity', 'ai_confidence_score', 'is_verified_by_human'
            ];
            if (trimmedVal === '') {
              rawObj[header] = defaultNonNullableFields.includes(header) ? undefined : null;
            } else {
              rawObj[header] = trimmedVal;
            }
          }
        });

        if (!rawObj.full_legal_name) {
          throw new Error('Spalte "full_legal_name" darf nicht leer sein.');
        }

        const parsed = CompanySchema.partial().safeParse(rawObj);
        if (!parsed.success) {
          throw new Error(`Zentrierte Validierung fehlgeschlagen für ${rawObj.full_legal_name || 'Unbekannt'}: ${parsed.error.message}`);
        }
        return parsed.data as Company;
      });

      // Analyze duplicates
      const { conflicts, safe } = analyzeCompaniesImport(parsedCompanies);

      if (conflicts.length > 0) {
        setCompanyConflicts(conflicts);
        setSafeCompanies(safe);
        setActiveView('resolve_companies');
      } else {
        // Direct commit if zero duplicates
        const res = await companiesMutation.mutateAsync(parsedCompanies);
        setCompanyStatus({ 
          type: 'success', 
          message: t('admin:data_portability.import_success_companies_direct', { 
            defaultValue: '{{importedCount}} Unternehmen neu importiert, {{updatedCount}} Unternehmen aktualisiert.', 
            importedCount: res.importedCount, 
            updatedCount: res.updatedCount 
          })
        });
        refetchCompanies();
      }
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setCompanyStatus({ type: 'error', message: errMsg || 'Fehler beim CSV-Import.' });
    }
  };

  // 4. CONTACTS UPLOAD PROCESSOR
  const processContactCSV = async (text: string) => {
    try {
      setContactStatus({ type: 'idle', message: t('admin:data_portability.parsing_csv', { defaultValue: 'Analysiere CSV...' }) });
      const rows = parseCSV(text);
      if (rows.length < 2) {
        throw new Error(t('admin:data_portability.csv_empty', { defaultValue: 'Die CSV Datei ist leer oder enthält keine Datenzeilen.' }));
      }

      const headers = rows[0].map(h => h.toLowerCase().trim());
      const dataRows = rows.slice(1);
      
      const parsedContacts = dataRows.map((row) => {
        const rawObj: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          let val = row[index];
          if (val === undefined) val = '';
          const trimmedVal = String(val).trim();
          
          if (['opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone'].includes(header)) {
            rawObj[header] = trimmedVal.toLowerCase() === 'true';
          } 
          else if (header === 'labels') {
            rawObj[header] = trimmedVal ? trimmedVal.split('|').map((l: string) => l.trim()).filter(Boolean) : [];
          }
          else if (header === 'website') {
            rawObj[header] = cleanUrl(trimmedVal) || '';
          }
          else if (header === 'email_address' || header === 'email_2') {
            rawObj[header] = cleanEmail(trimmedVal) || '';
          }
          else if (header === 'id_uuid') {
            rawObj[header] = trimmedVal === '' ? undefined : trimmedVal;
          }
          else {
            const defaultNonNullableFields = [
              'language', 'opt_in_marketing', 'opt_in_social_media', 'opt_in_direct_message', 'opt_in_sms', 'opt_in_phone',
              'created_by_identity', 'ai_confidence_score', 'is_verified_by_human'
            ];
            if (trimmedVal === '') {
              rawObj[header] = defaultNonNullableFields.includes(header) ? undefined : null;
            } else {
              rawObj[header] = trimmedVal;
            }
          }
        });

        if (!rawObj.last_name) {
          throw new Error('Spalte "last_name" darf nicht leer sein.');
        }

        const parsed = ContactSchema.partial().safeParse(rawObj);
        if (!parsed.success) {
          throw new Error(`Zentrierte Validierung fehlgeschlagen für ${rawObj.first_name || ''} ${rawObj.last_name || 'Unbekannt'}: ${parsed.error.message}`);
        }
        return parsed.data as Contact;
      });

      // Analyze duplicates
      const { conflicts, safe } = analyzeContactsImport(parsedContacts);

      if (conflicts.length > 0) {
        setContactConflicts(conflicts);
        setSafeContacts(safe);
        setActiveView('resolve_contacts');
      } else {
        // Direct commit if zero duplicates
        const res = await contactsMutation.mutateAsync(parsedContacts);
        setContactStatus({ 
          type: 'success', 
          message: t('admin:data_portability.import_success_contacts_direct', { 
            defaultValue: '{{importedCount}} Kontakte neu importiert, {{updatedCount}} Kontakte aktualisiert.', 
            importedCount: res.importedCount, 
            updatedCount: res.updatedCount 
          })
        });
        refetchContacts();
      }
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setContactStatus({ type: 'error', message: errMsg || 'Fehler beim CSV-Import.' });
    }
  };

  // Execution with full human duplicate decisions for Companies
  const submitResolvedCompanies = async () => {
    try {
      setCompanyStatus({ type: 'idle', message: t('admin:data_portability.applying_resolutions', { defaultValue: 'Wende Konfliktlösungen an...' }) });
      
      const uploadPack: Company[] = [...safeCompanies];

      for (const item of companyConflicts) {
        if (item.decision === 'discard') {
          // Exclude from import completely
          continue;
        }

        const payload = { ...item.incoming };

        if (item.decision === 'update') {
          // Standard Update: assign existing profile's UUID to force update in database row
          payload.id_uuid = item.existing.id_uuid;
        } else if (item.decision === 'create_new') {
          // Split entry: assign brand new UUID to avoid overlapping
          payload.id_uuid = generateUUID();
        }

        uploadPack.push(payload);
      }

      const res = await companiesMutation.mutateAsync(uploadPack);
      
      setCompanyStatus({ 
        type: 'success', 
        message: t('admin:data_portability.import_success_companies', { 
          defaultValue: '{{importedCount}} Unternehmen neu importiert, {{updatedCount}} Unternehmen aktualisiert. (Konfliktlösung erfolgreich ausgeführt)', 
          importedCount: res.importedCount, 
          updatedCount: res.updatedCount 
        })
      });

      // Clear states and return to root screen
      setCompanyConflicts([]);
      setSafeCompanies([]);
      setActiveView('upload');
      refetchCompanies();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : t('admin:data_portability.error_resolution', { defaultValue: 'Fehler bei der Konfliktlösung.' });
      setCompanyStatus({ type: 'error', message: errMsg });
    }
  };

  // Execution with full human duplicate decisions for Contacts
  const submitResolvedContacts = async () => {
    try {
      setContactStatus({ type: 'idle', message: t('admin:data_portability.applying_resolutions', { defaultValue: 'Wende Konfliktlösungen an...' }) });
      
      const uploadPack: Contact[] = [...safeContacts];

      for (const item of contactConflicts) {
        if (item.decision === 'discard') {
          continue;
        }

        const payload = { ...item.incoming };

        if (item.decision === 'update') {
          payload.id_uuid = item.existing.id_uuid;
        } else if (item.decision === 'create_new') {
          payload.id_uuid = generateUUID();
        }

        uploadPack.push(payload);
      }

      const res = await contactsMutation.mutateAsync(uploadPack);
      
      setContactStatus({ 
        type: 'success', 
        message: t('admin:data_portability.import_success_contacts', { 
          defaultValue: '{{importedCount}} Kontakte neu importiert, {{updatedCount}} Kontakte aktualisiert. (Konfliktlösung erfolgreich ausgeführt)', 
          importedCount: res.importedCount, 
          updatedCount: res.updatedCount 
        })
      });

      setContactConflicts([]);
      setSafeContacts([]);
      setActiveView('upload');
      refetchContacts();
    } catch (err: unknown) {
      console.error(err);
      const errMsg = err instanceof Error ? err.message : t('admin:data_portability.error_resolution', { defaultValue: 'Fehler bei der Konfliktlösung.' });
      setContactStatus({ type: 'error', message: errMsg });
    }
  };

  // Change individual decision for Companies
  const handleCompanyDecision = (id: string, decision: 'update' | 'create_new' | 'discard') => {
    setCompanyConflicts(prev => 
      prev.map(c => c.id === id ? { ...c, decision } : c)
    );
  };

  // Change individual decision for Contacts
  const handleContactDecision = (id: string, decision: 'update' | 'create_new' | 'discard') => {
    setContactConflicts(prev => 
      prev.map(c => c.id === id ? { ...c, decision } : c)
    );
  };

  // Drop handlers for Company Upload
  const handleDragCompany = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveCompany(true);
    } else if (e.type === "dragleave") {
      setDragActiveCompany(false);
    }
  };

  const handleDropCompany = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveCompany(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processCompanyCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileCompanySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processCompanyCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  // Drop handlers for Contact Upload
  const handleDragContact = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveContact(true);
    } else if (e.type === "dragleave") {
      setDragActiveContact(false);
    }
  };

  const handleDropContact = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveContact(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processContactCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileContactSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processContactCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  // Drag and drop handlers for new templates
  const handleDragEmail = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveEmail(true);
    } else if (e.type === "dragleave") {
      setDragActiveEmail(false);
    }
  };

  const handleDropEmail = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveEmail(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processEmailTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileEmailSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processEmailTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragSignature = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveSignature(true);
    } else if (e.type === "dragleave") {
      setDragActiveSignature(false);
    }
  };

  const handleDropSignature = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveSignature(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processSignatureCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileSignatureSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processSignatureCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragInvoiceText = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveInvoiceText(true);
    } else if (e.type === "dragleave") {
      setDragActiveInvoiceText(false);
    }
  };

  const handleDropInvoiceText = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveInvoiceText(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processInvoiceTextTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileInvoiceTextSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processInvoiceTextTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleDragInvoiceItem = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActiveInvoiceItem(true);
    } else if (e.type === "dragleave") {
      setDragActiveInvoiceItem(false);
    }
  };

  const handleDropInvoiceItem = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActiveInvoiceItem(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processInvoiceItemTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileInvoiceItemSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processInvoiceItemTemplateCSV(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="space-y-12">
      {/* ----------------- SCREEN: UPLOAD & EXPORT DEFAULT ----------------- */}
      {/* ----------------- SCREEN: UPLOAD & EXPORT DEFAULT ----------------- */}
      {activeView === 'upload' && (
        <div className="space-y-12">
          {/* Intro Context card */}
          <div className="flex items-start gap-5 p-6 bg-accent-blue/5 border border-accent-blue/10 rounded-2xl">
            <div className="p-3 bg-accent-blue/10 rounded-xl text-accent-blue">
              <Info size={24} />
            </div>
            <div>
              <h4 className="text-sm font-black text-white uppercase tracking-wider mb-1">{t('admin:data_portability.title', { defaultValue: 'Massenmigration & Portierbarkeit' })}</h4>
              <p className="text-xs text-slate-400 leading-relaxed font-bold italic">
                {t('admin:data_portability.description', { defaultValue: 'Sichern und laden Sie alle stammsynchronisierten CRM-Daten herunter...' })}
              </p>
            </div>
          </div>

          {/* Sub Tab Navigation */}
          <div className="flex border-b border-white/5 gap-6 pb-px">
            <button
              id="tab-stammdaten"
              onClick={() => setActivePortabilityTab('stammdaten')}
              className={`pb-4 px-2 font-black text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                activePortabilityTab === 'stammdaten'
                  ? 'border-accent-orange text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t('admin:data_portability.tabs.stammdaten', { defaultValue: 'Stammdaten' })}
            </button>
            <button
              id="tab-vorlagen"
              onClick={() => setActivePortabilityTab('vorlagen')}
              className={`pb-4 px-2 font-black text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                activePortabilityTab === 'vorlagen'
                  ? 'border-accent-orange text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t('admin:data_portability.tabs.vorlagen', { defaultValue: 'E-Mail- & Formularvorlagen' })}
            </button>
            <button
              id="tab-rechnungsposten"
              onClick={() => setActivePortabilityTab('rechnungsposten')}
              className={`pb-4 px-2 font-black text-xs uppercase tracking-widest border-b-2 transition-all cursor-pointer ${
                activePortabilityTab === 'rechnungsposten'
                  ? 'border-accent-orange text-white'
                  : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              {t('admin:data_portability.tabs.rechnungsposten', { defaultValue: 'Rechnungsposten-Katalog' })}
            </button>
          </div>

          {/* TAB 1: STAMMDATEN */}
          {activePortabilityTab === 'stammdaten' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* Company Card Component */}
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-primary-dark/50 p-4 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="text-accent-orange" size={24} />
                    <h3 className="text-base font-black text-white uppercase tracking-tight">{t('admin:data_portability.companies_registry', { defaultValue: 'Unternehmensregister' })}</h3>
                  </div>
                  <button
                    id="btn-export-companies"
                    onClick={handleExportCompanies}
                    className="flex items-center gap-2 bg-primary-light border border-white/10 hover:border-accent-orange/30 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer"
                  >
                    <Download size={14} className="text-accent-orange" />
                    {t('admin:data_portability.export_csv', { defaultValue: 'CSV Exportieren' })} ({companies.length})
                  </button>
                </div>

                {/* Drag & Drop Area */}
                <div
                  id="dropzone-companies"
                  onDragEnter={handleDragCompany}
                  onDragOver={handleDragCompany}
                  onDragLeave={handleDragCompany}
                  onDrop={handleDropCompany}
                  className={`relative border-2 border-dashed rounded-2xl py-12 px-6 flex flex-col items-center justify-center text-center transition-all ${
                    dragActiveCompany
                      ? 'border-accent-orange bg-accent-orange/5'
                      : 'border-white/5 bg-primary-light/10 hover:border-white/10'
                  }`}
                >
                  <UploadCloud size={36} className="text-slate-600 mb-4" />
                  <p className="text-xs font-bold text-slate-400 mb-1">{t('admin:data_portability.drag_and_drop_companies', { defaultValue: 'Unternehmens-CSV hierher ziehen oder durchsuchen' })}</p>
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">{t('admin:data_portability.separator_hint', { defaultValue: 'Semicolon oder Comma getrennt' })}</p>
                  
                  <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[9px] uppercase tracking-widest px-4 py-2 border border-white/15 rounded-lg transition-all">
                    {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileCompanySelect}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Status Display */}
                {companyStatus.type !== 'idle' && (
                  <div className={`p-4 rounded-xl flex items-start gap-3 text-xs font-bold ${
                    companyStatus.type === 'success' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {companyStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    <span>{companyStatus.message}</span>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    id="btn-template-companies"
                    onClick={handleDownloadTemplateCompanies}
                    className="text-slate-600 hover:text-slate-400 font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={12} />
                    {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (companies_template.csv)
                  </button>
                </div>
              </div>

              {/* Contact Card Component */}
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-primary-dark/50 p-4 rounded-xl border border-white/5">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="text-accent-blue" size={24} />
                    <h3 className="text-base font-black text-white uppercase tracking-tight">{t('admin:data_portability.contacts_registry', { defaultValue: 'Ansprechpartner / Kontakte' })}</h3>
                  </div>
                  <button
                    id="btn-export-contacts"
                    onClick={handleExportContacts}
                    className="flex items-center gap-2 bg-primary-light border border-white/10 hover:border-accent-blue/30 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer"
                  >
                    <Download size={14} className="text-accent-blue" />
                    {t('admin:data_portability.export_csv', { defaultValue: 'CSV Exportieren' })} ({contacts.length})
                  </button>
                </div>

                {/* Drag & Drop Area */}
                <div
                  id="dropzone-contacts"
                  onDragEnter={handleDragContact}
                  onDragOver={handleDragContact}
                  onDragLeave={handleDragContact}
                  onDrop={handleDropContact}
                  className={`relative border-2 border-dashed rounded-2xl py-12 px-6 flex flex-col items-center justify-center text-center transition-all ${
                    dragActiveContact
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-white/5 bg-primary-light/10 hover:border-white/10'
                  }`}
                >
                  <UploadCloud size={36} className="text-slate-600 mb-4" />
                  <p className="text-xs font-bold text-slate-400 mb-1">{t('admin:data_portability.drag_and_drop_contacts', { defaultValue: 'Kontakte-CSV hierher ziehen oder durchsuchen' })}</p>
                  <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">{t('admin:data_portability.separator_hint', { defaultValue: 'Semicolon oder Comma getrennt' })}</p>
                  
                  <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[9px] uppercase tracking-widest px-4 py-2 border border-white/15 rounded-lg transition-all">
                    {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileContactSelect}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Status Display */}
                {contactStatus.type !== 'idle' && (
                  <div className={`p-4 rounded-xl flex items-start gap-3 text-xs font-bold ${
                    contactStatus.type === 'success' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {contactStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                    <span>{contactStatus.message}</span>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    id="btn-template-contacts"
                    onClick={handleDownloadTemplateContacts}
                    className="text-slate-600 hover:text-slate-400 font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={12} />
                    {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (contacts_template.csv)
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 2: VORLAGEN */}
          {activePortabilityTab === 'vorlagen' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              
              {/* Email Templates Card */}
              <div className="space-y-6 border border-white/5 p-5 rounded-2xl bg-primary-light/10">
                <div className="flex justify-between items-center bg-primary-dark/50 p-3 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="text-accent-orange" size={20} />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">{t('admin:data_portability.email_templates', { defaultValue: 'E-Mail-Vorlagen' })}</h3>
                  </div>
                  <button
                    id="btn-export-emails"
                    onClick={handleExportEmailTemplates}
                    className="flex items-center gap-1.5 bg-primary-light border border-white/10 hover:border-accent-orange/30 text-white text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all cursor-pointer"
                  >
                    <Download size={12} className="text-accent-orange" />
                    CSV ({emailTemplates.length})
                  </button>
                </div>

                {/* Drag / Drop area */}
                <div
                  id="dropzone-emails"
                  onDragEnter={handleDragEmail}
                  onDragOver={handleDragEmail}
                  onDragLeave={handleDragEmail}
                  onDrop={handleDropEmail}
                  className={`relative border border-dashed rounded-xl py-8 px-4 flex flex-col items-center justify-center text-center transition-all ${
                    dragActiveEmail
                      ? 'border-accent-orange bg-accent-orange/5'
                      : 'border-white/5 bg-primary-light/5 hover:border-white/10'
                  }`}
                >
                  <UploadCloud size={28} className="text-slate-600 mb-3" />
                  <p className="text-[10px] font-bold text-slate-400 mb-0.5">{t('admin:data_portability.drag_and_drop_emails', { defaultValue: 'E-Mail-CSV hierher ziehen' })}</p>
                  <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider mb-3">{t('admin:data_portability.or_browse', { defaultValue: 'oder durchsuchen' })}</p>
                  
                  <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[8px] uppercase tracking-wider px-3 py-1.5 border border-white/15 rounded-md transition-all">
                    {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileEmailSelect}
                      className="hidden"
                    />
                  </label>
                </div>

                {emailStatus.type !== 'idle' && (
                  <div className={`p-3 rounded-xl flex items-start gap-2 text-[10px] font-bold ${
                    emailStatus.type === 'success' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {emailStatus.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    <span>{emailStatus.message}</span>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    id="btn-template-emails"
                    onClick={handleDownloadTemplateEmailTemplates}
                    className="text-slate-600 hover:text-slate-400 font-black uppercase text-[8px] tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={10} />
                    {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (emails_template.csv)
                  </button>
                </div>
              </div>

              {/* Signatures Card */}
              <div className="space-y-6 border border-white/5 p-5 rounded-2xl bg-primary-light/10">
                <div className="flex justify-between items-center bg-primary-dark/50 p-3 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="text-accent-orange" size={20} />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">{t('admin:data_portability.signatures', { defaultValue: 'Signaturen' })}</h3>
                  </div>
                  <button
                    id="btn-export-signatures"
                    onClick={handleExportSignatures}
                    className="flex items-center gap-1.5 bg-primary-light border border-white/10 hover:border-accent-orange/30 text-white text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all cursor-pointer"
                  >
                    <Download size={12} className="text-accent-orange" />
                    CSV ({signatures.length})
                  </button>
                </div>

                {/* Drag / Drop area */}
                <div
                  id="dropzone-signatures"
                  onDragEnter={handleDragSignature}
                  onDragOver={handleDragSignature}
                  onDragLeave={handleDragSignature}
                  onDrop={handleDropSignature}
                  className={`relative border border-dashed rounded-xl py-8 px-4 flex flex-col items-center justify-center text-center transition-all ${
                    dragActiveSignature
                      ? 'border-accent-orange bg-accent-orange/5'
                      : 'border-white/5 bg-primary-light/5 hover:border-white/10'
                  }`}
                >
                  <UploadCloud size={28} className="text-slate-600 mb-3" />
                  <p className="text-[10px] font-bold text-slate-400 mb-0.5">{t('admin:data_portability.drag_and_drop_signatures', { defaultValue: 'Signaturen-CSV hierher ziehen' })}</p>
                  <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider mb-3">{t('admin:data_portability.or_browse', { defaultValue: 'oder durchsuchen' })}</p>
                  
                  <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[8px] uppercase tracking-wider px-3 py-1.5 border border-white/15 rounded-md transition-all">
                    {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileSignatureSelect}
                      className="hidden"
                    />
                  </label>
                </div>

                {signatureStatus.type !== 'idle' && (
                  <div className={`p-3 rounded-xl flex items-start gap-2 text-[10px] font-bold ${
                    signatureStatus.type === 'success' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {signatureStatus.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    <span>{signatureStatus.message}</span>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    id="btn-template-signatures"
                    onClick={handleDownloadTemplateSignatures}
                    className="text-slate-600 hover:text-slate-400 font-black uppercase text-[8px] tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={10} />
                    {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (signatures_template.csv)
                  </button>
                </div>
              </div>

              {/* Invoice Text Templates Card */}
              <div className="space-y-6 border border-white/5 p-5 rounded-2xl bg-primary-light/10">
                <div className="flex justify-between items-center bg-primary-dark/50 p-3 rounded-xl border border-white/5">
                  <div className="flex items-center gap-2.5">
                    <FileSpreadsheet className="text-accent-orange" size={20} />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">{t('admin:data_portability.invoice_texts', { defaultValue: 'Rechnungstexte' })}</h3>
                  </div>
                  <button
                    id="btn-export-text-templates"
                    onClick={handleExportInvoiceTextTemplates}
                    className="flex items-center gap-1.5 bg-primary-light border border-white/10 hover:border-accent-orange/30 text-white text-[9px] font-black uppercase tracking-widest px-3 py-2 rounded-lg transition-all cursor-pointer"
                  >
                    <Download size={12} className="text-accent-orange" />
                    CSV ({invoiceTextTemplates.length})
                  </button>
                </div>

                {/* Drag / Drop area */}
                <div
                  id="dropzone-text-templates"
                  onDragEnter={handleDragInvoiceText}
                  onDragOver={handleDragInvoiceText}
                  onDragLeave={handleDragInvoiceText}
                  onDrop={handleDropInvoiceText}
                  className={`relative border border-dashed rounded-xl py-8 px-4 flex flex-col items-center justify-center text-center transition-all ${
                    dragActiveInvoiceText
                      ? 'border-accent-orange bg-accent-orange/5'
                      : 'border-white/5 bg-primary-light/5 hover:border-white/10'
                  }`}
                >
                  <UploadCloud size={28} className="text-slate-600 mb-3" />
                  <p className="text-[10px] font-bold text-slate-400 mb-0.5">{t('admin:data_portability.invoice_texts_drag_and_drop', { defaultValue: 'Rechnungstexte-CSV hierher ziehen' })}</p>
                  <p className="text-[8px] font-bold text-slate-600 uppercase tracking-wider mb-3">{t('admin:data_portability.or_browse', { defaultValue: 'oder durchsuchen' })}</p>
                  
                  <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[8px] uppercase tracking-wider px-3 py-1.5 border border-white/15 rounded-md transition-all">
                    {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleFileInvoiceTextSelect}
                      className="hidden"
                    />
                  </label>
                </div>

                {invoiceTextStatus.type !== 'idle' && (
                  <div className={`p-3 rounded-xl flex items-start gap-2 text-[10px] font-bold ${
                    invoiceTextStatus.type === 'success' 
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                      : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {invoiceTextStatus.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    <span>{invoiceTextStatus.message}</span>
                  </div>
                )}

                <div className="flex justify-start">
                  <button
                    id="btn-template-text-templates"
                    onClick={handleDownloadTemplateInvoiceTextTemplates}
                    className="text-slate-600 hover:text-slate-400 font-black uppercase text-[8px] tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Download size={10} />
                    {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (invoice_texts_template.csv)
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: RECHNUNGSPOSTEN */}
          {activePortabilityTab === 'rechnungsposten' && (
            <div className="max-w-2xl mx-auto space-y-6 border border-white/5 p-6 rounded-2xl bg-primary-light/10">
              <div className="flex justify-between items-center bg-primary-dark/50 p-4 rounded-xl border border-white/5">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="text-accent-orange" size={24} />
                  <h3 className="text-base font-black text-white uppercase tracking-tight">{t('admin:data_portability.invoice_items_catalog', { defaultValue: 'Rechnungsposten-Katalog' })}</h3>
                </div>
                <button
                  id="btn-export-items"
                  onClick={handleExportInvoiceItemTemplates}
                  className="flex items-center gap-2 bg-primary-light border border-white/10 hover:border-accent-orange/30 text-white text-[10px] font-black uppercase tracking-wider px-4 py-2.5 rounded-lg transition-all cursor-pointer"
                >
                  <Download size={14} className="text-accent-orange" />
                  {t('admin:data_portability.export_csv', { defaultValue: 'CSV Exportieren' })} ({invoiceItemTemplates.length})
                </button>
              </div>

              {/* Drag & Drop Area */}
              <div
                id="dropzone-invoice-items"
                onDragEnter={handleDragInvoiceItem}
                onDragOver={handleDragInvoiceItem}
                onDragLeave={handleDragInvoiceItem}
                onDrop={handleDropInvoiceItem}
                className={`relative border-2 border-dashed rounded-2xl py-12 px-6 flex flex-col items-center justify-center text-center transition-all ${
                  dragActiveInvoiceItem
                    ? 'border-accent-orange bg-accent-orange/5'
                    : 'border-white/5 bg-primary-light/10 hover:border-white/10'
                }`}
              >
                <UploadCloud size={36} className="text-slate-600 mb-4" />
                <p className="text-xs font-bold text-slate-400 mb-1">{t('admin:data_portability.drag_and_drop_items', { defaultValue: 'Rechnungsposten-CSV hierher ziehen oder durchsuchen' })}</p>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-4">{t('admin:data_portability.separator_hint', { defaultValue: 'Semicolon oder Comma getrennt' })}</p>
                
                <label className="cursor-pointer bg-primary-light hover:bg-primary-light/80 text-white font-black text-[9px] uppercase tracking-widest px-4 py-2 border border-white/15 rounded-lg transition-all">
                  {t('admin:data_portability.select_file', { defaultValue: 'Datei Auswählen' })}
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileInvoiceItemSelect}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Status Display */}
              {invoiceItemStatus.type !== 'idle' && (
                <div className={`p-4 rounded-xl flex items-start gap-3 text-xs font-bold ${
                  invoiceItemStatus.type === 'success' 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                }`}>
                  {invoiceItemStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                  <span>{invoiceItemStatus.message}</span>
                </div>
              )}

              <div className="flex justify-start">
                <button
                  id="btn-template-items"
                  onClick={handleDownloadTemplateInvoiceItemTemplates}
                  className="text-slate-600 hover:text-slate-400 font-black uppercase text-[9px] tracking-widest flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <Download size={12} />
                  {t('admin:data_portability.download_template', { defaultValue: 'Download Vorlage' })} (invoice_items_template.csv)
                </button>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ----------------- SCREEN: RESOLVE COMPANIES CONFLICTS ----------------- */}
      {activeView === 'resolve_companies' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          
          <div className="border border-white/5 bg-primary-dark p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2.5 text-accent-orange font-black uppercase text-xs tracking-widest mb-1.5">
                <AlertCircle size={16} />
                {t('admin:data_portability.fuzzy_active', { defaultValue: 'Fuzzy-Abgleich aktiv' })}
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tight">{t('admin:data_portability.duplicate_check_title', { defaultValue: 'Sicherheitsüberprüfung: Dubletten entdeckt' })}</h3>
              <p className="text-slate-400 font-bold italic text-xs mt-1 leading-normal">
                {t('admin:data_portability.company_duplicates_found_1', { defaultValue: 'Es wurden ' })}<span className="text-accent-orange font-black">{t('admin:data_portability.company_duplicates_count_label', { defaultValue: '{{count}} potenzielle Dubletten', count: companyConflicts.length })}</span> {t('admin:data_portability.company_duplicates_found_2', { defaultValue: 'im Unternehmensregister lokalisiert.' })} 
                <br />{t('admin:data_portability.define_action', { defaultValue: 'Bitte definieren Sie für jeden Datensatz die gewünschte Integrationshandlung.' })}
              </p>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setCompanyConflicts([]);
                  setSafeCompanies([]);
                  setActiveView('upload');
                  setCompanyStatus({ type: 'idle', message: '' });
                }}
                className="bg-primary-light border border-white/10 hover:border-white/25 text-white/70 hover:text-white px-5 py-3 rounded-lg text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                {t('common:cancel', { defaultValue: 'Abbrechen' })}
              </button>
              <button
                onClick={submitResolvedCompanies}
                className="bg-accent-orange hover:bg-opacity-95 text-white px-6 py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-accent-orange/20 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Check size={14} />
                {t('admin:data_portability.complete_import_count', { defaultValue: 'Import abschließen ({{count}} Datensätze)', count: companyConflicts.length + safeCompanies.length })}
              </button>
            </div>
          </div>

          {/* Status Display */}
          {companyStatus.type !== 'idle' && (
            <div className={`p-4 rounded-xl flex items-start gap-3 text-xs font-bold ${
              companyStatus.type === 'success' 
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {companyStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>{companyStatus.message}</span>
            </div>
          )}

          <div className="space-y-6">
            {companyConflicts.map((item, index) => {
              const diffName = normalizeName(item.incoming.full_legal_name) !== normalizeName(item.existing.full_legal_name);
              const diffTax = normalizeTax(item.incoming.tax_vat_id) !== normalizeTax(item.existing.tax_vat_id);
              const diffEmail = normalizeEmail(item.incoming.email_address) !== normalizeEmail(item.existing.email_address);
              const diffPhone = normalizePhone(item.incoming.phone_number) !== normalizePhone(item.existing.phone_number);
              const diffCity = String(item.incoming.city || '').toLowerCase().trim() !== String(item.existing.city || '').toLowerCase().trim();

              return (
                <div key={item.id} className="border border-white/5 bg-primary-light/10 rounded-2xl overflow-hidden shadow-xl">
                  {/* Warning reason banner */}
                  <div className="bg-amber-500/10 border-b border-white/5 px-6 py-3 text-xs font-bold text-amber-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-amber-500" />
                      <span>Eintrag #{index + 1}: Mögliche Übereinstimmung gefunden</span>
                    </div>
                    <div className="bg-amber-500/20 px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider">
                      {item.matchReasons.join(' & ')}
                    </div>
                  </div>

                  {/* Side-by-side Layout */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8 bg-black/20">
                    
                    {/* Left side: Incoming database row */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-orange"></span>
                        Neue Daten aus der CSV-Datei
                      </h4>
                      <div className="space-y-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                        <div className={`p-2.5 rounded-lg ${diffName ? 'bg-accent-orange/10 border border-accent-orange/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Firma / Legal Name</div>
                          <div className={`text-sm font-black ${diffName ? 'text-accent-orange' : 'text-white'}`}>{item.incoming.full_legal_name || 'N/A'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffTax ? 'bg-accent-orange/10 border border-accent-orange/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">USt-IdNr. / Steuernummer</div>
                          <div className={`text-xs font-bold ${diffTax ? 'text-accent-orange' : 'text-slate-200'}`}>{item.incoming.tax_vat_id || item.incoming.tax_number || 'Keine angegeben'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffEmail ? 'bg-accent-orange/10 border border-accent-orange/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">E-Mail-Adresse</div>
                          <div className={`text-xs font-bold ${diffEmail ? 'text-accent-orange' : 'text-slate-200'}`}>{item.incoming.email_address || 'Keine angegeben'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffPhone ? 'bg-accent-orange/10 border border-accent-orange/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Telefonnummer</div>
                          <div className={`text-xs font-bold ${diffPhone ? 'text-accent-orange' : 'text-slate-200'}`}>{item.incoming.phone_number || item.incoming.mobile_number || 'Keine angegeben'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffCity ? 'bg-accent-orange/10 border border-accent-orange/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Adresse / Ort</div>
                          <div className={`text-xs font-bold ${diffCity ? 'text-accent-orange' : 'text-slate-200'}`}>
                            {item.incoming.street || ''} {item.incoming.house_number || ''}, {item.incoming.postal_code || ''} {item.incoming.city || 'Keine angegeben'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right side: Existing matching profile */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                        Bestehendes Profil im System
                      </h4>
                      <div className="space-y-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Firma / Legal Name</div>
                          <div className="text-sm font-black text-slate-300">{item.existing.full_legal_name || 'N/A'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">USt-IdNr. / Steuernummer</div>
                          <div className="text-xs font-bold text-slate-400">{item.existing.tax_vat_id || item.existing.tax_number || 'Keine angegeben'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">E-Mail-Adresse</div>
                          <div className="text-xs font-bold text-slate-400">{item.existing.email_address || 'Keine angegeben'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Telefonnummer</div>
                          <div className="text-xs font-bold text-slate-400">{item.existing.phone_number || item.existing.mobile_number || 'Keine angegeben'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Adresse / Ort</div>
                          <div className="text-xs font-bold text-slate-400">
                            {item.existing.street || ''} {item.existing.house_number || ''}, {item.existing.postal_code || ''} {item.existing.city || 'Keine angegeben'}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Decisions Action Group toolbar */}
                  <div className="bg-primary-dark/80 border-t border-white/5 p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Ergebnis-Aktion bestimmen:</span>
                    
                    <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
                      
                      {/* OPTION 1: Update Existing Profile */}
                      <button
                        type="button"
                        onClick={() => handleCompanyDecision(item.id, 'update')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'update'
                            ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-md shadow-amber-500/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Bestehendes Profil Aktualisieren
                      </button>

                      {/* OPTION 2: Create New Separate Profile */}
                      <button
                        type="button"
                        onClick={() => handleCompanyDecision(item.id, 'create_new')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'create_new'
                            ? 'bg-accent-blue/10 border-accent-blue text-accent-blue shadow-md shadow-accent-blue/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Neues Profil anlegen
                      </button>

                      {/* OPTION 3: Discard Incoming Entry */}
                      <button
                        type="button"
                        onClick={() => handleCompanyDecision(item.id, 'discard')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'discard'
                            ? 'bg-rose-500/10 border-rose-500 text-rose-400 shadow-md shadow-rose-500/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Neue Daten verwerfen
                      </button>

                    </div>
                  </div>

                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-4 border-t border-white/5 pt-8">
            <button
              onClick={() => {
                setCompanyConflicts([]);
                setSafeCompanies([]);
                setActiveView('upload');
                setCompanyStatus({ type: 'idle', message: '' });
              }}
              className="bg-primary-light border border-white/10 hover:border-white/25 text-white/70 hover:text-white px-6 py-3.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              onClick={submitResolvedCompanies}
              className="bg-accent-orange hover:bg-opacity-95 text-white px-8 py-3.5 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-accent-orange/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Check size={14} />
              Import abschließen und importieren ({companyConflicts.length + safeCompanies.length} Datensätze)
            </button>
          </div>

        </motion.div>
      )}

      {/* ----------------- SCREEN: RESOLVE CONTACTS CONFLICTS ----------------- */}
      {activeView === 'resolve_contacts' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          
          <div className="border border-white/5 bg-primary-dark p-6 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2.5 text-accent-blue font-black uppercase text-xs tracking-widest mb-1.5">
                <AlertCircle size={16} />
                {t('admin:data_portability.fuzzy_active', { defaultValue: 'Fuzzy-Abgleich aktiv' })}
              </div>
              <h3 className="text-xl font-black text-white uppercase tracking-tight">{t('admin:data_portability.duplicate_check_title', { defaultValue: 'Sicherheitsüberprüfung: Dubletten entdeckt' })}</h3>
              <p className="text-slate-400 font-bold italic text-xs mt-1 leading-normal">
                {t('admin:data_portability.contact_duplicates_found_1', { defaultValue: 'Es wurden ' })}<span className="text-accent-blue font-black">{t('admin:data_portability.contact_duplicates_count_label', { defaultValue: '{{count}} potenzielle Dubletten', count: contactConflicts.length })}</span> {t('admin:data_portability.contact_duplicates_found_2', { defaultValue: 'im Partner-/Kontakteregister lokalisiert.' })}
                <br />{t('admin:data_portability.define_action', { defaultValue: 'Bitte definieren Sie für jeden Datensatz die gewünschte Integrationshandlung.' })}
              </p>
            </div>
            
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setContactConflicts([]);
                  setSafeContacts([]);
                  setActiveView('upload');
                  setContactStatus({ type: 'idle', message: '' });
                }}
                className="bg-primary-light border border-white/10 hover:border-white/25 text-white/70 hover:text-white px-5 py-3 rounded-lg text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
              >
                {t('common:cancel', { defaultValue: 'Abbrechen' })}
              </button>
              <button
                onClick={submitResolvedContacts}
                className="bg-accent-blue hover:bg-opacity-95 text-white px-6 py-3 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-accent-blue/20 flex items-center gap-2 transition-all cursor-pointer"
              >
                <Check size={14} />
                {t('admin:data_portability.complete_import_count', { defaultValue: 'Import abschließen ({{count}} Datensätze)', count: contactConflicts.length + safeContacts.length })}
              </button>
            </div>
          </div>

          {/* Status Display */}
          {contactStatus.type !== 'idle' && (
            <div className={`p-4 rounded-xl flex items-start gap-3 text-xs font-bold ${
              contactStatus.type === 'success' 
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
                : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            }`}>
              {contactStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>{contactStatus.message}</span>
            </div>
          )}

          <div className="space-y-6">
            {contactConflicts.map((item, index) => {
              const incomingName = `${item.incoming.first_name || ''} ${item.incoming.last_name || ''}`.trim();
              const existingName = `${item.existing.first_name || ''} ${item.existing.last_name || ''}`.trim();

              const diffName = normalizeName(incomingName) !== normalizeName(existingName);
              const diffEmail = normalizeEmail(item.incoming.email_address) !== normalizeEmail(item.existing.email_address);
              const diffPhone = normalizePhone(item.incoming.phone_number) !== normalizePhone(item.existing.phone_number);
              const diffCompany = item.incoming.associated_company_id !== item.existing.associated_company_id;
              const diffCity = String(item.incoming.city || '').toLowerCase().trim() !== String(item.existing.city || '').toLowerCase().trim();

              // Resolve company name to display beautifully
              const incomingCompName = companies.find(c => c.id_uuid === item.incoming.associated_company_id)?.full_legal_name || 'Kein verknüpftes Unternehmen';
              const existingCompName = companies.find(c => c.id_uuid === item.existing.associated_company_id)?.full_legal_name || 'Kein verknüpftes Unternehmen';

              return (
                <div key={item.id} className="border border-white/5 bg-primary-light/10 rounded-2xl overflow-hidden shadow-xl">
                  {/* Warning reason banner */}
                  <div className="bg-blue-500/10 border-b border-white/5 px-6 py-3 text-xs font-bold text-blue-300 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={14} className="text-blue-500" />
                      <span>Eintrag #{index + 1}: Mögliche Übereinstimmung gefunden</span>
                    </div>
                    <div className="bg-blue-500/20 px-2 py-1 rounded text-[10px] font-black uppercase tracking-wider">
                      {item.matchReasons.join(' & ')}
                    </div>
                  </div>

                  {/* Side-by-side Layout */}
                  <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8 bg-black/20">
                    
                    {/* Left side: Incoming database row */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-blue"></span>
                        Neue Daten aus der CSV-Datei
                      </h4>
                      <div className="space-y-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                        <div className={`p-2.5 rounded-lg ${diffName ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Person / Ansprechpartner</div>
                          <div className={`text-sm font-black ${diffName ? 'text-accent-blue' : 'text-white'}`}>{incomingName || 'N/A'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffCompany ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Verknüpftes Unternehmen</div>
                          <div className={`text-xs font-bold ${diffCompany ? 'text-accent-blue' : 'text-slate-200'}`}>{incomingCompName}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffEmail ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">E-Mail-Adresse</div>
                          <div className={`text-xs font-bold ${diffEmail ? 'text-accent-blue' : 'text-slate-200'}`}>{item.incoming.email_address || 'Keine angegeben'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffPhone ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Telefonnummer / Mobil</div>
                          <div className={`text-xs font-bold ${diffPhone ? 'text-accent-blue' : 'text-slate-200'}`}>{item.incoming.phone_number || item.incoming.mobile_number || 'Keine angegeben'}</div>
                        </div>
                        <div className={`p-2.5 rounded-lg ${diffCity ? 'bg-accent-blue/10 border border-accent-blue/20' : ''}`}>
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Adresse / Ort</div>
                          <div className={`text-xs font-bold ${diffCity ? 'text-accent-blue' : 'text-slate-200'}`}>
                            {item.incoming.street || ''} {item.incoming.house_number || ''}, {item.incoming.postal_code || ''} {item.incoming.city || 'Keine angegeben'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right side: Existing matching profile */}
                    <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                        Bestehendes Profil im System
                      </h4>
                      <div className="space-y-3 bg-white/[0.02] border border-white/5 p-4 rounded-xl">
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Person / Ansprechpartner</div>
                          <div className="text-sm font-black text-slate-300">{existingName || 'N/A'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Verknüpftes Unternehmen</div>
                          <div className="text-xs font-bold text-slate-400">{existingCompName}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">E-Mail-Adresse</div>
                          <div className="text-xs font-bold text-slate-400">{item.existing.email_address || 'Keine angegeben'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Telefonnummer / Mobil</div>
                          <div className="text-xs font-bold text-slate-400">{item.existing.phone_number || item.existing.mobile_number || 'Keine angegeben'}</div>
                        </div>
                        <div className="p-2.5 rounded-lg">
                          <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Adresse / Ort</div>
                          <div className="text-xs font-bold text-slate-400">
                            {item.existing.street || ''} {item.existing.house_number || ''}, {item.existing.postal_code || ''} {item.existing.city || 'Keine angegeben'}
                          </div>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Decisions Action Group toolbar */}
                  <div className="bg-primary-dark/80 border-t border-white/5 p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Ergebnis-Aktion bestimmen:</span>
                    
                    <div className="grid grid-cols-3 gap-3 w-full md:w-auto">
                      
                      {/* OPTION 1: Update Existing Profile */}
                      <button
                        type="button"
                        onClick={() => handleContactDecision(item.id, 'update')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'update'
                            ? 'bg-amber-500/10 border-amber-500 text-amber-400 shadow-md shadow-amber-500/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Bestehendes Profil Aktualisieren
                      </button>

                      {/* OPTION 2: Create New Separate Profile */}
                      <button
                        type="button"
                        onClick={() => handleContactDecision(item.id, 'create_new')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'create_new'
                            ? 'bg-accent-blue/10 border-accent-blue text-accent-blue shadow-md shadow-accent-blue/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Neues Profil anlegen
                      </button>

                      {/* OPTION 3: Discard Incoming Entry */}
                      <button
                        type="button"
                        onClick={() => handleContactDecision(item.id, 'discard')}
                        className={`px-4 py-3 rounded-lg text-[10px] font-black uppercase tracking-wider text-center border transition-all cursor-pointer ${
                          item.decision === 'discard'
                            ? 'bg-rose-500/10 border-rose-500 text-rose-400 shadow-md shadow-rose-500/5'
                            : 'bg-primary-light border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                        }`}
                      >
                        Neue Daten verwerfen
                      </button>

                    </div>
                  </div>

                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-4 border-t border-white/5 pt-8">
            <button
              onClick={() => {
                setContactConflicts([]);
                setSafeContacts([]);
                setActiveView('upload');
                setContactStatus({ type: 'idle', message: '' });
              }}
              className="bg-primary-light border border-white/10 hover:border-white/25 text-white/70 hover:text-white px-6 py-3.5 rounded-lg text-xs font-black uppercase tracking-widest transition-all cursor-pointer"
            >
              Abbrechen
            </button>
            <button
              onClick={submitResolvedContacts}
              className="bg-accent-blue hover:bg-opacity-95 text-white px-8 py-3.5 rounded-lg text-xs font-black uppercase tracking-widest shadow-lg shadow-accent-blue/20 flex items-center gap-2 transition-all cursor-pointer"
            >
              <Check size={14} />
              Import abschließen und importieren ({contactConflicts.length + safeContacts.length} Datensätze)
            </button>
          </div>

        </motion.div>
      )}

    </div>
  );
};
