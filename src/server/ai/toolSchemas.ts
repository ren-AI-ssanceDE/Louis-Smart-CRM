// ============================================================================
// Auftrag 007 Task 1 (5C-A): JSON-Schema-Basis für native Tool-Calls.
// TOOL_PARAMETERS: exakte Parameter-Schemas je Katalog-Tool — spiegeln die
// Erwartung von executeSingleTool (query-String bzw. strukturierte Args, die
// als JSON-String weitergereicht werden). Fehlende Schemas fallen auf
// { type: "object" } zurück (freie Args wie bisher im JSON-Freitext).
// Reine Daten + reine Funktionen — kein any (Regel 4).
// ============================================================================

export type ToolJsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

const stringSchema = { type: "string" as const };
const queryOnly = (description: string): ToolJsonSchema => ({
  type: "object",
  properties: { query: { ...stringSchema, description } },
  required: ["query"],
  additionalProperties: false
});

// ---------------------------------------------------------------------------
// Parameter-Schemas je Tool (Name → Schema). Tools ohne Eintrag nutzen den
// Fallback { type: "object" } in buildNativeTools.
// ---------------------------------------------------------------------------
export const TOOL_PARAMETERS: Record<string, ToolJsonSchema> = {
  // CRM READ — Suchabfrage als query-String
  list_companies: queryOnly("Suchbegriff (Name, Ort, USt-ID) als Freitext, optional mit limit/offset als JSON: { search, limit, offset }"),
  list_contacts: queryOnly("Suchbegriff (Name, E-Mail, Firma) als Freitext, optional mit limit/offset als JSON: { search, limit, offset }"),
  list_invoices: queryOnly("Filter als JSON: { search, limit, offset, payment_status } oder Suchbegriff"),
  crm_data_analyst: queryOnly("Analyse-Auftrag als Freitext (z. B. 'Angebotslage: wie viele angenommen?')"),
  // Auftrag 016 P1-2: Alias sichtbar im Katalog — gleiche Parameter wie crm_data_analyst
  data_architect: queryOnly("Analyse-Auftrag als Freitext (z. B. 'Angebotslage: wie viele angenommen?')"),
  text_generator: queryOnly("Text-/Branding-Auftrag als Freitext"),

  // CRM WRITE
  create_invoice_draft: queryOnly("Rechnungsdaten als JSON: { recipient_company_id_uuid?, recipient_contact_id_uuid?, invoice_number?, invoice_date?, due_date?, items: [{ description, quantity, unit_price_gross, vat_rate_percent }] }"),
  create_company_draft: queryOnly("Firmendaten als JSON: { full_legal_name, vat_id, address_street, address_city, address_zip, address_country_code, email_address, phone_number, iban }"),
  create_contact_draft: queryOnly("Kontaktdaten als JSON: { first_name, last_name, email_address, phone_number, company_id_uuid?, title?, role? }"),
  create_offer_draft: queryOnly("Angebotsdaten als JSON: { company_id_uuid?, contact_id_uuid?, offer_number?, subject?, offer_date?, valid_until?, items: [{ description, quantity, unit_price_gross, vat_rate_percent }] } — offer_number optional: gewünschte Nummer (sonst System-Nummer AG-YYYY-XXXX)"),
  create_note_draft: {
    type: "object",
    properties: {
      contact_id_uuid: { type: "string", description: "Ziel-Kontakt (optional, genau EIN Ziel)" },
      company_id_uuid: { type: "string", description: "Ziel-Firma (optional, genau EIN Ziel)" },
      note_text: { type: "string", description: "Notiztext (Pflicht)" },
      priority: { type: "string", description: "optional: low|medium|high" }
    },
    required: ["note_text"],
    additionalProperties: false
  },
  // G2 (Auftrag 009): Update-Tools
  update_company_draft: queryOnly("Firmen-ID + zu ändernde Felder als JSON: { id_uuid, full_legal_name?, street?, house_number?, postal_code?, city?, email_address?, phone_number?, iban?, bic_swift?, payment_term?, language? }"),
  update_contact_draft: queryOnly("Kontakt-ID + zu ändernde Felder als JSON: { id_uuid, first_name?, last_name?, email_address?, phone_number?, street?, city?, opt_in_marketing?, opt_in_social_media?, opt_in_direct_message?, opt_in_sms?, opt_in_phone? }"),
  // G4 (Auftrag 009): Notizen-Vollverwaltung
  list_notes: queryOnly("Filter als JSON: { entity_type?: 'contact'|'company', entity_id_uuid?, search?, limit? }"),
  update_note: queryOnly("Notiz-ID + Felder als JSON: { id_uuid, note_text?, priority? }"),
  delete_note: queryOnly("Notiz-ID als JSON: { id_uuid }"),
  // G5/G6 (Auftrag 009): Update-Tools für Rechnung + Angebot
  update_invoice_draft: queryOnly("Rechnungs-ID + Felder als JSON: { id_uuid, payment_status?, due_date?, invoice_number?, total_gross_amount?, introductory_text?, closing_text? }"),
  update_offer_draft: queryOnly("Angebots-ID + Felder als JSON: { id_uuid, title?, valid_until?, payment_term?, currency_code?, total_gross_amount? }"),
  // G7 (Auftrag 009): E-Mail-Entwürfe
  list_mail_drafts: queryOnly("Filter als JSON: { status?: 'PENDING'|'APPROVED'|'REJECTED', recipient?, limit? }"),
  finalize_and_send_offer: queryOnly("Angebots-ID als JSON: { offer_id_uuid } oder UUID-String"),
  send_smtp_email: {
    type: "object",
    properties: {
      to: { type: "string", description: "Empfänger-E-Mail-Adresse" },
      subject: { type: "string", description: "Betreff" },
      body: { type: "string", description: "E-Mail-Inhalt" },
      template_name: { type: "string", description: "optional: Vorlagenname" },
      invoice_id_uuid: { type: "string", description: "optional: zugehörige Rechnung" },
      offer_id_uuid: { type: "string", description: "optional: zugehöriges Angebot" }
    },
    required: ["to", "subject", "body"],
    additionalProperties: false
  },

  // KNOWLEDGE / VAULT
  web_search: queryOnly("Suchbegriff (z. B. 'Mehrwertsteuersatz Dänemark 2026')"),
  local_knowledge: queryOnly("Suchbegriff oder Dateiname im Vault"),
  list_vault_files: queryOnly("optional: Filter (Kategorie) oder leerer String"),
  // G8 (Auftrag 009): Vault-Vollverwaltung
  vault_write: queryOnly("Datei-Daten als JSON: { file_name, content, overwrite? } — nur .md/.txt/.json/.csv"),
  vault_update: queryOnly("Datei-Daten als JSON: { file_name, content }"),
  vault_delete: queryOnly("Dateiname als JSON: { file_name }"),
  recall_sessions: queryOnly("Suchbegriff als JSON: { query, limit, offset } oder Freitext"),
  vault_search: queryOnly("Suchbegriff als JSON: { query, limit } oder Freitext"),
  vault_read: queryOnly("Dateipfad als JSON: { path } oder Pfad-String"),
  update_memory: {
    type: "object",
    properties: {
      preference: { type: "string", description: "dauerhafte Präferenz (optional)" },
      note: { type: "string", description: "Notiz über den Nutzer (optional)" }
    },
    additionalProperties: false
  },
  delete_memory_note: {
    type: "object",
    properties: {
      note_id: { type: "string", description: "ID der zu löschenden Notiz" }
    },
    required: ["note_id"],
    additionalProperties: false
  },
  save_skill: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill-Name" },
      description: { type: "string", description: "Beschreibung" },
      content: { type: "string", description: "Skill-Inhalt (Markdown)" },
      category: { type: "string", description: "optional" },
      tags: { type: "array", items: { type: "string" }, description: "optional" }
    },
    required: ["name", "description", "content"],
    additionalProperties: false
  },
  update_skill: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill-Name (Pflicht)" },
      content: { type: "string", description: "neuer Inhalt (optional)" },
      description: { type: "string", description: "neue Beschreibung (optional)" },
      tags: { type: "array", items: { type: "string" }, description: "neue Tags (optional)" },
      category: { type: "string", description: "neue Kategorie (optional)" }
    },
    required: ["name"],
    additionalProperties: false
  },
  delete_skill: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill-Name" }
    },
    required: ["name"],
    additionalProperties: false
  },

  // KANBAN
  list_kanban_boards: queryOnly("optional: leerer String"),
  get_kanban_board_details: queryOnly("Board-ID als JSON: { board_id_uuid } oder UUID-String"),
  create_kanban_board: queryOnly("Board-Daten als JSON: { title, description?, columns?: string[], sample_cards?: string[] }"),
  create_kanban_card: {
    type: "object",
    properties: {
      board_id_uuid: { type: "string", description: "Ziel-Board" },
      column_id_uuid: { type: "string", description: "Ziel-Spalte (optional)" },
      title: { type: "string", description: "Kartentitel" },
      description: { type: "string", description: "optional" }
    },
    required: ["board_id_uuid", "title"],
    additionalProperties: false
  },
  update_kanban_card: {
    type: "object",
    properties: {
      card_id_uuid: { type: "string", description: "Karten-ID" },
      title: { type: "string", description: "optional" },
      description: { type: "string", description: "optional" }
    },
    required: ["card_id_uuid"],
    additionalProperties: false
  },
  move_kanban_card: {
    type: "object",
    properties: {
      card_id_uuid: { type: "string", description: "Karten-ID" },
      target_column_id_uuid: { type: "string", description: "Ziel-Spalte" }
    },
    required: ["card_id_uuid", "target_column_id_uuid"],
    additionalProperties: false
  },
  delete_kanban_card: queryOnly("Karten-ID als JSON: { card_id_uuid } oder UUID-String"),

  // TEMPLATES
  get_templates: queryOnly("Suchbegriff oder Kategorie als JSON: { search, category }"),
  get_template_details: queryOnly("Vorlagenname als JSON: { template_name } oder Name-String"),
  apply_template: queryOnly("Vorlage + Kontext als JSON: { template_name, context: { invoice_number, total_gross, due_date, my_company_name, my_contact_person } }"),

  // WORKFLOWS
  learn_workflow: queryOnly("Workflow-Makro als JSON: { name, description, steps } oder Freitext"),
  get_workflows: queryOnly("optional: leerer String oder Suchbegriff"),
  delegate_subtask: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            subtask_id: { type: "string" },
            task_prompt: { type: "string" },
            required_tools: { type: "array", items: { type: "string" } },
            max_turns: { type: "integer" }
          },
          required: ["subtask_id", "task_prompt"]
        },
        description: "max. 3 parallele Teilaufgaben"
      }
    },
    required: ["tasks"],
    additionalProperties: false
  },
  verify_subtask: queryOnly("Subtask-Status als JSON: { subtask_id, evidence }"),
  ask_user_question: {
    type: "object",
    properties: {
      question: { type: "string", description: "Frage an den Nutzer (Pflicht)" },
      choices: { type: "array", items: { type: "string" }, description: "optional" },
      context: { type: "string", description: "optional" }
    },
    required: ["question"],
    additionalProperties: false
  },

  // Steuer-Tools (nicht im Katalog, werden vom Loop als native Calls ergänzt)
  finalize_response: {
    type: "object",
    properties: {
      finalDraftText: { type: "string", description: "Finale Antwort an den Nutzer (Pflicht)" }
    },
    required: ["finalDraftText"],
    additionalProperties: false
  },
  propose_crm_changes: {
    type: "object",
    properties: {
      entity_type: { type: "string", description: "companies | contacts | invoices | emails | offers | kanban_board | kanban_column | kanban_card" },
      action: { type: "string", description: "CREATE | UPDATE | DELETE | SEND | MOVE" },
      id_uuid: { type: "string", description: "optional" },
      proposed_state: { type: "object", description: "Zieldaten" },
      explanation_rational: { type: "string", description: "Begründung" }
    },
    required: ["entity_type", "action", "proposed_state", "explanation_rational"],
    additionalProperties: false
  }
};

// ---------------------------------------------------------------------------
// Baut das native Tools-Array (OpenAI-/Gemini-Format):
//   [{ type: "function", function: { name, description, parameters } }]
// Deterministisch sortiert nach Namen → stabiler Cache-Prefix (getDeterministicTools).
// ---------------------------------------------------------------------------
export function buildNativeTools(
  catalog: Array<{ name: string; desc?: string }>
): Array<{ type: "function"; function: { name: string; description: string; parameters: ToolJsonSchema } }> {
  return [...catalog]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.desc || t.name,
        parameters: TOOL_PARAMETERS[t.name] || { type: "object" as const }
      }
    }));
}
