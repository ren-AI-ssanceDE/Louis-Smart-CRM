import React, { useState } from 'react';
import { Key, Plus, Trash2, Ban, Copy, Check, ShieldAlert, Cpu, Terminal, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

export const McpSettingsForm = () => {
  const { t } = useTranslation(['admin', 'common']);
  const { data: mcpKeys, refetch: refetchKeys, isLoading } = trpc.listMcpKeys.useQuery();
  const createKeyMutation = trpc.createMcpKey.useMutation();
  const deleteKeyMutation = trpc.deleteMcpKey.useMutation();
  const revokeKeyMutation = trpc.revokeMcpKey.useMutation();

  const [keyName, setKeyName] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read', 'write']);
  const [toolPermissions, setToolPermissions] = useState<Record<string, string[]>>({});
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [keyToDelete, setKeyToDelete] = useState<{ id_uuid: string; key_name: string } | null>(null);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);

  const availableScopes = [
    { id: 'read', label: t('admin:mcp_scope_read', { defaultValue: 'Lesen (crm_list_*, crm_get_*, crm_search_*)' }) },
    { id: 'write', label: t('admin:mcp_scope_write', { defaultValue: 'Schreiben (crm_create_*, crm_update_*)' }) },
    { id: 'admin', label: t('admin:mcp_scope_admin', { defaultValue: 'Admin (AI & Council Operations)' }) },
    { id: 'full_access', label: t('admin:mcp_scope_full', { defaultValue: 'Vollzugriff (*)' }) }
  ];

  const handleScopeToggle = (scopeId: string) => {
    if (selectedScopes.includes(scopeId)) {
      setSelectedScopes(selectedScopes.filter(s => s !== scopeId));
    } else {
      setSelectedScopes([...selectedScopes, scopeId]);
    }
  };

  // Tool-Berechtigungs-Matrix: Tool-Berechtigungs-Matrix (create/update/delete pro Tool).
  // Die Tool-Namen entsprechen GENAU der zentralen Mapping-Tabelle im Server
  // (MCP_TOOL_ACTIONS, mcpServer.ts) — der Drift-Guard-Test  erzwingt das.
  const toolPermissionGroups: Array<{ group: string; tools: Array<{ name: string; label: string }> }> = [
    {
      group: t('admin:mcp_perm_group_companies', { defaultValue: 'Unternehmen' }),
      tools: [
        { name: 'crm_create_company', label: t('admin:mcp_perm_crm_create_company', { defaultValue: 'Unternehmen anlegen' }) },
        { name: 'crm_update_company', label: t('admin:mcp_perm_crm_update_company', { defaultValue: 'Unternehmen aktualisieren' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_contacts', { defaultValue: 'Kontakte' }),
      tools: [
        { name: 'crm_create_contact', label: t('admin:mcp_perm_crm_create_contact', { defaultValue: 'Kontakt anlegen' }) },
        { name: 'crm_update_contact', label: t('admin:mcp_perm_crm_update_contact', { defaultValue: 'Kontakt aktualisieren' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_invoices', { defaultValue: 'Rechnungen' }),
      tools: [
        { name: 'crm_create_invoice', label: t('admin:mcp_perm_crm_create_invoice', { defaultValue: 'Rechnung anlegen' }) },
        { name: 'crm_update_invoice_status', label: t('admin:mcp_perm_crm_update_invoice_status', { defaultValue: 'Rechnungsstatus ändern' }) },
        { name: 'crm_generate_invoice_pdf', label: t('admin:mcp_perm_crm_generate_invoice_pdf', { defaultValue: 'Rechnungs-PDF erzeugen' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_offers', { defaultValue: 'Angebote' }),
      tools: [
        { name: 'crm_create_offer', label: t('admin:mcp_perm_crm_create_offer', { defaultValue: 'Angebot anlegen' }) },
        { name: 'offer_finalize_send', label: t('admin:mcp_perm_offer_finalize_send', { defaultValue: 'Angebot finalisieren & senden' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_kanban', { defaultValue: 'Kanban' }),
      tools: [
        { name: 'kanban_create_board', label: t('admin:mcp_perm_kanban_create_board', { defaultValue: 'Board anlegen' }) },
        { name: 'crm_create_kanban_card', label: t('admin:mcp_perm_crm_create_kanban_card', { defaultValue: 'Karte anlegen' }) },
        { name: 'kanban_update_card', label: t('admin:mcp_perm_kanban_update_card', { defaultValue: 'Karte aktualisieren' }) },
        { name: 'crm_move_kanban_card', label: t('admin:mcp_perm_crm_move_kanban_card', { defaultValue: 'Karte verschieben' }) },
        { name: 'kanban_delete_card', label: t('admin:mcp_perm_kanban_delete_card', { defaultValue: 'Karte löschen' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_notes', { defaultValue: 'Notizen' }),
      tools: [
        { name: 'notes_create', label: t('admin:mcp_perm_notes_create', { defaultValue: 'Notiz anlegen' }) },
        { name: 'notes_update', label: t('admin:mcp_perm_notes_update', { defaultValue: 'Notiz aktualisieren' }) },
        { name: 'notes_delete', label: t('admin:mcp_perm_notes_delete', { defaultValue: 'Notiz löschen' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_vault', { defaultValue: 'Wissensvault' }),
      tools: [
        { name: 'vault_write', label: t('admin:mcp_perm_vault_write', { defaultValue: 'Vault-Datei schreiben' }) },
        { name: 'vault_update', label: t('admin:mcp_perm_vault_update', { defaultValue: 'Vault-Datei aktualisieren' }) },
        { name: 'vault_delete', label: t('admin:mcp_perm_vault_delete', { defaultValue: 'Vault-Datei löschen' }) },
        { name: 'crm_upload_vault_document', label: t('admin:mcp_perm_crm_upload_vault_document', { defaultValue: 'Dokument hochladen' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_mail', { defaultValue: 'E-Mail' }),
      tools: [
        { name: 'mail_approve_draft', label: t('admin:mcp_perm_mail_approve_draft', { defaultValue: 'Mail-Entwurf freigeben' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_workflows', { defaultValue: 'Workflows' }),
      tools: [
        { name: 'workflows_learn', label: t('admin:mcp_perm_workflows_learn', { defaultValue: 'Workflow lernen' }) }
      ]
    },
    {
      group: t('admin:mcp_perm_group_agent', { defaultValue: 'Agent & Council' }),
      tools: [
        { name: 'crm_run_louis_ai', label: t('admin:mcp_perm_crm_run_louis_ai', { defaultValue: 'KI-Assistent ausführen (Chat)' }) },
        { name: 'crm_run_council_deliberation', label: t('admin:mcp_perm_crm_run_council_deliberation', { defaultValue: 'LLM Council ausführen' }) }
      ]
    }
  ];
  // Aktions-Enum: Aktions-Enum erweitert — Entitäts-Tools zeigen create/update/delete,
  // Aktions-Tools (approve/send/run) zeigen EINE Checkbox ("Erlauben"). Die
  // Zuordnung Tool → Aktion kommt vom Server (getToolAction-Semantik, Drift-Guard).
  const ENTITY_ACTIONS: Array<{ id: 'create' | 'update' | 'delete'; label: string }> = [
    { id: 'create', label: t('admin:mcp_perm_action_create', { defaultValue: 'Anlegen' }) },
    { id: 'update', label: t('admin:mcp_perm_action_update', { defaultValue: 'Ändern' }) },
    { id: 'delete', label: t('admin:mcp_perm_action_delete', { defaultValue: 'Löschen' }) }
  ];
  const ACTION_TOOL_ACTIONS: Array<{ id: 'approve' | 'send' | 'run'; label: string }> = [
    { id: 'approve', label: t('admin:mcp_perm_action_approve', { defaultValue: 'Erlauben' }) },
    { id: 'send', label: t('admin:mcp_perm_action_send', { defaultValue: 'Erlauben' }) },
    { id: 'run', label: t('admin:mcp_perm_action_run', { defaultValue: 'Erlauben' }) }
  ];
  // Tools mit Aktions-Semantik (nur eine Checkbox statt Dreiklang)
  const ACTION_TOOLS = new Set(['mail_approve_draft', 'offer_finalize_send', 'crm_run_louis_ai', 'crm_run_council_deliberation']);
  // : Tool-Aktionen des Formulars pro Tool — bei Aktions-Tools nur die passende
  const actionsForTool = (toolName: string) => {
    if (ACTION_TOOLS.has(toolName)) {
      if (toolName === 'mail_approve_draft') return ACTION_TOOL_ACTIONS.filter(a => a.id === 'approve');
      if (toolName === 'offer_finalize_send') return ACTION_TOOL_ACTIONS.filter(a => a.id === 'send');
      return ACTION_TOOL_ACTIONS.filter(a => a.id === 'run');
    }
    return ENTITY_ACTIONS;
  };

  const handleToolPermissionToggle = (tool: string, action: 'create' | 'update' | 'delete' | 'approve' | 'send' | 'run') => {
    setToolPermissions(prev => {
      const current = prev[tool] || [];
      const next = current.includes(action)
        ? current.filter(a => a !== action)
        : [...current, action];
      const result = { ...prev };
      if (next.length === 0) {
        delete result[tool];
      } else {
        result[tool] = next;
      }
      return result;
    });
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setErrorMsg(t('admin:mcp_enter_name', { defaultValue: 'Bitte geben Sie einen Namen für den API-Schlüssel ein.' }));
      return;
    }
    setErrorMsg('');
    try {
      const res = await createKeyMutation.mutateAsync({
        key_name: keyName.trim(),
        scopes: selectedScopes as ("companies" | "contacts" | "invoices" | "offers" | "read" | "write" | "kanban" | "vault" | "council" | "admin")[],
        tool_permissions: Object.keys(toolPermissions).length > 0 ? toolPermissions : null
      });
      setCreatedSecret(res.api_key);
      setKeyName('');
      toast.success(t('admin:mcp_create_success', { defaultValue: 'Neuer MCP API-Schlüssel erfolgreich erstellt.' }));
      refetchKeys();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('admin:mcp_create_error', { defaultValue: 'Fehler beim Erstellen des Schlüssels.' });
      setErrorMsg(msg);
      toast.error(msg);
    }
  };

  const handleConfirmDelete = async () => {
    if (!keyToDelete) return;
    try {
      await deleteKeyMutation.mutateAsync({ id_uuid: keyToDelete.id_uuid });
      toast.success(t('admin:mcp_delete_success', { defaultValue: 'MCP API-Schlüssel wurde erfolgreich gelöscht.' }));
      refetchKeys();
      setKeyToDelete(null);
    } catch (err) {
      // 2026-08-18 (Code-Regel): KEINE rohen Fehlertexte im Browser — generische Meldung, Details serverseitig geloggt.
      toast.error(t('admin:mcp_delete_error', { defaultValue: 'Fehler beim Löschen des API-Schlüssels.' }));
    }
  };

 // P1-1: Sanftes Widerrufen (Key bleibt sichtbar als inaktiv) — Button „Widerrufen“ neben „Löschen“.
  // 2026-08-18 (Code-Regel): KEIN window.confirm — Bestätigung über das etablierte Modal (Browser-Dialoge blockierbar).
  const handleRevokeKey = async (idUuid: string) => {
    try {
      await revokeKeyMutation.mutateAsync({ id_uuid: idUuid });
      toast.success(t('admin:mcp_revoke_success', { defaultValue: 'MCP API-Schlüssel wurde erfolgreich widerrufen.' }));
      refetchKeys();
      setRevokeKeyId(null);
    } catch (err) {
      toast.error(t('admin:mcp_revoke_error', { defaultValue: 'Fehler beim Widerrufen des API-Schlüssels.' }));
    }
  };

  const copyToClipboard = (text: string, setFn: (val: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setFn(true);
    setTimeout(() => setFn(false), 2000);
  };

  const sampleConfig = {
    mcpServers: {
      "louis-crm": {
        url: `${window.location.origin}/api/mcp`,
        headers: {
          Authorization: `Bearer ${createdSecret || 'louis_mcp_YOUR_SECRET_KEY'}`
        }
      }
    }
  };

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl p-6 space-y-8">
      {/* Header & Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div className="flex items-start gap-3">
          <div className="p-3 bg-accent-orange/10 rounded-xl shrink-0">
            <Cpu className="text-accent-orange" size={24} />
          </div>
          <div>
            <h4 className="text-base font-black text-white uppercase tracking-wider font-display flex flex-wrap items-center gap-2">
              Model Context Protocol (MCP) Server
              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                {t('admin:mcp_server_active', { defaultValue: 'Server Aktiv' })}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-mono font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                JSON-RPC 2.0 / SSE
              </span>
            </h4>
            <p className="text-xs text-slate-400 mt-1 font-medium leading-relaxed">
              Verbinden Sie externe KI-Clients (Claude Desktop, Cursor IDE, LangChain, Custom Agents) direkt mit dem Louis CRM via <code className="text-accent-orange bg-black/40 px-1.5 py-0.5 rounded font-mono">/api/mcp</code>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-primary-dark/80 px-4 py-2 rounded-lg border border-white/5">
          <Terminal size={14} className="text-slate-400" />
          <span className="text-xs font-mono text-slate-300">/api/mcp</span>
        </div>
      </div>

      {/* New Secret Created Alert */}
      {createdSecret && (
        <div className="p-5 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider font-display">
            <ShieldAlert size={16} />
            {t('admin:mcp_new_key_generated', { defaultValue: 'Neuer MCP API-Schlüssel generiert — Einmalige Anzeige!' })}
          </div>
          <p className="text-xs text-slate-300">
            {t('admin:mcp_save_secret_notice', { defaultValue: 'Speichern Sie diesen Schlüssel jetzt an einem sicheren Ort. Er wird aus Sicherheitsgründen nie wieder im Klartext angezeigt!' })}
          </p>
          <div className="flex items-center gap-2 bg-black/40 p-3 rounded-lg border border-amber-500/20 font-mono text-sm text-amber-300 break-all select-all">
            <span className="flex-1">{createdSecret}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(createdSecret, setCopiedSecret)}
              className="px-3 py-1.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-sans font-bold flex items-center gap-1.5 transition-all"
            >
              {copiedSecret ? <Check size={14} /> : <Copy size={14} />}
              {copiedSecret ? t('common:copied', { defaultValue: 'Kopiert' }) : t('common:copy', { defaultValue: 'Kopieren' })}
            </button>
          </div>
        </div>
      )}

      {/* Key Creation Form */}
      <form onSubmit={handleCreateKey} className="space-y-4 bg-primary-dark/60 p-5 rounded-xl border border-white/5">
        <h5 className="text-xs font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
          <Plus size={14} className="text-accent-orange" />
          {t('admin:mcp_create_new_key', { defaultValue: 'Neuen MCP API-Schlüssel erstellen' })}
        </h5>

        {errorMsg && (
          <p className="text-xs text-red-400 font-medium">{errorMsg}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
              {t('admin:mcp_key_name_label', { defaultValue: 'Name / Anwendung' })}
            </label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder={t('admin:mcp_name_placeholder', { defaultValue: 'z. B. Cursor Agent, Claude Desktop, AutoGPT' })}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange transition-all font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={createKeyMutation.isPending}
              className="w-full px-4 py-2.5 rounded-lg bg-accent-orange hover:bg-accent-orange/90 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2"
            >
              <Key size={14} />
              {createKeyMutation.isPending ? t('common:generating', { defaultValue: 'Generiere...' }) : t('admin:mcp_create_key_btn', { defaultValue: 'Schlüssel Erstellen' })}
            </button>
          </div>
        </div>

        {/* Scopes Selection */}
        <div className="space-y-2 pt-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display block">
            {t('admin:mcp_scopes_label', { defaultValue: 'Berechtigungs-Bereiche (Scopes)' })}
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availableScopes.map((scope) => (
              <label
                key={scope.id}
                className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center gap-2.5 transition-all ${
                  selectedScopes.includes(scope.id)
                    ? 'bg-accent-orange/10 border-accent-orange/40 text-white'
                    : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.id)}
                  onChange={() => handleScopeToggle(scope.id)}
                  className="rounded border-white/20 text-accent-orange focus:ring-0 bg-black/40"
                />
                <span className="font-mono text-[11px]">{scope.label}</span>
              </label>
            ))}
          </div>
        </div>
        {/* Tool-Berechtigungs-Matrix: Tool-Berechtigungs-Matrix (create/update/delete pro Tool) */}
        <div className="space-y-2 pt-2">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display block">
            {t('admin:mcp_perm_label', { defaultValue: 'Tool-Berechtigungen (optional, pro Tool)' })}
          </label>
          <p className="text-[10px] text-slate-500 font-mono">
            {t('admin:mcp_perm_hint', { defaultValue: 'Leer = generelle Scope-Berechtigung (bisheriges Verhalten). Gesetzt = nur diese Aktionen sind für die externen Clients erlaubt.' })}
          </p>
          <div className="space-y-3 rounded-xl bg-black/20 border border-white/5 p-3">
            {toolPermissionGroups.map((group) => (
              <div key={group.group} className="space-y-1.5">
                <div className="text-[10px] font-bold text-slate-300 uppercase tracking-wider font-display">
                  {group.group}
                </div>
                <div className="space-y-1">
                  {group.tools.map((tool) => (
                    <div key={tool.name} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-[11px] text-slate-400 w-56 truncate" title={tool.name}>
                        {tool.label}
                      </span>
                      <div className="flex items-center gap-3">
                        {actionsForTool(tool.name).map((action) => (
                          <label key={action.id} className="flex items-center gap-1 cursor-pointer text-[11px] text-slate-400 hover:text-white transition-colors">
                            <input
                              type="checkbox"
                              checked={(toolPermissions[tool.name] || []).includes(action.id)}
                              onChange={() => handleToolPermissionToggle(tool.name, action.id)}
                              className="rounded border-white/20 text-accent-orange focus:ring-0 bg-black/40 w-3.5 h-3.5"
                            />
                            {action.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </form>

      {/* Active Keys List */}
      <div className="space-y-3">
        <h5 className="text-xs font-black text-white uppercase tracking-wider font-display">
          {t('admin:mcp_active_keys_title', { defaultValue: 'MCP API-Schlüssel' })} ({mcpKeys?.length || 0})
        </h5>

        {isLoading ? (
          <div className="text-xs text-slate-500 py-4 font-mono">{t('admin:mcp_loading_keys', { defaultValue: 'Lade API-Schlüssel...' })}</div>
        ) : !mcpKeys || mcpKeys.length === 0 ? (
          <div className="p-4 rounded-xl bg-black/20 border border-white/5 text-xs text-slate-500 font-mono italic">
            {t('admin:mcp_no_keys_yet', { defaultValue: 'Noch keine MCP API-Schlüssel erstellt.' })}
          </div>
        ) : (
          <div className="space-y-2">
            {mcpKeys.map((k) => (
              <div
                key={k.id_uuid}
                data-testid="mcp-key-row"
                className="p-4 rounded-xl bg-primary-dark/60 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-white/10 transition-all"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white font-display uppercase tracking-wider">
                      {k.key_name}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 bg-black/40 px-2 py-0.5 rounded border border-white/5">
                      {k.key_prefix}...
                    </span>
                    {/* P1-1: Status-Badge für widerrufene (inaktive) Keys */}
                    {!k.is_active && (
                      <span
                        data-testid="mcp-key-inactive-badge"
                        className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 uppercase"
                      >
                        {t('admin:mcp_key_inactive', { defaultValue: 'Inaktiv' })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {k.scopes.map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 rounded text-[9px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20"
                      >
                        {s}
                      </span>
                    ))}
                    {k.tool_permissions && Object.keys(k.tool_permissions).length > 0 && (
                      <span
                        data-testid="mcp-key-tool-perms"
                        className="px-2 py-0.5 rounded text-[9px] font-mono bg-accent-orange/10 text-accent-orange border border-accent-orange/25"
                      >
                        {Object.entries(k.tool_permissions)
                          .map(([tool, actions]) => `${tool}: ${actions.join('/')}`)
                          .join(' • ')}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500 font-mono ml-2">
                      {t('common:created', { defaultValue: 'Erstellt' })}: {new Date(k.created_at).toLocaleDateString('de-DE')}
                    </span>
                    {k.last_used_at && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        • {t('admin:mcp_last_used', { defaultValue: 'Letzte Nutzung' })}: {new Date(k.last_used_at).toLocaleTimeString('de-DE')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  {/* P1-1: Sanftes Widerrufen — nur bei aktiven Keys; inaktive sind nicht widerrufbar */}
                  {k.is_active && (
                    <button
                      type="button"
                      data-testid="mcp-key-revoke"
                      onClick={() => setRevokeKeyId(k.id_uuid)}
                      disabled={revokeKeyMutation.isPending}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                    >
                      <Ban size={12} />
                      {t('admin:mcp_revoke_btn', { defaultValue: 'Widerrufen' })}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setKeyToDelete({ id_uuid: k.id_uuid, key_name: k.key_name })}
                    disabled={deleteKeyMutation.isPending}
                    className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                  >
                    <Trash2 size={12} />
                    {t('common:delete', { defaultValue: 'Löschen' })}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Integration Helper Code Snippet */}
      <div className="p-5 rounded-xl bg-black/40 border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <ExternalLink size={14} className="text-accent-orange" />
            Integration Config (mcpServers JSON)
          </h5>
          <button
            type="button"
            onClick={() => copyToClipboard(JSON.stringify(sampleConfig, null, 2), setCopiedConfig)}
            className="px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 transition-all"
          >
            {copiedConfig ? <Check size={12} /> : <Copy size={12} />}
            {copiedConfig ? t('common:copied', { defaultValue: 'Kopiert' }) : t('admin:mcp_copy_config', { defaultValue: 'Config Kopieren' })}
          </button>
        </div>
        <pre className="p-3 bg-black/60 rounded-lg border border-white/5 text-[11px] font-mono text-slate-300 overflow-x-auto">
          {JSON.stringify(sampleConfig, null, 2)}
        </pre>
      </div>

      {/* Delete/Revoke Confirmation Modal (2026-08-18: Revoke über dasselbe Modal statt window.confirm — Code-Regel) */}
      <AnimatePresence>
        {(keyToDelete || revokeKeyId) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-[#131722] border border-white/10 p-6 rounded-2xl shadow-2xl relative overflow-hidden space-y-4"
            >
              <div className="flex items-center gap-3 text-rose-500">
                <div className="p-2.5 bg-rose-500/10 rounded-xl">
                  <AlertTriangle size={20} />
                </div>
                <div>
                  <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
                    {revokeKeyId ? t('admin:mcp_revoke_key_title', { defaultValue: 'MCP API-Schlüssel widerrufen' }) : t('admin:mcp_delete_key_title', { defaultValue: 'MCP API-Schlüssel löschen' })}
                  </h4>
                  <p className="text-xs text-slate-400 font-medium">
                    {t('common:irreversible_action', { defaultValue: 'Unwiderrufliche Aktion' })}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-black/30 p-3 rounded-lg border border-white/5">
                {revokeKeyId
                  ? t('admin:mcp_revoke_confirm', { defaultValue: 'MCP API-Schlüssel wirklich widerrufen? Er funktioniert danach nicht mehr, bleibt aber für die Historie sichtbar.' })
                  : t('admin:mcp_delete_confirm_text', { defaultValue: 'Möchten Sie den MCP API-Schlüssel' }) + (keyToDelete ? ` <strong className="text-white font-mono">${keyToDelete.key_name}</strong> ` : " ") + t('admin:mcp_delete_confirm_suffix', { defaultValue: 'wirklich unwiderruflich löschen? Alle verknüpften MCP-Clients verlieren sofort den Zugriff.' })}
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setKeyToDelete(null); setRevokeKeyId(null); }}
                  disabled={deleteKeyMutation.isPending || revokeKeyMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition-all"
                >
                  {t('common:cancel', { defaultValue: 'Abbrechen' })}
                </button>
                <button
                  type="button"
                  onClick={() => { if (revokeKeyId) void handleRevokeKey(revokeKeyId); else handleConfirmDelete(); }}
                  disabled={deleteKeyMutation.isPending || revokeKeyMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {deleteKeyMutation.isPending || revokeKeyMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  {deleteKeyMutation.isPending ? t('common:deleting', { defaultValue: 'Lösche...' }) : t('admin:mcp_delete_permanently', { defaultValue: 'Endgültig löschen' })}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

