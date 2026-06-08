# 📋 Wiki: Vorlagen- & Template-Management

Die Wiederverwendbarkeit von Belegen, Anschreiben und Benachrichtigungen wird über das CRM-Vorlagenmodul gesteuert. Das Vorlagen-System von **Louis Smart CRM** ermöglicht es, standardisierte Strukturen anzulegen, die dynamisch mit Kundendaten gefüllt werden können.

---

## 🎨 1. Das Vorlagen-Tab (`src/components/admin/TemplatesTab.tsx`)

Im Administrationsbereich können Benutzer unter dem Reiter **"Vorlagen"** alle gespeicherten Textvorlagen verwalten:
* Erstellen neuer Briefvorlagen, Rechnungs-Begleitnotizen oder Mahnstufen-Texte.
* Festlegen eines Standard-Betreffs und vordefinierten Inhalts.
* Einbinden des KI-Textgenerators, um bestehende Vorlagen im Handumdrehen sprachlich aufzupolieren oder zu kürzen.

---

## 🔁 2. Der Variablen-Ersetzungsmechanismus (Placeholders)

Beim Verwenden einer Vorlage sucht das System nach Platzhaltern in geschweiften Klammern `{...}` und ersetzt diese durch echte Attribute des geladenen Datensatzes.

| Platzhalter | Datenbankfeld des Typs | Beispielhaftes Ergebnis |
| :--- | :--- | :--- |
| `{first_name}` | `contact.first_name` | Max |
| `{last_name}` | `contact.last_name` | Mustermann |
| `{company_name}` | `company.full_legal_name` | Bosch GmbH |
| `{invoice_number}` | `invoice.invoice_number` | RE-2026-0034 |
| `{due_date}` | `invoice.due_date` | 16. Juni 2026 |
| `{total_amount}` | `invoice.total_gross_amount` | 1.190,00 € |

### Programmiertechnischer Ersetzungs-Fahrplan (Regex-Interpolation):
```typescript
export function renderTemplate(templateText: string, context: Record<string, any>): string {
  return templateText.replace(/{([^{}]+)}/g, (match, key) => {
    return context[key.trim()] !== undefined ? String(context[key.trim()]) : match;
  });
}
```

---

## 🛡️ 3. Vorlagenkategorien

Zur besseren Strukturierung werden Vorlagen in Kategorien eingeteilt:
* **`invoice_delivery`**: Textbaustein für den Erstversand von Rechnungen.
* **`invoice_remind_1`**: Freundliche Zahlungserinnerung nach Verstreichen des Fälligkeitsdatums.
* **`invoice_remind_2`**: Bestimmte, formelle Mahnung inklusive Ankündigung von Verzugszinsen.
* **`customer_onboarding`**: Standardisiertes Begrüßungsschreiben für Neukunden.

---

## 🚀 4. Integration in Louis AI und Mailing

Sowohl das SMTP-Mailsystem als auch der AI-Assistent nutzen diese Vorlagen als Baseline:
1. Bittet der Benutzer Louis AI, eine Mahnung zu schreiben, sucht Louis im Werkzeug `local_knowledge` nach einer Vorlage der Kategorie `invoice_remind_x`.
2. Findet der Agent eine passende Vorlage, wird deren Grundstruktur geladen und erst danach der KI-Schreibassistent gestartet. Dies garantiert, dass firmeninterne Richtlinien (z.B. rechtliche Klauseln oder Bankverbindungen) im Text erhalten bleiben und die KI lediglich die individuelle Formulierung optimiert.
