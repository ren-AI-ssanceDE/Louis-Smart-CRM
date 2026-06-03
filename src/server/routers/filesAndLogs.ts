import { z } from "zod";
import fs from "fs";
import path from "path";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { getEntityStoragePath, ingestFileToRag, unindexFileFromRag, forceManualIngest } from "../storage.js";

interface LouisAiKnowledgeMetadataExtended {
  id_uuid: string;
  tenant_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  document_hash: string;
  created_at_utc: string;
  updated_at_utc: string;
  scope?: string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  created_by_identity?: string;
  is_verified_by_human?: boolean;
}

interface DBRowIndexedFile {
  id_uuid: string;
  file_name: string;
  chunk_count: string | number;
}

interface MatchedInvoice {
  id_uuid: string;
  invoice_number: string;
  payment_status: string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  metadata?: string | Record<string, unknown> | null;
}

export const filesAndLogsRouter = router({
  // File Management
  getFiles: protectedProcedure
    .input(z.object({ type: z.enum(["companies", "contacts"]), id_uuid: z.string().uuid(), name: z.string() }))
    .output(z.array(z.object({ 
      name: z.string(), 
      size: z.number(), 
      mtime: z.string(),
      isIndexed: z.boolean().optional(),
      chunkCount: z.number().optional()
    })))
    .query(async ({ input, ctx }) => {
      const storagePath = getEntityStoragePath(input.type, input.id_uuid, input.name, ctx.tenantId);
      try {
        let indexedFiles: { id_uuid: string; file_name: string; chunk_count?: number }[] = [];

        if (isUsingFallback) {
          const metadata = (fallbackStore.louisAiKnowledgeMetadata || []) as LouisAiKnowledgeMetadataExtended[];
          const chunks = fallbackStore.louisAiKnowledgeChunks || [];
          const matchedMeta = metadata.filter((m: LouisAiKnowledgeMetadataExtended) => 
            m.tenant_id === ctx.tenantId && 
            (input.type === "companies" 
              ? m.associated_company_id === input.id_uuid 
              : m.associated_contact_id === input.id_uuid)
          );
          indexedFiles = matchedMeta.map((m: LouisAiKnowledgeMetadataExtended) => {
            const chunkCount = chunks.filter((c) => c.document_id === m.id_uuid).length;
            return { id_uuid: m.id_uuid, file_name: m.file_name, chunk_count: chunkCount };
          });
        } else {
          try {
            const res = await pool.query<DBRowIndexedFile>(
              `SELECT m.id_uuid, m.file_name, COUNT(c.id_uuid) as chunk_count
               FROM sys_louis_ai_knowledge_metadata m
               LEFT JOIN sys_louis_ai_knowledge_chunks c ON m.id_uuid = c.document_id
               WHERE m.tenant_id = $1 AND 
                     (m.associated_company_id = $2 OR m.associated_contact_id = $2)
               GROUP BY m.id_uuid, m.file_name`,
              [ctx.tenantId, input.id_uuid]
            );
            indexedFiles = res.rows.map((row: DBRowIndexedFile) => ({
              id_uuid: row.id_uuid,
              file_name: row.file_name,
              chunk_count: parseInt(String(row.chunk_count || 0))
            }));
          } catch (err) {
            console.error("Failed to query RAG document metadata:", err);
          }
        }

        const files = fs.readdirSync(storagePath);
        return files
          .map(file => {
            try {
              const fullPath = path.join(storagePath, file);
              const stats = fs.statSync(fullPath);
              
              const matchingMeta = indexedFiles.find(m => 
                file === m.file_name || file.endsWith("_" + m.file_name)
              );

              return {
                name: file,
                size: stats.size,
                mtime: stats.mtime.toISOString(),
                isDirectory: stats.isDirectory(),
                isIndexed: !!matchingMeta,
                chunkCount: matchingMeta ? (matchingMeta.chunk_count || 0) : 0,
              };
            } catch (e) {
              return null;
            }
          })
          .filter((item): item is NonNullable<typeof item> => {
            if (item === null || item.isDirectory) return false;
            if (input.type === "companies") {
              const nameLower = item.name.toLowerCase();
              if (nameLower.startsWith("rechnung_") || nameLower.startsWith("zugferd_") || nameLower.startsWith("invoice_")) {
                return false;
              }
            }
            return true;
          })
          .map(({ name, size, mtime, isIndexed, chunkCount }) => ({ 
            name, 
            size, 
            mtime, 
            isIndexed, 
            chunkCount 
          }));
      } catch (err) {
        return [];
      }
    }),

  saveFile: protectedProcedure
    .input(z.object({
      type: z.enum(["companies", "contacts"]),
      id_uuid: z.string().uuid(),
      name: z.string(),
      filename: z.string(),
      content: z.string(), // base64 encoded file content
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const storagePath = getEntityStoragePath(input.type, input.id_uuid, input.name, ctx.tenantId);
        const filePath = path.join(storagePath, input.filename);
        
        if (!fs.existsSync(storagePath)) {
          fs.mkdirSync(storagePath, { recursive: true });
        }

        const buffer = Buffer.from(input.content, 'base64');
        fs.writeFileSync(filePath, buffer);

        // Dynamic indexing for RAG
        const scope = input.type === "companies" ? "company" : "contact";
        ingestFileToRag(filePath, input.filename, ctx.tenantId, scope, input.id_uuid).catch((e) => {
          console.error("Failed to ingest file on saveFile:", e);
        });

        return { success: true };
      } catch (err) {
        console.error("[saveFile] Error saving file:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Fehler beim Speichern der Datei.",
        });
      }
    }),

  forceIngestFileToRag: protectedProcedure
    .input(z.object({
      type: z.enum(["companies", "contacts"]),
      id_uuid: z.string().uuid(),
      name: z.string(),
      filename: z.string()
    }))
    .output(z.object({ success: z.boolean(), chunkCount: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const storagePath = getEntityStoragePath(input.type, input.id_uuid, input.name, ctx.tenantId);
        const filePath = path.join(storagePath, input.filename);
        
        if (!fs.existsSync(filePath)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datei nicht gefunden."
          });
        }

        const scope = input.type === "companies" ? "company" : "contact";
        const chunkCount = await forceManualIngest(filePath, input.filename, ctx.tenantId, scope, input.id_uuid);
        return { success: true, chunkCount };
      } catch (err) {
        console.error("[forceIngestFileToRag] Manual RAG Ingest failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Manueller RAG Ingest fehlgeschlagen."
        });
      }
    }),

  getFileContent: protectedProcedure
    .input(z.object({
      type: z.enum(["companies", "contacts"]),
      id_uuid: z.string().uuid(),
      name: z.string(),
      filename: z.string(),
    }))
    .output(z.object({ content: z.string(), success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const storagePath = getEntityStoragePath(input.type, input.id_uuid, input.name, ctx.tenantId);
        const filePath = path.join(storagePath, input.filename);
        if (!fs.existsSync(filePath)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datei nicht gefunden.",
          });
        }
        const content = fs.readFileSync(filePath).toString('base64');
        return { content, success: true };
      } catch (err) {
        console.error("[getFileContent] Error reading file:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Fehler beim Lesen der Datei.",
        });
      }
    }),

  deleteFile: protectedProcedure
    .input(z.object({ type: z.enum(["companies", "contacts"]), id_uuid: z.string().uuid(), name: z.string(), filename: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const storagePath = getEntityStoragePath(input.type, input.id_uuid, input.name, ctx.tenantId);
        const filePath = path.join(storagePath, input.filename);
        
        if (!fs.existsSync(filePath)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Datei existiert nicht auf dem Server.",
          });
        }

        // Detect if this is a ZUGFeRD xml or invoice pdf, so we can clean up siblings
        let matchedInvoiceId: string | null = null;
        let cleanNum: string | null = null;
        let matchedInvoice: MatchedInvoice | null = null;

        if (input.filename.startsWith("rechnung_") && input.filename.endsWith(".pdf")) {
          cleanNum = input.filename.slice("rechnung_".length, -".pdf".length);
        } else if (input.filename.startsWith("zugferd_") && input.filename.endsWith(".xml")) {
          cleanNum = input.filename.slice("zugferd_".length, -".xml".length);
        }

        if (cleanNum) {
          if (isUsingFallback) {
            const invoices = fallbackStore.invoices.filter(i => 
              (i.associated_company_id === input.id_uuid || i.associated_contact_id === input.id_uuid)
            );
            const found = invoices.find(i => i.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_') === cleanNum);
            if (found) {
              matchedInvoice = {
                id_uuid: found.id_uuid || "",
                invoice_number: found.invoice_number,
                payment_status: found.payment_status,
                metadata: found.metadata
              };
              matchedInvoiceId = found.id_uuid || null;
            }
          } else {
            const invRes = await pool.query<MatchedInvoice>(`
              SELECT id_uuid, invoice_number, payment_status, metadata FROM fiscal_billing_invoices
              WHERE (associated_company_id = $1 OR associated_contact_id = $1)
                AND (tenant_id = $2 OR tenant_id = '1')
            `, [input.id_uuid, ctx.tenantId]);
            const found = invRes.rows.find(row => row.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_') === cleanNum);
            if (found) {
              matchedInvoice = found;
              matchedInvoiceId = found.id_uuid;
            }
          }
        } else if (input.filename.includes("invoice_") || input.filename.includes("zugferd_")) {
          // Resolve by uuid if in nested folders
          const uuidMatch = input.filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
          if (uuidMatch) {
            const targetUuid = uuidMatch[0];
            if (isUsingFallback) {
              const found = fallbackStore.invoices.find(i => i.id_uuid === targetUuid);
              if (found) {
                matchedInvoice = {
                  id_uuid: found.id_uuid || "",
                  invoice_number: found.invoice_number,
                  payment_status: found.payment_status,
                  metadata: found.metadata
                };
              }
            } else {
              const invRes = await pool.query<MatchedInvoice>(`
                SELECT id_uuid, invoice_number, payment_status, metadata FROM fiscal_billing_invoices
                WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')
                LIMIT 1
              `, [targetUuid, ctx.tenantId]);
              if (invRes.rows.length > 0) {
                matchedInvoice = invRes.rows[0];
              }
            }
          }
        }

        if (matchedInvoice) {
          let isFinalized = false;
          let meta: Record<string, unknown> & { is_finalized?: boolean } = {};
          try {
            meta = typeof matchedInvoice.metadata === 'string' 
              ? JSON.parse(matchedInvoice.metadata) 
              : (matchedInvoice.metadata || {}) as Record<string, unknown> & { is_finalized?: boolean };
          } catch (_) {}
          if (meta.is_finalized || matchedInvoice.payment_status === 'paid') {
            isFinalized = true;
          }

          if (isFinalized) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Diese Rechnung ist final abgeschlossen. PDF- und XML-Dateien von abgeschlossenen Rechnungen können weder verändert noch gelöscht werden.",
            });
          }
        }

        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }

        // Unindex file from RAG store
        unindexFileFromRag(input.filename, ctx.tenantId, input.id_uuid).catch((e) => {
          console.error("Failed to unindex file on deleteFile:", e);
        });

        // If it was an invoice file, clear siblings/nested versions
        if (cleanNum) {
          const siblingPdf = path.join(storagePath, `rechnung_${cleanNum}.pdf`);
          const siblingXml = path.join(storagePath, `zugferd_${cleanNum}.xml`);
          if (fs.existsSync(siblingPdf)) {
            try { fs.unlinkSync(siblingPdf); } catch (e) {}
          }
          if (fs.existsSync(siblingXml)) {
            try { fs.unlinkSync(siblingXml); } catch (e) {}
          }
          if (matchedInvoiceId) {
            const nestedPdf = path.join(storagePath, "invoices", `invoice_${matchedInvoiceId}.pdf`);
            const nestedXml = path.join(storagePath, "invoices", `zugferd_${matchedInvoiceId}.xml`);
            if (fs.existsSync(nestedPdf)) {
              try { fs.unlinkSync(nestedPdf); } catch (e) {}
            }
            if (fs.existsSync(nestedXml)) {
              try { fs.unlinkSync(nestedXml); } catch (e) {}
            }
          }
          console.log(`[deleteFile] Cascadingly deleted all disk files matching invoice clean num: ${cleanNum}`);
        }

        return { success: true };
      } catch (err) {
        console.error("[deleteFile] Error deleting item:", err);
        if (err instanceof TRPCError) throw err;
        const errorMsg = err instanceof Error ? err.message : "Fehler beim Löschen der Datei.";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMsg,
        });
      }
    }),

  // Audit Logs
  getAuditLogs: protectedProcedure
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return (fallbackStore.auditLogs || []).filter(log => log.tenant_id === ctx.tenantId || log.tenant_id === '1');
      }
      const res = await pool.query(`
        SELECT * FROM sys_audit_event_logs 
        WHERE tenant_id = $1 OR tenant_id = '1'
        ORDER BY created_at_utc DESC LIMIT 100
      `, [ctx.tenantId]);
      return res.rows;
    })
});
