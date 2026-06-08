import React, { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { MailDraft } from '../../types';
import { 
  Mail, 
  Check, 
  X, 
  Edit2, 
  Loader2, 
  Clock, 
  AlertCircle,
  Save,
  Trash2,
  Inbox
} from 'lucide-react';

export const EmailDraftsApprovalPanel: React.FC = () => {
  const utils = trpc.useContext();
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  // Queries
  const { data: drafts = [], isLoading, refetch } = trpc.getPending.useQuery(undefined, { refetchInterval: 5000 });

  // Mutations
  const updateDraftMutation = trpc.updateDraft.useMutation({
    onSuccess: () => {
      toast.success("E-Mail-Entwurf erfolgreich aktualisiert!");
      setEditingDraftId(null);
      refetch();
    },
    onError: (err) => {
      toast.error("Fehler beim Aktualisieren: " + err.message);
    }
  });

  const approveMutation = trpc.approve.useMutation({
    onSuccess: () => {
      toast.success("E-Mail-Entwurf freigegeben und gesendet!");
      refetch();
      utils.getWorkflowInstancesLog.invalidate();
    },
    onError: (err) => {
      toast.error("Fehler bei Freigabe: " + err.message);
    }
  });

  const rejectMutation = trpc.reject.useMutation({
    onSuccess: () => {
      toast.success("E-Mail-Entwurf abgelehnt. Der Workflow-Zweig wurde abgebrochen.");
      refetch();
      utils.getWorkflowInstancesLog.invalidate();
    },
    onError: (err) => {
      toast.error("Fehler beim Ablehnen: " + err.message);
    }
  });

  const handleStartEdit = (draft: MailDraft) => {
    setEditingDraftId(draft.id_uuid);
    setEditSubject(draft.subject);
    setEditBody(draft.body);
  };

  const handleSaveEdit = (id: string) => {
    if (!editSubject.trim() || !editBody.trim()) {
      toast.warning("Betreff und Text dürfen nicht leer sein!");
      return;
    }
    updateDraftMutation.mutate({
      id_uuid: id,
      subject: editSubject,
      body: editBody
    });
  };

  const isMutating = updateDraftMutation.isPending || approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Overview stats block / heading */}
      <div className="flex justify-between items-center bg-primary-light/10 border border-white/5 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
            <Clock size={20} className="animate-pulse" />
          </div>
          <div>
            <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
              E-Mail Entwurfsfreigaben
            </h4>
            <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest mt-0.5">
              Sichte, editiere und verwalte die durch LOUIS-Workflows generierten E-Mails vor dem Versand.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white px-3 py-1.5 border border-white/5 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
        >
          Aktualisieren
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 bg-primary-light/10 border border-white/5 rounded-2xl">
          <Loader2 size={32} className="text-amber-500 animate-spin mb-3" />
          <span className="text-xs font-mono text-slate-500 uppercase tracking-widest">Lade ausstehende Entwürfe...</span>
        </div>
      ) : drafts.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center bg-primary-light/10 border border-white/5 rounded-2xl py-20">
          <Inbox size={48} className="text-slate-600 mb-4 opacity-50" />
          <p className="text-sm font-bold text-slate-300">
            Keine ausstehenden E-Mail-Freigaben
          </p>
          <p className="text-xs text-slate-500 max-w-sm mt-1 mx-auto leading-relaxed">
            Aktuell liegen keine unbestätigten E-Mail Entwürfe vor. Falls Workflows mit Freigabepflicht ausgeführt werden, erscheinen diese direkt an dieser Stelle.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft: MailDraft) => {
            const isEditing = editingDraftId === draft.id_uuid;
            
            return (
              <div 
                key={draft.id_uuid}
                className={`bg-primary-light/30 border rounded-2xl overflow-hidden transition-all duration-300 ${isEditing ? 'border-amber-500/30 ring-1 ring-amber-500/10' : 'border-white/5 hover:border-white/10'}`}
              >
                {/* Header metadata row */}
                <div className="p-5 bg-white/[0.01] border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center text-amber-500">
                      <Mail size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-white font-mono">{draft.recipient || 'Kein Empfänger'}</span>
                        <span className="text-[8px] font-mono font-bold uppercase tracking-widest bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded">
                          PENDING APPROVAL
                        </span>
                      </div>
                      <p className="text-[9px] text-slate-500 font-mono mt-0.5">
                        Draft ID: {draft.id_uuid.substring(0, 8)}... • Erzeugt: {new Date(draft.created_at_utc).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-stretch md:self-auto justify-end">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(draft.id_uuid)}
                          disabled={isMutating}
                          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-black text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-lg hover:shadow-amber-500/20"
                        >
                          <Save size={12} />
                          Änderung Speichern
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingDraftId(null)}
                          disabled={isMutating}
                          className="border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all cursor-pointer"
                        >
                          Abbrechen
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(draft)}
                          disabled={isMutating}
                          className="border border-white/5 bg-white/[0.02] hover:bg-white/5 text-slate-300 hover:text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Edit2 size={12} />
                          Bearbeiten
                        </button>
                        <button
                          type="button"
                          onClick={() => approveMutation.mutate({ id_uuid: draft.id_uuid })}
                          disabled={isMutating}
                          className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-neutral-black text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-lg hover:shadow-green-500/20"
                        >
                          <Check size={12} />
                          Freigeben & Senden
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectMutation.mutate({ id_uuid: draft.id_uuid })}
                          disabled={isMutating}
                          className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <X size={12} />
                          Ablehnen
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Draft Contents Area */}
                <div className="p-6 space-y-4">
                  {isEditing ? (
                    <div className="space-y-4">
                      {/* Subject Input */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Betreff</label>
                        <input
                          type="text"
                          value={editSubject}
                          onChange={(e) => setEditSubject(e.target.value)}
                          className="w-full bg-primary-dark border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500/40 transition-all font-sans font-bold"
                        />
                      </div>

                      {/* Msg Body area */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Inhalt / E-Mail Text</label>
                        <textarea
                          rows={10}
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          className="w-full bg-primary-dark border border-white/10 rounded-xl p-4 text-xs text-slate-300 focus:outline-none focus:border-amber-500/40 transition-all font-mono leading-relaxed resize-y h-48"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Betreff</span>
                        <div className="text-white text-sm font-bold bg-primary-dark/30 px-3 py-2 rounded-lg border border-white/[0.03]">
                          {draft.subject || 'Kein Betreff'}
                        </div>
                      </div>

                      <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Nachrichteninhalt</span>
                        <div className="bg-primary-dark/50 p-4 rounded-xl border border-white/[0.03] text-xs text-slate-300 font-normal leading-relaxed whitespace-pre-wrap font-mono min-h-[100px] shadow-inner">
                          {draft.body}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
