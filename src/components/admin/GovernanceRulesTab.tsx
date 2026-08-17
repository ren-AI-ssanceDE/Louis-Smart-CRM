// ============================================================================
// Governance-Rules-Verwaltung (S8) — Admin-Tab
// Liste, Anlegen, Editieren, Aktiv-Toggle, Löschen.
// Priorität: BLOCK > ASK > REQUIRE_APPROVAL > ALLOW (strengste Regel gewinnt).
// Texte via i18n (admin:governance_rules.*, common:*).
// ============================================================================

import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useTranslation } from "react-i18next";

interface RuleRow {
  id_uuid: string;
  rule_name: string;
  entity_type?: string | null;
  action: string;
  effect: string;
  note?: string | null;
  is_active: boolean;
  created_at_utc?: string | null;
}

const EFFECT_COLORS: Record<string, string> = {
  BLOCK: "bg-red-600/20 border-red-500/40 text-red-300",
  ASK: "bg-amber-600/20 border-amber-500/40 text-amber-300",
  REQUIRE_APPROVAL: "bg-blue-600/20 border-blue-500/40 text-blue-300",
  ALLOW: "bg-emerald-600/20 border-emerald-500/40 text-emerald-300"
};

const ENTITY_OPTIONS = [
  { value: "", key: "admin:governance_rules.entity_all" },
  { value: "contacts", key: "admin:governance_rules.entity_contacts" },
  { value: "companies", key: "admin:governance_rules.entity_companies" },
  { value: "invoices", key: "admin:governance_rules.entity_invoices" },
  { value: "offers", key: "admin:governance_rules.entity_offers" },
  { value: "emails", key: "admin:governance_rules.entity_emails" },
  { value: "kanban_board", key: "admin:governance_rules.entity_kanban_board" },
  { value: "kanban_column", key: "admin:governance_rules.entity_kanban_column" },
  { value: "kanban_card", key: "admin:governance_rules.entity_kanban_card" },
  { value: "notes", key: "admin:governance_rules.entity_notes" }
];

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "SEND", "MOVE", "EXPORT", "EXECUTE"] as const;
const EFFECTS = ["BLOCK", "ASK", "REQUIRE_APPROVAL", "ALLOW"] as const;

export function GovernanceRulesTab() {
  const { t } = useTranslation(["admin", "common"]);
  const { data: rules = [], isLoading, refetch } = trpc.listGovernanceRules.useQuery();
  const toggleMutation = trpc.toggleGovernanceRule.useMutation({ onSuccess: () => refetch() });
  const createMutation = trpc.createGovernanceRule.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    }
  });
  const updateMutation = trpc.updateGovernanceRule.useMutation({
    onSuccess: () => {
      refetch();
      resetForm();
    }
  });
  const deleteMutation = trpc.deleteGovernanceRule.useMutation({
    onSuccess: () => {
      refetch();
      setConfirmDeleteId(null);
    }
  });

  const [ruleName, setRuleName] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("CREATE");
  const [effect, setEffect] = useState<(typeof EFFECTS)[number]>("BLOCK");
  const [note, setNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const resetForm = () => {
    setRuleName("");
    setEntityType("");
    setAction("CREATE");
    setEffect("BLOCK");
    setNote("");
    setEditingId(null);
    setErrorMsg("");
  };

  const handleStartEdit = (rule: RuleRow) => {
    setEditingId(rule.id_uuid);
    setRuleName(rule.rule_name);
    setEntityType(rule.entity_type || "");
    setAction((rule.action as (typeof ACTIONS)[number]) || "CREATE");
    setEffect((rule.effect as (typeof EFFECTS)[number]) || "BLOCK");
    setNote(rule.note || "");
    setErrorMsg("");
  };

  const handleSave = () => {
    if (!ruleName.trim()) {
      setErrorMsg(t("admin:governance_rules.error_name", { defaultValue: "Regelname ist erforderlich." }));
      return;
    }
    setErrorMsg("");
    const payload = {
      rule_name: ruleName.trim(),
      entity_type: entityType.trim() || null,
      action,
      effect,
      note: note.trim()
    };
    if (editingId) {
      updateMutation.mutate({ id_uuid: editingId, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const actionLabel = (a: string) => t(`admin:governance_rules.action_labels.${a}`, { defaultValue: a });
  const actionDesc = (a: string) => t(`admin:governance_rules.action_descs.${a}`, { defaultValue: a });
  const effectLabel = (e: string) => t(`admin:governance_rules.effect_labels.${e}`, { defaultValue: e });
  const effectDesc = (e: string) => t(`admin:governance_rules.effect_descs.${e}`, { defaultValue: e });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-black text-white uppercase tracking-wide">
          {t("admin:governance_rules.title", { defaultValue: "Governance-Regeln" })}
        </h2>
        <p className="text-sm text-slate-400">
          {t("admin:governance_rules.desc", { defaultValue: "Steuern, welche Aktionen der AI-Agent ausführen darf. Gilt für Aktionen im Chat und in Workflows. Strengste Regel gewinnt: BLOCK > ASK > REQUIRE_APPROVAL > ALLOW. Trifft keine Regel zu, ist die Aktion erlaubt." })}
        </p>
      </div>

      {/* Create / Edit */}
      <div className="bg-primary-dark border border-white/10 rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest">
          {editingId
            ? t("admin:governance_rules.edit_rule", { defaultValue: "Regel bearbeiten" })
            : t("admin:governance_rules.new_rule", { defaultValue: "Neue Regel" })}
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder={t("admin:governance_rules.rule_name_placeholder", { defaultValue: "Regelname (z. B. Angebote nur mit Freigabe)" })}
            className="col-span-2 bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />

          <div className="col-span-2 space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {t("admin:governance_rules.entity_label", { defaultValue: "Gilt für (Entität) — leer = alle Datensätze" })}
            </label>
            <select
              value={ENTITY_OPTIONS.some((o) => o.value === entityType) ? entityType : ""}
              onChange={(e) => setEntityType(e.target.value)}
              className="w-full bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
            >
              {ENTITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.key, { defaultValue: o.value || "Alle Entitäten" })}</option>
              ))}
            </select>
            {entityType && !ENTITY_OPTIONS.some((o) => o.value === entityType) && (
              <p className="text-[10px] text-amber-400">
                {t("admin:governance_rules.custom_entity_hint", { entity: entityType, defaultValue: "Benutzerdefinierte Entität: {{entity}}" })}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {t("admin:governance_rules.action_label", { defaultValue: "Aktion" })}
            </label>
            <select value={action} onChange={(e) => setAction(e.target.value as (typeof ACTIONS)[number])}
              className="w-full bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{actionLabel(a)}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 leading-tight">{actionDesc(action)}</p>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              {t("admin:governance_rules.effect_label", { defaultValue: "Wirkung" })}
            </label>
            <select value={effect} onChange={(e) => setEffect(e.target.value as (typeof EFFECTS)[number])}
              className="w-full bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white">
              {EFFECTS.map((e) => (
                <option key={e} value={e}>{effectLabel(e)}</option>
              ))}
            </select>
            <p className="text-[10px] text-slate-500 leading-tight">{effectDesc(effect)}</p>
          </div>

          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin:governance_rules.note_placeholder", { defaultValue: "Begründung / Hinweis für den Agenten (wird bei ASK dem Nutzer gezeigt)" })}
            className="col-span-2 bg-primary-light border border-white/10 rounded-xl px-3 py-2 text-sm text-white" />
        </div>
        {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}
            className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 text-white font-bold text-xs uppercase px-4 py-2 rounded-xl disabled:opacity-50">
            {editingId
              ? t("admin:governance_rules.save_changes_btn", { defaultValue: "Änderungen speichern" })
              : t("admin:governance_rules.create_btn", { defaultValue: "Regel anlegen" })}
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
        {isLoading && <p className="text-sm text-slate-400">{t("admin:governance_rules.loading", { defaultValue: "Lade Regeln…" })}</p>}
        {(rules as RuleRow[]).map((rule) => (
          <div key={rule.id_uuid} data-testid="governance-rule-card" className="bg-primary-dark border border-white/10 rounded-2xl p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">{rule.rule_name}</span>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300" title={t("admin:governance_rules.entity_label", { defaultValue: "Gilt für (Entität) — leer = alle Datensätze" })}>
                  {rule.entity_type || t("admin:governance_rules.entity_all", { defaultValue: "ALLE" })}
                </span>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-white/10 text-slate-300" title={actionDesc(rule.action)}>
                  {actionLabel(rule.action)}
                </span>
                <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${EFFECT_COLORS[rule.effect] || "bg-white/10 text-slate-300"}`} title={effectDesc(rule.effect)}>
                  {effectLabel(rule.effect)}
                </span>
              </div>
              {rule.note && <p className="text-xs text-slate-400 mt-1">{rule.note}</p>}
              <p className="text-[10px] text-slate-500 mt-1 italic">
                {t("admin:governance_rules.effect_hint", { desc: effectDesc(rule.effect), defaultValue: "Wirkung: {{desc}}" })}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {confirmDeleteId === rule.id_uuid ? (
                <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-xl">
                  <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">{t("admin:governance_rules.confirm_delete", { defaultValue: "Löschen?" })}</span>
                  <button
                    onClick={() => deleteMutation.mutate({ id_uuid: rule.id_uuid })}
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
                    onClick={() => handleStartEdit(rule)}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:text-accent-orange hover:border-accent-orange/40 transition-all"
                    title={t("admin:governance_rules.edit_tooltip", { defaultValue: "Regel bearbeiten" })}>
                    {t("common:edit", { defaultValue: "Bearbeiten" })}
                  </button>
                  <button
                    onClick={() => toggleMutation.mutate({ id_uuid: rule.id_uuid })}
                    className={`text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border ${rule.is_active ? "bg-emerald-600/20 border-emerald-500/40 text-emerald-300" : "bg-white/5 border-white/10 text-slate-400"}`}
                    title={t("admin:governance_rules.toggle_tooltip", { defaultValue: "Regel aktivieren/deaktivieren" })}>
                    {rule.is_active ? t("common:active", { defaultValue: "Aktiv" }) : t("common:inactive", { defaultValue: "Inaktiv" })}
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(rule.id_uuid)}
                    className="text-[10px] font-bold uppercase px-3 py-1.5 rounded-lg border border-white/10 text-slate-400 hover:text-red-400 hover:border-red-500/40 transition-all"
                    title={t("admin:governance_rules.delete_tooltip", { defaultValue: "Regel löschen" })}>
                    {t("common:delete", { defaultValue: "Löschen" })}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {!isLoading && (rules as RuleRow[]).length === 0 && <p className="text-sm text-slate-500">{t("admin:governance_rules.empty", { defaultValue: "Keine Regeln vorhanden." })}</p>}
      </div>
    </div>
  );
}
