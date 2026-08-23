// ============================================================================
// Option A: Tool-Picker-Optionen für den DAG-Editor.
// Die Tool-Auswahl für ACTION-Knoten wandert vom (entfernten) linearen Editor
// in den Graph-Editor. i18n-Keys existieren unter admin.workflows_tab.tools.<id>.
//
// Nachtrag: Werte sind snake_case (Konsistenz mit learn_workflow-Ausgabe und
// WORKFLOW_EXECUTOR_TOOL_NAMES). executeX-Altbestand (manuell erstellte Workflows)
// wird via normalizeToolIdentifier/getToolOption aufgelöst — Abwärtskompatibilität.
// ============================================================================

export interface DagToolOption {
  value: string; // snake_case (vom WorkflowGraphExecutor verstanden)
  i18nKey: string; // admin:workflows_tab.tools.<key>
  defaultValue: string;
}

export const DAG_TOOL_OPTIONS: DagToolOption[] = [
  { value: "crm_data_analyst", i18nKey: "admin:workflows_tab.tools.crm_analyst", defaultValue: "CRM Data Analyst (CRM Abfrage & Analyse)" },
  { value: "web_search", i18nKey: "admin:workflows_tab.tools.web_search", defaultValue: "Web Search (Online Suche)" },
  { value: "local_knowledge", i18nKey: "admin:workflows_tab.tools.local_knowledge", defaultValue: "Local Knowledge (RAG Suche)" },
  { value: "text_generator", i18nKey: "admin:workflows_tab.tools.text_generator", defaultValue: "Text-Generator (Optimiertes Schreiben)" },
  { value: "create_invoice_draft", i18nKey: "admin:workflows_tab.tools.create_draft_invoice", defaultValue: "Create Draft Invoice (Rechnungsentwurf)" },
  { value: "create_company_draft", i18nKey: "admin:workflows_tab.tools.create_draft_company", defaultValue: "Create Draft Company (Firmenentwurf)" },
  { value: "create_contact_draft", i18nKey: "admin:workflows_tab.tools.create_draft_contact", defaultValue: "Create Draft Contact (Kontaktentwurf)" },
  { value: "create_offer_draft", i18nKey: "admin:workflows_tab.tools.create_draft_offer", defaultValue: "Create Draft Offer (Angebotsentwurf)" },
  { value: "finalize_and_send_offer", i18nKey: "admin:workflows_tab.tools.finalize_and_send_offer", defaultValue: "Finalize & Send Offer (Angebot abschließen & senden)" },
  { value: "send_smtp_email", i18nKey: "admin:workflows_tab.tools.send_smtp_email", defaultValue: "Send SMTP Email (E-Mail-Versand)" },
  { value: "list_kanban_boards", i18nKey: "admin:workflows_tab.tools.list_kanban_boards", defaultValue: "List Kanban Boards (Kanban-Boards auflisten)" },
  { value: "get_kanban_board_details", i18nKey: "admin:workflows_tab.tools.get_kanban_board_details", defaultValue: "Get Kanban Board Details (Kanban-Board Details abrufen)" },
  { value: "create_kanban_card", i18nKey: "admin:workflows_tab.tools.create_kanban_card", defaultValue: "Create Kanban Card (Kanban-Karte erstellen)" },
  { value: "update_kanban_card", i18nKey: "admin:workflows_tab.tools.update_kanban_card", defaultValue: "Update Kanban Card (Kanban-Karte aktualisieren)" },
  { value: "move_kanban_card", i18nKey: "admin:workflows_tab.tools.move_kanban_card", defaultValue: "Move Kanban Card (Kanban-Karte verschieben)" },
  { value: "delete_kanban_card", i18nKey: "admin:workflows_tab.tools.delete_kanban_card", defaultValue: "Delete Kanban Card (Kanban-Karte löschen)" },
  { value: "get_templates", i18nKey: "admin:workflows_tab.tools.get_templates", defaultValue: "Get Templates (Vorlagen suchen & abrufen)" },
  { value: "get_template_details", i18nKey: "admin:workflows_tab.tools.get_template_details", defaultValue: "Get Template Details (Vorlagendetails abrufen)" },
  { value: "apply_template", i18nKey: "admin:workflows_tab.tools.apply_template", defaultValue: "Apply Template (Vorlage anwenden & Platzhalter ausfüllen)" },
  { value: "create_note_draft", i18nKey: "admin:workflows_tab.tools.create_note_draft", defaultValue: "Create Note Draft (Notiz-Entwurf für Kontakt/Firma)" },
  { value: "vault_search", i18nKey: "admin:workflows_tab.tools.vault_search", defaultValue: "Vault Search (Obsidian-Wissensvault durchsuchen)" },
  { value: "vault_read", i18nKey: "admin:workflows_tab.tools.vault_read", defaultValue: "Vault Read (Datei aus Wissensvault lesen)" },
  { value: "list_vault_files", i18nKey: "admin:workflows_tab.tools.list_vault_files", defaultValue: "List Vault Files (Vault-Dateien auflisten)" },
  { value: "recall_sessions", i18nKey: "admin:workflows_tab.tools.recall_sessions", defaultValue: "Recall Sessions (Vergangene KI-Sessions durchsuchen)" },
  { value: "update_memory", i18nKey: "admin:workflows_tab.tools.update_memory", defaultValue: "Update Memory (Präferenzen & Notizen merken)" },
  { value: "save_skill", i18nKey: "admin:workflows_tab.tools.save_skill", defaultValue: "Save Skill (Wissens-Skill vorschlagen — Freigabe via Chat)" },
  { value: "get_workflows", i18nKey: "admin:workflows_tab.tools.get_workflows", defaultValue: "Get Workflows (Gelernte Workflows abrufen)" },
  { value: "learn_workflow", i18nKey: "admin:workflows_tab.tools.learn_workflow", defaultValue: "Learn Workflow (Neues Workflow-Makro erlernen)" },
  { value: "ask_user_question", i18nKey: "admin:workflows_tab.tools.ask_user_question", defaultValue: "Ask User Question (Rückfrage — Workflow pausiert bis Antwort)" },
  { value: "delegate_subtask", i18nKey: "admin:workflows_tab.tools.delegate_subtask", defaultValue: "Delegate Subtask (Teilaufgabe an Sub-Agent (max. 3 parallel))" },
  // G2–G8 : Update-Tools, Notizen-Vollverwaltung, Kanban-Board, Mail-Drafts, Vault-Writes
  { value: "update_company_draft", i18nKey: "admin:workflows_tab.tools.update_company_draft", defaultValue: "Update Company (Firma aktualisieren — Partial-Update)" },
  { value: "update_contact_draft", i18nKey: "admin:workflows_tab.tools.update_contact_draft", defaultValue: "Update Contact (Kontakt aktualisieren — inkl. Opt-ins)" },
  { value: "update_invoice_draft", i18nKey: "admin:workflows_tab.tools.update_invoice_draft", defaultValue: "Update Invoice (Rechnung aktualisieren — Status/Betrag)" },
  { value: "update_offer_draft", i18nKey: "admin:workflows_tab.tools.update_offer_draft", defaultValue: "Update Offer (Angebot aktualisieren)" },
  { value: "list_notes", i18nKey: "admin:workflows_tab.tools.list_notes", defaultValue: "List Notes (Notizen auflisten)" },
  { value: "update_note", i18nKey: "admin:workflows_tab.tools.update_note", defaultValue: "Update Note (Notiz ändern)" },
  { value: "delete_note", i18nKey: "admin:workflows_tab.tools.delete_note", defaultValue: "Delete Note (Notiz löschen)" },
  { value: "create_kanban_board", i18nKey: "admin:workflows_tab.tools.create_kanban_board", defaultValue: "Create Kanban Board (Kanban-Board anlegen)" },
  { value: "list_mail_drafts", i18nKey: "admin:workflows_tab.tools.list_mail_drafts", defaultValue: "List Mail Drafts (E-Mail-Entwürfe abrufen)" },
  { value: "vault_write", i18nKey: "admin:workflows_tab.tools.vault_write", defaultValue: "Vault Write (Datei im Wissensvault anlegen)" },
  { value: "vault_update", i18nKey: "admin:workflows_tab.tools.vault_update", defaultValue: "Vault Update (Vault-Datei aktualisieren)" },
  { value: "vault_delete", i18nKey: "admin:workflows_tab.tools.vault_delete", defaultValue: "Vault Delete (Vault-Datei löschen)" }
];

/**
 * Explizites Mapping executeX-Altbestand → snake_case (Wahrheit aus den
 * Dispatch-Zweigen des WorkflowGraphExecutor). Nicht mechanisch ableitbar
 * (z. B. executeLocalKnowledgeSearch → local_knowledge, NICHT local_knowledge_search).
 */
const EXECUTE_TO_SNAKE_MAP: Record<string, string> = {
  executeCrmDataAnalyst: "crm_data_analyst",
  executeWebSearch: "web_search",
  executeLocalKnowledgeSearch: "local_knowledge",
  executeTextGenerator: "text_generator",
  executeCreateDraftInvoice: "create_invoice_draft",
  executeCreateDraftCompany: "create_company_draft",
  executeCreateDraftContact: "create_contact_draft",
  executeCreateDraftOffer: "create_offer_draft",
  executeFinalizeAndSendOffer: "finalize_and_send_offer",
  executeSendSmtpEmail: "send_smtp_email",
  executeListKanbanBoards: "list_kanban_boards",
  executeGetKanbanBoardDetails: "get_kanban_board_details",
  executeCreateKanbanCard: "create_kanban_card",
  executeUpdateKanbanCard: "update_kanban_card",
  executeMoveKanbanCard: "move_kanban_card",
  executeDeleteKanbanCard: "delete_kanban_card",
  executeGetTemplates: "get_templates",
  executeGetTemplateDetails: "get_template_details",
  executeApplyTemplate: "apply_template",
  executeCreateNoteDraft: "create_note_draft",
  executeVaultSearch: "vault_search",
  executeVaultRead: "vault_read",
  executeListVaultFiles: "list_vault_files",
  executeRecallSessions: "recall_sessions",
  executeUpdateMemory: "update_memory",
  executeSaveSkill: "save_skill",
  executeGetWorkflows: "get_workflows",
  executeLearnWorkflow: "learn_workflow",
  executeAskUserQuestion: "ask_user_question",
  executeDelegateSubtask: "delegate_subtask",
  executeUpdateDraftCompany: "update_company_draft",
  executeUpdateDraftContact: "update_contact_draft",
  executeUpdateDraftInvoice: "update_invoice_draft",
  executeUpdateDraftOffer: "update_offer_draft",
  executeListNotes: "list_notes",
  executeUpdateNote: "update_note",
  executeDeleteNote: "delete_note",
  executeCreateKanbanBoard: "create_kanban_board",
  executeListMailDrafts: "list_mail_drafts",
  executeVaultWrite: "vault_write",
  executeVaultUpdate: "vault_update",
  executeVaultDelete: "vault_delete"
};

/**
 * Normalisiert einen Tool-Namen auf die snake_case-Schreibweise (Nachtrag).
 * executeX-Altbestand wird über das explizite Mapping aufgelöst; snake_case und
 * Spezialnamen bleiben unverändert. Leere Werte bleiben leer.
 */
export function normalizeToolIdentifier(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("execute")) {
    return EXECUTE_TO_SNAKE_MAP[raw] || raw;
  }
  return raw;
}

export function getToolOption(value: string): DagToolOption | undefined {
  const normalized = normalizeToolIdentifier(value);
  return DAG_TOOL_OPTIONS.find((o) => o.value === normalized);
}
