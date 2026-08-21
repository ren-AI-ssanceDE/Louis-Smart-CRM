// Chatprofil-Selektor + Tool-Panel (Task C.7-UI, Plan 2026-08-19)
// Header des Assistent-Chatfensters: Profil-Dropdown (Main + Chatprofile) + dezentes Icon →
// Popover-Panel mit der Tool-Auswahl (nur ADMIN-freigegebene MCP-Tools; Standard-Louis-Tools
// sind ausgeschlossen — eigene Backend-Einstellung). Manuelle Auswahl gewinnt über das Profil.
import { useState, useEffect, useMemo } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListChecks, Search, Check, RotateCcw } from "lucide-react";
import { trpc } from "../../lib/trpc";
import type { ChatProfileRecord } from "../../types";

interface Props {
  sessionId?: string;
  // 2026-08-20: Die UI-Auswahl (aus LouisAi) — der Wechsel übergibt die neue Profil-ID
  selectedProfileId?: string;
  onProfileSwitched: (profileId: string) => void;
}

interface SessionProfileInfo {
  profile_id: string | null;
  override_tools: string[] | null;
}

export function ChatProfileSelector({ sessionId, selectedProfileId, onProfileSwitched }: Props): JSX.Element {
  const { t } = useTranslation(["louis_copilot", "common"]);
  const utils = trpc.useContext();

  const profilesQuery = trpc.listChatProfiles.useQuery(undefined, { enabled: true });
  const sessionProfileQuery = trpc.getSessionProfileInfo.useQuery(
    { session_id: sessionId || "" },
    { enabled: !!sessionId }
  );
  const toolsQuery = trpc.listDiscoveredTools.useQuery({}, { enabled: true });
  const serversQuery = trpc.listServers.useQuery(undefined, { enabled: true });

  const overrideMutation = trpc.setSessionToolOverride.useMutation({
    onSuccess: () => {
      utils.getSessionProfileInfo.invalidate();
    }
  });

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [localTools, setLocalTools] = useState<string[] | null>(null);

  const profiles = profilesQuery.data || [];
  const sessionProfile = sessionProfileQuery.data as SessionProfileInfo | undefined;
  const overrideTools = sessionProfile?.override_tools ?? null;
  // 2026-08-20: Die ANZEIGE = die UI-Auswahl (selectedProfileId) — sonst die
  // Bindung der aktiven Session. Der Wechsel ist reine UI (kein Server-Swap mehr!).
  const currentProfileId = selectedProfileId || sessionProfile?.profile_id || "";

  // 2026-08-19: Die Anzeige muss die EFFEKTIVE Menge zeigen —
  // (Session-Override) > Profil-tools_json > alle freigegebenen (Main-Semantik, null = alle)
  const activeProfile = profiles.find((p) => p.id_uuid === currentProfileId) || null;
  const profileToolList: string[] | null = Array.isArray((activeProfile as { tools_json?: string[] | null } | null)?.tools_json)
    ? (activeProfile as { tools_json?: string[] | null }).tools_json as string[]
    : null;
  const effectiveTools: string[] | null = localTools ?? overrideTools ?? profileToolList;

  // Lokale (ungespeicherte) Auswahl synchron halten, wenn der Session-Zustand kommt
  useEffect(() => {
    if (localTools === null) setLocalTools(overrideTools);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideTools]);

  // 2026-08-19: Ohne geladene Session wurde die lokale Tool-Auswahl
  // nie gespeichert (der erste sendMessage erzeugt die Session erst). Beim Session-Start
  // die lokale Auswahl nachträglich in den Override übertragen.
  useEffect(() => {
    if (sessionId && localTools !== null) {
      void overrideMutation
        .mutateAsync({ session_id: sessionId, tools: localTools } as { session_id: string; tools: string[] | null })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const allTools = useMemo(() => {
    // NUR Admin-freigegebene MCP-Tools (is_enabled_for_louis) — Standard-Louis-Tools sind ausgeschlossen
    const serverNames = new Map((serversQuery.data || []).map((s) => [s.id_uuid, s.server_name]));
    const discovered = (toolsQuery.data || []) as Array<{
      normalized_tool_name: string;
      original_tool_name: string;
      server_id_uuid: string;
      tenant_id: string;
      is_enabled_for_louis: boolean;
    }>;
    return discovered
      .filter((tool) => tool.is_enabled_for_louis && tool.tenant_id === "1")
      .map((tool) => ({
        name: tool.normalized_tool_name,
        display: tool.original_tool_name,
        server: serverNames.get(tool.server_id_uuid) || "—",
        enabled: effectiveTools === null ? true : effectiveTools.includes(tool.normalized_tool_name)
      }));
  }, [toolsQuery.data, serversQuery.data, localTools, overrideTools, effectiveTools]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const list = q ? allTools.filter((tool) => tool.display.toLowerCase().includes(q) || tool.server.toLowerCase().includes(q)) : allTools;
    const groups = new Map<string, typeof list>();
    for (const tool of list) {
      const arr = groups.get(tool.server) || [];
      arr.push(tool);
      groups.set(tool.server, arr);
    }
    return [...groups.entries()];
  }, [allTools, searchTerm]);

  const activeCount = allTools.filter((tool) => tool.enabled).length;
  const selectionIsOverride = overrideTools !== null && overrideTools !== undefined;

  const switchProfile = (profileId: string): void => {
    setDropdownOpen(false);
    if (!profileId || profileId === currentProfileId) return;
    // 2026-08-20: KEIN Server-Swap — der Wechsel startet einen neuen Chat-Kontext
    // (die LouisAi setzt sessionId auf undefined; die aktive Session bleibt beim alten Profil).
    onProfileSwitched(profileId);
  };

  const toggleTool = (name: string): void => {
    // Basis = EFFEKTIVE Menge (Profil-Tools erhalten, nicht []!) — sonst kollabiert der
    // Override beim ersten Klick auf 1 Tool (2026-08-19)
    const base = localTools ?? overrideTools ?? profileToolList ?? allTools.map((tool) => tool.name);
    const next = base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
    setLocalTools(next);
    if (sessionId) {
      void overrideMutation
        .mutateAsync({ session_id: sessionId, tools: next } as { session_id: string; tools: string[] | null })
        .catch(() => undefined);
    }
  };

  const toggleServer = (server: string, value: boolean): void => {
    const base = new Set(localTools ?? overrideTools ?? profileToolList ?? allTools.map((tool) => tool.name));
    for (const tool of allTools) {
      if (tool.server === server) {
        if (value) base.add(tool.name);
        else base.delete(tool.name);
      }
    }
    const next = [...base];
    setLocalTools(next);
    if (sessionId) {
      void overrideMutation
        .mutateAsync({ session_id: sessionId, tools: next } as { session_id: string; tools: string[] | null })
        .catch(() => undefined);
    }
  };

  const resetToProfile = (): void => {
    setLocalTools(null);
    if (sessionId) {
      void overrideMutation
        .mutateAsync({ session_id: sessionId, tools: null } as { session_id: string; tools: string[] | null })
        .catch(() => undefined);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Chatprofil-Selektor (Header) */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-white/5 text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all font-bold"
          title={t("louis_copilot:chat_profile", { defaultValue: "Chatprofil" })}
          data-testid="chat-profile-selector"
        >
          <ListChecks size={12} />
          <span className="max-w-[110px] truncate">
            {profiles.find((p) => p.id_uuid === currentProfileId)?.profile_name ||
              t("louis_copilot:chat_profile_main", { defaultValue: "Main" })}
          </span>
          <ChevronDown size={11} />
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-40 w-56 max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-primary-dark shadow-2xl p-1.5">
              {(profiles || []).map((profile) => (
                <button
                  key={profile.id_uuid}
                  onClick={() => switchProfile(profile.id_uuid)}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                    profile.id_uuid === currentProfileId ? "bg-accent-orange/15 text-accent-orange" : "text-slate-300 hover:bg-white/5"
                  }`}
                  title={profile.description || undefined}
                >
                  <span className="truncate">{profile.profile_name}</span>
                  {profile.is_default && (
                    <span className="ml-auto text-[9px] text-emerald-400 border border-emerald-400/30 rounded-full px-1.5 py-0.5 uppercase font-mono">
                      {t("louis_copilot:chat_profile_default", { defaultValue: "Default" })}
                    </span>
                  )}
                  {profile.id_uuid === currentProfileId && <Check size={12} className="ml-1 shrink-0" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Dezentes Icon → Tool-Panel (Popover) */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className={`p-1.5 rounded-lg border border-white/5 transition-all ${panelOpen ? "text-accent-orange bg-white/5" : "text-slate-400 hover:text-white hover:bg-white/5"}`}
        title={t("louis_copilot:chat_tools", { defaultValue: "Tools auswählen" })}
        data-testid="chat-tools-panel-toggle"
      >
        <SlidersIcon />
      </button>

      {panelOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanelOpen(false)} />
          <div className="absolute right-16 top-16 z-40 w-80 max-h-[60vh] overflow-hidden rounded-xl border border-white/10 bg-primary-dark shadow-2xl flex flex-col" data-testid="chat-tools-panel">
            {/* Kopf */}
            <div className="p-2.5 border-b border-white/5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {t("louis_copilot:chat_tools_title", { defaultValue: "MCP-Tools" })}
                </span>
                <span className="text-[10px] font-mono text-slate-500">
                  {activeCount}/{allTools.length}
                </span>
              </div>
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={t("louis_copilot:chat_tools_search", { defaultValue: "Suchen…" })}
                  className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-slate-500 outline-none focus:border-accent-orange/40"
                />
              </div>
              {selectionIsOverride && (
                <button
                  onClick={resetToProfile}
                  className="flex items-center gap-1.5 text-[10px] text-accent-orange hover:underline"
                >
                  <RotateCcw size={10} />
                  {t("louis_copilot:chat_tools_reset", { defaultValue: "Profil-Tools übernehmen (manuelle Auswahl zurücksetzen)" })}
                </button>
              )}
            </div>
            {/* Tool-Liste (gruppiert nach Server, kollapsibel via Chips) */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
              {filtered.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6">
                  {t("louis_copilot:chat_tools_empty", { defaultValue: "Keine freigegebenen Tools" })}
                </p>
              )}
              {filtered.map(([server, tools]) => (
                <div key={server}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">{server}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => toggleServer(server, true)}
                        className="text-[9px] text-emerald-400/80 hover:text-emerald-300 font-bold uppercase"
                      >
                        {t("common:all", { defaultValue: "Alle" })}
                      </button>
                      <button
                        onClick={() => toggleServer(server, false)}
                        className="text-[9px] text-slate-500 hover:text-slate-300 font-bold uppercase"
                      >
                        {t("common:none", { defaultValue: "Keine" })}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {tools.map((tool) => (
                      <label
                        key={tool.name}
                        className="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-white/5 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={tool.enabled}
                          onChange={() => toggleTool(tool.name)}
                          className="w-3.5 h-3.5 accent-orange-500 cursor-pointer"
                        />
                        <span className="text-xs text-slate-300 truncate">{tool.display}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SlidersIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}
