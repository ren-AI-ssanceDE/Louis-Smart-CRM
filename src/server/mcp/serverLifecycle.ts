// stdio-Lebenszyklus-Logik (Task C.1, Plan 2026-08-19)
// Recycle (idle/age), Ressourcen-Limit (Default 5),
// OAuth-Temp-Dateien-Cleanup (getEnrichedServerEnvAndHeaders schreibt 8 Pfade, Z. 559-604).
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ServerWithConfig } from "./sdkTransport.js";

export interface PoolEntry<T> {
  handle: T;
  lastUsedAt: number;
  openedAt: number;
  isStdio: boolean;
}

/** Recycle-Prüfung: idle_timeout_s (Default 300) und max_lifetime_s (Default 3600). */
export function shouldRecycle<T>(entry: PoolEntry<T>, server: ServerWithConfig, now: number): { recycle: boolean; reason?: string } {
  if (!entry.isStdio) return { recycle: false };
  const idleS = server.idle_timeout_s ?? 300;
  const maxS = server.max_lifetime_s ?? 3600;
  if (now - entry.lastUsedAt >= idleS * 1000) {
    return { recycle: true, reason: `idle_timeout_s (${idleS}s)` };
  }
  if (now - entry.openedAt >= maxS * 1000) {
    return { recycle: true, reason: `max_lifetime_s (${maxS}s)` };
  }
  return { recycle: false };
}

/**
 * Ressourcen-Limit: bei Überschreitung wird die älteste idle stdio-Session geschlossen
 * (Entscheid 2026-08-19, Default 5, Admin-Config mcp_stdio_max_sessions).
 * Gibt die zu schließenden Keys zurück (der Aufrufer schließt + entfernt sie).
 */
export function enforceStdioLimit<T>(pool: Map<string, PoolEntry<T>>, maxSessions: number, now: number): string[] {
  const toClose: string[] = [];
  const stdioEntries = [...pool.entries()].filter(([, e]) => e.isStdio);
  if (stdioEntries.length <= maxSessions) return toClose;
  // Älteste idle zuerst (lastUsedAt aufsteigend)
  stdioEntries.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  const excess = stdioEntries.length - maxSessions;
  for (let i = 0; i < excess; i++) {
    toClose.push(stdioEntries[i][0]);
  }
  return toClose;
}

/** Die 8 OAuth-Temp-Datei-Pfade eines Servers (mcpDir + cwd, Z. 559-604 der Engine). */
export function oauthTempFilePaths(server: ServerWithConfig): string[] {
  const mcpDir = path.join(os.tmpdir(), `mcp_server_${server.id_uuid}`);
  const names = ["gcp-oauth.keys.json", "credentials.json", "token.json", "mcp-google-calendar-token.json"];
  const cwd = process.cwd();
  return [...names.map((n) => path.join(mcpDir, n)), ...names.map((n) => path.join(cwd, n))];
}

/** Temp-Dateien beim Recycle/Shutdown löschen (nur die bekannten Namen, best-effort). */
export function cleanupOAuthTempFiles(server: ServerWithConfig): void {
  for (const p of oauthTempFilePaths(server)) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}
