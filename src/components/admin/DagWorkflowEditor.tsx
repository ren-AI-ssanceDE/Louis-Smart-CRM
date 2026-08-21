// ============================================================================
// 4B (T5): Visueller DAG-Editor (React Flow / @xyflow).
// Knoten: ACTION/CONDITIONAL/WAIT/HUMAN_GATE/RAG/ASK_USER. Drag&Drop, Kanten,
// Zyklen-Validierung, Linear→DAG-Konvertierung. i18n-Pflicht (Regel 10).
// ============================================================================
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ReactFlow,
  Background,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Node,
  Edge,
  NodeProps,
  Handle,
  Position,
  MarkerType
} from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import {
  workflowToFlow,
  flowToWorkflow,
  isAcyclic,
  linearToDag,
  createEmptyNode,
  NODE_TYPE_LABELS
} from "../../lib/dagMappers.js";
import { DAG_TOOL_OPTIONS, getToolOption } from "../../lib/dagToolOptions.js";
import { IWorkflowDAG, IWorkflowNode, NodeConfigType } from "../../types/workflows.js";

// ---------------------------------------------------------------------------
// Custom-Knoten (ein generischer Editor-Knoten mit Typ-Badge)
// ---------------------------------------------------------------------------
const nodeStyle: Record<string, { border: string; badge: string }> = {
  dagAction: { border: "border-accent-blue/40", badge: "bg-accent-blue/20 text-accent-blue" },
  dagConditional: { border: "border-accent-orange/40", badge: "bg-accent-orange/20 text-accent-orange" },
  dagWait: { border: "border-violet-500/40", badge: "bg-violet-500/20 text-violet-400" },
  dagHumanGate: { border: "border-emerald-500/40", badge: "bg-emerald-500/20 text-emerald-400" },
  dagRag: { border: "border-cyan-500/40", badge: "bg-cyan-500/20 text-cyan-400" },
  dagAskUser: { border: "border-pink-500/40", badge: "bg-pink-500/20 text-pink-400" }
};

interface DagNodeData {
  label: string;
  nodeType: string;
  node?: IWorkflowNode | null;
}

function DagNode(props: NodeProps) {
  const { t } = useTranslation(["admin", "common"]);
  const data = props.data as unknown as DagNodeData;
  const style = nodeStyle[data.nodeType] || nodeStyle.dagAction;
  const label = NODE_TYPE_LABELS[data.nodeType] || "Aktion";
  return (
    <div className={`min-w-[160px] max-w-[220px] bg-primary-dark/90 border rounded-xl px-3 py-2 shadow-lg ${style.border} ${props.selected ? "ring-2 ring-accent-blue/50" : ""}`}>
      <Handle type="target" position={Position.Left} className="!bg-slate-500 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${style.badge}`}>
          {label}
        </span>
      </div>
      <div className="text-[11px] text-white font-semibold mt-1 leading-tight break-words">
        {data.label || "Unbenannt"}
      </div>
      {data.node?.tool_identifier && (
        <div className="text-[8px] text-slate-500 font-mono mt-0.5 truncate">{data.node.tool_identifier}</div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-slate-500 !w-2 !h-2" />
      {data.node?.fallback_node_id && (
        <Handle type="source" position={Position.Bottom} id="fallback" className="!bg-accent-orange !w-2 !h-2" style={{ left: "20%" }} />
      )}
    </div>
  );
}

const nodeTypes = {
  dagAction: DagNode,
  dagConditional: DagNode,
  dagWait: DagNode,
  dagHumanGate: DagNode,
  dagRag: DagNode,
  dagAskUser: DagNode
};

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------
interface DagEditorProps {
  workflowId: string;
  initialDag?: IWorkflowDAG | null;
  linearSequence?: Array<{ tool: string; instruction: string }>;
  workflowName: string;
  onSave: (dag: IWorkflowDAG) => void;
  onCancel: () => void;
  onConvertLinear: () => void; // „Linear → DAG" (Editor füllt aus linearer Sequenz)
}

export function DagWorkflowEditor({
  workflowId,
  initialDag,
  linearSequence,
  workflowName,
  onSave,
  onCancel,
  onConvertLinear
}: DagEditorProps) {
  const { t } = useTranslation(["admin", "common"]);
  const wrapperRef = useRef<HTMLDivElement>(null);
 // UX-Fix: ReactFlow-Instanz über onInit (useReactFlow braucht
  // ReactFlowProvider als Ancestor — würde sonst Fehler #001 werfen)
  const [rfInstance, setRfInstance] = useState<{ zoomIn: (o?: { duration?: number }) => void; zoomOut: (o?: { duration?: number }) => void; fitView: (o?: { duration?: number }) => void } | null>(null);

  const initial = useMemo(() => {
    if (initialDag && initialDag.nodes && initialDag.nodes.length > 0) {
      return workflowToFlow(initialDag);
    }
    if (linearSequence && linearSequence.length > 0) {
      return workflowToFlow(linearToDag(linearSequence, workflowId, workflowName));
    }
    return { nodes: [], edges: [] };
  }, [initialDag, linearSequence, workflowId, workflowName]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges as Edge[]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const onConnect = useCallback(
    (conn: Connection) => {
      // Zyklen-Prävention beim Verbinden: Zielkante darf keinen Zyklus erzeugen
      const candidate: Edge[] = [
        ...edges,
        {
          id: `${conn.source}->${conn.target}`,
          source: conn.source || "",
          target: conn.target || "",
          sourceHandle: conn.sourceHandle || null,
          type: "smoothstep",
          markerEnd: { type: MarkerType.ArrowClosed }
        }
      ];
      if (!isAcyclic(nodes as unknown as Parameters<typeof isAcyclic>[0], candidate as unknown as Parameters<typeof isAcyclic>[1])) {
        setError(t('admin:workflows_tab.dag_cycle_error', { defaultValue: "Verbindung würde einen Zyklus erzeugen (DAG-Garantie verletzt)." }));
        return;
      }
      setError("");
      setEdges((eds) => addEdge({
        ...conn,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed }
      }, eds));
    },
    [edges, nodes, setEdges, t]
  );

  const addNode = useCallback((type: NodeConfigType | "RAG" | "ASK_USER") => {
    const pos = { x: 120 + Math.random() * 180, y: 80 + Math.random() * 160 };
    const nodeData = createEmptyNode(type, pos);
    // data.nodeType MUSS dem dag*-Canvas-Typ entsprechen (das Panel prüft darauf)
    const canvasType =
      type === "RAG" ? "dagRag" :
      type === "ASK_USER" ? "dagAskUser" :
      nodeData.type === "CONDITIONAL" ? "dagConditional" :
      nodeData.type === "WAIT" ? "dagWait" :
      nodeData.type === "HUMAN_GATE" ? "dagHumanGate" : "dagAction";
    const flowNode: Node = {
      id: nodeData.node_id,
      type: canvasType,
      position: pos,
      data: { label: nodeData.name, node: nodeData, nodeType: canvasType }
    };
    setNodes((nds) => [...nds, flowNode]);
 // Option A: neuen Knoten automatisch selektieren → Tool-Select +
    // Anweisungsfeld erscheinen sofort (bessere UX, deterministische Tests)
    setSelectedId(flowNode.id);
  }, [setNodes]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }, [selectedId, setNodes, setEdges]);

  const updateSelectedLabel = useCallback((label: string) => {
    setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, label } } : n)));
  }, [selectedId, setNodes]);

 // Option A: Tool + Anweisung eines ausgewählten Knotens aktualisieren
  const updateSelectedTool = useCallback((tool: string) => {
    const option = getToolOption(tool);
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selectedId) return n;
      const node = (n.data as DagNodeData).node;
      const updated: IWorkflowNode = {
        ...(node || createEmptyNode("ACTION", { x: 0, y: 0 })),
        tool_identifier: tool,
        name: option ? option.defaultValue : tool
      };
      return {
        ...n,
        data: {
          ...n.data,
          label: updated.name,
          node: updated,
          nodeType: (n.data as DagNodeData).nodeType || "dagAction"
        }
      };
    }));
  }, [selectedId, setNodes]);

  const updateSelectedInstruction = useCallback((instruction: string) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== selectedId) return n;
      const node = (n.data as DagNodeData).node;
      return {
        ...n,
        data: {
          ...n.data,
          node: { ...(node || createEmptyNode("ACTION", { x: 0, y: 0 })), instructions_template: instruction }
        }
      };
    }));
  }, [selectedId, setNodes]);

 // UX-Fix: WAIT-Zeit (Anweisung als "5 Minuten"/"30 Sekunden" formatieren,
  // das versteht parseWaitDurationToSeconds in beiden Engines)
  const parseWaitValue = useCallback((instruction: string): { value: string; unit: string } => {
    const raw = (instruction || "").toLowerCase();
    const numMatch = raw.match(/(\d+)/);
    const value = numMatch ? numMatch[1] : "5";
    if (/(minute|minuten|min)/.test(raw)) return { value, unit: "minuten" };
    if (/(hour|stunde|stunden|h)/.test(raw)) return { value, unit: "stunden" };
    if (/(day|tag|tage|t)/.test(raw)) return { value, unit: "tage" };
    return { value, unit: "sekunden" };
  }, []);

  const updateSelectedWait = useCallback((value: string, unit: string) => {
    const unitLabel =
      unit === "minuten" ? "Minuten" :
      unit === "stunden" ? "Stunden" :
      unit === "tage" ? "Tage" : "Sekunden";
    updateSelectedInstruction(`${value} ${unitLabel}`);
  }, [updateSelectedInstruction]);

  const handleSave = useCallback(() => {
    const dag = flowToWorkflow(
      nodes as unknown as Parameters<typeof flowToWorkflow>[0],
      edges as unknown as Parameters<typeof flowToWorkflow>[1],
      workflowId,
      workflowName,
      true
    );
    if (dag.nodes.length === 0) {
      setError(t('admin:workflows_tab.dag_empty_error', { defaultValue: "Der Graph ist leer — füge mindestens einen Knoten hinzu." }));
      return;
    }
    if (!isAcyclic(nodes as unknown as Parameters<typeof isAcyclic>[0], edges as unknown as Parameters<typeof isAcyclic>[1])) {
      setError(t('admin:workflows_tab.dag_cycle_error', { defaultValue: "Der Graph enthält einen Zyklus — bitte beheben." }));
      return;
    }
    setError("");
    onSave(dag);
  }, [nodes, edges, workflowId, workflowName, onSave, t]);

  const selectedNode = nodes.find((n) => n.id === selectedId);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-display mr-1">
          {t('admin:workflows_tab.dag_add_node', { defaultValue: "Knoten hinzufügen" })}
        </span>
        <button type="button" onClick={() => addNode("ACTION")} className="px-2.5 py-1.5 bg-accent-blue/20 hover:bg-accent-blue/30 border border-accent-blue/40 text-accent-blue text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_action', { defaultValue: "+ Aktion" })}
        </button>
        <button type="button" onClick={() => addNode("CONDITIONAL")} className="px-2.5 py-1.5 bg-accent-orange/20 hover:bg-accent-orange/30 border border-accent-orange/40 text-accent-orange text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_conditional', { defaultValue: "+ Bedingung" })}
        </button>
        <button type="button" onClick={() => addNode("WAIT")} className="px-2.5 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/40 text-violet-400 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_wait', { defaultValue: "+ Warten" })}
        </button>
        <button type="button" onClick={() => addNode("HUMAN_GATE")} className="px-2.5 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_human_gate', { defaultValue: "+ Freigabe" })}
        </button>
        <button type="button" onClick={() => addNode("RAG")} className="px-2.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-400 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_rag', { defaultValue: "+ RAG" })}
        </button>
        <button type="button" onClick={() => addNode("ASK_USER")} className="px-2.5 py-1.5 bg-pink-500/20 hover:bg-pink-500/30 border border-pink-500/40 text-pink-400 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_node_ask_user', { defaultValue: "+ Rückfrage" })}
        </button>

        <div className="flex-1" />

        <button type="button" onClick={onConvertLinear} className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
          {t('admin:workflows_tab.dag_convert_linear', { defaultValue: "↺ Linear → DAG" })}
        </button>
        {selectedId && (
          <button type="button" onClick={removeSelected} className="px-2.5 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-400 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all">
            {t('admin:workflows_tab.dag_delete_node', { defaultValue: "Knoten löschen" })}
          </button>
        )}
      </div>

      {/* Selected-Node-Editor — UX-Fix: klare Labels + typ-spezifische Felder */}
      {selectedNode && (
        <div className="bg-primary-light/20 border border-white/5 rounded-xl px-4 py-3 space-y-3">
          {/* Knotenname */}
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
              {t('admin:workflows_tab.dag_field_name_label', { defaultValue: "Knotenname" })}
            </label>
            <input
              value={(selectedNode.data?.label as string) || ""}
              onChange={(e) => updateSelectedLabel(e.target.value)}
              placeholder={t('admin:workflows_tab.dag_node_name_placeholder', { defaultValue: "z. B. Kontakte zählen" })}
              className="w-full bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue/40 font-sans"
            />
          </div>

          {(selectedNode.data?.nodeType === "dagAction" || selectedNode.data?.nodeType === "dagRag" || selectedNode.data?.nodeType === "dagAskUser") && (
            <>
              {/* Tool-Auswahl */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {selectedNode.data?.nodeType === "dagAction"
                    ? t('admin:workflows_tab.dag_field_tool_label', { defaultValue: "Auszuführendes Tool" })
                    : selectedNode.data?.nodeType === "dagRag"
                      ? t('admin:workflows_tab.dag_field_rag_label', { defaultValue: "Wissensquelle (RAG)" })
                      : t('admin:workflows_tab.dag_field_question_label', { defaultValue: "Rückfrage-Typ" })}
                </label>
                <select
                  value={((selectedNode.data?.node as IWorkflowNode)?.tool_identifier) || ""}
                  onChange={(e) => updateSelectedTool(e.target.value)}
                  data-testid="dag-node-tool-select"
                  className="w-full bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue/40 font-sans"
                >
                  <option value="">— {t('admin:workflows_tab.dag_select_tool', { defaultValue: "Tool wählen" })} —</option>
                  {DAG_TOOL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{t(opt.i18nKey, { defaultValue: opt.defaultValue })}</option>
                  ))}
                </select>
              </div>
              {/* Anweisung */}
              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
                  {selectedNode.data?.nodeType === "dagAskUser"
                    ? t('admin:workflows_tab.dag_field_ask_instruction_label', { defaultValue: "Frage an den Nutzer (JSON: {\"question\":\"…\",\"choices\":[…]})" })
                    : t('admin:workflows_tab.dag_field_instruction_label', { defaultValue: "Anweisung / Prompt für diesen Schritt" })}
                </label>
                <input
                  value={((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || ""}
                  onChange={(e) => updateSelectedInstruction(e.target.value)}
                  placeholder={selectedNode.data?.nodeType === "dagAskUser"
                    ? '{"question":"Soll der Workflow fortfahren?","choices":["Ja","Nein"]}'
                    : t('admin:workflows_tab.dag_node_instruction_placeholder', { defaultValue: "z. B. {\"task\":\"count_contacts\",\"description\":\"…\"} oder Freitext" })}
                  className="w-full bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue/40 font-sans"
                />
              </div>
            </>
          )}

          {(selectedNode.data?.nodeType === "dagWait") && (
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.dag_field_wait_label', { defaultValue: "Wartezeit" })}
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={parseWaitValue(((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || "").value}
                  onChange={(e) => updateSelectedWait(e.target.value || "0", parseWaitValue(((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || "").unit)}
                  data-testid="dag-wait-value"
                  className="w-24 bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue/40 font-sans"
                />
                <select
                  value={parseWaitValue(((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || "").unit}
                  onChange={(e) => updateSelectedWait(parseWaitValue(((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || "").value, e.target.value)}
                  data-testid="dag-wait-unit"
                  className="flex-1 bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue/40 font-sans"
                >
                  <option value="sekunden">{t('admin:workflows_tab.dag_wait_seconds', { defaultValue: "Sekunden" })}</option>
                  <option value="minuten">{t('admin:workflows_tab.dag_wait_minutes', { defaultValue: "Minuten" })}</option>
                  <option value="stunden">{t('admin:workflows_tab.dag_wait_hours', { defaultValue: "Stunden" })}</option>
                  <option value="tage">{t('admin:workflows_tab.dag_wait_days', { defaultValue: "Tage" })}</option>
                </select>
              </div>
            </div>
          )}

          {(selectedNode.data?.nodeType === "dagConditional") && (
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.dag_field_condition_label', { defaultValue: "Bedingung (Frage, die mit JA/NEIN beantwortet wird)" })}
              </label>
              <input
                value={((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || ""}
                onChange={(e) => updateSelectedInstruction(e.target.value)}
                placeholder={t('admin:workflows_tab.dag_condition_placeholder', { defaultValue: "z. B. Hat die Testfirma mehr als 0 Kontakte?" })}
                className="w-full bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/40 font-sans"
              />
              <p className="text-[9px] text-slate-500 font-sans">
                {t('admin:workflows_tab.dag_condition_hint', { defaultValue: "JA → rechter Folgeknoten · NEIN → Fallback (unteres oranges Handle)" })}
              </p>
            </div>
          )}

          {(selectedNode.data?.nodeType === "dagHumanGate") && (
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.dag_field_gate_label', { defaultValue: "Anweisung für die Freigabe (was muss der Nutzer prüfen?)" })}
              </label>
              <input
                value={((selectedNode.data?.node as IWorkflowNode)?.instructions_template) || ""}
                onChange={(e) => updateSelectedInstruction(e.target.value)}
                placeholder={t('admin:workflows_tab.dag_gate_placeholder', { defaultValue: "z. B. Bitte den E-Mail-Entwurf prüfen und freigeben" })}
                className="w-full bg-primary-dark border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/40 font-sans"
              />
            </div>
          )}

          <p className="text-[9px] text-slate-500 font-sans pt-1">
            {t('admin:workflows_tab.dag_node_hint', { defaultValue: "Ziehe von der rechten Kante zum nächsten Knoten. Orange unten = Fallback (Bedingung)." })}
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[11px] rounded-lg px-3 py-2 font-sans">
          {error}
        </div>
      )}

      {/* Canvas */}
      <div ref={wrapperRef} className="relative h-[480px] bg-primary-light/10 border border-white/10 rounded-2xl overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.3}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          onInit={(inst) => setRfInstance(inst as unknown as typeof rfInstance)}
        >
          <Background gap={18} size={1} color="rgba(148,163,184,0.15)" />
          <MiniMap pannable zoomable className="!bg-primary-dark/80" nodeColor="#0f172a" />
        </ReactFlow>

        {/* UX-Fix: eigene Navigations-Controls (dunkles Theme, i18n-Tooltips) */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 z-10">
          <button
            type="button"
            title={t('admin:workflows_tab.dag_zoom_in', { defaultValue: "Hineinzoomen" })}
            onClick={() => rfInstance?.zoomIn({ duration: 200 })}
            className="w-8 h-8 rounded-lg bg-primary-dark/90 border border-white/15 text-slate-200 hover:text-white hover:border-accent-blue/50 flex items-center justify-center cursor-pointer text-sm font-bold shadow-lg"
          >
            +
          </button>
          <button
            type="button"
            title={t('admin:workflows_tab.dag_zoom_out', { defaultValue: "Herauszoomen" })}
            onClick={() => rfInstance?.zoomOut({ duration: 200 })}
            className="w-8 h-8 rounded-lg bg-primary-dark/90 border border-white/15 text-slate-200 hover:text-white hover:border-accent-blue/50 flex items-center justify-center cursor-pointer text-sm font-bold shadow-lg"
          >
            −
          </button>
          <button
            type="button"
            data-testid="dag-fit-view"
            title={t('admin:workflows_tab.dag_fit_view', { defaultValue: "Ansicht einpassen" })}
            onClick={() => rfInstance?.fitView({ duration: 300 })}
            className="w-8 h-8 rounded-lg bg-primary-dark/90 border border-white/15 text-slate-200 hover:text-white hover:border-accent-blue/50 flex items-center justify-center cursor-pointer shadow-lg"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-black uppercase tracking-wider rounded-xl transition-all">
          {t('common:close', { defaultValue: "Abbrechen" })}
        </button>
        <button type="button" onClick={handleSave} className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all">
          {t('admin:workflows_tab.dag_save', { defaultValue: "Graph speichern" })}
        </button>
      </div>
    </div>
  );
}
