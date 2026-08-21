import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { PDFDocument, rgb, PDFFont, RGB, PDFName, PDFHexString, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const execAsync = promisify(exec);
import { Invoice, InvoiceWithRecipient, InvoiceLineItem } from "../types.js";
import { pool, isUsingFallback, fallbackStore } from "./db.js";
import { getEntityStoragePath } from "./storage.js";
import { MyCompanyFullSchema } from "../lib/schemas.js";
import { generateZugferdXML, inferProfileFromInvoice, XmlProfile } from "../lib/zugferd.js";
import { z } from "zod";

export class InvoiceValidationError extends Error {
  public code: string;
  public validationReport?: unknown;
  public validationLogPath?: string;

  constructor(message: string, code: string, validationReport?: unknown, validationLogPath?: string) {
    super(message);
    this.name = 'InvoiceValidationError';
    this.code = code;
    this.validationReport = validationReport;
    this.validationLogPath = validationLogPath;
    Object.setPrototypeOf(this, InvoiceValidationError.prototype);
  }
}

export interface InvoicePDFContext extends InvoiceWithRecipient {
  entityType?: string;
  entityId?: string;
  entityName?: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfTranslations: Record<string, Record<string, string>> = {
  de: {
    invoice: "RECHNUNG",
    invoice_number: "Rechnungsnummer:",
    date: "Datum:",
    service_date: "Leistungszeitpunkt:",
    payment_term: "Zahlungsziel:",
    bank_account: "Bankkonto:",
    days: "Tage",
    pos: "Pos.",
    description: "Beschreibung",
    quantity: "Menge",
    unit: "Einheit",
    unit_price: "Einzelpreis",
    vat: "MwSt.",
    total_net: "Gesamt",
    std: "Std.",
    stk: "Stk.",
    pausch: "Pausch.",
    subtotal_net: "Summe:",
    plus_vat: "Zzgl. Umsatzsteuer",
    total_amount: "GESAMTSUMME:",
    tax_and_vat_id: "STEUERNUMMER & UST-IDNR.",
    vat_id_label: "USt-IdNr.:",
    tax_number_label: "Steuernummer:",
    bank_connection: "BANKVERBINDUNG",
    bank_name: "Bank:",
    contact_support: "KONTAKT & SUPPORT",
    customer: "Kunde",
    germany: "Deutschland"
  },
  en: {
    invoice: "INVOICE",
    invoice_number: "Invoice Number:",
    date: "Date:",
    service_date: "Service Date:",
    payment_term: "Payment Term:",
    bank_account: "Bank Account:",
    days: "Days",
    pos: "Pos",
    description: "Description",
    quantity: "Qty",
    unit: "Unit",
    unit_price: "Unit Price",
    vat: "VAT",
    total_net: "Total Net",
    std: "Hrs.",
    stk: "Pcs.",
    pausch: "Flat",
    subtotal_net: "Subtotal Net:",
    plus_vat: "Plus VAT",
    total_amount: "TOTAL AMOUNT:",
    tax_and_vat_id: "TAX ID & VAT ID",
    vat_id_label: "VAT Reg No:",
    tax_number_label: "Tax No:",
    bank_connection: "BANK DETAILS",
    bank_name: "Bank:",
    contact_support: "CONTACT & SUPPORT",
    customer: "Customer",
    germany: "Germany"
  }
};

function wrapText(text: string, maxWidth: number, font: PDFFont, fontSize: number): string[] {
  const result: string[] = [];
  const paragraphs = text.split("\n");
  for (const para of paragraphs) {
    if (para.trim() === "") {
      result.push("");
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = "";
    for (const word of words) {
      if (!word) continue;
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const lineWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (lineWidth > maxWidth) {
        if (currentLine) {
          result.push(currentLine);
        }
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }
  return result;
}

const cleanHtmlForPdf = (htmlText: string): string => {
  if (!htmlText) return "";
  let text = htmlText;
  
  // 1. Literal newlines in HTML source are preserved as newlines (supports plain text input)
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\r/g, "\n");
  
  // Consecutive block elements should just be separated by one newline
  text = text.replace(/<\/(p|div|h[1-6])>\s*<(p|div|h[1-6])[^>]*>/gi, "\n");
  
  // 2. Insert newlines for block elements and breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/tr>/gi, "\n");
  text = text.replace(/<(p|div|h[1-6]|tr)[^>]*>/gi, "\n");
  text = text.replace(/<li[^>]*>/gi, "\n• ");

  // Map <strong> and <em> to <b> and <i>
  text = text.replace(/<strong[^>]*>/gi, "<b>");
  text = text.replace(/<\/strong>/gi, "</b>");
  text = text.replace(/<em[^>]*>/gi, "<i>");
  text = text.replace(/<\/em>/gi, "</i>");
  
  // Strip attributes from <b> and <i> tags
  text = text.replace(/<b\s+[^>]*>/gi, "<b>");
  text = text.replace(/<i\s+[^>]*>/gi, "<i>");
  
  // 3. Remove all remaining HTML tags EXCEPT <b> and <i>
  text = text.replace(/<\/?(?!(?:b|i)\b)[a-z0-9-]+[^>]*>/gi, "");
  
  // 4. Decode HTML entities
  text = text.replace(/&nbsp;/gi, " ")
             .replace(/&amp;/gi, "&")
             .replace(/&lt;/gi, "<")
             .replace(/&gt;/gi, ">")
             .replace(/&quot;/gi, '"')
             .replace(/&#39;/gi, "'");
             
  // 5. Clean up excessive spaces and newlines
  text = text.replace(/[ ]+/g, " ");
  text = text.replace(/ \n/g, "\n");
  text = text.replace(/\n /g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  
  return text.trim();
};

export type RichTextSegment = {
  text: string;
  bold: boolean;
  italic: boolean;
};

export type FontSet = {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
};

export function parseRichText(text: string): RichTextSegment[] {
  const result: RichTextSegment[] = [];
  let bold = false;
  let italic = false;
  
  const parts = text.split(/(<b>|<\/b>|<i>|<\/i>)/i);
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower === "<b>") bold = true;
    else if (lower === "</b>") bold = false;
    else if (lower === "<i>") italic = true;
    else if (lower === "</i>") italic = false;
    else {
      if (part.length > 0) {
        result.push({ text: part, bold, italic });
      }
    }
  }
  return result;
}

export function wrapRichText(
  htmlText: string, 
  maxWidth: number, 
  fonts: FontSet, 
  fontSize: number
): RichTextSegment[][] {
  const result: RichTextSegment[][] = [];
  const paragraphs = htmlText.split("\n");
  
  for (const para of paragraphs) {
    if (para.trim() === "") {
      result.push([]);
      continue;
    }
    
    const segments = parseRichText(para);
    
    let currentLine: RichTextSegment[] = [];
    let currentLineWidth = 0;
    
    for (const segment of segments) {
      let font = fonts.regular;
      if (segment.bold && segment.italic) font = fonts.boldItalic;
      else if (segment.bold) font = fonts.bold;
      else if (segment.italic) font = fonts.italic;
      
      const words = segment.text.split(/(\s+)/);
      
      for (const word of words) {
        if (!word) continue;
        
        const isSpace = /^[\s]+$/.test(word);
        const wordWidth = font.widthOfTextAtSize(word, fontSize);
        
        if (currentLineWidth + wordWidth > maxWidth && !isSpace) {
          if (currentLine.length > 0) {
             result.push(currentLine);
             currentLine = [];
             currentLineWidth = 0;
          }
        }
        
        if (currentLine.length === 0 && isSpace) {
          continue;
        }
        
        if (currentLine.length > 0 && 
            currentLine[currentLine.length - 1].bold === segment.bold &&
            currentLine[currentLine.length - 1].italic === segment.italic) {
          currentLine[currentLine.length - 1].text += word;
        } else {
          currentLine.push({ text: word, bold: segment.bold, italic: segment.italic });
        }
        currentLineWidth += wordWidth;
      }
    }
    
    if (currentLine.length > 0) {
      result.push(currentLine);
    }
  }
  
  return result;
}

export function drawRichTextLine(
  page: PDFPage, 
  line: RichTextSegment[], 
  x: number, 
  y: number, 
  fontSize: number, 
  fonts: FontSet, 
  color: RGB
) {
  let currentX = x;
  for (const seg of line) {
    let font = fonts.regular;
    if (seg.bold && seg.italic) font = fonts.boldItalic;
    else if (seg.bold) font = fonts.bold;
    else if (seg.italic) font = fonts.italic;
    
    page.drawText(seg.text, { x: currentX, y, size: fontSize, font, color });
    currentX += font.widthOfTextAtSize(seg.text, fontSize);
  }
}

/**
 * Ensure required visual-rendering fonts are present on disk.
 * PDF/A-3b sealing (sRGB OutputIntent, XMP, /AF, AFRelationship) is delegated
 * to Mustang CLI in mergePdfAndXmlWithMustang, so no ICC profile is loaded here.
 *
 * Fonts must be bundled with the deployment (zero-egress). A setup script is
 * provided to fetch them once at install time — see npm run setup-assets.
 */
async function ensureFontAssets(): Promise<void> {
  const assetsDir = path.join(process.cwd(), "src/assets");
  const fontsDir = path.join(assetsDir, "fonts");

  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const fontRegularPath = path.join(fontsDir, "Lato-Regular.ttf");
  const fontBoldPath = path.join(fontsDir, "Lato-Bold.ttf");
  const fontItalicPath = path.join(fontsDir, "Lato-Italic.ttf");
  const fontBoldItalicPath = path.join(fontsDir, "Lato-BoldItalic.ttf");

  const missing: string[] = [];
  if (!fs.existsSync(fontRegularPath)) missing.push("Lato-Regular.ttf");
  if (!fs.existsSync(fontBoldPath)) missing.push("Lato-Bold.ttf");
  if (!fs.existsSync(fontItalicPath)) missing.push("Lato-Italic.ttf");
  if (!fs.existsSync(fontBoldItalicPath)) missing.push("Lato-BoldItalic.ttf");

  if (missing.length > 0) {
    throw new Error(
      `Missing bundled fonts: ${missing.join(", ")}. ` +
      `Run \`npm run setup-assets\` once to vendor them under src/assets/fonts/. ` +
      `Runtime downloads are disabled to comply with the project's zero-egress policy.`
    );
  }
}

export async function buildInvoicePDFBuffer(
  invoice: InvoicePDFContext,
  myCompany?: Partial<z.infer<typeof MyCompanyFullSchema>> | null,
  locale: string = "de"
): Promise<Uint8Array> {
  const tPDF = (key: string): string => {
    const lang = locale === "en" ? "en" : "de";
    return pdfTranslations[lang][key] || pdfTranslations["de"][key] || key;
  };

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  await ensureFontAssets();

  // Declare the document as PDF/A-1b in XMP. Mustang CLI inspects this marker
  // (ZUGFeRDExporterFromPDFA.determineAndSetExporter) to pick the right exporter;
  // without it, combine throws "PDF-A version not supported". Mustang will
  // upgrade A-1 → A-3 during combine and replace this XMP with the full
  // Factur-X / XRechnung metadata block.
  try {
    const xmpMetadata = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>1</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Invoice ${invoice.invoice_number}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    // CRITICAL: encode XMP as a UTF-8 byte buffer. The packet preamble
    // <?xpacket begin="<BOM>"...?> uses a literal U+FEFF whose UTF-8 encoding
    // is EF BB BF. pdf-lib's stream() treats raw strings as latin-1, which
    // mangles the BOM and makes Mustang's xmpbox parser throw
    // "Invalid byte 1 of 1-byte UTF-8 sequence".
    const xmpBuffer = Buffer.from(xmpMetadata, "utf-8");
    const xmpStream = pdfDoc.context.stream(xmpBuffer, {
      Type: "Metadata",
      Subtype: "XML",
      Length: xmpBuffer.length,
    });
    const xmpRef = pdfDoc.context.register(xmpStream);
    pdfDoc.catalog.set(PDFName.of("Metadata"), xmpRef);

    // Document trailer ID — required by PDF/A. Mustang preserves this.
    const uuid = invoice.id_uuid || "00000000-0000-0000-0000-000000000000";
    const hexPart = uuid.replace(/-/g, "").substring(0, 32).padEnd(32, "0");
    const docId = PDFHexString.of(hexPart);
    if (pdfDoc.context.trailerInfo) {
      pdfDoc.context.trailerInfo.ID = pdfDoc.context.obj([docId, docId]);
    }
  } catch (metaErr) {
    console.warn("[buildInvoicePDFBuffer] Could not write minimal PDF/A-1 markers:", metaErr);
  }

  const page = pdfDoc.addPage([595.276, 841.890]); // A4 Size (595 x 842 pt)
  
  const loadedFontsDir = path.join(process.cwd(), "src/assets/fonts");
  const fontRegularPath = path.join(loadedFontsDir, "Lato-Regular.ttf");
  const fontBoldPath = path.join(loadedFontsDir, "Lato-Bold.ttf");
  const fontItalicPath = path.join(loadedFontsDir, "Lato-Italic.ttf");
  const fontBoldItalicPath = path.join(loadedFontsDir, "Lato-BoldItalic.ttf");

  let fontRegular: PDFFont;
  let fontBold: PDFFont;
  let fontItalic: PDFFont;
  let fontBoldItalic: PDFFont;

  if (!fs.existsSync(fontRegularPath) || !fs.existsSync(fontBoldPath) || !fs.existsSync(fontItalicPath) || !fs.existsSync(fontBoldItalicPath)) {
    throw new Error(
      `Required TrueType Fonts (Lato) are missing from resources. ` +
      `Standard fallback fonts (like Helvetica) cannot be used in order to guarantee full PDF/A-3b compliance.`
    );
  }

  try {
    const fontRegularBytes = fs.readFileSync(fontRegularPath);
    const fontBoldBytes = fs.readFileSync(fontBoldPath);
    const fontItalicBytes = fs.readFileSync(fontItalicPath);
    const fontBoldItalicBytes = fs.readFileSync(fontBoldItalicPath);
    fontRegular = await pdfDoc.embedFont(fontRegularBytes);
    fontBold = await pdfDoc.embedFont(fontBoldBytes);
    fontItalic = await pdfDoc.embedFont(fontItalicBytes);
    fontBoldItalic = await pdfDoc.embedFont(fontBoldItalicBytes);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load and embed custom TrueType fonts (Lato). ` +
      `Standard fallback fonts cannot be used to prevent PDF/A-3 compliance failure. Error: ${errorMessage}`
    );
  }

  const fontSet: FontSet = {
    regular: fontRegular,
    bold: fontBold,
    italic: fontItalic,
    boldItalic: fontBoldItalic
  };

  // Elegant UI Palette mirroring our Tailwind Slate/Teal setup
  const black = rgb(15/255, 23/255, 42/255); // slate-900 / dark charcoal
  const darkGray = rgb(100/255, 116/255, 139/255); // slate-500
  const slate50 = rgb(248/255, 250/255, 252/255); // slate-50
  const slate200 = rgb(226/255, 232/255, 240/255); // slate-200 / light divider
  const borderGray = rgb(241/255, 245/255, 249/255); // slate-100
  const accentColor = rgb(13/255, 148/255, 136/255); // Vibrant teal to match text-teal-600

  // Pages tracking
  const pages: PDFPage[] = [page];
  let currentPageIndex = 0;
  let currentPage = pages[currentPageIndex];

  // Precision right-aligned text Helper
  const drawTextRight = (text: string, x: number, y: number, size: number, font: PDFFont, color: RGB) => {
    const width = font.widthOfTextAtSize(text, size);
    currentPage.drawText(text, { x: x - width, y, size, font, color });
  };

  // Get dynamic sender info
  const rawHeaderName = myCompany?.full_legal_name || "LOUIS Systems";
  const senderHeader = rawHeaderName.toUpperCase();
  const senderName = myCompany?.full_legal_name || "LOUIS Systems GmbH";
  const streetAndNo = (myCompany?.street && myCompany?.house_number) 
    ? `${myCompany.street} ${myCompany.house_number}` 
    : "Friedrichstr. 100";
  const postalAndCity = (myCompany?.postal_code && myCompany?.city)
    ? `${myCompany.postal_code} ${myCompany.city}`
    : "10117 Berlin";
  const countryCode = myCompany?.country_code || "DE";
  const vatId = myCompany?.tax_vat_id || "DE999999999";
  const taxNumber = myCompany?.tax_number || "";
  const senderEmail = myCompany?.email_address || "billing@louis-systems.de";
  
  const iban = myCompany?.iban || "DE89 1005 0000 0123 4567 89";
  const bic = myCompany?.bic_swift || "WELADED1100";

  // DRAW SENDER LOGO & HEADER
  let textX = 50;
  if (myCompany?.logo_url) {
    try {
      const mimeMatch = myCompany.logo_url.match(/^data:([^;]+);base64,/);
      if (mimeMatch) {
         const mimeType = mimeMatch[1];
         const base64Data = myCompany.logo_url.substring(myCompany.logo_url.indexOf(",") + 1);
         const imageBuffer = Buffer.from(base64Data, "base64");
         
         let logoImage;
         if (mimeType.includes("png")) {
           logoImage = await pdfDoc.embedPng(imageBuffer);
         } else if (mimeType.includes("jpeg") || mimeType.includes("jpg")) {
           logoImage = await pdfDoc.embedJpg(imageBuffer);
         }
         
         if (logoImage) {
           const dims = logoImage.scaleToFit(200, 100);
           // Draw logo links neben/to the left of the sender name and address
           currentPage.drawImage(logoImage, {
             x: 50,
             y: 805 - dims.height,
             width: dims.width,
             height: dims.height,
           });
           textX = 50 + dims.width + 16;
         }
      }
    } catch (err) {
      console.error("PDF logo embedding error:", err);
    }
  }

  drawTextRight(senderName, 545, 780, 11, fontBold, black);
  drawTextRight(streetAndNo, 545, 766, 10, fontRegular, darkGray);
  drawTextRight(`${postalAndCity}, ${countryCode}`, 545, 752, 10, fontRegular, darkGray);

  // Document Title (aligned above the metadata box)
  drawTextRight(tPDF("invoice"), 545, 685, 12, fontBold, black);

  // RECIPIENT ADDRESS BLOCK (Left Column)
  const recipientY = 660;
  
  const rawSenderLine = `${senderName} • ${streetAndNo} • ${postalAndCity}`;
  const maxSenderLineWidth = 260; // Maximaler Platz in Punkten bis zum Metadaten-Kasten (x=310-330)
  
  // Berechne die ideale Schriftgröße dynamisch basierend auf der Textbreite
  let senderLineFontSize = 7;
  let currentWidth = fontRegular.widthOfTextAtSize(rawSenderLine, senderLineFontSize);
  
  while (currentWidth > maxSenderLineWidth && senderLineFontSize > 5) {
    senderLineFontSize -= 0.2;
    currentWidth = fontRegular.widthOfTextAtSize(rawSenderLine, senderLineFontSize);
  }

  currentPage.drawText(rawSenderLine, {
    x: 50,
    y: 675,
    size: senderLineFontSize, // Verwendet die dynamisch verkleinerte Schriftgröße
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5)
  });
  
  const recipientName = invoice.entityName || invoice.company_name || invoice.contact_full_name || tPDF("customer");
  currentPage.drawText(recipientName, { x: 50, y: recipientY, size: 11, font: fontBold, color: black });

  // Resolve dynamic recipient fields from the DB properties
  let recipientStreet = invoice.co_street || invoice.ct_street || "";
  let recipientHouseNumber = invoice.co_house_number || invoice.ct_house_number || "";
  let recipientPostalCode = invoice.co_postal_code || invoice.ct_postal_code || "";
  let recipientCity = invoice.co_city || invoice.ct_city || "";
  let recipientCountry = invoice.co_country_code || "DE";

  if (recipientCountry === "DE" || recipientCountry === "de") {
    recipientCountry = tPDF("germany");
  }

  const streetAndNoRecipient = recipientStreet && recipientHouseNumber 
    ? `${recipientStreet} ${recipientHouseNumber}` 
    : (recipientStreet || "Beispielstraße 42");

  const postalAndCityRecipient = recipientPostalCode && recipientCity 
    ? `${recipientPostalCode} ${recipientCity}` 
    : (recipientCity || "12345 Musterstadt");

  currentPage.drawText(streetAndNoRecipient, { x: 50, y: recipientY - 14, size: 10, font: fontRegular, color: darkGray });
  currentPage.drawText(postalAndCityRecipient, { x: 50, y: recipientY - 28, size: 10, font: fontRegular, color: darkGray });
  currentPage.drawText(recipientCountry, { x: 50, y: recipientY - 42, size: 10, font: fontRegular, color: darkGray });

  if (invoice.leitweg_id) {
    currentPage.drawText(`Leitweg-ID: ${invoice.leitweg_id}`, { x: 50, y: recipientY - 58, size: 8, font: fontBold, color: accentColor });
  }

  // REPLACEMENT METADATA KASTEN BOX (Exact Copy of HTML Preview Card)
  const boxX = 330;
  const boxWidth = 215;
  const boxHeight = 114;
  const boxY = 675 - boxHeight; // 561

  // Draw background box
  currentPage.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: slate50,
    borderColor: borderGray,
    borderWidth: 1,
  });

  const startTextY = boxY + boxHeight - 12;
  const metadataKastenRows = [
    { label: tPDF("invoice_number"), val: invoice.invoice_number || "" },
    { label: "Kürzel:", val: invoice.metadata?.company_short_code || "--" },
    { label: tPDF("date"), val: invoice.issue_date ? new Date(invoice.issue_date).toLocaleDateString(locale === "en" ? "en-US" : "de-DE") : "" },
    { label: tPDF("service_date"), val: (invoice.service_date || invoice.issue_date) ? new Date(invoice.service_date || invoice.issue_date).toLocaleDateString(locale === "en" ? "en-US" : "de-DE") : "" },
    {
      label: tPDF("payment_term"),
      // Append "Tage" only when payment_term is a plain number ("14", "30").
      // For free-text terms (e.g. "Zahlbar innerhalb von 30 Tagen ohne Abzug"),
      // emit the sentence as-is and truncate to fit the metadata box width.
      val: (() => {
        const raw = (invoice.payment_term || "").trim();
        if (!raw) return `14 ${tPDF("days")}`;
        if (/^\d+$/.test(raw)) return `${raw} ${tPDF("days")}`;
        // Hard cap so it never spills past the box label
        return raw.length > 36 ? raw.slice(0, 33) + "..." : raw;
      })(),
    },
    { label: tPDF("bank_account"), val: (invoice.bank_account || "SPARKASSE").toUpperCase() },
  ];

  metadataKastenRows.forEach((item, idx) => {
    const cy = startTextY - idx * 18;
    // Draw label
    currentPage.drawText(item.label, { x: boxX + 12, y: cy, size: 8, font: fontBold, color: darkGray });
    // Draw value right aligned
    drawTextRight(item.val || "--", boxX + boxWidth - 12, cy, 8, fontBold, black);
    
    // Draw thin inside divider line
    if (idx < metadataKastenRows.length - 1) {
      currentPage.drawLine({
        start: { x: boxX + 8, y: cy - 6 },
        end: { x: boxX + boxWidth - 8, y: cy - 6 },
        thickness: 0.5,
        color: slate200,
      });
    }
  });

  const currencySymbol = invoice.currency_code === "EUR" ? "€" : invoice.currency_code;

  let tableY = 510;
  if (invoice.introductory_text) {
    const cleanIntro = cleanHtmlForPdf(invoice.introductory_text || "");
    const wrappedIntro = wrapRichText(cleanIntro, 495, fontSet, 9);
    let textY = 530;
    wrappedIntro.slice(0, 8).forEach((line) => {
      drawRichTextLine(currentPage, line, 50, textY, 9, fontSet, black);
      textY -= 12;
    });
    tableY = textY - 32;
  }

  let currentY = tableY - 22;

  const addNewPage = (drawHeader: boolean = true): void => {
    const newPage = pdfDoc.addPage([595.276, 841.890]);
    pages.push(newPage);
    currentPageIndex++;
    currentPage = pages[currentPageIndex];
    
    // Draw running header on page 2+
    currentPage.drawText(`${tPDF("invoice")} ${invoice.invoice_number || ""}`, {
      x: 50,
      y: 800,
      size: 8,
      font: fontBold,
      color: darkGray
    });
    const pageNumStr = `${currentPageIndex + 1}`;
    const pageNumWidth = fontRegular.widthOfTextAtSize(pageNumStr, 8);
    currentPage.drawText(pageNumStr, {
      x: 545 - pageNumWidth,
      y: 800,
      size: 8,
      font: fontRegular,
      color: darkGray
    });
    
    currentPage.drawLine({
      start: { x: 50, y: 792 },
      end: { x: 545, y: 792 },
      thickness: 0.5,
      color: slate200,
    });
    
    if (drawHeader) {
      // Draw table header on new page
      const tableHeaderY = 760;
      currentPage.drawRectangle({
        x: 50,
        y: tableHeaderY - 5,
        width: 495,
        height: 20,
        color: slate50,
        borderColor: borderGray,
        borderWidth: 1,
      });

      currentPage.drawText(tPDF("pos"), { x: 55, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("description"), { x: 85, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      drawTextRight(tPDF("quantity"), 295, tableHeaderY + 1, 8, fontBold, darkGray);
      drawTextRight(tPDF("unit"), 335, tableHeaderY + 1, 8, fontBold, darkGray);
      drawTextRight(tPDF("unit_price"), 410, tableHeaderY + 1, 8, fontBold, darkGray);
      drawTextRight(tPDF("vat"), 455, tableHeaderY + 1, 8, fontBold, darkGray);
      drawTextRight(tPDF("total_net"), 540, tableHeaderY + 1, 8, fontBold, darkGray);

      currentY = tableHeaderY - 25;
    } else {
      currentY = 780;
    }
  };

  if (tableY - 45 < 100) {
    addNewPage(true);
  } else {
    // TABLE COLUMNS HEADER
    currentPage.drawRectangle({
      x: 50,
      y: tableY - 5,
      width: 495,
      height: 20,
      color: slate50,
      borderColor: borderGray,
      borderWidth: 1,
    });

    currentPage.drawText(tPDF("pos"), { x: 55, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("description"), { x: 85, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    drawTextRight(tPDF("quantity"), 295, tableY + 1, 8, fontBold, darkGray);
    drawTextRight(tPDF("unit"), 335, tableY + 1, 8, fontBold, darkGray);
    drawTextRight(tPDF("unit_price"), 410, tableY + 1, 8, fontBold, darkGray);
    drawTextRight(tPDF("vat"), 455, tableY + 1, 8, fontBold, darkGray);
    drawTextRight(tPDF("total_net"), 540, tableY + 1, 8, fontBold, darkGray);

    currentY = tableY - 22;
  }

  // DRAW LINE ITEMS
  interface InvoiceLineItem {
    description?: string;
    quantity?: number;
    unit_code?: string;
    unit_price?: number;
    vat_rate?: number;
    total_net?: number;
  }
  const lineItems = (typeof invoice.invoice_line_items_json === 'string'
    ? JSON.parse(invoice.invoice_line_items_json || "[]")
    : (invoice.invoice_line_items_json || [])) as InvoiceLineItem[];

  lineItems.forEach((item: InvoiceLineItem, idx: number) => {
    let desc = item.description || "Dienstleistung";
    
    // Fallback merge for old 2-column descriptions
    const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
    const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);
    if (leftMatch || rightMatch) {
      const left = leftMatch ? leftMatch[1] : "";
      const right = rightMatch ? rightMatch[1] : "";
      desc = left + (left && right ? " | " : "") + right;
    } else {
      const singleMatch = desc.match(/<!-- SINGLE_COL_START -->([\s\S]*?)<!-- SINGLE_COL_END -->/);
      if (singleMatch) {
        desc = singleMatch[1];
      }
    }

    const cleanSingle = cleanHtmlForPdf(desc);
    const descriptionLines = wrapRichText(cleanSingle, 190, fontSet, 8);
    
    const lineSpacing = 11;
    const maxLines = Math.max(descriptionLines.length, 1);
    
    const totalColHeight = maxLines * lineSpacing;
    const rowHeight = Math.max(20, totalColHeight);
    
    if (currentY - rowHeight < 100) {
      addNewPage(true);
    }

    // Pos
    currentPage.drawText(String(idx + 1), { x: 55, y: currentY, size: 9, font: fontRegular, color: black });
    
    // Quantity
    drawTextRight(String(item.quantity), 295, currentY, 9, fontRegular, black);
    
    // Unit
    const unit = item.unit_code === "HUR" ? tPDF("std") : (item.unit_code === "H87" ? tPDF("stk") : tPDF("pausch"));
    drawTextRight(unit, 335, currentY, 9, fontRegular, black);
    
    // Unit Price
    const uPrice = `${Number(item.unit_price).toFixed(2)} ${currencySymbol}`;
    drawTextRight(uPrice, 410, currentY, 9, fontRegular, black);
    
    // VAT
    drawTextRight(`${item.vat_rate}%`, 455, currentY, 9, fontRegular, black);
    
    // Total
    const totalNetStr = `${Number(item.total_net || (item.quantity * item.unit_price)).toFixed(2)} ${currencySymbol}`;
    drawTextRight(totalNetStr, 540, currentY, 9, fontBold, black);

    // Draw description lines
    for (let i = 0; i < maxLines; i++) {
      const lineY = currentY - i * lineSpacing;
      if (lineY < 80) break;
      if (descriptionLines[i]) {
        drawRichTextLine(currentPage, descriptionLines[i], 85, lineY, 8, fontSet, black);
      }
    }
    
    // Underline row
    currentPage.drawLine({
      start: { x: 50, y: currentY - rowHeight + 4 },
      end: { x: 545, y: currentY - rowHeight + 4 },
      thickness: 0.5,
      color: borderGray,
    });
    
    currentY -= (rowHeight + 6);
  });

  // TOTALS BLOCK
  // Group by VAT rate
  const vatGroups: { vatRate: number; netAmount: number; vatAmount: number }[] = [];
  try {
    const groups: Record<number, { vatRate: number; netAmount: number; vatAmount: number }> = {};
    lineItems.forEach((item: InvoiceLineItem) => {
      const rate = typeof item.vat_rate === 'number' ? item.vat_rate : (invoice.vat_rate ?? 19);
      const isInclusive = !!invoice.is_vat_inclusive;
      
      let net = 0;
      let vat = 0;
      const qty = typeof item.quantity === 'number' ? item.quantity : 1;
      const uPrice = typeof item.unit_price === 'number' ? item.unit_price : 0;
      if (typeof item.total_net === 'number') {
        net = item.total_net;
      } else {
        if (isInclusive) {
          net = (qty * uPrice) / (1 + rate / 100);
        } else {
          net = qty * uPrice;
        }
        net = Math.round((net + Number.EPSILON) * 100) / 100;
      }
      vat = net * (rate / 100);
      vat = Math.round((vat + Number.EPSILON) * 100) / 100;

      if (!groups[rate]) {
        groups[rate] = { vatRate: rate, netAmount: 0, vatAmount: 0 };
      }
      groups[rate].netAmount += net;
      groups[rate].vatAmount += vat;
    });

    Object.values(groups).forEach(g => {
      vatGroups.push({
        vatRate: g.vatRate,
        netAmount: Math.round((g.netAmount + Number.EPSILON) * 100) / 100,
        vatAmount: Math.round((g.vatAmount + Number.EPSILON) * 100) / 100,
      });
    });
    vatGroups.sort((a, b) => b.vatRate - a.vatRate);
  } catch (err) {
    console.error("Error computing vat groups for PDF:", err);
  }

  let totalsY = currentY - 15;
  const numVatRows = vatGroups.length > 0 ? vatGroups.length : 1;
  const totalBlockHeight = 15 + (numVatRows * 14) + 22 + 10;
  if (totalsY - totalBlockHeight < 100) {
    addNewPage(false);
    totalsY = currentY - 15;
  }
  
  currentPage.drawText(tPDF("subtotal_net"), { x: 335, y: totalsY, size: 8, font: fontBold, color: darkGray });
  drawTextRight(`${Number(invoice.total_net_amount || 0).toFixed(2)} ${currencySymbol}`, 540, totalsY, 9, fontRegular, black);

  if (vatGroups.length > 0) {
    vatGroups.forEach((group) => {
      totalsY -= 14;
      currentPage.drawText(`${tPDF("plus_vat")} (${group.vatRate.toFixed(2)}%):`, { x: 335, y: totalsY, size: 8, font: fontBold, color: darkGray });
      drawTextRight(`${Number(group.vatAmount).toFixed(2)} ${currencySymbol}`, 540, totalsY, 9, fontRegular, black);
    });
  } else {
    totalsY -= 14;
    currentPage.drawText(`${tPDF("plus_vat")} (${invoice.vat_rate || 19}%):`, { x: 335, y: totalsY, size: 8, font: fontBold, color: darkGray });
    drawTextRight(`${Number(invoice.total_vat_amount || 0).toFixed(2)} ${currencySymbol}`, 540, totalsY, 9, fontRegular, black);
  }

  totalsY -= 22;
  currentPage.drawRectangle({
    x: 330,
    y: totalsY - 6,
    width: 215,
    height: 22,
    color: slate50,
    borderColor: borderGray,
    borderWidth: 1,
  });
  currentPage.drawText(tPDF("total_amount"), { x: 335, y: totalsY + 1, size: 9, font: fontBold, color: black });
  const grossStr = `${Number(invoice.total_gross_amount || 0).toFixed(2)} ${currencySymbol}`;
  drawTextRight(grossStr, 540, totalsY + 1, 9, fontBold, black);

  currentY = totalsY - 15;

  // CLOSING TEXT / TEMPLATE (Managed dynamically by user)
  if (invoice.closing_text) {
    currentY -= 25;
    const cleanClosing = cleanHtmlForPdf(invoice.closing_text || "");
    const wrappedClosing = wrapRichText(cleanClosing, 495, fontSet, 9);
    wrappedClosing.forEach((line) => {
      if (currentY < 100) {
        addNewPage(false);
        currentY = 780;
      }
      drawRichTextLine(currentPage, line, 50, currentY, 9, fontSet, black);
      currentY -= 12;
    });
  }

  // STATIC FOOTER AT BOTTOM - EXACT MATCH OF HTML THREE-COLUMN GRID
  pages.forEach((p, idx) => {
    const footerY = 55;
    p.drawLine({
      start: { x: 50, y: footerY + 20 },
      end: { x: 545, y: footerY + 20 },
      thickness: 0.5,
      color: slate200,
    });

    // Column 1: Tax columns
    p.drawText(tPDF("tax_and_vat_id"), { x: 50, y: footerY + 10, size: 7, font: fontBold, color: darkGray });
    const cleanedVatId = vatId ? vatId.trim() : "";
    const cleanedTaxNo = taxNumber ? taxNumber.trim() : "";
    
    let currentFooterTextY = footerY;
    if (cleanedVatId) {
      p.drawText(`${tPDF("vat_id_label")} ${cleanedVatId}`, { x: 50, y: currentFooterTextY, size: 7, font: fontRegular, color: darkGray });
      currentFooterTextY -= 10;
    }
    if (cleanedTaxNo) {
      p.drawText(`${tPDF("tax_number_label")} ${cleanedTaxNo}`, { x: 50, y: currentFooterTextY, size: 7, font: fontRegular, color: darkGray });
    } else if (!cleanedVatId) {
      p.drawText(`${tPDF("vat_id_label")} DE999999999`, { x: 50, y: currentFooterTextY, size: 7, font: fontRegular, color: darkGray });
    }

    // Column 2: Bank connection
    p.drawText(tPDF("bank_connection"), { x: 230, y: footerY + 10, size: 7, font: fontBold, color: darkGray });
    p.drawText(`IBAN: ${iban}`, { x: 230, y: footerY, size: 7, font: fontRegular, color: darkGray });
    
    let displayBank = myCompany?.bank_name || "Sparkasse Berlin";
    if (displayBank === "Unbekannte Bank") {
      displayBank = locale === "en" ? "Unknown Bank" : "Unbekannte Bank";
    }
    p.drawText(`BIC: ${bic} • ${tPDF("bank_name")} ${displayBank}`, { x: 230, y: footerY - 10, size: 7, font: fontRegular, color: darkGray });

    // Column 3: Contact & Support
    const rightFooterX = 545;
    const senderPhone = myCompany?.phone_number || "+49 30 123 456 78";
    const senderWebsite = myCompany?.website || "www.louis-crm.de";

    const drawTextRightOnPage = (pObj: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: RGB) => {
      const width = font.widthOfTextAtSize(text, size);
      pObj.drawText(text, { x: x - width, y, size, font, color });
    };

    drawTextRightOnPage(p, tPDF("contact_support"), rightFooterX, footerY + 10, 7, fontBold, darkGray);
    drawTextRightOnPage(p, senderEmail, rightFooterX, footerY, 7, fontRegular, darkGray);
    drawTextRightOnPage(p, senderPhone, rightFooterX, footerY - 10, 7, fontRegular, darkGray);
    drawTextRightOnPage(p, senderWebsite, rightFooterX, footerY - 20, 7, fontRegular, darkGray);

    // Page Number
    const totalPagesStr = `${pages.length}`;
    const pageNumLabel = `${idx + 1} / ${totalPagesStr}`;
    drawTextRightOnPage(p, pageNumLabel, rightFooterX, footerY - 30, 7, fontRegular, darkGray);
  });

  return await pdfDoc.save();
}

export async function generateInvoiceFilesOnDisk(invoiceId: string, tenantId: string, locale: string = "de"): Promise<void> {
  try {
    let invoice: InvoicePDFContext | undefined;
    if (isUsingFallback) {
      const found = fallbackStore.invoices.find(i => i.id_uuid === invoiceId);
      if (found) {
        invoice = { ...found } as InvoicePDFContext;
        if (invoice) {
          if (invoice.associated_company_id) {
            const co = fallbackStore.companies.find(c => c.id_uuid === invoice.associated_company_id);
            invoice.entityType = "companies";
            invoice.entityId = co?.id_uuid;
            invoice.entityName = co?.full_legal_name;
            invoice.co_street = co?.street;
            invoice.co_house_number = co?.house_number;
            invoice.co_postal_code = co?.postal_code;
            invoice.co_city = co?.city;
            invoice.co_country_code = co?.country_code;
          } else if (invoice.associated_contact_id) {
            const ct = fallbackStore.contacts.find(c => c.id_uuid === invoice.associated_contact_id);
            invoice.entityType = "contacts";
            invoice.entityId = ct?.id_uuid;
            invoice.entityName = ct?.full_legal_name;
            invoice.ct_street = ct?.street;
            invoice.ct_house_number = ct?.house_number;
            invoice.ct_postal_code = ct?.postal_code;
            invoice.ct_city = ct?.city;
          }
        }
      }
    } else {
      const invoiceRes = await pool.query(`
        SELECT i.*,
               co.full_legal_name as co_name,
               co.street as co_street,
               co.house_number as co_house_number,
               co.postal_code as co_postal_code,
               co.city as co_city,
               co.country_code as co_country_code,
               co.email_address as co_email_address,
               ct.full_legal_name as ct_name,
               ct.street as ct_street,
               ct.house_number as ct_house_number,
               ct.postal_code as ct_postal_code,
               ct.city as ct_city,
               ct.email_address as ct_email_address
        FROM fiscal_billing_invoices i
        LEFT JOIN core_registry_companies co ON i.associated_company_id = co.id_uuid
        LEFT JOIN core_registry_contacts ct ON i.associated_contact_id = ct.id_uuid
        WHERE i.id_uuid = $1 AND (i.tenant_id = $2 OR i.tenant_id = '1')
      `, [invoiceId, tenantId]);
      invoice = invoiceRes.rows[0];
      if (invoice) {
        if (invoice.associated_company_id) {
          invoice.entityType = "companies";
          invoice.entityId = invoice.associated_company_id;
          invoice.entityName = invoice.co_name;
        } else if (invoice.associated_contact_id) {
          invoice.entityType = "contacts";
          invoice.entityId = invoice.associated_contact_id;
          invoice.entityName = invoice.ct_name;
        }
      }
    }

    if (!invoice || !invoice.entityId) {
      console.warn("[generateInvoiceFilesOnDisk] Invoice or entity not found, or missing recipient.");
      return;
    }

    // Retrieve sender company settings
    let myCompany: z.infer<typeof MyCompanyFullSchema> | null = null;
    if (isUsingFallback) {
      myCompany = fallbackStore.myCompany;
    } else {
      const mcRes = await pool.query(`
        SELECT * FROM core_registry_my_company WHERE tenant_id = $1 OR tenant_id = '1' LIMIT 1
      `, [tenantId]);
      myCompany = mcRes.rows[0];
    }

    // Generate ZUGFeRD/XRechnung XML — profile auto-detected via Leitweg-ID presence
    const xmlProfile = inferProfileFromInvoice(invoice);
    console.log(`[generateInvoiceFilesOnDisk] Using XML profile: ${xmlProfile} for invoice ${invoice.invoice_number}`);
    const xmlData = generateZugferdXML(invoice, myCompany, xmlProfile);
    const entityStoragePath = getEntityStoragePath(invoice.entityType!, invoice.entityId!, invoice.entityName!, tenantId);
    
    // 1. Save in traditional relative "invoices" subdirectory for full fallback compatibility
    const storageDir = path.join(entityStoragePath, "invoices");
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const xmlPath = path.join(storageDir, `zugferd_${invoiceId}.xml`);
    const pdfPath = path.join(storageDir, `invoice_${invoiceId}.pdf`);
    fs.writeFileSync(xmlPath, xmlData);

    // 2. Save directly inside high-level storage path under human-readable name for direct File Browser UI visibility
    const cleanNum = invoice.invoice_number.replace(/[^a-zA-Z0-9_-]/g, '_');
    const displayPdfPath = path.join(entityStoragePath, `rechnung_${cleanNum}.pdf`);
    const displayXmlPath = path.join(entityStoragePath, `zugferd_${cleanNum}.xml`);
    fs.writeFileSync(displayXmlPath, xmlData);

    // Render standard visual PDF using pdf-lib
    const visualPdfBuffer = await buildInvoicePDFBuffer(invoice, myCompany, locale);
    const tempVisualPath = path.join(entityStoragePath, `temp_visual_${invoiceId}.pdf`);
    const tempPdfaPath = path.join(entityStoragePath, `temp_pdfa_${invoiceId}.pdf`);
    fs.writeFileSync(tempVisualPath, Buffer.from(visualPdfBuffer));

    // Validation gate: any artifact persisted to a data vault MUST pass
    // Mustang's validator. The audit log is always written, success or failure,
    // so GoBD auditors can trace every generation attempt.
    const validationLogPath = path.join(storageDir, `validation_${invoiceId}.log`);
    try {
      // Mustang refuses to overwrite an existing output file (ensureFileNotExists).
      // Remove any leftover from a previous attempt so re-issuing an invoice
      // succeeds idempotently. The validation gate below remains the only writer
      // of the final artifact, so this is safe.
      try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (_) {}
      try { if (fs.existsSync(displayPdfPath)) fs.unlinkSync(displayPdfPath); } catch (_) {}
      try { if (fs.existsSync(tempPdfaPath)) fs.unlinkSync(tempPdfaPath); } catch (_) {}

      // Step 1: normalize the pdf-lib output into a real PDF/A-3 via Ghostscript.
      // This fixes the font-width inconsistencies pdf-lib leaves behind that
      // make veraPDF reject the document (ISO 19005-3 §6.2.11.5 / §6.2.11.7.2).
      await normalizePdfA(tempVisualPath, tempPdfaPath);

      // Step 2: Mustang attaches the XML to the already-valid PDF/A-3 container.
      await mergePdfAndXmlWithMustang(tempPdfaPath, xmlPath, pdfPath, xmlProfile);

      // Gate: validate the merged PDF before exposing it anywhere
      const report = await validateInvoicePdf(pdfPath);
      const summary =
        `Invoice ${invoice.invoice_number} (${invoiceId})\n` +
        `Profile: ${xmlProfile}\n` +
        `Generated: ${new Date().toISOString()}\n` +
        `Result: ${report.ok ? "VALID" : "INVALID"}\n` +
        `Errors (${report.errors.length}):\n${report.errors.map((e) => "  - " + e).join("\n") || "  (none)"}\n` +
        `Warnings (${report.warnings.length}):\n${report.warnings.map((w) => "  - " + w).join("\n") || "  (none)"}\n` +
        `Notices (${report.notices.length}):\n${report.notices.map((n) => "  - " + n).join("\n") || "  (none)"}\n` +
        `\n----- Raw validator output -----\n${report.raw}\n`;
      fs.writeFileSync(validationLogPath, summary);

      if (!report.ok) {
        console.error(`[generateInvoiceFilesOnDisk] Validation gate FAILED for ${invoice.invoice_number}. See ${validationLogPath}`);
        // Do not ship a non-compliant artifact
        try { if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath); } catch (_) {}
        try { if (fs.existsSync(displayPdfPath)) fs.unlinkSync(displayPdfPath); } catch (_) {}
        throw new InvoiceValidationError(
          `invoice_failed_validation: ${report.errors.slice(0, 3).join("; ") || "validator returned non-valid summary"}`,
          "INVOICE_FAILED_VALIDATION",
          report,
          validationLogPath
        );
      }

      // Copy the certified merged PDF/A-3b container to the File Browser display location
      fs.copyFileSync(pdfPath, displayPdfPath);
      console.log(`[generateInvoiceFilesOnDisk] Successfully compiled, merged AND validated ZUGFeRD/XRechnung PDF for ${invoice.invoice_number}.`);
    } catch (mustangErr: unknown) {
      const errorMessage = mustangErr instanceof Error ? mustangErr.message : String(mustangErr);
      console.error(`[generateInvoiceFilesOnDisk] Mustang pipeline failure: ${errorMessage}`, mustangErr);
      // Clean up potentially corrupt/incomplete files to avoid delivering corrupt outputs
      if (fs.existsSync(pdfPath)) {
        try { fs.unlinkSync(pdfPath); } catch (_) {}
      }
      if (fs.existsSync(displayPdfPath)) {
        try { fs.unlinkSync(displayPdfPath); } catch (_) {}
      }
      // Re-throw to block and notify user/system instead of falling back to raw visual PDF
      throw mustangErr;
    } finally {
      // Clean up temporary visual + PDF/A intermediate files immediately
      try {
        if (fs.existsSync(tempVisualPath)) fs.unlinkSync(tempVisualPath);
        if (fs.existsSync(tempPdfaPath)) fs.unlinkSync(tempPdfaPath);
      } catch (cleanErr) {
        console.error("[generateInvoiceFilesOnDisk] Error deleting temporary file:", cleanErr);
      }
    }

    console.log(`[generateInvoiceFilesOnDisk] Successfully compiled and saved PDF/XML files on disk for Invoice: ${invoice.invoice_number}`);
  } catch (err) {
    console.error("[generateInvoiceFilesOnDisk] Error creating file artifacts:", err);
    throw err;
  }
}

/**
 * Structured result of a Mustang `--action validate` run.
 * `ok` reflects both the JVM exit code AND the absence of <error> entries in
 * the structured XML report, so a code-0 run with messages still counts as
 * failed if any error severity appears.
 */
export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  notices: string[];
  raw: string;
}

/**
 * Run Mustang `--action validate` against a freshly-merged PDF/A-3b file and
 * return a structured report. Used by the validation gate before any PDF is
 * exposed to the GoBD vault.
 *
 * Mustang emits an XML report on stdout shaped like:
 *   <validation>
 *     <pdf><summary status="valid|invalid" /></pdf>
 *     <xml><messages><error>...</error><warning>...</warning></messages></xml>
 *     <summary status="valid|invalid" />
 *   </validation>
 */
export async function validateInvoicePdf(pdfPath: string): Promise<ValidationReport> {
  await ensureMustangCli();
  const jarPath = path.join(process.cwd(), "mustang-cli.jar");

  return new Promise<ValidationReport>((resolve) => {
    const args = ["-jar", jarPath, "--action", "validate", "--source", pdfPath, "--disable-file-logging"];
    const child = spawn("java", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdoutData = "";
    let stderrData = "";
    child.stdout.on("data", (chunk) => { stdoutData += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderrData += chunk.toString(); });

    child.on("error", (err) => {
      resolve({
        ok: false,
        errors: [`Failed to start validator JVM: ${err.message}`],
        warnings: [],
        notices: [],
        raw: stderrData,
      });
    });

    child.on("close", (code) => {
      const combined = `${stdoutData}\n${stderrData}`;

      // Extract message bodies. The validator's XML wraps content in CDATA or
      // plain text; we capture everything between the tags non-greedy.
      const extract = (tag: string): string[] => {
        const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
        const out: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(combined)) !== null) {
          const text = m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
          if (text) out.push(text);
        }
        return out;
      };

      const errors = extract("error");
      const warnings = extract("warning");
      const notices = extract("notice");

      // Strict: the run must exit 0, carry no <error> entries, AND contain no
      // <summary status="invalid"> anywhere. Mustang emits three summaries
      // (pdf, xml, overall); a failing PDF/A section must block delivery too —
      // an earlier version only checked for the presence of any "valid"
      // summary, which let PDF/A failures slip through with a false VALID.
      const anyInvalid = /<summary[^>]*status="invalid"/.test(combined);
      const ok = code === 0 && errors.length === 0 && !anyInvalid;

      resolve({ ok, errors, warnings, notices, raw: combined });
    });
  });
}

/**
 * Resolve the Ghostscript executable name across platforms.
 * Linux/macOS: "gs". Windows: "gswin64c" / "gswin32c".
 * Override with the GHOSTSCRIPT_BIN env var if needed.
 */
function ghostscriptBin(): string {
  if (process.env.GHOSTSCRIPT_BIN) return process.env.GHOSTSCRIPT_BIN;
  return process.platform === "win32" ? "gswin64c" : "gs";
}

/**
 * Normalize a plain PDF (as produced by pdf-lib) into a genuine PDF/A-3
 * document using Ghostscript. This is the step that fixes the font-width
 * inconsistencies pdf-lib leaves behind (veraPDF ISO 19005-3 §6.2.11.5),
 * re-embeds all fonts with consistent /Widths and a proper OutputIntent.
 *
 * Mustang's --action combine then only has to attach the XML to an already
 * valid PDF/A-3 container.
 */
/**
 * Locate Ghostscript's bundled sRGB ICC profile (absolute path). A relative
 * filename does NOT work under SAFER mode (>= gs 9.50): the `file` operator is
 * sandboxed and we must reference + whitelist the exact absolute path.
 * Locations vary by gs version/distro.
 */
function ghostscriptIccProfile(): string | null {
  const fixed = [
    "/usr/share/color/icc/ghostscript/srgb.icc",
    "/usr/share/color/icc/sRGB.icc",
  ];
  for (const f of fixed) {
    if (fs.existsSync(f)) return f;
  }
  const roots = ["/usr/share/ghostscript", "/usr/local/share/ghostscript", "/var/lib/ghostscript"];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root)) {
        const icc = path.join(root, entry, "iccprofiles", "srgb.icc");
        if (fs.existsSync(icc)) return icc;
      }
    } catch (_) { /* ignore */ }
  }
  return null;
}

export async function normalizePdfA(inputPdfPath: string, outputPdfPath: string): Promise<void> {
  const gs = ghostscriptBin();
  const defTemplate = path.join(process.cwd(), "scripts", "PDFA_def.ps");
  if (!fs.existsSync(defTemplate)) {
    throw new Error(`PDF/A definition template missing at ${defTemplate}`);
  }
  const iccProfile = ghostscriptIccProfile();
  if (!iccProfile) {
    throw new Error(
      "Could not locate Ghostscript's srgb.icc profile. Ensure the ghostscript package is installed " +
      "(it ships the ICC profiles) or set the OutputIntent profile manually."
    );
  }

  // Materialize a run-specific def.ps with the absolute ICC path injected.
  const runtimeDefPs = `${outputPdfPath}.def.ps`;
  const tmpl = fs.readFileSync(defTemplate, "utf-8").replace(/__ICC_PROFILE_PATH__/g, iccProfile);
  fs.writeFileSync(runtimeDefPs, tmpl);

  return new Promise<void>((resolve, reject) => {
    const finish = (fn: () => void) => {
      try { if (fs.existsSync(runtimeDefPs)) fs.unlinkSync(runtimeDefPs); } catch (_) {}
      fn();
    };
    // --permit-file-read whitelists the exact ICC path for the SAFER sandbox,
    // which otherwise blocks the `file` read with /invalidfileaccess. The long
    // option must precede the other arguments.
    const args = [
      `--permit-file-read=${iccProfile}`,
      "-dPDFA=3",
      "-dBATCH",
      "-dNOPAUSE",
      "-dNOOUTERSAVE",
      "-dPDFACompatibilityPolicy=1",
      "-sColorConversionStrategy=RGB",
      "-sDEVICE=pdfwrite",
      "-dAutoRotatePages=/None",
      `-sOutputFile=${outputPdfPath}`,
      runtimeDefPs,
      inputPdfPath,
    ];

    const child = spawn(gs, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderrData = "";
    let stdoutData = "";
    child.stdout.on("data", (c) => { stdoutData += c.toString(); });
    child.stderr.on("data", (c) => { stderrData += c.toString(); });

    child.on("error", (err: unknown) => {
      const errCode = (err as Record<string, unknown>)?.code;
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errCode === "ENOENT") {
        finish(() => reject(new Error(
          `Ghostscript ('${gs}') not found on PATH. Install it (apt-get install ghostscript / choco install ghostscript) ` +
          `or set GHOSTSCRIPT_BIN. It is required to produce PDF/A-3 compliant invoices.`
        )));
      } else {
        finish(() => reject(new Error(`Failed to start Ghostscript: ${errMsg}`)));
      }
    });

    child.on("close", (code) => {
      if (code !== 0 || !fs.existsSync(outputPdfPath)) {
        finish(() => reject(new Error(`Ghostscript PDF/A conversion failed (code ${code}). Stderr: ${stderrData || stdoutData}`)));
      } else {
        finish(() => {
          console.log(`[Ghostscript] Normalized to PDF/A-3 (ICC: ${iccProfile}): ${outputPdfPath}`);
          resolve();
        });
      }
    });
  });
}

/**
 * Verify that mustang-cli.jar is bundled with the deployment.
 * No runtime download — the jar must be provisioned at build time via
 * `npm run setup-assets` (development) or COPY in the Dockerfile (production).
 */
export async function ensureMustangCli(): Promise<void> {
  const jarPath = path.join(process.cwd(), "mustang-cli.jar");
  if (!fs.existsSync(jarPath)) {
    throw new Error(
      `mustang-cli.jar is not present at ${jarPath}. ` +
      `Run \`npm run setup-assets\` once to vendor it. ` +
      `Runtime downloads are disabled to comply with the project's zero-egress policy.`
    );
  }
  const stats = fs.statSync(jarPath);
  if (stats.size < 1024 * 1024) {
    throw new Error(
      `mustang-cli.jar at ${jarPath} looks truncated (size ${stats.size} bytes). ` +
      `Delete the file and run \`npm run setup-assets\` again.`
    );
  }
}

/**
 * Map our internal profile identifier to the Mustang CLI `--profile` value.
 * Mustang 2.x rejects full names — it expects the single-letter shortcuts
 * shown as `<X>` in the help text. For ZUGFeRD v2:
 *   M = Minimum, W = Basic WL, B = Basic, C = CIUS,
 *   E = EN16931 (formerly "Comfort"), X = XRechnung,
 *   F = EXTENDED-CTC-FR, T = EXTENDED.
 */
function mustangProfileFlag(profile: XmlProfile): string {
  switch (profile) {
    case "xrechnung-3.0":
      return "X";
    case "zugferd-comfort":
    default:
      return "E";
  }
}

export async function mergePdfAndXmlWithMustang(
  visualPdfPath: string,
  xmlPath: string,
  outputPath: string,
  profile: XmlProfile = "zugferd-comfort"
): Promise<void> {
  // 1. Zod path validation with strict constraints
  const PathSchema = z.object({
    visualPdfPath: z.string().min(1).refine((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }, { message: "Input visual PDF file path does not exist or is not a valid file" }),
    xmlPath: z.string().min(1).refine((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isFile();
      } catch {
        return false;
      }
    }, { message: "Input Factur-X/ZUGFeRD XML file path does not exist or is not a valid file" }),
    outputPath: z.string().min(1),
  });

  const validated = PathSchema.parse({
    visualPdfPath,
    xmlPath,
    outputPath,
  });

  // 2. Ensure Mustang CLI jar exists
  await ensureMustangCli();
  const jarPath = path.join(process.cwd(), "mustang-cli.jar");
  const mustangProfile = mustangProfileFlag(profile);

  // 3. Execute Mustang CLI 2.x with the documented combine action.
  //    --no-additional-attachments is required: without it, Mustang prompts on
  //    stdin asking whether to attach extra files, which hangs the JVM
  //    indefinitely in a non-interactive process.
  //    --disable-file-logging keeps the run silent on disk.
  return new Promise<void>((resolve, reject) => {
    const args = [
      "-jar",
      jarPath,
      "--action",
      "combine",
      "--source",
      validated.visualPdfPath,
      "--source-xml",
      validated.xmlPath,
      "--out",
      validated.outputPath,
      // Factur-X format names the embedded XML "factur-x.xml" as required by
      // ZUGFeRD 2.4 / EN 16931. "zf" would embed it as "zugferd-invoice.xml",
      // which the eu-rechnung.de / KoSIT validators flag as non-conformant.
      // Mustang ties Factur-X to --version 1 (Factur-X 1.0 == ZUGFeRD 2.x).
      "--format",
      "fx",
      "--version",
      "1",
      "--profile",
      mustangProfile,
      "--no-additional-attachments",
      "--disable-file-logging",
      // pdf-lib emits a plain PDF rather than a PDF/A. Without this flag
      // Mustang's ZUGFeRDExporterFromPDFA throws "PDF-A version not supported".
      // With it, Mustang converts the input to PDF/A-3 as part of combine.
      "--ignorefileextension",
    ];

    console.log(`[MustangPDF] Executing command: java ${args.join(" ")}`);

    const child = spawn("java", args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    child.on("error", (err) => {
      console.error("[MustangPDF] Failed to start Java process:", err);
      reject(new Error(`Failed to start Mustang CLI Java process: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`[MustangPDF] Java process exited with code ${code}. Stderr: ${stderrData}`);
        reject(new Error(`Mustang CLI process exited with non-zero code ${code}. Stderr: ${stderrData || stdoutData || "Unknown error"}`));
      } else {
        // Double-check stderr for any thrown exception/stack traces or semantic errors
        const lowerStderr = stderrData.toLowerCase();
        if (lowerStderr.includes("exception") || lowerStderr.includes("error") || lowerStderr.includes("failed")) {
          console.error(`[MustangPDF] Mustang CLI succeeded with code 0 but reported errors in stderr: ${stderrData}`);
          reject(new Error(`Mustang CLI reported errors in stderr: ${stderrData}`));
        } else {
          // Mustang stamps Factur-X as PDF/A-3U. The pdf-lib visual layer leaves
          // a few glyphs without a ToUnicode mapping (a pdf-lib limitation),
          // which only violates the U (Unicode) conformance level — never B.
          // ZUGFeRD / Factur-X accept PDF/A-3B, and the document genuinely meets
          // B (Ghostscript fixed font widths and the OutputIntent), so we
          // declare the accurate conformance level: B. The PDF/A XMP metadata
          // stream is required to be uncompressed, so this same-length byte
          // patch preserves all xref offsets.
          try {
            const buf = fs.readFileSync(validated.outputPath);
            const patched = buf.toString("latin1")
              .replace(/(<pdfaid:conformance>)U(<\/pdfaid:conformance>)/g, "$1B$2")
              .replace(/(pdfaid:conformance=")U(")/g, "$1B$2");
            const outBuf = Buffer.from(patched, "latin1");
            if (outBuf.length === buf.length) {
              fs.writeFileSync(validated.outputPath, outBuf);
              console.log("[MustangPDF] Declared PDF/A-3 conformance level B.");
            }
          } catch (patchErr) {
            console.warn("[MustangPDF] Could not adjust PDF/A conformance level:", patchErr);
          }
          console.log(`[MustangPDF] Successfully merged PDF/A-3b invoice via Mustang CLI! Output: ${validated.outputPath}`);
          resolve();
        }
      }
    });
  });
}
