#!/usr/bin/env node
// ============================================================================
// COMMIT-MESSAGE-CHECK für das öffentliche Live-Repo (E:\Github Live)
// ----------------------------------------------------------------------------
// HARTE REGEL (Stefan 2026-08-22, B-213-7): Commit-Messages sind auf GitHub
// öffentlich sichtbar — Test-/Dev-Interna dürfen NICHT in Pushbegründungen
// stehen (nicht nur in Dateien!). Der Watchdog prüft nur UNGEPUSHTE Commits;
// dieser Check läuft als commit-msg-Hook VOR jedem Commit und blockt Verstöße
// an der Quelle.
//
// Aufruf (Hook):  node scripts/check-commit-msg.mjs "$1"   ($1 = COMMIT_EDITMSG)
// Aufruf (CLI):   node scripts/check-commit-msg.mjs --stdin  (testet eine Message)
// Exit 1 bei Verstoß (Commit wird abgebrochen), 0 bei sauber.
// ============================================================================
import fs from "node:fs";

const MSG_FILE = process.argv[2];

function readMessage() {
  if (!MSG_FILE) return "";
  return fs.readFileSync(MSG_FILE, "utf8");
}

// Interne Muster — konsistent mit watchdog-live-repo-internal.mjs + Guard.
// KEINE False-Positives: Wortgrenzen, keine Datums-/ISO-Treffer.
const COMMIT_INTERNA = [
  // Test-/Dev-Infrastruktur
  { re: /\.local_fallback_db\.json/, label: "Fallback-DB-Datei" },
  { re: /\bfallbackStore\b|\bsaveFallbackStore\b|\bisUsingFallback\b/, label: "Fallback-Store" },
  { re: /\bbeforeAll\b|\bFixtures?\b|\bGolden-Replay\b|\bmock-server\b/i, label: "Test-Fixture/Replay" },
  { re: /\b9333\b|\b9334\b|\b3100\b|\b3200\b/, label: "Test-Port" },
  { re: /test:zugferd|test:e2e|dev:e2e|hooks:install|check:rules|check:plan|extract-missing-i18n/, label: "Test-Command" },
  { re: /\be2e-out\b/, label: "E2E-Artefakt-Pfad" },
  { re: /\bpre-commit\b/, label: "Git-Hook-Internum" },
  { re: /\bmcp_e2e_mock\b/, label: "Mock-Tool" },
  { re: /\bStryker\b|\bPlaywright\b|\bVitest\b|\btest\.ts\b|\bspec\.ts\b/i, label: "Test-Framework" },
  { re: /\bTEST-?\b|\bE2E\b/, label: "Test-Begriff" },
  { re: /\bHybrid-Store\b|\bHeilige-?[Dd]ateien\b|\bfallback[- ]?mode\b/i, label: "interner Architektur-Begriff" },
  // Interne Projekt-Begriffe
  { re: /\bAuftrag\s+\d{2,3}\b|\bAuftrag-\d+/, label: "Auftrag-Nr." },
  { re: /\b0\d\d-[FNCAP]\d?(-[A-Z0-9]+)?\b/, label: "Befund-/Phasen-ID" },
  { re: /\bBefund\b|\bRegelkatalog\b|\bBugliste\b/, label: "interner Begriff" },
  { re: /\bStefan\b|\bHermes\b/i, label: "interner Name" },
  { re: /D:\\Docker|D:\/Docker|\blouis-plan\b|\bAppData\b|\bvibe-coding\b|\bhermes-agent\b/, label: "interner Pfad" },
  { re: /\bLouis-Smart-CRM-CI\b/, label: "internes Repo" },
  { re: /\bstefan@ren-ai-ssance\.de\b/i, label: "Test-Mail" },
  { re: /\bR-(?:MCP|QA|DS|AR|DO)-\d+\b/, label: "Regel-ID" },
  { re: /\bGoogle AI Studio\b|\baistudio-build\b/gi, label: "interner Ursprung" },
];

function check(msg) {
  const hits = [];
  for (const { re, label } of COMMIT_INTERNA) {
    // matchAll benötigt das global-Flag — bei Bedarf ergänzen
    const reG = re.global ? re : new RegExp(re.source, re.flags + "g");
    for (const m of msg.matchAll(reG)) {
      hits.push(`   ⛔ [${label}] '${m[0]}'`);
    }
  }
  return hits;
}

const msg = readMessage();
const hits = check(msg);
if (hits.length > 0) {
  console.error("❌ COMMIT-MESSAGE-CHECK: Interne Begriffe in der Pushbegründung gefunden (öffentlich sichtbar!):");
  for (const h of hits) console.error(h);
  console.error("   Regel (2026-08-22): Commit-Messages enthalten KEINE Test-/Dev-Interna.");
  console.error("   Message neutral formulieren (z. B. 'docs: README bereinigt') und Commit wiederholen.");
  process.exit(1);
}
console.log("✅ Commit-Message sauber (keine internen Begriffe).");
process.exit(0);
