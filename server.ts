import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import multer from "multer";
import * as dotenv from "dotenv";

import { initDatabase, seedDatabase, isUsingFallback, pool, fallbackStore, saveFallbackStore } from "./src/server/db.js";
import { authMiddleware, authConfig } from "./src/server/auth.js";
import { getSession } from "@auth/express";
import { appRouter } from "./src/server/router.js";
import { generateInvoiceFilesOnDisk } from "./src/server/pdfHelper.js";
import { getEntityStoragePath, multerStorage, ingestFileToRag, syncVaultFilesToRag } from "./src/server/storage.js";
import { initWorkflowEngine } from "./src/server/ai/workflowEngine.js";
import { executeCreateDraftInvoice, executeCreateDraftCompany, executeCreateDraftContact, executeCrmDataAnalyst } from "./src/server/ai/tools/crm.js";
import { runLouisAiFlow, executePassiveShortTermCompression } from "./src/server/ai/orchestrator.js";
import crypto from "crypto";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Initialize Database
  await initDatabase();
  await seedDatabase();

  // Initialize CRM Workflow Automation Listeners
  initWorkflowEngine();

  const app = express();
  app.set("trust proxy", true);
  const PORT = parseInt(String(process.env.PORT || 3000));

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // --- File Upload & Download Routes ---
  const serverMulterStorage = multer.diskStorage({
    destination: async (req, file, cb) => {
      const type = (req.body?.type || req.query?.type) as string | undefined;
      const id = (req.body?.id || req.query?.id) as string | undefined;
      const name = (req.body?.name || req.query?.name) as string | undefined;

      if (!type || !id || !name) {
        return cb(new Error("Missing entity context for upload"), "");
      }

      let tenantId = "1";
      try {
        const sessionRes = await getSession(req, authConfig);
        if (sessionRes?.user?.id) {
          tenantId = sessionRes.user.id;
        }
      } catch (err) {
        console.warn("Failed to retrieve session in multer storage:", err);
      }

      cb(null, getEntityStoragePath(type, id, name, tenantId));
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "_" + file.originalname);
    }
  });

  const upload = multer({ storage: serverMulterStorage });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Handle background RAG Ingestion
    const type = req.body?.type || req.query?.type;
    const id = req.body?.id || req.query?.id;
    const name = req.body?.name || req.query?.name;
    
    let tenantId = "1";
    try {
      const sessionRes = await getSession(req, authConfig);
      if (sessionRes?.user?.id) {
        tenantId = sessionRes.user.id;
      }
    } catch (err) {
      console.warn("Failed to retrieve session in upload route:", err);
    }

    if (type && id && name) {
      const scope = type === "companies" ? "company" : "contact";
      const filePath = req.file.path;
      const originalName = req.file.originalname || req.file.filename;

      ingestFileToRag(filePath, originalName, tenantId, scope, id).catch((e) => {
        console.error("Failed to index uploaded file to RAG:", e);
      });
    }

    res.json({ success: true, filename: req.file.filename });
  });

  app.get("/api/files/:type/:id/:name/:filename", async (req, res) => {
    const { type, id, name, filename } = req.params;
    let tenantId = "1";
    try {
      const sessionRes = await getSession(req, authConfig);
      if (sessionRes?.user?.id) {
        tenantId = sessionRes.user.id;
      }
    } catch (err) {
      console.warn("Failed to retrieve session in download route:", err);
    }
    const storagePath = getEntityStoragePath(type, id, name, tenantId);
    const filePath = path.join(storagePath, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }
    res.download(filePath);
  });

  app.get("/api/invoices/:invoiceId/download-pdf", async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const { lang } = req.query;
      const locale = typeof lang === 'string' ? lang : 'de';
      const sessionRes = await getSession(req, authConfig);
      const activeTenantId = sessionRes?.user?.id || "1";

      let invoice: any;
      if (isUsingFallback) {
        const found = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
        if (found) {
          invoice = { ...found };
          if (invoice.associated_company_id) {
            const co = fallbackStore.companies.find(c => c.id_uuid === invoice.associated_company_id);
            invoice.entityType = "companies";
            invoice.entityId = co?.id_uuid;
            invoice.entityName = co?.full_legal_name;
          } else if (invoice.associated_contact_id) {
            const ct = fallbackStore.contacts.find(c => c.id_uuid === invoice.associated_contact_id);
            invoice.entityType = "contacts";
            invoice.entityId = ct?.id_uuid;
            invoice.entityName = ct?.full_legal_name;
          }
        }
      } else {
        const invoiceRes = await pool.query(`
          SELECT i.*, 
                 co.full_legal_name as co_name, 
                 ct.full_legal_name as ct_name
          FROM fiscal_billing_invoices i
          LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
          LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
          WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
        `, [invoiceId, activeTenantId]);
        invoice = invoiceRes.rows[0];
        if (invoice) {
          if (invoice.associated_company_id) {
            invoice.entityType = "companies";
            invoice.entityId = invoice.associated_company_id;
            invoice.entityName = invoice.co_name;
          } else if (invoice.associated_contact_id) {
            invoice.entityType = "contacts";
            invoice.entityId = invoice.associated_contact_id;
            invoice.entityName = invoice.ct_name;
          }
        }
      }

      if (!invoice || !invoice.entityId) {
        console.warn(`[Download PDF] Invoice not found or has no entity. InvoiceID: ${invoiceId}, TenantID: ${activeTenantId}`);
        return res.status(404).send(`Invoice or associated contact/company not found for InvoiceID: ${invoiceId} under Tenant: ${activeTenantId}`);
      }

      if (invoice.payment_status === 'draft') {
        return res.status(400).send("Entwürfe haben keine PDF/XML-Rechnungsdateien. Bitte finalisieren Sie den Entwurf zuerst.");
      }

      await generateInvoiceFilesOnDisk(invoiceId, activeTenantId, locale);

      const cleanNum = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
      const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, activeTenantId);
      const displayPdfPath = path.join(entityStoragePath, `rechnung_${cleanNum}.pdf`);

      if (!fs.existsSync(displayPdfPath)) {
        console.warn(`[Download PDF] PDF File not found. Searched path: ${displayPdfPath}`);
        return res.status(404).send(`PDF File not found at path: ${displayPdfPath}. Please regenerate from preview.`);
      }

      const recipientName = invoice.entityName || invoice.company_name || 'Empfaenger';
      const cleanRecipient = recipientName.replace(/[/\\?%*:|"<>\.]/g, '');
      const filename = `Rechnung - ${cleanRecipient} - ${cleanNum}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
      res.download(displayPdfPath, filename);
    } catch (err: any) {
      console.error("Download PDF error:", err);
      // Differentiate compliance failures from generic server errors so the
      // frontend can surface a dedicated dialog instead of a generic toast.
      if (err && err.code === "INVOICE_FAILED_VALIDATION") {
        return res.status(422).json({
          code: "INVOICE_FAILED_VALIDATION",
          message: err.message,
          errors: err.validationReport?.errors ?? [],
          warnings: err.validationReport?.warnings ?? [],
          logPath: err.validationLogPath ?? null,
        });
      }
      // XRechnung pre-flight validations (Leitweg-ID, seller contact) throw
      // string-coded errors from zugferd.ts — surface them as 422 too.
      if (typeof err?.message === "string" && err.message.startsWith("xrechnung_")) {
        return res.status(422).json({ code: err.message, message: err.message });
      }
      res.status(500).send("Error generating/downloading PDF: " + err.message);
    }
  });

  app.get("/api/invoices/:invoiceId/download-xml", async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const { lang } = req.query;
      const locale = typeof lang === 'string' ? lang : 'de';
      const sessionRes = await getSession(req, authConfig);
      const activeTenantId = sessionRes?.user?.id || "1";

      let invoice: any;
      if (isUsingFallback) {
        const found = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
        if (found) {
          invoice = { ...found };
          if (invoice.associated_company_id) {
            const co = fallbackStore.companies.find(c => c.id_uuid === invoice.associated_company_id);
            invoice.entityType = "companies";
            invoice.entityId = co?.id_uuid;
            invoice.entityName = co?.full_legal_name;
          } else if (invoice.associated_contact_id) {
            const ct = fallbackStore.contacts.find(c => c.id_uuid === invoice.associated_contact_id);
            invoice.entityType = "contacts";
            invoice.entityId = ct?.id_uuid;
            invoice.entityName = ct?.full_legal_name;
          }
        }
      } else {
        const invoiceRes = await pool.query(`
          SELECT i.*, 
                 co.full_legal_name as co_name, 
                 ct.full_legal_name as ct_name
          FROM fiscal_billing_invoices i
          LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
          LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
          WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
        `, [invoiceId, activeTenantId]);
        invoice = invoiceRes.rows[0];
        if (invoice) {
          if (invoice.associated_company_id) {
            invoice.entityType = "companies";
            invoice.entityId = invoice.associated_company_id;
            invoice.entityName = invoice.co_name;
          } else if (invoice.associated_contact_id) {
            invoice.entityType = "contacts";
            invoice.entityId = invoice.associated_contact_id;
            invoice.entityName = invoice.ct_name;
          }
        }
      }

      if (!invoice || !invoice.entityId) {
        console.warn(`[Download XML] Invoice not found or has no entity. InvoiceID: ${invoiceId}, TenantID: ${activeTenantId}`);
        return res.status(404).send(`Invoice or associated contact/company not found for InvoiceID: ${invoiceId} under Tenant: ${activeTenantId}`);
      }

      if (invoice.payment_status === 'draft') {
        return res.status(400).send("Entwürfe haben keine PDF/XML-Rechnungsdateien. Bitte finalisieren Sie den Entwurf zuerst.");
      }

      await generateInvoiceFilesOnDisk(invoiceId, activeTenantId, locale);

      const cleanNum = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
      const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, activeTenantId);
      const displayXmlPath = path.join(entityStoragePath, `zugferd_${cleanNum}.xml`);

      if (!fs.existsSync(displayXmlPath)) {
        console.warn(`[Download XML] XML File not found. Searched path: ${displayXmlPath}`);
        return res.status(404).send(`XML File not found at path: ${displayXmlPath}`);
      }

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="zugferd_${cleanNum}.xml"`);
      res.download(displayXmlPath, `zugferd_${cleanNum}.xml`);
    } catch (err: any) {
      console.error("Download XML error:", err);
      res.status(500).send("Error generating/downloading XML: " + err.message);
    }
  });

  // --- Auth.js Integration ---
  app.use("/api/auth/*", authMiddleware);

  // --- tRPC Middleware ---
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: async ({ req } : any) => {
        const sessionRes = await getSession(req, authConfig);
        let session = null;
        if (sessionRes && sessionRes.user) {
          session = {
            ...sessionRes,
            user: {
              ...sessionRes.user,
              id: sessionRes.user.id || "1",
            }
          };
        } else if (isUsingFallback) {
          session = {
            user: {
              id: "1",
              name: "Demo User",
              email: "demo@louis-crm.de",
            },
            expires: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
          };
        }
        return { 
          session,
          tenantId: session?.user?.id || '1'
        };
      },
    })
  );

  app.get("/api/telegram/config", async (req, res) => {
    try {
      const tenantId = (req.query.tenantId as string) || "1";
      if (isUsingFallback) {
        if (!fallbackStore.telegramConfig) fallbackStore.telegramConfig = [];
        let found = fallbackStore.telegramConfig.find(x => x.tenant_id === tenantId);
        if (!found && fallbackStore.telegramConfig.length > 0) {
          found = fallbackStore.telegramConfig[0];
        }
        if (found && found.bot_token && found.is_active) {
          return res.json({
            bot_token: found.bot_token,
            allowed_user_ids: found.allowed_user_ids,
            is_active: found.is_active
          });
        }
      } else {
        let dbRes = await pool.query(
          "SELECT bot_token, allowed_user_ids, is_active FROM sys_integrations_telegram_config WHERE tenant_id = $1 LIMIT 1",
          [tenantId]
        );
        if (dbRes.rows.length === 0) {
          dbRes = await pool.query(
            "SELECT bot_token, allowed_user_ids, is_active FROM sys_integrations_telegram_config LIMIT 1"
          );
        }
        if (dbRes.rows.length > 0 && dbRes.rows[0].is_active) {
          return res.json({
            bot_token: dbRes.rows[0].bot_token,
            allowed_user_ids: dbRes.rows[0].allowed_user_ids,
            is_active: dbRes.rows[0].is_active
          });
        }
      }
      return res.status(404).json({ error: "Telegram config not found or inactive." });
    } catch (err: any) {
      console.error("Error serving telegram config REST endpoint:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Model Context Protocol (MCP) Server Integration ---
  const activeMcpSessions = new Set<string>();

  app.get("/api/mcp/sse", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const sessionId = Math.random().toString(36).substring(2, 15);
    activeMcpSessions.add(sessionId);

    // Send the endpoint event immediately as required by MCP spec
    res.write(`event: endpoint\ndata: /api/mcp/message?sessionId=${sessionId}\n\n`);

    const interval = setInterval(() => {
      res.write(":\n\n");
    }, 20000);

    req.on("close", () => {
      clearInterval(interval);
      activeMcpSessions.delete(sessionId);
    });
  });

  app.post("/api/mcp/message", async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId || !activeMcpSessions.has(sessionId)) {
        console.warn(`[MCP] Request received outside of active stream session: ${sessionId}`);
      }

      const { jsonrpc, id, method, params } = req.body || {};
      if (jsonrpc !== "2.0") {
        return res.status(400).json({ 
          jsonrpc: "2.0", 
          id: id || null, 
          error: { code: -32600, message: "Invalid JSON-RPC request" } 
        });
      }

      if (method === "initialize") {
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: "louis-crm-server",
              version: "1.0.0"
            }
          }
        });
      }

      if (method === "tools/list") {
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "search_contacts",
                description: "Sucht Kontakte im CRM anhand von Name, E-Mail, Telefon oder Stadt.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Der Suchbegriff zum Abfragen der Kontakte"
                    }
                  },
                  required: ["query"]
                }
              },
              {
                name: "crm_data_analyst",
                description: "Sucht intelligent im gesamten CRM (Kontakte, Unternehmen, Rechnungen) anhand von Text oder Fragen und liefert passende Treffer sowie Kennzahlen und Statistiken.",
                inputSchema: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description: "Die Frage oder der Suchbegriff an das CRM, z.B. 'Welche Firmen gibt es in Hamburg?' oder 'Zeige mir alle offenen Rechnungen'."
                    }
                  },
                  required: ["query"]
                }
              },
              {
                name: "create_invoice_draft",
                description: "Erstellt einen neuen sicheren Rechnungsentwurf (Draft) im CRM, ohne die finale E-Rechnung auszustellen.",
                inputSchema: {
                  type: "object",
                  properties: {
                    company_id: { "type": "string", "description": "UUID des zugeordneten Unternehmens (optional)" },
                    contact_id: { "type": "string", "description": "UUID des Hauptansprechpartners (optional)" },
                    items_list: {
                      "type": "array",
                      "description": "Liste der Rechnungseinträge",
                      "items": {
                        "type": "object",
                        "properties": {
                          "description": { "type": "string", "description": "Bezeichnung des Postens" },
                          "quantity": { "type": "number", "description": "Menge oder Stunden" },
                          "unit_price": { "type": "number", "description": "Netto-Einzelpreis" },
                          "vat_rate": { "type": "number", "description": "MwSt in % (z.B. 19)" },
                          "unit_code": { "type": "string", "description": "Maßeinheit wie HUR für Stunden oder C62 für Stücke (optional)" }
                        },
                        "required": ["description", "quantity", "unit_price"]
                      }
                    },
                    introductory_text: { "type": "string", "description": "Einleitender Text auf der Rechnung (optional)" },
                    closing_text: { "type": "string", "description": "Schlusssatz der Rechnung (optional)" },
                    payment_term: { "type": "string", "description": "Zahlungsziel in Tagen, z.B. '14' (optional)" },
                    is_vat_inclusive: { "type": "boolean", "description": "Handelt es sich um Bruttotage? Standard: false (optional)" }
                  },
                  required: ["items_list"]
                }
              },
              {
                name: "create_company_draft",
                description: "Erstellt einen neuen Unternehmensentwurf (Draft) im CRM-Register.",
                inputSchema: {
                  type: "object",
                  properties: {
                    full_legal_name: { "type": "string", "description": "Offizieller rechtlicher Name des Unternehmens (erforderlich)" },
                    street: { "type": "string", "description": "Straße (optional)" },
                    house_number: { "type": "string", "description": "Hausnummer (optional)" },
                    postal_code: { "type": "string", "description": "Postleitzahl (optional)" },
                    city: { "type": "string", "description": "Ort/Stadt (optional)" },
                    email_address: { "type": "string", "description": "E-Mail-Adresse (optional)" },
                    phone_number: { "type": "string", "description": "Telefonnummer (optional)" },
                    tax_vat_id: { "type": "string", "description": "USt-IdNr., z.B. DE123456789 (optional)" },
                    tax_number: { "type": "string", "description": "Steuernummer (optional)" },
                    responsible_person: { "type": "string", "description": "Ansprechpartner oder Inhaber (optional)" }
                  },
                  required: ["full_legal_name"]
                }
              },
              {
                name: "create_contact_draft",
                description: "Erstellt einen neuen Ansprechpartner / Kontaktentwurf (Draft) im CRM.",
                inputSchema: {
                  type: "object",
                  properties: {
                    first_name: { "type": "string", "description": "Vorname (optional)" },
                    last_name: { "type": "string", "description": "Nachname (erforderlich)" },
                    salutation: { "type": "string", "description": "Anrede, z.B. Herr or Frau (optional)" },
                    email_address: { "type": "string", "description": "E-Mail-Adresse (optional)" },
                    phone_number: { "type": "string", "description": "Telefonnummer (optional)" },
                    associated_company_id: { "type": "string", "description": "UUID des verknüpften Unternehmens im CRM (optional)" },
                    street: { "type": "string", "description": "Straße (optional)" },
                    house_number: { "type": "string", "description": "Hausnummer (optional)" },
                    postal_code: { "type": "string", "description": "Postleitzahl (optional)" },
                    city: { "type": "string", "description": "Ort/Stadt (optional)" }
                  },
                  required: ["last_name"]
                }
              },
              {
                name: "chat_with_louis",
                description: "Führt ein Gespräch mit LOUIS AI, der zentralen KI des CRM. Nutzt Ollama oder Gemini, um Fragen zu beantworten, Berichte zu lesen oder CRM-Aufgaben über natürlichen Text zu klären.",
                inputSchema: {
                  type: "object",
                  properties: {
                    message: { "type": "string", "description": "Die Chat-Nachricht des Benutzers." },
                    session_id: { "type": "string", "description": "Die optionale Session-UUID für den Chat-Verlauf. Wird zur Wiedererkennung des Gesprächsfadens genutzt." }
                  },
                  required: ["message"]
                }
              },
              {
                name: "clear_louis_chat",
                description: "Löscht den gesamten Chatverlauf und das Kurzzeitgedächtnis für eine bestimmte Session, um das Gespräch zurückzusetzen.",
                inputSchema: {
                  type: "object",
                  properties: {
                    session_id: { "type": "string", "description": "Die Session-UUID für den Chat-Verlauf, der gelöscht werden soll." }
                  },
                  required: ["session_id"]
                }
              }
            ]
          }
        });
      }

      if (method === "tools/call") {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        let activeTenantId = "1";
        if (isUsingFallback) {
          if (fallbackStore.telegramConfig && fallbackStore.telegramConfig.length > 0) {
            activeTenantId = fallbackStore.telegramConfig[0].tenant_id;
          }
        } else {
          try {
            const configRes = await pool.query("SELECT tenant_id FROM sys_integrations_telegram_config LIMIT 1");
            if (configRes.rows.length > 0) {
              activeTenantId = configRes.rows[0].tenant_id;
            }
          } catch (err) {
            console.warn("Could not query helper tenant_id:", err);
          }
        }

        if (toolName === "search_contacts") {
          const queryStr = (toolArgs.query || "").trim().toLowerCase();
          let results = [];

          if (isUsingFallback) {
            results = fallbackStore.contacts.filter(c => {
              return (
                (c.first_name || "").toLowerCase().includes(queryStr) ||
                (c.last_name || "").toLowerCase().includes(queryStr) ||
                (c.full_legal_name || "").toLowerCase().includes(queryStr) ||
                (c.email_address || "").toLowerCase().includes(queryStr) ||
                (c.phone_number || "").toLowerCase().includes(queryStr) ||
                (c.city || "").toLowerCase().includes(queryStr)
              );
            }).map(c => {
              const comp = fallbackStore.companies.find(co => co.id_uuid === c.associated_company_id);
              return {
                id_uuid: c.id_uuid,
                full_legal_name: c.full_legal_name,
                email_address: c.email_address,
                phone_number: c.phone_number,
                city: c.city,
                company_name: comp ? comp.full_legal_name : undefined
              };
            });
          } else {
            const dbRes = await pool.query(`
              SELECT c.id_uuid, c.full_legal_name, c.email_address, c.phone_number, c.city, co.full_legal_name as company_name
              FROM core_registry_contacts c
              LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
              WHERE (c.tenant_id = $1 OR c.tenant_id = '1') AND (
                c.full_legal_name ILIKE $2 OR
                c.email_address ILIKE $2 OR
                c.phone_number ILIKE $2 OR
                c.city ILIKE $2
              )
              LIMIT 15
            `, [activeTenantId, `%${queryStr}%`]);
            results = dbRes.rows;
          }

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(results, null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "crm_data_analyst") {
          const resultObj = await executeCrmDataAnalyst(activeTenantId, toolArgs.query || "");
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: typeof resultObj === "string" ? resultObj : JSON.stringify(resultObj, null, 2)
                }
              ]
            }
          });
        }

        if (toolName === "create_invoice_draft") {
          const resultStr = await executeCreateDraftInvoice(activeTenantId, JSON.stringify(toolArgs), "telegram-mcp-gateway");
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: resultStr
                }
              ]
            }
          });
        }

        if (toolName === "create_company_draft") {
          const resultStr = await executeCreateDraftCompany(activeTenantId, JSON.stringify(toolArgs), "telegram-mcp-gateway");
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: resultStr
                }
              ]
            }
          });
        }

        if (toolName === "create_contact_draft") {
          const resultStr = await executeCreateDraftContact(activeTenantId, JSON.stringify(toolArgs), "telegram-mcp-gateway");
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: resultStr
                }
              ]
            }
          });
        }

        if (toolName === "chat_with_louis") {
          const userMessage = (toolArgs.message || "").trim();
          let rawSessionId = toolArgs.session_id || "default-telegram-session";
          
          let sessionId = rawSessionId;
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
            const hash = crypto.createHash("md5").update(String(rawSessionId)).digest("hex");
            sessionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
          }

          let tenantId = "1";
          if (isUsingFallback) {
            if (fallbackStore.telegramConfig && fallbackStore.telegramConfig.length > 0) {
              tenantId = fallbackStore.telegramConfig[0].tenant_id;
            }
          } else {
            try {
              const configRes = await pool.query("SELECT tenant_id FROM sys_integrations_telegram_config LIMIT 1");
              if (configRes.rows.length > 0) {
                tenantId = configRes.rows[0].tenant_id;
              }
            } catch (err) {
              console.warn("Could not query telegram config tenant_id, using fallback '1'", err);
            }
          }
          const userId = "telegram_user";
          let history: any[] = [];
          let currentSummary = "";

          if (isUsingFallback) {
            if (!fallbackStore.louisAiSessions) {
              fallbackStore.louisAiSessions = [];
            }
            const session = fallbackStore.louisAiSessions.find((s: any) => s.id_uuid === sessionId && s.tenant_id === tenantId);
            if (session) {
              history = typeof session.conversation_history_json === "string"
                ? JSON.parse(session.conversation_history_json)
                : session.conversation_history_json;
              currentSummary = session.short_term_summary_text || "";
            } else {
              fallbackStore.louisAiSessions.push({
                id_uuid: sessionId,
                tenant_id: tenantId,
                session_title: userMessage.slice(0, 40),
                conversation_history_json: [],
                short_term_summary_text: "",
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
              saveFallbackStore();
            }
          } else {
            const resDb = await pool.query(
              "SELECT conversation_history_json, short_term_summary_text FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND tenant_id = $2 LIMIT 1",
              [sessionId, tenantId]
            );
            if (resDb.rows.length > 0) {
              const rawHist = resDb.rows[0].conversation_history_json;
              history = typeof rawHist === "string" ? JSON.parse(rawHist) : rawHist;
              currentSummary = resDb.rows[0].short_term_summary_text || "";
            } else {
              await pool.query(`
                INSERT INTO sys_louis_ai_sessions (id_uuid, tenant_id, session_title, conversation_history_json, short_term_summary_text)
                VALUES ($1, $2, $3, '[]'::jsonb, '')
              `, [sessionId, tenantId, userMessage.slice(0, 40)]);
            }
          }

          // Append user message to history
          history.push({ role: "user", content: userMessage, timestamp_utc: new Date().toISOString() });

          // Run passive short term compression
          const updatedSummary = await executePassiveShortTermCompression(tenantId, history, currentSummary);

          // Get active system language mapping
          let tenantLang = "de";
          if (isUsingFallback) {
            if (fallbackStore.myCompany && fallbackStore.myCompany.language) {
              tenantLang = fallbackStore.myCompany.language;
            }
          } else {
            try {
              const companyRes = await pool.query(
                "SELECT language FROM core_registry_my_company WHERE tenant_id = $1 LIMIT 1",
                [tenantId]
              );
              if (companyRes.rows.length > 0 && companyRes.rows[0].language) {
                tenantLang = companyRes.rows[0].language;
              }
            } catch (err) {
              console.warn("Could not query tenant language", err);
            }
          }

          const trimmedHistory = history.length > 5 ? history.slice(-5) : history;
          const result = await runLouisAiFlow(tenantId, userId, userMessage, trimmedHistory, tenantLang, updatedSummary);

          // Save assistant answer back in history sequence
          history.push({
            role: "assistant",
            content: result.replyText,
            thought_log: result.thoughtLog,
            proposed_changes: result.proposedChanges,
            timestamp_utc: new Date().toISOString(),
            metrics: result.metrics
          });

          if (isUsingFallback) {
            const session = fallbackStore.louisAiSessions.find((s: any) => s.id_uuid === sessionId && s.tenant_id === tenantId);
            if (session) {
              session.conversation_history_json = history;
              session.short_term_summary_text = updatedSummary;
              saveFallbackStore();
            }
          } else {
            await pool.query(`
              UPDATE sys_louis_ai_sessions
              SET conversation_history_json = $1, short_term_summary_text = $2, updated_at_utc = CURRENT_TIMESTAMP
              WHERE id_uuid = $3 AND tenant_id = $4
            `, [JSON.stringify(history), updatedSummary, sessionId, tenantId]);
          }

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: result.replyText
                }
              ]
            }
          });
        }

        if (toolName === "clear_louis_chat") {
          let rawSessionId = toolArgs.session_id || "default-telegram-session";
          
          let sessionId = rawSessionId;
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
            const hash = crypto.createHash("md5").update(String(rawSessionId)).digest("hex");
            sessionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
          }

          let tenantId = "1";
          if (isUsingFallback) {
            if (fallbackStore.telegramConfig && fallbackStore.telegramConfig.length > 0) {
              tenantId = fallbackStore.telegramConfig[0].tenant_id;
            }
          } else {
            try {
              const configRes = await pool.query("SELECT tenant_id FROM sys_integrations_telegram_config LIMIT 1");
              if (configRes.rows.length > 0) {
                tenantId = configRes.rows[0].tenant_id;
              }
            } catch (err) {
              console.warn("Could not query telegram config tenant_id, using fallback '1'", err);
            }
          }

          if (isUsingFallback) {
            if (fallbackStore.louisAiSessions) {
              fallbackStore.louisAiSessions = fallbackStore.louisAiSessions.filter((s: any) => !(s.id_uuid === sessionId && s.tenant_id === tenantId));
              saveFallbackStore();
            }
          } else {
            await pool.query(
              "DELETE FROM sys_louis_ai_sessions WHERE id_uuid = $1 AND tenant_id = $2",
              [sessionId, tenantId]
            );
          }

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: "SUCCESS"
                }
              ]
            }
          });
        }

        return res.status(404).json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool ${toolName} not found`
          }
        });
      }

      return res.status(404).json({
        jsonrpc: "2.0",
        id: id || null,
        error: {
          code: -32601,
          message: `Method ${method} not found`
        }
      });
    } catch (err: any) {
      console.error("[MCP] Error in message handler:", err);
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: err.message || "Internal server error"
        }
      });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", engine: "Louis-Modular-Router-v1" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    // Async background storage synchronization with RAG vectors
    console.log("[RAG Sync] Starting background data vaults synchronization...");
    syncVaultFilesToRag("1").then(() => {
      console.log("[RAG Sync] Background synchronization finished.");
    }).catch((e) => {
      console.error("[RAG Sync] Background synchronization encountered errors:", e);
    });
  });
}

startServer();
