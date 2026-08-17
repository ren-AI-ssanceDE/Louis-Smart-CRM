import { pool, isUsingFallback, fallbackStore } from "../db.js";
import { generateEmbedding, formatVectorForPostgres } from "./embeddingHelper.js";
import { HybridKnowledgeSearchInputSchema, HybridKnowledgeSearchInput, HybridKnowledgeSearchRawInput } from "../../lib/schemas.js";
import { HybridSearchResult } from "../../types.js";

/**
 * Performs a Hybrid Search combining Vector Search (HNSW) and Full-Text Search (PostgreSQL tsvector)
 * fused using Reciprocal Rank Fusion (RRF).
 */
export async function performHybridSearch(
  tenantId: string,
  rawInput: HybridKnowledgeSearchRawInput
): Promise<HybridSearchResult[]> {
  const input = HybridKnowledgeSearchInputSchema.parse(rawInput);
  const {
    query,
    company_id,
    contact_id,
    scope = "all",
    document_type,
    limit = 10,
    vector_weight = 0.7,
    fts_weight = 0.3,
  } = input;

  // Fallback mode for environments without a PostgreSQL connection
  if (isUsingFallback || !pool) {
    const chunks = fallbackStore.louisAiKnowledgeChunks || [];
    const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
    const metaMap = new Map(metadata.map((m) => [m.id_uuid, m.file_name]));

    const queryLower = query.toLowerCase();
    const filtered = chunks.filter((c) => {
      const tenantMatch = c.tenant_id === tenantId || c.tenant_id === "1";
      if (!tenantMatch) return false;

      if (scope === "global" && c.scope && c.scope !== "global") return false;
      if (scope === "company" && (c.scope !== "company" || c.associated_company_id !== company_id)) return false;
      if (scope === "contact" && (c.scope !== "contact" || c.associated_contact_id !== contact_id)) return false;

      if (document_type && c.document_type && c.document_type !== document_type) return false;

      return true;
    });

    const scored = filtered.map((c, index) => {
      const matchCount = c.chunk_text.toLowerCase().includes(queryLower) ? 1 : 0;
      const ftsScore = matchCount > 0 ? 0.8 : 0.1;
      const vectorScore = 0.5;
      const rrfScore = (vector_weight * vectorScore) + (fts_weight * ftsScore);

      return {
        chunk_id: c.id_uuid,
        document_id: c.document_id,
        chunk_index: c.chunk_index || index,
        chunk_text: c.chunk_text,
        file_name: metaMap.get(c.document_id) || "Unbenanntes Dokument",
        scope: c.scope || "global",
        associated_company_id: c.associated_company_id || null,
        associated_contact_id: c.associated_contact_id || null,
        vector_score: vectorScore,
        fts_score: ftsScore,
        rrf_score: rrfScore,
      };
    });

    scored.sort((a, b) => b.rrf_score - a.rrf_score);
    return scored.slice(0, limit);
  }

  // 1. Generate query embedding
  const queryEmbedding = await generateEmbedding(query, tenantId);
  const formattedVec = formatVectorForPostgres(queryEmbedding);

  // 2. Build scope filter conditions dynamically for PostgreSQL
  const extraParams: (string | number)[] = [];
  let paramIdx = 7; // $1 = vec, $2 = tenantId, $3 = query, $4 = vector_weight, $5 = fts_weight, $6 = limit

  let scopeFilterSql = "";

  if (scope === "global") {
    scopeFilterSql += ` AND c.scope = 'global'`;
  } else if (scope === "company" && company_id) {
    scopeFilterSql += ` AND (c.scope = 'company' AND c.associated_company_id = $${paramIdx})`;
    extraParams.push(company_id);
    paramIdx++;
  } else if (scope === "contact" && contact_id) {
    scopeFilterSql += ` AND (c.scope = 'contact' AND c.associated_contact_id = $${paramIdx})`;
    extraParams.push(contact_id);
    paramIdx++;
  } else if (scope === "all") {
    const conditions: string[] = ["c.scope = 'global'"];
    if (company_id) {
      conditions.push(`(c.scope = 'company' AND c.associated_company_id = $${paramIdx})`);
      extraParams.push(company_id);
      paramIdx++;
    }
    if (contact_id) {
      conditions.push(`(c.scope = 'contact' AND c.associated_contact_id = $${paramIdx})`);
      extraParams.push(contact_id);
      paramIdx++;
    }
    scopeFilterSql += ` AND (${conditions.join(" OR ")})`;
  }

  if (document_type) {
    scopeFilterSql += ` AND c.document_type = $${paramIdx}`;
    extraParams.push(document_type);
    paramIdx++;
  }

  const queryParams = [
    formattedVec,
    tenantId,
    query,
    vector_weight,
    fts_weight,
    limit,
    ...extraParams,
  ];

  // 3. RRF SQL Query
  const sql = `
    WITH vector_search AS (
      SELECT 
        c.id_uuid as chunk_id,
        c.document_id,
        c.chunk_index,
        c.chunk_text,
        m.file_name,
        c.scope,
        c.associated_company_id,
        c.associated_contact_id,
        1 - (c.embedding <=> $1::vector) as vector_score,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> $1::vector ASC) as rank_vector
      FROM sys_louis_ai_knowledge_chunks c
      JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
      WHERE (c.tenant_id = $2 OR c.tenant_id = '1')
        AND c.needs_reembedding = FALSE
        ${scopeFilterSql}
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT 50
    ),
    fts_search AS (
      SELECT 
        c.id_uuid as chunk_id,
        c.document_id,
        c.chunk_index,
        c.chunk_text,
        m.file_name,
        c.scope,
        c.associated_company_id,
        c.associated_contact_id,
        ts_rank_cd(c.tsv_chunk_text, plainto_tsquery('german', $3)) as fts_score,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.tsv_chunk_text, plainto_tsquery('german', $3)) DESC) as rank_fts
      FROM sys_louis_ai_knowledge_chunks c
      JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
      WHERE (c.tenant_id = $2 OR c.tenant_id = '1')
        AND c.tsv_chunk_text @@ plainto_tsquery('german', $3)
        ${scopeFilterSql}
      ORDER BY fts_score DESC
      LIMIT 50
    )
    SELECT 
      COALESCE(v.chunk_id, f.chunk_id) as chunk_id,
      COALESCE(v.document_id, f.document_id) as document_id,
      COALESCE(v.chunk_index, f.chunk_index) as chunk_index,
      COALESCE(v.chunk_text, f.chunk_text) as chunk_text,
      COALESCE(v.file_name, f.file_name) as file_name,
      COALESCE(v.scope, f.scope) as scope,
      COALESCE(v.associated_company_id, f.associated_company_id) as associated_company_id,
      COALESCE(v.associated_contact_id, f.associated_contact_id) as associated_contact_id,
      COALESCE(v.vector_score, 0)::float as vector_score,
      COALESCE(f.fts_score, 0)::float as fts_score,
      (
        (CASE WHEN v.rank_vector IS NOT NULL THEN ($4::float / (60.0 + v.rank_vector::float)) ELSE 0.0 END) +
        (CASE WHEN f.rank_fts IS NOT NULL THEN ($5::float / (60.0 + f.rank_fts::float)) ELSE 0.0 END)
      )::float as rrf_score
    FROM vector_search v
    FULL OUTER JOIN fts_search f ON v.chunk_id = f.chunk_id
    ORDER BY rrf_score DESC
    LIMIT $6;
  `;

  const res = await pool.query(sql, queryParams);
  return res.rows.map((r) => ({
    chunk_id: String(r.chunk_id),
    document_id: String(r.document_id),
    chunk_index: Number(r.chunk_index || 0),
    chunk_text: String(r.chunk_text),
    file_name: String(r.file_name || "Unbenanntes Dokument"),
    scope: String(r.scope || "global"),
    associated_company_id: r.associated_company_id ? String(r.associated_company_id) : null,
    associated_contact_id: r.associated_contact_id ? String(r.associated_contact_id) : null,
    vector_score: Number(r.vector_score || 0),
    fts_score: Number(r.fts_score || 0),
    rrf_score: Number(r.rrf_score || 0),
  }));
}
