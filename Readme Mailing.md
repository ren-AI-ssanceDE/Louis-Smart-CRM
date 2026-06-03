# ✉️ Wiki: Mailing- & SMTP-Integration

Die E-Mail-Kompatibilität von **Louis Smart CRM** erlaubt es Benutzern, Rechnungen, Zahlungserinnerungen und personalisierte Kundenanschreiben direkt aus der Anwendung heraus zu versenden. Das Backend kotiert alle Mail-Vorgänge über eine verschlüsselte SMTP-Node.

---

## ⚙️ 1. Datenbank-Schema & SMTP Konfiguration

Die Einstellungen zur E-Mail-Übertragung werden in der Tabelle `sys_integrations_smtp_nodes` abgelegt. Jedes Feld ist über das `SmtpSettingsSchema` in `src/lib/schemas.ts` gesichert:

* **`smtp_host_name`**: Der SMTP Server (z.B. `smtp.gmail.com` oder `mail.yourdomain.de`).
* **`smtp_port_number`**: Port des Servers (z.B. Port `465` für SSL/TLS oder Port `587` für STARTTLS).
* **`is_secure_connection`**: Boolean-Flag. Steuert, ob eine native TLS-Verschlüsselung erzwungen wird.
* **`smtp_user_name`**: Benutzername für den Server-Login.
* **`smtp_password_secret`**: Das zugehörige Passwort. Im Backend wird dieses Feld als geschütztes Secret behandelt und niemals im Client im Klartext ausgegeben.
* **`sender_email_address`**: Die tatsächliche Absenderadresse (z.B. `rechnung@firma.de`).
* **`sender_display_name`**: Optionaler Absendername (z.B. `"LOUIS Billing Service"`).

---

## 🛡️ 2. Sicherheits-Guardrail: Human-in-the-Loop

> ### **WICHTIGE VERTRETER-REGEL**
> Louis AI darf **unter keinen Umständen** selbstständig oder eigenmächtig E-Mails an echte Kunden herausschicken. Dies ist eine feste Systembarriere zur Vermeidung von automatisiertem Spam und Falschaussagen (Halluzinationen).

### Der Ablauf eines E-Mail-Vorgangs:
1. Der Benutzer bittet Louis AI: *"Schreibe eine freundliche Zahlungserinnerung an Firma Bosch."*
2. Louis AI generiert den Text und legt einen **Vorschlag (Draft / Proposed Change)** in der Datenbank an.
3. Der Benutzer sieht im UI in der Liste der ausstehenden Genehmigungen den E-Mail-Draft.
4. Der Mail-Dialog (`src/components/MailDialog.tsx`) öffnet sich. Der Benutzer kann den Betreff, den Inhalt und optionale Anhänge (wie die zugehörige PDF-Rechnung) modifizieren.
5. Erst nach Klick auf **"Senden"** durch den menschlichen Benutzer wird der eigentliche SMTP-Versand im Backend getriggert.

---

## 🏗️ 3. Technischer Sendevorgang im Backend

Der eigentliche Versand wird über das Node-Modul `nodemailer` abgewickelt (`src/server/routers/settings.ts` oder `src/server/routers/louisAi.ts`). 

### TLS/SSL Verbindungslogik (Auszug):
```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: smtp.smtp_host_name,
  port: smtp.smtp_port_number,
  secure: smtp.is_secure_connection,
  auth: {
    user: smtp.smtp_user_name,
    pass: smtp.smtp_password_secret,
  }
});
```

Falls der SMTP-Server eine Fehlermeldung zurückgibt (z.B. falsches Passwort oder Timeout am Port), fängt das Backend diesen Fehler ab und spiegelt dem Client eine detaillierte Fehlermeldung, anstatt abzustürzen.

---

## 📎 4. Anhänge & Rechnungs-Bezug

Wird eine E-Mail im Kontext einer Rechnung versendet (z.B. Rechnungsversand), lädt das System im Hintergrund die generierte PDF/A-3b Datei und fügt sie als binären Datenstrom mit dem korrekten MIME-Type (`application/pdf`) an die E-Mail an. Auch zusätzliche Anhänge können als Base64-kodierte Dateien über das Feld `customAttachments` an die API übermittelt werden.
