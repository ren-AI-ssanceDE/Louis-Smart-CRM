import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue, logAuditEvent } from "../db.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { generateInvoiceFilesOnDisk } from "../pdfHelper.ts";
import { generateZugferdXML, inferProfileFromInvoice } from "../../lib/zugferd.js";
import { McpContext } from "./auth.js";
import { z } from "zod";
import { CompanySchema, ContactSchema, InvoiceSchema, OfferInputSchema, CompanyFullSchema, InvoiceFullSchema } from "../../lib/schemas.js";
import { Company, Contact, Invoice, Offer } from "../../types.js";
import {
  CreateCompanyArgsZodSchema,
  CreateContactArgsZodSchema,
  CreateInvoiceArgsZodSchema,
  CreateOfferArgsZodSchema,
} from "../ai/tools/types.js";
import { executeListCompanies, executeListContacts, executeListInvoices } from "../ai/tools/crm.js";
import {
  executeListNotes, executeCreateNoteDraft, executeUpdateNote, executeDeleteNote,
  executeGetKanbanBoardDetails, executeCreateKanbanBoard, executeUpdateKanbanCard, executeDeleteKanbanCard,
  executeFinalizeAndSendOffer
} from "../ai/tools/crm.js";
import {
  executeListVaultFiles, executeLocalKnowledgeSearch, executeVaultWrite, executeVaultUpdate, executeVaultDelete,
  executeRecallSessions, executeLearnWorkflow
} from "../ai/tools/knowledge.js";
import { executeListMailDrafts, executeApproveMailDraft } from "../ai/tools/messaging.js";
import { executeGetTemplates } from "../ai/tools/templates.js";
import { orchestrator } from "../ai/orchestrator.js";
import { runCouncilDeliberation } from "../council/councilEngine.js";
import crypto from "node:crypto";

/**
 * MCP-Audit-Helper (Entscheidung Produktleitung 2026-08-16): MCP-Write-Aktionen (CREATE/UPDATE/DELETE)
 * MÜSSEN einen Audit-Eintrag erzeugen — MCP schreibt direkt in die DB (kein Draft-Flow),
 * ohne Audit wäre die Änderung unsichtbar und der Auditlog inkonsistent.
 * Lese-Tools (get/list/search) werden bewusst NICHT geloggt.
 */
async function mcpAudit(tenantId: string, eventType: string, entityType: string, entityId: string, details: string): Promise<void> {
  try {
    await logAuditEvent({
      tenantId,
      eventType,
      entityType,
      entityId,
      eventDetails: details,
      actorIdentity: "mcp_client"
    });
  } catch (err) {
    console.error("[MCP] Audit-Logging fehlgeschlagen:", err);
  }
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// -----------------------------------------------------------------------------
// MCP Tools Metadata Catalog
// -----------------------------------------------------------------------------
// Exportiert für den Feldnamen-Abgleich-Test (021-C: Katalog ↔ Agent-Schema).
export const MCP_TOOLS_CATALOG = [
  // 1. Companies & Contacts
  {
    name: "crm_list_companies",
    description: "Abruf und Filterung von Unternehmen aus dem CRM",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Suchbegriff (Name, Ort, USt-ID)" },
        limit: { type: "integer", default: 50 },
        offset: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "crm_get_company",
    description: "Detailansicht eines Unternehmens inklusive verknüpfter Kontakte und Rechnungen",
    inputSchema: {
      type: "object",
      properties: {
        company_id_uuid: { type: "string", description: "UUID des Unternehmens" }
      },
      required: ["company_id_uuid"]
    }
  },
  {
    name: "crm_create_company",
    description: "Neuanlage eines Unternehmens im CRM",
    inputSchema: {
      type: "object",
      properties: {
        full_legal_name: { type: "string", description: "Vollständiger Name der Firma" },
        short_code: { type: "string" },
        tax_vat_id: { type: "string", description: "USt-IdNr." },
        tax_number: { type: "string" },
        email_address: { type: "string" },
        phone_number: { type: "string" },
        street: { type: "string" },
        house_number: { type: "string" },
        postal_code: { type: "string" },
        city: { type: "string" },
        country_code: { type: "string", default: "DE" },
        website: { type: "string" },
        iban: { type: "string" },
        bic_swift: { type: "string" },
        bank_name: { type: "string" }
      },
      required: ["full_legal_name"]
    }
  },
  {
    name: "crm_update_company",
    description: "Aktualisierung der Stammdaten eines Unternehmens",
    inputSchema: {
      type: "object",
      properties: {
        id_uuid: { type: "string", description: "UUID des zu ändernden Unternehmens" },
        full_legal_name: { type: "string" },
        tax_vat_id: { type: "string" },
        email_address: { type: "string" },
        phone_number: { type: "string" },
        street: { type: "string" },
        house_number: { type: "string" },
        postal_code: { type: "string" },
        city: { type: "string" },
        country_code: { type: "string" },
        iban: { type: "string" },
        bic_swift: { type: "string" },
        bank_name: { type: "string" }
      },
      required: ["id_uuid"]
    }
  },
  {
    name: "crm_list_contacts",
    description: "Abruf von Ansprechpartnern / Kontakten aus dem CRM",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Suchbegriff (Vorname, Nachname, E-Mail)" },
        company_id_uuid: { type: "string", description: "Optionale Filterung nach Unternehmen" },
        limit: { type: "integer", default: 50 },
        offset: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "crm_get_contact",
    description: "Detailansicht eines Ansprechpartners / Kontaktes",
    inputSchema: {
      type: "object",
      properties: {
        contact_id_uuid: { type: "string", description: "UUID des Kontaktes" }
      },
      required: ["contact_id_uuid"]
    }
  },
  {
    name: "crm_create_contact",
    description: "Anlegen eines Ansprechpartners",
    inputSchema: {
      type: "object",
      properties: {
        first_name: { type: "string" },
        last_name: { type: "string" },
        email_address: { type: "string" },
        phone_number: { type: "string" },
        associated_company_id: { type: "string", description: "UUID des verknüpften Unternehmens" }
      },
      required: ["last_name"]
    }
  },
  {
    name: "crm_update_contact",
    description: "Bearbeiten eines Ansprechpartners",
    inputSchema: {
      type: "object",
      properties: {
        id_uuid: { type: "string" },
        first_name: { type: "string" },
        last_name: { type: "string" },
        email_address: { type: "string" },
        phone_number: { type: "string" },
        associated_company_id: { type: "string" }
      },
      required: ["id_uuid"]
    }
  },

  // 2. Finanzwesen & e-Invoicing
  {
    name: "crm_list_invoices",
    description: "Abruf aller Rechnungen aus dem CRM",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Suchbegriff (Rechnungsnummer, Empfänger)" },
        payment_status: { type: "string", enum: ["pending", "paid", "overdue", "draft"] },
        limit: { type: "integer", default: 50 },
        offset: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "crm_get_invoice",
    description: "Detailansicht einer Rechnung inklusive Posten und ZUGFeRD-Metadaten",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id_uuid: { type: "string", description: "UUID der Rechnung" }
      },
      required: ["invoice_id_uuid"]
    }
  },
  {
    name: "crm_create_invoice",
    description: "Erstellung einer neuen Rechnung (inklusive automatischer ZUGFeRD PDF/A-3 Generierung)",
    inputSchema: {
      type: "object",
      properties: {
        invoice_number: { type: "string" },
        associated_company_id: { type: "string" },
        associated_contact_id: { type: "string" },
        issue_date: { type: "string", description: "YYYY-MM-DD" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        service_date: { type: "string" },
        payment_term: { type: "string" },
        invoice_line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              vat_rate: { type: "number", default: 19 },
              unit_code: { type: "string", default: "HUR" }
            },
            required: ["description", "quantity", "unit_price"]
          }
        },
        payment_status: { type: "string", enum: ["pending", "paid", "overdue", "draft"], default: "pending" }
      },
      required: ["issue_date", "invoice_line_items"]
    }
  },
  {
    name: "crm_update_invoice_status",
    description: "Statusänderung einer Rechnung (z. B. bezahlt, storniert, entwurf)",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id_uuid: { type: "string" },
        payment_status: { type: "string", enum: ["pending", "paid", "overdue", "draft"] }
      },
      required: ["invoice_id_uuid", "payment_status"]
    }
  },
  {
    name: "crm_generate_invoice_pdf",
    description: "Rendern der PDF/A-3 Rechnung inklusive eingebetteter ZUGFeRD/Factur-X XML",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id_uuid: { type: "string" }
      },
      required: ["invoice_id_uuid"]
    }
  },
  {
    name: "crm_get_zugferd_xml",
    description: "Generierung und Abruf der konformen ZUGFeRD 2.2 / Factur-X XML einer Rechnung",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id_uuid: { type: "string" }
      },
      required: ["invoice_id_uuid"]
    }
  },
  {
    name: "crm_list_offers",
    description: "Abruf aller Angebote",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        limit: { type: "integer", default: 50 },
        offset: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "crm_create_offer",
    description: "Erstellung eines neuen Angebots",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        associated_company_id: { type: "string" },
        associated_contact_id: { type: "string" },
        issue_date: { type: "string" },
        valid_until: { type: "string" },
        line_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              position: { type: "integer" },
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              vat_rate: { type: "number", default: 19 }
            },
            required: ["description", "quantity", "unit_price"]
          }
        }
      },
      required: ["title", "issue_date", "valid_until", "line_items"]
    }
  },

  // 3. Vertiebs-Pipeline (Kanban)
  {
    name: "crm_list_kanban_boards",
    description: "Abruf der Vertiebs-Kanban Boards mit Spalten und Karten",
    inputSchema: {
      type: "object",
      properties: {
        search_term: { type: "string" }
      }
    }
  },
  {
    name: "crm_create_kanban_card",
    description: "Anlegen einer neuen Deal- / Lead-Karte in der Pipeline",
    inputSchema: {
      type: "object",
      properties: {
        board_id_uuid: { type: "string" },
        column_id_uuid: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"], default: "medium" },
        due_date: { type: "string" },
        company_id_uuid: { type: "string" },
        contact_id_uuid: { type: "string" }
      },
      required: ["title"]
    }
  },
  {
    name: "crm_move_kanban_card",
    description: "Verschieben einer Kanban-Karte in eine andere Phase/Spalte",
    inputSchema: {
      type: "object",
      properties: {
        card_id_uuid: { type: "string" },
        target_column_id_uuid: { type: "string" },
        target_column_title: { type: "string" },
        new_position: { type: "integer", default: 0 }
      },
      required: ["card_id_uuid"]
    }
  },

  // 4. Wissensdatenbank (Knowledge Vault)
  {
    name: "crm_list_vault_files",
    description: "Paginierte Auflistung aller Dokumente in der Wissensdatenbank",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optionaler Dateinamensfilter" },
        limit: { type: "integer", default: 20 },
        offset: { type: "integer", default: 0 }
      }
    }
  },
  {
    name: "crm_search_knowledge_vault",
    description: "Semantische Volltextsuche im CRM Knowledge Vault",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchanfrage" },
        top_k: { type: "integer", default: 5 }
      },
      required: ["query"]
    }
  },
  {
    name: "crm_upload_vault_document",
    description: "Hochladen und Speichern eines Dokuments im CRM Vault",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string" },
        content: { type: "string", description: "Textinhalt des Dokuments" }
      },
      required: ["filename", "content"]
    }
  },

  // 5. KI-Assistenz (Louis AI & Council)
  {
    name: "crm_run_louis_ai",
    description: "Ausführung einer komplexen KI-Anfrage über das Louis AI Orchestrator System",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Benutzer-Prompt / Anweisung an Louis AI" },
        session_id: { type: "string", description: "Optionale Session-ID zur Fortführung der Konversation" }
      },
      required: ["prompt"]
    }
  },
  {
    name: "crm_run_council_deliberation",
    description: "Starten einer Multimodell-Ratsberatung (Multi-LLM Deliberation)",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Strategische Fragestellung für das Council" },
        mode: { type: "string", enum: ["multi-role", "multi-model"], default: "multi-role" }
      },
      required: ["prompt"]
    }
  },

  // ===========================================================================
  // 6. BUG-1 (Auftrag 015): Erweiterung — Notizen, Vault, Mails, Kanban, Templates,
  //    Angebote, Sessions, Workflows (wrappen der Agent-Execute-Funktionen)
  // ===========================================================================

  // --- Notizen ---
  {
    name: "notes_list",
    description: "Listet CRM-Notizen (optional gefiltert nach Entität)",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "Optional: companies|contacts|invoices|offers|user" },
        entity_id_uuid: { type: "string", description: "Optional: UUID der Entität" },
        search: { type: "string", description: "Optional: Volltextsuche" },
        limit: { type: "number", default: 20 }
      }
    }
  },
  {
    name: "notes_create",
    description: "Erstellt eine neue CRM-Notiz",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: { type: "string", description: "companies|contacts|invoices|offers|user", enum: ["companies", "contacts", "invoices", "offers", "user"] },
        entity_id_uuid: { type: "string", description: "UUID der Entität (bei entity_type=user leer)" },
        content: { type: "string", description: "Notiztext" },
        priority: { type: "string", enum: ["low", "normal", "high"], default: "normal" }
      },
      required: ["entity_type", "content"]
    }
  },
  {
    name: "notes_update",
    description: "Aktualisiert eine bestehende CRM-Notiz",
    inputSchema: {
      type: "object",
      properties: {
        note_id_uuid: { type: "string", description: "UUID der Notiz" },
        content: { type: "string", description: "Neuer Notiztext" },
        priority: { type: "string", enum: ["low", "normal", "high"] }
      },
      required: ["note_id_uuid"]
    }
  },
  {
    name: "notes_delete",
    description: "Löscht eine CRM-Notiz",
    inputSchema: {
      type: "object",
      properties: {
        note_id_uuid: { type: "string", description: "UUID der Notiz" }
      },
      required: ["note_id_uuid"]
    }
  },

  // --- Vault (Wissensdatenbank) ---
  {
    name: "vault_search",
    description: "Durchsucht den Knowledge Vault (semantische + Volltext-Suche)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchbegriff" },
        limit: { type: "number", default: 5 }
      },
      required: ["query"]
    }
  },
  {
    name: "vault_write",
    description: "Schreibt ein Dokument in den Knowledge Vault",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Dateiname (z. B. notizen.md)" },
        content: { type: "string", description: "Textinhalt" }
      },
      required: ["file_name", "content"]
    }
  },
  {
    name: "vault_update",
    description: "Aktualisiert ein Dokument im Knowledge Vault",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Bestehender Dateiname" },
        content: { type: "string", description: "Neuer Textinhalt" }
      },
      required: ["file_name", "content"]
    }
  },
  {
    name: "vault_delete",
    description: "Löscht ein Dokument aus dem Knowledge Vault",
    inputSchema: {
      type: "object",
      properties: {
        file_name: { type: "string", description: "Dateiname" }
      },
      required: ["file_name"]
    }
  },

  // --- E-Mail / Mailing ---
  {
    name: "mail_list_drafts",
    description: "Listet E-Mail-Entwürfe (Mailing-Drafts)",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "pending_approval", "approved", "sent", "rejected"], description: "Optional: Status-Filter" },
        limit: { type: "number", default: 20 }
      }
    }
  },
  {
    name: "mail_approve_draft",
    description: "Genehmigt einen E-Mail-Entwurf (Freigabe-Flow)",
    inputSchema: {
      type: "object",
      properties: {
        draft_id_uuid: { type: "string", description: "UUID des Entwurfs" }
      },
      required: ["draft_id_uuid"]
    }
  },

  // --- Kanban ---
  {
    name: "kanban_get_board_details",
    description: "Liefert Details eines Kanban-Boards (Spalten + Karten)",
    inputSchema: {
      type: "object",
      properties: {
        board_id_uuid: { type: "string", description: "UUID des Boards" }
      },
      required: ["board_id_uuid"]
    }
  },
  {
    name: "kanban_create_board",
    description: "Erstellt ein neues Kanban-Board",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Board-Titel" },
        color: { type: "string", description: "Optional: Hex-Farbe" },
        columns: { type: "array", items: { type: "string" }, description: "Optional: Spaltennamen" }
      },
      required: ["title"]
    }
  },
  {
    name: "kanban_update_card",
    description: "Aktualisiert eine Kanban-Karte (z. B. Titel, Beschreibung)",
    inputSchema: {
      type: "object",
      properties: {
        card_id_uuid: { type: "string", description: "UUID der Karte" },
        title: { type: "string" },
        description: { type: "string" }
      },
      required: ["card_id_uuid"]
    }
  },
  {
    name: "kanban_delete_card",
    description: "Löscht eine Kanban-Karte",
    inputSchema: {
      type: "object",
      properties: {
        card_id_uuid: { type: "string", description: "UUID der Karte" }
      },
      required: ["card_id_uuid"]
    }
  },

  // --- Templates ---
  {
    name: "templates_list",
    description: "Listet verfügbare Vorlagen (E-Mail, Signatur, Texte, Posten)",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["email", "signature", "text", "item", "all"], default: "all" },
        search: { type: "string" }
      }
    }
  },

  // --- Angebote ---
  {
    name: "offer_finalize_send",
    description: "Finalisiert ein Angebot und erstellt die E-Mail zum Versand",
    inputSchema: {
      type: "object",
      properties: {
        offer_id_uuid: { type: "string", description: "UUID des Angebots" },
        recipient_email: { type: "string", description: "Optional: Empfänger-E-Mail (sonst Standard)" }
      },
      required: ["offer_id_uuid"]
    }
  },

  // --- Sessions / Recall ---
  {
    name: "sessions_recall",
    description: "Durchsucht vergangene Chat-Sessions (Kontext-Recall)",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Suchbegriff" },
        limit: { type: "number", default: 3 }
      },
      required: ["query"]
    }
  },

  // --- Workflows ---
  {
    name: "workflows_learn",
    description: "Speichert eine Abfolge als wiederverwendbaren Workflow (Learn)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workflow-Name" },
        description: { type: "string" },
        tool_chain_sequence: { type: "array", items: { type: "object" }, description: "Tool-Schritte" }
      },
      required: ["name", "tool_chain_sequence"]
    }
  }
];

// -----------------------------------------------------------------------------
// MCP Prompts & Resources Metadata Catalog
// -----------------------------------------------------------------------------
const MCP_PROMPTS_CATALOG = [
  {
    name: "kundengespraech_zusammenfassen",
    description: "Fasst Notizen eines Kundengesprächs zusammen und erstellt Action Items",
    arguments: [
      { name: "gespraechs_notizen", description: "Unstrukturierte Gesprächsnotizen", required: true }
    ]
  },
  {
    name: "mahnung_generieren",
    description: "Generiert einen höflichen oder bestimmten Mahnungstext für eine überfällige Rechnung",
    arguments: [
      { name: "rechnungs_nummer", description: "Nummer der überfälligen Rechnung", required: true },
      { name: "mahnstufe", description: "1 (Zahlungserinnerung), 2 (Mahnung), 3 (Letzte Mahnung)", required: false }
    ]
  },
  {
    name: "angebot_analysieren",
    description: "Analysiert ein erstelltes Angebot auf Vollständigkeit und Marge",
    arguments: [
      { name: "angebot_id", description: "UUID des Angebots", required: true }
    ]
  }
];

const MCP_RESOURCES_CATALOG = [
  {
    uri: "crm://companies",
    name: "CRM Unternehmensregister",
    description: "Liste aller aktiven Unternehmen im CRM",
    mimeType: "application/json"
  },
  {
    uri: "crm://contacts",
    name: "CRM Ansprechpartner",
    description: "Liste aller Kontakte / Ansprechpartner",
    mimeType: "application/json"
  },
  {
    uri: "crm://invoices",
    name: "CRM Rechnungsjournal",
    description: "Übersicht aller gebuchten Rechnungen",
    mimeType: "application/json"
  },
  {
    uri: "crm://vault/files",
    name: "CRM Knowledge Vault Dokumente",
    description: "Liste aller in der Wissensdatenbank gespeicherten Dokumente",
    mimeType: "application/json"
  }
];

const ALLOWED_COMPANY_UPDATE_COLUMNS = new Set([
  "full_legal_name",
  "short_code",
  "tax_vat_id",
  "tax_number",
  "email_address",
  "phone_number",
  "street",
  "house_number",
  "postal_code",
  "city",
  "country_code",
  "website",
  "iban",
  "bic_swift",
  "bank_name"
]);

const ALLOWED_CONTACT_UPDATE_COLUMNS = new Set([
  "first_name",
  "last_name",
  "full_legal_name",
  "email_address",
  "phone_number",
  "associated_company_id",
  "language",
  "opt_in_marketing",
  "opt_in_social_media",
  "opt_in_direct_message",
  "opt_in_sms",
  "opt_in_phone"
]);

function checkMcpToolScope(name: string, ctx: McpContext): void {
  const scopes = (ctx?.keyInfo?.scopes || []) as string[];
  const hasScope = (s: string) => scopes.includes(s) || scopes.includes("admin") || scopes.includes("full_access");

  const isReadTool = name.startsWith("crm_list_") || name.startsWith("crm_get_") || name.startsWith("crm_search_")
    // BUG-1 (Auftrag 015): neue Tool-Familien — Lese-Tools
    || name.startsWith("notes_list") || name.startsWith("vault_search") || name.startsWith("mail_list")
    || name.startsWith("kanban_get_") || name.startsWith("templates_list") || name.startsWith("sessions_");
  const isWriteTool = name.startsWith("crm_create_") || name.startsWith("crm_update_") || name.startsWith("crm_move_") || name.startsWith("crm_upload_") || name.startsWith("crm_generate_") || name.startsWith("crm_run_")
    // BUG-1 (Auftrag 015): neue Tool-Familien — Schreib-Tools
    || name.startsWith("notes_create") || name.startsWith("notes_update") || name.startsWith("notes_delete")
    || name.startsWith("vault_write") || name.startsWith("vault_update") || name.startsWith("vault_delete")
    || name.startsWith("mail_approve") || name.startsWith("kanban_create_") || name.startsWith("kanban_update_") || name.startsWith("kanban_delete_")
    || name.startsWith("offer_finalize") || name.startsWith("workflows_learn");

  if (isReadTool) {
    if (!hasScope("read") && !hasScope("write")) {
      throw new Error(`Insufficient permissions: Scope 'read' required for tool '${name}'.`);
    }
  } else if (isWriteTool) {
    if (!hasScope("write")) {
      throw new Error(`Insufficient permissions: Scope 'write' or 'admin' required for tool '${name}'.`);
    }
  }
}

// -----------------------------------------------------------------------------
// Tool Execution Router
// -----------------------------------------------------------------------------
async function executeMcpTool(name: string, args: Record<string, unknown>, ctx: McpContext): Promise<unknown> {
  checkMcpToolScope(name, ctx);
  const tenantId = ctx.tenantId || "1";

  switch (name) {
    // --- COMPANIES ---
    case "crm_list_companies": {
      const res = await executeListCompanies(tenantId, JSON.stringify(args));
      if (!res.data) throw new Error(res.error || "Fehler beim Abrufen der Unternehmen");
      return res.data;
    }

    case "crm_get_company": {
      const companyId = (args.company_id_uuid || args.company_id || args.id_uuid || args.id) as string;
      if (!companyId) throw new Error("company_id_uuid is required");
      if (isUsingFallback) {
        const company = fallbackStore.companies.find((c) => c.id_uuid === companyId);
        if (!company) throw new Error(`Company ${companyId} not found`);
        const contacts = fallbackStore.contacts.filter((ct) => ct.associated_company_id === companyId);
        const invoices = fallbackStore.invoices.filter((inv) => inv.associated_company_id === companyId);
        return { company, contacts, invoices };
      } else {
        const cRes = await pool.query(
          `SELECT * FROM core_registry_companies WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [companyId, tenantId]
        );
        if (cRes.rows.length === 0) throw new Error(`Company ${companyId} not found`);
        const company = cleanLigatureHacksFromValue(cleanDbRow(cRes.rows[0]));

        const ctRes = await pool.query(
          `SELECT * FROM core_registry_contacts WHERE associated_company_id = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [companyId, tenantId]
        );
        const invRes = await pool.query(
          `SELECT * FROM fiscal_billing_invoices WHERE associated_company_id = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [companyId, tenantId]
        );

        return {
          company,
          contacts: ctRes.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r))),
          invoices: invRes.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r))),
        };
      }
    }

    case "crm_create_company": {
      const parsed = CreateCompanyArgsZodSchema.parse(args);
      const idUuid = uuidv4();
      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        full_legal_name: parsed.full_legal_name,
        short_code: parsed.short_code || null,
        tax_vat_id: parsed.tax_vat_id || null,
        tax_number: parsed.tax_number || null,
        email_address: parsed.email_address || null,
        phone_number: parsed.phone_number || null,
        street: parsed.street || null,
        house_number: parsed.house_number || null,
        postal_code: parsed.postal_code || null,
        city: parsed.city || null,
        country_code: parsed.country_code || "DE",
        website: parsed.website || null,
        iban: parsed.iban || null,
        bic_swift: parsed.bic_swift || null,
        bank_name: null,
        created_by_identity: "ai_assistant" as const,
        ai_confidence_score: 1.0,
        is_verified_by_human: true,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        fallbackStore.companies.push(payload as unknown as z.infer<typeof CompanyFullSchema>);
        saveFallbackStore();
      } else {
        // BUG-6 (Auftrag 015): Spalte bank_name existiert NICHT in der DB (Schema-Drift) — aus INSERT entfernt
        await pool.query(
          `INSERT INTO core_registry_companies (
            id_uuid, tenant_id, full_legal_name, short_code, tax_vat_id, tax_number,
            email_address, phone_number, street, house_number, postal_code, city, country_code,
            website, iban, bic_swift, created_by_identity, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'ai_assistant', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            idUuid,
            tenantId,
            payload.full_legal_name,
            payload.short_code,
            payload.tax_vat_id,
            payload.tax_number,
            payload.email_address,
            payload.phone_number,
            payload.street,
            payload.house_number,
            payload.postal_code,
            payload.city,
            payload.country_code,
            payload.website,
            payload.iban,
            payload.bic_swift,
          ]
        );
      }

      workflowEventBus.emitEvent(tenantId, "company.created", payload);
      await mcpAudit(tenantId, "CREATE", "COMPANY", idUuid, `MCP: Unternehmen angelegt: ${payload.full_legal_name} (${payload.short_code || "kein Kürzel"})`);
      return payload;
    }

    case "crm_update_company": {
      const idUuid = (args.id_uuid || args.id || args.company_id_uuid) as string;
      if (!idUuid) throw new Error("id_uuid or id is required");
      if (isUsingFallback) {
        const company = fallbackStore.companies.find((c) => c.id_uuid === idUuid);
        if (!company) throw new Error(`Company ${idUuid} not found`);
        Object.assign(company, args, { updated_at_utc: new Date().toISOString() });
        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, "company.updated", company);
        await mcpAudit(tenantId, "UPDATE", "COMPANY", idUuid, `MCP: Unternehmen aktualisiert: ${company.full_legal_name} (Felder: ${Object.keys(args).filter((k) => ALLOWED_COMPANY_UPDATE_COLUMNS.has(k)).join(", ") || "keine"})`);
        return company;
      } else {
        const keys = Object.keys(args).filter((k) => ALLOWED_COMPANY_UPDATE_COLUMNS.has(k));
        if (keys.length === 0) throw new Error("No valid fields to update");
        const setSql = keys.map((k, idx) => `${k} = $${idx + 3}`).join(", ");
        const values = keys.map((k) => args[k]);
        const res = await pool.query(
          `UPDATE core_registry_companies SET ${setSql}, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1')) RETURNING *`,
          [idUuid, tenantId, ...values]
        );
        if (res.rows.length === 0) throw new Error(`Company ${idUuid} not found`);
        const updated = cleanLigatureHacksFromValue(cleanDbRow(res.rows[0]));
        workflowEventBus.emitEvent(tenantId, "company.updated", updated);
        await mcpAudit(tenantId, "UPDATE", "COMPANY", idUuid, `MCP: Unternehmen aktualisiert: ${updated.full_legal_name} (Felder: ${keys.join(", ")})`);
        return updated;
      }
    }

    // --- CONTACTS ---
    case "crm_list_contacts": {
      const res = await executeListContacts(tenantId, JSON.stringify(args));
      if (!res.data) throw new Error(res.error || "Fehler beim Abrufen der Kontakte");
      return res.data;
    }

    case "crm_get_contact": {
      const contactId = (args.contact_id_uuid || args.contact_id || args.id_uuid || args.id) as string;
      if (!contactId) throw new Error("contact_id_uuid is required");
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find((c) => c.id_uuid === contactId);
        if (!contact) throw new Error(`Contact ${contactId} not found`);
        const company = contact.associated_company_id
          ? fallbackStore.companies.find((co) => co.id_uuid === contact.associated_company_id)
          : null;
        return { contact, company };
      } else {
        const ctRes = await pool.query(
          `SELECT * FROM core_registry_contacts WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [contactId, tenantId]
        );
        if (ctRes.rows.length === 0) throw new Error(`Contact ${contactId} not found`);
        const contact = cleanLigatureHacksFromValue(cleanDbRow(ctRes.rows[0])) as { associated_company_id?: string };

        let company = null;
        if (contact.associated_company_id) {
          const cRes = await pool.query(
            `SELECT * FROM core_registry_companies WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
            [contact.associated_company_id, tenantId]
          );
          if (cRes.rows.length > 0) {
            company = cleanLigatureHacksFromValue(cleanDbRow(cRes.rows[0]));
          }
        }
        return { contact, company };
      }
    }

    case "crm_create_contact": {
      const parsed = CreateContactArgsZodSchema.parse(args);
      const idUuid = uuidv4();
      // BUG-7 (Auftrag 015): full_legal_name ist DB-NOT-NULL — aus first/last_name zusammensetzen (wie Agent)
      const fullLegalName = [parsed.first_name, parsed.last_name].filter(Boolean).join(" ").trim() || parsed.last_name || "Unbekannter Kontakt";
      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        full_legal_name: fullLegalName,
        first_name: parsed.first_name || null,
        last_name: parsed.last_name,
        email_address: parsed.email_address || null,
        phone_number: parsed.phone_number || null,
        associated_company_id: parsed.company_id || parsed.associated_company_id || null,
        language: parsed.language || "de",
        labels: [],
        opt_in_marketing: false,
        opt_in_social_media: false,
        opt_in_direct_message: false,
        opt_in_sms: false,
        opt_in_phone: false,
        created_by_identity: "ai_assistant" as const,
        ai_confidence_score: 1.0,
        is_verified_by_human: true,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        fallbackStore.contacts.push(payload);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO core_registry_contacts (
            id_uuid, tenant_id, full_legal_name, first_name, last_name, email_address, phone_number,
            associated_company_id, created_by_identity, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai_assistant', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            idUuid,
            tenantId,
            payload.full_legal_name,
            payload.first_name,
            payload.last_name,
            payload.email_address,
            payload.phone_number,
            payload.associated_company_id,
          ]
        );
      }

      workflowEventBus.emitEvent(tenantId, "contact.created", payload);
      await mcpAudit(tenantId, "CREATE", "CONTACT", idUuid, `MCP: Kontakt angelegt: ${fullLegalName} (${payload.email_address || "keine E-Mail"})`);
      return payload;
    }

    case "crm_update_contact": {
      const idUuid = (args.id_uuid || args.id || args.contact_id_uuid) as string;
      if (!idUuid) throw new Error("id_uuid is required");
      if (isUsingFallback) {
        const contact = fallbackStore.contacts.find((c) => c.id_uuid === idUuid);
        if (!contact) throw new Error(`Contact ${idUuid} not found`);
        Object.assign(contact, args, { updated_at_utc: new Date().toISOString() });
        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, "contact.updated", contact);
        await mcpAudit(tenantId, "UPDATE", "CONTACT", idUuid, `MCP: Kontakt aktualisiert: ${contact.full_legal_name} (Felder: ${Object.keys(args).filter((k) => ALLOWED_CONTACT_UPDATE_COLUMNS.has(k)).join(", ") || "keine"})`);
        return contact;
      } else {
        const keys = Object.keys(args).filter((k) => ALLOWED_CONTACT_UPDATE_COLUMNS.has(k));
        if (keys.length === 0) throw new Error("No valid fields to update");
        const setSql = keys.map((k, idx) => `${k} = $${idx + 3}`).join(", ");
        const values = keys.map((k) => args[k]);
        const res = await pool.query(
          `UPDATE core_registry_contacts SET ${setSql}, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1')) RETURNING *`,
          [idUuid, tenantId, ...values]
        );
        if (res.rows.length === 0) throw new Error(`Contact ${idUuid} not found`);
        const updated = cleanLigatureHacksFromValue(cleanDbRow(res.rows[0]));
        workflowEventBus.emitEvent(tenantId, "contact.updated", updated);
        await mcpAudit(tenantId, "UPDATE", "CONTACT", idUuid, `MCP: Kontakt aktualisiert: ${updated.full_legal_name} (Felder: ${keys.join(", ")})`);
        return updated;
      }
    }

    // --- INVOICES ---
    case "crm_list_invoices": {
      const res = await executeListInvoices(tenantId, JSON.stringify(args));
      if (!res.data) throw new Error(res.error || "Fehler beim Abrufen der Rechnungen");
      return res.data;
    }

    case "crm_get_invoice": {
      const invoiceId = (args.invoice_id_uuid || args.invoice_id || args.id_uuid || args.id) as string;
      if (!invoiceId) throw new Error("invoice_id_uuid is required");
      if (isUsingFallback) {
        const invoice = fallbackStore.invoices.find((i) => i.id_uuid === invoiceId);
        if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
        return invoice;
      } else {
        const res = await pool.query(
          `SELECT * FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [invoiceId, tenantId]
        );
        if (res.rows.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
        return cleanLigatureHacksFromValue(cleanDbRow(res.rows[0]));
      }
    }

    case "crm_create_invoice": {
      const parsed = CreateInvoiceArgsZodSchema.parse(args);
      const idUuid = uuidv4();
      const lineItems = (parsed.items_list || []).map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate ?? 19,
        unit_code: item.unit_code || "HUR",
      }));

      let totalNet = 0;
      let totalVat = 0;

      const itemsWithTotals = lineItems.map((item) => {
        const vatRate = item.vat_rate ?? 19;
        const itemNet = item.quantity * item.unit_price;
        const itemVat = itemNet * (vatRate / 100);
        totalNet += itemNet;
        totalVat += itemVat;
        return {
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          vat_rate: vatRate,
          total_net: itemNet,
          unit_code: item.unit_code || "HUR",
        };
      });

      const totalGross = totalNet + totalVat;
      const invoiceNumber = parsed.invoice_number || `INV-${Date.now().toString().slice(-6)}`;

      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        invoice_number: invoiceNumber,
        associated_company_id: parsed.company_id || null,
        associated_contact_id: parsed.contact_id || null,
        issue_date: parsed.issue_date || new Date().toISOString().split("T")[0],
        due_date: parsed.due_date || null,
        service_date: parsed.service_date || null,
        payment_term: parsed.payment_term || null,
        is_vat_inclusive: false,
        total_net_amount: Math.round(totalNet * 100) / 100,
        total_vat_amount: Math.round(totalVat * 100) / 100,
        total_gross_amount: Math.round(totalGross * 100) / 100,
        vat_rate: 19,
        currency_code: "EUR",
        invoice_line_items: itemsWithTotals,
        payment_status: (parsed.payment_status || "pending") as "pending" | "paid" | "overdue" | "draft",
        created_by_identity: "ai_assistant" as const,
        ai_confidence_score: 1.0,
        is_verified_by_human: true,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        fallbackStore.invoices.push(payload as unknown as z.infer<typeof InvoiceFullSchema>);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO fiscal_billing_invoices (
            id_uuid, tenant_id, invoice_number, associated_company_id, associated_contact_id,
            issue_date, due_date, service_date, payment_term, total_net_amount, total_vat_amount,
            total_gross_amount, invoice_line_items_json, payment_status, created_by_identity,
            created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'ai_assistant', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            idUuid,
            tenantId,
            payload.invoice_number,
            payload.associated_company_id,
            payload.associated_contact_id,
            payload.issue_date,
            payload.due_date,
            payload.service_date,
            payload.payment_term,
            payload.total_net_amount,
            payload.total_vat_amount,
            payload.total_gross_amount,
            JSON.stringify(payload.invoice_line_items),
            payload.payment_status,
          ]
        );
      }

      // Async generate PDF & ZUGFeRD XML files
      generateInvoiceFilesOnDisk(idUuid, tenantId).catch((err) =>
        console.warn("[MCP Tool] Background invoice PDF rendering error:", err)
      );

      workflowEventBus.emitEvent(tenantId, "invoice.created", payload);
      await mcpAudit(tenantId, "CREATE", "INVOICE", idUuid, `MCP: Rechnung angelegt: ${invoiceNumber} (Netto ${payload.total_net_amount} EUR, Status ${payload.payment_status})`);
      return payload;
    }

    case "crm_update_invoice_status": {
      const invoiceId = (args.invoice_id_uuid || args.invoice_id || args.id_uuid || args.id) as string;
      const status = (args.payment_status || args.status) as string;
      if (!invoiceId) throw new Error("invoice_id_uuid is required");

      if (isUsingFallback) {
        const invoice = fallbackStore.invoices.find((i) => i.id_uuid === invoiceId);
        if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
        const oldStatus = invoice.payment_status;
        invoice.payment_status = status as "draft" | "issued" | "paid" | "cancelled" | "overdue";
        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, "invoice.status_changed", invoice);
        await mcpAudit(tenantId, "UPDATE", "INVOICE", invoiceId, `MCP: Rechnungsstatus geändert: ${oldStatus} → ${status} (${invoice.invoice_number || invoiceId})`);
        return invoice;
      } else {
        const sel = await pool.query(
          `SELECT invoice_number, payment_status FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [invoiceId, tenantId]
        );
        if (sel.rows.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
        const oldStatus = sel.rows[0].payment_status;
        const invoiceNumber = sel.rows[0].invoice_number;
        const res = await pool.query(
          `UPDATE fiscal_billing_invoices SET payment_status = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 AND (tenant_id = $3 OR (tenant_id = '1' AND $3 = '1')) RETURNING *`,
          [status, invoiceId, tenantId]
        );
        if (res.rows.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
        const updated = cleanLigatureHacksFromValue(cleanDbRow(res.rows[0]));
        workflowEventBus.emitEvent(tenantId, "invoice.status_changed", updated);
        await mcpAudit(tenantId, "UPDATE", "INVOICE", invoiceId, `MCP: Rechnungsstatus geändert: ${oldStatus} → ${status} (${invoiceNumber || invoiceId})`);
        return updated;
      }
    }

    case "crm_generate_invoice_pdf": {
      const invoiceId = (args.invoice_id_uuid || args.invoice_id || args.id_uuid || args.id) as string;
      if (!invoiceId) throw new Error("invoice_id_uuid is required");
      await generateInvoiceFilesOnDisk(invoiceId, tenantId);
      return { success: true, message: `PDF and ZUGFeRD XML generated for invoice ${invoiceId}` };
    }

    case "crm_get_zugferd_xml": {
      const invoiceId = (args.invoice_id_uuid || args.invoice_id || args.id_uuid || args.id) as string;
      if (!invoiceId) throw new Error("invoice_id_uuid is required");
      let invoiceObj: Invoice | Record<string, unknown> | null = null;
      let myCompany: Record<string, unknown> | null = null;

      if (isUsingFallback) {
        invoiceObj = fallbackStore.invoices.find((i) => i.id_uuid === invoiceId);
        myCompany = fallbackStore.myCompany;
      } else {
        const iRes = await pool.query(
          `SELECT * FROM fiscal_billing_invoices WHERE id_uuid = $1 AND (tenant_id = $2 OR (tenant_id = '1' AND $2 = '1'))`,
          [invoiceId, tenantId]
        );
        if (iRes.rows.length > 0) invoiceObj = cleanDbRow(iRes.rows[0]);
        const mcRes = await pool.query(
          `SELECT * FROM core_registry_my_company WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1') LIMIT 1`,
          [tenantId]
        );
        if (mcRes.rows.length > 0) myCompany = cleanDbRow(mcRes.rows[0]);
      }

      if (!invoiceObj) throw new Error(`Invoice ${invoiceId} not found`);

      const profile = inferProfileFromInvoice(invoiceObj);
      const xml = generateZugferdXML(invoiceObj as unknown as Invoice, myCompany, profile);
      return { invoice_id_uuid: invoiceId, xml_profile: profile, zugferd_xml: xml };
    }

    // --- OFFERS ---
    case "crm_list_offers": {
      const limit = Number(args.limit) || 50;
      const offset = Number(args.offset) || 0;

      if (isUsingFallback) {
        const list = (fallbackStore.offers || []).filter(
          (o) => o.tenant_id === tenantId || o.tenant_id === "1"
        );
        return list.slice(offset, offset + limit);
      } else {
        const res = await pool.query(
          `SELECT * FROM core_registry_offers WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1') ORDER BY created_at_utc DESC LIMIT $2 OFFSET $3`,
          [tenantId, limit, offset]
        );
        return res.rows.map((r) => cleanLigatureHacksFromValue(cleanDbRow(r)));
      }
    }

    case "crm_create_offer": {
      const parsed = CreateOfferArgsZodSchema.parse(args);
      const idUuid = uuidv4();
      const lineItems = (parsed.line_items || []).map((item) => ({
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate ?? 19,
      }));

      let totalNet = 0;
      let totalGross = 0;

      const itemsWithTotals = lineItems.map((item, idx) => {
        const pos = item.position ?? idx + 1;
        const vatRate = item.vat_rate ?? 19;
        const net = item.quantity * item.unit_price;
        const gross = net * (1 + vatRate / 100);
        totalNet += net;
        totalGross += gross;
        return {
          id_uuid: uuidv4(),
          position: pos,
          description: item.description,
          quantity: item.quantity,
          unit_code: "PCE",
          unit_price: item.unit_price,
          vat_rate: vatRate,
          total_net: Math.round(net * 100) / 100,
          total_gross: Math.round(gross * 100) / 100,
        };
      });

      const offerNumber = `OFF-${Date.now().toString().slice(-6)}`;
      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        offer_number: offerNumber,
        title: parsed.title,
        associated_company_id: parsed.company_id || null,
        associated_contact_id: parsed.contact_id || null,
        issue_date: parsed.issue_date || new Date().toISOString().split("T")[0],
        valid_until: parsed.valid_until || new Date().toISOString().split("T")[0],
        line_items: itemsWithTotals,
        total_net_amount: Math.round(totalNet * 100) / 100,
        total_vat_amount: Math.round((totalGross - totalNet) * 100) / 100,
        total_gross_amount: Math.round(totalGross * 100) / 100,
        offer_status: "not_sent" as const,
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        if (!fallbackStore.offers) fallbackStore.offers = [];
        fallbackStore.offers.push(payload as unknown as Offer);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO core_registry_offers (
            id_uuid, tenant_id, offer_number, title, associated_company_id, associated_contact_id,
            issue_date, valid_until, line_items_json, total_net_amount, total_vat_amount, total_gross_amount,
            offer_status, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            idUuid,
            tenantId,
            offerNumber,
            payload.title,
            payload.associated_company_id,
            payload.associated_contact_id,
            payload.issue_date,
            payload.valid_until,
            JSON.stringify(payload.line_items),
            payload.total_net_amount,
            payload.total_vat_amount,
            payload.total_gross_amount,
            payload.offer_status,
          ]
        );
      }

      workflowEventBus.emitEvent(tenantId, "offer.created", payload);
      await mcpAudit(tenantId, "CREATE", "OFFER", idUuid, `MCP: Angebot angelegt: ${offerNumber} (${payload.title}, Netto ${payload.total_net_amount} EUR)`);
      return payload;
    }

    // --- KANBAN ---
    case "crm_list_kanban_boards": {
      if (isUsingFallback) {
        const boards = (fallbackStore.kanbanBoards || []).filter((b) => b.tenant_id === tenantId || b.tenant_id === "1");
        const columns = (fallbackStore.kanbanColumns || []).filter((c) => c.tenant_id === tenantId || c.tenant_id === "1");
        const cards = (fallbackStore.kanbanCards || []).filter((cd) => cd.tenant_id === tenantId || cd.tenant_id === "1");

        return boards.map((b) => {
          const bCols = columns.filter((col) => col.board_id === b.id_uuid);
          return {
            ...b,
            columns: bCols.map((col) => ({
              ...col,
              cards: cards.filter((card) => card.column_id === col.id_uuid),
            })),
          };
        });
      } else {
        const bRes = await pool.query(`SELECT * FROM kanban_boards WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1')`, [tenantId]);
        const cRes = await pool.query(`SELECT * FROM kanban_columns WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1') ORDER BY position ASC`, [tenantId]);
        const cdRes = await pool.query(`SELECT * FROM kanban_cards WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1') ORDER BY position ASC`, [tenantId]);

        const boards = bRes.rows.map((r) => cleanDbRow(r));
        const columns = cRes.rows.map((r) => cleanDbRow(r));
        const cards = cdRes.rows.map((r) => cleanDbRow(r));

        return boards.map((b) => {
          const bCols = columns.filter((col) => col.board_id === b.id_uuid);
          return {
            ...b,
            columns: bCols.map((col) => ({
              ...col,
              cards: cards.filter((card) => card.column_id === col.id_uuid),
            })),
          };
        });
      }
    }

    case "crm_create_kanban_card": {
      const idUuid = uuidv4();
      let boardId = args.board_id_uuid as string | undefined;
      let columnId = args.column_id_uuid as string | undefined;

      if (!boardId || !columnId) {
        // Resolve default board / first column
        if (isUsingFallback) {
          const b = fallbackStore.kanbanBoards?.[0];
          boardId = b?.id_uuid || uuidv4();
          const col = fallbackStore.kanbanColumns?.find((c) => c.board_id === boardId);
          columnId = col?.id_uuid || uuidv4();
        } else {
          const bRes = await pool.query(`SELECT id_uuid FROM kanban_boards WHERE tenant_id = $1 OR (tenant_id = '1' AND $1 = '1') LIMIT 1`, [tenantId]);
          boardId = bRes.rows[0]?.id_uuid;
          if (boardId) {
            const cRes = await pool.query(`SELECT id_uuid FROM kanban_columns WHERE board_id = $1 LIMIT 1`, [boardId]);
            columnId = cRes.rows[0]?.id_uuid;
          }
        }
      }

      if (!boardId || !columnId) throw new Error("Could not find a valid Kanban board or column");

      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        board_id: boardId,
        column_id: columnId,
        title: args.title as string,
        description: (args.description as string) || null,
        priority: ((args.priority as string) || "medium") as "low" | "medium" | "high" | "urgent",
        position: 0,
        due_date: (args.due_date as string) || null,
        assigned_user: "AI Assistant",
        company_id_uuid: (args.company_id_uuid as string) || null,
        contact_id_uuid: (args.contact_id_uuid as string) || null,
        labels: [],
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
        fallbackStore.kanbanCards.push(payload as unknown as (typeof fallbackStore.kanbanCards)[number]);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO kanban_cards (
            id_uuid, tenant_id, board_id, column_id, title, description, priority, position,
            due_date, assigned_user, company_id_uuid, contact_id_uuid, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            idUuid,
            tenantId,
            boardId,
            columnId,
            payload.title,
            payload.description,
            payload.priority,
            payload.position,
            payload.due_date,
            payload.assigned_user,
            payload.company_id_uuid,
            payload.contact_id_uuid,
          ]
        );
      }

      workflowEventBus.emitEvent(tenantId, "kanban.card_created", payload);
      await mcpAudit(tenantId, "CREATE", "KANBAN_CARD", idUuid, `MCP: Kanban-Karte angelegt: ${payload.title} (Board ${boardId}, Priorität ${payload.priority})`);
      return payload;
    }

    case "crm_move_kanban_card": {
      const cardId = args.card_id_uuid as string;
      const targetColumnId = args.target_column_id_uuid as string;
      const newPos = Number(args.new_position) || 0;

      if (isUsingFallback) {
        const card = fallbackStore.kanbanCards?.find((c) => c.id_uuid === cardId);
        if (!card) throw new Error(`Card ${cardId} not found`);
        if (targetColumnId) card.column_id = targetColumnId;
        card.position = newPos;
        card.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, "kanban.card_moved", card);
        return card;
      } else {
        const res = await pool.query(
          `UPDATE kanban_cards SET column_id = COALESCE($1, column_id), position = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND (tenant_id = $4 OR (tenant_id = '1' AND $4 = '1')) RETURNING *`,
          [targetColumnId || null, newPos, cardId, tenantId]
        );
        if (res.rows.length === 0) throw new Error(`Card ${cardId} not found`);
        const updated = cleanDbRow(res.rows[0]);
        workflowEventBus.emitEvent(tenantId, "kanban.card_moved", updated);
        return updated;
      }
    }

    // --- KNOWLEDGE VAULT ---
    case "crm_list_vault_files": {
      const res = await executeListVaultFiles(tenantId, JSON.stringify(args));
      if (!res.data) throw new Error(res.error || "Fehler beim Abrufen der Wissensdateien");
      return res.data;
    }

    case "crm_search_knowledge_vault": {
      const query = args.query as string;
      const topK = Number(args.top_k) || 5;

      if (isUsingFallback) {
        const docs = (fallbackStore.louisAiKnowledgeMetadata || []).filter(
          (d) => d.tenant_id === tenantId || d.tenant_id === "1"
        );
        const matches = docs.filter((d) =>
          ((d as unknown as Record<string, string>).file_name_original || d.file_name || (d as unknown as Record<string, string>).title || "").toLowerCase().includes(query.toLowerCase())
        );
        return matches.slice(0, topK);
      } else {
        const res = await pool.query(
          `SELECT * FROM sys_louis_ai_knowledge_metadata WHERE (tenant_id = $1 OR (tenant_id = '1' AND $1 = '1')) AND file_name ILIKE $2 LIMIT $3`,
          [tenantId, `%${query}%`, topK]
        );
        return res.rows.map((r) => cleanDbRow(r));
      }
    }

    case "crm_upload_vault_document": {
      const filename = args.filename as string;
      const content = args.content as string;
      const idUuid = uuidv4();

      const payload = {
        id_uuid: idUuid,
        tenant_id: tenantId,
        file_name: filename,
        file_size_bytes: Buffer.byteLength(content, "utf8"),
        mime_type: "text/plain",
        // BUG-12 (Auftrag 015): chunk_count existiert nicht in der DB — document_hash statt dessen (wie louisAi.ts/storage.ts)
        document_hash: crypto.createHash("sha256").update(content).digest("hex"),
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString(),
      };

      if (isUsingFallback) {
        if (!fallbackStore.louisAiKnowledgeMetadata) fallbackStore.louisAiKnowledgeMetadata = [];
        fallbackStore.louisAiKnowledgeMetadata.push(payload as unknown as (typeof fallbackStore.louisAiKnowledgeMetadata)[number]);
        saveFallbackStore();
      } else {
        await pool.query(
          `INSERT INTO sys_louis_ai_knowledge_metadata (
            id_uuid, tenant_id, file_name, file_size_bytes, mime_type, document_hash, created_at_utc, updated_at_utc
          ) VALUES ($1, $2, $3, $4, 'text/plain', $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [idUuid, tenantId, filename, payload.file_size_bytes, payload.document_hash]
        );
      }

      workflowEventBus.emitEvent(tenantId, "knowledge.file_uploaded", payload);
      return payload;
    }

    // --- AI ASSISTANT & COUNCIL ---
    case "crm_run_louis_ai": {
      const prompt = args.prompt as string;
      const sessionId = (args.session_id as string) || uuidv4();

      const result = await orchestrator.processUserPrompt({
        prompt,
        sessionId,
        tenantId,
        userId: ctx.userId,
      });

      return result;
    }

    case "crm_run_council_deliberation": {
      const prompt = args.prompt as string;
      const mode = (args.mode as "multi-role" | "multi-model") || "multi-role";

      const session = await runCouncilDeliberation({
        prompt,
        tenantId,
        mode,
      });

      return session;
    }

    // =========================================================================
    // BUG-1 (Auftrag 015): Neue Tool-Familien — Notizen, Vault, Mails, Kanban,
    // Templates, Angebote, Sessions, Workflows (Wrapper auf Agent-Execute-Funktionen)
    // =========================================================================

    // --- Notizen ---
    case "notes_list": {
      const res = await executeListNotes(tenantId, JSON.stringify(args));
      if (!res.success) throw new Error(res.error || "Fehler beim Auflisten der Notizen");
      return res.data;
    }
    case "notes_create": {
      // BUG-1: MCP-Interface (en) → Agent-Schema (de): entity_type/entity_id_uuid/content → contact_id_uuid/company_id_uuid/note_text
      const mapped: Record<string, unknown> = { note_text: args.content };
      if (args.priority) mapped.priority = args.priority === "high" ? "hoch" : args.priority === "low" ? "niedrig" : "normal";
      const entityType = String(args.entity_type || "");
      const entityId = String(args.entity_id_uuid || "");
      if (entityType === "contact" || entityType === "contacts") mapped.contact_id_uuid = entityId;
      else if (entityType === "company" || entityType === "companies") mapped.company_id_uuid = entityId;
      // 021-C (V2-2): MCP-Pfad persistiert die Notiz wirklich (bypassApproval=true) —
      // vorher No-Op + irreführender Audit CREATE|NOTE ohne DB-Eintrag.
      const res = await executeCreateNoteDraft(tenantId, JSON.stringify(mapped), "mcp_client", true);
      if (!res.success) throw new Error(res.error || "Fehler beim Erstellen der Notiz");
      await mcpAudit(tenantId, "CREATE", "NOTE", String(res.data?.id_uuid || entityId || "n/a"), `MCP: Notiz erstellt (${entityType || "ohne Ziel"}, Text: ${String(args.content || "").slice(0, 60)})`);
      return res.data;
    }
    case "notes_update": {
      // 021-C (V2-5): Katalog note_id_uuid/content → Agent id_uuid/note_text
      const mapped: Record<string, unknown> = { id_uuid: String(args.note_id_uuid || "") };
      if (args.content !== undefined && args.content !== null) mapped.note_text = String(args.content);
      if (args.priority !== undefined && args.priority !== null) mapped.priority = String(args.priority);
      const res = await executeUpdateNote(tenantId, JSON.stringify(mapped), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Aktualisieren der Notiz");
      await mcpAudit(tenantId, "UPDATE", "NOTE", String(res.data?.id_uuid || args.note_id_uuid || args.id_uuid || "n/a"), `MCP: Notiz aktualisiert (ID ${String(res.data?.id_uuid || args.note_id_uuid || args.id_uuid || "n/a")})`);
      return res.data;
    }
    case "notes_delete": {
      // 021-C (V2-5): Katalog note_id_uuid → Agent id_uuid
      const mapped: Record<string, unknown> = { id_uuid: String(args.note_id_uuid || "") };
      const res = await executeDeleteNote(tenantId, JSON.stringify(mapped), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Löschen der Notiz");
      await mcpAudit(tenantId, "DELETE", "NOTE", String(args.note_id_uuid || args.id_uuid || "n/a"), `MCP: Notiz gelöscht (ID ${String(args.note_id_uuid || args.id_uuid || "n/a")})`);
      return res.data;
    }

    // --- Vault (Wissensdatenbank) ---
    case "vault_search": {
      const res = await executeLocalKnowledgeSearch(tenantId, String(args.query || ""), undefined);
      if (!res.success) throw new Error(res.error || "Fehler bei der Vault-Suche");
      return res.data;
    }
    case "vault_write": {
      const res = await executeVaultWrite(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Schreiben in den Vault");
      await mcpAudit(tenantId, "CREATE", "VAULT_FILE", String(args.path || "n/a"), `MCP: Vault-Datei geschrieben (${String(args.path || "n/a")}, ${String(args.content || "").length} Zeichen)`);
      return res.data;
    }
    case "vault_update": {
      const res = await executeVaultUpdate(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Aktualisieren im Vault");
      await mcpAudit(tenantId, "UPDATE", "VAULT_FILE", String(args.path || "n/a"), `MCP: Vault-Datei aktualisiert (${String(args.path || "n/a")})`);
      return res.data;
    }
    case "vault_delete": {
      const res = await executeVaultDelete(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Löschen aus dem Vault");
      await mcpAudit(tenantId, "DELETE", "VAULT_FILE", String(args.path || "n/a"), `MCP: Vault-Datei gelöscht (${String(args.path || "n/a")})`);
      return res.data;
    }

    // --- E-Mail / Mailing ---
    case "mail_list_drafts": {
      const res = await executeListMailDrafts(tenantId, JSON.stringify(args));
      if (!res.success) throw new Error(res.error || "Fehler beim Auflisten der Mail-Entwürfe");
      return res.data;
    }
    case "mail_approve_draft": {
      // 021-E (T-1-Fund): Katalog draft_id_uuid → Agent id_uuid (Drift wie V2-5)
      const mapped = { id_uuid: String(args.draft_id_uuid || args.id_uuid || "") };
      const res = await executeApproveMailDraft(tenantId, JSON.stringify(mapped));
      if (!res.success) throw new Error(res.error || "Fehler beim Genehmigen des Mail-Entwurfs");
      await mcpAudit(tenantId, "UPDATE", "MAIL_DRAFT", String(mapped.id_uuid || "n/a"), `MCP: Mail-Entwurf genehmigt (${String(mapped.id_uuid || "n/a")})`);
      return res.data;
    }

    // --- Kanban ---
    case "kanban_get_board_details": {
      const res = await executeGetKanbanBoardDetails(tenantId, JSON.stringify(args));
      if (!res.success) throw new Error(res.error || "Fehler beim Abrufen der Board-Details");
      return res.data;
    }
    case "kanban_create_board": {
      const res = await executeCreateKanbanBoard(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Erstellen des Kanban-Boards");
      await mcpAudit(tenantId, "CREATE", "KANBAN_BOARD", String(res.data?.id_uuid || "n/a"), `MCP: Kanban-Board erstellt (${String(args.title || "n/a")})`);
      return res.data;
    }
    case "kanban_update_card": {
      const res = await executeUpdateKanbanCard(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Aktualisieren der Kanban-Karte");
      await mcpAudit(tenantId, "UPDATE", "KANBAN_CARD", String(args.card_id_uuid || args.id_uuid || "n/a"), `MCP: Kanban-Karte aktualisiert (${String(args.card_id_uuid || args.id_uuid || "n/a")})`);
      return res.data;
    }
    case "kanban_delete_card": {
      const res = await executeDeleteKanbanCard(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Löschen der Kanban-Karte");
      await mcpAudit(tenantId, "DELETE", "KANBAN_CARD", String(args.card_id_uuid || args.id_uuid || "n/a"), `MCP: Kanban-Karte gelöscht (${String(args.card_id_uuid || args.id_uuid || "n/a")})`);
      return res.data;
    }

    // --- Templates ---
    case "templates_list": {
      const category = (args.category as "email" | "signature" | "text" | "item" | "all") || "all";
      const res = await executeGetTemplates(tenantId, String(args.search || ""), category);
      if (!res.success) throw new Error(res.error || "Fehler beim Auflisten der Vorlagen");
      return res.data;
    }

    // --- Angebote ---
    case "offer_finalize_send": {
      const res = await executeFinalizeAndSendOffer(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Finalisieren des Angebots");
      await mcpAudit(tenantId, "UPDATE", "OFFER", String(args.offer_id_uuid || args.id_uuid || "n/a"), `MCP: Angebot finalisiert/gesendet (${String(args.offer_id_uuid || args.id_uuid || "n/a")})`);
      return res.data;
    }

    // --- Sessions / Recall ---
    case "sessions_recall": {
      const res = await executeRecallSessions(tenantId, JSON.stringify(args));
      if (!res.success) throw new Error(res.error || "Fehler beim Session-Recall");
      return res.data;
    }

    // --- Workflows ---
    case "workflows_learn": {
      const res = await executeLearnWorkflow(tenantId, JSON.stringify(args), "mcp_client");
      if (!res.success) throw new Error(res.error || "Fehler beim Speichern des Workflows");
      return res.data;
    }

    default:
      throw new Error(`Unknown MCP Tool: ${name}`);
  }
}

// -----------------------------------------------------------------------------
// MCP Main Request Handler
// -----------------------------------------------------------------------------
export async function handleMcpRequest(
  body: JsonRpcRequest | JsonRpcRequest[],
  ctx: McpContext
): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((req) => handleMcpSingleRequest(req, ctx)));
    const nonUndefined = results.filter((r): r is JsonRpcResponse => r !== undefined);
    if (nonUndefined.length === 0) return undefined;
    return nonUndefined;
  }
  return handleMcpSingleRequest(body, ctx);
}

async function handleMcpSingleRequest(
  body: JsonRpcRequest,
  ctx: McpContext
): Promise<JsonRpcResponse | undefined> {
  const isNotification = body.id === undefined;
  const reqId = body.id !== undefined ? body.id : null;

  try {
    switch (body.method) {
      case "initialize": {
        const clientVersion = body.params?.protocolVersion as string | undefined;
        const supportedVersions = ["2026-08-01", "2025-11-25", "2024-11-05"];
        const selectedVersion = clientVersion && supportedVersions.includes(clientVersion) ? clientVersion : "2026-08-01";

        if (isNotification) return undefined;

        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {
            protocolVersion: selectedVersion,
            capabilities: {
              tools: { listChanged: true },
              resources: { subscribe: true, listChanged: true },
              prompts: { listChanged: true },
              logging: {},
              notifications: {}
            },
            serverInfo: {
              name: "louis-smart-crm-mcp",
              version: "1.0.0",
            },
          },
        };
      }

      case "notifications/initialized":
      case "notifications/cancelled":
      case "notifications/progress": {
        return undefined;
      }

      case "ping": {
        if (isNotification) return undefined;
        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {},
        };
      }

      case "tools/list": {
        if (isNotification) return undefined;
        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {
            tools: MCP_TOOLS_CATALOG,
          },
        };
      }

      case "tools/call": {
        const params = body.params || {};
        const toolName = params.name as string;
        const toolArgs = (params.arguments as Record<string, unknown>) || {};

        if (!toolName) {
          if (isNotification) return undefined;
          return {
            jsonrpc: "2.0",
            id: reqId,
            error: {
              code: -32602,
              message: "Invalid params: Missing tool name",
            },
          };
        }

        try {
          const toolResult = await executeMcpTool(toolName, toolArgs, ctx);
          if (isNotification) return undefined;

          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              content: [
                {
                  type: "text",
                  text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2),
                },
              ],
              annotations: {
                audience: ["user", "assistant"],
                priority: 1.0,
                meta: { timestamp: new Date().toISOString() }
              }
            },
          };
        } catch (toolErr: unknown) {
          if (isNotification) return undefined;
          const errorMsg = toolErr instanceof Error ? toolErr.message : String(toolErr);
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              content: [
                {
                  type: "text",
                  text: `Tool execution error (${toolName}): ${errorMsg}`,
                },
              ],
              isError: true,
            },
          };
        }
      }

      case "resources/list": {
        if (isNotification) return undefined;
        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {
            resources: MCP_RESOURCES_CATALOG,
          },
        };
      }

      case "resources/read": {
        if (isNotification) return undefined;
        const uri = body.params?.uri as string;
        let contentData: unknown = [];

        if (uri === "crm://companies") {
          contentData = await executeMcpTool("crm_list_companies", { limit: 100 }, ctx);
        } else if (uri === "crm://contacts") {
          contentData = await executeMcpTool("crm_list_contacts", { limit: 100 }, ctx);
        } else if (uri === "crm://invoices") {
          contentData = await executeMcpTool("crm_list_invoices", { limit: 100 }, ctx);
        } else if (uri === "crm://vault/files") {
          contentData = await executeMcpTool("crm_search_knowledge_vault", { query: "%" }, ctx);
        } else {
          return {
            jsonrpc: "2.0",
            id: reqId,
            error: {
              code: -32602,
              message: `Unknown resource URI: ${uri}`,
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(contentData, null, 2),
              },
            ],
          },
        };
      }

      case "prompts/list": {
        if (isNotification) return undefined;
        return {
          jsonrpc: "2.0",
          id: reqId,
          result: {
            prompts: MCP_PROMPTS_CATALOG,
          },
        };
      }

      case "prompts/get": {
        if (isNotification) return undefined;
        const promptName = body.params?.name as string;
        const promptArgs = (body.params?.arguments as Record<string, string>) || {};

        if (promptName === "kundengespraech_zusammenfassen") {
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              description: "Fasst Notizen eines Kundengesprächs zusammen",
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Bitte fass die folgenden Gesprächsnotizen prägnant zusammen und erstelle konkrete CRM Action Items:\n\n${promptArgs.gespraechs_notizen || ""}`,
                  },
                },
              ],
            },
          };
        } else if (promptName === "mahnung_generieren") {
          return {
            jsonrpc: "2.0",
            id: reqId,
            result: {
              description: "Generiert Mahnungstext",
              messages: [
                {
                  role: "user",
                  content: {
                    type: "text",
                    text: `Bitte erstelle ein Mahnschreiben für die Rechnung ${promptArgs.rechnungs_nummer || "[Nummer]"} (Mahnstufe: ${promptArgs.mahnstufe || "1"}).`,
                  },
                },
              ],
            },
          };
        } else {
          return {
            jsonrpc: "2.0",
            id: reqId,
            error: {
              code: -32602,
              message: `Unknown prompt name: ${promptName}`,
            },
          };
        }
      }

      default:
        if (isNotification) return undefined;
        return {
          jsonrpc: "2.0",
          id: reqId,
          error: {
            code: -32601,
            message: `Method not found: ${body.method}`,
          },
        };
    }
  } catch (err: unknown) {
    if (isNotification) return undefined;
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: "2.0",
      id: reqId,
      error: {
        code: -32000,
        message: `Server execution error: ${errorMsg}`,
      },
    };
  }
}
