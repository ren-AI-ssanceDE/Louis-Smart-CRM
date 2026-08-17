import { GoogleGenAI, Type } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import { AgentPipelineContext, AgentExecutionResult, ToolDomain } from "./agentTypes.js";
import { validateProposalMathAndSchema, executeCritiqueLoop, ProposedState } from "./critic.js";
import { workflowEventBus } from "./workflowEventBus.js";
import { logAuditEvent, recordAgentRun, pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../db.js";
import { generateContentUniversal, getDeterministicTools } from "./geminiHelper.js";
import { buildNativeTools } from "./toolSchemas.js";
import { ToolResult, createToolSuccess, createToolError } from "./tools/types.js";
import {
  executeWebSearch,
  executeLocalKnowledgeSearch,
  executeListVaultFiles,
  executeRecallSessions,
  searchRelevantSkills,
  executeWorkflowMacro,
  appendSkillPitfall,
  executeListCompanies,
  executeListContacts,
  executeListInvoices,
  executeCrmDataAnalyst,
  executeLearnWorkflow,
  getLearnedWorkflows,
  executeTextGenerator,
  executeCreateDraftInvoice,
  executeCreateDraftCompany,
  executeCreateDraftContact,
  executeSendSmtpEmail,
  executeCreateDraftOffer,
  executeCreateNoteDraft,
  executeFinalizeAndSendOffer,
  executeListKanbanBoards,
  executeGetKanbanBoardDetails,
  executeCreateKanbanCard,
  executeUpdateKanbanCard,
  executeMoveKanbanCard,
  executeDeleteKanbanCard,
  executeGetTemplates,
  executeGetTemplateDetails,
  executeApplyTemplate,
  // G2–G6 (Auftrag 009): Update-Tools + Notizen-Vollverwaltung + Kanban-Board + Mail-Drafts
  executeUpdateDraftCompany,
  executeUpdateDraftContact,
  executeUpdateDraftInvoice,
  executeUpdateDraftOffer,
  executeListNotes,
  executeUpdateNote,
  executeDeleteNote,
  executeCreateKanbanBoard,
  executeListMailDrafts,
  executeVaultWrite,
  executeVaultUpdate,
  executeVaultDelete
} from "./tools.js";
import { safeParseReActDecision, truncateResult, classifyIntentFastPath } from "./orchestrator.js";
import { WorkflowLearnSuggestionSchema, SubTaskSpecSchema, VerifySubtaskArgsSchema, AskUserQuestionArgsSchema } from "../../lib/schemas.js";
import { ModelUsageMetadata, ConversationMessage, GovernanceAction, SubTaskResult, TenantAiConfig } from "../../types.js";
import { vaultToolKind, vaultWriteBaseName, VAULT_WRITE_ACTION_MAP } from "./vaultToolClassification.js";
import { ToolCall } from "../../types/inference.js";
import { McpClientEngine } from "../mcp/mcpClientEngine.js";
import { evaluateGovernanceRules } from "./governance.js";
import { vaultSearch, vaultReadText, readUserMemoryVault, writeUserMemoryVault, resolveSkillFiles } from "./vaultStore.js";
import type { VaultSkillFile } from "./vaultStore.js";
import { sanitizeFinalText } from "./toolCallSanitizer.js";

// S8: Write-Tool → Governance-Mapping (Pre-Tool-Hook vor jedem Write-Call)
const WRITE_ACTION_MAP: Record<string, { entity: string; action: GovernanceAction }> = {
  create_invoice_draft: { entity: "invoices", action: "CREATE" },
  create_company_draft: { entity: "companies", action: "CREATE" },
  create_contact_draft: { entity: "contacts", action: "CREATE" },
  create_offer_draft: { entity: "offers", action: "CREATE" },
  create_note_draft: { entity: "notes", action: "CREATE" },
  finalize_and_send_offer: { entity: "offers", action: "SEND" },
  send_smtp_email: { entity: "emails", action: "SEND" },
  create_kanban_card: { entity: "kanban_card", action: "CREATE" },
  update_kanban_card: { entity: "kanban_card", action: "UPDATE" },
  move_kanban_card: { entity: "kanban_card", action: "MOVE" },
  delete_kanban_card: { entity: "kanban_card", action: "DELETE" },
  // G2–G6 (Auftrag 009): Update-Tools + Notizen-Vollverwaltung + Kanban-Board
  update_company_draft: { entity: "companies", action: "UPDATE" },
  update_contact_draft: { entity: "contacts", action: "UPDATE" },
  update_note: { entity: "notes", action: "UPDATE" },
  delete_note: { entity: "notes", action: "DELETE" },
  update_invoice_draft: { entity: "invoices", action: "UPDATE" },
  update_offer_draft: { entity: "offers", action: "UPDATE" },
  create_kanban_board: { entity: "kanban_board", action: "CREATE" },
  vault_write: { entity: "vault_file", action: "CREATE" },
  vault_update: { entity: "vault_file", action: "UPDATE" },
  vault_delete: { entity: "vault_file", action: "DELETE" },
  update_memory: { entity: "vault_memory", action: "UPDATE" },
  delete_memory_note: { entity: "vault_memory", action: "DELETE" },
  save_skill: { entity: "vault_skill", action: "CREATE" },
  update_skill: { entity: "vault_skill", action: "UPDATE" },
  delete_skill: { entity: "vault_skill", action: "DELETE" }
};

// Befund-3-Fix (2026-08-17): Vault-Tool-Klassifikation (logisch + normalisiert) lebt im
// eigenen Modul vaultToolClassification.ts — suffix-basiert, robust gegen Server-Umbenennungen.
// Verwendung: parallele Lese-Erlaubnis (runReActLoop), Governance-Auflösung (executeSingleTool).

// S9: CORE-Tools mit Schreib-/Interaktions-Semantik — Sub-Agents dürfen diese NIE nutzen
// (update_memory schreibt dauerhaft; ask_user_question + verify_subtask kommen aus S11)
const SUBAGENT_CORE_EXCLUDED: ReadonlySet<string> = new Set(['update_memory', 'delete_memory_note', 'ask_user_question', 'verify_subtask']);

// S10: Deterministisches Skill-Matching (description 3 / name 2 / tags 1, case-insensitiv; Top-K)
// Auftrag 013 P2-E: Pinned-Skills (frontmatter pinned: true) werden IMMER einschlossen (Prio vor Scoring).
function topMatchSkills(skills: VaultSkillFile[], userMessage: string, topK: number): VaultSkillFile[] {
  const term = userMessage.toLowerCase();
  const pinned = skills.filter((s) => s.pinned);
  const scored = skills
    .filter((s) => !s.pinned)
    .map((s) => {
      let score = 0;
      if (s.description.toLowerCase().includes(term)) score += 3;
      if (s.name.toLowerCase().includes(term)) score += 2;
      if ((s.tags || []).some((t) => t && term.includes(t.toLowerCase()))) score += 1;
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  // Pinned zuerst (max. topK), dann beste Scorer bis topK
  const combined = [...pinned.slice(0, topK), ...scored.map((x) => x.s)].slice(0, topK);
  return combined;
}

// Auftrag 012 P0-2: Budgetiertes Notizen-Rendering für die Memory-Injektion.
// Neueste Notizen zuerst; sobald das Token-Budget erreicht ist, werden ältere weggelassen
// (mit Zähler, damit der Nutzer/Agent sieht, dass gekürzt wurde).
interface BudgetedNotesResult {
  text: string;
  dropped: number;
}
function renderBudgetedMemoryNotes(
  notes: Array<{ id_uuid: string; content: string; created_at_utc: string }>,
  budgetTokens: number
): BudgetedNotesResult {
  if (!notes || notes.length === 0) return { text: "", dropped: 0 };
  const sorted = notes.slice().sort((a, b) => String(b.created_at_utc).localeCompare(String(a.created_at_utc)));
  const lines: string[] = [];
  let usedTokens = 0;
  for (const n of sorted) {
    const line = `- ${n.content}`;
    const estTokens = Math.ceil(line.length / 3.8);
    if (usedTokens + estTokens > budgetTokens && lines.length > 0) break;
    lines.push(line);
    usedTokens += estTokens;
  }
  return { text: lines.join("\n"), dropped: notes.length - lines.length };
}

// Auftrag 012 P1-2: Validierung eines Subtask-Ergebnisses gegen ein optionales Output-Schema.
// Pragmatischer Vertrag-Check: final_text muss valides JSON sein und alle im Schema geforderten
// Top-Level-Keys enthalten. Liefert { ok, error? }.
function validateSubtaskOutput(finalText: string, schema: Record<string, unknown> | undefined): { ok: boolean; error?: string } {
  if (!schema || Object.keys(schema).length === 0) return { ok: true };
  const trimmed = (finalText || "").trim();
  if (!trimmed) return { ok: false, error: "Leere Antwort — kein JSON geliefert." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Toleranz: JSON in ```json-Blöcken extrahieren
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fence ? fence[1].trim() : trimmed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return { ok: false, error: "Antwort ist kein valides JSON." };
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Antwort-JSON muss ein Objekt sein." };
  }
  const required = (schema as Record<string, unknown>).required;
  if (Array.isArray(required)) {
    for (const key of required as string[]) {
      if (!(key in (parsed as Record<string, unknown>))) {
        return { ok: false, error: `Pflichtfeld '${key}' fehlt im Antwort-JSON.` };
      }
    }
  }
  return { ok: true };
}

export function buildOptimizedConversationHistory(
  history: ConversationMessage[],
  maxTokens: number = 2000
): ConversationMessage[] {
  if (!history || history.length === 0) return [];
  
  const result: ConversationMessage[] = [];
  let accumulatedLength = 0;
  
  // Rückwärts iterieren, um die aktuellsten Nachrichten zu priorisieren
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const estimatedTokens = Math.ceil((msg.content || "").length / 3.8);
    
    if (accumulatedLength + estimatedTokens > maxTokens && result.length >= 2) {
      break;
    }
    
    result.unshift(msg);
    accumulatedLength += estimatedTokens;
  }
  
  return result;
}

// ============================================================================
// Auftrag 006 A2+B1 (Regel 12): Delta-Statt-Kumulativ + Context-Compaction.
// Baut die <PREVIOUS_TOOL_RESULTS>-Sektion des ReAct-Dynamic-Payloads:
//  - Ergebnisse, die das Modell bereits in einer früheren Iteration gesehen hat
//    (Index < lastInjectedCount) → kompakte 1-Zeilen-Zusammenfassung
//  - Neue Ergebnisse (Index >= lastInjectedCount) → voll eingebettet (getruncated)
//  - B1 (compactionActive, keepLast): die jüngsten keepLast Ergebnisse werden
//    voll eingebettet, ALLE älteren als 1-Zeiler — unabhängig vom Delta-Stand.
// Macht den Prompt-Wachstum von O(n²) zu O(n). Reine Funktion, kein any.
// ============================================================================
export function buildToolResultsSection(
  toolResults: Array<{ toolName: string; query: string; result: unknown }>,
  lastInjectedCount: number,
  truncateLen: number,
  defaultLang: "de" | "en" = "de",
  keepLast = 2,
  compactionActive = false
): string {
  if (!toolResults || toolResults.length === 0) {
    return defaultLang === "de"
      ? "Keine bisherigen Tool-Ausführungen."
      : "No tool executions so far.";
  }

  const summarize = (t: { toolName: string; result: unknown }, actionNo: number): string => {
    const size = typeof t.result === "string" ? t.result.length : (t.result === null || t.result === undefined ? 0 : JSON.stringify(t.result).length);
    const status = typeof t.result === "string" && /fehler|error|failed|blockiert/i.test(t.result) ? "FEHLER" : "ok";
    return `[Action #${actionNo}] ${t.toolName} — ${status} (${size} Zeichen, bereits geliefert)`;
  };

  const embedFull = (t: { toolName: string; query: string; result: unknown }, actionNo: number): string =>
    `[Action #${actionNo}] Tool: ${t.toolName} | Query: ${t.query} | Yield result: ${truncateResult(t.result, truncateLen)}`;

  // B1: Ab der Compaction-Schwelle werden nur die jüngsten keepLast voll gezeigt, der Rest 1-Zeiler
  if (compactionActive) {
    const keep = Math.max(1, Math.min(keepLast, toolResults.length));
    const startFull = toolResults.length - keep;
    return toolResults
      .map((t, idx) => (idx >= startFull ? embedFull(t, idx + 1) : summarize(t, idx + 1)))
      .join("\n");
  }

  const lastInjected = Math.max(0, Math.min(lastInjectedCount, toolResults.length));
  const oldOnes = toolResults.slice(0, lastInjected);
  const newOnes = toolResults.slice(lastInjected);

  const oldSummary = oldOnes.map((t, i) => summarize(t, i + 1));
  const newFull = newOnes.map((t, idx) => embedFull(t, lastInjected + idx + 1));

  return [...oldSummary, ...newFull].join("\n");
}

// ============================================================================
// ============================================================================
// B4-Nachfolge (2026-08-16, provider-agnostisch): Ankündigungs-Erkennung
// Erkennt Antworten, die nur ankündigen ("Ich durchsuche gleich…") statt ein
// Tool auszuführen. NUR klare Futur-/Ankündigungs-Phrasen — fertige Antworten
// (auch reine Chat-/Analyse-Antworten) werden nie als Ankündigung klassifiziert.
// Reine Funktion, kein any — testbar.
// ============================================================================
const ANNOUNCEMENT_PATTERNS = [
  /\b(werde ich|werde gleich|gleich|einen moment|moment bitte|kurz|gleich loslegen)\b/i,
  /\b(ich durchsuche|ich suche nach|ich schaue (mir|nach)|ich hole|ich prüfe|ich pruefe|ich rufe ab|ich lade|ich lade nach|ich schaue gleich)\b/i,
  /\b(ich beginne|ich starte|ich führe aus|ich fuehre aus|ich setze um)\b/i,
  // Zukunfts-Ankündigungen: "werde ... suchen/laden/prüfen/abrufen/analysieren"
  /\bwerde\b[^.!?]{0,60}\b(suchen|laden|prüfen|pruefen|abrufen|analysieren|durchsuchen|schauen|nachsehen|ermitteln|herausfinden)\b/i
];

export function isAnnouncementText(text: string): boolean {
  return ANNOUNCEMENT_PATTERNS.some((re) => re.test(text || ""));
}

// Auftrag 006 B3 (Regel 12): Intent-gesteuerte Prompt-Direktiven.
// Bestimmt, ob der E-Mail-/Zahlungserinnerungs-Direktiven-Block (≈600 Zeichen)
// in den System-Prefix injiziert wird:
//   - mode 'always' → immer (bisheriges Verhalten, Default)
//   - mode 'intent' → nur wenn die Nutzeranfrage E-Mail-/Mahnungs-Bezug hat
// Reine Funktion, kein any — testbar.
// ============================================================================
export function shouldInjectEmailDirectives(
  mode: "always" | "intent" | undefined | null,
  userMessage: string
): boolean {
  if (mode !== "intent") return true; // 'always' und Default → bisheriges Verhalten
  const text = (userMessage || "").toLowerCase();
  // Schlüsselwörter für E-Mail-/Mahnungs-/Vorlagen-Bezug (de+en)
  const emailKeywords = [
    "email", "e-mail", "mail", "mahnung", "zahlungserinnerung", "erinnerung",
    "betreff", "rechnungsvorlage", "vorlage", "anhang", "empfänger",
    "freigabe", "entwurf", "senden", "verschicken", "schreiben",
    "template", "reminder", "invoice", "draft", "attach", "recipient",
    "inbox", "outlook", "gmx", "gmail", "web.de", "postausgang"
  ];
  return emailKeywords.some((kw) => text.includes(kw));
}

export type { ToolDomain } from "./agentTypes.js";
export interface DefinedToolDescriptor {
  name: string;
  desc: string;
  domain: ToolDomain;
}

export const SYSTEM_TOOL_CATALOG: DefinedToolDescriptor[] = [
  // CORE (immer verfügbar)
  { name: "crm_data_analyst", desc: "'crm_data_analyst': Analysiert und aggregiert CRM-Entitäten.", domain: 'CORE' },
  // Auftrag 016 P1-2: Alias sichtbar machen (Dispatch + Whitelist existierten bereits, Katalog-Eintrag fehlte)
  { name: "data_architect", desc: "'data_architect': Alias für 'crm_data_analyst' — Analysiert und aggregiert CRM-Entitäten (Synonym).", domain: 'CORE' },
  { name: "text_generator", desc: "'text_generator': Hochgradig konfigurierbare Text- & Branding-Engine.", domain: 'CORE' },
  
  // CRM READ
  { name: "list_companies", desc: "'list_companies': Listet Unternehmen mit Paginierung & Fuzzy-Suche. Query JSON: { search, limit, offset }", domain: 'CRM_READ' },
  { name: "list_contacts", desc: "'list_contacts': Listet Kontakte mit Paginierung & Fuzzy-Suche. Query JSON: { search, limit, offset }", domain: 'CRM_READ' },
  { name: "list_invoices", desc: "'list_invoices': Listet Rechnungen mit Paginierung & Fuzzy-Suche. Query JSON: { search, limit, offset, payment_status }", domain: 'CRM_READ' },
  
  // CRM WRITE
  { name: "create_invoice_draft", desc: "'create_invoice_draft': Erstellt einen Rechnungsentwurf. Query JSON: { company_id?, contact_id?, invoice_number?, items_list: [{ description, quantity, unit_price, vat_rate? }], payment_term?, due_date?, currency_code?, introductory_text?, closing_text? } — items_list ist Pflicht.", domain: 'CRM_WRITE' },
  { name: "create_company_draft", desc: "'create_company_draft': Erstellt einen Unternehmensentwurf. Query JSON: { full_legal_name, short_code?, street, house_number, postal_code, city, country_code, email_address, phone_number, tax_vat_id, tax_number, responsible_person, payment_term, iban, bic_swift, leitweg_id, website, language } — full_legal_name ist Pflicht.", domain: 'CRM_WRITE' },
  { name: "create_contact_draft", desc: "'create_contact_draft': Erstellt einen Kontaktentwurf. Query JSON: { first_name, last_name, email_address, phone_number, company_id, street, house_number, postal_code, city, country_code, language, salutation, gender_identity, date_of_birth, website, email_2, mobile_number, fax_number, tax_vat_id, iban, bic_swift, payment_term, opt_in_marketing?, opt_in_social_media?, opt_in_direct_message?, opt_in_sms?, opt_in_phone? } — Opt-in-Felder sind boolean (optional, Default false).", domain: 'CRM_WRITE' },
  { name: "create_offer_draft", desc: "'create_offer_draft': Erstellt einen Angebotsentwurf. Query JSON: { title, company_id?, contact_id?, offer_number?, line_items: [{ description, quantity, unit_price, vat_rate? }], payment_term?, valid_until?, currency_code?, introductory_text?, closing_text? } — title + line_items sind Pflicht.", domain: 'CRM_WRITE' },
  { name: "create_note_draft", desc: "'create_note_draft': Erstellt einen Notiz-Entwurf für einen Kontakt (contact_id_uuid) oder eine Firma (company_id_uuid). Query JSON: { contact_id_uuid?, company_id_uuid?, note_text, priority? } — genau EIN Ziel angeben, note_text ist Pflicht.", domain: 'CRM_WRITE' },
  // G2/G4 (Auftrag 009): Update-Tools + Notizen-Vollverwaltung
  { name: "update_company_draft", desc: "'update_company_draft': Aktualisiert ein bestehendes Unternehmen (Partial-Update, nur bereitgestellte Felder). Query JSON: { id_uuid, full_legal_name?, street?, city?, email_address?, phone_number?, iban?, ... }", domain: 'CRM_WRITE' },
  { name: "update_contact_draft", desc: "'update_contact_draft': Aktualisiert einen bestehenden Kontakt (Partial-Update, inkl. Opt-in-Felder). Query JSON: { id_uuid, first_name?, last_name?, email_address?, phone_number?, opt_in_marketing?, ... }", domain: 'CRM_WRITE' },
  { name: "list_notes", desc: "'list_notes': Listet Notizen. Query JSON: { entity_type?: 'contact'|'company', entity_id_uuid?, search?, limit? }", domain: 'CRM_READ' },
  { name: "update_note", desc: "'update_note': Ändert eine Notiz (note_text/priority). Query JSON: { id_uuid, note_text?, priority? }", domain: 'CRM_WRITE' },
  { name: "delete_note", desc: "'delete_note': Löscht eine Notiz. Query JSON: { id_uuid }", domain: 'CRM_WRITE' },
  // G5/G6 (Auftrag 009): Update-Tools für Rechnung + Angebot
  { name: "update_invoice_draft", desc: "'update_invoice_draft': Aktualisiert eine bestehende Rechnung (Partial-Update, z. B. payment_status, due_date, Beträge). Query JSON: { id_uuid, payment_status?, due_date?, ... }", domain: 'CRM_WRITE' },
  { name: "update_offer_draft", desc: "'update_offer_draft': Aktualisiert ein bestehendes Angebot (Partial-Update). Query JSON: { id_uuid, title?, valid_until?, payment_term?, ... }", domain: 'CRM_WRITE' },
  { name: "finalize_and_send_offer", desc: "'finalize_and_send_offer': Finalisiert ein Angebot und generiert das PDF.", domain: 'CRM_WRITE' },
  { name: "send_smtp_email", desc: "'send_smtp_email': Erstellt einen E-Mail-Entwurf zur Freigabe.", domain: 'CRM_WRITE' },
  // G7 (Auftrag 009): E-Mail-Entwürfe abrufen
  { name: "list_mail_drafts", desc: "'list_mail_drafts': Listet E-Mail-Entwürfe. Query JSON: { status?: 'PENDING'|'APPROVED'|'REJECTED', recipient?, limit? }", domain: 'CRM_READ' },
  
  // KNOWLEDGE / VAULT
  { name: "web_search", desc: "'web_search': Externe Webrecherche für Mehrwertsteuersätze, Firmenregister etc.", domain: 'KNOWLEDGE' },
  { name: "local_knowledge", desc: "'local_knowledge': Liest oder durchsucht Wissensdateien (Markdown .md, TXT, PDF, Word etc.) im Vault.", domain: 'KNOWLEDGE' },
  { name: "list_vault_files", desc: "'list_vault_files': Listet hochgeladene Vault-Dateien auf.", domain: 'KNOWLEDGE' },
  // G8 (Auftrag 009): Vault-Vollverwaltung (write/update/delete)
  { name: "vault_write", desc: "'vault_write': Legt eine neue Datei im Wissensvault an. Query JSON: { file_name, content, overwrite? } — nur .md/.txt/.json/.csv.", domain: 'KNOWLEDGE' },
  { name: "vault_update", desc: "'vault_update': Aktualisiert den Inhalt einer Vault-Datei (upsert). Query JSON: { file_name, content }", domain: 'KNOWLEDGE' },
  { name: "vault_delete", desc: "'vault_delete': Löscht eine Datei aus dem Wissensvault. Query JSON: { file_name }", domain: 'KNOWLEDGE' },
  { name: "recall_sessions", desc: "'recall_sessions': Durchsucht vergangene KI-Sessions per Volltextsuche. Query JSON: { query, limit, offset }", domain: 'KNOWLEDGE' },
  { name: "vault_search", desc: "'vault_search': Durchsucht den Obsidian-Wissensvault. Query JSON: { query, limit }", domain: 'KNOWLEDGE' },
  { name: "vault_read", desc: "'vault_read': Liest eine Datei aus dem Obsidian-Wissensvault. Query JSON: { path }", domain: 'KNOWLEDGE' },
  { name: "update_memory", desc: "'update_memory': Merkt sich dauerhafte Präferenzen und Notizen über den Nutzer. Query JSON: { preference?, note? } — mindestens ein Feld gesetzt", domain: 'CORE' },
  { name: "delete_memory_note", desc: "'delete_memory_note': Löscht eine einzelne Notiz aus dem Gedächtnis. Query JSON: { note_id } — die ID erhält man aus update_memory/liste oder dem Memory-Formular", domain: 'CORE' },
  { name: "save_skill", desc: "'save_skill': Legt einen Wissens-Skill im Vault an (Freigabe erforderlich). Query JSON: { name, description, content, category?, tags? }", domain: 'WORKFLOWS' },
  { name: "update_skill", desc: "'update_skill': Aktualisiert einen bestehenden Wissens-Skill (Freigabe erforderlich). Query JSON: { name, content?, description?, tags?, category? } — nur bereitgestellte Felder ändern sich", domain: 'WORKFLOWS' },
  { name: "delete_skill", desc: "'delete_skill': Löscht einen Wissens-Skill aus dem Vault (Freigabe erforderlich). Query JSON: { name }", domain: 'WORKFLOWS' },
  
  // KANBAN
  { name: "list_kanban_boards", desc: "'list_kanban_boards': Listet Kanban-Boards auf.", domain: 'KANBAN' },
  { name: "get_kanban_board_details", desc: "'get_kanban_board_details': Holt Details eines Kanban-Boards.", domain: 'KANBAN' },
  // G3 (Auftrag 009): Kanban-Board anlegen
  { name: "create_kanban_board", desc: "'create_kanban_board': Legt ein neues Kanban-Board an. Query JSON: { title, description?, columns?: string[], sample_cards?: string[] } — Default-Spalten: Offen/In Bearbeitung/Erledigt.", domain: 'KANBAN' },
  { name: "create_kanban_card", desc: "'create_kanban_card': Erstellt eine Karte auf dem Kanban-Board.", domain: 'KANBAN' },
  { name: "update_kanban_card", desc: "'update_kanban_card': Aktualisiert eine Kanban-Karte.", domain: 'KANBAN' },
  { name: "move_kanban_card", desc: "'move_kanban_card': Verschiebt eine Kanban-Karte.", domain: 'KANBAN' },
  { name: "delete_kanban_card", desc: "'delete_kanban_card': Löscht eine Kanban-Karte.", domain: 'KANBAN' },
  
  // TEMPLATES
  { name: "get_templates", desc: "'get_templates': Ruft System-Vorlagen ab (E-Mail, Signaturen, Text, Artikel). Query JSON: { search, category } oder Suchstring (z.B. 'Standard-Rechnungsvorlage').", domain: 'TEMPLATES' },
  { name: "get_template_details", desc: "'get_template_details': Ruft Vorlagendetails ab. Query JSON: { template_name } oder Name als String.", domain: 'TEMPLATES' },
  { name: "apply_template", desc: "'apply_template': Wendet eine Vorlage an und befüllt Platzhalter mit Daten. Query JSON: { template_name, context: { invoice_number, total_gross, due_date, my_company_name, my_contact_person } }.", domain: 'TEMPLATES' },
  
  // WORKFLOWS
  { name: "learn_workflow", desc: "'learn_workflow': Erlernt ein neues Workflow-Makro.", domain: 'WORKFLOWS' },
  { name: "get_workflows", desc: "'get_workflows': Ruft gelernte Workflows ab.", domain: 'WORKFLOWS' },
  { name: "delegate_subtask", desc: "'delegate_subtask': Delegiert Teilaufgaben an isolierte Sub-Agents (max. 3 parallel, read-only). Query JSON: { tasks: [{ subtask_id, task_prompt, required_tools, max_turns }] }", domain: 'WORKFLOWS' },
  { name: "verify_subtask", desc: "'verify_subtask': Markiert einen Subtask als verifiziert (Selbst-Reporte). Query JSON: { subtask_id, evidence }", domain: 'CORE' },
  { name: "ask_user_question", desc: "'ask_user_question': Stellt eine persistierte Rückfrage an den Nutzer (ASK-Governance). Query JSON: { question, choices?, context? }", domain: 'CORE' }
];

export function getDynamicToolSet(
  intent: 'DATA_CREATION' | 'DATA_CHANGE' | 'ANALYSIS' | 'CUSTOM_TOOL' | 'GENERAL' | null,
  userMessage: string,
  executedToolNames: Set<string>,
  allowedDomains?: ToolDomain[]
): DefinedToolDescriptor[] {
  const activeDomains = new Set<ToolDomain>(['CORE']);

  // S9: Sub-Agent-Modus — explizite Domänen statt Intent-Logik (read-only Garantie)
  if (allowedDomains && allowedDomains.length > 0) {
    for (const d of allowedDomains) activeDomains.add(d);
    return SYSTEM_TOOL_CATALOG.filter(
      tool => activeDomains.has(tool.domain) && !executedToolNames.has(tool.name)
    );
  }

  const msg = userMessage.toLowerCase();

  // Intent- & Schlüsselwort-basierte Freischaltung von Domänen
  if (intent === 'DATA_CREATION') {
    activeDomains.add('CRM_WRITE');
    activeDomains.add('CRM_READ');
  } else if (intent === 'DATA_CHANGE') {
    activeDomains.add('CRM_WRITE');
    activeDomains.add('CRM_READ');
    if (/kanban|board|spalte|karte/i.test(msg)) activeDomains.add('KANBAN');
  } else if (intent === 'ANALYSIS') {
    activeDomains.add('CRM_READ');
    activeDomains.add('KNOWLEDGE');
  } else if (intent === 'CUSTOM_TOOL') {
    activeDomains.add('WORKFLOWS');
  }

  // Schlüsselwort-Fallback-Matching
  if (/kanban|board|spalte|karte/i.test(msg)) activeDomains.add('KANBAN');
  if (/pdf|vault|dokument|wissen|datei|suche|google|web/i.test(msg)) activeDomains.add('KNOWLEDGE');
  if (/vorlage|template|mail|email|brief/i.test(msg)) activeDomains.add('TEMPLATES');
  if (/termin|kalender|calendar|event|meeting|einladen|buchen|mcp/i.test(msg)) {
    activeDomains.add('CRM_READ');
    activeDomains.add('CRM_WRITE');
    activeDomains.add('KNOWLEDGE');
  }
  if (/firma|unternehmen|kontakt|rechnung|angebot|mail|email|e-mail|nachricht|mahnung|erinnerung|entwurf|kunde|kunden/i.test(msg)) {
    activeDomains.add('CRM_READ');
    if (/erstelle|anlegen|neu|bearbeite|schreibe|sende|versende|schicke|mahn|erinnere|send|draft/i.test(msg)) {
      activeDomains.add('CRM_WRITE');
    }
  }

  // E-Mail / Sending specific keyword matching
  if (/mail|email|e-mail|sende|versende|schicke|mahnung|erinnerung|zahlungsaufforderung/i.test(msg)) {
    activeDomains.add('CRM_READ');
    activeDomains.add('CRM_WRITE');
  }

  // Standard-Fallback bei Unklarheit ('GENERAL')
  if (activeDomains.size <= 2) {
    activeDomains.add('CRM_READ');
    activeDomains.add('CRM_WRITE');
    activeDomains.add('KNOWLEDGE');
  }

  // Filtern aller bereits ausgeführten Tools und unpassenden Domänen
  return SYSTEM_TOOL_CATALOG.filter(
    tool => activeDomains.has(tool.domain) && !executedToolNames.has(tool.name)
  );
}

export class AgentRuntime {
  /**
   * Führt die konsolidierte Agenten-Pipeline in 5 Phasen aus.
   */
  public async executePipeline(context: AgentPipelineContext): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      // Phase 1: Context Setup & Prompt Splicing
      context.thoughtLog.push(`[Runtime Phase 1] Pipeline gestartet. Mandant: ${context.tenantId}, Sprache: ${context.language}`);

      // Phase 2: ReAct Decider Loop (Iterative Werkzeugausführung)
      await this.runReActLoop(context);

      // Phase 3: Schema & Math Verification Gate
      if (context.proposedChanges) {
        context.thoughtLog.push(`[Runtime Phase 3] Führe mathematische & Schema-Validierung aus...`);

        let val = { isValid: true, errors: [] as string[] };
        const entityType = context.proposedChanges.entity_type;

        if (
          entityType !== 'emails' && 
          entityType !== 'offers' &&
          entityType !== 'kanban_board' &&
          entityType !== 'kanban_column' &&
          entityType !== 'kanban_card'
        ) {
          val = validateProposalMathAndSchema(
            entityType,
            context.proposedChanges.action,
            context.proposedChanges.proposed_state
          );
        }

        if (!val.isValid) {
          context.thoughtLog.push(`[Runtime Phase 3] Fehler bei der Validierung: ${val.errors.join("; ")}`);
          this.applyValidationFailure(context, val.errors);
        } else {
          context.thoughtLog.push(`[Runtime Phase 3] Mathe- & Schema-Prüfung bestanden.`);
        }
      }

      // Phase 4: Compliance & Critique LLM Gate (Bypassed for Fast-Path Read Queries)
      // B3 (Auftrag 011): Draft-Flow-Vorschläge (proposedChanges ohne emails)
      // überspringen die LLM-Kritik — die menschliche Freigabe im Chat IST die
      // Kontrolle; die Kritikschleife kostet sonst 1-2 Min Latenz pro Antwort.
      // B5 (Stefan 2026-08-16): Kritikschleife läuft NUR noch, wenn eine
      // CRM-Änderung vorgeschlagen wurde (proposedChanges gesetzt) — reine
      // isComplex-Aufgaben (z. B. Vault-/Memory-Schreibvorgänge ohne Draft)
      // überspringen den Critic (spart ~15s + ~2k Output-Token pro Antwort).
      // Admin-Steuerung des Critic-Verhaltens: notiert in Auftrag 018 Phase D.
      const isDraftFlowProposal = !!context.proposedChanges &&
        context.proposedChanges.entity_type !== 'emails';
      const requiresCritic = !!context.proposedChanges && !isDraftFlowProposal;

      if (requiresCritic) {
        context.thoughtLog.push(`[Runtime Phase 4] Führe LLM-Kritikschleife aus...`);
        const critiqueResult = await executeCritiqueLoop(
          (context.aiConfig.provider_type as "ollama" | "anthropic" | "openai" | "gemini") || "gemini",
          (context.aiConfig.model_name as string) || "gemini-2.5-flash",
          (context.aiConfig.api_key_secret as string) || null,
          (context.aiConfig.base_url as string) || null,
          context.userMessage,
          context.finalDraftText || "",
          context.proposedChanges,
          context.language
        );

        if (critiqueResult.promptTokenCount) context.inputTokens += critiqueResult.promptTokenCount;
        if (critiqueResult.candidatesTokenCount) context.outputTokens += critiqueResult.candidatesTokenCount;

        const isApproved = critiqueResult.approved || (critiqueResult.approvalScore !== undefined && critiqueResult.approvalScore >= 70);

        if (!isApproved) {
          context.thoughtLog.push(`[Runtime Phase 4] Kritik-Gate Feedback: ${critiqueResult.log}`);
          if (context.proposedChanges && context.proposedChanges.entity_type === 'emails') {
            const ps = context.proposedChanges.proposed_state as Record<string, unknown>;
            let body = String(ps.email_body_content || ps.body || "");
            body = body.replace(/\[Datum\s*einfügen\]/gi, "binnen 7 Tagen")
                       .replace(/\[Datum\]/gi, "binnen 7 Tagen")
                       .replace(/\[Zahlungsziel\]/gi, "binnen 7 Tagen");
            ps.email_body_content = body;
            ps.body = body;
          }
          this.applyCritiqueFailure(context, critiqueResult.log);
        } else {
          context.finalDraftText = sanitizeFinalText(critiqueResult.correctedDraft, context.language);
          if (context.proposedChanges && context.proposedChanges.entity_type === 'emails') {
            const ps = context.proposedChanges.proposed_state as Record<string, unknown>;
            let body = String(ps.email_body_content || ps.body || "");
            body = body.replace(/\[Datum\s*einfügen\]/gi, "binnen 7 Tagen")
                       .replace(/\[Datum\]/gi, "binnen 7 Tagen")
                       .replace(/\[Zahlungsziel\]/gi, "binnen 7 Tagen");
            ps.email_body_content = body;
            ps.body = body;
          }
          context.thoughtLog.push(`[Runtime Phase 4] Kritik-Gate freigegeben: ${critiqueResult.log}`);
        }
      } else {
        // B5 (2026-08-16): wird jetzt auch bei komplexen Nicht-CRM-Aufgaben erreicht
        // (requiresCritic nur noch bei proposedChanges) — Text daher generisch.
        context.thoughtLog.push(`[Runtime Phase 4] LLM-Kritikschleife übersprungen (keine CRM-Änderung vorgeschlagen / Fast-Path).`);
      }

      // Append clickable sources if web search was executed
      this.appendWebSearchSources(context);

      // Phase 5: Event Bus Emission & Audit Logging
      const executionTimeMs = Date.now() - startTime;
      const initialIntent = classifyIntentFastPath(context.userMessage);
      const executedToolNames = new Set(context.toolResults.map(r => r.toolName));
      const activeTools = getDynamicToolSet(initialIntent, context.userMessage, executedToolNames);

      await logAuditEvent({
        tenantId: context.tenantId,
        eventType: "AGENT_PIPELINE_OPTIMIZED_EXECUTE",
        entityType: "agentRuntime",
        actorIdentity: context.userId,
        eventDetails: `Execution complete in ${executionTimeMs}ms. Tokens: In=${context.inputTokens}, Out=${context.outputTokens}. Active Tools: ${activeTools.length}/${SYSTEM_TOOL_CATALOG.length}`
      });

      // Auftrag 006 Task 7 (B2): Token-Metriken persistieren (Admin-Ansicht „Token-Verbrauch")
      try {
        await recordAgentRun({
          tenantId: context.tenantId,
          userId: context.userId,
          prompt: (context.userMessage || "").slice(0, 500),
          inputTokens: context.inputTokens,
          outputTokens: context.outputTokens,
          cachedTokens: context.cachedTokens,
          totalTokens: context.inputTokens + context.outputTokens,
          durationMs: executionTimeMs,
          activeTools: activeTools.length
        });
      } catch (err) {
        console.warn("[B2] recordAgentRun fehlgeschlagen (ignoriert):", err);
      }

      // S6: Skill-Improvement-Loop (Fehler → Pitfall, Erfolg → Vorschlag) — darf die Pipeline nie brechen/verzögern
      try {
        await this.maybeLearnFromExecution(context);
      } catch (err) {
        console.warn("[S6] maybeLearnFromExecution fehlgeschlagen (ignoriert):", err);
      }

      workflowEventBus.emitEvent(context.tenantId, "agent.pipeline_completed", {
        executionTimeMs,
        inputTokens: context.inputTokens,
        outputTokens: context.outputTokens,
        hasProposals: !!context.proposedChanges
      });

      // S6: Skill-Vorschlag als Event (NIE automatisch speichern)
      if (context.skillSuggestion) {
        workflowEventBus.emitEvent(context.tenantId, "agent.skill_suggestion", context.skillSuggestion);
      }

      if (!context.finalDraftText || context.finalDraftText.trim() === "") {
        try {
          const config = context.aiConfig;
          const provider = (config.provider_type || 'ollama') as "ollama" | "anthropic" | "openai" | "gemini";
          let cleanApiKey = (typeof config.api_key_secret === 'string' ? config.api_key_secret.trim() : '');
          if (cleanApiKey.includes('@') || cleanApiKey === '******') cleanApiKey = '';
          const modelToUse = config.model_name || "gemini-2.5-flash";
          const targetLang = context.language === 'de' ? 'German / Deutsch' : (context.language === 'en' ? 'English' : context.language);

          const toolSummary = context.toolResults.length > 0
            ? context.toolResults.map((t, i) => `[Action #${i+1}] Tool: ${t.toolName}\nResult: ${truncateResult(t.result, 1500)}`).join("\n\n")
            : (context.language === 'de' ? "Keine Werkzeuge ausgeführt." : "No tools executed.");

          const synthesisRes = await generateContentUniversal({
            provider_type: provider,
            model_name: modelToUse,
            api_key_secret: cleanApiKey,
            base_url: config.base_url as string | undefined,
            temperature: config.temperature ?? 0.2,
            contents: `You are Louis, the AI Assistant in Louis Smart CRM. Respond to the user's message "${context.userMessage}" in ${targetLang} based on the executed actions:\n${toolSummary}`
          });
          if (synthesisRes.text && synthesisRes.text.trim()) {
            context.finalDraftText = sanitizeFinalText(synthesisRes.text.trim(), context.language);
          }
        } catch {
          // Fallback handled dynamically
        }
      }

      return {
        finalDraftText: context.finalDraftText || "",
        proposedChanges: context.proposedChanges,
        thoughtLog: context.thoughtLog,
        inputTokens: context.inputTokens,
        outputTokens: context.outputTokens,
        cachedTokens: context.cachedTokens,
        executionTimeMs
      };
    } catch (fatalError: unknown) {
      const errMessage = fatalError instanceof Error ? fatalError.message : String(fatalError);
      context.thoughtLog.push(`[Runtime Critical Error] Exception abgefangen: ${errMessage}`);
      
      return {
        finalDraftText: context.language === 'de'
          ? `⚠️ **Fehler bei der Ausführung der KI-Anfrage:** ${errMessage}`
          : `⚠️ **Error executing AI request:** ${errMessage}`,
        proposedChanges: null,
        thoughtLog: context.thoughtLog,
        inputTokens: context.inputTokens,
        outputTokens: context.outputTokens,
        cachedTokens: context.cachedTokens || 0,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  private async runReActLoop(context: AgentPipelineContext): Promise<void> {
    const config = context.aiConfig;
    const provider = (config.provider_type || 'ollama') as "ollama" | "anthropic" | "openai" | "gemini";
    let cleanApiKey = (typeof config.api_key_secret === 'string' ? config.api_key_secret.trim() : '');
    if (cleanApiKey.includes('@') || cleanApiKey === '******') {
      cleanApiKey = '';
    }

    const ai = new GoogleGenAI({
      apiKey: cleanApiKey || "dummy",
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const modelToUse = config.model_name || (provider === 'gemini' ? "gemini-3.5-flash" : "llama3");
    let loopCount = 0;
    const maxLoops = context.maxIterations || 5;

    const preferredLanguageName = context.language === 'de' ? 'German / Deutsch' : 'English';

    // === S3: Zone 1 (statischer System-Prefix) — EINMAL pro Request vor der Schleife ===
    // Timestamp kommt aus context.temporalAnchor (im Orchestrator 1x pro Request gesetzt) — KEIN new Date() in der Schleife.
    const temporalAnchor = context.temporalAnchor || new Date().toISOString();
    const weekdaysGerman = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const weekdayName = weekdaysGerman[new Date(temporalAnchor).getDay()];
    const dateIsoStr = temporalAnchor;
    const formattedTimestamp = `${dateIsoStr.slice(0, 10)} ${dateIsoStr.slice(11, 19)} UTC (${weekdayName})`;

    // Workflow- und MCP-Tools GENAU EINMAL laden (nicht pro Iteration — Voraussetzung für Cache-Hits)
    // S5: statt ALLER Workflows nur die Top-K relevanten Skills (Embedding/Keyword) — gleicher Block-Aufbau
    let learnedWorkflows: Array<{ id_uuid: string; workflow_name: string; workflow_description?: string; description?: string }> = [];
    try {
      const skills = await searchRelevantSkills(context.tenantId, context.userMessage, 5);
      learnedWorkflows = skills as unknown as typeof learnedWorkflows;
    } catch (err) {
      console.warn("Failed to get relevant skills:", err);
    }

    let mcpDiscoveredTools: Array<{ normalized_tool_name: string; description?: string; original_tool_name: string; input_schema?: unknown }> = [];
    try {
      mcpDiscoveredTools = await McpClientEngine.listToolsForLouis(context.tenantId);
    } catch (err) {
      console.warn("Failed to get MCP tools for Louis:", err);
    }

    // Vollständiger, deterministisch sortierter Katalog — KEIN executed-/Intent-Filter (stabiler Cache-Prefix).
    // Zugelassene Verhaltensdifferenz: alle Tools bleiben gelistet; Schutz vor Redundanz = Duplicate-Block + Early-Exit-Direktive.
    // S9: Sub-Agent-Kontexte (allowedDomains gesetzt) erhalten NUR ihre Domänen-Tools minus SUBAGENT_CORE_EXCLUDED.
    const rawCatalogTools = context.allowedDomains && context.allowedDomains.length > 0
      ? getDynamicToolSet("ANALYSIS", context.userMessage, new Set(), context.allowedDomains)
      : SYSTEM_TOOL_CATALOG;
    const allCatalogTools = getDeterministicTools(
      context.allowedDomains && context.allowedDomains.length > 0
        ? rawCatalogTools.filter(t => !SUBAGENT_CORE_EXCLUDED.has(t.name))
        : rawCatalogTools
    );
    const activeToolsStr = allCatalogTools
      .map((td, idx) => `${idx + 1}. ${td.desc}`)
      .join("\n");

    const mcpToolsStr = mcpDiscoveredTools.length > 0
      ? "\n## Connected MCP External Tools:\n" + mcpDiscoveredTools
          .map((t, idx) => {
            let paramStr = "";
            const schema = t.input_schema as Record<string, unknown> | undefined;
            if (schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object") {
              const keys = Object.keys(schema.properties as Record<string, unknown>);
              if (keys.length > 0) {
                paramStr = ` (Parameters: ${keys.join(", ")})`;
              }
            }
            return `${idx + allCatalogTools.length + 1}. '${t.normalized_tool_name}': ${t.description || t.original_tool_name}${paramStr}`;
          }).join('\n')
      : '';

    const learnedWorkflowsStr = learnedWorkflows.length > 0
      ? "\n## Learned Workflow Custom Macro-Tools:\n" + learnedWorkflows
          .map((w, idx) => `${idx + allCatalogTools.length + mcpDiscoveredTools.length + 1}. 'workflow_${w.workflow_name.replace(/[^a-zA-Z0-9_]/g, '_')}': ${w.workflow_description || w.description || 'Custom workflow'}`).join('\n')
      : '';

    context.systemPrefix = `
    You are LOUIS AI, operating in an enterprise CRM ReAct loop.
    
    Preferred language: ${preferredLanguageName}
    Tenant ID: "${context.tenantId}"

    ## Temporal Context & MCP Tool Date Formatting Directives:
    - System Temporal Anchor: siehe 'Current System Timestamp' in der dynamischen Zone (wird pro Anfrage aktualisiert)
    - When calling MCP tools (e.g. Google Calendar, Google Tasks, Reminders), date and time arguments MUST be provided in full ISO 8601 format (e.g. 'YYYY-MM-DDTHH:mm:ssZ', or 'timeMin' and 'timeMax').
    - Translate relative expressions like "heute", "morgen", "übermorgen", "nächste Woche" into absolute ISO 8601 timestamps using today's temporal anchor (siehe 'Current Date' in der dynamischen Zone).

    ${shouldInjectEmailDirectives(context.promptDirectivesMode, context.userMessage) ? `## Directives for E-Mail & Payment Reminders (Zahlungserinnerungen):
    1. NEVER USE PLACEHOLDERS: Do NOT include placeholders like '[Datum einfügen]', '[Datum]', '[Betrag]' or '[Name]'. Calculate real dates based on today's date (siehe 'Current Date' in der dynamischen Zone) or use relative timeframes like 'binnen 7 Tagen' or 'in den nächsten Tagen'.
    2. RECIPIENT MATCHING: Do NOT reject or question email addresses based on contact names. Email addresses can be personal handles (e.g. s_opitz@gmx.de), company addresses, or representatives.
    3. FREIGABE-LOGIK (CHAT vs. DASHBOARD):
       - Sind alle Daten (Empfänger-E-Mail, Betreff, Inhalt) vollzählig und korrekt: Formuliere die E-Mail ausschließlich als 'proposedChanges' ('entity_type': 'emails', 'action': 'SEND') für die Freigabe direkt im Chat.
       - Fehlen Daten oder sind sie unvollständig: Das Werkzeug legt den Entwurf im Dashboard unter 'E-Mail-Entwürfe' an. Erstelle in diesem Fall KEIN 'proposedChanges' im Chat, sondern weise den Nutzer im Chat darauf hin, dass der Entwurf im Dashboard zur Ergänzung/Freigabe liegt.
    4. VORLAGEN (TEMPLATES):
       - Wenn eine E-Mail-Vorlage (z.B. 'Standard-Rechnungsvorlage' oder 'Freundliche Zahlungserinnerung') angefordert wird, rufe get_templates auf.
       - Wende die Vorlage mit apply_template an oder nutze ihren Betreff & Inhalt und ersetze alle Platzhalter ({{invoice_number}}, {{total_gross}}, {{currency}}, {{due_date}}, etc.) mit den echten CRM-Daten.
       - Verwende dann send_smtp_email mit den fertig befüllten Werten.
    ` : ''}

    ## Directives for ReAct Loop & Final Responses:
    - Set "isComplete" to true as soon as you have executed the required tools and retrieved the necessary data.
    - When "isComplete" is true, write a friendly, polite, and complete answer in ${preferredLanguageName} in "finalDraftText" for the user (e.g. detailing the calendar events found with time, date, title or stating clearly that no calendar entries were found).
    - "finalDraftText" MUST NOT be null or empty when "isComplete" is true, and MUST NOT be an internal debug thought.
    - FREIGABE-DRAFT-FLOW (WICHTIG): Alle Schreibaktionen (Kontakt, Firma, Rechnung, Angebot, Notiz, Update) erzeugen einen ENTWURF zur Freigabe. Das Tool antwortet mit 'draft: true' / 'Freigabe erforderlich'. Das ist ein ERFOLG:
      1. Rufe das Schreib-Tool genau EINMAL auf.
      2. Setze isComplete = true und schreibe die Antwort mit dem Hinweis, dass der Entwurf zur Freigabe bereitliegt (Freigabe-Button im Chat).
      3. NICHT erneut aufrufen, NICHT per list_*-Tool verifizieren (der Datensatz erscheint erst NACH der Freigabe in der Datenbank). Ein fehlender DB-Treffer bei der Verifikation ist KEIN Fehler.
    - Rückfragen bei unvollständigen Daten (z.B. fehlender Nachname) sind erlaubt, aber wenn alle Pflichtdaten vorliegen: sofort Schreib-Tool aufrufen und abschließen — KEINE unnötigen Zwischenschritte (kein list_contact vor create, keine Doppel-Calls).

    ## Available Tools (Deterministically Sorted):
    ${activeToolsStr}
    ${mcpToolsStr}
    ${learnedWorkflowsStr}

    ${context.toolCallMode === 'json' ? `Respond with a single valid JSON object matching this structure EXACTLY:
    {
      "thought": "Your reasoning in ${preferredLanguageName}",
      "isComplete": boolean,
      "callToolName": string | null,
      "callToolQuery": string | null,
      "finalDraftText": string | null,
      "proposedChanges": {
        "entity_type": "companies" | "contacts" | "invoices" | "emails" | "offers" | "kanban_board" | "kanban_column" | "kanban_card",
        "action": "CREATE" | "UPDATE" | "DELETE" | "SEND" | "MOVE",
        "id_uuid": "optional-uuid-string",
        "proposed_state": { ... },
        "explanation_rational": "Explanation string"
      } | null
    }` : context.toolCallMode === 'native' ? `You are operating in NATIVE TOOL-CALLING MODE. Instead of emitting a JSON decision object, use the provided function tools directly:
    - To execute a CRM/knowledge tool: call the corresponding function (e.g. list_companies) with its parameters.
    - When you have all data and are ready to answer: call finalize_response with { "finalDraftText": "your complete answer in ${preferredLanguageName}" }.
    - For CRM changes requiring approval: call propose_crm_changes with { "entity_type", "action", "proposed_state", "explanation_rational" }.
    Do NOT wrap your answer in JSON when using native tool calls.` : `You are in AUTO TOOL-CALLING MODE. You may use the provided function tools directly (preferred, saves tokens). If you cannot or should not call a tool, respond with a single valid JSON object matching this structure EXACTLY:
    {
      "thought": "Your reasoning in ${preferredLanguageName}",
      "isComplete": boolean,
      "callToolName": string | null,
      "callToolQuery": string | null,
      "finalDraftText": string | null,
      "proposedChanges": {
        "entity_type": "companies" | "contacts" | "invoices" | "emails" | "offers" | "kanban_board" | "kanban_column" | "kanban_card",
        "action": "CREATE" | "UPDATE" | "DELETE" | "SEND" | "MOVE",
        "id_uuid": "optional-uuid-string",
        "proposed_state": { ... },
        "explanation_rational": "Explanation string"
      } | null
    }`}
    `;

    // S10: Vault-Skill-Injektion (1x pro Request, nach Zone-1-Aufbau — caching-freundlich, request-gebunden)
    try {
      const skills = await resolveSkillFiles(context.tenantId);
      if (skills.length > 0) {
        const relevant = topMatchSkills(skills, context.userMessage, 3);
        if (relevant.length > 0) {
          context.systemPrefix += "\n## Relevant Vault Skills:\n" + relevant
            .map((s) => `- **${s.name}** (${s.description}):\n${s.content}`)
            .join("\n");
          // Auftrag 012 P0-1: Transparenz — Thought-Log-Zeile, welche Skills injiziert wurden
          context.thoughtLog.push(`[S10] Verwendete Skills: ${relevant.map((s) => s.name).join(", ")}`);
        }
      }
    } catch (err) {
      console.warn("[S10] Vault-Skill-Injektion fehlgeschlagen (Block weggelassen):", err);
    }

    // S11 Teil C: Offene Rückfragen laden (1x pro Request) — der Agent weiß, dass Entscheidungen ausstehen
    let openQuestions: string[] = [];
    try {
      if (isUsingFallback || !pool) {
        openQuestions = (fallbackStore.aiQuestions || [])
          .filter((q) => q.status === "OPEN" && (q.tenant_id === context.tenantId || q.tenant_id === "1"))
          .slice(0, 5)
          .map((q) => q.question);
      } else {
        const qRes = await pool.query(
          `SELECT question FROM sys_louis_ai_questions WHERE tenant_id = $1 AND status = 'OPEN' ORDER BY created_at_utc DESC LIMIT 5`,
          [context.tenantId]
        );
        openQuestions = qRes.rows.map((r) => String(r.question));
      }
    } catch {
      openQuestions = [];
    }

    // B4-Nachfolge (2026-08-16, provider-agnostisch): Ankündigungs-Schutz-Zähler
    // lebt AUSSERHALB der Schleife (zählt über Iterationen hinweg, max 2 Korrektur-Runden).
    const TOOL_CALL_RETRY_MAX = 2;
    let toolCallRetryCount = 0;
    // Befund-2-Fix (2026-08-17): Korrektur-Runden bei kaputtem JSON (parseFailed) — bounded.
    let jsonRetryCount = 0;

    while (!context.isComplete && loopCount < maxLoops) {
      loopCount++;
      context.currentIteration = loopCount;
      context.thoughtLog.push(`ReAct Iteration [Round ${loopCount}]: Analyzing system states...`);

      // Auftrag 006 A2: Tool-Ergebnis-Stand VOR dieser Iteration — nur NEUE Ergebnisse
      // werden in der Folge-Iteration voll eingebettet, ältere als 1-Zeilen-Zusammenfassung.
      const resultsBeforeIteration = context.toolResults.length;

      const executedToolNames = new Set(context.toolResults.map(r => r.toolName));
      const intent = classifyIntentFastPath(context.userMessage);

      // ============================================================================
      // B4-Nachfolge (2026-08-16, provider-agnostisch): Ankündigungs-Schutz
      // Das Modell darf den Loop NICHT mit einer Ankündigung ("Ich durchsuche gleich…")
      // beenden, wenn die Anfrage eindeutig Tools erfordert (Intent ≠ GENERAL) und noch
      // KEIN Tool ausgeführt wurde. Nur klare Futur-/Ankündigungs-Phrasen triggern den
      // Retry — fertige Antworten (auch reine Chat-/Analyse-Antworten) bleiben unberührt.
      // (Erkennungslogik: exportierte Funktion isAnnouncementText unten im Modul)
      // ============================================================================

      const sandboxToolResult = context.toolResults.find(r => 
        ["create_contact_draft", "create_company_draft", "create_invoice_draft", "create_offer_draft", "finalize_and_send_offer", "send_smtp_email"].includes(r.toolName) &&
        typeof r.result === "string" && (r.result.startsWith("Erfolg!") || r.result.includes("erfolgreich"))
      );

      const shouldForceEarlyExit = loopCount > 1 && (
        !!sandboxToolResult || 
        context.toolResults.length >= context.earlyExitAfterTools
      );

      const earlyExitDirective = shouldForceEarlyExit
        ? `
        🚨 EARLY-EXIT DIRECTIVE 🚨
        Sufficient tools have been executed. You MUST finish the ReAct loop now:
        - Set "isComplete" to true
        - Set "callToolName" to null and "callToolQuery" to null
        - Write your final response in "finalDraftText" in ${preferredLanguageName}.
        `
        : '';

      const optimizedHistory = buildOptimizedConversationHistory(context.history, context.maxHistoryTokens || 2000);

      // Zone 1 (statischer, gecachter Prefix aus context.systemPrefix) + Zone 2 (dynamisch pro Iteration;
      // Timestamp-Anzeige aus context.temporalAnchor — pro Request konstant, aber zwischen Requests wechselnd → gehört in Zone 2)
      const systemInstruction = (context.systemPrefix || "") + `
      Current System Timestamp: ${formattedTimestamp}
      Current Date: ${dateIsoStr.slice(0, 10)}
      System Temporal Anchor: ${formattedTimestamp}

      ## Parallel Tool Usage:
      parallelToolCalls ist ein JSON-FELD deiner Antwortstruktur — KEIN Tool-Name. Um mehrere unabhängige Lese-Tools parallel auszuführen, setze callToolName auf null und fülle parallelToolCalls mit [{"toolName": "...", "toolQuery": "..."}]. Schreiboperationen immer einzeln (seriell).

      ${context.shortTermSummary ? `## Short-Term Memory Summary:\n${context.shortTermSummary}\n` : ''}

      ${context.userMemory && (context.userMemory.response_preferences_text || (context.userMemory.chat_notes_json && context.userMemory.chat_notes_json.length > 0)) ? `## User Memory (Gedächtnis):
      Das Folgende ist das dauerhafte Gedächtnis über den Nutzer (Präferenzen + Notizen). Wenn der Nutzer nach gespeicherten Fakten, Präferenzen oder früheren Absprachen fragt, beantworte die Frage ZUERST auf Basis dieses Gedächtnisses — auch wenn die Daten nicht im CRM stehen. Erfinde keine Inhalte, die nicht hier stehen.
      ${context.userMemory.response_preferences_text ? `Präferenzen:\n${context.userMemory.response_preferences_text}` : ''}
      ${(() => {
        const budget = context.aiConfig.memory_budget_tokens ?? 800;
        const { text, dropped } = renderBudgetedMemoryNotes(context.userMemory?.chat_notes_json || [], budget);
        if (!text) return '';
        return `Notizen:\n${text}${dropped > 0 ? `\n(… und ${dropped} weitere ältere Notizen — Speicherbudget erreicht)` : ''}`;
      })()}
      ` : ''}

      ${openQuestions.length > 0 ? `## Offene Rückfragen (ausstehende Entscheidungen):\n${openQuestions.join("; ")}\n` : ''}

      ${context.attachments && context.attachments.length > 0 ? `
      ## Angehängte Dateien (Attachments):
      Der Nutzer hat folgende Dateien hochgeladen. Ihr vollständiger Inhalt steht dir hier als Kontext zur Verfügung. Nutze ihn für Analysen, Suchen und Beantwortung der Frage. Zitiere daraus, wenn du Fakten daraus verwendest.
      ${context.attachments.map((att, i) => `
      --- Datei ${i + 1}: ${att.fileName}${att.isIndexedInKnowledgeBase ? ' [In Wissensdatenbank dauerhaft indiziert]' : ''} ---
      ${att.text}
      `).join('\n')}
      ` : ''}

      ## Conversation History:
      ${JSON.stringify(optimizedHistory)}
      `;

      // Zone 3 Dynamic Payload per Iteration
      const dynamicPayload = `
      <REACT_LOOP_STATE>
      Iteration: ${loopCount} of ${maxLoops}
      Intent: ${intent || 'GENERAL'}

      <PREVIOUS_TOOL_RESULTS>
      ${buildToolResultsSection(
        context.toolResults,
        context.lastInjectedToolResults ?? 0,
        context.toolResultTruncateChars,
        context.language === "en" ? "en" : "de",
        context.reactKeepLastResults,
        // B1: Ab der konfigurierten Iteration greift die Compaction (nur keepLast voll)
        loopCount >= context.reactCompactionFromIteration
      )}
      </PREVIOUS_TOOL_RESULTS>

      <USER_QUERY>
      ${context.userMessage}
      </USER_QUERY>
      </REACT_LOOP_STATE>

      ${earlyExitDirective}
      ${context.retryDirective || ""}
      `;

      // Korrektur-Direktive nur EINE Iteration wirken lassen (danach zurücksetzen)
      context.retryDirective = undefined;

      try {
        // Auftrag 007 T3: Native Tool-Calls — tools nur im Modus 'auto'/'native' übergeben.
        // 'json' = bisheriges Verhalten (JSON-Freitext). Gemini-Zweig nutzt nativeTools
        // nur, wenn der Katalog als functionDeclarations konvertierbar ist.
        const toolCallMode = context.toolCallMode || 'auto';
        const useNativeTools = toolCallMode !== 'json';
        // Katalog-Tools + Steuer-Tools (finalize_response/propose_crm_changes werden von
        // safeParseReActDecision als native Calls erwartet, stehen aber nicht im Katalog)
        const nativeToolDecls = useNativeTools ? [
          ...buildNativeTools(allCatalogTools),
          ...buildNativeTools([
            { name: "finalize_response", desc: "'finalize_response': Beendet den ReAct-Loop mit der finalen Antwort an den Nutzer. Query JSON: { finalDraftText }" },
            { name: "propose_crm_changes", desc: "'propose_crm_changes': Schlägt CRM-Änderungen zur Freigabe vor. Query JSON: { entity_type, action, id_uuid?, proposed_state, explanation_rational }" }
          ])
        ] : undefined;

        const res = await generateContentUniversal({
          provider_type: provider,
          model_name: modelToUse,
          api_key_secret: cleanApiKey,
          base_url: config.base_url as string | undefined,
          temperature: config.temperature ?? 0.2,
          systemInstruction,
          contents: dynamicPayload,
          jsonFormat: toolCallMode === 'json' ? true : false,
          tools: nativeToolDecls
        });

        if (res.usageMetadata) {
          const metadata = res.usageMetadata as ModelUsageMetadata;
          context.inputTokens += metadata.promptTokens || metadata.promptTokenCount || metadata.prompt_token_count || 0;
          context.outputTokens += metadata.completionTokens || metadata.candidatesTokenCount || metadata.candidates_token_count || 0;
          context.cachedTokens += metadata.cachedInputTokens || metadata.cacheReadInputTokens || 0;
        }

        // Auftrag 007 T3: tool_calls durchreichen (native Tool-Calls) — sonst JSON-Pfad wie bisher
        const decision = safeParseReActDecision({ text: res.text || "", tool_calls: res.tool_calls as ToolCall[] | undefined });

        if (decision.thought) {
          context.thoughtLog.push(`Thought: ${decision.thought}`);
        }

        // Befund-2-Fix (2026-08-17): kaputtes JSON (parseFailed) → Korrektur-Runde statt
        // Garbage/Artefakt als finale Antwort. Bounded über jsonRetryCount; nach Erschöpfung
        // wird die Antwort aus den vorliegenden Tool-Ergebnissen gebaut (Loop-Ende-Fallback).
        if (decision.parseFailed) {
          if (jsonRetryCount < TOOL_CALL_RETRY_MAX) {
            jsonRetryCount++;
            context.thoughtLog.push(
              `[JSON-Retry ${jsonRetryCount}/${TOOL_CALL_RETRY_MAX}] Rohantwort war kein gültiges JSON — Korrektur-Runde wird gestartet.`
            );
            context.retryDirective =
              (context.language === 'de'
                ? `\n🚨 KORREKTUR-AUFFORDERUNG (${jsonRetryCount}/${TOOL_CALL_RETRY_MAX}) 🚨\nDeine letzte Antwort war KEIN gültiges JSON-Format. Antworte ausschließlich im vorgegebenen JSON-Entscheidungsformat oder als XML-Tool-Call (<invoke name="...">). Keine Markdown-Blöcke, kein Prosa-Text, kein vorzeitiges Beenden.`
                : `\n🚨 CORRECTION (${jsonRetryCount}/${TOOL_CALL_RETRY_MAX}) 🚨\nYour last response was NOT valid JSON. Respond ONLY in the required JSON decision format or as XML tool calls (<invoke name="...">). No markdown blocks, no prose, no premature finalization.`);
            continue;
          }
          context.thoughtLog.push(
            `[JSON-Retry] ${TOOL_CALL_RETRY_MAX} Korrektur-Runden ohne valides JSON — Antwort wird aus den vorliegenden Tool-Ergebnissen gebaut (kein Garbage-Text).`
          );
          context.isComplete = true;
          context.finalDraftText = null;
          break;
        }

        if (decision.proposedChanges) {
          const pc = decision.proposedChanges;
          if (pc.entity_type === 'emails' && pc.proposed_state) {
            const ps = pc.proposed_state as Record<string, unknown>;
            const rec = String(ps.recipient_email_address || ps.recipient || ps.to || "").trim();
            const subj = String(ps.email_subject_text || ps.subject || ps.email_subject || "").trim();
            const bdy = String(ps.email_body_content || ps.body || ps.message || "").trim();
            pc.proposed_state = {
              ...ps,
              recipient_email_address: rec,
              email_subject_text: subj,
              email_body_content: bdy,
              recipient: rec,
              subject: subj,
              body: bdy
            };
          }
          context.proposedChanges = pc as AgentPipelineContext['proposedChanges'];
        }

        // B4-Nachfolge (2026-08-16): Ankündigungs-Schutz — Modell will den Loop mit einer
        // Ankündigung beenden, obwohl die Anfrage Tools erfordert und KEIN Tool lief.
        // Gate: Intent ≠ GENERAL UND toolResults.length === 0 UND Ankündigungs-Phrasen.
        const toolIntentNeeded = intent !== null && intent !== "GENERAL";
        const noToolsExecuted = context.toolResults.length === 0;
        const announcementText = (decision.finalDraftText || decision.thought || "").trim();
        const isAnnouncement = toolIntentNeeded && noToolsExecuted && isAnnouncementText(announcementText);

        if (decision.isComplete && isAnnouncement && toolCallRetryCount < TOOL_CALL_RETRY_MAX) {
          // Korrektur-Runde statt Loop-Ende: Anweisung in den nächsten Prompt einbetten
          toolCallRetryCount++;
          context.thoughtLog.push(
            `[ToolCall-Retry ${toolCallRetryCount}/${TOOL_CALL_RETRY_MAX}] Ankündigung statt Tool-Ausführung erkannt (Intent: ${intent}). Korrektur-Runde wird gestartet.`
          );
          context.retryDirective =
            `\n🚨 KORREKTUR-AUFFORDERUNG (${toolCallRetryCount}/${TOOL_CALL_RETRY_MAX}) 🚨\n` +
            `Deine letzte Antwort war eine bloße ANKÜNDIGUNG ("${announcementText.slice(0, 80)}…"), kein Tool-Aufruf.\n` +
            `Diese Anfrage erfordert die Ausführung eines Tools (Intent: ${intent}).\n` +
            `- Rufe JETZT das passende Tool auf (als Tool-Call oder JSON/XML-Entscheidung) ODER\n` +
            `- Wenn die benötigten Daten bereits im Kontext/Verlauf vorhanden sind, beantworte die Frage direkt mit isComplete=true.\n` +
            `Antworte NIE mit einer Ankündigung wie "Ich werde suchen/prüfen/laden".`;
          continue; // nächste Iteration mit Korrektur-Direktive
        }

        if (decision.isComplete) {
          context.isComplete = true;
          let text = decision.finalDraftText;
          if (!text || text.trim() === "" || text.startsWith("Thought:") || text.includes("Analyzing system states")) {
            if (decision.thought && !decision.thought.startsWith("Thought:") && !decision.thought.includes("Analyzing system states")) {
              text = decision.thought;
            } else if (decision.thought) {
              text = decision.thought.replace(/^Thought:\s*/i, "").trim();
            } else {
              text = context.language === 'de' ? "Anfrage erfolgreich verarbeitet." : "Request processed successfully.";
            }
          }
          context.finalDraftText = sanitizeFinalText(text, context.language);
          break;
        }

        if (decision.parallelToolCalls && decision.parallelToolCalls.length > 0) {
          // S4: Parallele Ausführung unabhängiger READ-Tools (Promise.allSettled).
          // Whitelist-Filter: WRITE-Tools sind strukturell ausgeschlossen (parallele Writes = Race-Gefahr).
          const freshCalls = decision.parallelToolCalls.filter(pc => {
            // Befund-3-Fix (2026-08-17): Vault-Write-Tools NIEMALS parallel (Race-Gefahr);
            // Vault-Lese-Tools (logisch ODER normalisiert) sind parallel erlaubt —
            // sie fehlten in der Whitelist und blockierten ganze Batches (Duplicate-Block-Abbruch).
            const vkind = vaultToolKind(pc.toolName);
            if (vkind === 'write') return false;
            if (vkind === null && !this.READ_TOOL_WHITELIST.has(pc.toolName)) return false;
            const q = typeof pc.toolQuery === "string" ? pc.toolQuery : JSON.stringify(pc.toolQuery);
            return !context.toolResults.some(r => r.toolName === pc.toolName && r.query === q);
          });

          // Batch-interne Duplikate entfernen (zweistufig: gegen toolResults UND gegen den Batch selbst)
          const seen = new Set<string>();
          const dedupedCalls = freshCalls.filter(pc => {
            const q = typeof pc.toolQuery === "string" ? pc.toolQuery : JSON.stringify(pc.toolQuery);
            const key = `${pc.toolName}|${q}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          if (dedupedCalls.length === 0) {
            // Befund-3-Fix (2026-08-17): Statt Loop-Abbruch mit durchgesickertem Thought
            // das Modell gezielt weiterleiten — retryDirective wirkt exakt eine Iteration
            // (Reset nach Prompt-Bau). Der Loop bleibt durch maxLoops begrenzt; der
            // Loop-Ende-Fallback baut bei Bedarf eine echte Antwort aus den Ergebnissen.
            const blocked = decision.parallelToolCalls.map((pc) => pc.toolName).join(", ");
            context.thoughtLog.push(
              `[Parallel Block] ${decision.parallelToolCalls.length} parallelToolCalls gefiltert (Duplikate oder nicht parallel erlaubt: ${blocked}). Hinweis ans Modell gesendet — kein Thought-Leak.`
            );
            context.retryDirective =
              (context.language === 'de'
                ? `\n🚨 HINWEIS: Deine parallelen Tool-Aufrufe (${blocked}) wurden NICHT ausgeführt — Duplikate bereits vorliegender Ergebnisse oder nicht parallel erlaubt.\n- Führe fehlende Aufrufe EINZELN (seriell über callToolName) aus ODER\n- Beantworte die Anfrage mit den bereits vorliegenden Ergebnissen (isComplete=true).\nAntworte NIE mit einer Ankündigung wie "Ich werde listen/suchen/prüfen".`
                : `\n🚨 NOTE: Your parallel tool calls (${blocked}) were NOT executed — they duplicate already-available results or are not allowed in parallel.\n- Run missing calls ONE BY ONE (serially via callToolName) OR\n- Answer using the results you already have (isComplete=true).\nNever reply with an announcement like "I will list/search/check".`);
            continue;
          }

          context.thoughtLog.push(`[Parallel] Ausführen von ${dedupedCalls.length} unabhängigen Lese-Tools (allSettled).`);
          const settled = await Promise.allSettled(
            dedupedCalls.map(pc => this.executeSingleTool(context, ai, pc.toolName, pc.toolQuery))
          );
          settled.forEach((s, i) => {
            const pc = dedupedCalls[i];
            if (s.status === "fulfilled") {
              context.toolResults.push(s.value);
            } else {
              const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
              context.toolResults.push({
                toolName: pc.toolName,
                query: typeof pc.toolQuery === "string" ? pc.toolQuery : JSON.stringify(pc.toolQuery),
                result: `Tool execution failed: ${msg}`
              });
            }
          });
          // Delta-Tracking: nur Ergebnisse ab resultsBeforeIteration sind fürs Modell neu
          context.lastInjectedToolResults = resultsBeforeIteration;
          continue;
        }

        if (decision.callToolName) {
          const toolName = decision.callToolName;
          const rawToolQuery = decision.callToolQuery;
          let toolQuery = "";
          if (typeof rawToolQuery === "string") {
            toolQuery = rawToolQuery;
          } else if (rawToolQuery !== null && rawToolQuery !== undefined) {
            if (typeof rawToolQuery === "object") {
              const obj = rawToolQuery as Record<string, unknown>;
              if (typeof obj.query === "string") {
                toolQuery = obj.query;
              } else if (typeof obj.search === "string") {
                toolQuery = obj.search;
              } else if (typeof obj.instruction === "string") {
                toolQuery = obj.instruction;
              } else {
                toolQuery = JSON.stringify(rawToolQuery);
              }
            } else {
              toolQuery = String(rawToolQuery);
            }
          }
          
          const isDuplicateCall = context.toolResults.some(
            r => r.toolName === toolName && r.query === toolQuery
          );

          if (isDuplicateCall) {
            // Befund-3-Fix (2026-08-17): Statt Abbruch mit durchgesickertem Thought
            // das Modell weiterleiten (vorliegende Ergebnisse nutzen ODER andere Argumente).
            context.thoughtLog.push(`[Duplicate Block] Tool "${toolName}" mit Query "${toolQuery}" bereits ausgeführt — Hinweis ans Modell statt Loop-Abbruch (kein Thought-Leak).`);
            context.retryDirective =
              (context.language === 'de'
                ? `\n🚨 HINWEIS: Der Aufruf "${toolName}" mit dieser Query wurde bereits ausgeführt. Nutze die vorliegenden Ergebnisse, rufe das Tool mit ANDEREN Argumenten auf, oder beende mit isComplete=true.`
                : `\n🚨 NOTE: The call "${toolName}" with this query was already executed. Use the available results, call the tool with DIFFERENT arguments, or finalize with isComplete=true.`);
            continue;
          }

          const single = await this.executeSingleTool(context, ai, toolName, toolQuery);
          context.toolResults.push(single);
          // Delta-Tracking: nur Ergebnisse ab resultsBeforeIteration sind fürs Modell neu
          context.lastInjectedToolResults = resultsBeforeIteration;

          // B3 (Auftrag 011): einheitlicher Draft-Flow — nach einem Write-Tool mit
          // draft=true (Freigabe-Vorschlag) den Loop sofort beenden. Sonst verifiziert
          // der Agent den (noch nicht geschriebenen) Zustand, findet nichts in der DB
          // und ruft das Tool erneut auf → ReAct-Endlosschleife bis zum Timeout.
          const singleResObj = single.result as
            | { success?: boolean; data?: { draft?: boolean; message?: string } }
            | string
            | undefined;
          if (
            typeof singleResObj === "object" &&
            singleResObj !== null &&
            singleResObj.success === true &&
            singleResObj.data?.draft === true
          ) {
            context.thoughtLog.push(
              "[Draft-Flow] Freigabe-Vorschlag erstellt — ReAct-Loop beendet, wartet auf menschliche Freigabe."
            );
            context.isComplete = true;
            if (!context.finalDraftText || context.finalDraftText.trim() === "" || context.finalDraftText.startsWith("Thought:")) {
              // B3: faktenbasierte Antwort aus der Tool-Message statt interner
              // Thought-Zwischenüberlegung („Ich rufe das Tool auf…") —
              // kein zusätzlicher LLM-Call nötig, schnelle Antwort.
              const toolMsg = typeof singleResObj.data.message === "string"
                ? singleResObj.data.message
                : (context.language === "de"
                    ? "Entwurf erstellt — bitte im Chat freigeben."
                    : "Draft created — please approve in chat.");
              context.finalDraftText = sanitizeFinalText(toolMsg, context.language);
            }
            break;
          }
        } else {
          // No tool selected and isComplete is false
          context.isComplete = true;
          if (decision.finalDraftText && decision.finalDraftText.trim().length > 0) {
            context.finalDraftText = sanitizeFinalText(decision.finalDraftText, context.language);
          } else if (decision.thought && decision.thought.trim().length > 0) {
            context.finalDraftText = sanitizeFinalText(decision.thought, context.language);
          }
        }
      } catch (loopErr) {
        context.thoughtLog.push(`ReAct Loop Execution Error: ${(loopErr as Error).message}`);
        context.isComplete = true;
      }
    }

    if (!context.finalDraftText || context.finalDraftText.trim() === "") {
      context.isComplete = true;
      try {
        const targetLang = context.language === 'de' ? 'German / Deutsch' : (context.language === 'en' ? 'English' : context.language);
        const toolSummary = context.toolResults.length > 0
          ? context.toolResults.map((t, i) => `[Action #${i+1}] Tool: ${t.toolName}\nResult: ${truncateResult(t.result, 1500)}`).join("\n\n")
          : (context.language === 'de' ? "Keine Werkzeuge ausgeführt." : "No tools executed.");

        const summaryPrompt = `
You are Louis, the AI Assistant in Louis Smart CRM.
User query: "${context.userMessage}"

${context.attachments && context.attachments.length > 0
  ? `Attached files provided by the user:\n${context.attachments.map((att, i) => `--- File ${i + 1}: ${att.fileName} ---\n${att.text.slice(0, 20000)}`).join('\n\n')}\n\n`
  : ''}
Background system tools executed:
${toolSummary}

Formulate a concise, professional, and complete final answer to the user in ${targetLang}. Address their request directly and include all relevant details from the execution results (e.g. appointment/event details, times, dates, attendees, email addresses, contacts, subjects, etc.).
        `.trim();

        const synthesisRes = await generateContentUniversal({
          provider_type: provider,
          model_name: modelToUse,
          api_key_secret: cleanApiKey,
          base_url: config.base_url as string | undefined,
          temperature: config.temperature ?? 0.2,
          contents: summaryPrompt
        });

        if (synthesisRes.text && synthesisRes.text.trim().length > 0) {
          context.finalDraftText = sanitizeFinalText(synthesisRes.text.trim(), context.language);
        }
      } catch (synthErr) {
        console.warn("Dynamic response synthesis failed:", synthErr);
      }
    }
  }

  // S6: Skill-Improvement-Loop — Fehler bei Workflow-Skills → Pitfall, erfolgreiche Mehrfach-Tool-Runs → Skill-Vorschlag.
  // Strikt fehlertolerant: darf die Pipeline nie brechen und nie verzögern (4s-Timeout-Race für den LLM-Call).
  private async maybeLearnFromExecution(context: AgentPipelineContext): Promise<void> {
    try {
      // --- Fehlerfall: workflow_*-Tool mit Fehler-Indikator → Pitfall an den Skill anhängen ---
      const failedWorkflowResults = context.toolResults.filter((r) => {
        if (!r.toolName.startsWith("workflow_")) return false;
        const resText = truncateResult(r.result).toLowerCase();
        const hasErrorText = ["fehler", "error", "unknown tool", "failed", "blockiert", "läuft bereits"].some((k) => resText.includes(k));
        const structured = r.result as Partial<{ status: string; stepsExecuted: Array<{ status: string }> }> | null;
        const hasStructuredFailure = !!structured && typeof structured === "object"
          && (structured.status === "failed" || (Array.isArray(structured.stepsExecuted) && structured.stepsExecuted.some((s) => s.status === "failed")));
        return hasErrorText || hasStructuredFailure;
      });

      if (failedWorkflowResults.length > 0) {
        const workflows = await getLearnedWorkflows(context.tenantId);
        for (const res of failedWorkflowResults) {
          const suffix = res.toolName.slice("workflow_".length);
          const wf = workflows.find((w) => w.workflow_name === suffix)
            || workflows.find((w) => w.workflow_name.replace(/[^a-zA-Z0-9_]/g, "_") === suffix);
          if (!wf) continue;
          const errSnippet = truncateResult(res.result, 300).slice(0, 450);
          const pitfall = `Workflow '${wf.workflow_name}': ${errSnippet}`.slice(0, 500);
          await appendSkillPitfall(context.tenantId, wf.id_uuid, pitfall);
        }
        return;
      }

      // --- Erfolgsfall: ≥2 Tools, keine Fehler, Intent CUSTOM_TOOL/GENERAL → LLM-Skill-Vorschlag (NIE automatisch speichern) ---
      if (context.toolResults.length < 2) return;
      const allClean = context.toolResults.every((r) => {
        const resText = truncateResult(r.result).toLowerCase();
        return !["fehler", "error", "unknown tool", "failed", "blockiert"].some((k) => resText.includes(k));
      });
      if (!allClean) return;
      const intent = classifyIntentFastPath(context.userMessage);
      if (intent !== "CUSTOM_TOOL" && intent !== "GENERAL") return;

      const config = context.aiConfig;
      const provider = (config.provider_type || "ollama") as "ollama" | "anthropic" | "openai" | "gemini";
      let cleanApiKey = (typeof config.api_key_secret === "string" ? config.api_key_secret.trim() : "");
      if (cleanApiKey.includes("@") || cleanApiKey === "******") cleanApiKey = "";
      const modelToUse = config.model_name || (provider === "gemini" ? "gemini-3.5-flash" : "llama3");

      const toolTrace = context.toolResults
        .map((t) => `[Action] Tool: ${t.toolName} | Query: ${t.query} | Result: ${truncateResult(t.result, 300)}`)
        .join("\n");
      const suggestionPrompt = `Fasse den ausgeführten Ablauf als Workflow-Skill zusammen. Antworte NUR mit JSON nach diesem Schema: {"workflow_name": string, "workflow_description": string, "skill_tags": string[], "skill_category"?: string, "tool_chain_sequence": [{"tool": string, "instruction": string}]}

Ausgeführter Ablauf:
${toolTrace}`;

      // 4s-Timeout-Race (Muster executePassiveShortTermCompression) — der Lern-Loop darf die Pipeline nie verzögern
      const llmPromise = generateContentUniversal({
        provider_type: provider,
        model_name: modelToUse,
        api_key_secret: cleanApiKey,
        base_url: (config.base_url as string) || undefined,
        temperature: config.temperature ?? 0.2,
        contents: suggestionPrompt,
        jsonFormat: true
      }).then((res) => (res.text as string) || "");

      const timeoutPromise = new Promise<string>((resolve) => {
        setTimeout(() => resolve(""), 4000);
      });
      const raw = await Promise.race([llmPromise, timeoutPromise]);
      if (!raw) return;

      const parsed = WorkflowLearnSuggestionSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        context.skillSuggestion = parsed.data;
      }
    } catch (err) {
      console.warn("[maybeLearnFromExecution] Lern-Loop übersprungen (Pipeline läuft weiter):", err);
    }
  }

  // S9/S11: Persistiert den Sub-Task-Status (INSERT PENDING → UPDATE SUCCESS/FAILED mit result_json + verification)
  private async persistSubTask(
    tenantId: string,
    dbId: string,
    task: { subtask_id: string; task_prompt: string; required_tools?: string[]; required_output_schema?: Record<string, unknown> },
    status: "PENDING" | "SUCCESS" | "FAILED",
    resultJson: unknown,
    verificationStatus: "UNVERIFIED" | "NOT_APPLICABLE" | "VERIFIED" = "UNVERIFIED"
  ): Promise<void> {
    if (isUsingFallback || !pool) {
      if (!fallbackStore.aiSubtasks) fallbackStore.aiSubtasks = [];
      if (status === "PENDING") {
        fallbackStore.aiSubtasks.push({
          id_uuid: dbId,
          tenant_id: tenantId,
          parent_session_id: null,
          task_prompt: task.task_prompt,
          required_tools_json: task.required_tools || [],
          status,
          result_json: null,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
      } else {
        const rec = fallbackStore.aiSubtasks.find((r) => r.id_uuid === dbId);
        if (rec) {
          rec.status = status;
          rec.result_json = resultJson as Record<string, unknown>;
          (rec as { subtask_id?: string; verification_status?: string }).subtask_id = task.subtask_id;
          (rec as { subtask_id?: string; verification_status?: string }).verification_status = verificationStatus;
          rec.updated_at_utc = new Date().toISOString();
        }
      }
      saveFallbackStore();
      return;
    }
    if (status === "PENDING") {
      await pool.query(
        `INSERT INTO sys_louis_ai_subtasks (id_uuid, tenant_id, parent_session_id, task_prompt, required_tools_json, status, result_json, subtask_id, verification_status)
         VALUES ($1, $2, NULL, $3, $4::jsonb, 'PENDING', NULL, $5, 'UNVERIFIED')`,
        [dbId, tenantId, task.task_prompt, JSON.stringify(task.required_tools || []), task.subtask_id]
      );
    } else {
      await pool.query(
        `UPDATE sys_louis_ai_subtasks SET status = $1, result_json = $2::jsonb, subtask_id = $3, verification_status = $4, updated_at_utc = NOW() WHERE id_uuid = $5`,
        [status, JSON.stringify(resultJson), task.subtask_id, verificationStatus, dbId]
      );
    }
  }

  // S9: Sub-Agent-Delegation — isolierte Sub-Contexts, max. 3 parallel, read-only
  private async executeDelegation(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<SubTaskResult[]>> {
    try {
      let rawArgs: unknown;
      try {
        rawArgs = JSON.parse(argsStr);
      } catch {
        rawArgs = { tasks: [] };
      }
      const parsed = SubTaskSpecSchema.safeParse(rawArgs);
      if (!parsed.success) {
        return createToolError(`Ungültige delegate_subtask-Argumente: ${parsed.error.message}`);
      }

      const tasks = parsed.data.tasks.slice(0, 3);
      if (parsed.data.tasks.length > 3) {
        context.thoughtLog.push("[delegate_subtask] Mehr als 3 Tasks übergeben — nur die ersten 3 werden ausgeführt.");
      }

      const settled = await Promise.allSettled(tasks.map(async (task) => {
        const dbId = uuidv4();
        await this.persistSubTask(context.tenantId, dbId, task, "PENDING", null);

        // Auftrag 012 P1-2: optionales Output-Schema in den Subtask-Prompt einbetten
        const schema = task.required_output_schema as Record<string, unknown> | undefined;
        const schemaPrompt = schema && Object.keys(schema).length > 0
          ? `\n\nANTWORTFORMAT (strikt): Antworte NUR mit einem validen JSON-Objekt gemäß folgendem Schema. Kein Text davor oder danach.\nSchema: ${JSON.stringify(schema)}\n`
          : "";

        // Baut einen isolierten Sub-Context (KEINE Memory-/History-/proposedChanges-Übergabe)
        const buildSubContext = (userMessage: string): AgentPipelineContext => ({
          tenantId: context.tenantId,
          userId: context.userId,
          userMessage,
          language: context.language,
          aiConfig: context.aiConfig,
          history: [],
          allowedDomains: ["CORE", "CRM_READ", "KNOWLEDGE"],
          thoughtLog: [],
          toolResults: [],
          currentIteration: 0,
          maxIterations: Math.min(Math.max(task.max_turns ?? 3, 1), 5),
          toolResultTruncateChars: context.toolResultTruncateChars,
          reactKeepLastResults: context.reactKeepLastResults,
          reactCompactionFromIteration: context.reactCompactionFromIteration,
          earlyExitAfterTools: context.earlyExitAfterTools,
          lastInjectedToolResults: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          finalDraftText: null,
          proposedChanges: null,
          isComplete: false,
          isFastPath: false,
          isComplex: true,
          temporalAnchor: new Date().toISOString()
        });

        try {
          // Erster Lauf
          const subContext = buildSubContext(task.task_prompt + schemaPrompt);
          let subResult = await this.executePipeline(subContext);
          let finalText = subResult.finalDraftText || "";
          let retried = false;

          // Auftrag 012 P1-2: Schema-Validierung mit genau 1 Korrekturversuch
          const validation = validateSubtaskOutput(finalText, schema);
          if (!validation.ok && schema) {
            retried = true;
            const retryContext = buildSubContext(
              `${task.task_prompt}\n\nDeine vorherige Antwort wurde abgelehnt: ${validation.error}\n${schemaPrompt}`
            );
            subResult = await this.executePipeline(retryContext);
            finalText = subResult.finalDraftText || "";
          }

          const toolTrace = subContext.toolResults.map((t) => ({ tool: t.toolName, query: t.query }));
          const result: SubTaskResult = {
            subtask_id: task.subtask_id,
            status: "success",
            final_text: finalText,
            tool_trace: toolTrace,
            ...(retried ? { retried: true } : {})
          };
          // S11 Teil A: deterministische Verifikations-Kennzeichnung (Selbst-Reporte)
          const traceReadOnly = toolTrace.length > 0 && toolTrace.every((t) => {
            const cat = SYSTEM_TOOL_CATALOG.find((c) => c.name === t.tool);
            return cat && (cat.domain === "CRM_READ" || cat.domain === "KNOWLEDGE" || cat.name === "crm_data_analyst" || cat.name === "text_generator");
          });
          const verificationStatus = traceReadOnly ? "NOT_APPLICABLE" : "UNVERIFIED";
          result.verification_status = verificationStatus;
          await this.persistSubTask(context.tenantId, dbId, task, "SUCCESS", result, verificationStatus);
          return result;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const result: SubTaskResult = {
            subtask_id: task.subtask_id,
            status: "failed",
            final_text: "",
            tool_trace: [],
            error: msg,
            verification_status: "UNVERIFIED"
          };
          await this.persistSubTask(context.tenantId, dbId, task, "FAILED", result, "UNVERIFIED");
          return result;
        }
      }));

      const results = settled.map((s, i) => {
        const task = tasks[i];
        if (s.status === "fulfilled") return s.value;
        const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
        return { subtask_id: task.subtask_id, status: "failed" as const, final_text: "", tool_trace: [], error: msg };
      });

      for (const r of results) {
        await logAuditEvent({
          tenantId: context.tenantId,
          eventType: "SUB_TASK",
          entityType: "agentRuntime",
          eventDetails: `${r.subtask_id}: ${r.status}`,
          actorIdentity: context.userId
        });
      }

      // VERIFIKATION-Hinweise (S11-Vorbereitung): Sub-Agent-Ergebnisse sind Selbst-Reporte
      const annotated = results.map((r) => {
        const traceReadOnly = r.tool_trace.length > 0 && r.tool_trace.every((t) => {
          const cat = SYSTEM_TOOL_CATALOG.find((c) => c.name === t.tool);
          return cat && (cat.domain === "CRM_READ" || cat.domain === "KNOWLEDGE" || cat.name === "crm_data_analyst" || cat.name === "text_generator");
        });
        const note = traceReadOnly
          ? `VERIFIKATION: Subtask ${r.subtask_id} ist NOT_APPLICABLE (reine Lese-Tools).`
          : `VERIFIKATION: Subtask ${r.subtask_id} ist UNVERIFIED. Vor Faktenübernahme mit einem Lese-Tool gegen die Quelle prüfen; danach verify_subtask aufrufen mit Evidence.`;
        return { ...r, verifikation: note };
      });

      return createToolSuccess(annotated as unknown as SubTaskResult[]);
    } catch (err) {
      return createToolError(`Delegation fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // S10: update_memory — dauerhafte Präferenzen/Notizen merken (Vault-first, DB-Spiegel best-effort)
  private async executeUpdateMemory(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { preference?: string; note?: string };
      if (!rawArgs.preference && !rawArgs.note) {
        return createToolError("update_memory benötigt mindestens 'preference' oder 'note'.");
      }
      const current = (await readUserMemoryVault(context.tenantId, context.userId)) || {
        response_preferences_text: "",
        frequently_used_tools_json: [],
        chat_notes_json: []
      };
      if (rawArgs.preference) {
        const prefs = current.response_preferences_text.split("\n").filter(Boolean);
        if (!prefs.some((p) => p.toLowerCase().includes(rawArgs.preference!.toLowerCase()))) {
          prefs.push(rawArgs.preference);
        }
        current.response_preferences_text = prefs.join("\n");
      }
      if (rawArgs.note) {
        // Auftrag 012 P0-2: Notiz-Dedupe — identischer Inhalt innerhalb 24 h wird nicht dupliziert
        const now = Date.now();
        const noteText = rawArgs.note.trim();
        const duplicateWithin24h = current.chat_notes_json.some((n) => {
          const sameContent = n.content.trim().toLowerCase() === noteText.toLowerCase();
          const within24h = Math.abs(now - new Date(n.created_at_utc).getTime()) < 24 * 60 * 60 * 1000;
          return sameContent && within24h;
        });
        if (!duplicateWithin24h) {
          current.chat_notes_json.push({ id_uuid: `note-${now}`, content: rawArgs.note, created_at_utc: new Date().toISOString() });
        }
      }
      const writeRes = await writeUserMemoryVault(context.tenantId, context.userId, current);

      // DB-Spiegel aktualisieren (Tier-3-Kompatibilität / S2) — best-effort
      try {
        if (isUsingFallback || !pool) {
          const records = fallbackStore.louisAiUserMemory || [];
          const rec = records.find((m) => m.user_id === context.userId && m.tenant_id === context.tenantId);
          if (rec) {
            rec.response_preferences_text = current.response_preferences_text;
            rec.chat_notes_json = current.chat_notes_json as never;
            saveFallbackStore();
          }
        } else {
          await pool.query(
            `INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
             VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4::jsonb)
             ON CONFLICT (tenant_id, user_id) DO UPDATE SET response_preferences_text = EXCLUDED.response_preferences_text, chat_notes_json = EXCLUDED.chat_notes_json, updated_at_utc = CURRENT_TIMESTAMP`,
            [context.tenantId, context.userId, current.response_preferences_text, JSON.stringify(current.chat_notes_json)]
          );
        }
      } catch (err) {
        console.warn("[update_memory] DB-Spiegel fehlgeschlagen (Vault bleibt Quelle):", err);
      }

      await logAuditEvent({
        tenantId: context.tenantId,
        eventType: "MEMORY_UPDATE",
        entityType: "user_memory",
        eventDetails: `${context.userId}: ${rawArgs.preference ? "preference" : ""}${rawArgs.note ? " note" : ""}`,
        actorIdentity: context.userId
      });
      return createToolSuccess({ message: `Merke ich mir (${writeRes.source}): ${rawArgs.preference || rawArgs.note}`, path: writeRes.path });
    } catch (err) {
      return createToolError(`Memory konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Auftrag 012 P0-2: delete_memory_note — einzelne Notiz aus dem Gedächtnis entfernen (Vault-first, DB-Spiegel)
  private async executeDeleteMemoryNote(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { note_id?: string };
      if (!rawArgs.note_id) {
        return createToolError("delete_memory_note benötigt 'note_id'.");
      }
      const current = (await readUserMemoryVault(context.tenantId, context.userId)) || {
        response_preferences_text: "",
        frequently_used_tools_json: [],
        chat_notes_json: []
      };
      const before = current.chat_notes_json.length;
      current.chat_notes_json = current.chat_notes_json.filter((n) => n.id_uuid !== rawArgs.note_id);
      if (current.chat_notes_json.length === before) {
        return createToolSuccess({ message: `Notiz ${rawArgs.note_id} nicht gefunden — nichts gelöscht.`, deleted: false });
      }
      const writeRes = await writeUserMemoryVault(context.tenantId, context.userId, current);

      // DB-Spiegel aktualisieren (best-effort, identisch zu update_memory)
      try {
        if (isUsingFallback || !pool) {
          const records = fallbackStore.louisAiUserMemory || [];
          const rec = records.find((m) => m.user_id === context.userId && m.tenant_id === context.tenantId);
          if (rec) {
            rec.chat_notes_json = current.chat_notes_json as never;
            saveFallbackStore();
          }
        } else {
          await pool.query(
            `INSERT INTO sys_louis_ai_user_memory (id_uuid, tenant_id, user_id, response_preferences_text, frequently_used_tools_json, chat_notes_json)
             VALUES (gen_random_uuid(), $1, $2, $3, '[]'::jsonb, $4::jsonb)
             ON CONFLICT (tenant_id, user_id) DO UPDATE SET chat_notes_json = EXCLUDED.chat_notes_json, updated_at_utc = CURRENT_TIMESTAMP`,
            [context.tenantId, context.userId, current.response_preferences_text, JSON.stringify(current.chat_notes_json)]
          );
        }
      } catch (err) {
        console.warn("[delete_memory_note] DB-Spiegel fehlgeschlagen (Vault bleibt Quelle):", err);
      }

      await logAuditEvent({
        tenantId: context.tenantId,
        eventType: "MEMORY_NOTE_DELETED",
        entityType: "user_memory",
        eventDetails: `${context.userId}: Notiz ${rawArgs.note_id} gelöscht`,
        actorIdentity: context.userId
      });
      return createToolSuccess({ message: `Notiz gelöscht (${writeRes.source}).`, deleted: true, path: writeRes.path });
    } catch (err) {
      return createToolError(`Notiz konnte nicht gelöscht werden: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // S10: save_skill — NIE direkt schreiben, immer über den Freigabe-Flow (proposedChanges)
  private async executeSaveSkill(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { name?: string; description?: string; content?: string; category?: string; tags?: string[] };
      if (!rawArgs.name || !rawArgs.description || !rawArgs.content) {
        return createToolError("save_skill benötigt name, description und content.");
      }
      context.proposedChanges = {
        entity_type: "vault_skill",
        action: "CREATE",
        proposed_state: {
          name: rawArgs.name,
          description: rawArgs.description,
          content: rawArgs.content,
          category: rawArgs.category || null,
          tags: rawArgs.tags || []
        } as Record<string, unknown>,
        explanation_rational: "Wissens-Skill-Vorschlag"
      };
      return createToolSuccess({ message: `Wissens-Skill '${rawArgs.name}' als Vorschlag zur Freigabe angelegt.` });
    } catch (err) {
      return createToolError(`save_skill fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Auftrag 012 P0-1: update_skill — bestehenden Skill aktualisieren (Freigabe-Flow, Version-Inkrement im approveProposal)
  private async executeUpdateSkill(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { name?: string; content?: string; description?: string; tags?: string[]; category?: string };
      if (!rawArgs.name) {
        return createToolError("update_skill benötigt 'name'.");
      }
      context.proposedChanges = {
        entity_type: "vault_skill",
        action: "UPDATE",
        proposed_state: {
          name: rawArgs.name,
          ...(rawArgs.content !== undefined ? { content: rawArgs.content } : {}),
          ...(rawArgs.description !== undefined ? { description: rawArgs.description } : {}),
          ...(rawArgs.tags !== undefined ? { tags: rawArgs.tags } : {}),
          ...(rawArgs.category !== undefined ? { category: rawArgs.category } : {})
        } as Record<string, unknown>,
        explanation_rational: "Wissens-Skill-Update-Vorschlag"
      };
      return createToolSuccess({ message: `Wissens-Skill '${rawArgs.name}' als Update-Vorschlag zur Freigabe angelegt.` });
    } catch (err) {
      return createToolError(`update_skill fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Auftrag 012 P0-1: delete_skill — Skill löschen (Freigabe-Flow)
  private async executeDeleteSkill(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { name?: string };
      if (!rawArgs.name) {
        return createToolError("delete_skill benötigt 'name'.");
      }
      context.proposedChanges = {
        entity_type: "vault_skill",
        action: "DELETE",
        proposed_state: {
          name: rawArgs.name
        } as Record<string, unknown>,
        explanation_rational: "Wissens-Skill-Lösch-Vorschlag"
      };
      return createToolSuccess({ message: `Wissens-Skill '${rawArgs.name}' als Lösch-Vorschlag zur Freigabe angelegt.` });
    } catch (err) {
      return createToolError(`delete_skill fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // S11 Teil C: ask_user_question — persistierte Rückfrage (Dashboard beantwortet sie)
  private async askUserQuestion(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { question?: string; choices?: string[]; context?: string };
      const parsed = AskUserQuestionArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return createToolError(`Ungültige ask_user_question-Argumente: ${parsed.error.message}`);
      const { question, choices, context: ctxText } = parsed.data;
      const id = uuidv4();
      const now = new Date().toISOString();
      if (isUsingFallback || !pool) {
        if (!fallbackStore.aiQuestions) fallbackStore.aiQuestions = [];
        fallbackStore.aiQuestions.push({
          id_uuid: id,
          tenant_id: context.tenantId,
          question,
          choices_json: JSON.stringify(choices || []),
          context_text: ctxText || "",
          status: "OPEN",
          answer: "",
          created_by: context.userId,
          created_at_utc: now,
          answered_at_utc: null
        });
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_louis_ai_questions (id_uuid, tenant_id, question, choices_json, context_text, status, created_by)
           VALUES ($1, $2, $3, $4::jsonb, $5, 'OPEN', $6)`,
          [id, context.tenantId, question, JSON.stringify(choices || []), ctxText || "", context.userId]
        );
      }
      await logAuditEvent({ tenantId: context.tenantId, eventType: "GOVERNANCE_ASK", entityType: ctxText || "general", eventDetails: question, actorIdentity: context.userId });
      return createToolSuccess({ message: `Rückfrage gespeichert (ID ${id}). Warte auf die Antwort. Führe die geplante Aktion jetzt NICHT aus.` });
    } catch (err) {
      return createToolError(`ask_user_question fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // S11 Teil A: verify_subtask — Selbst-Reporte gegen Lese-Tools prüfen und als VERIFIED markieren
  private async verifySubtask(context: AgentPipelineContext, argsStr: string): Promise<ToolResult<Record<string, unknown>>> {
    try {
      const rawArgs = JSON.parse(argsStr) as { subtask_id?: string; evidence?: string };
      const parsed = VerifySubtaskArgsSchema.safeParse(rawArgs);
      if (!parsed.success) return createToolError(`Ungültige verify_subtask-Argumente: ${parsed.error.message}`);
      const { subtask_id, evidence } = parsed.data;
      let rowCount = 0;
      if (isUsingFallback || !pool) {
        const rec = (fallbackStore.aiSubtasks || []).find((s) => (s as { subtask_id?: string }).subtask_id === subtask_id);
        if (rec) {
          (rec as { subtask_id?: string; verification_status?: string; verification_evidence?: string }).verification_status = "VERIFIED";
          (rec as { subtask_id?: string; verification_status?: string; verification_evidence?: string }).verification_evidence = evidence;
          saveFallbackStore();
          rowCount = 1;
        }
      } else {
        const res = await pool.query(
          `UPDATE sys_louis_ai_subtasks SET verification_status = 'VERIFIED', verification_evidence = $3, updated_at_utc = NOW() WHERE subtask_id = $1 AND tenant_id = $2`,
          [subtask_id, context.tenantId, evidence]
        );
        rowCount = res.rowCount ?? 0;
      }
      if (rowCount === 0) return createToolError(`Unbekannte subtask_id: ${subtask_id}`);
      await logAuditEvent({ tenantId: context.tenantId, eventType: "SUB_TASK_VERIFIED", entityType: "agentRuntime", eventDetails: `${subtask_id}: ${evidence}`, actorIdentity: context.userId });
      return createToolSuccess({ message: `Subtask ${subtask_id} als VERIFIED markiert.` });
    } catch (err) {
      return createToolError(`verify_subtask fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // S4: Whitelist für parallele Ausführung — NUR Lese-/Analyse-Tools ohne Seiteneffekte.
  // Bewusst NICHT enthalten: learn_workflow, alle create_*_draft, send_smtp_email, finalize_and_send_offer,
  // create/update/move/delete_kanban_card (schreiben bzw. setzen proposedChanges).
  private readonly READ_TOOL_WHITELIST: ReadonlySet<string> = new Set([
    'web_search', 'local_knowledge', 'list_vault_files', 'list_companies', 'list_contacts', 'list_invoices',
    'crm_data_analyst', 'data_architect', 'text_generator', 'get_templates', 'get_template_details',
    'apply_template', 'list_kanban_boards', 'get_kanban_board_details', 'get_workflows', 'recall_sessions'
  ]);

  // S4: Zentraler Tool-Dispatch — 1:1 aus runReActLoop überführt (keine Logikänderung).
  // WRITE-Tools setzen weiterhin context.proposedChanges (Side-Effekte bleiben erhalten).
  private async executeSingleTool(
    context: AgentPipelineContext,
    ai: GoogleGenAI,
    toolName: string,
    rawToolQuery: string | Record<string, unknown> | null
  ): Promise<{ toolName: string; query: string; result: unknown }> {
    let toolQuery = "";
    if (typeof rawToolQuery === "string") {
      toolQuery = rawToolQuery;
    } else if (rawToolQuery !== null && rawToolQuery !== undefined) {
      if (typeof rawToolQuery === "object") {
        const obj = rawToolQuery as Record<string, unknown>;
        if (typeof obj.query === "string") {
          toolQuery = obj.query;
        } else if (typeof obj.search === "string") {
          toolQuery = obj.search;
        } else if (typeof obj.instruction === "string") {
          toolQuery = obj.instruction;
        } else {
          toolQuery = JSON.stringify(rawToolQuery);
        }
      } else {
        toolQuery = String(rawToolQuery);
      }
    }

    context.thoughtLog.push(`Executing tool "${toolName}" with query: "${toolQuery}"`);

    // S8: Governance-Check vor jedem Write-Tool-Call (BLOCK / REQUIRE_APPROVAL / ASK / ALLOW)
    // Befund-3b (2026-08-17): normalisierte MCP-Namen (mcp_<server>_vault_write) auflösen —
    // sonst greift die Governance bei Vault-Writes über den MCP-Pfad nicht.
    let govMapping = WRITE_ACTION_MAP[toolName];
    if (!govMapping) {
      const vkind = vaultToolKind(toolName);
      if (vkind === 'write') {
        const base = vaultWriteBaseName(toolName);
        govMapping = (base && VAULT_WRITE_ACTION_MAP[base]) || { entity: "vault_file", action: "CREATE" };
      }
    }
    if (govMapping) {
      const gov = await evaluateGovernanceRules(context.tenantId, govMapping.entity, govMapping.action);
      if (gov.effect === "BLOCK") {
        await logAuditEvent({ tenantId: context.tenantId, eventType: "GOVERNANCE_BLOCK", entityType: govMapping.entity, eventDetails: `${toolName}: ${gov.note || "Governance-Regel"}`, actorIdentity: context.userId });
        context.thoughtLog.push(`[Governance] BLOCK für ${toolName}: ${gov.note || "blockiert"}`);
        return { toolName, query: toolQuery, result: `Governance-Block: ${gov.note || "Aktion blockiert"}` };
      }
      if (gov.effect === "REQUIRE_APPROVAL") {
        // Entitäten OHNE Approval-Flow (kanban_card): sauber verweigern + Audit.
        // Draft-Entitäten (invoices/companies/contacts/offers/emails): der bestehende Draft-Pfad IST der Approval-Flow → unverändert.
        if (govMapping.entity === "kanban_card") {
          await logAuditEvent({ tenantId: context.tenantId, eventType: "GOVERNANCE_APPROVAL_REQUIRED", entityType: govMapping.entity, eventDetails: `${toolName}: ${gov.note || "Freigabe erforderlich"}`, actorIdentity: context.userId });
          return { toolName, query: toolQuery, result: `Freigabe erforderlich (kein Approval-Flow für kanban_card): ${gov.note || ""}` };
        }
      }
      if (gov.effect === "ASK") {
        // S11-Vorbereitung: ASK → Tool nicht ausführen, Agent soll ask_user_question aufrufen
        await logAuditEvent({ tenantId: context.tenantId, eventType: "GOVERNANCE_ASK", entityType: govMapping.entity, eventDetails: `${toolName}: ${gov.note || "Rückfrage erforderlich"}`, actorIdentity: context.userId });
        return { toolName, query: toolQuery, result: `Rückfrage erforderlich (ASK): ${gov.note || ""} — Rufe ask_user_question auf mit: ${gov.note || "Bitte um Entscheidung"}` };
      }
      // ALLOW → unverändert ausführen
    }

    // S9: Sub-Agent-Domain-Guard (defense in depth — Sub-Kontexte dürfen NUR ihre Domänen-Tools ausführen)
    if (context.allowedDomains && context.allowedDomains.length > 0) {
      const catEntry = SYSTEM_TOOL_CATALOG.find((t) => t.name === toolName);
      if (!catEntry || !context.allowedDomains.includes(catEntry.domain) || SUBAGENT_CORE_EXCLUDED.has(toolName)) {
        return { toolName, query: toolQuery, result: `Unknown tool: ${toolName} (nicht im Sub-Agent-Toolset)` };
      }
    }

    let result: unknown = null;
    if (toolName === "web_search") {
      result = await executeWebSearch(toolQuery, 1, context.tenantId, ai);
    } else if (toolName === "local_knowledge") {
      result = await executeLocalKnowledgeSearch(context.tenantId, toolQuery, ai);
    } else if (toolName === "list_vault_files") {
      result = await executeListVaultFiles(context.tenantId, toolQuery);
    } else if (toolName === "recall_sessions") {
      result = await executeRecallSessions(context.tenantId, toolQuery);
    } else if (toolName === "vault_search") {
      let vQuery = toolQuery;
      let vLimit = 5;
      try {
        const vParsed = JSON.parse(toolQuery) as { query?: string; limit?: number };
        if (vParsed.query) vQuery = vParsed.query;
        if (vParsed.limit) vLimit = vParsed.limit;
      } catch { /* reiner Suchstring */ }
      result = await vaultSearch(context.tenantId, vQuery, vLimit);
    } else if (toolName === "vault_read") {
      try {
        const vParsed = JSON.parse(toolQuery) as { path?: string };
        if (!vParsed.path) throw new Error("path fehlt");
        result = await vaultReadText(context.tenantId, vParsed.path);
      } catch (err) {
        result = `vault_read Fehler: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else if (toolName === "update_memory") {
      result = await this.executeUpdateMemory(context, toolQuery);
    } else if (toolName === "delete_memory_note") {
      result = await this.executeDeleteMemoryNote(context, toolQuery);
    } else if (toolName === "save_skill") {
      result = await this.executeSaveSkill(context, toolQuery);
    } else if (toolName === "update_skill") {
      result = await this.executeUpdateSkill(context, toolQuery);
    } else if (toolName === "delete_skill") {
      result = await this.executeDeleteSkill(context, toolQuery);
    } else if (toolName === "list_companies") {
      result = await executeListCompanies(context.tenantId, toolQuery);
    } else if (toolName === "list_contacts") {
      result = await executeListContacts(context.tenantId, toolQuery);
    } else if (toolName === "list_invoices") {
      result = await executeListInvoices(context.tenantId, toolQuery);
    } else if (toolName === "crm_data_analyst" || toolName === "data_architect") {
      result = await executeCrmDataAnalyst(context.tenantId, toolQuery);
    } else if (toolName === "learn_workflow") {
      result = await executeLearnWorkflow(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "verify_subtask") {
      result = await this.verifySubtask(context, toolQuery);
    } else if (toolName === "ask_user_question") {
      result = await this.askUserQuestion(context, toolQuery);
    } else if (toolName === "delegate_subtask") {
      result = await this.executeDelegation(context, toolQuery);
    } else if (toolName === "get_workflows") {
      result = await getLearnedWorkflows(context.tenantId);
    } else if (toolName === "text_generator") {
      result = await executeTextGenerator(context.tenantId, toolQuery, ai);
    } else if (toolName === "create_invoice_draft") {
      result = await executeCreateDraftInvoice(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          context.proposedChanges = {
            entity_type: "invoices",
            action: "CREATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.invoice || resData) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Rechnungsentwurf angelegt")
          };
        }
      }
    } else if (toolName === "create_company_draft") {
      result = await executeCreateDraftCompany(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          context.proposedChanges = {
            entity_type: "companies",
            action: "CREATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.company || resData) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Unternehmensentwurf angelegt")
          };
        }
      }
    } else if (toolName === "create_contact_draft") {
      result = await executeCreateDraftContact(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          context.proposedChanges = {
            entity_type: "contacts",
            action: "CREATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.contact || resData) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Kontaktentwurf angelegt")
          };
        }
      }
    } else if (toolName === "send_smtp_email") {
      result = await executeSendSmtpEmail(context.tenantId, toolQuery, context.userId, ai);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          const rawObj = (resData.email || resData) as Record<string, unknown>;
          const rec = String(rawObj.recipient_email_address || rawObj.recipient || "").trim();
          const subj = String(rawObj.email_subject_text || rawObj.subject || "").trim();
          const bdy = String(rawObj.email_body_content || rawObj.body || "").trim();
          const invId = rawObj.invoice_id ? String(rawObj.invoice_id).trim() : null;

          context.proposedChanges = {
            entity_type: "emails",
            action: "SEND",
            id_uuid: String(resData.id_uuid || rawObj.id_uuid || ""),
            proposed_state: {
              ...rawObj,
              recipient_email_address: rec,
              email_subject_text: subj,
              email_body_content: bdy,
              recipient: rec,
              subject: subj,
              body: bdy,
              invoice_id: invId
            },
            explanation_rational: String(resData.message || "E-Mail-Entwurf angelegt")
          };
        }
      }
    } else if (toolName === "create_offer_draft") {
      result = await executeCreateDraftOffer(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          context.proposedChanges = {
            entity_type: "offers",
            action: "CREATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.offer || resData) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Angebotsentwurf angelegt")
          };
        }
      }
    } else if (toolName === "finalize_and_send_offer") {
      result = await executeFinalizeAndSendOffer(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "create_note_draft") {
      result = await executeCreateNoteDraft(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData) {
          context.proposedChanges = {
            entity_type: "note",
            action: "CREATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: {
              contact_id_uuid: resData.contact_id_uuid ? String(resData.contact_id_uuid) : null,
              company_id_uuid: resData.company_id_uuid ? String(resData.company_id_uuid) : null,
              note_text: String(resData.note_text || ""),
              priority: String(resData.priority || "normal")
            },
            explanation_rational: String(resData.message || "Notiz-Entwurf angelegt")
          };
        }
      }
    } else if (toolName === "list_kanban_boards") {
      result = await executeListKanbanBoards(context.tenantId, toolQuery);
    } else if (toolName === "get_kanban_board_details") {
      result = await executeGetKanbanBoardDetails(context.tenantId, toolQuery);
    } else if (toolName === "create_kanban_board") {
      // G3 (Auftrag 009)
      result = await executeCreateKanbanBoard(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "create_kanban_card") {
      result = await executeCreateKanbanCard(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "update_kanban_card") {
      result = await executeUpdateKanbanCard(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "move_kanban_card") {
      result = await executeMoveKanbanCard(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "delete_kanban_card") {
      result = await executeDeleteKanbanCard(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "list_notes") {
      // G4 (Auftrag 009)
      result = await executeListNotes(context.tenantId, toolQuery);
    } else if (toolName === "update_note") {
      // G4 (Auftrag 009)
      result = await executeUpdateNote(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "delete_note") {
      // G4 (Auftrag 009)
      result = await executeDeleteNote(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "list_mail_drafts") {
      // G7 (Auftrag 009)
      result = await executeListMailDrafts(context.tenantId, toolQuery);
    } else if (toolName === "get_templates") {
      result = await executeGetTemplates(context.tenantId, toolQuery);
    } else if (toolName === "get_template_details") {
      result = await executeGetTemplateDetails(context.tenantId, toolQuery);
    } else if (toolName === "apply_template") {
      result = await executeApplyTemplate(context.tenantId, toolQuery);
    } else if (toolName === "vault_write" || toolName === "vault_update" || toolName === "vault_delete") {
      // G8 (Auftrag 009): Vault-Vollverwaltung
      if (toolName === "vault_write") result = await executeVaultWrite(context.tenantId, toolQuery, context.userId);
      else if (toolName === "vault_update") result = await executeVaultUpdate(context.tenantId, toolQuery, context.userId);
      else result = await executeVaultDelete(context.tenantId, toolQuery, context.userId);
    } else if (toolName === "update_company_draft") {
      // G2 (Auftrag 009) + B3 (Auftrag 011): Draft-Flow — Update als Vorschlag
      result = await executeUpdateDraftCompany(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData && resData.draft) {
          context.proposedChanges = {
            entity_type: "companies",
            action: "UPDATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.proposed_state || {}) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Unternehmens-Update vorgeschlagen")
          };
        }
      }
    } else if (toolName === "update_contact_draft") {
      // G2 (Auftrag 009) + B3 (Auftrag 011): Draft-Flow — Update als Vorschlag
      result = await executeUpdateDraftContact(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData && resData.draft) {
          context.proposedChanges = {
            entity_type: "contacts",
            action: "UPDATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.proposed_state || {}) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Kontakt-Update vorgeschlagen")
          };
        }
      }
    } else if (toolName === "update_invoice_draft") {
      // G5 (Auftrag 009) + B3 (Auftrag 011): Draft-Flow — Update als Vorschlag
      result = await executeUpdateDraftInvoice(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData && resData.draft) {
          context.proposedChanges = {
            entity_type: "invoices",
            action: "UPDATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.proposed_state || {}) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Rechnungs-Update vorgeschlagen")
          };
        }
      }
    } else if (toolName === "update_offer_draft") {
      // G6 (Auftrag 009) + B3 (Auftrag 011): Draft-Flow — Update als Vorschlag
      result = await executeUpdateDraftOffer(context.tenantId, toolQuery, context.userId);
      if (result && typeof result === "object" && "success" in result && (result as { success: boolean }).success) {
        const resData = (result as { data?: Record<string, unknown> }).data;
        if (resData && resData.draft) {
          context.proposedChanges = {
            entity_type: "offers",
            action: "UPDATE",
            id_uuid: String(resData.id_uuid || ""),
            proposed_state: (resData.proposed_state || {}) as Record<string, unknown>,
            explanation_rational: String(resData.message || "Angebots-Update vorgeschlagen")
          };
        }
      }
    } else if (toolName.startsWith("workflow_")) {
      // S5-Teil A: Workflow-Makro-Ausführung (vor MCP-Fallback)
      result = await executeWorkflowMacro(context.tenantId, toolName, toolQuery);
    } else if (toolName === "parallelToolCalls") {
      // S4-Robustheit: Manche Modelle rufen 'parallelToolCalls' als Tool-Name auf, statt das JSON-Feld zu setzen.
      // Eingebettete Calls parsen, Whitelist-filtern und parallel ausführen (allSettled, Fehler-Envelope).
      let calls: Array<{ toolName: string; toolQuery: string }> = [];
      try {
        const parsed = typeof toolQuery === "string" ? JSON.parse(toolQuery) : toolQuery;
        const rawCalls = Array.isArray(parsed) ? parsed : ((parsed as Record<string, unknown>).calls || (parsed as Record<string, unknown>).parallelToolCalls || []) as Array<Record<string, unknown>>;
        calls = rawCalls.map((c: Record<string, unknown>) => ({
          toolName: String(c.toolName || c.tool || ""),
          toolQuery: typeof c.toolQuery === "string" ? c.toolQuery : (typeof c.query === "string" ? c.query : JSON.stringify(c.query ?? c))
        }));
      } catch {
        calls = [];
      }
      const whitelisted = calls.filter(c => this.READ_TOOL_WHITELIST.has(c.toolName));
      if (whitelisted.length === 0) {
        result = "Unknown tool: parallelToolCalls (keine zulässigen Lese-Tools in der Anfrage)";
      } else {
        context.thoughtLog.push(`[Parallel] Shim: ${whitelisted.length} unabhängige Lese-Tools parallel (allSettled).`);
        const settled = await Promise.allSettled(
          whitelisted.map(c => this.executeSingleTool(context, ai, c.toolName, c.toolQuery))
        );
        result = settled.map((s, i) => {
          const c = whitelisted[i];
          if (s.status === "fulfilled") return `[${c.toolName}] ${truncateResult(s.value.result)}`;
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          return `[${c.toolName}] Tool execution failed: ${msg}`;
        }).join("\n");
      }
    } else {
      // Check if toolName is an MCP discovered tool
      const mcpTool = await McpClientEngine.getToolByNormalizedName(toolName, context.tenantId);
      if (mcpTool) {
        let parsedArgs: Record<string, unknown> = {};
        if (typeof rawToolQuery === "object" && rawToolQuery !== null) {
          parsedArgs = rawToolQuery as Record<string, unknown>;
        } else if (toolQuery && toolQuery.trim().startsWith("{")) {
          try {
            parsedArgs = JSON.parse(toolQuery);
          } catch {
            parsedArgs = { query: toolQuery };
          }
        } else if (toolQuery) {
          parsedArgs = { query: toolQuery };
        }
        const mcpRes = await McpClientEngine.executeTool(
          { tool_id_uuid: mcpTool.id_uuid, arguments: parsedArgs },
          context.tenantId
        );
        result = mcpRes.success ? mcpRes.result : `MCP Error (${mcpRes.server_name}): ${mcpRes.error}`;
      } else {
        result = `Unknown tool: ${toolName}`;
      }
    }

    return { toolName, query: toolQuery, result };
  }

  private appendWebSearchSources(context: AgentPipelineContext): void {
    const searchSources: { title: string; url: string }[] = [];
    const uniqUrls = new Set<string>();

    for (const toolRes of context.toolResults) {
      if (toolRes.toolName === 'web_search' && typeof toolRes.result === 'string') {
        const text = toolRes.result;
        const ddgRegex = /Title:\s*([^\n]+)[\s\S]*?URL:\s*(https?:\/\/[^\s\n]+)/gi;
        let match;
        while ((match = ddgRegex.exec(text)) !== null) {
          const title = match[1].trim();
          const url = match[2].trim();
          if (url && !uniqUrls.has(url)) {
            uniqUrls.add(url);
            searchSources.push({ title, url });
          }
        }
      }
    }

    if (searchSources.length > 0 && context.finalDraftText) {
      const sourcesHeader = context.language === 'de' ? "\n\n### Verwendete Quellen:\n" : "\n\n### Sources used:\n";
      if (!context.finalDraftText.includes(sourcesHeader.trim())) {
        const sourcesList = searchSources.map(s => `- [${s.title}](${s.url})`).join("\n");
        context.finalDraftText = context.finalDraftText.trim() + sourcesHeader + sourcesList;
      }
    }
  }

  private applyValidationFailure(context: AgentPipelineContext, errors: string[]): void {
    const isDe = context.language === 'de';
    const title = isDe 
      ? "⚠️ **Compliance-Validierung (Hinweis):**" 
      : "⚠️ **Compliance Validation Notice:**";
    context.finalDraftText = `${title}\n` + errors.map(e => `- ${e}`).join("\n");
    // Keep proposedChanges intact so user can approve, edit, or reject via UI
  }

  private applyCritiqueFailure(context: AgentPipelineContext, reason: string): void {
    const isDe = context.language === 'de';
    if (!context.finalDraftText || context.finalDraftText.trim() === "") {
      context.finalDraftText = isDe
        ? `E-Mail-Entwurf zur Überprüfung vorbereitet.\nHinweis: ${reason}`
        : `Email draft prepared for review.\nNote: ${reason}`;
    } else {
      context.finalDraftText += isDe ? `\n\n*(Qualitätshinweis: ${reason})*` : `\n\n*(Quality Note: ${reason})*`;
    }
    // Keep proposedChanges intact so approval window is always displayed
  }
}

export const globalAgentRuntime = new AgentRuntime();

// ============================================================================
// Auftrag 008 4A T1-Nachtrag (B1): delegate_subtask als Workflow-Schritt.
// Baut isolierte Sub-Contexts (wie executeDelegation) und führt sie über den
// globalen AgentRuntime-Singleton aus — kontext-agnostisch nutzbar (Workflows).
// Liefert dieselbe Struktur wie executeDelegation (SubTaskResult[] + Verifikation).
// ============================================================================
export async function runSubTasksStandalone(
  tenantId: string,
  userId: string,
  config: TenantAiConfig,
  tasksStr: string,
  language: "de" | "en" = "de"
): Promise<SubTaskResult[]> {
  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(tasksStr);
  } catch {
    rawArgs = { tasks: [] };
  }
  const parsed = SubTaskSpecSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return [{ subtask_id: "invalid", status: "failed", final_text: "", tool_trace: [], error: `Ungültige delegate_subtask-Argumente: ${parsed.error.message}` }];
  }

  const tasks = parsed.data.tasks.slice(0, 3);

  const settled = await Promise.allSettled(tasks.map(async (task) => {
    const dbId = uuidv4();
    // Sub-Task-Status in DB persistieren (bestehender Mechanismus)
    try {
      if (isUsingFallback || !pool) {
        if (!fallbackStore.aiSubtasks) fallbackStore.aiSubtasks = [];
        fallbackStore.aiSubtasks.push({
          id_uuid: dbId, tenant_id: tenantId,
          task_prompt: task.task_prompt, required_tools_json: task.required_tools || [],
          status: "SUCCESS",
          result_json: JSON.parse("{}"),
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_louis_ai_sub_tasks (id_uuid, tenant_id, subtask_id, task_prompt, status, result_json, verification_status)
           VALUES ($1, $2, $3, $4, 'SUCCESS', $5, 'NOT_APPLICABLE')`,
          [dbId, tenantId, task.subtask_id, task.task_prompt, "{}"]
        );
      }
    } catch { /* Persistenz best-effort */ }

    // Auftrag 012 P1-2: optionales Output-Schema auch im Workflow-Pfad (konsistent zu executeDelegation)
    const schema = task.required_output_schema as Record<string, unknown> | undefined;
    const schemaPrompt = schema && Object.keys(schema).length > 0
      ? `\n\nANTWORTFORMAT (strikt): Antworte NUR mit einem validen JSON-Objekt gemäß folgendem Schema. Kein Text davor oder danach.\nSchema: ${JSON.stringify(schema)}\n`
      : "";

    const subContext: AgentPipelineContext = {
      tenantId,
      userId,
      userMessage: task.task_prompt + schemaPrompt,
      language,
      aiConfig: config,
      history: [],
      allowedDomains: ["CORE", "CRM_READ", "KNOWLEDGE"],
      thoughtLog: [],
      toolResults: [],
      currentIteration: 0,
      maxIterations: Math.min(Math.max(task.max_turns ?? 3, 1), 5),
      toolResultTruncateChars: config.tool_result_truncate_chars ?? 2000,
      reactKeepLastResults: config.react_keep_last_results ?? 2,
      reactCompactionFromIteration: config.react_compaction_from_iteration ?? 3,
      earlyExitAfterTools: config.early_exit_after_tools ?? 4,
      lastInjectedToolResults: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      finalDraftText: null,
      proposedChanges: null,
      isComplete: false,
      isFastPath: false,
      isComplex: true,
      temporalAnchor: new Date().toISOString()
    };

    try {
      let subResult = await globalAgentRuntime.executePipeline(subContext);
      let finalText = subResult.finalDraftText || "";
      let retried = false;

      // Auftrag 012 P1-2: Schema-Validierung mit genau 1 Korrekturversuch
      const validation = validateSubtaskOutput(finalText, schema);
      if (!validation.ok && schema) {
        retried = true;
        const retryContext: AgentPipelineContext = { ...subContext, userMessage: `${task.task_prompt}\n\nDeine vorherige Antwort wurde abgelehnt: ${validation.error}\n${schemaPrompt}` };
        subResult = await globalAgentRuntime.executePipeline(retryContext);
        finalText = subResult.finalDraftText || "";
      }

      const toolTrace = subContext.toolResults.map((t) => ({ tool: t.toolName, query: t.query }));
      return {
        subtask_id: task.subtask_id,
        status: "success",
        final_text: finalText,
        tool_trace: toolTrace,
        ...(retried ? { retried: true } : {}),
        verification_status: "NOT_APPLICABLE"
      } as SubTaskResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        subtask_id: task.subtask_id,
        status: "failed",
        final_text: "",
        tool_trace: [],
        error: msg,
        verification_status: "UNVERIFIED"
      } as SubTaskResult;
    }
  }));

  return settled.map((s, i) => {
    const task = tasks[i];
    if (s.status === "fulfilled") return s.value;
    const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
    return { subtask_id: task.subtask_id, status: "failed" as const, final_text: "", tool_trace: [], error: msg };
  });
}
