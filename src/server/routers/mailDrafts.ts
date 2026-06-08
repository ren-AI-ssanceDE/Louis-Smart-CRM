import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { router, protectedProcedure } from "../trpc.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../db.js";
import { workflowExecutor } from "../ai/workflowExecutor.js";
import { ingestEmailToRag } from "../storage.js";
import { resolveAttachmentPhysicalPath } from "../ai/tools/messaging.js";
import { MailDraft, WorkflowInstance, CustomWorkflow, SmtpSettings } from "../../types.js";

export const mailDraftsRouter = router({
  getPending: protectedProcedure
    .query(async ({ ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        const list = fallbackStore.mailDrafts || [];
        return list.filter((d: MailDraft) => d.tenant_id === tenantId && d.status === "PENDING");
      }

      try {
        const res = await pool.query(
          "SELECT * FROM sys_louis_mail_drafts WHERE tenant_id = $1 AND status = 'PENDING' ORDER BY created_at_utc DESC",
          [tenantId]
        );
        return res.rows;
      } catch (err) {
        console.error("Postgres query getPending mail drafts failed:", err);
        return [];
      }
    }),

  updateDraft: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid(),
      subject: z.string().min(1),
      body: z.string().min(1)
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      if (isUsingFallback) {
        if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
        const draft = fallbackStore.mailDrafts.find((d: MailDraft) => d.id_uuid === input.id_uuid && d.tenant_id === tenantId);
        if (!draft) throw new Error("Draft not found");
        draft.subject = input.subject;
        draft.body = input.body;
        draft.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
        return { success: true };
      }

      try {
        await pool.query(
          "UPDATE sys_louis_mail_drafts SET subject = $1, body = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND tenant_id = $4",
          [input.subject, input.body, input.id_uuid, tenantId]
        );
        return { success: true };
      } catch (err) {
        console.error("Postgres updateDraft failed:", err);
        throw err;
      }
    }),

  approve: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let draft: MailDraft | null = null;

      if (isUsingFallback) {
        if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
        draft = fallbackStore.mailDrafts.find((d: MailDraft) => d.id_uuid === input.id_uuid && d.tenant_id === tenantId) || null;
      } else {
        try {
          const res = await pool.query("SELECT * FROM sys_louis_mail_drafts WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, tenantId]);
          if (res.rows.length > 0) {
            draft = res.rows[0];
          }
        } catch (e) {
          console.error("Error fetching draft during approve:", e);
        }
      }

      if (!draft) {
        throw new Error("Draft not found");
      }

      // 1. Attempt to send email via SMTP
      let smtp: SmtpSettings | null = null;
      if (isUsingFallback) {
        smtp = fallbackStore.smtpSettings;
      } else {
        try {
          const res = await pool.query(
            "SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
            [tenantId]
          );
          smtp = res.rows[0];
        } catch (e) {
          console.warn("Failed to retrieve SMTP configs during approve:", e);
        }
      }

      if (smtp) {
        try {
          const transporter = nodemailer.createTransport({
            host: smtp.smtp_host_name,
            port: smtp.smtp_port_number,
            secure: smtp.is_secure_connection,
            auth: {
              user: smtp.smtp_user_name,
              pass: smtp.smtp_password_secret,
            },
            tls: {
              rejectUnauthorized: false
            }
          });

          let parsedAttachments: unknown[] = [];
          if (draft.attachments_json) {
            try {
              if (typeof draft.attachments_json === "string") {
                parsedAttachments = JSON.parse(draft.attachments_json);
              } else if (Array.isArray(draft.attachments_json)) {
                parsedAttachments = draft.attachments_json;
              }
            } catch (pErr) {
              console.warn("Failed to parse draft.attachments_json:", pErr);
            }
          }

          const nodemailerAttachments: { filename: string; path: string }[] = [];
          if (Array.isArray(parsedAttachments)) {
            for (const att of parsedAttachments) {
              if (att && typeof att === "object") {
                const attObj = att as Record<string, unknown>;
                const filename = typeof attObj.filename === "string" ? attObj.filename : "Anhang";
                const source = typeof attObj.source === "string" ? attObj.source : undefined;
                const entityId = typeof attObj.entity_id === "string" ? attObj.entity_id : undefined;
                const entityType = typeof attObj.entity_type === "string" ? attObj.entity_type : undefined;

                const filePath = resolveAttachmentPhysicalPath(
                  tenantId,
                  filename,
                  source,
                  entityId,
                  entityType
                );

                if (filePath && fs.existsSync(filePath)) {
                  nodemailerAttachments.push({
                    filename: filename,
                    path: filePath
                  });
                } else {
                  console.warn(`[SMTP approve] Could not resolve physical path for attachment "${filename}"`);
                }
              } else if (typeof att === "string") {
                const filePath = resolveAttachmentPhysicalPath(tenantId, att);
                if (filePath && fs.existsSync(filePath)) {
                  nodemailerAttachments.push({
                    filename: path.basename(filePath).replace(/^\d+_/g, ''),
                    path: filePath
                  });
                }
              }
            }
          }

          const isHtml = /<[a-z|/][\s\S]*>/i.test(draft.body);
          const htmlContent = isHtml 
            ? draft.body 
            : draft.body.split("\n").map(line => line.trim() ? `<p style="margin: 0 0 1em 0;">${line}</p>` : "<br />").join("");

          await transporter.sendMail({
            from: smtp.sender_display_name 
              ? `"${smtp.sender_display_name}" <${smtp.sender_email_address || smtp.smtp_user_name}>` 
              : smtp.smtp_user_name,
            to: draft.recipient,
            subject: draft.subject,
            text: draft.body.replace(/<[^>]*>/g, ""),
            html: htmlContent,
            attachments: nodemailerAttachments
          });

          try {
            await ingestEmailToRag({
              tenantId,
              recipient: draft.recipient,
              senderType: "AI",
              subject: draft.subject,
              body: draft.body,
              attachments: parsedAttachments,
              workflowInstanceId: draft.workflow_instance_id
            });
          } catch (ragErr) {
            console.error("[approveMailDraft] Failed to ingest sent mail to RAG:", ragErr);
          }
        } catch (mailErr: unknown) {
          const errMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
          console.error("Error sending approved email via SMTP:", mailErr);
          throw new Error(`SMTP-Sende-Fehler: E-Mail konnte nicht zugestellt werden. (${errMsg})`);
        }
      } else {
        console.log(`[MailDraftsService] Simulating mail to ${draft.recipient} (No SMTP configured)`);
        
        let parsedAttachments: unknown[] = [];
        if (draft.attachments_json) {
          try {
            if (typeof draft.attachments_json === "string") {
              parsedAttachments = JSON.parse(draft.attachments_json);
            } else if (Array.isArray(draft.attachments_json)) {
              parsedAttachments = draft.attachments_json;
            }
          } catch (pErr) {
            console.warn("Failed to parse draft.attachments_json:", pErr);
          }
        }

        try {
          await ingestEmailToRag({
            tenantId,
            recipient: draft.recipient,
            senderType: "AI",
            subject: draft.subject,
            body: draft.body,
            attachments: parsedAttachments,
            workflowInstanceId: draft.workflow_instance_id
          });
        } catch (ragErr) {
          console.error("[approveMailDraft - Simulation] Failed to ingest simulated mail to RAG:", ragErr);
        }
      }

      // 2. Set Status as APPROVED
      if (isUsingFallback) {
        draft.status = "APPROVED";
        draft.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
      } else {
        try {
          await pool.query(
            "UPDATE sys_louis_mail_drafts SET status = 'APPROVED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND tenant_id = $2",
            [input.id_uuid, tenantId]
          );
        } catch (err) {
          console.error("Failed to update status for draft inside Postgres db:", err);
        }
      }

      // 3. Resume workflow execution if a workflow instance was paused on it
      if (draft.workflow_instance_id) {
        let instance: WorkflowInstance | null = null;
        if (isUsingFallback) {
          instance = (fallbackStore.workflowInstances || []).find((i: WorkflowInstance) => i.id_uuid === draft.workflow_instance_id);
        } else {
          try {
            const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [draft.workflow_instance_id]);
            if (res.rows.length > 0) {
              instance = res.rows[0];
            }
          } catch (e) {
            console.warn("Failed to load instance during resume:", e);
          }
        }

        if (instance) {
          let workflow: CustomWorkflow | null = null;
          if (isUsingFallback) {
            workflow = (fallbackStore.customWorkflows || []).find((w: CustomWorkflow) => w.id_uuid === instance.workflow_id);
          } else {
            try {
              const res = await pool.query("SELECT * FROM sys_louis_ai_custom_workflows WHERE id_uuid = $1", [instance.workflow_id]);
              if (res.rows.length > 0) {
                workflow = res.rows[0];
              }
            } catch (e) {
              console.warn("Failed to load custom workflow configuration:", e);
            }
          }

          if (workflow) {
            // Continuation occurs asynchronously
            const nextStepIndex = (instance.current_step_index || 0) + 1;
            console.log(`[MailDraftsService] ⏯️ Resuming workflow "${workflow.workflow_name}" from step ${nextStepIndex + 1}`);
            
            // Log resume event
            instance.execution_log.push({
              timestamp: new Date().toISOString(),
              step: "APPROVAL",
              details: `E-Mail-Entwurf (${draft.id_uuid}) wurde freigegeben. Setze Workflow bei Schritt ${nextStepIndex + 1} fort.`
            });
            await workflowExecutor.saveInstance(instance);

            workflowExecutor.execute(
              workflow,
              instance.initial_payload,
              nextStepIndex,
              instance.id_uuid
            ).catch((execErr: unknown) => {
              console.error("Async Workflow continuation execution error:", execErr);
            });
          }
        }
      }

      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({
      id_uuid: z.string().uuid()
    }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      let draft: MailDraft | null = null;

      if (isUsingFallback) {
        if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
        draft = fallbackStore.mailDrafts.find((d: MailDraft) => d.id_uuid === input.id_uuid && d.tenant_id === tenantId) || null;
      } else {
        try {
          const res = await pool.query("SELECT * FROM sys_louis_mail_drafts WHERE id_uuid = $1 AND tenant_id = $2", [input.id_uuid, tenantId]);
          if (res.rows.length > 0) {
            draft = res.rows[0];
          }
        } catch (e) {
          console.error("Error fetching draft during reject:", e);
        }
      }

      if (!draft) {
        throw new Error("Draft not found");
      }

      // 1. Mark as rejected
      if (isUsingFallback) {
        draft.status = "REJECTED";
        draft.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
      } else {
        try {
          await pool.query(
            "UPDATE sys_louis_mail_drafts SET status = 'REJECTED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND tenant_id = $2",
            [input.id_uuid, tenantId]
          );
        } catch (err) {
          console.error("Failed to reject draft inside Postgres db:", err);
        }
      }

      // 2. Mark corresponding workflow instance as failed/aborted
      if (draft.workflow_instance_id) {
        let instance: WorkflowInstance | null = null;
        if (isUsingFallback) {
          instance = (fallbackStore.workflowInstances || []).find((i: WorkflowInstance) => i.id_uuid === draft.workflow_instance_id);
        } else {
          try {
            const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [draft.workflow_instance_id]);
            if (res.rows.length > 0) {
              instance = res.rows[0];
            }
          } catch (e) {
            console.warn("Failed to load instance during reject abort trigger:", e);
          }
        }

        if (instance) {
          instance.status = "FAILED";
          instance.execution_log.push({
            timestamp: new Date().toISOString(),
            step: "REJECTION",
            details: `Workflow wurde abgebrochen, da der E-Mail-Entwurf (${draft.id_uuid}) abgelehnt wurde.`
          });
          await workflowExecutor.saveInstance(instance);
        }
      }

      return { success: true };
    })
});
