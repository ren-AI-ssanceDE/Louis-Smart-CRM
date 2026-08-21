import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { generateContentUniversal } from "../geminiHelper.js";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore } from "../../db.js";
import { getEntityStoragePath } from "../../storage.js";
import { Contact, Company, SmtpSettings, LouisAiConfig, MailDraft } from "../../../types.js";
import { ToolResult, createToolSuccess, createToolError } from "./types.js";

interface Attachment {
  filename: string;
  source: 'knowledge' | 'vault';
  entity_id?: string;
  entity_type?: 'companies' | 'contacts';
}

/**
 * Recursively search for a filename across all known storage buckets/vaults.
 * Used as a robust fallback to guarantee draft attachments can be resolved even if the source is misaligned.
 */
export function searchFileAcrossAllVaults(filename: string, tenantId: string): { path: string; source: 'knowledge' | 'vault'; entityId?: string; entityType?: 'companies' | 'contacts' } | null {
  const cleanFilename = filename.toLowerCase().trim();
  if (!cleanFilename) return null;

  // Helper to find match in a list of files (exact or case-insensitive or partial)
  const findMatchInList = (files: string[], target: string): string | undefined => {
    // 1. Exact match
    let found = files.find(f => f.toLowerCase() === target);
    if (found) return found;
    // 2. Exact match excluding timestamps (e.g. 1717354923000_my_document.pdf vs my_document.pdf)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF === target;
    });
    if (found) return found;
    // 3. Contains match (target is in folder filename)
    found = files.find(f => {
      const cleanF = f.replace(/^\d+_/g, '').toLowerCase();
      return cleanF.includes(target) || target.includes(cleanF);
    });
    if (found) return found;
    // 4. Raw includes
    return files.find(f => f.toLowerCase().includes(target));
  };

  // 1. Check knowledge_data_vault for tenant
  const kDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
  if (fs.existsSync(kDir)) {
    const files = fs.readdirSync(kDir);
    const matched = findMatchInList(files, cleanFilename);
    if (matched) {
      return { path: path.join(kDir, matched), source: 'knowledge' };
    }
  }

  // 2. Check knowledge_data_vault for fallback tenant "1"
  if (tenantId !== "1") {
    const kDirFallback = path.resolve(process.cwd(), "knowledge_data_vault", "1");
    if (fs.existsSync(kDirFallback)) {
      const files = fs.readdirSync(kDirFallback);
      const matched = findMatchInList(files, cleanFilename);
      if (matched) {
        return { path: path.join(kDirFallback, matched), source: 'knowledge' };
      }
    }
  }

  // Helper to search in vault directory
  const searchInVaultDir = (vaultRoot: string, type: 'companies' | 'contacts'): { path: string; source: 'vault'; entityId: string; entityType: 'companies' | 'contacts' } | null => {
    if (!fs.existsSync(vaultRoot)) return null;
    const entityDirs = fs.readdirSync(vaultRoot);
    for (const dir of entityDirs) {
      const dirPath = path.join(vaultRoot, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
         const files = fs.readdirSync(dirPath);
         const matched = findMatchInList(files, cleanFilename);
         if (matched) {
           const entityId = dir.split("__")[0];
           return {
             path: path.join(dirPath, matched),
             source: 'vault',
             entityId,
             entityType: type
           };
         }
      }
    }
    return null;
  };

  // 3. Check companies_data_vault for tenant
  const comVault = path.resolve(process.cwd(), "companies_data_vault", tenantId);
  const matchedCom = searchInVaultDir(comVault, 'companies');
  if (matchedCom) return matchedCom;

  // 4. Check contacts_data_vault for tenant
  const conVault = path.resolve(process.cwd(), "contacts_data_vault", tenantId);
  const matchedCon = searchInVaultDir(conVault, 'contacts');
  if (matchedCon) return matchedCon;

  // 5. Check companies_data_vault for tenant "1" fallback
  if (tenantId !== "1") {
    const comVaultFb = path.resolve(process.cwd(), "companies_data_vault", "1");
    const matchedComFb = searchInVaultDir(comVaultFb, 'companies');
    if (matchedComFb) return matchedComFb;

    const conVaultFb = path.resolve(process.cwd(), "contacts_data_vault", "1");
    const matchedConFb = searchInVaultDir(conVaultFb, 'contacts');
    if (matchedConFb) return matchedConFb;
  }

  // 6. Direct check in parent vaults directories if files are misplaced/uploaded directly there
  const parentComRoot = path.resolve(process.cwd(), "companies_data_vault");
  if (fs.existsSync(parentComRoot)) {
    const files = fs.readdirSync(parentComRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentComRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  const parentConRoot = path.resolve(process.cwd(), "contacts_data_vault");
  if (fs.existsSync(parentConRoot)) {
    const files = fs.readdirSync(parentConRoot);
    const matched = findMatchInList(files, cleanFilename);
    const potentialPath = path.join(parentConRoot, matched || '');
    if (matched && fs.existsSync(potentialPath) && fs.statSync(potentialPath).isFile()) {
      return { path: potentialPath, source: 'knowledge' };
    }
  }

  return null;
}

/**
 * Resolves the actual physical file path on disk for an attachment.
 */
export function resolveAttachmentPhysicalPath(
  tenantId: string,
  filename: string,
  source?: 'knowledge' | 'vault' | string,
  entityId?: string,
  entityType?: 'companies' | 'contacts' | string
): string | null {
  const cleanFilename = filename.trim();
  if (!cleanFilename) return null;

  // 1. If we have entityId and entityType, try searching in its vault directory first
  if (entityId && entityType) {
    const vaultFolder = entityType === "companies" ? "companies_data_vault" : "contacts_data_vault";
    const tenantVaultRoot = path.resolve(process.cwd(), vaultFolder, tenantId);
    if (fs.existsSync(tenantVaultRoot)) {
      try {
        const dirs = fs.readdirSync(tenantVaultRoot);
        const matchedDir = dirs.find(d => d.startsWith(entityId + "__"));
        if (matchedDir) {
          const fullDirPath = path.join(tenantVaultRoot, matchedDir);
          const files = fs.readdirSync(fullDirPath);
          const matchedFile = files.find(f => f.toLowerCase() === cleanFilename.toLowerCase() || 
                                              f.replace(/^\d+_/g, '').toLowerCase() === cleanFilename.toLowerCase() ||
                                              f.toLowerCase().includes(cleanFilename.toLowerCase()));
          if (matchedFile) {
            const absolutePath = path.join(fullDirPath, matchedFile);
            if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
              return absolutePath;
            }
          }
        }
      } catch (err) {
        console.warn(`[resolveAttachmentPhysicalPath] Failed listing vault dirs:`, err);
      }
    }
  }

  // 2. Try searching in knowledge_data_vault
  const kDir = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);
  if (fs.existsSync(kDir)) {
    try {
      const files = fs.readdirSync(kDir);
      const matchedFile = files.find(f => f.toLowerCase() === cleanFilename.toLowerCase() || 
                                          f.replace(/^\d+_/g, '').toLowerCase() === cleanFilename.toLowerCase() ||
                                          f.toLowerCase().includes(cleanFilename.toLowerCase()));
      if (matchedFile) {
        const absolutePath = path.join(kDir, matchedFile);
        if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
          return absolutePath;
        }
      }
    } catch (err) {
      console.warn(`[resolveAttachmentPhysicalPath] Failed listing knowledge files:`, err);
    }
  }

  // 3. Fallback to global search across all vaults
  const searchRes = searchFileAcrossAllVaults(cleanFilename, tenantId);
  if (searchRes && fs.existsSync(searchRes.path)) {
    return searchRes.path;
  }

  // 4. Fallback: Check if file exists directly if it is already an absolute path
  if (path.isAbsolute(cleanFilename) && fs.existsSync(cleanFilename) && fs.statSync(cleanFilename).isFile()) {
    return cleanFilename;
  }

  return null;
}

/**
 * Resolves filenames for Knowledge Base and Contact/Company Vaults dynamically on disk.
 * Uses exact match first, then falls back to case-insensitive partial/substring match.
 */
async function resolveAttachments(tenantId: string, recipient: string, attachmentsIn: unknown[]): Promise<Attachment[]> {
  const resolved: Attachment[] = [];
  if (!Array.isArray(attachmentsIn) || attachmentsIn.length === 0) {
    return resolved;
  }

  // Find associated contact and company for vault lookups
  let contact: Contact | null = null;
  let company: Company | null = null;

  // Clean the recipient email address to handle name brackets like: "Max Mustermann <max@mustermann.de>" or trailing spaces
  const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();

  if (isUsingFallback) {
    contact = fallbackStore.contacts?.find((c: Contact) => 
      c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
    ) || null;
    if (contact && contact.associated_company_id) {
      company = fallbackStore.companies?.find((co: Company) => 
        co.id_uuid === contact.associated_company_id && co.tenant_id === tenantId
      ) || null;
    }
  } else {
    try {
      const contactRes = await pool.query(
        `SELECT c.*, co.full_legal_name as co_name FROM core_registry_contacts c
         LEFT JOIN core_registry_companies co ON c.associated_company_id = co.id_uuid
         WHERE LOWER(c.email_address) = LOWER($1) AND (c.tenant_id = $2 OR c.tenant_id = '1') LIMIT 1`,
        [cleanRecipient, tenantId]
      );
      if (contactRes.rows.length > 0) {
        const row = contactRes.rows[0];
        contact = {
          id_uuid: row.id_uuid,
          full_legal_name: row.full_legal_name || `${row.first_name || ''} ${row.last_name || ''}`.trim(),
          associated_company_id: row.associated_company_id
        } as Contact;
        if (row.associated_company_id) {
          company = {
            id_uuid: row.associated_company_id,
            full_legal_name: row.co_name || "Unbekannt"
          } as Company;
        }
      }
    } catch (err) {
      console.warn("[ResolveAttachments] Failed query to resolve contact/company:", err);
    }
  }

  const KNOWLEDGE_ROOT = path.resolve(process.cwd(), "knowledge_data_vault", tenantId);

  for (const att of attachmentsIn) {
    let origFilename = "";
    let source: 'knowledge' | 'vault' = "knowledge";

    if (typeof att === 'string') {
      origFilename = att.trim();
      source = "knowledge"; 
    } else if (att && typeof att === 'object') {
      const typedAtt = att as { filename?: string; name?: string; source?: string };
      origFilename = String(typedAtt.filename || typedAtt.name || "").trim();
      source = String(typedAtt.source || "knowledge").toLowerCase() as 'knowledge' | 'vault';
    }

    if (!origFilename) continue;

    let foundFilename = "";
    let entityId: string | undefined;
    let entityType: 'companies' | 'contacts' | undefined;

    // 1. Try to find on Knowledge Base if source is knowledge or dynamic string
    if (source === "knowledge" || typeof att === 'string') {
      if (fs.existsSync(KNOWLEDGE_ROOT)) {
        const files = fs.readdirSync(KNOWLEDGE_ROOT);
        let matched = files.find(f => f.toLowerCase() === origFilename.toLowerCase());
        if (!matched) {
          matched = files.find(f => f.toLowerCase().includes(origFilename.toLowerCase()));
        }
        if (matched) {
          foundFilename = matched;
          source = "knowledge";
        }
      }
    }

    // 2. Try to find in Vaults if source is vault, or if not found yet in knowledge
    if (!foundFilename && (source === "vault" || typeof att === 'string')) {
      if (contact) {
        const contactPath = getEntityStoragePath("contacts", contact.id_uuid, contact.full_legal_name, tenantId);
        if (fs.existsSync(contactPath)) {
          const files = fs.readdirSync(contactPath);
          let matched = files.find(f => f.toLowerCase() === origFilename.toLowerCase());
          if (!matched) {
            matched = files.find(f => f.toLowerCase().includes(origFilename.toLowerCase()));
          }
          if (matched) {
            foundFilename = matched;
            source = "vault";
            entityId = contact.id_uuid;
            entityType = "contacts";
          }
        }
      }
      
      if (!foundFilename && company) {
        const companyPath = getEntityStoragePath("companies", company.id_uuid, company.full_legal_name, tenantId);
        if (fs.existsSync(companyPath)) {
          const files = fs.readdirSync(companyPath);
          let matched = files.find(f => f.toLowerCase() === origFilename.toLowerCase());
          if (!matched) {
            matched = files.find(f => f.toLowerCase().includes(origFilename.toLowerCase()));
          }
          if (matched) {
            foundFilename = matched;
            source = "vault";
            entityId = company.id_uuid;
            entityType = "companies";
          }
        }
      }
    }

    if (!foundFilename) {
      const searchRes = searchFileAcrossAllVaults(origFilename, tenantId);
      if (searchRes) {
        foundFilename = path.basename(searchRes.path);
        source = searchRes.source;
        entityId = searchRes.entityId;
        entityType = searchRes.entityType;
      }
    }

    if (!foundFilename) {
      foundFilename = origFilename;
    }

    resolved.push({
      filename: foundFilename,
      source: source,
      entity_id: entityId,
      entity_type: entityType
    });
  }

  return resolved;
}

/**
 * Tool 12: Send SMTP Email Tool
 * Prepares an email draft with recipient, subject, body, optional invoice attachment, and other files.
 * Under GoBD human-in-the-loop restrictions, it does NOT send immediately but returns instructions to formulate a proposedChange.
 */
export async function executeSendSmtpEmail(tenantId: string, argsStr: string, actor: string = "system", aiClient?: GoogleGenAI): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch (parseErr) {
      // Natural language/unstructured input fallback - Try deterministic parsing first (completely model-free)
      console.log("[SMTP Helper] Input is not valid JSON. Attempting deterministic regex parsing first...");
      
      let parsedRecipient = "";
      let parsedInvoiceId = "";
      let parsedSubject = "";
      let parsedBody = "";
      let parsedAttachments: unknown[] = [];

      // 1. Extract Email Address with regex
      const emailRegex = /([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10})/;
      const emailMatch = argsStr.match(emailRegex);
      if (emailMatch) {
         parsedRecipient = emailMatch[1].trim();
      }

      // 2. Extract Invoice UUID
      const uuidRegex = /([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;
      const uuidMatch = argsStr.match(uuidRegex);
      if (uuidMatch) {
         parsedInvoiceId = uuidMatch[1].trim();
      } else {
         // Search for custom invoice numbers like RE-2026-0001 or 2026-0001
         const invNumRegex = /\b(RE-\d{4}-\d+|\d{4}-\d+|RE-[A-Z0-9-]+)\b/i;
         const invNumMatch = argsStr.match(invNumRegex);
         if (invNumMatch) {
            const potentialNum = invNumMatch[1].trim();
            try {
              if (isUsingFallback) {
                const foundInv = fallbackStore.invoices.find(i => 
                  i.invoice_number.toLowerCase() === potentialNum.toLowerCase()
                );
                if (foundInv) {
                  parsedInvoiceId = foundInv.id_uuid || "";
                }
              } else {
                const res = await pool.query(
                  "SELECT id_uuid FROM fiscal_billing_invoices WHERE LOWER(invoice_number) = LOWER($1) AND (tenant_id = $2 OR tenant_id = '1') LIMIT 1",
                  [potentialNum, tenantId]
                );
                if (res.rows.length > 0) {
                  parsedInvoiceId = res.rows[0].id_uuid;
                }
              }
            } catch (dbErr) {
              console.warn("[SMTP Helper] Pre-search for invoice number failed:", dbErr);
            }
          }
       }

       // 3. Subject extracting if explicitly specified
       const subjectRegex = /(?:Betreff|Subject|Subj):\s*([^\n]+)/i;
       const subjectMatch = argsStr.match(subjectRegex);
       if (subjectMatch) {
         parsedSubject = subjectMatch[1].trim();
       }

       // 4. Body extracting if explicitly specified
       const bodyRegex = /(?:Inhalt|Content|Body|Text):\s*([\s\S]+)/i;
       const bodyMatch = argsStr.match(bodyRegex);
       if (bodyMatch) {
         parsedBody = bodyMatch[1].trim();
       }

       // 5. Look for mentioned file names to attach (rough deterministic heuristic for safety)
       const words = argsStr.split(/\s+/);
       for (const w of words) {
         if (w.endsWith(".pdf") || w.endsWith(".docx") || w.endsWith(".xlsx") || w.endsWith(".txt") || w.endsWith(".png") || w.endsWith(".jpg") || w.endsWith(".xml")) {
           const cleanFile = w.replace(/["'(),;]/g, "");
           if (cleanFile) {
             // Default to knowledge, it will auto-resolve to vault if not in knowledge
             parsedAttachments.push({ filename: cleanFile, source: "knowledge" });
           }
         }
       }

       // Always construct deterministic arguments as primary or fallback
       const fallbackDeterministicArgs = {
         recipient_email_address: parsedRecipient,
         email_subject_text: parsedSubject || (parsedInvoiceId ? `Zahlungserinnerung zu Ihrer Rechnung` : `Mitteilung von Louis CRM`),
         email_body_content: parsedBody || argsStr,
         invoice_id: parsedInvoiceId || null,
         attachments: parsedAttachments
       };

       if (parsedRecipient || parsedInvoiceId || parsedSubject || argsStr.length > 0) {
         rawArgs = fallbackDeterministicArgs;
         console.log("[SMTP Helper] Deterministically extracted SMTP arguments from input text:", rawArgs);
       } else {
         console.log("[SMTP AI Helper] Deterministic pattern mismatch, using configured AI model to parse");
         try {
           let providerType: 'gemini' | 'ollama' | 'openai' | 'anthropic' = 'ollama';
           let modelToUse = "llama3";
           let apiKeySecret = "";
           let baseUrl = "";

           // Load provider configuration of Louis AI
           if (isUsingFallback) {
             const found = (fallbackStore.louisAiConfig || []).find((c: LouisAiConfig) => c.tenant_id === tenantId) || (fallbackStore.louisAiConfig || []).find((c: LouisAiConfig) => c.tenant_id === '1');
             if (found) {
               if (found.provider_type) providerType = found.provider_type;
               if (found.model_name) modelToUse = found.model_name;
               if (found.api_key_secret) apiKeySecret = found.api_key_secret.trim();
               if (found.base_url) baseUrl = found.base_url.trim();
             }
           } else {
             const res = await pool.query(
               "SELECT provider_type, model_name, api_key_secret, base_url FROM sys_integrations_louis_ai_config WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1",
               [tenantId]
             );
             if (res.rows.length > 0) {
               const row = res.rows[0];
               if (row.provider_type) providerType = row.provider_type;
               if (row.model_name) modelToUse = row.model_name;
               if (row.api_key_secret) apiKeySecret = row.api_key_secret.trim();
               if (row.base_url) baseUrl = row.base_url.trim();
             }
           }

           const extractSystemPrompt = `Du bist eine hochpräzise E-Mail-Extraktions-Schnittstelle. Deine Aufgabe ist es, aus einer unstrukturierten Anweisung oder einem Textentwurf für eine E-Mail die exakten JSON-Daten zu extrahieren.
Erzeuge ein JSON-Objekt mit folgender Struktur:
{
  "recipient_email_address": "...", // The email address of the recipient
  "email_subject_text": "...", // Meaningful subject
  "email_body_content": "...", // The content/body of the email (HTML format allowed or plain text)
  "invoice_id": "...", // Optional UUID of the associated invoice, if mentioned, otherwise null/omit
  "attachments": [
    {
      "filename": "...", // Exact name of the PDF, DOCX, XLSX, TXT etc., to be attached
      "source": "knowledge" | "vault"
    }
  ]
}
Antworte AUSSCHLIESSLICH im puren JSON-Format ohne Markdown-Blockierungen.`;

           const res = await generateContentUniversal({
             provider_type: providerType,
             model_name: modelToUse,
             api_key_secret: apiKeySecret,
             base_url: baseUrl,
             temperature: 0.1,
             contents: `Bitte extrahiere das E-Mail-JSON aus folgendem Text:\n\n${argsStr}`,
             systemInstruction: extractSystemPrompt,
             jsonFormat: true
           });

           const textOutput = (res.text || "").replace(/```json/g, "").replace(/```/g, "").trim();
           rawArgs = JSON.parse(textOutput);
         } catch (e: unknown) {
           console.warn("[SMTP AI Helper] LLM argument extraction failed, using deterministic fallback:", e);
           rawArgs = fallbackDeterministicArgs;
         }
       }
     }

    // Now validate the extracted/parsed arguments
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new Error("Fehler: Argumente konnten nicht zu einem Objekt aufgelöst werden.");
    }

    const { SendEmailArgsZodSchema } = await import("./types.js");
    const parseResult = SendEmailArgsZodSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map(err => `${err.path.join('.') || 'root'}: ${err.message}`).join(", ");
      throw new Error(`Ungültige Argumente für 'send_smtp_email'. Details: ${errorDetails}`);
    }

    const argsMap = parseResult.data;
    let recipient = String(argsMap.recipient_email_address || "").trim();
    const subject = String(argsMap.email_subject_text || "").trim();
    const body = String(argsMap.email_body_content || "").trim();
    const invoiceId = argsMap.invoice_id ? String(argsMap.invoice_id).trim() : undefined;
    const rawAttachments = Array.isArray(argsMap.attachments) ? argsMap.attachments : [];

    let isDataComplete = true;
    let missingDataReason = "";

    // Check if recipient is a valid email. If not or empty, resolve against Invoice/CRM
    if (!recipient || !recipient.includes("@")) {
      console.log(`[SMTP Helper] Recipient "${recipient}" is missing or not a valid email address. Resolving against Invoice / CRM registry...`);
      let resolvedEmail = "";

      // 1. If invoiceId is provided, lookup invoice & associated contact/company
      if (invoiceId) {
        if (isUsingFallback) {
          const inv = fallbackStore.invoices?.find((i) => i.id_uuid === invoiceId || i.invoice_number === invoiceId || i.invoice_number?.toLowerCase() === invoiceId.toLowerCase());
          if (inv) {
            const contact = fallbackStore.contacts?.find((c) => c.id_uuid === inv.associated_contact_id) ||
                            fallbackStore.contacts?.find((c) => c.associated_company_id === inv.associated_company_id && (c.email_address || c.email_2));
            const company = fallbackStore.companies?.find((co) => co.id_uuid === inv.associated_company_id);
            resolvedEmail = contact?.email_address || contact?.email_2 || company?.email_address || company?.email_2 || "";
          }
        } else {
          try {
            const invRes = await pool.query(
              `SELECT 
                 COALESCE(ct.email_address, ct.email_2, ct_fallback.email_address, ct_fallback.email_2, co.email_address, co.email_2, i.contact_email) AS target_email
               FROM fiscal_billing_invoices i
               LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
               LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
               LEFT JOIN LATERAL (
                 SELECT email_address, email_2 FROM core_registry_contacts
                 WHERE (associated_company_id = i.associated_company_id OR id_uuid = i.associated_contact_id)
                   AND (email_address IS NOT NULL AND email_address != '')
                 LIMIT 1
               ) ct_fallback ON i.associated_company_id IS NOT NULL OR i.associated_contact_id IS NOT NULL
               WHERE (i.tenant_id = $1 OR i.tenant_id = '1') AND (i.id_uuid = $2 OR LOWER(i.invoice_number) = LOWER($2))
               LIMIT 1`,
              [tenantId, invoiceId]
            );
            if (invRes.rows.length > 0 && invRes.rows[0].target_email) {
              resolvedEmail = invRes.rows[0].target_email;
            }
          } catch (invErr) {
            console.warn("[SMTP Helper] Error resolving recipient from invoice:", invErr);
          }
        }
      }

      // 2. If still empty, search contact/company by recipient text
      if (!resolvedEmail && recipient.length > 0) {
        if (isUsingFallback) {
          const contact = fallbackStore.contacts?.find((c: Contact) => 
            c.tenant_id === tenantId && (
              c.full_legal_name?.toLowerCase().includes(recipient.toLowerCase()) ||
              `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(recipient.toLowerCase())
            )
          );
          if (contact && (contact.email_address || contact.email_2)) {
            resolvedEmail = contact.email_address || contact.email_2 || "";
          } else {
            const company = fallbackStore.companies?.find((co: Company) => 
              co.tenant_id === tenantId && co.full_legal_name?.toLowerCase().includes(recipient.toLowerCase())
            );
            if (company && (company.email_address || company.email_2)) {
              resolvedEmail = company.email_address || company.email_2 || "";
            }
          }
        } else {
          try {
            const contactRes = await pool.query(
              `SELECT COALESCE(ct.email_address, ct.email_2, co.email_address, co.email_2) AS target_email
               FROM core_registry_contacts ct
               LEFT JOIN core_registry_companies co ON ct.associated_company_id = co.id_uuid
               WHERE (ct.tenant_id = $1 OR ct.tenant_id = '1') AND (
                 LOWER(ct.full_legal_name) LIKE LOWER($2) OR 
                 LOWER(ct.first_name || ' ' || ct.last_name) LIKE LOWER($2)
               ) AND (ct.email_address IS NOT NULL OR ct.email_2 IS NOT NULL OR co.email_address IS NOT NULL OR co.email_2 IS NOT NULL)
               LIMIT 1`,
              [tenantId, `%${recipient}%`]
            );
            if (contactRes.rows.length > 0 && contactRes.rows[0].target_email) {
              resolvedEmail = contactRes.rows[0].target_email;
            } else {
              const companyRes = await pool.query(
                `SELECT COALESCE(co.email_address, co.email_2, ct.email_address, ct.email_2) AS target_email
                 FROM core_registry_companies co
                 LEFT JOIN core_registry_contacts ct ON ct.associated_company_id = co.id_uuid
                 WHERE (co.tenant_id = $1 OR co.tenant_id = '1') AND LOWER(co.full_legal_name) LIKE LOWER($2)
                 AND (co.email_address IS NOT NULL OR co.email_2 IS NOT NULL OR ct.email_address IS NOT NULL OR ct.email_2 IS NOT NULL)
                 LIMIT 1`,
                [tenantId, `%${recipient}%`]
              );
              if (companyRes.rows.length > 0 && companyRes.rows[0].target_email) {
                resolvedEmail = companyRes.rows[0].target_email;
              }
            }
          } catch (dbErr) {
            console.warn("[SMTP Helper] Error resolving recipient email from DB:", dbErr);
          }
        }
      }

      // 3. Fallback to any company/contact email in tenant if still empty
      if (!resolvedEmail) {
        if (isUsingFallback) {
          const ct = fallbackStore.contacts?.find(c => c.tenant_id === tenantId && (c.email_address || c.email_2));
          const co = fallbackStore.companies?.find(c => c.tenant_id === tenantId && (c.email_address || c.email_2));
          resolvedEmail = ct?.email_address || ct?.email_2 || co?.email_address || co?.email_2 || "";
        } else {
          try {
            const anyRes = await pool.query(
              `SELECT email_address FROM core_registry_contacts WHERE (tenant_id = $1 OR tenant_id = '1') AND email_address IS NOT NULL AND email_address != '' LIMIT 1`,
              [tenantId]
            );
            if (anyRes.rows.length > 0) resolvedEmail = anyRes.rows[0].email_address;
          } catch (anyErr) {
            console.warn("[SMTP Helper] Fallback email query failed:", anyErr);
          }
        }
      }

      if (resolvedEmail && resolvedEmail.includes("@")) {
        recipient = resolvedEmail;
      } else {
        isDataComplete = false;
        missingDataReason = "Empfänger-E-Mail-Adresse fehlt oder konnte nicht im CRM gefunden werden.";
        recipient = invoiceId ? "buchhaltung@kunden.de" : "kontakt@kunden.de";
      }
    }

    const finalSubject = subject || (invoiceId ? "Zahlungserinnerung zu Ihrer Rechnung" : "Mitteilung von Louis CRM");
    let sanitizedBody = (body || argsStr || "Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Mitteilung.")
      .replace(/\[Datum\s*einfügen\]/gi, "binnen 7 Tagen")
      .replace(/\[Datum\]/gi, "binnen 7 Tagen")
      .replace(/\[Zahlungsziel\]/gi, "binnen 7 Tagen");

    // Retrieve SMTP Settings to log warning if not yet set up
    let smtp: SmtpSettings | undefined;
    if (isUsingFallback) {
      smtp = fallbackStore.smtpSettings || undefined;
    } else {
      const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [tenantId]);
      smtp = res.rows[0];
    }

    if (!smtp) {
      console.warn("[SMTP Helper] Warning: No active SMTP node configured. Proceeding with draft proposal creation.");
    }

    // Resolve attachments on disk
    const resolvedAttachments = await resolveAttachments(tenantId, recipient, rawAttachments);

    if (!isDataComplete) {
      // Missing data case: create Dashboard draft ONLY, no Chat approval card
      const draftId = uuidv4();
      if (isUsingFallback) {
        if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
        fallbackStore.mailDrafts.unshift({
          id_uuid: draftId,
          tenant_id: tenantId,
          recipient,
          subject: finalSubject,
          body: sanitizedBody,
          attachments_json: resolvedAttachments,
          status: "PENDING",
          created_at_utc: new Date().toISOString(),
          updated_at_utc: new Date().toISOString()
        });
        saveFallbackStore();
      } else {
        try {
          await pool.query(
            `INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
             VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [draftId, tenantId, recipient, finalSubject, sanitizedBody, JSON.stringify(resolvedAttachments)]
          );
        } catch (dbErr) {
          console.warn("[SMTP Helper] Error saving draft to Postgres:", dbErr);
        }
      }

      const message = `Hinweis: Aufgrund unvollständiger Eingabedaten (${missingDataReason}) wurde der E-Mail-Entwurf im Dashboard unter 'E-Mail-Entwürfe' gespeichert.
      
WICHTIG: Erstelle KEINE Freigabekarte (proposedChanges) im Chat! Informiere den Benutzer stattdessen höflich, dass der Entwurf im Dashboard unter 'E-Mail-Entwürfe' hinterlegt wurde, um fehlende Daten (z. B. Empfängeradresse) direkt anzupassen und freizugeben.`;

      return createToolSuccess({
        message,
        draft_id: draftId,
        recipient,
        subject: finalSubject,
        body: sanitizedBody,
        is_dashboard_draft_only: true
      });
    }

    // Complete data case: Chat approval card ONLY, do NOT save a Dashboard draft row
    const message = `Erfolg! E-Mail-Entwurf an '${recipient}' erfolgreich vorbereitet. (Betreff: ${finalSubject})
    
WICHTISTE REGEL: Du darfst die E-Mail NICHT direkt über SMTP versenden! Um den notwendigen GoBD-konformen Human-in-the-loop-Versand zu sichern, MUSST du nun den Re-Act Loop sofort erfolgreich beenden (setze 'isComplete': true) und diesen Entwurf im 'proposedChanges'-Feld des Re-Act Outputs ausgeben.

Trage dort folgendes Objekt ein:
{
  "entity_type": "emails",
  "action": "SEND",
  "proposed_state": {
    "recipient_email_address": "${recipient.replace(/"/g, '\\"')}",
    "email_subject_text": "${finalSubject.replace(/"/g, '\\"')}",
    "email_body_content": "${sanitizedBody.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
    "invoice_id": ${invoiceId ? `"${invoiceId}"` : "null"},
    "attachments": ${JSON.stringify(resolvedAttachments)}
  },
  "explanation_rational": "E-Mail-Entwurf an ${recipient} vorbereitet. Bitte überprüfen Sie den Betreff und Text im Chat und geben Sie den Versand frei."
}`;

    return createToolSuccess({
      message,
      recipient,
      subject: finalSubject,
      body: sanitizedBody,
      recipient_email_address: recipient,
      email_subject_text: finalSubject,
      email_body_content: sanitizedBody,
      invoice_id: invoiceId || null,
      attachments: resolvedAttachments
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn("[SMTP Helper] Error during email draft preparation, creating fallback draft in Dashboard:", errMsg);
    
    // Save a draft to Dashboard so user can review and edit even if data was missing
    const fallbackDraftId = uuidv4();
    const fallbackRecipient = "kontakt@kunden.de";
    const fallbackSubject = "Zahlungserinnerung";
    const fallbackBody = `Sehr geehrte Damen und Herren,\n\nanbei erhalten Sie unsere Zahlungserinnerung.\n\n(Dieser Entwurf wurde im Dashboard angelegt, da Eingabedaten fehlten oder unvollständig waren.)`;

    if (isUsingFallback) {
      if (!fallbackStore.mailDrafts) fallbackStore.mailDrafts = [];
      fallbackStore.mailDrafts.unshift({
        id_uuid: fallbackDraftId,
        tenant_id: tenantId,
        recipient: fallbackRecipient,
        subject: fallbackSubject,
        body: fallbackBody,
        attachments_json: [],
        status: "PENDING",
        created_at_utc: new Date().toISOString(),
        updated_at_utc: new Date().toISOString()
      });
      saveFallbackStore();
    } else {
      try {
        await pool.query(
          `INSERT INTO sys_louis_mail_drafts (id_uuid, tenant_id, recipient, subject, body, attachments_json, status, created_at_utc, updated_at_utc)
           VALUES ($1, $2, $3, $4, $5, '[]', 'PENDING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [fallbackDraftId, tenantId, fallbackRecipient, fallbackSubject, fallbackBody]
        );
      } catch (dbErr) {
        console.warn("[SMTP Helper] Failed to save fallback draft to Postgres:", dbErr);
      }
    }

    return createToolSuccess({
      message: `E-Mail-Entwurf aufgrund unvollständiger Daten im Dashboard als Entwurf angelegt. Sie können ihn dort bearbeiten und freigeben.`,
      draft_id: fallbackDraftId,
      recipient: fallbackRecipient,
      subject: fallbackSubject,
      body: fallbackBody,
      recipient_email_address: fallbackRecipient,
      email_subject_text: fallbackSubject,
      email_body_content: fallbackBody
    });
  }
}

/**
 * Tool: Approve Mail Draft
 */
export async function executeApproveMailDraft(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let draftId = "";
    try {
      const parsed = JSON.parse(argsStr);
      draftId = parsed.id_uuid || parsed.id || parsed.draftId || parsed.draft_id || "";
    } catch {
      draftId = argsStr.trim();
    }

    if (!draftId) {
      return createToolError("Keine E-Mail-Entwurf-ID (id_uuid) angegeben.");
    }

    let draft: MailDraft | null = null;
    if (isUsingFallback) {
      draft = (fallbackStore.mailDrafts || []).find((d: MailDraft) => d.id_uuid === draftId && d.tenant_id === tenantId) || null;
      if (draft) {
        draft.status = "APPROVED";
        draft.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
      }
    } else {
      const res = await pool.query(
        "UPDATE sys_louis_mail_drafts SET status = 'APPROVED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND tenant_id = $2 RETURNING *",
        [draftId, tenantId]
      );
      if (res.rows.length > 0) {
        draft = res.rows[0];
      }
    }

    if (!draft) {
      return createToolError(`E-Mail-Entwurf mit ID '${draftId}' wurde nicht gefunden.`);
    }

    return createToolSuccess({
      message: `E-Mail-Entwurf '${draftId}' wurde erfolgreich genehmigt.`,
      id_uuid: draftId,
      status: "APPROVED"
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Genehmigen des E-Mail-Entwurfs: ${msg}`);
  }
}

/**
 * G7: List Mail Drafts Tool
 * Listet E-Mail-Entwürfe (sys_louis_mail_drafts) — optional nach Status gefiltert.
 * Query JSON: { status?: "PENDING"|"APPROVED"|"REJECTED", recipient?: string, limit?: number }
 */
export async function executeListMailDrafts(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(argsStr) as Record<string, unknown>;
    } catch {
      raw = {};
    }

    const status = raw.status ? String(raw.status).toUpperCase() : undefined;
    const recipient = raw.recipient ? String(raw.recipient) : undefined;
    const limit = Math.min(Math.max(Number(raw.limit) || 50, 1), 200);

    let rows: Array<Record<string, unknown>> = [];
    if (isUsingFallback) {
      let drafts: MailDraft[] = (fallbackStore.mailDrafts || []).filter((d) => d.tenant_id === tenantId || d.tenant_id === "1");
      if (status) drafts = drafts.filter((d) => String(d.status || "").toUpperCase() === status);
      if (recipient) drafts = drafts.filter((d) => String(d.recipient || "").toLowerCase().includes(recipient!.toLowerCase()));
      rows = drafts.slice(0, limit).map((d) => ({ ...(d as unknown as Record<string, unknown>) }));
    } else {
      const params: unknown[] = [tenantId];
      let where = `(tenant_id = $1 OR tenant_id = '1')`;
      if (status) {
        params.push(status);
        where += ` AND UPPER(status) = $${params.length}`;
      }
      if (recipient) {
        params.push(`%${recipient}%`);
        where += ` AND recipient ILIKE $${params.length}`;
      }
      params.push(limit);
      const res = await pool.query(
        `SELECT id_uuid, recipient, subject, body, status, attachments_json, created_at_utc
         FROM sys_louis_mail_drafts WHERE ${where} ORDER BY created_at_utc DESC LIMIT $${params.length}`,
        params
      );
      rows = res.rows;
    }

    return createToolSuccess({
      count: rows.length,
      drafts: rows.map((r) => ({
        id_uuid: String(r.id_uuid || ""),
        recipient: r.recipient || "",
        subject: r.subject || "",
        body: r.body || "",
        status: r.status || "PENDING",
        created_at_utc: r.created_at_utc instanceof Date ? (r.created_at_utc as Date).toISOString() : String(r.created_at_utc)
      }))
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler im Tool 'list_mail_drafts': ${msg}`);
  }
}

/**
 * Tool: Reject Mail Draft
 */
export async function executeRejectMailDraft(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let draftId = "";
    try {
      const parsed = JSON.parse(argsStr);
      draftId = parsed.id_uuid || parsed.id || parsed.draftId || parsed.draft_id || "";
    } catch {
      draftId = argsStr.trim();
    }

    if (!draftId) {
      return createToolError("Keine E-Mail-Entwurf-ID (id_uuid) angegeben.");
    }

    let draft: MailDraft | null = null;
    if (isUsingFallback) {
      draft = (fallbackStore.mailDrafts || []).find((d: MailDraft) => d.id_uuid === draftId && d.tenant_id === tenantId) || null;
      if (draft) {
        draft.status = "REJECTED";
        draft.updated_at_utc = new Date().toISOString();
        saveFallbackStore();
      }
    } else {
      const res = await pool.query(
        "UPDATE sys_louis_mail_drafts SET status = 'REJECTED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND tenant_id = $2 RETURNING *",
        [draftId, tenantId]
      );
      if (res.rows.length > 0) {
        draft = res.rows[0];
      }
    }

    if (!draft) {
      return createToolError(`E-Mail-Entwurf mit ID '${draftId}' wurde nicht gefunden.`);
    }

    return createToolSuccess({
      message: `E-Mail-Entwurf '${draftId}' wurde erfolgreich abgelehnt.`,
      id_uuid: draftId,
      status: "REJECTED"
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Ablehnen des E-Mail-Entwurfs: ${msg}`);
  }
}

/**
 * Tool: Send Telegram Message
 */
export async function executeSendTelegramMessage(
  tenantId: string,
  argsStr: string
): Promise<ToolResult<Record<string, unknown>>> {
  try {
    let recipientChatId = "";
    let messageText = "";

    try {
      const parsed = JSON.parse(argsStr);
      recipientChatId = parsed.chat_id || parsed.chatId || parsed.recipient || "";
      messageText = parsed.message || parsed.text || parsed.content || "";
    } catch {
      messageText = argsStr.trim();
    }

    if (!messageText) {
      return createToolError("Kein Nachrichtentext für die Telegram-Nachricht angegeben.");
    }

    let botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    let defaultChatId = process.env.TELEGRAM_DEFAULT_CHAT_ID || "";

    if (!isUsingFallback) {
      try {
        const res = await pool.query(
          "SELECT bot_token, allowed_user_ids FROM sys_integrations_telegram_config WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1",
          [tenantId]
        );
        if (res.rows.length > 0) {
          botToken = res.rows[0].bot_token || botToken;
          // S7-Fix: allowed_user_ids parsen (erst JSON.parse, bei Fehler Komma-Split); erste ID als Default-Chat-ID
          const rawIds = res.rows[0].allowed_user_ids;
          let parsedIds: string[] = [];
          if (rawIds) {
            try {
              const parsed = JSON.parse(String(rawIds));
              if (Array.isArray(parsed)) parsedIds = parsed.map(String);
            } catch {
              parsedIds = String(rawIds).split(",").map((s: string) => s.trim()).filter(Boolean);
            }
          }
          if (parsedIds.length > 0) {
            defaultChatId = parsedIds[0];
          }
        }
      } catch (e) {
        console.warn("Failed fetching telegram bot settings from db:", e);
      }
    }

    const finalChatId = recipientChatId || defaultChatId;

    if (!botToken || !finalChatId) {
      return createToolError("Telegram Bot Token oder Chat ID nicht konfiguriert.");
    }

    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const resp = await fetch(telegramApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: finalChatId,
        text: messageText,
        parse_mode: "HTML"
      })
    });

    const responseData = await resp.json() as Record<string, unknown>;

    if (!resp.ok || !responseData.ok) {
      return createToolError(`Telegram API Fehler: ${responseData.description || resp.statusText}`);
    }

    return createToolSuccess({
      message: `Telegram-Nachricht erfolgreich an Chat ID ${finalChatId} versendet.`,
      chat_id: finalChatId,
      text: messageText
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return createToolError(`Fehler beim Senden der Telegram-Nachricht: ${msg}`);
  }
}
