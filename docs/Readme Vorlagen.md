# 📋 Vorlagen- & Template-Management

> Vorlagen sind **wiederverwendbare Textbausteine** — einmal erstellen, überall nutzen, automatisch mit Kundendaten befüllen. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was sind Vorlagen?

Vorlagen sind fertige Textbausteine für wiederkehrende Schreiben — z. B.:

* **E-Mail-Vorlagen:** Zahlungserinnerung, Rechnungsbegleitung, Onboarding-Begrüßung, Mahnstufen-Texte
* **Signaturen:** Ihre E-Mail-Signatur (Name, Firma, Kontakt)
* **Rechnungstext-Vorlagen:** Fußzeilen, Zahlungsbedingungen auf Rechnungen
* **Artikel-/Positionsvorlagen:** Häufig verkaufte Positionen („Softwareberatung, 10 Std.“) — ein Klick, fertig
* **Workflow-Vorlagen:** Fertige Automatisierungen zum Starten (Zahlungserinnerung, Angebot nachfassen, Onboarding, Overdue-Report)

## Wie funktionieren Platzhalter? (Das Herzstück)

In Vorlagen schreiben Sie Platzhalter in geschweiften Klammern, die das System **automatisch durch echte Daten ersetzt**:

| Platzhalter | Wird zu |
|---|---|
| `{first_name}` | Max |
| `{company_name}` | Bosch GmbH |
| `{invoice_number}` | RE-2026-0034 |
| `{due_date}` | 16. Juni 2026 |
| `{total_amount}` | 1.190,00 € |

**Beispiel:** Sie schreiben eine Vorlage „Sehr geehrte/r {first_name} {last_name}, Ihre Rechnung {invoice_number} über {total_amount} ist am {due_date} fällig…“ — und jeder Kunde erhält automatisch seinen individuellen Text.

## So nutzen Sie Vorlagen

1. **Admin → Vorlagen** öffnen.
2. Neue Vorlage anlegen (Kategorie wählen, Text mit Platzhaltern schreiben) — oder eine bestehende mit Louis' Hilfe umformulieren.
3. Beim E-Mail-Schreiben oder Workflow-Erstellen die Vorlage auswählen — fertig.

## Vorteile

* **Einheitlichkeit:** Jedes Schreiben sieht gleich aus und enthält die nötigen rechtlichen Klauseln.
* **Weniger Tipparbeit:** Kein Kopieren/Einfügen mehr.
* **KI-Respekt für Ihre Vorlagen:** Bittet man Louis, eine Mahnung zu schreiben, nutzt er zuerst Ihre Vorlage und verbessert nur die Formulierung — Ihre Bankverbindung und Klauseln bleiben erhalten.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Vorlagen-Typen & Verwaltung

Im Admin-Bereich unter **„Vorlagen“** (`src/components/admin/TemplatesTab.tsx`) werden vier Vorlagen-Kategorien verwaltet:

| Kategorie | Tabelle / Router | Zweck |
|---|---|---|
| **E-Mail-Vorlagen** | `sys_comms_email_templates` (settingsRouter) | Briefe, Mahnstufen-Texte, Begleitnotizen, Onboarding |
| **Signaturen** | settingsRouter (`getSignatures`/`createSignature`/…) | E-Mail-Signaturen für Absender |
| **Rechnungstext-Vorlagen** | `sys_comms_invoice_text_templates` | Textbausteine auf Rechnungen (z. B. Fußzeilen, Zahlungsbedingungen) |
| **Artikel-/Positionsvorlagen** | `sys_comms_invoice_item_templates` | Wiederverwendbare Positionen für Angebote/Rechnungen |
| **Workflow-Vorlagen** | Workflow-Bibliothek | 1-Klick-Starter: Zahlungserinnerung, Angebot nachfassen, Onboarding, Overdue-Report |

Zusätzlich unterstützen Angebote eigene PDF-/Text-Vorlagen (`offersRouter`: `getTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`, `importOfferTemplates`).

## 2. Platzhalter-Ersetzung

Beim Verwenden einer Vorlage ersetzt das System Platzhalter `{...}` durch echte Attribute des geladenen Datensatzes:

| Platzhalter | Datenbankfeld | Beispiel |
|---|---|---|
| `{first_name}` / `{last_name}` | `contact.first_name/last_name` | Max / Mustermann |
| `{company_name}` | `company.full_legal_name` | Bosch GmbH |
| `{invoice_number}` | `invoice.invoice_number` | RE-2026-0034 |
| `{due_date}` | `invoice.due_date` | 16. Juni 2026 |
| `{total_amount}` | `invoice.total_gross_amount` | 1.190,00 € |
| `{my_company_name}` / `{my_contact_person}` | MyCompany | eigene Firma |

### Implementierung (Regex-Interpolation)
```typescript
export function renderTemplate(templateText: string, context: Record<string, any>): string {
  return templateText.replace(/{([^{}]+)}/g, (match, key) => {
    return context[key.trim()] !== undefined ? String(context[key.trim()]) : match;
  });
}
```

> **Hinweis:** In Workflow-DAG-Knoten wird die Doppel-Klammer-Syntax `{{customer.name}}` für Variablen-Interpolation aus dem Workflow-Kontext verwendet (`IWorkflowNode.instructions_template`).

## 3. Vorlagen-Kategorien (fachlich)

* `invoice_delivery` — Textbaustein für den Erstversand von Rechnungen
* `invoice_remind_1` — freundliche Zahlungserinnerung
* `invoice_remind_2` — formelle Mahnung inkl. Verzugszins-Hinweis
* `customer_onboarding` — Begrüßungsschreiben für Neukunden

## 4. Integration in Louis AI & Mailing

1. Bittet der Benutzer Louis AI um eine Mahnung, sucht der Agent per `get_templates` / `get_template_details` nach der passenden Vorlage.
2. `apply_template` befüllt die Platzhalter mit Kontext (Rechnungsnummer, Betrag, Fälligkeit, eigenes Unternehmen).
3. Erst danach startet der KI-Schreibassistent — firmeninterne Richtlinien (rechtliche Klauseln, Bankverbindungen) bleiben erhalten, die KI optimiert nur die Formulierung.

## 5. KI-Tools für Vorlagen

Im SYSTEM_TOOL_CATALOG (Domäne `TEMPLATES`):
* `get_templates` — Suche nach Vorlagen (Kategorie/Text)
* `get_template_details` — Details einer Vorlage
* `apply_template` — Anwendung mit Platzhalter-Kontext
