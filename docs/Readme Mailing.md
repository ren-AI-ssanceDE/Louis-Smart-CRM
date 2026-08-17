# ✉️ Mailing- & SMTP-Integration

> Mit Louis Smart CRM versenden Sie **Rechnungen, Zahlungserinnerungen und Kundenanschreiben** direkt aus der Anwendung — sicher, nachvollziehbar und immer mit Ihrer Freigabe. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was können Sie tun?

* **E-Mails aus dem CRM versenden** — Rechnungen, Mahnungen, Angebotsbegleitung, persönliche Anschreiben — mit Ihrem eigenen E-Mail-Server (z. B. `mail.ihrefirma.de`, Gmail, etc.).
* **Anhänge automatisch dabei** — beim Rechnungsversand wird die fertige PDF-Rechnung automatisch angehängt.
* **Vorlagen verwenden** — Standardtexte (z. B. Zahlungserinnerung) werden automatisch mit Kundendaten befüllt (`{first_name}`, `{invoice_number}`, `{total_amount}` …).
* **KI-Textentwürfe** — Louis formuliert den Text für Sie (freundlich, professionell, mahnend …), Sie passen an und senden.

## Das wichtigste Sicherheitsprinzip: Freigabe durch Sie

> **Louis kann niemals von sich aus E-Mails an Kunden versenden.**

Der Ablauf ist immer gleich:
1. Sie (oder ein automatisierter Workflow) beauftragen eine E-Mail.
2. Das System erstellt einen **Entwurf** — nichts wird versendet.
3. Im **E-Mail-Freigabe-Center** (und im Chat) sehen Sie den Entwurf: Betreff, Text, Anhänge.
4. Sie klicken **Freigeben** — erst dann geht die E-Mail raus.

So kann weder die KI noch ein Automatismus versehentlich falsche oder unpassende E-Mails verschicken.

## Einrichtung (einmalig, ~5 Minuten)

1. **Admin → E-Mail-Einstellungen** öffnen.
2. Ihre Serverdaten eintragen: Adresse (Host), Port (meist 465 oder 587), Benutzername, Passwort, Absenderadresse.
3. **„Verbindung Testen“** klicken — das System prüft, ob alles passt.
4. Speichern. Fertig.

## Was passiert mit gesendeten E-Mails?

* Jeder Versand wird im **Sicherheitsprotokoll (Audit-Log)** dokumentiert.
* Gesendete E-Mails werden als **Interaktionsverlauf** gespeichert — Louis kann später darauf zugreifen („Was haben wir der Firma X zuletzt geschrieben?“).

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. SMTP-Konfiguration (DB-gestützt)

Die Einstellungen liegen in `sys_integrations_smtp_nodes` (validiert durch `SmtpSettingsSchema` in `src/lib/schemas.ts`) und werden im Admin-Bereich konfiguriert:

| Feld | Bedeutung |
|---|---|
| `smtp_host_name` | SMTP-Server (z. B. `smtp.gmail.com`) |
| `smtp_port_number` | Port (465 SSL/TLS oder 587 STARTTLS) |
| `is_secure_connection` | Native TLS-Verbindung erzwingen |
| `smtp_user_name` | Login-Benutzername |
| `smtp_password_secret` | Passwort (Secret — wird nie im Client ausgegeben, in Logs maskiert) |
| `sender_email_address` | Tatsächliche Absenderadresse |
| `sender_display_name` | Optionaler Absendername |

* **Test**: `testSmtp`-Prozedur prüft die Verbindung vor dem Speichern.
* **Fehlerbehandlung**: SMTP-Fehler (falsches Passwort, Timeout) werden abgefangen und als klare Meldung gespiegelt — kein Crash.

## 2. Sicherheits-Guardrail: Human-in-the-Loop

> ### Louis AI versendet NIEMALS eigenmächtig E-Mails an echte Kunden.
> Dies ist eine feste Systembarriere gegen automatisierten Spam und KI-Halluzinationen.

### Ablauf
1. Anweisung an Louis AI (z. B. „Schreibe eine freundliche Zahlungserinnerung an Firma X“).
2. `send_smtp_email` erstellt einen **E-Mail-Entwurf** (Status `PENDING`) — kein Versand.
3. Der Entwurf erscheint im **E-Mail-Freigabe-Center** (`EmailDraftsApprovalPanel`) und im `proposedChanges`-Panel.
4. Der Benutzer prüft Betreff, Inhalt und Anhänge (z. B. die PDF-Rechnung) und klickt **Freigeben**.
5. Erst jetzt erfolgt der SMTP-Versand über `nodemailer` (TLS). Status: `APPROVED` → `SENT`.

## 3. Technischer Sendevorgang

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: smtp.smtp_host_name,
  port: smtp.smtp_port_number,
  secure: smtp.is_secure_connection,
  auth: { user: smtp.smtp_user_name, pass: smtp.smtp_password_secret }
});
```

## 4. Anhänge & Rechnungs-Bezug

* Beim Rechnungsversand lädt das System die generierte **PDF/A-3b-Datei** und hängt sie mit korrektem MIME-Type (`application/pdf`) an.
* Zusätzliche Anhänge: Base64-Dateien über `customAttachments`.
* **RAG-Integration**: Versendete E-Mails werden über `ingestEmailToRag` als Interaktionsverlauf indexiert und stehen späteren KI-Fragen zur Verfügung.

## 5. Mail-Drafts-API & Workflow-Anbindung

* **Router** (`mailDrafts.ts`): `getPending`, `updateDraft`, `approve`, `reject` — Status-Lebenszyklus `PENDING → APPROVED/REJECTED → SENT/FAILED`.
* **Workflows**: `SendEmail`-Knoten mit `direct_send_email: true` (sofortiger Versand mit Archivierung) oder `false` (Entwurf → `WAITING_FOR_DRAFT_APPROVAL` → Workflow pausiert bis Freigabe).
* **Vorlagen**: E-Mail-Texte kommen aus der Vorlagen-Bibliothek (`sys_comms_email_templates`, Signaturen, Rechnungstext- und Artikelvorlagen) — mit Platzhalter-Ersetzung `{first_name}`, `{invoice_number}`, `{total_amount}` etc.

## 6. KI-Textgenerierung

Der `AiTextGeneratorDialog` erstellt personalisierte Texte (freundlich / professionell / mahnend / kreativ) mit Kontext-Einspeisung (Empfänger, Betrag, Rechnungsnummer, Fälligkeit). Siehe [Readme Textgenerierung](Readme%20Textgenerierung.md).
