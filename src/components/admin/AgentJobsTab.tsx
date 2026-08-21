// ============================================================================
// Agent-Jobs-Verwaltung (S7/S11) — Admin-Tab
// Liste, Anlegen (agent/script/monitor), Editieren, Aktiv-Toggle, Löschen.
// Texte via i18n (admin:agent_jobs.*, common:*).
// ============================================================================

import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useTranslation } from "react-i18next";

interface JobRow {
  id_uuid: string;
  job_name: string;
  job_prompt: string;
  schedule_type: string;
  schedule_time?: string | null;
  schedule_weekday?: number | null;
  deliver_to: string;
  deliver_target?: string | null;
  is_active: boolean;
  last_run_at_utc?: string | null;
  job_type?: string | null;
  script_path?: string | null;
  allowed_domains?: string[] | null;
}

const SCHEDULE_LABEL_KEY: Record<string, string> = {
  hourly: "admin:agent_jobs.schedule_hourly",
  daily: "admin:agent_jobs.schedule_daily",
  weekly: "admin:agent_jobs.schedule_weekly"
};

const DELIVER_LABEL_KEY: Record<string, string> = {
  session: "admin:agent_jobs.deliver_session",
  mail_draft: "admin:agent_jobs.deliver_mail_draft",
  telegram: "admin:agent_jobs.deliver_telegram"
};

export function AgentJobsTab() {
  const { t } = useTranslation(["admin", "common"]);
  const { data: jobs = [], isLoading, refetch } = trpc.listAgentJobs.useQuery();
  const toggleMutation = trpc.toggleAgentJob.useMutation({ onSuccess: () => refetch() });
  const createMutation = trpc.createAgentJob.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    }
  });
  const updateMutation = trpc.updateAgentJob.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    }
  });
  const deleteMutation = trpc.deleteAgentJob.useMutation({
    onSuccess: () => {
      refetch();
      setConfirmDeleteId(null);
    }
  });

  const [jobName, setJobName] = useState("");
  const [jobPrompt, setJobPrompt] = useState("");
  const [jobType, setJobType] = useState<"agent" | "script" | "monitor">("agent");
  const [scriptPath, setScriptPath] = useState("");
  const [scheduleType, setScheduleType] = useState<"hourly" | "daily" | "weekly">("hourly");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleWeekday, setScheduleWeekday] = useState("1");
  const [deliverTo, setDeliverTo] = useState<"session" | "mail_draft" | "telegram">("session");
  const [deliverTarget, setDeliverTarget] = useState("");
 // P1-3: optionale Tool-Domänen-Einschränkung (leer = alle Domänen)
  type DomainOption = "CORE" | "CRM_READ" | "CRM_WRITE" | "KNOWLEDGE" | "KANBAN" | "TEMPLATES" | "WORKFLOWS";
  const [allowedDomains, setAllowedDomains] = useState<DomainOption[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const DOMAIN_OPTIONS = ["CORE", "CRM_READ", "CRM_WRITE", "KNOWLEDGE", "KANBAN", "TEMPLATES", "WORKFLOWS"] as const;
  const runNowMutation = trpc.runJobNow.useMutation({
    onSuccess: () => {
      refetch();
      setRunningJobId(null);
    },
    onError: () => setRunningJobId(null)
  });

  const resetForm = () => {
    setJobName("");
    setJobPrompt("");
    setJobType("agent");
    setScriptPath("");
    setScheduleType("hourly");
    setScheduleTime("09:00");
    setScheduleWeekday("1");
    setDeliverTo("session");
    setDeliverTarget("");
    setAllowedDomains([]);
    setEditingId(null);
    setErrorMsg("");
  };

  const handleStartEdit = (job: JobRow) => {
    setEditingId(job.id_uuid);
    setJobName(job.job_name);
    setJobPrompt(job.job_prompt);
    setJobType((job.job_type as "agent" | "script" | "monitor") || "agent");
    setScriptPath(job.script_path || "");
    setScheduleType((job.schedule_type as "hourly" | "daily" | "weekly") || "hourly");
    setScheduleTime(job.schedule_time || "09:00");
    setScheduleWeekday(String(job.schedule_weekday ?? 1));
    setDeliverTo((job.deliver_to as "session" | "mail_draft" | "telegram") || "session");
    setDeliverTarget(job.deliver_target || "");
    setAllowedDomains((job.allowed_domains as string[] | null | undefined) || []);
    setErrorMsg("");
  };

  const handleSave = () => {
    if (!jobName.trim() || !jobPrompt.trim()) {
      setErrorMsg(t("admin:agent_jobs.error_name_prompt", { defaultValue: "Bitte Job-Name und Prompt angeben." }));
      return;
    }
    if ((jobType === "script" || jobType === "monitor") && !scriptPath.trim()) {
      setErrorMsg(t("admin:agent_jobs.error_script_path", { defaultValue: "script_path ist für script/monitor-Jobs erforderlich." }));
      return;
    }
    setErrorMsg("");
    const payload = {
      job_name: jobName.trim(),
      job_prompt: jobPrompt.trim(),
      schedule_type: scheduleType,
      schedule_time: scheduleType === "daily" || scheduleType === "weekly" ? scheduleTime : undefined,
      schedule_weekday: scheduleType === "weekly" ? Number(scheduleWeekday) : undefined,
      deliver_to: deliverTo,
      deliver_target: deliverTo === "mail_draft" ? deliverTarget : undefined,
      job_type: jobType,
      script_path: scriptPath.trim() || undefined,
      allowed_domains: allowedDomains.length > 0 ? allowedDomains : undefined
    };
    if (editingId) {
      updateMutation.mutate({ id_uuid: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString("de-DE") : "—");
  const weekdays = t("admin:agent_jobs.weekdays", { returnObjects: true, defaultValue: ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] }) as string[];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-white uppercase tracking-wide">
          {t("admin:agent_jobs.title", { defaultValue: "Agent-Jobs (Cron)" })}
        </h2>
        <p className="text-sm text-slate-400">
          {t("admin:agent_jobs.desc", { defaultValue: "Automatische Agent-/Script-/Monitor-Jobs. Jobs lassen sich bearbeiten, pausieren oder löschen." })}
        </p>
      </div>

      {/* Create / Edit */}
      <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest">
          {editingId
            ? t("admin:agent_jobs.edit_job", { defaultValue: "Job bearbeiten" })
            : t("admin:agent_jobs.new_job", { defaultValue: "Neuer Job" })}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder={t("admin:agent_jobs.job_name_placeholder", { defaultValue: "Job-Name (z. B. Täglicher Statusbericht)" })}
            className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          <select value={jobType} onChange={(e) => setJobType(e.target.value as "agent" | "script" | "monitor")}
            className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            <option value="agent">{t("admin:agent_jobs.job_type_agent", { defaultValue: "Agent-Job (LLM)" })}</option>
            <option value="script">{t("admin:agent_jobs.job_type_script", { defaultValue: "Script-Job (Watchdog)" })}</option>
            <option value="monitor">{t("admin:agent_jobs.job_type_monitor", { defaultValue: "Monitor-Job (Hash-Diff)" })}</option>
          </select>
          <input value={jobPrompt} onChange={(e) => setJobPrompt(e.target.value)} placeholder={jobType === "agent"
            ? t("admin:agent_jobs.prompt_placeholder_agent", { defaultValue: "Prompt für den Agenten" })
            : t("admin:agent_jobs.prompt_placeholder_alarm", { defaultValue: "Instruktion bei Alarm/Änderung" })}
            className="col-span-2 bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          {(jobType === "script" || jobType === "monitor") && (
            <input value={scriptPath} onChange={(e) => setScriptPath(e.target.value)} placeholder={t("admin:agent_jobs.script_path_placeholder", { defaultValue: "script_path (z. B. watchdog.sh, liegt in louis-scripts)" })}
              className="col-span-2 bg-primary-light border border-accent-orange/30 rounded-xl px-3 py-2 text-sm text-white" />
          )}
          <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as "hourly" | "daily" | "weekly")}
            className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            <option value="hourly">{t("admin:agent_jobs.schedule_hourly", { defaultValue: "Stündlich" })}</option>
            <option value="daily">{t("admin:agent_jobs.schedule_daily", { defaultValue: "Täglich" })}</option>
            <option value="weekly">{t("admin:agent_jobs.schedule_weekly", { defaultValue: "Wöchentlich" })}</option>
          </select>
          {scheduleType === "daily" && (
            <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
              className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          )}
          {scheduleType === "weekly" && (
            <>
              <select value={scheduleWeekday} onChange={(e) => setScheduleWeekday(e.target.value)}
                className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
                {weekdays.map((d, i) => (
                  <option key={i + 1} value={String(i + 1)}>{d}</option>
                ))}
              </select>
              <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
            </>
          )}
          {scheduleType === "hourly" && (
            <div className="flex items-center text-[11px] text-slate-500 px-1">
              {t("admin:agent_jobs.hourly_hint", { defaultValue: "Läuft jede volle Stunde (kein Zeitfeld nötig)" })}
            </div>
          )}
          <select value={deliverTo} onChange={(e) => setDeliverTo(e.target.value as "session" | "mail_draft" | "telegram")}
            className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
            <option value="session">{t("admin:agent_jobs.deliver_session", { defaultValue: "Chat-Session" })}</option>
            <option value="mail_draft">{t("admin:agent_jobs.deliver_mail_draft", { defaultValue: "Mail-Entwurf" })}</option>
            <option value="telegram">{t("admin:agent_jobs.deliver_telegram", { defaultValue: "Telegram" })}</option>
          </select>
          {deliverTo === "mail_draft" && (
            <input value={deliverTarget} onChange={(e) => setDeliverTarget(e.target.value)} placeholder={t("admin:agent_jobs.recipient_email_placeholder", { defaultValue: "Empfänger-E-Mail" })}
              className="bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
          )}
          {/* P1-3: optionale Tool-Domänen-Einschränkung (nur für agent-Jobs sinnvoll) */}
          {jobType === "agent" && (
            <div className="col-span-2 space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {t("admin:agent_jobs.allowed_domains_label", { defaultValue: "Tool-Domänen (leer = alle)" })}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {DOMAIN_OPTIONS.map((d) => {
                  const active = allowedDomains.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setAllowedDomains(prev => active ? prev.filter(x => x !== d) : [...prev, d])}
                      className={`text-[9px] font-mono font-bold uppercase px-2 py-1 rounded-lg border transition-all cursor-pointer ${active ? "bg-accent-orange/20 border-accent-orange/40 text-accent-orange" : "bg-white/5 border-white/10 text-slate-400 hover:text-slate-200"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-slate-500">
                {t("admin:agent_jobs.allowed_domains_hint", { defaultValue: "Begrenzt, welche Tool-Domänen der Job-Agent nutzen darf (z. B. nur CRM_READ für Reports). Leer = alle Domänen." })}
              </p>
            </div>
          )}
        </div>
        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 text-white font-bold text-xs uppercase px-4 py-2 rounded-xl disabled:opacity-50">
            {editingId
              ? t("admin:agent_jobs.save_changes_btn", { defaultValue: "Änderungen speichern" })
              : t("admin:agent_jobs.create_btn", { defaultValue: "Job anlegen" })}
          </button>
          {editingId && (
            <button onClick={resetForm}
              className="px-4 py-2 border border-white/10 text-slate-400 hover:text-white rounded-xl text-xs font-bold uppercase">
              {t("common:cancel", { defaultValue: "Abbrechen" })}
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-slate-400">{t("admin:agent_jobs.loading", { defaultValue: "Lade Jobs…" })}</p>}
        {(jobs as JobRow[]).map((job) => (
          <div key={job.id_uuid} data-testid="agent-job-card" className="bg-primary-dark border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">{job.job_name}</span>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300">{job.job_type || "agent"}</span>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300">
                  {t(SCHEDULE_LABEL_KEY[job.schedule_type] || "admin:agent_jobs.schedule_hourly", { defaultValue: job.schedule_type })}
                  {job.schedule_type === "daily" && job.schedule_time ? ` ${job.schedule_time}` : ""}
                  {job.schedule_type === "weekly" ? ` ${weekdays[job.schedule_weekday ?? 1]}${job.schedule_time ? ` ${job.schedule_time}` : ""}` : ""}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 line-clamp-2">{job.job_prompt}</p>
              <div className="text-[10px] text-slate-500 mt-1 space-x-3">
                <span>
                  {t("admin:agent_jobs.delivery", { defaultValue: "Zustellung:" })} {t(DELIVER_LABEL_KEY[job.deliver_to] || "admin:agent_jobs.deliver_session", { defaultValue: job.deliver_to })}{job.deliver_target ? ` → ${job.deliver_target}` : ""}
                </span>
                {job.script_path && <span>{t("admin:agent_jobs.script", { defaultValue: "Skript:" })} {job.script_path}</span>}
                {job.allowed_domains && (job.allowed_domains as string[]).length > 0 && (
                  <span className="font-mono">{t("admin:agent_jobs.allowed_domains_badge", { defaultValue: "Domänen:" })} {(job.allowed_domains as string[]).join(", ")}</span>
                )}
                <span>{t("admin:agent_jobs.last_run", { defaultValue: "Letzter Lauf:" })} {fmtDate(job.last_run_at_utc)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {confirmDeleteId === job.id_uuid ? (
                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-xl">
                  <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">{t("admin:agent_jobs.confirm_delete", { defaultValue: "Löschen?" })}</span>
                  <button
                    onClick={() => deleteMutation.mutate({ id_uuid: job.id_uuid })}
                    className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[10px] font-bold uppercase transition-all">
                    {t("common:yes", { defaultValue: "Ja" })}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[10px] font-bold uppercase transition-all">
                    {t("common:no", { defaultValue: "Nein" })}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => handleStartEdit(job)}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-accent-orange hover:border-accent-orange/40 transition-all"
                    title={t("admin:agent_jobs.edit_tooltip", { defaultValue: "Job bearbeiten" })}>
                    {t("common:edit", { defaultValue: "Bearbeiten" })}
                  </button>
                  {/* P1-3: Jetzt ausführen (Ad-hoc/Test) */}
                  <button
                    data-testid="agent-job-run-now"
                    onClick={() => {
                      setRunningJobId(job.id_uuid);
                      runNowMutation.mutate({ id_uuid: job.id_uuid });
                    }}
                    disabled={runningJobId === job.id_uuid}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10 transition-all disabled:opacity-50"
                    title={t("admin:agent_jobs.run_now_tooltip", { defaultValue: "Job jetzt sofort ausführen (unabhängig vom Zeitplan)" })}>
                    {runningJobId === job.id_uuid ? t("admin:agent_jobs.running", { defaultValue: "Läuft…" }) : t("admin:agent_jobs.run_now", { defaultValue: "Jetzt ausführen" })}
                  </button>
                  <button
                    onClick={() => toggleMutation.mutate({ id_uuid: job.id_uuid })}
                    className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border ${job.is_active ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300" : "bg-white/5 border-white/10 text-slate-400"}`}
                    title={t("common:toggle", { defaultValue: "Aktivieren/Deaktivieren" })}>
                    {job.is_active ? t("common:active", { defaultValue: "Aktiv" }) : t("common:inactive", { defaultValue: "Inaktiv" })}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(job.id_uuid)}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/40 transition-all"
                    title={t("admin:agent_jobs.delete_tooltip", { defaultValue: "Job löschen" })}>
                    {t("common:delete", { defaultValue: "Löschen" })}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {!isLoading && (jobs as JobRow[]).length === 0 && <p className="text-sm text-slate-500">{t("admin:agent_jobs.empty", { defaultValue: "Noch keine Jobs angelegt." })}</p>}
      </div>
    </div>
  );
}
