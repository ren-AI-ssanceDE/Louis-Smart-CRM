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
import { LouisAiKnowledgeMetadata, LouisAiKnowledgeChunk, LouisAiConfig, CustomWorkflow, WorkflowInstance, Contact, Company } from "../types.js";

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
      const found = (fallbackStore.louisAiConfig || []).find((c: LouisAiConfig) => c.tenant_id === tenantId) || (fallbackStore.louisAiConfig || []).find((c: LouisAiConfig) => c.tenant_id === '1');
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
          const rowObj: Record<string, string> = {};
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
        (m: LouisAiKnowledgeMetadata) => m.tenant_id === tenantId && m.document_hash === docHash
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
    const metadataRecord: LouisAiKnowledgeMetadata = {
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

    const metadataRecord: LouisAiKnowledgeMetadata = {
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
          (m: LouisAiKnowledgeMetadata) => m.tenant_id === tenantId && 
                      m.file_name === filename && 
                      (associatedId ? (m.associated_company_id === associatedId || m.associated_contact_id === associatedId) : true)
        );
        if (foundIndex !== -1) {
          const docId = fallbackStore.louisAiKnowledgeMetadata[foundIndex].id_uuid;
          fallbackStore.louisAiKnowledgeMetadata.splice(foundIndex, 1);
          if (fallbackStore.louisAiKnowledgeChunks) {
            fallbackStore.louisAiKnowledgeChunks = fallbackStore.louisAiKnowledgeChunks.filter((c: LouisAiKnowledgeChunk) => c.document_id !== docId);
          }
          saveFallbackStore();
        }
      }
    } else {
      let queryStr = "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND file_name = $2";
      const params: unknown[] = [tenantId, filename];
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

interface LouisAiKnowledgeMetadataExtended {
  id_uuid: string;
  tenant_id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string;
  document_hash: string;
  scope?: string;
  associated_company_id?: string | null;
  associated_contact_id?: string | null;
  created_by_identity?: string;
  is_verified_by_human?: boolean;
  created_at_utc: string;
  updated_at_utc: string;
}

interface SaveEmailEntityParams {
  tenantId: string;
  scope: 'contact' | 'company';
  entityId: string;
  entityName: string;
  filename: string;
  buffer: Buffer;
  docHash: string;
  mimeType: string;
  creatorIdentity: 'human' | 'ai';
}

interface SaveEmailGlobalParams {
  tenantId: string;
  filename: string;
  buffer: Buffer;
  docHash: string;
  mimeType: string;
  creatorIdentity: 'human' | 'ai';
}

async function saveEmailToGlobalRag(params: SaveEmailGlobalParams): Promise<void> {
  const { tenantId, filename, buffer, docHash, mimeType, creatorIdentity } = params;
  
  // Check duplicate inside global scope
  let isDuplicate = false;
  if (isUsingFallback || !pool) {
    if (!fallbackStore.louisAiKnowledgeMetadata) {
      fallbackStore.louisAiKnowledgeMetadata = [];
    }
    const existing = (fallbackStore.louisAiKnowledgeMetadata as LouisAiKnowledgeMetadataExtended[]).find(
      (m: LouisAiKnowledgeMetadataExtended) => 
        m.tenant_id === tenantId && 
        m.document_hash === docHash && 
        m.scope === 'global'
    );
    if (existing) isDuplicate = true;
  } else {
    const res = await pool.query(
      "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND document_hash = $2 AND scope = 'global' LIMIT 1",
      [tenantId, docHash]
    );
    if (res.rows.length > 0) isDuplicate = true;
  }

  // Save/Write physical file inside knowledge_data_vault
  try {
    const storagePath = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
    const filePath = path.join(storagePath, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[saveEmailToGlobalRag] Successfully wrote physical email RAG file to knowledge base: ${filePath}`);
  } catch (fsErr) {
    console.error(`[saveEmailToGlobalRag] Failed to write email txt to global knowledge base disk:`, fsErr);
  }

  if (isDuplicate) {
    console.log(`[saveEmailToGlobalRag] Email "${filename}" already logged in global RAG.`);
    return;
  }

  // 2. Generate Metadata Record
  const docId = uuidv4();
  const metadataRecord = {
    id_uuid: docId,
    tenant_id: tenantId,
    scope: 'global',
    associated_company_id: null,
    associated_contact_id: null,
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
    fallbackStore.louisAiKnowledgeMetadata!.push(metadataRecord);
    saveFallbackStore();
  } else {
    await pool.query(
      `INSERT INTO sys_louis_ai_knowledge_metadata 
       (id_uuid, tenant_id, scope, associated_company_id, associated_contact_id, file_name, file_size_bytes, mime_type, document_hash, created_by_identity, is_verified_by_human, created_at_utc, updated_at_utc)
       VALUES ($1, $2, 'global', NULL, NULL, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        docId,
        tenantId,
        filename,
        buffer.length,
        mimeType,
        docHash,
        creatorIdentity,
        true
      ]
    );
  }

  // 3. Chunk & Embed text content
  const ragConfig = await getRagConfig(tenantId);
  const chunks = await intelligentChunkAndProcess(buffer, filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

  if (chunks.length === 0) {
    console.log(`[saveEmailToGlobalRag] No chunks extracted for email doc "${filename}".`);
    return;
  }

  console.log(`[saveEmailToGlobalRag] Ingesting ${chunks.length} chunks for email "${filename}" in global RAG.`);

  for (const textChunk of chunks) {
    const chunkId = uuidv4();
    let embeddingValues: number[] | null = null;
    try {
      embeddingValues = await generateEmbedding(textChunk, tenantId);
    } catch (embedErr) {
      console.warn(`[saveEmailToGlobalRag] Embedding failed for chunk`, embedErr);
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

async function saveEmailToEntityRag(params: SaveEmailEntityParams): Promise<void> {
  const { tenantId, scope, entityId, entityName, filename, buffer, docHash, mimeType, creatorIdentity } = params;
  
  // 1. Check duplicate inside this entity's scope
  let isDuplicate = false;
  if (isUsingFallback || !pool) {
    if (!fallbackStore.louisAiKnowledgeMetadata) {
      fallbackStore.louisAiKnowledgeMetadata = [];
    }
    const existing = (fallbackStore.louisAiKnowledgeMetadata as LouisAiKnowledgeMetadataExtended[]).find(
      (m: LouisAiKnowledgeMetadataExtended) => 
        m.tenant_id === tenantId && 
        m.document_hash === docHash && 
        m.scope === scope && 
        (scope === 'contact' ? m.associated_contact_id === entityId : m.associated_company_id === entityId)
    );
    if (existing) isDuplicate = true;
  } else {
    const res = await pool.query(
      "SELECT id_uuid FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1 AND document_hash = $2 AND scope = $3 AND (associated_contact_id = $4 OR associated_company_id = $4) LIMIT 1",
      [tenantId, docHash, scope, entityId]
    );
    if (res.rows.length > 0) isDuplicate = true;
  }

  // Save/Write physical file inside the CRM's storage/data vaults.
  // This ensures the E-Mail document text is immediately visible in the files storage list & available for RAG.
  try {
    const storagePath = getEntityStoragePath(scope === 'company' ? 'companies' : 'contacts', entityId, entityName, tenantId);
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
    const filePath = path.join(storagePath, filename);
    fs.writeFileSync(filePath, buffer);
    console.log(`[saveEmailToEntityRag] Successfully wrote physical email RAG file: ${filePath}`);
  } catch (fsErr) {
    console.error(`[saveEmailToEntityRag] Failed to write email txt to physical disk:`, fsErr);
  }

  if (isDuplicate) {
    console.log(`[saveEmailToEntityRag] Email "${filename}" already logged in RAG for ${scope} ${entityId}.`);
    return;
  }

  // 2. Generate Metadata Record
  const docId = uuidv4();
  const metadataRecord = {
    id_uuid: docId,
    tenant_id: tenantId,
    scope,
    associated_company_id: scope === 'company' ? entityId : null,
    associated_contact_id: scope === 'contact' ? entityId : null,
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
    fallbackStore.louisAiKnowledgeMetadata!.push(metadataRecord);
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
        scope === 'company' ? entityId : null,
        scope === 'contact' ? entityId : null,
        filename,
        buffer.length,
        mimeType,
        docHash,
        creatorIdentity,
        true
      ]
    );
  }

  // 3. Chunk & Embed text content
  const ragConfig = await getRagConfig(tenantId);
  const chunks = await intelligentChunkAndProcess(buffer, filename, ragConfig.chunkSize, ragConfig.chunkOverlap);

  if (chunks.length === 0) {
    console.log(`[saveEmailToEntityRag] No chunks extracted for email doc "${filename}".`);
    return;
  }

  console.log(`[saveEmailToEntityRag] Ingesting ${chunks.length} chunks for email "${filename}" in RAG.`);

  for (const textChunk of chunks) {
    const chunkId = uuidv4();
    let embeddingValues: number[] | null = null;
    try {
      embeddingValues = await generateEmbedding(textChunk, tenantId);
    } catch (embedErr) {
      console.warn(`[saveEmailToEntityRag] Embedding failed for chunk`, embedErr);
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
export interface IngestEmailToRagParams {
  tenantId: string;
  recipient: string;
  senderType: 'Human' | 'AI';
  subject: string;
  body: string;
  date?: string | Date;
  attachments?: { filename: string }[] | string[] | unknown;
  workflowInstanceId?: string;
}

export async function ingestEmailToRag(params: IngestEmailToRagParams): Promise<void> {
  const { tenantId, recipient, senderType, subject, body, date, attachments, workflowInstanceId } = params;
  try {
    // 1. Extract email addresses using regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const matches = recipient.match(emailRegex);
    const emails = matches ? Array.from(new Set(matches.map(email => email.toLowerCase().trim()))) : [];

    // 2. Prepare visual date-time
    const formattedDate = date 
      ? (typeof date === 'string' ? date : date.toISOString()) 
      : new Date().toISOString();

    // 3. Format visual sender
    const senderLabel = senderType === 'AI' ? 'Künstliche Intelligenz (AI)' : 'Mitarbeiter (Human)';

    // 4. Resolve exact list of attachment names as specified ("bei Anhängen der exakte Name der angehängten Datei")
    const attachmentsList: string[] = [];
    if (attachments && Array.isArray(attachments)) {
      for (const att of attachments) {
        if (typeof att === 'string') {
          attachmentsList.push(path.basename(att).replace(/^\d+_/g, ''));
        } else if (att && typeof att === 'object') {
          const typedAtt = att as Record<string, unknown>;
          if (typeof typedAtt.filename === 'string') {
            attachmentsList.push(typedAtt.filename);
          }
        }
      }
    }

    const attachmentsText = attachmentsList.length > 0
      ? `Anhänge: ${attachmentsList.join(', ')}`
      : 'Anhänge: Keine';

    // Strip HTML from body content
    const plainTextBody = body.replace(/<[^>]*>/g, '').trim();

    // Construct final text format doc
    const documentText = `E-Mail Dokumentation
===================
Datum/Uhrzeit: ${formattedDate}
Absender: ${senderLabel}
Betreff: ${subject}
Empfänger: ${recipient}

Inhalt:
${plainTextBody}

${attachmentsText}`;

    const docHash = crypto.createHash('md5').update(documentText).digest('hex');
    const buffer = Buffer.from(documentText, 'utf8');
    const filename = `email_${formattedDate.replace(/[:.]/g, '-')}_${subject.substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    const mimeType = 'text/plain';

    // Resolve entities from workflowInstanceId if provided
    let entityIdFromWorkflow: string | null = null;
    let entityTypeFromWorkflow: 'contact' | 'company' | null = null;

    if (workflowInstanceId) {
      let instance: WorkflowInstance | null = null;
      if (isUsingFallback || !pool) {
        instance = fallbackStore.workflowInstances?.find(
          (i: { id_uuid?: string }) => i.id_uuid === workflowInstanceId
        );
      } else {
        const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [workflowInstanceId]);
        if (res.rows.length > 0) instance = res.rows[0];
      }

      if (instance) {
        const payload = typeof instance.initial_payload === "string" ? JSON.parse(instance.initial_payload) : instance.initial_payload;
        if (payload && payload.id_uuid) {
          entityIdFromWorkflow = payload.id_uuid as string;
          
          let workflow: CustomWorkflow | null = null;
          if (isUsingFallback || !pool) {
            workflow = fallbackStore.customWorkflows?.find(
              (w: { id_uuid?: string }) => w.id_uuid === instance.workflow_id
            );
          } else {
            const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1", [instance.workflow_id]);
            if (res.rows.length > 0) workflow = res.rows[0];
          }

          if (workflow) {
            const evName = (workflow.trigger_config?.event_name || "") as string;
            if (evName.startsWith("contact.")) {
              entityTypeFromWorkflow = "contact";
            } else if (evName.startsWith("company.")) {
              entityTypeFromWorkflow = "company";
            }
          }
        }
      }
    }

    let contactsToIngest: { id: string; name: string }[] = [];
    let companiesToIngest: { id: string; name: string }[] = [];

    if (entityIdFromWorkflow && entityTypeFromWorkflow === "contact") {
      let contactName = "Kontakt";
      if (isUsingFallback || !pool) {
        const foundContact = fallbackStore.contacts?.find((c: Contact) => c.id_uuid === entityIdFromWorkflow);
        if (foundContact) contactName = foundContact.full_legal_name || "Kontakt";
      } else {
        const res = await pool.query("SELECT full_legal_name FROM core_registry_contacts WHERE id_uuid = $1 LIMIT 1", [entityIdFromWorkflow]);
        if (res.rows.length > 0) contactName = res.rows[0].full_legal_name || "Kontakt";
      }
      contactsToIngest.push({ id: entityIdFromWorkflow, name: contactName });
    }

    if (entityIdFromWorkflow && entityTypeFromWorkflow === "company") {
      let companyName = "Unternehmen";
      if (isUsingFallback || !pool) {
        const foundCompany = fallbackStore.companies?.find((c: Company) => c.id_uuid === entityIdFromWorkflow);
        if (foundCompany) companyName = foundCompany.full_legal_name || "Unternehmen";
      } else {
        const res = await pool.query("SELECT full_legal_name FROM core_registry_companies WHERE id_uuid = $1 LIMIT 1", [entityIdFromWorkflow]);
        if (res.rows.length > 0) companyName = res.rows[0].full_legal_name || "Unternehmen";
      }
      companiesToIngest.push({ id: entityIdFromWorkflow, name: companyName });
    }

    // 5. Look up each email in contacts and companies if not already resolved by workflow instance mapping
    if (contactsToIngest.length === 0 && companiesToIngest.length === 0 && emails.length > 0) {
      for (const email of emails) {
        // Look up contacts
        let contactId: string | null = null;
        let contactName = "Kontakt";
        if (isUsingFallback || !pool) {
          const foundContact = fallbackStore.contacts?.find(
            (c: { email_address?: string; tenant_id?: string }) => 
              c.email_address?.toLowerCase() === email && 
              (c.tenant_id === tenantId || c.tenant_id === '1')
          );
          if (foundContact) {
            contactId = (foundContact as { id_uuid: string }).id_uuid;
            contactName = (foundContact as { full_legal_name?: string }).full_legal_name || "Kontakt";
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid, full_legal_name FROM core_registry_contacts WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
            [email, tenantId]
          );
          if (res.rows.length > 0) {
            contactId = res.rows[0].id_uuid;
            contactName = res.rows[0].full_legal_name || "Kontakt";
          }
        }

        if (contactId) {
          contactsToIngest.push({ id: contactId, name: contactName });
        }

        // Look up companies
        let companyId: string | null = null;
        let companyName = "Unternehmen";
        if (isUsingFallback || !pool) {
          const foundCompany = fallbackStore.companies?.find(
            (co: { email_address?: string; tenant_id?: string }) => 
              co.email_address?.toLowerCase() === email && 
              (co.tenant_id === tenantId || co.tenant_id === '1')
          );
          if (foundCompany) {
            companyId = (foundCompany as { id_uuid: string }).id_uuid;
            companyName = (foundCompany as { full_legal_name?: string }).full_legal_name || "Unternehmen";
          }
        } else {
          const res = await pool.query(
            "SELECT id_uuid, full_legal_name FROM core_registry_companies WHERE LOWER(email_address) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
            [email, tenantId]
          );
          if (res.rows.length > 0) {
            companyId = res.rows[0].id_uuid;
            companyName = res.rows[0].full_legal_name || "Unternehmen";
          }
        }

        if (companyId) {
          companiesToIngest.push({ id: companyId, name: companyName });
        }
      }
    }

    // Save to all resolved Contact directories
    for (const c of contactsToIngest) {
      await saveEmailToEntityRag({
        tenantId,
        scope: 'contact',
        entityId: c.id,
        entityName: c.name,
        filename,
        buffer,
        docHash,
        mimeType,
        creatorIdentity: senderType === 'AI' ? 'ai' : 'human',
      });
    }

    // Save to all resolved Company directories
    for (const co of companiesToIngest) {
      await saveEmailToEntityRag({
        tenantId,
        scope: 'company',
        entityId: co.id,
        entityName: co.name,
        filename,
        buffer,
        docHash,
        mimeType,
        creatorIdentity: senderType === 'AI' ? 'ai' : 'human',
      });
    }

    if (contactsToIngest.length === 0 && companiesToIngest.length === 0) {
      console.log(`[ingestEmailToRag] No matching Contact or Company found. Saving to Global Knowledge Base: ${filename}`);
      await saveEmailToGlobalRag({
        tenantId,
        filename,
        buffer,
        docHash,
        mimeType,
        creatorIdentity: senderType === 'AI' ? 'ai' : 'human',
      });
    }

  } catch (err) {
    console.error(`[ingestEmailToRag] Failed to record sent email into contact/company RAG:`, err);
  }
}

