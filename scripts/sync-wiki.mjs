#!/usr/bin/env node
// ============================================================================
// WIKI-SYNC: GitHub-Wiki mit den aktuellen docs/Readmes synchronisieren
// ----------------------------------------------------------------------------
// Regel (2026-08-21): Das GitHub-Wiki ist ein SPIEGEL der Readmes —
// bei JEDEM Live-Push muss das Wiki mit den aktuellen Readme-Inhalten
// synchronisiert werden. Dieses Skript:
//   1. Kopiert jede docs/Readme-*.md in das Wiki-Repo (Namens-Mapping:
//      "Readme X.md" → "X.md", Leerzeichen→-, & → -&-)
//   2. Löscht verwaiste Wiki-Seiten (z. B. die alte MCP.md nach dem Merge)
//   3. Pusht die Änderungen ins Wiki-Repo
//
// Aufruf:   node scripts/sync-wiki.mjs          (Sync + Push)
//           node scripts/sync-wiki.mjs --dry    (nur anzeigen, nichts ändern)
// ============================================================================
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const REPO = process.cwd();
const DOCS_DIR = path.join(REPO, "docs");
const WIKI_URL = "https://github.com/ren-AI-ssanceDE/Louis-Smart-CRM.wiki.git";
const WIKI_DIR = path.join(os.tmpdir(), "louis-wiki-sync");
const DRY = process.argv.includes("--dry");

// Namens-Mapping: docs/Readme X.md → Wiki X.md (GitHub-Wiki-Konvention)
function toWikiName(docFile) {
  let name = docFile.replace(/^Readme /, "").replace(/\.md$/, "");
  name = name.replace(/, /g, "-");      // "Sicherheit, Transparenz" → "Sicherheit-Transparenz"
  name = name.replace(/ & /g, "-&-");   // "Datenbank & Datenmodell" → "Datenbank-&-Datenmodell"
  name = name.replace(/ /g, "-");       // "Council Engine" → "Council-Engine"
  return name + ".md";
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  if (DRY) return "";
  return execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function main() {
  console.log(`📚 WIKI-SYNC (${DRY ? "DRY-RUN" : "Sync + Push"})`);
  console.log(`   Quelle: ${DOCS_DIR}`);
  console.log(`   Ziel:   ${WIKI_URL}\n`);

  // 1. Wiki klonen (frisch)
  if (!DRY) {
    fs.rmSync(WIKI_DIR, { recursive: true, force: true });
    run(`git clone --depth 1 ${WIKI_URL} "${WIKI_DIR}"`);
  } else {
    console.log("   (Dry-Run: kein Klon)");
  }

  // 2. Readmes kopieren
  const docFiles = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  const synced = [];
  for (const docFile of docFiles) {
    if (docFile === "README.md" || docFile === "Releases.md" || docFile === "intro.md" || docFile === "voice.md") {
      // REGEL (2026-08-22, Stefan): Die README/Home.md wird NICHT mehr vom Sync aktualisiert.
      // Die Readme gestaltet Stefan selbst; einzige erlaubte Änderung durch den Agent:
      // die Versionsnummer im Einleitungssatz. Home.md bleibt unangetastet.
      console.log(`   ⏭️  übersprungen (Readme-Pflege liegt bei Stefan): ${docFile}`);
      continue;
    }
    const wikiName = toWikiName(docFile);
    const src = path.join(DOCS_DIR, docFile);
    const dst = path.join(WIKI_DIR, wikiName);
    if (!DRY) {
      fs.copyFileSync(src, dst);
    }
    synced.push({ docFile, wikiName });
  }

  // 3. Verwaiste Wiki-Seiten löschen (existieren nicht mehr als Readme)
  //    Ausnahme: Home.md, _Sidebar.md (Wiki-Infrastruktur)
  const wikiFiles = DRY ? [] : fs.readdirSync(WIKI_DIR).filter((f) => f.endsWith(".md"));
  const activeWikiNames = new Set(synced.map((s) => s.wikiName));
  const orphans = (DRY ? ["MCP.md"] : wikiFiles).filter(
    (f) => !activeWikiNames.has(f) && f !== "Home.md" && f !== "_Sidebar.md" && f !== "Home"
  );

  console.log(`\n📄 ${synced.length} Readmes → Wiki (${DRY ? "geplant" : "kopiert"}):`);
  for (const s of synced) {
    console.log(`   ✅ ${s.docFile} → ${s.wikiName}`);
  }

  if (orphans.length > 0) {
    console.log(`\n🗑️  ${orphans.length} verwaiste Wiki-Seite(n) ${DRY ? "würden gelöscht" : "gelöscht"}:`);
    for (const o of orphans) {
      console.log(`   ❌ ${o}`);
      if (!DRY) fs.rmSync(path.join(WIKI_DIR, o), { force: true });
      // Sidebar-Bereinigung: verwaiste Links aus _Sidebar.md entfernen
      if (!DRY) {
        const sidebarPath = path.join(WIKI_DIR, "_Sidebar.md");
        if (fs.existsSync(sidebarPath)) {
          const sidebar = fs.readFileSync(sidebarPath, "utf-8");
          const base = o.replace(/\.md$/, "");
          // Link-Zeile: [Titel](base) oder [Titel](base) mit Sonderzeichen
          const linkPattern = new RegExp(`^\\* \\[[^\\]]*\\]\\(${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)[\\s\\S]*?$`, "m");
          const cleaned = sidebar.replace(linkPattern, "").replace(/\n{3,}/g, "\n\n");
          fs.writeFileSync(sidebarPath, cleaned, "utf-8");
          console.log(`   ♻️  _Sidebar.md: verwaisten Link '[${base}]' entfernt`);
        }
      }
    }
  } else {
    console.log("\n🗑️  Keine verwaisten Wiki-Seiten.");
  }

  // 4. Commit + Push (nur bei echten Änderungen)
  if (DRY) {
    console.log("\n🏁 DRY-RUN beendet — nichts geändert, nichts gepusht.");
    return;
  }

  const status = run(`git -C "${WIKI_DIR}" status --porcelain`).trim();
  if (!status) {
    console.log("\n✅ Wiki ist bereits aktuell — keine Änderungen, kein Push.");
    return;
  }

  run(`git -C "${WIKI_DIR}" add -A`);
  run(`git -C "${WIKI_DIR}" commit -m "Wiki-Sync: Readmes aktualisiert (docs → Wiki)"`);
  run(`git -C "${WIKI_DIR}" push origin master`);
  console.log("\n✅ Wiki-Sync abgeschlossen + gepusht.");
}

try {
  main();
} catch (err) {
  console.error(`\n❌ Wiki-Sync fehlgeschlagen: ${err.message}`);
  process.exit(1);
}
