import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getSession } from "@auth/express";
import { authConfig } from "../auth.js";
import { forceManualIngest, intelligentChunkAndProcess } from "../storage.js";

export const chatUploadRouter = Router();

// Supported file types for chat attachments: anything from which we can
// extract plain text to send to the LLM. Images / audio are not supported.
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".csv", ".txt", ".md", ".json", ".xml",
  ".log", ".html", ".js", ".ts", ".py", ".java", ".cpp", ".css", ".yaml", ".yml",
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
const CHAT_ATTACHMENTS_DIR = path.join(process.cwd(), "uploads", "chat-attachments");

// Ensure uploads/chat-attachments directory exists
if (!fs.existsSync(CHAT_ATTACHMENTS_DIR)) {
  fs.mkdirSync(CHAT_ATTACHMENTS_DIR, { recursive: true });
}

const upload = multer({
  dest: path.join(process.cwd(), "uploads", "tmp"),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

function sanitizeFileName(originalName: string): string {
  const base = path.basename(originalName || "datei").replace(/[^\w.\- ]+/g, "_").trim();
  return base.length > 0 ? base : "datei.txt";
}

function getExtension(filename: string): string {
  return path.extname(filename).toLowerCase();
}

/** Extract readable text from an uploaded file (reuses the RAG parser). */
export async function extractTextFromBuffer(buffer: Buffer, filename: string): Promise<string> {
  const chunks = await intelligentChunkAndProcess(buffer, filename, 5000, 200);
  return chunks.join("\n\n");
}

/**
 * POST /api/chat/upload
 * multipart/form-data:
 *   - file: the uploaded document
 *   - indexInKnowledgeBase: 'true' | 'false' — permanently index in the RAG knowledge base
 * Response: ChatUploadResponseSchema
 */
chatUploadRouter.post("/upload", upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Keine Datei empfangen." });
      return;
    }

    const tempPath = req.file.path;
    const originalName = req.file.originalname || req.file.filename || "datei";
    const ext = getExtension(originalName);

    // Reject unsupported file types (no text extraction possible)
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      res.status(400).json({
        error: `Dateityp "${ext || "(ohne Endung)"}" wird nicht unterstützt. Erlaubt: PDF, DOCX, XLSX, CSV, TXT, MD, JSON, XML, HTML, Log, YAML, Code-Dateien.`
      });
      return;
    }

    // Resolve tenant + actor from the session (same pattern as /api/voice/transcribe)
    let tenantId = "1";
    let actorIdentity = "human_user";
    try {
      const sessionRes = await getSession(req, authConfig);
      if (sessionRes?.user) {
        const u = sessionRes.user as { tenant_id?: string; email?: string; name?: string };
        tenantId = u.tenant_id || "1";
        actorIdentity = u.email || u.name || "human_user";
      }
    } catch (err) {
      console.warn("Failed to retrieve session in /api/chat/upload:", err);
    }

    const indexInKnowledgeBase = String(req.body?.indexInKnowledgeBase || req.query?.indexInKnowledgeBase || "false") === "true";
    const attachmentId = uuidv4();
    const safeName = sanitizeFileName(originalName);
    const storedFileName = `${attachmentId}${ext}`;
    const finalPath = path.join(CHAT_ATTACHMENTS_DIR, storedFileName);
    // Sidecar-Endung ist kollisionsfrei: auch wenn ext === ".txt" ist, kann die
    // Binärdatei (<uuid>.txt) nie mit der Sidecar (<uuid>.extracted.txt) verwechselt werden.
    const textFilePath = path.join(CHAT_ATTACHMENTS_DIR, `${attachmentId}.extracted.txt`);

    try {
      // Move the temp file into the chat attachments vault
      fs.renameSync(tempPath, finalPath);
    } catch {
      // Cross-device rename can fail — fall back to copy + delete
      fs.copyFileSync(tempPath, finalPath);
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }

    const buffer = fs.readFileSync(finalPath);
    const mimeType = req.file.mimetype || "application/octet-stream";

    // 1. Extract plain text (sidecar .txt) — this is what gets sent to the LLM
    let extractedText = "";
    try {
      extractedText = await extractTextFromBuffer(buffer, safeName);
    } catch (extractErr) {
      console.warn(`[chatUpload] Text extraction failed for "${safeName}":`, extractErr);
      extractedText = buffer.toString("utf8").replace(/[^\x20-\x7E\u00C0-\u024F\n\r\t]/g, "");
    }
    fs.writeFileSync(textFilePath, extractedText, "utf8");

    // 2. Optionally index permanently into the RAG knowledge base.
    // Die Datei muss dafür im kanonischen Wissensdatenbank-Vault liegen
    // (knowledge_data_vault/<tenantId>/), sonst erscheint sie in der
    // Wissensdatenbank-Ansicht (getKnowledgeFiles ist filesystem-basiert) nicht.
    let isIndexed = false;
    if (indexInKnowledgeBase) {
      try {
        const knowledgeVaultDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
        if (!fs.existsSync(knowledgeVaultDir)) {
          fs.mkdirSync(knowledgeVaultDir, { recursive: true });
        }
        const knowledgeVaultPath = path.join(knowledgeVaultDir, safeName);
        fs.copyFileSync(finalPath, knowledgeVaultPath);
        const chunkCount = await forceManualIngest(knowledgeVaultPath, safeName, tenantId, "global", undefined, actorIdentity);
        isIndexed = chunkCount > 0;
        if (!isIndexed) {
          console.warn(`[chatUpload] forceManualIngest produced no chunks for "${safeName}" — metadata may still be recorded.`);
        }
      } catch (ingestErr) {
        console.error(`[chatUpload] Knowledge base indexing failed for "${safeName}":`, ingestErr);
        isIndexed = false;
      }
    }

    const preview = extractedText.slice(0, 500);

    res.json({
      attachmentId,
      fileName: safeName,
      fileSizeBytes: buffer.length,
      mimeType,
      isIndexedInKnowledgeBase: isIndexed,
      extractedCharCount: extractedText.length,
      extractedTextPreview: preview || undefined,
    });
  } catch (err) {
    console.error("[chatUpload] Upload failed:", err);
    // Best-effort cleanup of the temp file
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
    }
    res.status(500).json({ error: "Upload fehlgeschlagen: " + (err instanceof Error ? err.message : String(err)) });
  }
});
