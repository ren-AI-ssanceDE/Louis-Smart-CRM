// ============================================================================
// ASK-Governance-Inbox (S11) — Admin-Tab
// Offene Rückfragen anzeigen und beantworten. Antworten fließen in die
// Zone-2-Injektion (der Agent kennt getroffene Entscheidungen über offene Fragen
// — beantwortete Fragen erscheinen dort nicht mehr).
// ============================================================================

import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

interface QuestionRow {
  id_uuid: string;
  question: string;
  choices_json?: string;
  context_text?: string | null;
  status: string;
  answer?: string | null;
  created_by?: string | null;
  created_at_utc?: string | null;
}

export function AiQuestionsTab() {
  const { data: questions = [], isLoading, refetch } = trpc.listOpenQuestions.useQuery();
  const answerMutation = trpc.answerQuestion.useMutation({
    onSuccess: () => {
      refetch();
      setAnswerDrafts({});
    }
  });
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});

  const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("de-DE") : "—");
  const parseChoices = (raw?: string): string[] => {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-white uppercase tracking-wide">Rückfragen (ASK-Governance)</h2>
        <p className="text-sm text-slate-400">Der Agent stellt Rückfragen, wenn eine Aktion eine Entscheidung erfordert. Offene Fragen beantworten — die Antwort wird dem Agenten im nächsten Gespräch eingespielt.</p>
      </div>

      <div className="space-y-3">
        {isLoading && <p className="text-sm text-slate-400">Lade Rückfragen…</p>}
        {(questions as QuestionRow[]).map((q) => {
          const choices = parseChoices(q.choices_json);
          const isOpen = q.status === "OPEN";
          return (
            <div key={q.id_uuid} className={`bg-primary-dark border rounded-2xl p-4 ${isOpen ? "border-accent-orange/40" : "border-white/10 opacity-70"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${isOpen ? "bg-amber-600/20 border-amber-500/40 text-amber-300" : "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"}`}>
                  {isOpen ? "OFFEN" : "BEANTWORTET"}
                </span>
                <span className="text-[10px] text-slate-500">{fmtDate(q.created_at_utc)}{q.context_text ? ` · ${q.context_text}` : ""}</span>
              </div>
              <p className="text-sm font-medium text-white">{q.question}</p>
              {choices.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {choices.map((c, i) => (
                    <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-slate-300">{c}</span>
                  ))}
                </div>
              )}
              {isOpen ? (
                <div className="flex gap-2 mt-3">
                  <input
                    value={answerDrafts[q.id_uuid] || ""}
                    onChange={(e) => setAnswerDrafts((d) => ({ ...d, [q.id_uuid]: e.target.value }))}
                    placeholder="Antwort eingeben…"
                    className="flex-1 bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                  />
                  <button
                    onClick={() => {
                      const answer = (answerDrafts[q.id_uuid] || "").trim();
                      if (!answer) return;
                      answerMutation.mutate({ question_id: q.id_uuid, answer });
                    }}
                    disabled={answerMutation.isPending || !(answerDrafts[q.id_uuid] || "").trim()}
                    className="bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs uppercase px-4 py-2 rounded-xl disabled:opacity-50">
                    Beantworten
                  </button>
                </div>
              ) : (
                <p className="text-xs text-emerald-300 mt-2">✓ {q.answer || "beantwortet"}</p>
              )}
            </div>
          );
        })}
        {!isLoading && (questions as QuestionRow[]).length === 0 && <p className="text-sm text-slate-500">Keine Rückfragen vorhanden.</p>}
      </div>
    </div>
  );
}
