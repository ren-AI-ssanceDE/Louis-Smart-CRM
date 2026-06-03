# 👥 Wiki: CRM-Kontaktmanagement

Das Kontaktmanagement in **Louis Smart CRM** verwaltet alle Personenbeziehungen und Interaktionen im System. Es ist eng mit dem Firmenkonten-Modul verknüpft, kann aber auch autarke Einzelpersonen (B2C) abbilden.

---

## 🛠️ 1. Datenstruktur & Zod-Validierung

Jedem Kontakt liegt ein strenges Validierungsschema zugrunde (`ContactSchema` in `src/lib/schemas.ts`). Dies verhindert Daten-Regressionen und garantiert, dass KI-Modelle stets valide Datenstrukturen erzeugen.

### Wesentliche Felder des Kontakts:
* **Identifikation**:
  * `id_uuid` (UUID, Primärschlüssel)
  * `first_name` & `last_name` (Nachname ist Pflichtfeld)
  * `full_legal_name` (Generiert aus Vor- und Nachname)
* **Zugehörigkeit**:
  * `associated_company_id` (UUID, Fremdschlüssel auf die verknüpfte Firma)
* **Kommunikationsdaten**:
  * `email_address` (Standard-E-Mail, validiert via RFC 5322 Standard)
  * `email_2` (Alternative E-Mail)
  * `phone_number` / `mobile_number` / `fax_number` (Rufnummern)
  * `website` (URL-validiert)
* **Datenschutz & Einwilligungen (Opt-Ins)**:
  * `opt_in_marketing` (E-Mail Marketing zugestimmt)
  * `opt_in_sms` / `opt_in_phone` / `opt_in_direct_message` (Kanalspezifische Werbeeinwilligungen)
* **AI-Metadaten**:
  * `created_by_identity` (`'human' | 'ai_assistant' | 'system'`)
  * `ai_confidence_score` (Konfidenzfaktor zwischen 0.0 und 1.0)
  * `is_verified_by_human` (Flag, ob ein Mensch den Dateneintrag geprüft hat)

---

## 🔗 2. Firmenverknüpfung (N:1-Beziehung)

Ein Kontakt kann über `associated_company_id` mit genau einem Firmenprofil assoziiert werden. Im Client (`src/pages/Contacts.tsx`) äußert sich diese Koppelung wie folgt:
* Beim Aufrufen eines Kontakts wird das Firmenprofil inline geladen.
* Geerbte Attribute: Wenn beim Kontakt Rechnungsdaten (wie `payment_term` oder `price_list`) leer gelassen werden, erbt der Rechnungslauf automatisch die Konditionen der zugeordneten Muttergesellschaft.
* Löschweiterleitung: Wird eine Firma gelöscht, behalten verknüpfte Kontakte ihre Integrität, wobei `associated_company_id` auf `null` gesetzt wird (keine harte Kaskadierung zum Schutz vor Datenverlust).

---

## 📤 3. Massenimport & CSV-Integrität

Kontakte können in großen Mengen importiert werden. Der CSV-Importer prüft pro Zeile:
1. **Pflichtfelder**: Zeilen ohne einen Namen oder mit ungültigem Syntaxformat werden im Fehlerprotokoll isoliert.
2. **Dubletten-Erkennung**: Ist im System bereits ein Kontakt mit derselben E-Mail-Adresse (`email_address`) vorhanden, wird der Eintrag wahlweise übersprungen oder mit neuen CSV-Feldern aktualisiert (*Upsert-Funktion*).
3. **Format-Bereinigung**: Postleitzahlen, Telefonnummern und Ländercodes werden vollautomatisch normalisiert (z.B. Ländercode auf 2-stelligen ISO-Standard `DE`).

---

## 🤖 4. Autonome Pflege durch Louis AI

Der AI-Agent kann Kontakte direkt per Spracheingabe manipulieren.
* **Erstellung via Prompt**: *"Lege einen neuen Kontakt Max Mustermann für die Firma XYZ an mit der E-Mail max@mustermann.de."*
* **Arbeitsweise**: Der Agent führt das Tool `create_draft_contact` aus. Louis AI berechnet den Intent, extrahiert die Felder, setzt `created_by_identity: 'ai_assistant'` und legt einen Entwurf an. Der menschliche Benutzer sieht diesen Entwurf in seinen Benachrichtigungen und kann ihn mit einem Klick verifizieren (`is_verified_by_human: true`).
