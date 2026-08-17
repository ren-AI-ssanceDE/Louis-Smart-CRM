import { GoogleGenAI } from "@google/genai";
import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { LouisAiConfig } from "../../types.js";

interface GeminiEmbedding {
  values: number[];
}

interface GeminiEmbedResponse {
  embedding?: GeminiEmbedding;
  embeddings?: GeminiEmbedding[];
}

interface OpenAIEmbedding {
  embedding: number[];
}

interface OpenAIEmbedResponse {
  data?: OpenAIEmbedding[];
}

interface OllamaEmbedResponse {
  embedding?: number[];
  embeddings?: number[][];
}

export function padOrTrimEmbedding(values: number[], targetSize = 768): number[] {
  if (!values || !Array.isArray(values)) {
    return new Array(targetSize).fill(0);
  }
  if (values.length >= targetSize) {
    return values.slice(0, targetSize);
  }
  const padded = [...values];
  while (padded.length < targetSize) {
    padded.push(0);
  }
  return padded;
}

/**
 * Formats a number array into a valid PostgreSQL vector literal string '[0.12,0.34,...]'
 */
export function formatVectorForPostgres(values: number[]): string {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Invalid embedding array provided for vector formatting.");
  }
  // Sanitize numbers to avoid NaN or Infinity in SQL
  const sanitized = values.map((val) => (Number.isFinite(val) ? val : 0));
  return `[${sanitized.join(",")}]`;
}

let lastCheckedDimension = -1;

/**
 * Automatic self-healing schema alignment & Re-Embedding Queueing:
 * Checks if column dimensions match target configuration.
 * If there is a mismatch, drops old vector index, updates column dimension,
 * populates the reembedding queue and triggers background queue processing.
 */
export async function ensureTableVectorDimension(tenantId: string, targetDimensions: number): Promise<void> {
  if (isUsingFallback || !pool) return;
  if (lastCheckedDimension === targetDimensions) return;

  try {
    const res = await pool.query(`
      SELECT COALESCE(
        (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'sys_louis_ai_knowledge_chunks'::regclass AND attname = 'embedding'),
        -1
      ) as dim
    `);
    const currentDim = Number(res.rows[0]?.dim);

    if (currentDim !== targetDimensions && targetDimensions > 0) {
      console.log(`[RAG DB Align] Vector dimension mismatch: db vector(${currentDim}) vs target vector(${targetDimensions}). Re-queueing chunks...`);
      
      // 1. Drop old vector index safely
      await pool.query(`DROP INDEX IF EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx`);

      // 2. Adjust column type
      await pool.query(`ALTER TABLE sys_louis_ai_knowledge_chunks DROP COLUMN IF EXISTS embedding`);
      await pool.query(`ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN embedding vector(${targetDimensions})`);

      // 3. Mark all existing chunks for re-embedding and populate queue
      await pool.query(
        `UPDATE sys_louis_ai_knowledge_chunks SET needs_reembedding = TRUE WHERE tenant_id = $1 OR tenant_id = '1'`,
        [tenantId]
      );

      await pool.query(
        `INSERT INTO sys_louis_ai_reembedding_queue (id_uuid, tenant_id, chunk_id, target_dimension, status)
         SELECT gen_random_uuid(), tenant_id, id_uuid, $1, 'PENDING'
         FROM sys_louis_ai_knowledge_chunks
         WHERE tenant_id = $2 OR tenant_id = '1'
         ON CONFLICT DO NOTHING`,
        [targetDimensions, tenantId]
      );

      // 4. Re-create HNSW index for new dimensions
      await pool.query(`CREATE INDEX IF NOT EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx ON sys_louis_ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops)`);

      // 5. Trigger asynchronous queue processing
      processReembeddingQueue(tenantId).catch(err => {
        console.error("[ReembeddingWorker] Error processing queue:", err);
      });
    }
    lastCheckedDimension = targetDimensions;
  } catch (err) {
    console.warn("[RAG DB Align] Vector column alignment check bypassed:", err);
  }
}

/**
 * Processes pending items in the Re-Embedding Queue in batches
 */
export async function processReembeddingQueue(tenantId: string, batchSize = 10): Promise<void> {
  if (isUsingFallback || !pool) return;

  try {
    const queueRes = await pool.query(
      `SELECT q.id_uuid as queue_id, q.chunk_id, c.chunk_text, c.tenant_id
       FROM sys_louis_ai_reembedding_queue q
       JOIN sys_louis_ai_knowledge_chunks c ON q.chunk_id = c.id_uuid
       WHERE (q.tenant_id = $1 OR q.tenant_id = '1') AND q.status = 'PENDING'
       ORDER BY q.created_at_utc ASC
       LIMIT $2`,
      [tenantId, batchSize]
    );

    if (queueRes.rows.length === 0) return;

    for (const row of queueRes.rows) {
      const { queue_id, chunk_id, chunk_text, tenant_id: itemTenantId } = row;
      try {
        await pool.query(
          `UPDATE sys_louis_ai_reembedding_queue SET status = 'PROCESSING', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1`,
          [queue_id]
        );

        const newEmbedding = await generateEmbedding(chunk_text, itemTenantId);
        const formattedVec = formatVectorForPostgres(newEmbedding);

        await pool.query(
          `UPDATE sys_louis_ai_knowledge_chunks 
           SET embedding = $1::vector, needs_reembedding = FALSE, updated_at_utc = CURRENT_TIMESTAMP 
           WHERE id_uuid = $2`,
          [formattedVec, chunk_id]
        );

        await pool.query(
          `UPDATE sys_louis_ai_reembedding_queue SET status = 'COMPLETED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1`,
          [queue_id]
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE sys_louis_ai_reembedding_queue 
           SET status = 'FAILED', error_message = $1, retry_count = retry_count + 1, updated_at_utc = CURRENT_TIMESTAMP 
           WHERE id_uuid = $2`,
          [msg, queue_id]
        );
      }
    }
  } catch (err) {
    console.error("[ReembeddingQueue] Batch execution failed:", err);
  }
}

export async function getRagConfig(tenantId: string) {
  let provider = "ollama";
  let apiKey = "";
  let baseUrl = "";
  let modelName = "nomic-embed-text";
  let vectorDimensions = 768;
  let keepAliveMinutes = 5;
  let parallelSlots = 1;
  let chunkSize = 500;
  let chunkOverlap = 50;

  try {
    if (isUsingFallback) {
      const list = fallbackStore.louisAiConfig || [];
      const found = list.find((c: LouisAiConfig) => c.tenant_id === tenantId) || list.find((c: LouisAiConfig) => c.tenant_id === '1');
      if (found) {
        provider = found.embedding_provider || found.provider_type || "ollama";
        apiKey = found.embedding_api_key_secret || found.api_key_secret || "";
        baseUrl = found.embedding_base_url || found.base_url || "";
        modelName = found.embedding_model_name || (provider === "gemini" ? "text-embedding-004" : provider === "openai" ? "text-embedding-3-small" : "nomic-embed-text");
        vectorDimensions = found.vector_dimensions || 768;
        keepAliveMinutes = found.keep_alive_minutes ?? 5;
        parallelSlots = found.parallel_slots ?? 1;
        chunkSize = found.chunk_size ?? 500;
        chunkOverlap = found.chunk_overlap ?? 50;
      }
    } else {
      const res = await pool.query(
        "SELECT embedding_provider, embedding_api_key_secret, embedding_base_url, embedding_model_name, vector_dimensions, keep_alive_minutes, parallel_slots, chunk_size, chunk_overlap, provider_type, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        provider = row.embedding_provider || row.provider_type || "ollama";
        apiKey = row.embedding_api_key_secret || row.api_key_secret || "";
        baseUrl = row.embedding_base_url || row.base_url || "";
        modelName = row.embedding_model_name || (provider === "gemini" ? "text-embedding-004" : provider === "openai" ? "text-embedding-3-small" : "nomic-embed-text");
        vectorDimensions = parseInt(row.vector_dimensions || "768");
        keepAliveMinutes = parseInt(row.keep_alive_minutes ?? "5");
        parallelSlots = parseInt(row.parallel_slots ?? "1");
        chunkSize = parseInt(row.chunk_size ?? "500");
        chunkOverlap = parseInt(row.chunk_overlap ?? "50");
      }
    }
  } catch (err) {
    console.warn("Failed to query RAG embedding configuration, using system defaults:", err);
  }

  // Resolve API secrets
  if (apiKey === "******") {
    apiKey = "";
  }

  const ragConfig = {
    provider,
    apiKey,
    baseUrl,
    modelName,
    vectorDimensions,
    keepAliveMinutes,
    parallelSlots,
    chunkSize,
    chunkOverlap,
  };

  // Trigger Schema-Alignment asynchronously without blocking the user interface request
  if (vectorDimensions > 0) {
    ensureTableVectorDimension(tenantId, vectorDimensions).catch(err => {
      console.warn("[EmbeddingHelper] Error in asynchronous vector schema alignment:", err);
    });
  }

  return ragConfig;
}

type RetryTask<T> = () => Promise<T>;

async function callWithRetry<T>(
  fn: RetryTask<T>,
  retries = 5,
  delayMs = 1000,
  factor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    const errObj = error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    const errorString = String(errObj?.message || error || "").toLowerCase();
    const isRateLimitOrRetryable = 
      errObj?.status === 429 ||
      errObj?.statusCode === 429 ||
      errObj?.code === 429 ||
      errorString.includes("429") ||
      errorString.includes("resource_exhausted") ||
      errorString.includes("exhausted") ||
      errorString.includes("rate limit") ||
      errorString.includes("too many requests") ||
      errorString.includes("limit exceeded") ||
      errObj?.status === 503 ||
      errorString.includes("503") ||
      errorString.includes("service unavailable");

    if (isRateLimitOrRetryable && retries > 0) {
      console.warn(`[EmbeddingHelper] Temporary API error or rate limit matched. Retrying in ${delayMs}ms... (Remaining retries: ${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return callWithRetry(fn, retries - 1, delayMs * factor, factor);
    }
    throw error;
  }
}

export async function generateEmbedding(text: string, tenantId: string): Promise<number[]> {
  const config = await getRagConfig(tenantId);
  console.log(`[EmbeddingHelper] Generating embedding using provider: ${config.provider}, model: ${config.modelName}`);

  const cleanText = text.replace(/\s+/g, " ").trim() || " ";
  const targetDims = config.vectorDimensions || 768;

  try {
    if (config.provider === "gemini") {
      const key = config.apiKey || process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error("Fehler: Kein gültiger API-Schlüssel für Gemini Embeddings in den Admin-Einstellungen hinterlegt.");
      }
      const ai = new GoogleGenAI({ apiKey: key });

      let targetModel = config.modelName || "text-embedding-004";
      if (!targetModel.includes("embedding") && !targetModel.includes("gemini")) {
        targetModel = "text-embedding-004";
      }

      const res = await callWithRetry(async () => {
        try {
          return await ai.models.embedContent({
            model: targetModel,
            contents: cleanText,
          });
        } catch (embedErr) {
          console.warn(`[EmbeddingHelper] Gemini model '${targetModel}' failed, trying fallback model 'text-embedding-004':`, embedErr);
          return await ai.models.embedContent({
            model: "text-embedding-004",
            contents: cleanText,
          });
        }
      });
      const embedResponse = res as GeminiEmbedResponse;
      const embeddingValues = embedResponse.embedding?.values || embedResponse.embeddings?.[0]?.values;
      if (!embeddingValues) {
        throw new Error("No embedding values returned from Gemini embedContent.");
      }
      return padOrTrimEmbedding(embeddingValues, targetDims);
    }

    if (config.provider === "openai") {
      const key = config.apiKey;
      if (!key) {
        throw new Error("Missing API Key for OpenAI Embeddings.");
      }
      const url = `${config.baseUrl || "https://api.openai.com/v1"}/embeddings`;

      const res = await callWithRetry(async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            input: cleanText,
            model: config.modelName || "text-embedding-3-small",
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI Embeddings returned HTTP ${response.status}: ${errText}`);
        }
        return response;
      });

      const data = await res.json() as OpenAIEmbedResponse;
      const vals = data?.data?.[0]?.embedding;
      if (!vals) {
        throw new Error("No embedding data returned from OpenAI API.");
      }
      return padOrTrimEmbedding(vals, targetDims);
    }

    if (config.provider === "ollama") {
      const base = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
      const model = config.modelName || "nomic-embed-text";
      const keepAlive = `${config.keepAliveMinutes}m`;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (config.apiKey) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
        headers["x-api-key"] = config.apiKey;
      }

      try {
        const res = await fetch(`${base}/api/embed`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: model,
            input: cleanText,
            keep_alive: keepAlive,
          }),
        });

        if (res.ok) {
          const data = await res.json() as OllamaEmbedResponse;
          const vals = data?.embeddings?.[0] || data?.embedding;
          if (vals) return padOrTrimEmbedding(vals, targetDims);
        } else {
          console.warn(`[EmbeddingHelper] Ollama /api/embed returned HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn("[EmbeddingHelper] Ollama /api/embed search failed, trying /api/embeddings:", err);
      }

      const fallbackRes = await fetch(`${base}/api/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model,
          prompt: cleanText,
          keep_alive: keepAlive,
        }),
      });

      if (!fallbackRes.ok) {
        const errText = await fallbackRes.text();
        throw new Error(`Ollama Embeddings API returned HTTP ${fallbackRes.status}: ${errText}`);
      }

      const data = await fallbackRes.json() as OllamaEmbedResponse;
      const vals = data?.embedding;
      if (!vals) {
        throw new Error("No embedding values returned from Ollama API.");
      }
      return padOrTrimEmbedding(vals, targetDims);
    }

    throw new Error(`Unsupported embedding provider: ${config.provider}`);
  } catch (providerErr) {
    console.warn(`[EmbeddingHelper] Embedding generation failed for provider ${config.provider}:`, providerErr);
    console.warn("[EmbeddingHelper] Returning zero-vector fallback for embedding.");
    return padOrTrimEmbedding([], targetDims);
  }
}
