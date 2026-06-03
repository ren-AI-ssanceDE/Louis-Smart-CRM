import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
  Download, 
  Check, 
  Loader2, 
  AlertCircle,
  FileText,
  CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Dialog } from './ui/Dialog';
import JSZip from 'jszip';
import { Invoice, Company, Contact } from '../types';

interface BatchExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  invoices: Invoice[];
  companies: Company[];
  contacts: Contact[];
}

export const BatchExportDialog: React.FC<BatchExportDialogProps> = ({
  isOpen,
  onClose,
  invoices,
  companies,
  contacts
}) => {
  const { t, i18n } = useTranslation(['common', 'invoices']);

  // Default to the current year
  const currentYear = new Date().getFullYear();
  const [startMonth, setStartMonth] = useState(`${currentYear}-01`);
  const [endMonth, setEndMonth] = useState(`${currentYear}-12`);
  const [exportType, setExportType] = useState<'pdf' | 'xml' | 'both'>('both');

  // Export process state
  const [isExporting, setIsExporting] = useState(false);
  const [currentInvoiceIndex, setCurrentInvoiceIndex] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  // Filter invoices belonging to selected period (exclusive of drafts)
  const eligibleInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      // Exclude drafts as they don't have generated PDFs/XMLs or valid legal fields
      if (invoice.payment_status === 'draft') return false;
      if (!invoice.issue_date) return false;

      const invoiceMonth = invoice.issue_date.substring(0, 7); // e.g. "2026-05"
      return invoiceMonth >= startMonth && invoiceMonth <= endMonth;
    });
  }, [invoices, startMonth, endMonth]);

  // Compute month picker selections based on invoice history as helper
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    invoices.forEach(inv => {
      if (inv.issue_date && inv.issue_date.length >= 7) {
        monthsSet.add(inv.issue_date.substring(0, 7));
      }
    });
    // Add some default ones if empty
    if (monthsSet.size === 0) {
      monthsSet.add(`${currentYear}-01`);
      monthsSet.add(`${currentYear}-12`);
    }
    return Array.from(monthsSet).sort();
  }, [invoices, currentYear]);

  const handleExport = async () => {
    if (eligibleInvoices.length === 0) {
      toast.error(t('batch_export_no_invoices', { defaultValue: 'Keine exportierbaren Rechnungen im gewählten Zeitraum gefunden.' }));
      return;
    }

    setIsExporting(true);
    setCurrentInvoiceIndex(0);
    setCompletedCount(0);
    setErrorCount(0);

    const zip = new JSZip();
    const pdfFolder = zip.folder("PDFs");
    const xmlFolder = zip.folder("ZUGFeRD_XMLs");

    try {
      for (let i = 0; i < eligibleInvoices.length; i++) {
        const invoice = eligibleInvoices[i];
        setCurrentInvoiceIndex(i);
        setCurrentLabel(`${invoice.invoice_number} (${invoice.company_name || invoice.contact_full_name || 'CRM-Empfänger'})`);

        const company = companies.find(c => c.id_uuid === invoice.associated_company_id);
        const contact = contacts.find(c => c.id_uuid === invoice.associated_contact_id);
        const recipientName = company?.full_legal_name || (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '') || invoice.company_name || 'Empfaenger';
        const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
        const cleanNum = (invoice.invoice_number || invoice.id_uuid || 'RE').replace(/[^a-zA-Z0-9_-]/g, '_');

        let gotFiles = false;

        // 1. Download PDF if applicable
        if (exportType === 'pdf' || exportType === 'both') {
          try {
            const res = await fetch(`/api/invoices/${invoice.id_uuid}/download-pdf?lang=${i18n.language}`);
            if (res.ok) {
              const blob = await res.blob();
              const pdfFilename = `Rechnung - ${cleanRecipient} - ${cleanNum}.pdf`;
              if (pdfFolder) {
                pdfFolder.file(pdfFilename, blob);
              } else {
                zip.file(`PDFs/${pdfFilename}`, blob);
              }
              gotFiles = true;
            } else {
              console.error(`Failed to download PDF for ${invoice.invoice_number}`);
            }
          } catch (e) {
            console.error(`Error during PDF download for ${invoice.invoice_number}:`, e);
          }
        }

        // 2. Download XML if applicable
        if (exportType === 'xml' || exportType === 'both') {
          try {
            const res = await fetch(`/api/invoices/${invoice.id_uuid}/download-xml?lang=${i18n.language}`);
            if (res.ok) {
              const blob = await res.blob();
              const xmlFilename = `zugferd_${invoice.invoice_number || invoice.id_uuid}.xml`;
              if (xmlFolder) {
                xmlFolder.file(xmlFilename, blob);
              } else {
                zip.file(`ZUGFeRD_XMLs/${xmlFilename}`, blob);
              }
              gotFiles = true;
            } else {
              console.error(`Failed to download XML for ${invoice.invoice_number}`);
            }
          } catch (e) {
            console.error(`Error during XML download for ${invoice.invoice_number}:`, e);
          }
        }

        if (gotFiles) {
          setCompletedCount(prev => prev + 1);
        } else {
          setErrorCount(prev => prev + 1);
        }
      }

      // Generate the ZIP file
      setCurrentLabel(t('batch_export_building_zip', { defaultValue: 'Erstelle Exportdatei (ZIP)...' }));
      const content = await zip.generateAsync({ type: "blob" });
      
      const zipFilename = `Louis_Smart_CRM_Rechnungsexport_${startMonth}_bis_${endMonth}.zip`;
      const url = window.URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", zipFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t('batch_export_success_toast', { defaultValue: 'Export erfolgreich abgeschlossen' }));
      setIsExporting(false);
      onClose();
    } catch (err: any) {
      console.error("Batch Export Error:", err);
      toast.error(`${t('batch_export_failed', { defaultValue: 'Sammel-Export fehlgeschlagen' })}: ${err.message || err}`);
      setIsExporting(false);
    }
  };

  const progressPercent = eligibleInvoices.length > 0
    ? Math.round((currentInvoiceIndex / eligibleInvoices.length) * 100)
    : 0;

  // Render lists of German / English Month Names
  const formatMonthName = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => {
        if (!isExporting) onClose();
      }}
      title={t('common:batch_export')}
      size="md"
    >
      <div className="space-y-6">
        <p className="text-sm text-slate-400 font-sans leading-relaxed">
          {t('batch_export_description', { defaultValue: 'Wählen Sie einen Zeitraum und die gewünschten Dateiformate aus. Nur abgeschlossene und gebuchte Rechnungen (keine Entwürfe) werden exportiert.' })}
        </p>

        {!isExporting ? (
          <div className="space-y-4">
            {/* Range Pickers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5Packed">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  {t('batch_export_start_month', { defaultValue: 'Von Monat' })}
                </label>
                <div className="relative">
                  <input
                    type="month"
                    value={startMonth}
                    onChange={(e) => setStartMonth(e.target.value)}
                    className="w-full h-11 bg-primary-light border border-white/10 rounded-xl px-4 text-white text-xs font-bold focus:outline-none focus:border-accent-orange uppercase"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                  {t('batch_export_end_month', { defaultValue: 'Bis Monat' })}
                </label>
                <div className="relative">
                  <input
                    type="month"
                    value={endMonth}
                    onChange={(e) => setEndMonth(e.target.value)}
                    className="w-full h-11 bg-primary-light border border-white/10 rounded-xl px-4 text-white text-xs font-bold focus:outline-none focus:border-accent-orange uppercase"
                  />
                </div>
              </div>
            </div>

            {/* Range Preset buttons */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { 
                  label: t('preset_this_year', { defaultValue: 'Dieses Jahr' }), 
                  action: () => {
                    setStartMonth(`${currentYear}-01`);
                    setEndMonth(`${currentYear}-12`);
                  }
                },
                { 
                  label: t('preset_q1', { defaultValue: 'Q1' }), 
                  action: () => {
                    setStartMonth(`${currentYear}-01`);
                    setEndMonth(`${currentYear}-03`);
                  }
                },
                { 
                  label: t('preset_q2', { defaultValue: 'Q2' }), 
                  action: () => {
                    setStartMonth(`${currentYear}-04`);
                    setEndMonth(`${currentYear}-06`);
                  }
                },
                { 
                  label: t('preset_q3', { defaultValue: 'Q3' }), 
                  action: () => {
                    setStartMonth(`${currentYear}-07`);
                    setEndMonth(`${currentYear}-09`);
                  }
                },
                { 
                  label: t('preset_q4', { defaultValue: 'Q4' }), 
                  action: () => {
                    setStartMonth(`${currentYear}-10`);
                    setEndMonth(`${currentYear}-12`);
                  }
                },
                { 
                  label: t('preset_last_year', { defaultValue: 'Letztes Jahr' }), 
                  action: () => {
                    setStartMonth(`${currentYear - 1}-01`);
                    setEndMonth(`${currentYear - 1}-12`);
                  }
                }
              ].map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={preset.action}
                  className="px-2.5 py-1 text-[10px] uppercase font-black tracking-wider text-slate-400 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 hover:text-white transition-all focus:outline-none"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* Export Format Selector */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                {t('batch_export_formats', { defaultValue: 'Dateiformate' })}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'pdf', label: 'PDF' },
                  { value: 'xml', label: 'ZUGFeRD XML' },
                  { value: 'both', label: 'PDF + XML' }
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setExportType(opt.value as any)}
                    className={`h-11 border text-xs font-bold uppercase tracking-wider rounded-xl transition-all focus:outline-none flex items-center justify-center gap-1.5 ${
                      exportType === opt.value
                        ? 'bg-accent-blue/20 border-accent-blue text-accent-blue'
                        : 'bg-primary-light border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {exportType === opt.value && <Check size={14} />}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Eligibility Info Box */}
            <div className={`p-4 rounded-xl border flex items-start gap-3 mt-4 ${
              eligibleInvoices.length > 0 
                ? 'bg-accent-blue/10 border-accent-blue/20 text-accent-blue' 
                : 'bg-accent-orange/10 border-accent-orange/25 text-accent-orange'
            }`}>
              {eligibleInvoices.length > 0 ? (
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed font-sans block">
                {eligibleInvoices.length > 0 ? (
                  <>
                    <strong className="font-bold flex tracking-wider uppercase text-[10px] mb-1">
                      {t('batch_export_matching', { defaultValue: 'Rechnungen gefunden' })}
                    </strong>
                    <span>
                      {t('batch_export_matching_text', { 
                        defaultValue: 'Es wurden <strong>{{count}}</strong> exportierbare Rechnungen für den Zeitraum <strong>{{start}}</strong> bis <strong>{{end}}</strong> gefunden.', 
                        count: eligibleInvoices.length,
                        start: formatMonthName(startMonth),
                        end: formatMonthName(endMonth)
                      }).split('<strong>').map((s, idx) => {
                        if (idx === 0) return s;
                        const [bold, normal] = s.split('</strong>');
                        return <React.Fragment key={idx}><strong className="font-bold text-white font-mono">{bold}</strong>{normal}</React.Fragment>;
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <strong className="font-bold flex tracking-wider uppercase text-[10px] mb-1">
                      {t('batch_export_no_matching', { defaultValue: 'Keine Rechnungen' })}
                    </strong>
                    <span>
                      {t('batch_export_no_matching_text', { defaultValue: 'Keine abgeschlossenen Rechnungen im ausgewählten Zeitraum vorhanden.' })}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-4 border-t border-white/5">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 h-11 rounded-xl text-xs font-black uppercase tracking-widest text-slate-400 border border-white/10 hover:text-white hover:bg-white/5 transition-colors focus:outline-none"
              >
                {t('common:cancel')}
              </button>
              <button
                type="button"
                disabled={eligibleInvoices.length === 0}
                onClick={handleExport}
                className="flex-2 h-11 bg-accent-orange text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-accent-orange/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-accent-orange/10 active:scale-95 flex items-center justify-center gap-2 focus:outline-none"
              >
                <Download size={14} />
                {t('batch_export_start_btn', { defaultValue: 'Exportieren' })}
              </button>
            </div>
          </div>
        ) : (
          /* EXPORT PROGRESS STATE */
          <div className="space-y-6 pt-4 text-center">
            <div className="flex justify-center relative">
              <div className="h-20 w-20 flex items-center justify-center rounded-full bg-accent-blue/10 border border-accent-blue/30 text-accent-blue relative z-10 animate-pulse">
                <FileText size={32} />
              </div>
              <div className="absolute inset-0 flex justify-center items-center z-0">
                <div className="h-24 w-24 rounded-full border border-dashed border-accent-blue/20 animate-spin" />
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-white text-sm font-black uppercase tracking-wider">
                {t('batch_export_processing', { defaultValue: 'Sammel-Export läuft...' })}
              </h4>
              <p className="text-xs text-slate-400 font-mono tracking-wide max-w-sm mx-auto line-clamp-2">
                {currentLabel}
              </p>
            </div>

            {/* Custom Premium Progress Bar */}
            <div className="space-y-1.5 max-w-sm mx-auto">
              <div className="flex justify-between text-[10px] font-black tracking-widest uppercase font-mono text-slate-400">
                <span>
                  {completedCount + errorCount} / {eligibleInvoices.length}
                </span>
                <span>
                  {progressPercent}%
                </span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/10">
                <motion.div
                  className="h-full bg-accent-blue rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.2 }}
                />
              </div>
            </div>

            <div className="text-[10px] font-bold text-slate-500 font-mono flex items-center justify-center gap-4">
              <span>{t('batch_export_success', { defaultValue: 'Erfolgreich' })}: <strong className="text-accent-blue font-black">{completedCount}</strong></span>
              {errorCount > 0 && (
                <span>{t('batch_export_errors', { defaultValue: 'Verpasst/Fehler' })}: <strong className="text-accent-orange font-black">{errorCount}</strong></span>
              )}
            </div>

            <p className="text-[10px] font-sans text-slate-500 italic px-8">
              {t('batch_export_warning_leaving', { defaultValue: 'Bitte schließen Sie den Browsertab während des Vorgangs nicht.' })}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
};
