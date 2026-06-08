import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import path from "path";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, logAuditEvent } from "../db.js";
import { generateContentUniversal } from "./geminiHelper.js";
import { CustomWorkflow, WorkflowInstance, LouisAiConfig, WorkflowExecutionLogEntry, MailDraftAttachment, SmtpSettings } from "../../types.js";
import { ingestEmailToRag } from "../storage.js";
import { resolveAttachmentPhysicalPath } from "./tools/messaging.js";

interface LlmResultStructure {
  workflow_step_result?: {
    generated_content?: {
      body?: string;
      subject?: string;
      text?: string;
      attachments?: unknown[];
      outputs?: {
        details?: {
          body?: string;
          subject?: string;
        };
        body?: string;
        text?: string;
      };
      output?: {
        generated_text?: string;
      };
      generated_text?: string;
      email_subject_text?: string;
      email_body_content?: string;
    };
    outputs?: {
      details?: {
        body?: string;
        subject?: string;
      };
      body?: string;
      text?: string;
    };
    output?: {
      generated_text?: string;
    };
    generated_text?: string;
    email_body_content?: string;
    body?: string;
    text?: string;
    subject?: string;
    attachments?: unknown[];
    email_subject_text?: string;
  };
  generated_content?: {
    body?: string;
    subject?: string;
    text?: string;
    attachments?: unknown[];
    outputs?: {
      details?: {
        body?: string;
        subject?: string;
      };
      body?: string;
      text?: string;
    };
    output?: {
      generated_text?: string;
    };
    generated_text?: string;
    email_subject_text?: string;
    email_body_content?: string;
  };
  outputs?: {
    details?: {
      body?: string;
      subject?: string;
    };
    body?: string;
    text?: string;
  };
  output?: {
    generated_text?: string;
  };
  generated_text?: string;
  email_body_content?: string;
  body?: string;
  text?: string;
  subject?: string;
  attachments?: unknown[];
  email_subject_text?: string;
}

export class WorkflowExecutor {
  /**
   * Loaded active Louis AI Configuration dynamically based on tenant.
   */
  private async getLouisAiConfig(tenantId: string): Promise<{
    provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic';
    model_name: string;
    api_key_secret: string;
    base_url: string;
  }> {
    let provider_type: 'gemini' | 'ollama' | 'openai' | 'anthropic' = 'gemini';
    let model_name = "gemini-2.5-flash";
    let api_key_secret = process.env.GEMINI_API_KEY || "";
    let base_url = "";

    try {
      if (isUsingFallback) {
        const list = (fallbackStore.louisAiConfig as LouisAiConfig[] || []);
        const found = list.find((c) => c.tenant_id === tenantId) || 
                      list.find((c) => c.tenant_id === '1');
        if (found) {
          if (found.provider_type) provider_type = found.provider_type;
          if (found.model_name) model_name = found.model_name;
          if (found.api_key_secret) api_key_secret = found.api_key_secret.trim();
          if (found.base_url) base_url = found.base_url.trim();
        }
      } else {
        const res = await pool.query(
          "SELECT provider_type, model_name, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
          [tenantId]
        );
        if (res.rows.length > 0) {
          const row = res.rows[0];
          if (row.provider_type) provider_type = row.provider_type as 'gemini' | 'ollama' | 'openai' | 'anthropic';
          if (row.model_name) model_name = row.model_name;
          if (row.api_key_secret) api_key_secret = row.api_key_secret.trim();
          if (row.base_url) base_url = row.base_url.trim();
        }
      }
    } catch (err) {
      console.warn("[WorkflowExecutor] Failed to load provider configuration from Louis AI config, using defaults:", err);
    }

    if (api_key_secret.includes('@') || api_key_secret === '******') {
      api_key_secret = process.env.GEMINI_API_KEY || '';
    }

    return {
      provider_type,
      model_name,
      api_key_secret,
      base_url
    };
  }

  /**
   * Universal method to persist workflow execution states.
   */
  public async saveInstance(instance: WorkflowInstance) {
    const nowIso = new Date().toISOString();
    if (!instance.created_at_utc) {
      instance.created_at_utc = nowIso;
    }
    instance.updated_at_utc = nowIso;

    if (isUsingFallback) {
      if (!fallbackStore.workflowInstances) {
        fallbackStore.workflowInstances = [];
      }
      const idx = fallbackStore.workflowInstances.findIndex(i => i.id_uuid === instance.id_uuid);
      if (idx !== -1) {
        fallbackStore.workflowInstances[idx] = instance;
      } else {
        fallbackStore.workflowInstances.unshift(instance);
      }
      saveFallbackStore();
    } else {
      try {
        await pool.query(`
          INSERT INTO sys_louis_ai_workflow_instances (
            id_uuid, tenant_id, workflow_id, status, initial_payload, current_step_index, execution_log, execute_at_utc, created_at_utc, updated_at_utc
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (id_uuid)
          DO UPDATE SET 
            status = EXCLUDED.status, 
            current_step_index = EXCLUDED.current_step_index, 
            execution_log = EXCLUDED.execution_log, 
            execute_at_utc = EXCLUDED.execute_at_utc,
            updated_at_utc = CURRENT_TIMESTAMP
        `, [
          instance.id_uuid || uuidv4(),
          instance.tenant_id,
          instance.workflow_id,
          instance.status,
          JSON.stringify(instance.initial_payload),
          instance.current_step_index,
          JSON.stringify(instance.execution_log),
          instance.execute_at_utc || null
        ]);
      } catch (err) {
        console.error("[WorkflowExecutor] PostgreSQL saveInstance failed, local fallback used:", err);
        // Fallback save write-through
        if (!fallbackStore.workflowInstances) fallbackStore.workflowInstances = [];
        const idx = fallbackStore.workflowInstances.findIndex(i => i.id_uuid === instance.id_uuid);
        if (idx !== -1) {
          fallbackStore.workflowInstances[idx] = instance;
        } else {
          fallbackStore.workflowInstances.unshift(instance);
        }
        saveFallbackStore();
      }
    }
  }

  /**
   * Helper to retrieve all workflow instances for a specific tenant.
   */
  public async getInstances(tenantId: string): Promise<WorkflowInstance[]> {
    if (isUsingFallback) {
      return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
    }
    try {
      const res = await pool.query(
        "SELECT * FROM sys_louis_ai_workflow_instances WHERE tenant_id = $1 ORDER BY created_at_utc DESC",
        [tenantId]
      );
      return res.rows;
    } catch (err) {
      console.warn("[WorkflowExecutor] Postgres query for instances failed, using fallback:", err);
      return (fallbackStore.workflowInstances || []).filter(i => i.tenant_id === tenantId);
    }
  }

  /**
   * Execute an active custom workflow. Supports resuming from a specific step.
   */
  public async execute(
    workflow: CustomWorkflow,
    initialPayload: Record<string, unknown> | null | undefined,
    startStepIndex: number = 0,
    existingInstanceId?: string
  ) {
    const tenantId = workflow.tenant_id || "1";
    let instanceId = existingInstanceId || uuidv4();
    const sequence = workflow.tool_chain_sequence || [];

    let instance: WorkflowInstance | null = null;
    if (existingInstanceId) {
      if (isUsingFallback) {
        instance = (fallbackStore.workflowInstances || []).find(i => i.id_uuid === existingInstanceId) || null;
      } else {
        try {
          const res = await pool.query("SELECT * FROM sys_louis_ai_workflow_instances WHERE id_uuid = $1", [existingInstanceId]);
          if (res.rows.length > 0) {
            instance = res.rows[0];
          }
        } catch (e) {
          console.warn("Failed to find existing workflow instance by ID in Postgres:", e);
        }
      }
    }

    if (instance) {
      instance.status = "RUNNING";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "RESUME",
        details: `Workflow fortgesetzt ab Schritt ${startStepIndex + 1}`
      });
      await this.saveInstance(instance);
    } else {
      instanceId = uuidv4();
      instance = {
        id_uuid: instanceId,
        tenant_id: tenantId,
        workflow_id: workflow.id_uuid || "",
        status: "RUNNING",
        initial_payload: initialPayload,
        current_step_index: startStepIndex,
        execution_log: [
          {
            timestamp: new Date().toISOString(),
            step: "INIT",
            details: `Workflow gestartet: "${workflow.workflow_name}"`
          }
        ],
        execute_at_utc: null
      };
      await this.saveInstance(instance);
    }

    try {
      const config = await this.getLouisAiConfig(tenantId);

      for (let i = startStepIndex; i < sequence.length; i++) {
        instance.current_step_index = i;
        const step = sequence[i];
        
        console.log(`[WorkflowExecutor] Executing Step ${i + 1}/${sequence.length}: [Tool: ${step.tool}]`);
        
        const isWaitStep = [
          "executeWait",
          "wait",
          "WAIT",
          "delay",
          "DELAY"
        ].includes(step.tool || "") || 
        (typeof step.tool === "string" && (
          step.tool.toLowerCase().includes("wait") ||
          step.tool.toLowerCase().includes("delay")
        ));

        if (isWaitStep) {
          const seconds = this.parseWaitDurationToSeconds(step.instruction);
          const executeAt = new Date(Date.now() + seconds * 1000).toISOString();
          
          instance.current_step_index = i + 1;
          instance.status = "PENDING_DELAY";
          instance.execute_at_utc = executeAt;
          
          const delayLogEntry: WorkflowExecutionLogEntry = {
            step_index: i,
            tool: step.tool,
            instruction: step.instruction,
            timestamp: new Date().toISOString(),
            details: `Warte-Schritt: ${seconds} Sekunden Verzögerung aktiv. Fortsetzung geplant für ${executeAt}`
          };
          instance.execution_log.push(delayLogEntry);
          
          await this.saveInstance(instance);
          console.log(`[WorkflowExecutor] ⏰ Paused workflow instance ${instance.id_uuid} for ${seconds}s. Next resume step index: ${instance.current_step_index}`);
          return;
        }

        const logEntry: WorkflowExecutionLogEntry = {
          step_index: i,
          tool: step.tool,
          instruction: step.instruction,
          timestamp: new Date().toISOString()
        };

        // LLM prompt compilation
        const prompt = `
Du bist LOUIS, die KI-Engine des Louis Smart CRM. Deine Aufgabe ist es, einen automatisierten Workflow-Schritt auszuführen.

SCHRITT DETAILS:
- Aktueller Schritt: ${i + 1} von ${sequence.length}
- Auszuführende Aktion: ${step.tool}
- Instruktion des Autors: "${step.instruction}"

INITIALES EVENTS PAYLOAD (Der Trigger-Auslöser):
${JSON.stringify(initialPayload, null, 2)}

VORHERIGE OUTCOMES / VERLAUFS-SPEICHER:
${JSON.stringify(instance.execution_log, null, 2)}

Bitte generiere die Antwort oder das Resultat für diesen Schritt basierend auf der Instruktion und den vorliegenden Daten.
Antworte präzise, professionell und ohne Einleitungsfloskeln.
`;

        const needsApiKey = config.provider_type !== 'ollama';
        const hasApiKey = !!config.api_key_secret;
        let llmResult = "";

        if (!needsApiKey || hasApiKey) {
          try {
            const llm = await generateContentUniversal({
              provider_type: config.provider_type,
              model_name: config.model_name,
              api_key_secret: config.api_key_secret,
              base_url: config.base_url,
              contents: prompt,
              systemInstruction: "Führe den Workflow-Schritt aus und halte dich exakt an die Vorgabe des Benutzers. Nutze IMMER die korrekten Namen, Anreden (such as first_name, last_name, salutation) und E-Mail-Adressen aus dem dargelegten INITIALEN EVENTS PAYLOAD. Halluziniere oder erfinde unter keinen Umständen Personennamen, Anreden oder sonstige Kunden- oder Firmendetails. Wenn bestimmte Namensdaten nicht vorhanden sind, formuliere die Nachricht höflich und neutral (z.B. 'Sehr geehrte Damen und Herren' oder 'Hallo,') anstatt Namen zu erfinden."
            });
            llmResult = llm.text;
          } catch (llmErr: unknown) {
            const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
            console.error(`[WorkflowExecutor] LLM execution failed on step ${i + 1}:`, llmErr);
            llmResult = `[LLM Fehler: ${errMsg}]`;
          }
        } else {
          llmResult = `[Fehler: Kein ${config.provider_type.toUpperCase()} API Key konfiguriert. Schritt wurde übersprungen]`;
        }

        logEntry.outputs = { text: llmResult };

        // Handle physical actions
        if (
          step.tool === "SendEmail" ||
          step.tool === "EmailClient" ||
          step.tool === "EmailDraft" ||
          step.tool === "executeSendSmtpEmail" ||
          step.tool === "send_smtp_email"
        ) {
          const draftBody = this.extractEmailBody(llmResult, instance.execution_log);
          const draftSubject = this.extractEmailSubject(llmResult, workflow.workflow_name);
          const draftAttachments = this.extractAttachments(llmResult);

          // Proactively scan for file attachments in step instruction and LLM result string
          const filenameRegex = /['"«»]?(?:([a-zA-Z0-9_\-\säöüÄÖÜß]+)\.(pdf|txt|docx|doc|zip|png|jpg|jpeg|csv|xlsx))['"«»]?/gi;
          const textToScan = (step.instruction || "") + " " + (llmResult || "");
          const matches = textToScan.match(filenameRegex);
          if (matches) {
            for (const match of matches) {
              const cleanFilename = match.replace(/^['"«»\s]+|['"«»\s]+$/g, "").trim();
              if (cleanFilename && !cleanFilename.includes("\n")) {
                const resolvedPath = resolveAttachmentPhysicalPath(tenantId, cleanFilename);
                if (resolvedPath) {
                  const resolvedFilename = path.basename(resolvedPath).replace(/^\d+_/g, "").toLowerCase();
                  const normClean = cleanFilename.toLowerCase();
                  // Check that the resolved filename matches the clean match or is contained in it
                  // to prevent matching sentences like "Hänge die Datei hallo_new.txt"
                  if (resolvedFilename === normClean || resolvedFilename.includes(normClean)) {
                    if (!draftAttachments.some(att => att.filename.toLowerCase() === cleanFilename.toLowerCase() || att.filename.toLowerCase() === resolvedFilename)) {
                      draftAttachments.push({
                        filename: cleanFilename,
                        source: "knowledge"
                      });
                    }
                  }
                }
              }
            }
          }

          // Attempt to load SMTP Config to check if it exists in production
          let smtpExists = false;
          try {
            if (isUsingFallback) {
              smtpExists = !!fallbackStore.smtpSettings;
            } else {
              const res = await pool.query(
                "SELECT id_uuid FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1",
                [tenantId]
              );
              smtpExists = res.rows.length > 0;
            }
          } catch (e) {
            console.error("[WorkflowExecutor] Fehler bei der Überprüfung der SMTP-Einstellungen:", e);
          }

          const isProduction = process.env.NODE_ENV === "production";
          const shouldSendDirectly = workflow.direct_send_email === true && (!isProduction || smtpExists);

          if (shouldSendDirectly) {
            try {
              await this.handleMailingAktion(
                tenantId,
                initialPayload as Record<string, unknown>,
                draftBody || llmResult || step.instruction,
                logEntry as Record<string, unknown>,
                draftSubject,
                draftAttachments,
                instance.id_uuid,
                llmResult
              );

              // Protokolliere Erfolg
              logEntry.mailing_status = "Erfolgreich direkt versendet via SMTP.";

            } catch (mailErr: unknown) {
              const errorMsg = mailErr instanceof Error ? mailErr.message : String(mailErr);
              console.error(`[WorkflowExecutor] Kritischer Fehler bei E-Mail-Versand (Instanz: ${instance.id_uuid}):`, mailErr);

              logEntry.mailing_error = errorMsg;
              logEntry.mailing_status = "Kritischer Abbruch: E-Mail konnte nicht zugestellt werden.";
              instance.execution_log.push(logEntry);

              // SYSTEMSICHERUNG: Abbruch forcieren!
              instance.status = "FAILED";
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "ERROR",
                details: `Automatischer Versand abgebrochen: E-Mail-Versand fehlgeschlagen (SMTP-Fehler: ${errorMsg}).`
              });

              await this.saveInstance(instance);

              // Werfe Fehler, um auch die übergeordnete execute-Schleife zu beenden
              throw new Error(`Physikalisches Senden der Mail gescheitert: ${errorMsg}`);
            }
          } else {
            // Pause & Draft!
            const draftId = uuidv4();
            const payloadObj = (initialPayload && typeof initialPayload === "object") ? initialPayload as Record<string, unknown> : {};
            const data = (payloadObj.data && typeof payloadObj.data === "object") ? payloadObj.data as Record<string, unknown> : payloadObj;
            let emailTo = typeof data.email_address === "string" ? data.email_address : (typeof data.email === "string" ? data.email : "");
            if (!emailTo) {
              emailTo = this.extractEmailRecipient(llmResult);
            }

            if (isUsingFallback) {
              if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
              fallbackStore.mailDrafts.push({
                id_uuid: draftId,
                tenant_id: tenantId,
                workflow_instance_id: instance.id_uuid,
                recipient: emailTo || "no-recipient@crm.local",
                subject: draftSubject,
                body: draftBody || llmResult || step.instruction,
                attachments_json: draftAttachments,
                status: 'PENDING',
                created_at_utc: new Date().toISOString(),
                updated_at_utc: new Date().toISOString()
              });
              saveFallbackStore();
            } else {
              try {
                await pool.query(`
                  INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, workflow_instance_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [
                  draftId,
                  tenantId,
                  instance.id_uuid,
                  emailTo || "no-recipient@crm.local",
                  draftSubject,
                  draftBody || llmResult || step.instruction,
                  JSON.stringify(draftAttachments),
                  'PENDING'
                ]);
              } catch (draftErr: unknown) {
                console.error("Failed to insert draft into Postgres database:", draftErr);
              }
            }

            logEntry.outputs = { text: llmResult };
            if (workflow.direct_send_email === true && isProduction && !smtpExists) {
              logEntry.mailing_status = `Direktversand übersprungen: SMTP-Konfiguration fehlt in Produktion. Entwurf erhoben. ID: ${draftId}. Freigabe ausstehend.`;
            } else {
              logEntry.mailing_status = `Entwurf erhoben. ID: ${draftId}. Freigabe ausstehend.`;
            }
            instance.execution_log.push(logEntry);

            instance.status = "WAITING_FOR_DRAFT_APPROVAL";
            if (workflow.direct_send_email === true && isProduction && !smtpExists) {
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "PAUSE",
                details: `Workflow wurde pausiert bei Schritt ${i + 1}. E-Mail-Entwurf (${draftId}) erfordert Freigabe, da kein SMTP in Produktion konfiguriert ist.`
              });
            } else {
              instance.execution_log.push({
                timestamp: new Date().toISOString(),
                step: "PAUSE",
                details: `Workflow wurde pausiert bei Schritt ${i + 1}. E-Mail-Entwurf (${draftId}) erfordert Freigabe.`
              });
            }
            await this.saveInstance(instance);
            console.log(`[WorkflowExecutor] ⏸️ Pausing workflow for draft approval. Instance: ${instance.id_uuid}, Draft: ${draftId}`);
            return; // EXIT execution method immediately!
          }
        } else if (step.tool === "AddLabel" || step.tool === "UpdateContactLabels") {
          try {
            await this.handleLabelingAktion(tenantId, initialPayload, llmResult || step.instruction, logEntry);
          } catch (lblErr: unknown) {
            logEntry.label_error = lblErr instanceof Error ? lblErr.message : String(lblErr);
          }
        } else if (step.tool === "CreateEntityNote" || step.tool === "AddNote") {
          try {
            await this.handleNotingAktion(tenantId, initialPayload, llmResult || step.instruction, logEntry);
          } catch (noteErr: unknown) {
            logEntry.note_error = noteErr instanceof Error ? noteErr.message : String(noteErr);
          }
        }

        instance.execution_log.push(logEntry);
        await this.saveInstance(instance);
      }

      instance.status = "COMPLETED";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "TERM",
        details: "Workflow erfolgreich abgeschlossen."
      });
      await this.saveInstance(instance);
      console.log(`[WorkflowExecutor] ✅ Workflow completed: ${instanceId}`);

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[WorkflowExecutor] ❌ Critical failure during execution of instance ${instanceId}:`, err);
      instance.status = "FAILED";
      instance.execution_log.push({
        timestamp: new Date().toISOString(),
        step: "ERROR",
        details: `Kritischer Abbruch: ${errMsg}`
      });
      await this.saveInstance(instance);
    }
  }

  /**
   * Safe parser to extract and clean nested/surrounded Markdown JSON output from LLM results.
   */
  private parseLlmResultSafe(llmResult: string): LlmResultStructure | null {
    if (!llmResult) return null;
    let cleaned = llmResult.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\s*/g, "").replace(/\s*```$/g, "").trim();
    }
    try {
      return JSON.parse(cleaned) as LlmResultStructure;
    } catch (e) {
      const startIdx = cleaned.indexOf("{");
      const endIdx = cleaned.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        try {
          return JSON.parse(cleaned.substring(startIdx, endIdx + 1)) as LlmResultStructure;
        } catch (_) {}
      }
    }
    return null;
  }

  /**
   * Sends a real/simulated email based on SMTP environment nodes.
   */
  private async handleMailingAktion(
    tenantId: string,
    payload: Record<string, unknown> | null | undefined,
    bodyContent: string,
    logEntry: Record<string, unknown>,
    subject?: string,
    attachments?: unknown[],
    workflowInstanceId?: string,
    llmResult?: string
  ) {
    const payloadObj = (payload && typeof payload === "object") ? payload : {};
    const data = (payloadObj.data && typeof payloadObj.data === "object") ? payloadObj.data as Record<string, unknown> : payloadObj;
    let emailTo = typeof data.email_address === "string" ? data.email_address : (typeof data.email === "string" ? data.email : "");
    if (!emailTo && llmResult) {
      emailTo = this.extractEmailRecipient(llmResult);
    }

    if (!emailTo) {
      logEntry.mailing_status = "Skipped: Keine Empfänger-E-Mail-Adresse im Payload gefunden.";
      return;
    }

    // Attempt to load SMTP Config
    let smtp: SmtpSettings | null = null;
    if (isUsingFallback) {
      smtp = fallbackStore.smtpSettings;
    } else {
      const res = await pool.query(
        "SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
        [tenantId]
      );
      smtp = res.rows[0];
    }

    if (!smtp) {
      logEntry.mailing_status = `Simuliert: Mail an ${emailTo} gedraftet, da kein SMTP konfiguriert ist. Inhalt: ${bodyContent.substring(0, 100)}`;
      try {
        await ingestEmailToRag({
          tenantId,
          recipient: emailTo,
          senderType: "AI",
          subject: subject || `Automatisierte Benachrichtigung (Louis Smart CRM Workflow)`,
          body: bodyContent,
          attachments: attachments,
          workflowInstanceId
        });
      } catch (ragErr) {
        console.error("[WorkflowExecutor] Failed to ingest simulated mail to RAG:", ragErr);
      }
      return;
    }

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

    const isHtml = /<[a-z|/][\s\S]*>/i.test(bodyContent);
    const htmlContent = isHtml 
      ? bodyContent 
      : bodyContent.split("\n").map(line => line.trim() ? `<p style="margin: 0 0 1em 0;">${line}</p>` : "<br />").join("");

    const mailOptions = {
      from: smtp.sender_display_name 
        ? `"${smtp.sender_display_name}" <${smtp.sender_email_address || smtp.smtp_user_name}>` 
        : smtp.smtp_user_name,
      to: emailTo,
      subject: subject || `Automatisierte Benachrichtigung (Louis Smart CRM Workflow)`,
      text: bodyContent.replace(/<[^>]*>/g, ""),
      html: htmlContent,
      attachments: Array.isArray(attachments) ? attachments.map((att: unknown) => {
        if (typeof att === "string") {
          const resolvedPath = resolveAttachmentPhysicalPath(tenantId, att);
          return { 
            filename: resolvedPath ? path.basename(resolvedPath).replace(/^\d+_/g, "") : att, 
            path: resolvedPath || att 
          };
        } else if (att && typeof att === "object") {
          const attObj = att as Record<string, unknown>;
          const filename = typeof attObj.filename === "string" ? attObj.filename : "Anhang";
          const source = typeof attObj.source === "string" ? attObj.source : undefined;
          const entityId = typeof attObj.entity_id === "string" ? attObj.entity_id : undefined;
          const entityType = typeof attObj.entity_type === "string" ? attObj.entity_type : undefined;

          const resolvedPath = resolveAttachmentPhysicalPath(
            tenantId,
            filename,
            source,
            entityId,
            entityType
          );

          return {
            filename: filename,
            path: resolvedPath || (typeof attObj.path === "string" ? attObj.path : undefined),
            content: typeof attObj.content === "string" ? attObj.content : undefined
          };
        }
        return {};
      }).filter((item: { path?: string; content?: string }) => item.path || item.content) : undefined
    };

    await transporter.sendMail(mailOptions);
    try {
      await ingestEmailToRag({
        tenantId,
        recipient: emailTo,
        senderType: "AI",
        subject: mailOptions.subject,
        body: bodyContent,
        attachments: mailOptions.attachments,
        workflowInstanceId
      });
    } catch (ragErr) {
      console.error("[WorkflowExecutor] Failed to ingest sent mail to RAG:", ragErr);
    }
    logEntry.mailing_status = `Erfolgreich gesendet: Mail an ${emailTo} via SMTP Server.`;
  }

  /**
   * Helper to parse and extract email body safely from the step's outcome or preceding log entries.
   */
  private extractEmailBody(llmResult: string, executionLog: WorkflowExecutionLogEntry[]): string {
    const cleanOutput = (text: string): string => text.trim();

    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.body === "string") {
            return cleanOutput(details.body);
          }
          if (typeof details.text === "string") {
            return cleanOutput(details.text);
          }
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object" && typeof detailsOut.body === "string") {
            return cleanOutput(detailsOut.body);
          }
          if (typeof outputs.body === "string") {
            return cleanOutput(outputs.body);
          }
          if (typeof outputs.text === "string") {
            return cleanOutput(outputs.text);
          }
        }
        
        const output = target.output as Record<string, unknown> | undefined;
        if (output && typeof output === "object" && typeof output.generated_text === "string") {
          return cleanOutput(output.generated_text);
        }
        if (typeof target.generated_text === "string") {
          return cleanOutput(target.generated_text);
        }
        
        if (typeof target.email_body_content === "string") {
          return cleanOutput(target.email_body_content);
        }
        if (typeof target.body === "string") {
          return cleanOutput(target.body);
        }
        if (typeof target.text === "string") {
          return cleanOutput(target.text);
        }
      }
    } catch (e) {
      // Not JSON, that's fine
    }

    // Look backward in execution log for previous step outputs (e.g. general text generator output or prompt result)
    for (let i = executionLog.length - 1; i >= 0; i--) {
      const entry = executionLog[i];
      if (entry.outputs && typeof entry.outputs === "object") {
        const textVal = entry.outputs.text;
        if (typeof textVal === "string" && textVal.trim().length > 0) {
          const trimmed = textVal.trim();
          try {
            const parsedPrev = this.parseLlmResultSafe(trimmed);
            if (parsedPrev && typeof parsedPrev === "object") {
              const output = parsedPrev.output as Record<string, unknown> | undefined;
              if (output && typeof output === "object" && typeof output.generated_text === "string") {
                return cleanOutput(output.generated_text);
              }
              if (typeof parsedPrev.generated_text === "string") {
                return cleanOutput(parsedPrev.generated_text);
              }
              if (typeof parsedPrev.body === "string") {
                return cleanOutput(parsedPrev.body);
              }
              if (typeof parsedPrev.text === "string") {
                return cleanOutput(parsedPrev.text);
              }
            }
          } catch (_) {}
          
          if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            return trimmed;
          }
        }
      }
    }

    if (llmResult && !llmResult.trim().startsWith("{")) {
      return llmResult.trim();
    }

    return "";
  }

  /**
   * Helper to parse and extract email subject from LLM response.
   */
  private extractEmailSubject(llmResult: string, workflowName: string): string {
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.subject === "string") {
            return details.subject;
          }
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object" && typeof detailsOut.subject === "string") {
            return detailsOut.subject;
          }
          if (typeof outputs.subject === "string") {
            return outputs.subject;
          }
        }
        if (typeof target.email_subject_text === "string") {
          return target.email_subject_text;
        }
        if (typeof target.subject === "string") {
          return target.subject;
        }
      }
    } catch (e) {}
    return `Automatische Benachrichtigung (${workflowName})`;
  }

  /**
   * Helper to parse and extract email recipient from LLM response.
   */
  private extractEmailRecipient(llmResult: string): string {
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        if (details && typeof details === "object") {
          if (typeof details.recipient === "string") return details.recipient.trim();
          if (typeof details.recipient_email_address === "string") return details.recipient_email_address.trim();
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (outputs && typeof outputs === "object") {
          const detailsOut = outputs.details as Record<string, unknown> | undefined;
          if (detailsOut && typeof detailsOut === "object") {
            if (typeof detailsOut.recipient === "string") return detailsOut.recipient.trim();
            if (typeof detailsOut.recipient_email_address === "string") return detailsOut.recipient_email_address.trim();
          }
          if (typeof outputs.recipient === "string") return outputs.recipient.trim();
          if (typeof outputs.recipient_email_address === "string") return outputs.recipient_email_address.trim();
        }

        if (typeof target.recipient === "string") return target.recipient.trim();
        if (typeof target.recipient_email_address === "string") return target.recipient_email_address.trim();
      }
    } catch (e) {}
    return "";
  }

  /**
   * Helper to parse and extract email attachments list from LLM response.
   */
  private extractAttachments(llmResult: string): MailDraftAttachment[] {
    const list: MailDraftAttachment[] = [];
    try {
      const parsed = this.parseLlmResultSafe(llmResult);
      if (parsed && typeof parsed === "object") {
        let target: Record<string, unknown> = parsed as Record<string, unknown>;
        if (parsed.workflow_step_result && typeof parsed.workflow_step_result === "object") {
          target = parsed.workflow_step_result as Record<string, unknown>;
        }
        if (target.generated_content && typeof target.generated_content === "object") {
          target = target.generated_content as Record<string, unknown>;
        }

        const details = target.details as Record<string, unknown> | undefined;
        let atts: unknown = undefined;
        if (details && typeof details === "object" && Array.isArray(details.attachments)) {
          atts = details.attachments;
        }

        const outputs = target.outputs as Record<string, unknown> | undefined;
        if (!atts) {
          if (outputs && typeof outputs === "object") {
            const detailsOut = outputs.details as Record<string, unknown> | undefined;
            if (detailsOut && typeof detailsOut === "object" && Array.isArray(detailsOut.attachments)) {
              atts = detailsOut.attachments;
            } else if (Array.isArray(outputs.attachments)) {
              atts = outputs.attachments;
            }
          } else if (Array.isArray(target.attachments)) {
            atts = target.attachments;
          }
        }

        if (Array.isArray(atts)) {
          for (const item of atts) {
            if (item && typeof item === "object") {
              const itemObj = item as Record<string, unknown>;
              const sourceVal = (itemObj.source === "knowledge" || itemObj.source === "vault") ? itemObj.source : "knowledge";
              
              if (typeof itemObj.filename === "string") {
                list.push({
                  filename: itemObj.filename,
                  source: sourceVal,
                  entity_id: typeof itemObj.entity_id === "string" ? itemObj.entity_id : undefined,
                  entity_type: (itemObj.entity_type === "companies" || itemObj.entity_type === "contacts") ? itemObj.entity_type : undefined,
                  filePath: typeof itemObj.filePath === "string" ? itemObj.filePath : undefined
                });
              }
            }
          }
        }
      }
    } catch (e) {}
    return list;
  }

  /**
   * Appends label to contact when workflow is run.
   */
  private async handleLabelingAktion(tenantId: string, payload: Record<string, unknown> | null | undefined, labelContent: string, logEntry: Record<string, unknown>) {
    const data = payload?.data as Record<string, unknown> | undefined || payload;
    const contactId = data?.id_uuid || data?.associated_contact_id || "";

    if (!contactId) {
      logEntry.label_status = "Skipped: Keine gültige Contact-UUID im Payload ermittelt.";
      return;
    }

    // Extract tags from LLM response or instructions
    const matchedLabel = labelContent.replace(/[^a-z0-9\s_-]/gi, "").trim().split(/\s+/)[0] || "PROCESSED";
    
    if (isUsingFallback) {
      const contact = fallbackStore.contacts.find(c => c.id_uuid === contactId);
      if (contact) {
        if (!contact.labels) contact.labels = [];
        if (!contact.labels.includes(matchedLabel)) {
          contact.labels.push(matchedLabel);
          saveFallbackStore();
        }
        logEntry.label_status = `Label "${matchedLabel}" an Kontakt ${contact.full_legal_name} angeheftet.`;
      } else {
        logEntry.label_status = `Kontakt mit UUID "${contactId}" im FallbackStore nicht gefunden.`;
      }
    } else {
      const selectRes = await pool.query("SELECT labels_json, full_legal_name FROM core_registry_contacts WHERE id_uuid = $1", [contactId]);
      if (selectRes.rows.length > 0) {
        let currentLabels: string[] = [];
        try {
          const raw = selectRes.rows[0].labels_json;
          currentLabels = typeof raw === "string" ? JSON.parse(raw) : (raw || []);
        } catch (_) {}

        if (!currentLabels.includes(matchedLabel)) {
          currentLabels.push(matchedLabel);
          await pool.query(
            "UPDATE core_registry_contacts SET labels_json = $1 WHERE id_uuid = $2",
            [JSON.stringify(currentLabels), contactId]
          );
        }
        logEntry.label_status = `Label "${matchedLabel}" an Kontakt "${selectRes.rows[0].full_legal_name}" angeheftet (Postgres).`;
      } else {
        logEntry.label_status = `Kontakt mit UUID "${contactId}" in Postgres nicht gefunden.`;
      }
    }
  }

  /**
   * Appends note to target contact.
   */
  private async handleNotingAktion(tenantId: string, payload: Record<string, unknown> | null | undefined, noteContent: string, logEntry: Record<string, unknown>) {
    const data = payload?.data as Record<string, unknown> | undefined || payload;
    const contactId = (data?.id_uuid as string) || "";
    if (!contactId) {
      logEntry.note_status = "Skipped: Kontakt-UUID fehlt im Payload.";
      return;
    }
    
    // Check if noting is supported inside the CRM. We can log our note directly in the AuditLogs
    await logAuditEvent({
      tenantId,
      eventType: "UPDATE",
      entityType: "CONTACT",
      entityId: contactId,
      eventDetails: `Automatisierte Workflow-Notiz hinzugefügt: "${noteContent.substring(0, 200)}"`,
      actorIdentity: "assistant_workflow"
    });
    logEntry.note_status = `Notiz im AuditLog für Kontakt ${contactId} vermerkt.`;
  }

  /**
   * Helper parser to convert human-readable wait durations to seconds.
   */
  private parseWaitDurationToSeconds(instruction: string): number {
    if (!instruction) return 300;
    const normalized = instruction.toLowerCase().trim();

    // 1. Check hours
    const hourMatch = normalized.match(/(\d+)\s*(?:stund|hour|std|h\b)/i);
    if (hourMatch) {
      return parseInt(hourMatch[1], 10) * 3600;
    }

    // 2. Check minutes
    const minMatch = normalized.match(/(\d+)\s*(?:min|m\b)/i);
    if (minMatch) {
      return parseInt(minMatch[1], 10) * 60;
    }

    // 3. Check seconds
    const secMatch = normalized.match(/(\d+)\s*(?:sek|sec|s\b)/i);
    if (secMatch) {
      return parseInt(secMatch[1], 10);
    }

    // 4. Fallback search for any number
    const fallbackMatch = normalized.match(/(\d+)/);
    if (fallbackMatch) {
      const num = parseInt(fallbackMatch[1], 10);
      if (normalized.includes("min")) {
        return num * 60;
      }
      if (normalized.includes("stund") || normalized.includes("hour") || normalized.includes("std")) {
        return num * 3600;
      }
      return num;
    }

    return 300; // default fallback (5 minutes)
  }
}

export const workflowExecutor = new WorkflowExecutor();
