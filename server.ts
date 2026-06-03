import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import multer from "multer";
import * as dotenv from "dotenv";

import { initDatabase, seedDatabase, isUsingFallback, pool, fallbackStore } from "./src/server/db.js";
import { authMiddleware, authConfig } from "./src/server/auth.js";
import { getSession } from "@auth/express";
import { appRouter } from "./src/server/router.js";
import { generateInvoiceFilesOnDisk } from "./src/server/pdfHelper.js";
import { getEntityStoragePath, multerStorage, ingestFileToRag, syncVaultFilesToRag } from "./src/server/storage.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  // Initialize Database
  await initDatabase();
  await seedDatabase();

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
