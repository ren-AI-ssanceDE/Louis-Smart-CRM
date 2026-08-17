import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  AlertCircle,
  Wrench,
  ArrowRight,
  Code2,
  Loader2,
  Sparkles,
  Search
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';

export const McpToolMappingsPanel: React.FC = () => {
  const { t } = useTranslation(['admin', 'common']);

  // Data Queries
  const { data: mappings, refetch: refetchMappings, isLoading: isMappingsLoading } = trpc.listToolMappings.useQuery();
  const { data: discoveredTools } = trpc.listDiscoveredTools.useQuery();

  // Mutations
  const saveMappingMutation = trpc.saveToolMapping.useMutation();
  const deleteMappingMutation = trpc.deleteToolMapping.useMutation();
  const executeToolMutation = trpc.executeTool.useMutation();

  // State
  const [targetDomain, setTargetDomain] = useState<'contacts' | 'companies' | 'invoices' | 'offers' | 'documents' | 'tasks' | 'calendar' | 'external_api'>('contacts');
  const [actionType, setActionType] = useState('search');
  const [selectedToolId, setSelectedToolId] = useState('');
  const [fieldMappingsJson, setFieldMappingsJson] = useState('{\n  "query": "search_term"\n}');
  const [isPrimary, setIsPrimary] = useState(false);

  // Test Center State
  const [testToolId, setTestToolId] = useState('');
  const [testArgsJson, setTestArgsJson] = useState('{}');
  const [testResult, setTestResult] = useState<any>(null);

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedToolId) {
      toast.error('Bitte ein MCP Tool auswählen.');
      return;
    }

    let parsedFieldMappings: Record<string, string> = {};
    if (fieldMappingsJson.trim()) {
      try {
        parsedFieldMappings = JSON.parse(fieldMappingsJson);
      } catch {
        toast.error('Feld-Zuordnungen müssen valides JSON sein.');
        return;
      }
    }

    try {
      await saveMappingMutation.mutateAsync({
        target_domain: targetDomain,
        action_type: actionType,
        tool_id_uuid: selectedToolId,
        field_mappings: parsedFieldMappings,
        is_primary: isPrimary
      });
      toast.success('Tool Mapping gespeichert!');
      refetchMappings();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler beim Speichern');
    }
  };

  const handleDeleteMapping = async (id: string) => {
    try {
      await deleteMappingMutation.mutateAsync({ id_uuid: id });
      toast.success('Mapping gelöscht');
      refetchMappings();
    } catch (err) {
      toast.error('Fehler beim Löschen');
    }
  };

  const handleRunTest = async () => {
    if (!testToolId) {
      toast.error('Bitte ein Tool zum Testen wählen.');
      return;
    }

    let parsedArgs = {};
    if (testArgsJson.trim()) {
      try {
        parsedArgs = JSON.parse(testArgsJson);
      } catch {
        toast.error('Test-Argumente müssen valides JSON sein.');
        return;
      }
    }

    setTestResult(null);
    try {
      const res = await executeToolMutation.mutateAsync({
        tool_id_uuid: testToolId,
        arguments: parsedArgs
      });
      setTestResult(res);
      if (res.success) {
        toast.success(`Tool erfolgreich ausgeführt (${res.execution_time_ms}ms)`);
      } else {
        toast.error(`Ausführung fehlgeschlagen: ${res.error}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Testausführung fehlgeschlagen');
    }
  };

  return (
    <div className="space-y-8 bg-primary-dark/40 border border-white/5 rounded-2xl p-6">
      {/* Header */}
      <div>
        <h4 className="text-xl font-black text-white uppercase tracking-tight font-display flex items-center gap-3">
          <Layers className="text-accent-orange" size={24} />
          CRM Domain Tool Mappings &amp; Test Center
        </h4>
        <p className="text-xs text-slate-400 mt-1">
          Verknüpfen Sie entdeckte MCP-Tools mit spezifischen CRM-Aktionen (z.B. Kalender, E-Mail Sync, Dokumentenextraktion) für das Dual-Use Prinzip in UI und KI.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Mapping Creation Form */}
        <form onSubmit={handleSaveMapping} className="p-5 rounded-2xl bg-black/40 border border-white/5 space-y-4">
          <h5 className="text-xs font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <Plus size={14} className="text-accent-orange" />
            Neues Domain Mapping Erstellen
          </h5>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                Ziel CRM Domain *
              </label>
              <select
                value={targetDomain}
                onChange={(e) => setTargetDomain(e.target.value as any)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
              >
                <option value="contacts">Kontakte &amp; Ansprechpartner</option>
                <option value="companies">Unternehmen</option>
                <option value="invoices">Rechnungen &amp; e-Invoicing</option>
                <option value="offers">Angebote</option>
                <option value="documents">Dokumente &amp; Knowledge Vault</option>
                <option value="tasks">Aufgaben &amp; Kanban Deals</option>
                <option value="calendar">Kalender &amp; Termine</option>
                <option value="external_api">Externe APIs / Workflows</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                Aktions Typ *
              </label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
              >
                <option value="search">Search (Suche)</option>
                <option value="query">Query (Abfrage)</option>
                <option value="sync">Sync (Synchronisation)</option>
                <option value="create">Create (Anlegen)</option>
                <option value="update">Update (Bearbeiten)</option>
                <option value="custom_action">Custom Action</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
              Zugewiesenes MCP Tool *
            </label>
            <select
              value={selectedToolId}
              onChange={(e) => setSelectedToolId(e.target.value)}
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
            >
              <option value="">-- MCP Tool Auswählen --</option>
              {discoveredTools?.map((t) => (
                <option key={t.id_uuid} value={t.id_uuid}>
                  {t.normalized_tool_name} ({t.original_tool_name})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
              Feld-Mapping (CRM Key &rarr; MCP Tool Arg Key)
            </label>
            <textarea
              rows={3}
              value={fieldMappingsJson}
              onChange={(e) => setFieldMappingsJson(e.target.value)}
              placeholder='{\n  "query": "search_term"\n}'
              className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white placeholder-slate-600 focus:outline-none focus:border-accent-orange font-mono"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              className="rounded border-white/20 text-accent-orange focus:ring-0 bg-black/40"
            />
            <span className="text-xs text-slate-300 font-medium">Primäres Tool für diese Aktion</span>
          </label>

          <button
            type="submit"
            disabled={saveMappingMutation.isPending}
            className="w-full px-4 py-2.5 rounded-xl bg-accent-orange hover:bg-accent-orange/90 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2"
          >
            {saveMappingMutation.isPending && <Loader2 size={14} className="animate-spin" />}
            Mapping Speichern
          </button>
        </form>

        {/* Existing Mappings List */}
        <div className="space-y-3">
          <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest font-display">
            Aktive Domain Mappings ({mappings?.length || 0})
          </h5>

          {isMappingsLoading ? (
            <div className="text-xs text-slate-500 py-4 font-mono">Lade Mappings...</div>
          ) : !mappings || mappings.length === 0 ? (
            <div className="p-6 rounded-2xl bg-black/20 border border-white/5 text-center text-xs text-slate-500 font-mono italic">
              Noch keine Domain-Mappings vorhanden.
            </div>
          ) : (
            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
              {mappings.map((m) => {
                const tool = discoveredTools?.find((t) => t.id_uuid === m.tool_id_uuid);
                return (
                  <div
                    key={m.id_uuid}
                    className="p-3.5 rounded-xl bg-black/30 border border-white/5 flex items-center justify-between gap-3 hover:border-white/10 transition-all text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">
                          {m.target_domain}
                        </span>
                        <ArrowRight size={12} className="text-slate-500" />
                        <span className="font-mono font-bold text-white uppercase">{m.action_type}</span>
                        {m.is_primary && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                            Primary
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-accent-orange">
                        Tool: {tool ? tool.normalized_tool_name : m.tool_id_uuid}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleDeleteMapping(m.id_uuid!)}
                      className="p-2 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Mapping entfernen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Test Center */}
      <div className="pt-6 border-t border-white/5 space-y-4">
        <h5 className="text-xs font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
          <Play size={14} className="text-accent-orange" />
          Live Test Center für externe MCP Tools
        </h5>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3 p-4 rounded-xl bg-black/30 border border-white/5">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                MCP Tool Auswählen
              </label>
              <select
                value={testToolId}
                onChange={(e) => setTestToolId(e.target.value)}
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange font-mono"
              >
                <option value="">-- Tool Auswählen --</option>
                {discoveredTools?.map((t) => (
                  <option key={t.id_uuid} value={t.id_uuid}>
                    {t.normalized_tool_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display">
                Test Argumente (JSON)
              </label>
              <textarea
                rows={4}
                value={testArgsJson}
                onChange={(e) => setTestArgsJson(e.target.value)}
                placeholder='{\n  "query": "Test"\n}'
                className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-accent-orange"
              />
            </div>

            <button
              type="button"
              onClick={handleRunTest}
              disabled={executeToolMutation.isPending}
              className="w-full px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider font-display transition-all flex items-center justify-center gap-2"
            >
              {executeToolMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Tool Testen
            </button>
          </div>

          {/* Test Result Inspector */}
          <div className="p-4 rounded-xl bg-black/50 border border-white/5 space-y-2 flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-display block mb-2">
                Ausführungsergebnis
              </span>

              {testResult ? (
                <div className="space-y-2 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold uppercase ${testResult.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {testResult.success ? 'Erfolgreich' : 'Fehler'}
                    </span>
                    <span className="text-slate-400">{testResult.execution_time_ms} ms</span>
                  </div>

                  {testResult.error && (
                    <p className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300">
                      {testResult.error}
                    </p>
                  )}

                  <pre className="p-3 bg-black/80 rounded border border-white/5 text-slate-300 max-h-[160px] overflow-auto text-[10px]">
                    {JSON.stringify(testResult.result, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-slate-600 font-mono italic">
                  Wählen Sie ein Tool aus und klicken Sie auf &quot;Tool Testen&quot;, um die Rückgabe zu prüfen.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
