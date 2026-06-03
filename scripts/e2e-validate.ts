// End-to-end validation harness for the e-invoice pipeline.
//
// For each scenario:
//   1. Generate the ZUGFeRD/XRechnung XML via src/lib/zugferd.ts
//   2. Render a visual PDF via src/server/pdfHelper.ts
//   3. Merge them with Mustang CLI (--action combine)
//   4. Validate the merged PDF with Mustang (--action validate)
//   5. Print pass/fail with the error/warning counts
//
// Outputs land in ./e2e-out/ for inspection and downstream veraPDF/KoSIT runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildInvoicePDFBuffer,
  mergePdfAndXmlWithMustang,
  validateInvoicePdf,
  type InvoicePDFContext,
} from "../src/server/pdfHelper.js";
import { generateZugferdXML, inferProfileFromInvoice } from "../src/lib/zugferd.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "e2e-out");
fs.mkdirSync(OUT, { recursive: true });

const myCompany = {
  full_legal_name: "Louis Systems GmbH",
  tax_vat_id: "DE123456789",
  tax_number: "30/220/33408",
  street: "Friedrichstr.",
  house_number: "100",
  postal_code: "10117",
  city: "Berlin",
  country_code: "DE",
  iban: "DE89370400440532013000",
  bic_swift: "COBADEFFXXX",
  bank_name: "Commerzbank",
  responsible_person: "Stefan Tusk",
  phone_number: "+49 30 1234567",
  email_address: "billing@louis-systems.de",
  first_name: "Stefan",
  last_name: "Tusk",
} as const;

interface Scenario {
  name: string;
  invoice: InvoicePDFContext;
  expectedProfile: "zugferd-comfort" | "xrechnung-3.0";
}

const baseInvoice = (overrides: Partial<InvoicePDFContext>): InvoicePDFContext => ({
  id_uuid: "11111111-1111-1111-1111-111111111111",
  invoice_number: "RE-2026-0001",
  issue_date: "2026-05-27",
  service_date: "2026-05-20",
  due_date: "2026-06-26",
  payment_term: "Zahlbar innerhalb von 30 Tagen ohne Abzug",
  is_vat_inclusive: false,
  total_net_amount: 100,
  total_vat_amount: 19,
  total_gross_amount: 119,
  vat_rate: 19,
  currency_code: "EUR",
  payment_status: "pending",
  invoice_line_items_json: JSON.stringify([
    { description: "Beratung", quantity: 1, unit_price: 100, vat_rate: 19, total_net: 100, unit_code: "HUR" },
  ]),
  co_name: "Acme GmbH",
  co_street: "Hauptstr.",
  co_house_number: "1",
  co_postal_code: "20095",
  co_city: "Hamburg",
  co_country_code: "DE",
  entityType: "companies",
  entityId: "22222222-2222-2222-2222-222222222222",
  entityName: "Acme GmbH",
  ...overrides,
});

const scenarios: Scenario[] = [
  {
    name: "01-zugferd-single-line",
    expectedProfile: "zugferd-comfort",
    invoice: baseInvoice({}),
  },
  {
    name: "02-zugferd-multi-line",
    expectedProfile: "zugferd-comfort",
    invoice: baseInvoice({
      invoice_number: "RE-2026-0002",
      total_net_amount: 350,
      total_vat_amount: 66.5,
      total_gross_amount: 416.5,
      invoice_line_items_json: JSON.stringify([
        { description: "Beratung", quantity: 2, unit_price: 100, vat_rate: 19, total_net: 200, unit_code: "HUR" },
        { description: "Lizenzgebühr", quantity: 1, unit_price: 150, vat_rate: 19, total_net: 150, unit_code: "C62" },
      ]),
    }),
  },
  {
    name: "03-zugferd-mixed-vat",
    expectedProfile: "zugferd-comfort",
    invoice: baseInvoice({
      invoice_number: "RE-2026-0003",
      total_net_amount: 200,
      total_vat_amount: 26,
      total_gross_amount: 226,
      invoice_line_items_json: JSON.stringify([
        { description: "Beratung 19%", quantity: 1, unit_price: 100, vat_rate: 19, total_net: 100, unit_code: "HUR" },
        { description: "Buchverkauf 7%", quantity: 1, unit_price: 100, vat_rate: 7, total_net: 100, unit_code: "C62" },
      ]),
    }),
  },
  {
    name: "04-xrechnung-b2g",
    expectedProfile: "xrechnung-3.0",
    invoice: baseInvoice({
      invoice_number: "RE-2026-0004",
      // Public-sector buyer reference — triggers the XRechnung profile and
      // exercises the seller-contact mandatory block.
      leitweg_id: "991-12345-67",
      co_name: "Bundesamt für Beispiele",
      co_email_address: "rechnung@bundesamt-beispiele.de",
    }),
  },
];

interface RunResult {
  scenario: string;
  profile: string;
  detectedProfile: string;
  xmlBytes: number;
  pdfBytes: number;
  validation: { ok: boolean; errors: number; warnings: number; notices: number };
  failureReason?: string;
}

async function runScenario(s: Scenario): Promise<RunResult> {
  const detectedProfile = inferProfileFromInvoice(s.invoice);
  const outDir = path.join(OUT, s.name);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. XML
  const xml = generateZugferdXML(s.invoice, myCompany, detectedProfile);
  const xmlPath = path.join(outDir, "factur-x.xml");
  fs.writeFileSync(xmlPath, xml);

  // 2. Visual PDF
  const pdfBytes = await buildInvoicePDFBuffer(s.invoice, myCompany, "de");
  const visualPath = path.join(outDir, "visual.pdf");
  fs.writeFileSync(visualPath, Buffer.from(pdfBytes));

  // 3. Merge via Mustang
  const finalPdfPath = path.join(outDir, "invoice.pdf");
  await mergePdfAndXmlWithMustang(visualPath, xmlPath, finalPdfPath, detectedProfile);

  // 4. Validate
  const report = await validateInvoicePdf(finalPdfPath);
  fs.writeFileSync(path.join(outDir, "validation.log"), report.raw);

  return {
    scenario: s.name,
    profile: s.expectedProfile,
    detectedProfile,
    xmlBytes: xml.length,
    pdfBytes: fs.statSync(finalPdfPath).size,
    validation: {
      ok: report.ok,
      errors: report.errors.length,
      warnings: report.warnings.length,
      notices: report.notices.length,
    },
  };
}

(async () => {
  const results: RunResult[] = [];
  for (const s of scenarios) {
    process.stdout.write(`\n=== ${s.name} ===\n`);
    try {
      const r = await runScenario(s);
      results.push(r);
      console.log(JSON.stringify(r, null, 2));
    } catch (err: any) {
      const failure: RunResult = {
        scenario: s.name,
        profile: s.expectedProfile,
        detectedProfile: "n/a",
        xmlBytes: 0,
        pdfBytes: 0,
        validation: { ok: false, errors: -1, warnings: -1, notices: -1 },
        failureReason: err?.message || String(err),
      };
      results.push(failure);
      console.error(`FAILED: ${failure.failureReason}`);
    }
  }

  const passed = results.filter((r) => r.validation.ok).length;
  console.log("\n=== Summary ===");
  console.log(`${passed}/${results.length} scenarios passed validation.`);
  for (const r of results) {
    const flag = r.validation.ok ? "PASS" : "FAIL";
    console.log(`  [${flag}] ${r.scenario} (profile=${r.detectedProfile}, errors=${r.validation.errors}, warnings=${r.validation.warnings})`);
  }

  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})();
