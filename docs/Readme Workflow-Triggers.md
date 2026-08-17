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
* **Sonstiges:** Datei hochgeladen, Council-Fallback

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
* **Kanban**: `kanban.board_created`, `kanban.card_created`, `kanban.card_updated`, `kanban.card_moved`, `kanban.card_deleted`, `kanban.column_created`, `kanban.approval_approved`, `kanban.approval_rejected`
* **Weitere**: `file.uploaded`, `council.session_degraded_fallback`

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
* **S7-Migration**: TIMER-Last-Run-Marker werden automatisch von Legacy-Speicherorten migriert (idempotent).

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
