#!/usr/bin/env node
// ============================================================================
// SANITIZE-GATE: Interna-Check + gezielte Neutralisierung vor Release-Commits
// ----------------------------------------------------------------------------
// HARTE REGEL (2026-08-21; Stefan-Entscheid 2026-09-06): Dateien im
// öffentlichen Repo duerfen KEINE internen Referenzen enthalten. Release-Dateien
// entstehen teils per Uebernahme aus dem Dev-Repo — dieser Schritt entfernt die
// bekannten Kommentar-ID-Referenzen automatisch und BLOCKT alles, was nicht
// sicher automatisch neutralisierbar ist (Exit 1 = Handarbeit noetig).
//
// Muster-Set KONSISTENT mit watchdog-live-repo-internal.mjs (Hermes-Cron,
// Profile-Skript) — bei Aenderung BEIDE anpassen.
//
// Nutzung:
//   node scripts/sanitize-public.mjs              # Check: Liste + Exit 1 bei Funden
//   node scripts/sanitize-public.mjs --fix        # Auto-Neutralisierung + Re-Check
//   node scripts/sanitize-public.mjs --root <dir> # beliebigen Baum scannen
//
// Auto-neutralisiert NUR sichere, deterministische Formen in Kommentarzeilen:
//   - fuehrende ID-Praefixe:  "071 (BUG-006): ", "BUG-010: ", "BUG-010 (defensiv): ",
//                             "102 (BUG-010): ", "R-AR-05: ", "R-AR-10: " ...
//   - Klammerform:            "(R-AR-10, wrappbar)" -> "(bewusst wrappbar)"
// Alles andere (Namen, Pfade, Begriffe, IDs mitten im Satz) wird gemeldet und
// blockt — bewusst KEINE generischen Text-Rewrites (Lehre 064, 2026-08-24).
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const FIX = args.includes("--fix");
const rootIdx = args.indexOf("--root");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = rootIdx >= 0
  ? path.resolve(args[rootIdx + 1])
  : path.resolve(SCRIPT_DIR, "..");

// Interne Muster — identisch mit watchdog-live-repo-internal.mjs
const PATTERNS = [
  { re: /\bAuftrag\s+\d{2,3}\b/g, label: "Auftrag-Nr." },
  { re: /\bAuftrag-\d+/g, label: "Auftrag-x" },
  { re: /\bseit\s+(?:Auftrag\s+)?0\d\d\b/g, label: "interne Nr." },
  { re: /\bStefan\b/g, label: "Name (intern)" },
  { re: /\bHermes\b/g, label: "Name (intern)" },
  { re: /\bRegelkatalog\b/g, label: "interner Begriff" },
  { re: /\bBugliste\b/g, label: "interner Begriff" },
  { re: /\bBefund\b/g, label: "interner Begriff" },
  { re: /\b0\d\d-[FNCAP]\d?\b/g, label: "Befund-ID" },
  { re: /\b0\d\d-P\d(?:-\d)?\b/g, label: "Phase-ID" },
  { re: /\b021-[A-Z]\b/g, label: "Auftrags-ID" },
  { re: /\bR-(?:MCP|QA|DS|AR|DO)-\d+\b/g, label: "Regel-ID" },
  { re: /\bBUG-\d+\b/g, label: "BUG-ID" },
  { re: /D:\\Docker|D:\/Docker/g, label: "interner Pfad" },
  { re: /louis-plan/g, label: "interner Pfad" },
  { re: /AppData|hermes-agent|vibe-coding/g, label: "interner Pfad" },
  { re: /Louis-Smart-CRM-CI/g, label: "internes Repo" },
  { re: /stefan@ren-ai-ssance\.de/gi, label: "Test-Mail" },
  { re: /ren-AI-ssanceDE\/(?!Louis-Smart-CRM\b)/g, label: "internes Repo" },
  { re: /Google AI Studio|aistudio-build/gi, label: "interner Ursprung" },
];

// Heilige Dateien — nie melden, nie anfassen
const HOLY_FILES = [
  "src/lib/zugferd.ts",
  "docker-entrypoint.sh",
  "src/server/pdfHelper.ts",
  "mustang-cli.jar",
  "PDFA_def.ps",
  "src/server/routers/invoices.ts",
];

// Wächter-/Werkzeug-Skripte MÜSSEN die Muster als Regex enthalten (ihre Funktion)
const WAECHTER = [
  "scripts/check-commit-msg.mjs",
  "scripts/guard-live-repo.mjs",
  "scripts/sync-wiki.mjs",
  "scripts/sanitize-public.mjs",
];

const TEXT_EXT = [".md", ".ts", ".tsx", ".js", ".mjs", ".yml", ".yaml", ".json", ".sh", ".ps", ".env.example", ".gitignore", ".dockerignore", ".sql"];
const SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage", "e2e-out", "ollama"];

// Ausnahmeregel docs/hermes-integration.md (2026-09-06): Leitfaden darf ueber
// Hermes sprechen — nur Hermes-/hermes-agent-Nennungen sind dort frei.
function isHermesDocExempt(relPath, label, matchText) {
  if (relPath !== "docs/hermes-integration.md") return false;
  if (label === "Name (intern)" && matchText === "Hermes") return true;
  if (label === "interner Pfad" && /hermes-agent/.test(matchText)) return true;
  return false;
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

// Deterministische Auto-Fixes NUR fuer Kommentarzeilen (s. Kopfkommentar)
const FIXERS = [
  // fuehrende ID-Praefixe:  "// 071 (BUG-006): ..." | "// BUG-010 (defensiv): ..."
  { re: /^(\s*(?:\/\/|\*)\s*)(?:\d{2,3}\s+)?\(?BUG-\d+\)?(?:\s*\(defensiv\))?\s*[:：]\s*/, label: "BUG-Praefix" },
  // fuehrende Regel-ID:     "// R-AR-05: ..."
  { re: /^(\s*(?:\/\/|\*)\s*)R-(?:MCP|QA|DS|AR|DO)-\d+\s*[:：]\s*/, label: "Regel-ID-Praefix" },
  // Klammerform:            "(R-AR-10, wrappbar)" -> "(bewusst wrappbar)"
  { re: /\(R-(?:MCP|QA|DS|AR|DO)-\d+,\s*wrappbar\)/, label: "wrappbar-Klammer", replacement: "(bewusst wrappbar)" },
];

function applyFixers(line) {
  let out = line;
  for (const f of FIXERS) {
    const repl = f.replacement !== undefined ? f.replacement : "$1";
    out = out.replace(f.re, repl);
  }
  return out;
}

function relPath(root, full) {
  return path.relative(root, full).replace(/\\/g, "/");
}

function walk(root, cb) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIRS.includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) { walk(full, cb); continue; }
    if (!TEXT_EXT.includes(path.extname(entry.name).toLowerCase())) continue;
    cb(full);
  }
}

function main() {
  if (!fs.existsSync(ROOT)) { console.error(`❌ SANITIZE: Root nicht gefunden: ${ROOT}`); process.exit(1); }

  const violations = [];
  const fixedLines = [];

  walk(ROOT, (full) => {
    const rel = relPath(ROOT, full);
    if (HOLY_FILES.some((h) => rel === h || rel.endsWith("/" + h))) return;
    if (WAECHTER.includes(rel)) return; // Wächter duerfen die Muster enthalten
    let text;
    try { text = fs.readFileSync(full, "utf-8"); } catch { return; }

    const lines = text.split("\n");
    const changed = [];

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (FIX && isCommentLine(line)) {
        const fixed = applyFixers(line);
        if (fixed !== line) { lines[i] = fixed; changed.push({ rel, ln: i + 1 }); line = fixed; }
      }
      for (const { re, label } of PATTERNS) {
        for (const m of line.matchAll(re)) {
          if (isHermesDocExempt(rel, label, m[0])) continue;
          violations.push(`${rel}:${i + 1} [${label}] '${m[0]}'`);
        }
      }
    }

    if (changed.length > 0) {
      fs.writeFileSync(full, lines.join("\n"), "utf-8");
      fixedLines.push(...changed);
    }
  });

  // Ausgabe
  if (FIX && fixedLines.length > 0) {
    console.log(`✅ SANITIZE --fix: ${fixedLines.length} Kommentarzeile(n) neutralisiert (ID-Praefixe entfernt).`);
  }
  if (violations.length > 0) {
    console.log(`❌ SANITIZE: ${violations.length} interne Referenz(en) gefunden${FIX ? " (nach Auto-Fix; Handarbeit noetig)" : ""}:`);
    for (const v of violations.slice(0, 30)) console.log(`   ⛔ ${v}`);
    if (violations.length > 30) console.log(`   … und ${violations.length - 30} weitere`);
    console.log("Regel (2026-08-21/09-06): öffentliche Dateien enthalten KEINE internen Referenzen.");
    console.log("Automatisch entfernt werden nur fuehrende BUG-/Regel-ID-Praefixe und '(R-.., wrappbar)' in Kommentaren.");
    console.log("Namen/Pfade/Begriffe mitten im Satz: manuell neutral formulieren, dann erneut laufen lassen.");
    process.exit(1);
  }
  if (!FIX || fixedLines.length === 0) console.log("CLEAN — keine internen Referenzen.");
  else console.log("CLEAN — nach Auto-Fix keine internen Referenzen mehr.");
  process.exit(0);
}

main();
