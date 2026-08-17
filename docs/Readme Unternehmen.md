# 🏢 Firmenverwaltung & Mandantenstruktur

> In Louis Smart CRM verwalten Sie **Unternehmen** — sowohl Ihre Kunden als auch Ihr eigenes Unternehmen. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist eine „Firma“ im System?

Eine Firma ist ein **Unternehmensprofil** mit allen Stammdaten, die Sie für die Geschäftsabwicklung brauchen:

* **Offizieller Firmenname** (laut Handelsregister)
* **Anschrift** (Straße, PLZ, Ort, Land)
* **Steuerdaten** — Umsatzsteuer-ID (USt-IdNr) und Steuernummer
* **Bankverbindung** (IBAN, BIC) für Überweisungen
* **Geschäftsbedingungen** — Zahlungsziel (z. B. „14 Tage“), Mehrwertsteuersatz, Preisliste
* **Bei Behörden:** die **Leitweg-ID** für E-Rechnungen (B2G)
* **Labels/Tags** — z. B. „A-Kunde“, „Premium“, „B2B“ — für Filter und Kampagnen

## Zwei Arten von Firmen — wichtig zu verstehen

### 1. Ihr eigenes Unternehmen („Mein Unternehmen“)
Das ist **Ihr** Betrieb — der Absender auf Rechnungen und Angeboten. Hier pflegen Sie:
* Firmenname, Logo, Adresse, Bankverbindung
* **Rechnungsnummern-Logik:** Präfix (z. B. `INV-`), ob das Jahr enthalten sein soll (z. B. `INV-2026-0001`) — die nächste Nummer vergibt das System automatisch

> 👉 **Einmalig einrichten:** Admin → „Mein Unternehmen“ — danach erscheinen Ihre Daten automatisch auf jedem Beleg.

### 2. Kunden-Unternehmen
Das sind Ihre Geschäftspartner. Pro Firma können Sie **Ansprechpartner (Kontakte)** hinterlegen — einer davon kann als Hauptansprechpartner (`responsible_person`) markiert werden. Louis adressiert Schreiben dann automatisch an diese Person.

## Was kann Louis für Sie tun?

* **Analysen:** *„Welches Unternehmen hat im letzten Quartal den meisten Umsatz erzielt?“*
* **Anlegen & Ändern:** *„Erstelle die Firma Ren-AI-ssance GmbH in München, IBAN DE12…“* oder *„Ändere bei der Acme AG die Telefonnummer“* — immer als **Entwurf**, den Sie freigeben.
* **Kampagnen:** Labels werden von Louis interpretiert (z. B. „alle A-Kunden mit Zahlungsverzug finden“).

## Datenschutz-Hinweis

* Firmen und Kontakte können gelöscht werden, solange keine Rechnungsverbindlichkeiten bestehen.
* Historische Rechnungen bleiben nach gesetzlicher Vorgabe revisionssicher erhalten.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Unternehmenscharakteristika & Rechtspflichten

Das `CompanySchema` (`src/lib/schemas.ts`) deckt die Stammdatenpflege nach HGB/GoBD ab:

* **Identifikatoren**: `full_legal_name` (offizieller Firmenname laut Handelsregister, Pflicht), `short_code` (interner Kurzschlüssel, z. B. für Rechnungsnummern-Präfixe)
* **Steuerdaten**: `tax_vat_id` (USt-IdNr, z. B. `DE123456789` — essenziell für B2B & innergemeinschaftliche Lieferungen), `tax_number` (Steuernummer Finanzamt)
* **Anschrift**: `street`, `house_number`, `postal_code`, `city`, `country_code` (ISO-2)
* **Finanzdaten**: `iban`, `bic_swift`, `bank_name` (SEPA/Überweisung)
* **Behördenschnittstelle**: `leitweg_id` (B2G-E-Rechnungen)
* **Geschäftsbedingungen**: `payment_term` (Zahlungsziel), `vat_rate` (Standard-Steuersatz, Default 19 %), `currency_code`, `price_list`
* **Organisation**: `responsible_person` (Hauptansprechpartner), `labels` (Tags wie `Premium`, `A-Kunde`, `B2B`)

## 2. „My Company“ vs. Kunden-Unternehmen

### A. Eigene Firma (Mandant / Rechnungssteller)
Abgebildet über `MyCompanySchema` + Tabelle `core_registry_my_company_table`:
* `invoice_number_prefix` (z. B. `INV-`) und `offer_number_prefix`
* `invoice_number_next_seq` / `offer_number_next_seq` (automatische Fortschreibung bei Finalisierung)
* `invoice_number_year_fixed` (z. B. `INV-2026-0001`)
* `logo_url` (dynamisch in PDF eingefügt), Bankverbindung, Absenderdaten
* Konfigurierbar im Admin-Panel (`MyCompanyForm`)

### B. Kunden-Unternehmen (Käufer / Debitoren)
Eigenschaften wie `payment_term`, `vat_rate`, `price_list` — vererbt an verknüpfte Kontakte, wenn dort nicht gesetzt.

## 3. N:1-Verbindung zu CRM-Kontakten

* **Zugehörige Kontakte**: Das Firmenprofil (`src/pages/Companies.tsx`) listet alle Kontakte mit passender `associated_company_id`.
* **Hauptansprechpartner**: Ist `responsible_person` gesetzt, adressiert Louis AI Schreiben automatisch an diese Person.
* **Dokumente**: Firmen können eigene Vault-Dateien (custom documents) ablegen.

## 4. AI-Features für Firmenkonten

* **Analytik**: „Welches Unternehmen hat im letzten Quartal den meisten Umsatz erzielt?“ → `crm_data_analyst` verknüpft Firmen- und Rechnungsdaten.
* **Erstellung/Aktualisierung**: `create_company_draft` / `update_company_draft` — immer als **Freigabe-Entwurf** (Human-in-the-Loop, einheitlicher Draft-Flow).
* **Labels**: Louis AI interpretiert Tags für Mailing-Listen oder Rabatt-Kampagnen; Workflows pflegen Labels automatisch (`AddLabel`).

## 5. Workflow-Anbindung

* **Events**: `company.created`, `company.updated`, `company.deleted` → Workflow-Trigger (z. B. Konsistenzprüfung, Onboarding).
* **Reports**: Agent-Jobs (z. B. `report_contacts_quality.cjs`) liefern wöchentliche Datenqualitäts-Kennzahlen (ohne Namen, DSGVO-konform).
