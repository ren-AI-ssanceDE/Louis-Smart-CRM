# ⚙️ Wiki: Workflows & Tool-Integration

Die Flexibilität von **Louis Smart CRM** resultiert aus der sequentiellen Ausführung von vordefinierten Workflows und dynamischen Modul-Schnittstellen (Tools). Das System erlaubt es Benutzern, Prozesse zu automatisieren und der KI gezielte Handlungsmuster an die Hand zu geben.

---

## 🏗️ 1. Der ReAct Agent-Loop & Tools

Anstatt starr vorformulierte Skripte abzuarbeiten, agiert die KI im **ReAct-Modus (Reasoning + Acting)**. Bei jeder Benutzeranweisung entscheidet das zugrundeliegende LLM dynamisch, welche Werkzeuge geladen und in welcher Reihenfolge sie ausgeführt werden müssen.

Die im Backend (`src/server/ai/tools/`) modular deklarierten und in der Registry (`src/server/ai/tools.ts`) vereinten Kern-Tools umfassen:

### Die registrierten System-Tools:

1. **`local_knowledge` (RAG / Wissensdatenbank-Suche)**:
   * **Funktionsweise**: Durchsucht Mandanten-Dokumente und geteilte PDFs. Unterstützt eine Kontext-sensitive Entitätserkennung, um bei Anfragen automatisch zugehörige Unternehmens- oder Kontaktspeicher mit einzubeziehen.
   * **Bestandsliste**: Interzeptiert allgemeine Suchen nach verfügbaren Dateien und gibt eine strukturierte Übersicht der indizierten RAG-Dokumente zurück.

2. **`crm_data_analyst` (Strukturierte DB-Abfragen)**:
   * **Funktionsweise**: Ermöglicht eine flexible Aggregation und Filterung der CRM-Tabellen (Unternehmen, Kontakte, Rechnungen).
   * **Merkmale**: Suchbegriffe werden über eine Stoppwort-Filterung gereinigt und mittels eines hybriden SQL-Scorings (bzw. In-Memory Levenshtein-Fuzzy-Matching im Fallback-Modus) bewertet, um fehlerhafte Eingaben auszugleichen. Berechnet komplexe Summen wie ausstehende Bruttoumsätze oder bezahlte Posten.

3. **`web_search` (Konfigurierbare Websuche)**:
   * **Funktionsweise**: Bietet vier integrierte Suchverfahren, gesteuert über die Admin-Einstellungen:
     * **Gemini Google Grounding**: Nutzt die native Websuche von Google über das Gemini-Modell inklusive automatischer Quellen-Zitierung im Metadaten-Strom.
     * **Google Custom Search API**: Direkte, parametrisierte JSON-Suche über das Google Search API-Gateway.
     * **SearXNG API / Scraper**: Verteilte Abfrage über eigene SearXNG-Knoten.
     * **DuckDuckGo Scraper**: Robuster, anonymer HTML-Fallback mit integriertem linearen Backoff-Wiederholungsverfahren bei Timeouts.

4. **`create_draft_invoice` (Rechnungsentwurfs-Generator)**:
   * **Funktionsweise**: Ermöglicht es dem Agenten, vollständige Rechnungsentwürfe anzulegen. Die Umsatzsteuer (standardmäßig 19%) sowie Gesamt-Netto- und Bruttobeträge werden automatisch berechnet und GoBD-konform gerundet.

5. **`create_draft_company` (Unternehmensentwurfs-Generator)**:
   * **Funktionsweise**: Legt neue Firmenprofile mit Anschrift, Kontaktdaten, IBAN/BIC, Steuernummern und Leitweg-ID im Entwurfsmodus an.

6. **`create_draft_contact` (Kontaktentwurfs-Generator)**:
   * **Funktionsweise**: Erstellt neue Kontakte, verknüpft sie auf Wunsch mit einer übergeordneten Firmen-UUID und fügt ansteuerbare Kommunikationskanäle hinzu.

7. **`learn_workflow` (Rezept-Lern-Modus)**:
   * **Funktionsweise**: Ermöglicht es der KI, basierend auf einer natürlichen Handlungsanweisung ein wiederverwendbares Workflow-Rezept (Toolchain) zu entwerfen und persistent im System zu speichern.

8. **`send_smtp_email` (E-Mail-Vorbereitung & GoBD-Compliance)**:
   * **Funktionsweise**: Analysiert unstrukturierte Textanweisungen, löst Empfänger-Pseudonyme über das CRM auf und durchsucht physische Dateiordner (Wissensdatenbank-Pfad, Kontakt-/Unternehmens-Vaults) nach passenden E-Mail-Anhängen.
   * **Sicherheits-Schranke**: Im Sinne der GoBD-Richtlinien wird die E-Mail **nicht** blind versandt. Das Tool übergibt stattdessen einen strukturierten Vorschlag an den *Human-in-the-Loop*-Layer (`proposedChanges`), um dem Anwender die Freigabe des SMTP-Versands vorzulegen.

---

## 📋 2. Custom Workflows (Benutzerdefinierte Arbeitsabläufe)

Über die Workflow-Verwaltung (`src/components/admin/LouisAiWorkflowsTab.tsx`) können wiederholbare Prozessketten definiert werden. Ein Workflow besteht aus einer logischen Abfolge von Schritten (Toolchains). Jedes Rezept wird durch einen der folgenden drei Trigger gestartet:

### Die drei Workflow-Trigger:
1. **`MANUAL` (Manueller Start)**:
   * Wird direkt im UI oder im Chat durch den Benutzer gezielt aufgerufen.
2. **`CRM_EVENT` (Ereignis-gesteuert)**:
   * Lauscht auf den System-Eventbus (`src/server/ai/workflowEventBus.ts`). Sobald eine CRM-Aktion eintritt (z. B. ein neuer Neukunde angelegt oder eine Rechnung als überfällig markiert wird), triggert die Engine den verknüpften Workflow.
3. **`TIMER` (Zeitgesteuert / Cron-System)**:
   * Erlaubt zyklische Automatisierungen. Unterstützt stündliche Ausführungen (`hourly`) sowie tägliche Ausführungen (`daily`) zu einer exakten Uhrzeit (z. B. "08:30" Uhr).

---

## 💾 3. Workflow-Engine & Hintergrund-Scheduler

Die **Louis Workflow Engine** (`src/server/ai/workflowEngine.ts`) steuert die asynchrone Bearbeitung aller laufenden Instanzen:

* **Taktfrequenz (Heartbeat)**: Ein kontinuierlicher Hintergrund-Scheduler prüft alle 10 Sekunden fällige Aufgaben (Delayed Queue) sowie periodisch fällige Timer-Jobs.
* **Verzögerungs-Warteschlange (Delayed Queue)**: Workflow-Schritte können mit einer Verzögerung (`delay_seconds`) versehen werden. Die Engine speichert diese im Zustand `PENDING_DELAY` und reaktiviert sie präzise, sobald der geplante Ausführungszeitpunkt (`execute_at_utc`) erreicht ist.
* **Doppel-Ausführungsschutz (Idempotency Guard)**:
  * Um race conditions und mehrfache Zusendungen bei parallelen Ereignissen zu verhindern, greift ein zweistufiger Idempotenz-Schutz:
    1. **In-Memory-Sliding-Window**: Speichert Kaskaden-Auslöser für 15 Sekunden im Arbeitsspeicher und filtert identische Payloads für dieselbe Entität sofort aus.
    2. **Datenbank-Audit**: Validiert vor dem Start, ob sich bereits eine aktive Instanz im Zustand `PENDING_DELAY` oder `RUNNING` für dieselbe Rezeptur und Entitäts-ID in der Pipeline befindet.

---

## ⚙️ 4. Workflow-Executor & Schritt-Abarbeitung

Der **Workflow Executor** (`src/server/ai/workflowExecutor.ts`) verarbeitet Schritt für Schritt die modellierten Toolchains einer Instanz.

### Die unterstützten Schritt-Aktionen:

* **Mailing-Aktionen (`SendEmail` / `EmailClient` / `send_smtp_email`)**:
  * **Direkter Versand (`direct_send_email: true`)**: Die E-Mail wird über das registrierte SMTP-Relay gesendet und im Dateisystem archiviert.
  * **Entwurfspause (`direct_send_email: false`)**: Der Executor erzeugt einen E-Mail-Draft in `sys_louis_mail_drafts` mit dem Status `PENDING`. Das Workflow-Verfahren wechselt in den Zustand `WAITING_FOR_DRAFT_APPROVAL` und pausiert die Ausführung so lange, bis ein Mitarbeiter den Entwurf im Freigabe-Center (`src/components/admin/EmailDraftsApprovalPanel.tsx`) geprüft und freigegeben hat. Nach Freigabe wird der Workflow nahtlos fortgeführt.
  * **RAG-Integration**: Gesendete E-Mails werden automatisch über den Ingestion-Kanal (`ingestEmailToRag`) als Interaktionsverlauf erfasst und stehen kommenden KI-Fragen zur Verfügung.

* **Labeling-Aktion (`AddLabel` / `UpdateContactLabels`)**:
  * Heftet dynamisch anpassbare Tags an Kontakt-Datensätze im Dateisystem oder in der PostgreSQL-Registry (mit automatischer De-Duplizierung).

* **Timeline-Notizen (`CreateEntityNote` / `AddNote`)**:
  * Erstellt strukturierte Notiz-Einträge und protokolliert die erzeugten Inhalte als auditierungsfähige Ereignisse im CRM-Aktivitätsverlauf.

### Fehlerbehandlung & Resilienz:
Sollte ein Einzelschritt fehlschlagen (z. B. SMTP-Timeout, fehlender API-Key, gelöschte Dateien), bricht das System nicht unkontrolliert ab. Die Instanz fängt Ausnahmen ab, wechselt geordnet in den Zustand `FAILED` und dokumentiert die exakte Fehlerursache mit Zeitstempel im internen `execution_log`, um volle Transparenz und einfache Nachbesserung zu gewährleisten.
