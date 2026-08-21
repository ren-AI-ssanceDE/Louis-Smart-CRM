// ============================================================================
// Token-Verbrauch — Admin-Tab
// Aggregiert sys_louis_ai_agent_runs: Summen, Ø/Request, Tages-Trend, letzte Läufe.
// Texte via i18n (admin:token_usage.*, common:*).
// ============================================================================

import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useTranslation } from "react-i18next";
import { Activity, TrendingUp, Zap, Clock, Cpu, Layers, ChevronLeft, ChevronRight } from "lucide-react";

// 6-08-15: Pagination für die Läufe-Liste (war unbegrenzt → sehr lange Liste)
const RECENT_PAGE_SIZE = 10;

export function TokenUsageTab() {
  const { t } = useTranslation(["admin", "common"]);
  const { data, isLoading } = trpc.getTokenUsageStats.useQuery({ days: 14 });
  const [recentPage, setRecentPage] = useState(0);

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const fmtDate = (v: string) => {
    try {
      return new Date(v).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return v;
    }
  };

  return (
    <div data-testid="token-usage-tab" className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-white uppercase tracking-wide">
          {t("admin:token_usage.title", { defaultValue: "Token-Verbrauch" })}
        </h2>
        <p className="text-sm text-slate-400">
          {t("admin:token_usage.desc", { defaultValue: "Aggregierte Token-Metriken aller Agent-Läufe (letzte 14 Tage)." })}
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">{t("admin:token_usage.loading", { defaultValue: "Lade Metriken…" })}</p>}

      {data && (
        <div className="space-y-6">
          {/* KPI-Karten */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Activity size={12} className="text-accent-orange" />
                {t("admin:token_usage.total_tokens", { defaultValue: "Tokens gesamt" })}
              </div>
              <div className="text-2xl font-black text-white font-mono">{fmt(data.totalTokens)}</div>
              <div className="text-[10px] text-slate-500">{t("admin:token_usage.runs_count", { count: data.runs, defaultValue: "{{count}} Läufe" })}</div>
            </div>

            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <TrendingUp size={12} className="text-accent-blue" />
                {t("admin:token_usage.avg_per_run", { defaultValue: "Ø Tokens / Lauf" })}
              </div>
              <div className="text-2xl font-black text-white font-mono">{fmt(data.avgTokensPerRun)}</div>
              <div className="text-[10px] text-slate-500">
                {t("admin:token_usage.input_short", { defaultValue: "Input" })}: {fmt(data.inputTokens)} · {t("admin:token_usage.output_short", { defaultValue: "Output" })}: {fmt(data.outputTokens)}
              </div>
            </div>

            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Zap size={12} className="text-emerald-400" />
                {t("admin:token_usage.cached_tokens", { defaultValue: "Gecachte Tokens" })}
              </div>
              <div className="text-2xl font-black text-white font-mono">{fmt(data.cachedTokens)}</div>
              <div className="text-[10px] text-slate-500">{t("admin:token_usage.cached_hint", { defaultValue: "Cache-Treffer (Provider-abhängig)" })}</div>
            </div>

            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Clock size={12} className="text-violet-400" />
                {t("admin:token_usage.runs_total", { defaultValue: "Läufe" })}
              </div>
              <div className="text-2xl font-black text-white font-mono">{data.runs}</div>
              <div className="text-[10px] text-slate-500">{t("admin:token_usage.period", { defaultValue: "Letzte 14 Tage" })}</div>
            </div>
          </div>

          {/* Tages-Trend */}
          {data.byDay.length > 0 && (
            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Cpu size={12} className="text-accent-orange" />
                {t("admin:token_usage.by_day_title", { defaultValue: "Verlauf (Tokens pro Tag)" })}
              </div>
              <div className="flex items-end gap-1.5 h-24">
                {data.byDay.slice(0, 14).reverse().map((d) => {
                  const max = Math.max(...data.byDay.map((x) => x.totalTokens), 1);
                  const h = Math.max(4, Math.round((d.totalTokens / max) * 92));
                  return (
                    <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.totalTokens} Tokens (${d.runs} Läufe)`}>
                      <div className="w-full bg-gradient-to-t from-accent-orange/60 to-accent-blue/60 rounded-t-md" style={{ height: `${h}px` }} />
                      <span className="text-[8px] font-mono text-slate-500">{d.day.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Letzte Läufe — paginiert (10 pro Seite) */}
          {data.recent && data.recent.length > 0 && (
            <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <Layers size={12} className="text-accent-blue" />
                {t("admin:token_usage.recent_title", { defaultValue: "Letzte Läufe" })}
                <span className="ml-auto text-[9px] text-slate-500 font-mono">
                  {t("admin:token_usage.recent_count", { count: data.recent.length, defaultValue: "{{count}} gesamt" })}
                </span>
              </div>
              <div className="space-y-2">
                {data.recent.slice(recentPage * RECENT_PAGE_SIZE, (recentPage + 1) * RECENT_PAGE_SIZE).map((r) => (
                  <div key={r.id_uuid} className="flex items-center justify-between gap-4 bg-primary-light/20 border border-white/5 rounded-xl px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-xs text-slate-300 truncate max-w-[300px]">{r.prompt || "—"}</p>
                      <p className="text-[9px] font-mono text-slate-500">{fmtDate(r.created_at_utc)} · {r.active_tools} {t("admin:token_usage.tools", { defaultValue: "Tools" })} · {r.duration_ms}ms</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-bold text-white font-mono">{fmt(r.total_tokens)}</span>
                      <span className="text-[9px] text-slate-500 block">{t("admin:token_usage.tokens_short", { defaultValue: "Tokens" })}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Pagination-Controls */}
              {data.recent.length > RECENT_PAGE_SIZE && (
                <div className="flex items-center justify-between pt-2" data-testid="token-usage-pagination">
                  <button
                    type="button"
                    data-testid="token-usage-prev"
                    disabled={recentPage === 0}
                    onClick={() => setRecentPage((p) => Math.max(0, p - 1))}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={12} />
                    {t("common:prev_page", { defaultValue: "Zurück" })}
                  </button>
                  <span className="text-[10px] font-mono text-slate-500">
                    {t("admin:token_usage.page_x_of_y", {
                      page: recentPage + 1,
                      pages: Math.max(1, Math.ceil(data.recent.length / RECENT_PAGE_SIZE)),
                      defaultValue: "Seite {{page}} / {{pages}}"
                    })}
                  </span>
                  <button
                    type="button"
                    data-testid="token-usage-next"
                    disabled={(recentPage + 1) * RECENT_PAGE_SIZE >= data.recent.length}
                    onClick={() => setRecentPage((p) => p + 1)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {t("common:next_page", { defaultValue: "Weiter" })}
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}

          {data.runs === 0 && (
            <p className="text-sm text-slate-500 italic">
              {t("admin:token_usage.empty", { defaultValue: "Noch keine Agent-Läufe erfasst. Sobald der AI-Agent im Chat aktiv wird, erscheinen hier die Token-Metriken." })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
