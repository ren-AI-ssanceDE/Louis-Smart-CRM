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
  Bookmark
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MailDraftAttachment } from '../types';
import { trpc } from '../lib/trpc';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thought_log?: string[];
  proposed_changes?: {
    entity_type: 'companies' | 'contacts' | 'invoices';
    action: 'CREATE' | 'UPDATE' | 'DELETE';
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
}

function renderMessageContent(text: string, role: 'user' | 'assistant'): React.ReactNode {
  if (!text) return null;

  // Pattern matching: Either Markdown style link [Some text](http://someurl) OR raw url https://someurl...
  const combinedRegex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s/$.?#].[^\s]*)/gi;
  
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let keyIdx = 0;
  let match;

  const linkClass = role === 'user'
    ? "text-white underline hover:opacity-80 cursor-pointer break-all font-semibold"
    : "text-[#38bdf8] hover:text-[#38bdf8]/80 underline cursor-pointer break-all font-semibold inline-flex items-center gap-0.5";

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
  const [inputText, setInputText] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showThoughts, setShowThoughts] = useState<Record<number, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement>(null);
  const [isPending, setIsPending] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

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
        const pState = variables.proposed_state as any;
        const recipient = String(pState.recipient_email_address || "").trim().toLowerCase();
        
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
    if (!inputText.trim() || isPending) return;

    const userMsg = inputText.trim();
    setInputText('');

    // Add user message to state
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: userMsg,
        timestamp_utc: new Date().toISOString()
      }
    ]);

    setIsPending(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resultObj = await utils.client.sendMessage.mutate({
        message: userMsg,
        sessionId,
        language: i18n.language
      }, {
        signal: controller.signal
      });

      if (resultObj.sessionId) {
        setSessionId(resultObj.sessionId);
      }

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: resultObj.replyText,
          thought_log: resultObj.thoughtLog,
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
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-wide text-white font-display uppercase italic">{t('louis_copilot:title_brand', { defaultValue: 'LOUIS CRM AI' })}</h2>
              <span className="bg-accent-orange/10 border border-accent-orange/20 text-accent-orange text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest font-mono">
                ReAct Core v1.4
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              {t('louis_copilot:louis_ai_subtitle', { defaultValue: "Intelligenter Assistent für Analysen, Recherche & Zero-Direct-Write CRM-Mutierung" })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMessages([]);
              setSessionId(undefined);
              toast.success(t('louis_copilot:chat_reset', { defaultValue: "Unterhaltung zurückgesetzt" }));
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

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar bg-primary-dark/30">
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
                    {msg.proposed_changes.entity_type === 'emails' ? (
                      <div className="space-y-3 font-sans text-xs">
                        <div className="text-[10px] uppercase font-black text-slate-500 mb-1">
                          {t('louis_copilot:props_review_title_mail', { defaultValue: "GoBD E-Mail-Entwurf" })}
                        </div>
                        <div className="flex border-b border-white/5 pb-2">
                          <span className="text-slate-400 w-20 shrink-0 font-bold">{t('louis_copilot:recipient', { defaultValue: "Empfänger" })}:</span>
                          <span className="text-white font-mono break-all">{String(msg.proposed_changes.proposed_state.recipient_email_address || '')}</span>
                        </div>
                        <div className="flex border-b border-white/5 pb-2">
                          <span className="text-slate-400 w-20 shrink-0 font-bold">{t('louis_copilot:subject', { defaultValue: "Betreff" })}:</span>
                          <span className="text-white font-bold">{String(msg.proposed_changes.proposed_state.email_subject_text || '')}</span>
                        </div>
                        {msg.proposed_changes.proposed_state.invoice_id && (
                          <div className="flex border-b border-white/5 pb-2 text-accent-orange font-bold">
                            <span className="text-slate-400 w-20 shrink-0 font-bold">{t('louis_copilot:attachment', { defaultValue: "Anhang" })}:</span>
                            <span>Rechnungs-PDF (UUID: {String(msg.proposed_changes.proposed_state.invoice_id).substring(0, 8)}...)</span>
                          </div>
                        )}
                        {Array.isArray(msg.proposed_changes.proposed_state.attachments) && msg.proposed_changes.proposed_state.attachments.map((att: MailDraftAttachment, idx: number) => (
                          <div key={idx} className="flex border-b border-white/5 pb-2 text-sky-400 font-bold">
                            <span className="text-slate-400 w-20 shrink-0 font-bold">
                              {idx === 0 ? t('louis_copilot:attachments', { defaultValue: "Anhänge" }) : ""}
                            </span>
                            <span className="truncate">
                              📎 {att.filename} <span className="text-[10px] text-slate-500 font-normal">({att.source === 'knowledge' ? t('louis_copilot:knowledge_base', { defaultValue: 'Wissensdatenbank' }) : 'Vault'})</span>
                            </span>
                          </div>
                        ))}
                        <div className="pt-2">
                          <span className="text-slate-400 font-bold block mb-1">{t('louis_copilot:content', { defaultValue: "Inhalt" })}:</span>
                          <div 
                            className="bg-primary-dark/80 border border-white/5 rounded-2xl p-4 text-slate-300 max-h-48 overflow-y-auto font-sans leading-relaxed text-sm break-words"
                            dangerouslySetInnerHTML={{ __html: String(msg.proposed_changes.proposed_state.email_body_content || '').replace(/\\n/g, '<br/>') }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-[11px] leading-relaxed max-h-60 overflow-y-auto scrollbar-thin">
                        <div className="text-[10px] uppercase font-black text-slate-500 mb-1">
                          {t('louis_copilot:entity_properties', { entity: msg.proposed_changes.entity_type, defaultValue: `${msg.proposed_changes.entity_type} Properties:` })}
                        </div>
                        {Object.entries(msg.proposed_changes.proposed_state || {}).map(([key, val]) => {
                          if (typeof val === 'object' && val !== null) {
                            return (
                              <div key={key} className="pl-2">
                                <span className="text-accent-blue font-semibold">{key}:</span>
                                <div className="pl-4 text-[10px] text-slate-400">
                                  {JSON.stringify(val, null, 2)}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={key} className="pl-2 flex justify-between">
                              <span className="text-slate-400 font-bold shrink-0">{key}:</span>
                              <span className="text-white text-right truncate pl-4 font-mono">{String(val)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
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

      {/* Input Area */}
      <div className="p-4 bg-primary-dark/80 border-t border-white/5 flex items-end gap-3">
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
        <button
          onClick={handleSend}
          disabled={!inputText.trim() || isPending}
          className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-tr from-accent-orange to-accent-orange/80 text-white flex items-center justify-center hover:scale-105 transition-transform duration-300 shadow-md hover:shadow-accent-orange/20 disabled:scale-100 disabled:opacity-50"
        >
          <Send className="w-5 h-5 text-white" />
        </button>
      </div>

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
