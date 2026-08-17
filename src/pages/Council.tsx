import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Plus, 
  Trash2, 
  Play, 
  ArrowRight, 
  Loader2, 
  Award, 
  ChevronRight, 
  CheckCircle, 
  AlertCircle, 
  RefreshCw, 
  Cpu, 
  User as UserIcon, 
  MessageSquare,
  FileText,
  Download,
  Info,
  BookOpen,
  Database,
  X
} from 'lucide-react';
import { trpc } from '../lib/trpc';
import { toast } from 'sonner';
import { cn } from '../lib/utils';
import { CouncilSession, CouncilMessage, CouncilParticipant } from '../types';

// Markdown-Renderer Hilfsfunktionen
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const regex = /\*\*([^*]+)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<strong key={key++} className="font-bold text-white font-sans">{match[1]}</strong>);
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <div className="space-y-3 text-sm text-slate-300 leading-relaxed font-sans">
      {lines.map((line, i) => {
        if (line.startsWith('### ')) {
          return <h4 key={i} className="text-sm font-bold text-white mt-4 mb-2 font-display uppercase tracking-wider">{line.replace('### ', '')}</h4>;
        }
        if (line.startsWith('## ')) {
          return <h3 key={i} className="text-base font-black text-accent-orange mt-6 mb-3 font-display uppercase tracking-tight italic">{line.replace('## ', '')}</h3>;
        }
        if (line.startsWith('# ')) {
          return <h2 key={i} className="text-lg font-black text-white mt-8 mb-4 font-display uppercase tracking-tight italic">{line.replace('# ', '')}</h2>;
        }
        
        if (line.startsWith('- ') || line.startsWith('* ')) {
          const content = line.substring(2);
          return (
            <div key={i} className="flex items-start gap-2 pl-3 my-1">
              <span className="text-accent-orange mt-2 shrink-0 h-1.5 w-1.5 rounded-full bg-accent-orange/80" />
              <p className="flex-1">{parseInlineMarkdown(content)}</p>
            </div>
          );
        }

        if (line === '---') {
          return <hr key={i} className="border-white/5 my-4" />;
        }

        return <p key={i} className="min-h-[1rem]">{parseInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export const Council = () => {
  const { t } = useTranslation(['council', 'common']);
  // Query & Mutation API
  const { data: settings, isLoading: isSettingsLoading } = trpc.getSettings.useQuery();
  const { data: sessions = [], isLoading: isSessionsLoading, refetch: refetchSessions } = trpc.getCouncilSessions.useQuery();
  
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const { data: activeSessionData, isLoading: isActiveSessionLoading, refetch: refetchActiveSession } = trpc.getCouncilSession.useQuery(
    { id: selectedSessionId || '' },
    { enabled: !!selectedSessionId }
  );

  const createSessionMutation = trpc.createSession.useMutation({
    onSuccess: (newSession) => {
      toast.success(t('council:session_initialized', { defaultValue: 'Diskussions-Session erfolgreich initialisiert!' }));
      refetchSessions();
      setSelectedSessionId(newSession.id);
      setIsCreating(false);
    },
    onError: (err) => {
      toast.error(t('council:error_session_init', { defaultValue: 'Fehler beim Initialisieren der Session: ' }) + err.message);
    }
  });

  const executeStepMutation = trpc.executeStep.useMutation({
    onSuccess: () => {
      toast.success(t('council:round_calculated', { defaultValue: 'Runde erfolgreich berechnet!' }));
      refetchSessions();
      refetchActiveSession();
    },
    onError: (err) => {
      toast.error(t('council:error_round_calc', { defaultValue: 'Fehler bei der Rundenberechnung: ' }) + err.message);
    }
  });

  const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);

  const deleteSessionMutation = trpc.deleteSession.useMutation({
    onSuccess: () => {
      toast.success(t('council:session_deleted', { defaultValue: 'Session gelöscht.' }));
      refetchSessions();
      if (selectedSessionId === sessionToDelete) {
        setSelectedSessionId(null);
      }
      setSessionToDelete(null);
    },
    onError: (err) => {
      toast.error(t('council:error_session_delete', { defaultValue: 'Fehler beim Löschen der Session: ' }) + err.message);
    }
  });

  const [isSaveKbModalOpen, setIsSaveKbModalOpen] = useState(false);
  const [kbSaveOption, setKbSaveOption] = useState<'full' | 'summary_only'>('full');

  const saveToKbMutation = trpc.saveToKnowledgeBase.useMutation({
    onSuccess: (res) => {
      toast.success(t('council:saved_to_kb_success', { defaultValue: 'Erfolgreich in der Wissensdatenbank gespeichert: ' }) + res.fileName);
      setIsSaveKbModalOpen(false);
    },
    onError: (err) => {
      toast.error(t('council:error_saving_kb', { defaultValue: 'Fehler beim Speichern in Wissensdatenbank: ' }) + err.message);
    }
  });

  const handleSaveToKnowledgeBase = () => {
    if (!selectedSessionId) return;
    saveToKbMutation.mutate({
      sessionId: selectedSessionId,
      saveOption: kbSaveOption
    });
  };

  // UI States
  const [isCreating, setIsCreating] = useState(false);
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<'multi-role' | 'multi-model'>('multi-role');
  const [maxRounds, setMaxRounds] = useState(3);
  const [participants, setParticipants] = useState<CouncilParticipant[]>([]);
  const [activeRoundTab, setActiveRoundTab] = useState<number>(1);

  // Sync settings when creating a new session
  useEffect(() => {
    if (settings && isCreating) {
      setMode(settings.defaultMode || 'multi-role');
      setMaxRounds(settings.defaultMaxRounds || 3);
      
      // Befülle Standard-Teilnehmer aus Rollen
      const initialParticipants: CouncilParticipant[] = (settings.roles || []).map((role, idx) => ({
        id: role.id || String(idx),
        name: role.name,
        providerId: 'louis-chat', // Nutze Standard Louis Config
        modelId: '',
        systemPrompt: role.systemPrompt,
        temperature: role.temperature
      }));
      setParticipants(initialParticipants);
    }
  }, [settings, isCreating]);

  // Sync active round tab when active session data loads
  useEffect(() => {
    if (activeSessionData?.session) {
      const current = activeSessionData.session.currentRound;
      const status = activeSessionData.session.status;
      if (status === 'completed') {
        setActiveRoundTab(activeSessionData.session.maxRounds);
      } else {
        setActiveRoundTab(Math.max(1, current - 1));
      }
    }
  }, [activeSessionData]);

  const handleStartSession = () => {
    if (!topic.trim()) {
      toast.error(t('council:enter_topic_prompt', { defaultValue: 'Bitte geben Sie ein Diskussionsthema ein.' }));
      return;
    }
    if (participants.length === 0) {
      toast.error(t('council:add_participant_prompt', { defaultValue: 'Bitte fügen Sie mindestens einen Debattanten hinzu.' }));
      return;
    }
    createSessionMutation.mutate({
      topic,
      mode,
      maxRounds,
      participants
    });
  };

  const handleExecuteNextRound = () => {
    if (!selectedSessionId) return;
    executeStepMutation.mutate({ sessionId: selectedSessionId });
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessionToDelete(id);
  };

  const handleAddParticipant = () => {
    const newPart: CouncilParticipant = {
      id: crypto.randomUUID(),
      name: t('council:debater_default_name', { defaultValue: 'Debattant {{num}}', num: participants.length + 1 }),
      providerId: 'louis-chat',
      modelId: '',
      systemPrompt: t('council:debater_default_prompt', { defaultValue: 'Du bist ein erfahrener Beirat und lieferst fundierte Perspektiven.' }),
      temperature: 0.7
    };
    setParticipants([...participants, newPart]);
  };

  const handleUpdateParticipant = <K extends keyof CouncilParticipant>(id: string, field: K, value: CouncilParticipant[K]) => {
    setParticipants(participants.map(p => p.id === id ? { ...p, [field]: value } : p));
  };

  const handleRemoveParticipant = (id: string) => {
    setParticipants(participants.filter(p => p.id !== id));
  };

  // Hilfsfunktion zum Exportieren des Berichts als Text
  const handleExportText = () => {
    if (!activeSessionData?.session) return;
    const s = activeSessionData.session;
    let content = `========================================\n`;
    content += `LLM COUNCIL CONSENSUS REPORT\n`;
    content += `Thema: ${s.topic}\n`;
    content += `Datum: ${s.createdAt}\n`;
    content += `Modus: ${s.mode} | Runden: ${s.maxRounds}\n`;
    content += `========================================\n\n`;
    content += `### ${t('council:synthesized_conclusion', { defaultValue: 'SYNTHETISIERTES FAZIT:' })}\n\n${s.finalConclusion || t('council:no_conclusion', { defaultValue: 'Kein Fazit verfügbar.' })}\n\n`;
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `council_report_${s.id.slice(0, 8)}.txt`;
    link.click();
  };

  if (isSettingsLoading || isSessionsLoading) {
    return (
      <div className="flex items-center gap-3 justify-center py-24 h-screen">
        <Loader2 className="w-8 h-8 text-accent-orange animate-spin" />
        <span className="text-sm font-mono text-slate-400 uppercase tracking-widest">
          {t('council:sondiere_central', { defaultValue: 'Sondiere Council-Zentrale...' })}
        </span>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-primary-dark">
      {/* Top Banner */}
      <div className="px-8 py-5 border-b border-white/5 bg-primary-light/15 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent-orange/10 border border-accent-orange/20 rounded-xl text-accent-orange shadow-lg shadow-accent-orange/5">
            <Users size={22} />
          </div>
          <div>
            <h1 className="text-base font-black tracking-wider uppercase text-white font-display">Louis LLM Council</h1>
            <p className="text-[10px] text-slate-400 font-mono">{t('council:subtitle', { defaultValue: 'Unabhängiges Multi-LLM Diskussionsforum nach dem Karpathy-Raffinement-Modell' })}</p>
          </div>
        </div>
        
        <button
          onClick={() => {
            setIsCreating(true);
            setSelectedSessionId(null);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-accent-orange hover:bg-accent-orange/90 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-accent-orange/15"
        >
          <Plus size={14} /> {t('council:new_debate', { defaultValue: 'Neue Debatte' })}
        </button>
      </div>

      {/* Main Split Screen */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Session List */}
        <div className="w-80 border-r border-white/5 flex flex-col bg-slate-950/20 shrink-0">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-mono">{t('council:past_debates', { defaultValue: 'Vergangene Debatten ({{count}})', count: sessions.length })}</h3>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
            {sessions.length === 0 ? (
              <div className="p-6 text-center text-slate-600 font-mono text-xs">
                {t('council:no_debates', { defaultValue: 'Keine Debatten aufgezeichnet.' })}
              </div>
            ) : (
              sessions.map((s) => {
                const isSelected = selectedSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setSelectedSessionId(s.id);
                      setIsCreating(false);
                    }}
                    className={cn(
                      "p-4 rounded-xl border transition-all duration-300 cursor-pointer group relative",
                      isSelected
                        ? "bg-primary-light border-white/10 text-white shadow-xl shadow-black/30"
                        : "bg-slate-900/40 border-white/5 text-slate-400 hover:text-white hover:border-white/10"
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      title={t('council:delete_session', { defaultValue: 'Debatte löschen' })}
                      className="absolute top-3.5 right-3.5 p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/15 opacity-70 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>

                    <p className="text-xs font-bold tracking-tight line-clamp-2 pr-6 font-display group-hover:text-white">
                      {s.topic}
                    </p>
                    
                    <div className="flex items-center justify-between mt-3">
                      <span className={cn(
                        "text-[9px] font-mono px-2 py-0.5 rounded-full uppercase font-bold",
                        s.status === 'completed' ? "bg-green-500/10 text-green-400" :
                        s.status === 'active' ? "bg-accent-orange/10 text-accent-orange" :
                        "bg-slate-800 text-slate-400"
                      )}>
                        {s.status === 'completed' ? t('council:completed', { defaultValue: 'Beendet' }) : s.status === 'active' ? t('council:round_num', { defaultValue: 'Runde {{num}}', num: s.currentRound }) : t('council:draft', { defaultValue: 'Entwurf' })}
                      </span>
                      <span className="text-[9px] font-mono text-slate-500">
                        {new Date(s.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Content Pane */}
        <div className="flex-1 flex flex-col bg-primary-dark/40 overflow-y-auto custom-scrollbar">
          <AnimatePresence mode="wait">
            {isCreating ? (
              // Phase 1: Neue Diskussion Konfigurieren
              <motion.div
                key="creation-form"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="max-w-4xl mx-auto p-8 space-y-8 w-full"
              >
                <div>
                  <h2 className="text-xl font-black text-white uppercase italic tracking-wider font-display mb-1">{t('council:initialize_debate', { defaultValue: 'Debatte initialisieren' })}</h2>
                  <p className="text-xs text-slate-400 font-mono">{t('council:initialize_sub', { defaultValue: 'Konstruiere ein Expertengremium zur parallelisierten Entscheidungsfindung.' })}</p>
                </div>

                <div className="space-y-4">
                  <label className="block text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">{t('council:topic_label', { defaultValue: 'Fragestellung / Topic zur Debatte' })}</label>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={t('council:topic_placeholder', { defaultValue: 'z.B. Wie sollten wir auf den CRM-Markteintritt eines neuen Mitbewerbers reagieren, der mit Kampfpreisen wirbt?' })}
                    rows={3}
                    className="w-full bg-slate-900/60 border border-white/5 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-accent-orange/50 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-900/40 p-5 rounded-xl border border-white/5">
                  <div>
                    <label className="block text-xs font-bold font-mono text-slate-400 uppercase tracking-wider mb-2">{t('council:mode_label', { defaultValue: 'Modus' })}</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setMode('multi-role')}
                        className={cn(
                          "py-3 px-4 rounded-lg border text-xs font-bold uppercase transition-all",
                          mode === 'multi-role'
                            ? "bg-accent-orange/15 border-accent-orange text-white"
                            : "bg-slate-900 border-white/5 text-slate-500 hover:text-white"
                        )}
                      >
                        Multi-Role
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode('multi-model')}
                        className={cn(
                          "py-3 px-4 rounded-lg border text-xs font-bold uppercase transition-all",
                          mode === 'multi-model'
                            ? "bg-accent-orange/15 border-accent-orange text-white"
                            : "bg-slate-900 border-white/5 text-slate-500 hover:text-white"
                        )}
                      >
                        Multi-Model
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold font-mono text-slate-400 uppercase tracking-wider mb-2">{t('council:rounds_label', { defaultValue: 'Runden: {{count}}', count: maxRounds })}</label>
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={maxRounds}
                      onChange={(e) => setMaxRounds(parseInt(e.target.value))}
                      className="w-full accent-accent-orange mt-3"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                      <span>{t('council:round_1_hint', { defaultValue: '1 (Einfacher Entwurf)' })}</span>
                      <span>{t('council:round_5_hint', { defaultValue: '5 (Kritischer Konsens)' })}</span>
                    </div>
                  </div>
                </div>

                {/* Debattanten */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">{t('council:board_debaters', { defaultValue: 'Gremium / Debattanten ({{count}})', count: participants.length })}</h3>
                    <button
                      type="button"
                      onClick={handleAddParticipant}
                      className="text-xs font-bold text-accent-orange hover:text-accent-orange/80 transition-colors uppercase font-mono flex items-center gap-1"
                    >
                      <Plus size={14} /> {t('council:add_debater', { defaultValue: 'Debattant Hinzufügen' })}
                    </button>
                  </div>

                  <div className="space-y-4">
                    {participants.map((part, index) => (
                      <div key={part.id} className="p-5 bg-slate-900/50 rounded-xl border border-white/5 space-y-3 relative">
                        <button
                          type="button"
                          onClick={() => handleRemoveParticipant(part.id)}
                          className="absolute top-4 right-4 text-slate-500 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={15} />
                        </button>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">{t('council:name_role_label', { defaultValue: 'Name / Rolle' })}</label>
                            <input
                              type="text"
                              value={part.name}
                              onChange={(e) => handleUpdateParticipant(part.id, 'name', e.target.value)}
                              className="w-full bg-slate-800/40 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                            />
                          </div>

                          {mode === 'multi-model' && (
                            <div>
                              <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">{t('council:provider_model_label', { defaultValue: 'Provider & Modell' })}</label>
                              <select
                                value={part.providerId}
                                onChange={(e) => {
                                  const pId = e.target.value;
                                  handleUpdateParticipant(part.id, 'providerId', pId);
                                }}
                                className="w-full bg-slate-800/40 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                              >
                                <option value="louis-chat">Louis AI (Standard)</option>
                                {(settings?.providers || []).map(p => (
                                  <option key={p.id_uuid} value={p.id_uuid}>{p.name} ({p.provider_type})</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {mode === 'multi-model' && (
                            <div>
                              <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">{t('council:model_id_override', { defaultValue: 'Modell-ID Überschreibung (optional)' })}</label>
                              <input
                                type="text"
                                value={part.modelId}
                                onChange={(e) => handleUpdateParticipant(part.id, 'modelId', e.target.value)}
                                placeholder={t('council:model_id_placeholder', { defaultValue: 'z.B. gpt-4o, claude-3-5-sonnet' })}
                                className="w-full bg-slate-800/40 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                              />
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold font-mono text-slate-500 uppercase tracking-wider mb-1">{t('council:system_prompt_label', { defaultValue: 'System-Prompt (Mission/Rolle)' })}</label>
                          <textarea
                            value={part.systemPrompt}
                            onChange={(e) => handleUpdateParticipant(part.id, 'systemPrompt', e.target.value)}
                            rows={2}
                            className="w-full bg-slate-800/40 border border-white/5 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-accent-orange/40"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end pt-6 border-t border-white/5">
                  <button
                    onClick={handleStartSession}
                    disabled={createSessionMutation.isPending}
                    className="flex items-center gap-2 px-6 py-3 bg-accent-orange hover:bg-accent-orange/85 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
                  >
                    {createSessionMutation.isPending ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> {t('council:initializing', { defaultValue: 'Initialisiere...' })}
                      </>
                    ) : (
                      <>
                        {t('council:start_discussion', { defaultValue: 'Diskussion Starten' })} <Play size={14} />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            ) : selectedSessionId ? (
              // Phase 2 & 3: Session Details (Arena oder Consensus Report)
              isActiveSessionLoading ? (
                <div className="flex-1 flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-accent-orange animate-spin" />
                </div>
              ) : activeSessionData?.session ? (
                <div className="p-8 space-y-8 w-full max-w-7xl mx-auto">
                  {/* Topic Card */}
                  <div className="bg-slate-900/60 p-6 rounded-xl border border-white/5 space-y-3 shadow-xl">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="space-y-1">
                        <span className="text-[9px] font-mono font-bold text-accent-orange uppercase tracking-widest">{t('council:current_topic', { defaultValue: 'AKTUELLES THEMA' })}</span>
                        <h2 className="text-lg font-black text-white font-display leading-snug">{activeSessionData.session.topic}</h2>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setIsSaveKbModalOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-orange/15 hover:bg-accent-orange/25 text-accent-orange border border-accent-orange/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all font-mono shadow-sm"
                          title={t('council:save_to_kb_tooltip', { defaultValue: 'In Wissensdatenbank speichern' })}
                        >
                          <BookOpen size={13} /> {t('council:save_to_kb', { defaultValue: 'In Wissensdatenbank speichern' })}
                        </button>

                        <button
                          type="button"
                          onClick={handleExportText}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-lg transition-colors border border-white/5 font-mono uppercase tracking-wider"
                        >
                          <Download size={13} /> {t('council:export_txt', { defaultValue: 'Export .TXT' })}
                        </button>

                        <button
                          type="button"
                          onClick={(e) => handleDeleteSession(activeSessionData.session.id, e)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors font-mono"
                          title={t('council:delete_debate_tooltip', { defaultValue: 'Debatte löschen' })}
                        >
                          <Trash2 size={13} /> {t('council:delete_debate', { defaultValue: 'Löschen' })}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 pt-2 border-t border-white/5 text-[10px] font-mono text-slate-500">
                      <span>{t('council:mode', { defaultValue: 'Modus:' })} <strong className="text-slate-300 capitalize">{activeSessionData.session.mode}</strong></span>
                      <span>{t('council:max_rounds', { defaultValue: 'Maximale Runden:' })} <strong className="text-slate-300">{activeSessionData.session.maxRounds}</strong></span>
                      <span>{t('council:current_round', { defaultValue: 'Aktuelle Runde:' })} <strong className="text-slate-300">{activeSessionData.session.currentRound}</strong></span>
                    </div>
                  </div>

                  {/* Consensus Report (Phase 3) */}
                  {activeSessionData.session.status === 'completed' && activeSessionData.session.finalConclusion && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-slate-900 p-8 rounded-xl border border-accent-orange/20 shadow-2xl relative overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 p-6 flex items-center gap-2 z-10">
                        <button
                          type="button"
                          onClick={() => {
                            setKbSaveOption('summary_only');
                            setIsSaveKbModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-orange/15 hover:bg-accent-orange/25 text-accent-orange border border-accent-orange/30 rounded-lg text-xs font-bold uppercase tracking-wider transition-all font-mono"
                        >
                          <BookOpen size={13} /> {t('council:save_summary_to_kb', { defaultValue: 'Synthese in Wissensdatenbank' })}
                        </button>

                        <button
                          type="button"
                          onClick={handleExportText}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 rounded-lg transition-colors border border-white/5 font-mono uppercase tracking-wider"
                        >
                          <Download size={13} /> {t('council:export_txt', { defaultValue: 'Export .TXT' })}
                        </button>
                      </div>

                      <div className="flex items-center gap-3 mb-6 border-b border-white/5 pb-4">
                        <div className="p-2 bg-accent-orange/15 rounded-xl border border-accent-orange/35 text-accent-orange shrink-0">
                          <Award size={24} />
                        </div>
                        <div>
                          <h3 className="text-base font-black text-white uppercase italic tracking-wide font-display">{t('council:consensus_report', { defaultValue: 'Consensus Report' })}</h3>
                          <p className="text-[10px] text-slate-500 font-mono">{t('council:consensus_report_sub', { defaultValue: 'Synthetisiertes Gesamtergebnis und Handlungsempfehlung des Gremiums' })}</p>
                        </div>
                      </div>

                      <div className="p-6 bg-slate-950/40 rounded-xl border border-white/5 shadow-inner">
                        {renderMarkdown(activeSessionData.session.finalConclusion)}
                      </div>
                    </motion.div>
                  )}

                  {/* Discussion Arena (Parallel Grid) */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare size={18} className="text-accent-orange" />
                        <h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">{t('council:discussion_arena', { defaultValue: 'Diskussions-Arena' })}</h3>
                      </div>

                      {/* Runden-Navigations-Tabs */}
                      <div className="flex items-center gap-1 bg-slate-950/30 p-1 rounded-lg border border-white/5">
                        {Array.from({ length: activeSessionData.session.status === 'completed' ? activeSessionData.session.maxRounds : activeSessionData.session.currentRound }).map((_, idx) => {
                          const r = idx + 1;
                          // Nur Runden anzeigen, für die es bereits Nachrichten gibt, es sei denn es ist die aktive Draft-Runde
                          const hasMessages = activeSessionData.messages.some(m => m.roundNumber === r);
                          if (!hasMessages && r !== activeSessionData.session.currentRound) return null;
                          
                          return (
                            <button
                              key={r}
                              onClick={() => setActiveRoundTab(r)}
                              className={cn(
                                "px-3 py-1 rounded-md text-[10px] font-bold uppercase font-mono tracking-wider transition-colors",
                                activeRoundTab === r
                                  ? "bg-accent-orange text-white"
                                  : "text-slate-500 hover:text-slate-300"
                              )}
                            >
                              {t('council:round_tab', { defaultValue: 'Runde {{num}}', num: r })}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Active Step Executor (Phase 2) */}
                    {activeSessionData.session.status !== 'completed' && activeRoundTab === activeSessionData.session.currentRound && (
                      <div className="p-8 bg-slate-900/30 rounded-xl border border-dashed border-white/10 text-center space-y-4">
                        <div className="flex justify-center">
                          <div className="p-4 bg-accent-orange/5 rounded-full border border-accent-orange/15 text-accent-orange animate-pulse">
                            <RefreshCw size={24} />
                          </div>
                        </div>
                        <div className="max-w-md mx-auto">
                          <h4 className="text-sm font-bold text-white font-display uppercase tracking-wide">{t('council:round_ready_title', { defaultValue: 'Runde {{num}} Bereit zur Ausführung', num: activeSessionData.session.currentRound })}</h4>
                          <p className="text-xs text-slate-500 font-mono mt-1 leading-relaxed">
                            {activeSessionData.session.currentRound === 1 
                              ? t('council:round_1_description', { defaultValue: 'Phase 1 (Brainstorming): Die 5 Berater-Rollen (Kontrarian, Grundsatzdenker, Expansionist, Außenseiter, Umsetzer) analysieren die Frage unabhängig aus ihrer Spezialperspektive.' })
                              : t('council:round_n_description', { defaultValue: 'Phase 2 (Anonymes Peer Review): Die Berater bewerten anonymisiert die Entwürfe A bis E aus Runde {{prevRound}}, vergeben Rankings und identifizieren blinde Flecken.', prevRound: activeSessionData.session.currentRound - 1 })}
                          </p>
                        </div>
                        <button
                          onClick={handleExecuteNextRound}
                          disabled={executeStepMutation.isPending}
                          className="flex items-center gap-2 px-6 py-3 bg-accent-orange hover:bg-accent-orange/85 text-white rounded-lg text-xs font-bold uppercase tracking-wider mx-auto transition-colors shadow-lg shadow-accent-orange/15"
                        >
                          {executeStepMutation.isPending ? (
                            <>
                              <Loader2 size={14} className="animate-spin" /> {t('council:calculating', { defaultValue: 'Berechne...' })}
                            </>
                          ) : (
                            <>
                              {t('council:calculate_round', { defaultValue: 'Runde {{num}} berechnen', num: activeSessionData.session.currentRound })} <ArrowRight size={14} />
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Parallel Responses Grid */}
                    {activeSessionData.messages.filter(m => m.roundNumber === activeRoundTab).length > 0 && (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {activeSessionData.session.participants.map((participant) => {
                          const msg = activeSessionData.messages.find(
                            m => m.roundNumber === activeRoundTab && m.participantId === participant.id
                          );
                          return (
                            <div
                              key={participant.id}
                              className="bg-slate-900/50 rounded-xl border border-white/5 overflow-hidden flex flex-col shadow-xl"
                            >
                              <div className="px-5 py-4 border-b border-white/5 bg-slate-950/20 flex items-center justify-between shrink-0">
                                <div className="min-w-0">
                                  <h4 className="text-xs font-bold text-white truncate font-display">{participant.name}</h4>
                                  <p className="text-[9px] text-slate-500 font-mono truncate">{participant.modelId || 'Louis AI'}</p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {Boolean((msg?.fallbackMetadata as { usedFallback?: boolean } | undefined)?.usedFallback) && (
                                    <span className="text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md uppercase shrink-0 flex items-center gap-1" title={(msg?.fallbackMetadata as { fallbackReason?: string } | undefined)?.fallbackReason || 'Fallback verwendet'}>
                                      <AlertCircle size={10} /> Fallback
                                    </span>
                                  )}
                                  <span className="text-[9px] font-mono text-slate-600 border border-white/5 px-2 py-0.5 rounded-md uppercase shrink-0">
                                    Temp: {participant.temperature}
                                  </span>
                                </div>
                              </div>
                              <div className="p-5 flex-1 overflow-y-auto custom-scrollbar max-h-96 min-h-[16rem] bg-slate-950/10">
                                {msg ? (
                                  renderMarkdown(msg.content)
                                ) : (
                                  <div className="flex items-center gap-2 text-xs font-mono text-slate-600 justify-center h-full">
                                    <Loader2 size={14} className="animate-spin" /> {t('council:generating_draft', { defaultValue: 'Generiere Entwurf...' })}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-slate-600 font-mono">
                  {t('council:session_load_error', { defaultValue: 'Session konnte nicht geladen werden.' })}
                </div>
              )
            ) : (
              // No Session Selected Landing
              <motion.div
                key="landing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 flex flex-col items-center justify-center p-8 max-w-md mx-auto text-center"
              >
                <div className="p-6 bg-accent-orange/10 border border-accent-orange/20 rounded-2xl text-accent-orange mb-6 shadow-xl shadow-accent-orange/5 animate-pulse">
                  <Users size={40} />
                </div>
                <h3 className="text-lg font-black text-white uppercase italic tracking-wider font-display mb-2">{t('council:welcome_title', { defaultValue: 'Louis Council' })}</h3>
                <p className="text-slate-400 text-xs tracking-wide leading-relaxed font-medium mb-6">
                  {t('council:welcome_text', { defaultValue: 'Willkommen im LLM Council. Dieses autarke System ermöglicht es Ihnen, strategische Entscheidungen durch parallele Debatten mehrerer KI-Agenten zu evaluieren und verfeinern zu lassen.' })}
                </p>
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-2 px-6 py-3 bg-accent-orange hover:bg-accent-orange/85 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-lg shadow-accent-orange/15"
                >
                  <Plus size={14} /> {t('council:start_new_debate', { defaultValue: 'Neue Debatte starten' })}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Modal: In Wissensdatenbank Speichern */}
      <AnimatePresence>
        {isSaveKbModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-white/10 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-6 relative"
            >
              <button
                type="button"
                onClick={() => setIsSaveKbModalOpen(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>

              <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                <div className="p-2.5 bg-accent-orange/10 border border-accent-orange/20 rounded-xl text-accent-orange">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase italic tracking-wider font-display">{t('council:save_kb_title', { defaultValue: 'In Wissensdatenbank Speichern' })}</h3>
                  <p className="text-xs text-slate-400 font-mono">{t('council:save_kb_subtitle', { defaultValue: 'Speichern Sie diese Debatte für RAG-Analysen und KI-Recherchen im CRM.' })}</p>
                </div>
              </div>

              <div className="space-y-3">
                <label className="block text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">
                  {t('council:save_scope_label', { defaultValue: 'Umfang der Speicherung' })}
                </label>

                <div className="space-y-3">
                  <div
                    onClick={() => setKbSaveOption('full')}
                    className={cn(
                      "p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3",
                      kbSaveOption === 'full'
                        ? "bg-accent-orange/10 border-accent-orange text-white"
                        : "bg-slate-800/40 border-white/5 text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <input
                      type="radio"
                      name="kbSaveOption"
                      checked={kbSaveOption === 'full'}
                      onChange={() => setKbSaveOption('full')}
                      className="mt-1 accent-accent-orange"
                    />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-white uppercase tracking-wider">{t('council:save_full_title', { defaultValue: 'Gesamte Debatte (Granular)' })}</p>
                      <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
                        {t('council:save_full_desc', { defaultValue: 'Speichert alle Diskussionsrunden, Personas, Zwischenergebnisse der Agenten UND das abschließende Ergebnis.' })}
                      </p>
                    </div>
                  </div>

                  <div
                    onClick={() => setKbSaveOption('summary_only')}
                    className={cn(
                      "p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3",
                      kbSaveOption === 'summary_only'
                        ? "bg-accent-orange/10 border-accent-orange text-white"
                        : "bg-slate-800/40 border-white/5 text-slate-400 hover:text-slate-200"
                    )}
                  >
                    <input
                      type="radio"
                      name="kbSaveOption"
                      checked={kbSaveOption === 'summary_only'}
                      onChange={() => setKbSaveOption('summary_only')}
                      className="mt-1 accent-accent-orange"
                    />
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-white uppercase tracking-wider">{t('council:save_kb_synthesis_only_label', { defaultValue: 'Nur Endergebnis / Synthese' })}</p>
                      <p className="text-[11px] text-slate-400 font-mono leading-relaxed">
                        {t('council:save_kb_synthesis_only_desc', { defaultValue: 'Speichert ausschließlich die finale Synthese (Consensus Report) und das Hauptthema.' })}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setIsSaveKbModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors font-mono"
                >
                  {t('common:cancel', { defaultValue: 'Abbrechen' })}
                </button>
                <button
                  type="button"
                  onClick={handleSaveToKnowledgeBase}
                  disabled={saveToKbMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-accent-orange hover:bg-accent-orange/85 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-colors shadow-lg shadow-accent-orange/15 font-mono"
                >
                  {saveToKbMutation.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> {t('common:saving', { defaultValue: 'Speichere...' })}
                    </>
                  ) : (
                    <>
                      <BookOpen size={14} /> {t('common:save', { defaultValue: 'Speichern' })}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Modal: Debatte Löschen Bestätigung */}
        {sessionToDelete && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl"
            >
              <div className="flex items-center gap-3.5 text-red-400">
                <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl shrink-0">
                  <Trash2 size={22} />
                </div>
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wide text-white font-display">
                    {t('council:confirm_delete_title', { defaultValue: 'Debatte löschen' })}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {t('council:confirm_delete_sub', { defaultValue: 'Unwiderruflicher Schritt' })}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-white/5 text-xs text-slate-300 font-mono leading-relaxed">
                {t('council:confirm_delete_session', { defaultValue: 'Möchten Sie diese Diskussions-Session und alle dazugehörigen Nachrichten wirklich unwiderruflich löschen?' })}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSessionToDelete(null)}
                  disabled={deleteSessionMutation.isPending}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold font-mono rounded-lg transition-colors uppercase tracking-wider"
                >
                  {t('common:cancel', { defaultValue: 'Abbrechen' })}
                </button>
                <button
                  type="button"
                  onClick={() => deleteSessionMutation.mutate({ id: sessionToDelete })}
                  disabled={deleteSessionMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold font-mono rounded-lg transition-colors uppercase tracking-wider shadow-lg shadow-red-600/20"
                >
                  {deleteSessionMutation.isPending ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> {t('common:deleting', { defaultValue: 'Lösche...' })}
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} /> {t('common:confirm_delete_btn', { defaultValue: 'Unwiderruflich Löschen' })}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
