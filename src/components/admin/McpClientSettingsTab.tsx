import React, { useState } from 'react';
import {
  Server,
  Plus,
  RefreshCw,
  Activity,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Clock,
  Crown,
  ShieldAlert,
  Terminal,
  Globe,
  Wrench,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Shield,
  Layers,
  ChevronRight,
  Sliders,
  Calendar,
  Mail,
  Github,
  Database,
  Search,
  MessageSquare,
  Store,
  Download,
  ExternalLink,
  Key,
  Check,
  Zap,
  Sparkles
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
// C.7/C.4 (Plan 2026-08-19): Chatprofile-Verwaltung + Genehmigungs-Queue
import { McpChatProfilesPanel } from './McpChatProfilesPanel';
import { McpApprovalsPanel } from './McpApprovalsPanel';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { McpTransportType, McpAuthType, McpPresetDefinition, McpPresetCategory } from '../../types';

export const McpClientSettingsTab: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);

  // Tab view
  const [activeTab, setActiveTab] = useState<'marketplace' | 'servers'>('marketplace');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Data queries
  const { data: servers, refetch: refetchServers, isLoading: isServersLoading } = trpc.listServers.useQuery();
  const { data: discoveredTools, refetch: refetchTools } = trpc.listDiscoveredTools.useQuery();
  const { data: presetsCatalog, isLoading: isPresetsLoading } = trpc.getPresetsCatalog.useQuery();

  // Check URL query params for OAuth success callback
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'success') {
      setActiveTab('servers');
      toast.success('MCP Server erfolgreich via OAuth autorisiert und verbunden!');
      refetchServers();
      refetchTools();
      const newUrl = window.location.pathname + '?tab=admin&subtab=mcp';
      window.history.replaceState({}, '', newUrl);
    } else if (params.get('subtab') === 'mcp') {
      setActiveTab('servers');
    }
  }, [refetchServers, refetchTools]);

  // Mutations
  // BUG-10 (Auftrag 015): onSuccess-Refetch — nach dem Anlegen muss die Server-Liste sofort aktualisieren
  // und der "Aktive Server"-Tab aktiv werden (vorher blieb die Karte unsichtbar bis zum Reload)
  const createServerMutation = trpc.createServer.useMutation({
    onSuccess: () => {
      refetchServers();
      refetchTools();
      setActiveTab('servers');
    }
  });
  const updateServerMutation = trpc.updateServer.useMutation();
  const deleteServerMutation = trpc.deleteServer.useMutation();
  const pingServerMutation = trpc.pingServer.useMutation();
  const discoverToolsMutation = trpc.discoverTools.useMutation();
  const toggleToolMutation = trpc.toggleToolState.useMutation();
  const installPresetMutation = trpc.installPreset.useMutation();
  const initiateOAuthMutation = trpc.initiateOAuth.useMutation();

  // State for manual server modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null);
  const [serverToDelete, setServerToDelete] = useState<{ id_uuid: string; server_name: string } | null>(null);

  // Form state for manual server
  const [serverName, setServerName] = useState('');
  const [description, setDescription] = useState('');
  const [transportType, setTransportType] = useState<McpTransportType>('http');
  const [endpointOrCommand, setEndpointOrCommand] = useState('');
  const [commandArgs, setCommandArgs] = useState('');
  const [envVars, setEnvVars] = useState('');
  const [headers, setHeaders] = useState('');
  const [authType, setAuthType] = useState<McpAuthType>('none');
  const [authToken, setAuthToken] = useState('');
  const [isActive, setIsActive] = useState(true);

  // State for preset installation modal
  const [selectedPreset, setSelectedPreset] = useState<McpPresetDefinition | null>(null);
  const [presetFieldValues, setPresetFieldValues] = useState<Record<string, string>>({});
  const [presetDisplayName, setPresetDisplayName] = useState('');
  const [installedOAuthServerId, setInstalledOAuthServerId] = useState<string | null>(null);

  const resetForm = () => {
    setEditingServerId(null);
    setServerName('');
    setDescription('');
    setTransportType('http');
    setEndpointOrCommand('');
    setCommandArgs('');
    setEnvVars('');
    setHeaders('');
    setAuthType('none');
    setAuthToken('');
    setIsActive(true);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (srv: any) => {
    setEditingServerId(srv.id_uuid);
    setServerName(srv.server_name || '');
    setDescription(srv.description || '');
    setTransportType(srv.transport_type || 'http');
    setEndpointOrCommand(srv.endpoint_or_command || '');
    setCommandArgs(Array.isArray(srv.command_args) ? srv.command_args.join(' ') : '');
    setEnvVars(srv.env_vars ? JSON.stringify(srv.env_vars, null, 2) : '');
    setHeaders(srv.headers ? JSON.stringify(srv.headers, null, 2) : '');
    setAuthType(srv.auth_type || 'none');
    setAuthToken(srv.auth_token_encrypted || '');
    setIsActive(srv.is_active ?? true);
    setIsModalOpen(true);
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName.trim() || !endpointOrCommand.trim()) {
      toast.error('Bitte Name und Endpunkt/Befehl angeben.');
      return;
    }

    let parsedEnv: Record<string, string> = {};
    if (envVars.trim()) {
      try {
        parsedEnv = JSON.parse(envVars);
      } catch {
        toast.error('Umgebungsvariablen müssen valides JSON sein.');
        return;
      }
    }

    let parsedHeaders: Record<string, string> = {};
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers);
      } catch {
        toast.error('Headers müssen valides JSON sein.');
        return;
      }
    }

    const argsArray = commandArgs.trim() ? commandArgs.split(' ').filter(Boolean) : [];

    try {
      if (editingServerId) {
        await updateServerMutation.mutateAsync({
          id_uuid: editingServerId,
          data: {
            server_name: serverName.trim(),
            description: description.trim() || undefined,
            transport_type: transportType,
            endpoint_or_command: endpointOrCommand.trim(),
            command_args: argsArray,
            env_vars: parsedEnv,
            headers: parsedHeaders,
            auth_type: authType,
            auth_token_encrypted: authToken.trim() || undefined,
            is_active: isActive
          }
        });
        toast.success('MCP Server erfolgreich aktualisiert');
      } else {
        await createServerMutation.mutateAsync({
          server_name: serverName.trim(),
          description: description.trim() || undefined,
          transport_type: transportType,
          endpoint_or_command: endpointOrCommand.trim(),
          command_args: argsArray,
          env_vars: parsedEnv,
          headers: parsedHeaders,
          auth_type: authType,
          auth_token_encrypted: authToken.trim() || undefined,
          is_active: isActive
        });
        toast.success('MCP Server erfolgreich angelegt');
      }

      setIsModalOpen(false);
      resetForm();
      refetchServers();
      refetchTools();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler beim Speichern: ${msg}`);
    }
  };

  const handleConfirmDeleteServer = async () => {
    if (!serverToDelete) return;
    try {
      await deleteServerMutation.mutateAsync({ id_uuid: serverToDelete.id_uuid });
      toast.success('MCP Server entfernt');
      if (selectedServerForTools === serverToDelete.id_uuid) setSelectedServerForTools(null);
      setServerToDelete(null);
      refetchServers();
      refetchTools();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler beim Löschen: ${msg}`);
    }
  };

  const handlePingServer = async (idUuid: string) => {
    try {
      const res = await pingServerMutation.mutateAsync({ server_id_uuid: idUuid });
      if (res.healthy) {
        toast.success(`Server erreichbar (${res.latencyMs}ms)`);
      } else {
        toast.error(`Server offline: ${res.errorMessage || 'Keine Antwort'}`);
      }
      refetchServers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Ping fehlgeschlagen: ${msg}`);
    }
  };

  const handleDiscoverTools = async (idUuid: string) => {
    try {
      const tools = await discoverToolsMutation.mutateAsync({ server_id_uuid: idUuid });
      toast.success(`${tools.length} Tools entdeckt & aktualisiert!`);
      setSelectedServerForTools(idUuid);
      refetchTools();
      refetchServers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Tool Discovery Fehler: ${msg}`);
    }
  };

  const handleToggleTool = async (idUuid: string, currentLouis: boolean, currentUi: boolean, target: 'louis' | 'ui') => {
    try {
      await toggleToolMutation.mutateAsync({
        id_uuid: idUuid,
        is_enabled_for_louis: target === 'louis' ? !currentLouis : undefined,
        is_enabled_for_ui: target === 'ui' ? !currentUi : undefined
      });
      toast.success('Tool-Status geändert');
      refetchTools();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler beim Umschalten: ${msg}`);
    }
  };

  // Preset modal handlers
  const handleOpenPresetModal = (preset: McpPresetDefinition) => {
    setSelectedPreset(preset);
    setPresetDisplayName(preset.name);
    const initialFields: Record<string, string> = {};
    preset.fields.forEach((f) => {
      initialFields[f.key] = f.defaultValue || '';
    });
    setPresetFieldValues(initialFields);
    setInstalledOAuthServerId(null);
  };

  const handleInstallPreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPreset) return;

    for (const f of selectedPreset.fields) {
      if (f.required && !presetFieldValues[f.key]?.trim()) {
        toast.error(`Bitte Feld "${f.label}" ausfüllen.`);
        return;
      }
    }

    try {
      const res = await installPresetMutation.mutateAsync({
        presetId: selectedPreset.id,
        displayName: presetDisplayName.trim() || selectedPreset.name,
        fieldValues: presetFieldValues,
        autoConnect: true
      });

      toast.success(`Preset "${selectedPreset.name}" erfolgreich installiert!`);
      refetchServers();
      refetchTools();

      if (selectedPreset.authType === 'oauth2') {
        setInstalledOAuthServerId(res.serverId);
      } else {
        setSelectedPreset(null);
        setActiveTab('servers');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Fehler bei Installation: ${msg}`);
    }
  };

  const handleTriggerOAuth = async () => {
    if (!selectedPreset || !installedOAuthServerId) return;
    try {
      const redirectUri = `${window.location.origin}/api/mcp/oauth/callback`;
      const res = await initiateOAuthMutation.mutateAsync({
        serverId: installedOAuthServerId,
        provider: selectedPreset.oauthProvider || 'google',
        redirectUri
      });
      window.location.href = res.authUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`OAuth Anforderung fehlgeschlagen: ${msg}`);
    }
  };

  const handleTriggerOAuthForServer = async (srv: any) => {
    try {
      const redirectUri = `${window.location.origin}/api/mcp/oauth/callback`;
      const res = await initiateOAuthMutation.mutateAsync({
        serverId: srv.id_uuid,
        provider: 'google',
        redirectUri
      });
      window.location.href = res.authUrl;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`OAuth Anforderung fehlgeschlagen: ${msg}`);
    }
  };

  const getHealthBadge = (status?: string) => {
    switch (status) {
      case 'healthy':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold">
            <CheckCircle2 size={12} /> Healthy
          </span>
        );
      case 'degraded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-mono font-bold">
            <AlertCircle size={12} /> Degraded
          </span>
        );
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-mono font-bold">
            <XCircle size={12} /> Offline
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/20 text-slate-400 text-[10px] font-mono font-bold">
            <Clock size={12} /> Unbekannt
          </span>
        );
    }
  };

  const renderPresetIcon = (iconName: string) => {
    switch (iconName) {
      case 'Calendar': return <Calendar size={20} className="text-accent-orange" />;
      case 'Mail': return <Mail size={20} className="text-blue-400" />;
      case 'Github': return <Github size={20} className="text-purple-400" />;
      case 'Database': return <Database size={20} className="text-emerald-400" />;
      case 'Globe': return <Globe size={20} className="text-amber-400" />;
      case 'MessageSquare': return <MessageSquare size={20} className="text-pink-400" />;
      default: return <Server size={20} className="text-accent-orange" />;
    }
  };

  const filteredPresets = presetsCatalog?.filter((p) => {
    if (selectedCategory === 'all') return true;
    return p.category === selectedCategory;
  }) || [];

  const filteredTools = selectedServerForTools
    ? discoveredTools?.filter((t) => t.server_id_uuid === selectedServerForTools)
    : discoveredTools;

  return (
    <div className="space-y-8">
      {/* Top Header & Sub-Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/5">
        <div>
          <h3 className="text-2xl font-black text-white uppercase tracking-tight font-display flex items-center gap-3">
            <Server className="text-accent-orange" size={28} />
            MCP Client &amp; Marketplace Hub
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Installieren Sie 1-Klick MCP Marktplatz-Presets oder binden Sie eigene externe MCP-Server ein.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex p-1 bg-black/40 border border-white/10 rounded-xl">
            <button
              type="button"
              onClick={() => setActiveTab('marketplace')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'marketplace'
                  ? 'bg-accent-orange text-white shadow-md shadow-accent-orange/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Store size={14} /> Marktplatz Presets
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('servers')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'servers'
                  ? 'bg-accent-orange text-white shadow-md shadow-accent-orange/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Server size={14} /> Aktive Server ({servers?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chatprofiles')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'chatprofiles'
                  ? 'bg-accent-orange text-white shadow-md shadow-accent-orange/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Crown size={14} /> {t('admin:mcp_tab_chatprofiles', { defaultValue: 'Chatprofile' })}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('approvals')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                activeTab === 'approvals'
                  ? 'bg-accent-orange text-white shadow-md shadow-accent-orange/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldAlert size={14} /> {t('admin:mcp_tab_approvals', { defaultValue: 'Freigaben' })}
            </button>
          </div>

          {/* BUG-9 (Auftrag 015): relative z-10 — ein <select> überlagerte den Button und fing Pointer-Events ab */}
          <button
            type="button"
            onClick={handleOpenCreateModal}
            className="relative z-10 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition-all flex items-center gap-1.5 shrink-0"
            title="Eigenen Server manuell anlegen"
          >
            <Plus size={14} /> Manuell
          </button>
        </div>
      </div>

      {/* MARKETPLACE TAB */}
      {activeTab === 'marketplace' && (
        <div className="space-y-6">
          {/* Category Filter Chips */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { id: 'all', label: 'Alle Presets', icon: Sparkles },
              { id: 'google', label: 'Google Workspace', icon: Mail },
              { id: 'developer', label: 'Developer Tools', icon: Github },
              { id: 'database', label: 'Databases', icon: Database },
              { id: 'search', label: 'Search & Web', icon: Globe },
              { id: 'communication', label: 'Communication', icon: MessageSquare }
            ].map((cat) => {
              const Icon = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                    isSelected
                      ? 'bg-accent-orange/10 border-accent-orange/40 text-accent-orange'
                      : 'bg-black/30 border-white/5 text-slate-400 hover:text-white hover:border-white/10'
                  }`}
                >
                  <Icon size={14} /> {cat.label}
                </button>
              );
            })}
          </div>

          {/* Marketplace Grid */}
          {isPresetsLoading ? (
            <div className="p-12 text-center text-xs text-slate-500 font-mono">
              Lade MCP Marktplatz Katalog...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredPresets.map((preset) => {
                const isAlreadyInstalled = servers?.some((s) => {
                  if (s.env_vars?.__preset_id === preset.id) return true;
                  if (s.server_name.toLowerCase() === preset.name.toLowerCase()) return true;
                  if (s.server_name.toLowerCase() === `${preset.name.toLowerCase()} (preset)`) return true;
                  const specificPkg = preset.args?.find((a) => a.startsWith('@') || a.startsWith('mcp-server') || a.includes('/server-'));
                  if (specificPkg && s.command_args?.some((arg) => arg.toLowerCase() === specificPkg.toLowerCase())) return true;
                  return false;
                });

                return (
                  <div
                    key={preset.id}
                    className="p-5 rounded-2xl bg-primary-dark/60 border border-white/5 hover:border-white/15 transition-all flex flex-col justify-between space-y-4 group"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10 group-hover:scale-105 transition-transform">
                          {renderPresetIcon(preset.icon)}
                        </div>
                        <span className="px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-[10px] font-mono text-slate-400 uppercase tracking-wider font-bold">
                          {preset.category}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-sm font-black text-white font-display tracking-wide uppercase">
                          {preset.name}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1.5 leading-relaxed line-clamp-3">
                          {preset.description}
                        </p>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
                        <Terminal size={12} /> {preset.transportType.toUpperCase()}
                        {preset.authType === 'oauth2' && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-bold ml-1">
                            OAuth 2.0
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenPresetModal(preset)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                          isAlreadyInstalled
                            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                            : 'bg-accent-orange hover:bg-accent-orange/90 text-white shadow-lg shadow-accent-orange/20'
                        }`}
                      >
                        {isAlreadyInstalled ? (
                          <>
                            <Check size={14} /> Verbundet
                          </>
                        ) : (
                          <>
                            <Download size={14} /> Anbinden
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ACTIVE SERVERS TAB */}
      {activeTab === 'servers' && (
        <div className="space-y-8">
          {/* External Servers Grid */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest font-display flex items-center justify-between">
              <span>Angebundene externe MCP Server ({servers?.length || 0})</span>
              <button
                type="button"
                onClick={() => refetchServers()}
                className="p-1 text-slate-400 hover:text-white transition-colors"
                title="Aktualisieren"
              >
                <RefreshCw size={14} className={isServersLoading ? 'animate-spin' : ''} />
              </button>
            </h4>

            {isServersLoading ? (
              <div className="p-8 text-center text-xs text-slate-500 font-mono">Lade externe MCP Server...</div>
            ) : !servers || servers.length === 0 ? (
              <div className="p-8 rounded-2xl bg-black/20 border border-white/5 text-center space-y-3">
                <Server size={32} className="mx-auto text-slate-600" />
                <p className="text-xs text-slate-400 font-medium">
                  Noch keine externen MCP-Server angebunden. Wählen Sie ein Preset im Marktplatz oder erstellen Sie einen eigenen Server.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('marketplace')}
                  className="px-4 py-2 rounded-xl bg-accent-orange text-white text-xs font-bold font-display uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <Store size={14} /> Zum Marktplatz
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {servers.map((srv) => {
                  const serverTools = discoveredTools?.filter((t) => t.server_id_uuid === srv.id_uuid) || [];
                  return (
                    <div
                      key={srv.id_uuid}
                      className={`p-5 rounded-2xl bg-primary-dark/60 border transition-all space-y-4 ${
                        selectedServerForTools === srv.id_uuid
                          ? 'border-accent-orange/50 shadow-lg shadow-accent-orange/5'
                          : 'border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-white font-display uppercase tracking-wider">
                              {srv.server_name}
                            </span>
                            {getHealthBadge(srv.health_status)}
                          </div>
                          {srv.description && (
                            <p className="text-xs text-slate-400 line-clamp-2">{srv.description}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(srv)}
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                            title="Bearbeiten"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setServerToDelete({ id_uuid: srv.id_uuid!, server_name: srv.server_name })}
                            className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer"
                            title="Entfernen"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      <div className="p-3 rounded-xl bg-black/40 border border-white/5 font-mono text-[11px] space-y-1 text-slate-300">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500 uppercase tracking-wider text-[9px] font-bold">Transport:</span>
                          <span className="text-accent-orange font-bold">{srv.transport_type.toUpperCase()}</span>
                        </div>
                        <div className="flex items-center justify-between truncate">
                          <span className="text-slate-500 uppercase tracking-wider text-[9px] font-bold">Endpunkt:</span>
                          <span className="truncate text-slate-300 ml-2" title={srv.endpoint_or_command}>
                            {srv.endpoint_or_command}
                          </span>
                        </div>
                        {srv.last_ping_at && !isNaN(new Date(srv.last_ping_at).getTime()) && (
                          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-white/5">
                            <span>Letzter Ping:</span>
                            <span>{new Date(srv.last_ping_at).toLocaleTimeString()}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePingServer(srv.id_uuid!)}
                            disabled={pingServerMutation.isPending}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition-all flex items-center gap-1.5"
                          >
                            <Activity size={12} /> Ping
                          </button>

                          {srv.auth_type === 'oauth2' && (
                            <button
                              type="button"
                              onClick={() => handleTriggerOAuthForServer(srv)}
                              disabled={initiateOAuthMutation.isPending}
                              className="px-3 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 text-xs font-bold transition-all flex items-center gap-1.5"
                              title="Google / Anwendungs-Konto erneut per OAuth verbinden"
                            >
                              <Shield size={12} /> OAuth Autorisieren
                            </button>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDiscoverTools(srv.id_uuid!)}
                          disabled={discoverToolsMutation.isPending}
                          className="px-3 py-1.5 rounded-xl bg-accent-orange/10 hover:bg-accent-orange/20 border border-accent-orange/30 text-accent-orange text-xs font-bold transition-all flex items-center gap-1.5"
                        >
                          <Wrench size={12} /> {serverTools.length} Tools Entdecken
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Discovered Tools List */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest font-display flex items-center gap-2">
                <Wrench size={16} className="text-accent-orange" />
                <span>Entdeckte MCP Tools ({filteredTools?.length || 0})</span>
              </h4>

              {selectedServerForTools && (
                <button
                  type="button"
                  onClick={() => setSelectedServerForTools(null)}
                  className="text-xs text-accent-orange hover:underline font-mono"
                >
                  Alle Server-Tools anzeigen
                </button>
              )}
            </div>

            {!filteredTools || filteredTools.length === 0 ? (
              <div className="p-8 rounded-2xl bg-black/20 border border-white/5 text-center text-xs text-slate-500 font-mono">
                Keine registrierten MCP Tools vorhanden. Klicken Sie auf "Tools Entdecken" bei einem aktiven Server.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredTools.map((tool) => (
                  <div
                    key={tool.id_uuid}
                    className="p-4 rounded-xl bg-primary-dark/40 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-accent-orange">
                          {tool.normalized_tool_name}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({tool.original_tool_name})
                        </span>
                      </div>
                      {tool.description && (
                        <p className="text-xs text-slate-400">{tool.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-display uppercase tracking-wider">Louis AI:</span>
                        <button
                          type="button"
                          onClick={() => handleToggleTool(tool.id_uuid!, tool.is_enabled_for_louis, tool.is_enabled_for_ui, 'louis')}
                          className={`p-1 rounded-md transition-colors ${
                            tool.is_enabled_for_louis ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                          title="Für Louis AI aktivieren/deaktivieren"
                        >
                          {tool.is_enabled_for_louis ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-400 font-display uppercase tracking-wider">UI Button:</span>
                        <button
                          type="button"
                          onClick={() => handleToggleTool(tool.id_uuid!, tool.is_enabled_for_louis, tool.is_enabled_for_ui, 'ui')}
                          className={`p-1 rounded-md transition-colors ${
                            tool.is_enabled_for_ui ? 'text-emerald-400' : 'text-slate-600'
                          }`}
                          title="Für UI Schnellaktionen aktivieren/deaktivieren"
                        >
                          {tool.is_enabled_for_ui ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PRESET INSTALLATION MODAL */}
      <AnimatePresence>
        {selectedPreset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg bg-primary-dark border border-white/10 rounded-2xl p-6 space-y-6 shadow-2xl relative"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                    {renderPresetIcon(selectedPreset.icon)}
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-wider font-display">
                      {selectedPreset.name} Anbinden
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">{selectedPreset.description}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedPreset(null);
                    setInstalledOAuthServerId(null);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              {installedOAuthServerId ? (
                <div className="space-y-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-center">
                  <Shield size={32} className="mx-auto text-blue-400" />
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-white">OAuth 2.0 Autorisierung erforderlich</h4>
                    <p className="text-xs text-slate-300">
                      Der Server wurde angelegt. Klicken Sie auf den Button unten, um den Zugriff bei Google/Anbieter zu berechtigen.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleTriggerOAuth}
                    disabled={initiateOAuthMutation.isPending}
                    className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30"
                  >
                    {initiateOAuthMutation.isPending ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ExternalLink size={16} />
                    )}
                    Jetzt bei {selectedPreset.name} Anmelden &amp; Autorisieren
                  </button>
                </div>
              ) : (
                <form onSubmit={handleInstallPreset} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Anzeigename *
                    </label>
                    <input
                      type="text"
                      required
                      value={presetDisplayName}
                      onChange={(e) => setPresetDisplayName(e.target.value)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange"
                    />
                  </div>

                  {selectedPreset.fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display flex items-center justify-between">
                        <span>{field.label} {field.required && '*'}</span>
                      </label>
                      <input
                        type={field.type === 'password' ? 'password' : 'text'}
                        required={field.required}
                        value={presetFieldValues[field.key] || ''}
                        onChange={(e) => setPresetFieldValues({ ...presetFieldValues, [field.key]: e.target.value })}
                        placeholder={field.placeholder || `Geben Sie ${field.label} ein`}
                        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                      />
                      {field.description && (
                        <p className="text-[10px] text-slate-500">{field.description}</p>
                      )}
                    </div>
                  ))}

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={installPresetMutation.isPending}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-accent-orange hover:bg-accent-orange/90 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent-orange/20"
                    >
                      {installPresetMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                      Installieren &amp; Verbinden
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPreset(null)}
                      className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition-all"
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MANUAL CREATE/EDIT SERVER MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-primary-dark border border-white/10 rounded-2xl p-6 space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-white/5">
                <h3 className="text-lg font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                  <Server className="text-accent-orange" size={20} />
                  {editingServerId ? 'MCP Server Bearbeiten' : 'Neuen MCP Server Anbinden'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveServer} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Server Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      placeholder="z. B. Google Calendar MCP, Postgres DB MCP"
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Transport Typ *
                    </label>
                    <select
                      value={transportType}
                      onChange={(e) => setTransportType(e.target.value as McpTransportType)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
                    >
                      <option value="http">HTTP (Streamable JSON-RPC 2.0)</option>
                      <option value="sse">SSE (Server-Sent Events)</option>
                      <option value="stdio">Stdio (Local Process / CLI)</option>
                      <option value="streamable_http">{t('admin:mcp_transport_streamable_http', { defaultValue: 'Streamable HTTP (Session-basiert)' })}</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                    {transportType === 'stdio' ? 'Befehl / Executable *' : 'Endpoint URL *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={endpointOrCommand}
                    onChange={(e) => setEndpointOrCommand(e.target.value)}
                    placeholder={
                      transportType === 'stdio'
                        ? 'z. B. npx, python, /usr/local/bin/mcp-server'
                        : 'z. B. https://mcp.calendar.example.com/sse'
                    }
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                  />
                </div>

                {transportType === 'stdio' && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Befehls-Argumente (Leerzeichen-getrennt)
                    </label>
                    <input
                      type="text"
                      value={commandArgs}
                      onChange={(e) => setCommandArgs(e.target.value)}
                      placeholder="z. B. -y @modelcontextprotocol/server-postgres postgresql://..."
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                    Beschreibung
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Wozu dient dieser MCP Server?"
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Authentifizierung
                    </label>
                    <select
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as McpAuthType)}
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
                    >
                      <option value="none">Keine Auth</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key">API Key (X-API-Key Header)</option>
                      <option value="basic">Basic Auth</option>
                    </select>
                  </div>

                  {authType !== 'none' && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                        Token / Secret (Verschlüsselt gespeichert)
                      </label>
                      <input
                        type="password"
                        value={authToken}
                        onChange={(e) => setAuthToken(e.target.value)}
                        placeholder="Secret Token eingeben"
                        className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Headers (JSON Format)
                    </label>
                    <textarea
                      rows={3}
                      value={headers}
                      onChange={(e) => setHeaders(e.target.value)}
                      placeholder='{\n  "X-Custom-Header": "value"\n}'
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                      Umgebungsvariablen (JSON Format)
                    </label>
                    <textarea
                      rows={3}
                      value={envVars}
                      onChange={(e) => setEnvVars(e.target.value)}
                      placeholder='{\n  "API_KEY": "xyz"\n}'
                      className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={createServerMutation.isPending || updateServerMutation.isPending}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-accent-orange hover:bg-accent-orange/90 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2 shadow-lg shadow-accent-orange/20"
                  >
                    {(createServerMutation.isPending || updateServerMutation.isPending) && (
                      <Loader2 size={14} className="animate-spin" />
                    )}
                    Speichern &amp; Verbinden
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold transition-all"
                  >
                    Abbrechen
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DELETE SERVER CONFIRMATION MODAL */}
      <AnimatePresence>
        {serverToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md bg-primary-dark border border-white/10 p-6 rounded-2xl shadow-2xl relative space-y-4"
            >
              <div className="flex items-center gap-3 text-rose-500">
                <div className="p-2.5 bg-rose-500/10 rounded-xl">
                  <AlertCircle size={20} />
                </div>
                <div>
                  <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
                    MCP Server löschen
                  </h4>
                  <p className="text-xs text-slate-400 font-medium">
                    Unwiderrufliche Aktion
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed bg-black/40 p-3 rounded-lg border border-white/5">
                Möchten Sie den MCP Server <strong className="text-white font-mono">{serverToDelete.server_name}</strong> wirklich unwiderruflich löschen? Alle verknüpften Tools werden ebenfalls entfernt.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setServerToDelete(null)}
                  disabled={deleteServerMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeleteServer}
                  disabled={deleteServerMutation.isPending}
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {deleteServerMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Trash2 size={14} />
                  )}
                  {deleteServerMutation.isPending ? 'Lösche...' : 'Endgültig löschen'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* C.7 (Plan 2026-08-19): Chatprofile-Verwaltung (Admin-Systemebene) */}
      {activeTab === 'chatprofiles' && (
        <McpChatProfilesPanel />
      )}

      {/* C.4 (Plan 2026-08-19): Genehmigungs-Queue (untrusted Write-Tools) */}
      {activeTab === 'approvals' && (
        <McpApprovalsPanel />
      )}
    </div>
  );
};
