import React, { useEffect, useState, useRef } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { 
  Brain, 
  Save, 
  Info, 
  Trash2, 
  Edit2, 
  Plus, 
  Check, 
  X, 
  FileText, 
  UploadCloud, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  Loader2,
  Download
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { KnowledgeFile, ChatNote, Company, Contact } from '../../types';
import { cn, downloadFileFromUrl } from '../../lib/utils';

export const LouisAiMemoryForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preferencesText, setPreferencesText] = useState('');
  const [activeMemoryTab, setActiveMemoryTab] = useState<'user' | 'files'>('user');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [newNoteType, setNewNoteType] = useState<'user' | 'contact' | 'company'>('user');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTargetId, setNewNoteTargetId] = useState('');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [expandedNoteIds, setExpandedNoteIds] = useState<string[]>([]);

  const [newNoteIsRagIndexed, setNewNoteIsRagIndexed] = useState(true);
  const [togglingNoteRagId, setTogglingNoteRagId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isNoteSubmitAttempted, setIsNoteSubmitAttempted] = useState(false);

  // Queries
  const { data: memory, refetch: refetchMemory, isLoading: isLoadingMemory } = trpc.getUserMemory.useQuery();
  const { data: contacts = [] } = trpc.getContacts.useQuery();
  const { data: companies = [] } = trpc.getCompanies.useQuery();
  const { data: kFiles = [], refetch: refetchKFiles } = trpc.getKnowledgeFiles.useQuery();
  const kFileList: KnowledgeFile[] = kFiles || [];

  useEffect(() => {
    if (memory) {
      setPreferencesText(memory.response_preferences_text || '');
    }
  }, [memory]);

  // Mutations
  const editNoteMutation = trpc.editEntityNote.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_updated_success', { defaultValue: 'Notiz erfolgreich aktualisiert!' }));
      refetchMemory();
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setEditingNoteId(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_updated_error', { defaultValue: 'Fehler beim Aktualisieren der Notiz.' }));
    }
  });

  const deleteNoteMutation = trpc.deleteEntityNote.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_deleted_success', { defaultValue: 'Notiz erfolgreich gelöscht!' }));
      refetchMemory();
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setDeletingNoteId(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_deleted_error', { defaultValue: 'Fehler beim Löschen der Notiz.' }));
      setDeletingNoteId(null);
    }
  });

  const addNoteMutation = trpc.saveNoteToEntity.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_note_added_success', { defaultValue: 'Wissensnotiz manuell hinzugefügt!' }));
      refetchMemory();
      refetchKFiles();
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      setIsAddingNote(false);
      setNewNoteContent('');
      setNewNoteTargetId('');
      setNewNoteIsRagIndexed(true);
      setIsNoteSubmitAttempted(false);
    },
    onError: (err) => {
      toast.error(t('admin:toast_note_added_error', { defaultValue: 'Fehler beim Hinzufügen der Notiz.' }));
    }
  });

  const toggleRagMutation = trpc.toggleNoteRagIndex.useMutation({
    onSuccess: (_, variables) => {
      const isIndexed = variables && variables.is_rag_indexed ? true : false;
      toast.success(isIndexed 
        ? t('admin:toast_rag_toggle_success_index', { defaultValue: 'Wissensnotiz erfolgreich indiziert!' })
        : t('admin:toast_rag_toggle_success_remove', { defaultValue: 'Wissensnotiz erfolgreich aus RAG entfernt!' })
      );
      setTogglingNoteRagId(null);
      refetchMemory();
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_rag_toggle_error', { defaultValue: 'RAG-Umschaltung fehlgeschlagen.' }));
      setTogglingNoteRagId(null);
    }
  });

  const handleToggleNoteRag = (id_uuid: string, is_rag_indexed: boolean) => {
    setTogglingNoteRagId(id_uuid);
    toggleRagMutation.mutate({ id_uuid, is_rag_indexed });
  };

  const handleDownloadNote = (note: ChatNote, targetLabel: string) => {
    try {
      const markdownContent = `# Wissensnotiz - Louis Smart CRM

**Zuordnung:** ${targetLabel}
**Erstellt am:** ${note.created_at_utc ? new Date(note.created_at_utc).toLocaleString('de-DE') : 'N/A'}
**RAG-Status:** ${note.is_rag_indexed ? 'In RAG Wissensdatenbank integriert' : 'Inaktiv'}
**Notiz-ID:** ${note.id_uuid}

---

## Inhalt

${note.content}
`;
      const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeLabel = (targetLabel || 'notiz').replace(/[^a-zA-Z0-9_-]/g, '_');
      a.download = `wissensnotiz_${safeLabel}_${note.id_uuid.slice(0, 8)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t('admin:toast_note_downloaded', { defaultValue: 'Notiz heruntergeladen!' }));
    } catch (err) {
      downloadFileFromUrl(`/api/notes/download/${note.id_uuid}`, `wissensnotiz_${note.id_uuid.slice(0, 8)}.md`).catch(() => {});
    }
  };

  const saveKFileMutation = trpc.saveKnowledgeFile.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_file_uploaded_success', { defaultValue: 'Wissensdokument hochgeladen!' }));
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_uploaded_error', { defaultValue: 'Fehler beim Hochladen der Datei: ' }) + err.message);
    }
  });

  const deleteKFileMutation = trpc.deleteKnowledgeFile.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_file_deleted_success', { defaultValue: 'Wissensdokument gelöscht!' }));
      refetchKFiles();
      setDeletingFileName(null);
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_deleted_error', { defaultValue: 'Fehler beim Löschen der Datei: ' }) + err.message);
      setDeletingFileName(null);
    }
  });

  const [ingestingKFile, setIngestingKFile] = useState<string | null>(null);

  const ingestKFileMutation = trpc.forceIngestKnowledgeToRag.useMutation({
    onSuccess: (data) => {
      toast.success(t('admin:toast_file_rag_success', { name: ingestingKFile || '', count: data.chunkCount, defaultValue: `Datei "${ingestingKFile || ''}" erfolgreich im CRM RAG indiziert! (${data.chunkCount} Textblöcke generiert)` }));
      setIngestingKFile(null);
      refetchKFiles();
    },
    onError: (err) => {
      toast.error(t('admin:toast_file_rag_error', { defaultValue: 'RAG Ingest fehlgeschlagen: ' }) + err.message);
      setIngestingKFile(null);
    }
  });

  const handleManualIngestKFile = (filename: string) => {
    setIngestingKFile(filename);
    ingestKFileMutation.mutate({ filename });
  };

  const performUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Content = result.split(',')[1];
      saveKFileMutation.mutate({
        filename: file.name,
        content: base64Content
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) performUpload(file);
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
      performUpload(e.dataTransfer.files[0]);
    }
  };

  const updateMemoryMutation = trpc.updateUserMemory.useMutation({
    onSuccess: () => {
      toast.success(t('ai_settings_saved_success', { defaultValue: "LOUIS AI Langzeitgedächtnis erfolgreich gespeichert!" }));
      refetchMemory();
    },
    onError: (err) => {
      toast.error(t('user_memory_save_failed', { defaultValue: "Fehler beim Sichern des Langzeitgedächtnisses: " }) + err.message);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMemoryMutation.mutate({
      response_preferences_text: preferencesText
    });
  };

  if (isLoadingMemory) {
    return (
      <div className="flex items-center gap-3 justify-center py-12">
        <div className="w-6 h-6 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">{t('admin:ai_settings.loading_ai_profiles')}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center gap-6 mb-8">
        <div className="p-5 bg-gradient-to-tr from-accent-orange/20 to-accent-blue/20 rounded-2xl border border-white/5 shadow-xl relative glow-orange">
          <Brain className="text-accent-orange" size={32} />
        </div>
        <div>
          <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display">
            {t('admin:ai_settings.memory_db_label')}
          </h3>
          <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">
            {t('admin:ai_settings.memory_db_desc')}
          </p>
        </div>
      </div>

      {/* Response Preferences Block */}
      <div className="space-y-6">
        <div>
          <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display mb-2">
            {t('admin:ai_settings.memory_title', { defaultValue: '🧠 AI Langzeitgedächtnis & Antwortpräferenzen (User Memory)' })}
          </h4>
          <p className="text-slate-500 text-[11px] leading-relaxed max-w-2xl font-medium">
            {t('admin:ai_settings.memory_desc', { defaultValue: 'Personalisiere das Langzeitgedächtnis deines LOUIS ReAct Agenten. Hinterlege globale Abmachungen, Antwortstile oder systemweite Persona-Richtlinien. Zudem sichte hier die im Kurzzeitgedächtnis automatisch aggregierten CRM-Notizen.' })}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
            {t('admin:ai_settings.memory_preferences_label', { defaultValue: 'Globale Antwort-Präferenzen & Verhaltensanweisungen' })}
          </label>
          <textarea
            value={preferencesText}
            onChange={(e) => setPreferencesText(e.target.value)}
            rows={4}
            className="w-full bg-primary-dark border border-white/5 rounded-xl p-4 text-xs leading-relaxed text-white font-medium focus:outline-none focus:border-accent-orange/40 focus:ring-1 focus:ring-accent-orange/25"
            placeholder={t('admin:ai_settings.memory_preferences_placeholder', { defaultValue: 'z.B. Du bist ein professioneller, steuerrechtlich sensibilisierter Finanzassistent. Antworte immer auf Deutsch, halte Angebote tabellarisch und formuliere kurz gefasst.' })}
          />
        </div>

        {/* Long-term memory & Internal Knowledge Base Tools */}
        <div className="space-y-4 border-t border-white/5 pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:ai_settings.memory_db_label', { defaultValue: '🧠 Langzeitgedächtnis & Wissensdatenbank' })}
              </label>
              <p className="text-[10px] text-slate-500 font-medium">
                {t('admin:ai_settings.memory_db_desc', { defaultValue: 'Pflegetools für dauerhafte AI-Kontexte, Kundenprofile und begleitendes RAG-Hintergrundwissen.' })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsAddingNote(true);
                setNewNoteType('user');
                setNewNoteContent('');
                setNewNoteTargetId('');
              }}
              className="bg-accent-orange/10 border border-accent-orange/20 text-accent-orange hover:bg-accent-orange/20 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all self-start sm:self-center"
            >
              <Plus size={12} />
              {t('admin:ai_settings.memory_add_note_btn', { defaultValue: 'Notiz hinzufügen' })}
            </button>
          </div>

          {/* Sub-tabs Selection */}
          <div className="flex flex-wrap gap-1 border-b border-white/5 pb-1">
            <button
              type="button"
              onClick={() => { setActiveMemoryTab('user'); setIsAddingNote(false); }}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                activeMemoryTab === 'user'
                  ? 'bg-accent-orange text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('admin:ai_settings.memory_tab_user', { defaultValue: 'Eigene Notizen / Wissen' })}
            </button>
            <button
              type="button"
              onClick={() => { setActiveMemoryTab('files'); setIsAddingNote(false); }}
              className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                activeMemoryTab === 'files'
                  ? 'bg-accent-orange text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t('admin:ai_settings.memory_tab_files', { count: kFiles.length, defaultValue: `Wissensdokumente (${kFiles.length})` })}
            </button>
          </div>

          {/* Manual Note Form */}
          {isAddingNote && (
            <div className="bg-primary-dark border border-accent-orange/30 p-5 rounded-2xl space-y-4 mb-4">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <h5 className="text-[11px] font-black text-white uppercase tracking-widest font-display">
                  {t('admin:ai_settings.memory_add_form_title', { defaultValue: 'Wissensnotiz manuell hinzufügen' })}
                </h5>
                <button 
                  type="button" 
                  onClick={() => setIsAddingNote(false)}
                  className="text-slate-500 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">
                    {t('admin:ai_settings.memory_content_label', { defaultValue: 'Inhalt (Markdown)' })}
                  </label>
                  <textarea
                    value={newNoteContent}
                    onChange={(e) => setNewNoteContent(e.target.value)}
                    required
                    rows={5}
                    placeholder={t('admin:ai_settings.memory_content_placeholder', { defaultValue: 'Trage hier dein Wissen, eine Gesprächszusammenfassung oder Systemrichtlinien ein...' })}
                    className={cn(
                      "w-full bg-[#0d1527] border rounded-xl p-3 text-xs text-white focus:outline-none",
                      isNoteSubmitAttempted && !newNoteContent.trim()
                        ? "border-red-500/50 focus:border-red-500"
                        : "border-white/5 focus:border-accent-orange/40"
                    )}
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="newNoteIsRagIndexed"
                    checked={newNoteIsRagIndexed}
                    onChange={(e) => setNewNoteIsRagIndexed(e.target.checked)}
                    className="rounded border-white/5 bg-[#0d1527] text-accent-orange focus:ring-accent-orange/40 focus:ring-1 focus:ring-offset-0 cursor-pointer w-3.5 h-3.5"
                  />
                  <label htmlFor="newNoteIsRagIndexed" className="text-[10px] font-bold text-slate-300 select-none cursor-pointer flex items-center gap-1.5 hover:text-white transition-colors">
                    <Sparkles size={11} className="text-amber-400" />
                    {t('admin:ai_settings.memory_rag_checkbox_label', { defaultValue: 'Direkt in die RAG-Wissensdatenbank (Vektor-Kurzzeitgedächtnis) aufnehmen' })}
                  </label>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!newNoteContent.trim()) {
                      setIsNoteSubmitAttempted(true);
                      toast.error(t('admin:toast_content_empty_error', { defaultValue: 'Inhalt darf nicht leer sein.' }));
                      return;
                    }
                    setIsNoteSubmitAttempted(false);
                    addNoteMutation.mutate({
                      entity_type: newNoteType,
                      entity_id: undefined,
                      content: newNoteContent,
                      is_rag_indexed: newNoteIsRagIndexed
                    });
                  }}
                  disabled={addNoteMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-accent-orange text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 hover:scale-105 active:scale-95 transition-transform duration-200 cursor-pointer"
                >
                  {addNoteMutation.isPending ? "..." : <Check size={12} />}
                  {t('admin:ai_settings.note_action_save', { defaultValue: 'Speichern' })}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAddingNote(false)}
                  className="px-4 py-2 rounded-xl border border-white/5 text-slate-400 text-[10px] font-black uppercase tracking-wider hover:text-white"
                >
                  {t('admin:ai_settings.note_action_cancel', { defaultValue: 'Abbrechen' })}
                </button>
              </div>
            </div>
          )}

          {/* Tab Contents */}
          {activeMemoryTab === 'files' ? (
            <div className="space-y-4">
              {/* File upload zone */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={cn(
                  "border-2 border-dashed p-8 rounded-2xl bg-primary-dark/30 hover:bg-primary-dark/50 transition-all text-center cursor-pointer group",
                  dragActive 
                    ? "border-accent-orange bg-accent-orange/5" 
                    : "border-white/5 hover:border-accent-orange/30 hover:bg-primary-dark/50"
                )}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  accept=".pdf,.txt,.doc,.docx,.md"
                />
                <UploadCloud 
                  className={cn(
                    "mx-auto mb-2 transition-colors",
                    dragActive ? "text-accent-orange scale-110" : "text-slate-500 group-hover:text-accent-orange"
                  )} 
                  size={28} 
                />
                <span className="block text-xs text-white font-semibold">
                  {t('admin:ai_settings.files_upload_title', { defaultValue: 'Dateien hier hochladen (.pdf, .txt, .md, .docx)' })}
                </span>
                <span className="block text-[9px] text-slate-500 font-mono mt-1">
                  {t('admin:ai_settings.files_upload_desc', { defaultValue: 'Werden im Louis System-Tresor zur RAG-Dokumentenverarbeitung bereitgestellt' })}
                </span>
              </div>

              {/* Files Table / List */}
              {kFiles.length === 0 ? (
                <div className="p-6 text-center bg-primary-dark/30 border border-white/5 rounded-2xl">
                  <p className="text-xs text-slate-500 font-mono italic font-medium">
                    {t('admin:ai_settings.files_empty', { defaultValue: 'Keine Systemdokumente hochgeladen.' })}
                  </p>
                </div>
              ) : (
                <div className="bg-primary-dark/50 border border-white/5 rounded-2xl overflow-hidden">
                  <table className="w-full text-left text-xs text-slate-300 font-medium">
                    <thead className="bg-[#050B14] text-[9px] text-slate-400 uppercase tracking-widest font-black">
                      <tr>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_name', { defaultValue: 'Dateiname' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_size', { defaultValue: 'Größe' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_mtime', { defaultValue: 'Aktualisiert' })}</th>
                        <th className="px-4 py-3">{t('admin:ai_settings.files_col_status', { defaultValue: 'RAG-Status' })}</th>
                        <th className="px-4 py-3 text-right">{t('admin:ai_settings.files_col_action', { defaultValue: 'Aktion' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {kFileList.map((f: KnowledgeFile) => (
                        <tr key={f.name} className="hover:bg-white/[0.01] transition-colors">
                          <td className="px-4 py-3 font-semibold text-white flex items-center gap-2">
                             <FileText size={14} className="text-accent-blue scale-110" />
                            {f.name}
                          </td>
                          <td className="px-4 py-3 text-slate-400 font-mono">
                            {(f.size / 1024).toFixed(1)} KB
                          </td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-[10px]">
                            {new Date(f.mtime).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3">
                            {f.isIndexed && (f.chunkCount || 0) > 0 ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={`${f.chunkCount} RAG Chunks successfully indexed in database`}>
                                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                <span>{t('admin:ai_settings.files_status_ready', { count: f.chunkCount, defaultValue: `RAG READY (${f.chunkCount} chunks)` })}</span>
                              </span>
                            ) : (() => {
                              const ext = f.name.split('.').pop()?.toLowerCase() || '';
                              const isRAGCompatible = ['txt', 'md', 'json', 'csv', 'xml', 'log', 'html', 'js', 'ts', 'py', 'java', 'cpp', 'css', 'yaml', 'yml', 'pdf', 'docx', 'xlsx'].includes(ext);
                              
                              if (ingestingKFile === f.name) {
                                return (
                                  <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                                    <Loader2 size={11} className="animate-spin text-amber-400" />
                                    <span>{t('admin:ai_settings.files_status_progress', { defaultValue: 'IN BEARBEITUNG...' })}</span>
                                  </span>
                                );
                              }
                              
                              if (isRAGCompatible) {
                                return (
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('admin:ai_settings.files_status_not_indexed_tooltip', { defaultValue: 'Noch keine Textsegmente im RAG-Index vorhanden' })}>
                                      <span className="w-1 h-1 rounded-full bg-amber-500/40 animate-pulse" />
                                      <span>{t('admin:ai_settings.files_status_not_indexed', { defaultValue: 'Noch nicht indiziert' })}</span>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleManualIngestKFile(f.name)}
                                      className="inline-flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 hover:border-amber-500/50 text-amber-300 text-[8px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full cursor-pointer transition-all active:scale-95 text-shadow-sm hover:shadow-amber-500/20 shadow-sm"
                                      title={t('admin:ai_settings.files_status_action_ingest_tooltip', { defaultValue: 'Dieses Dokument parsen und für die Louis KI im RAG-Vektorspeicher bereitstellen' })}
                                    >
                                      <Sparkles size={8} className="text-amber-400" />
                                      <span>{t('admin:ai_settings.files_status_action_ingest', { defaultValue: 'IN RAG AUFNEHMEN' })}</span>
                                    </button>
                                  </div>
                                );
                              } else {
                                return (
                                  <span className="inline-flex items-center gap-2 bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                                    <span>{t('admin:ai_settings.files_status_archive', { defaultValue: 'ABLAGE' })}</span>
                                  </span>
                                );
                              }
                            })()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {deletingFileName === f.name ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="text-[9px] text-slate-400 font-bold uppercase mr-1">{t('admin:ai_settings.confirm_delete_prompt', { defaultValue: 'Löschen?' })}</span>
                                <button
                                  type="button"
                                  onClick={() => deleteKFileMutation.mutate({ filename: f.name })}
                                  disabled={deleteKFileMutation.isPending}
                                  className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[9px] font-bold transition-all cursor-pointer"
                                >
                                  {t('admin:ai_settings.confirm_yes', { defaultValue: 'Ja' })}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingFileName(null)}
                                  className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[9px] font-bold transition-all cursor-pointer"
                                >
                                  {t('admin:ai_settings.confirm_no', { defaultValue: 'Nein' })}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    downloadFileFromUrl(`/api/knowledge-files/download/${encodeURIComponent(f.name)}`, f.name).catch(() => {
                                      toast.error(t('admin:toast_file_download_error', { defaultValue: 'Fehler beim Herunterladen der Datei' }));
                                    });
                                  }}
                                  className="text-slate-500 hover:text-accent-blue hover:bg-accent-blue/10 p-1.5 rounded transition-colors cursor-pointer inline-flex items-center justify-center"
                                  title={t('admin:ai_settings.files_download_tooltip', { defaultValue: 'Datei herunterladen' })}
                                >
                                  <Download size={14} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingFileName(f.name)}
                                  className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition-colors cursor-pointer"
                                  title={t('admin:ai_settings.files_delete_tooltip', { defaultValue: 'Datei löschen' })}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div>
              {/* Filter and display memory notes based on tab */}
              {(() => {
                const filteredNotes = ((memory?.chat_notes_json || []) as unknown as ChatNote[]).filter(
                  (note: ChatNote) => note.entity_type === activeMemoryTab
                );

                if (filteredNotes.length === 0) {
                  return (
                    <div className="p-6 text-center bg-primary-dark/30 border border-white/5 rounded-2xl">
                      <p className="text-xs text-slate-500 font-mono italic">
                        {activeMemoryTab === 'user' 
                          ? t('admin:ai_settings.notes_empty_user', { defaultValue: 'Bislang wurden keine internen Wissensnotizen angelegt.' })
                          : activeMemoryTab === 'contact' 
                          ? t('admin:ai_settings.notes_empty_contact', { defaultValue: 'Keine importierten Kontaktnotizen vorhanden.' })
                          : t('admin:ai_settings.notes_empty_company', { defaultValue: 'Keine importierten Firmennotizen vorhanden.' })}
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {filteredNotes.map((note: ChatNote) => {
                      const isEditing = editingNoteId === note.id_uuid;
                      const isExpanded = expandedNoteIds.includes(note.id_uuid);

                      // Map entity targets for clarity
                      let targetLabel = t('admin:ai_settings.note_target_user_admin', { defaultValue: 'Eigene Wissensdatenbank (Admin)' });
                      if (note.entity_type === 'contact' && note.entity_id) {
                        const contactObj = (contacts || []).find((c) => c.id_uuid === note.entity_id);
                        targetLabel = contactObj 
                          ? `${contactObj.first_name || ''} ${contactObj.last_name || ''}`.trim() || contactObj.email_address || ''
                          : t('admin:ai_settings.note_target_contact_id', { id: note.entity_id.slice(0, 8), defaultValue: `Kontakt (ID: ${note.entity_id.slice(0, 8)})` });
                      } else if (note.entity_type === 'company' && note.entity_id) {
                        const companyObj = (companies || []).find((c) => c.id_uuid === note.entity_id);
                        targetLabel = companyObj 
                          ? companyObj.full_legal_name 
                          : t('admin:ai_settings.note_target_company_id', { id: note.entity_id.slice(0, 8), defaultValue: `Unternehmen (ID: ${note.entity_id.slice(0, 8)})` });
                      }

                      return (
                        <div 
                          key={note.id_uuid} 
                          className="bg-primary-dark/80 border border-white/5 p-4 rounded-2xl relative overflow-hidden group hover:border-accent-orange/20 transition-all font-sans flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2 mb-2.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[9px] font-mono uppercase bg-accent-orange/10 border border-accent-orange/20 text-accent-orange px-2 py-0.5 rounded-full font-bold w-fit">
                                  {targetLabel}
                                </span>
                                {note.is_rag_indexed ? (
                                  <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-[#34d399] text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('admin:ai_settings.note_badge_rag_active_tooltip', { defaultValue: 'In RAG-Wissensdatenbank integriert' })}>
                                    <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                                    <span>{t('admin:ai_settings.note_badge_rag_active', { defaultValue: 'RAG AKTIV' })}</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" title={t('admin:ai_settings.note_badge_no_rag_tooltip', { defaultValue: 'Nicht im RAG-Vektorspeicher' })}>
                                    <span>{t('admin:ai_settings.note_badge_no_rag', { defaultValue: 'KEIN RAG' })}</span>
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] text-slate-500 font-mono">
                                {new Date(note.created_at_utc).toLocaleDateString()}
                              </span>
                            </div>

                            {isEditing ? (
                              <textarea
                                value={editingNoteContent}
                                onChange={(e) => setEditingNoteContent(e.target.value)}
                                rows={4}
                                className="w-full bg-[#0d1527] border border-accent-orange/40 rounded-xl p-3 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent-orange/25"
                              />
                            ) : (
                              <div
                                onClick={() => {
                                  if (note.content && note.content.length > 150) {
                                    setExpandedNoteIds(prev => 
                                      prev.includes(note.id_uuid) 
                                        ? prev.filter(id => id !== note.id_uuid) 
                                        : [...prev, note.id_uuid]
                                    );
                                  }
                                }}
                                className={note.content && note.content.length > 150 ? "cursor-pointer group/note select-none" : ""}
                              >
                                <p className="text-xs text-slate-300 leading-relaxed font-sans font-medium whitespace-pre-wrap">
                                  {note.content && note.content.length > 150 && !isExpanded
                                    ? `${note.content.substring(0, 150)}...`
                                    : note.content
                                  }
                                </p>
                                {note.content && note.content.length > 150 && (
                                  <div className="mt-2.5 flex items-center gap-1 text-[10px] text-accent-orange font-bold uppercase tracking-wider group-hover/note:text-accent-orange/80 transition-colors">
                                    {isExpanded ? (
                                      <>
                                        <ChevronUp size={10} /> {t('admin:ai_settings.note_show_less', { defaultValue: 'Weniger anzeigen' })}
                                      </>
                                    ) : (
                                      <>
                                        <ChevronDown size={10} /> {t('admin:ai_settings.note_show_more', { defaultValue: 'Mehr anzeigen' })}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-2.5 border-t border-white/5 flex items-center justify-between">
                            <span className="text-[9px] text-slate-500 font-mono">
                              id_uuid: {note.id_uuid.slice(0, 8)}...
                            </span>
                            
                            <div className="flex items-center gap-1.5">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!editingNoteContent.trim()) {
                                        toast.error(t('admin:toast_content_empty_error', { defaultValue: 'Inhalt darf nicht leer sein.' }));
                                        return;
                                      }
                                      editNoteMutation.mutate({
                                        id_uuid: note.id_uuid,
                                        content: editingNoteContent
                                      });
                                    }}
                                    disabled={editNoteMutation.isPending}
                                    className="p-1 px-2.5 bg-accent-blue/15 hover:bg-accent-blue/30 text-accent-blue border border-accent-blue/20 rounded-lg text-[9px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer"
                                  >
                                    <Check size={10} /> {t('admin:ai_settings.note_action_save', { defaultValue: 'Speichern' })}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingNoteId(null)}
                                    className="p-1 px-2 border border-white/5 text-slate-400 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider cursor-pointer"
                                  >
                                    {t('admin:ai_settings.note_action_cancel', { defaultValue: 'Abbrechen' })}
                                  </button>
                                </>
                              ) : (
                                <>
                                  {deletingNoteId === note.id_uuid ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[9px] text-slate-400 font-bold uppercase mr-1">{t('admin:ai_settings.confirm_delete_prompt', { defaultValue: 'Löschen?' })}</span>
                                      <button
                                        type="button"
                                        onClick={() => deleteNoteMutation.mutate({ id_uuid: note.id_uuid })}
                                        disabled={deleteNoteMutation.isPending}
                                        className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/40 text-red-400 text-[9px] font-bold transition-all cursor-pointer"
                                      >
                                        {t('admin:ai_settings.confirm_yes', { defaultValue: 'Ja' })}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeletingNoteId(null)}
                                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[9px] font-bold transition-all cursor-pointer"
                                      >
                                        {t('admin:ai_settings.confirm_no', { defaultValue: 'Nein' })}
                                      </button>
                                    </div>
                                  ) : (
                                    <>
                                      {togglingNoteRagId === note.id_uuid ? (
                                        <Loader2 size={12} className="text-amber-400 animate-spin" />
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => handleToggleNoteRag(note.id_uuid, !note.is_rag_indexed)}
                                          className={`p-1 rounded transition-colors cursor-pointer flex items-center justify-center ${
                                            note.is_rag_indexed 
                                              ? 'text-[#34d399] hover:bg-emerald-500/10' 
                                              : 'text-slate-400 hover:text-amber-400 hover:bg-amber-500/10'
                                          }`}
                                          title={note.is_rag_indexed 
                                            ? t('admin:ai_settings.note_action_remove_rag_tooltip', { defaultValue: 'Aus RAG Wissensdatenbank entfernen' }) 
                                            : t('admin:ai_settings.note_action_add_rag_tooltip', { defaultValue: 'In die RAG Wissensdatenbank aufnehmen' })
                                          }
                                        >
                                          <Sparkles size={12} />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadNote(note, targetLabel)}
                                        className="text-slate-400 hover:text-accent-blue p-1 hover:bg-accent-blue/10 rounded transition-colors cursor-pointer flex items-center justify-center"
                                        title={t('admin:ai_settings.note_action_download_tooltip', { defaultValue: 'Notiz als Markdown herunterladen' })}
                                      >
                                        <Download size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingNoteId(note.id_uuid);
                                          setEditingNoteContent(note.content);
                                        }}
                                        className="text-slate-400 hover:text-white p-1 hover:bg-white/5 rounded transition-colors cursor-pointer flex items-center justify-center"
                                        title={t('admin:ai_settings.note_action_edit_tooltip', { defaultValue: 'Notiz bearbeiten' })}
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setDeletingNoteId(note.id_uuid)}
                                        className="text-slate-400 hover:text-red-400 p-1 hover:bg-red-500/10 rounded transition-colors cursor-pointer flex items-center justify-center"
                                        title={t('admin:ai_settings.note_action_delete_tooltip', { defaultValue: 'Notiz löschen' })}
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-primary-dark/55 border border-white/5 rounded-2xl p-4 flex gap-3 text-xs text-slate-400 leading-relaxed font-sans">
        <Info className="text-accent-blue shrink-0" size={18} />
        <p>
          <strong>{t('admin:ai_settings.safety_hint_title', { defaultValue: 'Sicherheitshinweis:' })}</strong> {t('admin:ai_settings.safety_hint_desc', { defaultValue: 'Deine API-Schlüssel werden für deinen Mandanten (Tenant) hochgradig isoliert im System hinterlegt. Louis CRM AI nutzt die ReAct-Orchestrierung um alle Datenbankaktivitäten in Echtzeit zu begleiten, verwehrt der künstlichen Intelligenz jedoch jede direkte Schreibberechtigung auf Live-CRM-Daten.' })}
        </p>
      </div>

      {/* Action Button */}
      <div className="flex justify-end pt-4 border-t border-white/5">
        <button
          type="submit"
          disabled={updateMemoryMutation.isPending}
          className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[11px] tracking-widest px-6 py-3.5 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-accent-orange/20 cursor-pointer"
        >
          {updateMemoryMutation.isPending ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Save size={14} />
          )}
          {t('common:save', { defaultValue: 'Speichern' })}
        </button>
      </div>
    </form>
  );
};
