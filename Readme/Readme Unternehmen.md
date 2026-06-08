# 🏢 Wiki: Firmenverwaltung & Mandantenstruktur

Die Verwaltung von Firmen/Unternehmen in **Louis Smart CRM** unterscheidet strikt zwischen **Kunden-Unternehmen** (Debitoren/Kontakte) und dem **eigenen Unternehmen** (Mandant/Rechnungssteller).

---

## 🏛️ 1. Unternehmenscharakteristika & Rechtspflichten

Jedes in der Datenbank registrierte Kundenunternehmen erfüllt die Anforderungen an eine vollständige Stammdatenpflege nach HGB und GoBD. Das zugehörige Schema (`CompanySchema` in `src/lib/schemas.ts`) beinhaltet:

* **Eindeutige Identifikatoren**:
  * `full_legal_name`: Der offizielle Firmenname laut Handelsregister (Pflichtangabe).
  * `short_code`: Ein interner Kurzschlüssel zur schnellen Kennzeichnung (z.B. in Rechnungsnummer-Präfixen).
* **Steuerdaten (Geschäftsverkehr)**:
  * `tax_vat_id`: Umsatzsteuer-Identifikationsnummer (USt-IdNr, z.B. `DE123456789`). Essentiell für B2B-Rechnungen und die Prüfung der Steuerbefreiung bei innergemeinschaftlichen Lieferungen.
  * `tax_number`: Steuernummer beim lokalen Finanzamt.
* **Firmensitz & Anschrift**:
  * `street`, `house_number`, `postal_code`, `city` und `country_code` (ISO-2 Code wie `DE`, `AT`, `CH`).
* **Finanzdaten**:
  * `iban`, `bic_swift` und `bank_name` für automatisierte SEPA-Lastschriften oder Überweisungsträger.
* **Behördenschnittstelle**:
  * `leitweg_id`: Die Nummer zur automatischen Vermittlung von E-Rechnungen bei Bund und Ländern (B2G).

---

## 👑 2. "My Company" vs. Kunden-Unternehmen

Im System existiert eine logische Trennung:

### A. Eigene Firma (Der Mandant / Rechnungssteller)
Abgebildet über das Schema `MyCompanySchema`. Es erweitert das Standard-Firmenschema um mandantenspezifische Zusatzfelder:
* **`invoice_number_prefix`**: Ein frei definierbares Präfix für Rechnungsnummern (z.B. `INV-`).
* **`invoice_number_next_seq`**: Die nächste fortlaufende Rechnungsnummer. Das System erhöht diese bei jedem finalen Belegexport automatisch.
* **`invoice_number_year_fixed`**: Schalter, ob das aktuelle Kalenderjahr fest im Rechnungsnummernkreis integriert sein soll (z.B. `INV-2026-0001`).
* **`logo_url`**: Pfad zum eigenen Logo, das dynamisch in das visuelle PDF eingefügt wird.

### B. Kunden-Unternehmen (Käufer / Debitoren)
Dies sind die Kunden des System-Betreibers. Sie besitzen Eigenschaften wie `payment_term` (Zahlungsziel in Tagen, z.B. "14 Tage netto") und `vat_rate` (Standardmäßiger Steuersatz für Lieferungen an dieses Unternehmen, standardmäßig 19%).

---

## 👥 3. N:1 Verbindung zu CRM-Kontakten

Über die Web-Oberfläche (`src/pages/Companies.tsx`) wird die direkte Beziehung zwischen Unternehmen und ihren Ansprechpartnern verwaltet:
* **Zugehörige Kontakte**: Das System listet im Firmenprofil alle Mitarbeiter auf, deren `associated_company_id` der UUID der Firma entspricht.
* **Hauptansprechpartner**: Ein bestimmter Mitarbeiter kann im Feld `responsible_person` der Firma hinterlegt werden. Ist dieses Feld ausgefüllt, adressiert Louis AI Briefe und E-Mails automatisch an diese konkrete Person.

---

## 🤖 4. AI-Features für Firmenkonten

Mit dem CRM-Tooling kann die KI Firmenanalysen durchführen:
* **Analytisches Abfragen**: *"Welches Unternehmen hat im letzten Quartal den meisten Umsatz erzielt?"* -> Das System nutzt das Tool `crm_data_analyst`, um die Datenbank-Tabellen von Firmen und Rechnungen zu verknüpfen und zu aggregieren.
* **Automatisches Tagging (`labels`)**: Firmen können mit Tags (z.B. `Premium`, `A-Kunde`, `B2B`) versehen werden. Louis AI kann diese Tags interpretieren, um gezielte Mailing-Listen oder Rabatt-Kampagnen vorzuschlagen.
