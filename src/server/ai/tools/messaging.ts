import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { generateContentUniversal } from "../geminiHelper.js";
import { pool, isUsingFallback, fallbackStore } from "../../db.js";
import { getEntityStoragePath } from "../../storage.js";

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
function searchFileAcrossAllVaults(filename: string, tenantId: string): { path: string; source: 'knowledge' | 'vault'; entityId?: string; entityType?: 'companies' | 'contacts' } | null {
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
 * Resolves filenames for Knowledge Base and Contact/Company Vaults dynamically on disk.
 * Uses exact match first, then falls back to case-insensitive partial/substring match.
 */
async function resolveAttachments(tenantId: string, recipient: string, attachmentsIn: any[]): Promise<Attachment[]> {
  const resolved: Attachment[] = [];
  if (!Array.isArray(attachmentsIn) || attachmentsIn.length === 0) {
    return resolved;
  }

  // Find associated contact and company for vault lookups
  let contact: any = null;
  let company: any = null;

  // Clean the recipient email address to handle name brackets like: "Max Mustermann <max@mustermann.de>" or trailing spaces
  const cleanRecipient = recipient.includes("<") ? (recipient.match(/<([^>]+)>/)?.[1] || recipient).trim() : recipient.trim();

  if (isUsingFallback) {
    contact = fallbackStore.contacts?.find((c: any) => 
      c.email_address?.toLowerCase() === cleanRecipient.toLowerCase() && c.tenant_id === tenantId
    );
    if (contact && contact.associated_company_id) {
      company = fallbackStore.companies?.find((co: any) => 
        co.id_uuid === contact.associated_company_id && co.tenant_id === tenantId
      );
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
        };
        if (row.associated_company_id) {
          company = {
            id_uuid: row.associated_company_id,
            full_legal_name: row.co_name || "Unbekannt"
          };
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
      origFilename = String(att.filename || att.name || "").trim();
      source = String(att.source || "knowledge").toLowerCase() as 'knowledge' | 'vault';
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
export async function executeSendSmtpEmail(tenantId: string, argsStr: string, actor: string = "system", aiClient?: GoogleGenAI): Promise<string> {
  try {
    let rawArgs: any;
    try {
      rawArgs = JSON.parse(argsStr);
    } catch (parseErr) {
      // Natural language/unstructured input fallback - Try deterministic parsing first (completely model-free)
      console.log("[SMTP Helper] Input is not valid JSON. Attempting deterministic regex parsing first...");
      
      let parsedRecipient = "";
      let parsedInvoiceId = "";
      let parsedSubject = "";
      let parsedBody = "";
      let parsedAttachments: any[] = [];

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

       // If we found a recipient and some key action like an invoice reference or a subject line, we parse deterministically
       if (parsedRecipient && (parsedInvoiceId || parsedSubject || argsStr.toLowerCase().includes("rechnung") || argsStr.toLowerCase().includes("invoice"))) {
         rawArgs = {
           recipient_email_address: parsedRecipient,
           email_subject_text: parsedSubject || (parsedInvoiceId ? `Rechnungskopie für Sie` : `E-Mail von Louis CRM`),
           email_body_content: parsedBody || argsStr, // default to the entire text as fallback
           invoice_id: parsedInvoiceId || null,
           attachments: parsedAttachments
         };
         console.log("[SMTP Helper] Deterministically extracted SMTP arguments from input text:", rawArgs);
       } else {
         // Fall back to configured LLM (which could be local Ollama, OpenAI, Anthropic, or Gemini)
         console.log("[SMTP AI Helper] Deterministic pattern mismatch, using configured AI model to parse");
         try {
           let providerType: 'gemini' | 'ollama' | 'openai' | 'anthropic' = 'gemini';
           let modelToUse = "gemini-3.5-flash";
           let apiKeySecret = "";
           let baseUrl = "";

           // Load provider configuration of Louis AI
           if (isUsingFallback) {
             const found = (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === tenantId) || (fallbackStore.louisAiConfig || []).find((c: any) => c.tenant_id === '1');
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
  "recipient_email_address": "...", // Die E-Mail-Adresse des Empfängers
  "email_subject_text": "...", // Aussagekräftiger Betreff
  "email_body_content": "...", // Der Inhalt/Textkörper der E-Mail (HTML-Format erlaubt oder reiner Text)
  "invoice_id": "...", // Optionale UUID der zugehörigen Rechnung, falls erwähnt, sonst null/weglassen
  "attachments": [
    {
      "filename": "...", // Exakter Name der PDF, DOCX, XLSX, TXT etc., die angehängt werden soll (aus der Wissensdatenbank oder dem Unternehmens-/Kontakt-Vault)
      "source": "knowledge" | "vault" // "knowledge" für Dokumente aus der Wissensdatenbank, "vault" für Dokumente aus dem Kontakt/Unternehmens-Vault. Wähle basierend darauf, woher das Dokument laut Kontext oder Logik stammt.
    }
  ] // Optionale Liste an Dateien, die zusätzlich angehängt werden sollen
}
Antworte AUSSCHLIESSLICH im puren JSON-Format ohne Markdown-Blockierungen oder sonstige Zusätze.`;

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
         } catch (e: any) {
           throw new Error(`Fehler bei der automatischen KI-Strukturierung der E-Mail-Argumente: ${e.message}`);
         }
       }
     }

    // Now validate the extracted/parsed arguments
    if (!rawArgs || typeof rawArgs !== 'object') {
      throw new Error("Fehler: Argumente konnten nicht zu einem Objekt aufgelöst werden.");
    }

    let recipient = String(rawArgs.recipient_email_address || "").trim();
    const subject = String(rawArgs.email_subject_text || "").trim();
    const body = String(rawArgs.email_body_content || "").trim();
    const invoiceId = rawArgs.invoice_id ? String(rawArgs.invoice_id).trim() : undefined;
    const rawAttachments = Array.isArray(rawArgs.attachments) ? rawArgs.attachments : [];

    // Check if recipient is a valid email. If it does not contain a "@" and is not empty, resolve against CRM
    const isEmail = recipient.includes("@");
    if (!isEmail && recipient.length > 0) {
      console.log(`[SMTP Helper] Recipient "${recipient}" is not a valid email address. Resolving against CRM registry...`);
      let resolvedEmail = "";
      
      if (isUsingFallback) {
        // Try searching contacts first
        const contact = fallbackStore.contacts?.find((c: any) => 
          c.tenant_id === tenantId && (
            c.full_legal_name?.toLowerCase().includes(recipient.toLowerCase()) ||
            `${c.first_name || ''} ${c.last_name || ''}`.toLowerCase().includes(recipient.toLowerCase())
          )
        );
        if (contact && (contact.email_address || contact.email_2)) {
          resolvedEmail = contact.email_address || contact.email_2;
          console.log(`[SMTP Helper] Resolved contact from fallback store and found email: ${resolvedEmail}`);
        } else {
          // Try company
          const company = fallbackStore.companies?.find((co: any) => 
            co.tenant_id === tenantId && co.full_legal_name?.toLowerCase().includes(recipient.toLowerCase())
          );
          if (company && (company.email_address || company.email_2)) {
            resolvedEmail = company.email_address || company.email_2;
            console.log(`[SMTP Helper] Resolved company from fallback store and found email: ${resolvedEmail}`);
          }
        }
      } else {
        try {
          // Search contacts with ILIKE
          const contactRes = await pool.query(
            `SELECT full_legal_name, email_address, email_2 FROM core_registry_contacts 
             WHERE (tenant_id = $1 OR tenant_id = '1') AND (
               LOWER(full_legal_name) LIKE LOWER($2) OR 
               LOWER(first_name || ' ' || last_name) LIKE LOWER($2)
             ) LIMIT 1`,
            [tenantId, `%${recipient}%`]
          );
          if (contactRes.rows.length > 0 && (contactRes.rows[0].email_address || contactRes.rows[0].email_2)) {
            resolvedEmail = contactRes.rows[0].email_address || contactRes.rows[0].email_2;
            console.log(`[SMTP Helper] Resolved contact from DB: ${contactRes.rows[0].full_legal_name} -> ${resolvedEmail}`);
          } else {
            // Search companies
            const companyRes = await pool.query(
              `SELECT full_legal_name, email_address, email_2 FROM core_registry_companies 
               WHERE (tenant_id = $1 OR tenant_id = '1') AND LOWER(full_legal_name) LIKE LOWER($2) LIMIT 1`,
              [tenantId, `%${recipient}%`]
            );
            if (companyRes.rows.length > 0 && (companyRes.rows[0].email_address || companyRes.rows[0].email_2)) {
              resolvedEmail = companyRes.rows[0].email_address || companyRes.rows[0].email_2;
              console.log(`[SMTP Helper] Resolved company from DB: ${companyRes.rows[0].full_legal_name} -> ${resolvedEmail}`);
            }
          }
        } catch (dbErr) {
          console.warn("[SMTP Helper] Error resolving recipient email from DB:", dbErr);
        }
      }
      
      recipient = resolvedEmail || "";
    }

    if (!subject) {
      throw new Error("email_subject_text (Betreff) ist erforderlich.");
    }
    if (!body) {
      throw new Error("email_body_content (Inhalt) ist erforderlich.");
    }

    // Retrieve SMTP Settings to make sure it's set up
    let smtp: any;
    if (isUsingFallback) {
      smtp = fallbackStore.smtpSettings;
    } else {
      const res = await pool.query("SELECT * FROM sys_integrations_smtp_nodes WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END LIMIT 1", [tenantId]);
      smtp = res.rows[0];
    }

    if (!smtp) {
      throw new Error("Fehler: SMTP-Verbindung ist nicht eingerichtet. Bitte konfigurieren Sie SMTP unter Admin > Verbindungen.");
    }

    // Resolve attachments on disk
    const resolvedAttachments = await resolveAttachments(tenantId, recipient, rawAttachments);

    // We do NOT send the mail here under any circumstances. We instruct the model to finish its ReAct loop
    // and deliver a proposal via proposedChanges to the human-in-the-loop.
    return `Erfolg! E-Mail-Entwurf an '${recipient}' erfolgreich vorbereitet. (Betreff: ${subject})
    
WICHTISTE REGEL: Du darfst die E-Mail NICHT direkt über SMTP versenden! Um den notwendigen GoBD-konformen Human-in-the-loop-Versand zu sichern, MUSST du nun den Re-Act Loop sofort erfolgreich beenden (setze 'isComplete': true) und diesen Entwurf im 'proposedChanges'-Feld des Re-Act Outputs ausgeben.

Trage dort folgendes Objekt ein:
{
  "entity_type": "emails",
  "action": "SEND",
  "proposed_state": {
    "recipient_email_address": "${recipient.replace(/"/g, '\\"')}",
    "email_subject_text": "${subject.replace(/"/g, '\\"')}",
    "email_body_content": "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}",
    "invoice_id": ${invoiceId ? `"${invoiceId}"` : "null"},
    "attachments": ${JSON.stringify(resolvedAttachments)}
  },
  "explanation_rational": "E-Mail-Entwurf an ${recipient} vorbereitet. Bitte überprüfen Sie den Betreff, Text und Anhänge und geben Sie den tatsächlichen SMTP-Versand frei."
}`;
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return `Fehler bei der Vorbereitung des E-Mail-Entwurfs: ${errMsg}`;
  }
}
