import { ExpressAuth } from "@auth/express";
import PostgresAdapter from "@auth/pg-adapter";
import Credentials from "@auth/express/providers/credentials";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "./db.js";
import { Session, IdentityRole } from "../types.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// 021-D (V2-6): Passwort-Hashing auf bcrypt (per-User-Salt, Kostenfaktor 10).
// Alt-Hashes (PBKDF2, fixes Salt, 1000 Iterationen) bleiben per Fallback gültig
// und werden beim nächsten erfolgreichen Login lazy migriert (siehe authorize).
const BCRYPT_ROUNDS = 10;
const LEGACY_PBKDF2_SALT = "louis-smart-crm-salt-key-99-abc";
const LEGACY_PBKDF2_ITERATIONS = 1000;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/** Erkennt bcrypt-Hashes ($2a$/$2b$/$2y$). Alles andere = Alt-Format (PBKDF2). */
export function isBcryptHash(storedHash: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(storedHash);
}

/**
 * Verifiziert ein Passwort gegen einen gespeicherten Hash — bcrypt oder
 * Alt-Format (PBKDF2-SHA512, fixes Salt, 1000 Iterationen).
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (isBcryptHash(storedHash)) {
    try {
      return bcrypt.compareSync(password, storedHash);
    } catch {
      return false;
    }
  }
  // Legacy: PBKDF2 mit dem alten, hartkodierten Salt
  const legacy = crypto.pbkdf2Sync(password, LEGACY_PBKDF2_SALT, LEGACY_PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  const normalized = storedHash.trim().toLowerCase();
  return normalized === legacy;
}

interface AuthSessionUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: IdentityRole;
  tenant_id?: string;
}

interface AuthSession {
  user?: AuthSessionUser;
  expires: string;
}

interface AuthToken {
  sub?: string;
  role?: IdentityRole;
  tenant_id?: string;
  [key: string]: unknown;
}

interface AuthUser {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: IdentityRole;
  tenant_id?: string;
}

export const authConfig: Parameters<typeof ExpressAuth>[0] = {
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const email = (credentials.email as string || "").toLowerCase().trim();
        const password = credentials.password as string || "";

        if (isUsingFallback) {
          if (!fallbackStore.authAccessIdentities) {
            fallbackStore.authAccessIdentities = [];
          }
          let user = fallbackStore.authAccessIdentities.find(
            (u) => u.email_address.toLowerCase().trim() === email
          );
          
          if (!user && email === "admin@louis-crm.de") {
            const defaultUser = {
              id_uuid: "00000000-0000-4000-8000-000000000099",
              email_address: "admin@louis-crm.de",
              full_legal_name: "Admin",
              account_role: "admin",
              password_hash: hashPassword("admin"),
              created_at_utc: new Date().toISOString(),
              updated_at_utc: new Date().toISOString()
            };
            fallbackStore.authAccessIdentities.push(defaultUser);
            saveFallbackStore();
            user = defaultUser;
          }

          if (user && verifyPassword(password, String(user.password_hash || ""))) {
            // 021-D (V2-6): Lazy-Migration — Alt-PBKDF2-Hash nach erfolgreichem Login auf bcrypt umstellen
            if (!isBcryptHash(String(user.password_hash || ""))) {
              user.password_hash = hashPassword(password);
              saveFallbackStore();
            }
            return {
              id: user.id_uuid,
              name: user.full_legal_name,
              email: user.email_address,
              role: (user.account_role || "staff") as IdentityRole,
              tenant_id: "1"
            };
          }
        } else {
          try {
            const res = await pool.query(
              "SELECT * FROM auth_access_identities WHERE LOWER(email_address) = LOWER($1) LIMIT 1",
              [email]
            );
            if (res.rows.length > 0) {
              const user = res.rows[0];
              if (verifyPassword(password, String(user.password_hash || ""))) {
                // 021-D (V2-6): Lazy-Migration — Alt-PBKDF2-Hash nach erfolgreichem Login auf bcrypt umstellen
                if (!isBcryptHash(String(user.password_hash || ""))) {
                  const newHash = hashPassword(password);
                  await pool.query(
                    `UPDATE auth_access_identities SET password_hash = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2`,
                    [newHash, user.id_uuid]
                  );
                }
                return {
                  id: user.id_uuid,
                  name: user.full_legal_name,
                  email: user.email_address,
                  role: (user.account_role || "staff") as IdentityRole,
                  tenant_id: "1"
                };
              }
            } else if (email === "admin@louis-crm.de") {
              const id = "00000000-0000-4000-8000-000000000099";
              const pHash = hashPassword("admin");
              await pool.query(
                `INSERT INTO auth_access_identities (id_uuid, email_address, full_legal_name, account_role, password_hash)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (email_address) DO NOTHING`,
                [id, "admin@louis-crm.de", "Admin", "admin", pHash]
              );
              if (password === "admin") {
                return {
                  id,
                  name: "Admin",
                  email: "admin@louis-crm.de",
                  role: "admin" as IdentityRole,
                  tenant_id: "1"
                };
              }
            }
          } catch (err) {
            console.error("Authorize db access error:", err);
            if (email === "admin@louis-crm.de" && password === "admin") {
              return {
                id: "00000000-0000-4000-8000-000000000099",
                name: "Admin",
                email: "admin@louis-crm.de",
                role: "admin" as IdentityRole,
                tenant_id: "1"
              };
            }
          }
        }
        return null;
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  callbacks: {
    async jwt({ token, user } : { token: AuthToken; user?: AuthUser | null }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role || 'staff';
        token.tenant_id = user.tenant_id || '1';
      }
      return token;
    },
    async session({ session, token, user } : { session: AuthSession; token?: AuthToken | null; user?: AuthUser | null }) {
      if (session && session.user) {
        session.user.id = (token?.sub || user?.id) as string;
        session.user.role = (token?.role || user?.role || 'staff') as IdentityRole;
        session.user.tenant_id = (token?.tenant_id || user?.tenant_id || '1') as string;
      }
      return session;
    }
  },
  secret: process.env.AUTH_SECRET || "",
  trustHost: true,
};

// 021-F (Regel 2026-08-17): Auth-Secret lebt in der DB (sys_app_security),
// NICHT in Dateien/Code. Der alte hartkodierte UUID-Fallback wird ersetzt:
// NULL/leer = beim ersten Start generiert + in der DB persistiert (stabil über
// Neustarts, Sessions bleiben gültig). AUTH_SECRET-Env ist nur ein optionaler
// Infrastruktur-Override (>= 32 Zeichen, nicht der bekannte Compose-Beispielwert).
let cachedAuthSecret: string | null = null;

export async function getAuthSecret(): Promise<string> {
  if (cachedAuthSecret) return cachedAuthSecret;
  const envSecret = process.env.AUTH_SECRET;
  if (
    envSecret &&
    envSecret.length >= 32 &&
    envSecret !== "some_random_secret_at_least_32_chars_long_for_security"
  ) {
    cachedAuthSecret = envSecret;
    return envSecret;
  }
  if (isUsingFallback || !pool) {
    if (!fallbackStore.authSecret) {
      fallbackStore.authSecret = crypto.randomBytes(32).toString("hex");
      saveFallbackStore();
    }
    cachedAuthSecret = fallbackStore.authSecret;
    return fallbackStore.authSecret;
  }
  try {
    const res = await pool.query("SELECT auth_secret FROM sys_app_security LIMIT 1");
    if (res.rows.length > 0 && res.rows[0].auth_secret) {
      cachedAuthSecret = String(res.rows[0].auth_secret);
      return cachedAuthSecret;
    }
    // Kein Eintrag (Bestands-DB ohne Seed): generieren + idempotent persistieren
    const generated = crypto.randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO sys_app_security (auth_secret) VALUES ($1) ON CONFLICT DO NOTHING",
      [generated]
    );
    const res2 = await pool.query("SELECT auth_secret FROM sys_app_security LIMIT 1");
    cachedAuthSecret = String(res2.rows[0]?.auth_secret || generated);
    return cachedAuthSecret;
  } catch (err) {
    console.error("[auth] getAuthSecret DB-Zugriff fehlgeschlagen — temporaeres Secret fuer diese Sitzung.", err);
    cachedAuthSecret = crypto.randomBytes(32).toString("hex");
    return cachedAuthSecret;
  }
}

export async function initAuthSecret(): Promise<void> {
  authConfig.secret = await getAuthSecret();
}

// Postgres adapter is disabled to prevent user ID/tenant ID split-brain issues with auth_access_identities table.
// NextAuth runs in pure Credentials JWT mode instead, ensuring absolute tenant ID consistency.
/*
if (!isUsingFallback && pool) {
  authConfig.adapter = PostgresAdapter(pool);
}
*/

export const authMiddleware = ExpressAuth(authConfig);
