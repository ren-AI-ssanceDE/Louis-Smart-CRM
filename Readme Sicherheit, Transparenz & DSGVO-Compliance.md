# 🔒 Wiki: Sicherheit, Transparenz & DSGVO-Compliance

Als moderne Unternehmenssoftware zur Verarbeitung vertraulicher Geschäftsbeziehungen und finanzrelevanter Belege besitzt das Sicherheits- und Compliance-Konzept in **Louis Smart CRM** höchste Priorität. Es ist vollständig DSGVO-konform und entspricht den Grundsätzen GoBD.

---

## 📂 1. Unveränderbares Audit-Log (System-Transparenz)

Jede sensible Nutzeraktion, jeder API-Call und jeder autonome Schritt von Louis AI wird in einer lückenlosen Transaktionsdatenbank im Audit-Log aufgezeichnet. 

### Erfasste Ereignisse:
* Erstellung, Bearbeitung oder Löschung von Kundenkonten und Kontakten.
* Generierung, Verifizierung oder Export von E-Rechnungen.
* AI-Toolaufrufe (inklusive Konfidenzwert und ob die Aktion vom Agenten oder Menschen initiiert wurde).
* SMTP-Verbindungstests und Mail-Versand-Metadaten.

Das Audit-Log wird im Admin-Bereich (`src/components/admin/AuditLogTable.tsx`) visualisiert. Es ist rein anfügend (*Append-Only*). Selbst Administratoren können Einträge im regulären Betrieb nicht modifizieren oder löschen, was höchste Transparenz und Revisionssicherheit garantiert.

---

## 📤 2. DSGVO-Datenportabilität (Ein-Klick-Export)

Entsprechend **Art. 20 DSGVO (Recht auf Datenübertragbarkeit)** bietet das System eine automatisierte Funktion zum strukturierten Export aller gespeicherten Daten bezüglich einer Person oder Firma:

* **Inhalt des Exports**: Ein Klick im DSGVO-Tab (`src/components/admin/DataPortabilityTab.tsx`) erzeugt ein maschinenlesbares ZIP-Archiv oder eine strukturierte JSON-Datei.
* **Erfasste Daten**: Personenstammdaten, Historien, verknüpfte E-Mails, Rechnungsverläufe sowie alle hinterlegten Metadaten.
* **Nutzen**: Kunden können bei Beendigung des Vertragsverhältnisses verlangen, dass ihre Daten in maschinenlesbarer Form übergeben werden. Das System erfüllt diese Pflicht vollautomatisch innerhalb weniger Sekunden.

---

## 🗑️ 3. Löschkonzept und "Recht auf Vergessen"

Unter Berücksichtigung von **Art. 17 DSGVO ("Recht auf Löschen" / "Recht auf Vergessenwerden")** implementiert das System ein intelligentes Löschkonzept, das jedoch regulatorische Aufbewahrungspflichten nicht verletzt:

1. ** CRM-Kontakte**: Können vollständig und physikalisch gelöscht werden, sofern keine Rechnungsverbindlichkeiten bestehen.
2. **Rechnungen & Buchhaltungsdaten**: Rechnungen dürfen nach GoBD **nicht** gelöscht oder spurlos überschrieben werden (10 Jahre gesetzliche Aufbewahrungsfrist).
3. **Kaskadierendes Verhalten**: Wird ein zugehöriger Kontakt gelöscht, behält die historisch geschriebene Rechnung ihre Integrität (die Rechnungsadresse wird im XML/PDF-Metadatenstrom ehemals fest eingebrannt archiviert, während im CRM-Aktivitätsbereich der Datensatz datenschutzkonform anonymisiert wird).

---

## 🔑 4. Schutz von Drittanbieter-Schlüsseln (Secrets)

Um Zugangsdaten (wie den `GEMINI_API_KEY` oder das Passwort des SMTP-Postfachs) vor Diebstahl zu schützen, setzt Louis Smart CRM auf folgende Barrieren:

* **Kein Client-Zugriff**: Der Browser lädt niemals Passwörter oder API-Schlüssel herunter. requests werden über tRPC-Endpunkte ausschließlich serverseitig prozessiert.
* **Rolle der `.env`-Datei**: Umgebungsvariablen werden sicher im Docker-Container oder der Laufzeitumgebung gehalten und nicht in die Quellcode-Repositorys (Git) übertragen.
* **Maskierung in Log-Einträgen**: Bei SMTP-Verbindungsproblemen fängt das System Passwörter in Fehlermeldungen ab und maskiert diese (z.B. `***`), bevor sie in das Audit-Log geschrieben werden.
