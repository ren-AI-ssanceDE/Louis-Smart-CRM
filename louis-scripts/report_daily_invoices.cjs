// Report (täglich): Offene & überfällige Rechnungen — nur Kennzahlen, keine Kundendaten.
// Einrichtung: Agent-Job, job_type=script, script_path=report_daily_invoices.js,
//              schedule_type=daily, deliver_to=session|mail_draft
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionTimeoutMillis: 8000 });
  await c.connect();
  const { rows } = await c.query(
    `SELECT payment_status,
            count(*) AS n,
            COALESCE(SUM(total_gross_amount), 0) AS sum_gross
     FROM fiscal_billing_invoices
     GROUP BY payment_status ORDER BY payment_status`
  );
  const map = Object.fromEntries(rows.map((r) => [r.payment_status, r]));
  const open = map.issued ? Number(map.issued.n) : 0;
  const overdue = map.overdue ? Number(map.overdue.n) : 0;
  const sum = Number(map.issued?.sum_gross || 0) + Number(map.overdue?.sum_gross || 0);
  console.log(
    `RECHNUNGS-REPORT: ${open} offen, ${overdue} überfällig, Gesamtsumme offen+überfällig ${sum.toFixed(2)} EUR`
  );
  await c.end();
})().catch((e) => {
  console.error("RECHNUNGS-REPORT-FEHLER: " + e.message);
  process.exit(1);
});
