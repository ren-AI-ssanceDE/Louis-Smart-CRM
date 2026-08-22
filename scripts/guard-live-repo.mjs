#!/usr/bin/env node
// ============================================================================
// GUARD: Öffentliches Live-Repo (E:\Github Live) — nur Produktiv-Stand
// ----------------------------------------------------------------------------
// HARTE REGEL (2026-08-21): Test-Artefakte/Testergebnisse gehören NICHT
// ins öffentliche Live-Repo. Dieses Skript prüft den Index vor dem Commit und
// blockt, wenn verbotene Pfade gestaged sind.
//
// Verbotene Muster (öffentliche Kopie):
//   - Test-Code:          tests/, tests-e2e/, *.spec.ts, *.test.ts
//   - Test-Configs:       playwright.config.*, vitest.config.*, stryker.config.*
//   - Test-Skripte:       scripts/qa-*, scripts/golden-*, scripts/mcp-*volltest*,
//                         scripts/check-plan*, scripts/check-project-rules*,
//                         scripts/e2e-*, scripts/approval-*, scripts/token-baseline*,
//                         scripts/workflow-dag*, scripts/migrate-mcp-secrets*,
//                         scripts/install-git-hooks*, scripts/extract-missing-i18n*,
//                         scripts/mcp-preset-catalog*, scripts/test-*, scripts/git-hooks/
//   - Test-Compose:       docker-compose.test.yml, compose.test.*
//   - CI-Workflow:        .github/
//   - Intern:             AGENTS.md, todo.md, *.rar, .hermes/
//   - Build-Artefakte:    node_modules/, dist/, build/, coverage/, e2e-out/
//
// Nutzung:  node scripts/guard-live-repo.mjs            (prüft gestaged)
//           node scripts/guard-live-repo.mjs --all       (prüft ALLE getrackten Dateien)
// Exit 1 + Liste, wenn Verstöße gefunden.
// ============================================================================
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN = [
  /^tests\//, /^tests-e2e\//,
  /\.spec\.ts$/, /\.test\.ts$/,
  /^playwright\.config/, /^vitest/, /^stryker\.config/,
  /^scripts\/qa-/, /^scripts\/golden-/, /^scripts\/mcp-.*volltest/,
  /^scripts\/check-plan/, /^scripts\/check-project-rules/,
  /^scripts\/e2e-/, /^scripts\/approval-/, /^scripts\/token-baseline/,
  /^scripts\/workflow-dag/, /^scripts\/migrate-mcp-secrets/,
  /^scripts\/install-git-hooks/, /^scripts\/extract-missing-i18n/,
  /^scripts\/mcp-preset-catalog/, /^scripts\/test-/, /^scripts\/git-hooks\//,
  /^docker-compose\.test/, /^compose\.test/,
  /^\.github\//,
  /^AGENTS\.md$/, /^todo\.md$/, /\.rar$/, /^\.hermes\//,
  /^node_modules\//, /^dist\//, /^build\//, /^coverage\//, /^e2e-out\//,
];

function check(files) {
  const violations = files
    .map((f) => f.replace(/^"|"$/g, "")) // git quoted paths entpacken
    .filter((f) => FORBIDDEN.some((re) => re.test(f)));
  return [...new Set(violations)];
}

const all = process.argv.includes("--all");
const files = all
  ? execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean)
  : execSync("git diff --cached --name-only -z", { encoding: "utf8" })
      .split("\0").filter(Boolean);

const violations = check(files);
if (violations.length > 0) {
  console.error("❌ GUARD: Verbotene Dateien im öffentlichen Live-Repo gefunden:");
  for (const v of violations) console.error(`   ⛔ ${v}`);
  console.error("   Regel (2026-08-21): Test-Artefakte/Interne Dateien gehören NICHT ins Live-Repo.");
  console.error("   Diese Dateien entfernen (git rm --cached + rm) und Commit wiederholen.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// INHALTSSCHUTZ DER ÖFFENTLICHEN README-QUELLEN (docs/) — Regel R-DO-08 (2026-08-22)
// Test-/Dev-Interna (Dateinamen, Ports, Commands, QA-Prozess, interne Namen)
// gehören NICHT in öffentliche Readmes. Scant docs/Readme*.md + docs/README.md.
// Ausnahmen: "Readme Qualitätssicherung & Tests.md" (bewusste öffentliche QA-Doku)
// und die Root-README.md (wird von Stefan selbst gestaltet, R-DO-08).
// ---------------------------------------------------------------------------
const README_INTERNA = [
  /\.local_fallback_db\.json/,
  /\bfallbackStore\b|\bsaveFallbackStore\b|\bisUsingFallback\b/,
  /\bbeforeAll\b|\bFixtures?\b|\bGolden-Replay\b|\bmock-server\b/i,
  /\b9333\b|\b9334\b|\b3100\b/,
  /test:zugferd|test:e2e|dev:e2e|hooks:install|check:rules|check:plan|extract-missing-i18n/,
  /e2e-out/,
  /pre-commit/,
  /mcp_e2e_mock/,
  /\bhermes\b|\bvibe-coding\b|ren-AI-ssanceDE/i,
  /stefan@ren-ai-ssance/i,
];
const README_SCAN_EXCLUDES = ["Readme Qualitätssicherung & Tests.md", "README.md", "Releases.md"]; // QA-Doku (gewollt), Root-README (Stefans Werk), Releases.md (historisch)

function checkReadmeContent() {
  const violations = [];
  const docsDir = "docs";
  if (!fs.existsSync(docsDir)) return violations;
  for (const f of fs.readdirSync(docsDir)) {
    if (!f.endsWith(".md")) continue;
    if (README_SCAN_EXCLUDES.some((x) => f.includes(x))) continue;
    const content = fs.readFileSync(path.join(docsDir, f), "utf8");
    for (const re of README_INTERNA) {
      if (re.test(content)) violations.push(`${f}  →  ${re}`);
    }
  }
  return violations;
}

const contentViolations = checkReadmeContent();
if (contentViolations.length > 0) {
  console.error("❌ GUARD: Test-/Interna-Hinweise in öffentlichen Readme-Quellen (docs/) gefunden:");
  for (const v of contentViolations) console.error(`   ⛔ ${v}`);
  console.error("   Regel (2026-08-22, R-DO-08): Test-/Dev-Interna gehören NICHT in öffentliche Readmes.");
  process.exit(1);
}
console.log(`✅ Guard ok: ${all ? files.length : files.length} Datei(en) geprüft + Readme-Inhaltsscan sauber, keine Verstöße.`);
