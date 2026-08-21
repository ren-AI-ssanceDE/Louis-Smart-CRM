import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Brain, 
  Sparkles, 
  AlertCircle, 
  Check, 
  X, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  User, 
  Search, 
  FileText, 
  Database,
  ArrowRight,
  RefreshCw,
  Bookmark,
  Mic,
  Square,
  Volume2,
  Paperclip,
  Loader2,
  History,
  Trash2,
  CornerDownRight,
  HelpCircle,
} from 'lucide-react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { MailDraftAttachment } from '../types';
import { trpc } from '../lib/trpc';
// C.7 (Plan 2026-08-19): Chatprofil-Selektor + Tool-Panel im Chat-Header
import { ChatProfileSelector } from '../components/chat/ChatProfileSelector';
import { toast } from 'sonner';
import { downloadFileFromUrl } from '../lib/utils';
import { ProposedChangeViewer } from '../components/ProposedChangeViewer';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thought_log?: string[];
  used_skills?: string[];
 // Phase 3 (#20): Anzahl der erinnerten Memory-Einträge (🧠-Feedback)
  memory_recall_count?: number;
  proposed_changes?: {
    entity_type: 'companies' | 'contacts' | 'invoices' | 'vault_skill' | 'emails' | 'offers' | 'note' | 'kanban_board' | 'kanban_column' | 'kanban_card';
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'SEND' | 'MOVE';
    id_uuid?: string;
    proposed_state: Record<string, unknown>;
    explanation_rational: string;
  } | null;
  timestamp_utc: string;
  metrics?: {
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  attachments?: {
    fileName: string;
    isIndexedInKnowledgeBase: boolean;
  }[];
}

/** Server response of POST /api/chat/upload (ChatUploadResponseSchema) */
interface UploadDescriptor {
  attachmentId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  isIndexedInKnowledgeBase: boolean;
  extractedCharCount: number;
  extractedTextPreview?: string;
}

interface PendingAttachment {
  file: File;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  descriptor?: UploadDescriptor;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderMessageContent(text: string, role: 'user' | 'assistant'): React.ReactNode {
  if (!text) return null;

  // Pattern matching: Either Markdown style link [Some text](url) OR raw url https://someurl...
  const combinedRegex = /(\[([^\]]+)\]\(([^)]+)\))|(https?:\/\/[^\s/$.?#].[^\s]*)/gi;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyIdx = 0;
  let match;

  const linkClass = role === 'user'
    ? "text-white underline hover:opacity-80 cursor-pointer break-all font-semibold"
    : "text-[#38bdf8] hover:text-[#38bdf8]/80 underline cursor-pointer break-all font-semibold inline-flex items-center gap-0.5";

  const handleLinkClick = (e: React.MouseEvent, url: string, label?: string) => {
    const isInternalApi = url.startsWith('/api/') || url.includes('/api/knowledge-files/') || url.includes('/api/notes/') || url.includes('/api/files/') || url.includes('/api/invoices/');
    if (isInternalApi) {
      e.preventDefault();
      e.stopPropagation();
      downloadFileFromUrl(url, label).catch(() => {
        toast.error(i18next.t('admin:files.download_error', { defaultValue: 'Fehler beim Herunterladen der Datei' }));
      });
    }
  };

  while ((match = combinedRegex.exec(text)) !== null) {
    const matchIndex = match.index;
    
    // Add text before match
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }
    
    if (match[1]) {
      // It's a markdown link: [label](url)
      const label = match[2];
      const url = match[3];
      parts.push(
        <a
          key={`md-link-${keyIdx++}`}
          href={url}
          target="_blank"
          referrerPolicy="no-referrer"
          rel="noopener noreferrer"
          className={linkClass}
          onClick={(e) => handleLinkClick(e, url, label)}
        >
          {label}
        </a>
      );
    } else {
      // It's a raw URL helper
      const url = match[4];
      // Clean up punctuation at the end of raw URL (like trailing dot, comma, parenthesis)
      let cleanedUrl = url;
      let trailing = "";
      while (cleanedUrl.length > 0 && [".", ",", ")", "]", "!"].includes(cleanedUrl[cleanedUrl.length - 1])) {
        trailing = cleanedUrl[cleanedUrl.length - 1] + trailing;
        cleanedUrl = cleanedUrl.slice(0, cleanedUrl.length - 1);
      }
      
      parts.push(
        <a
          key={`raw-link-${keyIdx++}`}
          href={cleanedUrl}
          target="_blank"
          referrerPolicy="no-referrer"
          rel="noopener noreferrer"
          className={linkClass}
          onClick={(e) => handleLinkClick(e, cleanedUrl)}
        >
          {cleanedUrl}
        </a>
      );
      if (trailing) {
        parts.push(trailing);
      }
    }
    
    lastIndex = combinedRegex.lastIndex;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return (
    <div className="whitespace-pre-wrap break-words">
      {parts.length > 0 ? parts : text}
    </div>
  );
}

export function LouisAi({ onClose }: { onClose?: () => void }) {
  const { t, i18n } = useTranslation(['common', 'louis_ai', 'louis_copilot', 'admin']);
  const utils = trpc.useContext();
  // UI-Lücke S1: ausklappbare Session-Historie direkt am Chat
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadedSessionTitle, setLoadedSessionTitle] = useState<string | undefined>(undefined);
  const deleteSessionMutation = trpc.deleteChatSession.useMutation({
    onSuccess: () => sessionsQuery.refetch()
  });

  const loadSession = async (targetSessionId: string) => {
    try {
      const hist = await utils.client.getSessionHistory.query({ sessionId: targetSessionId });
      setMessages((hist.conversation_history_json as Array<Record<string, unknown>>).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
        content: String(m.content || ''),
        timestamp_utc: String((m as Record<string, unknown>).timestamp_utc || new Date().toISOString())
      })));
      setSessionId(targetSessionId);
      setLoadedSessionTitle(hist.session_title || 'Session');
      setHistoryOpen(false);
      toast.success(t('louis_copilot:session_loaded', { defaultValue: 'Session geladen' }) + `: ${hist.session_title || '—'}`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      toast.error(t('louis_copilot:session_load_failed', { defaultValue: 'Session konnte nicht geladen werden' }) + `: ${error}`);
    }
  };

 // P2-B: Session-Verkettung — „Als Verlauf fortsetzen“ setzt die bisherige Session als parent
  const continueFromSession = async (targetSessionId: string) => {
    const previous = sessionId;
    await loadSession(targetSessionId);
    if (previous && previous !== targetSessionId) {
      setPendingParentSessionId(previous);
      toast.info(t('louis_copilot:session_continue_hint', { defaultValue: "Verknüpfe mit vorherigem Verlauf — Louis kann sich darauf beziehen." }));
    }
  };

  const handleDeleteSession = async (targetSessionId: string) => {
    try {
      await deleteSessionMutation.mutateAsync({ sessionId: targetSessionId });
      if (targetSessionId === sessionId) {
        setMessages([]);
        setSessionId(undefined);
        setLoadedSessionTitle(undefined);
      }
      toast.success(t('louis_copilot:session_deleted', { defaultValue: 'Session gelöscht.' }));
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      toast.error(t('louis_copilot:session_delete_failed', { defaultValue: 'Session konnte nicht gelöscht werden' }) + `: ${error}`);
    }
  };

  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // 2026-08-20: Das IM CHAT gewählte Chatprofil (UI-Auswahl, unabhängig von der
  // Session-Bindung) — der Wechsel startet einen neuen Chat-Kontext, keine Umbindung.
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  // Profilgebundener Verlauf (2026-08-19): Der Verlauf zeigt nur Sessions des AKTIVEN
  // Chatprofils (eigene Session-DB pro Profil). Anker: Bindung der aktuellen
  // Session, sonst das Default-Profil (bzw. Main).
  const sessionProfileQuery = trpc.getSessionProfileInfo.useQuery({ session_id: sessionId }, { enabled: !!sessionId });
  const chatProfilesQuery = trpc.listChatProfiles.useQuery(undefined, { enabled: !sessionId });
  // Verlauf-Anker (2026-08-20): 1. die UI-Auswahl (selectedProfileId), 2. die
  // Bindung der aktiven Session, 3. das Default-Profil (bzw. Main).
  const activeProfileId = selectedProfileId
    ?? (sessionId ? (sessionProfileQuery.data as { profile_id?: string } | undefined)?.profile_id : undefined)
    ?? (((chatProfilesQuery.data || []) as Array<{ id_uuid: string; is_default?: boolean; is_system?: boolean }>).find((p) => p.is_default)?.id_uuid
      || ((chatProfilesQuery.data || []) as Array<{ id_uuid: string; is_system?: boolean }>).find((p) => p.is_system)?.id_uuid);
  const sessionsQuery = trpc.listSessions.useQuery({ profile_id: activeProfileId }, { enabled: historyOpen });
  // (2026-08-19): Warm Resume — beim Öffnen die letzte Session laden,
  // falls noch keine aktiv ist (die letzte Session wird wiederhergestellt).
  const lastSessionQuery = trpc.getLastSession.useQuery(undefined, { enabled: !sessionId });
  // 2026-08-20: Warm Resume NUR beim ersten Öffnen (die letzte Session wird nur beim Start wiederhergestellt).
  // Nach einem PROFILWECHSEL darf die letzte Session NICHT erneut geladen werden — der Wechsel
  // ist ein NEUER Kontext (leeres Fenster).
  const warmResumeDone = useRef(false);
  useEffect(() => {
    if (warmResumeDone.current) return;
    if (!sessionId && lastSessionQuery.data) {
      warmResumeDone.current = true;
      void loadSession(lastSessionQuery.data.id_uuid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, lastSessionQuery.data]);
 // P2-B: bisherige Session als parent beim nächsten sendMessage (nur 1x)
  const [pendingParentSessionId, setPendingParentSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showThoughts, setShowThoughts] = useState<Record<number, boolean>>({});
 // P0-B: Kompressions-Anzeige (Louis komprimiert gerade den Verlauf)
  const [compressionNotice, setCompressionNotice] = useState<'in_progress' | 'done' | null>(null);

 // P2-A: Skill-Suggestions (Backend-Event → Chat-Karte)
  const skillSuggestionsQuery = trpc.listSkillSuggestions.useQuery(undefined, { enabled: true });
  const dismissSuggestionMutation = trpc.dismissSkillSuggestion.useMutation({
    onSuccess: () => skillSuggestionsQuery.refetch()
  });
  const applySuggestionMutation = trpc.applySkillSuggestion.useMutation({
    onSuccess: (data) => {
      skillSuggestionsQuery.refetch();
      if (data.proposedChanges) {
        // Vorschlag direkt in den Freigabe-Flow übernehmen (proposedChanges)
        handleApprove(data.proposedChanges as NonNullable<Message['proposed_changes']>);
      } else {
        toast.info(t('louis_copilot:skill_suggestion_applied', { defaultValue: "Skill-Vorschlag zur Freigabe vorbereitet." }));
      }
    }
  });

 // P2-C: Offene Rückfragen (ask_user_question) inline im Chat
  const openQuestionsQuery = trpc.listOpenQuestionsForChat.useQuery(undefined, { enabled: true });
  const answerQuestionMutation = trpc.answerQuestionForChat.useMutation({
    onSuccess: () => openQuestionsQuery.refetch()
  });

  // STT Recording & Transcribing States
  const [isRecording, setIsRecording] = useState(false);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/ogg; codecs=opus' });
        await sendAudioToSTT(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      setAudioChunks([]);
      setRecordingTime(0);
      setIsRecording(true);
      
      mediaRecorder.start();

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

    } catch (err) {
      console.error("Failed to start recording:", err);
      toast.error(t('louis_copilot:mic_permission_failed', { defaultValue: "Mikrofon-Zugriff verweigert oder nicht verfügbar." }));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const sendAudioToSTT = async (blob: Blob) => {
    setIsTranscribing(true);
    const formData = new FormData();
    formData.append("file", blob, "voice_recording.ogg");

    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: "Transkription fehlgeschlagen" }));
        throw new Error(errJson.error || "Server response error");
      }

      const data = await response.json();
      if (data && data.text) {
        setInputText(prev => prev ? prev + " " + data.text : data.text);
        toast.success(t('louis_copilot:stt_success', { defaultValue: "Sprachnotiz erfolgreich transkribiert!" }));
      } else {
        toast.error(t('louis_copilot:stt_empty_text', { defaultValue: "Es konnte kein Text erkannt werden." }));
      }
    } catch (err) {
      console.error("STT Error:", err);
      toast.error(t('louis_copilot:stt_failed_toast', { defaultValue: "Transkription fehlgeschlagen. Bitte prüfen Sie Ihre STT-Einstellungen." }));
    } finally {
      setIsTranscribing(false);
    }
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  const [isPending, setIsPending] = useState(false);
 // P2 (#53-UI): laufende Subtasks im Thought-Log abbrechen (Polling nur während einer Antwort)
  const runningSubtasksQuery = trpc.listRunningSubtasks.useQuery(undefined, { refetchInterval: isPending ? 5000 : false });
  const abortSubtaskMutation = trpc.abortRunningSubtask.useMutation({
    onSuccess: () => { void runningSubtasksQuery.refetch(); }
  });
  const abortControllerRef = useRef<AbortController | null>(null);

  // File attachment states (chat upload)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [selectedFileForUpload, setSelectedFileForUpload] = useState<File | null>(null);
  const [uploadIndexFlag, setUploadIndexFlag] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (pendingAttachments.length >= 5) {
      toast.error(t('louis_copilot:attach_limit_reached', { defaultValue: 'Maximal 5 Dateien pro Nachricht.' }));
      return;
    }
    setSelectedFileForUpload(file);
    setUploadIndexFlag(false);
    setShowUploadDialog(true);
  };

  const confirmUpload = async () => {
    if (!selectedFileForUpload || isUploading) return;
    const file = selectedFileForUpload;
    const indexFlag = uploadIndexFlag;
    setSelectedFileForUpload(null);
    setShowUploadDialog(false);
    setPendingAttachments(prev => [...prev, { file, status: 'uploading' }]);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('indexInKnowledgeBase', String(indexFlag));
      const response = await fetch("/api/chat/upload", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ error: "Upload fehlgeschlagen" }));
        throw new Error(errJson.error || "Upload fehlgeschlagen");
      }
      const descriptor = await response.json() as UploadDescriptor;
      setPendingAttachments(prev => prev.map(a => a.file === file ? { ...a, status: 'done', descriptor } : a));
      if (descriptor.isIndexedInKnowledgeBase) {
        utils.getKnowledgeFiles.invalidate().catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setPendingAttachments(prev => prev.map(a => a.file === file ? { ...a, status: 'error', error: errorMsg } : a));
      toast.error(t('louis_copilot:attach_upload_failed', { error: errorMsg, defaultValue: `Upload fehlgeschlagen: ${errorMsg}` }));
    } finally {
      setIsUploading(false);
    }
  };

  const removePendingAttachment = (idx: number) => {
    setPendingAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const [showNoteModal, setShowNoteModal] = useState(false);
  const [suggestedNote, setSuggestedNote] = useState<{
    entity_type: 'user' | 'company' | 'contact';
    entity_id?: string;
    content: string;
  } | null>(null);

  // Load contacts and companies for memory target selectors
  const { data: contacts = [] } = trpc.getContacts.useQuery();
  const { data: companies = [] } = trpc.getCompanies.useQuery();

  const saveNoteMutation = trpc.saveNoteToEntity.useMutation({
    onSuccess: () => {
      toast.success(t('louis_copilot:note_saved_success', { defaultValue: "Kurzzeit-Notiz gespeichert & im Langzeitgedächtnis indiziert!" }));
      setShowNoteModal(false);
      setSuggestedNote(null);
      // Invalidate queries so that updated listings reflect instantly in local views
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
    },
    onError: (err) => {
      toast.error(t('louis_copilot:note_save_failed', { defaultValue: "Fehler beim Sichern der Notiz: " }) + err.message);
    }
  });

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsPending(false);
    toast.info(t('louis_copilot:generation_cancelled', { defaultValue: "Antwortgenerierung abgebrochen." }));

    // Add visual indicator of aborted request
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: `❌ *[${t('louis_copilot:generation_aborted', { defaultValue: "Anfrage abgebrochen" })}]*`,
        timestamp_utc: new Date().toISOString()
      }
    ]);
  };

  // Queries & Mutations
  const approveMutation = trpc.approveProposal.useMutation({
    onSuccess: (data, variables) => {
      if (!variables) return;
      toast.success(t('louis_copilot:proposal_approved_success', { defaultValue: "Änderungen erfolgreich in die Live-Datenbank übernommen!" }));
      
      // Invalidate queries so that updated listings reflect instantly in local views
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      utils.getInvoices.invalidate();

      // Open suggested note dialog
      let entity_type: 'user' | 'contact' | 'company' = 'user';
      let entity_id: string | undefined = undefined;
      let content = variables.explanation_rational || (
        variables.entity_type === 'companies' 
          ? t('louis_copilot:company_approved_fallback', { defaultValue: 'Unternehmen über LOUIS AI erfolgreich freigegeben.' }) 
          : t('louis_copilot:contact_approved_fallback', { defaultValue: 'Kontakt über LOUIS AI erfolgreich freigegeben.' })
      );

      if (variables.entity_type === 'companies') {
        entity_type = 'company';
        entity_id = data.appliedId || variables.id_uuid;
      } else if (variables.entity_type === 'contacts') {
        entity_type = 'contact';
        entity_id = data.appliedId || variables.id_uuid;
      } else if (variables.entity_type === 'emails' && variables.proposed_state) {
        const pState = variables.proposed_state as { recipient_email_address?: string; recipient?: string; email_subject_text?: string; email_body_content?: string };
        const recipient = String(pState.recipient_email_address || pState.recipient || "").trim().toLowerCase();
        
        // Clean any recipient name brackets to get the raw email
        const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient;

        // Try to find a matching contact by email
        const matchedContact = contacts.find(c => 
          c.email_address?.toLowerCase() === cleanRecipient ||
          c.email_2?.toLowerCase() === cleanRecipient
        );
        
        if (matchedContact) {
          entity_type = 'contact';
          entity_id = matchedContact.id_uuid;
        } else {
          // Try to find a matching company by email
          const matchedCompany = companies.find(co => 
            co.email_address?.toLowerCase() === cleanRecipient ||
            co.email_2?.toLowerCase() === cleanRecipient
          );
          if (matchedCompany) {
            entity_type = 'company';
            entity_id = matchedCompany.id_uuid;
          }
        }
        
        // Use the actual email text / subject as note content
        const subject = pState.email_subject_text || '';
        let body = pState.email_body_content || '';
        
        // Clean HTML tags and br tags a bit for beautiful Markdown presentation
        body = body.replace(/<br\s*\/?>/gi, '\n');
        body = body.replace(/<\/?[^>]+(>|$)/g, ""); // Strip out other HTML tags
        
        content = `**Betreff:** ${subject}\n\n${body}`;
      }

      setSuggestedNote({
        entity_type,
        entity_id,
        content
      });
      setShowNoteModal(true);

      // Update message proposed_changes state to show approved check
      setMessages(prev => prev.map(msg => {
        if (msg.proposed_changes && msg.proposed_changes.proposed_state === variables.proposed_state) {
          return {
            ...msg,
            proposed_changes: null, // Clear panel on success or mark as done
            content: msg.content + `\n\n✅ *[${t('louis_copilot:approved', { defaultValue: 'Freigegeben' })}] ${variables.explanation_rational}*`
          };
        }
        return msg;
      }));
    },
    onError: (err) => {
      toast.error(t('louis_copilot:approval_failed', { defaultValue: `Freigabe fehlgeschlagen: ` }) + err.message);
    }
  });

  const handleSend = async () => {
    if (isPending) return;
    const readyAttachments = pendingAttachments.filter(a => a.status === 'done' && a.descriptor);
    const trimmed = inputText.trim();
    if (!trimmed && readyAttachments.length === 0) return;
    if (pendingAttachments.some(a => a.status === 'uploading')) return;

    // Default prompt when only files are attached (e.g. "search in this file")
    // Fix: fehlgeschlagene Uploads dem Agenten als Kontext mitgeben,
    // damit er die Ablehnung ehrlich meldet statt Datei-Inhalte zu erfinden.
    const failedAttachments = pendingAttachments.filter(a => a.status === 'error');
    const failedNote = failedAttachments.length > 0
      ? `\n\n[Hinweis des Systems: ${failedAttachments.length} angehängte Datei(en) konnten nicht hochgeladen werden (${failedAttachments.map(a => a.file.name).join(', ')}). Format nicht unterstützt oder Datei zu groß. Erwähne das ehrlich in deiner Antwort und erfinde keinen Datei-Inhalt.]`
      : '';
    const userMsg = (trimmed || (readyAttachments.length > 0
      ? t('louis_copilot:attach_default_message', { defaultValue: 'Bitte analysiere die angehängten Dateien.' })
      : '')) + failedNote;
    setInputText('');

    const attachmentRefs = readyAttachments.map(a => ({
      attachmentId: a.descriptor!.attachmentId,
      fileName: a.descriptor!.fileName,
      isIndexedInKnowledgeBase: a.descriptor!.isIndexedInKnowledgeBase
    }));

    // Add user message to state (with attachment chips).
 // P0 (B1): Timestamp-Marker für die Bubble — bei compressionInProgress
    // wird genau DIESE Bubble wieder entfernt (nicht slice(0,-1), das wäre bei
    // parallelen State-Updates unsicher).
    const userBubbleTimestamp = new Date().toISOString();
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: userMsg,
        timestamp_utc: userBubbleTimestamp,
        attachments: attachmentRefs.map(a => ({ fileName: a.fileName, isIndexedInKnowledgeBase: a.isIndexedInKnowledgeBase }))
      }
    ]);

    // Chips are consumed into the bubble; start fresh for the next message
    setPendingAttachments([]);

    setIsPending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resultObj = await utils.client.sendMessage.mutate({
        message: userMsg,
        sessionId,
        language: i18n.language,
        attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
 // P2-B: Lineage — beim ersten sendMessage nach „Als Verlauf fortsetzen“
        parentSessionId: pendingParentSessionId,
        // 2026-08-20: Das im Chat gewählte Profil — die NEUE Session wird daran gebunden
        chat_profile_id: selectedProfileId
      }, {
        signal: controller.signal
      });

 // P2-B: parent nur einmal setzen
      if (pendingParentSessionId) {
        setPendingParentSessionId(undefined);
      }

      if (resultObj.sessionId) {
        setSessionId(resultObj.sessionId);
      }

 // P0-B: Louis komprimiert gerade den Verlauf → Hinweis anzeigen,
      // Nachricht NICHT als Antwort hängen (Server hat sie nicht verarbeitet).
 // P0 (B1): die eben hinzugefügte User-Bubble wieder entfernen,
      // sonst steht die Nachricht doppelt (Bubble + Eingabefeld) beim erneuten Senden.
      if (resultObj.compressionInProgress) {
        setMessages(prev => prev.filter(m => !(m.role === 'user' && m.timestamp_utc === userBubbleTimestamp)));
        setCompressionNotice('in_progress');
        setInputText(userMsg);
        return;
      }
      if (compressionNotice !== null) {
        setCompressionNotice('done');
        setTimeout(() => setCompressionNotice(null), 4000);
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: resultObj.replyText,
          thought_log: resultObj.thoughtLog,
          used_skills: resultObj.usedSkills,
          memory_recall_count: resultObj.memoryRecallCount,
          proposed_changes: resultObj.proposedChanges,
          timestamp_utc: new Date().toISOString(),
          metrics: resultObj.metrics
        }
      ]);

      // Invalidate queries so any automatically created drafts show up immediately
      utils.getCompanies.invalidate();
      utils.getContacts.invalidate();
      utils.getInvoices.invalidate();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.name === 'AbortError' || error.message?.includes('abort') || error.message?.includes('Abort')) {
        console.log('Fetch request aborted.');
      } else {
        toast.error(t('louis_copilot:error_sending_message', { error: error.message, defaultValue: `Fehler beim Senden: ${error.message}` }));
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsPending(false);
    }
  };

  const handleApprove = (proposal: NonNullable<Message['proposed_changes']>) => {
    approveMutation.mutate({
      entity_type: proposal.entity_type,
      action: proposal.action,
      id_uuid: proposal.id_uuid,
      proposed_state: proposal.proposed_state,
      explanation_rational: proposal.explanation_rational
    });
  };

  const handleDecline = (index: number) => {
    toast.info(t('louis_copilot:proposal_declined', { defaultValue: "Vorschlag abgelehnt." }));
    setMessages(prev => prev.map((msg, idx) => {
      if (idx === index) {
        return {
          ...msg,
          proposed_changes: null,
          content: msg.content + `\n\n❌ *[${t('louis_copilot:declined', { defaultValue: 'Abgelehnt' })}]*`
        };
      }
      return msg;
    }));
  };

  const toggleThoughts = (index: number) => {
    setShowThoughts(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPending]);

  return (
    <div className="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Header */}
      <div className="p-6 bg-primary-dark/80 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent-orange to-accent-blue/80 flex items-center justify-center shadow-lg relative glow-orange">
            <Brain className="text-white w-6 h-6 animate-pulse" />
            <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-primary-dark shadow-[0_0_8px_#10b981]" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-wide text-white font-display uppercase italic">{t('louis_copilot:title_brand', { defaultValue: 'Louis' })}</h2>
            {loadedSessionTitle && (
              <p className="text-[10px] text-accent-orange font-bold mt-0.5 truncate max-w-[220px]" title={loadedSessionTitle}>
                {t('louis_copilot:session_active', { defaultValue: "Aktiv" })}: {loadedSessionTitle}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* C.7 + 2026-08-20: Profilwechsel = NEUER Chat-Kontext (keine Umbindung!) —
              die aktive Session bleibt beim alten Profil, der nächste sendMessage erstellt
              eine neue Session im gewählten Profil */}
          <ChatProfileSelector
            sessionId={sessionId}
            selectedProfileId={selectedProfileId}
            onProfileSwitched={(profileId) => {
              setSelectedProfileId(profileId);
              setSessionId(undefined);
              // 2026-08-20: KOMPLETTER Reset des Chatfensters (neuer Konversationskontext) —
              // Session-Titel + Nachrichten leeren, sonst bleibt „Aktiv: <alte Session>“ stehen
              setLoadedSessionTitle(undefined);
              setMessages([]);
              setHistoryOpen(false);
            }}
          />
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all ${historyOpen ? "border-accent-orange/40 text-accent-orange bg-white/5" : "border-white/5 text-slate-400 hover:text-white hover:bg-white/5"}`}
            title={t('louis_copilot:chat_history', { defaultValue: "Verlauf" })}
          >
            <History size={12} />
            {t('louis_copilot:chat_history', { defaultValue: "Verlauf" })}
          </button>
          {/* 2026-08-20: „Neu starten“ = NEUER Chat im aktiven Profil — der bisherige
              Chat bleibt in der DB + im Verlauf erhalten (KEIN Löschen!) */}
          <button
            onClick={() => {
              setMessages([]);
              setSessionId(undefined);
              setLoadedSessionTitle(undefined);
              toast.success(t('louis_copilot:chat_reset', { defaultValue: "Neuer Chat gestartet" }));
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/5 text-xs text-slate-400 hover:text-white hover:bg-white/5 transition-all font-bold uppercase tracking-wider"
          >
            <RefreshCw size={12} />
            {t('louis_copilot:new_chat', { defaultValue: "Neu starten" })}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl border border-white/5 text-slate-400 hover:text-white hover:bg-white/5 transition-all flex items-center justify-center cursor-pointer"
              title={t('louis_copilot:close', { defaultValue: "Schließen" })}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Session-Historie (ausklappbar, direkt am Chat) */}
      {historyOpen && (
        <div className="border-b border-white/5 bg-primary-dark/95 max-h-72 overflow-y-auto no-scrollbar">
          <div className="p-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-black uppercase tracking-widest text-white">
                {t('louis_copilot:chat_history_title', { defaultValue: "Verlauf" })} ({sessionsQuery.data?.length ?? 0})
              </h3>
            </div>
            {sessionsQuery.isLoading && <p className="text-xs text-slate-400">Lade Sessions…</p>}
            {(sessionsQuery.data ?? []).map((s) => (
              <div key={s.id_uuid} className="group flex items-center justify-between gap-2 rounded-xl border border-white/5 hover:border-accent-orange/30 bg-primary-light/40 px-3 py-2">
                <button onClick={() => loadSession(s.id_uuid)} className="flex-1 text-left min-w-0">
                  <div className="text-sm font-bold text-white truncate">{s.session_title || t('louis_copilot:session_untitled', { defaultValue: "Ohne Titel" })}</div>
                  <div className="text-[10px] text-slate-500">
                    {s.updated_at_utc ? new Date(s.updated_at_utc).toLocaleString('de-DE') : '—'} · {s.message_count} {t('louis_copilot:session_messages', { defaultValue: "Nachrichten" })}
                  </div>
                </button>
                <button
 // P2-B: Session-Verkettung (Lineage) — nur bei einer anderen Session als der aktiven sinnvoll
                  onClick={() => continueFromSession(s.id_uuid)}
                  className="opacity-40 group-hover:opacity-100 text-slate-400 hover:text-accent-blue transition-all p-1"
                  title={t('louis_copilot:session_continue', { defaultValue: "Als Verlauf fortsetzen (verknüpft mit vorheriger Session)" })}
                >
                  <CornerDownRight size={13} />
                </button>
                <button
                  onClick={() => handleDeleteSession(s.id_uuid)}
                  className="opacity-40 group-hover:opacity-100 text-slate-400 hover:text-red-400 transition-all p-1"
                  title={t('louis_copilot:session_delete', { defaultValue: "Session löschen" })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!sessionsQuery.isLoading && (sessionsQuery.data ?? []).length === 0 && (
              <p className="text-xs text-slate-500">{t('louis_copilot:no_sessions', { defaultValue: "Noch keine Sessions vorhanden." })}</p>
            )}
          </div>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar bg-primary-dark/30">
        {/* P2-C: Offene Rückfragen mit klickbaren Chips */}
        {(openQuestionsQuery.data ?? []).length > 0 && (
          <div className="space-y-3">
            {(openQuestionsQuery.data ?? []).map((q) => {
              let choices: string[] = [];
              try {
                const parsed = JSON.parse(q.choices_json || "[]");
                choices = Array.isArray(parsed) ? parsed : [];
              } catch {
                choices = [];
              }
              return (
                <div key={q.id_uuid} data-testid="open-question-card" className="bg-gradient-to-tr from-accent-blue/10 to-accent-orange/5 border border-accent-blue/30 rounded-2xl p-4 shadow-xl">
                  <div className="flex items-center gap-2">
                    <HelpCircle size={14} className="text-accent-blue shrink-0" />
                    <span className="text-xs font-black uppercase tracking-widest text-accent-blue font-display">
                      {t('louis_copilot:open_question_title', { defaultValue: "❓ Louis wartet auf deine Antwort" })}
                    </span>
                  </div>
                  <p className="text-sm font-bold text-white mt-1.5">{q.question}</p>
                  {choices.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {choices.map((choice) => (
                        <button
                          key={choice}
                          data-testid="open-question-chip"
                          onClick={() => answerQuestionMutation.mutate({ question_id: q.id_uuid, answer: choice })}
                          disabled={answerQuestionMutation.isPending}
                          className="px-3 py-1.5 bg-accent-blue/10 border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50"
                        >
                          {choice}
                        </button>
                      ))}
                    </div>
                  )}
                  {choices.length === 0 && (
                    <input
                      data-testid="open-question-input"
                      placeholder={t('louis_copilot:open_question_placeholder', { defaultValue: "Antwort eingeben…" })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                          answerQuestionMutation.mutate({ question_id: q.id_uuid, answer: (e.target as HTMLInputElement).value.trim() });
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                      className="mt-3 w-full bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* P2-A: Skill-Suggestion-Karten (offene Vorschläge) */}
        {(skillSuggestionsQuery.data ?? []).length > 0 && (
          <div className="space-y-3">
            {(skillSuggestionsQuery.data ?? []).map((sug) => (
              <div key={sug.id_uuid} data-testid="skill-suggestion-card" className="bg-gradient-to-tr from-accent-orange/10 to-accent-blue/5 border border-accent-orange/30 rounded-2xl p-4 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-accent-orange shrink-0" />
                      <span className="text-xs font-black uppercase tracking-widest text-accent-orange font-display">
                        {t('louis_copilot:skill_suggestion_title', { defaultValue: "💡 Louis schlägt einen Skill vor" })}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white mt-1.5">{sug.workflow_name}</p>
                    <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{sug.workflow_description}</p>
                    {(sug.skill_tags || []).length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                        {sug.skill_tags.slice(0, 5).map((tag) => (
                          <span key={tag} className="text-[9px] font-mono bg-accent-orange/10 border border-accent-orange/20 text-accent-orange px-1.5 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      data-testid="skill-suggestion-apply"
                      onClick={() => applySuggestionMutation.mutate({ id_uuid: sug.id_uuid })}
                      disabled={applySuggestionMutation.isPending}
                      className="px-3 py-1.5 bg-accent-orange hover:bg-accent-orange/80 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {t('louis_copilot:skill_suggestion_save', { defaultValue: "Als Skill speichern" })}
                    </button>
                    <button
                      data-testid="skill-suggestion-dismiss"
                      onClick={() => dismissSuggestionMutation.mutate({ id_uuid: sug.id_uuid })}
                      disabled={dismissSuggestionMutation.isPending}
                      className="px-3 py-1.5 border border-white/10 text-slate-400 hover:text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50"
                    >
                      {t('louis_copilot:skill_suggestion_dismiss', { defaultValue: "Verwerfen" })}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-lg mx-auto space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-black tracking-wide text-white uppercase italic">
                {t('louis_copilot:welcome_title', { defaultValue: "Willkommen bei LOUIS AI" })}
              </h3>
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                {t('louis_copilot:welcome_text', { defaultValue: "Ich bin dein multilingualer CRM-Entwicklungs-Agent. Du kannst mich nach CRM-Analysen fragen (z.B. Umsatzberichte), Informationen im Web recherchieren lassen oder Datenänderungen beauftragen, die ich dir als verifizierbaren Entwurf vorbereite." })}
              </p>
            </div>
            <div className="w-full grid grid-cols-2 gap-3 text-left">
              {[
                { label: t('louis_copilot:demo_q1', { defaultValue: "Erstelle einen neuen Kontakt Marc Schmidt für die Muster GmbH" }), text: "Erstelle einen neuen Kontakt Marc Schmidt für die Muster GmbH" },
                { label: t('louis_copilot:demo_q2', { defaultValue: "Zeige mir eine finanzielle Übersicht offener Rechnungen" }), text: "Zeige mit eine finanzielle Übersicht aller offener Rechnungen" },
                { label: t('louis_copilot:demo_q3', { defaultValue: "Recherchiere die aktuellen E-Rechnungs-Vorgaben in Europa" }), text: "Wie sind die aktuellen E-Rechnungsvorgaben in Europa?" },
                { label: t('louis_copilot:demo_q4', { defaultValue: "Erstelle ein neues Unternehmen Bäcker Müller in Berlin" }), text: "Erstelle ein neues Unternehmen Bäcker Müller in Berlin" }
              ].map((demo, idx) => (
                <button
                  key={idx}
                  onClick={() => setInputText(demo.text)}
                  className="p-3 text-xs text-slate-300 font-bold tracking-wide rounded-2xl bg-primary-light/50 border border-white/5 hover:border-accent-orange/30 hover:bg-primary-light transition-all text-left truncate"
                >
                  {demo.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-start gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role !== 'user' && (
              <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-tr from-accent-orange to-accent-blue/80 flex items-center justify-center font-bold text-white shadow-md relative">
                <Brain className="w-4 h-4 text-white" />
              </div>
            )}

            <div className={`flex flex-col max-w-xl ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div 
                className={`p-4 rounded-3xl text-sm font-medium leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-accent-orange text-white rounded-tr-none' 
                    : 'bg-primary-light border border-white/5 text-slate-200 rounded-tl-none font-sans'
                }`}
              >
                {msg.role === 'user' && msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {msg.attachments.map((att, ai) => (
                      <span
                        key={ai}
                        className="flex items-center gap-1.5 bg-white/15 border border-white/20 rounded-lg px-2 py-1 text-[10px] font-bold"
                        title={att.fileName}
                      >
                        <FileText size={10} className="shrink-0" />
                        <span className="max-w-[160px] truncate">{att.fileName}</span>
                        {att.isIndexedInKnowledgeBase && (
                          <span className="flex items-center gap-0.5 text-emerald-200" title={t('louis_copilot:attach_indexed_badge', { defaultValue: 'In Wissensdatenbank indiziert' })}>
                            <Database size={10} />
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
                {renderMessageContent(msg.content, msg.role)}
              </div>

              {/* Timestamp & Metrics */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1 px-1">
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(msg.timestamp_utc).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
                </span>
                
                {msg.role === 'assistant' && msg.metrics && (
                  <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 bg-white/5 border border-white/5 px-2 py-0.5 rounded-full select-none">
                    <span className="flex items-center gap-1">
                      <Clock size={10} className="text-accent-orange animate-pulse" />
                      <span>{(msg.metrics.durationMs / 1000).toFixed(2)}s</span>
                    </span>
                    <span className="w-[1px] h-2 bg-white/10" />
                    <span className="flex items-center gap-1">
                      <Brain size={10} className="text-accent-blue" />
                      <span>{msg.metrics.totalTokens.toLocaleString(i18n.language)} Tokens</span>
                    </span>
                    <span className="text-[9px] text-slate-500 hidden sm:inline">
                      (In: {msg.metrics.inputTokens.toLocaleString(i18n.language)} • Out: {msg.metrics.outputTokens.toLocaleString(i18n.language)})
                    </span>
                  </div>
                )}

                {msg.role === 'assistant' && msg.used_skills && msg.used_skills.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap text-[9px] font-mono">
                    <span className="text-slate-500">{t('louis_copilot:used_skills_label', { defaultValue: "Skills:" })}</span>
                    {msg.used_skills.map((skill) => (
                      <span key={skill} className="bg-accent-orange/10 border border-accent-orange/20 text-accent-orange px-1.5 py-0.5 rounded-full">
                        {skill}
                      </span>
                    ))}
                  </div>
                )}

                {/* Phase 3 (#20): Recall-Status — sichtbares Memory-Feedback */}
                {msg.role === 'assistant' && (msg.memory_recall_count ?? 0) > 0 && (
                  <div className="flex items-center gap-1 text-[9px] font-mono text-slate-400 bg-accent-blue/5 border border-accent-blue/10 px-2 py-0.5 rounded-full select-none">
                    <span>🧠</span>
                    <span>{t('louis_copilot:memory_recall_label', { defaultValue: 'erinnert an' })} {msg.memory_recall_count} {t('louis_copilot:memory_recall_entries', { defaultValue: 'Einträge' })}</span>
                  </div>
                )}

                {msg.role === 'assistant' && (
                  <button
                    onClick={() => {
                      setSuggestedNote({
                        entity_type: 'user',
                        content: msg.content,
                      });
                      setShowNoteModal(true);
                    }}
                    className="flex items-center gap-1 bg-accent-orange/10 border border-accent-orange/20 text-accent-orange hover:bg-accent-orange/25 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider select-none cursor-pointer transition-all active:scale-95 duration-200"
                    title={t('louis_copilot:save_to_longterm', { defaultValue: 'In das Langzeitgedächtnis übernehmen' })}
                  >
                    <Bookmark size={9} />
                    <span>{t('louis_copilot:longterm_memory', { defaultValue: 'Langzeitgedächtnis' })}</span>
                  </button>
                )}
              </div>

              {/* Thought log rendering */}
              {msg.thought_log && msg.thought_log.length > 0 && (
                <div className="mt-2 w-full">
                  <button
                    onClick={() => toggleThoughts(i)}
                    className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-all bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/5"
                  >
                    <Clock size={12} className="text-accent-orange animate-spin" />
                    <span>{showThoughts[i] ? t('louis_copilot:hide_thinking', { defaultValue: "Denk-Prozess ausblenden" }) : t('louis_copilot:show_thinking', { defaultValue: "Louis Denk-Schritte einblenden" })}</span>
                    {showThoughts[i] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>

                  <AnimatePresence>
                    {showThoughts[i] && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden mt-2 bg-primary-dark/80 rounded-2xl border border-white/5 p-4 space-y-2 font-mono text-xs text-slate-300"
                      >
                        <div className="flex items-center gap-2 border-b border-white/5 pb-2 mb-2">
                          <Database className="w-3.5 h-3.5 text-accent-blue" />
                          <span className="text-xs uppercase font-black text-slate-400 tracking-wider">{t('louis_copilot:multi_agent_log', { defaultValue: 'Multi-Agent State Log' })}</span>
                        </div>
                        {/* P2 (#53-UI): laufende Sub-Agenten abbrechen */}
                        {(runningSubtasksQuery.data?.subtask_ids ?? []).length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 pb-2 mb-2 border-b border-white/5">
                            <span className="text-[10px] uppercase font-black text-amber-400 tracking-wider">
                              {t('louis_copilot:running_subtasks', { defaultValue: '⏳ Laufende Sub-Agenten' })}
                            </span>
                            {(runningSubtasksQuery.data?.subtask_ids ?? []).map((sid) => (
                              <button
                                key={sid}
                                type="button"
                                data-testid={`abort-subtask-${sid}`}
                                onClick={() => abortSubtaskMutation.mutate({ subtask_id: sid })}
                                disabled={abortSubtaskMutation.isPending}
                                className="text-[10px] font-mono bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/20 px-2 py-1 rounded-lg cursor-pointer disabled:opacity-50"
                              >
                                ⏹ {sid} {t('louis_copilot:abort_subtask', { defaultValue: 'abbrechen' })}
                              </button>
                            ))}
                          </div>
                        )}
                        {msg.thought_log.map((thought, idx) => {
                          const isTool = thought.includes("Executing tool") || thought.includes("Tool");
                          const isSuccess = thought.includes("Success");
                          return (
                            <div key={idx} className="flex items-start gap-1.5 leading-relaxed">
                              <span className="text-accent-orange shrink-0">&gt;</span>
                              <span className={isTool ? 'text-accent-blue font-bold' : isSuccess ? 'text-emerald-400 font-bold' : 'text-slate-300'}>
                                {thought}
                              </span>
                            </div>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Zero-Direct-Write Proposed CRM Diff Approval Panel */}
              {msg.proposed_changes && (
                <div className="mt-4 w-full bg-primary-dark border border-accent-orange/30 rounded-2xl p-5 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-accent-orange/5 blur-xl rounded-full" />
                  
                  <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent-orange" />
                      <span className="text-xs font-black uppercase text-white tracking-widest font-display italic">
                        {t('louis_copilot:props_review_title', { defaultValue: "GoBD Freigabe-Entwurf" })}
                      </span>
                    </div>
                    <div className="bg-accent-orange/10 border border-accent-orange/30 text-accent-orange text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest">
                      {msg.proposed_changes.action}
                    </div>
                  </div>

                  {/* Rational */}
                  <p className="text-xs text-slate-400 mb-3 italic">
                    💡 "{msg.proposed_changes.explanation_rational}"
                  </p>

                  {/* Visual Diff Rendering */}
                  <div className="bg-primary-light/60 border border-white/5 p-4 rounded-xl mb-4 text-slate-200">
                    <ProposedChangeViewer
                      entityType={msg.proposed_changes.entity_type}
                      action={msg.proposed_changes.action}
                      proposedState={msg.proposed_changes.proposed_state}
                    />
                  </div>

                  {/* Approve / Decline Buttons */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleApprove(msg.proposed_changes)}
                      disabled={approveMutation.isPending}
                      className="flex-1 bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg hover:shadow-emerald-500/10 transition-all disabled:opacity-50"
                    >
                      {approveMutation.isPending && <RefreshCw size={12} className="animate-spin" />}
                      {!approveMutation.isPending && <Check size={14} />}
                      {t('louis_copilot:approve', { defaultValue: "Freigeben (Einfügen)" })}
                    </button>
                    <button
                      onClick={() => handleDecline(i)}
                      disabled={approveMutation.isPending}
                      className="px-4 py-2.5 rounded-xl border border-white/5 hover:border-red-500/20 text-red-400 hover:bg-red-500/10 font-bold text-xs uppercase transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <X size={14} />
                      {t('louis_copilot:decline', { defaultValue: "Ablehnen" })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {isPending && (
          <div className="flex flex-col gap-2 items-start">
            <div className="flex items-center gap-4">
              <div className="shrink-0 w-8 h-8 rounded-xl bg-gradient-to-tr from-accent-orange to-accent-blue/80 flex items-center justify-center shadow-md relative animate-pulse">
                <Brain className="w-4 h-4 text-white animate-spin" />
              </div>
              <div className="bg-primary-light border border-white/5 p-4 rounded-3xl rounded-tl-none max-w-sm flex items-center gap-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-accent-orange rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-accent-blue rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-2 h-2 bg-neutral-white rounded-full animate-bounce" />
                </div>
                <p className="text-xs text-slate-400 font-mono tracking-widest uppercase">{t('louis_copilot:thinking', { defaultValue: 'Louis Thinking...' })}</p>
              </div>
            </div>
            <button
              onClick={handleCancel}
              className="ml-12 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/10 text-red-400 hover:text-white hover:bg-red-500/20 transition-all font-bold text-xs uppercase cursor-pointer"
            >
              <X size={12} />
              {t('louis_copilot:cancel_generation', { defaultValue: "Abbrechen" })}
            </button>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* P0-B: Kompressions-Hinweis (Louis komprimiert den Verlauf) */}
      {compressionNotice !== null && (
        <div className="px-4 py-2 bg-primary-dark/60 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs">
            {compressionNotice === 'in_progress' ? (
              <>
                <RefreshCw size={12} className="shrink-0 text-violet-400 animate-spin" />
                <span className="text-violet-300 font-sans">
                  {t('louis_copilot:compression_in_progress', { defaultValue: '🗜️ Louis komprimiert den Verlauf…' })}
                </span>
                <span className="text-slate-400 font-sans">
                  {t('louis_copilot:compression_wait_hint', { defaultValue: 'Bitte in ein paar Sekunden erneut senden.' })}
                </span>
              </>
            ) : (
              <>
                <Check size={12} className="shrink-0 text-emerald-400" />
                <span className="text-emerald-300 font-sans">
                  {t('louis_copilot:compression_done', { defaultValue: '✓ Louis hat den Verlauf zusammengefasst.' })}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 bg-primary-dark/80 border-t border-white/5">
        <div className="flex flex-col gap-2">
          {/* Pending attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((att, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-2 bg-primary-light border rounded-xl px-3 py-1.5 text-xs max-w-full ${
                    att.status === 'error' ? 'border-red-500/40' : 'border-white/10'
                  }`}
                >
                  <FileText size={12} className={`shrink-0 ${att.status === 'error' ? 'text-red-400' : 'text-accent-blue'}`} />
                  <span className="text-white font-bold max-w-[160px] truncate">{att.file.name}</span>
                  <span className="text-slate-500 shrink-0">{formatBytes(att.file.size)}</span>
                  {att.status === 'uploading' && <RefreshCw size={12} className="shrink-0 text-violet-400 animate-spin" />}
                  {att.status === 'done' && !att.descriptor?.isIndexedInKnowledgeBase && <Check size={12} className="shrink-0 text-emerald-400" />}
                  {att.status === 'done' && att.descriptor?.isIndexedInKnowledgeBase && (
                    <span className="flex items-center gap-1 shrink-0 text-emerald-400" title={t('louis_copilot:attach_indexed_badge', { defaultValue: 'In Wissensdatenbank indiziert' })}>
                      <Database size={12} />
                      <span className="text-[9px] font-black uppercase tracking-wider">{t('louis_copilot:attach_indexed_label', { defaultValue: 'Indiziert' })}</span>
                    </span>
                  )}
                  {att.status === 'error' && (
                    <span className="text-red-400 text-[10px] max-w-[140px] truncate" title={att.error}>{att.error}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(idx)}
                    disabled={att.status === 'uploading'}
                    className="shrink-0 text-slate-500 hover:text-white transition-all cursor-pointer disabled:opacity-40"
                    title={t('louis_copilot:attach_remove', { defaultValue: 'Datei entfernen' })}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

      <div className="flex items-end gap-3">
        {isRecording ? (
          <div className="flex-1 bg-violet-950/20 border border-violet-500/30 rounded-2xl px-5 py-3 flex items-center justify-between gap-4 h-[48px] animate-pulse">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
              <span className="text-xs font-mono font-bold text-red-400">
                REC: {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
              </span>
            </div>
            
            {/* Visual Waveform Indicators */}
            <div className="flex items-center gap-1 h-3">
              {[8, 16, 24, 16, 8, 12, 20, 16, 10, 14, 18, 12, 8].map((h, i) => (
                <div 
                  key={i} 
                  className="w-[2px] bg-violet-400 rounded-full transition-all duration-300"
                  style={{
                    height: `${h}px`,
                    animation: 'bounce 0.6s ease-in-out infinite alternate',
                    animationDelay: `${i * 0.05}s`
                  }}
                />
              ))}
            </div>

            <span className="text-xs text-slate-400 font-sans italic">
              {t('louis_copilot:speaking_now_hint', { defaultValue: 'Sprechen Sie jetzt...' })}
            </span>
          </div>
        ) : isTranscribing ? (
          <div className="flex-1 bg-primary-light border border-white/5 rounded-2xl px-5 py-3 flex items-center gap-3 h-[48px]">
            <RefreshCw className="w-4 h-4 text-violet-400 animate-spin" />
            <span className="text-xs text-slate-400 font-sans tracking-wide">
              {t('louis_copilot:stt_transcribing_info', { defaultValue: 'Übersetze Sprachnachricht...' })}
            </span>
          </div>
        ) : (
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isPending}
            placeholder={t('louis_copilot:chat_placeholder', { defaultValue: "Frage LOUIS AI nach Analysen, Recherchen oder CRM-Mutierungen..." })}
            rows={2}
            className="flex-1 bg-primary-light border border-white/5 rounded-2xl px-5 py-3 text-sm font-medium text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans resize-y min-h-[48px] max-h-40 leading-relaxed"
          />
        )}

        {/* Attachment Paperclip Button */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelect}
          title={t('louis_copilot:attach_file', { defaultValue: 'Datei anhängen' })}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPending || isRecording || isTranscribing || isUploading || pendingAttachments.length >= 5}
          className="shrink-0 w-12 h-12 rounded-2xl bg-primary-light border border-white/5 text-slate-400 hover:text-accent-blue hover:border-accent-blue/40 flex items-center justify-center transition-all duration-300 shadow-md cursor-pointer disabled:opacity-50"
          title={t('louis_copilot:attach_file', { defaultValue: 'Datei anhängen' })}
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Microphone/Recording Action Button */}
        {!isRecording && !isTranscribing ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={isPending}
            className="shrink-0 w-12 h-12 rounded-2xl bg-primary-light border border-white/5 text-slate-400 hover:text-violet-400 hover:border-violet-500/40 flex items-center justify-center transition-all duration-300 shadow-md cursor-pointer disabled:opacity-50"
            title={t('louis_copilot:stt_record_voice', { defaultValue: 'Sprachaufzeichnung starten' })}
          >
            <Mic className="w-5 h-5" />
          </button>
        ) : isRecording ? (
          <button
            type="button"
            onClick={stopRecording}
            className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-tr from-red-600 to-red-500 text-white flex items-center justify-center hover:scale-105 transition-transform duration-300 shadow-md shadow-red-500/20 cursor-pointer"
            title={t('louis_copilot:stt_stop_record', { defaultValue: 'Sprachaufzeichnung beenden' })}
          >
            <Square className="w-5 h-5 text-white animate-pulse" />
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="shrink-0 w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center opacity-50 cursor-not-allowed"
          >
            <RefreshCw className="w-5 h-5 animate-spin" />
          </button>
        )}

        <button
          onClick={handleSend}
          disabled={
            (!inputText.trim() && !pendingAttachments.some(a => a.status === 'done')) ||
            isPending || isRecording || isTranscribing ||
            pendingAttachments.some(a => a.status === 'uploading')
          }
          className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent-orange to-accent-orange/80 text-white flex items-center justify-center hover:scale-105 transition-transform duration-300 shadow-md hover:shadow-accent-orange/20 disabled:scale-100 disabled:opacity-50"
        >
          <Send className="w-5 h-5 text-white" />
        </button>
      </div>
        </div>
      </div>

      {/* Attachment Upload Decision Overlay Modal */}
      <AnimatePresence>
        {showUploadDialog && selectedFileForUpload && (
          <div className="fixed inset-0 bg-primary-dark/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="w-full max-w-md bg-primary-light border border-accent-blue/30 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-accent-blue/5 blur-xl rounded-full" />

              <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-blue to-accent-orange flex items-center justify-center shadow-lg">
                  <Paperclip className="text-white w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-white font-display italic tracking-wide">
                    {t('louis_copilot:attach_dialog_title', { defaultValue: "Datei anhängen" })}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {t('louis_copilot:attach_dialog_subtitle', { defaultValue: "An LOUIS senden — für Suchen & Analysen" })}
                  </p>
                </div>
              </div>

              {/* Selected file info */}
              <div className="flex items-center gap-3 bg-primary-dark/50 border border-white/10 rounded-2xl px-4 py-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-accent-blue/15 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4 text-accent-blue" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{selectedFileForUpload.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">{formatBytes(selectedFileForUpload.size)}</p>
                </div>
              </div>

              {/* Knowledge base index option (decided at selection time) */}
              <label className="flex items-start gap-3 bg-primary-dark/40 border border-white/10 rounded-2xl px-4 py-3 mb-5 cursor-pointer hover:border-emerald-500/30 transition-all select-none">
                <input
                  type="checkbox"
                  checked={uploadIndexFlag}
                  onChange={(e) => setUploadIndexFlag(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-500 cursor-pointer shrink-0"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white">
                    <Database size={12} className="text-emerald-400" />
                    {t('louis_copilot:attach_index_checkbox', { defaultValue: "In Wissensdatenbank dauerhaft speichern" })}
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                    {t('louis_copilot:attach_index_hint', { defaultValue: "Die Datei wird dauerhaft indiziert und steht LOUIS bei zukünftigen Suchen über die Wissensdatenbank (RAG) zur Verfügung." })}
                  </span>
                </span>
              </label>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={confirmUpload}
                  disabled={isUploading}
                  className="flex-1 bg-gradient-to-tr from-accent-blue to-accent-blue/80 hover:from-accent-blue hover:to-accent-blue/90 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer"
                >
                  {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                  {t('louis_copilot:attach_dialog_add', { defaultValue: "Hinzufügen" })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUploadDialog(false);
                    setSelectedFileForUpload(null);
                  }}
                  disabled={isUploading}
                  className="px-4 py-2.5 rounded-xl border border-white/5 hover:border-white/10 hover:bg-white/5 text-slate-400 hover:text-white font-bold text-xs uppercase transition-all disabled:opacity-50 select-none cursor-pointer"
                >
                  {t('louis_copilot:cancel', { defaultValue: "Abbrechen" })}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Short Term Memory Automated Note Suggestion Overlay Modal */}
      <AnimatePresence>
        {showNoteModal && suggestedNote && (
          <div className="fixed inset-0 bg-primary-dark/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: 'spring', duration: 0.4 }}
              className="w-full max-w-md bg-primary-light border border-accent-orange/30 rounded-3xl p-6 shadow-2xl relative animate-in fade-in zoom-in duration-200"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-accent-orange/5 blur-xl rounded-full" />
              
              <div className="flex items-center gap-3 border-b border-white/5 pb-4 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-accent-orange to-accent-blue flex items-center justify-center shadow-lg">
                  <Brain className="text-white w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase text-white font-display italic tracking-wide">
                    {t('louis_copilot:suggest_note_title', { defaultValue: "In das Langzeitgedächtnis" })}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {t('louis_copilot:suggest_note_subtitle', { defaultValue: "LOUIS Langzeit-Speicherung & CRM-Notizen" })}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed mb-4">
                {t('louis_copilot:suggest_note_desc', { defaultValue: "Wähle aus, wo du diese Antwort dauerhaft als Markdown-Notiz speichern möchtest:" })}
              </p>

              {/* Target Entity Selector (User, Contact, Company) */}
              <div className="grid grid-cols-3 gap-2 mb-4 bg-primary-dark/50 p-1 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setSuggestedNote(prev => prev ? { ...prev, entity_type: 'user', entity_id: undefined } : null)}
                  className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                    suggestedNote.entity_type === 'user'
                      ? 'bg-accent-orange text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t('louis_copilot:target_user', { defaultValue: "Eigene Notiz" })}
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestedNote(prev => prev ? { ...prev, entity_type: 'contact', entity_id: '' } : null)}
                  className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                    suggestedNote.entity_type === 'contact'
                      ? 'bg-accent-orange text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t('louis_copilot:target_contact', { defaultValue: "Kontakt" })}
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestedNote(prev => prev ? { ...prev, entity_type: 'company', entity_id: '' } : null)}
                  className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer ${
                    suggestedNote.entity_type === 'company'
                      ? 'bg-accent-orange text-white shadow-md'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {t('louis_copilot:target_company', { defaultValue: "Unternehmen" })}
                </button>
              </div>

              {/* Conditional dropdown selects based on target type */}
              {suggestedNote.entity_type === 'contact' && (
                <div className="mb-4">
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-wider mb-2 font-display">
                    {t('louis_copilot:select_contact_label', { defaultValue: "CRM-Kontakt Auswählen" })}
                  </label>
                  <select
                    value={suggestedNote.entity_id || ''}
                    onChange={(e) => setSuggestedNote(prev => prev ? { ...prev, entity_id: e.target.value } : null)}
                    className="w-full bg-primary-dark border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                  >
                    <option value="">-- {t('louis_copilot:select_contact_placeholder', { defaultValue: "Kontakt auswählen" })} --</option>
                    {contacts.map((c) => (
                      <option key={c.id_uuid} value={c.id_uuid}>
                        {c.first_name} {c.last_name} {c.full_legal_name ? `(${c.full_legal_name})` : ''}
                      </option>
                    ))}
                  </select>
                  {!suggestedNote.entity_id && (
                    <p className="text-[10px] text-accent-orange mt-1">
                      {t('louis_copilot:select_contact_validation', { defaultValue: '* Bitte wähle einen Kontakt aus, um die Notiz zu speichern.' })}
                    </p>
                  )}
                </div>
              )}

              {suggestedNote.entity_type === 'company' && (
                <div className="mb-4">
                  <label className="block text-[10px] text-slate-400 uppercase font-black tracking-wider mb-2 font-display">
                    {t('louis_copilot:select_company_label', { defaultValue: "CRM-Unternehmen Auswählen" })}
                  </label>
                  <select
                    value={suggestedNote.entity_id || ''}
                    onChange={(e) => setSuggestedNote(prev => prev ? { ...prev, entity_id: e.target.value } : null)}
                    className="w-full bg-primary-dark border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                  >
                    <option value="">-- {t('louis_copilot:select_company_placeholder', { defaultValue: "Unternehmen auswählen" })} --</option>
                    {companies.map((c) => (
                      <option key={c.id_uuid} value={c.id_uuid}>
                        {c.full_legal_name || c.email_address || c.id_uuid}
                      </option>
                    ))}
                  </select>
                  {!suggestedNote.entity_id && (
                    <p className="text-[10px] text-accent-orange mt-1">
                      {t('louis_copilot:select_company_validation', { defaultValue: '* Bitte wähle ein Unternehmen aus, um die Notiz zu speichern.' })}
                    </p>
                  )}
                </div>
              )}

              {/* Note Content Input */}
              <div className="mb-5">
                <label className="block text-[10px] text-slate-400 uppercase font-black tracking-wider mb-2 font-display">
                  {t('louis_copilot:note_content_label', { defaultValue: "Notiz-Text (Markdown)" })}
                </label>
                <textarea
                  value={suggestedNote.content}
                  onChange={(e) => setSuggestedNote(prev => prev ? { ...prev, content: e.target.value } : null)}
                  rows={6}
                  className="w-full bg-primary-dark border border-white/5 rounded-xl p-3 text-xs leading-relaxed text-white font-medium focus:outline-none focus:border-accent-orange/40 focus:ring-1 focus:ring-accent-orange/25"
                  placeholder={t('louis_copilot:note_textarea_hint', { defaultValue: "Unterstützt reines Markdown Format..." })}
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    saveNoteMutation.mutate({
                      entity_type: suggestedNote.entity_type,
                      entity_id: suggestedNote.entity_id,
                      content: suggestedNote.content
                    });
                  }}
                  disabled={
                    saveNoteMutation.isPending || 
                    ((suggestedNote.entity_type === 'contact' || suggestedNote.entity_type === 'company') && !suggestedNote.entity_id)
                  }
                  className="flex-1 bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:from-accent-orange hover:to-accent-orange/90 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed select-none cursor-pointer"
                >
                  {saveNoteMutation.isPending && <RefreshCw size={12} className="animate-spin" />}
                  {!saveNoteMutation.isPending && <Check size={14} />}
                  {t('louis_copilot:note_save_btn', { defaultValue: "Dauerhaft speichern" })}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNoteModal(false);
                    setSuggestedNote(null);
                  }}
                  disabled={saveNoteMutation.isPending}
                  className="px-4 py-2.5 rounded-xl border border-white/5 hover:border-white/10 hover:bg-white/5 text-slate-400 hover:text-white font-bold text-xs uppercase transition-all disabled:opacity-50 select-none cursor-pointer"
                >
                  {t('louis_copilot:cancel', { defaultValue: "Abbrechen" })}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
