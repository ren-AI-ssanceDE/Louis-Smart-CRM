import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Upload, Trash2, Download, File, Loader2, AlertCircle, Sparkles, Search, ArrowUpDown, Database, Layers } from 'lucide-react';
import { trpc } from '../lib/trpc';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

interface FileBrowserProps {
  type: 'companies' | 'contacts';
  id: string;
  name: string;
}

type SortOption = 'name_asc' | 'name_desc' | 'date_desc' | 'date_asc' | 'size_desc' | 'size_asc';
type TabOption = 'all' | 'rag_active' | 'unindexed' | 'storage';

export const FileBrowser: React.FC<FileBrowserProps> = ({ type, id, name }) => {
  const { t } = useTranslation(['common', 'dashboard', 'admin']);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterTab, setFilterTab] = useState<TabOption>('all');
  const [sortBy, setSortBy] = useState<SortOption>('date_desc');
  const [visibleLimit, setVisibleLimit] = useState<number>(5);
  
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

  // Compute metrics/statistics
  const stats = React.useMemo(() => {
    let indexedCount = 0;
    let totalChunks = 0;
    let pendingIngestionCount = 0;
    
    displayedFiles.forEach(f => {
      if (f.isIndexed) {
        indexedCount++;
        totalChunks += f.chunkCount || 0;
      } else {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        const isRAGCompatible = ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
        if (isRAGCompatible) {
          pendingIngestionCount++;
        }
      }
    });

    const totalSize = displayedFiles.reduce((acc, curr) => acc + (curr.size || 0), 0);

    return {
      indexedCount,
      totalChunks,
      pendingIngestionCount,
      totalCount: displayedFiles.length,
      totalSize
    };
  }, [displayedFiles]);

  // Filter & Sort logic
  const filteredAndSortedFiles = React.useMemo(() => {
    // 1. Search filter
    let result = displayedFiles.filter(file => 
      file.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // 2. Tab filter
    if (filterTab === 'rag_active') {
      result = result.filter(file => file.isIndexed);
    } else if (filterTab === 'unindexed') {
      result = result.filter(file => {
        if (file.isIndexed) return false;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
      });
    } else if (filterTab === 'storage') {
      result = result.filter(file => {
        if (file.isIndexed) return false;
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        return !['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
      });
    }

    // 3. Sorting
    result.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return a.name.localeCompare(b.name);
      } else if (sortBy === 'name_desc') {
        return b.name.localeCompare(a.name);
      } else if (sortBy === 'date_desc') {
        const aTime = new Date(a.mtime).getTime();
        const bTime = new Date(b.mtime).getTime();
        return bTime - aTime;
      } else if (sortBy === 'date_asc') {
        const aTime = new Date(a.mtime).getTime();
        const bTime = new Date(b.mtime).getTime();
        return aTime - bTime;
      } else if (sortBy === 'size_desc') {
        return b.size - a.size;
      } else if (sortBy === 'size_asc') {
        return a.size - b.size;
      }
      return 0;
    });

    return result;
  }, [displayedFiles, searchTerm, filterTab, sortBy]);

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

  const paginatedFiles = React.useMemo(() => {
    return filteredAndSortedFiles.slice(0, visibleLimit);
  }, [filteredAndSortedFiles, visibleLimit]);

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

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
        />
      </div>

      {/* RAG & Document Stats Row */}
      {displayedFiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-dark/40 border border-white/5 p-4 rounded-xl">
          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-display">
              {t('files.stats_title', { defaultValue: 'RAG-Abdeckung' })}
            </span>
            <div className="flex items-center gap-2">
              <Database size={14} className="text-accent-blue" />
              <span className="text-white font-mono font-black text-xs">
                {stats.indexedCount} / {stats.totalCount}
              </span>
            </div>
            <span className="text-[8px] text-slate-400 uppercase tracking-wider block font-medium">
              {t('files.stats_indexed', { count: stats.indexedCount, defaultValue: `${stats.indexedCount} RAG-Dokumente` })}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-display">
              {t('admin:ai_settings.rag_tokens_title', { defaultValue: 'RAG Segmente' })}
            </span>
            <div className="flex items-center gap-2">
              <Layers size={14} className="text-accent-orange" />
              <span className="text-white font-mono font-black text-xs">
                {stats.totalChunks}
              </span>
            </div>
            <span className="text-[8px] text-slate-400 uppercase tracking-wider block font-medium">
              {t('files.stats_chunks', { count: stats.totalChunks, defaultValue: `${stats.totalChunks} Textsegmente` })}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-display">
              {t('files.stats_rag_ready_header', { defaultValue: 'RAG-Bereit' })}
            </span>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400 animate-pulse" />
              <span className="text-white font-mono font-black text-xs">
                {stats.pendingIngestionCount}
              </span>
            </div>
            <span className="text-[8px] text-slate-400 uppercase tracking-wider block font-medium">
              {t('files.stats_rag_ready_desc', { defaultValue: 'Ausstehende Dokumente' })}
            </span>
          </div>

          <div className="space-y-1">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-display">
              {t('files.stats_storage_header', { defaultValue: 'Speicherplatz' })}
            </span>
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-slate-400" />
              <span className="text-white font-mono font-black text-xs">
                {formatSize(stats.totalSize)}
              </span>
            </div>
            <span className="text-[8px] text-slate-400 uppercase tracking-wider block font-medium">
              {t('files.stats_storage_desc', { defaultValue: 'Gesamte Kapazität indiziert' })}
            </span>
          </div>
        </div>
      )}

      {/* Search & Control Tools */}
      {displayedFiles.length > 0 && (
        <div className="space-y-4 bg-primary-dark/20 p-4 rounded-xl border border-white/5">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Search size={14} />
              </span>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setVisibleLimit(5); // Reset expansion limit on search
                }}
                placeholder={t('files.search_placeholder', { defaultValue: 'Dateien nach Name filtern...' })}
                className="w-full pl-10 pr-4 py-2 bg-primary-dark border-2 border-white/5 rounded-lg text-white font-bold text-xs focus:border-accent-orange/30 outline-none transition-colors placeholder:text-slate-600"
              />
            </div>

            {/* Sorting */}
            <div className="flex items-center gap-2 self-start md:self-auto">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5 font-display min-w-[70px]">
                <ArrowUpDown size={12} className="text-accent-blue" />
                {t('files.sort_label', { defaultValue: 'Sortierung' })}:
              </span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-primary-dark border-2 border-white/5 rounded-lg text-white font-bold text-xs px-3 py-1.5 outline-none focus:border-accent-orange/30 cursor-pointer min-w-[140px]"
              >
                <option value="date_desc">{t('files.sort_date_desc', { defaultValue: 'Neueste zuerst' })}</option>
                <option value="date_asc">{t('files.sort_date_asc', { defaultValue: 'Älteste zuerst' })}</option>
                <option value="name_asc">{t('files.sort_name_asc', { defaultValue: 'Name (A-Z)' })}</option>
                <option value="name_desc">{t('files.sort_name_desc', { defaultValue: 'Name (Z-A)' })}</option>
                <option value="size_desc">{t('files.sort_size_desc', { defaultValue: 'Größte zuerst' })}</option>
                <option value="size_asc">{t('files.sort_size_asc', { defaultValue: 'Kleinste zuerst' })}</option>
              </select>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            {[
              { id: 'all', label: t('files.tab_all', { count: displayedFiles.length, defaultValue: `Alle (${displayedFiles.length})` }) },
              { id: 'rag_active', label: t('files.tab_rag_ready', { count: stats.indexedCount, defaultValue: `RAG Aktiv (${stats.indexedCount})` }) },
              { id: 'unindexed', label: t('files.tab_unindexed', { count: stats.pendingIngestionCount, defaultValue: `RAG Bereit (${stats.pendingIngestionCount})` }) },
              { id: 'storage', label: t('files.tab_storage', { count: displayedFiles.length - stats.indexedCount - stats.pendingIngestionCount, defaultValue: `Nur Ablage (${displayedFiles.length - stats.indexedCount - stats.pendingIngestionCount})` }) }
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFilterTab(tab.id as TabOption);
                  setVisibleLimit(5); // Reset limit on tab change
                }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border",
                  filterTab === tab.id
                    ? "bg-accent-orange text-black border-accent-orange"
                    : "bg-primary-dark/30 text-slate-400 border-white/5 hover:border-white/10 hover:text-white"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={(e) => {
          if (filteredAndSortedFiles.length === 0 || e.target === e.currentTarget) {
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "relative min-h-[220px] bg-primary-dark/50 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-6 transition-all cursor-pointer group/dropzone",
          dragActive 
            ? "border-accent-orange bg-accent-orange/5" 
            : "border-white/5 hover:border-accent-orange/20 hover:bg-primary-dark/60",
          filteredAndSortedFiles.length > 0 ? "justify-start cursor-default" : "justify-center"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-8 h-8 text-accent-orange animate-spin" />
        ) : filteredAndSortedFiles.length === 0 ? (
          <div className="text-center space-y-4 py-8 group-hover/dropzone:scale-102 transition-transform duration-200">
            <div className="w-16 h-16 bg-primary-light border-2 border-white/5 rounded-2xl flex items-center justify-center mx-auto text-slate-500 group-hover/dropzone:text-accent-orange transition-colors">
              <Upload size={32} />
            </div>
            <div className="space-y-1">
              <p className="text-white font-bold text-sm">{t('files.empty')}</p>
              <p className="text-slate-500 text-[10px] uppercase tracking-widest font-black">{t('files.drop_zone')}</p>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col gap-3">
            <AnimatePresence mode="popLayout">
              {paginatedFiles.map((file) => (
                <motion.div
                  key={file.name}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="bg-primary-light border-2 border-white/5 p-4 rounded-xl flex items-center gap-4 group hover:border-accent-orange/20 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg bg-primary-dark border-2 border-white/5 flex items-center justify-center text-slate-500 group-hover:text-accent-orange transition-colors">
                    <File size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-bold text-xs flex flex-wrap items-center gap-2" title={file.name}>
                      <span className="truncate max-w-[160px] sm:max-w-md">{file.name}</span>
                      {file.isIndexed && (file.chunkCount || 0) > 0 ? (
                        <span className="shrink-0 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5" title={t('files.indexed_chunks_tooltip', { count: file.chunkCount, defaultValue: `${file.chunkCount} RAG Segmente erfolgreich in der Datenbank indiziert.` })}>
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                          <span>{t('files.rag_ready', { count: file.chunkCount, defaultValue: `RAG BEREIT (${file.chunkCount} Segmente)` })}</span>
                        </span>
                      ) : (() => {
                        const ext = file.name.split('.').pop()?.toLowerCase() || '';
                        const isRAGCompatible = ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
                        
                        if (ingestingFile === file.name) {
                          return (
                            <span className="shrink-0 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5 animate-pulse">
                              <Loader2 size={8} className="animate-spin text-amber-400" />
                              <span>{t('files.in_progress', { defaultValue: 'VERARBEITE...' })}</span>
                            </span>
                          );
                        }
                        
                        if (isRAGCompatible) {
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="shrink-0 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1.5" title={t('files.no_chunks_tooltip', { defaultValue: 'Noch keine Textsegmente im RAG-Index vorhanden' })}>
                                <span className="w-1 h-1 rounded-full bg-amber-500/40 animate-pulse" />
                                <span>{t('files.not_indexed', { defaultValue: 'Noch nicht indiziert' })}</span>
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleManualIngest(file.name);
                                }}
                                className="shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50 text-amber-300 text-[8px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition-all active:scale-95 text-shadow-sm hover:shadow-amber-500/20 shadow-sm"
                                title={t('files.ingest_tooltip', { defaultValue: 'Dieses Dokument parsen und für die Louis KI im RAG-Vektorsuche bereitstellen' })}
                              >
                                <Sparkles size={8} className="text-amber-400 animate-pulse" />
                                <span>{t('files.ingest_rag', { defaultValue: 'IN RAG AUFNEHMEN' })}</span>
                              </button>
                            </div>
                          );
                        } else {
                          return (
                            <span className="shrink-0 bg-white/5 border border-white/10 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('files.general_storage_tooltip', { defaultValue: 'Binäre Ablage (Keine RAG-Fragmentierung)' })}>
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

            {/* Pagination Controls */}
            {filteredAndSortedFiles.length > visibleLimit && (
              <div className="flex flex-col items-center justify-center pt-4 border-t border-white/5 gap-2 w-full">
                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest font-mono">
                  {t('files.info_showing', { 
                    showing: visibleLimit, 
                    total: filteredAndSortedFiles.length, 
                    defaultValue: `Zeige ${visibleLimit} von ${filteredAndSortedFiles.length} Dateien` 
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleLimit(prev => prev + 5)}
                  className="px-4 py-2 bg-primary-light border-2 border-white/5 hover:border-accent-orange/40 rounded-lg text-slate-300 hover:text-white text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer active:scale-95"
                >
                  {t('files.show_more', { defaultValue: 'Mehr anzeigen' })}
                </button>
              </div>
            )}

            {visibleLimit > 5 && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => setVisibleLimit(5)}
                  className="px-4 py-2 bg-primary-light/30 border border-white/5 rounded-lg text-slate-400 hover:text-white text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer active:scale-95"
                >
                  {t('files.show_less', { defaultValue: 'Weniger anzeigen' })}
                </button>
              </div>
            )}
          </div>
        )}

        {dragActive && (
          <div className="absolute inset-0 bg-accent-orange/10 backdrop-blur-sm pointer-events-none flex items-center justify-center rounded-2xl">
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

