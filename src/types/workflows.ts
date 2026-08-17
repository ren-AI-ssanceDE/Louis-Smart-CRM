// src/types/workflows.ts

export type NodeConfigType = "ACTION" | "CONDITIONAL" | "WAIT" | "HUMAN_GATE";

export interface IWorkflowNode {
  node_id: string;
  name: string;
  type: NodeConfigType;
  tool_identifier: "SendEmail" | "CreateNote" | "TelegramNotify" | "ConditionalBranch" | "create_kanban_card" | "CreateKanbanCard" | "move_kanban_card" | "MoveKanbanCard" | "update_kanban_card" | "UpdateKanbanCard" | "delete_kanban_card" | "DeleteKanbanCard" | (string & {});
  instructions_template: string; // Supports template variables like {{customer.name}}
  next_node_ids: string[]; // Multiple IDs allow parallel execution (Fork)
  fallback_node_id?: string; // Alternative node in case of error or false case
  model_selection?: string; // Specific engine ID for this dedicated node
  rag_enabled?: boolean; // Enables RAG knowledge search specifically for this step
  rag_query?: string; // Search term/template (e.g. "Company guidelines for {{customer.industry}}")
}

export interface IWorkflowDAG {
  workflow_id: string;
  title: string;
  is_active: boolean;
  start_node_id: string;
  nodes: IWorkflowNode[];
}

export interface IWorkflowContextState {
  initial_payload: Record<string, unknown>;
  node_results: Record<string, Record<string, unknown>>; // Results indexed by node ID
}
