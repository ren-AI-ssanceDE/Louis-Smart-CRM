// Secret-Verschlüsselung (Task C.3, Plan 2026-08-19)
// ⚠️ 2026-08-19: auth_token_encrypted war KLARTEXT (Spaltenname suggerierte nur Verschlüsselung).
// Echte AES-256-GCM-Verschlüsselung mit Magic-Prefix "lv1:" für idempotente Migration (C.3b).
// Schlüssel: Container-Env LOUIS_SECRET_KEY (Secret, NICHT User-konfigurierbar — kein Regel-12-Wert).
// Dev-Fallback NUR für Fallback-Modus/Tests (stabiler Hash) — Produktion MUSS den Env-Key setzen.
import crypto from "node:crypto";

const MAGIC = "lv1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let warnedDevKey = false;

function getKey(): Buffer {
  const env = process.env.LOUIS_SECRET_KEY;
  if (env && env.length > 0) {
    return crypto.createHash("sha256").update(env).digest();
  }
  if (!warnedDevKey) {
    warnedDevKey = true;
    console.warn("[MCP Secrets] LOUIS_SECRET_KEY ist NICHT gesetzt — Dev-Fallback-Key wird verwendet (nur für Tests/Fallback-Modus, NICHT für Produktion!)");
  }
  return crypto.createHash("sha256").update("louis-dev-fallback-key-2026").digest();
}

/** True, wenn der Wert bereits verschlüsselt ist (Magic-Prefix). */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(MAGIC);
}

/** Verschlüsselt einen Klartext-Secret (idempotent: bereits verschlüsselte Werte bleiben). */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  if (isEncryptedSecret(plain)) return plain;
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MAGIC + Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Entschlüsselt mit explizitem Key (Rotation: Legacy-Key → neuer Key, Skript migrate-mcp-secrets.ts). */
export function decryptSecretWithKey(stored: string | null | undefined, key: Buffer): string {
  if (stored === null || stored === undefined || stored === "") return "";
  if (!isEncryptedSecret(stored)) return stored;
  try {
    const raw = Buffer.from(stored.slice(MAGIC.length), "base64");
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const data = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return stored; // fail-safe: Wert durchreichen statt werfen
  }
}

/** Entschlüsselt einen gespeicherten Secret. Klartext-Bestand (vor Migration) wird durchgereicht. */
export function decryptSecret(stored: string | null | undefined): string {
  return decryptSecretWithKey(stored, getKey());
}
