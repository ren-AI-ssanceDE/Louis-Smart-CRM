// Admin-Panel: Chatprofile-CRUD (Task C.7-UI, Plan 2026-08-19)
// Team-weite Profile (Admin) + persönliche (User); Name FIX nach Erstellung;
// Default pro Tenant (Admin); 2-Stufen-Inline-Löschen; Tools-Auswahl aus freigegebenen MCP-Tools.
import { useState, useMemo } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Check, Search, Crown, Edit2 } from "lucide-react";
import { trpc } from "../../lib/trpc";

type EditProfileShape = {
  id_uuid: string;
  profile_name: string;
  description?: string | null;
  tools_json?: string[] | null;
  is_system?: boolean;
  is_default?: boolean;
};

export function McpChatProfilesPanel(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const utils = trpc.useContext();
  const profilesQuery = trpc.listChatProfiles.useQuery(undefined, { enabled: true });
  const toolsQuery = trpc.listDiscoveredTools.useQuery({}, { enabled: true });
  const serversQuery = trpc.listServers.useQuery(undefined, { enabled: true });

  const createMutation = trpc.createChatProfile.useMutation({
    onSuccess: () => {
      utils.listChatProfiles.invalidate();
      setShowCreate(false);
      setName("");
      setDescription("");
      setSelectedTools([]);
      toastOk();
    }
  });
  const deleteMutation = trpc.deleteChatProfile.useMutation({ onSuccess: () => utils.listChatProfiles.invalidate() });
  const setDefaultMutation = trpc.setDefaultChatProfile.useMutation({ onSuccess: () => utils.listChatProfiles.invalidate() });
  const updateMutation = trpc.updateChatProfile.useMutation({
    onSuccess: () => {
      utils.listChatProfiles.invalidate();
      setEditingProfile(null);
      toastOk();
    }
  });

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [teamWide, setTeamWide] = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [editingProfile, setEditingProfile] = useState<EditProfileShape | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editSelectedTools, setEditSelectedTools] = useState<string[]>([]);
  const toggleEditTool = (name: string): void => {
    setEditSelectedTools((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]));
  };
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const serverNames = useMemo(
    () => new Map((serversQuery.data || []).map((s) => [s.id_uuid, s.server_name])),
    [serversQuery.data]
  );
  const toolOptions = useMemo(() => {
    const discovered = (toolsQuery.data || []) as Array<{
      normalized_tool_name: string;
      original_tool_name: string;
      server_id_uuid: string;
      is_enabled_for_louis: boolean;
    }>;
    const q = searchTerm.trim().toLowerCase();
    return discovered
      .filter((tool) => tool.is_enabled_for_louis && (!q || tool.original_tool_name.toLowerCase().includes(q)))
      .map((tool) => ({
        name: tool.normalized_tool_name,
        display: tool.original_tool_name,
        server: serverNames.get(tool.server_id_uuid) || "—"
      }));
  }, [toolsQuery.data, serverNames, searchTerm]);

  const toastOk = (): void => {
    // Stiller Erfolg via Query-Invalidierung (kein toast nötig — UI aktualisiert sich)
  };

  const toggleTool = (name: string): void => {
    setSelectedTools((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <Crown size={14} className="text-accent-orange" />
          {t("admin:mcp_chat_profiles", { defaultValue: "Chatprofile" })}
        </h4>
        <button
          type="button"
          onClick={() => setShowCreate((o) => !o)}
          className="relative z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent-orange text-white text-xs font-bold transition-all hover:bg-accent-orange/90"
        >
          <Plus size={12} />
          {t("admin:mcp_chat_profile_create", { defaultValue: "Neues Profil" })}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("admin:mcp_chat_profile_name", { defaultValue: "Name (einmalig, danach fix)" })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent-orange/40"
            />
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("admin:mcp_chat_profile_description", { defaultValue: "Beschreibung (editierbar)" })}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent-orange/40"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={teamWide}
              onChange={(e) => setTeamWide(e.target.checked)}
              className="w-4 h-4 accent-orange-500 cursor-pointer"
            />
            {t("admin:mcp_chat_profile_teamwide", { defaultValue: "Team-weit (nur Admin)" })}
          </label>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t("admin:mcp_chat_profile_tools", { defaultValue: "Tools" })}
              </span>
              <div className="relative flex-1 max-w-xs">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t("louis_copilot:chat_tools_search", { defaultValue: "Suchen…" })}
                  className="w-full pl-7 pr-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-500 outline-none"
                />
              </div>
              <span className="text-[10px] font-mono text-slate-500">{selectedTools.length}</span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 space-y-1">
              {toolOptions.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  {t("louis_copilot:chat_tools_empty", { defaultValue: "Keine freigegebenen Tools" })}
                </p>
              )}
              {toolOptions.map((tool) => (
                <label key={tool.name} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedTools.includes(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                    className="w-3.5 h-3.5 accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 truncate">{tool.display}</span>
                  <span className="ml-auto text-[9px] text-slate-500 truncate max-w-[140px]">{tool.server}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!name.trim()) return;
              void createMutation.mutateAsync({
                profile_name: name.trim(),
                description: description || undefined,
                tools: selectedTools.length > 0 ? selectedTools : undefined,
                team_wide: teamWide
              } as { profile_name: string; description?: string; tools?: string[]; team_wide: boolean });
            }}
            disabled={!name.trim()}
            className="px-3 py-1.5 rounded-lg bg-accent-orange text-white text-xs font-bold hover:bg-accent-orange/90 disabled:opacity-40"
          >
            {t("common:save", { defaultValue: "Speichern" })}
          </button>
        </div>
      )}

      {editingProfile && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
              {t("admin:mcp_chat_profile_edit", { defaultValue: "Bearbeiten" })}: {editingProfile.profile_name}
            </h5>
            <button
              type="button"
              onClick={() => setEditingProfile(null)}
              className="px-2 py-1 rounded-lg border border-white/10 text-xs text-slate-400 hover:text-white transition-all"
            >
              {t("common:cancel", { defaultValue: "Abbrechen" })}
            </button>
          </div>
          <input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder={t("admin:mcp_chat_profile_description", { defaultValue: "Beschreibung (editierbar)" })}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-slate-500 outline-none focus:border-accent-orange/40"
          />
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {t("admin:mcp_chat_profile_tools", { defaultValue: "Tools" })}
              </span>
              <span className="text-[10px] font-mono text-slate-500">{editSelectedTools.length}</span>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 space-y-1">
              {toolOptions.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-4">
                  {t("louis_copilot:chat_tools_empty", { defaultValue: "Keine freigegebenen Tools" })}
                </p>
              )}
              {toolOptions.map((tool) => (
                <label key={tool.name} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editSelectedTools.includes(tool.name)}
                    onChange={() => toggleEditTool(tool.name)}
                    className="w-3.5 h-3.5 accent-orange-500 cursor-pointer"
                  />
                  <span className="text-xs text-slate-300 truncate">{tool.display}</span>
                  <span className="ml-auto text-[9px] text-slate-500 truncate max-w-[140px]">{tool.server}</span>
                </label>
              ))}
            </div>
          </div>
          {/* Schnellwahl: Alle / Keine (Plan C.7 —  2026-08-19: Anlage startete leer) */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {editSelectedTools.length}/{toolOptions.length} {t("admin:mcp_chat_profile_tools", { defaultValue: "Tools" })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditSelectedTools(toolOptions.map((tool) => tool.name))}
                className="text-[10px] text-emerald-400/80 hover:text-emerald-300 font-bold uppercase"
              >
                {t("common:all", { defaultValue: "Alle" })}
              </button>
              <button
                type="button"
                onClick={() => setEditSelectedTools([])}
                className="text-[10px] text-slate-400 hover:text-white font-bold uppercase"
              >
                {t("common:none", { defaultValue: "Keine" })}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (!editingProfile) return;
                void updateMutation.mutateAsync({
                  id_uuid: editingProfile.id_uuid,
                  description: editDescription || null,
                  tools: editSelectedTools
                } as { id_uuid: string; description?: string | null; tools?: string[] });
              }}
              className="px-3 py-1.5 rounded-lg bg-accent-orange text-white text-xs font-bold hover:bg-accent-orange/90"
            >
              {t("common:save", { defaultValue: "Speichern" })}
            </button>
            <span className="text-[10px] text-slate-500">
              {t("admin:mcp_chat_profile_hint", { defaultValue: "Leere Auswahl = keine Tools für dieses Profil" })}
            </span>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {(profilesQuery.data || []).map((profile) => (
          <div key={profile.id_uuid} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white truncate">{profile.profile_name}</span>
                {profile.is_system && (
                  <span className="text-[9px] text-accent-orange border border-accent-orange/30 rounded-full px-1.5 py-0.5 uppercase font-mono">
                    {t("admin:mcp_chat_profile_system", { defaultValue: "System" })}
                  </span>
                )}
                {profile.is_default && (
                  <span className="text-[9px] text-emerald-400 border border-emerald-400/30 rounded-full px-1.5 py-0.5 uppercase font-mono">
                    {t("louis_copilot:chat_profile_default", { defaultValue: "Default" })}
                  </span>
                )}
              </div>
              {profile.description && <p className="text-xs text-slate-400 truncate">{profile.description}</p>}
              <p className="text-[10px] text-slate-500 font-mono">
                {profile.tools_json && Array.isArray(profile.tools_json) ? `${profile.tools_json.length} ${t("admin:mcp_chat_profile_tools", { defaultValue: "Tools" })}` : t("admin:mcp_chat_profile_all", { defaultValue: "Alle freigegebenen Tools" })}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  setEditingProfile(profile as EditProfileShape);
                  setEditDescription(profile.description || "");
                  setEditSelectedTools(Array.isArray(profile.tools_json) ? [...profile.tools_json] : []);
                }}
                title={t("admin:mcp_chat_profile_edit", { defaultValue: "Bearbeiten" })}
                className="p-1.5 rounded-lg border border-white/5 text-slate-400 hover:text-accent-orange hover:border-accent-orange/40 transition-all"
              >
                <Edit2 size={13} />
              </button>
              {!profile.is_default && (
                <button
                  type="button"
                  onClick={() => void setDefaultMutation.mutateAsync({ id_uuid: profile.id_uuid } as { id_uuid: string })}
                  title={t("admin:mcp_chat_profile_set_default", { defaultValue: "Als Default setzen" })}
                  className="p-1.5 rounded-lg border border-white/5 text-slate-400 hover:text-emerald-400 hover:border-emerald-400/30 transition-all"
                >
                  <Check size={13} />
                </button>
              )}
              {!profile.is_system && (
                <>
                  {confirmDeleteId === profile.id_uuid ? (
                    <button
                      type="button"
                      onClick={() => {
                        void deleteMutation.mutateAsync({ id_uuid: profile.id_uuid } as { id_uuid: string });
                        setConfirmDeleteId(null);
                      }}
                      className="px-2 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold"
                    >
                      {t("common:confirm_delete", { defaultValue: "Wirklich löschen?" })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(profile.id_uuid)}
                      title={t("common:delete", { defaultValue: "Löschen" })}
                      className="p-1.5 rounded-lg border border-white/5 text-slate-400 hover:text-red-400 hover:border-red-400/30 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {(profilesQuery.data || []).length === 0 && (
          <p className="text-xs text-slate-500 text-center py-6">
            {t("admin:mcp_chat_profile_empty", { defaultValue: "Keine Profile — Main wird automatisch angelegt" })}
          </p>
        )}
      </div>
    </div>
  );
}
