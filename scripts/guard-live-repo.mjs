#!/usr/bin/env node
// ============================================================================
// GUARD: Öffentliches Live-Repo (E:\Github Live) — nur Produktiv-Stand
// ----------------------------------------------------------------------------
// HARTE REGEL (Stefan 2026-08-21): Test-Artefakte/Testergebnisse gehören NICHT
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
  console.error("   Regel (Stefan 2026-08-21): Test-Artefakte/Interne Dateien gehören NICHT ins Live-Repo.");
  console.error("   Diese Dateien entfernen (git rm --cached + rm) und Commit wiederholen.");
  process.exit(1);
}
console.log(`✅ Guard ok: ${all ? files.length : files.length} Datei(en) geprüft, keine Verstöße.`);
