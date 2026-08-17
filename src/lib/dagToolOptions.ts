// ============================================================================
// Auftrag 008 Option A: Tool-Picker-Optionen für den DAG-Editor.
// Die Tool-Auswahl für ACTION-Knoten wandert vom (entfernten) linearen Editor
// in den Graph-Editor. i18n-Keys existieren unter admin.workflows_tab.tools.<id>.
// ============================================================================

export interface DagToolOption {
  value: string; // executeX / snake_case (vom WorkflowExecutor verstanden)
  i18nKey: string; // admin:workflows_tab.tools.<key>
  defaultValue: string;
}

export const DAG_TOOL_OPTIONS: DagToolOption[] = [
  { value: "executeCrmDataAnalyst", i18nKey: "admin:workflows_tab.tools.crm_analyst", defaultValue: "CRM Data Analyst (CRM Abfrage & Analyse)" },
  { value: "executeWebSearch", i18nKey: "admin:workflows_tab.tools.web_search", defaultValue: "Web Search (Online Suche)" },
  { value: "executeLocalKnowledgeSearch", i18nKey: "admin:workflows_tab.tools.local_knowledge", defaultValue: "Local Knowledge (RAG Suche)" },
  { value: "executeTextGenerator", i18nKey: "admin:workflows_tab.tools.text_generator", defaultValue: "Text-Generator (Optimiertes Schreiben)" },
  { value: "executeCreateDraftInvoice", i18nKey: "admin:workflows_tab.tools.create_draft_invoice", defaultValue: "Create Draft Invoice (Rechnungsentwurf)" },
  { value: "executeCreateDraftCompany", i18nKey: "admin:workflows_tab.tools.create_draft_company", defaultValue: "Create Draft Company (Firmenentwurf)" },
  { value: "executeCreateDraftContact", i18nKey: "admin:workflows_tab.tools.create_draft_contact", defaultValue: "Create Draft Contact (Kontaktentwurf)" },
  { value: "executeCreateDraftOffer", i18nKey: "admin:workflows_tab.tools.create_draft_offer", defaultValue: "Create Draft Offer (Angebotsentwurf)" },
  { value: "executeFinalizeAndSendOffer", i18nKey: "admin:workflows_tab.tools.finalize_and_send_offer", defaultValue: "Finalize & Send Offer (Angebot abschließen & senden)" },
  { value: "executeSendSmtpEmail", i18nKey: "admin:workflows_tab.tools.send_smtp_email", defaultValue: "Send SMTP Email (E-Mail-Versand)" },
  { value: "executeListKanbanBoards", i18nKey: "admin:workflows_tab.tools.list_kanban_boards", defaultValue: "List Kanban Boards (Kanban-Boards auflisten)" },
  { value: "executeGetKanbanBoardDetails", i18nKey: "admin:workflows_tab.tools.get_kanban_board_details", defaultValue: "Get Kanban Board Details (Kanban-Board Details abrufen)" },
  { value: "executeCreateKanbanCard", i18nKey: "admin:workflows_tab.tools.create_kanban_card", defaultValue: "Create Kanban Card (Kanban-Karte erstellen)" },
  { value: "executeUpdateKanbanCard", i18nKey: "admin:workflows_tab.tools.update_kanban_card", defaultValue: "Update Kanban Card (Kanban-Karte aktualisieren)" },
  { value: "executeMoveKanbanCard", i18nKey: "admin:workflows_tab.tools.move_kanban_card", defaultValue: "Move Kanban Card (Kanban-Karte verschieben)" },
  { value: "executeDeleteKanbanCard", i18nKey: "admin:workflows_tab.tools.delete_kanban_card", defaultValue: "Delete Kanban Card (Kanban-Karte löschen)" },
  { value: "executeGetTemplates", i18nKey: "admin:workflows_tab.tools.get_templates", defaultValue: "Get Templates (Vorlagen suchen & abrufen)" },
  { value: "executeGetTemplateDetails", i18nKey: "admin:workflows_tab.tools.get_template_details", defaultValue: "Get Template Details (Vorlagendetails abrufen)" },
  { value: "executeApplyTemplate", i18nKey: "admin:workflows_tab.tools.apply_template", defaultValue: "Apply Template (Vorlage anwenden & Platzhalter ausfüllen)" },
  { value: "executeCreateNoteDraft", i18nKey: "admin:workflows_tab.tools.create_note_draft", defaultValue: "Create Note Draft (Notiz-Entwurf für Kontakt/Firma)" },
  { value: "executeVaultSearch", i18nKey: "admin:workflows_tab.tools.vault_search", defaultValue: "Vault Search (Obsidian-Wissensvault durchsuchen)" },
  { value: "executeVaultRead", i18nKey: "admin:workflows_tab.tools.vault_read", defaultValue: "Vault Read (Datei aus Wissensvault lesen)" },
  { value: "executeListVaultFiles", i18nKey: "admin:workflows_tab.tools.list_vault_files", defaultValue: "List Vault Files (Vault-Dateien auflisten)" },
  { value: "executeRecallSessions", i18nKey: "admin:workflows_tab.tools.recall_sessions", defaultValue: "Recall Sessions (Vergangene KI-Sessions durchsuchen)" },
  { value: "executeUpdateMemory", i18nKey: "admin:workflows_tab.tools.update_memory", defaultValue: "Update Memory (Präferenzen & Notizen merken)" },
  { value: "executeSaveSkill", i18nKey: "admin:workflows_tab.tools.save_skill", defaultValue: "Save Skill (Wissens-Skill vorschlagen — Freigabe via Chat)" },
  { value: "executeGetWorkflows", i18nKey: "admin:workflows_tab.tools.get_workflows", defaultValue: "Get Workflows (Gelernte Workflows abrufen)" },
  { value: "executeLearnWorkflow", i18nKey: "admin:workflows_tab.tools.learn_workflow", defaultValue: "Learn Workflow (Neues Workflow-Makro erlernen)" },
  { value: "executeAskUserQuestion", i18nKey: "admin:workflows_tab.tools.ask_user_question", defaultValue: "Ask User Question (Rückfrage — Workflow pausiert bis Antwort)" },
  { value: "executeDelegateSubtask", i18nKey: "admin:workflows_tab.tools.delegate_subtask", defaultValue: "Delegate Subtask (Teilaufgabe an Sub-Agent (max. 3 parallel))" },
  // G2–G8 (Auftrag 009): Update-Tools, Notizen-Vollverwaltung, Kanban-Board, Mail-Drafts, Vault-Writes
  { value: "executeUpdateDraftCompany", i18nKey: "admin:workflows_tab.tools.update_company_draft", defaultValue: "Update Company (Firma aktualisieren — Partial-Update)" },
  { value: "executeUpdateDraftContact", i18nKey: "admin:workflows_tab.tools.update_contact_draft", defaultValue: "Update Contact (Kontakt aktualisieren — inkl. Opt-ins)" },
  { value: "executeUpdateDraftInvoice", i18nKey: "admin:workflows_tab.tools.update_invoice_draft", defaultValue: "Update Invoice (Rechnung aktualisieren — Status/Betrag)" },
  { value: "executeUpdateDraftOffer", i18nKey: "admin:workflows_tab.tools.update_offer_draft", defaultValue: "Update Offer (Angebot aktualisieren)" },
  { value: "executeListNotes", i18nKey: "admin:workflows_tab.tools.list_notes", defaultValue: "List Notes (Notizen auflisten)" },
  { value: "executeUpdateNote", i18nKey: "admin:workflows_tab.tools.update_note", defaultValue: "Update Note (Notiz ändern)" },
  { value: "executeDeleteNote", i18nKey: "admin:workflows_tab.tools.delete_note", defaultValue: "Delete Note (Notiz löschen)" },
  { value: "executeCreateKanbanBoard", i18nKey: "admin:workflows_tab.tools.create_kanban_board", defaultValue: "Create Kanban Board (Kanban-Board anlegen)" },
  { value: "executeListMailDrafts", i18nKey: "admin:workflows_tab.tools.list_mail_drafts", defaultValue: "List Mail Drafts (E-Mail-Entwürfe abrufen)" },
  { value: "executeVaultWrite", i18nKey: "admin:workflows_tab.tools.vault_write", defaultValue: "Vault Write (Datei im Wissensvault anlegen)" },
  { value: "executeVaultUpdate", i18nKey: "admin:workflows_tab.tools.vault_update", defaultValue: "Vault Update (Vault-Datei aktualisieren)" },
  { value: "executeVaultDelete", i18nKey: "admin:workflows_tab.tools.vault_delete", defaultValue: "Vault Delete (Vault-Datei löschen)" }
];

export function getToolOption(value: string): DagToolOption | undefined {
  return DAG_TOOL_OPTIONS.find((o) => o.value === value);
}
