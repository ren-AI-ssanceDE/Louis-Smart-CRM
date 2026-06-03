import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Upload, Trash2, Download, File, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface FileBrowserProps {
  type: 'companies' | 'contacts';
  id: string;
  name: string;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({ type, id, name }) => {
  const { t } = useTranslation(['common', 'dashboard', 'admin']);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();

  const { data: files = [], isLoading, error } = trpc.getFiles.useQuery(
    { type, id_uuid: id, name },
    { enabled: !!id }
  );

  const displayedFiles = React.useMemo(() => {
    return files.filter(f => {
      if (type === 'companies') {
        const nameLower = f.name.toLowerCase();
        return !(nameLower.startsWith("rechnung_") || nameLower.startsWith("zugferd_") || nameLower.startsWith("invoice_"));
      }
      return true;
    });
  }, [files, type]);

  const deleteMutation = trpc.deleteFile.useMutation({
    onSuccess: () => {
      utils.getFiles.invalidate({ type, id_uuid: id, name });
      toast.success(t('files.delete_success', { defaultValue: 'Datei erfolgreich gelöscht' }));
    },
    onError: () => {
      toast.error(t('files.delete_error', { defaultValue: 'Fehler beim Löschen der Datei' }));
    }
  });

  const [ingestingFile, setIngestingFile] = useState<string | null>(null);

  const ingestMutation = trpc.forceIngestFileToRag.useMutation({
    onSuccess: (data) => {
      utils.getFiles.invalidate({ type, id_uuid: id, name });
      toast.success(t('files.ingest_success', { name: ingestingFile || '', count: data.chunkCount, defaultValue: `Datei "${ingestingFile || ''}" erfolgreich im RAG indiziert! (${data.chunkCount} Textblöcke generiert)` }));
      setIngestingFile(null);
    },
    onError: (err) => {
      setIngestingFile(null);
      toast.error(t('files.ingest_error', { message: err.message, defaultValue: `RAG Ingest fehlgeschlagen: ${err.message}` }));
    }
  });

  const handleManualIngest = async (filename: string) => {
    setIngestingFile(filename);
    ingestMutation.mutate({ type, id_uuid: id, name, filename });
  };

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('type', type);
    formData.append('id', id);
    formData.append('name', name);
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        utils.getFiles.invalidate({ type, id_uuid: id, name });
        toast.success(t('files.upload_success', { defaultValue: 'Datei erfolgreich hochgeladen' }));
      } else {
        toast.error(t('files.upload_error', { defaultValue: 'Fehler beim Hochladen der Datei' }));
      }
    } catch (err) {
      toast.error(t('files.upload_error', { defaultValue: 'Fehler beim Hochladen der Datei' }));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDownloadUrl = (filename: string) => {
    return `/api/files/${type}/${id}/${encodeURIComponent(name)}/${encodeURIComponent(filename)}`;
  };

  const handleDownload = async (filename: string) => {
    try {
      setDownloadingFile(filename);
      const url = getDownloadUrl(filename);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Error downloading file:", err);
      toast.error(t('files.download_error', { defaultValue: 'Fehler beim Herunterladen der Datei' }));
    } finally {
      setDownloadingFile(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-wider font-display flex items-center gap-3">
            <FileText className="text-accent-orange" /> {t('files.title')}
          </h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
            {t('files.workspace_subtitle', { defaultValue: 'Arbeits- und Interaktionsbereich' })}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          disabled={isUploading}
          className="flex items-center gap-3 px-5 py-2.5 bg-accent-orange hover:bg-accent-orange/90 disabled:opacity-50 text-black font-black text-[10px] uppercase tracking-widest rounded-lg transition-all"
        >
          {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {t('files.upload')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
        />
      </div>

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={cn(
          "relative min-h-[300px] bg-primary-dark/50 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-8 transition-all",
          dragActive ? "border-accent-orange bg-accent-orange/5" : "border-white/5",
          displayedFiles.length > 0 ? "justify-start" : "justify-center"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-8 h-8 text-accent-orange animate-spin" />
        ) : displayedFiles.length === 0 ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-primary-light border-2 border-white/5 rounded-2xl flex items-center justify-center mx-auto text-slate-600">
              <Upload size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-white font-bold text-sm">{t('files.empty')}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-widest font-black">{t('files.drop_zone')}</p>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-3">
            <AnimatePresence>
              {displayedFiles.map((file) => (
                <motion.div
                  key={file.name}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-primary-light border-2 border-white/5 p-4 rounded-xl flex items-center gap-4 group hover:border-accent-orange/20 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary-dark border-2 border-white/5 flex items-center justify-center text-slate-500 group-hover:text-accent-orange transition-colors">
                    <File size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-bold text-xs flex flex-wrap items-center gap-2" title={file.name}>
                      <span className="truncate max-w-[200px] sm:max-w-md">{file.name}</span>
                      {file.isIndexed && (
                        <span className="shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5" title={`${file.chunkCount} RAG Chunks successfully indexed in database`}>
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{t('files.rag_ready', { count: file.chunkCount, defaultValue: `RAG READY (${file.chunkCount} chunks)` })}</span>
                        </span>
                      )}
                       {!file.isIndexed && (() => {
                        const ext = file.name.split('.').pop()?.toLowerCase() || '';
                        const isRAGCompatible = ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
                        
                        if (ingestingFile === file.name) {
                          return (
                            <span className="shrink-0 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                              <Loader2 size={8} className="animate-spin text-amber-400" />
                              <span>{t('files.in_progress', { defaultValue: 'IN PROGRESS...' })}</span>
                            </span>
                          );
                        }
                        
                        if (isRAGCompatible) {
                          return (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleManualIngest(file.name);
                              }}
                              className="shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50 text-amber-300 text-[8px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition-all active:scale-95 text-shadow-sm hover:shadow-amber-500/20 shadow-sm"
                              title="Dieses Dokument parsen und für die Louis KI im RAG-Vektorsuche bereitstellen"
                            >
                              <Sparkles size={8} className="text-amber-400 animate-pulse" />
                              <span>{t('files.ingest_rag', { defaultValue: 'IN RAG AUFNEHMEN' })}</span>
                            </button>
                          );
                        } else {
                          return (
                            <span className="shrink-0 bg-white/5 border border-white/10 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title="Binäre Ablage (Keine RAG-Fragmentierung)">
                              {t('files.general_storage', { defaultValue: 'ABLAGE' })}
                            </span>
                          );
                        }
                      })()}
                    </div>
                    <div className="text-[9px] text-slate-500 font-black uppercase tracking-wider mt-1">
                      {formatSize(file.size)} • {new Date(file.mtime).toLocaleDateString()}
                    </div>
                  </div>
                  {confirmDeleteFile === file.name ? (
                    <motion.div 
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-2"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest mr-1">
                        {t('files.delete_confirm', { defaultValue: 'Löschen?' })}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteMutation.mutate({ type, id_uuid: id, name, filename: file.name });
                          setConfirmDeleteFile(null);
                        }}
                        disabled={deleteMutation.isPending}
                        className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-black text-[9px] uppercase tracking-wider rounded transition-colors cursor-pointer"
                      >
                        {deleteMutation.isPending ? t('loading') : t('delete', { defaultValue: 'Löschen' })}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmDeleteFile(null);
                        }}
                        className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-slate-300 font-black text-[9px] uppercase tracking-wider rounded transition-colors cursor-pointer"
                      >
                        {t('cancel', { defaultValue: 'Abbrechen' })}
                      </button>
                    </motion.div>
                  ) : (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDownload(file.name);
                        }}
                        disabled={downloadingFile === file.name}
                        className="p-2 text-slate-500 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                        title={t('files.download', { defaultValue: 'Datei herunterladen' })}
                      >
                        {downloadingFile === file.name ? (
                          <Loader2 size={14} className="animate-spin text-accent-orange" />
                        ) : (
                          <Download size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmDeleteFile(file.name);
                        }}
                        className="p-2 text-slate-500 hover:text-red-500 transition-colors cursor-pointer"
                        title={t('files.delete', { defaultValue: 'Datei löschen' })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {dragActive && (
          <div className="absolute inset-0 bg-accent-orange/10 backdrop-blur-sm pointer-events-none flex items-center justify-center">
            <div className="bg-accent-orange text-black font-black text-xs px-6 py-3 rounded-xl uppercase tracking-widest flex items-center gap-3">
              <Upload size={16} /> {t('files.drop_zone')}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border-2 border-red-500/20 rounded-xl flex items-center gap-4 text-red-500">
          <AlertCircle size={20} />
          <div className="text-xs font-bold uppercase tracking-wide">
            {t('error')}: {error.message}
          </div>
        </div>
      )}
    </div>
  );
};
