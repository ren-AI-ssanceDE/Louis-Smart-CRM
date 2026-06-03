import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { pool, fallbackStore, isUsingFallback, saveFallbackStore } from "./db.js";
import * as db from "./db.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Roots should be relative to the project root
export const COMPANIES_ROOT = path.resolve(__dirname, "../../companies_data_vault");
export const CONTACTS_ROOT = path.resolve(__dirname, "../../contacts_data_vault");

if (!fs.existsSync(COMPANIES_ROOT)) fs.mkdirSync(COMPANIES_ROOT, { recursive: true });
if (!fs.existsSync(CONTACTS_ROOT)) fs.mkdirSync(CONTACTS_ROOT, { recursive: true });

export function getEntityStoragePath(type: string, id: string, name: string, tenantId: string = '1') {
  const isCompany = type === "companies" || type === "company" || type === "companies_data_vault";
  const root = isCompany ? COMPANIES_ROOT : CONTACTS_ROOT;
  const tenantRoot = path.join(root, tenantId);

  if (!fs.existsSync(tenantRoot)) {
    fs.mkdirSync(tenantRoot, { recursive: true });
  }

  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const newDirName = `${id}__${safeName}`;
  const newFullPath = path.join(tenantRoot, newDirName);

  const existingDirs = fs.readdirSync(tenantRoot);
  const existingDirName = existingDirs.find(d => d.startsWith(id + "__"));

  if (existingDirName) {
    const existingFullPath = path.join(tenantRoot, existingDirName);
    if (existingDirName !== newDirName) {
      try {
        fs.renameSync(existingFullPath, newFullPath);
        return newFullPath;
      } catch (err) {
        console.error("Failed to rename storage directory:", err);
        return existingFullPath;
      }
    }
    return existingFullPath;
  }

  if (!fs.existsSync(newFullPath)) {
    fs.mkdirSync(newFullPath, { recursive: true });
  }
  return newFullPath;
}

export async function generateEmbedding(text: string, tenantId: string = '1') {
  let customApiKey = "";
  try {
    if (db.isUsingFallback) {
      const found = (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === tenantId) || (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === '1');
      if (found && found.api_key_secret) {
        customApiKey = found.api_key_secret.trim();
      }
    } else {
      const res = await pool.query(
        "SELECT api_key_secret FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0 && res.rows[0].api_key_secret) {
        customApiKey = res.rows[0].api_key_secret.trim();
      }
    }
  } catch (err) {
    console.warn("Failed to load api key from Louis AI config for embeddings:", err);
  }

  if (customApiKey.includes('@') || customApiKey === '******') {
    customApiKey = '';
  }

  if (!customApiKey) {
    console.warn(`No custom GEMINI_API_KEY configured for tenant ${tenantId}. Skipping embedding generation.`);
    return null;
  }

  try {
    const genAI = new GoogleGenAI({
      apiKey: customApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const result = await genAI.models.embedContent({
      model: "gemini-embedding-2-preview",
      contents: [text],
    });
    return result.embeddings?.[0]?.values;
  } catch (err) {
    console.error("Embedding generation failed:", err);
    return null;
  }
}

export const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = (req.body?.type || req.query?.type) as string | undefined;
    const id = (req.body?.id || req.query?.id) as string | undefined;
    const name = (req.body?.name || req.query?.name) as string | undefined;

    if (!type || !id || !name) {
      return cb(new Error("Missing entity context for upload"), "");
    }
    cb(null, getEntityStoragePath(type, id, name));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname);
  }
});

// Check if format is text-parseable or indexable for autonomous background ingestion (excluding pdf which is manual trigger-only)
export function isTextBasedFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  const list = ['.txt', '.md', '.json', '.csv', '.xml', '.log', '.html', '.js', '.ts', '.py', '.java', '.cpp', '.css', '.yaml', '.yml', '.docx', '.xlsx'];
  return list.includes(ext);
}

export function mimeTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.txt': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.json': return 'application/json';
    case '.csv': return 'text/csv';
    case '.xml': return 'text/xml';
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

export function chunkTextString(text: string, chunkSize: number = 500, chunkOverlap: number = 100): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(" "));
    i += (chunkSize - chunkOverlap);
    if (chunkSize - chunkOverlap <= 0) {
      break;
    }
  }
  return chunks.filter(c => c.trim().length > 0);
}

function splitTextBySizedChunks(text: string, chunkSize: number = 500, chunkOverlap: number = 100): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(" "));
    i += (chunkSize - chunkOverlap);
    if (chunkSize - chunkOverlap <= 0) break;
  }
  return chunks;
}

function splitTextOrMarkdown(text: string, chunkSize: number = 500, chunkOverlap: number = 100): string[] {
  if (text.includes('# ')) {
    const segments = text.split(/(?=\n#+ )/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const segment of segments) {
      if ((currentChunk + segment).length > chunkSize) {
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
        }
        if (segment.length > chunkSize) {
          const subChunks = splitTextBySizedChunks(segment, chunkSize, chunkOverlap);
          chunks.push(...subChunks);
          currentChunk = "";
        } else {
          currentChunk = segment;
        }
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + segment;
      }
    }
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    if ((currentChunk + para).length > chunkSize) {
      if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
      }
      if (para.length > chunkSize) {
        const subChunks = splitTextBySizedChunks(para, chunkSize, chunkOverlap);
        chunks.push(...subChunks);
        currentChunk = "";
      } else {
        currentChunk = para;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

function splitSourceCode(text: string, ext: string): string[] {
  const lines = text.split(/\r?\n/);
  const chunks: string[] = [];
  let currentBlock: string[] = [];
  let lineCount = 0;

  const isBlockStart = (line: string): boolean => {
    const trimmed = line.trim();
    if (ext === '.py') {
      return trimmed.startsWith('def ') || trimmed.startsWith('class ');
    }
    return trimmed.startsWith('function ') || 
           trimmed.startsWith('class ') || 
           trimmed.startsWith('public ') || 
           trimmed.startsWith('private ') || 
           trimmed.startsWith('async function ') ||
           trimmed.startsWith('export class ') ||
           trimmed.startsWith('export function ');
  };

  for (const line of lines) {
    if ((isBlockStart(line) && currentBlock.length > 5) || lineCount >= 40) {
      chunks.push(currentBlock.join("\n"));
      currentBlock = [];
      lineCount = 0;
    }
    currentBlock.push(line);
    if (line.trim().length > 0) {
      lineCount++;
    }
  }

  if (currentBlock.length > 0) {
    chunks.push(currentBlock.join("\n"));
  }

  return chunks;
}

export async function intelligentChunkAndProcess(
  buffer: Buffer,
  filename: string,
  chunkSize: number = 500,
  chunkOverlap: number = 100
): Promise<string[]> {
  const ext = path.extname(filename).toLowerCase();
  let chunks: string[] = [];

  try {
    if (ext === '.pdf') {
      const parsed = await pdf(buffer);
      const text = parsed.text || "";
      chunks = splitTextBySizedChunks(text, chunkSize, chunkOverlap);
    } 
    else if (ext === '.docx') {
      const parsed = await mammoth.extractRawText({ buffer });
      const text = parsed.value || "";
      chunks = splitTextOrMarkdown(text, chunkSize, chunkOverlap);
    } 
    else if (ext === '.xlsx') {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet);
        for (const row of jsonRows) {
          chunks.push(`[Tabelle: ${sheetName}] ${JSON.stringify(row)}`);
        }
      }
    } 
    else if (ext === '.csv') {
      const text = buffer.toString("utf8");
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length > 0) {
        const delimiter = text.includes(';') ? ';' : ',';
        const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
          const rowObj: any = {};
          headers.forEach((header, index) => {
            rowObj[header] = values[index] || "";
          });
          chunks.push(JSON.stringify(rowObj));
        }
      }
    } 
    else if (['.html', '.xml'].includes(ext)) {
      let text = buffer.toString("utf8");
      if (ext === '.html') {
        text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      }
      chunks = splitTextOrMarkdown(text, chunkSize, chunkOverlap);
    } 
    else if (['.py', '.js', '.ts', '.java', '.cpp', '.css'].includes(ext)) {
      const text = buffer.toString("utf8");
      chunks = splitSourceCode(text, ext);
    } 
    else {
      const text = buffer.toString("utf8");
      chunks = splitTextOrMarkdown(text, chunkSize, chunkOverlap);
    }
  } catch (err) {
    console.error(`Error in intelligentChunkAndProcess for ${filename}:`, err);
    const text = buffer.toString("utf8").replace(/[^\x20-\x7E\s]/g, '');
    chunks = splitTextBySizedChunks(text, chunkSize, chunkOverlap);
  }

  return chunks.filter(c => c.trim().length > 0);
}

export async function getRagConfig(tenantId: string) {
  return {
    chunkSize: 500,
    chunkOverlap: 100
  };
}

export async function ingestFileToRag(
  filePath: string,
  filename: string,
  tenantId: string,
  scope: 'company' | 'contact' | 'global',
  associatedId?: string,
  creatorIdentity: string = 'human'
) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[ingestFileToRag] File does not exist at path: ${filePath}`);
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const docHash = crypto.createHash('md5').update(buffer).digest('hex');
    const docId = uuidv4();
    const mimeType = mimeTypeFromFilename(filename);

    let isDuplicate = false;
    if (isUsingFallback || !pool) {
      if (!fallbackStore.louisAiKnowledgeMetadata) {
        fallbackStore.louisAiKnowledgeMetadata = [];
      }
      const existing = fallbackStore.louisAiKnowledgeMetadata.find(
        (m: any) => m.tenant_id === tenantId && m.document_hash === docHash
      );
      if (existing) isDuplicate = true;
    } else {
      const res = await pool.query(
        "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND document_hash = $2 LIMIT 1",
        [tenantId, docHash]
      );
      if (res.rows.length > 0) isDuplicate = true;
    }

    if (isDuplicate) {
      console.log(`[ingestFileToRag] Document "${filename}" already indexed.`);
      return;
    }

    // Save metadata
    const metadataRecord: any = {
      id_uuid: docId,
      tenant_id: tenantId,
      scope,
      associated_company_id: scope === 'company' ? associatedId : null,
      associated_contact_id: scope === 'contact' ? associatedId : null,
      file_name: filename,
      file_size_bytes: buffer.length,
      mime_type: mimeType,
      document_hash: docHash,
      created_by_identity: creatorIdentity,
      is_verified_by_human: false,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    };

    if (isUsingFallback || !pool) {
      fallbackStore.louisAiKnowledgeMetadata.push(metadataRecord);
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_knowledge_metadata 
         (id_uuid, tenant_id, scope, associated_company_id, associated_contact_id, file_name, file_size_bytes, mime_type, document_hash, created_by_identity, is_verified_by_human, created_at_utc, updated_at_utc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          docId,
          tenantId,
          scope,
          scope === 'company' ? associatedId : null,
          scope === 'contact' ? associatedId : null,
          filename,
          buffer.length,
          mimeType,
          docHash,
          creatorIdentity,
          false
        ]
      );
    }

    // Chunk and embed if text based
    if (isTextBasedFile(filename)) {
      const ragConfig = await getRagConfig(tenantId);
      const chunks = await intelligentChunkAndProcess(buffer, filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

      if (chunks.length === 0) {
        console.log(`[ingestFileToRag] No chunks extracted from "${filename}". Skipped indexing.`);
        return;
      }

      console.log(`[ingestFileToRag] Extracted ${chunks.length} chunks for "${filename}" using intelligent parsing`);

      for (const textChunk of chunks) {
        const chunkId = uuidv4();
        let embeddingValues: number[] | null = null;
        try {
          embeddingValues = await generateEmbedding(textChunk, tenantId);
        } catch (embedErr) {
          console.warn(`[ingestFileToRag] Embedding failed for chunk`, embedErr);
        }

        if (isUsingFallback || !pool) {
          if (!fallbackStore.louisAiKnowledgeChunks) {
            fallbackStore.louisAiKnowledgeChunks = [];
          }
          fallbackStore.louisAiKnowledgeChunks.push({
            id_uuid: chunkId,
            tenant_id: tenantId,
            document_id: docId,
            chunk_text: textChunk,
            embedding: embeddingValues,
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          });
        } else {
          const vectorStr = embeddingValues ? `[${embeddingValues.join(",")}]` : null;
          await pool.query(
            `INSERT INTO sys_louis_ai_knowledge_chunks (id_uuid, tenant_id, document_id, chunk_text, embedding, created_at_utc, updated_at_utc)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [chunkId, tenantId, docId, textChunk, vectorStr]
          );
        }
      }

      if (isUsingFallback || !pool) {
        saveFallbackStore();
      }
    }
  } catch (err) {
    console.error(`[ingestFileToRag] Error ingesting file "${filename}":`, err);
  }
}

export async function forceManualIngest(
  filePath: string,
  filename: string,
  tenantId: string,
  scope: 'company' | 'contact' | 'global',
  associatedId?: string,
  creatorIdentity: string = 'human'
): Promise<number> {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[forceManualIngest] File does not exist at path: ${filePath}`);
      return 0;
    }

    // 1. Cleane existierenden Index für dieses Dokument vorab, um Duplikate zu vermeiden
    await unindexFileFromRag(filename, tenantId, associatedId);

    const buffer = fs.readFileSync(filePath);
    const docHash = crypto.createHash('md5').update(buffer).digest('hex');
    const docId = uuidv4();
    const mimeType = mimeTypeFromFilename(filename);

    const metadataRecord: any = {
      id_uuid: docId,
      tenant_id: tenantId,
      scope,
      associated_company_id: scope === 'company' ? associatedId : null,
      associated_contact_id: scope === 'contact' ? associatedId : null,
      file_name: filename,
      file_size_bytes: buffer.length,
      mime_type: mimeType,
      document_hash: docHash,
      created_by_identity: creatorIdentity,
      is_verified_by_human: true,
      created_at_utc: new Date().toISOString(),
      updated_at_utc: new Date().toISOString()
    };

    if (isUsingFallback || !pool) {
      if (!fallbackStore.louisAiKnowledgeMetadata) {
        fallbackStore.louisAiKnowledgeMetadata = [];
      }
      fallbackStore.louisAiKnowledgeMetadata.push(metadataRecord);
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_knowledge_metadata 
         (id_uuid, tenant_id, scope, associated_company_id, associated_contact_id, file_name, file_size_bytes, mime_type, document_hash, created_by_identity, is_verified_by_human, created_at_utc, updated_at_utc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          docId,
          tenantId,
          scope,
          scope === 'company' ? associatedId : null,
          scope === 'contact' ? associatedId : null,
          filename,
          buffer.length,
          mimeType,
          docHash,
          creatorIdentity,
          true
        ]
      );
    }

    const ragConfig = await getRagConfig(tenantId);
    const chunks = await intelligentChunkAndProcess(buffer, filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

    console.log(`[forceManualIngest] Processed ${chunks.length} chunks for "${filename}"`);

    for (const textChunk of chunks) {
      const chunkId = uuidv4();
      let embeddingValues: number[] | null = null;
      try {
        embeddingValues = await generateEmbedding(textChunk, tenantId);
      } catch (embedErr) {
        console.warn(`[forceManualIngest] Embedding failed for chunk`, embedErr);
      }

      if (isUsingFallback || !pool) {
        if (!fallbackStore.louisAiKnowledgeChunks) {
          fallbackStore.louisAiKnowledgeChunks = [];
        }
        fallbackStore.louisAiKnowledgeChunks.push({
          id_uuid: chunkId,
          tenant_id: tenantId,
          document_id: docId,
          chunk_text: textChunk,
          embedding: embeddingValues,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
      } else {
        const vectorStr = embeddingValues ? `[${embeddingValues.join(",")}]` : null;
        await pool.query(
          `INSERT INTO sys_louis_ai_knowledge_chunks (id_uuid, tenant_id, document_id, chunk_text, embedding, created_at_utc, updated_at_utc)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [chunkId, tenantId, docId, textChunk, vectorStr]
        );
      }
    }

    if (isUsingFallback || !pool) {
      saveFallbackStore();
    }

    return chunks.length;
  } catch (err) {
    console.error(`[forceManualIngest] Error manually ingesting file "${filename}":`, err);
    return 0;
  }
}

export async function unindexFileFromRag(filename: string, tenantId: string, associatedId?: string) {
  try {
    if (isUsingFallback || !pool) {
      if (fallbackStore.louisAiKnowledgeMetadata) {
        const foundIndex = fallbackStore.louisAiKnowledgeMetadata.findIndex(
          (m: any) => m.tenant_id === tenantId && 
                      m.file_name === filename && 
                      (associatedId ? (m.associated_company_id === associatedId || m.associated_contact_id === associatedId) : true)
        );
        if (foundIndex !== -1) {
          const docId = fallbackStore.louisAiKnowledgeMetadata[foundIndex].id_uuid;
          fallbackStore.louisAiKnowledgeMetadata.splice(foundIndex, 1);
          if (fallbackStore.louisAiKnowledgeChunks) {
            fallbackStore.louisAiKnowledgeChunks = fallbackStore.louisAiKnowledgeChunks.filter((c: any) => c.document_id !== docId);
          }
          saveFallbackStore();
        }
      }
    } else {
      let queryStr = "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND file_name = $2";
      const params: any[] = [tenantId, filename];
      if (associatedId) {
        queryStr += " AND (associated_company_id = $3 OR associated_contact_id = $3)";
        params.push(associatedId);
      }
      queryStr += " LIMIT 1";

      const res = await pool.query(queryStr, params);
      if (res.rows.length > 0) {
        const docId = res.rows[0].id_uuid;
        await pool.query("DELETE FROM sys_louis_ai_knowledge_metadata WHERE id_uuid = $1 AND tenant_id = $2", [docId, tenantId]);
      }
    }
    console.log(`[unindexFileFromRag] Successfully unindexed "${filename}" associated with ${associatedId || 'global'}`);
  } catch (err) {
    console.error(`[unindexFileFromRag] Error unindexing file "${filename}":`, err);
  }
}

export async function syncVaultFilesToRag(tenantId: string = "1") {
  try {
    const listDirsSafe = (dir: string) => {
      if (!fs.existsSync(dir)) return [];
      try { return fs.readdirSync(dir); } catch { return []; }
    };

    // Scan companies vault
    const companiesTenantRoot = path.join(COMPANIES_ROOT, tenantId);
    const companyDirs = listDirsSafe(companiesTenantRoot);
    for (const dirName of companyDirs) {
      if (dirName.includes("__")) {
        const parts = dirName.split("__");
        const companyId = parts[0];
        const dirPath = path.join(companiesTenantRoot, dirName);
        const files = listDirsSafe(dirPath);
        for (const filename of files) {
          const filePath = path.join(dirPath, filename);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            await ingestFileToRag(filePath, filename, tenantId, "company", companyId);
          }
        }
      }
    }

    // Scan contacts vault
    const contactsTenantRoot = path.join(CONTACTS_ROOT, tenantId);
    const contactDirs = listDirsSafe(contactsTenantRoot);
    for (const dirName of contactDirs) {
      if (dirName.includes("__")) {
        const parts = dirName.split("__");
        const contactId = parts[0];
        const dirPath = path.join(contactsTenantRoot, dirName);
        const files = listDirsSafe(dirPath);
        for (const filename of files) {
          const filePath = path.join(dirPath, filename);
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            await ingestFileToRag(filePath, filename, tenantId, "contact", contactId);
          }
        }
      }
    }
  } catch (err) {
    console.error("[syncVaultFilesToRag] Sync process encountered errors:", err);
  }
}
