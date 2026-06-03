import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../../db.js";
import { generateEmbedding } from "../embeddingHelper.js";

/**
 * Tool 3: Local Knowledge Tool (RAG searching of metadata chunks)
 */
export async function executeLocalKnowledgeSearch(tenantId: string, query: string, aiClient?: GoogleGenAI): Promise<string> {
  const normQuery = query.toLowerCase().trim().replace(/\s+/g, " ");

  // Intercept list request to avoid RAG semantic mismatch
  const containsListRequest = /welche dateien|welche dokumente|dateien in der wissensdatenbank|liste der dateien|dateibestand|dokumentenliste|dateiliste|welche dokumente gibt|verzeichnis|wissensdokument|what files|what documents|list the files|list files/i.test(normQuery);

  if (containsListRequest) {
    let dbMetadataFiles: string[] = [];
    if (isUsingFallback || !pool) {
      const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
      dbMetadataFiles = metadata.filter((m: any) => m.tenant_id === tenantId).map((m: any) => m.file_name);
    } else {
      try {
        const res = await pool.query(
          "SELECT file_name FROM sys_louis_ai_knowledge_metadata WHERE tenant_id = $1",
          [tenantId]
        );
        if (res && res.rows) {
          dbMetadataFiles = res.rows.map((row: any) => String(row.file_name));
        }
      } catch (err) {
        console.warn("[LocalKnowledgeSearch] Failed to read database metadata files:", err);
      }
    }

    let diskFiles: string[] = [];
    try {
      const fs = await import("fs");
      const path = await import("path");
      const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
      if (fs.existsSync(KNOWLEDGE_ROOT)) {
        diskFiles = fs.readdirSync(KNOWLEDGE_ROOT);
      }
    } catch (err) {
      console.warn("[LocalKnowledgeSearch] Failed to read disk files:", err);
    }

    const allFiles = Array.from(new Set([...diskFiles, ...dbMetadataFiles]));
    
    if (allFiles.length > 0) {
      const fileHighlights = allFiles
        .map((f) => `- ${f} (${dbMetadataFiles.includes(f) ? "Indiziert / RAG-Suche aktiv" : "Hochgeladen"})`)
        .join("\n");
      return `[Bestand der Wissensdatenbank]\nAktuell befinden sich folgende Dateien in der Wissensdatenbank des Mandanten:\n${fileHighlights}`;
    } else {
      return `[Bestand der Wissensdatenbank]\nEs sind aktuell keine Dateien in der Wissensdatenbank hinterlegt.`;
    }
  }

  // 1. Context-Sensitive Entity Resolution
  let resolvedCompanyId: string | null = null;
  let resolvedContactId: string | null = null;
  let activeScope: 'company' | 'contact' | 'global' = 'global';
  let entityName = '';

  let comList: any[] = [];
  let conList: any[] = [];
  if (isUsingFallback || !pool) {
    comList = fallbackStore.companies || [];
    conList = fallbackStore.contacts || [];
  } else {
    try {
      const dbComs = await pool.query("SELECT id_uuid, full_legal_name FROM core_registry_companies WHERE tenant_id = $1", [tenantId]);
      comList = dbComs.rows;
      const dbCons = await pool.query("SELECT id_uuid, full_legal_name, first_name, last_name FROM core_registry_contacts WHERE tenant_id = $1", [tenantId]);
      conList = dbCons.rows;
    } catch (e) {
      console.warn("DB lookup of registries for scope detection failed:", e);
    }
  }

  // Weiche Wort-Schnittmengen-Heuristik für flexible Entitätserkennung
  const getSignificantTerms = (name: string): string[] => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s-]/g, "")
      .split(/[\s-]+/)
      .filter(w => w.length > 2 && !["gmbh", "corp", "co", "kg", "inc", "corporation", "ag", "gbr", "gmbh & co. kg", "company", "companies"].includes(w));
  };

  // Find if any company's name is mentioned in the query
  for (const c of comList) {
    const fullLegalName = c.full_legal_name || '';
    const comNameLower = fullLegalName.toLowerCase();
    
    // Fall A: Exakter Substring-Treffer
    if (comNameLower.length > 2 && normQuery.includes(comNameLower)) {
      resolvedCompanyId = c.id_uuid;
      activeScope = 'company';
      entityName = fullLegalName;
      break;
    }
    
    // Fall B: Alle signifikanten Terme der Firma sind in der Query genannt
    const terms = getSignificantTerms(fullLegalName);
    if (terms.length > 0 && terms.every(t => normQuery.includes(t))) {
      resolvedCompanyId = c.id_uuid;
      activeScope = 'company';
      entityName = fullLegalName;
      break;
    }
  }

  // Gleiches für Kontakte, falls kein Company-Match vorliegt
  if (activeScope === 'global') {
    for (const c of conList) {
      const fallbackName = `${c.first_name || ''} ${c.last_name || ''}`;
      const conName = (c.full_legal_name || fallbackName).trim();
      const conNameLower = conName.toLowerCase();
      
      if (conNameLower.length > 2 && normQuery.includes(conNameLower)) {
        resolvedContactId = c.id_uuid;
        activeScope = 'contact';
        entityName = conName;
        break;
      }
      
      // Weiche Vorname-Nachname-Kombination
      const firstName = (c.first_name || '').toLowerCase().trim();
      const lastName = (c.last_name || '').toLowerCase().trim();
      if (firstName.length > 2 && lastName.length > 2 && normQuery.includes(firstName) && normQuery.includes(lastName)) {
        resolvedContactId = c.id_uuid;
        activeScope = 'contact';
        entityName = conName;
        break;
      }
    }
  }

  const containsCompanyKeyword = /unternehmen|firmen|firma|company|companies/i.test(normQuery);
  const containsContactKeyword = /kontakt|kontakte|ansprechpartner|mitarbeiter|person|contacts/i.test(normQuery);

  // Try dynamic embeddings first
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await generateEmbedding(query, tenantId);
  } catch (err) {
    console.warn("[LocalKnowledgeSearch] Active embedding generation failed, reverting to keyword similarity:", err);
  }

  // Helper for in-memory cosine similarity
  function getCosineSimilarity(A: number[], B: number[]) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    const len = Math.min(A.length, B.length);
    for (let i = 0; i < len; i++) {
      dotProduct += A[i] * B[i];
      normA += A[i] * A[i];
      normB += B[i] * B[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  const stopWords = new Set([
    "der", "die", "das", "und", "ist", "ein", "eine", "einen", "einem", "einer", "eines", 
    "in", "im", "on", "at", "with", "mit", "von", "vom", "zu", "zur", "zum", "bei", "beim",
    "fuer", "für", "den", "dem", "des", "einigen", "einige", "aus", "nach", "vor", "hinter",
    "ueber", "über", "unter", "the", "and", "this", "that", "there", "their", "they", "we", "he", "she", "it",
    "was", "were", "been", "have", "has", "had", "are", "is", "am", "be", "do", "does", "did", "of", "to", "for", 
    "as", "by", "but"
  ]);

  const queryWords = normQuery
    .split(/\s+/)
    .map(w => w.replace(/[^a-z0-9äöüß-]/g, ""))
    .filter(w => (w.length > 2 || /^\d+$/.test(w)) && !stopWords.has(w));

  // Offline or Fallback representation using in-memory logic
  if (isUsingFallback || !pool) {
    const metadata = fallbackStore.louisAiKnowledgeMetadata || [];
    const chunks = fallbackStore.louisAiKnowledgeChunks || [];
    
    // Filter metadata IDs based on scope & resolved entities (mit Einschluss von globalen Dokumenten)
    const filteredMetadataIds = metadata
      .filter((m: any) => {
        if (m.tenant_id !== tenantId) return false;
        
        if (resolvedCompanyId) {
          return (m.scope === 'company' && m.associated_company_id === resolvedCompanyId) || m.scope === 'global';
        }
        if (resolvedContactId) {
          return (m.scope === 'contact' && m.associated_contact_id === resolvedContactId) || m.scope === 'global';
        }
        
        if (containsCompanyKeyword) {
          return m.scope === 'company' || m.scope === 'global';
        }
        if (containsContactKeyword) {
          return m.scope === 'contact' || m.scope === 'global';
        }
        
        return true; // Alle Dokumente des Mandanten durchsuchen
      })
      .map((m: any) => m.id_uuid);

    const relevantChunks = chunks.filter((c: any) => 
      c.tenant_id === tenantId && 
      (filteredMetadataIds.includes(c.document_id) || !c.document_id)
    );

    const scored = relevantChunks.map((chunk: any) => {
      let similarityScore = 0;
      if (queryEmbedding) {
        let chunkVector: number[] | null = null;
        if (typeof chunk.embedding === "string") {
          try { chunkVector = JSON.parse(chunk.embedding); } catch(e) {}
        } else if (Array.isArray(chunk.embedding)) {
          chunkVector = chunk.embedding;
        }
        similarityScore = chunkVector ? getCosineSimilarity(queryEmbedding!, chunkVector) : 0;
      }

      let keywordScore = 0;
      const textLower = chunk.chunk_text.toLowerCase().replace(/\s+/g, " ");
      const doc = metadata.find((m: any) => m.id_uuid === chunk.document_id) as any;
      const fileLower = doc ? (doc.file_name || "").toLowerCase().replace(/\s+/g, " ") : "";

      for (const word of queryWords) {
        if (fileLower.includes(word)) {
          keywordScore += 4;
        }
        if (textLower.includes(word)) {
          const occurrences = (textLower.match(new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length;
          keywordScore += Math.min(occurrences * 1.0, 4);
        }
      }

      const cleanQueryPhrase = queryWords.join(" ");
      if (cleanQueryPhrase.length >= 2) {
        if (fileLower.includes(cleanQueryPhrase)) keywordScore += 8;
        if (textLower.includes(cleanQueryPhrase)) keywordScore += 5;
      }

      const normalizedKeywordScore = Math.min(keywordScore / 25.0, 1.0);
      const vectorScore = similarityScore;
      let totalScore = queryEmbedding
        ? (vectorScore * 0.7) + (normalizedKeywordScore * 0.3)
        : normalizedKeywordScore;

      // Soft boosting for matched entity scope documents (*1.2)
      let boost = 1.0;
      if (resolvedCompanyId && doc && doc.scope === 'company' && doc.associated_company_id === resolvedCompanyId) {
        boost = 1.2;
      } else if (resolvedContactId && doc && doc.scope === 'contact' && doc.associated_contact_id === resolvedContactId) {
        boost = 1.2;
      }
      totalScore *= boost;

      return { 
         chunk_text: chunk.chunk_text, 
         file_name: doc ? doc.file_name : "Wissensdatenbank", 
         totalScore 
      };
    })
    .filter(c => c.totalScore > 0.05)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

    if (scored.length === 0) {
      return `No matching local knowledge files or document chunks found${entityName ? ` for "${entityName}"` : ""}.`;
    }

    return scored.map((c, i) => `[Result ${i + 1}] (Relevance: ${c.totalScore.toFixed(1)}, File: ${c.file_name})\n${c.chunk_text}`).join("\n\n");
  }

  // Postgres MODE with pgvector cosine similarity and keyword FTS selection
  try {
    let vectorRows: any[] = [];
    if (queryEmbedding) {
      let vectorSql = `
        SELECT c.id_uuid, c.chunk_text, m.file_name, m.scope, m.associated_company_id, m.associated_contact_id,
               (1 - (c.embedding <=> $1::vector)) as similarity
        FROM sys_louis_ai_knowledge_chunks c
        JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
        WHERE c.tenant_id = $2
      `;
      const vectorParams: any[] = [`[${queryEmbedding.join(",")}]`, tenantId];
      let paramIdx = 3;

      if (resolvedCompanyId) {
        vectorSql += ` AND ( (m.scope = 'company' AND m.associated_company_id = $${paramIdx}) OR m.scope = 'global' )`;
        vectorParams.push(resolvedCompanyId);
        paramIdx++;
      } else if (resolvedContactId) {
        vectorSql += ` AND ( (m.scope = 'contact' AND m.associated_contact_id = $${paramIdx}) OR m.scope = 'global' )`;
        vectorParams.push(resolvedContactId);
        paramIdx++;
      } else if (containsCompanyKeyword) {
        vectorSql += ` AND (m.scope = 'company' OR m.scope = 'global')`;
      } else if (containsContactKeyword) {
        vectorSql += ` AND (m.scope = 'contact' OR m.scope = 'global')`;
      }

      vectorSql += ` ORDER BY c.embedding <=> $1::vector ASC LIMIT 20`;
      const vecResult = await pool.query(vectorSql, vectorParams);
      vectorRows = vecResult.rows;
    }

    // 2. Keyword Matches holen
    let keywordRows: any[] = [];
    if (queryWords.length > 0) {
      let textSql = `
        SELECT c.id_uuid, c.chunk_text, m.file_name, m.scope, m.associated_company_id, m.associated_contact_id,
               0.0 as similarity
        FROM sys_louis_ai_knowledge_chunks c
        JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
        WHERE c.tenant_id = $1
      `;
      const textParams: any[] = [tenantId];
      let paramIdx = 2;

      if (resolvedCompanyId) {
        textSql += ` AND ( (m.scope = 'company' AND m.associated_company_id = $${paramIdx}) OR m.scope = 'global' )`;
        textParams.push(resolvedCompanyId);
        paramIdx++;
      } else if (resolvedContactId) {
        textSql += ` AND ( (m.scope = 'contact' AND m.associated_contact_id = $${paramIdx}) OR m.scope = 'global' )`;
        textParams.push(resolvedContactId);
        paramIdx++;
      } else if (containsCompanyKeyword) {
        textSql += ` AND (m.scope = 'company' OR m.scope = 'global')`;
      } else if (containsContactKeyword) {
        textSql += ` AND (m.scope = 'contact' OR m.scope = 'global')`;
      }

      const wordClauses = queryWords.map((_, idx) => `(c.chunk_text ILIKE $${paramIdx + idx} OR m.file_name ILIKE $${paramIdx + idx})`).join(" OR ");
      textSql += ` AND (${wordClauses})`;
      for (const w of queryWords) {
        textParams.push(`%${w}%`);
      }

      textSql += ` LIMIT 20`;
      const textResult = await pool.query(textSql, textParams);
      keywordRows = textResult.rows;
    }

    // 3. Zusammenführen und de-duplizieren nach Chunk ID
    const mergedMap = new Map<string, any>();
    for (const row of vectorRows) {
      mergedMap.set(row.id_uuid, row);
    }
    for (const row of keywordRows) {
      if (!mergedMap.has(row.id_uuid)) {
        mergedMap.set(row.id_uuid, row);
      }
    }

    const mergedChunks = Array.from(mergedMap.values());

    // 4. Hybrid Relevance Scoring
    const scoredChunks = mergedChunks.map((chunk: any) => {
      let keywordScore = 0;
      const textLower = chunk.chunk_text.toLowerCase().replace(/\s+/g, " ");
      const fileLower = (chunk.file_name || "").toLowerCase().replace(/\s+/g, " ");

      for (const word of queryWords) {
        if (fileLower.includes(word)) {
          keywordScore += 4;
        }
        if (textLower.includes(word)) {
          const occurrences = (textLower.match(new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) || []).length;
          keywordScore += Math.min(occurrences * 1.0, 4);
        }
      }

      const cleanQueryPhrase = queryWords.join(" ");
      if (cleanQueryPhrase.length >= 2) {
        if (fileLower.includes(cleanQueryPhrase)) keywordScore += 8;
        if (textLower.includes(cleanQueryPhrase)) keywordScore += 5;
      }

      const vectorScore = chunk.similarity ? parseFloat(chunk.similarity) : 0;
      const normalizedKeywordScore = Math.min(keywordScore / 25.0, 1.0);
      
      let totalScore = queryEmbedding
        ? (vectorScore * 0.7) + (normalizedKeywordScore * 0.3)
        : normalizedKeywordScore;

      // Soft boosting for matched entity scope documents (*1.2)
      let boost = 1.0;
      if (resolvedCompanyId && chunk.scope === 'company' && chunk.associated_company_id === resolvedCompanyId) {
        boost = 1.2;
      } else if (resolvedContactId && chunk.scope === 'contact' && chunk.associated_contact_id === resolvedContactId) {
        boost = 1.2;
      }
      totalScore *= boost;

      return {
        chunk_text: chunk.chunk_text,
        file_name: chunk.file_name,
        totalScore,
        vectorScore,
        keywordScore
      };
    });

    const finalScored = scoredChunks
      .filter((c: any) => c.totalScore > 0.05)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 5);

    if (finalScored.length === 0) {
      return `No matching vector or text knowledge chunks found${entityName ? ` for "${entityName}"` : ""}.`;
    }

    return finalScored.map((c, i) => 
      `[Result ${i + 1}] (Relevance: ${c.totalScore.toFixed(1)}, File: ${c.file_name || 'Wissensdatenbank'})\n${c.chunk_text}`
    ).join("\n\n");

  } catch (err) {
    console.warn("[LocalKnowledgeSearch] Postgres vector search failed, executing text override fallback:", err);
    try {
      let sqlText = `
        SELECT c.chunk_text, m.file_name, 0.5 as similarity 
        FROM sys_louis_ai_knowledge_chunks c
        JOIN sys_louis_ai_knowledge_metadata m ON c.document_id = m.id_uuid
        WHERE c.tenant_id = $1 AND c.chunk_text ILIKE $2
      `;
      const plainQuery = `%${query.replace(/%/g, "")}%`;
      const paramsText: any[] = [tenantId, plainQuery];

      if (resolvedCompanyId) {
        sqlText += ` AND ( (m.scope = 'company' AND m.associated_company_id = $3) OR m.scope = 'global' )`;
        paramsText.push(resolvedCompanyId);
      } else if (resolvedContactId) {
        sqlText += ` AND ( (m.scope = 'contact' AND m.associated_contact_id = $3) OR m.scope = 'global' )`;
        paramsText.push(resolvedContactId);
      }

      sqlText += " LIMIT 5";
      const resText = await pool.query(sqlText, paramsText);
      if (resText.rows.length > 0) {
        return resText.rows.map((row: any, i: number) => 
          `[Result ${i + 1}] (Keyword MatchFallback, File: ${row.file_name || 'Wissensdatenbank'})\n${row.chunk_text}`
        ).join("\n\n");
      }
    } catch (e) {}
    return `Local database knowledge query failed: ${(err as Error).message}`;
  }
}

/**
 * Tool 5: Custom Tool Learning (Persist a reusable workflow recipe)
 */
export async function learnWorkflow(tenantId: string, name: string, description: string, toolChain: { tool: string; instruction: string }[], created_by_identity: string = "ai_assistant"): Promise<any> {
  const id_uuid = uuidv4();
  
  // Dual write system: Always write to local fallback first to ensure no data loss during container migrations
  if (!fallbackStore.customWorkflows) {
    fallbackStore.customWorkflows = [];
  }
  const record = {
    id_uuid,
    tenant_id: tenantId,
    workflow_name: name,
    workflow_description: description,
    tool_chain_sequence: toolChain,
    created_by_identity,
    created_at_utc: new Date().toISOString(),
    updated_at_utc: new Date().toISOString()
  };

  // Synchronise or replace same duplicate workflow if newly proposed
  fallbackStore.customWorkflows = fallbackStore.customWorkflows.filter(
    (w: any) => !(w.tenant_id === tenantId && w.workflow_name === name)
  );
  fallbackStore.customWorkflows.push(record);
  
  // Save fallback store atomic instantly
  saveFallbackStore();

  if (!isUsingFallback) {
    // Postgres synchronization
    try {
      await pool.query(`
        INSERT INTO sys_louis_ai_custom_workflows (id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence, created_by_identity)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, workflow_name)
        DO UPDATE SET workflow_description = EXCLUDED.workflow_description, tool_chain_sequence = EXCLUDED.tool_chain_sequence, created_by_identity = EXCLUDED.created_by_identity, updated_at_utc = CURRENT_TIMESTAMP
      `, [id_uuid, tenantId, name, description, JSON.stringify(toolChain), created_by_identity]);
    } catch (err) {
      console.warn("Postgres synchronization failed in learnWorkflow, fallback store used:", err);
    }
  }

  return record;
}

/**
 * Tool 6: Get Learned Workflows List
 */
export async function getLearnedWorkflows(tenantId: string): Promise<any[]> {
  if (isUsingFallback) {
    return (fallbackStore.customWorkflows || []).filter((w: any) => w.tenant_id === tenantId);
  }

  try {
    const result = await pool.query("SELECT id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence, created_by_identity, created_at_utc, updated_at_utc FROM sys_louis_ai_custom_workflows WHERE tenant_id = $1", [tenantId]);
    
    // Auto-recovery / Dual Database Symmetrie:
    // If PostgreSQL has 0 rows, but we find workflows in our local fallback store, sync them into PG
    if (result.rows.length === 0 && fallbackStore.customWorkflows && fallbackStore.customWorkflows.length > 0) {
      const locals = fallbackStore.customWorkflows.filter((w: any) => w.tenant_id === tenantId);
      if (locals.length > 0) {
        for (const local of locals) {
          try {
            await pool.query(`
              INSERT INTO sys_louis_ai_custom_workflows (id_uuid, tenant_id, workflow_name, workflow_description, tool_chain_sequence)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (tenant_id, workflow_name) DO NOTHING
            `, [local.id_uuid, local.tenant_id, local.workflow_name, local.workflow_description, JSON.stringify(local.tool_chain_sequence)]);
          } catch (e) {
            console.warn("Failed background Postgres sync of custom workflow", e);
          }
        }
        return locals;
      }
    }
    return result.rows;
  } catch (err) {
    console.warn("Postgres query failed in getLearnedWorkflows, falling back to local fallbackStore:", err);
    return (fallbackStore.customWorkflows || []).filter((w: any) => w.tenant_id === tenantId);
  }
}

/**
 * Tool 7: Delete Learned Workflow
 */
export async function deleteWorkflow(tenantId: string, id_uuid: string): Promise<boolean> {
  // Always delete from local fallback first
  let fallbackUpdated = false;
  if (!fallbackStore.customWorkflows) {
    fallbackStore.customWorkflows = [];
  }
  const initialLen = fallbackStore.customWorkflows.length;
  fallbackStore.customWorkflows = fallbackStore.customWorkflows.filter(
    (w: any) => !(w.id_uuid === id_uuid && w.tenant_id === tenantId)
  );
  if (fallbackStore.customWorkflows.length < initialLen) {
    fallbackUpdated = true;
    saveFallbackStore();
  }

  let dbDeleted = false;
  if (!isUsingFallback) {
    try {
      const result = await pool.query(
        "DELETE FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1 AND tenant_id = $2",
        [id_uuid, tenantId]
      );
      if (result.rowCount !== null && result.rowCount > 0) {
        dbDeleted = true;
      }
    } catch (err) {
      console.warn("Postgres deletion failed in deleteWorkflow, fallback data was updated:", err);
    }
  }

  return fallbackUpdated || dbDeleted;
}
