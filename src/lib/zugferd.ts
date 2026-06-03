import { z } from 'zod';
import { InvoiceWithRecipient } from '../types';
import { roundFiscal, LineItem } from './math';
import { MyCompanyFullSchema } from './schemas';

export type XmlProfile = 'zugferd-comfort' | 'xrechnung-3.0';

const GUIDELINE_IDS: Record<XmlProfile, string> = {
  'zugferd-comfort': 'urn:cen.eu:en16931:2017',
  'xrechnung-3.0': 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0',
};

// Leitweg-ID format per KoSIT: groboid[-feinadressierung][-pruefziffer]
// e.g. "991-12345-67", "04011000-1234512345-06"
const LEITWEG_ID_REGEX = /^\d{2,12}(-[A-Z0-9]{1,30})?(-\d{2})?$/i;

function cleanDescForXml(desc: string): string {
  if (!desc) return "Dienstleistung";
  const leftMatch = desc.match(/<!-- COL_LEFT_START -->([\s\S]*?)<!-- COL_LEFT_END -->/);
  const rightMatch = desc.match(/<!-- COL_RIGHT_START -->([\s\S]*?)<!-- COL_RIGHT_END -->/);

  let raw = desc;
  if (leftMatch || rightMatch) {
    const left = leftMatch ? leftMatch[1] : "";
    const right = rightMatch ? rightMatch[1] : "";
    raw = `${left} | ${right}`;
  }

  const cleaned = raw
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return escapeXml(cleaned);
}

function escapeXml(unsafe: any): string {
  if (unsafe === undefined || unsafe === null) return "";
  const str = String(unsafe);
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatXmlDate(dateVal: any): string {
  if (!dateVal) return "";
  if (dateVal instanceof Date) {
    try {
      const y = dateVal.getFullYear();
      const m = String(dateVal.getMonth() + 1).padStart(2, '0');
      const d = String(dateVal.getDate()).padStart(2, '0');
      return `${y}${m}${d}`;
    } catch (e) {
      return "";
    }
  }
  return String(dateVal).replace(/-/g, '').substring(0, 8);
}

/**
 * Pick a usable seller contact name from MyCompany fields.
 * Order: responsible_person -> first+last name -> full_legal_name.
 */
function sellerContactName(myCompany?: Partial<z.infer<typeof MyCompanyFullSchema>> | null): string {
  if (!myCompany) return "";
  if (myCompany.responsible_person && myCompany.responsible_person.trim()) {
    return myCompany.responsible_person.trim();
  }
  const fn = (myCompany.first_name || "").trim();
  const ln = (myCompany.last_name || "").trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  return (myCompany.full_legal_name || "").trim();
}

/**
 * Generates an EN 16931 compliant ZUGFeRD/Factur-X (CII) XML.
 *
 * @param invoice  Invoice + recipient context
 * @param myCompany Seller (issuer) profile
 * @param profile   Target compliance profile.
 *                  - "zugferd-comfort" (default): ZUGFeRD/Factur-X EN16931 profile
 *                  - "xrechnung-3.0": KoSIT XRechnung 3.0 (mandatory for German B2G)
 *
 * For XRechnung the function enforces:
 *   - valid Leitweg-ID in BuyerReference (BT-10)
 *   - SellerContact with name (BT-41), phone (BT-42) and email (BT-43)
 *
 * Throws Error with a translatable code when XRechnung prerequisites are missing.
 */
export function generateZugferdXML(
  invoice: InvoiceWithRecipient,
  myCompany?: Partial<z.infer<typeof MyCompanyFullSchema>> | null,
  profile: XmlProfile = 'zugferd-comfort'
): string {
  let lineItems: LineItem[] = typeof invoice.invoice_line_items_json === 'string'
    ? JSON.parse(invoice.invoice_line_items_json || '[]')
    : ((invoice.invoice_line_items_json as unknown as LineItem[]) || invoice.invoice_line_items || []);

  // EN 16931 requires at least one IncludedSupplyChainTradeLineItem. Synthesize
  // a fallback line from the invoice's own totals when no granular lines were
  // provided (e.g. legacy data, third-party imports, minimal seed rows).
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    const fallbackNetRaw = invoice.total_net_amount ?? 0;
    const fallbackNet = typeof fallbackNetRaw === "number"
      ? fallbackNetRaw
      : Number(fallbackNetRaw) || 0;
    const fallbackRate = typeof invoice.vat_rate === "number"
      ? invoice.vat_rate
      : Number(invoice.vat_rate ?? 19) || 19;
    lineItems = [{
      description: "Dienstleistung",
      quantity: 1,
      unit_price: fallbackNet,
      vat_rate: fallbackRate,
      total_net: fallbackNet,
      unit_code: "C62",
    }];
  }

  const seller = {
    name: myCompany?.full_legal_name || "LOUIS Systems GmbH",
    vatId: myCompany?.tax_vat_id || "DE999999999",
    taxNumber: myCompany?.tax_number || "30/220/33408",
    street: myCompany?.street ? `${myCompany.street}${myCompany.house_number ? ' ' + myCompany.house_number : ''}` : "Friedrichstr. 100",
    city: myCompany?.city || "Berlin",
    zip: myCompany?.postal_code || "10117",
    country: myCompany?.country_code || "DE",
    iban: myCompany?.iban || "DE89370400440532013000",
    bic: myCompany?.bic_swift || "SOLODEF1XXX",
    bankName: myCompany?.bank_name || "Berliner Volksbank",
    contactName: sellerContactName(myCompany),
    contactPhone: (myCompany?.phone_number || myCompany?.mobile_number || "").trim(),
    contactEmail: (myCompany?.email_address || "").trim(),
  };

  const recipientName = invoice.company_name || invoice.co_name || invoice.contact_full_name || invoice.ct_name || 'Customer';
  const recipientStreet = invoice.co_street || invoice.ct_street || "Beispielstraße 42";
  const recipientHouseNumber = invoice.co_house_number || invoice.ct_house_number || "";
  const recipientZip = invoice.co_postal_code || invoice.ct_postal_code || "12345";
  const recipientCity = invoice.co_city || invoice.ct_city || "Musterstadt";
  const recipientCountry = invoice.co_country_code || invoice.ct_country_code || "DE";

  const recipientStreetFull = recipientHouseNumber
    ? `${recipientStreet} ${recipientHouseNumber}`
    : recipientStreet;

  // Profile-specific validations
  // Defensive .trim() — DB drivers may hand back non-strings (e.g. null, Date)
  // depending on column types and pg type parsers.
  const asStr = (v: any) => (typeof v === "string" ? v : (v == null ? "" : String(v))).trim();
  const leitwegRaw = asStr(invoice.leitweg_id);
  const buyerEmail = asStr(invoice.co_email_address) || asStr(invoice.ct_email_address);
  if (profile === 'xrechnung-3.0') {
    if (!leitwegRaw) {
      throw new Error("xrechnung_missing_leitweg_id");
    }
    if (!LEITWEG_ID_REGEX.test(leitwegRaw)) {
      throw new Error("xrechnung_invalid_leitweg_id");
    }
    if (!seller.contactName) throw new Error("xrechnung_missing_seller_contact_name");
    if (!seller.contactPhone) throw new Error("xrechnung_missing_seller_contact_phone");
    if (!seller.contactEmail) throw new Error("xrechnung_missing_seller_contact_email");
    if (!buyerEmail) throw new Error("xrechnung_missing_buyer_email");
  }

  // Group line items by vat_rate -> ApplicableTradeTax breakdown.
  // Coerce every number defensively: line items may come from JSON (numbers) or
  // from a pg NUMERIC column (strings) — `+=` on a string operand produces
  // string concatenation, which leaks into the XML as e.g. "01001000" and
  // breaks decimal schema validation.
  const num = (v: any): number => {
    const n = typeof v === "number" ? v : (v == null ? 0 : Number(v));
    return Number.isFinite(n) ? n : 0;
  };
  const taxMap = new Map<number, { basis: number; tax: number }>();
  for (const item of lineItems) {
    const rate = num(item.vat_rate !== undefined ? item.vat_rate : 19);
    const qty = num(item.quantity);
    const price = num(item.unit_price);
    const net = item.total_net !== undefined ? num(item.total_net) : qty * price;
    const tax = net * (rate / 100);
    const existing = taxMap.get(rate) || { basis: 0, tax: 0 };
    existing.basis += net;
    existing.tax += tax;
    taxMap.set(rate, existing);
  }

  if (taxMap.size === 0) {
    taxMap.set(num(invoice.vat_rate !== undefined ? invoice.vat_rate : 19), {
      basis: num(invoice.total_net_amount),
      tax: num(invoice.total_vat_amount),
    });
  }

  const taxBreakdownXML = Array.from(taxMap.entries()).map(([rate, vals]) => `
            <ram:ApplicableTradeTax>
                <ram:CalculatedAmount>${roundFiscal(vals.tax).toFixed(2)}</ram:CalculatedAmount>
                <ram:TypeCode>VAT</ram:TypeCode>
                <ram:BasisAmount>${roundFiscal(vals.basis).toFixed(2)}</ram:BasisAmount>
                <ram:CategoryCode>S</ram:CategoryCode>
                <ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
            </ram:ApplicableTradeTax>`).join('');

  const buyerReferenceXML = leitwegRaw
    ? `<ram:BuyerReference>${escapeXml(leitwegRaw)}</ram:BuyerReference>`
    : '';

  const sellerContactXML = (seller.contactName || seller.contactPhone || seller.contactEmail) ? `
                <ram:DefinedTradeContact>
                    ${seller.contactName ? `<ram:PersonName>${escapeXml(seller.contactName)}</ram:PersonName>` : ''}
                    ${seller.contactPhone ? `
                    <ram:TelephoneUniversalCommunication>
                        <ram:CompleteNumber>${escapeXml(seller.contactPhone)}</ram:CompleteNumber>
                    </ram:TelephoneUniversalCommunication>` : ''}
                    ${seller.contactEmail ? `
                    <ram:EmailURIUniversalCommunication>
                        <ram:URIID>${escapeXml(seller.contactEmail)}</ram:URIID>
                    </ram:EmailURIUniversalCommunication>` : ''}
                </ram:DefinedTradeContact>` : '';

  // Seller electronic address (BT-34) — required by XRechnung (PEPPOL-EN16931-R020).
  // For ZUGFeRD it's recommended but emitted unconditionally when an email is known.
  const sellerUriXML = seller.contactEmail ? `
                <ram:URIUniversalCommunication>
                    <ram:URIID schemeID="EM">${escapeXml(seller.contactEmail)}</ram:URIID>
                </ram:URIUniversalCommunication>` : '';

  // Buyer electronic address (BT-49) — required by XRechnung (PEPPOL-EN16931-R010).
  const buyerUriXML = buyerEmail ? `
                <ram:URIUniversalCommunication>
                    <ram:URIID schemeID="EM">${escapeXml(buyerEmail)}</ram:URIID>
                </ram:URIUniversalCommunication>` : '';

  // BusinessProcess (BT-23) — XRechnung mandates it (PEPPOL-EN16931-R001). Default
  // to the PEPPOL billing process when caller didn't override.
  const businessProcessId = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";
  const businessProcessXML = profile === 'xrechnung-3.0'
    ? `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${businessProcessId}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>`
    : '';

  // Payment terms (BR-CO-25) — if DuePayableAmount > 0 we must emit either DueDate
  // or a textual Description. Always emit the block; prefer due_date, fall back to
  // "Zahlbar bei Erhalt" so the rule passes even when no terms were configured.
  // due_date arrives as a Date when sourced from pg, as a string from JSON; coerce.
  const paymentTermsXML = (() => {
    const rawDue: any = invoice.due_date;
    const dueDate = rawDue instanceof Date
      ? rawDue
      : (typeof rawDue === "string" ? rawDue.trim() : "");
    if (dueDate) {
      const termText = typeof invoice.payment_term === "string" && invoice.payment_term.trim()
        ? invoice.payment_term.trim()
        : "Zahlbar bis zum angegebenen Datum";
      return `
            <ram:SpecifiedTradePaymentTerms>
                <ram:Description>${escapeXml(termText)}</ram:Description>
                <ram:DueDateDateTime>
                    <udt:DateTimeString format="102">${formatXmlDate(dueDate)}</udt:DateTimeString>
                </ram:DueDateDateTime>
            </ram:SpecifiedTradePaymentTerms>`;
    }
    const term = typeof invoice.payment_term === "string" && invoice.payment_term.trim()
      ? invoice.payment_term.trim()
      : "Zahlbar bei Erhalt";
    return `
            <ram:SpecifiedTradePaymentTerms>
                <ram:Description>${escapeXml(term)}</ram:Description>
            </ram:SpecifiedTradePaymentTerms>`;
  })();

  const guidelineId = GUIDELINE_IDS[profile];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice
    xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
    xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
    xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
    xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
    <rsm:ExchangedDocumentContext>
        ${businessProcessXML}
        <ram:GuidelineSpecifiedDocumentContextParameter>
            <ram:ID>${guidelineId}</ram:ID>
        </ram:GuidelineSpecifiedDocumentContextParameter>
    </rsm:ExchangedDocumentContext>
    <rsm:ExchangedDocument>
        <ram:ID>${escapeXml(invoice.invoice_number)}</ram:ID>
        <ram:TypeCode>380</ram:TypeCode>
        <ram:IssueDateTime>
            <udt:DateTimeString format="102">${formatXmlDate(invoice.issue_date)}</udt:DateTimeString>
        </ram:IssueDateTime>
    </rsm:ExchangedDocument>
    <rsm:SupplyChainTradeTransaction>
        ${lineItems.map((item: LineItem, index: number) => {
          const qty = item.quantity || 0;
          const price = item.unit_price || 0;
          const vatRate = item.vat_rate !== undefined ? item.vat_rate : 19;
          const unitCode = item.unit_code || "HUR";
          const itemNetTotal = item.total_net !== undefined ? item.total_net : (qty * price);
          return `
        <ram:IncludedSupplyChainTradeLineItem>
            <ram:AssociatedDocumentLineDocument>
                <ram:LineID>${index + 1}</ram:LineID>
            </ram:AssociatedDocumentLineDocument>
            <ram:SpecifiedTradeProduct>
                <ram:Name>${cleanDescForXml(item.description)}</ram:Name>
            </ram:SpecifiedTradeProduct>
            <ram:SpecifiedLineTradeAgreement>
                <ram:NetPriceProductTradePrice>
                    <ram:ChargeAmount>${roundFiscal(price).toFixed(2)}</ram:ChargeAmount>
                </ram:NetPriceProductTradePrice>
            </ram:SpecifiedLineTradeAgreement>
            <ram:SpecifiedLineTradeDelivery>
                <ram:BilledQuantity unitCode="${escapeXml(unitCode)}">${qty}</ram:BilledQuantity>
            </ram:SpecifiedLineTradeDelivery>
            <ram:SpecifiedLineTradeSettlement>
                <ram:ApplicableTradeTax>
                    <ram:TypeCode>VAT</ram:TypeCode>
                    <ram:CategoryCode>S</ram:CategoryCode>
                    <ram:RateApplicablePercent>${vatRate}</ram:RateApplicablePercent>
                </ram:ApplicableTradeTax>
                <ram:SpecifiedTradeSettlementLineMonetarySummation>
                    <ram:LineTotalAmount>${roundFiscal(itemNetTotal).toFixed(2)}</ram:LineTotalAmount>
                </ram:SpecifiedTradeSettlementLineMonetarySummation>
            </ram:SpecifiedLineTradeSettlement>
        </ram:IncludedSupplyChainTradeLineItem>`;
        }).join('')}
        <ram:ApplicableHeaderTradeAgreement>
            ${buyerReferenceXML}
            <ram:SellerTradeParty>
                <ram:Name>${escapeXml(seller.name)}</ram:Name>${sellerContactXML}
                <ram:PostalTradeAddress>
                    <ram:PostcodeCode>${escapeXml(seller.zip)}</ram:PostcodeCode>
                    <ram:LineOne>${escapeXml(seller.street)}</ram:LineOne>
                    <ram:CityName>${escapeXml(seller.city)}</ram:CityName>
                    <ram:CountryID>${escapeXml(seller.country)}</ram:CountryID>
                </ram:PostalTradeAddress>${sellerUriXML}
                <ram:SpecifiedTaxRegistration>
                    <ram:ID schemeID="VA">${escapeXml(seller.vatId)}</ram:ID>
                </ram:SpecifiedTaxRegistration>
                ${seller.taxNumber ? `
                <ram:SpecifiedTaxRegistration>
                    <ram:ID schemeID="FC">${escapeXml(seller.taxNumber)}</ram:ID>
                </ram:SpecifiedTaxRegistration>` : ''}
            </ram:SellerTradeParty>
            <ram:BuyerTradeParty>
                <ram:Name>${escapeXml(recipientName)}</ram:Name>
                <ram:PostalTradeAddress>
                    <ram:PostcodeCode>${escapeXml(recipientZip)}</ram:PostcodeCode>
                    <ram:LineOne>${escapeXml(recipientStreetFull)}</ram:LineOne>
                    <ram:CityName>${escapeXml(recipientCity)}</ram:CityName>
                    <ram:CountryID>${escapeXml(recipientCountry)}</ram:CountryID>
                </ram:PostalTradeAddress>${buyerUriXML}
            </ram:BuyerTradeParty>
        </ram:ApplicableHeaderTradeAgreement>
        <ram:ApplicableHeaderTradeDelivery>
            <ram:ActualDeliverySupplyChainEvent>
                <ram:OccurrenceDateTime>
                    <udt:DateTimeString format="102">${formatXmlDate(invoice.service_date || invoice.issue_date)}</udt:DateTimeString>
                </ram:OccurrenceDateTime>
            </ram:ActualDeliverySupplyChainEvent>
        </ram:ApplicableHeaderTradeDelivery>
        <ram:ApplicableHeaderTradeSettlement>
            <ram:InvoiceCurrencyCode>${escapeXml(invoice.currency_code || 'EUR')}</ram:InvoiceCurrencyCode>
            ${seller.iban ? `
            <ram:SpecifiedTradeSettlementPaymentMeans>
                <ram:TypeCode>58</ram:TypeCode>
                <ram:PayeePartyCreditorFinancialAccount>
                    <ram:IBANID>${escapeXml(seller.iban.replace(/\s+/g, ''))}</ram:IBANID>
                </ram:PayeePartyCreditorFinancialAccount>
                ${seller.bic ? `
                <ram:PayeeSpecifiedCreditorFinancialInstitution>
                    <ram:BICID>${escapeXml(seller.bic.replace(/\s+/g, ''))}</ram:BICID>
                </ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
            </ram:SpecifiedTradeSettlementPaymentMeans>` : ''}
            ${taxBreakdownXML}${paymentTermsXML}
            <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
                <ram:LineTotalAmount>${roundFiscal(invoice.total_net_amount).toFixed(2)}</ram:LineTotalAmount>
                <ram:TaxBasisTotalAmount>${roundFiscal(invoice.total_net_amount).toFixed(2)}</ram:TaxBasisTotalAmount>
                <ram:TaxTotalAmount currencyID="${escapeXml(invoice.currency_code || 'EUR')}">${roundFiscal(invoice.total_vat_amount).toFixed(2)}</ram:TaxTotalAmount>
                <ram:GrandTotalAmount>${roundFiscal(invoice.total_gross_amount).toFixed(2)}</ram:GrandTotalAmount>
                <ram:DuePayableAmount>${roundFiscal(invoice.total_gross_amount).toFixed(2)}</ram:DuePayableAmount>
            </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        </ram:ApplicableHeaderTradeSettlement>
    </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`.trim();

  return xml;
}

/**
 * Helper: detect whether an invoice should be issued as XRechnung (B2G)
 * by the presence of a syntactically valid Leitweg-ID.
 */
export function inferProfileFromInvoice(invoice: Pick<InvoiceWithRecipient, 'leitweg_id'>): XmlProfile {
  const lw = (invoice.leitweg_id || '').trim();
  if (lw && LEITWEG_ID_REGEX.test(lw)) return 'xrechnung-3.0';
  return 'zugferd-comfort';
}
