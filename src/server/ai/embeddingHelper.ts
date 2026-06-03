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

export function padOrTrimEmbedding(values: number[], targetSize = 1536): number[] {
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

let lastCheckedDimension = -1;

/**
 * Automatisches self-healing Schema-Alignment:
 * Prüft ob die Spaltendimensionen der PostgreSQL-Tabelle mit der Konfiguration übereinstimmen.
 * Bei Diskrepanz wird der HNSW-Index neu aufgebaut und die Spalte auf die korrekte Größe skaliert.
 */
export async function ensureTableVectorDimension(targetDimensions: number) {
  if (isUsingFallback || !pool) return;
  if (lastCheckedDimension === targetDimensions) return;

  try {
    const res = await pool.query(`
      SELECT COALESCE(
        (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'sys_louis_ai_knowledge_chunks'::regclass AND attname = 'embedding'),
        -1
      ) as dim
    `);
    const currentDim = res.rows[0]?.dim;
    if (currentDim !== targetDimensions && targetDimensions > 0) {
      console.log(`[RAG DB Align] Vector dimension mismatch detected: pgvector column is vector(${currentDim}), but config is vector(${targetDimensions}). Re-aligning pgvector...`);
      
      // A. Drop Index
      await pool.query(`DROP INDEX IF EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx`);
      
      // B. Spalte anpassen (Auf NULL setzen, Text-Metadaten bleiben erhalten und werden bei Suchanfragen re-indiziert)
      await pool.query(`ALTER TABLE sys_louis_ai_knowledge_chunks DROP COLUMN IF EXISTS embedding`);
      await pool.query(`ALTER TABLE sys_louis_ai_knowledge_chunks ADD COLUMN embedding vector(${targetDimensions})`);
      
      // C. HNSW Index neu erstellen
      await pool.query(`CREATE INDEX IF NOT EXISTS sys_louis_ai_knowledge_chunks_embedding_hnsw_idx ON sys_louis_ai_knowledge_chunks USING hnsw (embedding vector_cosine_ops)`);
      
      console.log(`[RAG DB Align] Vector column successfully resized and HNSW-indexed to vector(${targetDimensions})!`);
    }
    lastCheckedDimension = targetDimensions;
  } catch (err) {
    console.warn("[RAG DB Align] Dynamic vector column alignment check bypassed or deferred:", err);
  }
}

export async function getRagConfig(tenantId: string) {
  // Load config from DB or fallbackStore
  let provider = "gemini";
  let apiKey = "";
  let baseUrl = "";
  let modelName = "gemini-embedding-2-preview";
  let vectorDimensions = 1536;
  let keepAliveMinutes = 5;
  let parallelSlots = 1;
  let chunkSize = 500;
  let chunkOverlap = 50;

  try {
    if (isUsingFallback) {
      const list = fallbackStore.louisAiConfig || [];
      const found = list.find((c: LouisAiConfig) => c.tenant_id === tenantId) || list.find((c: LouisAiConfig) => c.tenant_id === '1');
      if (found) {
        provider = found.embedding_provider || found.provider_type || "gemini";
        apiKey = found.embedding_api_key_secret || found.api_key_secret || "";
        baseUrl = found.embedding_base_url || found.base_url || "";
        modelName = found.embedding_model_name || "gemini-embedding-2-preview";
        vectorDimensions = found.vector_dimensions || 1536;
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
        provider = row.embedding_provider || row.provider_type || "gemini";
        apiKey = row.embedding_api_key_secret || row.api_key_secret || "";
        baseUrl = row.embedding_base_url || row.base_url || "";
        modelName = row.embedding_model_name || "gemini-embedding-2-preview";
        vectorDimensions = parseInt(row.vector_dimensions || "1536");
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
    ensureTableVectorDimension(vectorDimensions).catch(err => {
      console.warn("[EmbeddingHelper] Error in asynchronous vector schema alignment:", err);
    });
  }

  return ragConfig;
}

export async function generateEmbedding(text: string, tenantId: string): Promise<number[]> {
  const config = await getRagConfig(tenantId);
  console.log(`[EmbeddingHelper] Generating embedding using provider: ${config.provider}, model: ${config.modelName}`);

  const cleanText = text.replace(/\s+/g, " ").trim() || " ";

  if (config.provider === "gemini") {
    const key = config.apiKey;
    if (!key) {
      throw new Error("Fehler: Kein gültiger API-Schlüssel für Gemini Embeddings in den Admin-Einstellungen hinterlegt.");
    }
    const ai = new GoogleGenAI({ apiKey: key });
    try {
      const res = await ai.models.embedContent({
        model: config.modelName || "gemini-embedding-2-preview",
        contents: cleanText,
      });
      const embedResponse = res as GeminiEmbedResponse;
      const embeddingValues = embedResponse.embedding?.values || embedResponse.embeddings?.[0]?.values;
      if (!embeddingValues) {
        throw new Error("No embedding values returned from Gemini embedContent.");
      }
      return padOrTrimEmbedding(embeddingValues, config.vectorDimensions);
    } catch (e) {
      console.warn("[EmbeddingHelper] Gemini embedContent failed, attempting gemini-embedding-2-preview fallback:", e);
      try {
        const fallbackRes = await ai.models.embedContent({
          model: "gemini-embedding-2-preview",
          contents: cleanText,
        });
        const fallbackResponse = fallbackRes as GeminiEmbedResponse;
        const vals = fallbackResponse.embedding?.values || fallbackResponse.embeddings?.[0]?.values;
        if (vals) return padOrTrimEmbedding(vals, config.vectorDimensions);
      } catch (innerErr) {
        // ignore and propagate first error
      }
      throw e;
    }
  }

  if (config.provider === "openai") {
    const key = config.apiKey;
    if (!key) {
      throw new Error("Missing API Key for OpenAI Embeddings.");
    }
    const url = `${config.baseUrl || "https://api.openai.com/v1"}/embeddings`;
    const res = await fetch(url, {
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

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Embeddings returned HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json() as OpenAIEmbedResponse;
    const vals = data?.data?.[0]?.embedding;
    if (!vals) {
      throw new Error("No embedding data returned from OpenAI API.");
    }
    return padOrTrimEmbedding(vals, config.vectorDimensions);
  }

  if (config.provider === "ollama") {
    const base = config.baseUrl || "http://localhost:11434";
    const model = config.modelName || "nomic-embed-text";
    
    // Support Ollama Keep-Alive options if specified
    const keepAlive = `${config.keepAliveMinutes}m`;

    // Try /api/embed first (newer Ollama version format)
    try {
      const res = await fetch(`${base}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          input: cleanText,
          keep_alive: keepAlive,
        }),
      });

      if (res.ok) {
        const data = await res.json() as OllamaEmbedResponse;
        const vals = data?.embeddings?.[0] || data?.embedding;
        if (vals) return padOrTrimEmbedding(vals, config.vectorDimensions);
      }
    } catch (err) {
      console.warn("[EmbeddingHelper] Ollama /api/embed search failed, trying /api/embeddings:", err);
    }

    // Try /api/embeddings fallback (historical Ollama support)
    const fallbackRes = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    return padOrTrimEmbedding(vals, config.vectorDimensions);
  }

  throw new Error(`Unsupported embedding provider: ${config.provider}`);
}
