# ⚡ Automatisierte Workflow-Trigger

> Workflow-Trigger sind die **Auslöser** für Ihre automatisierten Abläufe: ein Ereignis, eine Uhrzeit oder ein Klick. Letzte Aktualisierung: August 2026.

---

# 🧑‍💼 Teil 1 — Für Anwender (einfach erklärt)

## Was ist ein Trigger?

Ein Trigger ist der **Startknopf** eines Workflows. Es gibt drei Arten:

| Trigger | Einfach erklärt | Beispiel |
|---|---|---|
| **Manuell** | Sie starten den Ablauf selbst | „Starte den Wochenbericht“ |
| **Ereignis (CRM_EVENT)** | Das System startet automatisch, wenn etwas Bestimmtes passiert | Rechnung wird überfällig → Mahnlauf |
| **Zeitplan (TIMER)** | Das System startet zu festen Zeiten | Jeden Morgen um 08:30 Uhr → Tagesreport |

## Welche Ereignisse gibt es?

Das System „beobachtet“ ständig Ihre Daten. Bei diesen Ereignissen können Workflows automatisch starten:

* **Rechnungen:** angelegt, aktualisiert, finalisiert, **bezahlt**, **überfällig**, Status geändert
* **Kontakte:** angelegt, aktualisiert, gelöscht
* **Unternehmen:** angelegt, aktualisiert, gelöscht
* **Angebote:** angelegt, finalisiert, versendet, Status geändert
* **Kanban:** Board/Karte/Spalte angelegt, Karte verschoben/gelöscht, Freigabe erteilt/abgelehnt
* **Dateien:** Datei an Kontakt/Unternehmen hochgeladen, Datei ins interne Wissen hochgeladen
* **Sonstiges:** Council-Fallback

## Trigger eingrenzen: Bedingungen (Filter)

Sie können einen Ereignis-Trigger **eingrenzen**, damit er nur bei passenden
Ereignissen startet — statt bei jedem Ereignis dieses Typs:

* **Bedingung hinzufügen:** Wählen Sie ein Feld (z. B. Unternehmen, Dateiname,
  Entitätstyp), einen Operator (gleich, ungleich, enthält, beginnt mit, endet mit)
  und einen Wert.
* **Verknüpfung:** Mehrere Bedingungen werden mit **UND** (alle müssen passen)
  oder **ODER** (mindestens eine muss passen) verbunden.
* **Ohne Bedingungen** startet der Workflow bei **jedem** Ereignis dieses Typs.

**Beispiel:** „Wenn eine Datei an das Unternehmen *Musterfirma* hochgeladen wird
**und** der Dateiname auf `.pdf` endet“ → nur passende Uploads starten den
Workflow. Fehlt das Feld im Ereignis (z. B. kein Unternehmen zugeordnet), wird
die Bedingung als nicht erfüllt gewertet — der Workflow startet nicht.

## Workflows von Louis lernen lassen

Sie können Louis im Chat bitten, einen Workflow **mit Trigger** zu speichern,
z. B.: *„Merke dir: Wenn eine Datei an die Firma X hochgeladen wird, lege eine
Notiz an.“* Louis speichert den Workflow mit dem passenden Ereignis-Trigger
und optionalen Bedingungen — Sie sehen ihn danach im Admin-Bereich und können
ihn dort anpassen oder deaktivieren.

## Typische Beispiele

* **Rechnung bezahlt** → automatische Zahlungsbestätigung an den Kunden (als Entwurf), Timeline-Notiz „Zahlung erhalten“, Label „Zahlung ausstehend“ entfernen
* **Rechnung überfällig** → Mahnentwurf vorbereiten, Kunde mit Label „Zahlungsverzug“ markieren, Buchhaltung informieren
* **Kontakt aktualisiert** → Änderung dokumentieren, Folge-Workflows anstoßen

## Zeitpläne einrichten (einfach)

Im Admin-Bereich wählen Sie einfach:
* **Stündlich** — jede volle Stunde
* **Täglich** — z. B. 08:30 Uhr
* **Wöchentlich** — z. B. montags 08:00
* **Cron-Ausdruck** — für Profis (z. B. „monatlich am 1. um 9 Uhr“)

## Sicherheit: Kein Doppel-Versand, keine ungeprüften Mails

* **Schutz vor Doppel-Ausführung:** Wenn ein Ereignis zweimal kommt (z. B. durch einen Klick-Doppler), startet der Workflow nur einmal.
* **E-Mails nur mit Freigabe:** Automatisierte E-Mails landen immer zuerst als **Entwurf** — Sie geben frei, dann geht sie raus. Niemals automatisch und ungeprüft.
* **Fehler werden abgefangen:** Schlägt ein Schritt fehl (z. B. E-Mail-Server nicht erreichbar), bricht der Workflow sauber ab und protokolliert die Ursache — Sie können ihn später fortsetzen.

---

# 🔧 Teil 2 — Für Entwickler (technische Details)

## 1. Die drei Trigger-Arten

| Trigger | Auslöser | Anwendungsbeispiel |
|---|---|---|
| **`MANUAL`** | Benutzer startet Workflow per Knopfdruck im UI oder per Chat-Anweisung an Louis | „Starte den Wochenbericht“ |
| **`CRM_EVENT`** | System-Ereignis auf dem Event-Bus (`workflowEventBus`) | Rechnung überfällig → Mahnlauf |
| **`TIMER`** | Zeitgesteuerter Scheduler (stündlich / täglich / wöchentlich / 5-Felder-Cron) | Täglich 08:30 Uhr → Tagesreport |

## 2. CRM-Events (Ereignis-Trigger)

Das System emittiert Events bei Datenbewegungen; Workflows mit passendem `event_name` starten sekundenschnell:

### Kern-Entitäten
* **Rechnungen**: `invoice.created`, `invoice.updated`, `invoice.finalized`, `invoice.paid`, `invoice.overdue`, `invoice.status_changed`, `invoice.status_updated`
* **Kontakte**: `contact.created`, `contact.updated`, `contact.deleted`
* **Unternehmen**: `company.created`, `company.updated`, `company.deleted`
* **Angebote**: `offer.created`, `offer.finalized`, `offer.sent`, `offer.status_updated`
* **Kanban**: `kanban.board_created`, `kanban.card_created`, `kanban.card_updated`, `kanban.card_moved`, `kanban.card_deleted`, `kanban.column_created` (die früheren Approval-Trigger haben keinen aktiven Datenpfad — obsoletes Subsystem)
* **Dateien**: `file.uploaded` (Datei an Kontakt/Unternehmen), `knowledge.file_uploaded` (Datei ins interne Wissen)
* **Weitere**: `council.session_degraded_fallback`

### Trigger-Bedingungen (Filter) & Verknüpfung

Ereignis-Trigger können über `trigger_config` eingegrenzt werden:

```json
{
  "event_name": "file.uploaded",
  "logic": "AND",
  "conditions": [
    { "field": "company_id", "operator": "equals", "value": "<id>" },
    { "field": "file_name", "operator": "ends_with", "value": ".pdf" }
  ]
}
```

* **`logic`**: `AND` (alle Bedingungen müssen erfüllt sein, Default) oder
  `OR` (mindestens eine). Ohne `conditions`-Feld greift das Altverhalten:
  jedes Ereignis des Typs startet.
* **`field`** (Whitelist): `entity_type`, `entity_id`, `entity_name`,
  `file_name`, `company_id`, `company_name`, `invoice_status`,
  `kanban_column_id`.
* **`operator`**: `equals`, `not_equals`, `contains`, `starts_with`,
  `ends_with`.
* **Fehlendes Feld im Payload** → Bedingung gilt als nicht erfüllt (kein
  stiller Start). Der angereicherte Payload enthält für Uploads zusätzlich
  `company_id`/`company_name` (bei Firmen direkt, bei Kontakten über die
  zugeordnete Firma).
* **Louis-Lernen**: `learn_workflow` akzeptiert optional `trigger_type` und
  `trigger_config` (siehe oben) — Louis kann Trigger-Workflows per Chat
  speichern; unstrukturierte Lern-Inputs mit Trigger-Hinweisen (z. B.
  „wenn eine Datei hochgeladen wird“) werden deterministisch erkannt.

### Klassische Trigger-Ereignisse
* 🟢 **`invoice.paid`** — Zahlungseingang gebucht → Zahlungsbestätigung senden, Timeline-Notiz, Label „Zahlung ausstehend“ entfernen
* 🔴 **`invoice.overdue`** — Fälligkeitsdatum überschritten (Scheduler prüft kontinuierlich) → Mahnentwurf, Label „Zahlungsverzug“, Buchhaltung benachrichtigen
* 👥 **`contact.updated`** — Kontaktdaten geändert → Abgleich, Audit, Folge-Workflows
* 🏢 **`company.updated`** — Stammdaten geändert → Konsistenzprüfung, Zuständigkeiten aktualisieren

## 3. Timer-Trigger & Cron

Der Hintergrund-Scheduler (`workflowEngine.ts`) prüft alle **10 Sekunden** fällige Aufgaben:

| Frequenz | Konfiguration |
|---|---|
| `hourly` | Jede volle Stunde |
| `daily` | Täglich zu `schedule_time` (Default **08:30**) |
| `weekly` | Wöchentlich an `schedule_weekday` (1=Mo … 7=So) + Uhrzeit |
| `cron` | **5-Felder-Cron-Expression** (Minute Stunde Tag Monat Wochentag) — z. B. `0 8 * * 1` = montags 08:00 |

* **Delayed Queue**: Schritte mit `delay_seconds` → Zustand `PENDING_DELAY` → Reaktivierung bei `execute_at_utc`.
* **Migration**: TIMER-Last-Run-Marker werden automatisch von Legacy-Speicherorten migriert (idempotent).

## 4. Verwaltung (Admin)

Admin → **„Louis AI Workflows“** (`src/components/admin/LouisAiWorkflowsTab.tsx`):

```
+-------------------------------------------------------------------------+
|  1. TRIGGER-TYP WÄHLEN          2. AKTIONEN DEFINIEREN (DAG)            |
|  [ CRM_EVENT               ▼ ]  [ Aktion: E-Mail vorbereiten  ]        |
|  Ereignis: [ invoice.paid  ▼ ]  [ Aktion: Label hinzufügen     ]        |
|  ODER TIMER: [ daily 08:30 ]    [ Aktion: Notiz schreiben      ]        |
+-------------------------------------------------------------------------+
```

* **Aktiv/Inaktiv**: `toggleWorkflowStatus`
* **Trigger ändern**: `updateWorkflowTrigger`
* **Manueller Start**: `triggerWorkflowManually`
* **Human-Gate**: `approveWorkflowHumanGate`
* **Dry-Run**: `dryRunWorkflow` (Simulation ohne Seiteneffekte)
* **Versionierung**: `skill_version` + `version_history` (Changelog)
* **1-Klick-Vorlagen**: Zahlungserinnerung, Angebot nachfassen, Onboarding, Overdue-Report

## 5. Praxisbeispiel: Automatisierter Mahnlauf

```
┌─────────────────────────────────┐
│     Hintergrund-Scheduler       │  ➔ Errechnet Fälligkeit
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Trigger: `invoice.overdue`    │  ➔ Zündet bei Überschreitung
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│   Schritt 1: Notiz in Timeline  │  ➔ "Rechnung Nr. 1042 überfällig"
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Schritt 2: Label "In Verzug"   │  ➔ Kundenprofil wird getaggt
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────┐
│  Schritt 3: Mail-Draft          │  ➔ E-Mail-Entwurf (Status PENDING)
└────────────────┬────────────────┘
                 ▼
 🛑 [ HUMAN-IN-THE-LOOP ]         ➔ Mitarbeiter prüft & gibt frei
                 ▼
┌─────────────────────────────────┐
│       Versand über SMTP         │  ➔ Rechtskonform an den Kunden
└─────────────────────────────────┘
```

## 6. Sicherheit, Integrität & Schutzmechanismen

1. **Doppel-Ausführungsschutz (Idempotency Guard)**:
   * Duplikats-Filter: identische Events innerhalb 15 Sekunden werden blockiert
   * Pipeline-Sperre: kein zweiter Lauf derselben Rezeptur + Entität in `PENDING_DELAY`/`RUNNING`
2. **Human-in-the-Loop standardmäßig aktiv**: E-Mails werden nie ungeprüft versendet (Draft `PENDING` → Freigabe-Center).
3. **Asynchrone Fehlerbehandlung**: Fehler → `FAILED` + präzise Ursache im `execution_log`; manuelle Fortsetzung nach Behebung möglich.
4. **Abwärtskompatibilität**: Legacy-Workflows ohne `dag_structure` werden beim Start automatisch in DAGs konvertiert (kein Datenverlust).
