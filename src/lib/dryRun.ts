// ============================================================================
// 4C (T8b): Dry-Run/Simulation — deterministische Workflow-Analyse.
// Ohne LLM, ohne Seiteneffekte: DAG-Struktur validieren, alle Pfade vom
// Startknoten traversieren, Seiteneffekt-Risiko je Knoten klassifizieren.
// Reine Funktionen — in Unit-Tests ohne Server/DOM testbar. Kein any (Regel 4).
// ============================================================================
import { IWorkflowDAG, IWorkflowNode } from "../types/workflows.js";
import { DAG_TOOL_OPTIONS, normalizeToolIdentifier } from "./dagToolOptions.js";

// Tool-Namen mit ECHTEM Seiteneffekt (schreiben/versenden) — der Dry-Run warnt davor.
const SIDE_EFFECT_TOOL_MARKERS = [
  "send_smtp_email", "SendSmtpEmail", "executeSendSmtpEmail",
  "finalize_and_send_offer", "FinalizeAndSendOffer", "executeFinalizeAndSendOffer",
  "create_kanban_card", "CreateKanbanCard", "executeCreateKanbanCard",
  "move_kanban_card", "MoveKanbanCard", "executeMoveKanbanCard",
  "update_kanban_card", "UpdateKanbanCard", "executeUpdateKanbanCard",
  "delete_kanban_card", "DeleteKanbanCard", "executeDeleteKanbanCard",
  "update_memory", "UpdateMemory", "executeUpdateMemory",
  "learn_workflow", "LearnWorkflow", "executeLearnWorkflow",
  "apply_template", "ApplyTemplate", "executeApplyTemplate",
  "TelegramNotify"
];

export interface DryRunNodeReport {
  node_id: string;
  name: string;
  type: string;
  tool_identifier: string;
  has_instruction: boolean;
  has_side_effect: boolean;
  side_effect_hint?: string;
  reachable: boolean;
  warnings: string[];
}

export interface DryRunReport {
  workflow_id: string;
  title: string;
  valid: boolean;
  start_node_id: string | null;
  start_node_exists: boolean;
  node_count: number;
  edge_count: number;
  path_count: number;
  longest_path_length: number;
  has_cycles: boolean;
  unknown_tools: string[];
  nodes: DryRunNodeReport[];
  summary: string[];
}

function isSideEffectTool(tool: string): boolean {
  return SIDE_EFFECT_TOOL_MARKERS.some((m) => tool === m);
}

export function classifyToolRisk(tool: string): { side_effect: boolean; hint?: string } {
  if (isSideEffectTool(tool)) {
    return { side_effect: true, hint: "Schreibt Daten oder versendet Nachrichten — im Dry-Run NICHT ausgeführt." };
  }
  return { side_effect: false };
}

// Folgeknoten eines Knotens inkl. Fallback (für Pfad-Traversierung)
function successors(dag: IWorkflowDAG, nodeId: string): string[] {
  const node = dag.nodes.find((n) => n.node_id === nodeId);
  if (!node) return [];
  const next = [...(node.next_node_ids || [])];
  if (node.fallback_node_id && !next.includes(node.fallback_node_id)) {
    next.push(node.fallback_node_id);
  }
  return next.filter((id) => dag.nodes.some((n) => n.node_id === id));
}

// Alle Pfade vom Startknoten aus zählen (einfache DFS mit Zyklus-Schutz)
function countPaths(dag: IWorkflowDAG, startId: string, visited: Set<string>): number {
  const node = dag.nodes.find((n) => n.node_id === startId);
  if (!node) return 0;
  if (visited.has(startId)) return 0; // Zyklus-Schutz
  const next = successors(dag, startId);
  if (next.length === 0) return 1; // Endknoten = ein Pfad
  const nextVisited = new Set(visited).add(startId);
  return next.reduce((sum, id) => sum + countPaths(dag, id, nextVisited), 0);
}

function longestPath(dag: IWorkflowDAG, startId: string, visited: Set<string>): number {
  const node = dag.nodes.find((n) => n.node_id === startId);
  if (!node) return 0;
  if (visited.has(startId)) return 0;
  const next = successors(dag, startId);
  if (next.length === 0) return 1;
  const nextVisited = new Set(visited).add(startId);
  return 1 + Math.max(...next.map((id) => longestPath(dag, id, nextVisited)));
}

/**
 * Deterministischer Dry-Run: validiert den Graphen, traversiert alle Pfade vom
 * Startknoten und klassifiziert jedes Knoten-Risiko (Seiteneffekt, fehlende
 * Anweisung, unbekanntes Tool, Erreichbarkeit). Führt NICHTS aus.
 */
export function dryRunDag(dag: IWorkflowDAG | null | undefined): DryRunReport {
  const report: DryRunReport = {
    workflow_id: dag?.workflow_id || "",
    title: dag?.title || "Unbekannter Workflow",
    valid: false,
    start_node_id: dag?.start_node_id || null,
    start_node_exists: false,
    node_count: dag?.nodes?.length || 0,
    edge_count: 0,
    path_count: 0,
    longest_path_length: 0,
    has_cycles: false,
    unknown_tools: [],
    nodes: [],
    summary: []
  };

  if (!dag || !Array.isArray(dag.nodes)) {
    report.summary.push("Keine DAG-Struktur vorhanden.");
    return report;
  }

  const nodeIds = new Set(dag.nodes.map((n) => n.node_id));
  const startId = dag.start_node_id;

  // Startknoten
  if (startId && nodeIds.has(startId)) {
    report.start_node_exists = true;
  } else {
    report.summary.push(`Startknoten '${startId || "(leer)"}' existiert nicht.`);
  }

  // Kanten zählen + nächste-Knoten-Existenz prüfen
  let edges = 0;
  const edgeTargets = new Set<string>();
  for (const n of dag.nodes) {
    for (const nextId of (n.next_node_ids || [])) {
      edges++;
      edgeTargets.add(nextId);
      if (!nodeIds.has(nextId)) {
        report.summary.push(`Knoten '${n.node_id}' verweist auf unbekannten Folgeknoten '${nextId}'.`);
      }
    }
    if (n.fallback_node_id && !nodeIds.has(n.fallback_node_id)) {
      report.summary.push(`Knoten '${n.node_id}' hat unbekannten Fallback '${n.fallback_node_id}'.`);
    }
  }
  report.edge_count = edges;

  // Zyklus-Erkennung (Kahn/DFS-Farbe) — inkl. Fallback-Kanten
  const color = new Map<string, "gray" | "black">();
  let hasCycle = false;
  const visit = (id: string): void => {
    if (color.get(id) === "black") return;
    if (color.get(id) === "gray") { hasCycle = true; return; }
    color.set(id, "gray");
    for (const nextId of successors(dag, id)) visit(nextId);
    color.set(id, "black");
  };
  for (const n of dag.nodes) visit(n.node_id);
  report.has_cycles = hasCycle;
  if (hasCycle) report.summary.push("Zyklus im Graphen erkannt — Endlosschleife möglich!");

  // Pfad-Zählung + Erreichbarkeit (ab Startknoten)
  if (startId && nodeIds.has(startId)) {
    report.path_count = countPaths(dag, startId, new Set());
    report.longest_path_length = longestPath(dag, startId, new Set());
    // Erreichbare Knoten sammeln
    const reachable = new Set<string>();
    const walk = (id: string, seen: Set<string>): void => {
      if (reachable.has(id) || seen.has(id)) return;
      reachable.add(id);
      for (const nextId of successors(dag, id)) {
        walk(nextId, new Set(seen).add(id));
      }
    };
    walk(startId, new Set());
    report.summary.push(`${report.path_count} Pfad(e) vom Startknoten, längster Pfad: ${report.longest_path_length} Knoten.`);
    for (const n of dag.nodes) {
      if (!reachable.has(n.node_id)) {
        report.summary.push(`Knoten '${n.node_id}' ist vom Startknoten NICHT erreichbar (toter Pfad).`);
      }
    }
  } else {
    for (const n of dag.nodes) {
      report.summary.push(`Knoten '${n.node_id}' ist nicht erreichbar (kein gültiger Startknoten).`);
    }
  }

  // Knoten-Reports
  const reachableFromStart = new Set<string>();
  if (startId && nodeIds.has(startId)) {
    const walk = (id: string, seen: Set<string>): void => {
      if (reachableFromStart.has(id) || seen.has(id)) return;
      reachableFromStart.add(id);
      for (const nextId of successors(dag, id)) {
        walk(nextId, new Set(seen).add(id));
      }
    };
    walk(startId, new Set());
  }

  for (const n of dag.nodes) {
    const risk = classifyToolRisk(n.tool_identifier || "");
    const warnings: string[] = [];
    const tool = n.tool_identifier || "";
    // Nachtrag: executeX-Altbestand auf snake_case normalisieren, damit der
    // Dry-Run beide Schreibweisen akzeptiert (wie der Editor und die Executor-Liste).
    const normalizedTool = normalizeToolIdentifier(tool);
    // Bekannt = im Tool-Picker-Katalog ODER ein von der DAG-Engine direkt
    // unterstützter Spezial-Bezeichner
    const knownTool =
      DAG_TOOL_OPTIONS.some((o) => o.value === normalizedTool) ||
      tool === "SendEmail" || tool === "CreateNote" || tool === "TelegramNotify" ||
      tool === "AskUserQuestion" || tool === "ask_user_question" ||
      tool === "DelegateSubtask" || tool === "delegate_subtask" ||
      tool === "ConditionalBranch" || tool === "conditional" ||
      /^create_kanban_card|^move_kanban_card|^update_kanban_card|^delete_kanban_card/.test(normalizedTool);
    if (!tool) {
      warnings.push("Kein Tool zugewiesen.");
      report.unknown_tools.push(n.node_id);
    } else if (!knownTool) {
      warnings.push(`Tool '${tool}' ist der DAG-Engine unbekannt.`);
      report.unknown_tools.push(tool);
    }
    if (!n.instructions_template || !String(n.instructions_template).trim()) {
      warnings.push("Keine Anweisung hinterlegt.");
    }
    if (risk.side_effect && risk.hint) warnings.push(risk.hint);

    report.nodes.push({
      node_id: n.node_id,
      name: n.name || n.node_id,
      type: n.type,
      tool_identifier: tool,
      has_instruction: !!n.instructions_template && !!String(n.instructions_template).trim(),
      has_side_effect: risk.side_effect,
      side_effect_hint: risk.hint,
      reachable: reachableFromStart.has(n.node_id),
      warnings
    });
  }

  // Gesamt-Validität: Startknoten existiert, keine Zyklen, keine unbekannten Tools,
  // jeder Knoten erreichbar
  report.valid =
    report.start_node_exists &&
    !report.has_cycles &&
    report.unknown_tools.length === 0 &&
    report.nodes.every((n) => n.reachable);

  if (report.valid) {
    report.summary.push("Dry-Run: Workflow ist strukturell gültig und ausführbar.");
  } else {
    report.summary.push("Dry-Run: Es wurden Probleme gefunden (siehe Knoten-Warnungen).");
  }

  return report;
}

/** Konvertiert eine (ggf. JSONB-String) dag_structure in ein Objekt. */
export function normalizeDag(raw: unknown): IWorkflowDAG | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as IWorkflowDAG;
    } catch {
      return null;
    }
  }
  return raw as IWorkflowDAG;
}
