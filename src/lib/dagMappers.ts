// ============================================================================
// 4B (T4): DAG-Mapper — reine Funktionen für den visuellen Editor.
// IWorkflowDAG ↔ React-Flow-Graph, Zyklen-Validierung (DAG-Garantie),
// Linear→DAG-Konvertierung. Kein any (Regel 4), testbar ohne React.
// ============================================================================
import { IWorkflowDAG, IWorkflowNode, NodeConfigType } from "../types/workflows.js";
import { normalizeToolIdentifier } from "./dagToolOptions.js";

// React-Flow-Node (minimale Struktur — keine @xyflow-Importe, damit die
// Mapper in Unit-Tests ohne DOM laufen)
export interface FlowNodeLike {
  id: string;
  type: string; // "dagAction" | "dagConditional" | "dagWait" | "dagHumanGate" | "dagRag" | "dagAskUser"
  position: { x: number; y: number };
  data: {
    label: string;
    node: IWorkflowNode;
  };
}

export interface FlowEdgeLike {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
}

export const NODE_TYPE_MAP: Record<NodeConfigType, string> = {
  ACTION: "dagAction",
  CONDITIONAL: "dagConditional",
  WAIT: "dagWait",
  HUMAN_GATE: "dagHumanGate"
};

export const NODE_TYPE_LABELS: Record<string, string> = {
  dagAction: "Aktion",
  dagConditional: "Bedingung",
  dagWait: "Warten",
  dagHumanGate: "Freigabe",
  dagRag: "RAG-Suche",
  dagAskUser: "Rückfrage"
};

// Knoten-Neu-Anlage (Editor-Palette → Graph)
export function createEmptyNode(
  type: NodeConfigType | "RAG" | "ASK_USER",
  position: { x: number; y: number },
  name?: string
): IWorkflowNode {
  const baseName = name || (type === "RAG" ? "RAG-Suche" : type === "ASK_USER" ? "Rückfrage" : type.charAt(0) + type.slice(1).toLowerCase());
  return {
    node_id: `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: `${baseName}`,
    type: (type === "RAG" ? "ACTION" : type === "ASK_USER" ? "ACTION" : type) as NodeConfigType,
    tool_identifier: type === "RAG" ? "LocalKnowledgeSearch" : type === "ASK_USER" ? "AskUserQuestion" : type === "CONDITIONAL" ? "ConditionalBranch" : "SendEmail",
    instructions_template: "",
    next_node_ids: [],
    rag_enabled: type === "RAG" ? true : undefined,
    rag_query: type === "RAG" ? "" : undefined
  };
}

// React-Flow-Knoten-Typ aus IWorkflowNode ableiten (RAG/ASK_USER sind
// ACTION-Sonderfälle über tool_identifier). Nachtrag: snake_case-Namen
// (local_knowledge) genauso erkennen wie executeX-/PascalCase-Altbestand.
export function flowTypeForNode(node: IWorkflowNode): string {
  const tool = normalizeToolIdentifier(node.tool_identifier || "");
  if (node.rag_enabled || tool === "local_knowledge" || node.tool_identifier === "LocalKnowledgeSearch" || node.tool_identifier === "RagSearch") return "dagRag";
  if (tool === "ask_user_question" || node.tool_identifier === "AskUserQuestion") return "dagAskUser";
  return NODE_TYPE_MAP[node.type] || "dagAction";
}

// IWorkflowDAG → React-Flow-Graph (deterministisches Auto-Layout via einfacher
// Zeilen-Spalten-Anordnung; kein dagre-Dependency nötig)
export function workflowToFlow(dag: IWorkflowDAG): { nodes: FlowNodeLike[]; edges: FlowEdgeLike[] } {
  const nodes: FlowNodeLike[] = (dag.nodes || []).map((n, idx) => {
    const type = flowTypeForNode(n);
    return {
      id: n.node_id,
      type,
      position: { x: 140 + (idx % 3) * 240, y: 60 + Math.floor(idx / 3) * 140 },
      data: {
        label: n.name || n.node_id,
        // nodeType MUSS gesetzt sein — der Selected-Node-Editor (DagWorkflowEditor)
        // rendert das Tool-/Anweisungs-Panel nur bei data.nodeType === "dagAction" usw.
        // Ohne nodeType blieben geladene Workflows komplett uneditierbar.
        nodeType: type,
        // Nachtrag: tool_identifier beim Laden auf snake_case normalisieren —
        // executeX-Altbestand wird so im Editor korrekt angezeigt und beim Speichern
        // konsistent als snake_case geschrieben (Namenswelt-Vereinheitlichung).
        node: n.tool_identifier ? { ...n, tool_identifier: normalizeToolIdentifier(n.tool_identifier) } : n
      }
    };
  });

  const edges: FlowEdgeLike[] = [];
  for (const n of dag.nodes || []) {
    for (const targetId of n.next_node_ids || []) {
      edges.push({
        id: `${n.node_id}->${targetId}`,
        source: n.node_id,
        target: targetId
      });
    }
    if (n.fallback_node_id) {
      edges.push({
        id: `${n.node_id}-fb->${n.fallback_node_id}`,
        source: n.node_id,
        target: n.fallback_node_id,
        sourceHandle: "fallback"
      });
    }
  }
  return { nodes, edges };
}

// React-Flow-Graph → IWorkflowDAG
export function flowToWorkflow(
  nodes: FlowNodeLike[],
  edges: FlowEdgeLike[],
  workflowId: string,
  title: string,
  isActive: boolean
): IWorkflowDAG {
  const byId = new Map<string, FlowNodeLike>();
  for (const n of nodes) byId.set(n.id, n);

  const dagNodes: IWorkflowNode[] = nodes.map((n) => {
    const node = n.data?.node || createEmptyNode("ACTION", { x: 0, y: 0 }, n.id);
    return {
      ...node,
      node_id: n.id,
      name: n.data?.label || node.name || n.id,
      next_node_ids: edges
        .filter((e) => e.source === n.id && e.sourceHandle !== "fallback")
        .map((e) => e.target)
        .filter((t) => byId.has(t))
    };
  });

  // fallback_node_id aus fallback-Kanten rekonstruieren
  for (const n of dagNodes) {
    const fbEdge = edges.find((e) => e.source === n.node_id && e.sourceHandle === "fallback");
    if (fbEdge && byId.has(fbEdge.target)) {
      n.fallback_node_id = fbEdge.target;
    } else {
      delete n.fallback_node_id;
    }
  }

  const startNode = dagNodes.find((n) => !edges.some((e) => e.target === n.node_id && e.sourceHandle !== "fallback"));
  return {
    workflow_id: workflowId,
    title: title || "Workflow-Graph",
    is_active: isActive,
    start_node_id: startNode?.node_id || dagNodes[0]?.node_id || "",
    nodes: dagNodes
  };
}

// Zyklen-Validierung (Kahn-Algorithmus) — garantiert DAG-Eigenschaft.
// Gibt true zurück, wenn der Graph azyklisch ist; false bei Zyklus.
export function isAcyclic(nodes: FlowNodeLike[], edges: FlowEdgeLike[]): boolean {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    adj.get(e.source)?.push(e.target);
    indegree.set(e.target, (indegree.get(e.target) || 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) queue.push(id);
  }
  let visited = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    visited++;
    for (const next of adj.get(id) || []) {
      const d = (indegree.get(next) || 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return visited === nodes.length;
}

// Linear (tool_chain_sequence) → DAG (1-Klick-Konvertierung)
export function linearToDag(
  sequence: Array<{ tool: string; instruction: string }>,
  workflowId: string,
  title: string
): IWorkflowDAG {
  const nodes: IWorkflowNode[] = sequence.map((step, i) => ({
    node_id: `step_${i + 1}`,
    name: step.tool,
    type: "ACTION" as NodeConfigType,
    tool_identifier: step.tool,
    instructions_template: step.instruction || "",
    next_node_ids: i < sequence.length - 1 ? [`step_${i + 2}`] : []
  }));
  return {
    workflow_id: workflowId,
    title: title || "Workflow-Graph",
    is_active: false,
    start_node_id: nodes.length > 0 ? nodes[0].node_id : "",
    nodes
  };
}
