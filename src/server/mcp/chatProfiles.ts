// Chatprofile-Backend (Task C.7/C.8, Plan 2026-08-19)
// Benannte Tool-Sets pro Chat: Main-Systemprofil (alle Admin-freigegebenen Tools) + Chatprofile
// (fixer Name nach Erstellung — Entscheid 2026-08-19), eigene History je (Session, Profil)
// im Archiv (C.8: aktive History bleibt in der Session-Spalte, Swap beim Wechsel).
import { v4 as uuidv4 } from "uuid";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow } from "../db.js";
import { waitForCompressionLock } from "../ai/contextCompressor.js";
import type { ChatMessage } from "../../types.js";

export interface ChatProfileRecord {
  id_uuid: string;
  tenant_id: string;
  profile_name: string; // FIX nach Erstellung (kein Update-Endpunkt für den Namen)
  description?: string | null;
  tools_json?: string[] | null; // NULL = alle Admin-freigegebenen (Main)
  is_system: boolean;
  is_default: boolean;
  created_by_user_id?: string | null; // NULL = team-weit (Admin), gesetzt = persönlich
  created_at?: string | Date;
  updated_at?: string | Date;
}

// --- Wechsel-Sperre: KEIN Profilwechsel bei laufendem CHAT-Task (2026-2026-08-19) ---
// Nur session-gebundene Tasks blockieren (Agent-Run, Kompression, delegierte Subtasks);
// Crons/Background-Workflows lösen KEINE Sperre aus.
// TTL-Schutz: Marker altert nach 10 min (verhindert klebende Sperren bei Fehlerpfaden).
const activeChatTasks = new Map<string, number>();
const CHAT_TASK_TTL_MS = 10 * 60 * 1000;

export function markChatTaskActive(sessionId: string, active: boolean): void {
  if (active) activeChatTasks.set(sessionId, Date.now());
  else activeChatTasks.delete(sessionId);
}

export function isChatTaskActive(sessionId: string): boolean {
  const started = activeChatTasks.get(sessionId);
  if (started === undefined) return false;
  if (Date.now() - started > CHAT_TASK_TTL_MS) {
    activeChatTasks.delete(sessionId);
    return false;
  }
  return true;
}

// --- Hauptfunktionen -----------------------------------------------------------

export async function getOrCreateMainProfile(tenantId: string): Promise<ChatProfileRecord | null> {
  if (isUsingFallback) {
    if (!fallbackStore.mcpChatProfiles) fallbackStore.mcpChatProfiles = [];
    let main = fallbackStore.mcpChatProfiles.find((p) => p.tenant_id === tenantId && p.profile_name === "main");
    if (!main) {
      main = {
        id_uuid: uuidv4(),
        tenant_id: tenantId,
        profile_name: "main",
        description: "Alle freigegebenen Tools",
        tools_json: null,
        is_system: true,
        is_default: true,
        created_by_user_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      fallbackStore.mcpChatProfiles.push(main);
      saveFallbackStore();
    }
    return main;
  }
  const res = await pool.query(
    `SELECT * FROM sys_mcp_chat_profiles WHERE tenant_id = $1 AND profile_name = 'main' LIMIT 1`,
    [tenantId]
  );
  if (res.rows.length > 0) return cleanDbRow(res.rows[0]) as ChatProfileRecord;
  const id = uuidv4();
  const inserted = await pool.query(
    `INSERT INTO sys_mcp_chat_profiles (id_uuid, tenant_id, profile_name, description, tools_json, is_system, is_default)
     VALUES ($1, $2, 'main', 'Alle freigegebenen Tools', NULL, TRUE, TRUE) RETURNING *`,
    [id, tenantId]
  );
  return cleanDbRow(inserted.rows[0]) as ChatProfileRecord;
}

export async function getChatProfileById(tenantId: string, profileId: string): Promise<ChatProfileRecord | null> {
  if (isUsingFallback) {
    return (fallbackStore.mcpChatProfiles || []).find((p) => p.id_uuid === profileId && p.tenant_id === tenantId) || null;
  }
  const res = await pool.query(
    `SELECT * FROM sys_mcp_chat_profiles WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1`,
    [profileId, tenantId]
  );
  return res.rows.length > 0 ? (cleanDbRow(res.rows[0]) as ChatProfileRecord) : null;
}

export async function listChatProfiles(tenantId: string, userId?: string): Promise<ChatProfileRecord[]> {
  // Main-Systemprofil lazy-seeden (Fallback-Modus + frische DBs — Main existiert immer)
  await getOrCreateMainProfile(tenantId);
  if (isUsingFallback) {
    const list = fallbackStore.mcpChatProfiles || [];
    return list.filter((p) => p.tenant_id === tenantId && (p.created_by_user_id === null || p.created_by_user_id === userId || p.created_by_user_id === undefined));
  }
  const res = await pool.query(
    `SELECT * FROM sys_mcp_chat_profiles
     WHERE tenant_id = $1 OR tenant_id = '1'
       AND (created_by_user_id IS NULL OR created_by_user_id = $2)
     ORDER BY is_system DESC, profile_name ASC`,
    [tenantId, userId || ""]
  );
  return res.rows.map((r) => cleanDbRow(r) as ChatProfileRecord);
}

export async function createChatProfile(
  tenantId: string,
  userId: string,
  input: { profile_name: string; description?: string; tools?: string[] | null; team_wide?: boolean }
): Promise<ChatProfileRecord> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const name = String(input.profile_name || "").trim();
  if (!name || name === "main") throw new Error("Profilname ungültig (Pflichtfeld, 'main' ist reserviert)");
  const record: ChatProfileRecord = {
    id_uuid: id,
    tenant_id: tenantId,
    profile_name: name,
    description: input.description || null,
    tools_json: Array.isArray(input.tools) ? input.tools : null,
    is_system: false,
    is_default: false,
    created_by_user_id: input.team_wide ? null : userId,
    created_at: now,
    updated_at: now
  };
  if (isUsingFallback) {
    if (!fallbackStore.mcpChatProfiles) fallbackStore.mcpChatProfiles = [];
    fallbackStore.mcpChatProfiles.push(record);
    saveFallbackStore();
    return record;
  }
  const res = await pool.query(
    `INSERT INTO sys_mcp_chat_profiles (id_uuid, tenant_id, profile_name, description, tools_json, is_system, is_default, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6) RETURNING *`,
    [id, tenantId, name, record.description, record.tools_json ? JSON.stringify(record.tools_json) : null, record.created_by_user_id]
  );
  return cleanDbRow(res.rows[0]) as ChatProfileRecord;
}

/** Nur Beschreibung editierbar — der Name ist FIX (Zuordnungs-Stabilität, 2026-08-19). */
export async function updateChatProfile(
  tenantId: string,
  profileId: string,
  userId: string,
  input: { description?: string | null; tools?: string[] | null }
): Promise<ChatProfileRecord | null> {
  const { description, tools } = input;
  if (isUsingFallback) {
    const list = fallbackStore.mcpChatProfiles || [];
    const idx = list.findIndex((p) => p.id_uuid === profileId && p.tenant_id === tenantId);
    if (idx < 0) return null;
    const hasTools = Array.isArray(tools);
    list[idx] = {
      ...list[idx],
      ...(description !== undefined ? { description: description || null } : {}),
      ...(hasTools ? { tools_json: tools } : {}),
      updated_at: new Date().toISOString()
    };
    saveFallbackStore();
    return list[idx];
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (description !== undefined) {
    sets.push(`description = $${params.length + 1}`);
    params.push(description || null);
  }
  if (Array.isArray(tools)) {
    sets.push(`tools_json = $${params.length + 1}`);
    params.push(JSON.stringify(tools));
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at_utc = CURRENT_TIMESTAMP`);
  params.push(profileId, tenantId, userId);
  // is_system (Main) ist NUR bearbeitbar (nie löschbar) — Systemprofil braucht Admin-Konfiguration
  const res = await pool.query(
    `UPDATE sys_mcp_chat_profiles SET ${sets.join(", ")}
     WHERE id_uuid = $${params.length - 2} AND tenant_id = $${params.length - 1}
       AND (created_by_user_id IS NULL OR created_by_user_id = $${params.length}) RETURNING *`,
    params
  );
  return res.rows.length > 0 ? (cleanDbRow(res.rows[0]) as ChatProfileRecord) : null;
}

// Abwärtskompatibler Alias (Aufrufer aus früheren Phasen)
export const updateChatProfileDescription = async (
  tenantId: string,
  profileId: string,
  userId: string,
  description?: string
): Promise<ChatProfileRecord | null> => updateChatProfile(tenantId, profileId, userId, { description });

export async function deleteChatProfile(tenantId: string, profileId: string, userId: string): Promise<boolean> {
  if (isUsingFallback) {
    const list = fallbackStore.mcpChatProfiles || [];
    const idx = list.findIndex((p) => p.id_uuid === profileId && p.tenant_id === tenantId);
    if (idx < 0 || list[idx].is_system) return false;
    list.splice(idx, 1);
    saveFallbackStore();
    return true;
  }
  const res = await pool.query(
    `DELETE FROM sys_mcp_chat_profiles
     WHERE id_uuid = $1 AND tenant_id = $2 AND is_system = FALSE
       AND (created_by_user_id IS NULL OR created_by_user_id = $3) RETURNING id_uuid`,
    [profileId, tenantId, userId]
  );
  return res.rows.length > 0;
}

/** Sticky Default pro Tenant (Admin setzt; Entscheid 2026-08-19). */
export async function setDefaultChatProfile(tenantId: string, profileId: string): Promise<boolean> {
  //  2026-08-19: Main (is_system) muss als Default setzbar sein — sonst fällt
  // die Main-Konfiguration bei ungebundenen Sessions auf andere Profile zurück. is_system
  // blockt nur LÖSCHEN, nicht die Default-Rolle.
  if (isUsingFallback) {
    const list = fallbackStore.mcpChatProfiles || [];
    const target = list.find((p) => p.id_uuid === profileId && p.tenant_id === tenantId);
    if (!target) return false;
    for (const p of list) p.is_default = false;
    target.is_default = true;
    saveFallbackStore();
    return true;
  }
  await pool.query(`UPDATE sys_mcp_chat_profiles SET is_default = FALSE WHERE tenant_id = $1`, [tenantId]);
  const res = await pool.query(
    `UPDATE sys_mcp_chat_profiles SET is_default = TRUE WHERE id_uuid = $1 AND tenant_id = $2 RETURNING id_uuid`,
    [profileId, tenantId]
  );
  return res.rows.length > 0;
}

export async function getDefaultProfileId(tenantId: string): Promise<string | null> {
  if (isUsingFallback) {
    const list = fallbackStore.mcpChatProfiles || [];
    const def = list.find((p) => p.tenant_id === tenantId && p.is_default);
    return def?.id_uuid ?? list.find((p) => p.tenant_id === tenantId && p.is_system)?.id_uuid ?? null;
  }
  const res = await pool.query(
    `SELECT id_uuid FROM sys_mcp_chat_profiles WHERE tenant_id = $1 ORDER BY is_default DESC, is_system DESC LIMIT 1`,
    [tenantId]
  );
  return res.rows[0]?.id_uuid ?? null;
}

/** Effektive Tool-Liste eines Profils: tools_json oder null (= alle Admin-freigegebenen). */
export function profileToolNames(profile: ChatProfileRecord | null | undefined): string[] | null {
  if (!profile) return null;
  if (Array.isArray(profile.tools_json)) return profile.tools_json;
  return null; // Main: alle
}

// --- Session-Bindung + History-Swap (C.8) -------------------------------------

export interface SessionProfileInfo {
  profileId: string;
  overrideTools?: string[] | null;
}

export async function getSessionProfile(tenantId: string, sessionId: string): Promise<SessionProfileInfo | null> {
  //  2026-08-19: Ungebundene Bestandssessions (vor C.7 angelegt, kein
  // active_chat_profile_id) fielen auf "alle Tools" zurück — die Main-Konfiguration griff nicht.
  // Fix: leere Bindung → Default-Profil (bzw. Main) → Main-Tool-Auswahl wirkt überall.
  const resolveProfile = async (bound: string | null | undefined): Promise<string> => {
    if (bound) return bound;
    return (await getDefaultProfileId(tenantId)) || "";
  };
  if (isUsingFallback) {
    const session = fallbackStore.louisAiSessions?.find((s) => s.id_uuid === sessionId);
    if (!session) return null;
    return { profileId: await resolveProfile(session.active_chat_profile_id), overrideTools: session.active_mcp_tools_json || null };
  }
  const res = await pool.query(
    `SELECT active_chat_profile_id, active_mcp_tools_json FROM sys_louis_ai_sessions WHERE id_uuid = $1 LIMIT 1`,
    [sessionId]
  );
  if (res.rows.length === 0) return null;
  return {
    profileId: await resolveProfile(res.rows[0].active_chat_profile_id),
    overrideTools: res.rows[0].active_mcp_tools_json || null
  };
}

/**
 * Chatprofil wechseln (C.8): aktive History → Archiv des AKTUELLEN Profils, Ziel-History laden,
 * active_chat_profile_id setzen. Wechsel-Sperre: kein Wechsel bei laufendem CHAT-Task
 * (Agent-Run-Marker, Kompressions-Lock, laufende Subtasks mit Session-Bezug).
 * Crons/Background-Workflows blockieren NICHT.
 */
export async function switchSessionProfile(
  tenantId: string,
  sessionId: string,
  targetProfileId: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Wechsel-Sperre
  if (isChatTaskActive(sessionId)) {
    return { success: false, error: "Chat-Task läuft gerade — Profilwechsel erst nach Abschluss möglich" };
  }
  if (!(await waitForCompressionLock(sessionId))) {
    return { success: false, error: "Chat-Kompression läuft gerade — Profilwechsel erst danach möglich" };
  }
  if (!isUsingFallback) {
    const running = await pool.query(
      `SELECT id_uuid FROM sys_louis_ai_subtasks WHERE parent_session_id = $1 AND status IN ('running', 'pending') LIMIT 1`,
      [sessionId]
    );
    if (running.rows.length > 0) {
      return { success: false, error: "Laufende Sub-Tasks blockieren den Profilwechsel" };
    }
  }

  // 2. Session laden
  let currentProfileId: string | null = null;
  let history: unknown = [];
  let summary = "";
  if (isUsingFallback) {
    const session = fallbackStore.louisAiSessions?.find((s) => s.id_uuid === sessionId);
    if (!session) return { success: false, error: "Session nicht gefunden" };
    currentProfileId = session.active_chat_profile_id || null;
    history = session.conversation_history_json || [];
    summary = session.short_term_summary_text || "";
  } else {
    const res = await pool.query(
      `SELECT active_chat_profile_id, conversation_history_json, short_term_summary_text FROM sys_louis_ai_sessions WHERE id_uuid = $1 LIMIT 1`,
      [sessionId]
    );
    if (res.rows.length === 0) return { success: false, error: "Session nicht gefunden" };
    currentProfileId = res.rows[0].active_chat_profile_id || null;
    history = res.rows[0].conversation_history_json || [];
    summary = res.rows[0].short_term_summary_text || "";
  }

  // 3. Aktuelle History ins Archiv des aktuellen Profils sichern
  if (currentProfileId && currentProfileId !== targetProfileId) {
    if (isUsingFallback) {
      if (!fallbackStore.sessionProfileHistories) fallbackStore.sessionProfileHistories = [];
      const idx = fallbackStore.sessionProfileHistories.findIndex(
        (h) => h.session_id === sessionId && h.chat_profile_id === currentProfileId
      );
      const entry = {
        session_id: sessionId,
        chat_profile_id: currentProfileId,
        conversation_history_json: history,
        short_term_summary_text: summary,
        updated_at_utc: new Date().toISOString()
      };
      if (idx >= 0) fallbackStore.sessionProfileHistories[idx] = entry;
      else fallbackStore.sessionProfileHistories.push(entry);
      saveFallbackStore();
    } else {
      await pool.query(
        `INSERT INTO sys_louis_ai_session_profile_histories (session_id, chat_profile_id, conversation_history_json, short_term_summary_text, updated_at_utc)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (session_id, chat_profile_id) DO UPDATE SET
           conversation_history_json = EXCLUDED.conversation_history_json,
           short_term_summary_text = EXCLUDED.short_term_summary_text,
           updated_at_utc = CURRENT_TIMESTAMP`,
        [sessionId, currentProfileId, JSON.stringify(history), summary]
      );
    }
  }

  // 4. Ziel-History aus dem Archiv laden (oder leer für Erstnutzung)
  let targetHistory: unknown = [];
  let targetSummary = "";
  if (isUsingFallback) {
    const arch = fallbackStore.sessionProfileHistories?.find(
      (h) => h.session_id === sessionId && h.chat_profile_id === targetProfileId
    );
    if (arch) {
      targetHistory = arch.conversation_history_json;
      targetSummary = arch.short_term_summary_text || "";
    }
  } else {
    const arch = await pool.query(
      `SELECT conversation_history_json, short_term_summary_text FROM sys_louis_ai_session_profile_histories
       WHERE session_id = $1 AND chat_profile_id = $2 LIMIT 1`,
      [sessionId, targetProfileId]
    );
    if (arch.rows.length > 0) {
      targetHistory = arch.rows[0].conversation_history_json || [];
      targetSummary = arch.rows[0].short_term_summary_text || "";
    }
  }

  // 5. Session aktualisieren (aktive History bleibt in der Session-Spalte — FTS/message_count unverändert)
  if (isUsingFallback) {
    const session = fallbackStore.louisAiSessions?.find((s) => s.id_uuid === sessionId);
    if (session) {
      session.active_chat_profile_id = targetProfileId;
      session.conversation_history_json = (targetHistory || []) as ChatMessage[];
      session.short_term_summary_text = targetSummary;
    }
    saveFallbackStore();
  } else {
    await pool.query(
      `UPDATE sys_louis_ai_sessions SET active_chat_profile_id = $1, conversation_history_json = $2, short_term_summary_text = $3, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $4`,
      [targetProfileId, JSON.stringify(targetHistory), targetSummary, sessionId]
    );
  }
  return { success: true };
}

/** Session-Override (Tool-Panel im Chat): manuelle Auswahl gewinnt über das Profil. */
export async function setSessionToolOverride(
  tenantId: string,
  sessionId: string,
  tools: string[] | null
): Promise<boolean> {
  if (isUsingFallback) {
    const session = fallbackStore.louisAiSessions?.find((s) => s.id_uuid === sessionId);
    if (!session) return false;
    session.active_mcp_tools_json = tools;
    saveFallbackStore();
    return true;
  }
  const res = await pool.query(
    `UPDATE sys_louis_ai_sessions SET active_mcp_tools_json = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 RETURNING id_uuid`,
    [tools ? JSON.stringify(tools) : null, sessionId]
  );
  return res.rows.length > 0;
}
