// ============================================================================
// Befund-3-Fix (2026-08-17) — Vault-Tool-Klassifikation
// ----------------------------------------------------------------------------
// Problem: Die READ_TOOL_WHITELIST im ReAct-Loop kannte keine Vault-Tools →
// parallele vault_list-Aufrufe wurden gefiltert → "[Duplicate Block]"-Abbruch mit
// durchgesickertem Thought als Endtext (unvollständige AI-Antworten).
// Zusätzlich (Befund 3b): WRITE_ACTION_MAP matcht nur logische Namen — normalisierte
// MCP-Namen (mcp_<server>_vault_write) umgingen den Governance-Check.
//
// Lösung: suffix-basierte Klassifikation (logisch UND normalisiert), robust gegen
// Server-Umbenennungen (der Server-Prefix mcp_<name>_ ist beliebig).
// ============================================================================

import { GovernanceAction } from "../../types.js";

export const VAULT_READ_TOOL_SUFFIXES = [
  "vault_list",
  "vault_read",
  "vault_get_document_map",
  "vault_search",
  "search_simple",
  "search_query",
  "tag_list",
  "command_list",
  "active_file_get_path"
];

export const VAULT_WRITE_TOOL_SUFFIXES = [
  "vault_write",
  "vault_append",
  "vault_patch",
  "vault_delete",
  "vault_move",
  "vault_copy"
];

/** Klassifiziert einen Vault-Tool-Namen (logisch oder normalisiert) als read/write — sonst null. */
export function vaultToolKind(name: string): "read" | "write" | null {
  const s = name.toLowerCase();
  if (VAULT_WRITE_TOOL_SUFFIXES.some((x) => s === x || s.endsWith(`_${x}`))) return "write";
  if (VAULT_READ_TOOL_SUFFIXES.some((x) => s === x || s.endsWith(`_${x}`))) return "read";
  return null;
}

/** Liefert den Basis-Namen (Suffix) eines Vault-Write-Tools — für Governance-Mapping bei normalisierten Namen. */
export function vaultWriteBaseName(name: string): string | undefined {
  const s = name.toLowerCase();
  return VAULT_WRITE_TOOL_SUFFIXES.find((x) => s === x || s.endsWith(`_${x}`));
}

/** Governance-Mapping für die RAW-MCP-Vault-Write-Tools (Befund 3b). */
export const VAULT_WRITE_ACTION_MAP: Record<string, { entity: string; action: GovernanceAction }> = {
  vault_write: { entity: "vault_file", action: "CREATE" },
  vault_append: { entity: "vault_file", action: "CREATE" },
  vault_patch: { entity: "vault_file", action: "UPDATE" },
  vault_delete: { entity: "vault_file", action: "DELETE" },
  vault_move: { entity: "vault_file", action: "MOVE" },
  vault_copy: { entity: "vault_file", action: "CREATE" }
};
