// Report (wöchentlich): Datenqualität der Kontakte — NUR Kennzahlen, keine Namen.
// Erkennt: Kontakte ohne E-Mail, ohne Firma, potenzielle Duplikate (gleicher Nachname).
const { Client } = require("pg");

(async () => {
  const c = new Client({ connectionTimeoutMillis: 8000 });
  await c.connect();
  const noMail = await c.query(
    `SELECT count(*)::int AS n FROM core_registry_contacts WHERE email_address IS NULL OR email_address = ''`
  );
  const noCompany = await c.query(
    `SELECT count(*)::int AS n FROM core_registry_contacts WHERE associated_company_id IS NULL`
  );
  const dups = await c.query(
    `SELECT count(*)::int AS n FROM (SELECT last_name FROM core_registry_contacts
       WHERE last_name IS NOT NULL AND last_name <> '' GROUP BY last_name HAVING count(*) > 1) d`
  );
  console.log(
    `KONTAKT-QUALITAET: ${noMail.rows[0].n} ohne E-Mail, ${noCompany.rows[0].n} ohne Firma, ${dups.rows[0].n} Namens-Duplikate`
  );
  await c.end();
})().catch((e) => {
  console.error("QUALITAET-FEHLER: " + e.message);
  process.exit(1);
});
