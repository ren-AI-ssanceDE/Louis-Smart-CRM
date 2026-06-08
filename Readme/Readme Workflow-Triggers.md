# ⚡ Wiki: Automatisierte Workflow-Trigger in Louis Smart CRM

Eines der mächtigsten Werkzeuge in **Louis Smart CRM** ist das integrierte, ereignisgesteuerte Automatisierungssystem. Es ermöglicht Unternehmen, repetitive Geschäftsprozesse vollautomatisch und fehlerfrei im Hintergrund ablaufen zu lassen, sobald bestimmte Schlüsselereignisse (sogenannte **Trigger**) im CRM eintreffen.

Durch die intelligente Kopplung von **System-Triggern** mit dem **Louis AI Assistenten** können Sie komplexe Handlungsabfolgen ("Rezepte") definieren, die ohne manuelles Zutun ausgeführt werden.

---

## 🏗️ 1. Die vier intelligenten System-Trigger

Das CRM überwacht kontinuierlich alle Datenbewegungen und löst bei definierten Zustandsänderungen sofort die entsprechenden Workflows aus. Im Speziellen sind vier zentrale Trigger im Kern des Systems verankert:

### 🟢 A. `invoice.paid` (Rechnung wurde bezahlt)
* **Wann wird es ausgelöst?** Sobald der Zahlungseingang für eine offene Rechnung im System registriert und die Rechnung als "bezahlt" (Status: `paid`) gebucht wird.
* **Typische Anwendungen:**
  * Automatischer Versand einer Zahlungsbestätigung per E-Mail an den Kunden.
  * Erstellung einer internen Timeline-Notiz ("Zahlung erhalten").
  * Aktualisierung von Kunden-Labels (z.B. Entfernen des Tags "Zahlung ausstehend").

### 🔴 B. `invoice.overdue` (Rechnung ist überfällig)
* **Wann wird es ausgelöst?** Das System prüft über einen zeitgesteuerten Hintergrund-Scheduler (Heartbeat) kontinuierlich alle ausstehenden Posten. Erreicht eine Rechnung ihr Fälligkeitsdatum (`due_date`) ohne Zahlungseingang, wechselt ihr Status automatisch auf "überfällig" (`overdue`). In diesem Moment zündet der Trigger.
* **Typische Anwendungen:**
  * Vorbereitung eines freundlichen Zahlungserinnerungs-Entwurfs im Postausgang.
  * Automatische Zuweisung des Labels "Zahlungsverzug" an das verknüpfte Kundenprofil.
  * Benachrichtigung der Buchhaltung zur weiteren Überwachung.

### 👥 C. `contact.updated` (Ansprechpartner wurde aktualisiert)
* **Wann wird es ausgelöst?** Sobald die Daten eines bestehenden Kontaktes (z.B. Telefonnummer, E-Mail-Adresse, Zuständigkeiten, Wohnort oder zugewiesene Tags) bearbeitet oder aktualisiert werden.
* **Typische Anwendungen:**
  * Automatischer Abgleich der Kontaktdaten mit verknüpften Systemen.
  * Dokumentation der vorgenommenen Änderungen im globalen Änderungsverlauf (Audit Log).
  * Ansteuerung von Folge-Workflows, falls sich spezifische Verantwortlichkeiten ändern.

### 🏢 D. `company.updated` (Unternehmensprofil wurde aktualisiert)
* **Wann wird es ausgelöst?** Bei jeder Änderung an den Stammdaten eines Kundenunternehmens (z.B. Firmenname, Steuernummern, Leitweg-ID, Bankverbindungen oder Labels).
* **Typische Anwendungen:**
  * Konsistenzprüfung verknüpfter Verträge und Rechnungen.
  * Aktualisierung von Zuständigkeiten bei den im Unternehmen beschäftigten Kontakten.

---

## ⚙️ 2. Wie Sie Workflows einrichten und verwalten

Die Verwaltung aller automatischen Abläufe erfolgt komfortabel über die Benutzeroberfläche im Admin-Bereich unter dem Reiter **"Louis AI Workflows"** (`src/components/admin/LouisAiWorkflowsTab.tsx`).

```
                    ADMIN-BEREICH ➔ WORKFLOW-VERWALTUNG
+-------------------------------------------------------------------------+
|                                                                         |
|  1. TRIGGER-TYP WÄHLEN          2. AKTIONEN DEFINIEREN (Rezepte)         |
|  [ CRM_EVENT               ▼ ]  [+] E-Mail vorbereiten / versenden      |
|  Ereignis: [ invoice.paid  ▼ ]  [+] Kontakt-Label hinzufügen             |
|                                 [+] Historien-Notiz schreiben           |
+-------------------------------------------------------------------------+
```

Ein Workflow besteht immer aus einem **Auslöser** (Trigger) und einer **Kette von Aktionen** (Rezepte/Toolchains):

### Die drei verfügbaren Trigger-Arten:
1. **`MANUAL` (Manueller Start):** Der Workflow wird vom Benutzer gezielt per Knopfdruck oder per Chat-Anweisung an Louis gestartet.
2. **`CRM_EVENT` (Ereignisgesteuert):** Der Workflow lauscht im Hintergrund auf die oben genannten System-Ereignisse (wie `invoice.overdue`) und startet sekundenschnell.
3. **`TIMER` (Zeitgesteuert / Scheduler):** Der Workflow wird zyklisch ausgeführt – entweder stündlich oder täglich zu einer exakt definiertem Uhrzeit (z.B. jeden Morgen um 08:30 Uhr).

---

## 💡 3. Praxisbeispiel: Der automatisierte Mahnlauf

Dieses Beispiel zeigt, wie ein vollautomatisierter Mahnprozess im CRM im Zusammenspiel mit Louis AI abläuft:

```
┌─────────────────────────────────┐
│     Hintergrund-Scheduler       │  ➔ Errechnet Fälligkeit
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Trigger: `invoice.overdue`    │  ➔ Zündet bei Überschreitung des Termins
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Schritt 1: Notiz in Timeline  │  ➔ Schreibt: "Rechnung Nr. 1042 überfällig"
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Schritt 2: Frist-Label setzen  │  ➔ Fügt dem Kunden "In Verzug" als Tag hinzu
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Schritt 3: Mail-Draft erstellen │  ➔ Erzeugt vorbereiteten E-Mail-Entwurf 
└────────────────┬────────────────┘     (Status: PENDING zur Freigabe)
                 ▼
 🛑 [ HUMAN-IN-THE-LOOP CHECK ]    ➔ Mitarbeiter prüft & gibt per Klick frei
                 ▼
┌─────────────────────────────────┐
│       Versand über SMTP         │  ➔ E-Mail geht rechtskonform an den Kunden
└─────────────────────────────────┘
```

---

## 🛡️ 4. Sicherheit, Integrität & Schutzmechanismen

Um maximale geschäftliche Stabilität und Verlässlichkeit zu garantieren, verfügt die Workflow-Engine über integrierte Absicherungssysteme:

### 1. Doppel-Ausführungsschutz (Idempotency Guard)
Damit Kunden beispielsweise bei einem Netzwerk-Schluckauf oder schnellen Klicks nicht mit mehreren Mahnungs-E-Mails bombardiert werden, blockiert ein intelligenter Schutz die mehrfache Ausführung:
* **Duplikats-Filter:** Erkennt und blockiert identische Ereignisse innerhalb eines kurzen Zeitfensters (15 Sekunden).
* **Pipeline-Sperre:** Bevor ein zeitverzögerter Schritt startet, wird geprüft, ob bereits ein identischer Workflow für denselben Vorgang aktiv ist.

### 2. "Human-in-the-Loop" standardmäßig aktiv
Aus Sicherheitsgründen wird Louis AI **niemals eigenmächtig** unüberprüfte E-Mails direkt an Kunden versenden.
* **Entwurfs-Sperre:** Der Workflow erstellt die E-Mail zunächst als Entwurf im Status `PENDING`.
* **Mitarbeiter-Kontrolle:** Der Entwurf wird im **E-Mail Freigabe-Center** (`src/components/admin/EmailDraftsApprovalPanel.tsx`) angezeigt. Erst wenn ein Mitarbeiter die E-Mail liest und auf **Freigeben** klickt, wird sie über das Firmen-SMTP-Postfach versendet.

### 3. Asynchrone Fehlerbehandlung
Falls ein externer Dienst (z.B. Ihr SMTP-Server) kurzfristig nicht erreichbar ist, bricht das System nicht ab. Fehler werden präzise abgefangen, die Workflow-Instanz wird geordnet auf `FAILED` gesetzt und die genaue Ursache im systeminternen Logbuch festgehalten, sodass Sie die Aktion nach Behebung manuell fortsetzen können.
