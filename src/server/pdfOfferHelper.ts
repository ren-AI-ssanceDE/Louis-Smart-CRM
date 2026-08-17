import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PDFDocument, rgb, PDFFont, RGB, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Offer, Company, Contact, OfferLineItem } from "../types.js";

export interface MyCompany {
  full_legal_name?: string | null;
  street?: string | null;
  house_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country_code?: string | null;
  tax_vat_id?: string | null;
  tax_number?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  iban?: string | null;
  bic_swift?: string | null;
  bank_name?: string | null;
  website?: string | null;
  logo_url?: string | null;
}

// Translations for quote-related labels
const pdfTranslations: Record<string, Record<string, string>> = {
  de: {
    offer: "ANGEBOT",
    offer_number: "Angebotsnummer:",
    date: "Datum:",
    valid_until: "Gültig bis:",
    payment_term: "Zahlungsziel:",
    bank_account: "Bankkonto:",
    days: "Tage",
    pos: "Pos.",
    description: "Leistung / Artikel",
    quantity: "Menge",
    unit: "Einheit",
    unit_price: "Einzelpreis",
    vat: "MwSt.",
    total_net: "Gesamt",
    std: "Std.",
    stk: "Stk.",
    pausch: "Pausch.",
    subtotal_net: "Summe Netto:",
    plus_vat: "Umsatzsteuer (19%):",
    total_amount: "GESAMTSUMME:",
    tax_and_vat_id: "STEUERNUMMER & UST-IDNR.",
    vat_id_label: "USt-IdNr.:",
    tax_number_label: "Steuernummer:",
    bank_connection: "BANKVERBINDUNG",
    bank_name: "Bank:",
    contact_support: "KONTAKT & SUPPORT",
    customer: "Kunde",
    germany: "Deutschland",
    phone_label: "Tel.:"
  },
  en: {
    offer: "OFFER",
    offer_number: "Offer Number:",
    date: "Date:",
    valid_until: "Valid Until:",
    payment_term: "Payment Term:",
    bank_account: "Bank Account:",
    days: "Days",
    pos: "Pos",
    description: "Service / Item",
    quantity: "Qty",
    unit: "Unit",
    unit_price: "Unit Price",
    vat: "VAT",
    total_net: "Total Net",
    std: "Hrs.",
    stk: "Pcs.",
    pausch: "Flat",
    subtotal_net: "Subtotal Net:",
    plus_vat: "VAT Amount:",
    total_amount: "TOTAL AMOUNT:",
    tax_and_vat_id: "TAX ID & VAT ID",
    vat_id_label: "VAT Reg No:",
    tax_number_label: "Tax No:",
    bank_connection: "BANK DETAILS",
    bank_name: "Bank:",
    contact_support: "CONTACT & SUPPORT",
    customer: "Customer",
    germany: "Germany",
    phone_label: "Tel:"
  }
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

function stripHtml(html: string): string {
  if (!html) return "";
  let text = html;
  
  // 1. Literal newlines in HTML source are preserved as newlines (supports plain text input)
  text = text.replace(/\r\n/g, "\n");
  text = text.replace(/\r/g, "\n");

  // Handle double column markers (strip or separate)
  text = text.replace(/<!-- COL_LEFT_START -->/g, "");
  text = text.replace(/<!-- COL_LEFT_END -->/g, "\n");
  text = text.replace(/<!-- COL_RIGHT_START -->/g, "");
  text = text.replace(/<!-- COL_RIGHT_END -->/g, "\n");
  text = text.replace(/<!-- SINGLE_COL_START -->/g, "");
  text = text.replace(/<!-- SINGLE_COL_END -->/g, "");
  
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

  // 3. Strip all other HTML tags EXCEPT <b> and <i>
  text = text.replace(/<\/?(?!(?:b|i)\b)[a-z0-9-]+[^>]*>/gi, "");

  // 4. Unescape common HTML entities
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
}

async function ensureFontAssets(): Promise<void> {
  const assetsDir = path.join(process.cwd(), "src/assets");
  const fontsDir = path.join(assetsDir, "fonts");

  if (!fs.existsSync(fontsDir)) {
    fs.mkdirSync(fontsDir, { recursive: true });
  }

  const fontRegularPath = path.join(fontsDir, "Lato-Regular.ttf");
  const fontBoldPath = path.join(fontsDir, "Lato-Bold.ttf");

  const missing: string[] = [];
  if (!fs.existsSync(fontRegularPath)) missing.push("Lato-Regular.ttf");
  if (!fs.existsSync(fontBoldPath)) missing.push("Lato-Bold.ttf");

  if (missing.length > 0) {
    throw new Error(
      `Missing bundled fonts for Offer PDF: ${missing.join(", ")}. ` +
      `Please ensure Lato fonts exist or run setup-assets.`
    );
  }
}

export function interpolateOfferText(
  text: string,
  offer: Offer,
  recipientCompany: Company | null,
  recipientContact: Contact | null,
  myCompany: MyCompany | null
): string {
  if (!text) return "";
  
  const companyName = recipientCompany?.full_legal_name || "Neukunde";
  const responsiblePerson = recipientContact 
    ? `${recipientContact.first_name ? recipientContact.first_name + ' ' : ''}${recipientContact.last_name}`
    : (recipientCompany?.responsible_person || "");
  
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const formatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: offer.currency_code || "EUR" });

  return text
    .replace(/\{\{company_name\}\}/g, companyName)
    .replace(/\{\{responsible_person\}\}/g, responsiblePerson)
    .replace(/\{\{offer_number\}\}/g, offer.offer_number)
    .replace(/\{\{valid_until\}\}/g, formatDate(offer.valid_until))
    .replace(/\{\{total_net\}\}/g, formatter.format(offer.total_net_amount))
    .replace(/\{\{total_gross\}\}/g, formatter.format(offer.total_gross_amount))
    .replace(/\{\{my_company_name\}\}/g, myCompany?.full_legal_name || "LOUIS Systems GmbH");
}

export async function buildOfferPDFBuffer(
  offer: Offer,
  recipientCompany: Company | null,
  recipientContact: Contact | null,
  myCompany: MyCompany | null,
  locale: string = "de"
): Promise<Uint8Array> {
  const tPDF = (key: string): string => {
    const lang = locale === "en" ? "en" : "de";
    return pdfTranslations[lang][key] || pdfTranslations["de"][key] || key;
  };

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  await ensureFontAssets();

  const page = pdfDoc.addPage([595.276, 841.890]); // A4 Size (595 x 842 pt)

  const loadedFontsDir = path.join(process.cwd(), "src/assets/fonts");
  const fontRegularPath = path.join(loadedFontsDir, "Lato-Regular.ttf");
  const fontBoldPath = path.join(loadedFontsDir, "Lato-Bold.ttf");
  const fontItalicPath = path.join(loadedFontsDir, "Lato-Italic.ttf");
  const fontBoldItalicPath = path.join(loadedFontsDir, "Lato-BoldItalic.ttf");

  const fontRegularBytes = fs.readFileSync(fontRegularPath);
  const fontBoldBytes = fs.readFileSync(fontBoldPath);
  const fontItalicBytes = fs.readFileSync(fontItalicPath);
  const fontBoldItalicBytes = fs.readFileSync(fontBoldItalicPath);

  const fontRegular = await pdfDoc.embedFont(fontRegularBytes);
  const fontBold = await pdfDoc.embedFont(fontBoldBytes);
  const fontItalic = await pdfDoc.embedFont(fontItalicBytes);
  const fontBoldItalic = await pdfDoc.embedFont(fontBoldItalicBytes);

  const fontSet: FontSet = {
    regular: fontRegular,
    bold: fontBold,
    italic: fontItalic,
    boldItalic: fontBoldItalic
  };

  // Elegant UI Palette (mirroring our Tailwind Slate/Teal setup)
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
  const senderEmail = myCompany?.email_address || "billing@musterfirma.test";
  const senderPhone = myCompany?.phone_number || "+49 30 123 456 78";
  
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

  // DRAW SENDER INFO (Header right)
  drawTextRight(senderName, 545, 780, 11, fontBold, black);
  drawTextRight(streetAndNo, 545, 766, 10, fontRegular, darkGray);
  drawTextRight(`${postalAndCity}, ${countryCode}`, 545, 752, 10, fontRegular, darkGray);

  // Document Title
  drawTextRight(tPDF("offer"), 545, 685, 12, fontBold, black);

  // RECIPIENT ADDRESS BLOCK (Left Column)
  const recipientY = 660;
  
  const rawSenderLine = `${senderName} • ${streetAndNo} • ${postalAndCity}`;
  const maxSenderLineWidth = 260;
  
  // Calculate ideal font size dynamically for sender line
  let senderLineFontSize = 7;
  let currentWidth = fontRegular.widthOfTextAtSize(rawSenderLine, senderLineFontSize);
  while (currentWidth > maxSenderLineWidth && senderLineFontSize > 5) {
    senderLineFontSize -= 0.2;
    currentWidth = fontRegular.widthOfTextAtSize(rawSenderLine, senderLineFontSize);
  }

  currentPage.drawText(rawSenderLine, {
    x: 50,
    y: 675,
    size: senderLineFontSize,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5)
  });
  
  const recipientName = recipientCompany?.full_legal_name || 
                        (recipientContact ? `${recipientContact.first_name ? recipientContact.first_name + ' ' : ''}${recipientContact.last_name}` : "") || 
                        tPDF("customer");
  currentPage.drawText(recipientName, { x: 50, y: recipientY, size: 11, font: fontBold, color: black });

  // Resolve dynamic recipient fields
  const recipientStreet = recipientCompany?.street || recipientContact?.street || "";
  const recipientHouseNumber = recipientCompany?.house_number || recipientContact?.house_number || "";
  const recipientPostalCode = recipientCompany?.postal_code || recipientContact?.postal_code || "";
  const recipientCity = recipientCompany?.city || recipientContact?.city || "";
  let recipientCountry = recipientCompany?.country_code || "DE";

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

  // REPLACEMENT METADATA KASTEN BOX
  const boxX = 330;
  const boxWidth = 215;
  const boxHeight = 80;
  const boxY = 675 - boxHeight; // 595

  currentPage.drawRectangle({
    x: boxX,
    y: boxY,
    width: boxWidth,
    height: boxHeight,
    color: slate50,
    borderColor: borderGray,
    borderWidth: 1,
  });

  const metadataKastenRows = [
    { label: tPDF("offer_number"), val: offer.offer_number || "" },
    { label: tPDF("date"), val: offer.issue_date ? new Date(offer.issue_date).toLocaleDateString(locale === "en" ? "en-US" : "de-DE") : "" },
    { label: tPDF("valid_until"), val: offer.valid_until ? new Date(offer.valid_until).toLocaleDateString(locale === "en" ? "en-US" : "de-DE") : "" },
  ];

  metadataKastenRows.forEach((item, idx) => {
    // Symmetrical, perfectly balanced vertical spacing inside the 80pt high box
    const cy = boxY + 58 - idx * 22;
    
    currentPage.drawText(item.label, { x: boxX + 12, y: cy, size: 8, font: fontBold, color: darkGray });
    drawTextRight(item.val || "--", boxX + boxWidth - 12, cy, 8, fontBold, black);
    
    if (idx < metadataKastenRows.length - 1) {
      const dividerY = boxY + 47 - idx * 22;
      currentPage.drawLine({
        start: { x: boxX + 8, y: dividerY },
        end: { x: boxX + boxWidth - 8, y: dividerY },
        thickness: 0.5,
        color: slate200,
      });
    }
  });

  // Offer Title / Subject Line
  const titleY = boxY - 30;
  currentPage.drawText(offer.title || tPDF("offer"), { x: 50, y: titleY, size: 12, font: fontBold, color: black });

  // Interpolated Introductory Text
  const resolvedIntro = interpolateOfferText(offer.introductory_text || "", offer, recipientCompany, recipientContact, myCompany);
  let tableY = titleY - 20;
  
  if (resolvedIntro) {
    const cleanIntro = stripHtml(resolvedIntro);
    const wrappedIntro = wrapRichText(cleanIntro, 495, fontSet, 9);
    let textY = titleY - 20;
    wrappedIntro.forEach((line) => {
      drawRichTextLine(currentPage, line, 50, textY, 9, fontSet, black);
      textY -= 12;
    });
    tableY = textY - 20;
  }

  let currentY = tableY - 25;

  const addNewPage = (drawHeader: boolean = true): void => {
    const newPage = pdfDoc.addPage([595.276, 841.890]);
    pages.push(newPage);
    currentPageIndex++;
    currentPage = pages[currentPageIndex];
    
    // Draw running header on page 2+
    currentPage.drawText(`${tPDF("offer")} ${offer.offer_number || ""}`, {
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
      currentPage.drawText(tPDF("description"), { x: 80, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("quantity"), { x: 300, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("unit"), { x: 340, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("unit_price"), { x: 390, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("vat"), { x: 450, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });
      currentPage.drawText(tPDF("total_net"), { x: 500, y: tableHeaderY + 1, size: 8, font: fontBold, color: darkGray });

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
    currentPage.drawText(tPDF("description"), { x: 80, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("quantity"), { x: 300, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("unit"), { x: 340, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("unit_price"), { x: 390, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("vat"), { x: 450, y: tableY + 1, size: 8, font: fontBold, color: darkGray });
    currentPage.drawText(tPDF("total_net"), { x: 500, y: tableY + 1, size: 8, font: fontBold, color: darkGray });

    currentY = tableY - 25;
  }

  // DRAW TABLE ROWS
  const formatter = new Intl.NumberFormat(locale === "en" ? "en-US" : "de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  (offer.line_items || []).forEach((item, index) => {
    const isTextPos = !!((item as unknown) as Record<string, unknown>).is_text_position;
    const posStr = String(item.position || (index + 1));
    const qtyStr = isTextPos ? "" : formatter.format(item.quantity);
    const unitStr = isTextPos ? "" : (item.unit_code === "HUR" ? tPDF("std") : (item.unit_code === "PCE" ? tPDF("stk") : item.unit_code));
    const priceStr = isTextPos ? "" : formatter.format(item.unit_price);
    const vatStr = isTextPos ? "" : `${item.vat_rate}%`;
    const rowNetStr = isTextPos ? "" : formatter.format(item.total_net);

    const maxDescWidth = isTextPos ? 450 : 210;
    
    const cleanDesc = stripHtml(item.description || "");
    
    let combinedText = cleanDesc;
    if (!combinedText && !isTextPos) {
      combinedText = "Angebotsposition";
    }

    // Clean up excessive/consecutive newlines in combinedText
    combinedText = combinedText.replace(/\n\s*\n\s*\n+/g, "\n\n").replace(/^[\s\r\n\u200b\u00a0]+|[\s\r\n\u200b\u00a0]+$/g, "");

    let descLines = wrapRichText(combinedText, maxDescWidth, fontSet, 8);
    
    // Trim empty lines from the start and end of descLines to prevent layout vertical shifts
    while (descLines.length > 0 && descLines[0].every((seg) => seg.text.trim() === "")) {
      descLines.shift();
    }
    while (descLines.length > 0 && descLines[descLines.length - 1].every((seg) => seg.text.trim() === "")) {
      descLines.pop();
    }
    
    if (descLines.length === 0) {
      descLines.push(isTextPos ? [] : [{ text: "Angebotsposition", bold: false, italic: false }]);
    }
    
    const rowHeight = descLines.length * 10 + 18;
    if (currentY - rowHeight < 100) {
      addNewPage(true);
    }

    // Draw row cells
    currentPage.drawText(posStr, { x: 55, y: currentY, size: 8, font: fontRegular, color: black });
    
    // Wrapped description (not bolding first line to respect user rules)
    let descY = currentY;
    descLines.forEach((line) => {
      if (descY < 100) return;
      drawRichTextLine(currentPage, line, 80, descY, 8, fontSet, black);
      descY -= 10;
    });

    if (!isTextPos) {
      currentPage.drawText(qtyStr, { x: 300, y: currentY, size: 8, font: fontRegular, color: black });
      currentPage.drawText(unitStr, { x: 340, y: currentY, size: 8, font: fontRegular, color: black });
      currentPage.drawText(priceStr, { x: 390, y: currentY, size: 8, font: fontRegular, color: black });
      currentPage.drawText(vatStr, { x: 450, y: currentY, size: 8, font: fontRegular, color: black });
      currentPage.drawText(rowNetStr, { x: 500, y: currentY, size: 8, font: fontBold, color: black });
    }

    // Draw row divider line below the row's text
    const dividerY = currentY - descLines.length * 10 - 6;
    currentPage.drawLine({
      start: { x: 50, y: dividerY },
      end: { x: 545, y: dividerY },
      thickness: 0.5,
      color: borderGray,
    });

    // Update currentY for the next row
    currentY -= rowHeight;
  });

  // TOTALS SECTION
  // Group by VAT rate
  const vatGroups: { vatRate: number; netAmount: number; vatAmount: number }[] = [];
  try {
    const groups: Record<number, { vatRate: number; netAmount: number; vatAmount: number }> = {};
    (offer.line_items || []).forEach((item: OfferLineItem) => {
      const isTextPos = !!item.is_text_position;
      if (isTextPos) return;
      const rate = typeof item.vat_rate === 'number' ? item.vat_rate : 19;
      
      let net = 0;
      let vat = 0;
      const qty = typeof item.quantity === 'number' ? item.quantity : 1;
      const uPrice = typeof item.unit_price === 'number' ? item.unit_price : 0;
      if (typeof item.total_net === 'number') {
        net = item.total_net;
      } else {
        net = qty * uPrice;
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
    console.error("Error computing vat groups for Offer PDF:", err);
  }

  let totalsY = currentY - 15;
  const numVatRows = vatGroups.length > 0 ? vatGroups.length : 1;
  const totalBlockHeight = 15 + (numVatRows * 14) + 22 + 10;
  if (totalsY - totalBlockHeight < 100) {
    addNewPage(false);
    totalsY = currentY - 15;
  }

  const totalsBoxX = 350;

  // Subtotal Net
  currentPage.drawText(tPDF("subtotal_net"), { x: totalsBoxX, y: totalsY, size: 8, font: fontRegular, color: darkGray });
  drawTextRight(`${formatter.format(offer.total_net_amount)} ${offer.currency_code}`, 545, totalsY, 8, fontBold, black);

  if (vatGroups.length > 0) {
    vatGroups.forEach((group) => {
      totalsY -= 14;
      const label = locale === "en" ? `VAT (${group.vatRate.toFixed(2)}%):` : `Umsatzsteuer (${group.vatRate.toFixed(2)}%):`;
      currentPage.drawText(label, { x: totalsBoxX, y: totalsY, size: 8, font: fontRegular, color: darkGray });
      drawTextRight(`${formatter.format(group.vatAmount)} ${offer.currency_code}`, 545, totalsY, 8, fontBold, black);
    });
  } else {
    totalsY -= 14;
    currentPage.drawText(tPDF("plus_vat"), { x: totalsBoxX, y: totalsY, size: 8, font: fontRegular, color: darkGray });
    drawTextRight(`${formatter.format(offer.total_vat_amount)} ${offer.currency_code}`, 545, totalsY, 8, fontBold, black);
  }

  // Divider
  totalsY -= 12;
  currentPage.drawLine({
    start: { x: totalsBoxX, y: totalsY },
    end: { x: 545, y: totalsY },
    thickness: 1,
    color: slate200,
  });

  // Grand Total Gross
  totalsY -= 14;
  currentPage.drawText(tPDF("total_amount"), { x: totalsBoxX, y: totalsY, size: 9, font: fontBold, color: black });
  drawTextRight(`${formatter.format(offer.total_gross_amount)} ${offer.currency_code}`, 545, totalsY, 10, fontBold, black);

  // Interpolated Closing Text
  let closingY = totalsY - 24;
  const resolvedClosing = interpolateOfferText(offer.closing_text || "", offer, recipientCompany, recipientContact, myCompany);
  if (resolvedClosing) {
    const cleanClosing = stripHtml(resolvedClosing);
    const wrappedClosing = wrapRichText(cleanClosing, 495, fontSet, 8);
    wrappedClosing.forEach((line) => {
      if (closingY < 100) {
        addNewPage(false);
        closingY = currentY - 15;
      }
      drawRichTextLine(currentPage, line, 50, closingY, 8, fontSet, darkGray);
      closingY -= 11;
    });
  }

  // Update footer page numbers to show "Seite X / Y" if there's multiple pages
  pages.forEach((p, idx) => {
    const footerY = 45;
    p.drawLine({
      start: { x: 50, y: 60 },
      end: { x: 545, y: 60 },
      thickness: 0.5,
      color: borderGray,
    });

    // Own Tax/Company Details Left, Bank Connection Center, Support Right
    p.drawText(tPDF("tax_and_vat_id"), { x: 50, y: footerY, size: 7, font: fontBold, color: darkGray });
    p.drawText(`${tPDF("tax_number_label")} ${taxNumber}`, { x: 50, y: footerY - 10, size: 7, font: fontRegular, color: darkGray });
    p.drawText(`${tPDF("vat_id_label")} ${vatId}`, { x: 50, y: footerY - 18, size: 7, font: fontRegular, color: darkGray });

    p.drawText(tPDF("bank_connection"), { x: 230, y: footerY, size: 7, font: fontBold, color: darkGray });
    p.drawText(`${tPDF("bank_name")} ${myCompany?.bank_name || "Sparkasse"}`, { x: 230, y: footerY - 10, size: 7, font: fontRegular, color: darkGray });
    p.drawText(`IBAN: ${iban}`, { x: 230, y: footerY - 18, size: 7, font: fontRegular, color: darkGray });
    p.drawText(`BIC: ${bic}`, { x: 230, y: footerY - 26, size: 7, font: fontRegular, color: darkGray });

    p.drawText(tPDF("contact_support"), { x: 420, y: footerY, size: 7, font: fontBold, color: darkGray });
    p.drawText(`${tPDF("phone_label")} ${senderPhone}`, { x: 420, y: footerY - 10, size: 7, font: fontRegular, color: darkGray });
    p.drawText(`E-Mail: ${senderEmail}`, { x: 420, y: footerY - 18, size: 7, font: fontRegular, color: darkGray });
    p.drawText(`Web: ${myCompany?.website || "www.musterfirma.test"}`, { x: 420, y: footerY - 26, size: 7, font: fontRegular, color: darkGray });

    // Page Number
    const totalPagesStr = `${pages.length}`;
    const pageNumLabel = `${idx + 1} / ${totalPagesStr}`;
    const pageNumWidth = fontRegular.widthOfTextAtSize(pageNumLabel, 7);
    p.drawText(pageNumLabel, {
      x: 545 - pageNumWidth,
      y: footerY - 34,
      size: 7,
      font: fontRegular,
      color: darkGray
    });
  });

  return pdfDoc.save();
}
