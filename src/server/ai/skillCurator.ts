// ============================================================================
// Phase 6 + P1-1 (Parität): Curator & Skills
// #28 Skill-Pruning — inaktiv bis aktiviert, NIEMALS löschen (Muster skills_curator.py).
// #29 Curator (Pflicht REIN) — Frontmatter pflegen (status/last_used),
// inaktive markieren, genutzte reaktivieren, überfällige archivieren. NIE automatisch löschen.
// #30 Usage-Tracking — use_count/view_count/patch_count je Skill (Teil des Curators).
// P1-1: Zähler + Tick-Fälligkeit + Archiv-Stufe (_archive/, nie löschen).
// Reine Funktionen (testbar, kein any) + Best-Effort-Persistenz via vaultWriteText.
// ============================================================================

import type { VaultSkillFile } from "./vaultStore.js";

export type SkillStatus = "active" | "inactive" | "archived";

export interface SkillFrontmatterState {
  status: SkillStatus;
  lastUsedAtUtc: string | null;
  version: number;
  /** #30: Nutzungszähler (fehlend = 0). */
  useCount: number;
  viewCount: number;
  patchCount: number;
}

/** Frontmatter-Parsing (pure): status / last_used_at_utc / version / Zähler aus dem Dateiinhalt. */
export function parseSkillFrontmatter(content: string): SkillFrontmatterState {
  const statusMatch = content.match(/^status:\s*(active|inactive|archived)\s*$/m);
  const usedMatch = content.match(/^last_used_at_utc:\s*(.+)$/m);
  const versionMatch = content.match(/^version:\s*(\d+)\s*$/m);
  const counter = (name: string): number => {
    const m = content.match(new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : 0;
  };
  return {
    status: statusMatch ? (statusMatch[1] as SkillStatus) : "active",
    lastUsedAtUtc: usedMatch ? usedMatch[1].trim() : null,
    version: versionMatch ? Number(versionMatch[1]) : 1,
    useCount: counter("use_count"),
    viewCount: counter("view_count"),
    patchCount: counter("patch_count")
  };
}

/** #28: Skill inaktiv, wenn last_used_at_utc älter als N Tage (oder nie genutzt + alt). */
export function isSkillInactive(
  skill: Pick<VaultSkillFile, "name" | "lastUsedAtUtc" | "status">,
  now: Date,
  inactiveAfterDays: number
): boolean {
  if (skill.status === "inactive" || skill.status === "archived") return true;
  if (!skill.lastUsedAtUtc) return false; // nie genutzt → nicht bestrafen (fail-open)
  const last = new Date(skill.lastUsedAtUtc);
  if (Number.isNaN(last.getTime())) return false;
  const ageDays = (now.getTime() - last.getTime()) / 86400000;
  return ageDays > inactiveAfterDays;
}

/** #29 Archiv-Stufe: letzte Nutzung älter als N Tage → archivieren (unabhängig vom Frontmatter-Status,
 *  der nur ein Spiegel ist — ein 70-Tage-alter Skill wird direkt archiviert, nicht erst geprunt). */
export function shouldArchiveSkill(
  skill: Pick<VaultSkillFile, "name" | "lastUsedAtUtc" | "status">,
  now: Date,
  archiveAfterDays: number
): boolean {
  if (skill.status === "archived") return true;
  if (!skill.lastUsedAtUtc) return false; // nie genutzt → fail-open, nicht archivieren
  const last = new Date(skill.lastUsedAtUtc);
  if (Number.isNaN(last.getTime())) return false;
  const ageDays = (now.getTime() - last.getTime()) / 86400000;
  return ageDays > archiveAfterDays;
}

/** #29: Tick-Fälligkeit (pure) — Intervall in Stunden, NULL/0 = Default 24h. */
export function isCuratorTickDue(lastTickAtUtc: number | null, intervalHours: number | null, now: Date): boolean {
  if (lastTickAtUtc === null) return true;
  const hours = intervalHours && intervalHours > 0 ? intervalHours : 24;
  return now.getTime() - lastTickAtUtc >= hours * 3_600_000;
}

/** #29: Tick-Planung (pure) — teilt Skills in aktiv / zu prunen / zu archivieren. */
export function planCuratorTick(
  skills: VaultSkillFile[],
  now: Date,
  inactiveAfterDays: number,
  archiveAfterDays: number
): { active: VaultSkillFile[]; toPrune: VaultSkillFile[]; toArchive: VaultSkillFile[] } {
  const { active, pruned } = filterInactiveSkills(skills, now, inactiveAfterDays);
  const toArchive = pruned.filter((s) => shouldArchiveSkill(s, now, archiveAfterDays));
  const toPrune = pruned.filter((s) => !shouldArchiveSkill(s, now, archiveAfterDays));
  return { active, toPrune, toArchive };
}

/** #29: Zielpfad im Archiv-Ordner (nie überschreiben — Datum anhängen bei Kollision). */
export function archivePathFor(skill: VaultSkillFile, now: Date): string {
  const fileName = skill.path.split("/").pop() || `${skill.name}.md`;
  return `_louis/skills/_archive/${now.toISOString().slice(0, 10)}-${fileName}`;
}

/** #28/#29: Frontmatter-Update als Frontmatter-Block (pure) — ersetzt/ergänzt Felder. */
export function buildCuratedFrontmatter(
  content: string,
  patch: {
    status?: SkillStatus;
    lastUsedAtUtc?: string | null;
    useCount?: number;
    viewCount?: number;
    patchCount?: number;
  }
): string {
  const hasFrontmatter = /^---\s*\n/.test(content);
  const body = hasFrontmatter ? content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "") : content.trim();
  const lines: string[] = ["---"];
  const existing = hasFrontmatter ? (content.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || "" : "";
  // #30: bestehende Zähler extrahieren (werden erhalten, wenn kein Zähler-Patch kommt)
  const existingCounter = (name: string): number => {
    const m = existing.match(new RegExp(`^${name}:\\s*(\\d+)\\s*$`, "m"));
    return m ? Number(m[1]) : 0;
  };
  const counters = {
    useCount: existingCounter("use_count"),
    viewCount: existingCounter("view_count"),
    patchCount: existingCounter("patch_count")
  };
  // Bestehende Zeilen übernehmen (ohne status/last_used_at_utc/use_count/view_count/patch_count —
  // werden unten (ggf. mit Patch) neu gesetzt)
  for (const line of existing.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(status|last_used_at_utc|use_count|view_count|patch_count)\s*:/.test(trimmed)) continue;
    lines.push(trimmed);
  }
  if (patch.status) lines.push(`status: ${patch.status}`);
  if (patch.lastUsedAtUtc) lines.push(`last_used_at_utc: ${patch.lastUsedAtUtc}`);
  if (patch.useCount !== undefined) lines.push(`use_count: ${patch.useCount}`);
  else if (counters.useCount > 0) lines.push(`use_count: ${counters.useCount}`);
  if (patch.viewCount !== undefined) lines.push(`view_count: ${patch.viewCount}`);
  else if (counters.viewCount > 0) lines.push(`view_count: ${counters.viewCount}`);
  if (patch.patchCount !== undefined) lines.push(`patch_count: ${patch.patchCount}`);
  else if (counters.patchCount > 0) lines.push(`patch_count: ${counters.patchCount}`);
  lines.push("---");
  return `${lines.join("\n")}\n\n${body.trim()}\n`;
}

/** #28: Filter — inaktive Skills werden NICHT injiziert (bleiben aber im Vault erhalten). */
export function filterInactiveSkills(
  skills: VaultSkillFile[],
  now: Date,
  inactiveAfterDays: number
): { active: VaultSkillFile[]; pruned: VaultSkillFile[] } {
  const active: VaultSkillFile[] = [];
  const pruned: VaultSkillFile[] = [];
  for (const s of skills) {
    if (isSkillInactive(s, now, inactiveAfterDays)) pruned.push(s);
    else active.push(s);
  }
  return { active, pruned };
}

/** Best-Effort-Persistenz des Frontmatter-Updates (via vaultWriteText, non-fatal). */
export async function persistSkillFrontmatter(
  tenantId: string,
  skill: VaultSkillFile,
  patch: {
    status?: SkillStatus;
    lastUsedAtUtc?: string | null;
    useCount?: number;
    viewCount?: number;
    patchCount?: number;
  }
): Promise<void> {
  try {
    const { vaultWriteText } = await import("./vaultStore.js");
    const updated = buildCuratedFrontmatter(skill.content, patch);
    if (updated !== skill.content) {
      await vaultWriteText(tenantId, skill.path, updated);
    }
  } catch (err) {
    // #29: Curator ist Best-Effort — nie den Agent-Pfad blockieren
    console.warn(`[SkillCurator] Frontmatter-Update für ${skill.name} fehlgeschlagen (ignoriert):`, err instanceof Error ? err.message : String(err));
  }
}

/** #30: Zähler-Inkrement per Pfad (best-effort, non-blocking) — lädt die Datei, patcht, schreibt zurück. */
export async function bumpSkillCounter(
  tenantId: string,
  skillPath: string,
  counter: "useCount" | "viewCount" | "patchCount"
): Promise<void> {
  try {
    const { vaultReadText, vaultWriteText } = await import("./vaultStore.js");
    const read = await vaultReadText(tenantId, skillPath);
    if (!read.content) return;
    const fm = parseSkillFrontmatter(read.content);
    const next = { useCount: fm.useCount, viewCount: fm.viewCount, patchCount: fm.patchCount };
    next[counter] += 1;
    const updated = buildCuratedFrontmatter(read.content, next);
    if (updated !== read.content) {
      await vaultWriteText(tenantId, skillPath, updated);
    }
  } catch (err) {
    console.warn(`[SkillCurator] Zähler-Inkrement (${counter}) für ${skillPath} fehlgeschlagen (ignoriert):`, err instanceof Error ? err.message : String(err));
  }
}

/** In-Memory-Tick-Zeitstempel pro Tenant (App-Prozess; Neustart = Tick wieder fällig, harmlos). */
const lastCuratorTickAt: Map<string, number> = new Map();

 /**
  * #29 (026 P1-1): Tick-Einstieg für den Scheduler-Heartbeat — prüft Fälligkeit
  * (curator_interval_hours, NULL = 24) + Config (skill_curator_enabled) und führt
  * runCuratorTick aus. Best-effort, nie blockierend, nie werfend.
  */
 export async function maybeRunCuratorTick(tenantId: string): Promise<{ pruned: number; archived: number; skipped: boolean }> {
   try {
     const { getTenantAiConfig } = await import("./orchestrator.js");
     const cfg = await getTenantAiConfig(tenantId);
     if (!(cfg.skill_curator_enabled ?? true)) return { pruned: 0, archived: 0, skipped: true };
     const now = new Date();
     const last = lastCuratorTickAt.get(tenantId) ?? null;
     if (!isCuratorTickDue(last, cfg.curator_interval_hours ?? null, now)) return { pruned: 0, archived: 0, skipped: true };
     lastCuratorTickAt.set(tenantId, now.getTime());
     const res = await runCuratorTick(tenantId, {
       enabled: true,
       inactiveAfterDays: cfg.skill_prune_inactive_after_days ?? 30,
       archiveAfterDays: cfg.curator_archive_after_days ?? 60
     });
     if (res.pruned > 0 || res.archived > 0) {
       console.log(`[SkillCurator] Tick: ${res.pruned} inaktiv markiert, ${res.archived} archiviert (NIE gelöscht).`);
     }
     return { ...res, skipped: false };
   } catch (err) {
     console.warn("[SkillCurator] Tick-Prüfung fehlgeschlagen (ignoriert):", err instanceof Error ? err.message : String(err));
     return { pruned: 0, archived: 0, skipped: true };
   }
 }

 /** #29 (026 P1-1, Punkt 4): Backup vor Curator-Aktionen — Original-Inhalt als `.bak-<datum>`
  *  neben der Datei ablegen (best-effort, nie werfend). NIE löschen (auch Backups nicht). */
 async function backupSkillBeforeChange(tenantId: string, skill: VaultSkillFile): Promise<void> {
   try {
     const { vaultWriteText } = await import("./vaultStore.js");
     const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
     const backupPath = `${skill.path}.bak-${stamp}`;
     await vaultWriteText(tenantId, backupPath, skill.content);
   } catch (err) {
     console.warn(`[SkillCurator] Backup für ${skill.name} fehlgeschlagen (ignoriert):`, err instanceof Error ? err.message : String(err));
   }
 }

 /** #29: Ein Curator-Tick (async, best-effort) — Prune (inaktiv markieren) + Archiv
 * (überfällige inaktive Skills nach `_louis/skills/_archive/` VERSCHIEBEN — erst Kopie,
 * dann Original entfernen; bei Kopier-Fehler bleibt das Original unangetastet. NIE löschen.)
 */
 export async function runCuratorTick(
   tenantId: string,
   cfg: { enabled: boolean; inactiveAfterDays: number; archiveAfterDays: number }
 ): Promise<{ pruned: number; archived: number }> {
   if (!cfg.enabled) return { pruned: 0, archived: 0 };
   try {
     const { resolveSkillFiles, vaultWriteText, vaultDeleteText } = await import("./vaultStore.js");
     const skills = await resolveSkillFiles(tenantId);
     const now = new Date();
     const { toPrune, toArchive } = planCuratorTick(skills, now, cfg.inactiveAfterDays, cfg.archiveAfterDays);
     // 1) Prune: Frontmatter-Status auf inactive (bleibt im Skill-Ordner) — mit Backup vor der Änderung
     for (const s of toPrune) {
       await backupSkillBeforeChange(tenantId, s);
       await persistSkillFrontmatter(tenantId, s, { status: "inactive" });
     }
     // 2) Archiv: Backup + Kopie mit status: archived in _archive/, Original erst danach entfernen
     for (const s of toArchive) {
       try {
         await backupSkillBeforeChange(tenantId, s);
         const archivedContent = buildCuratedFrontmatter(s.content, { status: "archived" });
         const target = archivePathFor(s, now);
         const written = await vaultWriteText(tenantId, target, archivedContent);
         if (written && written.path) {
           await vaultDeleteText(tenantId, s.path);
         }
       } catch (err) {
         console.warn(`[SkillCurator] Archiv-Verschiebung für ${s.name} fehlgeschlagen (Original bleibt erhalten):`, err instanceof Error ? err.message : String(err));
       }
     }
     return { pruned: toPrune.length, archived: toArchive.length };
   } catch (err) {
     console.warn("[SkillCurator] Tick fehlgeschlagen (ignoriert):", err instanceof Error ? err.message : String(err));
     return { pruned: 0, archived: 0 };
   }
 }
