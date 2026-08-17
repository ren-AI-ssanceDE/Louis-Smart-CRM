# 👥 CRM-Kontaktmanagement

> In Louis Smart CRM verwalten Sie alle **Personen**, mit denen Sie geschäftlich zu tun haben — Ansprechpartner, Kundenkontakte, Lieferanten. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist ein „Kontakt“?

Ein Kontakt ist eine **Person**, die Sie in Ihrem CRM speichern — z. B. „Julia Sommer, Einkaufsleiterin bei Acme AG“. Kontakte gehören meist zu einem **Unternehmen** (siehe [Readme Unternehmen](Readme%20Unternehmen.md)), können aber auch einzeln stehen.

## Was können Sie mit Kontakten tun?

* **Anlegen & pflegen:** Name, E-Mail, Telefon, Adresse, Sprache — alles an einem Ort.
* **Einer Firma zuordnen:** Ein Kontakt gehört zu genau einem Unternehmen. Dadurch erbt er automatisch die Konditionen der Firma (z. B. Zahlungsziel) — Sie müssen nichts doppelt eintragen.
* **Datenschutz-Einwilligungen verwalten:** Für jeden Kanal (E-Mail, SMS, Telefon, Messenger, Social Media) können Sie separat speichern, ob der Kontakt der Kontaktaufnahme zugestimmt hat (DSGVO-Pflicht!).
* **Massenimport:** Sie können viele Kontakte aus einer **CSV-Datei** (z. B. aus Excel) importieren. Das System erkennt Dubletten (gleiche E-Mail) und bereinigt Formate automatisch.
* **KI-gestützt verwalten:** Sie können Louis einfach schreiben: *„Lege einen neuen Kontakt Julia Sommer an, E-Mail julia@sommer.de“* — Louis erstellt einen **Entwurf**, den Sie freigeben.

## Was passiert beim Löschen?

* Wenn Sie eine **Firma** löschen, bleiben ihre Kontakte erhalten (nur die Zuordnung wird entfernt) — so verlieren Sie keine wichtigen Daten.
* Kontakte können Sie vollständig löschen, solange keine Rechnungsverbindlichkeiten bestehen. Historische Rechnungen bleiben revisionssicher erhalten (gesetzliche Pflicht).

## Tipp für den Alltag

Nutzen Sie die **Notizen-Funktion**: Sie können zu jedem Kontakt Notizen hinterlegen (auch per Louis: *„Notiere, dass Julia Sommer im August im Urlaub ist“*). Notizen lassen sich später durchsuchen und ändern.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Datenstruktur & Zod-Validierung

Jedem Kontakt liegt das `ContactSchema` (`src/lib/schemas.ts`) zugrunde — die Single Source of Truth für KI-generierte und manuelle Datensätze.

### Wesentliche Felder
* **Identifikation**: `id_uuid` (UUID, PK), `first_name` & `last_name` (Nachname Pflicht), `full_legal_name`
* **Zugehörigkeit**: `associated_company_id` (UUID, Fremdschlüssel auf Firma)
* **Kommunikation**: `email_address` (RFC-5322-validiert), `email_2`, `phone_number`, `mobile_number`, `fax_number`, `website` (URL-validiert)
* **Anschrift**: `street`, `house_number`, `postal_code`, `city`, `country_code` (ISO-2), `language`
* **Datenschutz & Einwilligungen (Opt-ins)**: `opt_in_marketing`, `opt_in_social_media`, `opt_in_direct_message`, `opt_in_sms`, `opt_in_phone` — standardmäßig `false`, per KI-Tool setzbar
* **Geschäftsbedingungen (geerbt)**: `payment_term`, `price_list`, `vat_rate` (leer → Vererbung von der Mutterfirma)
* **KI-Metadaten**: `created_by_identity` (`human | ai_assistant | system`), `ai_confidence_score`, `is_verified_by_human`

## 2. Firmenverknüpfung (N:1)

* Beim Öffnen eines Kontakts wird das Firmenprofil inline geladen (`src/pages/Contacts.tsx`).
* **Geerbte Attribute**: Fehlen Rechnungsdaten (Zahlungsziel, Preisliste), übernimmt der Rechnungslauf die Konditionen der Muttergesellschaft.
* **Löschweiterleitung**: Wird eine Firma gelöscht, bleibt der Kontakt erhalten; `associated_company_id` wird auf `null` gesetzt (keine harte Kaskade → Datenschutz).

## 3. Massenimport & CSV-Integrität

1. **Pflichtfelder**: Zeilen ohne Namen oder mit ungültigem Format werden im Fehlerprotokoll isoliert.
2. **Dubletten-Erkennung**: Gleiche `email_address` → wahlweise überspringen oder aktualisieren (Upsert).
3. **Format-Bereinigung**: Postleitzahlen, Telefonnummern, Ländercodes (ISO-2, z. B. `DE`) werden normalisiert.

## 4. Autonome Pflege durch Louis AI

* **Erstellung**: „Lege einen neuen Kontakt … an“ → Tool `create_contact_draft` (inkl. optionaler Opt-in-Felder). Ergebnis ist ein **Freigabe-Entwurf** (`proposedChanges`) — erst nach menschlicher Bestätigung erfolgt der DB-Insert.
* **Aktualisierung**: „Ändere die Telefonnummer von …“ → `update_contact_draft` (Partial-Update, ebenfalls als Freigabe).
* **Notizen**: `create_note_draft`, `list_notes`, `update_note`, `delete_note` für Kontakte und Firmen.
* **Such- & Analyse-Tools**: `list_contacts` (Fuzzy-Suche), `crm_data_analyst` (Aggregationen, z. B. Kontakte ohne Firma, Datenqualität).
* **Verifikation**: Nach Freigabe wird `is_verified_by_human: true` gesetzt; KI-Anlagen tragen `created_by_identity: 'ai_assistant'`.

## 5. Workflow-Anbindung

* **Events**: `contact.created`, `contact.updated`, `contact.deleted` → Trigger für Workflows (z. B. Onboarding-Schreiben, Datenqualitäts-Checks).
* **Labels**: Kontakte können getaggt werden (`labels`); Workflow-Aktionen (`AddLabel`) pflegen diese automatisch.
* **Datenschutz-Regel**: QA-Tests laufen ausschließlich mit Testdaten (z. B. „Test Testkunde“ / Musterfirma GmbH), niemals mit echten Kontakten.
