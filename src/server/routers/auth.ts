import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../trpc.js";
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
        role: z.enum(["admin", "staff", "system"]),
        tenant_id: z.string(),
      })),
    }))
    .query(async ({ ctx }) => {
      const isAuthenticated = !!(ctx.session && ctx.session.user);
      const user = ctx.session && ctx.session.user ? {
        id: ctx.session.user.id || "",
        name: ctx.session.user.name || null,
        email: ctx.session.user.email || null,
        role: ctx.session.user.role || "staff",
        tenant_id: ctx.session.user.tenant_id || "1",
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
    }),

  getUsers: adminProcedure
    .output(z.array(z.object({
      id_uuid: z.string(),
      email_address: z.string(),
      full_legal_name: z.string(),
      account_role: z.string(),
      created_at_utc: z.union([z.string(), z.date()]).optional().nullable(),
      updated_at_utc: z.union([z.string(), z.date()]).optional().nullable(),
    })))
    .query(async () => {
      if (isUsingFallback) {
        if (!fallbackStore.authAccessIdentities) {
          fallbackStore.authAccessIdentities = [];
        }
        if (fallbackStore.authAccessIdentities.length === 0) {
          fallbackStore.authAccessIdentities.push({
            id_uuid: "00000000-0000-4000-8000-000000000099",
            email_address: "admin@louis-crm.de",
            full_legal_name: "Admin",
            account_role: "admin",
            password_hash: hashPassword("admin"),
            created_at_utc: new Date().toISOString(),
            updated_at_utc: new Date().toISOString()
          });
          saveFallbackStore();
        }
        return fallbackStore.authAccessIdentities.map((u) => ({
          id_uuid: u.id_uuid,
          email_address: u.email_address,
          full_legal_name: u.full_legal_name,
          account_role: u.account_role,
          created_at_utc: u.created_at_utc,
          updated_at_utc: u.updated_at_utc,
        }));
      } else {
        const res = await pool.query(
          "SELECT id_uuid, email_address, full_legal_name, account_role, created_at_utc, updated_at_utc FROM auth_access_identities ORDER BY created_at_utc ASC"
        );
        return res.rows.map((row) => ({
          id_uuid: row.id_uuid as string,
          email_address: row.email_address as string,
          full_legal_name: row.full_legal_name as string,
          account_role: row.account_role as string,
          created_at_utc: row.created_at_utc ? (row.created_at_utc as Date).toISOString() : null,
          updated_at_utc: row.updated_at_utc ? (row.updated_at_utc as Date).toISOString() : null,
        }));
      }
    }),

  createUser: adminProcedure
    .input(z.object({
      email_address: z.string().email(),
      full_legal_name: z.string().min(1),
      account_role: z.enum(["admin", "staff", "system"]),
      password: z.string().min(4),
    }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const email = input.email_address.toLowerCase().trim();
      const pHash = hashPassword(input.password);
      const uuid = crypto.randomUUID();

      if (isUsingFallback) {
        if (!fallbackStore.authAccessIdentities) {
          fallbackStore.authAccessIdentities = [];
        }
        const exists = fallbackStore.authAccessIdentities.some(
          (u) => u.email_address.toLowerCase().trim() === email
        );
        if (exists) {
          throw new Error("Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.");
        }
        fallbackStore.authAccessIdentities.push({
          id_uuid: uuid,
          email_address: email,
          full_legal_name: input.full_legal_name,
          account_role: input.account_role,
          password_hash: pHash,
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        const existsRes = await pool.query(
          "SELECT 1 FROM auth_access_identities WHERE LOWER(email_address) = LOWER($1)",
          [email]
        );
        if (existsRes.rows.length > 0) {
          throw new Error("Ein Benutzer mit dieser E-Mail-Adresse existiert bereits.");
        }
        await pool.query(
          `INSERT INTO auth_access_identities (id_uuid, email_address, full_legal_name, account_role, password_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuid, email, input.full_legal_name, input.account_role, pHash]
        );
      }

      await logAuditEvent({
        tenantId: ctx.tenantId || "1",
        eventType: "CREATE_USER",
        entityType: "AUTH_ACCESS_IDENTITIES",
        eventDetails: `Created user ${input.full_legal_name} (${email}) as ${input.account_role}`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return { success: true, message: "Benutzer erfolgreich angelegt." };
    }),

  updateUser: adminProcedure
    .input(z.object({
      id_uuid: z.string(),
      email_address: z.string().email(),
      full_legal_name: z.string().min(1),
      account_role: z.enum(["admin", "staff", "system"]),
      password: z.string().optional(),
    }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const email = input.email_address.toLowerCase().trim();

      if (isUsingFallback) {
        if (!fallbackStore.authAccessIdentities) {
          fallbackStore.authAccessIdentities = [];
        }
        const user = fallbackStore.authAccessIdentities.find((u) => u.id_uuid === input.id_uuid);
        if (!user) {
          throw new Error("Benutzer nicht gefunden.");
        }
        const emailExists = fallbackStore.authAccessIdentities.some(
          (u) => u.id_uuid !== input.id_uuid && u.email_address.toLowerCase().trim() === email
        );
        if (emailExists) {
          throw new Error("Ein anderer Benutzer verwendet bereits diese E-Mail-Adresse.");
        }

        if (user.account_role === "admin" && input.account_role !== "admin") {
          const adminCount = fallbackStore.authAccessIdentities.filter(u => u.account_role === "admin").length;
          if (adminCount <= 1) {
            throw new Error("Der letzte Administrator kann nicht herabgestuft werden.");
          }
        }

        user.email_address = email;
        user.full_legal_name = input.full_legal_name;
        user.account_role = input.account_role;
        if (input.password) {
          user.password_hash = hashPassword(input.password);
        }
        user.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
      } else {
        const emailExists = await pool.query(
          "SELECT 1 FROM auth_access_identities WHERE id_uuid != $1 AND LOWER(email_address) = LOWER($2)",
          [input.id_uuid, email]
        );
        if (emailExists.rows.length > 0) {
          throw new Error("Ein anderer Benutzer verwendet bereits diese E-Mail-Adresse.");
        }

        const currentRoleRes = await pool.query(
          "SELECT account_role FROM auth_access_identities WHERE id_uuid = $1",
          [input.id_uuid]
        );
        if (currentRoleRes.rows.length > 0) {
          const currentRole = currentRoleRes.rows[0].account_role;
          if (currentRole === "admin" && input.account_role !== "admin") {
            const adminCountRes = await pool.query("SELECT COUNT(*) FROM auth_access_identities WHERE account_role = 'admin'");
            const adminCount = parseInt(adminCountRes.rows[0].count);
            if (adminCount <= 1) {
              throw new Error("Der letzte Administrator kann nicht herabgestuft werden.");
            }
          }
        }

        if (input.password) {
          const pHash = hashPassword(input.password);
          await pool.query(
            `UPDATE auth_access_identities 
             SET email_address = $1, full_legal_name = $2, account_role = $3, password_hash = $4, updated_at_utc = CURRENT_TIMESTAMP
             WHERE id_uuid = $5`,
            [email, input.full_legal_name, input.account_role, pHash, input.id_uuid]
          );
        } else {
          await pool.query(
            `UPDATE auth_access_identities 
             SET email_address = $1, full_legal_name = $2, account_role = $3, updated_at_utc = CURRENT_TIMESTAMP
             WHERE id_uuid = $4`,
            [email, input.full_legal_name, input.account_role, input.id_uuid]
          );
        }
      }

      await logAuditEvent({
        tenantId: ctx.tenantId || "1",
        eventType: "UPDATE_USER",
        entityType: "AUTH_ACCESS_IDENTITIES",
        eventDetails: `Updated user details for ${input.full_legal_name} (${email})`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return { success: true, message: "Benutzer erfolgreich aktualisiert." };
    }),

  deleteUser: adminProcedure
    .input(z.object({
      id_uuid: z.string(),
    }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (ctx.session?.user?.id === input.id_uuid) {
        throw new Error("Sie können Ihren eigenen Benutzer nicht löschen.");
      }

      let deletedEmail = "";

      if (isUsingFallback) {
        if (!fallbackStore.authAccessIdentities) {
          fallbackStore.authAccessIdentities = [];
        }
        const index = fallbackStore.authAccessIdentities.findIndex((u) => u.id_uuid === input.id_uuid);
        if (index === -1) {
          throw new Error("Benutzer nicht gefunden.");
        }
        const userToDelete = fallbackStore.authAccessIdentities[index];
        if (userToDelete.account_role === "admin") {
          const adminCount = fallbackStore.authAccessIdentities.filter(u => u.account_role === "admin").length;
          if (adminCount <= 1) {
            throw new Error("Der letzte Administrator kann nicht gelöscht werden.");
          }
        }
        deletedEmail = userToDelete.email_address;
        fallbackStore.authAccessIdentities.splice(index, 1);
        saveFallbackStore();
      } else {
        const checkRoleRes = await pool.query(
          "SELECT account_role, email_address FROM auth_access_identities WHERE id_uuid = $1",
          [input.id_uuid]
        );
        if (checkRoleRes.rows.length === 0) {
          throw new Error("Benutzer nicht gefunden.");
        }
        const userToDelete = checkRoleRes.rows[0];
        if (userToDelete.account_role === "admin") {
          const adminCountRes = await pool.query("SELECT COUNT(*) FROM auth_access_identities WHERE account_role = 'admin'");
          const adminCount = parseInt(adminCountRes.rows[0].count);
          if (adminCount <= 1) {
            throw new Error("Der letzte Administrator kann nicht gelöscht werden.");
          }
        }
        deletedEmail = userToDelete.email_address as string;
        await pool.query(
          "DELETE FROM auth_access_identities WHERE id_uuid = $1",
          [input.id_uuid]
        );
      }

      await logAuditEvent({
        tenantId: ctx.tenantId || "1",
        eventType: "DELETE_USER",
        entityType: "AUTH_ACCESS_IDENTITIES",
        eventDetails: `Deleted user: ${deletedEmail}`,
        actorIdentity: ctx.session?.user?.email || "unknown"
      });

      return { success: true, message: "Benutzer erfolgreich gelöscht." };
    })
});
