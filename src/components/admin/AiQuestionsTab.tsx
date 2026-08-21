// ============================================================================
// ASK-Governance-Inbox (S11) — Admin-Tab
// Offene Rückfragen anzeigen und beantworten. Antworten fließen in die
// Zone-2-Injektion (der Agent kennt getroffene Entscheidungen über offene Fragen
// — beantwortete Fragen erscheinen dort nicht mehr).
// ============================================================================

import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
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

const PAGE_SIZE = 10;

export function AiQuestionsTab() {
  const { t } = useTranslation(["admin", "common", "validation_errors"]);
  const { data: questions = [], isLoading, refetch } = trpc.listOpenQuestions.useQuery();
  const answerMutation = trpc.answerQuestion.useMutation({
    onSuccess: () => {
      refetch();
      setAnswerDrafts({});
      setFeedback("question_answered");
    },
    onError: () => setFeedback("question_error")
  });
  const deleteMutation = trpc.deleteQuestion.useMutation({
    onSuccess: () => {
      refetch();
      setFeedback("question_deleted");
    },
    onError: () => setFeedback("question_error")
  });
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(0);
  const [feedback, setFeedback] = useState<"question_answered" | "question_deleted" | "question_error" | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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

  const rows = questions as QuestionRow[];
  // Suche (case-insensitiv) über Frage, Kontext und Antwort — kombinierbar mit Status-Filter.
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((q) => {
        if (statusFilter !== "ALL" && q.status !== statusFilter) return false;
        if (!normalizedSearch) return true;
        return (
          (q.question || "").toLowerCase().includes(normalizedSearch) ||
          (q.context_text || "").toLowerCase().includes(normalizedSearch) ||
          (q.answer || "").toLowerCase().includes(normalizedSearch) ||
          (q.created_by || "").toLowerCase().includes(normalizedSearch)
        );
      }),
    [rows, statusFilter, normalizedSearch]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const applyFeedback = (msg: string | null) => {
    setFeedback(msg);
    if (msg) setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-white uppercase tracking-wide">Rückfragen (ASK-Governance)</h2>
        <p className="text-sm text-slate-400">Der Agent stellt Rückfragen, wenn eine Aktion eine Entscheidung erfordert. Offene Fragen beantworten — die Antwort wird dem Agenten im nächsten Gespräch eingespielt.</p>
      </div>

      {feedback && (
        <div
          data-testid="questions-feedback"
          className={`px-4 py-2 rounded-xl text-sm font-medium border ${
            feedback === "question_error"
              ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
              : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
          }`}
        >
          {feedback === "question_answered" && t('admin:ai_settings.questions_answered_feedback', { defaultValue: '✓ Rückfrage beantwortet — die Entscheidung ist gespeichert und fließt in die nächste Agenten-Antwort ein.' })}
          {feedback === "question_deleted" && t('admin:ai_settings.questions_deleted_feedback', { defaultValue: 'Rückfrage gelöscht.' })}
          {feedback === "question_error" && t('admin:ai_settings.questions_error_feedback', { defaultValue: 'Fehler — Aktion fehlgeschlagen.' })}
        </div>
      )}

      {/* Filter-Leiste (Status + Suche) */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          data-testid="questions-status-filter"
          className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
        >
          <option value="ALL">Alle ({rows.length})</option>
          <option value="OPEN">Offen</option>
          <option value="ANSWERED">Beantwortet</option>
        </select>
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(0);
            }}
            placeholder={t('admin:ai_settings.questions_search_placeholder', { defaultValue: 'Rückfragen durchsuchen…' })}
            data-testid="questions-search-input"
            className="w-full bg-primary-light/20 border border-white/5 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all placeholder:text-slate-500"
          />
        </div>
        <span className="text-xs text-slate-500">
          {filtered.length} Einträge · Seite {safePage + 1}/{pageCount}
        </span>
      </div>

      <div className="space-y-3">
        {isLoading && <p className="text-sm text-slate-400">Lade Rückfragen…</p>}
        {pageRows.map((q) => {
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
                    data-testid={`question-answer-input-${q.id_uuid}`}
                    className="flex-1 bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                  />
                  <button
                    onClick={() => {
                      const answer = (answerDrafts[q.id_uuid] || "").trim();
                      if (!answer) return;
                      answerMutation.mutate({ question_id: q.id_uuid, answer });
                    }}
                    disabled={answerMutation.isPending || !(answerDrafts[q.id_uuid] || "").trim()}
                    data-testid={`question-answer-btn-${q.id_uuid}`}
                    className="bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs uppercase px-4 py-2 rounded-xl disabled:opacity-50">
                    Beantworten
                  </button>
                </div>
              ) : (
                <p className="text-xs text-emerald-300 mt-2">✓ {q.answer || "beantwortet"}</p>
              )}
              <div className="flex justify-end mt-2">
                <button
                  onClick={() => {
                    if (confirmDeleteId === q.id_uuid) {
                      setConfirmDeleteId(null);
                      deleteMutation.mutate({ question_id: q.id_uuid });
                    } else {
                      setConfirmDeleteId(q.id_uuid);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  data-testid={`question-delete-btn-${q.id_uuid}`}
                  className={`text-[10px] font-bold uppercase tracking-wider border rounded-lg px-2 py-1 cursor-pointer disabled:opacity-50 ${
                    confirmDeleteId === q.id_uuid
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : "text-rose-400 hover:text-rose-300 border-rose-500/20 hover:border-rose-500/40"
                  }`}>
                  {confirmDeleteId === q.id_uuid ? t('admin:ai_settings.questions_delete_confirm_short', { defaultValue: 'Wirklich löschen?' }) : t('admin:ai_settings.questions_delete', { defaultValue: 'Löschen' })}
                </button>
              </div>
            </div>
          );
        })}
        {!isLoading && pageRows.length === 0 && (
          <p className="text-sm text-slate-500">
            {normalizedSearch
              ? t('admin:ai_settings.questions_search_no_results', { defaultValue: 'Keine Rückfragen für die Suche gefunden.' })
              : statusFilter === "ALL"
                ? t('admin:ai_settings.questions_empty_all', { defaultValue: 'Keine Rückfragen vorhanden.' })
                : t('admin:ai_settings.questions_empty_filter', { defaultValue: 'Keine Rückfragen im Filter.' })}
          </p>
        )}

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
              className="px-3 py-1.5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer">
              ← Zurück
            </button>
            <span className="text-xs text-slate-500">Seite {safePage + 1} von {pageCount}</span>
            <button
              onClick={() => setPage(safePage + 1)}
              disabled={safePage >= pageCount - 1}
              className="px-3 py-1.5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-bold disabled:opacity-40 cursor-pointer">
              Weiter →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
