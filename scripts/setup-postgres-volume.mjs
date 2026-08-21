#!/usr/bin/env node
// ============================================================================
// SETUP: PostgreSQL-Volume-Auto-Erkennung
// ----------------------------------------------------------------------------
// Problem: `external: true` in docker-compose.yml erzwingt einen exakt
// benannten, bereits existierenden Volume. Historisch haben Installationen
// unterschiedliche Volume-Namen (z. B. `louis-crm_postgres_data` vs.
// `louiscrm_louis-crm_postgres_data` — abhängig vom Projektordner-Namen).
// Ein fester Name in der Compose-Datei bricht daher bestehende Installationen.
//
// Lösung (kein Umbenennen!): Dieses Skript erkennt das VORHANDENE
// PostgreSQL-Volume auf dem System und schreibt dessen Namen in die `.env`
// (POSTGRES_VOLUME=...). docker-compose.yml nutzt die Variable:
//     name: ${POSTGRES_VOLUME:-louis-crm_postgres_data}
//     external: true        ← Schutz bleibt: kein stilles Leer-Volume
//
// Verhalten:
//   1. `docker volume ls` ausführen und alle Volumes sammeln.
//   2. Kandidaten = Volumes, deren Name "postgres" (oder "pgdata") enthält
//      UND NICHT zu Test-Stacks gehört (louis-crm-test, _test_).
//   3. Existiert genau ≥1 Kandidat → der ERSTE (stabil sortiert) wird genutzt.
//      (Kein Umbenennen, kein Anlegen — das vorhandene Volume bleibt.)
//   4. Existiert kein Kandidat → neues Volume mit dem Standard-Namen
//      `louis-crm_postgres_data` ANLEGEN (frische Installation), damit
//      `external: true` erfüllt ist.
//   5. POSTGRES_VOLUME in `.env` schreiben (ersetzen oder ergänzen).
//
// Idempotent: mehrfach ausführbar, überschreibt nur die POSTGRES_VOLUME-Zeile.
// Exit 0 = ok, Exit 1 = Fehler (docker nicht verfügbar o. Ä.).
// Flags: --dry-run = nur anzeigen, nichts schreiben/anlegen.
// ============================================================================
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = join(ROOT, ".env");

// Standard-Name für frische Installationen (muss zur Compose-Datei passen)
const DEFAULT_VOLUME = "louis-crm_postgres_data";

// Test-Stack-Volumes ausschließen (gehören zu louis-crm-test-*)
const TEST_MARKERS = ["louis-crm-test", "_test_", "test-postgres", "postgres-test"];

function run(cmd) {
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function listVolumes() {
  const out = run("docker volume ls --format {{.Name}}");
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function isPostgresCandidate(name) {
  if (!/postgres|pgdata/i.test(name)) return false;
  if (TEST_MARKERS.some((m) => name.includes(m))) return false;
  return true;
}

function readEnv() {
  if (!existsSync(ENV_FILE)) return "";
  return readFileSync(ENV_FILE, "utf-8");
}

function writeEnv(current, volume) {
  const lines = current.split("\n");
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (/^\s*POSTGRES_VOLUME\s*=/.test(line)) {
      out.push(`POSTGRES_VOLUME=${volume}`);
      replaced = true;
    } else {
      out.push(line);
    }
  }
  if (!replaced) {
    // Ans Ende (nach einer Leerzeile) anhängen
    if (out.length > 0 && out[out.length - 1] !== "") out.push("");
    out.push("# PostgreSQL-Volume (Auto-Erkennung durch scripts/setup-postgres-volume.mjs)");
    out.push(`POSTGRES_VOLUME=${volume}`);
  }
  return out.join("\n");
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  let volumes;
  try {
    volumes = listVolumes();
  } catch (err) {
    console.error("❌ Docker ist nicht erreichbar. Läuft der Docker-Daemon?");
    console.error(`   Details: ${err.message.split("\n")[0]}`);
    process.exit(1);
  }

  const candidates = volumes.filter(isPostgresCandidate).sort();
  let chosen;

  if (candidates.length > 0) {
    chosen = candidates[0];
    console.log(`ℹ️  Vorhandenes PostgreSQL-Volume gefunden: ${chosen}`);
    if (candidates.length > 1) {
      console.log(`   (Weitere Kandidaten: ${candidates.slice(1).join(", ")})`);
    }
  } else {
    chosen = DEFAULT_VOLUME;
    if (dryRun) {
      console.log(`ℹ️  Kein PostgreSQL-Volume vorhanden — würde ${chosen} anlegen (frische Installation).`);
    } else {
      try {
        run(`docker volume create ${DEFAULT_VOLUME}`);
        console.log(`✅ Kein Volume vorhanden — neues Volume angelegt: ${DEFAULT_VOLUME}`);
      } catch (err) {
        console.error(`❌ Konnte Volume ${DEFAULT_VOLUME} nicht anlegen.`);
        console.error(`   Details: ${err.message.split("\n")[0]}`);
        process.exit(1);
      }
    }
  }

  if (dryRun) {
    console.log(`ℹ️  Dry-Run: würde POSTGRES_VOLUME=${chosen} in ${ENV_FILE} schreiben.`);
    process.exit(0);
  }

  const current = readEnv();
  const updated = writeEnv(current, chosen);
  writeFileSync(ENV_FILE, updated, "utf-8");
  console.log(`✅ POSTGRES_VOLUME=${chosen} in ${ENV_FILE} geschrieben.`);
  console.log("   docker-compose.yml nutzt diesen Namen (external: true — Schutz bleibt).");
  process.exit(0);
}

main();
