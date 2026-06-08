#!/usr/bin/env node
// Build-time asset provisioning. Runs once at install / docker build.
// At runtime the app never reaches the network — see ZERO_EGRESS in AI_CONTEXT.md.
//
// Provisions:
//   - src/assets/fonts/Lato-Regular.ttf       (PDF visual rendering)
//   - src/assets/fonts/Lato-Bold.ttf          (PDF visual rendering)
//   - mustang-cli.jar                         (ZUGFeRD/XRechnung PDF/A-3b sealing)
//
// Idempotent: existing non-truncated files are kept.
// Exit code 1 if any asset cannot be provisioned.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const MUSTANG_VERSION = "2.23.0";

const ASSETS = [
  {
    label: "Lato Regular",
    dest: join(ROOT, "src/assets/fonts/Lato-Regular.ttf"),
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf",
    minBytes: 50_000,
  },
  {
    label: "Lato Bold",
    dest: join(ROOT, "src/assets/fonts/Lato-Bold.ttf"),
    url: "https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Bold.ttf",
    minBytes: 50_000,
  },
  {
    label: `Mustang CLI ${MUSTANG_VERSION}`,
    dest: join(ROOT, "mustang-cli.jar"),
    url: `https://github.com/ZUGFeRD/mustangproject/releases/download/core-${MUSTANG_VERSION}/Mustang-CLI-${MUSTANG_VERSION}.jar`,
    minBytes: 1_000_000,
  },
  // sRGB.icc removed: Mustang injects the OutputIntent itself during PDF/A-1 → A-3 promotion.
  // If veraPDF complains about a missing color profile after Mustang sealing, re-add it here.
];

function isPresent(asset) {
  if (!existsSync(asset.dest)) return false;
  const size = statSync(asset.dest).size;
  if (size < asset.minBytes) {
    console.warn(`[setup-assets] ${asset.label} found but looks truncated (${size} bytes); will re-download`);
    try { unlinkSync(asset.dest); } catch {}
    return false;
  }
  return true;
}

async function download(asset) {
  mkdirSync(dirname(asset.dest), { recursive: true });
  console.log(`[setup-assets] Downloading ${asset.label} -> ${asset.dest}`);

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      if (attempt > 1) {
        const delay = attempt * 2000;
        console.log(`[setup-assets] Retrying in ${delay / 1000}s... (Attempt ${attempt}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout per attempt

      const res = await fetch(asset.url, { 
        redirect: "follow",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      await pipeline(Readable.fromWeb(res.body), createWriteStream(asset.dest));

      const size = statSync(asset.dest).size;
      if (size < asset.minBytes) {
        throw new Error(`Downloaded size ${size} < expected min ${asset.minBytes}`);
      }

      console.log(`[setup-assets] OK ${asset.label} (${size.toLocaleString()} bytes)`);
      return; // Success!
    } catch (err) {
      console.warn(`[setup-assets] Attempt ${attempt} failed: ${err.message || err}`);
      if (existsSync(asset.dest)) {
        try { unlinkSync(asset.dest); } catch {}
      }
      if (attempt >= maxRetries) {
        throw err; // Rethrow on last attempt
      }
    }
  }
}

let failed = 0;
for (const asset of ASSETS) {
  if (isPresent(asset)) {
    console.log(`[setup-assets] Skipping ${asset.label} — already present`);
    continue;
  }
  try {
    await download(asset);
  } catch (err) {
    console.error(`[setup-assets] FAILED ${asset.label}: ${err.message || err}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`[setup-assets] ${failed} asset(s) failed. Aborting.`);
  process.exit(1);
}
console.log("[setup-assets] All assets provisioned.");
