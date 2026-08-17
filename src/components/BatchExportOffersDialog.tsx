import React, { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  Download, 
  Check, 
  AlertCircle,
  FileText,
  CheckCircle2
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Dialog } from './ui/Dialog';
import JSZip from 'jszip';
import { Offer, Company, Contact } from '../types';
import { trpc } from '../lib/trpc';

interface BatchExportOffersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  offers: Offer[];
  companies: Company[];
  contacts: Contact[];
}

export const BatchExportOffersDialog: React.FC<BatchExportOffersDialogProps> = ({
  isOpen,
  onClose,
  offers,
  companies,
  contacts
}) => {
  const { t, i18n } = useTranslation(['common', 'offers']);

  const generatePdfMutation = trpc.generateOfferPdf.useMutation();

  // Default to the current year
  const currentYear = new Date().getFullYear();
  const [startMonth, setStartMonth] = useState(`${currentYear}-01`);
  const [endMonth, setEndMonth] = useState(`${currentYear}-12`);

  // Export process state
  const [isExporting, setIsExporting] = useState(false);
  const [currentOfferIndex, setCurrentOfferIndex] = useState(0);
  const [currentLabel, setCurrentLabel] = useState('');
  const [completedCount, setCompletedCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  // Filter offers belonging to selected period
  const eligibleOffers = useMemo(() => {
    return offers.filter(offer => {
      if (!offer.issue_date) return false;
      const offerMonth = offer.issue_date.substring(0, 7); // e.g. "2026-05"
      const isAfterOrEqual = offerMonth >= startMonth;
      const isBeforeOrEqual = offerMonth <= endMonth;
      return isAfterOrEqual && isBeforeOrEqual;
    });
  }, [offers, startMonth, endMonth]);

  const handleExport = async () => {
    if (eligibleOffers.length === 0) {
      toast.error(t('batch_export_no_offers', { defaultValue: 'Keine Angebote im gewählten Zeitraum gefunden.' }));
      return;
    }

    setIsExporting(true);
    setCurrentOfferIndex(0);
    setCompletedCount(0);
    setErrorCount(0);

    const zip = new JSZip();
    const pdfFolder = zip.folder("Angebote_PDFs");

    try {
      for (let i = 0; i < eligibleOffers.length; i++) {
        const offer = eligibleOffers[i];
        setCurrentOfferIndex(i);

        const company = companies.find(c => c.id_uuid === offer.associated_company_id);
        const contact = contacts.find(c => c.id_uuid === offer.associated_contact_id);
        const recipientName = company?.full_legal_name || (contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '') || 'Empfaenger';
        const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');

        setCurrentLabel(`${offer.offer_number} (${recipientName})`);

        const cleanNum = (offer.offer_number || offer.id_uuid || 'AN').replace(/[^a-zA-Z0-9_-]/g, '_');

        let gotFiles = false;

        try {
          // Generate PDF on the fly via the tRPC mutation
          const result = await generatePdfMutation.mutateAsync({ id_uuid: offer.id_uuid });
          if (result && result.success && result.filePath) {
            // Download the PDF from our REST API /api/files/download
            const downloadUrl = `/api/files/download?path=${encodeURIComponent(result.filePath)}`;
            const res = await fetch(downloadUrl);
            if (res.ok) {
              const blob = await res.blob();
              const pdfFilename = `Angebot - ${cleanRecipient} - ${cleanNum}.pdf`;
              if (pdfFolder) {
                pdfFolder.file(pdfFilename, blob);
              } else {
                zip.file(`Angebote_PDFs/${pdfFilename}`, blob);
              }
              gotFiles = true;
            } else {
              console.error(`Failed to download PDF for ${offer.offer_number}`);
            }
          } else {
            console.error(`Failed to generate PDF for ${offer.offer_number}`);
          }
        } catch (e) {
          console.error(`Error during PDF generation/download for ${offer.offer_number}:`, e);
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
      
      const zipFilename = `Louis_Smart_CRM_Angebotsexport_${startMonth}_bis_${endMonth}.zip`;
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
    } catch (err: unknown) {
      console.error("Batch Export Error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('batch_export_failed', { defaultValue: 'Sammel-Export failed' })}: ${errMsg}`);
      setIsExporting(false);
    }
  };

  const progressPercent = eligibleOffers.length > 0
    ? Math.round((currentOfferIndex / eligibleOffers.length) * 100)
    : 0;

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
      title={t('batch_export_offers_title', { defaultValue: 'Angebote Sammel-Export' })}
      size="md"
    >
      <div className="space-y-6">
        <p className="text-sm text-slate-400 font-sans leading-relaxed">
          {t('batch_export_offers_description', { defaultValue: 'Wählen Sie einen Zeitraum für den Sammel-Export Ihrer Angebote aus. Alle Angebote im gewählten Zeitraum werden als PDF generiert und in eine ZIP-Datei gepackt.' })}
        </p>

        {!isExporting ? (
          <div className="space-y-4">
            {/* Range Pickers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
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

            {/* Eligibility Info Box */}
            <div className={`p-4 rounded-xl border flex items-start gap-3 mt-4 ${
              eligibleOffers.length > 0 
                ? 'bg-accent-blue/10 border-accent-blue/20 text-accent-blue' 
                : 'bg-accent-orange/10 border-accent-orange/25 text-accent-orange'
            }`}>
              {eligibleOffers.length > 0 ? (
                <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              ) : (
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
              )}
              <div className="text-xs leading-relaxed font-sans block">
                {eligibleOffers.length > 0 ? (
                  <>
                    <strong className="font-bold flex tracking-wider uppercase text-[10px] mb-1">
                      {t('batch_export_offers_matching', { defaultValue: 'Angebote gefunden' })}
                    </strong>
                    <span>
                      {t('batch_export_offers_matching_text', { 
                        defaultValue: 'Es wurden \x3cstrong\x3e{{count}}\x3c/strong\x3e Angebote für den Zeitraum \x3cstrong\x3e{{start}}\x3c/strong\x3e bis \x3cstrong\x3e{{end}}\x3c/strong\x3e gefunden.', 
                        count: eligibleOffers.length,
                        start: formatMonthName(startMonth),
                        end: formatMonthName(endMonth)
                      }).split('\x3cstrong\x3e').map((s, idx) => {
                        if (idx === 0) return s;
                        const [bold, normal] = s.split('\x3c/strong\x3e');
                        return <React.Fragment key={idx}><strong className="font-bold text-white font-mono">{bold}</strong>{normal}</React.Fragment>;
                      })}
                    </span>
                  </>
                ) : (
                  <>
                    <strong className="font-bold flex tracking-wider uppercase text-[10px] mb-1">
                      {t('batch_export_no_matching_offers', { defaultValue: 'Keine Angebote' })}
                    </strong>
                    <span>
                      {t('batch_export_no_matching_offers_text', { defaultValue: 'Keine Angebote im ausgewählten Zeitraum vorhanden.' })}
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
                disabled={eligibleOffers.length === 0}
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
                {t('batch_export_offers_processing', { defaultValue: 'Angebote Sammel-Export läuft...' })}
              </h4>
              <p className="text-xs text-slate-400 font-mono tracking-wide max-w-sm mx-auto line-clamp-2">
                {currentLabel}
              </p>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5 max-w-sm mx-auto">
              <div className="flex justify-between text-[10px] font-black tracking-widest uppercase font-mono text-slate-400">
                <span>
                  {completedCount + errorCount} / {eligibleOffers.length}
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
