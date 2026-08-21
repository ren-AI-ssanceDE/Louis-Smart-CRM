// ============================================================================
// S10: Vault-Store — Obsidian-MCP-Gedächtnis & Wissens-Skills (2-Tier Hot-Switch)
// ----------------------------------------------------------------------------
// Tier 1: Obsidian-MCP (obsidian-mcp@2, direkt auf Vault-Dateien) — Konvention: obsidian_<op>
// Tier 2: sys_louis_ai_user_memory (DB) — NUR LESEN (Memory); Schreiben: Fehler+Audit (nie still)
//
// (Der frühere Tier-2-Markdown-Vault-Server wurde am 2026-08-16 entfernt — Obsidian ist die
// einzige Wissensanbindung; knowledge_data_vault bleibt als interne KI-DB.)
//
// Die Zuordnung Tier↔Tool kommt aus sys_mcp_tool_mappings (Admin-Konfiguration).
// Solange keine MCP-Server registriert sind, fallen Lese-Pfade auf den Memory-Tier
// zurück und Schreib-Pfade liefern einen Fehler-Envelope + VAULT_WRITE_FAILED-Audit.
//
// Pfad-Governance (hart im Code): Lesen BLOCKED: Privat/; Schreiben BLOCKED: Privat/, RO/;
// Schreiben ERLAUBT NUR unter _louis/.
// ============================================================================

import { pool, isUsingFallback, fallbackStore, logAuditEvent } from "../db.js";
import { McpClientEngine } from "../mcp/mcpClientEngine.js";
import { evaluateGovernanceRules } from "./governance.js";
import { AgentUserMemory } from "./agentTypes.js";

export interface VaultReadResult {
  path: string;
  content: string;
  source: "tier1" | "tier2";
}

export interface VaultSearchHit {
  path: string;
  snippet: string;
  score: number;
}

export const VAULT_BLOCKED_READ_PREFIXES: string[] = ["Privat/"];
export const VAULT_BLOCKED_WRITE_PREFIXES: string[] = ["Privat/", "RO/"];
export const VAULT_ALLOWED_WRITE_PREFIX: string = "_louis/";

/**
 * Pfad-Sanitisierung (verhindert Path-Traversal): akzeptiert NUR relative Vault-Pfade.
 * Verwirft absolute Pfade, ..-Segmente, führende Slashes, Backslashes und null-Bytes.
 * Bei Schreibzugriff zusätzlich: nur .md-Endung. Rückgabe null = Governance-Verletzung.
 */
export function sanitizeVaultPath(relativePath: string, forWrite: boolean = false): string | null {
  if (!relativePath || typeof relativePath !== "string") return null;
  const p = relativePath.replace(/\\/g, "/").trim();
  if (p.length === 0) return null;
  if (p.includes("\0")) return null;
  if (p.startsWith("/") || p.startsWith("\\")) return null;
  if (/^[a-zA-Z]:/.test(p)) return null; // absolute Windows-Pfade (C:\...)
  const segments = p.split("/");
  if (segments.some((s) => s === "..")) return null;
  if (forWrite && !p.toLowerCase().endsWith(".md")) return null;
  return p;
}

interface TierResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * MCP-Fehler erkennen (B3-Fix 2026-08-16): Manche Server liefern bei Fehlern trotz
 * HTTP 200 ein Ergebnis mit isError:true oder einen Fehlertext statt JSON.
 * Vorher: roher String → ok:true → vaultReadText crashte bei res.content.length.
 */
function isMcpErrorResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.isError === true) {
    // Fehlertext aus content[0].text ziehen, falls vorhanden
    if (Array.isArray(r.content) && r.content.length > 0) {
      const first = r.content[0] as Record<string, unknown>;
      if (typeof first?.text === "string") return first.text;
    }
    return "MCP-Fehler (isError)";
  }
  return null;
}

/** Führt ein MCP-Tool eines Tiers aus; versucht Tier-Konvention, dann logischen Namen. */
async function tryTierCall<T>(tierPrefix: string, louisToolName: string, tenantId: string, args: Record<string, unknown>): Promise<TierResult<T>> {
  const candidates = [`${tierPrefix}_${louisToolName}`, louisToolName];
  for (const name of candidates) {
    try {
      const tool = await McpClientEngine.getToolByNormalizedName(name, tenantId);
      if (!tool) continue;
      const res = await McpClientEngine.executeTool({ tool_id_uuid: tool.id_uuid, arguments: args }, tenantId);
      if (res.success) {
        // B3: Fehlerantworten (isError) NICHT als Erfolg behandeln
        const errText = isMcpErrorResult(res.result);
        if (errText) return { ok: false, error: errText };
        return { ok: true, data: unwrapMcpResult(res.result) as T };
      }
      return { ok: false, error: res.error || "MCP-Fehler" };
    } catch (err) {
      // weiter zum nächsten Kandidaten/Tier
    }
  }
  return { ok: false, error: `MCP-Tool ${tierPrefix}_${louisToolName} nicht verfügbar` };
}

/**
 * MCP-Standard-Antwort entpacken: { content: [{ type: "text", text: "..." }] }
 * → der text ist bei obsidian-mcp@2 ein JSON-String (ggf. mit Text-Präfix wie
 *   "Read Obsidian Note succeeded.\n{...}") → JSON wird extrahiert und geparst.
 * Falls result bereits ein nutzbares Objekt ist, wird es unverändert geliefert.
 */
function unwrapMcpResult(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content) && r.content.length > 0) {
    const first = r.content[0] as Record<string, unknown>;
    if (typeof first?.text === "string") {
      const text = first.text.trim();
      // JSON ab dem ersten { oder [ (Text-Präfix überspringen)
      const jsonStart = text.search(/[\[{]/);
      if (jsonStart >= 0) {
        const candidate = text.slice(jsonStart);
        try {
          return JSON.parse(candidate);
        } catch {
          // kein JSON — rohen Text zurückgeben
        }
      }
      return text;
    }
  }
  return result;
}

/** Governance-Block-Helper: liefert true, wenn die Aktion geblockt/auditiert wurde. */
async function governanceBlock(tenantId: string, entityType: string, action: "CREATE" | "UPDATE" | "READ", note: string): Promise<boolean> {
  await logAuditEvent({
    tenantId,
    eventType: "GOVERNANCE_BLOCK",
    entityType,
    eventDetails: note,
    actorIdentity: "vaultStore"
  });
  return true;
}

export async function vaultReadText(tenantId: string, relativePath: string): Promise<VaultReadResult> {
  const clean = sanitizeVaultPath(relativePath, false);
  if (!clean) {
    await governanceBlock(tenantId, "vault", "READ", `Ungültiger Vault-Pfad (Path-Traversal-Versuch): ${relativePath}`);
    throw new Error(`Governance-Block: Ungültiger Vault-Pfad '${relativePath}'`);
  }
  for (const prefix of VAULT_BLOCKED_READ_PREFIXES) {
    if (clean.startsWith(prefix)) {
      await governanceBlock(tenantId, "vault", "READ", `Lesezugriff blockiert (${prefix}): ${clean}`);
      throw new Error(`Governance-Block: Zugriff auf '${clean}' verweigert (geschützter Bereich)`);
    }
  }
  // Tier 1 (Obsidian, Local-REST-API-MCP-Plugin) — Tool: vault_read { path }
  const tier1 = await tryTierCall<VaultReadResult>("obsidian", "vault_read", tenantId, { path: clean });
  if (tier1.ok && tier1.data && typeof (tier1.data as VaultReadResult).content === "string") {
    return { ...tier1.data, source: "tier1" } as VaultReadResult;
  }
  if (!tier1.ok) {
    throw new Error(`Vault-Lesezugriff fehlgeschlagen: ${tier1.error || clean}`);
  }
  // Memory-Tier nicht verfügbar für generische Pfade: Fehler
  throw new Error(`Vault-Lesezugriff fehlgeschlagen (Tier 1 nicht verfügbar): ${clean}`);
}

export async function vaultSearch(tenantId: string, query: string, limit: number): Promise<VaultSearchHit[]> {
  const clampedLimit = Math.min(Math.max(limit, 1), 20);
  // Plugin-Tool: search_simple (Obsidian-Volltextsuche) — Ergebnisformat: [{ path, snippet, score? }] o. ä.
  const tier1 = await tryTierCall<unknown>("obsidian", "search_simple", tenantId, { query, limit: clampedLimit });
  if (tier1.ok && tier1.data) {
    const raw = tier1.data as { matches?: VaultSearchHit[] } | VaultSearchHit[];
    const hits = Array.isArray(raw) ? raw : raw.matches;
    if (Array.isArray(hits)) return hits as VaultSearchHit[];
  }
  return []; // nie werfen
}

export async function vaultWriteText(tenantId: string, relativePath: string, content: string): Promise<{ path: string; source: "tier1" | "tier2" }> {
  const clean = sanitizeVaultPath(relativePath, true);
  if (!clean) {
    await governanceBlock(tenantId, "vault", "CREATE", `Ungültiger Schreib-Pfad (Traversal oder keine .md): ${relativePath}`);
    throw new Error(`Governance-Block: Ungültiger Schreib-Pfad '${relativePath}'`);
  }
  for (const prefix of VAULT_BLOCKED_WRITE_PREFIXES) {
    if (clean.startsWith(prefix)) {
      await governanceBlock(tenantId, "vault", "CREATE", `Schreibzugriff blockiert (${prefix}): ${clean}`);
      throw new Error(`Governance-Block: Schreiben nach '${clean}' verweigert (geschützter Bereich)`);
    }
  }
  if (!clean.startsWith(VAULT_ALLOWED_WRITE_PREFIX)) {
    await governanceBlock(tenantId, "vault", "CREATE", `Schreiben außerhalb ${VAULT_ALLOWED_WRITE_PREFIX} blockiert: ${clean}`);
    throw new Error(`Governance-Block: Schreiben ist nur unter '${VAULT_ALLOWED_WRITE_PREFIX}' erlaubt (${clean})`);
  }
  // Zweite Ebene (S8): Governance-Regeln für vault_skill
  const gov = await evaluateGovernanceRules(tenantId, clean.startsWith("_louis/skills/") ? "vault_skill" : "vault_memory", clean.startsWith("_louis/skills/") ? "CREATE" : "UPDATE");
  if (gov.effect === "BLOCK") {
    await logAuditEvent({ tenantId, eventType: "GOVERNANCE_BLOCK", entityType: "vault", eventDetails: `vaultWriteText: ${gov.note || "blockiert"}`, actorIdentity: "vaultStore" });
    throw new Error(`Governance-Block: ${gov.note || "Schreiben blockiert"}`);
  }
  // Tier 1 (Obsidian, Local-REST-API-MCP-Plugin) — Tool: vault_write { path, content } (erstellt oder überschreibt)
  const tier1 = await tryTierCall<{ path: string }>("obsidian", "vault_write", tenantId, { path: clean, content });
  if (tier1.ok && tier1.data) return { path: String(tier1.data.path || clean), source: "tier1" };
  // Tier 1 fehlt → Fehler + Audit (nie still)
  await logAuditEvent({ tenantId, eventType: "VAULT_WRITE_FAILED", entityType: "vault", eventDetails: `Schreiben fehlgeschlagen (Tier 1 down): ${clean}`, actorIdentity: "vaultStore" });
  throw new Error(`Vault-Schreibzugriff fehlgeschlagen (Tier 1 nicht verfügbar): ${clean}`);
}

// vaultDeleteText — Datei aus dem Vault löschen (nur _louis/, .md, Governance wie Write)
export async function vaultDeleteText(tenantId: string, relativePath: string): Promise<{ path: string; source: "tier1" | "tier2" }> {
  const clean = sanitizeVaultPath(relativePath, true);
  if (!clean) {
    await governanceBlock(tenantId, "vault", "UPDATE", `Ungültiger Lösch-Pfad (Traversal oder keine .md): ${relativePath}`);
    throw new Error(`Governance-Block: Ungültiger Lösch-Pfad '${relativePath}'`);
  }
  for (const prefix of VAULT_BLOCKED_WRITE_PREFIXES) {
    if (clean.startsWith(prefix)) {
      await governanceBlock(tenantId, "vault", "UPDATE", `Löschzugriff blockiert (${prefix}): ${clean}`);
      throw new Error(`Governance-Block: Löschen aus '${clean}' verweigert (geschützter Bereich)`);
    }
  }
  if (!clean.startsWith(VAULT_ALLOWED_WRITE_PREFIX)) {
    await governanceBlock(tenantId, "vault", "UPDATE", `Löschen außerhalb ${VAULT_ALLOWED_WRITE_PREFIX} blockiert: ${clean}`);
    throw new Error(`Governance-Block: Löschen ist nur unter '${VAULT_ALLOWED_WRITE_PREFIX}' erlaubt (${clean})`);
  }
  const gov = await evaluateGovernanceRules(tenantId, clean.startsWith("_louis/skills/") ? "vault_skill" : "vault_memory", "UPDATE");
  if (gov.effect === "BLOCK") {
    await logAuditEvent({ tenantId, eventType: "GOVERNANCE_BLOCK", entityType: "vault", eventDetails: `vaultDeleteText: ${gov.note || "blockiert"}`, actorIdentity: "vaultStore" });
    throw new Error(`Governance-Block: ${gov.note || "Löschen blockiert"}`);
  }
  // Tier 1 (Obsidian, Local-REST-API-MCP-Plugin) — Tool: vault_delete { path } (Papierkorb)
  const tier1 = await tryTierCall<{ path: string }>("obsidian", "vault_delete", tenantId, { path: clean });
  if (tier1.ok && tier1.data) return { path: String(tier1.data.path || clean), source: "tier1" };
  await logAuditEvent({ tenantId, eventType: "VAULT_DELETE_FAILED", entityType: "vault", eventDetails: `Löschen fehlgeschlagen (Tier 1 down): ${clean}`, actorIdentity: "vaultStore" });
  throw new Error(`Vault-Löschzugriff fehlgeschlagen (Tier 1 nicht verfügbar): ${clean}`);
}

// ---------------------------------------------------------------------------
// User-Memory (Vault-first, Tier-3-Fallback)
// ---------------------------------------------------------------------------

const parseJsonArray = <T>(value: unknown): T[] => {
  if (!value) return [];
  try {
    const arr = JSON.parse(String(value));
    return Array.isArray(arr) ? (arr as T[]) : [];
  } catch {
    return [];
  }
};

function parseMemoryMarkdown(md: string): AgentUserMemory | null {
  if (!md || !md.includes("##")) return null;
  const preferences: string[] = [];
  const notes: string[] = [];
  let section: "pref" | "notes" | null = null;
  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## Preferences")) { section = "pref"; continue; }
    if (trimmed.startsWith("## Notes")) { section = "notes"; continue; }
    if (trimmed.startsWith("## ")) { section = null; continue; }
    if (section === "pref" && trimmed.startsWith("- ")) preferences.push(trimmed.slice(2));
    if (section === "notes" && trimmed.startsWith("- ")) notes.push(trimmed.slice(2));
  }
  return {
    response_preferences_text: preferences.join("\n"),
    frequently_used_tools_json: [],
    chat_notes_json: notes.map((n, i) => ({ id_uuid: `vault-note-${i}`, content: n, created_at_utc: new Date().toISOString() }))
  };
}

export async function readUserMemoryVault(tenantId: string, userId: string): Promise<AgentUserMemory | null> {
  const relPath = `_louis/memory/${tenantId}/${userId}.md`;
  const tier1 = await tryTierCall<{ content: string }>("obsidian", "vault_read", tenantId, { path: relPath });
  if (tier1.ok && tier1.data) {
    const parsed = parseMemoryMarkdown(String(tier1.data.content || ""));
    if (parsed) return parsed;
  }
  // Tier 2: DB-Fallback (nur lesen) — exakt die getTenantUserMemory-Logik
  try {
    if (isUsingFallback || !pool) {
      const records = fallbackStore.louisAiUserMemory || [];
      const record = records.find((m) => m.user_id === userId && m.tenant_id === tenantId);
      if (!record) return null;
      return {
        response_preferences_text: String(record.response_preferences_text || ""),
        frequently_used_tools_json: parseJsonArray<{ tool: string; count: number }>(record.frequently_used_tools_json),
        chat_notes_json: parseJsonArray<{ id_uuid: string; content: string; created_at_utc: string }>(record.chat_notes_json)
      };
    }
    const res = await pool.query(
      `SELECT response_preferences_text, frequently_used_tools_json, chat_notes_json FROM sys_louis_ai_user_memory WHERE user_id = $1 AND tenant_id = $2 LIMIT 1`,
      [userId, tenantId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      response_preferences_text: String(row.response_preferences_text || ""),
      frequently_used_tools_json: parseJsonArray<{ tool: string; count: number }>(row.frequently_used_tools_json),
      chat_notes_json: parseJsonArray<{ id_uuid: string; content: string; created_at_utc: string }>(row.chat_notes_json)
    };
  } catch {
    return null;
  }
}

export async function writeUserMemoryVault(tenantId: string, userId: string, memory: AgentUserMemory): Promise<{ path: string; source: "tier1" | "tier2" }> {
  const relPath = `_louis/memory/${tenantId}/${userId}.md`;
  const prefLines = (memory.response_preferences_text || "").split("\n").filter(Boolean).map((p) => `- ${p}`).join("\n");
  const noteLines = (memory.chat_notes_json || []).map((n) => `- ${n.content}`).join("\n");
  const md = `---\ntags: [louis-memory]\ntenant_id: ${tenantId}\nuser_id: ${userId}\nupdated: ${new Date().toISOString()}\n---\n\n## Preferences\n${prefLines || "- (keine)"}\n\n## Notes\n${noteLines || "- (keine)"}\n`;
  return vaultWriteText(tenantId, relPath, md);
}

// ---------------------------------------------------------------------------
// Wissens-Skills (nur lesen/injizieren; Schreiben via save_skill → Freigabe-Flow)
// ---------------------------------------------------------------------------

// (2026-08-18): Eindeutiger Skill-Marker — wird von ALLEN
// Schreibpfaden gesetzt (approveProposal louisAi.ts + SkillsTab.tsx: tags: [louis-skill]).
// resolveSkillFiles löst Skills über diese Volltext-Markierung auf (bewährte Lösung:
// deterministischer, funktionierender Pfad statt fragiler API-Ordner-Listung).
export const SKILL_SEARCH_MARKER = "louis-skill";

export interface VaultSkillFile {
  path: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  version: number;
 // P2-E: Pinned-Skills werden immer injiziert (Prio vor Scoring)
  pinned?: boolean;
 // P1-1: + archived (in _archive/ verschoben — nie gelöscht) + Usage-Zähler (#30)
  //: + archived (in _archive/ verschoben — nie gelöscht) + Usage-Zähler (#30)
  status?: "active" | "inactive" | "archived";
  lastUsedAtUtc?: string | null;
  useCount?: number;
  viewCount?: number;
  patchCount?: number;
}

/** Parst eine Skill-Datei (Frontmatter + Body) in VaultSkillFile — pure, testbar, kein any. */
export function parseSkillFile(filename: string, content: string): VaultSkillFile {
  const name = filename.replace(/\.md$/, "").split("/").pop() || filename.replace(/\.md$/, "");
  // Frontmatter-Tags parsen (tags: [a, b] oder tags: [a] oder tags:\n - a)
  const tagMatch = content.match(/^tags:\s*\[(.*?)\]/m) || content.match(/^tags:\s*\n((?:\s*-\s*.+\n?)+)/m);
  const tags = tagMatch
    ? tagMatch[1].includes(",")
      ? tagMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
      : tagMatch[1].includes("\n")
        ? (tagMatch[1].match(/- (.+)/g) || []).map((t) => t.replace("- ", "").trim())
        : [tagMatch[1].trim()] // Einzel-Tag ohne Komma (z.B. tags: [louis-skill])
    : [];
  const descMatch = content.match(/^description:\s*(.+)$/m);
 // P1-1: + archived-Status + Usage-Zähler (#30)
  //: + archived-Status + Usage-Zähler (#30)
  const statusMatch = content.match(/^status:\s*(active|inactive|archived)\s*$/m);
  const usedMatch = content.match(/^last_used_at_utc:\s*(.+)$/m);
  const counter = (name: string): number => {
    const m = content.match(new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return {
    path: filename,
    name,
    description: descMatch ? descMatch[1].trim() : "",
    content,
    tags,
    version: 1,
    status: statusMatch ? (statusMatch[1] as "active" | "inactive" | "archived") : "active",
    lastUsedAtUtc: usedMatch ? usedMatch[1].trim() : null,
    useCount: counter("use_count"),
    viewCount: counter("view_count"),
    patchCount: counter("patch_count")
  };
}

export async function resolveSkillFiles(tenantId: string): Promise<VaultSkillFile[]> {
 // (2026-08-18): Tier-1-`vault_list` kann KEINE Unterordner-Listungen
  // (liefert für "_louis/skills" immer [] — nur die Wurzel-Ebene funktioniert; verifiziert).
  // bewährte Lösung: Skills über die Volltext-Suche mit dem Skill-Marker auflösen (analog
  // Dateisystem-Scan des Skill-Ordners) — deterministisch, nutzt den funktionierenden Pfad.
  // `vault_list` bleibt als Fallback-Versuch für künftige API-Verbesserungen.
  try {
    const searchRes = await tryTierCall<unknown>("obsidian", "search_simple", tenantId, { query: SKILL_SEARCH_MARKER, limit: 50 });
    const raw = searchRes.ok ? searchRes.data : null;
    const hits = Array.isArray(raw) ? raw : (raw as { matches?: unknown[] } | undefined)?.matches;
    if (Array.isArray(hits) && hits.length > 0) {
      const skills: VaultSkillFile[] = [];
      for (const entry of hits) {
        const filename = String((entry as { filename?: string })?.filename || "");
        // Nur Dateien im Skill-Ordner (verhindert Rauschen aus anderen _louis-/Doku-Dateien);
        // _archive/-Skills (026 P1-1) bleiben erhalten, werden aber nicht injiziert.
        if (!filename.startsWith("_louis/skills/") || filename.startsWith("_louis/skills/_archive/") || !filename.endsWith(".md")) continue;
        const readRes = await tryTierCall<{ content: string }>("obsidian", "vault_read", tenantId, { path: filename });
        if (!readRes.ok || !readRes.data) continue;
        skills.push(parseSkillFile(filename, String(readRes.data.content || "")));
      }
      return skills;
    }
  } catch (err) {
    console.warn("[vaultStore] resolveSkillFiles (Suche über Skill-Marker) fehlgeschlagen:", err);
  }

  // Fallback: bisheriger vault_list-Weg (funktioniert, falls die API später Rekursion kann)
  try {
    const listRes = await tryTierCall<unknown>("obsidian", "vault_list", tenantId, { path: "_louis/skills" });
    if (!listRes.ok || !listRes.data) return [];
    const raw = listRes.data as { files?: Array<{ name?: string; path?: string }> } | Array<{ name?: string; path?: string }>;
    const files = Array.isArray(raw) ? raw : raw.files;
    if (!Array.isArray(files)) return [];
    const skills: VaultSkillFile[] = [];
    for (const entry of files) {
      const fileName = entry?.name || (entry?.path || "").split("/").pop() || "";
      if (!fileName.endsWith(".md")) continue;
      if (fileName.startsWith("_archive")) continue; // 026 P1-1: Archiv nicht injizieren
      const relPath = `_louis/skills/${fileName}`;
      const readRes = await tryTierCall<{ content: string }>("obsidian", "vault_read", tenantId, { path: relPath });
      if (!readRes.ok || !readRes.data) continue;
      skills.push(parseSkillFile(relPath, String(readRes.data.content || "")));
    }
    return skills;
  } catch (err) {
    console.warn("[vaultStore] resolveSkillFiles (vault_list-Fallback) fehlgeschlagen:", err);
    return []; // fehlertolerant
  }
}
