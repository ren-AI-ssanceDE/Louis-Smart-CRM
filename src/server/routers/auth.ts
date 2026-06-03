import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../trpc.js";
import { isUsingFallback, fallbackStore, saveFallbackStore, pool, logAuditEvent } from "../db.js";
import { hashPassword } from "../auth.js";
import crypto from "crypto";

export const authRouter = router({
  getSession: publicProcedure
    .output(z.object({
      isAuthenticated: z.boolean(),
      isUsingFallback: z.boolean(),
      user: z.nullable(z.object({
        id: z.string(),
        name: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
      })),
    }))
    .query(async ({ ctx }) => {
      const isAuthenticated = !!(ctx.session && ctx.session.user);
      const user = ctx.session && ctx.session.user ? {
        id: ctx.session.user.id || "",
        name: ctx.session.user.name || null,
        email: ctx.session.user.email || null,
      } : null;

      return {
        isAuthenticated,
        isUsingFallback,
        user,
      };
    }),

  updateCredentials: protectedProcedure
    .input(z.object({
      email_address: z.string().email(),
      password: z.string().optional(),
    }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const currentEmail = ctx.session?.user?.email || "admin@louis-crm.de";
      const newEmail = input.email_address.toLowerCase().trim();
      const newPassword = input.password;

      if (isUsingFallback) {
        if (!fallbackStore.authAccessIdentities) {
          fallbackStore.authAccessIdentities = [];
        }
        
        let user = fallbackStore.authAccessIdentities.find(
          u => u.email_address.toLowerCase().trim() === currentEmail.toLowerCase().trim()
        );

        if (!user) {
          user = {
            id_uuid: ctx.session?.user?.id || "00000000-0000-4000-8000-000000000099",
            email_address: currentEmail,
            full_legal_name: "Admin",
            account_role: "admin",
            password_hash: hashPassword("admin"),
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          };
          fallbackStore.authAccessIdentities.push(user);
        }

        user.email_address = newEmail;
        if (newPassword) {
          user.password_hash = hashPassword(newPassword);
        }
        user.updated_at_utc = new Date().toISOString();
        
        saveFallbackStore();
      } else {
        const checkUser = await pool.query(
          "SELECT id_uuid FROM auth_access_identities WHERE LOWER(email_address) = LOWER($1)",
          [currentEmail]
        );

        let userId = ctx.session?.user?.id;
        if (checkUser.rows.length === 0) {
          userId = crypto.randomUUID();
          await pool.query(
            `INSERT INTO auth_access_identities (id_uuid, email_address, full_legal_name, account_role, password_hash)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, currentEmail, "Admin", "admin", hashPassword("admin")]
          );
        } else {
          userId = checkUser.rows[0].id_uuid;
        }

        if (newPassword) {
          await pool.query(
            `UPDATE auth_access_identities 
             SET email_address = $1, password_hash = $2, updated_at_utc = CURRENT_TIMESTAMP
             WHERE id_uuid = $3`,
            [newEmail, hashPassword(newPassword), userId]
          );
        } else {
          await pool.query(
            `UPDATE auth_access_identities 
             SET email_address = $1, updated_at_utc = CURRENT_TIMESTAMP
             WHERE id_uuid = $2`,
            [newEmail, userId]
          );
        }
      }

      await logAuditEvent({
        tenantId: "1",
        eventType: "UPDATE_CREDENTIALS",
        entityType: "AUTH_ACCESS_IDENTITIES",
        eventDetails: `Updated admin login credentials to email: ${newEmail}`,
        actorIdentity: currentEmail
      });

      return {
        success: true,
        message: "Zugangsdaten erfolgreich aktualisiert."
      };
    })
});
