import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import multer from "multer";
import * as dotenv from "dotenv";

import { initDatabase, seedDatabase, isUsingFallback, pool, fallbackStore, saveFallbackStore } from "./src/server/db.js";
import { authMiddleware, authConfig, initAuthSecret } from "./src/server/auth.js";
import { getSession } from "@auth/express";
import { appRouter } from "./src/server/router.js";
import { voiceRouter } from "./src/server/routers/voice.js";
import { chatUploadRouter } from "./src/server/routers/chatUpload.js";
import { generateInvoiceFilesOnDisk } from "./src/server/pdfHelper.js";
import { getEntityStoragePath, multerStorage, ingestFileToRag, syncVaultFilesToRag, COMPANIES_ROOT, CONTACTS_ROOT } from "./src/server/storage.js";
import { initWorkflowEngine } from "./src/server/ai/workflowEngine.js";
import { workflowEventBus } from "./src/server/ai/workflowEventBus.js";
import { executeCreateDraftInvoice, executeCreateDraftCompany, executeCreateDraftContact, executeCrmDataAnalyst } from "./src/server/ai/tools/crm.js";
import { runLouisAiFlow, executePassiveShortTermCompression, ConversationMessage } from "./src/server/ai/orchestrator.js";
import { ChatMessage } from "./src/types.js";
import { mcpAuthMiddleware, McpAuthenticatedRequest, validateMcpApiKey, McpContext } from "./src/server/mcp/auth.js";
import { handleMcpRequest } from "./src/server/mcp/mcpServer.js";
import { saveMcpOAuthToken, handleMcpOAuthCallback } from "./src/server/mcp/oauthHandler.js";
import { McpClientEngine } from "./src/server/mcp/mcpClientEngine.js";
import crypto from "crypto";

dotenv.config();

interface InvoiceWithRecipient {
  id_uuid?: string;
  invoice_number?: string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  entityType?: "companies" | "contacts";
  entityId?: string | null;
  entityName?: string | null;
  co_name?: string | null;
  ct_name?: string | null;
  payment_status?: string;
  metadata?: string | Record<string, unknown> | null;
  issue_date?: string | Date;
  company_name?: string | null;
}

interface ErrorWithCode extends Error {
  code?: string;
  validationReport?: {
    errors?: unknown[];
    warnings?: unknown[];
  };
  validationLogPath?: string;
}

interface FallbackStoreSession {
  id_uuid: string;
  tenant_id: string;
  session_title: string;
  conversation_history_json: ChatMessage[];
  short_term_summary_text?: string;
  created_at_utc: string;
  updated_at_utc: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Initialize Database
  await initDatabase();
  // Auth-Secret aus der DB laden (sys_app_security) — Regel: keine Einstellungen in Dateien
  await initAuthSecret();
  await seedDatabase();

  // Initialize CRM Workflow Automation Listeners
  initWorkflowEngine();

  const app = express();
  app.set("trust proxy", true);
  const PORT = parseInt(process.env.PORT || "3000", 10);

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // JSON-Parse-Fehler auf MCP-Pfaden → JSON-RPC -32700 statt HTML 400
  // (express.json wirft sonst einen SyntaxError, der als HTML "Bad Request" endet)
  app.use("/api/mcp", (err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" }
      });
      return;
    }
    next(err);
  });

  // --- MCP (Model Context Protocol) JSON-RPC 2.0 Endpoint ---
  app.post("/api/mcp", mcpAuthMiddleware, async (req: McpAuthenticatedRequest, res) => {
    try {
      const response = await handleMcpRequest(req.body, req.mcpContext!);
      res.json(response);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: { code: -32603, message: `Internal MCP error: ${msg}` }
      });
    }
  });

  app.get("/api/mcp", mcpAuthMiddleware, async (req: McpAuthenticatedRequest, res) => {
    res.json({
      name: "louis-smart-crm-mcp",
      status: "active",
      protocolVersion: "2024-11-05",
      tenantId: req.mcpContext?.tenantId,
      endpoint: "/api/mcp"
    });
  });

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
        const user = sessionRes?.user as { tenant_id?: string } | undefined;
        if (user?.tenant_id) {
          tenantId = user.tenant_id;
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
      const user = sessionRes?.user as { tenant_id?: string } | undefined;
      if (user?.tenant_id) {
        tenantId = user.tenant_id;
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

      // Projektarbeit P0-1: file.uploaded-Event auf dem UI-Pfad emittieren (Payload wie
      // saveFile). file_name = originalname (OHNE Date.now()-Präfix), damit
      // Trigger-Bedingungen wie `file_name contains X` matchen. Best-effort:
      // ein Event-Fehler darf den Upload nicht abbrechen.
      try {
        workflowEventBus.emitEvent(tenantId, "file.uploaded", {
          file_name: originalName,
          file_size_bytes: req.file.size,
          entity_type: type,
          entity_id: id,
          entity_name: name
        });
      } catch (eventErr) {
        console.error("[api/upload] Failed to emit file.uploaded event:", eventErr);
      }
    }

    res.json({ success: true, filename: req.file.filename });
  });

  app.use("/api/voice", voiceRouter);
  app.use("/api/chat", chatUploadRouter);

  app.get("/api/files/download", async (req, res) => {
    try {
      const rawPath = req.query.path as string | undefined;
      if (!rawPath) {
        return res.status(400).send("Missing path query parameter");
      }

      // Prevent Directory Traversal / Path Traversal:
      // Ensure the path does not contain ".."
      const cleanPath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
      if (rawPath.includes("..") || cleanPath.includes("..")) {
        return res.status(400).send("Invalid path specification");
      }

      let filePath = "";
      let resolvedFilename = "";

      if (cleanPath.startsWith("companies/") || cleanPath.startsWith("contacts/")) {
        // e.g. "companies/1/605db05b-80a5-4ef5-b1a7-e14bcf087928/angebot_AG-2026-0001.pdf"
        const parts = cleanPath.split("/");
        if (parts.length < 4) {
          return res.status(400).send("Invalid vault path format");
        }
        const type = parts[0]; // e.g. "companies"
        const tenantId = parts[1]; // e.g. "1"
        const entityId = parts[2]; // UUID
        const filename = parts.slice(3).join("/"); // e.g. "angebot_AG-2026-0001.pdf"

        const root = type === "companies" ? COMPANIES_ROOT : CONTACTS_ROOT;
        const tenantRoot = path.join(root, tenantId);
        if (!fs.existsSync(tenantRoot)) {
          return res.status(404).send("Tenant directory not found");
        }

        const existingDirs = fs.readdirSync(tenantRoot);
        const existingDirName = existingDirs.find(d => d.startsWith(entityId + "__"));
        if (!existingDirName) {
          return res.status(404).send("Entity directory not found");
        }

        filePath = path.join(tenantRoot, existingDirName, filename);
        resolvedFilename = filename;
      } else if (cleanPath.startsWith("knowledge_vault/") || cleanPath.startsWith("knowledge_data_vault/")) {
        // e.g. "knowledge_vault/offers/angebot_AG-2026-0001.pdf" or "knowledge_data_vault/1/doc.pdf"
        filePath = path.join(process.cwd(), cleanPath);
        resolvedFilename = path.basename(cleanPath);
      } else {
        return res.status(400).send("Unsupported file path category");
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(`File not found: ${resolvedFilename}`);
      }

      if (resolvedFilename.toLowerCase().endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      }
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(resolvedFilename)}"`);
      res.download(filePath, resolvedFilename);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[Download Path Error]:", error);
      res.status(500).send("Error downloading file: " + error.message);
    }
  });

  // Dedicated Route: Download file from Knowledge Base (knowledge_data_vault)
  app.get("/api/knowledge-files/download/:filename", async (req, res) => {
    try {
      let rawFilename = req.params.filename;
      try {
        rawFilename = decodeURIComponent(rawFilename);
      } catch (_) {}
      const filename = path.basename(rawFilename);

      let activeTenantId = "1";
      try {
        const sessionRes = await getSession(req, authConfig);
        const user = sessionRes?.user as { tenant_id?: string } | undefined;
        if (user?.tenant_id) {
          activeTenantId = user.tenant_id;
        }
      } catch (err) {
        console.warn("Session fetch failed in knowledge download:", err);
      }

      let KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", activeTenantId);
      let filePath = path.join(KNOWLEDGE_ROOT, filename);

      if (!fs.existsSync(filePath)) {
        // Search in fallback tenant "1"
        KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", "1");
        filePath = path.join(KNOWLEDGE_ROOT, filename);
      }

      if (!fs.existsSync(filePath)) {
        // Fuzzy search in tenant directory if exact case/encoding differs
        if (fs.existsSync(KNOWLEDGE_ROOT)) {
          const files = fs.readdirSync(KNOWLEDGE_ROOT);
          const matched = files.find(f => f.toLowerCase() === filename.toLowerCase() || encodeURIComponent(f) === req.params.filename);
          if (matched) {
            filePath = path.join(KNOWLEDGE_ROOT, matched);
          }
        }
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(`Datei nicht gefunden: ${filename}`);
      }

      if (filename.endsWith('.md')) {
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      }
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.download(filePath, filename);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[Download Knowledge File Error]:", error);
      res.status(500).send("Fehler beim Herunterladen der Datei: " + error.message);
    }
  });

  // Dedicated Route: Download individual Note / Knowledge entry as Markdown
  app.get("/api/notes/download/:id", async (req, res) => {
    try {
      const noteId = req.params.id;
      let activeTenantId = "1";
      let userId = "human_user";
      try {
        const sessionRes = await getSession(req, authConfig);
        const user = sessionRes?.user as { id?: string; email?: string; tenant_id?: string } | undefined;
        if (user?.tenant_id) activeTenantId = user.tenant_id;
        if (user?.id || user?.email) userId = user.id || user.email || "human_user";
      } catch (err) {
        console.warn("Session fetch failed in note download:", err);
      }

      let foundNote: {
        id_uuid: string;
        content: string;
        entity_type?: string;
        entity_id?: string;
        created_at_utc?: string;
        created_by_identity?: string;
        is_rag_indexed?: boolean;
      } | null = null;

      if (isUsingFallback) {
        if (fallbackStore.louisAiUserMemory) {
          const memory = fallbackStore.louisAiUserMemory.find((m) => m.user_id === userId && m.tenant_id === activeTenantId);
          if (memory && memory.chat_notes_json) {
            foundNote = memory.chat_notes_json.find((n) => n.id_uuid === noteId) || null;
          }
        }
      } else {
        const memRes = await pool.query(
          "SELECT chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1",
          [userId, activeTenantId]
        );
        if (memRes.rows.length > 0) {
          const chatNotes = typeof memRes.rows[0].chat_notes_json === 'string'
            ? JSON.parse(memRes.rows[0].chat_notes_json)
            : memRes.rows[0].chat_notes_json || [];
          foundNote = chatNotes.find((n: { id_uuid: string }) => n.id_uuid === noteId) || null;
        }
      }

      if (!foundNote) {
        return res.status(404).send("Notiz nicht gefunden.");
      }

      const createdAt = foundNote.created_at_utc ? new Date(foundNote.created_at_utc).toLocaleString("de-DE") : "N/A";
      const entityLabel = foundNote.entity_type === "company" ? "Firma" : foundNote.entity_type === "contact" ? "Kontakt" : "Persönliche Wissensnotiz";
      const ragStatus = foundNote.is_rag_indexed ? "Aktiv (RAG-Vektorspeicher)" : "Inaktiv";

      const markdownDoc = `# Wissensnotiz - Louis Smart CRM

**Kategorie / Zuordnung:** ${entityLabel} ${foundNote.entity_id ? `(ID: ${foundNote.entity_id})` : ""}
**Erstellt am:** ${createdAt}
**Ersteller:** ${foundNote.created_by_identity || "LOUIS CRM AI"}
**RAG-Index:** ${ragStatus}
**ID:** ${foundNote.id_uuid}

---

## Inhalt

${foundNote.content}
`;

      const filename = `wissensnotiz_${foundNote.entity_type || "notiz"}_${foundNote.id_uuid.slice(0, 8)}.md`;
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(markdownDoc);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[Download Note Error]:", error);
      res.status(500).send("Fehler beim Herunterladen der Notiz: " + error.message);
    }
  });

  app.get("/api/files/:type/:id/:name/:filename", async (req, res) => {
    const { type, id, name, filename } = req.params;
    let tenantId = "1";
    try {
      const sessionRes = await getSession(req, authConfig);
      const user = sessionRes?.user as { tenant_id?: string } | undefined;
      if (user?.tenant_id) {
        tenantId = user.tenant_id;
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
      const user = sessionRes?.user as { tenant_id?: string } | undefined;
      const activeTenantId = user?.tenant_id || "1";

      let invoice: InvoiceWithRecipient | undefined;
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

      const cleanNum = (invoice.invoice_number || "").replace(/[^a-zA-Z0-9_-]/g, '_');
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
    } catch (err: unknown) {
      const error = err as ErrorWithCode;
      console.error("Download PDF error:", error);
      // Differentiate compliance failures from generic server errors so the
      // frontend can surface a dedicated dialog instead of a generic toast.
      if (error && error.code === "INVOICE_FAILED_VALIDATION") {
        return res.status(422).json({
          code: "INVOICE_FAILED_VALIDATION",
          message: error.message,
          errors: error.validationReport?.errors ?? [],
          warnings: error.validationReport?.warnings ?? [],
          logPath: error.validationLogPath ?? null,
        });
      }
      // XRechnung pre-flight validations (Leitweg-ID, seller contact) throw
      // string-coded errors from zugferd.ts — surface them as 422 too.
      if (typeof error?.message === "string" && error.message.startsWith("xrechnung_")) {
        return res.status(422).json({ code: error.message, message: error.message });
      }
      res.status(500).send("Error generating/downloading PDF: " + error.message);
    }
  });

  app.get("/api/invoices/:invoiceId/download-xml", async (req, res) => {
    try {
      const { invoiceId } = req.params;
      const { lang } = req.query;
      const locale = typeof lang === 'string' ? lang : 'de';
      const sessionRes = await getSession(req, authConfig);
      const user = sessionRes?.user as { tenant_id?: string } | undefined;
      const activeTenantId = user?.tenant_id || "1";

      let invoice: InvoiceWithRecipient | undefined;
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

      const cleanNum = (invoice.invoice_number || "").replace(/[^a-zA-Z0-9_-]/g, '_');
      const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, activeTenantId);
      const displayXmlPath = path.join(entityStoragePath, `zugferd_${cleanNum}.xml`);

      if (!fs.existsSync(displayXmlPath)) {
        console.warn(`[Download XML] XML File not found. Searched path: ${displayXmlPath}`);
        return res.status(404).send(`XML File not found at path: ${displayXmlPath}`);
      }

      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="zugferd_${cleanNum}.xml"`);
      res.download(displayXmlPath, `zugferd_${cleanNum}.xml`);
    } catch (err: unknown) {
      const error = err as Error;
      console.error("Download XML error:", error);
      res.status(500).send("Error generating/downloading XML: " + error.message);
    }
  });

  // --- Auth.js Integration ---
  app.use("/api/auth/*", authMiddleware);

  // --- tRPC Middleware ---
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext: async ({ req } : { req: express.Request }) => {
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
          const cookieHeader = req.headers.cookie;
          const cookies: Record<string, string> = cookieHeader
            ? Object.fromEntries(
                cookieHeader.split(";").map((c: string) => {
                  const parts = c.trim().split("=");
                  return [parts[0], parts.slice(1).join("=")];
                })
              )
            : {};
          const explicitLogout = cookies["explicit_logout"] === "1";

          if (!explicitLogout) {
            session = {
              user: {
                id: "1",
                name: "Demo User",
                email: "demo@louis-crm.de",
                role: "admin" as const,
                tenant_id: "1",
              },
              expires: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString()
            };
          }
        }
        return { 
          session,
          tenantId: session?.user?.tenant_id || '1'
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
    } catch (err: unknown) {
      const error = err as Error;
      console.error("Error serving telegram config REST endpoint:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Model Context Protocol (MCP) Server Integration ---
  app.get("/api/mcp/oauth/callback", async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) {
        return res.status(400).send(`<html><body style="font-family:sans-serif;background:#0f172a;color:#fff;padding:2rem;"><h2>OAuth Autorisations-Fehler</h2><p>${error}</p></body></html>`);
      }
      if (!code || !state) {
        return res.status(400).send("<html><body style=\"font-family:sans-serif;background:#0f172a;color:#fff;padding:2rem;\"><h2>OAuth Fehler</h2><p>Fehlender Code oder State Parameter.</p></body></html>");
      }

      const redirectUri = `${req.protocol}://${req.get('host')}/api/mcp/oauth/callback`;
      await handleMcpOAuthCallback(String(code), String(state), redirectUri);

      try {
        const stateObj = JSON.parse(Buffer.from(String(state), 'base64').toString('utf8'));
        if (stateObj.serverId && stateObj.tenantId) {
          McpClientEngine.discoverTools(stateObj.serverId, stateObj.tenantId).catch(() => {});
        }
      } catch (_) {}

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Autorisierung erfolgreich</title>
            <style>
              body { font-family: system-ui, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #1e293b; padding: 2rem; border-radius: 1rem; border: 1px solid #334155; text-align: center; max-width: 400px; }
              h2 { color: #10b981; margin-top: 0; }
              p { color: #94a3b8; font-size: 14px; }
              a { display: inline-block; margin-top: 1rem; padding: 0.5rem 1rem; background: #f97316; color: #fff; text-decoration: none; border-radius: 0.5rem; font-weight: bold; }
            </style>
          </head>
          <body>
            <div class="card">
              <h2>✓ Autorisierung Erfolgreich!</h2>
              <p>Der MCP-Server wurde erfolgreich verknüpft.</p>
              <a href="/?tab=admin&subtab=mcp&oauth=success">Zurück zum CRM</a>
              <script>
                setTimeout(() => {
                  if (window.opener) {
                    window.opener.location.reload();
                    window.close();
                  } else {
                    window.location.href = '/?tab=admin&subtab=mcp&oauth=success';
                  }
                }, 1500);
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).send(`<html><body style="font-family:sans-serif;background:#0f172a;color:#fff;padding:2rem;"><h2>OAuth Callback Fehler</h2><p>${msg}</p></body></html>`);
    }
  });

  const activeMcpSessions = new Set<string>();

  app.get("/api/mcp/sse", mcpAuthMiddleware, (req, res) => {
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

  app.post("/api/mcp/message", mcpAuthMiddleware, async (req: McpAuthenticatedRequest, res) => {
    try {
      const sessionId = (req.headers["mcp-session-id"] || req.headers["x-mcp-session-id"] || req.query.sessionId) as string | undefined;
      if (sessionId) {
        res.setHeader("mcp-session-id", sessionId);
        if (!activeMcpSessions.has(sessionId)) {
          console.warn(`[MCP] Request received outside of active stream session: ${sessionId}`);
        }
      }

      const response = await handleMcpRequest(req.body, req.mcpContext!);
      if (response === undefined) {
        res.status(204).end();
      } else {
        res.json(response);
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error("[MCP] Error in message handler:", error);
      res.status(500).json({
        jsonrpc: "2.0",
        id: req.body?.id || null,
        error: {
          code: -32603,
          message: error.message || "Internal server error"
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
